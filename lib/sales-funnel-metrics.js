import { hasConsistentSalesOptOut, isBoundedSalesReplyHistory } from "./sales-reply-history.js";

const MAX_INPUT_LEADS = 500;
const MAX_COUNTED_LEADS = 100;
const MIN_APPOINTMENT_LEAD_MS = 15 * 60 * 1000;
const MEETING_DURATIONS = new Set([30, 45, 60]);
const REPLY_TYPES = new Set([
  "MATERIAL_REQUEST", "GENERAL_QUESTION", "SCHEDULING", "PRICE", "DISCOUNT",
  "CONTRACT", "COMPLAINT", "PERSONAL_DATA", "OPT_OUT", "UNKNOWN",
]);

/**
 * Produces a bounded, read-only sales funnel from already authorized leads.
 * It never writes data, sends messages, or infers events that lack an audit field.
 */
export function buildSalesFunnelMetrics(rawLeads, { now = new Date() } = {}) {
  const input = snapshotInput(rawLeads);
  const nowMs = validDate(now);
  if (!input || !Number.isFinite(nowMs)) return emptyMetrics(true);

  const seen = new Set();
  const leads = [];
  let invalid = 0;
  let duplicate = 0;
  let processed = 0;

  for (const rawLead of input.leads) {
    processed += 1;
    const lead = snapshotLead(rawLead);
    if (!lead) {
      invalid += 1;
      continue;
    }
    if (seen.has(lead.id)) {
      duplicate += 1;
      continue;
    }
    seen.add(lead.id);
    leads.push(lead);
    if (leads.length === MAX_COUNTED_LEADS) break;
  }

  const counts = {
    registered: leads.length,
    researched: leads.filter((lead) => lead.researchComplete).length,
    outreachSent: leads.filter((lead) => lead.outreachRecordedAt !== null).length,
    replied: leads.filter((lead) => lead.replies.length > 0).length,
    appointments: leads.filter((lead) => lead.appointmentConfirmed).length,
    followUpLeads: leads.filter((lead) => lead.followUps.length > 0).length,
    meetingOptionsSent: leads.filter((lead) => lead.meetingOptionsRecordedAt !== null).length,
    optedOut: leads.filter((lead) => lead.optedOut).length,
    appointmentOutcomes: leads.filter((lead) => lead.appointmentOutcome !== null).length,
    pendingAppointmentOutcomes: leads.filter((lead) => lead.appointmentConfirmed
      && lead.appointmentOutcome === null && Number.isFinite(lead.appointment?.endsAt)
      && nowMs >= lead.appointment.endsAt).length,
    won: leads.filter((lead) => lead.appointmentOutcome?.result === "WON").length,
    lost: leads.filter((lead) => lead.appointmentOutcome?.result === "LOST").length,
    noShow: leads.filter((lead) => lead.appointmentOutcome?.result === "NO_SHOW").length,
    nextAction: leads.filter((lead) => lead.appointmentOutcome?.result === "FOLLOW_UP").length,
    postMeetingFollowUps: leads.filter((lead) => lead.postMeetingFollowUp !== null).length,
    completedPostMeetingFollowUps: leads.filter((lead) => lead.postMeetingFollowUp?.completedAt !== null
      && lead.postMeetingFollowUp?.completedAt !== undefined).length,
    overduePostMeetingFollowUps: leads.filter((lead) => lead.postMeetingFollowUp !== null
      && lead.postMeetingFollowUp.completedAt === null && nowMs >= lead.postMeetingFollowUp.dueAt).length,
    invalid,
    duplicate,
    overflow: input.truncatedCount + Math.max(0, input.leads.length - processed),
  };

  return freezeMetrics(counts, false);
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
    if (!validText(value.id, 128) || !isBoundedSalesReplyHistory(value.replies)
      || !Array.isArray(value.followUps)
      || value.followUps.length > 2
      || invalidOptionalTimestamp(value.outreachRecordedAt)
      || invalidOptionalTimestamp(value.meetingOptionsRecordedAt)) return null;

    const replies = value.replies.map(snapshotReply);
    const followUps = value.followUps.map(snapshotFollowUp);
    if (replies.some((reply) => !reply) || followUps.some((followUp) => !followUp)) return null;
    const optedOut = value.optedOut;
    if (!hasConsistentSalesOptOut(replies, optedOut)) return null;
    const researchComplete = value.researchComplete === true;
    const outreachApproved = value.outreachApproved === true;
    const outreachRecordedAt = validTimestamp(value.outreachRecordedAt)
      ? value.outreachRecordedAt : null;
    // Preserve stored event order: sorting would hide corrupted audit history.
    let previousEventAt = Date.parse(outreachRecordedAt);
    for (const followUp of followUps) {
      const recordedAt = Date.parse(followUp.recordedAt);
      if (!Number.isFinite(previousEventAt) || recordedAt < previousEventAt) return null;
      previousEventAt = recordedAt;
    }
    for (const reply of replies) {
      const receivedAt = Date.parse(reply.receivedAt);
      if (!Number.isFinite(previousEventAt) || receivedAt < previousEventAt) return null;
      previousEventAt = receivedAt;
    }
    const meetingOptionsRecordedAt = validTimestamp(value.meetingOptionsRecordedAt)
      ? value.meetingOptionsRecordedAt : null;
    const meetingOptionsApproved = value.meetingOptionsApproved === true;
    const schedulingReply = replies.findLast((reply) => reply.type === "SCHEDULING") ?? null;
    const appointmentConfirmed = value.appointmentConfirmed === true;
    const appointment = snapshotAppointment(value.appointment);
    const appointmentOutcome = snapshotAppointmentOutcome(value.appointmentOutcome);
    const postMeetingFollowUp = snapshotPostMeetingFollowUp(value.postMeetingFollowUp);

    if (outreachRecordedAt && (!researchComplete || !outreachApproved)
      || replies.length > 0 && !outreachRecordedAt
      || followUps.length > 0 && !outreachRecordedAt
      || meetingOptionsRecordedAt && (!meetingOptionsApproved || !schedulingReply
        || Date.parse(meetingOptionsRecordedAt) < Date.parse(schedulingReply.receivedAt))
      || appointmentConfirmed && (!appointment || !meetingOptionsApproved
        || !meetingOptionsRecordedAt
        || appointment.confirmedAt < Date.parse(meetingOptionsRecordedAt)
        || appointment.startsAt < appointment.confirmedAt + MIN_APPOINTMENT_LEAD_MS)
      || appointment && !appointmentConfirmed
      || value.appointmentOutcome !== null && value.appointmentOutcome !== undefined
        && !appointmentOutcome
      || appointmentOutcome && (!appointmentConfirmed || !appointment
        || appointmentOutcome.recordedAt < appointment.endsAt)
      || value.postMeetingFollowUp !== null && value.postMeetingFollowUp !== undefined
        && !postMeetingFollowUp
      || postMeetingFollowUp && (appointmentOutcome?.result !== "FOLLOW_UP"
        || postMeetingFollowUp.createdAt < appointmentOutcome.recordedAt)) return null;

    return {
      id: value.id,
      researchComplete,
      outreachRecordedAt,
      replies,
      followUps,
      meetingOptionsApproved,
      meetingOptionsRecordedAt,
      appointmentConfirmed,
      appointment,
      appointmentOutcome,
      postMeetingFollowUp,
      optedOut,
    };
  } catch {
    return null;
  }
}

function snapshotReply(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !REPLY_TYPES.has(value.type) || !validTimestamp(value.receivedAt)) return null;
  return { type: value.type, receivedAt: value.receivedAt };
}

function snapshotFollowUp(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validTimestamp(value.recordedAt)) return null;
  return { recordedAt: value.recordedAt };
}

function snapshotAppointment(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validTimestamp(value.selectedSlot)
    || !MEETING_DURATIONS.has(value.durationMinutes)
    || !validText(value.confirmedBy, 128)
    || !validTimestamp(value.confirmedAt)) return null;
  const startsAt = Date.parse(value.selectedSlot);
  const endsAt = startsAt + value.durationMinutes * 60 * 1000;
  return { startsAt, endsAt, confirmedAt: Date.parse(value.confirmedAt) };
}

function snapshotAppointmentOutcome(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["FOLLOW_UP", "WON", "LOST", "NO_SHOW"].includes(value.result)
    || !validText(value.notes, 2_000) || !validText(value.actorId, 128)
    || !validTimestamp(value.recordedAt)) return null;
  return { result: value.result, recordedAt: Date.parse(value.recordedAt) };
}

function snapshotPostMeetingFollowUp(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validText(value.action, 2_000) || !validText(value.owner, 160)
    || !validText(value.createdBy, 128)
    || !validTimestamp(value.createdAt) || !validTimestamp(value.dueAt)
    || value.completedAt !== null && (!validTimestamp(value.completedAt)
      || !validText(value.completedBy, 128))
    || value.completedAt === null && value.completedBy !== null) return null;
  const createdAt = Date.parse(value.createdAt);
  const dueAt = Date.parse(value.dueAt);
  const completedAt = value.completedAt === null ? null : Date.parse(value.completedAt);
  if (dueAt < createdAt || completedAt !== null && completedAt < createdAt) return null;
  return { createdAt, dueAt, completedAt };
}

function freezeMetrics(counts, invalidBatch) {
  const funnel = Object.freeze([
    Object.freeze({ key: "registered", label: "登録", count: counts.registered }),
    Object.freeze({ key: "researched", label: "調査完了", count: counts.researched }),
    Object.freeze({ key: "outreachSent", label: "初回送信", count: counts.outreachSent }),
    Object.freeze({ key: "replied", label: "返信あり", count: counts.replied }),
    Object.freeze({ key: "appointments", label: "アポ確定", count: counts.appointments }),
  ]);
  return Object.freeze({
    funnel,
    counts: Object.freeze(counts),
    rates: Object.freeze({
      replyRate: percentage(counts.replied, counts.outreachSent),
      appointmentRate: percentage(counts.appointments, counts.outreachSent),
      appointmentOutcomeRate: percentage(counts.appointmentOutcomes, counts.appointments),
      winRate: percentage(counts.won, counts.won + counts.lost),
    }),
    invalidBatch,
  });
}

function emptyMetrics(invalidBatch) {
  return freezeMetrics({
    registered: 0,
    researched: 0,
    outreachSent: 0,
    replied: 0,
    appointments: 0,
    followUpLeads: 0,
    meetingOptionsSent: 0,
    optedOut: 0,
    appointmentOutcomes: 0,
    pendingAppointmentOutcomes: 0,
    won: 0,
    lost: 0,
    noShow: 0,
    nextAction: 0,
    postMeetingFollowUps: 0,
    completedPostMeetingFollowUps: 0,
    overduePostMeetingFollowUps: 0,
    invalid: 0,
    duplicate: 0,
    overflow: 0,
  }, invalidBatch);
}

function percentage(numerator, denominator) {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1_000) / 10;
}

function validText(value, maxLength) {
  return typeof value === "string" && value.length > 0
    && value.length <= maxLength && value.trim() === value;
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function invalidOptionalTimestamp(value) {
  return value !== null && value !== undefined && !validTimestamp(value);
}

function validDate(value) {
  try {
    const time = value instanceof Date ? value.getTime() : Number.NaN;
    return Number.isFinite(time) ? time : Number.NaN;
  } catch {
    return Number.NaN;
  }
}
