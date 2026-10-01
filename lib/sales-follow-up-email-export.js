import { buildUnsentEmailMessage, salesEmailRecipient } from "./sales-email-export.js";

const FOLLOW_UP_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

/** Builds one approved, unsent follow-up email without sending or recording it. */
export function buildUnsentSalesFollowUpEmail(rawLead) {
  const lead = snapshotLead(rawLead);
  if (!lead) return null;
  return buildUnsentEmailMessage(lead.recipient, lead.draft);
}

function snapshotLead(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const recipient = salesEmailRecipient(value.contact);
    const draft = snapshotDraft(value.followUpDraft);
    const approval = snapshotApproval(value.followUpApproval);
    const outreachApproval = snapshotApproval(value.outreachApproval);
    const outreachDelivery = snapshotDelivery(value.outreachDelivery);
    if (!recipient || !draft || !approval || !outreachApproval || !outreachDelivery
      || value.optedOut !== false || value.appointmentConfirmed !== false
      || value.outreachApproved !== true
      || value.outreachRecordedAt !== value.outreachDelivery.recordedAt
      || outreachDelivery.recordedAt < outreachApproval.approvedAt
      || value.followUpApproved !== true
      || approval.approvedAt < draft.savedAt
      || !validSignature(value.outreachDraft?.signature)
      || draft.signature !== value.outreachDraft.signature
      || !Array.isArray(value.replies) || value.replies.length !== 0
      || !Array.isArray(value.followUps) || value.followUps.length >= 2) return null;
    let latestContactAt = outreachDelivery.recordedAt;
    for (const rawFollowUp of value.followUps) {
      const followUp = snapshotDeliveredFollowUp(rawFollowUp, value.outreachDraft.signature);
      if (!followUp || followUp.savedAt < latestContactAt + FOLLOW_UP_DELAY_MS) return null;
      latestContactAt = followUp.recordedAt;
    }
    if (draft.savedAt < latestContactAt + FOLLOW_UP_DELAY_MS) return null;
    return { recipient, draft: value.followUpDraft };
  } catch {
    return null;
  }
}

function snapshotDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validText(value.subject, 160) || /[\r\n\u0000]/u.test(value.subject)
    || !validText(value.body, 4_000) || value.body.includes("\u0000")
    || !validSignature(value.signature) || !validText(value.savedBy, 128)
    || !validTimestamp(value.savedAt)) return null;
  return {
    signature: value.signature,
    savedAt: Date.parse(value.savedAt),
  };
}

function snapshotApproval(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && validText(value.actorId, 128) && validTimestamp(value.approvedAt)
    ? { approvedAt: Date.parse(value.approvedAt) } : null;
}

function snapshotDelivery(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && validText(value.actorId, 128) && validTimestamp(value.recordedAt)
    && (value.channel === "EMAIL" || value.channel === "LINE")
    ? { recordedAt: Date.parse(value.recordedAt), channel: value.channel } : null;
}

function snapshotDeliveredFollowUp(value, signature) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = snapshotDraft(value.draft);
  const approval = snapshotApproval(value.approval);
  const delivery = snapshotDelivery(value.delivery);
  if (!draft || !approval || !delivery || delivery.channel !== "EMAIL"
    || draft.signature !== signature || approval.approvedAt < draft.savedAt
    || delivery.recordedAt < approval.approvedAt) return null;
  return { savedAt: draft.savedAt, recordedAt: delivery.recordedAt };
}

function validSignature(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 500
    && value.trim() === value && !value.includes("\u0000");
}

function validText(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength
    && value.trim() === value;
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}
