import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/sales/follow-up-email/[id]/route.ts", import.meta.url), "utf8");

test("follow-up email route authenticates before one RLS-scoped row read", () => {
  assert.ok(source.indexOf("auth.getUser()") < source.indexOf('from("tasks")'));
  assert.match(source, /select\("id, content"\)\.eq\("id", id\)\.maybeSingle\(\)/u);
  assert.doesNotMatch(source, /service[_-]?role|createClient\([^)]*secret/iu);
});

test("follow-up email route is download-only and never sends or mutates", () => {
  assert.match(source, /buildUnsentSalesFollowUpEmail/u);
  assert.match(source, /message\/rfc822/u);
  assert.match(source, /cache-control": "no-store"/u);
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|fetch\(|resend|sendMail/iu);
});
