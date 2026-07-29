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

  const [
    projectsResult,
    importantTasksResult,
    inProgressTasksResult,
    reviewTasksResult,
    doneTasksResult,
    ceoInboxResult,
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

  const projects: Project[] = projectsResult.data ?? [];
  const reviewTasks: ReviewTask[] = reviewTasksResult.data ?? [];
  const ceoInboxItems: CeoInboxItem[] = ceoInboxResult.data ?? [];

  const activeProjectsCount = projects.filter(
    (project) => project.status === "開発中",
  ).length;

  const humanReviewCount = reviewTasks.length;
  const ceoInboxUnreadCount =
    ceoInboxResult.count ?? ceoInboxItems.length;

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-500">
              STAR WORK OS
            </p>

            <h1 className="mt-1 text-3xl font-bold text-gray-900">
              CEO Dashboard
            </h1>

            <p className="mt-2 text-sm text-gray-600">
              ログイン中：{user.email}
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              href="/tasks"
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Tasks
            </Link>

            <Link
              href="/workflows"
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Workflows
            </Link>

            <Link
              href="/projects"
              className="rounded-xl bg-black px-4 py-2 text-center text-sm font-semibold text-white"
            >
              Projects
            </Link>

            <LogoutButton />
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

        <section className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl bg-white p-6 shadow-sm lg:col-span-2">
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

          <aside className="rounded-2xl bg-white p-6 shadow-sm">
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
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className="mt-3 text-3xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
