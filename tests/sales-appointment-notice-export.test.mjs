import test from "node:test";
import assert from "node:assert/strict";
import { buildUnsentSalesAppointmentNotice } from "../lib/sales-appointment-notice-export.js";

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
    appointmentNoticeRecordedAt: null,
    appointmentNoticeDelivery: null,
    appointmentNoticeDraft: {
      subject: "Web面談日時確定のご案内",
      body: "日時：2026年9月28日 10:00\n参加URL：https://zoom.us/j/123",
      signature: "STAR WORK OS\n営業担当",
      savedBy: "scheduler",
      savedAt: "2026-09-27T04:00:00.000Z",
    },
    ...overrides,
  };
}

test("builds an approved unsent appointment notice for one email recipient", () => {
  const eml = buildUnsentSalesAppointmentNotice(lead());
  assert.ok(eml);
  assert.match(eml, /^To: sales@example\.com\r\nSubject: =\?UTF-8\?B\?/u);
  assert.match(eml, /\r\nX-Unsent: 1\r\n\r\n/u);
  const encodedBody = eml.split("\r\n\r\n")[1].replace(/\r\n/gu, "");
  assert.equal(Buffer.from(encodedBody, "base64").toString("utf8"),
    "日時：2026年9月28日 10:00\r\n参加URL：https://zoom.us/j/123\r\n\r\nSTAR WORK OS\r\n営業担当");
});

test("fails closed for LINE, unapproved, delivered, suppressed, or ambiguous notices", () => {
  assert.equal(buildUnsentSalesAppointmentNotice(lead({
    meetingOptionsDelivery: { ...lead().meetingOptionsDelivery, channel: "LINE" },
  })), null);
  assert.equal(buildUnsentSalesAppointmentNotice(lead({ appointmentNoticeApproved: false })), null);
  assert.equal(buildUnsentSalesAppointmentNotice(lead({
    appointmentNoticeRecordedAt: "2026-09-27T06:00:00.000Z",
  })), null);
  assert.equal(buildUnsentSalesAppointmentNotice(lead({ optedOut: true })), null);
  assert.equal(buildUnsentSalesAppointmentNotice(lead({
    optedOut: false, replies: [{ type: "OPT_OUT" }],
  })), null);
  assert.equal(buildUnsentSalesAppointmentNotice(lead({
    contact: "a@example.com b@example.com",
  })), null);
});

test("rejects missing or forged appointment and notice approval chronology", () => {
  const valid = lead();
  for (const forged of [
    { meetingOptionsApproved: false },
    { meetingOptionsApproval: null },
    { meetingOptionsRecordedAt: null },
    { meetingOptionsDelivery: null },
    {
      appointment: { ...valid.appointment, confirmedBy: "" },
    },
    {
      appointment: {
        ...valid.appointment,
        confirmedAt: "2026-09-27T02:59:59.999Z",
      },
    },
    {
      appointment: {
        ...valid.appointment,
        selectedSlot: "2026-09-27T03:44:59.999Z",
      },
    },
    { appointmentNoticeApproval: null },
    {
      appointmentNoticeDraft: {
        ...valid.appointmentNoticeDraft,
        savedAt: "2026-09-27T03:29:59.999Z",
      },
    },
    {
      appointmentNoticeApproval: {
        ...valid.appointmentNoticeApproval,
        approvedAt: "2026-09-27T03:59:59.999Z",
      },
    },
  ]) {
    assert.equal(buildUnsentSalesAppointmentNotice(lead(forged)), null);
  }
});
