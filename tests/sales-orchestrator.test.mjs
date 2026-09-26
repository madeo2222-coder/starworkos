import test from "node:test";
import assert from "node:assert/strict";
import { planSalesNextWork, SALES_ACTIONS, SALES_ROLES } from "../lib/sales-orchestrator.js";

const NOW = new Date("2026-09-22T00:00:00Z");
const sentLead = {
  researchComplete: true,
  outreachApproved: true,
  outreachRecordedAt: "2026-09-18T00:00:00Z",
};

function expectPlan(lead, ownerRole, action, reason) {
  assert.deepEqual(planSalesNextWork(lead, { now: NOW }), { ownerRole, action, reason, deliveryAllowed: false });
}

test("plans research before any customer contact preparation", () => {
  expectPlan({}, SALES_ROLES.RESEARCHER, SALES_ACTIONS.RESEARCH_COMPANY, "RESEARCH_REQUIRED");
});

test("requires human approval before outreach preparation", () => {
  expectPlan({ researchComplete: true }, SALES_ROLES.SALES_WRITER, SALES_ACTIONS.PREPARE_OUTREACH, "HUMAN_APPROVAL_REQUIRED");
});

test("never treats an approved message as delivered", () => {
  expectPlan({ researchComplete: true, outreachApproved: true }, SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION, "WAIT_FOR_HUMAN_SEND_RECORD");
});

test("keeps opt-out sticky even when other work is due", () => {
  expectPlan({ ...sentLead, optedOut: true }, SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.STOP_CONTACT, "OPT_OUT");
});

test("stops automation for sensitive and unknown replies", () => {
  for (const type of ["PRICE", "CONTRACT", "COMPLAINT", "PERSONAL_DATA", "UNKNOWN"]) {
    expectPlan({ ...sentLead, replies: [{ type, receivedAt: "2026-09-21T00:00:00Z" }] }, SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.HUMAN_REVIEW, `SENSITIVE_REPLY_${type}`);
  }
});

test("processes only the newest valid reply", () => {
  expectPlan({ ...sentLead, replies: [
    { type: "PRICE", receivedAt: "2026-09-19T00:00:00Z" },
    { type: "MATERIAL_REQUEST", receivedAt: "2026-09-21T00:00:00Z" },
  ] }, SALES_ROLES.SALES_WRITER, SALES_ACTIONS.PREPARE_REPLY, "SAFE_REPLY_MATERIAL_REQUEST");
});

test("routes scheduling reply to the scheduler without confirming anything", () => {
  expectPlan({ ...sentLead, replies: [{ type: "SCHEDULING", receivedAt: "2026-09-21T00:00:00Z" }] }, SALES_ROLES.SCHEDULER, SALES_ACTIONS.PREPARE_MEETING_OPTIONS, "SCHEDULING_REPLY");
});

test("does not offer follow-up before three days", () => {
  expectPlan({ ...sentLead, outreachRecordedAt: "2026-09-20T00:00:00Z" }, null, SALES_ACTIONS.NO_ACTION, "FOLLOW_UP_NOT_DUE");
});

test("prepares but never delivers a due follow-up", () => {
  expectPlan(sentLead, SALES_ROLES.SALES_WRITER, SALES_ACTIONS.PREPARE_FOLLOW_UP, "FOLLOW_UP_DUE");
});

test("caps follow-ups at two and routes the case to a human", () => {
  expectPlan({ ...sentLead, followUps: [
    { recordedAt: "2026-09-18T00:00:00Z" }, { recordedAt: "2026-09-19T00:00:00Z" },
  ] }, SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.HUMAN_REVIEW, "FOLLOW_UP_LIMIT_REACHED");
});

test("rejects malformed input safely", () => {
  assert.deepEqual(planSalesNextWork(new Proxy({}, { get() { throw new Error("nope"); } }), { now: NOW }), {
    ownerRole: null, action: SALES_ACTIONS.NO_ACTION, reason: "INVALID_INPUT", deliveryAllowed: false,
  });
});
