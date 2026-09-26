import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesWorkQueue } from "../lib/sales-work-queue.js";
import { SALES_ACTIONS } from "../lib/sales-orchestrator.js";

const NOW = new Date("2026-09-27T00:00:00Z");
const sentLead = {
  researchComplete: true,
  outreachApproved: true,
  outreachRecordedAt: "2026-09-20T00:00:00Z",
};

test("prioritizes stop requests, human review, scheduling, and safe preparation", () => {
  const result = buildSalesWorkQueue([
    { id: "research", companyName: "株式会社研究", researchComplete: false },
    { id: "reply", companyName: "株式会社返信", ...sentLead, replies: [{ type: "GENERAL_QUESTION", receivedAt: "2026-09-26T00:00:00Z" }] },
    { id: "schedule", companyName: "株式会社日程", ...sentLead, replies: [{ type: "SCHEDULING", receivedAt: "2026-09-26T00:00:00Z" }] },
    { id: "review", companyName: "株式会社確認", ...sentLead, replies: [{ type: "CONTRACT", receivedAt: "2026-09-26T00:00:00Z" }] },
    { id: "stop", companyName: "株式会社停止", ...sentLead, optedOut: true },
  ], { now: NOW });

  assert.deepEqual(result.items.map(({ leadId, action, deliveryAllowed }) => ({ leadId, action, deliveryAllowed })), [
    { leadId: "stop", action: SALES_ACTIONS.STOP_CONTACT, deliveryAllowed: false },
    { leadId: "review", action: SALES_ACTIONS.HUMAN_REVIEW, deliveryAllowed: false },
    { leadId: "schedule", action: SALES_ACTIONS.PREPARE_MEETING_OPTIONS, deliveryAllowed: false },
    { leadId: "reply", action: SALES_ACTIONS.PREPARE_REPLY, deliveryAllowed: false },
    { leadId: "research", action: SALES_ACTIONS.RESEARCH_COMPANY, deliveryAllowed: false },
  ]);
});

test("keeps manual send recording visible but omits genuinely completed or waiting leads", () => {
  const result = buildSalesWorkQueue([
    { id: "record", companyName: "記録待ち", researchComplete: true, outreachApproved: true },
    { id: "waiting", companyName: "追客期限前", ...sentLead, outreachRecordedAt: "2026-09-26T00:00:00Z" },
    { id: "done", companyName: "アポ確定", ...sentLead, appointmentConfirmed: true },
  ], { now: NOW });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].leadId, "record");
  assert.equal(result.items[0].reason, "WAIT_FOR_HUMAN_SEND_RECORD");
  assert.equal(result.counts.noAction, 2);
});

test("deduplicates lead ids and reports malformed records without throwing", () => {
  const hostile = new Proxy({}, { get() { throw new Error("blocked"); } });
  const result = buildSalesWorkQueue([
    { id: "one", companyName: "一社目" },
    { id: "one", companyName: "重複" },
    { id: "", companyName: "IDなし" },
    hostile,
  ], { now: NOW });

  assert.equal(result.items.length, 1);
  assert.deepEqual(result.counts, { queued: 1, invalid: 2, duplicate: 1, noAction: 0, overflow: 0 });
});

test("caps output and preserves a deterministic order", () => {
  const result = buildSalesWorkQueue([
    { id: "b", companyName: "同名", researchComplete: false },
    { id: "a", companyName: "同名", researchComplete: false },
    { id: "c", companyName: "同名", researchComplete: false },
  ], { now: NOW, limit: 2 });

  assert.equal(result.items.length, 2);
  assert.equal(result.counts.overflow, 1);
  assert.deepEqual(result.items.map((item) => item.leadId), ["a", "b"]);
});

test("fails closed for invalid batches and dates", () => {
  assert.equal(buildSalesWorkQueue(null, { now: NOW }).invalidBatch, true);
  assert.equal(buildSalesWorkQueue([], { now: new Date("invalid") }).invalidBatch, true);
});

test("returns immutable queue records", () => {
  const result = buildSalesWorkQueue([{ id: "one", companyName: "一社目" }], { now: NOW });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.items), true);
  assert.equal(Object.isFrozen(result.items[0]), true);
  assert.equal(Object.isFrozen(result.counts), true);
});
