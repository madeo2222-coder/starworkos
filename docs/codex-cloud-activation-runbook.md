# Codex Cloud / External Agent Activation Runbook

## Purpose

Use this runbook to move STAR WORK OS from code-complete external-agent support to a controlled production activation.

This document does **not** authorize production database changes, secret changes, or enabling external dispatch. Those remain explicit operator actions.

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
5. Run the existing local/operator preflight:
   `npm run check:external-agent`
6. After PR #17 is deployed, call:
   `GET /api/internal/external-agent-jobs/readiness`
   with `Authorization: Bearer <EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN>`.
7. Require `readiness.state` to be exactly `READY_TO_ENABLE` and `issues` to be empty.
8. Verify the callback URL resolves to this production deployment and the dispatch URL host exactly matches the allowlist.
9. Enable dispatch only after explicit approval by setting `EXTERNAL_AGENT_DISPATCH_ENABLED=true`.
10. Re-run the authenticated readiness endpoint and require `state=ENABLED`.
11. Submit one controlled, non-destructive software-development job.
12. Verify the job moves `QUEUED -> RUNNING -> terminal`, records execution history, and does not request a protected action without human approval.

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
- dispatch is explicitly enabled;
- one controlled job completes end-to-end;
- callback replay protection is verified;
- execution history is populated;
- protected actions still require human approval.
