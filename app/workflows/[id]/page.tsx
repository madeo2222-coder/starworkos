import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import AutoRelayButton from "./auto-relay-button";

type ProjectRelation = {
  name: string;
};

type AiEmployeeRelation = {
  name: string;
  role: string | null;
  description: string | null;
};

type Workflow = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  current_step_order: number | null;
  projects:
    | ProjectRelation
    | ProjectRelation[]
    | null;
};

type WorkflowStep = {
  id: string;
  workflow_id: string;
  step_order: number;
  name: string;
  status: string | null;
  requires_human_approval: boolean | null;
  assigned_ai_employee_id: string | null;
  ai_employees:
    | AiEmployeeRelation
    | AiEmployeeRelation[]
    | null;
};

type CompleteStepResponse = {
  ok?: boolean;
  workflow_status?: string;
  completed_step_order?: number;
  current_step_order?: number | null;
};

function getProjectName(
  projects: Workflow["projects"],
): string {
  if (!projects) {
    return "プロジェクト未設定";
  }

  if (Array.isArray(projects)) {
    return projects[0]?.name ?? "プロジェクト未設定";
  }

  return projects.name;
}

function getAssignedEmployee(
  relation: WorkflowStep["ai_employees"],
): AiEmployeeRelation | null {
  if (!relation) {
    return null;
  }

  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

async function completeStep(formData: FormData) {
  "use server";

  const workflowId = String(
    formData.get("workflowId") ?? "",
  ).trim();

  const stepName = String(
    formData.get("stepName") ?? "",
  ).trim();

  if (!workflowId) {
    throw new Error(
      "Workflow STEPの情報が不足しています。",
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase.rpc(
    "complete_current_workflow_step",
    {
      p_workflow_id: workflowId,
      p_result: stepName
        ? `STEP「${stepName}」を人間が完了確認しました。`
        : "現在のSTEPを人間が完了確認しました。",
    },
  );

  if (error) {
    if (
      error.message.includes(
        "HUMAN_APPROVAL_REQUIRED",
      )
    ) {
      throw new Error(
        "このSTEPは人間承認が必要です。先に承認処理を行ってください。",
      );
    }

    if (
      error.message.includes(
        "WORKFLOW_ALREADY_COMPLETED",
      )
    ) {
      throw new Error(
        "このWorkflowはすでに完了しています。",
      );
    }

    if (
      error.message.includes(
        "WORKFLOW_NOT_FOUND",
      )
    ) {
      throw new Error(
        "対象のWorkflowが見つかりません。",
      );
    }

    if (
      error.message.includes(
        "CURRENT_STEP_NOT_FOUND",
      )
    ) {
      throw new Error(
        "現在のSTEPが見つかりません。",
      );
    }

    throw new Error(
      `STEPの完了処理に失敗しました: ${error.message}`,
    );
  }

  const result =
    data as CompleteStepResponse | null;

  if (!result?.ok) {
    throw new Error(
      "STEPの完了結果を確認できませんでした。",
    );
  }

  revalidatePath(`/workflows/${workflowId}`);
  revalidatePath(`/workflows/${workflowId}/chat`);
  revalidatePath("/workflows");
  revalidatePath("/dashboard");
  revalidatePath("/ceo-inbox");
  revalidatePath("/executions");
  revalidatePath("/ai-employees");

  redirect(`/workflows/${workflowId}`);
}

export default async function WorkflowDetailPage({
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

  const {
    data: workflowData,
    error: workflowError,
  } = await supabase
    .from("workflows")
    .select(`
      id,
      title,
      description,
      status,
      priority,
      current_step_order,
      projects (
        name
      )
    `)
    .eq("id", id)
    .maybeSingle();

  if (workflowError) {
    throw new Error(
      `Workflowの取得に失敗しました: ${workflowError.message}`,
    );
  }

  if (!workflowData) {
    notFound();
  }

  const {
    data: stepData,
    error: stepError,
  } = await supabase
    .from("workflow_steps")
    .select(`
      id,
      workflow_id,
      step_order,
      name,
      status,
      requires_human_approval,
      assigned_ai_employee_id,
      ai_employees (
        name,
        role,
        description
      )
    `)
    .eq("workflow_id", id)
    .order("step_order", {
      ascending: true,
    });

  if (stepError) {
    throw new Error(
      `Workflow STEPの取得に失敗しました: ${stepError.message}`,
    );
  }

  const workflow =
    workflowData as unknown as Workflow;

  const steps =
    (stepData ?? []) as unknown as WorkflowStep[];

  const projectName = getProjectName(
    workflow.projects,
  );

  return (
    <main className="min-h-screen bg-[#f7f7f5] p-6 md:p-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap gap-4">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-zinc-500 hover:text-zinc-950"
          >
            ← Command Center
          </Link>

          <Link
            href="/workflows"
            className="text-sm font-medium text-zinc-500 hover:text-zinc-950"
          >
            Workflows一覧へ戻る
          </Link>

          <Link
            href={`/workflows/${workflow.id}/chat`}
            className="text-sm font-medium text-zinc-500 hover:text-zinc-950"
          >
            AI社員チャットを見る
          </Link>
        </div>

        <section className="os-surface rounded-[24px] p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="os-eyebrow">
                {projectName}
              </p>

              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-zinc-950 md:text-4xl">
                {workflow.title}
              </h1>

              <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-500">
                {workflow.description ??
                  "説明は登録されていません。"}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-semibold text-white">
                {workflow.status ?? "未設定"}
              </span>

              <span className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-semibold text-zinc-600">
                優先度{" "}
                {workflow.priority ?? "未設定"}
              </span>

              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700">
                現在 STEP{" "}
                {workflow.current_step_order ?? "-"}
              </span>
            </div>
          </div>
        </section>

        {workflow.status !== "DONE" && (
          <section className="mt-6">
            <AutoRelayButton
              workflowId={workflow.id}
            />
          </section>
        )}

        {workflow.status === "DONE" && (
          <section className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="text-sm font-bold text-emerald-900">
              このWorkflowは完了しています。
            </p>

            <p className="mt-2 text-sm leading-6 text-emerald-800">
              AI社員チャットや実行履歴から、成果物と処理内容を確認できます。
            </p>

            <div className="mt-4 flex flex-wrap gap-4">
              <Link
                href={`/workflows/${workflow.id}/chat`}
                className="text-sm font-bold text-emerald-900 underline"
              >
                AI社員チャットを見る
              </Link>

              <Link
                href="/executions"
                className="text-sm font-bold text-emerald-900 underline"
              >
                実行履歴を見る
              </Link>
            </div>
          </section>
        )}

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="os-eyebrow">Execution plan</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-950">
                Workflow Steps
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                各AI社員の担当工程と現在の状態を確認します。
              </p>
            </div>

            <Link
              href={`/workflows/${workflow.id}/chat`}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
            >
              会話履歴を確認
            </Link>
          </div>

          {steps.length === 0 ? (
            <div className="mt-4 rounded-2xl bg-white p-6 text-gray-600 shadow-sm">
              STEPはまだ登録されていません。
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {steps.map((step) => {
                const employee =
                  getAssignedEmployee(
                    step.ai_employees,
                  );

                const isCurrentStep =
                  workflow.status !== "DONE" &&
                  workflow.current_step_order ===
                    step.step_order;

                return (
                  <article
                    key={step.id}
                    className={`os-surface rounded-[22px] p-6 ${
                      isCurrentStep
                        ? "!border-zinc-950 ring-1 ring-zinc-950"
                        : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-semibold text-gray-500">
                            STEP {step.step_order}
                          </p>

                          {isCurrentStep && (
                            <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-bold text-white">
                              現在の工程
                            </span>
                          )}
                        </div>

                        <h3 className="mt-2 text-lg font-semibold tracking-tight text-zinc-950">
                          {step.name}
                        </h3>

                        <p className="mt-2 text-sm text-gray-600">
                          担当：
                          {employee?.name ??
                            "未割当"}

                          {employee?.role
                            ? `（${employee.role}）`
                            : ""}
                        </p>

                        <p className="mt-3 text-sm leading-6 text-gray-500">
                          {employee?.description ??
                            "担当AI社員の説明は登録されていません。"}
                        </p>

                        {isCurrentStep &&
                          step.requires_human_approval && (
                            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                              <p className="text-sm font-bold text-amber-900">
                                このSTEPはCEOの承認が必要です。
                              </p>

                              <Link
                                href="/ceo-inbox"
                                className="mt-2 inline-flex text-sm font-bold text-amber-900 underline"
                              >
                                CEO Inboxで確認する →
                              </Link>
                            </div>
                          )}

                        {!employee &&
                          step.assigned_ai_employee_id && (
                            <p className="mt-2 text-xs text-amber-700">
                              AI社員IDは設定されていますが、社員情報を取得できませんでした。
                            </p>
                          )}
                      </div>

                      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                        {step.status ?? "未設定"}
                      </span>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                      <Link
                        href={`/workflows/${workflow.id}/steps/${step.id}`}
                        className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
                      >
                        詳細を見る
                      </Link>

                      {isCurrentStep && (
                        <form action={completeStep}>
                          <input
                            type="hidden"
                            name="workflowId"
                            value={workflow.id}
                          />

                          <input
                            type="hidden"
                            name="stepName"
                            value={step.name}
                          />

                          <button
                            type="submit"
                            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                          >
                            STEP
                            {step.step_order}
                            を手動完了
                          </button>
                        </form>
                      )}
                    </div>
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
