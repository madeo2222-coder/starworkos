import test from "node:test";
import assert from "node:assert/strict";
import {
  CODEX_GATEWAY_MAX_BODY_BYTES,
  buildCodexDelegationComment,
  buildCodexIssue,
  codexIssueMarker,
  findExistingCodexIssue,
  hasCodexDelegationComment,
  parseRepository,
  validateCodexGatewayPayload,
} from "../lib/codex-cloud-github.js";

const payload = {
  job: {
    id: "11111111-1111-4111-8111-111111111111",
    provider: "openai_codex",
    capability: "software_development",
    repository: "madeo2222-coder/starworkos",
    baseBranch: "main",
  },
  task: {
    title: "Implement safe delegation",
    content: "Create the integration without production changes.",
    priority: "高",
    dueDate: "2026-09-30",
  },
  executionPolicy: {
    protectedActionsRequireHumanApproval: ["main_merge", "production_deploy"],
  },
};

test("Codex gateway accepts only a valid OpenAI Codex job contract", () => {
  assert.equal(validateCodexGatewayPayload(payload), null);
  assert.equal(validateCodexGatewayPayload({ ...payload, job: { ...payload.job, provider: "anthropic_claude_code" } }), "UNSUPPORTED_CODEX_GATEWAY_JOB");
  assert.equal(validateCodexGatewayPayload({ ...payload, task: { ...payload.task, title: "" } }), "INVALID_CODEX_GATEWAY_TASK");
  assert.deepEqual(parseRepository("madeo2222-coder/starworkos"), { owner: "madeo2222-coder", repo: "starworkos" });
  assert.equal(parseRepository("https://github.com/madeo2222-coder/starworkos"), null);
});

test("Codex issue contains a deterministic idempotency marker and safety constraints", () => {
  const issue = buildCodexIssue(payload);
  assert.equal(issue.body.includes(codexIssueMarker(payload.job.id)), true);
  assert.match(issue.body, /non-production branch/);
  assert.match(issue.body, /human approval/);
  assert.match(issue.body, /Do not merge or deploy to production/);
  assert.match(issue.body, /Implement safe delegation/);
});

test("Codex delegation comment names the repository and preserves protected-action boundaries", () => {
  const comment = buildCodexDelegationComment("madeo2222-coder/starworkos");
  assert.match(comment, /^@codex /i);
  assert.match(comment, /madeo2222-coder\/starworkos/);
  assert.match(comment, /Do not merge/);
  assert.match(comment, /human approval/);
});

test("gateway retry helpers reuse the marked issue and avoid duplicate Codex comments", () => {
  const marker = codexIssueMarker(payload.job.id);
  const issues = [
    { number: 4, body: "other" },
    { number: 5, body: marker + "\njob" },
    { number: 6, body: marker, pull_request: {} },
  ];
  assert.equal(findExistingCodexIssue(issues, marker)?.number, 5);
  assert.equal(hasCodexDelegationComment([{ body: "@codex do it" }]), true);
  assert.equal(hasCodexDelegationComment([{ body: "not delegated" }]), false);
  assert.equal(CODEX_GATEWAY_MAX_BODY_BYTES, 32 * 1024);
});
