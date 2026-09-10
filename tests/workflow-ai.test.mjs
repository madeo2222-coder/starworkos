import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  WORKFLOW_AI_REQUEST_MAX_BODY_BYTES,
  WORKFLOW_AI_MAX_OUTPUT_TOKENS,
  WORKFLOW_AI_MAX_AUDIT_ERROR_CHARS,
  WORKFLOW_AI_MAX_PROMPT_CHARS,
  WORKFLOW_AI_MAX_RESPONSE_CHARS,
  WORKFLOW_AI_RESULT_FIELD_LIMITS,
  WORKFLOW_AI_TIMEOUT_MS,
  buildWorkflowAiPrompt,
  getWorkflowAiAuditError,
  isValidWorkflowIdentifier,
  isRequirementsStep,
  parseWorkflowAiResult,
  validateWorkflowAiRequest,
} from "../lib/workflow-ai.js";

const baseInput = {
  employee: {
    name: "AI PM",
    role: "Product Manager",
    description: "依頼を実行可能な要件へ変換する",
  },
  workflow: {
    title: "要件整理の実働化",
    description: "Taskから作成されたWorkflow",
    priority: "高",
  },
  step: {
    stepOrder: 1,
    name: "要件整理",
  },
  ceoInstruction: "人間承認フローを維持して要件を整理する",
  previousStep: "前工程はありません。",
};

test("identifies STEP 1 as the requirements step", () => {
  assert.equal(isRequirementsStep(baseInput.step), true);
  assert.equal(isRequirementsStep({ stepOrder: 2, name: "設計" }), false);
});

test("builds a STEP 1 prompt with workflow context and a verifiable requirements contract", () => {
  const prompt = buildWorkflowAiPrompt(baseInput);

  assert.match(prompt, /件名: 要件整理の実働化/);
  assert.match(prompt, /説明: Taskから作成されたWorkflow/);
  assert.match(prompt, /STEP 1: 要件整理/);
  assert.match(prompt, /対象範囲/);
  assert.match(prompt, /対象外/);
  assert.match(prompt, /機能要件/);
  assert.match(prompt, /非機能要件/);
  assert.match(prompt, /受入条件/);
  assert.match(prompt, /未確定事項・確認事項/);
  assert.match(prompt, /人間承認待ち/);
  assert.match(prompt, /mainへのマージ/);
});

test("does not force the STEP 1 requirements template on later steps", () => {
  const prompt = buildWorkflowAiPrompt({
    ...baseInput,
    step: { stepOrder: 2, name: "設計" },
  });

  assert.doesNotMatch(prompt, /要件整理STEPの出力基準/);
  assert.match(prompt, /人間承認待ち/);
});

test("parses plain JSON and strips markdown fences", () => {
  assert.deepEqual(
    parseWorkflowAiResult(
      '```json\n{"work_note":" 分析済み ","deliverable":" 要件書 "}\n```',
    ),
    {
      work_note: "分析済み",
      deliverable: "要件書",
    },
  );
});

test("rejects empty, malformed, or incomplete AI results", () => {
  assert.throws(() => parseWorkflowAiResult(""), /回答が空/);
  assert.throws(() => parseWorkflowAiResult("not-json"), /JSONとして解析/);
  assert.throws(
    () => parseWorkflowAiResult('{"work_note":"ok"}'),
    /回答形式/,
  );
  assert.throws(
    () =>
      parseWorkflowAiResult(
        '{"work_note":"ok","deliverable":"   "}',
      ),
    /回答形式/,
  );
});

test("bounds prompt and parsed AI result sizes before persistence", () => {
  assert.equal(WORKFLOW_AI_MAX_PROMPT_CHARS, 64_000);
  assert.equal(WORKFLOW_AI_MAX_RESPONSE_CHARS, 64_000);
  assert.throws(
    () =>
      buildWorkflowAiPrompt({
        ...baseInput,
        ceoInstruction: "x".repeat(WORKFLOW_AI_MAX_PROMPT_CHARS),
      }),
    /業務情報が大きすぎます/,
  );
  assert.throws(
    () => parseWorkflowAiResult("x".repeat(WORKFLOW_AI_MAX_RESPONSE_CHARS + 1)),
    /保存可能な上限/,
  );
  assert.throws(
    () =>
      parseWorkflowAiResult(
        JSON.stringify({
          work_note: "x".repeat(WORKFLOW_AI_RESULT_FIELD_LIMITS.work_note + 1),
          deliverable: "ok",
        }),
      ),
    /保存可能な上限/,
  );
});

test("validates a minimal workflow AI request before database work", () => {
  const workflowId = "b2916606-3298-4457-a3ee-6e52340e925b";
  assert.equal(WORKFLOW_AI_REQUEST_MAX_BODY_BYTES, 4 * 1024);
  assert.equal(isValidWorkflowIdentifier(workflowId), true);
  assert.equal(isValidWorkflowIdentifier("workflow"), false);
  assert.equal(validateWorkflowAiRequest({ workflowId }), null);
  assert.match(validateWorkflowAiRequest(null), /JSON body/);
  assert.match(validateWorkflowAiRequest({ workflowId: "workflow" }), /workflowId/);
  assert.match(validateWorkflowAiRequest({ workflowId, extra: true }), /Unexpected/);
});

test("stores bounded audit classifications without raw provider or database details", () => {
  const secretDetail = "secret-token-and-private-row-data";

  assert.match(
    getWorkflowAiAuditError(
      Object.assign(new Error(secretDetail), {
        name: "APIConnectionTimeoutError",
      }),
    ),
    /^\[AI_PROVIDER_TIMEOUT\]/,
  );
  assert.match(
    getWorkflowAiAuditError(
      Object.assign(new Error(secretDetail), { name: "RateLimitError" }),
    ),
    /^\[AI_PROVIDER_RATE_LIMIT\]/,
  );
  assert.match(
    getWorkflowAiAuditError(
      new Error(`Workflowの取得に失敗しました: ${secretDetail}`),
    ),
    /^\[WORKFLOW_DATABASE_FAILED\]/,
  );
  assert.match(
    getWorkflowAiAuditError(new Error(secretDetail)),
    /^\[WORKFLOW_AI_EXECUTION_FAILED\]/,
  );

  for (const error of [
    new Error(secretDetail),
    new Error(`AI実行結果の確定に失敗しました: ${secretDetail}`),
    Object.assign(new Error(secretDetail), { name: "AuthenticationError" }),
  ]) {
    const auditError = getWorkflowAiAuditError(error);
    assert.ok(auditError.length <= WORKFLOW_AI_MAX_AUDIT_ERROR_CHARS);
    assert.doesNotMatch(auditError, new RegExp(secretDetail));
  }
});

test("run-ai authenticates before reading a bounded request body", async () => {
  const route = await readFile(
    new URL(
      "../app/api/workflow-steps/[stepId]/run-ai/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(route, /isValidWorkflowIdentifier\(stepId\)/);
  assert.match(route, /readUtf8BodyWithLimit\([\s\S]*WORKFLOW_AI_REQUEST_MAX_BODY_BYTES/);
  assert.match(route, /validateWorkflowAiRequest\(body\)/);
  assert.ok(route.indexOf("supabase.auth.getUser()") < route.indexOf("readUtf8BodyWithLimit("));
  assert.ok(route.lastIndexOf("readUtf8BodyWithLimit") < route.indexOf("JSON.parse(parsedText.text)"));
});

test("run-ai does not expose internal exception details in HTTP responses", async () => {
  const route = await readFile(
    new URL(
      "../app/api/workflow-steps/[stepId]/run-ai/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  const catchBlock = route.split("} catch (error) {").at(-1) ?? "";
  assert.match(catchBlock, /実行履歴の分類を確認/);
  assert.doesNotMatch(catchBlock, /error: message/);
  assert.match(catchBlock, /error_message: auditError/);
  assert.doesNotMatch(catchBlock, /error_message: message/);
  assert.match(catchBlock, /classification: auditError/);
  assert.match(catchBlock, /code: historyError\.code \?\? "unknown"/);
  assert.doesNotMatch(catchBlock, /"Execution history update failed:",\s*historyError/);
  assert.doesNotMatch(catchBlock, /"Workflow AI execution failed:",\s*error/);
});

test("route keeps server-side workflow and human approval guards before persistence and AI execution", async () => {
  const route = await readFile(
    new URL(
      "../app/api/workflow-steps/[stepId]/run-ai/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  const workflowGuard = route.indexOf('workflow.status !== "IN_PROGRESS"');
  const currentStepGuard = route.indexOf(
    "step.step_order !== workflow.current_step_order",
  );
  const approvalGuard = route.indexOf(
    "step.requires_human_approval && !step.approved_at",
  );
  const historyCreate = route.indexOf('.from("execution_history")');
  const openAiCall = route.indexOf("new OpenAI(");

  assert.ok(workflowGuard >= 0);
  assert.ok(currentStepGuard >= 0);
  assert.ok(approvalGuard >= 0);
  assert.ok(workflowGuard < historyCreate);
  assert.ok(currentStepGuard < historyCreate);
  assert.ok(approvalGuard < historyCreate);
  assert.ok(approvalGuard < openAiCall);
  assert.match(route, /buildWorkflowAiPrompt/);
  assert.match(route, /parseWorkflowAiResult/);
});

test("route authenticates and bounds its request before accessing workflow data or OpenAI", async () => {
  const route = await readFile(
    new URL("../app/api/workflow-steps/[stepId]/run-ai/route.ts", import.meta.url),
    "utf8",
  );

  const authentication = route.indexOf("if (!user)");
  const bodyLimit = route.indexOf("readUtf8BodyWithLimit(");
  const workflowQuery = route.indexOf('.from("workflow_steps")');
  const openAiCall = route.indexOf("new OpenAI(");

  assert.ok(authentication >= 0);
  assert.ok(bodyLimit >= 0);
  assert.ok(workflowQuery >= 0);
  assert.ok(openAiCall >= 0);
  assert.ok(authentication < bodyLimit);
  assert.ok(bodyLimit < workflowQuery);
  assert.ok(bodyLimit < openAiCall);
  assert.match(route, /WORKFLOW_AI_REQUEST_MAX_BODY_BYTES/);
  assert.match(route, /isValidWorkflowIdentifier\(stepId\)/);
  assert.match(route, /validateWorkflowAiRequest/);
  assert.match(route, /getWorkflowAiAuditError/);
  assert.match(route, /AI社員の実行に失敗しました。実行履歴の分類を確認してください。/);
});

test("run-ai atomically claims a STEP execution and maps concurrency to conflict before OpenAI", async () => {
  const route = await readFile(
    new URL(
      "../app/api/workflow-steps/[stepId]/run-ai/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  const historyClaim = route.indexOf('rpc("start_workflow_ai_run"');
  const uniqueConflict = route.indexOf('historyCreateError.code === "23505"');
  const openAiCall = route.indexOf("new OpenAI(");

  assert.ok(historyClaim >= 0);
  assert.ok(uniqueConflict > historyClaim);
  assert.ok(uniqueConflict < openAiCall);
  assert.match(route.slice(uniqueConflict, openAiCall), /status: 409/);
  assert.match(route.slice(uniqueConflict, openAiCall), /すでにAI実行中/);
  assert.match(route, /isValidWorkflowIdentifier\(claimedExecutionId\)/);
});

test("run-ai bounds OpenAI cost, duration, retries, retention, and completion state", async () => {
  const route = await readFile(
    new URL(
      "../app/api/workflow-steps/[stepId]/run-ai/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.equal(WORKFLOW_AI_TIMEOUT_MS, 120_000);
  assert.equal(WORKFLOW_AI_MAX_OUTPUT_TOKENS, 6_000);
  assert.match(route, /timeout: WORKFLOW_AI_TIMEOUT_MS/);
  assert.match(route, /maxRetries: 0/);
  assert.match(route, /max_output_tokens: WORKFLOW_AI_MAX_OUTPUT_TOKENS/);
  assert.match(route, /store: false/);
  assert.match(route, /idempotencyKey: `workflow-ai:\$\{executionHistoryId\}`/);
  assert.match(route, /response\.status !== "completed"/);
  assert.ok(
    route.indexOf('response.status !== "completed"') <
      route.indexOf("parseWorkflowAiResult(outputText)"),
  );
});

test("run-ai atomically persists its STEP result, handoff, and successful execution", async () => {
  const route = await readFile(
    new URL(
      "../app/api/workflow-steps/[stepId]/run-ai/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  const parseResult = route.indexOf("parseWorkflowAiResult(outputText)");
  const finalizeResult = route.indexOf('"finalize_workflow_ai_run"');

  assert.ok(parseResult >= 0);
  assert.ok(finalizeResult > parseResult);
  assert.doesNotMatch(
    route.slice(parseResult, finalizeResult),
    /\.from\("workflow_steps"\)[\s\S]*\.update\(/,
  );
  assert.match(
    route.slice(finalizeResult),
    /p_execution_history_id:[\s\S]*p_work_note:[\s\S]*p_deliverable:[\s\S]*p_message_content:[\s\S]*p_total_tokens:/,
  );
});

test("run-ai cannot overwrite a committed SUCCESS while recording a later error", async () => {
  const route = await readFile(
    new URL(
      "../app/api/workflow-steps/[stepId]/run-ai/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  const catchBlock = route.split("} catch (error) {").at(-1) ?? "";
  assert.match(
    catchBlock,
    /\.from\("execution_history"\)[\s\S]*\.update\([\s\S]*status: "ERROR"[\s\S]*\.eq\("id", executionHistoryId\)[\s\S]*\.eq\("status", "RUNNING"\)/,
  );
});

test("database permits only one RUNNING execution per Workflow STEP", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260909111500_prevent_concurrent_workflow_ai_runs.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /group by workflow_step_id[\s\S]*having count\(\*\) > 1/i);
  assert.match(migration, /raise exception 'CONCURRENT_WORKFLOW_AI_RUNS_EXIST'/);
  assert.match(
    migration,
    /create unique index if not exists execution_history_one_running_per_step_idx[\s\S]*on public\.execution_history \(workflow_step_id\)[\s\S]*where workflow_step_id is not null[\s\S]*and status = 'RUNNING'/i,
  );
});

test("database atomically claims a Workflow AI run and recovers only stale executions", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260909150000_start_workflow_ai_run.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /create or replace function public\.start_workflow_ai_run/i);
  assert.match(migration, /language plpgsql[\s\S]*security invoker[\s\S]*set search_path = ''/i);
  assert.match(migration, /auth\.uid\(\)/i);
  assert.match(migration, /from public\.workflows[\s\S]*for update/i);
  assert.match(migration, /from public\.workflow_steps[\s\S]*for update/i);
  assert.match(migration, /WORKFLOW_STEP_STATE_CHANGED/);
  assert.match(migration, /HUMAN_APPROVAL_REQUIRED/);
  assert.match(
    migration,
    /from public\.execution_history[\s\S]*status = 'RUNNING'[\s\S]*for update/i,
  );
  assert.match(
    migration,
    /started_at > now\(\) - interval '5 minutes'[\s\S]*WORKFLOW_AI_ALREADY_RUNNING/i,
  );
  assert.match(
    migration,
    /update public\.execution_history[\s\S]*status = 'ERROR'[\s\S]*再実行可能な状態へ復旧/i,
  );
  assert.match(
    migration,
    /insert into public\.execution_history[\s\S]*'RUNNING'/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.start_workflow_ai_run\([\s\S]*from public, anon/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.start_workflow_ai_run\([\s\S]*to authenticated/i,
  );
});

test("database finalizes a Workflow AI run in one guarded transaction", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260909140000_finalize_workflow_ai_run.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /create or replace function public\.finalize_workflow_ai_run/i);
  assert.match(migration, /language plpgsql[\s\S]*security invoker[\s\S]*set search_path = ''/i);
  assert.match(migration, /auth\.uid\(\)/i);
  const workflowLock = migration.indexOf("from public.workflows");
  const stepLock = migration.indexOf("from public.workflow_steps");
  const executionLock = migration.indexOf("from public.execution_history");
  assert.ok(workflowLock >= 0);
  assert.ok(stepLock > workflowLock);
  assert.ok(executionLock > stepLock);
  assert.match(migration.slice(executionLock), /for update/i);
  assert.match(migration, /v_execution\.status <> 'RUNNING'/i);
  assert.match(migration, /EXECUTION_HISTORY_MISMATCH/);
  assert.match(migration, /WORKFLOW_STEP_STATE_CHANGED/);
  assert.match(migration, /insert into public\.workflow_messages/i);
  assert.match(
    migration,
    /update public\.execution_history[\s\S]*status = 'SUCCESS'[\s\S]*and status = 'RUNNING'/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.finalize_workflow_ai_run\([\s\S]*from public, anon/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.finalize_workflow_ai_run\([\s\S]*to authenticated/i,
  );
});
