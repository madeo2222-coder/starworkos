import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

type TaskStatus =
  | "NEW"
  | "PLANNING"
  | "IN_PROGRESS"
  | "WAITING"
  | "COMPLETED"
  | "CANCELLED";

type Task = {
  id: string;
  title: string;
  content: string | null;
  status: TaskStatus;
  priority: string;
  due_date: string | null;
  assigned_ai_employee_id: string | null;
  created_at: string;
};

type AiEmployee = {
  id: string;
  name: string;
  role: string | null;
};

const taskStatuses: TaskStatus[] = [
  "NEW",
  "PLANNING",
  "IN_PROGRESS",
  "WAITING",
  "COMPLETED",
  "CANCELLED",
];

function getStatusLabel(status: TaskStatus) {
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
  }
}

function getStatusClassName(status: TaskStatus) {
  switch (status) {
    case "NEW":
      return "bg-blue-100 text-blue-800";
    case "PLANNING":
      return "bg-violet-100 text-violet-800";
    case "IN_PROGRESS":
      return "bg-emerald-100 text-emerald-800";
    case "WAITING":
      return "bg-amber-100 text-amber-800";
    case "COMPLETED":
      return "bg-gray-200 text-gray-800";
    case "CANCELLED":
      return "bg-red-100 text-red-800";
  }
}

function formatDate(value: string | null) {
  if (!value) {
    return "期限未設定";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

async function createTask(formData: FormData) {
  "use server";

  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const priority = String(formData.get("priority") ?? "中").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  const assignedAiEmployeeId = String(
    formData.get("assignedAiEmployeeId") ?? "",
  ).trim();

  if (!title) {
    throw new Error("Taskのタイトルを入力してください。");
  }

  if (!["低", "中", "高", "最優先"].includes(priority)) {
    throw new Error("Taskの優先度が正しくありません。");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title,
      content: content || null,
      priority,
      status: "NEW",
      due_date: dueDate || null,
      assigned_ai_employee_id: assignedAiEmployeeId || null,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Taskの作成に失敗しました: ${error.message}`);
  }

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  redirect(`/tasks/${data.id}`);
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
  }>;
}) {
  const { q = "" } = await searchParams;
  const searchQuery = q.trim();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [tasksResult, employeesResult] = await Promise.all([
    supabase
      .from("tasks")
      .select(`
        id,
        title,
        content,
        status,
        priority,
        due_date,
        assigned_ai_employee_id,
        created_at
      `)
      .order("created_at", { ascending: false }),

    supabase
      .from("ai_employees")
      .select("id, name, role")
      .order("created_at", { ascending: true }),
  ]);

  if (tasksResult.error) {
    throw new Error(
      `Taskの取得に失敗しました: ${tasksResult.error.message}`,
    );
  }

  if (employeesResult.error) {
    throw new Error(
      `AI社員の取得に失敗しました: ${employeesResult.error.message}`,
    );
  }

  const tasks = (tasksResult.data ?? []) as Task[];
  const employees: AiEmployee[] = employeesResult.data ?? [];
  const employeeMap = new Map(
    employees.map((employee) => [employee.id, employee]),
  );
  const normalizedQuery = searchQuery.toLocaleLowerCase("ja");
  const filteredTasks = normalizedQuery
    ? tasks.filter((task) =>
        [task.title, task.content ?? ""]
          .join("\n")
          .toLocaleLowerCase("ja")
          .includes(normalizedQuery),
      )
    : tasks;

  const statusCounts = new Map(
    taskStatuses.map((status) => [
      status,
      tasks.filter((task) => task.status === status).length,
    ]),
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
            Workflows一覧
          </Link>
        </div>

        <header className="rounded-2xl bg-white p-6 shadow-sm md:p-8">
          <p className="text-sm font-semibold text-gray-500">
            STAR WORK OS
          </p>

          <h1 className="mt-2 text-3xl font-bold text-gray-900">
            Task Center
          </h1>

          <p className="mt-3 text-sm leading-6 text-gray-600">
            CEOからの案件を登録し、状態・優先度・担当AIを管理します。
            Workflowの自動生成は次の開発段階で追加します。
          </p>
        </header>

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {taskStatuses.map((status) => (
            <div
              key={status}
              className="rounded-2xl bg-white p-4 shadow-sm"
            >
              <p className="text-xs font-bold text-gray-500">
                {getStatusLabel(status)}
              </p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {statusCounts.get(status) ?? 0}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-gray-900">
            新しいTaskを登録
          </h2>

          <form action={createTask} className="mt-5 space-y-5">
            <div>
              <label
                htmlFor="title"
                className="text-sm font-bold text-gray-900"
              >
                タイトル
              </label>
              <input
                id="title"
                name="title"
                type="text"
                required
                className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-500"
                placeholder="例：新サービスの販売計画を作成する"
              />
            </div>

            <div>
              <label
                htmlFor="content"
                className="text-sm font-bold text-gray-900"
              >
                内容
              </label>
              <textarea
                id="content"
                name="content"
                rows={6}
                className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm leading-7 text-gray-900 outline-none focus:border-blue-500"
                placeholder="案件の目的、背景、必要な成果物を入力してください。"
              />
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <div>
                <label
                  htmlFor="priority"
                  className="text-sm font-bold text-gray-900"
                >
                  優先度
                </label>
                <select
                  id="priority"
                  name="priority"
                  defaultValue="中"
                  className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900"
                >
                  <option value="低">低</option>
                  <option value="中">通常</option>
                  <option value="高">高</option>
                  <option value="最優先">最優先</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="dueDate"
                  className="text-sm font-bold text-gray-900"
                >
                  期限
                </label>
                <input
                  id="dueDate"
                  name="dueDate"
                  type="date"
                  className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900"
                />
              </div>

              <div>
                <label
                  htmlFor="assignedAiEmployeeId"
                  className="text-sm font-bold text-gray-900"
                >
                  担当AI
                </label>
                <select
                  id="assignedAiEmployeeId"
                  name="assignedAiEmployeeId"
                  defaultValue=""
                  className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900"
                >
                  <option value="">未割当</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                      {employee.role ? `（${employee.role}）` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700"
            >
              Taskを登録
            </button>
          </form>
        </section>

        <section className="mt-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                案件一覧
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {filteredTasks.length}件
              </p>
            </div>

            <form className="flex w-full gap-2 sm:max-w-md">
              <input
                name="q"
                type="search"
                defaultValue={searchQuery}
                className="min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900"
                placeholder="タイトル・内容を検索"
              />
              <button
                type="submit"
                className="rounded-xl bg-black px-5 py-3 text-sm font-bold text-white"
              >
                検索
              </button>
            </form>
          </div>

          {filteredTasks.length === 0 ? (
            <div className="mt-4 rounded-2xl bg-white p-8 text-center text-sm text-gray-600 shadow-sm">
              該当するTaskはありません。
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {filteredTasks.map((task) => {
                const employee = task.assigned_ai_employee_id
                  ? employeeMap.get(task.assigned_ai_employee_id)
                  : null;

                return (
                  <Link
                    key={task.id}
                    href={`/tasks/${task.id}`}
                    className="block rounded-2xl bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-bold text-gray-900">
                          {task.title}
                        </h3>

                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-gray-600">
                          {task.content ?? "内容は登録されていません。"}
                        </p>

                        <p className="mt-3 text-sm text-gray-500">
                          担当AI：{employee?.name ?? "未割当"}・
                          {formatDate(task.due_date)}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-black px-3 py-1 text-xs font-bold text-white">
                          優先度 {task.priority}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusClassName(
                            task.status,
                          )}`}
                        >
                          {getStatusLabel(task.status)}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
