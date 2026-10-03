import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENTS_API_RESULT_PATH,
  buildAgentsApiInstructions,
  buildAgentsApiSessionRequest,
  parseAgentsSessionExternalJobId,
  validateAgentsApiPayload,
  validateAgentsResult,
} from "../lib/agents-api-codex.js";

const payload = {
  job: { id: "11111111-1111-4111-8111-111111111111", provider: "openai_codex", capability: "software_development", repository: "madeo2222-coder/starworkos", baseBranch: "main" },
  task: { title: "Safe change", content: "Update docs only." },
};

test("validates only bounded software-development jobs", () => {
  assert.equal(validateAgentsApiPayload(payload), null);
  assert.equal(validateAgentsApiPayload({ ...payload, job: { ...payload.job, provider: "other" } }), "UNSUPPORTED_AGENTS_API_JOB");
  assert.equal(validateAgentsApiPayload({ ...payload, job: { ...payload.job, repository: "https://github.com/x/y" } }), "INVALID_AGENTS_API_REPOSITORY");
});

test("session request uses a hosted sandbox and never gives the sandbox GitHub credentials", () => {
  const request = buildAgentsApiSessionRequest(payload, "ZmFrZS1hcmNoaXZl");
  assert.equal(request.environment.type, "openai_hosted");
  assert.equal(request.environment.files[0].path, "/workspace/repository.tar.gz");
  assert.equal(JSON.stringify(request).includes("GITHUB_TOKEN"), false);
  assert.match(request.agent.instructions, /Never push to GitHub yourself/);
  assert.equal(request.agent.instructions.includes(AGENTS_API_RESULT_PATH), true);
});

test("parses only explicit Agents API session external ids", () => {
  assert.equal(parseAgentsSessionExternalJobId("agents-session:sess_abc123"), "sess_abc123");
  assert.equal(parseAgentsSessionExternalJobId("github-issue:34"), null);
});

test("validates a bounded result artifact and rejects traversal or generated directories", () => {
  const valid = validateAgentsResult({ summary: "done", tests: ["npm test"], warnings: [], files: [{ path: "docs/result.md", operation: "upsert", content: "ok" }] });
  assert.equal(valid.files[0].path, "docs/result.md");
  assert.equal(validateAgentsResult({ summary: "", tests: [], warnings: [], files: [{ path: "../secret", operation: "upsert", content: "x" }] }), null);
  assert.equal(validateAgentsResult({ summary: "", tests: [], warnings: [], files: [{ path: "node_modules/x", operation: "upsert", content: "x" }] }), null);
});
