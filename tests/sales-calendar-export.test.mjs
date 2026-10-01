import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesAppointmentCalendar } from "../lib/sales-calendar-export.js";

function lead(overrides = {}) {
  return {
    id: "123e4567-e89b-12d3-a456-426614174000",
    companyName: "テスト工務店",
    optedOut: false,
    meetingOptionsApproved: true,
    meetingOptionsRecordedAt: "2026-09-28T01:00:00.000Z",
    meetingOptionsDelivery: {
      actorId: "operator",
      recordedAt: "2026-09-28T01:00:00.000Z",
      channel: "EMAIL",
    },
    appointmentConfirmed: true,
    appointment: {
      selectedSlot: "2026-10-01T01:00:00.000Z",
      durationMinutes: 30,
      meetingUrl: "https://zoom.us/j/123456789",
      notes: "営業責任者が参加",
      confirmedBy: "scheduler",
      confirmedAt: "2026-09-28T02:00:00.000Z",
    },
    ...overrides,
  };
}

test("builds a standalone UTC calendar event for manual import", () => {
  const calendar = buildSalesAppointmentCalendar(lead());
  assert.ok(calendar);
  assert.match(calendar, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/u);
  assert.match(calendar, /DTSTART:20261001T010000Z\r\nDTEND:20261001T013000Z/u);
  assert.match(calendar, /SUMMARY:Web面談 - テスト工務店/u);
  assert.match(calendar, /LOCATION:https:\/\/zoom\.us\/j\/123456789/u);
  assert.match(calendar, /DESCRIPTION:営業責任者が参加\\n\\nhttps:\/\/zoom\.us\/j\/123456789/u);
  assert.match(calendar, /\r\nEND:VCALENDAR\r\n$/u);
});

test("contains no organizer, attendee, send method, or external execution metadata", () => {
  const calendar = buildSalesAppointmentCalendar(lead());
  assert.doesNotMatch(calendar, /ATTENDEE|ORGANIZER|METHOD:REQUEST|mailto:|VALARM/iu);
  assert.doesNotMatch(calendar, /contact|actorId|confirmedBy/iu);
});

test("escapes text injection and folds every UTF-8 content line to 75 octets", () => {
  const calendar = buildSalesAppointmentCalendar(lead({
    companyName: "株式会社長い会社名、営業部".repeat(12),
    appointment: {
      ...lead().appointment,
      notes: "1行目\nBEGIN:VALARM,危険;値\\末尾".repeat(8),
    },
  }));
  assert.ok(calendar);
  assert.match(calendar, /\\nBEGIN:VALARM\\,危険\\;値\\\\末尾/u);
  assert.ok(calendar.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75));
  assert.equal(calendar.split("\r\n").filter((line) => line === "BEGIN:VALARM").length, 0);
});

test("fails closed for unconfirmed, suppressed, malformed, or unsafe appointments", () => {
  assert.equal(buildSalesAppointmentCalendar(lead({ appointmentConfirmed: false })), null);
  assert.equal(buildSalesAppointmentCalendar(lead({ optedOut: true })), null);
  assert.equal(buildSalesAppointmentCalendar(lead({
    optedOut: false, replies: [{ type: "OPT_OUT" }],
  })), null);
  assert.equal(buildSalesAppointmentCalendar(lead({ appointment: null })), null);
  assert.equal(buildSalesAppointmentCalendar(lead({
    appointment: { ...lead().appointment, meetingUrl: "http://example.com/meeting" },
  })), null);
  assert.equal(buildSalesAppointmentCalendar(lead({
    appointment: { ...lead().appointment, selectedSlot: "invalid" },
  })), null);
});

test("rejects missing or forged appointment confirmation chronology", () => {
  const valid = lead();
  for (const forged of [
    { meetingOptionsApproved: false },
    { meetingOptionsRecordedAt: null },
    { meetingOptionsDelivery: null },
    {
      meetingOptionsDelivery: {
        ...valid.meetingOptionsDelivery,
        recordedAt: "2026-09-28T00:59:59.999Z",
      },
    },
    {
      appointment: { ...valid.appointment, confirmedBy: "" },
    },
    {
      appointment: {
        ...valid.appointment,
        confirmedAt: "2026-09-28T00:59:59.999Z",
      },
    },
    {
      appointment: {
        ...valid.appointment,
        selectedSlot: "2026-09-28T02:14:59.999Z",
      },
    },
  ]) {
    assert.equal(buildSalesAppointmentCalendar(lead(forged)), null);
  }
});
