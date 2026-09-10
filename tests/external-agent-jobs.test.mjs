import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { HUMAN_APPROVAL_ACTIONS, JOB_CREATE_MAX_BODY_BYTES, RESULT_FIELD_LIMITS, isValidTransition, validateCreateInput, validateResultInput } from "../lib/external-agent-jobs.js";
import { CALLBACK_MAX_AGE_SECONDS, CALLBACK_MAX_BODY_BYTES, CALLBACK_MIN_SECRET_LENGTH, createCallbackSignature, mapCallbackDatabaseError, verifyCallbackSignature } from "../lib/external-agent-callback.js";
import { DISPATCH_MAX_BODY_BYTES, DISPATCH_RESPONSE_MAX_BODY_BYTES, dispatchConfig, dispatchPayload, hasMinimumTokenLength, parseDispatchResponse, readBoundedJsonResponse, safeTokenEquals, validateDispatchRequest } from "../lib/external-agent-dispatch.js";
import { readJsonBodyWithLimit, readUtf8BodyWithLimit } from "../lib/request-body.js";

const valid = { taskId: "b2916606-3298-4457-a3ee-6e52340e925b", aiEmployeeId: "9953e15e-503d-4c63-b1f2-232ef1ca6a23", provider: "openai_codex", capability: "software_development", repository: "madeo2222-coder/starworkos", baseBranch: "main" };
const validJobId = "f85da2f1-52b1-421a-a075-754cdac6b247";
const migration = await readFile(new URL("../supabase/migrations/20260826_external_agent_job_foundation.sql", import.meta.url), "utf8");
const callbackAtomicityMigration = await readFile(new URL("../supabase/migrations/20260909170000_external_agent_callback_atomicity.sql", import.meta.url), "utf8");
const resultIdentityMigration = await readFile(new URL("../supabase/migrations/20260909090000_pin_external_agent_result_identity.sql", import.meta.url), "utf8");

test("accepts a valid creation contract without dispatching externally", () => assert.equal(validateCreateInput(valid), null));
test("rejects invalid repository", () => assert.match(validateCreateInput({ ...valid, repository: "https://github.com/x/y" }), /Repository/));
test("rejects unsupported provider", () => assert.match(validateCreateInput({ ...valid, provider: "unknown" }), /provider/));
test("rejects unsupported capability", () => assert.match(validateCreateInput({ ...valid, capability: "deploy" }), /capability/));
test("rejects malformed IDs and overlong repository inputs before database work", () => {
  assert.match(validateCreateInput({ ...valid, taskId: "task" }), /taskId/);
  assert.match(validateCreateInput({ ...valid, aiEmployeeId: "employee" }), /aiEmployeeId/);
  assert.match(validateCreateInput({ ...valid, repository: `owner/${"r".repeat(200)}` }), /Repository/);
  assert.match(validateCreateInput({ ...valid, baseBranch: "b".repeat(256) }), /branch/);
});
test("rejects unsafe Git branch forms before database work", () => {
  for (const baseBranch of ["-main", "/main", "main/", "main.", ".hidden", "feature/.hidden", "feature/main.lock", "feature//main", "feature/../main"]) {
    assert.match(validateCreateInput({ ...valid, baseBranch }), /branch/, baseBranch);
  }
});

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
test("accepts bounded PR data, timestamps, and full commit SHA", () => assert.equal(validateResultInput({
  jobId: validJobId,
  status: "SUCCEEDED",
  externalJobId: "remote-123",
  branchName: "codex/job-123",
  commitSha: "a".repeat(40),
  pullRequestNumber: 12,
  pullRequestUrl: "https://github.com/o/r/pull/12",
  resultSummary: "tests passed",
  startedAt: "2026-09-09T06:00:00Z",
  completedAt: "2026-09-09T06:01:00.123Z",
}), null));
test("accepts bounded error data", () => assert.equal(validateResultInput({ jobId: validJobId, status: "FAILED", errorCode: "TEST_FAILED", errorSummary: "tests failed" }), null));
test("rejects malformed or oversized callback result fields before database work", () => {
  assert.match(validateResultInput({ jobId: "job", status: "FAILED" }), /jobId/);
  assert.match(validateResultInput({ jobId: validJobId, status: "FAILED", externalJobId: "x".repeat(RESULT_FIELD_LIMITS.externalJobId + 1) }), /externalJobId/);
  assert.match(validateResultInput({ jobId: validJobId, status: "FAILED", branchName: "../main" }), /branchName/);
  assert.match(validateResultInput({ jobId: validJobId, status: "FAILED", branchName: "feature/main.lock" }), /branchName/);
  assert.match(validateResultInput({ jobId: validJobId, status: "FAILED", pullRequestNumber: 1.5 }), /pullRequestNumber/);
  assert.match(validateResultInput({ jobId: validJobId, status: "FAILED", errorCode: "bad-code" }), /errorCode/);
  assert.match(validateResultInput({ jobId: validJobId, status: "FAILED", resultSummary: "x".repeat(RESULT_FIELD_LIMITS.resultSummary + 1) }), /resultSummary/);
  assert.match(validateResultInput({ jobId: validJobId, status: "FAILED", startedAt: "yesterday" }), /timestamp/);
});
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
test("database hardening mirrors public API bounds and keeps approval policy immutable", async () => {
  const hardeningMigration = await readFile(new URL("../supabase/migrations/20260909072943_harden_external_agent_job_contract.sql", import.meta.url), "utf8");
  assert.match(hardeningMigration, /external_agent_jobs_base_branch_format_check/);
  assert.match(hardeningMigration, /external_agent_jobs_idempotency_key_length_check/);
  assert.match(hardeningMigration, /external_agent_jobs_result_summary_length_check/);
  assert.match(hardeningMigration, /external_agent_jobs_error_summary_length_check/);
  assert.match(hardeningMigration, /new\.approval_requirement/);
  assert.match(hardeningMigration, /old\.approval_requirement/);
  assert.match(hardeningMigration, /job contract fields are immutable/);
});
test("route maps expected job-creation errors without returning raw database details", async () => {
  const route = await readFile(new URL("../app/api/external-agent-jobs/route.ts", import.meta.url), "utf8");
  assert.match(route, /EXTERNAL_AGENT_JOB_FORBIDDEN/);
  assert.match(route, /EXTERNAL_AGENT_JOB_FORBIDDEN"\) \? 403/);
  assert.match(route, /AUTHENTICATION_REQUIRED/);
  assert.match(route, /AUTHENTICATION_REQUIRED"\) \? 401/);
  assert.match(route, /EXTERNAL_AGENT_JOB_IDEMPOTENCY_CONFLICT/);
  assert.match(route, /EXTERNAL_AGENT_JOB_DUPLICATE_ACTIVE/);
  assert.match(route, /EXTERNAL_AGENT_JOB_CREATE_FAILED/);
  assert.doesNotMatch(route, /error: error\.message/);
});
test("job creation authenticates before reading a bounded request body", async () => {
  const route = await readFile(new URL("../app/api/external-agent-jobs/route.ts", import.meta.url), "utf8");
  assert.equal(JOB_CREATE_MAX_BODY_BYTES, 8 * 1024);
  assert.match(route, /EXTERNAL_AGENT_JOB_PAYLOAD_TOO_LARGE/);
  assert.match(route, /readJsonBodyWithLimit\(request, JOB_CREATE_MAX_BODY_BYTES\)/);
  assert.doesNotMatch(route, /request\.(?:json|text)\(\)/);
  assert.ok(route.indexOf("supabase.auth.getUser()") < route.indexOf("const parsedBody"));
  assert.ok(route.lastIndexOf("EXTERNAL_AGENT_JOB_PAYLOAD_TOO_LARGE") < route.indexOf("validateCreateInput(body)"));
});
test("phase 1 contains no dispatch, merge, deploy, or external HTTP implementation", () => {
  assert.doesNotMatch(migration, /http_post|net\.http|github push|openai api/i);
});

test("signed callback is accepted only with its intact body, timestamp, and nonce", () => {
  const secret = "s".repeat(CALLBACK_MIN_SECRET_LENGTH);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "a".repeat(32);
  const body = JSON.stringify({ jobId: "job", status: "SUCCEEDED" });
  const signature = createCallbackSignature({ secret, timestamp, nonce, body });
  assert.equal(verifyCallbackSignature({ secret, timestamp, nonce, body, signature }), true);
  assert.equal(verifyCallbackSignature({ secret, timestamp, nonce, body: `${body} `, signature }), false);
});

test("signed callback rejects expired timestamps and short nonces", () => {
  const secret = "s".repeat(CALLBACK_MIN_SECRET_LENGTH);
  const now = Date.now();
  const timestamp = String(Math.floor((now - (CALLBACK_MAX_AGE_SECONDS + 1) * 1000) / 1000));
  const nonce = "b".repeat(32);
  const body = "{}";
  const signature = createCallbackSignature({ secret, timestamp, nonce, body });
  assert.equal(verifyCallbackSignature({ secret, timestamp, nonce, body, signature, now }), false);
  assert.equal(verifyCallbackSignature({ secret, timestamp: String(Math.floor(now / 1000)), nonce: "short", body, signature, now }), false);
});

test("signed callback rejects non-canonical timestamp formats", () => {
  const secret = "s".repeat(CALLBACK_MIN_SECRET_LENGTH);
  const nonce = "c".repeat(32);
  const body = "{}";
  const timestamp = "1234567890.5";
  const signature = createCallbackSignature({ secret, timestamp, nonce, body });
  assert.equal(verifyCallbackSignature({ secret, timestamp, nonce, body, signature }), false);
  assert.equal(CALLBACK_MAX_BODY_BYTES, 64 * 1024);
});

test("signed callback requires a strong secret, a header-safe nonce, and a finite clock", () => {
  const secret = "s".repeat(CALLBACK_MIN_SECRET_LENGTH);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = "{}";
  const safeNonce = "nonce_12345678901";
  assert.equal(verifyCallbackSignature({ secret: "short", timestamp, nonce: safeNonce, body, signature: createCallbackSignature({ secret: "short", timestamp, nonce: safeNonce, body }) }), false);
  assert.equal(verifyCallbackSignature({ secret, timestamp, nonce: "nonce.with.a.dot", body, signature: createCallbackSignature({ secret, timestamp, nonce: "nonce.with.a.dot", body }) }), false);
  assert.equal(verifyCallbackSignature({ secret, timestamp, nonce: safeNonce, body, signature: createCallbackSignature({ secret, timestamp, nonce: safeNonce, body }), now: Number.NaN }), false);
});

test("callback database errors distinguish nonce replay from other unique conflicts", () => {
  assert.deepEqual(mapCallbackDatabaseError({ code: "23505", message: 'duplicate key violates "external_agent_callback_nonces_pkey"' }), { status: 409, error: "CALLBACK_REPLAY_DETECTED" });
  assert.deepEqual(mapCallbackDatabaseError({ code: "23505", message: 'duplicate key violates "external_agent_jobs_provider_external_id_idx"' }), { status: 500, error: "EXTERNAL_AGENT_JOB_CALLBACK_FAILED" });
  assert.deepEqual(mapCallbackDatabaseError({ code: "P0001", message: "raw database detail" }), { status: 409, error: "EXTERNAL_AGENT_JOB_RESULT_REJECTED" });
  assert.deepEqual(mapCallbackDatabaseError({ code: "08006", message: "connection failure" }), { status: 500, error: "EXTERNAL_AGENT_JOB_CALLBACK_FAILED" });
});

test("callback route requires signed requests and applies nonce plus result atomically", async () => {
  const callbackRoute = await readFile(new URL("../app/api/internal/external-agent-jobs/callback/route.ts", import.meta.url), "utf8");
  assert.match(callbackRoute, /verifyCallbackSignature/);
  assert.match(callbackRoute, /apply_external_agent_job_callback/);
  assert.match(callbackRoute, /mapCallbackDatabaseError/);
  assert.doesNotMatch(callbackRoute, /EXTERNAL_AGENT_RESULT_TOKEN/);
  assert.doesNotMatch(callbackRoute, /error: error\.message/);
  assert.doesNotMatch(callbackRoute, /\.from\("external_agent_callback_nonces"\)/);
});

test("callback database contract rolls back nonce reservation when result update fails", () => {
  assert.match(callbackAtomicityMigration, /insert into public\.external_agent_callback_nonces/);
  assert.match(callbackAtomicityMigration, /public\.update_external_agent_job_result/);
  assert.ok(callbackAtomicityMigration.indexOf("external_agent_callback_nonces") < callbackAtomicityMigration.indexOf("update_external_agent_job_result"));
  assert.match(callbackAtomicityMigration, /revoke all on function public\.apply_external_agent_job_callback[\s\S]+from public, anon, authenticated/);
  assert.match(callbackAtomicityMigration, /grant execute on function public\.apply_external_agent_job_callback[\s\S]+to service_role/);
});

test("database pins external result identity and verifies pull request provenance", () => {
  assert.match(resultIdentityMigration, /external_agent_jobs_pull_request_identity_check/);
  assert.match(resultIdentityMigration, /'https:\/\/github\.com\/' \|\| repository \|\| '\/pull\/'/);
  assert.match(resultIdentityMigration, /for update/);
  assert.match(resultIdentityMigration, /external job id does not match the dispatched job/);
  assert.match(resultIdentityMigration, /branch name cannot be replaced/);
  assert.match(resultIdentityMigration, /commit sha cannot be replaced/);
  assert.match(resultIdentityMigration, /pull request number and url must be supplied together/);
  assert.match(resultIdentityMigration, /v_current\.repository/);
  assert.match(resultIdentityMigration, /pull request url does not match the authorized repository/);
});

test("database rejects impossible external result timestamps", () => {
  assert.match(resultIdentityMigration, /v_current\.created_at - interval '5 minutes'/);
  assert.match(resultIdentityMigration, /started_at is too far in the future/);
  assert.match(resultIdentityMigration, /completed_at is too far in the future/);
  assert.match(resultIdentityMigration, /completed_at cannot precede started_at/);
});

test("hardened result RPC remains service-role only", () => {
  assert.match(resultIdentityMigration, /security definer/);
  assert.match(resultIdentityMigration, /set search_path = ''/);
  assert.match(resultIdentityMigration, /revoke all on function public\.update_external_agent_job_result[\s\S]+from public, anon, authenticated/);
  assert.match(resultIdentityMigration, /grant execute on function public\.update_external_agent_job_result[\s\S]+to service_role/);
});

test("legacy bearer-token result route is removed so callbacks have one authenticated entry point", async () => {
  await assert.rejects(readFile(new URL("../app/api/internal/external-agent-jobs/result/route.ts", import.meta.url)), { code: "ENOENT" });
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

test("gateway response parsing accepts only a bounded JSON body", async () => {
  const validResponse = new Response(JSON.stringify({ externalJobId: "remote-123" }));
  assert.deepEqual(await readBoundedJsonResponse(validResponse), { externalJobId: "remote-123" });

  const oversizedHeader = new Response("{}", { headers: { "content-length": String(DISPATCH_RESPONSE_MAX_BODY_BYTES + 1) } });
  assert.equal(await readBoundedJsonResponse(oversizedHeader), null);

  const oversizedStream = new Response("x".repeat(DISPATCH_RESPONSE_MAX_BODY_BYTES + 1));
  assert.equal(await readBoundedJsonResponse(oversizedStream), null);
  assert.equal(await readBoundedJsonResponse(new Response("not json")), null);
});

test("internal dispatch authentication uses a constant-time equality check", () => {
  assert.equal(safeTokenEquals("a".repeat(32), "a".repeat(32)), true);
  assert.equal(safeTokenEquals("a".repeat(32), "b".repeat(32)), false);
  assert.equal(safeTokenEquals("a".repeat(32), "a".repeat(31)), false);
  assert.equal(hasMinimumTokenLength("a".repeat(16)), true);
  assert.equal(hasMinimumTokenLength("short"), false);
});

test("dispatch route is fail-closed, idempotent at the gateway, and never returns raw errors", async () => {
  const route = await readFile(new URL("../app/api/internal/external-agent-jobs/dispatch/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(!config\.ok\)/);
  assert.match(route, /DISPATCH_AUTHENTICATION_REQUIRED/);
  assert.match(route, /EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN/);
  assert.match(route, /config\.gatewayToken/);
  assert.match(route, /idempotency-key/);
  assert.match(route, /external-agent-job:\$\{job\.id\}/);
  assert.match(route, /hasMinimumTokenLength\(triggerToken\)/);
  assert.match(route, /redirect: "error"/);
  assert.match(route, /readBoundedJsonResponse\(gatewayResponse\)/);
  assert.ok(route.indexOf("readBoundedJsonResponse(gatewayResponse)") < route.indexOf("clearTimeout(timeout)"));
  assert.match(route, /p_status: "RUNNING"/);
  assert.doesNotMatch(route, /error: .*\.message/);
});

test("dispatch rejects oversized payloads before decoding JSON or contacting the gateway", async () => {
  const route = await readFile(new URL("../app/api/internal/external-agent-jobs/dispatch/route.ts", import.meta.url), "utf8");
  assert.equal(DISPATCH_MAX_BODY_BYTES, 4 * 1024);
  assert.match(route, /readJsonBodyWithLimit/);
  assert.match(route, /DISPATCH_PAYLOAD_TOO_LARGE/);
  assert.doesNotMatch(route, /request\.text\(\)/);
  assert.ok(route.indexOf("DISPATCH_AUTHENTICATION_REQUIRED") < route.indexOf("const parsedBody"));
});

test("callback rejects oversized payloads before signature or database work", async () => {
  const callbackRoute = await readFile(new URL("../app/api/internal/external-agent-jobs/callback/route.ts", import.meta.url), "utf8");
  assert.match(callbackRoute, /readUtf8BodyWithLimit/);
  assert.match(callbackRoute, /CALLBACK_PAYLOAD_TOO_LARGE/);
  assert.doesNotMatch(callbackRoute, /request\.text\(\)/);
  assert.ok(callbackRoute.lastIndexOf("CALLBACK_PAYLOAD_TOO_LARGE") < callbackRoute.lastIndexOf("verifyCallbackSignature"));
});

test("bounded body reader rejects oversized chunked requests without collecting later chunks", async () => {
  let pulls = 0;
  const request = new Request("https://work.example.test/callback", {
    method: "POST",
    body: new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode("12345"));
        if (pulls > 1) controller.close();
      },
    }),
    duplex: "half",
  });
  const result = await readUtf8BodyWithLimit(request, 4);
  assert.deepEqual(result, { ok: false });
  assert.equal(pulls, 1);
});

test("bounded JSON reader preserves valid small input and treats malformed JSON as invalid input", async () => {
  const validRequest = new Request("https://work.example.test/jobs", { method: "POST", body: '{"jobId":"x"}' });
  assert.deepEqual(await readJsonBodyWithLimit(validRequest, 64), { ok: true, value: { jobId: "x" } });
  const malformedRequest = new Request("https://work.example.test/jobs", { method: "POST", body: "{" });
  assert.deepEqual(await readJsonBodyWithLimit(malformedRequest, 64), { ok: true, value: null });
});

test("agent entry routes authenticate before reading a body and apply strict body limits", async () => {
  const createRoute = await readFile(new URL("../app/api/external-agent-jobs/route.ts", import.meta.url), "utf8");
  const dispatchRoute = await readFile(new URL("../app/api/internal/external-agent-jobs/dispatch/route.ts", import.meta.url), "utf8");
  assert.match(createRoute, /EXTERNAL_AGENT_JOB_PAYLOAD_TOO_LARGE/);
  assert.ok(createRoute.indexOf("auth.getUser") < createRoute.indexOf("const parsedBody"));
  assert.match(dispatchRoute, /DISPATCH_PAYLOAD_TOO_LARGE/);
  assert.ok(dispatchRoute.indexOf("DISPATCH_AUTHENTICATION_REQUIRED") < dispatchRoute.indexOf("const parsedBody"));
});

test("AI execution is server-guarded before history creation or an OpenAI call", async () => {
  const route = await readFile(new URL("../app/api/workflow-steps/[stepId]/run-ai/route.ts", import.meta.url), "utf8");
  const guardStart = route.indexOf('.from("workflows")');
  const historyCreate = route.indexOf('rpc("start_workflow_ai_run"');
  const openAiCall = route.indexOf("new OpenAI(");

  assert.ok(guardStart >= 0);
  assert.ok(historyCreate >= 0);
  assert.ok(guardStart < historyCreate);
  assert.ok(guardStart < openAiCall);
  assert.match(route, /workflow\.status !== "IN_PROGRESS"/);
  assert.match(route, /step\.step_order !== workflow\.current_step_order/);
  assert.match(route, /step\.status !== "IN_PROGRESS"/);
  assert.match(route, /step\.requires_human_approval && !step\.approved_at/);
  assert.match(route, /status: 409/);
});
