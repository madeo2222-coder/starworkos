import { buildUnsentEmailMessage, salesEmailRecipient } from "./sales-email-export.js";
import { hasSalesOptOutEvidence } from "./sales-reply-history.js";

const MIN_APPOINTMENT_LEAD_MS = 15 * 60 * 1000;

/** Builds an approved, unsent appointment confirmation email without side effects. */
export function buildUnsentSalesAppointmentNotice(rawLead) {
  const lead = snapshotLead(rawLead);
  if (!lead) return null;
  return buildUnsentEmailMessage(lead.recipient, lead.draft);
}

function snapshotLead(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const recipient = salesEmailRecipient(value.contact);
    const appointment = snapshotAppointment(value.appointment);
    const meetingApprovalAt = auditTime(value.meetingOptionsApproval);
    const meetingRecordedAt = toTime(value.meetingOptionsRecordedAt);
    const meetingDelivery = snapshotDelivery(value.meetingOptionsDelivery);
    const draftSavedAt = draftTime(value.appointmentNoticeDraft);
    const noticeApprovalAt = auditTime(value.appointmentNoticeApproval);
    if (!recipient || hasSalesOptOutEvidence(value) || value.appointmentConfirmed !== true
      || value.meetingOptionsApproved !== true || !Number.isFinite(meetingApprovalAt)
      || !Number.isFinite(meetingRecordedAt) || !meetingDelivery
      || meetingDelivery.channel !== "EMAIL"
      || value.meetingOptionsDelivery.recordedAt !== value.meetingOptionsRecordedAt
      || meetingRecordedAt < meetingApprovalAt || !appointment
      || appointment.confirmedAt < meetingRecordedAt
      || appointment.startsAt < appointment.confirmedAt + MIN_APPOINTMENT_LEAD_MS
      || value.appointmentNoticeApproved !== true
      || !Number.isFinite(draftSavedAt) || !Number.isFinite(noticeApprovalAt)
      || draftSavedAt < appointment.confirmedAt || draftSavedAt >= appointment.startsAt
      || noticeApprovalAt < draftSavedAt || noticeApprovalAt >= appointment.startsAt
      || !value.appointmentNoticeDraft || value.appointmentNoticeRecordedAt !== null
      || value.appointmentNoticeDelivery !== null
    ) return null;
    return { recipient, draft: value.appointmentNoticeDraft };
  } catch {
    return null;
  }
}

function snapshotAppointment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![30, 45, 60].includes(value.durationMinutes)
    || !validText(value.confirmedBy, 128)) return null;
  const startsAt = toTime(value.selectedSlot);
  const confirmedAt = toTime(value.confirmedAt);
  return Number.isFinite(startsAt) && Number.isFinite(confirmedAt)
    ? { startsAt, confirmedAt } : null;
}

function snapshotDelivery(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validText(value.actorId, 128) || !Number.isFinite(toTime(value.recordedAt))
    || !["EMAIL", "LINE"].includes(value.channel)) return null;
  return { channel: value.channel };
}

function auditTime(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && validText(value.actorId, 128) ? toTime(value.approvedAt) : NaN;
}

function draftTime(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && validText(value.savedBy, 128) ? toTime(value.savedAt) : NaN;
}

function toTime(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    ? Date.parse(value) : NaN;
}

function validText(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}
