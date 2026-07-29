import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

type ExecutionRow = {
  id: string;
  workflow_id: string | null;
  workflow_step_id: string | null;
  ai_employee_id: string | null;
  model: string | null;
  action: string;
  status: string;
  duration_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  estimated_cost: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

type AiEmployee = {
  id: string;
  name: string;
  role: string | null;
};

type Workflow = {
  id: string;
  title: string;
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
    return "計測中";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}秒`;
}

function getStatusLabel(status: string) {
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

function getStatusClassName(status: string) {
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

export default async function ExecutionsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("execution_history")
    .select(`
      id,
      workflow_id,
      workflow_step_id,
      ai_employee_id,
      model,
      action,
      status,
      duration_ms,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      estimated_cost,
      error_message,
      started_at,
      completed_at,
      created_at
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(
      `実行履歴の取得に失敗しました: ${error.message}`,
    );
  }

  const executionRows: ExecutionRow[] = data ?? [];

  const employeeIds = Array.from(
    new Set(
      executionRows
        .map((row) => row.ai_employee_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const workflowIds = Array.from(
    new Set(
      executionRows
        .map((row) => row.workflow_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  let employees: AiEmployee[] = [];
  let workflows: Workflow[] = [];

  if (employeeIds.length > 0) {
    const { data: employeeData, error: employeeError } =
      await supabase
        .from("ai_employees")
        .select("id, name, role")
        .in("id", employeeIds);

    if (employeeError) {
      throw new Error(
        `AI社員の取得に失敗しました: ${employeeError.message}`,
      );
    }

    employees = employeeData ?? [];
  }

  if (workflowIds.length > 0) {
    const { data: workflowData, error: workflowError } =
      await supabase
        .from("workflows")
        .select("id, title")
        .in("id", workflowIds);

    if (workflowError) {
      throw new Error(
        `Workflowの取得に失敗しました: ${workflowError.message}`,
      );
    }

    workflows = workflowData ?? [];
  }

  const employeeMap = new Map(
    employees.map((employee) => [employee.id, employee]),
  );

  const workflowMap = new Map(
    workflows.map((workflow) => [workflow.id, workflow]),
  );

  const successCount = executionRows.filter(
    (row) => row.status === "SUCCESS",
  ).length;

  const errorCount = executionRows.filter(
    (row) => row.status === "ERROR",
  ).length;

  const runningCount = executionRows.filter(
    (row) => row.status === "RUNNING",
  ).length;

  const completedRows = executionRows.filter(
    (row) => row.duration_ms !== null,
  );

  const averageDurationMs =
    completedRows.length > 0
      ? Math.round(
          completedRows.reduce(
            (total, row) => total + (row.duration_ms ?? 0),
            0,
          ) / completedRows.length,
        )
      : null;

  const successRate =
    executionRows.length > 0
      ? Math.round((successCount / executionRows.length) * 100)
      : 0;

  const totalTokens = executionRows.reduce(
    (total, row) => total + (row.total_tokens ?? 0),
    0,
  );

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
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
            Workflowsを見る
          </Link>
        </div>

        <header className="rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-gray-500">
            STAR WORK OS
          </p>

          <h1 className="mt-2 text-3xl font-bold text-gray-900">
            Execution History
          </h1>

          <p className="mt-2 text-sm text-gray-600">
            AI社員の実行内容、処理時間、使用モデル、トークン数、
            成功・失敗を確認します。
          </p>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard
            title="総実行数"
            value={String(executionRows.length)}
          />

          <SummaryCard
            title="成功率"
            value={`${successRate}%`}
          />

          <SummaryCard
            title="成功"
            value={String(successCount)}
          />

          <SummaryCard
            title="失敗・実行中"
            value={`${errorCount} / ${runningCount}`}
          />

          <SummaryCard
            title="合計トークン"
            value={totalTokens.toLocaleString("ja-JP")}
          />
        </section>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                AI社員の実行履歴
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                最新100件を表示しています。
              </p>
            </div>

            <p className="text-sm font-semibold text-gray-700">
              平均実行時間：
              {formatDuration(averageDurationMs)}
            </p>
          </div>

          {executionRows.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-gray-300 p-8 text-center">
              <p className="text-sm text-gray-500">
                実行履歴はまだありません。
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {executionRows.map((execution) => {
                const employee = execution.ai_employee_id
                  ? employeeMap.get(execution.ai_employee_id)
                  : null;

                const workflow = execution.workflow_id
                  ? workflowMap.get(execution.workflow_id)
                  : null;

                return (
                  <article
                    key={execution.id}
                    className="rounded-2xl border border-gray-200 p-5"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusClassName(
                              execution.status,
                            )}`}
                          >
                            {getStatusLabel(execution.status)}
                          </span>

                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                            {execution.model ?? "モデル未記録"}
                          </span>
                        </div>

                        <h3 className="mt-3 text-lg font-bold text-gray-900">
                          {execution.action}
                        </h3>

                        <p className="mt-2 text-sm text-gray-600">
                          AI社員：
                          {employee?.name ?? "未割当"}
                          {employee?.role
                            ? `（${employee.role}）`
                            : ""}
                        </p>

                        <p className="mt-1 text-sm text-gray-600">
                          Workflow：
                          {workflow?.title ?? "未設定"}
                        </p>
                      </div>

                      <div className="text-sm text-gray-600 lg:text-right">
                        <p>
                          開始：
                          {formatDateTime(execution.started_at)}
                        </p>

                        <p className="mt-1">
                          完了：
                          {formatDateTime(execution.completed_at)}
                        </p>

                        <p className="mt-1 font-semibold text-gray-900">
                          実行時間：
                          {formatDuration(execution.duration_ms)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <Metric
                        label="入力トークン"
                        value={
                          execution.prompt_tokens?.toLocaleString(
                            "ja-JP",
                          ) ?? "未記録"
                        }
                      />

                      <Metric
                        label="出力トークン"
                        value={
                          execution.completion_tokens?.toLocaleString(
                            "ja-JP",
                          ) ?? "未記録"
                        }
                      />

                      <Metric
                        label="合計トークン"
                        value={
                          execution.total_tokens?.toLocaleString(
                            "ja-JP",
                          ) ?? "未記録"
                        }
                      />
                    </div>

                    {execution.error_message && (
                      <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4">
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
                        className="mt-5 inline-flex text-sm font-bold text-gray-900 underline"
                      >
                        Workflowを確認 →
                      </Link>
                    )}
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

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-gray-50 p-4">
      <p className="text-xs font-semibold text-gray-500">
        {label}
      </p>

      <p className="mt-2 text-lg font-bold text-gray-900">
        {value}
      </p>
    </div>
  );
}