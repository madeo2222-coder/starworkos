export const SALES_LEAD_RECORD_PREFIX = "STAR_WORK_OS_SALES_LEAD_V1\n";

const MAX_RECORD_LENGTH = 12_000;

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

    return Object.freeze({
      id,
      companyName: value.companyName,
      website: value.website ?? "",
      contact: value.contact ?? "",
      proposalFit: value.proposalFit ?? "",
      researchNotes: typeof value.researchNotes === "string" ? value.researchNotes.slice(0, 2_000) : "",
      optedOut: value.optedOut === true,
      appointmentConfirmed: value.appointmentConfirmed === true,
      researchComplete: value.researchComplete === true,
      outreachApproved: value.outreachApproved === true,
      outreachRecordedAt: typeof value.outreachRecordedAt === "string" ? value.outreachRecordedAt : null,
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
