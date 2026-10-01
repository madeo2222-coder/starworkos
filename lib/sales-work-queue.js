import { planSalesNextWork, SALES_ACTIONS } from "./sales-orchestrator.js";
import { isBoundedSalesReplyHistory } from "./sales-reply-history.js";

const MAX_INPUT_LEADS = 500;
const MAX_QUEUE_ITEMS = 100;
const MIN_APPOINTMENT_LEAD_MS = 15 * 60 * 1000;
const MEETING_DURATIONS = new Set([30, 45, 60]);

const ACTION_PRIORITY = Object.freeze({
  [SALES_ACTIONS.STOP_CONTACT]: 0,
  [SALES_ACTIONS.HUMAN_REVIEW]: 1,
  [SALES_ACTIONS.COMPLETE_POST_MEETING_FOLLOW_UP]: 2,
  [SALES_ACTIONS.RECORD_APPOINTMENT_OUTCOME]: 2,
  [SALES_ACTIONS.SCHEDULE_POST_MEETING_FOLLOW_UP]: 3,
  [SALES_ACTIONS.CONFIRM_MEETING]: 3,
  [SALES_ACTIONS.PREPARE_APPOINTMENT_NOTICE]: 3,
  [SALES_ACTIONS.PREPARE_APPOINTMENT_REMINDER]: 3,
  [SALES_ACTIONS.PREPARE_MEETING_OPTIONS]: 4,
  [SALES_ACTIONS.PREPARE_REPLY]: 5,
  [SALES_ACTIONS.NO_ACTION]: 6,
  [SALES_ACTIONS.PREPARE_OUTREACH]: 7,
  [SALES_ACTIONS.PREPARE_FOLLOW_UP]: 8,
  [SALES_ACTIONS.RESEARCH_COMPANY]: 9,
});

/**
 * Builds a bounded, deterministic queue of the next sales work across leads.
 *
 * The queue only describes work. It never sends a message, invokes an AI,
 * changes a calendar, or writes to a database.
 */
export function buildSalesWorkQueue(rawLeads, { now = new Date(), limit = MAX_QUEUE_ITEMS } = {}) {
  const input = snapshotInput(rawLeads);
  const nowValue = snapshotDate(now);
  const itemLimit = normalizeLimit(limit);

  if (!input || !nowValue) return emptyQueue(true);

  const seen = new Set();
  const items = [];
  let invalidCount = 0;
  let duplicateCount = 0;
  let noActionCount = 0;

  for (const rawLead of input.leads) {
    const lead = snapshotLead(rawLead);
    if (!lead) {
      invalidCount += 1;
      continue;
    }
    if (seen.has(lead.id)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(lead.id);

    const plan = planSalesNextWork(lead.planInput, { now: nowValue });
    if (plan.reason === "INVALID_INPUT") {
      invalidCount += 1;
      continue;
    }
    const safetyAction = plan.action === SALES_ACTIONS.STOP_CONTACT
      || plan.action === SALES_ACTIONS.HUMAN_REVIEW;
    if (lead.invalidAppointmentConfirmation && !safetyAction) {
      invalidCount += 1;
      continue;
    }
    const visibleManualRecord = plan.reason === "WAIT_FOR_HUMAN_SEND_RECORD"
      || plan.reason === "WAIT_FOR_HUMAN_REPLY_SEND_RECORD"
      || plan.reason === "WAIT_FOR_HUMAN_FOLLOW_UP_SEND_RECORD"
      || plan.reason === "WAIT_FOR_HUMAN_APPOINTMENT_NOTICE_SEND_RECORD"
      || plan.reason === "WAIT_FOR_HUMAN_APPOINTMENT_REMINDER_SEND_RECORD"
      || plan.reason === "WAIT_FOR_HUMAN_MEETING_OPTIONS_SEND_RECORD";
    if (plan.ownerRole === null || (plan.action === SALES_ACTIONS.NO_ACTION && !visibleManualRecord)) {
      noActionCount += 1;
      continue;
    }

    const priority = ACTION_PRIORITY[plan.action];
    if (!Number.isSafeInteger(priority)) {
      invalidCount += 1;
      continue;
    }

    items.push(Object.freeze({
      leadId: lead.id,
      companyName: lead.companyName,
      ownerRole: plan.ownerRole,
      action: plan.action,
      reason: plan.reason,
      priority,
      deliveryAllowed: false,
    }));
  }

  items.sort(compareItems);
  const queueItems = Object.freeze(items.slice(0, itemLimit));

  return Object.freeze({
    items: queueItems,
    counts: Object.freeze({
      queued: queueItems.length,
      invalid: invalidCount,
      duplicate: duplicateCount,
      noAction: noActionCount,
      overflow: Math.max(0, items.length - itemLimit) + input.truncatedCount,
    }),
    invalidBatch: false,
  });
}

function snapshotInput(value) {
  try {
    if (!Array.isArray(value)) return null;
    return {
      leads: value.slice(0, MAX_INPUT_LEADS),
      truncatedCount: Math.max(0, value.length - MAX_INPUT_LEADS),
    };
  } catch {
    return null;
  }
}

function snapshotLead(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const id = value.id;
    const companyName = value.companyName;
    const replies = value.replies ?? [];
    const followUps = value.followUps ?? [];
    if (!validText(id, 128) || !validText(companyName, 160)
      || !isBoundedSalesReplyHistory(replies)
      || !Array.isArray(followUps) || followUps.length > 2) return null;

    const appointment = snapshotAppointment(value.appointment);
    const appointmentConfirmed = value.appointmentConfirmed === true;
    const meetingOptionsRecordedAt = snapshotTimestamp(value.meetingOptionsRecordedAt);
    const invalidAppointmentConfirmation = appointmentConfirmed && (!appointment
      || value.meetingOptionsApproved !== true
      || !Number.isFinite(meetingOptionsRecordedAt)
      || appointment.confirmedAt < meetingOptionsRecordedAt
      || appointment.startsAt < appointment.confirmedAt + MIN_APPOINTMENT_LEAD_MS);

    return {
      id,
      companyName,
      invalidAppointmentConfirmation,
      planInput: {
        optedOut: value.optedOut,
        appointmentConfirmed,
        appointment: appointment ? {
          selectedSlot: appointment.selectedSlot,
          durationMinutes: appointment.durationMinutes,
          confirmedBy: appointment.confirmedBy,
          confirmedAt: appointment.confirmedAtValue,
        } : value.appointment,
        appointmentNoticeDraft: value.appointmentNoticeDraft,
        appointmentNoticeApproved: value.appointmentNoticeApproved,
        appointmentNoticeRecordedAt: value.appointmentNoticeRecordedAt,
        appointmentReminderDraft: value.appointmentReminderDraft,
        appointmentReminderApproved: value.appointmentReminderApproved,
        appointmentReminderRecordedAt: value.appointmentReminderRecordedAt,
        appointmentOutcome: value.appointmentOutcome,
        postMeetingFollowUp: value.postMeetingFollowUp,
        researchComplete: value.researchComplete,
        researchNotes: value.researchNotes,
        researchAudit: value.researchAudit,
        outreachApproved: value.outreachApproved,
        outreachRecordedAt: value.outreachRecordedAt,
        replyApproved: value.replyApproved,
        replyRecordedAt: value.replyRecordedAt,
        meetingOptionsApproved: value.meetingOptionsApproved,
        meetingOptionsRecordedAt: value.meetingOptionsRecordedAt,
        followUpDraft: value.followUpDraft,
        followUpApproved: value.followUpApproved,
        followUps: followUps.slice(),
        replies: replies.slice(),
      },
    };
  } catch {
    return null;
  }
}

function validText(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && value.trim() === value;
}

function snapshotAppointment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validTimestamp(value.selectedSlot)
    || !MEETING_DURATIONS.has(value.durationMinutes)
    || !validText(value.confirmedBy, 128)
    || !validTimestamp(value.confirmedAt)) return null;
  return {
    selectedSlot: value.selectedSlot,
    durationMinutes: value.durationMinutes,
    confirmedBy: value.confirmedBy,
    confirmedAtValue: value.confirmedAt,
    startsAt: Date.parse(value.selectedSlot),
    confirmedAt: Date.parse(value.confirmedAt),
  };
}

function snapshotTimestamp(value) {
  return validTimestamp(value) ? Date.parse(value) : NaN;
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function snapshotDate(value) {
  try {
    const time = value instanceof Date ? value.getTime() : NaN;
    return Number.isFinite(time) ? new Date(time) : null;
  } catch {
    return null;
  }
}

function normalizeLimit(value) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, MAX_QUEUE_ITEMS) : MAX_QUEUE_ITEMS;
}

function compareItems(a, b) {
  return a.priority - b.priority
    || a.companyName.localeCompare(b.companyName, "ja")
    || a.leadId.localeCompare(b.leadId, "en");
}

function emptyQueue(invalidBatch) {
  return Object.freeze({
    items: Object.freeze([]),
    counts: Object.freeze({ queued: 0, invalid: 0, duplicate: 0, noAction: 0, overflow: 0 }),
    invalidBatch,
  });
}
