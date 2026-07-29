import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import RunAiButton from "./run-ai-button";

type AiEmployee = {
  name: string;
  role: string | null;
  description: string | null;
};

type WorkflowStep = {
  id: string;
  workflow_id: string;
  step_order: number;
  name: string;
  status: string | null;
  ceo_instruction: string | null;
  work_note: string | null;
  deliverable: string | null;
  ai_employees: AiEmployee | AiEmployee[] | null;
};

type PreviousStep = {
  id: string;
  step_order: number;
  name: string;
  deliverable: string | null;
  work_note: string | null;
  ai_employees: AiEmployee | AiEmployee[] | null;
};

function resolveEmployee(
  relation: AiEmployee | AiEmployee[] | null,
): AiEmployee | null {
  if (!relation) {
    return null;
  }

  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

async function saveStepContent(formData: FormData) {
  "use server";

  const workflowId = String(formData.get("workflowId") ?? "");
  const stepId = String(formData.get("stepId") ?? "");
  const ceoInstruction = String(
    formData.get("ceoInstruction") ?? "",
  );
  const workNote = String(formData.get("workNote") ?? "");
  const deliverable = String(formData.get("deliverable") ?? "");

  if (!workflowId || !stepId) {
    throw new Error("Workflow STEPの情報が不足しています。");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase
    .from("workflow_steps")
    .update({
      ceo_instruction: ceoInstruction.trim() || null,
      work_note: workNote.trim() || null,
      deliverable: deliverable.trim() || null,
    })
    .eq("id", stepId)
    .eq("workflow_id", workflowId);

  if (error) {
    throw new Error(
      `Workflow STEPの保存に失敗しました: ${error.message}`,
    );
  }

  revalidatePath(`/workflows/${workflowId}`);
  revalidatePath(`/workflows/${workflowId}/steps/${stepId}`);
}

export default async function WorkflowStepDetailPage({
  params,
}: {
  params: Promise<{
    id: string;
    stepId: string;
  }>;
}) {
  const { id, stepId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("workflow_steps")
    .select(`
      id,
      workflow_id,
      step_order,
      name,
      status,
      ceo_instruction,
      work_note,
      deliverable,
      ai_employees (
        name,
        role,
        description
      )
    `)
    .eq("id", stepId)
    .eq("workflow_id", id)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Workflow STEPの取得に失敗しました: ${error.message}`,
    );
  }

  if (!data) {
    notFound();
  }

  const step = data as unknown as WorkflowStep;
  const employee = resolveEmployee(step.ai_employees);

  let previousStep: PreviousStep | null = null;

  if (step.step_order > 1) {
    const { data: previousStepData, error: previousStepError } =
      await supabase
        .from("workflow_steps")
        .select(`
          id,
          step_order,
          name,
          deliverable,
          work_note,
          ai_employees (
            name,
            role,
            description
          )
        `)
        .eq("workflow_id", id)
        .lt("step_order", step.step_order)
        .order("step_order", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (previousStepError) {
      throw new Error(
        `前工程の取得に失敗しました: ${previousStepError.message}`,
      );
    }

    previousStep =
      (previousStepData as unknown as PreviousStep | null) ?? null;
  }

  const previousEmployee = previousStep
    ? resolveEmployee(previousStep.ai_employees)
    : null;

  return (
    <main className="min-h-screen bg-gray-50 p-6 md:p-10">
      <div className="mx-auto max-w-5xl">
        <Link
          href={`/workflows/${id}`}
          className="text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          ← Workflowへ戻る
        </Link>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-500">
                STEP {step.step_order}
              </p>

              <h1 className="mt-2 text-3xl font-bold text-gray-900">
                {step.name}
              </h1>

              <p className="mt-3 text-sm text-gray-600">
                担当：{employee?.name ?? "未割当"}
                {employee?.role ? `（${employee.role}）` : ""}
              </p>
            </div>

            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
              {step.status ?? "未設定"}
            </span>
          </div>

          <p className="mt-5 max-w-3xl text-sm leading-7 text-gray-600">
            {employee?.description ??
              "担当AI社員の説明は登録されていません。"}
          </p>
        </section>

        {previousStep && (
          <section className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-6">
            <p className="text-sm font-semibold text-blue-700">
              前工程からの引継ぎ
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-700">
                STEP {previousStep.step_order}
              </span>

              <span className="text-sm font-bold text-gray-900">
                {previousStep.name}
              </span>

              <span className="text-sm text-gray-600">
                担当：{previousEmployee?.name ?? "未割当"}
              </span>
            </div>

            <div className="mt-5 rounded-xl bg-white p-5">
              <h2 className="text-sm font-bold text-gray-900">
                成果物・引継ぎ内容
              </h2>

              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-700">
                {previousStep.deliverable ??
                  "前工程の成果物はまだ登録されていません。"}
              </p>
            </div>

            {previousStep.work_note && (
              <details className="mt-4 rounded-xl bg-white p-5">
                <summary className="cursor-pointer text-sm font-bold text-gray-900">
                  前工程の作業メモも確認する
                </summary>

                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-700">
                  {previousStep.work_note}
                </p>
              </details>
            )}
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-blue-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">
            AI社員に作業を依頼
          </h2>

          <p className="mt-2 text-sm leading-6 text-gray-600">
            担当AI社員が、CEO指示と前工程の成果物を確認して、
            作業メモと次工程への成果物を自動作成します。
          </p>

          <div className="mt-5">
            <RunAiButton workflowId={id} stepId={stepId} />
          </div>
        </section>

        <form action={saveStepContent} className="mt-6 space-y-6">
          <input type="hidden" name="workflowId" value={id} />
          <input type="hidden" name="stepId" value={stepId} />

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <label
              htmlFor="ceoInstruction"
              className="block text-lg font-bold text-gray-900"
            >
              CEOからの指示
            </label>

            <p className="mt-2 text-sm text-gray-600">
              このSTEPでAI社員に依頼する内容を記録します。
            </p>

            <textarea
              id="ceoInstruction"
              name="ceoInstruction"
              defaultValue={step.ceo_instruction ?? ""}
              rows={6}
              className="mt-4 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm leading-7 text-gray-900 outline-none focus:border-gray-900"
              placeholder="この工程で行う作業を入力してください。"
            />
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <label
              htmlFor="workNote"
              className="block text-lg font-bold text-gray-900"
            >
              AI社員の作業メモ
            </label>

            <p className="mt-2 text-sm text-gray-600">
              AI社員が作成した分析内容や、人間による追記を保存します。
            </p>

            <textarea
              id="workNote"
              name="workNote"
              defaultValue={step.work_note ?? ""}
              rows={10}
              className="mt-4 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm leading-7 text-gray-900 outline-none focus:border-gray-900"
              placeholder="AI社員の分析・調査・作業内容が表示されます。"
            />
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <label
              htmlFor="deliverable"
              className="block text-lg font-bold text-gray-900"
            >
              成果物・次工程への引継ぎ
            </label>

            <p className="mt-2 text-sm text-gray-600">
              AI社員が作成した成果物や、次工程への引継ぎを保存します。
            </p>

            <textarea
              id="deliverable"
              name="deliverable"
              defaultValue={step.deliverable ?? ""}
              rows={10}
              className="mt-4 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm leading-7 text-gray-900 outline-none focus:border-gray-900"
              placeholder="決定事項、成果物、未解決事項、次工程への引継ぎが表示されます。"
            />
          </section>

          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-xl bg-black px-6 py-3 text-sm font-semibold text-white hover:bg-gray-800"
            >
              作業内容を保存
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}