# Codex Cloud / External Agent Activation Runbook

## Purpose

Use this runbook to move STAR WORK OS from code-complete external-agent support to a controlled production activation.

Production database changes, secret/environment changes, external dispatch activation, main merges, production deploys, and destructive operations remain human-gated.

## Required production variables

Configure these only in the production Vercel project for STAR WORK OS:

- `EXTERNAL_AGENT_CALLBACK_SECRET`
- `EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN`
- `EXTERNAL_AGENT_GATEWAY_TOKEN`
- `EXTERNAL_AGENT_DISPATCH_URL`
- `EXTERNAL_AGENT_CALLBACK_URL`
- `EXTERNAL_AGENT_DISPATCH_ALLOWED_HOSTS`
- `EXTERNAL_AGENT_DISPATCH_ENABLED`

Keep `EXTERNAL_AGENT_DISPATCH_ENABLED=false` until every preflight and smoke check below passes.

## Safe activation order

1. Confirm the production Vercel project points to `madeo2222-coder/starworkos` and the expected `main` commit.
2. Confirm all required Supabase migrations are applied in filename/version order.
3. Configure the required production variables except dispatch activation.
4. Keep `EXTERNAL_AGENT_DISPATCH_ENABLED=false`.
5. Run the local/operator preflight:
   `npm run check:external-agent`
6. Call the authenticated readiness endpoint:
   `GET /api/internal/external-agent-jobs/readiness`
   with `Authorization: Bearer <EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN>`.
7. Require `readiness.state` to be exactly `READY_TO_ENABLE` and `issues` to be empty.
8. Create or identify one controlled `QUEUED` test job and call:
   `POST /api/internal/external-agent-jobs/dispatch-dry-run`
   with the same Bearer token and JSON body `{"jobId":"<uuid>"}`.
9. Require the dry-run to return `ok=true`, `readiness.state=READY_TO_ENABLE`, `job.status=QUEUED`, and `wouldDispatch=false`.
10. Verify the callback URL resolves to this production deployment and the dispatch URL host exactly matches the allowlist.
11. Verify the actual Codex/agent gateway independently before enabling dispatch.
12. Enable dispatch only after explicit human approval by setting `EXTERNAL_AGENT_DISPATCH_ENABLED=true`.
13. Re-run readiness and require `state=ENABLED`.
14. Re-run dispatch dry-run for the controlled job and require `wouldDispatch=true`.
15. Dispatch exactly one controlled, non-destructive software-development job.
16. Verify `QUEUED -> RUNNING -> terminal`, signed callback handling, execution-history linkage, and human gating for protected actions.

## Controlled E2E job rules

The first production job must:

- use `provider=openai_codex`;
- target `madeo2222-coder/starworkos`;
- use a non-production branch;
- avoid database migrations, secrets, destructive operations, and production deploys;
- create at most a reviewable code change or analysis result;
- stop at `WAITING_HUMAN_APPROVAL` before any protected action.

## Protected actions

These remain human-gated:

- main merge;
- production deploy;
- production database migration;
- secret or environment change;
- destructive operation.

## Failure handling

If readiness is not `READY_TO_ENABLE` or `ENABLED`, do not dispatch a job. Correct only the named issue code.

If dry-run fails, do not call the real dispatch endpoint. Resolve configuration or job-state errors first.

If dispatch fails after the gateway accepts a job:

1. Do not manually force the STAR WORK OS job to `RUNNING`.
2. Check the gateway by its idempotency key `external-agent-job:<job-id>`.
3. Resolve state reconciliation before retrying.
4. Keep protected actions disabled.

If callback verification fails:

1. Keep dispatch disabled.
2. Verify the callback secret, timestamp, nonce, and production callback URL.
3. Do not bypass signature verification or replay protection.

## Completion criteria

Codex Cloud activation is complete only when:

- production migrations match the repository;
- authenticated readiness returns no issues;
- dispatch dry-run succeeds while disabled;
- the gateway path is verified;
- dispatch is explicitly enabled;
- one controlled job completes end-to-end;
- callback replay protection is verified;
- execution history is populated;
- protected actions still require human approval.
