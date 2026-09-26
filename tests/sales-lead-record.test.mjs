import test from "node:test";
import assert from "node:assert/strict";
import {
  createSalesLeadRecord,
  completeSalesResearch,
  parseSalesLeadRecord,
  SALES_LEAD_RECORD_PREFIX,
} from "../lib/sales-lead-record.js";

test("creates a bounded initial sales lead record", () => {
  const content = createSalesLeadRecord({
    companyName: " テスト工務店 ",
    website: "https://example.com",
    contact: "sales@example.com",
    proposalFit: "住宅設備延長保証の提案候補",
  });

  assert.ok(content?.startsWith(SALES_LEAD_RECORD_PREFIX));
  assert.deepEqual(parseSalesLeadRecord("lead-1", content), {
    id: "lead-1",
    companyName: "テスト工務店",
    website: "https://example.com",
    contact: "sales@example.com",
    proposalFit: "住宅設備延長保証の提案候補",
    optedOut: false,
    researchNotes: "",
    appointmentConfirmed: false,
    researchComplete: false,
    outreachApproved: false,
    outreachRecordedAt: null,
    followUps: [],
    replies: [],
  });
});

test("rejects unsafe or incomplete create input", () => {
  assert.equal(createSalesLeadRecord({ companyName: "" }), null);
  assert.equal(createSalesLeadRecord({ companyName: "企業", website: "javascript:alert(1)" }), null);
  assert.equal(createSalesLeadRecord({ companyName: "企業", proposalFit: "x".repeat(2_001) }), null);
});

test("rejects malformed, oversized, and unrelated stored content", () => {
  assert.equal(parseSalesLeadRecord("lead-1", "other"), null);
  assert.equal(parseSalesLeadRecord("lead-1", `${SALES_LEAD_RECORD_PREFIX}{broken`), null);
  assert.equal(parseSalesLeadRecord("lead-1", `${SALES_LEAD_RECORD_PREFIX}${"x".repeat(12_001)}`), null);
});

test("fails closed for hostile objects", () => {
  const hostile = new Proxy({}, { get() { throw new Error("blocked"); } });
  assert.equal(createSalesLeadRecord(hostile), null);
});

test("research completion requires notes and never grants approval or delivery", () => {
  const original = createSalesLeadRecord({ companyName: "工務店" });
  assert.equal(completeSalesResearch("lead-1", original, " "), null);
  const updated = completeSalesResearch("lead-1", original, "公式サイトで新築住宅事業を確認");
  const lead = parseSalesLeadRecord("lead-1", updated);
  assert.equal(lead.researchComplete, true);
  assert.equal(lead.outreachApproved, false);
  assert.equal(lead.outreachRecordedAt, null);
  assert.equal(completeSalesResearch("lead-1", updated, "再実行"), null);
  for (const changes of [{ optedOut: true }, { replies: [{}] }, { outreachApproved: true }]) {
    const raw = JSON.parse(original.slice(SALES_LEAD_RECORD_PREFIX.length));
    const blocked = SALES_LEAD_RECORD_PREFIX + JSON.stringify({ ...raw, ...changes });
    assert.equal(completeSalesResearch("lead-1", blocked, "調査済み"), null);
  }
});
