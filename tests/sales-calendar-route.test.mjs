import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/sales/calendar/[id]/route.ts", import.meta.url), "utf8");

test("calendar route authenticates before one RLS-scoped row read", () => {
  assert.ok(source.indexOf("auth.getUser()") < source.indexOf('from("tasks")'));
  assert.match(source, /select\("id, content"\)\.eq\("id", id\)\.maybeSingle\(\)/u);
  assert.doesNotMatch(source, /service[_-]?role|createClient\([^)]*secret/iu);
});

test("calendar route is download-only and never creates or sends an event", () => {
  assert.match(source, /buildSalesAppointmentCalendar/u);
  assert.match(source, /text\/calendar/u);
  assert.match(source, /cache-control": "no-store"/u);
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|fetch\(|send|invite/iu);
});
