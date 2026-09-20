import test from "node:test";
import assert from "node:assert/strict";
import {
  CODEX_CONNECTOR_BOT_LOGIN,
  CODEX_RESULT_SUMMARY_MAX_CHARS,
  extractRepositoryPullRequest,
  findFinalCodexComment,
  parseGithubIssueExternalJobId,
  summarizeCodexResult,
  validateReconcileRequest,
} from "../lib/codex-cloud-reconciliation.js";

test("parses only bounded GitHub issue external job identifiers", () => {
  assert.equal(parseGithubIssueExternalJobId("github-issue:21"), 21);
  assert.equal(parseGithubIssueExternalJobId("github-issue:0"), null);
  assert.equal(parseGithubIssueExternalJobId("codex:21"), null);
});

test("accepts only UUID reconciliation requests", () => {
  assert.equal(validateReconcileRequest({ jobId: "11111111-1111-4111-8111-111111111111" }), null);
  assert.equal(validateReconcileRequest({ jobId: "nope" }), "INVALID_RECONCILE_JOB_ID");
});

test("trusts only a final Codex connector comment", () => {
  const finalBody = "Done.\n\n[View task →](https://chatgpt.com/s/cd_example)";
  const comments = [
    { user: { login: "attacker" }, body: finalBody },
    { user: { login: CODEX_CONNECTOR_BOT_LOGIN }, body: "Working on it" },
    { user: { login: CODEX_CONNECTOR_BOT_LOGIN }, body: finalBody },
  ];
  assert.equal(findFinalCodexComment(comments)?.body, finalBody);
});

test("extracts a PR only from the authorized repository", () => {
  const body = "Ready: https://github.com/madeo2222-coder/starworkos/pull/42";
  assert.deepEqual(extractRepositoryPullRequest(body, "madeo2222-coder/starworkos"), {
    number: 42,
    url: "https://github.com/madeo2222-coder/starworkos/pull/42",
  });
  assert.equal(extractRepositoryPullRequest(body, "other/repo"), null);
});

test("bounds the stored Codex result summary and removes the task link", () => {
  const body = "Result ".repeat(1000) + "\n[View task →](https://chatgpt.com/s/cd_example)";
  const summary = summarizeCodexResult(body);
  assert.ok(summary.length <= CODEX_RESULT_SUMMARY_MAX_CHARS);
  assert.equal(summary.includes("View task"), false);
});

test("reconciliation route stops at human approval instead of merging or deploying", async () => {
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(new URL("../app/api/internal/codex-cloud-reconcile/route.ts", import.meta.url), "utf8");
  assert.match(route, /p_status: "WAITING_HUMAN_APPROVAL"/);
  assert.doesNotMatch(route, /merge_pull_request|\/merges(?:["`?\/])|apply_migration|supabase\.rpc\(["'].*migration/i);
  assert.match(route, /codexIssueContractDigest/);
  assert.match(route, /codex_gateway_dispatches/);
  assert.match(route, /dispatchRecord\.delegated_at === null/);
  assert.match(route, /RECONCILE_PULL_REQUEST_IDENTITY_MISMATCH/);
  assert.match(route, /pr\?\.head\?\.repo\?\.full_name/);
  assert.match(route, /pr\?\.state !== "open"/);
  assert.match(route, /EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN/);
});
