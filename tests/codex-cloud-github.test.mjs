import test from "node:test";
import assert from "node:assert/strict";
import {
  CODEX_GATEWAY_MAX_BODY_BYTES,
  buildCodexDelegationComment,
  buildCodexIssue,
  codexDelegationMarker,
  codexIssueContractDigest,
  codexIssueMarker,
  findExistingCodexIssue,
  hasCodexDelegationComment,
  isTrustedCodexIssue,
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
  assert.equal(validateCodexGatewayPayload({ ...payload, job: { ...payload.job, capability: "code_review" } }), "UNSUPPORTED_CODEX_GATEWAY_JOB");
  assert.equal(validateCodexGatewayPayload({ ...payload, job: { ...payload.job, capability: "repository_analysis" } }), "UNSUPPORTED_CODEX_GATEWAY_JOB");
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
  const comment = buildCodexDelegationComment("madeo2222-coder/starworkos", payload.job.id);
  assert.equal(comment.includes(codexDelegationMarker(payload.job.id)), true);
  assert.match(comment, /@codex /i);
  assert.match(comment, /madeo2222-coder\/starworkos/);
  assert.match(comment, /Do not merge/);
  assert.match(comment, /human approval/);
});

test("gateway retry helpers trust only the authenticated actor and exact issue contract", () => {
  const contract = buildCodexIssue(payload);
  const trusted = { number: 5, title: contract.title, body: contract.body, user: { login: "gateway-user" } };
  const forged = { number: 6, title: contract.title, body: contract.body, user: { login: "attacker" } };
  assert.equal(isTrustedCodexIssue(trusted, contract, "gateway-user"), true);
  assert.equal(isTrustedCodexIssue(forged, contract, "gateway-user"), false);
  assert.equal(findExistingCodexIssue([forged, trusted], contract, "gateway-user")?.number, 5);
  assert.match(codexIssueContractDigest(contract), /^[0-9a-f]{64}$/);

  const delegation = buildCodexDelegationComment(payload.job.repository, payload.job.id);
  const actor = "gateway-user";
  assert.equal(hasCodexDelegationComment([{ body: delegation, user: { login: actor } }], payload.job.repository, payload.job.id, actor), true);
  assert.equal(hasCodexDelegationComment([{ body: delegation, user: { login: "attacker" } }], payload.job.repository, payload.job.id, actor), false);
  assert.equal(hasCodexDelegationComment([{ body: "@codex do it", user: { login: actor } }], payload.job.repository, payload.job.id, actor), false);
  assert.equal(hasCodexDelegationComment([{ body: delegation, user: { login: actor } }], payload.job.repository, "22222222-2222-4222-8222-222222222222", actor), false);
  assert.equal(CODEX_GATEWAY_MAX_BODY_BYTES, 32 * 1024);
});

test("database migration provides an atomic, service-role-only dispatch claim", async () => {
  const { readFile } = await import("node:fs/promises");
  const migration = await readFile(new URL("../supabase/migrations/20260920090000_codex_gateway_dispatch_claim.sql", import.meta.url), "utf8");
  assert.match(migration, /job_id uuid primary key/);
  assert.match(migration, /on conflict \(job_id\) do nothing/);
  assert.match(migration, /for update/);
  assert.match(migration, /interval '2 minutes'/);
  assert.match(migration, /if v_row\.delegated_at is not null/);
  assert.match(migration, /complete_codex_gateway_delegation/);
  assert.match(migration, /delegated_at = coalesce\(delegated_at, now\(\)\)/);
  assert.equal(migration.split("\n").some((line) => line.trim() === "as $"), false);
  assert.equal(migration.split("\n").some((line) => line.trim() === "$;"), false);
  assert.equal((migration.match(/as \$\$/g) ?? []).length, 3);
  assert.equal((migration.match(/^\$\$;$/gm) ?? []).length, 3);
  assert.match(migration, /contract digest mismatch/);
  assert.match(migration, /issue identity mismatch/);
  assert.match(migration, /revoke all on function public\.claim_codex_gateway_dispatch[\s\S]+from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.claim_codex_gateway_dispatch[\s\S]+to service_role/);
  assert.match(migration, /revoke all on function public\.complete_codex_gateway_delegation[\s\S]+from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.complete_codex_gateway_delegation[\s\S]+to service_role/);
});

test("gateway route keeps the lease until an authenticated delegation comment is posted", async () => {
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(new URL("../app/api/internal/codex-cloud-gateway/route.ts", import.meta.url), "utf8");
  const commentCheck = route.indexOf("hasCodexDelegationComment");
  const completeCall = route.indexOf('supabase.rpc("complete_codex_gateway_delegation"');
  assert.ok(commentCheck >= 0);
  assert.ok(completeCall > commentCheck);
  assert.match(route, /postedComment\?\.user\?\.login !== actorLogin/);
  assert.match(route, /!claim\.claimed && !claim\.delegated/);
});
