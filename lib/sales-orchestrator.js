import {
  hasSalesOptOutEvidence,
  isBoundedSalesReplyHistory,
} from "./sales-reply-history.js";

/**
 * Pure, side-effect-free work planning for the first STAR WORK OS sales MVP.
 *
 * This module deliberately does not call an AI provider, email/LINE, a calendar,
 * or the database. It only returns the next work a human or an AI employee may
 * prepare. Delivery always remains a separately approved operation.
 */

export const SALES_ROLES = Object.freeze({
  RESEARCHER: "researcher",
  SALES_WRITER: "sales_writer",
  SCHEDULER: "scheduler",
  SALES_MANAGER: "sales_manager",
  DELIVERY_OPERATOR: "delivery_operator",
});

export const SALES_ACTIONS = Object.freeze({
  RESEARCH_COMPANY: "RESEARCH_COMPANY",
  PREPARE_OUTREACH: "PREPARE_OUTREACH",
  PREPARE_FOLLOW_UP: "PREPARE_FOLLOW_UP",
  PREPARE_REPLY: "PREPARE_REPLY",
  PREPARE_MEETING_OPTIONS: "PREPARE_MEETING_OPTIONS",
  CONFIRM_MEETING: "CONFIRM_MEETING",
  PREPARE_APPOINTMENT_NOTICE: "PREPARE_APPOINTMENT_NOTICE",
  PREPARE_APPOINTMENT_REMINDER: "PREPARE_APPOINTMENT_REMINDER",
  RECORD_APPOINTMENT_OUTCOME: "RECORD_APPOINTMENT_OUTCOME",
  SCHEDULE_POST_MEETING_FOLLOW_UP: "SCHEDULE_POST_MEETING_FOLLOW_UP",
  COMPLETE_POST_MEETING_FOLLOW_UP: "COMPLETE_POST_MEETING_FOLLOW_UP",
  HUMAN_REVIEW: "HUMAN_REVIEW",
  STOP_CONTACT: "STOP_CONTACT",
  NO_ACTION: "NO_ACTION",
});

const SAFE_REPLY_TYPES = new Set(["MATERIAL_REQUEST", "GENERAL_QUESTION", "SCHEDULING"]);
const SENSITIVE_REPLY_TYPES = new Set([
  "PRICE",
  "DISCOUNT",
  "CONTRACT",
  "COMPLAINT",
  "PERSONAL_DATA",
  "OPT_OUT",
  "UNKNOWN",
]);
const REPLY_TYPES = new Set([...SAFE_REPLY_TYPES, ...SENSITIVE_REPLY_TYPES]);
const MEETING_DURATIONS = new Set([30, 45, 60]);

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_APPOINTMENT_LEAD_MS = 15 * 60 * 1000;

export function planSalesNextWork(rawLead, { now = new Date() } = {}) {
  const lead = snapshotLead(rawLead);
  const nowMs = validDate(now);
  if (!lead || !Number.isFinite(nowMs)) return noAction("INVALID_INPUT");

  const reply = latestReply(lead.replies);
  if (hasSalesOptOutEvidence(rawLead) || lead.optedOut || reply?.type === "OPT_OUT") {
    return work(SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.STOP_CONTACT, "OPT_OUT", false);
  }
  if (reply && SENSITIVE_REPLY_TYPES.has(reply.type)) return planReply(reply, lead);
  if (invalidApprovalDeliveryState(lead, reply)) return noAction("INVALID_INPUT");
  if (lead.invalidAppointmentConfirmation) return noAction("INVALID_INPUT");
  if (lead.appointmentConfirmed) {
    if (!lead.appointment) return noAction("INVALID_APPOINTMENT");
    if (lead.appointmentOutcome) {
      if (lead.appointmentOutcome.result !== "FOLLOW_UP") {
        return noAction("APPOINTMENT_OUTCOME_RECORDED");
      }
      if (!lead.postMeetingFollowUp) {
        return work(SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.SCHEDULE_POST_MEETING_FOLLOW_UP,
          "POST_MEETING_FOLLOW_UP_REQUIRED", false);
      }
      if (lead.postMeetingFollowUp.completedAt !== null) {
        return noAction("POST_MEETING_FOLLOW_UP_COMPLETED");
      }
      if (nowMs >= lead.postMeetingFollowUp.dueAt) {
        return work(SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.COMPLETE_POST_MEETING_FOLLOW_UP,
          "POST_MEETING_FOLLOW_UP_DUE", false);
      }
      return noAction("POST_MEETING_FOLLOW_UP_SCHEDULED");
    }
    if (nowMs < lead.appointment.startsAt) {
      if (!lead.appointmentNoticeDraft) {
        return work(SALES_ROLES.SCHEDULER, SALES_ACTIONS.PREPARE_APPOINTMENT_NOTICE,
          "APPOINTMENT_NOTICE_REQUIRED", false);
      }
      if (!lead.appointmentNoticeApproved) {
        return work(SALES_ROLES.SCHEDULER, SALES_ACTIONS.PREPARE_APPOINTMENT_NOTICE,
          "APPOINTMENT_NOTICE_APPROVAL_REQUIRED", false);
      }
      if (!Number.isFinite(lead.appointmentNoticeRecordedAt)) {
        return work(SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION,
          "WAIT_FOR_HUMAN_APPOINTMENT_NOTICE_SEND_RECORD", false);
      }
      if (nowMs < lead.appointment.startsAt - DAY_MS) {
        return noAction("APPOINTMENT_REMINDER_NOT_DUE");
      }
      if (!lead.appointmentReminderDraft) {
        return work(SALES_ROLES.SCHEDULER, SALES_ACTIONS.PREPARE_APPOINTMENT_REMINDER,
          "APPOINTMENT_REMINDER_REQUIRED", false);
      }
      if (!lead.appointmentReminderApproved) {
        return work(SALES_ROLES.SCHEDULER, SALES_ACTIONS.PREPARE_APPOINTMENT_REMINDER,
          "APPOINTMENT_REMINDER_APPROVAL_REQUIRED", false);
      }
      if (!Number.isFinite(lead.appointmentReminderRecordedAt)) {
        return work(SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION,
          "WAIT_FOR_HUMAN_APPOINTMENT_REMINDER_SEND_RECORD", false);
      }
      return noAction("APPOINTMENT_SCHEDULED");
    }
    if (nowMs < lead.appointment.endsAt) return noAction("APPOINTMENT_IN_PROGRESS");
    return work(SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.RECORD_APPOINTMENT_OUTCOME, "APPOINTMENT_OUTCOME_REQUIRED", false);
  }

  if (reply) return planReply(reply, lead);

  if (lead.followUpDraft) {
    if (lead.followUpApproved) {
      return work(SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION,
        "WAIT_FOR_HUMAN_FOLLOW_UP_SEND_RECORD", false);
    }
    return work(SALES_ROLES.SALES_WRITER, SALES_ACTIONS.PREPARE_FOLLOW_UP,
      "FOLLOW_UP_APPROVAL_REQUIRED", false);
  }
  if (lead.followUpApproved) return noAction("INVALID_FOLLOW_UP");

  if (!lead.researchComplete) return work(SALES_ROLES.RESEARCHER, SALES_ACTIONS.RESEARCH_COMPANY, "RESEARCH_REQUIRED", false);
  if (!lead.outreachApproved) return work(SALES_ROLES.SALES_WRITER, SALES_ACTIONS.PREPARE_OUTREACH, "HUMAN_APPROVAL_REQUIRED", false);
  if (!lead.outreachRecordedAt) return work(SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION, "WAIT_FOR_HUMAN_SEND_RECORD", false);

  const followUpCount = lead.followUps.length;
  if (followUpCount >= 2) return work(SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.HUMAN_REVIEW, "FOLLOW_UP_LIMIT_REACHED", false);

  const lastContactAt = latestContactAt(lead);
  if (!lastContactAt || nowMs - lastContactAt < 3 * DAY_MS) return noAction("FOLLOW_UP_NOT_DUE");
  return work(SALES_ROLES.SALES_WRITER, SALES_ACTIONS.PREPARE_FOLLOW_UP, "FOLLOW_UP_DUE", false);
}

function planReply(reply, lead) {
  if (reply.type === "OPT_OUT") return work(SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.STOP_CONTACT, "OPT_OUT", false);
  if (SENSITIVE_REPLY_TYPES.has(reply.type)) return work(SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.HUMAN_REVIEW, `SENSITIVE_REPLY_${reply.type}`, false);
  if (!SAFE_REPLY_TYPES.has(reply.type)) return work(SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.HUMAN_REVIEW, "UNKNOWN_REPLY", false);
  if (reply.type === "SCHEDULING") {
    if (Number.isFinite(lead.meetingOptionsRecordedAt)) return work(SALES_ROLES.SCHEDULER, SALES_ACTIONS.CONFIRM_MEETING, "WAIT_FOR_MEETING_CONFIRMATION", false);
    if (lead.meetingOptionsApproved) return work(SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION, "WAIT_FOR_HUMAN_MEETING_OPTIONS_SEND_RECORD", false);
    return work(SALES_ROLES.SCHEDULER, SALES_ACTIONS.PREPARE_MEETING_OPTIONS, "SCHEDULING_REPLY", false);
  }
  if (Number.isFinite(lead.replyRecordedAt)) return noAction("REPLY_RECORDED");
  if (lead.replyApproved) return work(SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION, "WAIT_FOR_HUMAN_REPLY_SEND_RECORD", false);
  return work(SALES_ROLES.SALES_WRITER, SALES_ACTIONS.PREPARE_REPLY, `SAFE_REPLY_${reply.type}`, false);
}

function work(ownerRole, action, reason, deliveryAllowed) {
  return Object.freeze({ ownerRole, action, reason, deliveryAllowed });
}

function noAction(reason) {
  return work(null, SALES_ACTIONS.NO_ACTION, reason, false);
}

function snapshotLead(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const researchComplete = value.researchComplete === true;
    const hasResearchNotes = value.researchNotes !== undefined && value.researchNotes !== "";
    const hasResearchAudit = value.researchAudit !== undefined && value.researchAudit !== null;
    const researchAudit = hasResearchAudit ? snapshotResearchAudit(value.researchAudit) : null;
    if (hasResearchNotes && (!validText(value.researchNotes, 2_000)
      || value.researchNotes.includes("\0"))
      || hasResearchAudit && (!researchAudit || !hasResearchNotes)
      || !researchComplete && (hasResearchNotes || hasResearchAudit)) return null;
    const replies = snapshotReplies(value.replies ?? []);
    const followUps = snapshotFollowUps(value.followUps ?? []);
    const outreachRecordedAt = toTime(value.outreachRecordedAt);
    if (!replies || !followUps
      || (replies.length > 0 || followUps.length > 0) && !Number.isFinite(outreachRecordedAt)) return null;
    let latestContactAt = outreachRecordedAt;
    for (const followUp of followUps) {
      if (followUp.recordedAt < latestContactAt) return null;
      latestContactAt = followUp.recordedAt;
    }
    let latestReplyAt = latestContactAt;
    for (const reply of replies) {
      if (reply.receivedAt < latestReplyAt) return null;
      latestReplyAt = reply.receivedAt;
    }
    const appointment = snapshotAppointment(value.appointment);
    const appointmentOutcome = snapshotAppointmentOutcome(value.appointmentOutcome);
    const postMeetingFollowUp = snapshotPostMeetingFollowUp(value.postMeetingFollowUp);
    const followUpDraft = snapshotFollowUpDraft(value.followUpDraft);
    const appointmentNoticeDraft = snapshotFollowUpDraft(value.appointmentNoticeDraft);
    const appointmentReminderDraft = snapshotFollowUpDraft(value.appointmentReminderDraft);
    const replyRecordedAt = toTime(value.replyRecordedAt);
    const meetingOptionsRecordedAt = toTime(value.meetingOptionsRecordedAt);
    const appointmentNoticeRecordedAt = toTime(value.appointmentNoticeRecordedAt);
    const appointmentReminderRecordedAt = toTime(value.appointmentReminderRecordedAt);
    const appointmentConfirmed = value.appointmentConfirmed === true;
    const meetingOptionsApproved = value.meetingOptionsApproved === true;
    const invalidAppointmentConfirmation = appointmentConfirmed && (!appointment
      || !meetingOptionsApproved
      || !Number.isFinite(meetingOptionsRecordedAt)
      || appointment.confirmedAt < meetingOptionsRecordedAt
      || appointment.startsAt < appointment.confirmedAt + MIN_APPOINTMENT_LEAD_MS);
    if (value.appointmentOutcome !== null && value.appointmentOutcome !== undefined
      && !appointmentOutcome
      || value.postMeetingFollowUp !== null && value.postMeetingFollowUp !== undefined
      && !postMeetingFollowUp
      || value.followUpDraft !== null && value.followUpDraft !== undefined
      && !followUpDraft
      || value.appointmentNoticeDraft !== null && value.appointmentNoticeDraft !== undefined
      && !appointmentNoticeDraft
      || value.appointmentReminderDraft !== null && value.appointmentReminderDraft !== undefined
      && !appointmentReminderDraft) return null;
    const invalidAppointmentOutcome = appointmentOutcome !== null
      && (value.appointmentConfirmed !== true || !appointment
        || Number.isFinite(appointmentOutcome.recordedAt)
          && appointmentOutcome.recordedAt < appointment.endsAt);
    const invalidPostMeetingFollowUp = postMeetingFollowUp !== null
      && (appointmentOutcome?.result !== "FOLLOW_UP"
        || postMeetingFollowUp.dueAt < postMeetingFollowUp.createdAt
        || postMeetingFollowUp.completedAt !== null
          && postMeetingFollowUp.completedAt < postMeetingFollowUp.createdAt
        || Number.isFinite(appointmentOutcome?.recordedAt)
          && postMeetingFollowUp.createdAt < appointmentOutcome.recordedAt);
    if (invalidAppointmentOutcome || invalidPostMeetingFollowUp) return null;
    return {
      optedOut: value.optedOut === true,
      appointmentConfirmed,
      invalidAppointmentConfirmation,
      appointment,
      appointmentNoticeDraft,
      appointmentNoticeApproved: value.appointmentNoticeApproved === true,
      appointmentNoticeRecordedAt,
      appointmentReminderDraft,
      appointmentReminderApproved: value.appointmentReminderApproved === true,
      appointmentReminderRecordedAt,
      appointmentOutcome,
      postMeetingFollowUp,
      researchComplete,
      outreachApproved: value.outreachApproved === true,
      outreachRecordedAt,
      replyApproved: value.replyApproved === true,
      replyRecordedAt,
      meetingOptionsApproved,
      meetingOptionsRecordedAt,
      invalidApprovalDeliveryTimestamp: [
        [value.replyRecordedAt, replyRecordedAt],
        [value.meetingOptionsRecordedAt, meetingOptionsRecordedAt],
        [value.appointmentNoticeRecordedAt, appointmentNoticeRecordedAt],
        [value.appointmentReminderRecordedAt, appointmentReminderRecordedAt],
      ].some(([raw, time]) => raw !== null && raw !== undefined && !Number.isFinite(time)),
      followUpDraft,
      followUpApproved: value.followUpApproved === true,
      followUps,
      replies,
    };
  } catch {
    return null;
  }
}

function snapshotResearchAudit(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validText(value.actorId, 128) || value.actorId.includes("\0")
    || !validResearchTimestamp(value.completedAt)
    || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 5) return null;
  const sources = [];
  for (const source of value.sources) {
    if (!validText(source, 512) || /[\s\u0000-\u001f\u007f]/u.test(source)) return null;
    try {
      const url = new URL(source);
      if (url.protocol !== "https:" || url.hostname.length === 0
        || url.username !== "" || url.password !== "" || url.href !== source) return null;
      sources.push(source);
    } catch {
      return null;
    }
  }
  return new Set(sources).size === sources.length ? { completedAt: Date.parse(value.completedAt) } : null;
}

function validResearchTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function invalidApprovalDeliveryState(lead, reply) {
  if (lead.invalidApprovalDeliveryTimestamp) return true;

  const replyWorkflowPresent = lead.replyApproved || Number.isFinite(lead.replyRecordedAt);
  if (replyWorkflowPresent
    && (!reply || !["MATERIAL_REQUEST", "GENERAL_QUESTION"].includes(reply.type))) return true;
  if (Number.isFinite(lead.replyRecordedAt)
    && (!lead.replyApproved || lead.replyRecordedAt < reply.receivedAt)) return true;

  const meetingWorkflowPresent = lead.meetingOptionsApproved
    || Number.isFinite(lead.meetingOptionsRecordedAt);
  if (meetingWorkflowPresent && reply?.type !== "SCHEDULING") return true;
  if (Number.isFinite(lead.meetingOptionsRecordedAt)
    && (!lead.meetingOptionsApproved || lead.meetingOptionsRecordedAt < reply.receivedAt)) return true;

  const noticeWorkflowPresent = lead.appointmentNoticeDraft
    || lead.appointmentNoticeApproved || Number.isFinite(lead.appointmentNoticeRecordedAt);
  if (noticeWorkflowPresent && (!lead.appointmentConfirmed || !lead.appointment)) return true;
  if (lead.appointmentNoticeDraft
    && lead.appointmentNoticeDraft.savedAt >= lead.appointment.startsAt) return true;
  if (lead.appointmentNoticeApproved && !lead.appointmentNoticeDraft) return true;
  if (Number.isFinite(lead.appointmentNoticeRecordedAt)
    && (!lead.appointmentNoticeApproved
      || !lead.appointmentNoticeDraft
      || lead.appointmentNoticeRecordedAt < lead.appointmentNoticeDraft.savedAt
      || lead.appointmentNoticeRecordedAt >= lead.appointment.startsAt)) return true;

  const reminderWorkflowPresent = lead.appointmentReminderDraft
    || lead.appointmentReminderApproved || Number.isFinite(lead.appointmentReminderRecordedAt);
  if (reminderWorkflowPresent
    && (!lead.appointmentConfirmed || !lead.appointment
      || !Number.isFinite(lead.appointmentNoticeRecordedAt))) return true;
  if (lead.appointmentReminderDraft
    && (lead.appointmentReminderDraft.savedAt < lead.appointmentNoticeRecordedAt
      || lead.appointmentReminderDraft.savedAt < lead.appointment.startsAt - DAY_MS
      || lead.appointmentReminderDraft.savedAt >= lead.appointment.startsAt)) return true;
  if (lead.appointmentReminderApproved && !lead.appointmentReminderDraft) return true;
  if (Number.isFinite(lead.appointmentReminderRecordedAt)
    && (!lead.appointmentReminderApproved
      || !lead.appointmentReminderDraft
      || lead.appointmentReminderRecordedAt < lead.appointmentReminderDraft.savedAt
      || lead.appointmentReminderRecordedAt >= lead.appointment.startsAt)) return true;

  return false;
}

function snapshotReplies(value) {
  if (!isBoundedSalesReplyHistory(value)) return null;
  const replies = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || !REPLY_TYPES.has(entry.type)) return null;
    const receivedAt = toTime(entry.receivedAt);
    if (!Number.isFinite(receivedAt)
      || entry.type === "OPT_OUT" && index !== value.length - 1) return null;
    replies.push({ type: entry.type, receivedAt });
  }
  return replies;
}

function snapshotFollowUps(value) {
  if (!Array.isArray(value) || value.length > 2) return null;
  const followUps = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const recordedAt = toTime(entry.recordedAt);
    if (!Number.isFinite(recordedAt)) return null;
    followUps.push({ recordedAt });
  }
  return followUps;
}

function snapshotFollowUpDraft(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validText(value.subject, 160) || /[\r\n\u0000]/u.test(value.subject)
    || !validText(value.body, 4_000) || value.body.includes("\u0000")
    || typeof value.signature !== "string" || value.signature.length > 500
    || value.signature.trim() !== value.signature || value.signature.includes("\u0000")
    || !validText(value.savedBy, 128) || !Number.isFinite(toTime(value.savedAt))) return null;
  return { savedAt: toTime(value.savedAt) };
}

function snapshotAppointment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !MEETING_DURATIONS.has(value.durationMinutes)
    || !validText(value.confirmedBy, 128)) return null;
  const selectedSlot = toTime(value.selectedSlot);
  const confirmedAt = toTime(value.confirmedAt);
  if (!Number.isFinite(selectedSlot) || !Number.isFinite(confirmedAt)) return null;
  const endsAt = selectedSlot + value.durationMinutes * 60 * 1000;
  return Number.isFinite(endsAt) ? { startsAt: selectedSlot, endsAt, confirmedAt } : null;
}

function snapshotAppointmentOutcome(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["FOLLOW_UP", "WON", "LOST", "NO_SHOW"].includes(value.result)) return null;
  const recordedAt = value.recordedAt === undefined ? null : toTime(value.recordedAt);
  if (recordedAt !== null && !Number.isFinite(recordedAt)) return null;
  return { result: value.result, recordedAt };
}

function snapshotPostMeetingFollowUp(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const dueAt = toTime(value.dueAt);
  const createdAt = toTime(value.createdAt);
  const completedAt = value.completedAt === null ? null : toTime(value.completedAt);
  if (!Number.isFinite(dueAt) || !Number.isFinite(createdAt)
    || completedAt !== null && !Number.isFinite(completedAt)) return null;
  return { dueAt, createdAt, completedAt };
}

function latestReply(replies) {
  const candidates = [];
  for (const entry of replies) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    try {
      const receivedAt = entry.receivedAt;
      if (!Number.isFinite(receivedAt) || typeof entry.type !== "string") continue;
      candidates.push({ type: entry.type, receivedAt });
    } catch {
      // A malformed reply must not become eligible for automation.
    }
  }
  candidates.sort((a, b) => b.receivedAt - a.receivedAt);
  return candidates[0] ?? null;
}

function latestContactAt(lead) {
  const times = [lead.outreachRecordedAt];
  for (const followUp of lead.followUps) {
    if (!followUp || typeof followUp !== "object" || Array.isArray(followUp)) continue;
    try { times.push(followUp.recordedAt); } catch { /* ignore invalid history */ }
  }
  return Math.max(...times.filter(Number.isFinite), Number.NEGATIVE_INFINITY);
}

function toTime(value) {
  if (typeof value !== "string" || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)) return NaN;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : NaN;
}

function validText(value, maxLength) {
  return typeof value === "string" && value.length > 0
    && value.length <= maxLength && value.trim() === value;
}

function validDate(value) {
  try { return value instanceof Date ? value.getTime() : NaN; } catch { return NaN; }
}
