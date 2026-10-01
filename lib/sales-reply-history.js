export const MAX_STANDARD_SALES_REPLIES = 8;
export const MAX_SALES_REPLIES_WITH_OPT_OUT = 9;

const SALES_REPLY_TYPES = new Set([
  "MATERIAL_REQUEST", "GENERAL_QUESTION", "SCHEDULING", "PRICE", "DISCOUNT",
  "CONTRACT", "COMPLAINT", "PERSONAL_DATA", "OPT_OUT", "UNKNOWN",
]);

export function isBoundedSalesReplyHistory(value) {
  if (!Array.isArray(value) || value.length > MAX_SALES_REPLIES_WITH_OPT_OUT) return false;
  if (value.length <= MAX_STANDARD_SALES_REPLIES) return true;
  return value[MAX_STANDARD_SALES_REPLIES]?.type === "OPT_OUT"
    && value.slice(0, MAX_STANDARD_SALES_REPLIES)
      .every((reply) => reply?.type !== "OPT_OUT");
}

export function hasConsistentSalesOptOut(value, optedOut) {
  if (!isBoundedSalesReplyHistory(value) || typeof optedOut !== "boolean") return false;
  const optOutIndex = value.findIndex((reply) => reply?.type === "OPT_OUT");
  return optedOut === (optOutIndex !== -1)
    && (optOutIndex === -1 || optOutIndex === value.length - 1);
}

/**
 * Treats either the cached flag or any persisted reply as contact-suppression
 * evidence. Malformed supplied histories also suppress outbound artifacts.
 */
export function hasSalesOptOutEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  try {
    if (value.optedOut === true) return true;
    if (value.optedOut !== undefined && value.optedOut !== false) return true;
    if (value.replies === undefined) return false;
    if (!isBoundedSalesReplyHistory(value.replies)
      || !value.replies.every((reply) => reply && typeof reply === "object"
        && !Array.isArray(reply) && SALES_REPLY_TYPES.has(reply.type))) return true;
    return value.replies.some((reply) => reply?.type === "OPT_OUT");
  } catch {
    return true;
  }
}

export function requiresOptOutOnlyReplyIntake(lead) {
  if (!lead || typeof lead !== "object" || Array.isArray(lead)
    || !isBoundedSalesReplyHistory(lead.replies)) return true;
  if (lead.replies.length >= MAX_STANDARD_SALES_REPLIES) return true;
  if (lead.replies.length === 0 || lead.appointmentConfirmed === true) return false;

  const latestReply = lead.replies.at(-1);
  if (latestReply?.type === "GENERAL_QUESTION" || latestReply?.type === "MATERIAL_REQUEST") {
    return lead.replyRecordedAt === null;
  }
  if (latestReply?.type === "SCHEDULING") return lead.meetingOptionsRecordedAt === null;
  return true;
}

export function salesReplyIntakeDefaultChannel(lead) {
  if (!lead || typeof lead !== "object" || Array.isArray(lead)
    || !isBoundedSalesReplyHistory(lead.replies)) return "EMAIL";
  const latestChannel = lead.replies.at(-1)?.channel;
  if (latestChannel === "EMAIL" || latestChannel === "LINE") return latestChannel;
  const deliveryChannel = lead.outreachDelivery?.channel;
  return deliveryChannel === "LINE" ? "LINE" : "EMAIL";
}
