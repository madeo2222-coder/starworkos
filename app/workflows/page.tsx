import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

type Workflow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  current_step_order: number;
  created_at: string;
  projects:
    | {
        name: string;
      }[]
    | null;
};

export default async function WorkflowsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("workflows")
    .select(`
      id,
      title,
      description,
      status,
      priority,
      current_step_order,
      created_at,
      projects (
        name
      )
    `)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Workflowの取得に失敗しました: ${error.message}`);
  }

  const workflowRows: Workflow[] = data ?? [];

  return (
    <main className="min-h-screen bg-gray-50 p-6 md:p-10">
      <div className="mx-auto max-w-6xl">
        <Link
  href="/dashboard"
  className="mb-6 inline-flex items-center text-sm font-semibold text-gray-700 underline"
>
  ← Dashboardへ戻る
</Link>

       <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
  <div>
    <p className="text-sm font-medium text-gray-500">
      STAR WORK OS
    </p>

    <h1 className="mt-2 text-3xl font-bold text-gray-900">
      Workflows
    </h1>

    <p className="mt-2 text-sm text-gray-600">
      CEOの依頼がAI社員へどのように引き継がれているか確認します。
    </p>
  </div>

  <Link
    href="/workflows/new"
    className="inline-flex w-fit items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-700"
  >
    ＋ 新しいWorkflowを作成
  </Link>
</div>

        {workflowRows.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-gray-600 shadow-sm">
            Workflowはまだ登録されていません。
          </div>
        ) : (
          <div className="space-y-5">
            {workflowRows.map((workflow) => (
              <Link
                key={workflow.id}
                href={`/workflows/${workflow.id}`}
                className="block rounded-2xl bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex flex-col justify-between gap-4 md:flex-row">
                  <div>
                    <p className="text-sm font-medium text-gray-500">
                      {workflow.projects?.[0]?.name ?? "プロジェクト未設定"}
                    </p>

                    <h2 className="mt-1 text-xl font-bold text-gray-900">
                      {workflow.title}
                    </h2>

                    <p className="mt-3 text-sm leading-6 text-gray-600">
                      {workflow.description ?? "説明はありません。"}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-start gap-2">
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                      {workflow.status}
                    </span>

                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                      優先度 {workflow.priority}
                    </span>

                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                      現在 STEP {workflow.current_step_order}
                    </span>
                  </div>
                </div>

                <p className="mt-5 text-sm font-semibold text-gray-900">
                  詳細を見る →
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}