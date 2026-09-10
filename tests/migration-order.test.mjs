import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);

const orderedMigrations = [
  "20260729090000_task_center_v11.sql",
  "20260729100000_task_workflow_status_sync.sql",
  "20260729110000_task_workflow_planning_rpc.sql",
  "20260901_external_agent_callback_security.sql",
  "20260909072943_harden_external_agent_job_contract.sql",
  "20260909090000_pin_external_agent_result_identity.sql",
  "20260909111500_prevent_concurrent_workflow_ai_runs.sql",
  "20260909140000_finalize_workflow_ai_run.sql",
  "20260909150000_start_workflow_ai_run.sql",
  "20260909160000_harden_workflow_rpc_privileges.sql",
  "20260909170000_external_agent_callback_atomicity.sql",
];

test("new migration versions are unambiguous and preserve dependency order", async () => {
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const filename of filenames) {
    assert.match(filename, /^\d{8}(?:\d{6})?_[a-z0-9_]+\.sql$/);
  }

  for (const filename of orderedMigrations.filter(
    (name) => name.startsWith("20260729") || name.startsWith("20260909"),
  )) {
    assert.match(filename, /^\d{14}_/, filename);
  }

  const versions = filenames.map((filename) => filename.split("_", 1)[0]);
  assert.equal(new Set(versions).size, versions.length);

  const selected = filenames.filter((filename) =>
    orderedMigrations.includes(filename),
  );
  assert.deepEqual(selected, orderedMigrations);
});

test("every dependency-sensitive migration is transaction-wrapped", async () => {
  for (const filename of orderedMigrations) {
    const sql = (await readFile(new URL(filename, migrationsDirectory), "utf8"))
      .trim()
      .toLowerCase();

    assert.match(sql, /(?:^|\n)begin;/, filename);
    assert.match(sql, /commit;$/, filename);
  }
});
