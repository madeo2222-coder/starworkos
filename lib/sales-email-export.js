const EMAIL_PATTERN = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/giu;

/**
 * Returns one unambiguous ASCII mailbox from a bounded contact field.
 * Free-form labels are allowed, but multiple occurrences or control characters fail closed.
 */
export function salesEmailRecipient(rawContact) {
  if (typeof rawContact !== "string" || rawContact.length === 0 || rawContact.length > 254
    || rawContact.trim() !== rawContact || /[\u0000-\u001f\u007f]/u.test(rawContact)) return null;
  const matches = rawContact.match(EMAIL_PATTERN);
  if (!matches || matches.length !== 1) return null;
  const address = matches[0];
  if (!validMailbox(address)) return null;
  return address;
}

/**
 * Builds an RFC 822 email draft that a human can open in a mail client.
 * This function performs no network request and never records a delivery.
 */
export function buildUnsentSalesEmail(rawLead) {
  const lead = snapshotLead(rawLead);
  if (!lead) return null;

  return buildUnsentEmailMessage(lead.recipient, lead.draft);
}

// Shared pure formatter for already-authorized draft export flows.
export function buildUnsentEmailMessage(rawRecipient, rawDraft) {
  const recipient = salesEmailRecipient(rawRecipient);
  const draft = snapshotDraft(rawDraft);
  if (!recipient || !draft) return null;

  const body = `${draft.body}\r\n\r\n${draft.signature}`;
  const encodedBody = foldBase64(Buffer.from(body, "utf8").toString("base64"));
  return [
    `To: ${recipient}`,
    `Subject: ${encodeMimeHeader(draft.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "X-Unsent: 1",
    "",
    encodedBody,
    "",
  ].join("\r\n");
}

function snapshotLead(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const recipient = salesEmailRecipient(value.contact);
    const draft = snapshotDraft(value.outreachDraft);
    const approval = snapshotApproval(value.outreachApproval);
    const hasResearchAudit = value.researchAudit !== null && value.researchAudit !== undefined;
    const researchCompletedAt = hasResearchAudit
      ? snapshotResearchCompletedAt(value.researchAudit) : null;
    if (!recipient || !draft || !approval
      || hasResearchAudit && researchCompletedAt === null
      || researchCompletedAt !== null && approval.approvedAt < researchCompletedAt
      || value.outreachApproved !== true
      || value.outreachRecordedAt !== null || value.optedOut === true
      || value.outreachDelivery !== null && value.outreachDelivery !== undefined
      || value.appointmentConfirmed === true
      || !Array.isArray(value.replies) || value.replies.length !== 0
      || !Array.isArray(value.followUps) || value.followUps.length !== 0) return null;
    return { recipient, draft };
  } catch {
    return null;
  }
}

function snapshotApproval(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validText(value.actorId, 128) || !validTimestamp(value.approvedAt)) return null;
  return { approvedAt: Date.parse(value.approvedAt) };
}

function snapshotResearchCompletedAt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validText(value.actorId, 128) || !validTimestamp(value.completedAt)
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
  return new Set(sources).size === sources.length ? Date.parse(value.completedAt) : null;
}

function snapshotDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validText(value.subject, 160) || !validText(value.body, 4_000)
    || !validText(value.signature, 500)
    || containsControl(value.subject) || value.body.includes("\u0000")
    || value.signature.includes("\u0000")) return null;
  return {
    subject: value.subject,
    body: normalizeNewlines(value.body),
    signature: normalizeNewlines(value.signature),
  };
}

function validMailbox(value) {
  if (value.length > 254 || !/^[\x21-\x7e]+$/u.test(value)) return false;
  const [local, domain, ...rest] = value.split("@");
  return rest.length === 0 && local.length > 0 && local.length <= 64
    && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..")
    && domain.length > 0 && domain.length <= 253;
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

function containsControl(value) {
  return /[\u0000-\u001f\u007f]/u.test(value);
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
      words.push(mimeWord(chunk));
      chunk = "";
      bytes = 0;
    }
    chunk += character;
    bytes += size;
  }
  if (chunk) words.push(mimeWord(chunk));
  return words.join("\r\n ");
}

function mimeWord(value) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function foldBase64(value) {
  return value.match(/.{1,76}/gu)?.join("\r\n") ?? "";
}
