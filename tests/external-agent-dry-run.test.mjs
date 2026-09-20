import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDispatchDryRun } from "../lib/external-agent-dry-run.js";

const queuedJob = {
  id: "11111111-1111-4111-8111-111111111111",
  task_id: "22222222-2222-4222-8222-222222222222",
  ai_employee_id: "33333333-3333-4333-8333-333333333333",
  provider: "openai_codex",
  capability: "software_development",
  repository: "madeo2222-coder/starworkos",
  base_branch: "main",
  requested_action: "implement",
  status: "QUEUED",
};

test("dry-run succeeds while dispatch remains disabled", () => {
  const result = evaluateDispatchDryRun(
    { configured: true, enabled: false, state: "READY_TO_ENABLE", issues: [] },
    queuedJob,
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.wouldDispatch, false);
  assert.equal(result.readiness.state, "READY_TO_ENABLE");
  assert.equal(result.job.provider, "openai_codex");
});

test("dry-run reports that enabled dispatch would send the queued job", () => {
  const result = evaluateDispatchDryRun(
    { configured: true, enabled: true, state: "ENABLED", issues: [] },
    queuedJob,
  );

  assert.equal(result.ok, true);
  assert.equal(result.wouldDispatch, true);
});

test("dry-run fails closed when configuration is incomplete", () => {
  assert.deepEqual(
    evaluateDispatchDryRun(
      { configured: false, enabled: false, state: "NOT_READY", issues: ["GATEWAY_TOKEN_MISSING_OR_WEAK"] },
      queuedJob,
    ),
    { ok: false, status: 503, error: "EXTERNAL_AGENT_DISPATCH_NOT_CONFIGURED" },
  );
});

test("dry-run rejects missing and non-queued jobs", () => {
  assert.deepEqual(
    evaluateDispatchDryRun({ configured: true, enabled: false, state: "READY_TO_ENABLE" }, null),
    { ok: false, status: 404, error: "EXTERNAL_AGENT_JOB_NOT_FOUND" },
  );

  assert.deepEqual(
    evaluateDispatchDryRun(
      { configured: true, enabled: false, state: "READY_TO_ENABLE" },
      { ...queuedJob, status: "RUNNING" },
    ),
    { ok: false, status: 409, error: "EXTERNAL_AGENT_JOB_NOT_QUEUED" },
  );
});
