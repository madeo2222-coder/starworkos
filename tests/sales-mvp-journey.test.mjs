import test from "node:test";
import assert from "node:assert/strict";
import {
  approveSalesMeetingOptions,
  approveSalesOutreachDraft,
  completeSalesResearch,
  confirmSalesAppointment,
  createSalesLeadRecord,
  parseSalesLeadRecord,
  recordSalesMeetingOptionsDelivery,
  recordSalesOutreachDelivery,
  recordSalesReply,
  saveSalesMeetingOptions,
  saveSalesOutreachDraft,
} from "../lib/sales-lead-record.js";
import { planSalesNextWork, SALES_ACTIONS, SALES_ROLES } from "../lib/sales-orchestrator.js";
import { buildSalesWorkQueue } from "../lib/sales-work-queue.js";

const ID = "journey-lead";
const NOW = new Date("2026-09-27T04:00:00.000Z");

function lead(content) {
  const parsed = parseSalesLeadRecord(ID, content);
  assert.ok(parsed, "the persisted record must remain valid throughout the journey");
  return parsed;
}

function expectWork(content, ownerRole, action, reason) {
  const parsed = lead(content);
  assert.deepEqual(planSalesNextWork(parsed, { now: NOW }), {
    ownerRole, action, reason, deliveryAllowed: false,
  });
  const queue = buildSalesWorkQueue([parsed], { now: NOW });
  assert.equal(queue.invalidBatch, false);
  const visibleManualRecord = reason === "WAIT_FOR_HUMAN_SEND_RECORD"
    || reason === "WAIT_FOR_HUMAN_REPLY_SEND_RECORD"
    || reason === "WAIT_FOR_HUMAN_MEETING_OPTIONS_SEND_RECORD";
  if (ownerRole === null || (action === SALES_ACTIONS.NO_ACTION && !visibleManualRecord)) {
    assert.equal(queue.items.length, 0);
  } else {
    assert.equal(queue.items.length, 1);
    assert.deepEqual({
      ownerRole: queue.items[0].ownerRole,
      action: queue.items[0].action,
      reason: queue.items[0].reason,
      deliveryAllowed: queue.items[0].deliveryAllowed,
    }, { ownerRole, action, reason, deliveryAllowed: false });
  }
}

test("runs one sales lead from registration through a confirmed appointment", () => {
  let content = createSalesLeadRecord({
    companyName: "テスト工務店",
    website: "https://example.com",
    contact: "sales@example.com",
    proposalFit: "住宅設備延長保証の提案候補",
  });
  expectWork(content, SALES_ROLES.RESEARCHER, SALES_ACTIONS.RESEARCH_COMPANY, "RESEARCH_REQUIRED");

  content = completeSalesResearch(ID, content, "公式サイトで住宅設備事業と問い合わせ窓口を確認");
  expectWork(content, SALES_ROLES.SALES_WRITER, SALES_ACTIONS.PREPARE_OUTREACH, "HUMAN_APPROVAL_REQUIRED");

  content = saveSalesOutreachDraft(ID, content, {
    subject: "住宅設備延長保証のご提案",
    body: "御社の住宅設備事業に合う延長保証をご案内します。",
    signature: "STAR WORK OS 営業担当\nsales@example.com",
  });
  content = approveSalesOutreachDraft(ID, content, "sales-manager", "2026-09-27T00:30:00.000Z");
  expectWork(content, SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION, "WAIT_FOR_HUMAN_SEND_RECORD");

  content = recordSalesOutreachDelivery(
    ID, content, "delivery-operator", "2026-09-27T01:00:00.000Z", "EMAIL",
  );
  assert.ok(content);

  content = recordSalesReply(ID, content, {
    channel: "EMAIL",
    type: "SCHEDULING",
    message: "オンラインで説明を聞きたいので候補日時をください。",
  }, "sales-operator", "2026-09-27T02:00:00.000Z");
  expectWork(content, SALES_ROLES.SCHEDULER, SALES_ACTIONS.PREPARE_MEETING_OPTIONS, "SCHEDULING_REPLY");

  content = saveSalesMeetingOptions(ID, content, [
    "2026-09-29T01:00:00.000Z",
    "2026-09-28T01:00:00.000Z",
  ], 30, "scheduler", "2026-09-27T02:30:00.000Z");
  content = approveSalesMeetingOptions(ID, content, "sales-manager", "2026-09-27T02:45:00.000Z");
  expectWork(content, SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION, "WAIT_FOR_HUMAN_MEETING_OPTIONS_SEND_RECORD");

  content = recordSalesMeetingOptionsDelivery(
    ID, content, "delivery-operator", "2026-09-27T03:00:00.000Z",
  );
  expectWork(content, SALES_ROLES.SCHEDULER, SALES_ACTIONS.CONFIRM_MEETING, "WAIT_FOR_MEETING_CONFIRMATION");

  content = confirmSalesAppointment(ID, content, {
    selectedSlot: "2026-09-28T01:00:00.000Z",
    meetingUrl: "https://zoom.us/j/123456789",
    notes: "営業責任者が参加",
  }, "scheduler", "2026-09-27T04:00:00.000Z");

  const confirmed = lead(content);
  assert.equal(confirmed.appointmentConfirmed, true);
  assert.equal(confirmed.appointment.selectedSlot, "2026-09-28T01:00:00.000Z");
  assert.equal(confirmed.appointment.meetingUrl, "https://zoom.us/j/123456789");
  expectWork(content, SALES_ROLES.SCHEDULER, SALES_ACTIONS.NO_ACTION, "APPOINTMENT_CONFIRMED");
});
