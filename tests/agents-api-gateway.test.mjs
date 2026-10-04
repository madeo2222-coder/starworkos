import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Agents API gateway is authenticated and keeps credentials outside the sandbox", async () => {
  const route = await readFile(new URL("../app/api/internal/agents-api-gateway/route.ts", import.meta.url), "utf8");
  assert.match(route, /EXTERNAL_AGENT_GATEWAY_TOKEN/);
  assert.match(route, /CODEX_GITHUB_TOKEN/);
  assert.match(route, /OPENAI_AGENTS_URL/);
  assert.match(route, /openai-beta/);
  assert.match(route, /agents=v1/);
  assert.match(route, /idempotency-key/);
  assert.match(route, /AGENTS_API_MAX_ARCHIVE_BYTES/);
  assert.match(route, /redirect: "follow"/);
  assert.doesNotMatch(route, /process\.env\.OPENAI_API_KEY.*sessionRequest/);
  assert.doesNotMatch(route, /GITHUB_TOKEN.*buildAgentsApiSessionRequest/);
});

test("Agents API gateway returns only a bounded external session identifier", async () => {
  const route = await readFile(new URL("../app/api/internal/agents-api-gateway/route.ts", import.meta.url), "utf8");
  assert.match(route, /agents-session:/);
  assert.match(route, /\^sess_/);
  assert.match(route, /status: 202/);
  assert.doesNotMatch(route, /merge_pull_request|production_deploy|apply_migration/i);
});
