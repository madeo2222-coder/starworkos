import test from "node:test";
import assert from "node:assert/strict";
import {
  createSalesLeadRecord,
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
