import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

type Project = {
  id: string;
  name: string;
};

const WORKFLOW_STEP_DEFINITIONS = [
  {
    stepOrder: 1,
    stepName: "要件整理",
    employeeName: "AI PM",
  },
  {
    stepOrder: 2,
    stepName: "設計",
    employeeName: "AI Architect",
  },
  {
    stepOrder: 3,
    stepName: "実装",
    employeeName: "AI Developer",
  },
  {
    stepOrder: 4,
    stepName: "品質確認",
    employeeName: "AI QA",
  },
  {
    stepOrder: 5,
    stepName: "ナレッジ化",
    employeeName: "AI Knowledge",
  },
] as const;

async function createWorkflow(formData: FormData) {
  "use server";

  const title = String(
    formData.get("title") ?? "",
  ).trim();

  const description = String(
    formData.get("description") ?? "",
  ).trim();

  const ceoInstruction = String(
    formData.get("ceoInstruction") ?? "",
  ).trim();

  const priority = String(
    formData.get("priority") ?? "高",
  ).trim();

  const projectIdValue = String(
    formData.get("projectId") ?? "",
  ).trim();

  const projectId = projectIdValue || null;

  if (!title) {
    throw new Error(
      "Workflow名を入力してください。",
    );
  }

  if (!ceoInstruction) {
    throw new Error(
      "CEOからの依頼内容を入力してください。",
    );
  }

  const allowedPriorities = [
    "低",
    "中",
    "高",
  ];

  if (!allowedPriorities.includes(priority)) {
    throw new Error(
      `優先度の指定が正しくありません。受信値：${priority}`,
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: workflowId, error } =
    await supabase.rpc(
      "create_development_workflow",
      {
        p_project_id: projectId,
        p_title: title,
        p_description: description,
        p_ceo_instruction: ceoInstruction,
        p_priority: priority,
      },
    );

  if (error) {
    const errorMessage = error.message;

    if (
      errorMessage.includes(
        "WORKFLOW_TITLE_REQUIRED",
      )
    ) {
      throw new Error(
        "Workflow名を入力してください。",
      );
    }

    if (
      errorMessage.includes(
        "CEO_INSTRUCTION_REQUIRED",
      )
    ) {
      throw new Error(
        "CEOからの依頼内容を入力してください。",
      );
    }

    if (
      errorMessage.includes(
        "INVALID_PRIORITY",
      )
    ) {
      throw new Error(
        "優先度の指定が正しくありません。",
      );
    }

    if (
      errorMessage.includes(
        "PROJECT_NOT_FOUND",
      )
    ) {
      throw new Error(
        "選択したプロジェクトが見つかりません。",
      );
    }

    if (
      errorMessage.includes(
        "AI_PM_NOT_FOUND",
      )
    ) {
      throw new Error(
        "AI PMが登録されていません。",
      );
    }

    if (
      errorMessage.includes(
        "AI_ARCHITECT_NOT_FOUND",
      )
    ) {
      throw new Error(
        "AI Architectが登録されていません。",
      );
    }

    if (
      errorMessage.includes(
        "AI_DEVELOPER_NOT_FOUND",
      )
    ) {
      throw new Error(
        "AI Developerが登録されていません。",
      );
    }

    if (
      errorMessage.includes(
        "AI_QA_NOT_FOUND",
      )
    ) {
      throw new Error(
        "AI QAが登録されていません。",
      );
    }

    if (
      errorMessage.includes(
        "AI_KNOWLEDGE_NOT_FOUND",
      )
    ) {
      throw new Error(
        "AI Knowledgeが登録されていません。",
      );
    }

    if (
      errorMessage.includes(
        "AUTHENTICATION_REQUIRED",
      )
    ) {
      redirect("/login");
    }

    throw new Error(
      `Workflowの作成に失敗しました: ${errorMessage}`,
    );
  }

  if (
    !workflowId ||
    typeof workflowId !== "string"
  ) {
    throw new Error(
      "Workflowは作成されましたが、作成IDを取得できませんでした。",
    );
  }

  redirect(`/workflows/${workflowId}`);
}

export default async function NewWorkflowPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("projects")
    .select(`
      id,
      name
    `)
    .order("created_at", {
      ascending: true,
    });

  if (error) {
    throw new Error(
      `プロジェクトの取得に失敗しました: ${error.message}`,
    );
  }

  const projects: Project[] = data ?? [];

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap gap-4">
          <Link
            href="/workflows"
            className="text-sm font-semibold text-gray-700 underline"
          >
            ← Workflows一覧へ戻る
          </Link>

          <Link
            href="/dashboard"
            className="text-sm font-semibold text-gray-700 underline"
          >
            Dashboardへ戻る
          </Link>
        </div>

        <header className="rounded-2xl bg-white p-6 shadow-sm md:p-8">
          <p className="text-sm font-semibold text-gray-500">
            STAR WORK OS
          </p>

          <h1 className="mt-2 text-3xl font-bold text-gray-900">
            新しいWorkflowを作成
          </h1>

          <p className="mt-3 text-sm leading-6 text-gray-600">
            CEOからの依頼を登録すると、AI PM、AI Architect、
            AI Developer、AI QA、AI Knowledgeの5工程を自動作成します。
          </p>
        </header>

        <form
          action={createWorkflow}
          className="mt-6 space-y-6"
        >
          <section className="rounded-2xl bg-white p-6 shadow-sm md:p-8">
            <div>
              <label
                htmlFor="title"
                className="text-sm font-bold text-gray-900"
              >
                Workflow名
              </label>

              <p className="mt-1 text-sm text-gray-500">
                何を行うWorkflowなのか、分かりやすい名前を付けます。
              </p>

              <input
                id="title"
                name="title"
                type="text"
                required
                placeholder="例：STAR WARRANTY代理店マニュアル作成"
                className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-500"
              />
            </div>

            <div className="mt-6">
              <label
                htmlFor="description"
                className="text-sm font-bold text-gray-900"
              >
                Workflowの説明
              </label>

              <p className="mt-1 text-sm text-gray-500">
                背景や目的を簡潔に記録します。
              </p>

              <textarea
                id="description"
                name="description"
                rows={4}
                placeholder="例：代理店が初めて利用する際に迷わない入力マニュアルを作成する。"
                className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm leading-6 text-gray-900 outline-none focus:border-blue-500"
              />
            </div>

            <div className="mt-6">
              <label
                htmlFor="ceoInstruction"
                className="text-sm font-bold text-gray-900"
              >
                CEOからの依頼内容
              </label>

              <p className="mt-1 text-sm text-gray-500">
                AI PMが最初に受け取る具体的な指示です。
              </p>

              <textarea
                id="ceoInstruction"
                name="ceoInstruction"
                rows={10}
                required
                placeholder={[
                  "例：",
                  "STAR WARRANTYの代理店向け入力マニュアルを作成してください。",
                  "",
                  "初めて操作する代理店でも理解できる内容にしてください。",
                  "ログイン、顧客登録、商品登録、申込登録、確認方法まで含めてください。",
                  "不明な仕様は断定せず、確認事項として整理してください。",
                ].join("\n")}
                className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm leading-7 text-gray-900 outline-none focus:border-blue-500"
              />
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div>
                <label
                  htmlFor="projectId"
                  className="text-sm font-bold text-gray-900"
                >
                  プロジェクト
                </label>

                <select
                  id="projectId"
                  name="projectId"
                  defaultValue=""
                  className="mt-3 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-500"
                >
                  <option value="">
                    プロジェクト未設定
                  </option>

                  {projects.map((project) => (
                    <option
                      key={project.id}
                      value={project.id}
                    >
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>

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
                  defaultValue="高"
                  className="mt-3 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-500"
                >
                  <option value="低">
                    低
                  </option>

                  <option value="中">
                    通常
                  </option>

                  <option value="高">
                    最優先
                  </option>
                </select>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-6">
            <h2 className="text-lg font-bold text-blue-900">
              自動作成されるAI社員の工程
            </h2>

            <div className="mt-4 space-y-3">
              {WORKFLOW_STEP_DEFINITIONS.map(
                (definition) => (
                  <div
                    key={definition.stepOrder}
                    className="flex flex-col gap-1 rounded-xl bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <p className="text-sm font-bold text-gray-900">
                      STEP {definition.stepOrder}：
                      {definition.stepName}
                    </p>

                    <p className="text-sm font-semibold text-gray-600">
                      {definition.employeeName}
                    </p>
                  </div>
                ),
              )}
            </div>
          </section>

          <button
            type="submit"
            className="w-full rounded-xl bg-blue-600 px-6 py-4 text-sm font-bold text-white transition hover:bg-blue-700"
          >
            Workflowを作成する
          </button>
        </form>
      </div>
    </main>
  );
}