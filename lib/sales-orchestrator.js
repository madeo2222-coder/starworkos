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

const DAY_MS = 24 * 60 * 60 * 1000;

export function planSalesNextWork(rawLead, { now = new Date() } = {}) {
  const lead = snapshotLead(rawLead);
  const nowMs = validDate(now);
  if (!lead || !Number.isFinite(nowMs)) return noAction("INVALID_INPUT");

  if (lead.optedOut) return work(SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.STOP_CONTACT, "OPT_OUT", false);
  if (lead.appointmentConfirmed) return work(SALES_ROLES.SCHEDULER, SALES_ACTIONS.NO_ACTION, "APPOINTMENT_CONFIRMED", false);

  const reply = latestReply(lead.replies);
  if (reply) return planReply(reply);

  if (!lead.researchComplete) return work(SALES_ROLES.RESEARCHER, SALES_ACTIONS.RESEARCH_COMPANY, "RESEARCH_REQUIRED", false);
  if (!lead.outreachApproved) return work(SALES_ROLES.SALES_WRITER, SALES_ACTIONS.PREPARE_OUTREACH, "HUMAN_APPROVAL_REQUIRED", false);
  if (!lead.outreachRecordedAt) return work(SALES_ROLES.DELIVERY_OPERATOR, SALES_ACTIONS.NO_ACTION, "WAIT_FOR_HUMAN_SEND_RECORD", false);

  const followUpCount = lead.followUps.length;
  if (followUpCount >= 2) return work(SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.HUMAN_REVIEW, "FOLLOW_UP_LIMIT_REACHED", false);

  const lastContactAt = latestContactAt(lead);
  if (!lastContactAt || nowMs - lastContactAt < 3 * DAY_MS) return noAction("FOLLOW_UP_NOT_DUE");
  return work(SALES_ROLES.SALES_WRITER, SALES_ACTIONS.PREPARE_FOLLOW_UP, "FOLLOW_UP_DUE", false);
}

function planReply(reply) {
  if (reply.type === "OPT_OUT") return work(SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.STOP_CONTACT, "OPT_OUT", false);
  if (SENSITIVE_REPLY_TYPES.has(reply.type)) return work(SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.HUMAN_REVIEW, `SENSITIVE_REPLY_${reply.type}`, false);
  if (!SAFE_REPLY_TYPES.has(reply.type)) return work(SALES_ROLES.SALES_MANAGER, SALES_ACTIONS.HUMAN_REVIEW, "UNKNOWN_REPLY", false);
  if (reply.type === "SCHEDULING") return work(SALES_ROLES.SCHEDULER, SALES_ACTIONS.PREPARE_MEETING_OPTIONS, "SCHEDULING_REPLY", false);
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
    return {
      optedOut: value.optedOut === true,
      appointmentConfirmed: value.appointmentConfirmed === true,
      researchComplete: value.researchComplete === true,
      outreachApproved: value.outreachApproved === true,
      outreachRecordedAt: toTime(value.outreachRecordedAt),
      followUps: asArray(value.followUps),
      replies: asArray(value.replies),
    };
  } catch {
    return null;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value.slice(0, 8) : [];
}

function latestReply(replies) {
  const candidates = [];
  for (const entry of replies) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    try {
      const receivedAt = toTime(entry.receivedAt);
      if (!receivedAt || typeof entry.type !== "string") continue;
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
    try { times.push(toTime(followUp.recordedAt)); } catch { /* ignore invalid history */ }
  }
  return Math.max(...times.filter(Number.isFinite), Number.NEGATIVE_INFINITY);
}

function toTime(value) {
  if (typeof value !== "string" || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)) return NaN;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : NaN;
}

function validDate(value) {
  try { return value instanceof Date ? value.getTime() : NaN; } catch { return NaN; }
}
