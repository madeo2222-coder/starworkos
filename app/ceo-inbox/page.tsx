import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

type InboxDecision = "APPROVED" | "REJECTED" | "ACKNOWLEDGED";
type StatusFilter = "unread" | "read" | "all";
type TypeFilter =
  | "all"
  | "APPROVAL_REQUEST"
  | "REVIEW_REQUEST"
  | "WARNING"
  | "ERROR"
  | "REPORT";
type PriorityFilter = "all" | "URGENT" | "HIGH" | "NORMAL" | "LOW";
type SortFilter = "newest" | "oldest";
type QueryValue = string | string[] | undefined;

type InboxFilters = {
  status: StatusFilter;
  type: TypeFilter;
  priority: PriorityFilter;
  q: string;
  sort: SortFilter;
  page: number;
};

type InboxSearchParams = {
  status?: QueryValue;
  type?: QueryValue;
  priority?: QueryValue;
  q?: QueryValue;
  sort?: QueryValue;
  page?: QueryValue;
  result?: QueryValue;
};

const PAGE_SIZE = 20;
const TYPE_FILTERS: TypeFilter[] = [
  "all",
  "APPROVAL_REQUEST",
  "REVIEW_REQUEST",
  "WARNING",
  "ERROR",
  "REPORT",
];
const PRIORITY_FILTERS: PriorityFilter[] = [
  "all",
  "URGENT",
  "HIGH",
  "NORMAL",
  "LOW",
];

type CeoInboxItem = {
  id: string;
  title: string;
  message: string;
  item_type: string;
  status: string;
  priority: string;
  workflow_id: string | null;
  created_at: string;
};

type Workflow = {
  id: string;
  title: string;
  current_step_order: number | null;
};

type WorkflowStep = {
  id: string;
  workflow_id: string;
  step_order: number;
  name: string;
  requires_human_approval: boolean | null;
};

function firstQueryValue(value: QueryValue) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeFilters(params: InboxSearchParams): InboxFilters {
  const statusValue = firstQueryValue(params.status);
  const typeValue = firstQueryValue(params.type);
  const priorityValue = firstQueryValue(params.priority);
  const sortValue = firstQueryValue(params.sort);
  const pageValue = firstQueryValue(params.page);
  const qValue = firstQueryValue(params.q) ?? "";

  const status: StatusFilter = ["unread", "read", "all"].includes(
    statusValue ?? "",
  )
    ? (statusValue as StatusFilter)
    : "unread";
  const type: TypeFilter = TYPE_FILTERS.includes(
    typeValue as TypeFilter,
  )
    ? (typeValue as TypeFilter)
    : "all";
  const priority: PriorityFilter = PRIORITY_FILTERS.includes(
    priorityValue as PriorityFilter,
  )
    ? (priorityValue as PriorityFilter)
    : "all";
  const sort: SortFilter =
    sortValue === "oldest" ? "oldest" : "newest";
  const page =
    pageValue && /^[1-9]\d*$/.test(pageValue)
      ? Number(pageValue)
      : 1;

  return {
    status,
    type,
    priority,
    q: qValue.trim().slice(0, 100),
    sort,
    page: Number.isSafeInteger(page) ? page : 1,
  };
}

function buildInboxUrl(
  filters: InboxFilters,
  options?: {
    page?: number;
    result?: string;
  },
) {
  const params = new URLSearchParams({
    status: filters.status,
    type: filters.type,
    priority: filters.priority,
    sort: filters.sort,
    page: String(options?.page ?? filters.page),
  });

  if (filters.q) {
    params.set("q", filters.q);
  }

  if (options?.result) {
    params.set("result", options.result);
  }

  return `/ceo-inbox?${params.toString()}`;
}

function escapePostgrestIlike(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

function getInboxTypeLabel(itemType: string) {
  switch (itemType) {
    case "APPROVAL_REQUEST":
      return "承認依頼";
    case "REVIEW_REQUEST":
      return "確認依頼";
    case "WARNING":
      return "警告";
    case "ERROR":
      return "エラー";
    case "REPORT":
      return "報告";
    default:
      return itemType;
  }
}

function getPriorityLabel(priority: string) {
  switch (priority) {
    case "URGENT":
      return "緊急";
    case "HIGH":
      return "高";
    case "NORMAL":
      return "通常";
    case "LOW":
      return "低";
    default:
      return priority;
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function ReturnFilterInputs({
  filters,
}: {
  filters: InboxFilters;
}) {
  return (
    <>
      <input type="hidden" name="returnStatus" value={filters.status} />
      <input type="hidden" name="returnType" value={filters.type} />
      <input
        type="hidden"
        name="returnPriority"
        value={filters.priority}
      />
      <input type="hidden" name="returnQ" value={filters.q} />
      <input type="hidden" name="returnSort" value={filters.sort} />
      <input type="hidden" name="returnPage" value={filters.page} />
    </>
  );
}

async function resolveInboxItem(formData: FormData) {
  "use server";

  const inboxItemId = String(formData.get("inboxItemId") ?? "").trim();
  const workflowId = String(formData.get("workflowId") ?? "").trim();
  const decision = String(
    formData.get("decision") ?? "",
  ) as InboxDecision;
  const returnFilters = normalizeFilters({
    status: String(formData.get("returnStatus") ?? ""),
    type: String(formData.get("returnType") ?? ""),
    priority: String(formData.get("returnPriority") ?? ""),
    q: String(formData.get("returnQ") ?? ""),
    sort: String(formData.get("returnSort") ?? ""),
    page: String(formData.get("returnPage") ?? ""),
  });

  if (
    !inboxItemId ||
    !["APPROVED", "REJECTED", "ACKNOWLEDGED"].includes(decision)
  ) {
    throw new Error("CEO Inboxの処理情報が正しくありません。");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: inboxItem, error: inboxError } = await supabase
    .from("ceo_inbox")
    .select("id, item_type, status, workflow_id")
    .eq("id", inboxItemId)
    .maybeSingle();

  if (inboxError) {
    throw new Error(
      `CEO Inboxの取得に失敗しました: ${inboxError.message}`,
    );
  }

  if (!inboxItem || inboxItem.status !== "UNREAD") {
    throw new Error("このCEO Inboxはすでに処理されています。");
  }

  const isApprovalRequest =
    inboxItem.item_type === "APPROVAL_REQUEST";

  if (isApprovalRequest) {
    if (
      decision === "ACKNOWLEDGED" ||
      !workflowId ||
      inboxItem.workflow_id !== workflowId
    ) {
      throw new Error(
        "承認待ち通知は、承認または却下で処理してください。",
      );
    }
  } else if (decision !== "ACKNOWLEDGED") {
    throw new Error(
      "完了通知・報告・確認事項は、確認済みとして処理してください。",
    );
  }

  if (decision === "APPROVED") {
    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("id, current_step_order")
      .eq("id", workflowId)
      .maybeSingle();

    if (workflowError) {
      throw new Error(
        `Workflowの取得に失敗しました: ${workflowError.message}`,
      );
    }

    if (!workflow || workflow.current_step_order === null) {
      throw new Error("承認対象の現在STEPが見つかりません。");
    }

    const { data: currentStep, error: stepError } = await supabase
      .from("workflow_steps")
      .select("id, name, requires_human_approval")
      .eq("workflow_id", workflowId)
      .eq("step_order", workflow.current_step_order)
      .maybeSingle();

    if (stepError) {
      throw new Error(
        `現在STEPの取得に失敗しました: ${stepError.message}`,
      );
    }

    if (!currentStep) {
      throw new Error("承認対象の現在STEPが見つかりません。");
    }

    if (currentStep.requires_human_approval) {
      const { error: approvalError } = await supabase
        .from("workflow_steps")
        .update({
          requires_human_approval: false,
        })
        .eq("id", currentStep.id)
        .eq("workflow_id", workflowId)
        .eq("requires_human_approval", true);

      if (approvalError) {
        throw new Error(
          `STEPの承認に失敗しました: ${approvalError.message}`,
        );
      }
    }

    const { error: messageError } = await supabase
      .from("workflow_messages")
      .insert({
        workflow_id: workflowId,
        workflow_step_id: currentStep.id,
        sender_type: "CEO",
        message_type: "APPROVAL_RESULT",
        content: `CEOがSTEP「${currentStep.name}」を承認しました。`,
        created_by_user_id: user.id,
      });

    if (messageError) {
      throw new Error(
        `承認結果の保存に失敗しました: ${messageError.message}`,
      );
    }
  }

  if (decision === "REJECTED") {
    const { error: messageError } = await supabase
      .from("workflow_messages")
      .insert({
        workflow_id: workflowId,
        sender_type: "CEO",
        message_type: "APPROVAL_RESULT",
        content:
          "CEOが承認依頼を却下しました。内容を確認し、修正後に再申請してください。",
        created_by_user_id: user.id,
      });

    if (messageError) {
      throw new Error(
        `却下結果の保存に失敗しました: ${messageError.message}`,
      );
    }
  }

  const { error: updateError } = await supabase
    .from("ceo_inbox")
    .update({
      status: "READ",
    })
    .eq("id", inboxItemId)
    .eq("status", "UNREAD");

  if (updateError) {
    throw new Error(
      `CEO Inboxの更新に失敗しました: ${updateError.message}`,
    );
  }

  revalidatePath("/ceo-inbox");
  revalidatePath("/dashboard");

  if (workflowId) {
    revalidatePath(`/workflows/${workflowId}`);
    revalidatePath(`/workflows/${workflowId}/chat`);
  }

  const result =
    decision === "APPROVED"
      ? "approved"
      : decision === "REJECTED"
        ? "rejected"
        : "acknowledged";

  redirect(
    buildInboxUrl(returnFilters, {
      result,
    }),
  );
}

export default async function CeoInboxPage({
  searchParams,
}: {
  searchParams: Promise<InboxSearchParams>;
}) {
  const rawSearchParams = await searchParams;
  const filters = normalizeFilters(rawSearchParams);
  const result = firstQueryValue(rawSearchParams.result);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let inboxQuery = supabase
    .from("ceo_inbox")
    .select(
      `
        id,
        title,
        message,
        item_type,
        status,
        priority,
        workflow_id,
        created_at
      `,
      {
        count: "exact",
      },
    );

  if (filters.status === "unread") {
    inboxQuery = inboxQuery.eq("status", "UNREAD");
  } else if (filters.status === "read") {
    inboxQuery = inboxQuery.eq("status", "READ");
  }

  if (filters.type !== "all") {
    inboxQuery = inboxQuery.eq("item_type", filters.type);
  }

  if (filters.priority !== "all") {
    inboxQuery = inboxQuery.eq("priority", filters.priority);
  }

  if (filters.q) {
    const escapedKeyword = escapePostgrestIlike(filters.q);
    const pattern = `"%${escapedKeyword}%"`;

    inboxQuery = inboxQuery.or(
      `title.ilike.${pattern},message.ilike.${pattern}`,
    );
  }

  const rangeFrom = (filters.page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  const [inboxResult, unreadCountResult] = await Promise.all([
    inboxQuery
      .order("created_at", {
        ascending: filters.sort === "oldest",
      })
      .range(rangeFrom, rangeTo),

    supabase
      .from("ceo_inbox")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("status", "UNREAD"),
  ]);

  if (inboxResult.error) {
    throw new Error(
      `CEO Inboxの取得に失敗しました: ${inboxResult.error.message}`,
    );
  }

  if (unreadCountResult.error) {
    throw new Error(
      `CEO Inbox未処理件数の取得に失敗しました: ${unreadCountResult.error.message}`,
    );
  }

  const totalCount = inboxResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const unreadTotalCount = unreadCountResult.count ?? 0;

  if (filters.page > totalPages) {
    redirect(
      buildInboxUrl(filters, {
        page: totalPages,
        result,
      }),
    );
  }

  const inboxItems: CeoInboxItem[] = inboxResult.data ?? [];
  const workflowIds = Array.from(
    new Set(
      inboxItems
        .map((item) => item.workflow_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  let workflows: Workflow[] = [];
  let currentSteps: WorkflowStep[] = [];

  if (workflowIds.length > 0) {
    const { data: workflowData, error: workflowError } = await supabase
      .from("workflows")
      .select("id, title, current_step_order")
      .in("id", workflowIds);

    if (workflowError) {
      throw new Error(
        `Workflowの取得に失敗しました: ${workflowError.message}`,
      );
    }

    workflows = workflowData ?? [];

    const { data: stepData, error: stepError } = await supabase
      .from("workflow_steps")
      .select(`
        id,
        workflow_id,
        step_order,
        name,
        requires_human_approval
      `)
      .in("workflow_id", workflowIds);

    if (stepError) {
      throw new Error(
        `Workflow STEPの取得に失敗しました: ${stepError.message}`,
      );
    }

    const workflowMap = new Map(
      workflows.map((workflow) => [workflow.id, workflow]),
    );

    currentSteps = (stepData ?? []).filter((step) => {
      const workflow = workflowMap.get(step.workflow_id);
      return workflow?.current_step_order === step.step_order;
    });
  }

  const workflowMap = new Map(
    workflows.map((workflow) => [workflow.id, workflow]),
  );
  const currentStepMap = new Map(
    currentSteps.map((step) => [step.workflow_id, step]),
  );
  const unreadItems = inboxItems.filter(
    (item) => item.status === "UNREAD",
  );
  const processedItems = inboxItems.filter(
    (item) => item.status !== "UNREAD",
  );

  const resultMessage =
    result === "approved"
      ? "承認しました。自動リレーを再開できます。"
      : result === "rejected"
        ? "承認依頼を却下しました。"
        : result === "acknowledged"
          ? "確認済みにしました。"
          : null;

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap gap-4">
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-gray-700 underline"
          >
            ← Dashboardへ戻る
          </Link>

          <Link
            href="/workflows"
            className="text-sm font-semibold text-gray-700 underline"
          >
            Workflows一覧
          </Link>
        </div>

        <header className="rounded-2xl bg-white p-6 shadow-sm md:p-8">
          <p className="text-sm font-semibold text-gray-500">
            STAR WORK OS
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                CEO Inbox
              </h1>

              <p className="mt-2 text-sm leading-6 text-gray-600">
                AI社員から届いた承認依頼・確認事項・報告を処理します。
              </p>
            </div>

            <span className="rounded-full bg-amber-100 px-4 py-2 text-sm font-bold text-amber-900">
              未処理 {unreadTotalCount}件
            </span>
          </div>
        </header>

        <form
          method="get"
          action="/ceo-inbox"
          className="mt-6 rounded-2xl bg-white p-5 shadow-sm"
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <label className="text-sm font-semibold text-gray-700">
              状態
              <select
                name="status"
                defaultValue={filters.status}
                className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 font-normal"
              >
                <option value="unread">未処理</option>
                <option value="read">処理済み</option>
                <option value="all">すべて</option>
              </select>
            </label>

            <label className="text-sm font-semibold text-gray-700">
              種別
              <select
                name="type"
                defaultValue={filters.type}
                className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 font-normal"
              >
                <option value="all">すべて</option>
                <option value="APPROVAL_REQUEST">承認依頼</option>
                <option value="REVIEW_REQUEST">確認依頼</option>
                <option value="WARNING">警告</option>
                <option value="ERROR">エラー</option>
                <option value="REPORT">報告</option>
              </select>
            </label>

            <label className="text-sm font-semibold text-gray-700">
              優先度
              <select
                name="priority"
                defaultValue={filters.priority}
                className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 font-normal"
              >
                <option value="all">すべて</option>
                <option value="URGENT">緊急</option>
                <option value="HIGH">高</option>
                <option value="NORMAL">通常</option>
                <option value="LOW">低</option>
              </select>
            </label>

            <label className="text-sm font-semibold text-gray-700">
              並び順
              <select
                name="sort"
                defaultValue={filters.sort}
                className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 font-normal"
              >
                <option value="newest">新しい順</option>
                <option value="oldest">古い順</option>
              </select>
            </label>

            <label className="text-sm font-semibold text-gray-700">
              キーワード
              <input
                type="search"
                name="q"
                defaultValue={filters.q}
                placeholder="タイトル・本文を検索"
                maxLength={100}
                className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2 font-normal"
              />
            </label>
          </div>

          <input type="hidden" name="page" value="1" />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="rounded-xl bg-black px-5 py-2 text-sm font-bold text-white hover:bg-gray-800"
            >
              絞り込む
            </button>

            <Link
              href="/ceo-inbox"
              className="rounded-xl border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
            >
              条件をリセット
            </Link>

            <p className="ml-auto text-sm text-gray-600">
              総件数 {totalCount}件
            </p>
          </div>
        </form>

        {resultMessage && (
          <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-900">
            {resultMessage}
          </p>
        )}

        {inboxItems.length === 0 && (
          <div className="mt-6 rounded-2xl bg-white p-8 text-center text-sm text-gray-600 shadow-sm">
            条件に一致する通知はありません
          </div>
        )}

        {unreadItems.length > 0 && (
          <section className="mt-6">
            <h2 className="text-xl font-bold text-gray-900">未処理</h2>

            <div className="mt-4 space-y-4">
              {unreadItems.map((item) => {
                const workflow = item.workflow_id
                  ? workflowMap.get(item.workflow_id)
                  : null;
                const currentStep = item.workflow_id
                  ? currentStepMap.get(item.workflow_id)
                  : null;
                const isApproval =
                  item.item_type === "APPROVAL_REQUEST" &&
                  Boolean(item.workflow_id);

                return (
                  <article
                    key={item.id}
                    className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
                            {getInboxTypeLabel(item.item_type)}
                          </span>

                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                            優先度 {getPriorityLabel(item.priority)}
                          </span>
                        </div>

                        <h3 className="mt-4 text-lg font-bold text-gray-900">
                          {item.title}
                        </h3>

                        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-700">
                          {item.message}
                        </p>

                        {workflow && (
                          <div className="mt-4 rounded-xl bg-gray-50 p-4">
                            <p className="text-sm font-bold text-gray-900">
                              {workflow.title}
                            </p>

                            <p className="mt-1 text-sm text-gray-600">
                              {currentStep
                                ? `現在 STEP ${currentStep.step_order}：${currentStep.name}`
                                : "現在STEPを取得できませんでした。"}
                            </p>
                          </div>
                        )}
                      </div>

                      <p className="text-xs text-gray-500">
                        {formatDateTime(item.created_at)}
                      </p>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                      {item.workflow_id && (
                        <Link
                          href={`/workflows/${item.workflow_id}`}
                          className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                        >
                          Workflowを確認
                        </Link>
                      )}

                      {isApproval ? (
                        <>
                          <form action={resolveInboxItem}>
                            <ReturnFilterInputs filters={filters} />
                            <input
                              type="hidden"
                              name="inboxItemId"
                              value={item.id}
                            />
                            <input
                              type="hidden"
                              name="workflowId"
                              value={item.workflow_id ?? ""}
                            />
                            <input
                              type="hidden"
                              name="decision"
                              value="APPROVED"
                            />
                            <button
                              type="submit"
                              className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700"
                            >
                              承認する
                            </button>
                          </form>

                          <form action={resolveInboxItem}>
                            <ReturnFilterInputs filters={filters} />
                            <input
                              type="hidden"
                              name="inboxItemId"
                              value={item.id}
                            />
                            <input
                              type="hidden"
                              name="workflowId"
                              value={item.workflow_id ?? ""}
                            />
                            <input
                              type="hidden"
                              name="decision"
                              value="REJECTED"
                            />
                            <button
                              type="submit"
                              className="rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-700"
                            >
                              却下する
                            </button>
                          </form>
                        </>
                      ) : (
                        <form action={resolveInboxItem}>
                          <ReturnFilterInputs filters={filters} />
                          <input
                            type="hidden"
                            name="inboxItemId"
                            value={item.id}
                          />
                          <input
                            type="hidden"
                            name="workflowId"
                            value={item.workflow_id ?? ""}
                          />
                          <input
                            type="hidden"
                            name="decision"
                            value="ACKNOWLEDGED"
                          />
                          <button
                            type="submit"
                            className="rounded-xl bg-black px-5 py-2 text-sm font-bold text-white hover:bg-gray-800"
                          >
                            確認済みにする
                          </button>
                        </form>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {processedItems.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-bold text-gray-900">処理済み</h2>

            <div className="mt-4 space-y-3">
              {processedItems.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl bg-white p-5 opacity-75 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold text-gray-500">
                        {getInboxTypeLabel(item.item_type)}・{item.status}
                      </p>
                      <p className="mt-2 font-bold text-gray-900">
                        {item.title}
                      </p>
                    </div>

                    <p className="text-xs text-gray-500">
                      {formatDateTime(item.created_at)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <nav
          className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white p-5 shadow-sm"
          aria-label="CEO Inboxのページ移動"
        >
          <div>
            {filters.page > 1 ? (
              <Link
                href={buildInboxUrl(filters, {
                  page: filters.page - 1,
                })}
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
              >
                前へ
              </Link>
            ) : (
              <span className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-400">
                前へ
              </span>
            )}
          </div>

          <p className="text-center text-sm text-gray-600">
            現在ページ {filters.page} / {totalPages}
            <span className="ml-3">総件数 {totalCount}件</span>
          </p>

          <div>
            {filters.page < totalPages ? (
              <Link
                href={buildInboxUrl(filters, {
                  page: filters.page + 1,
                })}
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
              >
                次へ
              </Link>
            ) : (
              <span className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-400">
                次へ
              </span>
            )}
          </div>
        </nav>
      </div>
    </main>
  );
}
