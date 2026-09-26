import test from "node:test";
import assert from "node:assert/strict";
import {
  createSalesLeadRecord,
  completeSalesResearch,
  saveSalesOutreachDraft,
  approveSalesOutreachDraft,
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
    outreachDraft: null,
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

const outreach = { subject: "ご提案", body: "Web面談のご相談です。", signature: "テスト株式会社 営業担当\nsales@example.com" };
const approvalTime = "2026-09-27T00:00:00.000Z";
function researchedRecord() {
  return completeSalesResearch("lead-1", createSalesLeadRecord({ companyName: "工務店" }), "公式サイトを確認");
}
function changeRecord(content, changes) {
  return SALES_LEAD_RECORD_PREFIX + JSON.stringify({
    ...JSON.parse(content.slice(SALES_LEAD_RECORD_PREFIX.length)), ...changes,
  });
}

test("draft approval applies to saved text and editing revokes it without losing research", () => {
  const saved = saveSalesOutreachDraft("lead-1", researchedRecord(), outreach);
  assert.equal(parseSalesLeadRecord("lead-1", saved).outreachApproved, false);
  const approved = approveSalesOutreachDraft("lead-1", saved, "reviewer-1", approvalTime);
  assert.equal(parseSalesLeadRecord("lead-1", approved).outreachApproved, true);
  assert.equal(parseSalesLeadRecord("lead-1", approved).outreachRecordedAt, null);
  const audit = JSON.parse(approved.slice(SALES_LEAD_RECORD_PREFIX.length)).outreachApproval;
  assert.deepEqual(audit, { actorId: "reviewer-1", approvedAt: approvalTime });
  assert.equal(approveSalesOutreachDraft("lead-1", approved, "reviewer-1", approvalTime), null);
  const edited = saveSalesOutreachDraft("lead-1", approved, { ...outreach, body: "改訂済みの文面" });
  const lead = parseSalesLeadRecord("lead-1", edited);
  assert.equal(lead.outreachApproved, false);
  assert.equal(lead.researchNotes, "公式サイトを確認");
  assert.equal(JSON.parse(edited.slice(SALES_LEAD_RECORD_PREFIX.length)).outreachApproval, null);
});

test("approval requires a saved draft, signature and server audit fields", () => {
  const record = researchedRecord();
  assert.equal(approveSalesOutreachDraft("lead-1", record, "reviewer", approvalTime), null);
  const unsigned = saveSalesOutreachDraft("lead-1", record, { ...outreach, signature: "" });
  assert.ok(unsigned);
  assert.equal(approveSalesOutreachDraft("lead-1", unsigned, "reviewer", approvalTime), null);
  const saved = saveSalesOutreachDraft("lead-1", record, outreach);
  assert.equal(approveSalesOutreachDraft("lead-1", saved, "", approvalTime), null);
  assert.equal(approveSalesOutreachDraft("lead-1", saved, "reviewer", "invalid"), null);
});

test("draft edits and approvals stop on contact suppression and progressed records", () => {
  const saved = saveSalesOutreachDraft("lead-1", researchedRecord(), outreach);
  for (const changes of [
    { researchComplete: false }, { optedOut: true }, { optedOut: "false" },
    { appointmentConfirmed: true }, { outreachRecordedAt: approvalTime },
    { replies: [{ type: "OPT_OUT" }] }, { followUps: [{}] },
  ]) {
    const blocked = changeRecord(saved, changes);
    assert.equal(saveSalesOutreachDraft("lead-1", blocked, outreach), null);
    assert.equal(approveSalesOutreachDraft("lead-1", blocked, "reviewer", approvalTime), null);
  }
});

test("rejects header injection, blank and oversized drafts, and malformed stored drafts", () => {
  const record = researchedRecord();
  for (const input of [
    { ...outreach, subject: "提案\nBCC: other@example.com" },
    { ...outreach, body: " " }, { ...outreach, body: "x".repeat(4001) },
    { ...outreach, signature: "x".repeat(501) }, null,
  ]) assert.equal(saveSalesOutreachDraft("lead-1", record, input), null);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(record, { outreachDraft: { subject: "不完全" } })), null);
  const large = changeRecord(record, { extra: "x".repeat(10_000) });
  assert.equal(saveSalesOutreachDraft("lead-1", large, { ...outreach, body: "x".repeat(4000) }), null);
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
