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

test("AI execution is server-guarded before history creation or an OpenAI call", async () => {
  const route = await readFile(new URL("../app/api/workflow-steps/[stepId]/run-ai/route.ts", import.meta.url), "utf8");
  const guardStart = route.indexOf('.from("workflows")');
  const historyCreate = route.indexOf('.from("execution_history")');
  const openAiCall = route.indexOf("new OpenAI(");

  assert.ok(guardStart >= 0);
  assert.ok(guardStart < historyCreate);
  assert.ok(guardStart < openAiCall);
  assert.match(route, /workflow\.status !== "IN_PROGRESS"/);
  assert.match(route, /step\.step_order !== workflow\.current_step_order/);
  assert.match(route, /step\.status !== "IN_PROGRESS"/);
  assert.match(route, /step\.requires_human_approval && !step\.approved_at/);
  assert.match(route, /status: 409/);
});
