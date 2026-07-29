import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

type AiEmployee = {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  status: string | null;
  created_at: string;
};

type ExecutionHistory = {
  id: string;
  workflow_id: string | null;
  workflow_step_id: string | null;
  model: string | null;
  action: string;
  status: string;
  duration_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

type WorkflowStep = {
  id: string;
  workflow_id: string;
  step_order: number;
  name: string;
  status: string;
};

type Workflow = {
  id: string;
  title: string;
  status: string;
  priority: string;
};

type WorkflowMessage = {
  id: string;
  workflow_id: string;
  workflow_step_id: string | null;
  sender_type: string;
  message_type: string;
  content: string;
  created_at: string;
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "未記録";
  }

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

function formatDuration(durationMs: number | null) {
  if (durationMs === null) {
    return "未記録";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}秒`;
}

function getEmployeeStatusLabel(status: string | null) {
  switch (status) {
    case "READY":
      return "待機中";
    case "IN_PROGRESS":
      return "作業中";
    case "BLOCKED":
      return "停止中";
    default:
      return status ?? "未設定";
  }
}

function getEmployeeStatusClassName(status: string | null) {
  switch (status) {
    case "READY":
      return "bg-emerald-100 text-emerald-800";
    case "IN_PROGRESS":
      return "bg-blue-100 text-blue-800";
    case "BLOCKED":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function getExecutionStatusLabel(status: string) {
  switch (status) {
    case "SUCCESS":
      return "成功";
    case "ERROR":
      return "失敗";
    case "RUNNING":
      return "実行中";
    default:
      return status;
  }
}

function getExecutionStatusClassName(status: string) {
  switch (status) {
    case "SUCCESS":
      return "bg-emerald-100 text-emerald-800";
    case "ERROR":
      return "bg-red-100 text-red-800";
    case "RUNNING":
      return "bg-blue-100 text-blue-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function getSenderLabel(senderType: string) {
  switch (senderType) {
    case "CEO":
      return "CEO";
    case "AI_EMPLOYEE":
      return "AI社員";
    case "SYSTEM":
      return "システム";
    default:
      return senderType;
  }
}

export default async function AiEmployeeDetailPage({
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

  const { data: employee, error: employeeError } = await supabase
    .from("ai_employees")
    .select(`
      id,
      name,
      role,
      description,
      status,
      created_at
    `)
    .eq("id", id)
    .maybeSingle();

  if (employeeError) {
    throw new Error(
      `AI社員の取得に失敗しました: ${employeeError.message}`,
    );
  }

  if (!employee) {
    notFound();
  }

  const [
    executionsResult,
    workflowStepsResult,
    messagesResult,
  ] = await Promise.all([
    supabase
      .from("execution_history")
      .select(`
        id,
        workflow_id,
        workflow_step_id,
        model,
        action,
        status,
        duration_ms,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        error_message,
        started_at,
        completed_at,
        created_at
      `)
      .eq("ai_employee_id", id)
      .order("created_at", { ascending: false })
      .limit(100),

    supabase
      .from("workflow_steps")
      .select(`
        id,
        workflow_id,
        step_order,
        name,
        status
      `)
      .eq("assigned_ai_employee_id", id)
      .order("step_order", { ascending: true }),

    supabase
      .from("workflow_messages")
      .select(`
        id,
        workflow_id,
        workflow_step_id,
        sender_type,
        message_type,
        content,
        created_at
      `)
      .eq("ai_employee_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (executionsResult.error) {
    throw new Error(
      `実行履歴の取得に失敗しました: ${executionsResult.error.message}`,
    );
  }

  if (workflowStepsResult.error) {
    throw new Error(
      `担当工程の取得に失敗しました: ${workflowStepsResult.error.message}`,
    );
  }

  if (messagesResult.error) {
    throw new Error(
      `会話履歴の取得に失敗しました: ${messagesResult.error.message}`,
    );
  }

  const executions: ExecutionHistory[] =
    executionsResult.data ?? [];

  const workflowSteps: WorkflowStep[] =
    workflowStepsResult.data ?? [];

  const messages: WorkflowMessage[] =
    messagesResult.data ?? [];

  const workflowIds = Array.from(
    new Set([
      ...executions
        .map((execution) => execution.workflow_id)
        .filter((workflowId): workflowId is string =>
          Boolean(workflowId),
        ),
      ...workflowSteps.map((step) => step.workflow_id),
      ...messages.map((message) => message.workflow_id),
    ]),
  );

  let workflows: Workflow[] = [];

  if (workflowIds.length > 0) {
    const { data: workflowData, error: workflowError } =
      await supabase
        .from("workflows")
        .select(`
          id,
          title,
          status,
          priority
        `)
        .in("id", workflowIds);

    if (workflowError) {
      throw new Error(
        `Workflowの取得に失敗しました: ${workflowError.message}`,
      );
    }

    workflows = workflowData ?? [];
  }

  const workflowMap = new Map(
    workflows.map((workflow) => [workflow.id, workflow]),
  );

  const successCount = executions.filter(
    (execution) => execution.status === "SUCCESS",
  ).length;

  const errorCount = executions.filter(
    (execution) => execution.status === "ERROR",
  ).length;

  const runningCount = executions.filter(
    (execution) => execution.status === "RUNNING",
  ).length;

  const successRate =
    executions.length > 0
      ? Math.round((successCount / executions.length) * 100)
      : 0;

  const completedExecutions = executions.filter(
    (execution) => execution.duration_ms !== null,
  );

  const averageDurationMs =
    completedExecutions.length > 0
      ? Math.round(
          completedExecutions.reduce(
            (total, execution) =>
              total + (execution.duration_ms ?? 0),
            0,
          ) / completedExecutions.length,
        )
      : null;

  const totalTokens = executions.reduce(
    (total, execution) =>
      total + (execution.total_tokens ?? 0),
    0,
  );

  const promptTokens = executions.reduce(
    (total, execution) =>
      total + (execution.prompt_tokens ?? 0),
    0,
  );

  const completionTokens = executions.reduce(
    (total, execution) =>
      total + (execution.completion_tokens ?? 0),
    0,
  );

  const modelUsage = new Map<string, number>();

  executions.forEach((execution) => {
    const model = execution.model ?? "モデル未記録";
    modelUsage.set(model, (modelUsage.get(model) ?? 0) + 1);
  });

  const modelRows = Array.from(modelUsage.entries()).sort(
    (a, b) => b[1] - a[1],
  );

  const assignedWorkflowIds = new Set(
    workflowSteps.map((step) => step.workflow_id),
  );

  const assignedWorkflows = workflows.filter((workflow) =>
    assignedWorkflowIds.has(workflow.id),
  );

  const recentExecutions = executions.slice(0, 10);

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap gap-4">
          <Link
            href="/ai-employees"
            className="text-sm font-semibold text-gray-700 underline"
          >
            ← AI社員一覧へ戻る
          </Link>

          <Link
            href="/dashboard"
            className="text-sm font-semibold text-gray-700 underline"
          >
            Dashboardへ戻る
          </Link>

          <Link
            href="/executions"
            className="text-sm font-semibold text-gray-700 underline"
          >
            全実行履歴を見る
          </Link>
        </div>

        <header className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-500">
                STAR WORK OS
              </p>

              <h1 className="mt-2 text-3xl font-bold text-gray-900">
                {employee.name}
              </h1>

              <p className="mt-2 text-lg font-semibold text-gray-700">
                {employee.role ?? "役割未設定"}
              </p>

              <p className="mt-4 max-w-3xl text-sm leading-7 text-gray-600">
                {employee.description ??
                  "説明はまだ登録されていません。"}
              </p>
            </div>

            <span
              className={`w-fit rounded-full px-4 py-2 text-sm font-bold ${getEmployeeStatusClassName(
                employee.status,
              )}`}
            >
              {getEmployeeStatusLabel(employee.status)}
            </span>
          </div>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            title="総実行数"
            value={String(executions.length)}
          />

          <SummaryCard
            title="成功率"
            value={`${successRate}%`}
          />

          <SummaryCard
            title="平均実行時間"
            value={formatDuration(averageDurationMs)}
          />

          <SummaryCard
            title="合計トークン"
            value={totalTokens.toLocaleString("ja-JP")}
          />
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl bg-white p-6 shadow-sm lg:col-span-2">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                最近の実行履歴
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                最新10件の実績を表示します。
              </p>
            </div>

            {recentExecutions.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-gray-300 p-8 text-center">
                <p className="text-sm text-gray-500">
                  このAI社員の実行履歴はまだありません。
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                {recentExecutions.map((execution) => {
                  const workflow = execution.workflow_id
                    ? workflowMap.get(execution.workflow_id)
                    : null;

                  return (
                    <article
                      key={execution.id}
                      className="rounded-xl border border-gray-200 p-5"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-bold ${getExecutionStatusClassName(
                                execution.status,
                              )}`}
                            >
                              {getExecutionStatusLabel(
                                execution.status,
                              )}
                            </span>

                            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                              {execution.model ?? "モデル未記録"}
                            </span>
                          </div>

                          <h3 className="mt-3 font-bold text-gray-900">
                            {execution.action}
                          </h3>

                          <p className="mt-2 text-sm text-gray-600">
                            Workflow：
                            {workflow?.title ?? "未設定"}
                          </p>
                        </div>

                        <div className="text-sm text-gray-600 sm:text-right">
                          <p>
                            {formatDateTime(execution.created_at)}
                          </p>

                          <p className="mt-1 font-semibold text-gray-900">
                            {formatDuration(execution.duration_ms)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <MiniMetric
                          label="入力"
                          value={
                            execution.prompt_tokens?.toLocaleString(
                              "ja-JP",
                            ) ?? "未記録"
                          }
                        />

                        <MiniMetric
                          label="出力"
                          value={
                            execution.completion_tokens?.toLocaleString(
                              "ja-JP",
                            ) ?? "未記録"
                          }
                        />

                        <MiniMetric
                          label="合計"
                          value={
                            execution.total_tokens?.toLocaleString(
                              "ja-JP",
                            ) ?? "未記録"
                          }
                        />
                      </div>

                      {execution.error_message && (
                        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
                          <p className="text-sm font-bold text-red-800">
                            エラー内容
                          </p>

                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-red-700">
                            {execution.error_message}
                          </p>
                        </div>
                      )}

                      {execution.workflow_id && (
                        <Link
                          href={`/workflows/${execution.workflow_id}`}
                          className="mt-4 inline-flex text-sm font-bold text-gray-900 underline"
                        >
                          Workflowを確認 →
                        </Link>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold text-gray-900">
                成績内訳
              </h2>

              <div className="mt-5 space-y-3">
                <StatRow
                  label="成功"
                  value={String(successCount)}
                />

                <StatRow
                  label="失敗"
                  value={String(errorCount)}
                />

                <StatRow
                  label="実行中"
                  value={String(runningCount)}
                />

                <StatRow
                  label="入力トークン"
                  value={promptTokens.toLocaleString("ja-JP")}
                />

                <StatRow
                  label="出力トークン"
                  value={completionTokens.toLocaleString("ja-JP")}
                />
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold text-gray-900">
                使用モデル
              </h2>

              {modelRows.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">
                  モデル利用履歴はありません。
                </p>
              ) : (
                <div className="mt-5 space-y-3">
                  {modelRows.map(([model, count]) => (
                    <StatRow
                      key={model}
                      label={model}
                      value={`${count}回`}
                    />
                  ))}
                </div>
              )}
            </div>
          </aside>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-gray-900">
              担当Workflow
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              このAI社員が工程を担当しているWorkflowです。
            </p>

            {assignedWorkflows.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-gray-300 p-6 text-center">
                <p className="text-sm text-gray-500">
                  担当Workflowはありません。
                </p>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {assignedWorkflows.map((workflow) => {
                  const steps = workflowSteps.filter(
                    (step) =>
                      step.workflow_id === workflow.id,
                  );

                  return (
                    <article
                      key={workflow.id}
                      className="rounded-xl border border-gray-200 p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="font-bold text-gray-900">
                            {workflow.title}
                          </h3>

                          <p className="mt-1 text-sm text-gray-600">
                            担当工程：
                            {steps
                              .map(
                                (step) =>
                                  `STEP ${step.step_order} ${step.name}`,
                              )
                              .join("、")}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                            {workflow.status}
                          </span>

                          <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
                            {workflow.priority}
                          </span>
                        </div>
                      </div>

                      <Link
                        href={`/workflows/${workflow.id}`}
                        className="mt-4 inline-flex text-sm font-bold text-gray-900 underline"
                      >
                        詳細を見る →
                      </Link>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-gray-900">
              最近の会話履歴
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              CEOやAI社員とのメッセージを表示します。
            </p>

            {messages.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-gray-300 p-6 text-center">
                <p className="text-sm text-gray-500">
                  会話履歴はまだありません。
                </p>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {messages.map((message) => {
                  const workflow = workflowMap.get(
                    message.workflow_id,
                  );

                  return (
                    <article
                      key={message.id}
                      className="rounded-xl border border-gray-200 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
                            {getSenderLabel(
                              message.sender_type,
                            )}
                          </span>

                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                            {message.message_type}
                          </span>
                        </div>

                        <span className="text-xs text-gray-500">
                          {formatDateTime(message.created_at)}
                        </span>
                      </div>

                      <p className="mt-3 text-sm font-semibold text-gray-900">
                        {workflow?.title ?? "Workflow未設定"}
                      </p>

                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-600">
                        {message.content}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
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

function MiniMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <p className="text-xs font-semibold text-gray-500">
        {label}
      </p>

      <p className="mt-2 font-bold text-gray-900">
        {value}
      </p>
    </div>
  );
}

function StatRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-gray-50 px-4 py-3">
      <p className="text-sm font-medium text-gray-600">
        {label}
      </p>

      <p className="text-sm font-bold text-gray-900">
        {value}
      </p>
    </div>
  );
}