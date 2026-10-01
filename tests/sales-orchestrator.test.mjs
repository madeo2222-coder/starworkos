import test from "node:test";
import assert from "node:assert/strict";
import { planSalesNextWork, SALES_ACTIONS, SALES_ROLES } from "../lib/sales-orchestrator.js";

const NOW = new Date("2026-09-22T00:00:00Z");
const sentLead = {
  researchComplete: true,
  outreachApproved: true,
  outreachRecordedAt: "2026-09-18T00:00:00Z",
};

function confirmedAppointmentState({
  selectedSlot = "2026-09-22T01:00:00Z",
  durationMinutes = 60,
  confirmedBy = "scheduler",
  confirmedAt = "2026-09-21T20:30:00Z",
  meetingOptionsRecordedAt = "2026-09-21T20:00:00Z",
} = {}) {
  return {
    replies: [{ type: "SCHEDULING", receivedAt: "2026-09-21T19:00:00Z" }],
    meetingOptionsApproved: true,
    meetingOptionsRecordedAt,
    appointmentConfirmed: true,
    appointment: { selectedSlot, durationMinutes, confirmedBy, confirmedAt },
  };
}

function expectPlan(lead, ownerRole, action, reason) {
  assert.deepEqual(planSalesNextWork(lead, { now: NOW }), { ownerRole, action, reason, deliveryAllowed: false });
}

test("plans research before any customer contact preparation", () => {
  expectPlan({}, SALES_ROLES.RESEARCHER, SALES_ACTIONS.RESEARCH_COMPANY, "RESEARCH_REQUIRED");
});

test("requires human approval before outreach preparation", () => {
  expectPlan({ researchComplete: true }, SALES_ROLES.SALES_WRITER, SALES_ACTIONS.PREPARE_OUTREACH, "HUMAN_APPROVAL_REQUIRED");
});

test("validates supplied research evidence before outreach preparation", () => {
  const researchAudit = {
    actorId: "researcher-1",
    completedAt: "2026-09-21T00:00:00.000Z",
    sources: ["https://example.com/company"],
  };
  expectPlan({
    researchComplete: true,
    researchNotes: "公開情報を確認済み",
    researchAudit,
  }, SALES_ROLES.SALES_WRITER, SALES_ACTIONS.PREPARE_OUTREACH, "HUMAN_APPROVAL_REQUIRED");

  for (const forged of [
    { researchComplete: true, researchNotes: "", researchAudit },
    { researchComplete: true, researchNotes: "公開情報を確認済み", researchAudit: { ...researchAudit, actorId: "" } },
    { researchComplete: true, researchNotes: "公開情報を確認済み", researchAudit: { ...researchAudit, completedAt: "invalid" } },
    { researchComplete: true, researchNotes: "公開情報を確認済み", researchAudit: { ...researchAudit, sources: ["http://example.com/company"] } },
    { researchComplete: false, researchNotes: "公開情報を確認済み", researchAudit },
  ]) {
    expectPlan(forged, null, SALES_ACTIONS.NO_ACTION, "INVALID_INPUT");
  }
});

test("never treats an approved message as delivered", () => {
  expectPlan({ researchComplete: true, outreachApproved: true }, SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION, "WAIT_FOR_HUMAN_SEND_RECORD");
});

test("keeps opt-out sticky even when other work is due", () => {
  expectPlan({ ...sentLead, optedOut: true }, SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.STOP_CONTACT, "OPT_OUT");
});

test("fails safe when cached opt-out evidence has an invalid type", () => {
  expectPlan({ ...sentLead, optedOut: "false" }, SALES_ROLES.SALES_MANAGER,
    SALES_ACTIONS.STOP_CONTACT, "OPT_OUT");
});

test("honors a ninth final opt-out even before the cached flag catches up", () => {
  const replies = Array.from({ length: 9 }, (_, index) => ({
    type: index === 8 ? "OPT_OUT" : "GENERAL_QUESTION",
    receivedAt: `2026-09-${13 + index}T00:00:00Z`,
  }));
  expectPlan({ ...sentLead, outreachRecordedAt: "2026-09-12T00:00:00Z",
    optedOut: false, replies }, SALES_ROLES.SALES_MANAGER,
    SALES_ACTIONS.STOP_CONTACT, "OPT_OUT");
});

test("keeps a final opt-out ahead of confirmed appointment work", () => {
  expectPlan({
    ...sentLead,
    optedOut: false,
    appointmentConfirmed: true,
    appointment: { selectedSlot: "2026-09-22T01:00:00Z", durationMinutes: 60 },
    replies: [{ type: "OPT_OUT", receivedAt: "2026-09-21T23:30:00Z" }],
  }, SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.STOP_CONTACT, "OPT_OUT");
});

test("keeps a sensitive reply ahead of confirmed appointment work", () => {
  expectPlan({
    ...sentLead,
    appointmentConfirmed: true,
    appointment: { selectedSlot: "2026-09-22T01:00:00Z", durationMinutes: 60 },
    replies: [{ type: "COMPLAINT", receivedAt: "2026-09-21T23:30:00Z" }],
  }, SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.HUMAN_REVIEW,
  "SENSITIVE_REPLY_COMPLAINT");
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

test("approved safe replies wait for human delivery and recorded replies leave the queue", () => {
  const reply = [{ type: "GENERAL_QUESTION", receivedAt: "2026-09-21T00:00:00Z" }];
  expectPlan({ ...sentLead, replies: reply, replyApproved: true }, SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION, "WAIT_FOR_HUMAN_REPLY_SEND_RECORD");
  expectPlan({ ...sentLead, replies: reply, replyApproved: true, replyRecordedAt: "2026-09-21T01:00:00Z" }, null, SALES_ACTIONS.NO_ACTION, "REPLY_RECORDED");
});

test("routes scheduling reply to the scheduler without confirming anything", () => {
  expectPlan({ ...sentLead, replies: [{ type: "SCHEDULING", receivedAt: "2026-09-21T00:00:00Z" }] }, SALES_ROLES.SCHEDULER, SALES_ACTIONS.PREPARE_MEETING_OPTIONS, "SCHEDULING_REPLY");
});

test("approved meeting options wait for external sending without confirming an appointment", () => {
  expectPlan({
    ...sentLead,
    replies: [{ type: "SCHEDULING", receivedAt: "2026-09-21T00:00:00Z" }],
    meetingOptionsApproved: true,
  }, SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION, "WAIT_FOR_HUMAN_MEETING_OPTIONS_SEND_RECORD");
});

test("recorded meeting options require explicit appointment confirmation", () => {
  expectPlan({
    ...sentLead,
    replies: [{ type: "SCHEDULING", receivedAt: "2026-09-21T00:00:00Z" }],
    meetingOptionsApproved: true,
    meetingOptionsRecordedAt: "2026-09-21T01:00:00Z",
  }, SALES_ROLES.SCHEDULER, SALES_ACTIONS.CONFIRM_MEETING, "WAIT_FOR_MEETING_CONFIRMATION");
});

test("rejects forged appointment confirmation provenance and chronology", () => {
  const confirmed = confirmedAppointmentState();
  const withoutConfirmedBy = {
    selectedSlot: confirmed.appointment.selectedSlot,
    durationMinutes: confirmed.appointment.durationMinutes,
    confirmedAt: confirmed.appointment.confirmedAt,
  };

  for (const forged of [
    { ...confirmed, appointment: withoutConfirmedBy },
    {
      ...confirmed,
      appointment: { ...confirmed.appointment, confirmedAt: undefined },
    },
    { ...confirmed, meetingOptionsApproved: false },
    { ...confirmed, meetingOptionsRecordedAt: undefined },
    {
      ...confirmed,
      appointment: { ...confirmed.appointment, confirmedAt: "2026-09-21T19:59:59Z" },
    },
    {
      ...confirmed,
      appointment: {
        ...confirmed.appointment,
        selectedSlot: "2026-09-21T20:44:59Z",
      },
    },
    {
      ...confirmed,
      appointment: { ...confirmed.appointment, durationMinutes: 15 },
    },
  ]) {
    expectPlan({ ...sentLead, ...forged }, null, SALES_ACTIONS.NO_ACTION, "INVALID_INPUT");
  }
});

test("rejects forged approval and delivery chronology", () => {
  const reply = [{ type: "GENERAL_QUESTION", receivedAt: "2026-09-21T00:00:00Z" }];
  const schedulingReply = [{ type: "SCHEDULING", receivedAt: "2026-09-21T00:00:00Z" }];
  const confirmed = confirmedAppointmentState();
  const appointmentNoticeDraft = {
    subject: "Web面談日時確定のご案内", body: "本文", signature: "署名",
    savedBy: "scheduler", savedAt: "2026-09-21T23:00:00Z",
  };
  const appointmentReminderDraft = {
    subject: "Web面談前日のご案内", body: "本文", signature: "署名",
    savedBy: "scheduler", savedAt: "2026-09-21T23:40:00Z",
  };
  const notice = {
    appointmentNoticeDraft,
    appointmentNoticeApproved: true,
    appointmentNoticeRecordedAt: "2026-09-21T23:30:00Z",
  };

  for (const forged of [
    { replyApproved: true },
    { replies: reply, replyRecordedAt: "2026-09-21T01:00:00Z" },
    { replies: reply, replyApproved: true, replyRecordedAt: "2026-09-20T23:59:59Z" },
    { replies: reply, meetingOptionsApproved: true },
    { replies: schedulingReply, meetingOptionsRecordedAt: "2026-09-21T01:00:00Z" },
    {
      replies: schedulingReply,
      meetingOptionsApproved: true,
      meetingOptionsRecordedAt: "2026-09-20T23:59:59Z",
    },
    { ...confirmed, appointmentNoticeApproved: true },
    {
      ...confirmed,
      appointmentNoticeDraft,
      appointmentNoticeRecordedAt: "2026-09-21T23:30:00Z",
    },
    {
      ...confirmed,
      appointmentNoticeDraft,
      appointmentNoticeApproved: true,
      appointmentNoticeRecordedAt: "2026-09-21T22:59:59Z",
    },
    {
      ...confirmed,
      ...notice,
      appointmentReminderApproved: true,
    },
    {
      ...confirmed,
      ...notice,
      appointmentReminderDraft,
      appointmentReminderRecordedAt: "2026-09-21T23:50:00Z",
    },
    {
      ...confirmed,
      ...notice,
      appointmentReminderDraft,
      appointmentReminderApproved: true,
      appointmentReminderRecordedAt: "2026-09-21T23:39:59Z",
    },
  ]) {
    expectPlan({ ...sentLead, ...forged }, null, SALES_ACTIONS.NO_ACTION, "INVALID_INPUT");
  }
});

test("keeps appointment notice and reminder approval and delivery human-controlled", () => {
  const confirmed = confirmedAppointmentState();
  const appointmentNoticeDraft = {
    subject: "Web面談日時確定のご案内", body: "本文", signature: "署名",
    savedBy: "scheduler", savedAt: "2026-09-21T23:00:00Z",
  };
  expectPlan({ ...sentLead, ...confirmed }, SALES_ROLES.SCHEDULER,
    SALES_ACTIONS.PREPARE_APPOINTMENT_NOTICE, "APPOINTMENT_NOTICE_REQUIRED");
  expectPlan({ ...sentLead, ...confirmed, appointmentNoticeDraft },
    SALES_ROLES.SCHEDULER, SALES_ACTIONS.PREPARE_APPOINTMENT_NOTICE,
    "APPOINTMENT_NOTICE_APPROVAL_REQUIRED");
  expectPlan({ ...sentLead, ...confirmed,
    appointmentNoticeDraft, appointmentNoticeApproved: true,
  }, SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION,
  "WAIT_FOR_HUMAN_APPOINTMENT_NOTICE_SEND_RECORD");
  expectPlan({ ...sentLead, ...confirmed,
    appointmentNoticeDraft, appointmentNoticeApproved: true,
    appointmentNoticeRecordedAt: "2026-09-21T23:30:00Z",
  }, SALES_ROLES.SCHEDULER, SALES_ACTIONS.PREPARE_APPOINTMENT_REMINDER,
  "APPOINTMENT_REMINDER_REQUIRED");
  const appointmentReminderDraft = {
    subject: "Web面談前日のご案内", body: "本文", signature: "署名",
    savedBy: "scheduler", savedAt: "2026-09-21T23:40:00Z",
  };
  expectPlan({ ...sentLead, ...confirmed,
    appointmentNoticeDraft, appointmentNoticeApproved: true,
    appointmentNoticeRecordedAt: "2026-09-21T23:30:00Z", appointmentReminderDraft,
  }, SALES_ROLES.SCHEDULER, SALES_ACTIONS.PREPARE_APPOINTMENT_REMINDER,
  "APPOINTMENT_REMINDER_APPROVAL_REQUIRED");
  expectPlan({ ...sentLead, ...confirmed,
    appointmentNoticeDraft, appointmentNoticeApproved: true,
    appointmentNoticeRecordedAt: "2026-09-21T23:30:00Z", appointmentReminderDraft,
    appointmentReminderApproved: true,
  }, SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION,
  "WAIT_FOR_HUMAN_APPOINTMENT_REMINDER_SEND_RECORD");
  expectPlan({ ...sentLead, ...confirmed,
    appointmentNoticeDraft, appointmentNoticeApproved: true,
    appointmentNoticeRecordedAt: "2026-09-21T23:30:00Z", appointmentReminderDraft,
    appointmentReminderApproved: true, appointmentReminderRecordedAt: "2026-09-21T23:50:00Z",
  }, null, SALES_ACTIONS.NO_ACTION, "APPOINTMENT_SCHEDULED");
});

test("does not prepare an appointment reminder before the final 24 hours", () => {
  expectPlan({ ...sentLead, ...confirmedAppointmentState({
    selectedSlot: "2026-09-24T01:00:00Z",
  }),
    appointmentNoticeDraft: {
      subject: "確定案内", body: "本文", signature: "署名",
      savedBy: "scheduler", savedAt: "2026-09-21T00:00:00Z",
    },
    appointmentNoticeApproved: true,
    appointmentNoticeRecordedAt: "2026-09-21T01:00:00Z",
  }, null, SALES_ACTIONS.NO_ACTION, "APPOINTMENT_REMINDER_NOT_DUE");
});

test("queues an unrecorded appointment outcome only after the meeting ends", () => {
  expectPlan({ ...sentLead, ...confirmedAppointmentState({
    selectedSlot: "2026-09-22T00:00:00Z",
  }),
  }, null, SALES_ACTIONS.NO_ACTION, "APPOINTMENT_IN_PROGRESS");
  expectPlan({ ...sentLead, ...confirmedAppointmentState({
    selectedSlot: "2026-09-21T22:00:00Z", durationMinutes: 30,
  }),
  }, SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.RECORD_APPOINTMENT_OUTCOME,
  "APPOINTMENT_OUTCOME_REQUIRED");
  expectPlan({ ...sentLead, ...confirmedAppointmentState({
    selectedSlot: "2026-09-21T22:00:00Z", durationMinutes: 30,
  }),
    appointmentOutcome: { result: "WON" },
  }, null, SALES_ACTIONS.NO_ACTION, "APPOINTMENT_OUTCOME_RECORDED");
});

test("rejects forged appointment outcome and post-meeting follow-up chronology", () => {
  const confirmed = confirmedAppointmentState({
    selectedSlot: "2026-09-21T22:00:00Z",
    durationMinutes: 30,
  });
  const appointmentOutcome = {
    result: "FOLLOW_UP",
    recordedAt: "2026-09-21T23:00:00Z",
  };
  const postMeetingFollowUp = {
    createdAt: "2026-09-21T23:30:00Z",
    dueAt: "2026-09-24T23:30:00Z",
    completedAt: null,
  };

  for (const forged of [
    {
      appointmentConfirmed: false,
      appointmentOutcome,
    },
    {
      appointmentOutcome: {
        ...appointmentOutcome,
        recordedAt: "2026-09-21T22:29:59Z",
      },
    },
    {
      appointmentOutcome,
      postMeetingFollowUp: {
        ...postMeetingFollowUp,
        createdAt: "2026-09-21T22:59:59Z",
      },
    },
    {
      appointmentOutcome,
      postMeetingFollowUp: {
        ...postMeetingFollowUp,
        dueAt: "2026-09-21T23:29:59Z",
      },
    },
    {
      appointmentOutcome,
      postMeetingFollowUp: {
        ...postMeetingFollowUp,
        completedAt: "2026-09-21T23:29:59Z",
      },
    },
    {
      appointmentOutcome: null,
      postMeetingFollowUp,
    },
    {
      appointmentOutcome: {
        ...appointmentOutcome,
        result: "WON",
      },
      postMeetingFollowUp,
    },
  ]) {
    expectPlan({
      ...sentLead,
      ...confirmed,
      ...forged,
    }, null, SALES_ACTIONS.NO_ACTION, "INVALID_INPUT");
  }
});

test("does not offer follow-up before three days", () => {
  expectPlan({ ...sentLead, outreachRecordedAt: "2026-09-20T00:00:00Z" }, null, SALES_ACTIONS.NO_ACTION, "FOLLOW_UP_NOT_DUE");
});

test("prepares but never delivers a due follow-up", () => {
  expectPlan(sentLead, SALES_ROLES.SALES_WRITER, SALES_ACTIONS.PREPARE_FOLLOW_UP, "FOLLOW_UP_DUE");
});

test("keeps saved and approved follow-up drafts in the human-controlled flow", () => {
  const followUpDraft = {
    subject: "ご確認", body: "本文", signature: "署名",
    savedBy: "writer", savedAt: "2026-09-23T00:00:00Z",
  };
  expectPlan({ ...sentLead, followUpDraft }, SALES_ROLES.SALES_WRITER,
    SALES_ACTIONS.PREPARE_FOLLOW_UP, "FOLLOW_UP_APPROVAL_REQUIRED");
  expectPlan({ ...sentLead, followUpDraft, followUpApproved: true },
    SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION,
    "WAIT_FOR_HUMAN_FOLLOW_UP_SEND_RECORD");
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

test("rejects malformed, reordered, and impossible contact histories", () => {
  const invalidHistories = [
    { ...sentLead, replies: [{}] },
    { ...sentLead, replies: [{ type: "NOT_SUPPORTED", receivedAt: "2026-09-21T00:00:00Z" }] },
    { ...sentLead, replies: [
      { type: "GENERAL_QUESTION", receivedAt: "2026-09-21T00:00:00Z" },
      { type: "MATERIAL_REQUEST", receivedAt: "2026-09-20T00:00:00Z" },
    ] },
    { researchComplete: true, outreachApproved: true,
      replies: [{ type: "GENERAL_QUESTION", receivedAt: "2026-09-21T00:00:00Z" }] },
    { ...sentLead, followUps: [{}] },
    { ...sentLead, followUps: [
      { recordedAt: "2026-09-21T00:00:00Z" },
      { recordedAt: "2026-09-20T00:00:00Z" },
    ] },
    { ...sentLead, followUps: [{ recordedAt: "2026-09-21T00:00:00Z" }],
      replies: [{ type: "GENERAL_QUESTION", receivedAt: "2026-09-20T00:00:00Z" }] },
  ];

  for (const lead of invalidHistories) {
    expectPlan(lead, null, SALES_ACTIONS.NO_ACTION, "INVALID_INPUT");
  }
});
