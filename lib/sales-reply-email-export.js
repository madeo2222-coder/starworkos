import { salesEmailRecipient } from "./sales-email-export.js";
import { hasSalesOptOutEvidence, isBoundedSalesReplyHistory } from "./sales-reply-history.js";

const SAFE_TYPES = new Set(["MATERIAL_REQUEST", "GENERAL_QUESTION"]);
const REPLY_TYPES = new Set([
  "MATERIAL_REQUEST", "GENERAL_QUESTION", "SCHEDULING", "PRICE", "DISCOUNT",
  "CONTRACT", "COMPLAINT", "PERSONAL_DATA", "OPT_OUT", "UNKNOWN",
]);
const FOLLOW_UP_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

/** Builds an unsent RFC 822 draft for one approved safe inbound email reply. */
export function buildUnsentSalesReplyEmail(rawLead) {
  const lead = snapshotLead(rawLead);
  if (!lead) return null;
  const body = `${normalizeNewlines(lead.draft.body)}\r\n\r\n${normalizeNewlines(lead.draft.signature)}`;
  return [
    `To: ${lead.recipient}`,
    `Subject: ${encodeMimeHeader(lead.draft.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "X-Unsent: 1",
    "",
    foldBase64(Buffer.from(body, "utf8").toString("base64")),
    "",
  ].join("\r\n");
}

function snapshotLead(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const recipient = salesEmailRecipient(value.contact);
    const draft = snapshotDraft(value.replyDraft);
    const outreachDraft = snapshotDraft(value.outreachDraft);
    const outreachApproval = snapshotApproval(value.outreachApproval);
    const outreachDelivery = snapshotDelivery(value.outreachDelivery);
    if (!recipient || !draft || !outreachDraft || !outreachApproval || !outreachDelivery
      || value.outreachApproved !== true
      || value.outreachRecordedAt !== value.outreachDelivery.recordedAt
      || outreachDelivery.recordedAt < outreachApproval.approvedAt
      || hasSalesOptOutEvidence(value) || value.appointmentConfirmed === true) return null;
    const latestContactAt = snapshotFollowUps(
      value.followUps, outreachDelivery.recordedAt, outreachDraft.signature,
    );
    const reply = snapshotReplyHistory(value.replies, latestContactAt);
    const approval = snapshotApproval(value.replyApproval);
    if (!Number.isFinite(latestContactAt) || !reply || !approval
      || reply.channel !== "EMAIL" || !SAFE_TYPES.has(reply.type)
      || value.replyApproved !== true || value.replyRecordedAt !== null
      || value.replyDelivery !== null && value.replyDelivery !== undefined
      || approval.approvedAt < reply.receivedAt) return null;
    return { recipient, draft };
  } catch {
    return null;
  }
}

function snapshotReplyHistory(value, earliestAt) {
  if (!isBoundedSalesReplyHistory(value) || value.length === 0) return null;
  let latestAt = earliestAt;
  let unresolved = null;
  for (const valueReply of value) {
    const reply = snapshotReply(valueReply);
    if (!reply || reply.receivedAt < latestAt || unresolved) return null;
    if (valueReply.resolution === null || valueReply.resolution === undefined) {
      if (reply.type === "OPT_OUT") return null;
      unresolved = reply;
      continue;
    }
    const resolution = snapshotResolution(valueReply.resolution, reply);
    if (!resolution) return null;
    latestAt = resolution.recordedAt;
  }
  return unresolved;
}

function snapshotReply(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (value.channel !== "EMAIL" && value.channel !== "LINE")
    || !REPLY_TYPES.has(value.type) || !validText(value.message, 4_000)
    || value.message.includes("\u0000") || !validText(value.actorId, 128)
    || !validTimestamp(value.receivedAt)) return null;
  return { channel: value.channel, type: value.type, receivedAt: Date.parse(value.receivedAt) };
}

function snapshotResolution(value, reply) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const approval = snapshotApproval(value.approval);
  const delivery = snapshotDelivery(value.delivery);
  if (!approval || !delivery || delivery.channel !== reply.channel
    || approval.approvedAt < reply.receivedAt
    || delivery.recordedAt < approval.approvedAt) return null;
  if (value.kind === "SAFE_REPLY") {
    if (!snapshotDraft(value.draft)) return null;
  } else if (value.kind === "MEETING_OPTIONS") {
    const savedAt = snapshotMeetingOptionsDraft(value.draft);
    if (!Number.isFinite(savedAt) || approval.approvedAt < savedAt) return null;
  } else {
    return null;
  }
  return { recordedAt: delivery.recordedAt };
}

function snapshotMeetingOptionsDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validText(value.message, 4_000) || value.message.includes("\u0000")
    || !validText(value.savedBy, 128) || !validTimestamp(value.savedAt)
    || !Array.isArray(value.slots) || value.slots.length < 2 || value.slots.length > 3
    || !value.slots.every(validTimestamp)
    || new Set(value.slots).size !== value.slots.length) return NaN;
  for (let index = 1; index < value.slots.length; index += 1) {
    if (Date.parse(value.slots[index]) <= Date.parse(value.slots[index - 1])) return NaN;
  }
  return Date.parse(value.savedAt);
}

function snapshotFollowUps(value, initialContactAt, signature) {
  if (!Array.isArray(value) || value.length > 2) return NaN;
  let latestContactAt = initialContactAt;
  for (const followUp of value) {
    if (!followUp || typeof followUp !== "object" || Array.isArray(followUp)) return NaN;
    const draft = snapshotTimedDraft(followUp.draft);
    const approval = snapshotApproval(followUp.approval);
    const delivery = snapshotDelivery(followUp.delivery);
    if (!draft || !approval || !delivery || delivery.channel !== "EMAIL"
      || draft.signature !== signature || draft.savedAt < latestContactAt + FOLLOW_UP_DELAY_MS
      || approval.approvedAt < draft.savedAt || delivery.recordedAt < approval.approvedAt) return NaN;
    latestContactAt = delivery.recordedAt;
  }
  return latestContactAt;
}

function snapshotTimedDraft(value) {
  const draft = snapshotDraft(value);
  if (!draft || !validText(value.savedBy, 128) || !validTimestamp(value.savedAt)) return null;
  return { signature: value.signature, savedAt: Date.parse(value.savedAt) };
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

function snapshotDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validText(value.subject, 160) || !validText(value.body, 4_000)
    || !validText(value.signature, 500) || /[\u0000-\u001f\u007f]/u.test(value.subject)
    || value.body.includes("\u0000") || value.signature.includes("\u0000")) return null;
  return { subject: value.subject, body: value.body, signature: value.signature };
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

function normalizeNewlines(value) {
  return value.replace(/\r\n?/gu, "\n").replace(/\n/gu, "\r\n");
}

function encodeMimeHeader(value) {
  const words = [];
  let chunk = "";
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > 30 && chunk) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
      chunk = "";
      bytes = 0;
    }
    chunk += character;
    bytes += size;
  }
  if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
  return words.join("\r\n ");
}

function foldBase64(value) {
  return value.match(/.{1,76}/gu)?.join("\r\n") ?? "";
}
