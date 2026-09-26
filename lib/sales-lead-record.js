export const SALES_LEAD_RECORD_PREFIX = "STAR_WORK_OS_SALES_LEAD_V1\n";

const MAX_RECORD_LENGTH = 12_000;

// Pure transitions: approval is attached only to the persisted draft and never sends it.
export function saveSalesOutreachDraft(id, content, input) {
  const record = editableOutreachRecord(id, content);
  if (!record) return null;
  try {
    const draft = {
      subject: cleanText(input.subject),
      body: cleanText(input.body),
      signature: cleanText(input.signature),
    };
    if (!validDraft(draft)) return null;
    return encodeRecord({ ...record, outreachDraft: draft, outreachApproved: false, outreachApproval: null });
  } catch {
    return null;
  }
}

export function approveSalesOutreachDraft(id, content, actorId, approvedAt) {
  const record = editableOutreachRecord(id, content);
  if (!record || record.outreachApproved || !validDraft(record.outreachDraft)
    || !validText(record.outreachDraft.signature, 500)
    || !validText(actorId, 128)
    || typeof approvedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(approvedAt)
    || !Number.isFinite(Date.parse(approvedAt))) return null;
  return encodeRecord({
    ...record, outreachApproved: true, outreachApproval: { actorId, approvedAt },
  });
}

// Records a delivery performed outside WORK OS. This transition never sends a message.
export function recordSalesOutreachDelivery(id, content, actorId, recordedAt, channel) {
  const lead = parseSalesLeadRecord(id, content);
  if (!lead || lead.optedOut || lead.appointmentConfirmed || !lead.researchComplete
    || !lead.outreachApproved || lead.outreachRecordedAt !== null
    || lead.replies.length !== 0 || lead.followUps.length !== 0
    || !validText(actorId, 128) || !validTimestamp(recordedAt)
    || (channel !== "EMAIL" && channel !== "LINE")) return null;
  try {
    const record = JSON.parse(content.slice(SALES_LEAD_RECORD_PREFIX.length));
    if (!validDraft(record.outreachDraft) || !validAudit(record.outreachApproval)
      || (record.outreachDelivery !== undefined && record.outreachDelivery !== null)) return null;
    return encodeRecord({
      ...record,
      outreachRecordedAt: recordedAt,
      outreachDelivery: { actorId, recordedAt, channel },
    });
  } catch {
    return null;
  }
}

function editableOutreachRecord(id, content) {
  if (!parseSalesLeadRecord(id, content)) return null;
  const record = JSON.parse(content.slice(SALES_LEAD_RECORD_PREFIX.length));
  if (record.researchComplete !== true || record.optedOut !== false
    || record.appointmentConfirmed !== false || typeof record.outreachApproved !== "boolean"
    || record.outreachRecordedAt !== null
    || !Array.isArray(record.replies) || record.replies.length !== 0
    || !Array.isArray(record.followUps) || record.followUps.length !== 0) return null;
  return record;
}

function validDraft(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && validText(value.subject, 160) && !/[\r\n\u0000]/.test(value.subject)
    && validText(value.body, 4_000) && !value.body.includes("\u0000")
    && typeof value.signature === "string" && value.signature.length <= 500
    && value.signature.trim() === value.signature && !value.signature.includes("\u0000");
}

function validAudit(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && validText(value.actorId, 128) && validTimestamp(value.approvedAt);
}

function validDelivery(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && validText(value.actorId, 128) && validTimestamp(value.recordedAt)
    && (value.channel === "EMAIL" || value.channel === "LINE");
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function encodeRecord(record) {
  const result = SALES_LEAD_RECORD_PREFIX + JSON.stringify(record);
  return result.length <= MAX_RECORD_LENGTH ? result : null;
}

export function completeSalesResearch(id, content, notes) {
  const lead = parseSalesLeadRecord(id, content);
  if (!lead || typeof notes !== "string") return null;
  const researchNotes = notes.trim();
  if (!validText(researchNotes, 2_000)) return null;
  const record = JSON.parse(content.slice(SALES_LEAD_RECORD_PREFIX.length));
  // Only a pristine research-stage record may advance. Preserve all stored fields.
  if (record.researchComplete !== false || record.optedOut !== false
    || record.appointmentConfirmed !== false || record.outreachApproved !== false
    || record.outreachRecordedAt !== null
    || !Array.isArray(record.replies) || record.replies.length !== 0
    || !Array.isArray(record.followUps) || record.followUps.length !== 0) return null;
  const next = SALES_LEAD_RECORD_PREFIX + JSON.stringify({
    ...record, researchComplete: true, researchNotes,
  });
  return next.length <= MAX_RECORD_LENGTH ? next : null;
}

export function createSalesLeadRecord(rawInput) {
  const input = snapshotCreateInput(rawInput);
  if (!input) return null;

  return `${SALES_LEAD_RECORD_PREFIX}${JSON.stringify({
    ...input,
    optedOut: false,
    appointmentConfirmed: false,
    researchComplete: false,
    outreachApproved: false,
    outreachRecordedAt: null,
    outreachDelivery: null,
    followUps: [],
    replies: [],
  })}`;
}

export function parseSalesLeadRecord(id, content) {
  if (!validText(id, 128) || typeof content !== "string" || content.length > MAX_RECORD_LENGTH) return null;
  if (!content.startsWith(SALES_LEAD_RECORD_PREFIX)) return null;

  try {
    const value = JSON.parse(content.slice(SALES_LEAD_RECORD_PREFIX.length));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (!validText(value.companyName, 160)) return null;
    if (!optionalText(value.website, 512) || !optionalText(value.contact, 254) || !optionalText(value.proposalFit, 2_000)) return null;
    if (value.outreachDraft !== undefined && !validDraft(value.outreachDraft)) return null;
    if (value.outreachRecordedAt !== null && value.outreachRecordedAt !== undefined
      && !validTimestamp(value.outreachRecordedAt)) return null;
    if (value.outreachDelivery !== null && value.outreachDelivery !== undefined
      && !validDelivery(value.outreachDelivery)) return null;

    return Object.freeze({
      id,
      companyName: value.companyName,
      website: value.website ?? "",
      contact: value.contact ?? "",
      proposalFit: value.proposalFit ?? "",
      researchNotes: typeof value.researchNotes === "string" ? value.researchNotes.slice(0, 2_000) : "",
      outreachDraft: value.outreachDraft ? Object.freeze({
        subject: value.outreachDraft.subject,
        body: value.outreachDraft.body,
        signature: value.outreachDraft.signature,
      }) : null,
      optedOut: value.optedOut === true,
      appointmentConfirmed: value.appointmentConfirmed === true,
      researchComplete: value.researchComplete === true,
      outreachApproved: value.outreachApproved === true,
      outreachRecordedAt: typeof value.outreachRecordedAt === "string" ? value.outreachRecordedAt : null,
      outreachDelivery: value.outreachDelivery ? Object.freeze({
        actorId: value.outreachDelivery.actorId,
        recordedAt: value.outreachDelivery.recordedAt,
        channel: value.outreachDelivery.channel,
      }) : null,
      followUps: Array.isArray(value.followUps) ? value.followUps.slice(0, 8) : [],
      replies: Array.isArray(value.replies) ? value.replies.slice(0, 8) : [],
    });
  } catch {
    return null;
  }
}

function snapshotCreateInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const companyName = cleanText(value.companyName);
    const website = cleanText(value.website);
    const contact = cleanText(value.contact);
    const proposalFit = cleanText(value.proposalFit);

    if (!validText(companyName, 160)) return null;
    if (!optionalText(website, 512) || !optionalText(contact, 254) || !optionalText(proposalFit, 2_000)) return null;
    if (website && !/^https?:\/\/[^\s]+$/u.test(website)) return null;

    return { companyName, website, contact, proposalFit };
  } catch {
    return null;
  }
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validText(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && value.trim() === value;
}

function optionalText(value, maxLength) {
  return value === undefined || (typeof value === "string" && value.length <= maxLength && value.trim() === value);
}
