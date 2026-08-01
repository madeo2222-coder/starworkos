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
  const runningCount = workflowRows.filter(
    (workflow) => workflow.status === "IN_PROGRESS",
  ).length;
  const doneCount = workflowRows.filter(
    (workflow) => workflow.status === "DONE",
  ).length;

  return (
    <main className="min-h-screen bg-[#f7f7f5] px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <Link href="/dashboard" className="text-sm font-medium text-zinc-500 hover:text-zinc-950">← Command Center</Link>
          <div className="flex gap-2">
            <Link href="/tasks" className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-white">Tasks</Link>
            <Link href="/ai-employees" className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-white">AI Employees</Link>
          </div>
        </div>

        <header className="os-surface rounded-[24px] p-6 md:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="os-eyebrow">Operations pipeline</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-zinc-950">Workflows</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">CEOの指示が5人のAI社員へどう引き継がれ、どこまで進んでいるかを確認します。</p>
            </div>
            <Link href="/workflows/new" className="inline-flex w-fit items-center justify-center rounded-xl bg-zinc-950 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800">＋ Workflowを作成</Link>
          </div>

          <div className="mt-8 grid grid-cols-3 gap-3 border-t border-zinc-100 pt-6">
            <WorkflowMetric label="すべて" value={workflowRows.length} />
            <WorkflowMetric label="進行中" value={runningCount} />
            <WorkflowMetric label="完了" value={doneCount} />
          </div>
        </header>

        {workflowRows.length === 0 ? (
          <div className="os-surface mt-6 rounded-[22px] p-8 text-zinc-500">
            Workflowはまだ登録されていません。
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-[22px] border border-zinc-200 bg-white">
            {workflowRows.map((workflow) => (
              <Link
                key={workflow.id}
                href={`/workflows/${workflow.id}`}
                className="group block border-b border-zinc-100 p-5 last:border-0 hover:bg-zinc-50/80 md:p-6"
              >
                <div className="flex flex-col justify-between gap-4 md:flex-row">
                  <div>
                    <p className="text-xs font-medium text-zinc-500">
                      {workflow.projects?.[0]?.name ?? "プロジェクト未設定"}
                    </p>

                    <h2 className="mt-2 text-lg font-semibold tracking-tight text-zinc-950">
                      {workflow.title}
                    </h2>

                    <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                      {workflow.description ?? "説明はありません。"}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-start gap-2">
                    <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700">
                      {workflow.status}
                    </span>

                    <span className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-semibold text-zinc-600">
                      優先度 {workflow.priority}
                    </span>

                    <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-semibold text-white">
                      現在 STEP {workflow.current_step_order}
                    </span>
                  </div>
                </div>

                <p className="mt-4 text-sm font-semibold text-zinc-500 group-hover:text-zinc-950">
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

function WorkflowMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">{value}</p>
    </div>
  );
}
