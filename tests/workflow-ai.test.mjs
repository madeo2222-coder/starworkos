import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildWorkflowAiPrompt,
  isRequirementsStep,
  parseWorkflowAiResult,
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
  const bodyLimit = route.indexOf("const parsedBody = await readJsonBodyWithLimit");
  const workflowQuery = route.indexOf('.from("workflow_steps")');
  const openAiCall = route.indexOf("new OpenAI(");

  assert.ok(authentication >= 0);
  assert.ok(bodyLimit >= 0);
  assert.ok(workflowQuery >= 0);
  assert.ok(openAiCall >= 0);
  assert.ok(authentication < bodyLimit);
  assert.ok(bodyLimit < workflowQuery);
  assert.ok(bodyLimit < openAiCall);
  assert.match(route, /RUN_AI_MAX_BODY_BYTES = 4 \* 1024/);
  assert.match(route, /UUID_PATTERN\.test\(stepId\)/);
  assert.match(route, /isRunAiRequestBody/);
  assert.match(route, /const message = "AI社員の実行中に問題が発生しました。"/);
});
