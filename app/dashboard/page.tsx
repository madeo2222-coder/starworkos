import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import LogoutButton from "./logout-button";

type Project = {
  id: string;
  name: string;
  status: string;
  priority: string;
  next_action: string | null;
};

type ReviewTask = {
  id: string;
  title: string;
  priority: string;
  assigned_to: string | null;
  projects:
    | {
        name: string;
      }
    | {
        name: string;
      }[]
    | null;
};

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

type AiEmployee = {
  id: string;
  name: string;
  role: string | null;
  status: string | null;
};

type TodayTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
};

type WorkflowSummary = {
  id: string;
  title: string;
  status: string;
  current_step_order: number | null;
};

function getProjectName(task: ReviewTask) {
  if (!task.projects) {
    return "未分類";
  }

  if (Array.isArray(task.projects)) {
    return task.projects[0]?.name ?? "未分類";
  }

  return task.projects.name;
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
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayStartedAt = new Date(
    `${today}T00:00:00+09:00`,
  ).toISOString();

  const [
    projectsResult,
    importantTasksResult,
    inProgressTasksResult,
    reviewTasksResult,
    doneTasksResult,
    ceoInboxResult,
    employeesResult,
    todayTasksResult,
    workflowsResult,
    todayErrorsResult,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, priority, next_action")
      .order("created_at", { ascending: true }),

    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true }),

    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .in("status", ["PLANNING", "IN_PROGRESS", "WAITING"]),

    supabase
      .from("tasks")
      .select(
        `
          id,
          title,
          priority,
          assigned_to,
          projects (
            name
          )
        `,
      )
      .eq("status", "HUMAN_REVIEW")
      .order("created_at", { ascending: true }),

    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .in("status", ["COMPLETED", "DONE"]),

    supabase
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
      )
      .eq("status", "UNREAD")
      .order("created_at", { ascending: false })
      .limit(10),

    supabase
      .from("ai_employees")
      .select("id, name, role, status")
      .order("created_at", { ascending: true }),

    supabase
      .from("tasks")
      .select("id, title, status, priority, due_date")
      .eq("due_date", today)
      .order("priority", { ascending: false })
      .limit(8),

    supabase
      .from("workflows")
      .select("id, title, status, current_step_order")
      .order("updated_at", { ascending: false })
      .limit(6),

    supabase
      .from("execution_history")
      .select("id", { count: "exact", head: true })
      .eq("status", "ERROR")
      .gte("created_at", todayStartedAt),
  ]);

  if (projectsResult.error) {
    throw new Error(
      `プロジェクト取得に失敗しました: ${projectsResult.error.message}`,
    );
  }

  if (importantTasksResult.error) {
    throw new Error(
      `Task総数の取得に失敗しました: ${importantTasksResult.error.message}`,
    );
  }

  if (inProgressTasksResult.error) {
    throw new Error(
      `進行中Task取得に失敗しました: ${inProgressTasksResult.error.message}`,
    );
  }

  if (reviewTasksResult.error) {
    throw new Error(
      `確認待ちタスク取得に失敗しました: ${reviewTasksResult.error.message}`,
    );
  }

  if (doneTasksResult.error) {
    throw new Error(
      `完了Task取得に失敗しました: ${doneTasksResult.error.message}`,
    );
  }

  if (ceoInboxResult.error) {
    throw new Error(
      `CEO Inbox取得に失敗しました: ${ceoInboxResult.error.message}`,
    );
  }

  if (employeesResult.error) {
    throw new Error(
      `AI社員取得に失敗しました: ${employeesResult.error.message}`,
    );
  }

  if (todayTasksResult.error) {
    throw new Error(
      `今日のTask取得に失敗しました: ${todayTasksResult.error.message}`,
    );
  }

  if (workflowsResult.error) {
    throw new Error(
      `Workflow状況の取得に失敗しました: ${workflowsResult.error.message}`,
    );
  }

  if (todayErrorsResult.error) {
    throw new Error(
      `システム状態の取得に失敗しました: ${todayErrorsResult.error.message}`,
    );
  }

  const projects: Project[] = projectsResult.data ?? [];
  const reviewTasks: ReviewTask[] = reviewTasksResult.data ?? [];
  const ceoInboxItems: CeoInboxItem[] = ceoInboxResult.data ?? [];
  const employees: AiEmployee[] = employeesResult.data ?? [];
  const todayTasks: TodayTask[] = todayTasksResult.data ?? [];
  const workflows: WorkflowSummary[] = workflowsResult.data ?? [];

  const activeProjectsCount = projects.filter(
    (project) => project.status === "開発中",
  ).length;

  const humanReviewCount = reviewTasks.length;
  const ceoInboxUnreadCount =
    ceoInboxResult.count ?? ceoInboxItems.length;
  const todayErrorCount = todayErrorsResult.count ?? 0;

  return (
    <main className="min-h-screen bg-[#f7f7f5] px-4 py-5 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="os-surface rounded-[24px] p-6 md:p-8">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-100 pb-5">
            <Link href="/dashboard" className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-zinc-950 text-xs font-bold text-white">
                SW
              </span>
              <span className="text-sm font-semibold tracking-tight text-zinc-950">
                STAR WORK OS
              </span>
            </Link>

            <nav className="flex flex-wrap items-center gap-1 text-sm font-medium text-zinc-600">
              <Link href="/tasks" className="rounded-lg px-3 py-2 hover:bg-zinc-100 hover:text-zinc-950">Tasks</Link>
              <Link href="/workflows" className="rounded-lg px-3 py-2 hover:bg-zinc-100 hover:text-zinc-950">Workflows</Link>
              <Link href="/ai-employees" className="rounded-lg px-3 py-2 hover:bg-zinc-100 hover:text-zinc-950">AI Employees</Link>
              <Link href="/ceo-inbox" className="rounded-lg px-3 py-2 hover:bg-zinc-100 hover:text-zinc-950">CEO Inbox</Link>
              <LogoutButton />
            </nav>
          </div>

          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="os-eyebrow">Company command center</p>

            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-zinc-950 md:text-4xl">
              おはようございます。
            </h1>

            <p className="mt-3 text-sm text-zinc-500">
              AI社員と会社全体の動きを、ここから把握できます。 · {user.email}
            </p>
          </div>

            <Link
              href="/tasks"
              className="inline-flex w-fit items-center rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              ＋ 新しいTask
            </Link>
          </div>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard
            title="Task総数"
            value={String(importantTasksResult.count ?? 0)}
          />

          <SummaryCard
            title="進行中プロジェクト"
            value={String(activeProjectsCount)}
          />

          <SummaryCard
            title="人間確認待ち"
            value={String(humanReviewCount)}
          />

          <SummaryCard
            title="完了Task"
            value={String(doneTasksResult.count ?? 0)}
          />

          <Link
            href="/ceo-inbox"
            className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <p className="text-sm font-medium text-amber-800">
              CEO Inbox未処理
            </p>

            <p className="mt-3 text-3xl font-bold text-amber-950">
              {ceoInboxUnreadCount}
            </p>

            <p className="mt-3 text-sm font-bold text-amber-900">
              CEO Inboxを開く →
            </p>
          </Link>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-12">
          <div className="os-surface rounded-[22px] p-6 xl:col-span-7">
            <SectionHeading
              eyebrow="AI workforce"
              title="AI社員"
              description="いま会社で動いているAIチーム"
              href="/ai-employees"
            />

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {employees.map((employee) => (
                <Link
                  key={employee.id}
                  href={`/ai-employees/${employee.id}`}
                  className="os-card-hover rounded-2xl border border-zinc-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-zinc-100 text-sm font-bold text-zinc-700">
                      {employee.name.slice(0, 2)}
                    </span>
                    <StatusDot status={employee.status} />
                  </div>
                  <p className="mt-4 font-semibold text-zinc-950">{employee.name}</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">{employee.role ?? "役割未設定"}</p>
                </Link>
              ))}
              {employees.length === 0 && (
                <p className="text-sm text-zinc-500">AI社員はまだ登録されていません。</p>
              )}
            </div>
          </div>

          <div className="os-surface rounded-[22px] p-6 xl:col-span-5">
            <SectionHeading
              eyebrow="Today"
              title="今日のタスク"
              description={`${today} が期限の仕事`}
              href="/tasks"
            />
            <div className="mt-5 divide-y divide-zinc-100">
              {todayTasks.map((task) => (
                <Link key={task.id} href={`/tasks/${task.id}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="size-2 rounded-full bg-zinc-900" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800">{task.title}</span>
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">{task.status}</span>
                </Link>
              ))}
              {todayTasks.length === 0 && (
                <div className="rounded-2xl bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">今日が期限のTaskはありません。</div>
              )}
            </div>
          </div>

          <div className="os-surface rounded-[22px] p-6 xl:col-span-8">
            <SectionHeading
              eyebrow="Operations"
              title="Workflow状況"
              description="最近更新された5STEP Workflow"
              href="/workflows"
            />
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {workflows.map((workflow) => (
                <Link key={workflow.id} href={`/workflows/${workflow.id}`} className="os-card-hover rounded-2xl border border-zinc-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-zinc-900">{workflow.title}</p>
                    <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">{workflow.status}</span>
                  </div>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                    <div className="h-full rounded-full bg-zinc-900" style={{ width: `${Math.min(100, ((workflow.current_step_order ?? 0) / 5) * 100)}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">STEP {workflow.current_step_order ?? "-"} / 5</p>
                </Link>
              ))}
            </div>
          </div>

          <aside className="os-surface rounded-[22px] p-6 xl:col-span-4">
            <p className="os-eyebrow">System health</p>
            <div className="mt-4 flex items-center gap-3">
              <span className={`size-3 rounded-full ${todayErrorCount === 0 ? "bg-emerald-500" : "bg-amber-500"}`} />
              <h2 className="text-xl font-semibold tracking-tight text-zinc-950">
                {todayErrorCount === 0 ? "すべて正常" : "確認が必要です"}
              </h2>
            </div>
            <dl className="mt-6 space-y-4 text-sm">
              <SystemRow label="Database" value="Connected" />
              <SystemRow label="AI実行エラー（本日）" value={`${todayErrorCount}件`} />
              <SystemRow label="承認待ち" value={`${ceoInboxUnreadCount}件`} />
              <SystemRow label="稼働中Task" value={`${inProgressTasksResult.count ?? 0}件`} />
            </dl>
          </aside>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="os-surface rounded-[22px] p-6 lg:col-span-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  プロジェクト
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  現在の案件と次の一手
                </p>
              </div>

              <Link
                href="/projects"
                className="text-sm font-semibold text-gray-700 underline"
              >
                すべて表示
              </Link>
            </div>

            <div className="mt-5 space-y-3">
              {projects.map((project) => (
                <article
                  key={project.id}
                  className="rounded-xl border border-gray-200 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="font-bold text-gray-900">
                        {project.name}
                      </h3>

                      <p className="mt-1 text-sm text-gray-600">
                        次の一手：{project.next_action ?? "未設定"}
                      </p>
                    </div>

                    <div className="flex gap-2 text-xs font-semibold">
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700">
                        {project.status}
                      </span>

                      <span className="rounded-full bg-black px-3 py-1 text-white">
                        {project.priority}
                      </span>
                    </div>
                  </div>
                </article>
              ))}

              {projects.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                  <p className="text-sm text-gray-500">
                    プロジェクトはまだ登録されていません。
                  </p>
                </div>
              )}
            </div>
          </div>

          <aside className="os-surface rounded-[22px] p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  CEO Inbox
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  AI社員からの未処理通知
                </p>
              </div>

              <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">
                未処理 {ceoInboxUnreadCount}件
              </span>
            </div>

            <Link
              href="/ceo-inbox"
              className="mt-4 inline-flex text-sm font-bold text-amber-900 underline"
            >
              CEO Inboxを開く →
            </Link>

            <div className="mt-5 space-y-3">
              {ceoInboxItems.map((item) => {
                const href = item.workflow_id
                  ? `/workflows/${item.workflow_id}`
                  : "/workflows";

                return (
                  <Link
                    key={item.id}
                    href={href}
                    className="block rounded-xl border border-amber-300 bg-amber-50 p-4 transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-950">
                        {getInboxTypeLabel(item.item_type)}
                      </span>

                      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-amber-900">
                        優先度 {getPriorityLabel(item.priority)}
                      </span>
                    </div>

                    <p className="mt-3 text-sm font-bold text-amber-950">
                      {item.title}
                    </p>

                    <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm leading-6 text-amber-900">
                      {item.message}
                    </p>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <p className="text-xs text-amber-800">
                        {formatDateTime(item.created_at)}
                      </p>

                      <p className="text-sm font-bold text-amber-950">
                        Workflowを確認 →
                      </p>
                    </div>
                  </Link>
                );
              })}

              {ceoInboxItems.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-300 p-5 text-center">
                  <p className="text-sm text-gray-500">
                    現在、未処理通知はありません。
                  </p>
                </div>
              )}
            </div>

            {reviewTasks.length > 0 && (
              <div className="mt-8 border-t border-gray-200 pt-6">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-gray-900">
                    人間確認待ちタスク
                  </p>

                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
                    {humanReviewCount}件
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {reviewTasks.map((task) => (
                    <article
                      key={task.id}
                      className="rounded-xl border border-gray-200 bg-gray-50 p-4"
                    >
                      <p className="text-sm font-bold text-gray-900">
                        {getProjectName(task)}
                      </p>

                      <p className="mt-2 text-sm leading-6 text-gray-700">
                        {task.title}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full bg-gray-200 px-3 py-1 text-xs font-semibold text-gray-900">
                          {task.priority}
                        </span>

                        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-700">
                          {task.assigned_to ?? "未割当"}
                        </span>
                      </div>

                      <Link
                        href="/tasks"
                        className="mt-4 inline-flex text-sm font-bold text-gray-900 underline"
                      >
                        タスクを確認 →
                      </Link>
                    </article>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-8 rounded-xl bg-gray-50 p-4">
              <p className="text-sm font-semibold text-gray-900">
                進行中Task
              </p>

              <p className="mt-2 text-3xl font-bold text-gray-900">
                {inProgressTasksResult.count ?? 0}
              </p>

              <Link
                href="/tasks"
                className="mt-3 inline-flex text-sm font-semibold text-gray-700 underline"
              >
                タスクボードを確認
              </Link>
            </div>
          </aside>
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
      <p className="text-xs font-medium text-zinc-500">{title}</p>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-zinc-950">{value}</p>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  href,
}: {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="os-eyebrow">{eyebrow}</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-950">{title}</h2>
        <p className="mt-1 text-sm text-zinc-500">{description}</p>
      </div>
      <Link href={href} className="shrink-0 text-xs font-semibold text-zinc-600 hover:text-zinc-950">すべて見る →</Link>
    </div>
  );
}

function StatusDot({ status }: { status: string | null }) {
  const active = status === "IN_PROGRESS";
  const blocked = status === "BLOCKED";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
      <span className={`size-2 rounded-full ${blocked ? "bg-red-500" : active ? "bg-blue-500" : "bg-emerald-500"}`} />
      {blocked ? "停止中" : active ? "作業中" : "待機中"}
    </span>
  );
}

function SystemRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-semibold text-zinc-900">{value}</dd>
    </div>
  );
}
