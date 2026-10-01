import { hasSalesOptOutEvidence } from "./sales-reply-history.js";

const MIN_APPOINTMENT_LEAD_MS = 15 * 60 * 1000;

/**
 * Builds a standalone calendar event for manual import. It does not invite
 * attendees, create a calendar event, or contact an external service.
 */
export function buildSalesAppointmentCalendar(rawLead) {
  const lead = snapshotLead(rawLead);
  if (!lead) return null;

  const start = Date.parse(lead.appointment.selectedSlot);
  const end = start + lead.appointment.durationMinutes * 60 * 1000;
  if (!Number.isFinite(end)) return null;
  const description = [lead.appointment.notes, lead.appointment.meetingUrl]
    .filter(Boolean).join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//STAR WORK OS//Sales Appointment//JA",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${escapeText(`${lead.id}@star-work-os.local`)}`,
    `DTSTAMP:${calendarTimestamp(lead.appointment.confirmedAt)}`,
    `DTSTART:${calendarTimestamp(lead.appointment.selectedSlot)}`,
    `DTEND:${calendarTimestamp(new Date(end).toISOString())}`,
    `SUMMARY:${escapeText(`Web面談 - ${lead.companyName}`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(lead.appointment.meetingUrl)}`,
    `URL:${lead.appointment.meetingUrl}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.flatMap(foldLine).join("\r\n")}\r\n`;
}

function snapshotLead(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const appointment = value.appointment;
    const meetingOptionsRecordedAt = value.meetingOptionsRecordedAt;
    const meetingOptionsDelivery = value.meetingOptionsDelivery;
    if (!validText(value.id, 128) || !validText(value.companyName, 160)
      || value.appointmentConfirmed !== true || hasSalesOptOutEvidence(value)
      || value.meetingOptionsApproved !== true
      || !validTimestamp(meetingOptionsRecordedAt)
      || !validDelivery(meetingOptionsDelivery)
      || meetingOptionsDelivery.recordedAt !== meetingOptionsRecordedAt
      || !appointment || typeof appointment !== "object" || Array.isArray(appointment)
      || !validTimestamp(appointment.selectedSlot)
      || !validTimestamp(appointment.confirmedAt)
      || !validText(appointment.confirmedBy, 128)
      || ![30, 45, 60].includes(appointment.durationMinutes)
      || !validHttpsUrl(appointment.meetingUrl)
      || typeof appointment.notes !== "string" || appointment.notes.length > 1_000
      || appointment.notes.includes("\u0000")
      || Date.parse(appointment.confirmedAt) < Date.parse(meetingOptionsRecordedAt)
      || Date.parse(appointment.selectedSlot)
        < Date.parse(appointment.confirmedAt) + MIN_APPOINTMENT_LEAD_MS) return null;
    return {
      id: value.id,
      companyName: value.companyName,
      appointment: {
        selectedSlot: appointment.selectedSlot,
        durationMinutes: appointment.durationMinutes,
        meetingUrl: appointment.meetingUrl,
        notes: appointment.notes,
        confirmedAt: appointment.confirmedAt,
      },
    };
  } catch {
    return null;
  }
}

function calendarTimestamp(value) {
  return value.replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

function escapeText(value) {
  return value.replace(/\\/gu, "\\\\").replace(/\r\n?|\n/gu, "\\n")
    .replace(/,/gu, "\\,").replace(/;/gu, "\\;");
}

function foldLine(line) {
  const result = [];
  let chunk = "";
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, "utf8");
    const limit = result.length === 0 ? 75 : 74;
    if (bytes + size > limit && chunk) {
      result.push(result.length === 0 ? chunk : ` ${chunk}`);
      chunk = "";
      bytes = 0;
    }
    chunk += character;
    bytes += size;
  }
  result.push(result.length === 0 ? chunk : ` ${chunk}`);
  return result;
}

function validText(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function validDelivery(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && validText(value.actorId, 128) && validTimestamp(value.recordedAt)
    && ["EMAIL", "LINE"].includes(value.channel);
}

function validHttpsUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512
    || value.trim() !== value || /[\s\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}
