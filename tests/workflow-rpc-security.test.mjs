import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20260909160000_harden_workflow_rpc_privileges.sql",
  import.meta.url,
);

test("browser-callable Workflow mutation RPCs require RLS and use invoker rights", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  for (const table of [
    "workflows",
    "workflow_steps",
    "workflow_messages",
    "ceo_inbox",
  ]) {
    assert.match(migration, new RegExp(`\\('${table}'\\)`));
  }

  assert.match(migration, /relation\.relrowsecurity is distinct from true/i);
  assert.match(migration, /raise exception 'WORKFLOW_RLS_REQUIRED'/i);
  assert.match(
    migration,
    /alter function public\.complete_current_workflow_step\(uuid, text\)[\s\S]*security invoker/i,
  );
  assert.match(
    migration,
    /alter function public\.resolve_ceo_inbox_item\([\s\S]*timestamptz[\s\S]*\)[\s\S]*security invoker/i,
  );
});

test("Workflow mutation RPCs are executable only by authenticated browser users", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  for (const functionName of [
    "complete_current_workflow_step",
    "resolve_ceo_inbox_item",
  ]) {
    const functionSection = migration.slice(
      migration.indexOf(`alter function public.${functionName}`),
      functionName === "complete_current_workflow_step"
        ? migration.indexOf("alter function public.resolve_ceo_inbox_item")
        : migration.indexOf("commit;"),
    );

    assert.match(functionSection, /revoke all[\s\S]*from public, anon/i);
    assert.match(functionSection, /grant execute[\s\S]*to authenticated/i);
  }
});

test("service-role external mutation functions remain outside the browser privilege migration", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.doesNotMatch(migration, /alter function public\.update_external_agent_job_result/i);
  assert.doesNotMatch(migration, /alter function public\.apply_external_agent_job_callback/i);
  assert.doesNotMatch(migration, /to service_role/i);
});
