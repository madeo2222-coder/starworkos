import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

type AiEmployee = {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  status: string | null;
};

type ExecutionHistory = {
  id: string;
  ai_employee_id: string | null;
  action: string;
  status: string;
  duration_ms: number | null;
  total_tokens: number | null;
  created_at: string;
};

type EmployeeStats = {
  totalExecutions: number;
  successCount: number;
  errorCount: number;
  runningCount: number;
  successRate: number;
  averageDurationMs: number | null;
  totalTokens: number;
  latestExecution: ExecutionHistory | null;
};

function formatDuration(durationMs: number | null) {
  if (durationMs === null) {
    return "未記録";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}秒`;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "実行履歴なし";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function getEmployeeStats(
  employeeId: string,
  executions: ExecutionHistory[],
): EmployeeStats {
  const employeeExecutions = executions.filter(
    (execution) => execution.ai_employee_id === employeeId,
  );

  const successCount = employeeExecutions.filter(
    (execution) => execution.status === "SUCCESS",
  ).length;

  const errorCount = employeeExecutions.filter(
    (execution) => execution.status === "ERROR",
  ).length;

  const runningCount = employeeExecutions.filter(
    (execution) => execution.status === "RUNNING",
  ).length;

  const completedExecutions = employeeExecutions.filter(
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

  const successRate =
    employeeExecutions.length > 0
      ? Math.round(
          (successCount / employeeExecutions.length) * 100,
        )
      : 0;

  const totalTokens = employeeExecutions.reduce(
    (total, execution) =>
      total + (execution.total_tokens ?? 0),
    0,
  );

  return {
    totalExecutions: employeeExecutions.length,
    successCount,
    errorCount,
    runningCount,
    successRate,
    averageDurationMs,
    totalTokens,
    latestExecution: employeeExecutions[0] ?? null,
  };
}

function getStatusLabel(status: string | null) {
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

function getStatusClassName(status: string | null) {
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

export default async function AiEmployeesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [employeesResult, executionsResult] = await Promise.all([
    supabase
      .from("ai_employees")
      .select(`
        id,
        name,
        role,
        description,
        status
      `)
      .order("created_at", { ascending: true }),

    supabase
      .from("execution_history")
      .select(`
        id,
        ai_employee_id,
        action,
        status,
        duration_ms,
        total_tokens,
        created_at
      `)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  if (employeesResult.error) {
    throw new Error(
      `AI社員の取得に失敗しました: ${employeesResult.error.message}`,
    );
  }

  if (executionsResult.error) {
    throw new Error(
      `実行履歴の取得に失敗しました: ${executionsResult.error.message}`,
    );
  }

  const employees: AiEmployee[] = employeesResult.data ?? [];
  const executions: ExecutionHistory[] =
    executionsResult.data ?? [];

  const employeeRows = employees.map((employee) => ({
    employee,
    stats: getEmployeeStats(employee.id, executions),
  }));

  const totalExecutions = employeeRows.reduce(
    (total, row) => total + row.stats.totalExecutions,
    0,
  );

  const totalSuccess = employeeRows.reduce(
    (total, row) => total + row.stats.successCount,
    0,
  );

  const totalTokens = employeeRows.reduce(
    (total, row) => total + row.stats.totalTokens,
    0,
  );

  const organizationSuccessRate =
    totalExecutions > 0
      ? Math.round((totalSuccess / totalExecutions) * 100)
      : 0;

  const activeEmployees = employees.filter(
    (employee) => employee.status === "IN_PROGRESS",
  ).length;

  return (
    <main className="min-h-screen bg-[#f7f7f5] px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap gap-4">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-zinc-500 hover:text-zinc-950"
          >
            ← Command Center
          </Link>

          <Link
            href="/executions"
            className="text-sm font-medium text-zinc-500 hover:text-zinc-950"
          >
            実行履歴を見る
          </Link>
        </div>

        <header className="os-surface rounded-[24px] p-6 md:p-8">
          <p className="os-eyebrow">AI workforce</p>

          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-zinc-950">
            AI Employees
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
            会社を動かすAI社員の役割、現在の状態、実行品質をひとつの組織図として確認します。
          </p>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard
            title="AI社員数"
            value={String(employees.length)}
          />

          <SummaryCard
            title="作業中"
            value={String(activeEmployees)}
          />

          <SummaryCard
            title="総実行数"
            value={String(totalExecutions)}
          />

          <SummaryCard
            title="組織成功率"
            value={`${organizationSuccessRate}%`}
          />

          <SummaryCard
            title="合計トークン"
            value={totalTokens.toLocaleString("ja-JP")}
          />
        </section>

        <section className="mt-6">
          {employeeRows.length === 0 ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
              <p className="text-sm text-gray-500">
                AI社員はまだ登録されていません。
              </p>
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {employeeRows.map(({ employee, stats }) => (
                <article
                  key={employee.id}
                  className="os-surface os-card-hover rounded-[22px] p-6"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="mb-4 grid size-11 place-items-center rounded-2xl bg-zinc-950 text-sm font-bold text-white">
                        {employee.name.slice(0, 2)}
                      </div>
                      <h2 className="text-xl font-semibold tracking-tight text-zinc-950">
                        {employee.name}
                      </h2>

                      <p className="mt-1 text-sm font-semibold text-gray-600">
                        {employee.role ?? "役割未設定"}
                      </p>
                    </div>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusClassName(
                        employee.status,
                      )}`}
                    >
                      {getStatusLabel(employee.status)}
                    </span>
                  </div>

                  <p className="mt-4 min-h-12 text-sm leading-6 text-gray-600">
                    {employee.description ??
                      "説明はまだ登録されていません。"}
                  </p>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <Metric
                      label="実行回数"
                      value={String(stats.totalExecutions)}
                    />

                    <Metric
                      label="成功率"
                      value={`${stats.successRate}%`}
                    />

                    <Metric
                      label="平均実行時間"
                      value={formatDuration(
                        stats.averageDurationMs,
                      )}
                    />

                    <Metric
                      label="合計トークン"
                      value={stats.totalTokens.toLocaleString(
                        "ja-JP",
                      )}
                    />
                  </div>

                  <div className="mt-5 rounded-2xl border border-zinc-100 bg-zinc-50/80 p-4">
                    <p className="text-xs font-semibold text-gray-500">
                      最近の実行
                    </p>

                    {stats.latestExecution ? (
                      <>
                        <p className="mt-2 text-sm font-bold text-gray-900">
                          {stats.latestExecution.action}
                        </p>

                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-700">
                            {stats.latestExecution.status}
                          </span>

                          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-700">
                            {formatDateTime(
                              stats.latestExecution.created_at,
                            )}
                          </span>
                        </div>
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-gray-500">
                        実行履歴はまだありません。
                      </p>
                    )}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-4">
                    <Link
                      href={`/ai-employees/${employee.id}`}
                      className="text-sm font-bold text-gray-900 underline"
                    >
                      社員カルテを見る →
                    </Link>

                    <Link
                      href="/executions"
                      className="text-sm font-semibold text-gray-600 underline"
                    >
                      実行履歴
                    </Link>
                  </div>
                </article>
              ))}
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
    <div className="os-surface rounded-[20px] p-5">
      <p className="text-xs font-medium text-zinc-500">
        {title}
      </p>

      <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-zinc-950">
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
    <div className="rounded-xl border border-zinc-200 p-3">
      <p className="text-xs font-semibold text-gray-500">
        {label}
      </p>

      <p className="mt-2 text-lg font-bold text-gray-900">
        {value}
      </p>
    </div>
  );
}
