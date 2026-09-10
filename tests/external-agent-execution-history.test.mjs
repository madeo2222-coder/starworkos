import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20260910_external_agent_execution_history.sql", import.meta.url),
  "utf8",
);

test("external agent jobs are linked one-to-one to execution history", () => {
  assert.match(migration, /external_agent_job_id uuid/);
  assert.match(migration, /references public\.external_agent_jobs\(id\)/);
  assert.match(migration, /create unique index if not exists execution_history_external_agent_job_id_uidx/);
});

test("RUNNING external jobs create or refresh a RUNNING audit entry", () => {
  assert.match(migration, /if new\.status = 'RUNNING'/);
  assert.match(migration, /'external:' \|\| new\.provider/);
  assert.match(migration, /'External Agent: ' \|\| new\.capability/);
  assert.match(migration, /status = 'RUNNING'/);
  assert.match(migration, /on conflict \(external_agent_job_id\)/);
});

test("terminal external jobs map to existing execution history statuses", () => {
  assert.match(migration, /new\.status in \('SUCCEEDED', 'FAILED', 'CANCELLED'\)/);
  assert.match(migration, /new\.status = 'SUCCEEDED' then 'SUCCESS' else 'ERROR'/);
  assert.match(migration, /completed_at = coalesce\(new\.completed_at, now\(\)\)/);
  assert.match(migration, /coalesce\(new\.error_summary, new\.error_code/);
});

test("audit synchronization is service-controlled and transition-driven", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /revoke all on function public\.sync_external_agent_job_execution_history\(\) from public, anon, authenticated/);
  assert.match(migration, /after update of status on public\.external_agent_jobs/);
  assert.match(migration, /when \(old\.status is distinct from new\.status\)/);
});
