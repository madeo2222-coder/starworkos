import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getWorkflowCreationRpcErrorMessage,
  getWorkflowCreationValidationError,
  isValidUuid,
  WORKFLOW_CREATION_LIMITS,
} from "../lib/workflow-creation.js";

const validInput = {
  title: "安全なWorkflow",
  description: "説明",
  ceoInstruction: "依頼内容",
  priority: "高",
  projectId: "11111111-1111-4111-8111-111111111111",
};

test("Workflow creation validates IDs, lengths, and enum values before RPC", () => {
  assert.equal(getWorkflowCreationValidationError(validInput), null);
  assert.equal(isValidUuid(validInput.projectId), true);
  assert.equal(
    isValidUuid("019cdef0-1234-7000-8000-123456789abc"),
    true,
  );
  assert.equal(isValidUuid("project"), false);

  assert.match(
    getWorkflowCreationValidationError({ ...validInput, projectId: "project" }),
    /プロジェクト/,
  );
  assert.match(
    getWorkflowCreationValidationError({ ...validInput, priority: "緊急" }),
    /優先度/,
  );
  assert.match(
    getWorkflowCreationValidationError({
      ...validInput,
      title: "a".repeat(WORKFLOW_CREATION_LIMITS.title + 1),
    }),
    /200文字以内/,
  );
  assert.match(
    getWorkflowCreationValidationError({
      ...validInput,
      description: "a".repeat(WORKFLOW_CREATION_LIMITS.description + 1),
    }),
    /20000文字以内/,
  );
  assert.match(
    getWorkflowCreationValidationError({
      ...validInput,
      ceoInstruction: "a".repeat(
        WORKFLOW_CREATION_LIMITS.ceoInstruction + 1,
      ),
    }),
    /32000文字以内/,
  );
});

test("Workflow creation maps RPC failures without exposing raw database errors", () => {
  assert.equal(
    getWorkflowCreationRpcErrorMessage("TASK_WORKFLOW_ALREADY_EXISTS"),
    "このTaskにはすでに関連Workflowが存在します。",
  );

  const rawError = "password=secret connection refused internal-host";
  const userMessage = getWorkflowCreationRpcErrorMessage(rawError);

  assert.doesNotMatch(userMessage, /secret|internal-host|connection refused/);
  assert.match(userMessage, /もう一度お試しください/);
});

test("Workflow creation pages do not interpolate raw Supabase errors", async () => {
  const [newWorkflowPage, taskPage] = await Promise.all([
    readFile(new URL("../app/workflows/new/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/tasks/[id]/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(
    newWorkflowPage,
    /Workflowの作成に失敗しました:\s*\$\{errorMessage\}/,
  );
  assert.doesNotMatch(
    taskPage,
    /Workflowの作成に失敗しました:\s*\$\{workflowCreateError\.message\}/,
  );
  assert.match(newWorkflowPage, /maxLength=\{WORKFLOW_CREATION_LIMITS\.title\}/);
  assert.match(taskPage, /getWorkflowCreationValidationError/);
});
