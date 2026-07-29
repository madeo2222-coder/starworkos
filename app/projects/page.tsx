import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

type Project = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  priority: string;
  progress: number;
  next_action: string | null;
};

export default async function ProjectsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, name, slug, description, status, priority, progress, next_action"
    )
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`プロジェクト取得に失敗しました: ${error.message}`);
  }

  const projects: Project[] = data ?? [];

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-500">STAR WORK OS</p>

            <h1 className="mt-1 text-3xl font-bold text-gray-900">
              Projects
            </h1>

            <p className="mt-2 text-sm text-gray-600">
              会社の案件・プロダクト・新規事業を管理します。
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
              href="/dashboard"
              className="rounded-xl bg-black px-4 py-2 text-center text-sm font-semibold text-white"
            >
              Dashboard
            </Link>
          </div>
        </header>

        <section className="mt-6 grid gap-5 md:grid-cols-2">
          {projects.map((project) => (
            <article
              key={project.id}
              className="rounded-2xl bg-white p-6 shadow-sm"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">
                    {project.name}
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    {project.description ?? "説明はまだ登録されていません。"}
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

              <div className="mt-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-600">進捗</span>
                  <span className="font-bold text-gray-900">
                    {project.progress}%
                  </span>
                </div>

                <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-black"
                    style={{ width: `${project.progress}%` }}
                  />
                </div>
              </div>

              <div className="mt-5 rounded-xl bg-gray-50 p-4">
                <p className="text-xs font-semibold text-gray-500">
                  次の一手
                </p>

                <p className="mt-1 text-sm font-medium text-gray-900">
                  {project.next_action ?? "未設定"}
                </p>
              </div>

              <Link
                href={`/projects/${project.slug}`}
                className="mt-5 inline-flex rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
              >
                詳細を見る
              </Link>
            </article>
          ))}
        </section>

        {projects.length === 0 && (
          <div className="mt-6 rounded-2xl bg-white p-8 text-center shadow-sm">
            <p className="text-gray-600">
              プロジェクトはまだ登録されていません。
            </p>
          </div>
        )}
      </div>
    </main>
  );
}