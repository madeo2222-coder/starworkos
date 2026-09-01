import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type AiResult = {
  work_note: string;
  deliverable: string;
};

function parseAiResult(text: string): AiResult {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const parsed = JSON.parse(cleaned) as Partial<AiResult>;

  if (
    typeof parsed.work_note !== "string" ||
    typeof parsed.deliverable !== "string"
  ) {
    throw new Error("AIの回答形式が正しくありません。");
  }

  return {
    work_note: parsed.work_note.trim(),
    deliverable: parsed.deliverable.trim(),
  };
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      stepId: string;
    }>;
  },
) {
  const startedAt = new Date();
  const startedTime = Date.now();

  let executionHistoryId: string | null = null;
  let supabase: Awaited<ReturnType<typeof createClient>> | null = null;

  try {
    const { stepId } = await context.params;

    const body = (await request.json()) as {
      workflowId?: string;
    };

    const workflowId = body.workflowId;
    const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";

    if (!stepId || !workflowId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Workflow STEPの情報が不足しています。",
        },
        { status: 400 },
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          ok: false,
          error: "OPENAI_API_KEYが設定されていません。",
        },
        { status: 500 },
      );
    }

    supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          error: "ログインが必要です。",
        },
        { status: 401 },
      );
    }

    const { data: step, error: stepError } = await supabase
      .from("workflow_steps")
      .select(`
        id,
        workflow_id,
        step_order,
        name,
        status,
        requires_human_approval,
        approved_at,
        ceo_instruction,
        work_note,
        deliverable,
        assigned_ai_employee_id
      `)
      .eq("id", stepId)
      .eq("workflow_id", workflowId)
      .maybeSingle();

    if (stepError) {
      throw new Error(
        `Workflow STEPの取得に失敗しました: ${stepError.message}`,
      );
    }

    if (!step) {
      return NextResponse.json(
        {
          ok: false,
          error: "対象のWorkflow STEPが見つかりません。",
        },
        { status: 404 },
      );
    }

    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("id, status, current_step_order")
      .eq("id", workflowId)
      .maybeSingle();

    if (workflowError) {
      throw new Error(`Workflowの取得に失敗しました: ${workflowError.message}`);
    }

    if (!workflow) {
      return NextResponse.json(
        {
          ok: false,
          error: "対象のWorkflowが見つかりません。",
        },
        { status: 404 },
      );
    }

    if (workflow.status !== "IN_PROGRESS") {
      return NextResponse.json(
        {
          ok: false,
          error: "Workflowは現在AI実行できる状態ではありません。",
        },
        { status: 409 },
      );
    }

    if (step.step_order !== workflow.current_step_order) {
      return NextResponse.json(
        {
          ok: false,
          error: "現在のWorkflow STEPのみ実行できます。",
        },
        { status: 409 },
      );
    }

    if (step.status !== "IN_PROGRESS") {
      return NextResponse.json(
        {
          ok: false,
          error: "現在のSTEPはAI実行できる状態ではありません。",
        },
        { status: 409 },
      );
    }

    if (step.requires_human_approval && !step.approved_at) {
      return NextResponse.json(
        {
          ok: false,
          error: "このSTEPは人間承認後に実行できます。",
        },
        { status: 409 },
      );
    }

    const { data: executionHistory, error: historyCreateError } =
      await supabase
        .from("execution_history")
        .insert({
          workflow_id: workflowId,
          workflow_step_id: stepId,
          ai_employee_id: step.assigned_ai_employee_id,
          model,
          action: `STEP ${step.step_order}：${step.name}`,
          status: "RUNNING",
          started_at: startedAt.toISOString(),
        })
        .select("id")
        .single();

    if (historyCreateError) {
      throw new Error(
        `実行履歴の開始記録に失敗しました: ${historyCreateError.message}`,
      );
    }

    executionHistoryId = executionHistory.id;

    let employeeName = "AI社員";
    let employeeRole = "担当業務";
    let employeeDescription = "";

    if (step.assigned_ai_employee_id) {
      const { data: employee, error: employeeError } = await supabase
        .from("ai_employees")
        .select("name, role, description")
        .eq("id", step.assigned_ai_employee_id)
        .maybeSingle();

      if (employeeError) {
        throw new Error(
          `AI社員の取得に失敗しました: ${employeeError.message}`,
        );
      }

      if (employee) {
        employeeName = employee.name;
        employeeRole = employee.role ?? "担当業務";
        employeeDescription = employee.description ?? "";
      }
    }

    let previousStepText = "前工程はありません。";

    if (step.step_order > 1) {
      const { data: previousStep, error: previousStepError } =
        await supabase
          .from("workflow_steps")
          .select(`
            step_order,
            name,
            work_note,
            deliverable
          `)
          .eq("workflow_id", workflowId)
          .lt("step_order", step.step_order)
          .order("step_order", { ascending: false })
          .limit(1)
          .maybeSingle();

      if (previousStepError) {
        throw new Error(
          `前工程の取得に失敗しました: ${previousStepError.message}`,
        );
      }

      if (previousStep) {
        previousStepText = [
          `STEP ${previousStep.step_order}：${previousStep.name}`,
          "",
          "作業メモ:",
          previousStep.work_note ?? "未登録",
          "",
          "成果物・引継ぎ:",
          previousStep.deliverable ?? "未登録",
        ].join("\n");
      }
    }

    const ceoInstruction =
      step.ceo_instruction?.trim() ||
      "現在の工程に必要な作業を、担当AI社員として適切に進めてください。";

    const { error: ceoMessageError } = await supabase
      .from("workflow_messages")
      .insert({
        workflow_id: workflowId,
        workflow_step_id: stepId,
        ai_employee_id: step.assigned_ai_employee_id,
        sender_type: "CEO",
        message_type: "MESSAGE",
        content: ceoInstruction,
        created_by_user_id: user.id,
      });

    if (ceoMessageError) {
      throw new Error(
        `CEOメッセージの保存に失敗しました: ${ceoMessageError.message}`,
      );
    }

    const prompt = `
あなたはSTAR WORK OSのAI社員です。

【担当AI社員】
名前: ${employeeName}
役割: ${employeeRole}
役割説明: ${employeeDescription || "未登録"}

【現在の工程】
STEP ${step.step_order}: ${step.name}

【CEOからの指示】
${ceoInstruction}

【前工程からの引継ぎ】
${previousStepText}

次のルールを守ってください。

1. 担当する役割の範囲で作業してください。
2. 不明な情報を事実として断定しないでください。
3. 人間の承認が必要な判断は、勝手に確定しないでください。
4. 次工程のAI社員が理解できる具体的な成果物を作ってください。
5. 日本語で回答してください。
6. 必ず次のJSON形式だけで回答してください。説明文やコードフェンスは不要です。

{
  "work_note": "分析、確認事項、作業経過、判断根拠",
  "deliverable": "完成した成果物、決定事項、未解決事項、次工程への具体的な引継ぎ"
}
`.trim();

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const response = await openai.responses.create({
      model,
      input: prompt,
    });

    const outputText = response.output_text?.trim();

    if (!outputText) {
      throw new Error("OpenAIから回答を取得できませんでした。");
    }

    const aiResult = parseAiResult(outputText);

    const { error: stepUpdateError } = await supabase
      .from("workflow_steps")
      .update({
        work_note: aiResult.work_note,
        deliverable: aiResult.deliverable,
      })
      .eq("id", stepId)
      .eq("workflow_id", workflowId);

    if (stepUpdateError) {
      throw new Error(
        `AI回答の保存に失敗しました: ${stepUpdateError.message}`,
      );
    }

    const aiMessageContent = [
      "【作業メモ】",
      aiResult.work_note,
      "",
      "【成果物・次工程への引継ぎ】",
      aiResult.deliverable,
    ].join("\n");

    const { error: aiMessageError } = await supabase
      .from("workflow_messages")
      .insert({
        workflow_id: workflowId,
        workflow_step_id: stepId,
        ai_employee_id: step.assigned_ai_employee_id,
        sender_type: "AI_EMPLOYEE",
        message_type: "HANDOFF",
        content: aiMessageContent,
        created_by_user_id: user.id,
      });

    if (aiMessageError) {
      throw new Error(
        `AI社員メッセージの保存に失敗しました: ${aiMessageError.message}`,
      );
    }

    const completedAt = new Date();
    const durationMs = Date.now() - startedTime;

    const promptTokens = response.usage?.input_tokens ?? null;
    const completionTokens = response.usage?.output_tokens ?? null;
    const totalTokens = response.usage?.total_tokens ?? null;

    const { error: historyCompleteError } = await supabase
      .from("execution_history")
      .update({
        status: "SUCCESS",
        duration_ms: durationMs,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        completed_at: completedAt.toISOString(),
        error_message: null,
      })
      .eq("id", executionHistoryId);

    if (historyCompleteError) {
      throw new Error(
        `実行履歴の完了記録に失敗しました: ${historyCompleteError.message}`,
      );
    }

    return NextResponse.json({
      ok: true,
      workNote: aiResult.work_note,
      deliverable: aiResult.deliverable,
      execution: {
        model,
        durationMs,
        promptTokens,
        completionTokens,
        totalTokens,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "AI社員の実行中に予期しないエラーが発生しました。";

    if (supabase && executionHistoryId) {
      const durationMs = Date.now() - startedTime;

      const { error: historyError } = await supabase
        .from("execution_history")
        .update({
          status: "ERROR",
          duration_ms: durationMs,
          completed_at: new Date().toISOString(),
          error_message: message,
        })
        .eq("id", executionHistoryId);

      if (historyError) {
        console.error(
          "Execution history update failed:",
          historyError,
        );
      }
    }

    console.error("Workflow AI execution failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
