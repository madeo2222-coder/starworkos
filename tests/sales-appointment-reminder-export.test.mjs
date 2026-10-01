import test from "node:test";
import assert from "node:assert/strict";
import { buildUnsentSalesAppointmentReminder } from "../lib/sales-appointment-reminder-export.js";

function lead(overrides = {}) {
  return {
    contact: "営業部 sales@example.com",
    optedOut: false,
    meetingOptionsApproved: true,
    meetingOptionsApproval: {
      actorId: "manager",
      approvedAt: "2026-09-27T02:30:00.000Z",
    },
    meetingOptionsRecordedAt: "2026-09-27T03:00:00.000Z",
    meetingOptionsDelivery: {
      actorId: "operator",
      recordedAt: "2026-09-27T03:00:00.000Z",
      channel: "EMAIL",
    },
    appointmentConfirmed: true,
    appointment: {
      selectedSlot: "2026-09-28T01:00:00.000Z",
      durationMinutes: 30,
      confirmedBy: "scheduler",
      confirmedAt: "2026-09-27T03:30:00.000Z",
    },
    appointmentNoticeApproved: true,
    appointmentNoticeApproval: {
      actorId: "manager",
      approvedAt: "2026-09-27T04:15:00.000Z",
    },
    appointmentNoticeRecordedAt: "2026-09-27T04:30:00.000Z",
    appointmentNoticeDelivery: {
      actorId: "operator",
      recordedAt: "2026-09-27T04:30:00.000Z",
      channel: "EMAIL",
    },
    appointmentReminderApproved: true,
    appointmentReminderApproval: {
      actorId: "manager",
      approvedAt: "2026-09-27T05:15:00.000Z",
    },
    appointmentReminderRecordedAt: null,
    appointmentReminderDelivery: null,
    appointmentReminderDraft: {
      subject: "Web面談前日のご案内",
      body: "日時：2026年9月28日 10:00\n参加URL：https://zoom.us/j/123",
      signature: "STAR WORK OS\n営業担当",
      savedBy: "scheduler",
      savedAt: "2026-09-27T05:00:00.000Z",
    },
    ...overrides,
  };
}

test("builds an approved unsent appointment reminder for one email recipient", () => {
  const eml = buildUnsentSalesAppointmentReminder(lead());
  assert.ok(eml);
  assert.match(eml, /^To: sales@example\.com\r\nSubject: =\?UTF-8\?B\?/u);
  assert.match(eml, /\r\nX-Unsent: 1\r\n\r\n/u);
});

test("fails closed for LINE, unapproved, delivered, suppressed, or ambiguous reminders", () => {
  assert.equal(buildUnsentSalesAppointmentReminder(lead({
    meetingOptionsDelivery: { ...lead().meetingOptionsDelivery, channel: "LINE" },
  })), null);
  assert.equal(buildUnsentSalesAppointmentReminder(lead({ appointmentReminderApproved: false })), null);
  assert.equal(buildUnsentSalesAppointmentReminder(lead({
    appointmentNoticeRecordedAt: undefined,
  })), null);
  assert.equal(buildUnsentSalesAppointmentReminder(lead({
    appointmentReminderRecordedAt: "2026-09-27T06:00:00.000Z",
  })), null);
  assert.equal(buildUnsentSalesAppointmentReminder(lead({ optedOut: true })), null);
  assert.equal(buildUnsentSalesAppointmentReminder(lead({
    optedOut: false, replies: [{ type: "OPT_OUT" }],
  })), null);
  assert.equal(buildUnsentSalesAppointmentReminder(lead({ contact: "a@example.com b@example.com" })), null);
});

test("rejects missing or forged appointment and reminder approval chronology", () => {
  const valid = lead();
  for (const forged of [
    { meetingOptionsApproval: null },
    { meetingOptionsDelivery: null },
    {
      appointment: { ...valid.appointment, confirmedAt: "2026-09-27T02:59:59.999Z" },
    },
    { appointmentNoticeApproved: false },
    { appointmentNoticeApproval: null },
    { appointmentNoticeDelivery: null },
    {
      appointmentNoticeDelivery: {
        ...valid.appointmentNoticeDelivery,
        recordedAt: "2026-09-27T04:29:59.999Z",
      },
    },
    { appointmentReminderApproval: null },
    {
      appointmentReminderDraft: {
        ...valid.appointmentReminderDraft,
        savedAt: "2026-09-27T04:29:59.999Z",
      },
    },
    {
      appointmentReminderApproval: {
        ...valid.appointmentReminderApproval,
        approvedAt: "2026-09-27T04:59:59.999Z",
      },
    },
  ]) {
    assert.equal(buildUnsentSalesAppointmentReminder(lead(forged)), null);
  }
});
