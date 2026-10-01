import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/sales/page.tsx", import.meta.url), "utf8");

test("sales reply intake keeps one final opt-out slot visible", () => {
  assert.match(page, /MAX_SALES_REPLIES_WITH_OPT_OUT/u);
  assert.match(page, /lead\.replies\.length < MAX_SALES_REPLIES_WITH_OPT_OUT/u);
  assert.match(page, /requiresOptOutOnlyReplyIntake\(lead\)/u);
  assert.match(page, /salesReplyIntakeDefaultChannel\(lead\)/u);
  assert.match(page, /defaultValue=\{defaultChannel\}/u);
  assert.match(page, /defaultValue=\{optOutOnly \? "OPT_OUT" : "UNKNOWN"\}/u);
  assert.match(page, /!optOutOnly \|\| value === "OPT_OUT"/u);
  assert.match(page, /追加できるのは配信停止だけです/u);
});

test("reply intake remains an authenticated server action", () => {
  const action = page.slice(page.indexOf("async function recordInboundReply"),
    page.indexOf("async function recordOutreachDelivery"));
  assert.match(action, /"use server"/u);
  assert.match(action, /supabase\.auth\.getUser\(\)/u);
  assert.match(action, /recordSalesReply\(/u);
  assert.match(action, /\.eq\("updated_at", version\)/u);
});
