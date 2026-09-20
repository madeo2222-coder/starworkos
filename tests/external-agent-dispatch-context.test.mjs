import test from "node:test";
import assert from "node:assert/strict";
import { DISPATCH_PROTECTED_ACTIONS, DISPATCH_TASK_LIMITS, dispatchPayload } from "../lib/external-agent-dispatch.js";

const job = {
  id: "job",
  task_id: "task",
  ai_employee_id: "employee",
  provider: "openai_codex",
  capability: "software_development",
  repository: "madeo2222-coder/starworkos",
  base_branch: "main",
  requested_action: "software_development",
};

test("dispatch payload includes bounded task context and human-approval guardrails", () => {
  const task = {
    title: "Implement controlled Codex dispatch",
    content: "x".repeat(DISPATCH_TASK_LIMITS.content + 100),
    priority: "最優先",
    due_date: "2026-09-30",
  };
  const payload = dispatchPayload(job, task, "https://work.example.test/callback");

  assert.equal(payload.task.title, task.title);
  assert.equal(payload.task.content.length, DISPATCH_TASK_LIMITS.content);
  assert.equal(payload.task.priority, "最優先");
  assert.equal(payload.task.dueDate, "2026-09-30");
  assert.deepEqual(payload.executionPolicy.protectedActionsRequireHumanApproval, DISPATCH_PROTECTED_ACTIONS);
  assert.equal(payload.executionPolicy.mustUseNonProductionBranch, true);
  assert.equal(payload.executionPolicy.mustStopBeforeProtectedAction, true);
});

test("dispatch payload tolerates nullable task fields without leaking undefined values", () => {
  const payload = dispatchPayload(job, { title: "Task", content: null, priority: null, due_date: null }, "https://work.example.test/callback");
  assert.deepEqual(payload.task, {
    title: "Task",
    content: null,
    priority: null,
    dueDate: null,
  });
});
