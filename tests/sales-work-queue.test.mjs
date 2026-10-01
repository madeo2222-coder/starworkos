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

function confirmedAppointmentState({
  selectedSlot = "2026-09-28T01:00:00Z",
  durationMinutes = 30,
  confirmedBy = "scheduler",
  confirmedAt = "2026-09-25T03:00:00Z",
  meetingOptionsRecordedAt = "2026-09-25T02:00:00Z",
} = {}) {
  return {
    replies: [{ type: "SCHEDULING", receivedAt: "2026-09-25T00:00:00Z" }],
    meetingOptionsApproved: true,
    meetingOptionsRecordedAt,
    appointmentConfirmed: true,
    appointment: { selectedSlot, durationMinutes, confirmedBy, confirmedAt },
  };
}

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

test("fails safe when cached opt-out evidence has an invalid type", () => {
  const result = buildSalesWorkQueue([{
    id: "malformed-stop", companyName: "停止状態確認社", ...sentLead,
    optedOut: "false",
  }], { now: NOW });

  assert.equal(result.counts.invalid, 0);
  assert.equal(result.items[0].action, SALES_ACTIONS.STOP_CONTACT);
  assert.equal(result.items[0].reason, "OPT_OUT");
});

test("excludes a lead with forged supplied research evidence", () => {
  const result = buildSalesWorkQueue([
    {
      id: "forged-research",
      companyName: "監査不正社",
      researchComplete: true,
      researchNotes: "公開情報を確認済み",
      researchAudit: {
        actorId: "researcher-1",
        completedAt: "invalid",
        sources: ["https://example.com/company"],
      },
    },
    { id: "valid", companyName: "正常社", researchComplete: false },
  ], { now: NOW });

  assert.deepEqual(result.items.map((item) => item.leadId), ["valid"]);
  assert.equal(result.counts.invalid, 1);
});

test("keeps a ninth final opt-out actionable after eight prior replies", () => {
  const replies = Array.from({ length: 9 }, (_, index) => ({
    type: index === 8 ? "OPT_OUT" : "GENERAL_QUESTION",
    receivedAt: `2026-09-${18 + index}T00:00:00Z`,
  }));
  const result = buildSalesWorkQueue([{
    id: "capacity-stop", companyName: "停止依頼社", ...sentLead,
    outreachRecordedAt: "2026-09-17T00:00:00Z", replies, optedOut: true,
  }], { now: NOW });
  assert.equal(result.counts.invalid, 0);
  assert.equal(result.items[0].action, SALES_ACTIONS.STOP_CONTACT);
});

test("fails safe when final opt-out evidence arrives before the cached flag", () => {
  const replies = Array.from({ length: 9 }, (_, index) => ({
    type: index === 8 ? "OPT_OUT" : "GENERAL_QUESTION",
    receivedAt: `2026-09-${18 + index}T00:00:00Z`,
  }));
  const result = buildSalesWorkQueue([{
    id: "stale-capacity-stop", companyName: "停止反映待ち社", ...sentLead,
    outreachRecordedAt: "2026-09-17T00:00:00Z", replies, optedOut: false,
  }], { now: NOW });
  assert.equal(result.counts.invalid, 0);
  assert.equal(result.items[0].action, SALES_ACTIONS.STOP_CONTACT);
});

test("keeps final opt-out evidence visible after appointment confirmation", () => {
  const result = buildSalesWorkQueue([{
    id: "appointment-stop", companyName: "面談後停止社", ...sentLead,
    ...confirmedAppointmentState(),
    replies: [{ type: "OPT_OUT", receivedAt: "2026-09-26T02:00:00Z" }],
    optedOut: false,
  }], { now: NOW });
  assert.equal(result.counts.invalid, 0);
  assert.equal(result.items[0].action, SALES_ACTIONS.STOP_CONTACT);
  assert.equal(result.items[0].reason, "OPT_OUT");
});

test("keeps a sensitive reply visible after appointment confirmation", () => {
  const result = buildSalesWorkQueue([{
    id: "appointment-review", companyName: "面談後確認社", ...sentLead,
    ...confirmedAppointmentState(),
    replies: [{ type: "CONTRACT", receivedAt: "2026-09-26T02:00:00Z" }],
  }], { now: NOW });
  assert.equal(result.counts.invalid, 0);
  assert.equal(result.items[0].action, SALES_ACTIONS.HUMAN_REVIEW);
  assert.equal(result.items[0].reason, "SENSITIVE_REPLY_CONTRACT");
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
  assert.equal(result.counts.noAction, 1);
  assert.equal(result.counts.invalid, 1);
});

test("keeps approved reply delivery recording visible", () => {
  const result = buildSalesWorkQueue([{
    id: "reply-record", companyName: "返信記録待ち", ...sentLead,
    replies: [{ type: "GENERAL_QUESTION", receivedAt: "2026-09-26T00:00:00Z" }],
    replyApproved: true,
  }], { now: NOW });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].leadId, "reply-record");
  assert.equal(result.items[0].reason, "WAIT_FOR_HUMAN_REPLY_SEND_RECORD");
});

test("keeps approved follow-up delivery recording visible", () => {
  const followUpDraft = {
    subject: "ご確認", body: "本文", signature: "署名",
    savedBy: "writer", savedAt: "2026-09-23T00:00:00Z",
  };
  const result = buildSalesWorkQueue([{
    id: "follow-up-send", companyName: "追客送信待ち", ...sentLead,
    followUpDraft, followUpApproved: true,
  }], { now: NOW });
  assert.equal(result.items[0].leadId, "follow-up-send");
  assert.equal(result.items[0].reason, "WAIT_FOR_HUMAN_FOLLOW_UP_SEND_RECORD");
});

test("omits a reply after its manual delivery has been recorded", () => {
  const result = buildSalesWorkQueue([{
    id: "reply-done", companyName: "返信完了", ...sentLead,
    replies: [{ type: "GENERAL_QUESTION", receivedAt: "2026-09-26T00:00:00Z" }],
    replyApproved: true,
    replyRecordedAt: "2026-09-26T01:00:00Z",
  }], { now: NOW });

  assert.equal(result.items.length, 0);
  assert.equal(result.counts.noAction, 1);
});

test("keeps approved meeting-option sending visible", () => {
  const result = buildSalesWorkQueue([{
    id: "meeting-send", companyName: "候補送信待ち", ...sentLead,
    replies: [{ type: "SCHEDULING", receivedAt: "2026-09-26T00:00:00Z" }],
    meetingOptionsApproved: true,
  }], { now: NOW });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].leadId, "meeting-send");
  assert.equal(result.items[0].reason, "WAIT_FOR_HUMAN_MEETING_OPTIONS_SEND_RECORD");
});

test("queues appointment confirmation after meeting options were delivered", () => {
  const result = buildSalesWorkQueue([{
    id: "meeting-wait", companyName: "候補回答待ち", ...sentLead,
    replies: [{ type: "SCHEDULING", receivedAt: "2026-09-26T00:00:00Z" }],
    meetingOptionsApproved: true,
    meetingOptionsRecordedAt: "2026-09-26T01:00:00Z",
  }], { now: NOW });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].action, SALES_ACTIONS.CONFIRM_MEETING);
  assert.equal(result.items[0].reason, "WAIT_FOR_MEETING_CONFIRMATION");
});

test("counts missing and forged appointment confirmation chronology as invalid", () => {
  const confirmed = {
    ...sentLead,
    replies: [{ type: "SCHEDULING", receivedAt: "2026-09-25T00:00:00Z" }],
    meetingOptionsApproved: true,
    meetingOptionsRecordedAt: "2026-09-25T02:00:00Z",
    appointmentConfirmed: true,
    appointment: {
      selectedSlot: "2026-09-27T01:00:00Z",
      durationMinutes: 30,
      confirmedBy: "scheduler",
      confirmedAt: "2026-09-25T03:00:00Z",
    },
  };
  const result = buildSalesWorkQueue([
    {
      id: "missing-confirmation-audit", companyName: "確定監査欠落社", ...confirmed,
      appointment: {
        selectedSlot: confirmed.appointment.selectedSlot,
        durationMinutes: confirmed.appointment.durationMinutes,
      },
    },
    {
      id: "confirmed-before-options", companyName: "候補送信前確定社", ...confirmed,
      appointment: { ...confirmed.appointment, confirmedAt: "2026-09-25T01:59:59Z" },
    },
    {
      id: "confirmed-too-late", companyName: "開始直前確定社", ...confirmed,
      appointment: { ...confirmed.appointment, selectedSlot: "2026-09-25T03:14:59Z" },
    },
    { id: "valid-confirmation", companyName: "正常確定社", ...confirmed },
  ], { now: NOW });

  assert.deepEqual(result.items.map((item) => item.leadId), ["valid-confirmation"]);
  assert.deepEqual(result.counts, {
    queued: 1, invalid: 3, duplicate: 0, noAction: 0, overflow: 0,
  });
});

test("counts forged approval and delivery chronology as invalid", () => {
  const result = buildSalesWorkQueue([
    {
      id: "reply-without-approval", companyName: "未承認返信記録", ...sentLead,
      replies: [{ type: "GENERAL_QUESTION", receivedAt: "2026-09-26T00:00:00Z" }],
      replyRecordedAt: "2026-09-26T01:00:00Z",
    },
    {
      id: "meeting-before-reply", companyName: "返信前候補送信", ...sentLead,
      replies: [{ type: "SCHEDULING", receivedAt: "2026-09-26T00:00:00Z" }],
      meetingOptionsApproved: true,
      meetingOptionsRecordedAt: "2026-09-25T23:59:59Z",
    },
  ], { now: NOW });

  assert.equal(result.items.length, 0);
  assert.equal(result.counts.invalid, 2);
});

test("queues appointment notice approval and manual delivery recording", () => {
  const confirmed = confirmedAppointmentState();
  const appointmentNoticeDraft = {
    subject: "Web面談日時確定のご案内", body: "本文", signature: "署名",
    savedBy: "scheduler", savedAt: "2026-09-27T01:00:00Z",
  };
  const result = buildSalesWorkQueue([
    {
      id: "notice-review", companyName: "案内承認待ち", ...sentLead,
      ...confirmed, appointmentNoticeDraft,
    },
    {
      id: "notice-send", companyName: "案内送信記録待ち", ...sentLead,
      ...confirmed, appointmentNoticeDraft,
      appointmentNoticeApproved: true,
    },
  ], { now: NOW });

  assert.deepEqual(result.items.map(({ leadId, action, reason }) => ({ leadId, action, reason })), [
    {
      leadId: "notice-review", action: SALES_ACTIONS.PREPARE_APPOINTMENT_NOTICE,
      reason: "APPOINTMENT_NOTICE_APPROVAL_REQUIRED",
    },
    {
      leadId: "notice-send", action: SALES_ACTIONS.NO_ACTION,
      reason: "WAIT_FOR_HUMAN_APPOINTMENT_NOTICE_SEND_RECORD",
    },
  ]);
});

test("queues appointment reminder approval and manual delivery recording", () => {
  const confirmed = confirmedAppointmentState({ selectedSlot: "2026-09-27T12:00:00Z" });
  const notice = {
    appointmentNoticeDraft: {
      subject: "確定案内", body: "本文", signature: "署名",
      savedBy: "scheduler", savedAt: "2026-09-26T01:00:00Z",
    },
    appointmentNoticeApproved: true,
    appointmentNoticeRecordedAt: "2026-09-26T02:00:00Z",
  };
  const appointmentReminderDraft = {
    subject: "Web面談前日のご案内", body: "本文", signature: "署名",
    savedBy: "scheduler", savedAt: "2026-09-27T00:00:00Z",
  };
  const result = buildSalesWorkQueue([
    {
      id: "reminder-review", companyName: "前日案内承認待ち", ...sentLead,
      ...confirmed, ...notice, appointmentReminderDraft,
    },
    {
      id: "reminder-send", companyName: "前日案内送信記録待ち", ...sentLead,
      ...confirmed, ...notice, appointmentReminderDraft,
      appointmentReminderApproved: true,
    },
  ], { now: NOW });

  assert.deepEqual(result.items.map(({ leadId, action, reason }) => ({ leadId, action, reason })), [
    {
      leadId: "reminder-review", action: SALES_ACTIONS.PREPARE_APPOINTMENT_REMINDER,
      reason: "APPOINTMENT_REMINDER_APPROVAL_REQUIRED",
    },
    {
      leadId: "reminder-send", action: SALES_ACTIONS.NO_ACTION,
      reason: "WAIT_FOR_HUMAN_APPOINTMENT_REMINDER_SEND_RECORD",
    },
  ]);
});

test("queues an ended appointment until its result is recorded", () => {
  const result = buildSalesWorkQueue([{
    id: "outcome", companyName: "結果待ち", ...sentLead,
    ...confirmedAppointmentState({ selectedSlot: "2026-09-26T01:00:00Z" }),
    appointmentOutcome: null,
  }], { now: NOW });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].action, SALES_ACTIONS.RECORD_APPOINTMENT_OUTCOME);
  assert.equal(result.items[0].reason, "APPOINTMENT_OUTCOME_REQUIRED");
  assert.equal(result.items[0].priority, 2);
});

test("queues required and overdue post-meeting follow-up work", () => {
  const base = {
    ...sentLead,
    ...confirmedAppointmentState({ selectedSlot: "2026-09-26T01:00:00Z" }),
    appointmentOutcome: { result: "FOLLOW_UP" },
  };
  const result = buildSalesWorkQueue([
    { id: "schedule-follow-up", companyName: "設定待ち", ...base },
    {
      id: "complete-follow-up", companyName: "期限到来", ...base,
      postMeetingFollowUp: {
        dueAt: "2026-09-27T00:00:00Z",
        createdAt: "2026-09-26T03:00:00Z",
        completedAt: null,
      },
    },
    {
      id: "future-follow-up", companyName: "期限前", ...base,
      postMeetingFollowUp: {
        dueAt: "2026-09-28T00:00:00Z",
        createdAt: "2026-09-26T03:00:00Z",
        completedAt: null,
      },
    },
  ], { now: NOW });

  assert.deepEqual(result.items.map(({ leadId, action, reason }) => ({ leadId, action, reason })), [
    {
      leadId: "complete-follow-up",
      action: SALES_ACTIONS.COMPLETE_POST_MEETING_FOLLOW_UP,
      reason: "POST_MEETING_FOLLOW_UP_DUE",
    },
    {
      leadId: "schedule-follow-up",
      action: SALES_ACTIONS.SCHEDULE_POST_MEETING_FOLLOW_UP,
      reason: "POST_MEETING_FOLLOW_UP_REQUIRED",
    },
  ]);
  assert.equal(result.counts.noAction, 1);
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

test("rejects oversized, non-array, and internally invalid workflow state", () => {
  const result = buildSalesWorkQueue([
    {
      id: "reply-overflow", companyName: "返信超過",
      ...sentLead,
      replies: Array.from({ length: 9 }, (_, index) => ({
        type: "GENERAL_QUESTION",
        receivedAt: `2026-09-2${index % 7}T00:00:00Z`,
      })),
      followUps: [],
    },
    {
      id: "follow-up-overflow", companyName: "追客超過",
      ...sentLead,
      replies: [],
      followUps: [
        { recordedAt: "2026-09-21T00:00:00Z" },
        { recordedAt: "2026-09-22T00:00:00Z" },
        { recordedAt: "2026-09-23T00:00:00Z" },
      ],
    },
    { id: "reply-object", companyName: "返信配列不正", replies: {}, followUps: [] },
    { id: "follow-up-object", companyName: "追客配列不正", replies: [], followUps: {} },
    { id: "reply-entry", companyName: "返信要素不正", ...sentLead,
      replies: [{}], followUps: [] },
    { id: "follow-up-entry", companyName: "追客要素不正", ...sentLead,
      replies: [], followUps: [{}] },
    { id: "contact-order", companyName: "接触順序不正", ...sentLead,
      replies: [{ type: "GENERAL_QUESTION", receivedAt: "2026-09-21T00:00:00Z" }],
      followUps: [{ recordedAt: "2026-09-22T00:00:00Z" }] },
    {
      id: "planner-invalid", companyName: "内部状態不正",
      ...sentLead,
      appointmentConfirmed: true,
      appointment: { selectedSlot: "2026-09-26T01:00:00Z", durationMinutes: 30 },
      appointmentOutcome: { result: "FOLLOW_UP" },
      postMeetingFollowUp: { dueAt: "invalid", createdAt: "2026-09-26T03:00:00Z", completedAt: null },
      replies: [],
      followUps: [],
    },
    { id: "valid", companyName: "正常", replies: [], followUps: [] },
  ], { now: NOW });

  assert.deepEqual(result.items.map((item) => item.leadId), ["valid"]);
  assert.deepEqual(result.counts, {
    queued: 1, invalid: 8, duplicate: 0, noAction: 0, overflow: 0,
  });
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
