import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

type Workflow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
};

type WorkflowMessage = {
  id: string;
  workflow_id: string;
  workflow_step_id: string | null;
  ai_employee_id: string | null;
  sender_type: string;
  message_type: string;
  content: string;
  created_at: string;
};

type WorkflowStep = {
  id: string;
  step_order: number;
  name: string;
};

type AiEmployee = {
  id: string;
  name: string;
  role: string | null;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function getSenderLabel(
  message: WorkflowMessage,
  employeeMap: Map<string, AiEmployee>,
) {
  if (message.sender_type === "CEO") {
    return "CEO";
  }

  if (message.sender_type === "SYSTEM") {
    return "STAR WORK OS";
  }

  if (message.ai_employee_id) {
    return (
      employeeMap.get(message.ai_employee_id)?.name ??
      "AI社員"
    );
  }

  return "AI社員";
}

function getSenderRole(
  message: WorkflowMessage,
  employeeMap: Map<string, AiEmployee>,
) {
  if (message.sender_type === "CEO") {
    return "最高経営責任者";
  }

  if (message.sender_type === "SYSTEM") {
    return "システム";
  }

  if (message.ai_employee_id) {
    return (
      employeeMap.get(message.ai_employee_id)?.role ??
      "担当AI社員"
    );
  }

  return "担当AI社員";
}

function getMessageTypeLabel(messageType: string) {
  switch (messageType) {
    case "MESSAGE":
      return "メッセージ";
    case "REPORT":
      return "報告";
    case "QUESTION":
      return "質問";
    case "HANDOFF":
      return "引継ぎ";
    case "APPROVAL_REQUEST":
      return "承認依頼";
    case "APPROVAL_RESULT":
      return "承認結果";
    case "ERROR":
      return "エラー";
    default:
      return messageType;
  }
}

function getMessageCardClassName(senderType: string) {
  switch (senderType) {
    case "CEO":
      return "ml-auto border-blue-200 bg-blue-50";
    case "SYSTEM":
      return "mx-auto border-gray-300 bg-gray-100";
    default:
      return "mr-auto border-emerald-200 bg-emerald-50";
  }
}

function getAvatarClassName(senderType: string) {
  switch (senderType) {
    case "CEO":
      return "bg-blue-600 text-white";
    case "SYSTEM":
      return "bg-gray-700 text-white";
    default:
      return "bg-emerald-600 text-white";
  }
}

function getInitials(name: string) {
  const trimmed = name.trim();

  if (!trimmed) {
    return "AI";
  }

  if (trimmed === "CEO") {
    return "CEO";
  }

  if (trimmed === "STAR WORK OS") {
    return "OS";
  }

  const words = trimmed.split(/\s+/);

  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join("");
  }

  return trimmed.slice(0, 2).toUpperCase();
}

export default async function WorkflowChatPage({
  params,
}: {
  params: Promise<{
    id: string;
  }>;
}) {
  const { id } = await params;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: workflow, error: workflowError } =
    await supabase
      .from("workflows")
      .select(`
        id,
        title,
        description,
        status,
        priority
      `)
      .eq("id", id)
      .maybeSingle();

  if (workflowError) {
    throw new Error(
      `Workflowの取得に失敗しました: ${workflowError.message}`,
    );
  }

  if (!workflow) {
    notFound();
  }

  const { data: messageData, error: messageError } =
    await supabase
      .from("workflow_messages")
      .select(`
        id,
        workflow_id,
        workflow_step_id,
        ai_employee_id,
        sender_type,
        message_type,
        content,
        created_at
      `)
      .eq("workflow_id", id)
      .order("created_at", { ascending: true });

  if (messageError) {
    throw new Error(
      `会話履歴の取得に失敗しました: ${messageError.message}`,
    );
  }

  const messages: WorkflowMessage[] = messageData ?? [];

  const stepIds = Array.from(
    new Set(
      messages
        .map((message) => message.workflow_step_id)
        .filter((stepId): stepId is string => Boolean(stepId)),
    ),
  );

  const employeeIds = Array.from(
    new Set(
      messages
        .map((message) => message.ai_employee_id)
        .filter((employeeId): employeeId is string =>
          Boolean(employeeId),
        ),
    ),
  );

  let steps: WorkflowStep[] = [];
  let employees: AiEmployee[] = [];

  if (stepIds.length > 0) {
    const { data: stepData, error: stepError } =
      await supabase
        .from("workflow_steps")
        .select(`
          id,
          step_order,
          name
        `)
        .in("id", stepIds);

    if (stepError) {
      throw new Error(
        `Workflow STEPの取得に失敗しました: ${stepError.message}`,
      );
    }

    steps = stepData ?? [];
  }

  if (employeeIds.length > 0) {
    const { data: employeeData, error: employeeError } =
      await supabase
        .from("ai_employees")
        .select(`
          id,
          name,
          role
        `)
        .in("id", employeeIds);

    if (employeeError) {
      throw new Error(
        `AI社員の取得に失敗しました: ${employeeError.message}`,
      );
    }

    employees = employeeData ?? [];
  }

  const stepMap = new Map(
    steps.map((step) => [step.id, step]),
  );

  const employeeMap = new Map(
    employees.map((employee) => [employee.id, employee]),
  );

  const ceoMessageCount = messages.filter(
    (message) => message.sender_type === "CEO",
  ).length;

  const aiMessageCount = messages.filter(
    (message) => message.sender_type === "AI_EMPLOYEE",
  ).length;

  const systemMessageCount = messages.filter(
    (message) => message.sender_type === "SYSTEM",
  ).length;

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap gap-4">
          <Link
            href={`/workflows/${workflow.id}`}
            className="text-sm font-semibold text-gray-700 underline"
          >
            ← Workflow詳細へ戻る
          </Link>

          <Link
            href="/workflows"
            className="text-sm font-semibold text-gray-700 underline"
          >
            Workflows一覧
          </Link>

          <Link
            href="/dashboard"
            className="text-sm font-semibold text-gray-700 underline"
          >
            Dashboardへ戻る
          </Link>
        </div>

        <header className="rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-gray-500">
            STAR WORK OS
          </p>

          <h1 className="mt-2 text-3xl font-bold text-gray-900">
            AI社員チャット
          </h1>

          <p className="mt-3 text-xl font-bold text-gray-900">
            {workflow.title}
          </p>

          <p className="mt-2 text-sm leading-6 text-gray-600">
            {workflow.description ?? "説明はありません。"}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
              {workflow.status}
            </span>

            <span className="rounded-full bg-black px-3 py-1 text-xs font-bold text-white">
              優先度 {workflow.priority}
            </span>
          </div>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            title="総メッセージ"
            value={String(messages.length)}
          />

          <SummaryCard
            title="CEO"
            value={String(ceoMessageCount)}
          />

          <SummaryCard
            title="AI社員"
            value={String(aiMessageCount)}
          />

          <SummaryCard
            title="システム"
            value={String(systemMessageCount)}
          />
        </section>

        <section className="mt-6 rounded-2xl bg-white p-4 shadow-sm md:p-6">
          <div className="border-b border-gray-200 pb-5">
            <h2 className="text-xl font-bold text-gray-900">
              Conversation
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              CEOとAI社員の会話・報告・引継ぎを時系列で表示します。
            </p>
          </div>

          {messages.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-semibold text-gray-600">
                このWorkflowには、まだ会話履歴がありません。
              </p>

              <p className="mt-2 text-sm text-gray-500">
                STEP詳細画面から「AI社員へ依頼する」を実行すると、
                会話がここへ保存されます。
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              {messages.map((message) => {
                const senderName = getSenderLabel(
                  message,
                  employeeMap,
                );

                const senderRole = getSenderRole(
                  message,
                  employeeMap,
                );

                const step = message.workflow_step_id
                  ? stepMap.get(message.workflow_step_id)
                  : null;

                return (
                  <article
                    key={message.id}
                    className={`flex max-w-4xl gap-3 rounded-2xl border p-4 md:p-5 ${getMessageCardClassName(
                      message.sender_type,
                    )}`}
                  >
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xs font-black ${getAvatarClassName(
                        message.sender_type,
                      )}`}
                    >
                      {getInitials(senderName)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-bold text-gray-900">
                            {senderName}
                          </p>

                          <p className="mt-1 text-xs font-semibold text-gray-500">
                            {senderRole}
                          </p>
                        </div>

                        <p className="shrink-0 text-xs text-gray-500">
                          {formatDateTime(message.created_at)}
                        </p>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-gray-700 shadow-sm">
                          {getMessageTypeLabel(message.message_type)}
                        </span>

                        {step && (
                          <Link
                            href={`/workflows/${workflow.id}/steps/${step.id}`}
                            className="rounded-full bg-white px-3 py-1 text-xs font-bold text-gray-700 shadow-sm hover:bg-gray-50"
                          >
                            STEP {step.step_order}：{step.name}
                          </Link>
                        )}
                      </div>

                      <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-gray-700">
                        {message.content}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function SummaryCard({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">
        {title}
      </p>

      <p className="mt-3 text-3xl font-bold text-gray-900">
        {value}
      </p>
    </div>
  );
}