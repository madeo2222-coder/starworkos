import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesAuditTimeline } from "../lib/sales-audit-timeline.js";

const audit = (actorId, approvedAt) => ({ actorId, approvedAt });
const delivery = (actorId, recordedAt, channel = "EMAIL") => ({ actorId, recordedAt, channel });

test("builds a chronological read-only audit timeline for a completed appointment", () => {
  const events = buildSalesAuditTimeline({
    researchAudit: {
      sources: ["https://example.com/company"],
      actorId: "researcher",
      completedAt: "2026-09-27T00:00:00.000Z",
    },
    outreachApproval: audit("manager", "2026-09-27T00:30:00.000Z"),
    outreachDelivery: delivery("sender", "2026-09-27T01:00:00.000Z"),
    replyApproval: null,
    replyDelivery: null,
    meetingOptionsDraft: { savedBy: "scheduler", savedAt: "2026-09-27T02:15:00.000Z" },
    meetingOptionsApproval: audit("manager", "2026-09-27T02:30:00.000Z"),
    meetingOptionsDelivery: delivery("sender", "2026-09-27T03:00:00.000Z"),
    appointment: {
      confirmedBy: "scheduler", confirmedAt: "2026-09-27T04:00:00.000Z",
      selectedSlot: "2026-09-28T01:00:00.000Z",
    },
    appointmentOutcome: {
      result: "FOLLOW_UP", notes: "次回提案を準備", actorId: "manager",
      recordedAt: "2026-09-28T01:30:00.000Z",
    },
    replies: [{
      type: "SCHEDULING", receivedAt: "2026-09-27T02:00:00.000Z",
      actorId: "operator", channel: "EMAIL",
    }],
  });

  assert.deepEqual(events.map((entry) => entry.type), [
    "RESEARCH_COMPLETED", "OUTREACH_APPROVED", "OUTREACH_DELIVERED", "INBOUND_REPLY",
    "MEETING_OPTIONS_SAVED", "MEETING_OPTIONS_APPROVED",
    "MEETING_OPTIONS_DELIVERED", "APPOINTMENT_CONFIRMED", "APPOINTMENT_OUTCOME_RECORDED",
  ]);
  assert.equal(events.at(-1).label, "面談結果：次回対応");
  assert.equal(events.at(-2).detail, "2026-09-28T01:00:00.000Z");
  assert.equal(Object.isFrozen(events), true);
  assert.equal(Object.isFrozen(events[0]), true);
});

test("rejects appointments without delivered options or enough confirmation lead time", () => {
  const appointment = {
    confirmedBy: "scheduler",
    confirmedAt: "2026-09-27T04:00:00.000Z",
    selectedSlot: "2026-09-28T01:00:00.000Z",
  };
  const meetingWorkflow = {
    meetingOptionsDraft: { savedBy: "scheduler", savedAt: "2026-09-27T02:15:00.000Z" },
    meetingOptionsApproval: audit("manager", "2026-09-27T02:30:00.000Z"),
    meetingOptionsDelivery: delivery("sender", "2026-09-27T03:00:00.000Z"),
  };

  assert.deepEqual(buildSalesAuditTimeline({ replies: [], appointment }), []);
  assert.deepEqual(buildSalesAuditTimeline({
    replies: [],
    ...meetingWorkflow,
    appointment: { ...appointment, selectedSlot: "2026-09-27T04:14:59.999Z" },
  }), []);
});

test("omits legacy research audit and rejects malformed research audit", () => {
  assert.deepEqual(buildSalesAuditTimeline({ replies: [] }), []);
  assert.deepEqual(buildSalesAuditTimeline({
    researchAudit: {
      sources: ["http://example.com"], actorId: "researcher", completedAt: "2026-09-27T00:00:00.000Z",
    },
    replies: [],
  }), []);
});

test("adds post-meeting follow-up scheduling and completion audits", () => {
  const events = buildSalesAuditTimeline({
    replies: [],
    postMeetingFollowUp: {
      action: "見積条件を整理する",
      dueAt: "2026-10-01T01:00:00.000Z",
      owner: "営業責任者",
      createdBy: "manager",
      createdAt: "2026-09-28T02:00:00.000Z",
      completedBy: "operator",
      completedAt: "2026-09-30T03:00:00.000Z",
    },
  });

  assert.deepEqual(events.map((entry) => entry.type), [
    "POST_MEETING_FOLLOW_UP_SCHEDULED", "POST_MEETING_FOLLOW_UP_COMPLETED",
  ]);
  assert.equal(events[0].detail, "2026-10-01T01:00:00.000Z");
  assert.equal(events[1].actorId, "operator");
});

test("adds manual follow-up draft approval and delivery audits", () => {
  const draft = {
    subject: "ご確認", body: "本文", signature: "署名",
    savedBy: "writer", savedAt: "2026-09-30T00:00:00.000Z",
  };
  const events = buildSalesAuditTimeline({
    replies: [],
    followUps: [{
      draft,
      approval: audit("manager", "2026-09-30T01:00:00.000Z"),
      delivery: delivery("sender", "2026-09-30T02:00:00.000Z"),
    }],
  });
  assert.deepEqual(events.map((entry) => entry.type), [
    "FOLLOW_UP_SAVED", "FOLLOW_UP_APPROVED", "FOLLOW_UP_DELIVERED",
  ]);
});

test("adds appointment notice preparation, approval, and delivery audits", () => {
  const events = buildSalesAuditTimeline({
    replies: [],
    appointmentNoticeDraft: {
      subject: "Web面談日時確定のご案内", body: "本文", signature: "署名",
      savedBy: "scheduler", savedAt: "2026-09-27T04:00:00.000Z",
    },
    appointmentNoticeApproval: audit("manager", "2026-09-27T05:00:00.000Z"),
    appointmentNoticeDelivery: delivery("sender", "2026-09-27T06:00:00.000Z", "LINE"),
  });
  assert.deepEqual(events.map((entry) => entry.type), [
    "APPOINTMENT_NOTICE_SAVED", "APPOINTMENT_NOTICE_APPROVED", "APPOINTMENT_NOTICE_DELIVERED",
  ]);
  assert.equal(events.at(-1).channel, "LINE");
});

test("adds appointment reminder preparation, approval, and delivery audits", () => {
  const events = buildSalesAuditTimeline({
    replies: [],
    appointmentReminderDraft: {
      subject: "Web面談前日のご案内", body: "本文", signature: "署名",
      savedBy: "scheduler", savedAt: "2026-09-27T04:00:00.000Z",
    },
    appointmentReminderApproval: audit("manager", "2026-09-27T05:00:00.000Z"),
    appointmentReminderDelivery: delivery("sender", "2026-09-27T06:00:00.000Z", "LINE"),
  });
  assert.deepEqual(events.map((entry) => entry.type), [
    "APPOINTMENT_REMINDER_SAVED", "APPOINTMENT_REMINDER_APPROVED",
    "APPOINTMENT_REMINDER_DELIVERED",
  ]);
  assert.equal(events.at(-1).channel, "LINE");
});

test("preserves archived multi-reply audits and opt-out events", () => {
  const events = buildSalesAuditTimeline({
    outreachApproval: null,
    outreachDelivery: null,
    replyApproval: null,
    replyDelivery: null,
    meetingOptionsDraft: null,
    meetingOptionsApproval: null,
    meetingOptionsDelivery: null,
    appointment: null,
    replies: [
      {
        type: "MATERIAL_REQUEST", receivedAt: "2026-09-27T02:00:00.000Z",
        actorId: "operator", channel: "LINE",
        resolution: {
          kind: "SAFE_REPLY",
          approval: audit("manager", "2026-09-27T02:15:00.000Z"),
          delivery: delivery("sender", "2026-09-27T03:00:00.000Z", "LINE"),
        },
      },
      {
        type: "OPT_OUT", receivedAt: "2026-09-27T04:00:00.000Z",
        actorId: "operator", channel: "LINE",
      },
    ],
  });

  assert.deepEqual(events.map((entry) => entry.type), [
    "INBOUND_REPLY", "REPLY_APPROVED", "REPLY_DELIVERED", "OPT_OUT",
  ]);
  assert.equal(events.at(-1).label, "配信停止を受信");
});

test("rejects forged archived reply resolution type, channel, and chronology", () => {
  const reply = {
    type: "GENERAL_QUESTION", receivedAt: "2026-09-27T02:00:00.000Z",
    actorId: "operator", channel: "EMAIL",
  };
  const safeResolution = {
    kind: "SAFE_REPLY",
    approval: audit("manager", "2026-09-27T02:15:00.000Z"),
    delivery: delivery("sender", "2026-09-27T03:00:00.000Z"),
  };
  const meetingResolution = {
    kind: "MEETING_OPTIONS",
    draft: { savedBy: "scheduler", savedAt: "2026-09-27T02:15:00.000Z" },
    approval: audit("manager", "2026-09-27T02:30:00.000Z"),
    delivery: delivery("sender", "2026-09-27T03:00:00.000Z"),
  };
  for (const forged of [
    { ...reply, type: "OPT_OUT", resolution: safeResolution },
    { ...reply, resolution: { ...safeResolution, approval: audit("manager", "2026-09-27T01:59:59.999Z") } },
    { ...reply, resolution: { ...safeResolution, delivery: delivery("sender", "2026-09-27T02:14:59.999Z") } },
    { ...reply, resolution: { ...safeResolution, delivery: delivery("sender", "2026-09-27T03:00:00.000Z", "LINE") } },
    { ...reply, resolution: meetingResolution },
    { ...reply, type: "SCHEDULING", resolution: {
      ...meetingResolution,
      draft: { savedBy: "scheduler", savedAt: "2026-09-27T01:59:59.999Z" },
    } },
  ]) assert.deepEqual(buildSalesAuditTimeline({ replies: [forged] }), []);
});

test("rejects forged chronology across current workflow audit records", () => {
  const valid = {
    researchAudit: {
      sources: ["https://example.com/company"],
      actorId: "researcher",
      completedAt: "2026-09-27T00:00:00.000Z",
    },
    outreachApproval: audit("manager", "2026-09-27T00:30:00.000Z"),
    outreachDelivery: delivery("sender", "2026-09-27T01:00:00.000Z"),
    replies: [],
  };
  const followUp = {
    draft: {
      subject: "ご確認", body: "本文", signature: "署名",
      savedBy: "writer", savedAt: "2026-09-27T02:00:00.000Z",
    },
    approval: audit("manager", "2026-09-27T02:30:00.000Z"),
    delivery: delivery("sender", "2026-09-27T03:00:00.000Z"),
  };
  const appointment = {
    confirmedBy: "scheduler", confirmedAt: "2026-09-27T04:00:00.000Z",
    selectedSlot: "2026-09-28T01:00:00.000Z",
  };
  const appointmentOutcome = {
    result: "FOLLOW_UP", notes: "次回提案を準備", actorId: "manager",
    recordedAt: "2026-09-28T01:30:00.000Z",
  };

  for (const forged of [
    {
      ...valid,
      outreachDelivery: delivery("sender", "2026-09-27T00:29:59.999Z"),
    },
    {
      ...valid,
      followUps: [{
        ...followUp,
        delivery: delivery("sender", "2026-09-27T02:29:59.999Z"),
      }],
    },
    {
      ...valid,
      replies: [{
        type: "GENERAL_QUESTION", receivedAt: "2026-09-27T02:00:00.000Z",
        actorId: "operator", channel: "EMAIL",
      }],
      replyApproval: audit("manager", "2026-09-27T01:59:59.999Z"),
      replyDelivery: delivery("sender", "2026-09-27T03:00:00.000Z"),
    },
    {
      ...valid,
      meetingOptionsDraft: { savedBy: "scheduler", savedAt: "2026-09-27T02:15:00.000Z" },
      meetingOptionsApproval: audit("manager", "2026-09-27T02:30:00.000Z"),
      meetingOptionsDelivery: delivery("sender", "2026-09-27T02:29:59.999Z"),
    },
    {
      ...valid,
      appointment,
      appointmentNoticeDraft: {
        subject: "Web面談日時確定のご案内", body: "本文", signature: "署名",
        savedBy: "scheduler", savedAt: "2026-09-27T04:30:00.000Z",
      },
      appointmentNoticeApproval: audit("manager", "2026-09-27T05:00:00.000Z"),
      appointmentNoticeDelivery: delivery("sender", "2026-09-27T04:59:59.999Z"),
    },
    {
      ...valid,
      appointment,
      appointmentOutcome: { ...appointmentOutcome, recordedAt: "2026-09-27T03:59:59.999Z" },
    },
    {
      ...valid,
      appointment,
      appointmentOutcome,
      postMeetingFollowUp: {
        action: "見積条件を整理する",
        dueAt: "2026-10-01T01:00:00.000Z",
        owner: "営業責任者",
        createdBy: "manager",
        createdAt: "2026-09-28T01:29:59.999Z",
        completedBy: null,
        completedAt: null,
      },
    },
  ]) assert.deepEqual(buildSalesAuditTimeline(forged), []);
});

test("preserves a valid archived meeting-options resolution", () => {
  const events = buildSalesAuditTimeline({
    appointment: {
      confirmedBy: "scheduler", confirmedAt: "2026-09-27T04:00:00.000Z",
      selectedSlot: "2026-09-28T01:00:00.000Z",
    },
    replies: [{
      type: "SCHEDULING", receivedAt: "2026-09-27T02:00:00.000Z",
      actorId: "operator", channel: "LINE",
      resolution: {
        kind: "MEETING_OPTIONS",
        draft: { savedBy: "scheduler", savedAt: "2026-09-27T02:15:00.000Z" },
        approval: audit("manager", "2026-09-27T02:30:00.000Z"),
        delivery: delivery("sender", "2026-09-27T03:00:00.000Z", "LINE"),
      },
    }],
  });
  assert.deepEqual(events.map((entry) => entry.type), [
    "INBOUND_REPLY", "MEETING_OPTIONS_SAVED", "MEETING_OPTIONS_APPROVED",
    "MEETING_OPTIONS_DELIVERED", "APPOINTMENT_CONFIRMED",
  ]);
});

test("preserves a ninth final opt-out after eight bounded replies", () => {
  const replies = Array.from({ length: 9 }, (_, index) => ({
    type: index === 8 ? "OPT_OUT" : "GENERAL_QUESTION",
    receivedAt: `2026-09-${20 + index}T00:00:00.000Z`,
    actorId: "operator",
    channel: "EMAIL",
  }));
  const events = buildSalesAuditTimeline({ replies });
  assert.equal(events.length, 9);
  assert.equal(events.at(-1).type, "OPT_OUT");
});

test("fails closed on malformed audit data and caps the requested view", () => {
  assert.deepEqual(buildSalesAuditTimeline(null), []);
  assert.deepEqual(buildSalesAuditTimeline({ replies: [{}] }), []);
  assert.deepEqual(buildSalesAuditTimeline({
    outreachApproval: { actorId: "manager", approvedAt: "invalid" }, replies: [],
  }), []);

  const events = buildSalesAuditTimeline({
    outreachApproval: audit("manager", "2026-09-27T00:30:00.000Z"),
    outreachDelivery: delivery("sender", "2026-09-27T01:00:00.000Z"),
    replies: [{
      type: "GENERAL_QUESTION", receivedAt: "2026-09-27T02:00:00.000Z",
      actorId: "operator", channel: "EMAIL",
    }],
  }, { limit: 2 });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((entry) => entry.type), ["OUTREACH_DELIVERED", "INBOUND_REPLY"]);
});
