import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

type Task = {
  id: string;
  title: string;
  content: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  assigned_ai_employee_id: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
};

type AiEmployee = {
  id: string;
  name: string;
  role: string | null;
};

type Workflow = {
  id: string;
  title: string;
  status: string;
  current_step_order: number | null;
};

function getStatusLabel(status: string) {
  switch (status) {
    case "NEW":
      return "新規";
    case "PLANNING":
      return "計画中";
    case "IN_PROGRESS":
      return "進行中";
    case "WAITING":
      return "待機中";
    case "COMPLETED":
      return "完了";
    case "CANCELLED":
      return "キャンセル";
    default:
      return status;
  }
}

function formatDate(value: string | null) {
  if (!value) {
    return "未設定";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${value}T00:00:00+09:00`));
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

function toWorkflowPriority(priority: string) {
  switch (priority.toUpperCase()) {
    case "LOW":
    case "低":
      return "低";
    case "MEDIUM":
    case "中":
      return "中";
    case "HIGH":
    case "CRITICAL":
    case "高":
    case "最優先":
      return "高";
    default:
      throw new Error(
        `Taskの優先度をWorkflow用に変換できません: ${priority}`,
      );
  }
}

async function createWorkflowFromTask(formData: FormData) {
  "use server";

  const taskId = String(formData.get("taskId") ?? "").trim();

  if (!taskId) {
    throw new Error("Taskの情報が不足しています。");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select(`
      id,
      title,
      content,
      priority,
      status,
      due_date,
      assigned_ai_employee_id,
      project_id
    `)
    .eq("id", taskId)
    .maybeSingle();

  if (taskError) {
    throw new Error(`Taskの取得に失敗しました: ${taskError.message}`);
  }

  if (!task) {
    throw new Error("対象のTaskが見つかりません。");
  }

  if (task.status !== "NEW") {
    throw new Error(
      "Workflowを生成できるのは状態がNEWのTaskだけです。",
    );
  }

  const { data: existingWorkflow, error: existingWorkflowError } =
    await supabase
      .from("workflows")
      .select("id")
      .eq("task_id", taskId)
      .limit(1)
      .maybeSingle();

  if (existingWorkflowError) {
    throw new Error(
      `関連Workflowの確認に失敗しました: ${existingWorkflowError.message}`,
    );
  }

  if (existingWorkflow) {
    throw new Error(
      "このTaskにはすでに関連Workflowが存在します。",
    );
  }

  let assignedEmployee: AiEmployee | null = null;

  if (task.assigned_ai_employee_id) {
    const { data: employee, error: employeeError } = await supabase
      .from("ai_employees")
      .select("id, name, role")
      .eq("id", task.assigned_ai_employee_id)
      .maybeSingle();

    if (employeeError) {
      throw new Error(
        `担当AIの取得に失敗しました: ${employeeError.message}`,
      );
    }

    assignedEmployee = employee;
  }

  let workflowPriority: string;

  try {
    workflowPriority = toWorkflowPriority(task.priority);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "優先度変換に失敗しました。";

    throw new Error(message);
  }

  const taskContent =
    task.content?.trim() || "Task内容は登録されていません。";
  const dueDate = task.due_date || "未設定";
  const employeeLabel = assignedEmployee
    ? `${assignedEmployee.name}${
        assignedEmployee.role ? `（${assignedEmployee.role}）` : ""
      }`
    : "未割当";
  const workflowDescription = [
    "Taskから生成された開発Workflowです。",
    "",
    "【Task内容】",
    taskContent,
    "",
    `【期限】${dueDate}`,
    `【Task優先度】${task.priority}`,
    `【担当AI】${employeeLabel}`,
  ].join("\n");
  const ceoInstruction = [
    "以下のTaskを実行可能な開発計画へ整理してください。",
    "",
    "【Task】",
    task.title,
    "",
    "【主指示】",
    taskContent,
    "",
    `【期限】${dueDate}`,
    `【優先度】${task.priority}`,
    `【担当AI】${employeeLabel}`,
    "",
    "AI PMは最初に目的、要件、制約、確認事項、完了条件を整理してください。",
    "整理した内容をAI Architect、AI Developer、AI QA、AI Knowledgeが具体的に実行できる形で順番に引き継いでください。",
    "不明な情報は推測で確定せず、確認事項として明示してください。",
  ].join("\n");

  const { data: workflowId, error: workflowCreateError } =
    await supabase.rpc("create_development_workflow", {
      p_project_id: task.project_id,
      p_title: task.title,
      p_description: workflowDescription,
      p_ceo_instruction: ceoInstruction,
      p_priority: workflowPriority,
      p_task_id: taskId,
    });

  if (
    workflowCreateError ||
    !workflowId ||
    typeof workflowId !== "string"
  ) {
    throw new Error(
      workflowCreateError
        ? `Workflowの作成に失敗しました: ${workflowCreateError.message}`
        : "Workflowの作成IDを取得できませんでした。",
    );
  }

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/workflows");
  redirect(`/workflows/${workflowId}`);
}

export default async function TaskDetailPage({
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

  const { data, error } = await supabase
    .from("tasks")
    .select(`
      id,
      title,
      content,
      priority,
      status,
      due_date,
      assigned_ai_employee_id,
      project_id,
      created_at,
      updated_at
    `)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Taskの取得に失敗しました: ${error.message}`);
  }

  if (!data) {
    notFound();
  }

  const task = data as Task;
  let assignedEmployee: AiEmployee | null = null;

  if (task.assigned_ai_employee_id) {
    const { data: employee, error: employeeError } = await supabase
      .from("ai_employees")
      .select("id, name, role")
      .eq("id", task.assigned_ai_employee_id)
      .maybeSingle();

    if (employeeError) {
      throw new Error(
        `担当AIの取得に失敗しました: ${employeeError.message}`,
      );
    }

    assignedEmployee = employee;
  }

  const { data: workflowData, error: workflowError } = await supabase
    .from("workflows")
    .select("id, title, status, current_step_order")
    .eq("task_id", task.id)
    .order("created_at", { ascending: false });

  if (workflowError) {
    throw new Error(
      `関連Workflowの取得に失敗しました: ${workflowError.message}`,
    );
  }

  const workflows: Workflow[] = workflowData ?? [];

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap gap-4">
          <Link
            href="/tasks"
            className="text-sm font-semibold text-gray-700 underline"
          >
            ← Task Centerへ戻る
          </Link>

          <Link
            href="/dashboard"
            className="text-sm font-semibold text-gray-700 underline"
          >
            Dashboardへ戻る
          </Link>
        </div>

        <header className="rounded-2xl bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-500">
                Task
              </p>
              <h1 className="mt-2 text-3xl font-bold text-gray-900">
                {task.title}
              </h1>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-black px-3 py-1 text-xs font-bold text-white">
                優先度 {task.priority}
              </span>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">
                {getStatusLabel(task.status)}
              </span>
            </div>
          </div>
        </header>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">内容</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-700">
            {task.content ?? "内容は登録されていません。"}
          </p>
        </section>

        {task.status === "COMPLETED" && (
          <section className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
            <p className="text-lg font-bold text-emerald-950">
              このTaskは完了しています。
            </p>

            <p className="mt-2 text-sm leading-6 text-emerald-800">
              関連Workflowの全5STEPが正常に完了しました。
            </p>
          </section>
        )}

        {task.status === "WAITING" && (
          <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <p className="text-lg font-bold text-amber-950">
              このTaskは確認待ちです。
            </p>

            <p className="mt-2 text-sm leading-6 text-amber-900">
              人間承認待ち、またはAI実行エラーでWorkflowが停止しています。
            </p>

            <div className="mt-4 flex flex-wrap gap-4">
              {workflows[0] && (
                <Link
                  href={`/workflows/${workflows[0].id}`}
                  className="text-sm font-bold text-amber-950 underline"
                >
                  Workflowで停止理由を確認 →
                </Link>
              )}

              <Link
                href="/ceo-inbox"
                className="text-sm font-bold text-amber-950 underline"
              >
                CEO Inboxを確認 →
              </Link>
            </div>
          </section>
        )}

        {workflows.length === 0 && task.status === "NEW" && (
          <section className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-6">
            <h2 className="text-lg font-bold text-blue-950">
              AI PMへWorkflow作成を依頼
            </h2>

            <p className="mt-2 text-sm leading-6 text-blue-900">
              Taskの内容を引き継ぎ、既存の5STEP開発Workflowを生成します。
            </p>

            <form action={createWorkflowFromTask} className="mt-5">
              <input type="hidden" name="taskId" value={task.id} />
              <button
                type="submit"
                className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700"
              >
                AI PMへ依頼する
              </button>
            </form>
          </section>
        )}

        {workflows.length === 0 && task.status !== "NEW" && (
          <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-gray-700">
              このTaskは状態が{getStatusLabel(task.status)}
              のため、Workflowを新規生成できません。
            </p>
          </section>
        )}

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <DetailCard title="優先度" value={task.priority} />
          <DetailCard title="期限" value={formatDate(task.due_date)} />
          <DetailCard
            title="担当AI"
            value={
              assignedEmployee
                ? `${assignedEmployee.name}${
                    assignedEmployee.role
                      ? `（${assignedEmployee.role}）`
                      : ""
                  }`
                : "未割当"
            }
          />
          <DetailCard title="状態" value={getStatusLabel(task.status)} />
          <DetailCard
            title="作成日時"
            value={formatDateTime(task.created_at)}
          />
          <DetailCard
            title="更新日時"
            value={formatDateTime(task.updated_at)}
          />
        </section>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                関連Workflow
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                このTaskから生成されたWorkflowを表示します。
              </p>
            </div>

            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
              {workflows.length}件
            </span>
          </div>

          {workflows.length === 0 ? (
            <p className="mt-5 rounded-xl bg-gray-50 p-5 text-sm text-gray-600">
              関連Workflowはありません。
            </p>
          ) : (
            <div className="mt-5 space-y-3">
              {workflows.map((workflow) => (
                <Link
                  key={workflow.id}
                  href={`/workflows/${workflow.id}`}
                  className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-bold text-gray-900">
                      {workflow.title}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      現在 STEP {workflow.current_step_order ?? "-"}
                    </p>
                  </div>
                  <span className="text-xs font-bold text-gray-700">
                    {workflow.status}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function DetailCard({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-gray-500">{title}</p>
      <p className="mt-2 font-bold text-gray-900">{value}</p>
    </div>
  );
}
