import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  companyNameKey,
  MAX_SALES_BULK_IMPORT_LENGTH,
  MAX_SALES_BULK_IMPORT_ROWS,
  prepareSalesBulkImport,
} from "../lib/sales-bulk-import.js";
import { parseSalesLeadRecord } from "../lib/sales-lead-record.js";

test("prepares four-column Excel rows as one bounded insert payload", () => {
  const rows = prepareSalesBulkImport([
    "企業名\tWebサイト\t窓口\t提案理由",
    " テスト工務店 \thttps://example.com\tsales@example.com\t保証の提案候補",
    "第二住宅\t\t営業部\t既存顧客支援",
  ].join("\r\n"));

  assert.equal(rows?.length, 2);
  assert.deepEqual(rows?.map((row) => row.title), ["営業見込み：テスト工務店", "営業見込み：第二住宅"]);
  assert.deepEqual(rows?.map((row, index) => parseSalesLeadRecord(`lead-${index}`, row.content).companyName), [
    "テスト工務店", "第二住宅",
  ]);
  assert.ok(rows?.every((row) => row.priority === "高" && row.status === "NEW"));
  assert.ok(Object.isFrozen(rows));
  assert.ok(rows?.every(Object.isFrozen));
});

test("accepts headerless rows and ignores blank lines", () => {
  const rows = prepareSalesBulkImport("\n株式会社A\thttps://a.example\t営業部\t候補\n\n");
  assert.equal(rows?.length, 1);
  assert.equal(parseSalesLeadRecord("lead-a", rows[0].content).companyName, "株式会社A");
});

test("rejects malformed headers, column counts, fields, and oversized input", () => {
  assert.equal(prepareSalesBulkImport(""), null);
  assert.equal(prepareSalesBulkImport("企業名\tURL\t窓口\t提案理由\n企業\thttps://a.example\t窓口\t理由"), null);
  assert.equal(prepareSalesBulkImport("企業\thttps://a.example\t窓口"), null);
  assert.equal(prepareSalesBulkImport("企業\tjavascript:alert(1)\t窓口\t理由"), null);
  assert.equal(prepareSalesBulkImport("企業\thttps://a.example\t窓口\t理由\t余分"), null);
  assert.equal(prepareSalesBulkImport("x".repeat(MAX_SALES_BULK_IMPORT_LENGTH + 1)), null);
});

test("rejects more than fifty companies without returning a partial payload", () => {
  const input = Array.from({ length: MAX_SALES_BULK_IMPORT_ROWS + 1 }, (_, index) => (
    `企業${index}\thttps://example.com/${index}\t営業部\t候補`
  )).join("\n");
  assert.equal(prepareSalesBulkImport(input), null);
});

test("rejects normalized duplicates within the batch or existing RLS-visible leads", () => {
  assert.equal(prepareSalesBulkImport([
    "株式会社ＡＢＣ\thttps://a.example\t営業部\t候補",
    "株式会社abc\thttps://b.example\t営業部\t候補",
  ].join("\n")), null);
  assert.equal(prepareSalesBulkImport(
    " 株式会社 ABC \thttps://a.example\t営業部\t候補",
    ["株式会社   ＡＢＣ"],
  ), null);
  assert.equal(companyNameKey(" 株式会社　ＡＢＣ "), "株式会社 abc");
});

test("fails closed for hostile values and an unbounded existing-name snapshot", () => {
  const hostile = new Proxy([], { get() { throw new Error("blocked"); } });
  assert.equal(prepareSalesBulkImport("企業\t\t\t", hostile), null);
  assert.equal(prepareSalesBulkImport("企業\t\t\t", Array.from({ length: 501 }, () => "企業")), null);
});

test("single registration authenticates, checks normalized duplicates, and exposes no raw errors", () => {
  const page = readFileSync(new URL("../app/sales/page.tsx", import.meta.url), "utf8");
  const action = page.slice(
    page.indexOf("async function createSalesLead("),
    page.indexOf("async function createSalesLeadsBulk("),
  );
  assert.ok(action.indexOf("supabase.auth.getUser()") < action.indexOf(".select(\"id, content\")"));
  assert.ok(action.includes("companyNameKey(lead.companyName)"));
  assert.ok(action.includes("companyNameKey(companyName) === candidateKey"));
  assert.ok(action.indexOf("lead-duplicate") < action.lastIndexOf(".insert("));
  assert.doesNotMatch(action, /throw new Error|\.message/u);
});
