import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("profile editing authenticates, rejects duplicates, and uses optimistic concurrency", () => {
  const page = readFileSync(new URL("../app/sales/page.tsx", import.meta.url), "utf8");
  const action = page.slice(
    page.indexOf("async function updateLeadProfile("),
    page.indexOf("async function createSalesLeadsBulk("),
  );

  assert.ok(action.indexOf("supabase.auth.getUser()") < action.indexOf('.select("id, content, updated_at, status")'));
  assert.ok(action.includes("companyNameKey(currentLead.companyName)"));
  assert.ok(action.includes("other.id !== id"));
  assert.ok(action.indexOf("profile-duplicate") < action.lastIndexOf(".update("));
  assert.ok(action.includes('.eq("updated_at", version).eq("content", task.content).eq("status", task.status)'));
  assert.doesNotMatch(action, /throw new Error|\.message/u);
});
