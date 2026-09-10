# External Agent / Workflow AI Boundary Hardening Runbook

## Scope

This runbook covers the PR prepared on `feat/external-agent-boundary-hardening`.
It does not authorize a production database migration, environment change,
external AI dispatch, production deployment, or main merge.

## Required order

1. Confirm a current database backup and record the deployed application commit.
2. Run the database migration preflight in Preview.
3. Apply all pending migrations to Preview in filename/version order.
4. Do not deploy the new application code if any migration stops.
5. Deploy the matching application commit to Preview only.
6. Run the smoke checks below without approving a main merge or production action.
7. Repeat the database-first sequence in Production only after explicit approval.

The application code depends on `start_workflow_ai_run`,
`finalize_workflow_ai_run`, and `apply_external_agent_job_callback`. Deploying
the code before the migrations would make those routes fail.

## Migration safety checks

Migration versions are unique. The July 29 Task schema runs first, its initial
status synchronization runs second, and the corrected atomic planning RPC runs
last so an older function body cannot overwrite the correction.

The migrations intentionally stop instead of modifying ambiguous existing data
when either of these conditions is found:

- more than one `RUNNING` execution exists for the same Workflow STEP;
- RLS is not enabled on the Workflow, STEP, message, or CEO Inbox tables.

If a preflight stops, leave the application on its current commit. Inspect and
resolve the reported data or RLS condition separately; do not delete or rewrite
records as part of this rollout.

## Preview smoke checks

1. An unauthenticated Workflow AI request returns 401 before reading its body.
2. An unapproved human-review STEP returns 409 without creating an execution.
3. Two simultaneous requests for one STEP produce one `RUNNING` execution and
   one 409 response.
4. A successful AI response atomically saves the STEP output, handoff message,
   and `SUCCESS` execution history.
5. A failed AI request stores a bounded audit classification without raw provider
   or database details.
6. A signed callback is accepted once; replaying the same nonce is rejected.
7. STEP completion and CEO approval still work for an authorized user under RLS.

## Safe rollback order

If application errors appear after deployment:

1. Stop external dispatch and do not approve additional executions.
2. Roll the application back to the previously recorded commit first.
3. Keep the additive tables, columns, indexes, and functions in place while the
   cause is investigated; the previous application does not depend on removing
   them.
4. Reversing database changes requires a separate reviewed migration and explicit
   approval. Do not manually drop functions, constraints, or audit records.
