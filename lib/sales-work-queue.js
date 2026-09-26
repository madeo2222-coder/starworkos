import { planSalesNextWork, SALES_ACTIONS } from "./sales-orchestrator.js";

const MAX_INPUT_LEADS = 500;
const MAX_QUEUE_ITEMS = 100;

const ACTION_PRIORITY = Object.freeze({
  [SALES_ACTIONS.STOP_CONTACT]: 0,
  [SALES_ACTIONS.HUMAN_REVIEW]: 1,
  [SALES_ACTIONS.PREPARE_MEETING_OPTIONS]: 2,
  [SALES_ACTIONS.PREPARE_REPLY]: 3,
  [SALES_ACTIONS.NO_ACTION]: 4,
  [SALES_ACTIONS.PREPARE_OUTREACH]: 5,
  [SALES_ACTIONS.PREPARE_FOLLOW_UP]: 6,
  [SALES_ACTIONS.RESEARCH_COMPANY]: 7,
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
    if (plan.ownerRole === null || (plan.action === SALES_ACTIONS.NO_ACTION && plan.reason !== "WAIT_FOR_HUMAN_SEND_RECORD")) {
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
    if (!validText(id, 128) || !validText(companyName, 160)) return null;

    return {
      id,
      companyName,
      planInput: {
        optedOut: value.optedOut,
        appointmentConfirmed: value.appointmentConfirmed,
        researchComplete: value.researchComplete,
        outreachApproved: value.outreachApproved,
        outreachRecordedAt: value.outreachRecordedAt,
        followUps: snapshotArray(value.followUps),
        replies: snapshotArray(value.replies),
      },
    };
  } catch {
    return null;
  }
}

function snapshotArray(value) {
  return Array.isArray(value) ? value.slice(0, 8) : [];
}

function validText(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && value.trim() === value;
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
