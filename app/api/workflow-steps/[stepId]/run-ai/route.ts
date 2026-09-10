import OpenAI from "openai";
import { NextResponse } from "next/server";
import { readUtf8BodyWithLimit } from "@/lib/request-body";
import {
  WORKFLOW_AI_REQUEST_MAX_BODY_BYTES,
  WORKFLOW_AI_MAX_OUTPUT_TOKENS,
  WORKFLOW_AI_TIMEOUT_MS,
  buildWorkflowAiPrompt,
  getWorkflowAiAuditError,
  isValidWorkflowIdentifier,
  parseWorkflowAiResult,
  validateWorkflowAiRequest,
} from "@/lib/workflow-ai";
import { createClient } from "@/utils/supabase/server";

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      stepId: string;
    }>;
  },
) {
  const startedTime = Date.now();

  let executionHistoryId: string | null = null;
  let supabase: Awaited<ReturnType<typeof createClient>> | null = null;

  try {
    const { stepId } = await context.params;

    if (!isValidWorkflowIdentifier(stepId)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Workflow STEPの情報が正しくありません。",
        },
        { status: 400 },
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

    const parsedText = await readUtf8BodyWithLimit(
      request,
      WORKFLOW_AI_REQUEST_MAX_BODY_BYTES,
    );
    if (!parsedText.ok) {
      return NextResponse.json(
        { ok: false, error: "AI実行リクエストが大きすぎます。" },
        { status: 413 },
      );
    }

    const body: unknown = (() => {
      try {
        return JSON.parse(parsedText.text);
      } catch {
        return null;
      }
    })();
    if (validateWorkflowAiRequest(body)) {
      return NextResponse.json(
        { ok: false, error: "AI実行リクエストが正しくありません。" },
        { status: 400 },
      );
    }

    const workflowId = (body as { workflowId: string }).workflowId;
    const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          ok: false,
          error: "AI実行の設定に問題があります。",
        },
        { status: 503 },
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
      .select("id, title, description, priority, status, current_step_order")
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

    const { data: executionClaim, error: historyCreateError } =
      await supabase.rpc("start_workflow_ai_run", {
        p_workflow_id: workflowId,
        p_workflow_step_id: stepId,
        p_model: model,
      });

    if (historyCreateError) {
      if (
        historyCreateError.code === "23505" ||
        historyCreateError.message.includes("WORKFLOW_AI_ALREADY_RUNNING")
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: "このWorkflow STEPはすでにAI実行中です。",
          },
          { status: 409 },
        );
      }

      if (
        historyCreateError.message.includes("WORKFLOW_STEP_STATE_CHANGED") ||
        historyCreateError.message.includes("HUMAN_APPROVAL_REQUIRED")
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: "Workflow STEPの状態が変更されたため、AI実行を開始できませんでした。",
          },
          { status: 409 },
        );
      }

      throw new Error(
        `実行履歴の開始記録に失敗しました: ${historyCreateError.message}`,
      );
    }

    const claimedExecutionId =
      executionClaim &&
      typeof executionClaim === "object" &&
      !Array.isArray(executionClaim) &&
      "execution_history_id" in executionClaim
        ? executionClaim.execution_history_id
        : null;

    if (!isValidWorkflowIdentifier(claimedExecutionId)) {
      throw new Error("実行履歴IDを取得できませんでした。");
    }

    executionHistoryId = claimedExecutionId;

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

    const prompt = buildWorkflowAiPrompt({
      employee: {
        name: employeeName,
        role: employeeRole,
        description: employeeDescription,
      },
      workflow: {
        title: workflow.title,
        description: workflow.description,
        priority: workflow.priority,
      },
      step: {
        stepOrder: step.step_order,
        name: step.name,
      },
      ceoInstruction,
      previousStep: previousStepText,
    });

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: WORKFLOW_AI_TIMEOUT_MS,
      maxRetries: 0,
    });

    const response = await openai.responses.create(
      {
        model,
        input: prompt,
        max_output_tokens: WORKFLOW_AI_MAX_OUTPUT_TOKENS,
        store: false,
      },
      {
        idempotencyKey: `workflow-ai:${executionHistoryId}`,
      },
    );

    if (response.status !== "completed") {
      throw new Error("OpenAIの回答が完了しませんでした。");
    }

    const outputText = response.output_text?.trim();

    if (!outputText) {
      throw new Error("OpenAIから回答を取得できませんでした。");
    }

    const aiResult = parseWorkflowAiResult(outputText);

    const aiMessageContent = [
      "【作業メモ】",
      aiResult.work_note,
      "",
      "【成果物・次工程への引継ぎ】",
      aiResult.deliverable,
    ].join("\n");

    const durationMs = Date.now() - startedTime;

    const promptTokens = response.usage?.input_tokens ?? null;
    const completionTokens = response.usage?.output_tokens ?? null;
    const totalTokens = response.usage?.total_tokens ?? null;

    const { error: finalizeError } = await supabase.rpc(
      "finalize_workflow_ai_run",
      {
        p_execution_history_id: executionHistoryId,
        p_workflow_id: workflowId,
        p_workflow_step_id: stepId,
        p_work_note: aiResult.work_note,
        p_deliverable: aiResult.deliverable,
        p_message_content: aiMessageContent,
        p_duration_ms: durationMs,
        p_prompt_tokens: promptTokens,
        p_completion_tokens: completionTokens,
        p_total_tokens: totalTokens,
      },
    );

    if (finalizeError) {
      throw new Error(
        `AI実行結果の確定に失敗しました: ${finalizeError.message}`,
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
    const auditError = getWorkflowAiAuditError(error);

    if (supabase && executionHistoryId) {
      const durationMs = Date.now() - startedTime;

      const { error: historyError } = await supabase
        .from("execution_history")
        .update({
          status: "ERROR",
          duration_ms: durationMs,
          completed_at: new Date().toISOString(),
          error_message: auditError,
        })
        .eq("id", executionHistoryId)
        .eq("status", "RUNNING");

      if (historyError) {
        console.error("Execution history update failed", {
          code: historyError.code ?? "unknown",
        });
      }
    }

    console.error("Workflow AI execution failed", {
      classification: auditError,
    });

    return NextResponse.json(
      {
        ok: false,
        error:
          "AI社員の実行に失敗しました。実行履歴の分類を確認してください。",
      },
      { status: 500 },
    );
  }
}
