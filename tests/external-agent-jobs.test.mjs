import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { HUMAN_APPROVAL_ACTIONS, isValidTransition, validateCreateInput, validateResultInput } from "../lib/external-agent-jobs.js";
import { CALLBACK_MAX_AGE_SECONDS, createCallbackSignature, verifyCallbackSignature } from "../lib/external-agent-callback.js";
import { dispatchConfig, dispatchPayload, parseDispatchResponse, safeTokenEquals, validateDispatchRequest } from "../lib/external-agent-dispatch.js";

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
test("idempotency race revalidates the request payload before returning the winning job", () => {
  const raceHandler = migration.split("exception when unique_violation then")[1]?.split("end $$;")[0] ?? "";
  assert.match(raceHandler, /select \* into v_existing from public\.external_agent_jobs where idempotency_key = p_idempotency_key/);
  assert.match(raceHandler, /is distinct from \(p_task_id, p_ai_employee_id, p_provider, p_capability, p_repository, p_base_branch\)/);
  assert.match(raceHandler, /idempotency key conflicts with another request/);
});
test("job creation is authenticated and fails closed without an exact allowlist entry", () => {
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /if v_user_id is null then raise exception 'AUTHENTICATION_REQUIRED'/);
  assert.match(migration, /create table public\.external_agent_job_authorizations/);
  assert.match(migration, /authz\.user_id = v_user_id/);
  assert.match(migration, /authz\.project_id = v_task\.project_id/);
  assert.match(migration, /authz\.repository = p_repository/);
  assert.match(migration, /authz\.enabled = true/);
  assert.match(migration, /EXTERNAL_AGENT_JOB_FORBIDDEN/);
});
test("authorization runs before idempotency lookup so known keys cannot bypass access control", () => {
  assert.ok(migration.indexOf("EXTERNAL_AGENT_JOB_FORBIDDEN") < migration.indexOf("select * into v_existing from public.external_agent_jobs where idempotency_key = p_idempotency_key"));
});
test("browser roles cannot administer the external-agent allowlist", () => {
  assert.match(migration, /revoke all on table public\.external_agent_job_authorizations from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.external_agent_job_authorizations to service_role/);
});
test("browser roles cannot mutate jobs and result RPC is service-only", () => {
  assert.match(migration, /revoke all on table public\.external_agent_jobs from anon, authenticated/);
  assert.match(migration, /update_external_agent_job_result[\s\S]+from public, anon, authenticated/);
});
test("route maps expected job-creation errors without returning raw database details", async () => {
  const route = await readFile(new URL("../app/api/external-agent-jobs/route.ts", import.meta.url), "utf8");
  assert.match(route, /EXTERNAL_AGENT_JOB_FORBIDDEN/) && assert.match(route, /: 403/);
  assert.match(route, /AUTHENTICATION_REQUIRED/) && assert.match(route, /: 401/);
  assert.match(route, /EXTERNAL_AGENT_JOB_IDEMPOTENCY_CONFLICT/);
  assert.match(route, /EXTERNAL_AGENT_JOB_DUPLICATE_ACTIVE/);
  assert.match(route, /EXTERNAL_AGENT_JOB_CREATE_FAILED/);
  assert.doesNotMatch(route, /error: error\.message/);
});
test("phase 1 contains no dispatch, merge, deploy, or external HTTP implementation", () => {
  assert.doesNotMatch(migration, /http_post|net\.http|github push|openai api/i);
});

test("signed callback is accepted only with its intact body, timestamp, and nonce", () => {
  const secret = "test-callback-secret";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "a".repeat(32);
  const body = JSON.stringify({ jobId: "job", status: "SUCCEEDED" });
  const signature = createCallbackSignature({ secret, timestamp, nonce, body });
  assert.equal(verifyCallbackSignature({ secret, timestamp, nonce, body, signature }), true);
  assert.equal(verifyCallbackSignature({ secret, timestamp, nonce, body: `${body} `, signature }), false);
});

test("signed callback rejects expired timestamps and short nonces", () => {
  const secret = "test-callback-secret";
  const now = Date.now();
  const timestamp = String(Math.floor((now - (CALLBACK_MAX_AGE_SECONDS + 1) * 1000) / 1000));
  const nonce = "b".repeat(32);
  const body = "{}";
  const signature = createCallbackSignature({ secret, timestamp, nonce, body });
  assert.equal(verifyCallbackSignature({ secret, timestamp, nonce, body, signature, now }), false);
  assert.equal(verifyCallbackSignature({ secret, timestamp: String(Math.floor(now / 1000)), nonce: "short", body, signature, now }), false);
});

test("callback route requires signed requests and records nonce before accepting results", async () => {
  const callbackRoute = await readFile(new URL("../app/api/internal/external-agent-jobs/callback/route.ts", import.meta.url), "utf8");
  assert.match(callbackRoute, /verifyCallbackSignature/);
  assert.match(callbackRoute, /external_agent_callback_nonces/);
  assert.match(callbackRoute, /CALLBACK_REPLAY_DETECTED/);
  assert.doesNotMatch(callbackRoute, /error: error\.message/);
});

test("dispatch is disabled until every operator-provided gateway setting is present", () => {
  assert.equal(dispatchConfig({}).error, "EXTERNAL_AGENT_DISPATCH_DISABLED");
  assert.equal(dispatchConfig({ EXTERNAL_AGENT_DISPATCH_ENABLED: "true" }).error, "EXTERNAL_AGENT_DISPATCH_NOT_CONFIGURED");
  const config = dispatchConfig({
    EXTERNAL_AGENT_DISPATCH_ENABLED: "true",
    EXTERNAL_AGENT_DISPATCH_URL: "https://gateway.example.test/jobs",
    EXTERNAL_AGENT_CALLBACK_URL: "https://work.example.test/api/internal/external-agent-jobs/callback",
    EXTERNAL_AGENT_DISPATCH_ALLOWED_HOSTS: "gateway.example.test",
    EXTERNAL_AGENT_GATEWAY_TOKEN: "a".repeat(32),
  });
  assert.equal(config.ok, true);
  assert.equal(dispatchConfig({ ...config, EXTERNAL_AGENT_DISPATCH_ENABLED: "true", EXTERNAL_AGENT_DISPATCH_URL: "http://gateway.example.test" }).error, "EXTERNAL_AGENT_DISPATCH_NOT_CONFIGURED");
});

test("dispatch request and gateway response contracts are strictly minimal", () => {
  assert.equal(validateDispatchRequest({ jobId: "not-a-uuid" }), "INVALID_DISPATCH_REQUEST");
  assert.equal(validateDispatchRequest({ jobId: "b2916606-3298-4457-a3ee-6e52340e925b" }), null);
  assert.equal(parseDispatchResponse({ externalJobId: "remote-123" }).externalJobId, "remote-123");
  assert.equal(parseDispatchResponse({}), null);
  assert.deepEqual(dispatchPayload({ id: "job", task_id: "task", ai_employee_id: "employee", provider: "openai_codex", capability: "software_development", repository: "madeo2222-coder/starworkos", base_branch: "main", requested_action: "software_development" }, "https://work.example.test/callback"), {
    job: { id: "job", taskId: "task", aiEmployeeId: "employee", provider: "openai_codex", capability: "software_development", repository: "madeo2222-coder/starworkos", baseBranch: "main", requestedAction: "software_development" },
    callbackUrl: "https://work.example.test/callback",
  });
});

test("internal dispatch authentication uses a constant-time equality check", () => {
  assert.equal(safeTokenEquals("a".repeat(32), "a".repeat(32)), true);
  assert.equal(safeTokenEquals("a".repeat(32), "b".repeat(32)), false);
  assert.equal(safeTokenEquals("a".repeat(32), "a".repeat(31)), false);
});

test("dispatch route is fail-closed, idempotent at the gateway, and never returns raw errors", async () => {
  const route = await readFile(new URL("../app/api/internal/external-agent-jobs/dispatch/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(!config\.ok \|\| !config\.url/);
  assert.match(route, /DISPATCH_AUTHENTICATION_REQUIRED/);
  assert.match(route, /EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN/);
  assert.match(route, /config\.gatewayToken/);
  assert.match(route, /idempotency-key/);
  assert.match(route, /external-agent-job:\$\{job\.id\}/);
  assert.match(route, /p_status: "RUNNING"/);
  assert.doesNotMatch(route, /error: .*\.message/);
});
