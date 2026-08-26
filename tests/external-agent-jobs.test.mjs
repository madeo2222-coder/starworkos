import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { HUMAN_APPROVAL_ACTIONS, isValidTransition, validateCreateInput, validateResultInput } from "../lib/external-agent-jobs.js";

const valid = { taskId: "task", aiEmployeeId: "employee", provider: "openai_codex", capability: "software_development", repository: "madeo2222-coder/starworkos", baseBranch: "main" };
const migration = await readFile(new URL("../supabase/migrations/20260826_external_agent_job_foundation.sql", import.meta.url), "utf8");

test("accepts a valid creation contract without dispatching externally", () => assert.equal(validateCreateInput(valid), null));
test("rejects invalid repository", () => assert.match(validateCreateInput({ ...valid, repository: "https://github.com/x/y" }), /Repository/));
test("rejects unsupported provider", () => assert.match(validateCreateInput({ ...valid, provider: "unknown" }), /provider/));
test("rejects unsupported capability", () => assert.match(validateCreateInput({ ...valid, capability: "deploy" }), /capability/));

test("allows the minimum state transitions", () => {
  assert.equal(isValidTransition("QUEUED", "RUNNING"), true);
  assert.equal(isValidTransition("RUNNING", "SUCCEEDED"), true);
  assert.equal(isValidTransition("RUNNING", "FAILED"), true);
  assert.equal(isValidTransition("RUNNING", "WAITING_HUMAN_APPROVAL"), true);
});
test("rejects invalid and terminal transitions", () => {
  assert.equal(isValidTransition("FAILED", "RUNNING"), false);
  assert.equal(isValidTransition("SUCCEEDED", "RUNNING"), false);
  assert.equal(isValidTransition("QUEUED", "SUCCEEDED"), false);
});
test("accepts PR data and full commit SHA", () => assert.equal(validateResultInput({ jobId: "job", status: "SUCCEEDED", commitSha: "a".repeat(40), pullRequestUrl: "https://github.com/o/r/pull/12" }), null));
test("accepts error data", () => assert.equal(validateResultInput({ jobId: "job", status: "FAILED", errorCode: "TEST_FAILED", errorSummary: "tests failed" }), null));
test("all production-impacting operations require approval", () => assert.deepEqual(HUMAN_APPROVAL_ACTIONS, ["main_merge", "production_deploy", "production_database_migration", "secret_or_environment_change", "destructive_operation"]));
test("database contract validates missing Task and AI Employee", () => {
  assert.match(migration, /Task not found/);
  assert.match(migration, /AI Employee not found/);
});
test("database contract handles idempotency atomically", () => {
  assert.match(migration, /idempotency_key text not null unique/);
  assert.match(migration, /idempotency key conflicts with another request/);
  assert.match(migration, /when unique_violation/);
});
test("browser roles cannot mutate jobs and result RPC is service-only", () => {
  assert.match(migration, /revoke all on table public\.external_agent_jobs from anon, authenticated/);
  assert.match(migration, /update_external_agent_job_result[\s\S]+from public, anon, authenticated/);
});
test("phase 1 contains no dispatch, merge, deploy, or external HTTP implementation", () => {
  assert.doesNotMatch(migration, /http_post|net\.http|github push|openai api/i);
});
