import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AGENTS_API_RESULT_PATH,
  selectAgentsResultArtifact,
  selectCompletedRootTurn,
} from "../lib/agents-api-codex.js";

test("selects only a completed root turn", () => {
  const turn = selectCompletedRootTurn([
    { id: "sub", status: "completed", subagent_id: "agent_2" },
    { id: "running", status: "in_progress", subagent_id: null },
    { id: "done", status: "completed", subagent_id: null },
  ]);
  assert.equal(turn.id, "done");
});

test("selects exactly one bounded result artifact for the completed turn", () => {
  const artifact = selectAgentsResultArtifact([
    { id: "other", turn_id: "turn_1", path: "/workspace/outputs/other.json", size_bytes: 10 },
    { id: "result", turn_id: "turn_1", path: AGENTS_API_RESULT_PATH, size_bytes: 100 },
  ], "turn_1");
  assert.equal(artifact.id, "result");
  assert.equal(selectAgentsResultArtifact([
    { id: "a", turn_id: "turn_1", path: AGENTS_API_RESULT_PATH, size_bytes: 100 },
    { id: "b", turn_id: "turn_1", path: AGENTS_API_RESULT_PATH, size_bytes: 100 },
  ], "turn_1"), null);
});

test("reconciler publishes only validated artifacts and stops at human approval", async () => {
  const route = await readFile(new URL("../app/api/internal/agents-api-reconcile/route.ts", import.meta.url), "utf8");
  assert.match(route, /validateAgentsResult/);
  assert.match(route, /selectCompletedRootTurn/);
  assert.match(route, /selectAgentsResultArtifact/);
  assert.match(route, /publishAgentsResultToGithub/);
  assert.match(route, /p_status: "WAITING_HUMAN_APPROVAL"/);
  assert.match(route, /AGENTS_SESSION_REQUIRES_ACTION/);
  assert.doesNotMatch(route, /merge_pull_request|production_deploy|apply_migration/i);
});

test("server-side publisher creates a non-production PR and never merges it", async () => {
  const publisher = await readFile(new URL("../lib/agents-api-github-publisher.ts", import.meta.url), "utf8");
  assert.match(publisher, /agents: apply job/);
  assert.match(publisher, /refs\/heads/);
  assert.match(publisher, /"\/pulls"/);
  assert.match(publisher, /AGENTS_EXISTING_BRANCH_IDENTITY_MISMATCH/);
  assert.doesNotMatch(publisher, /\/merges|merge_pull_request|force:\s*true/i);
});
