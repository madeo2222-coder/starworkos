import { hasSalesOptOutEvidence } from "./sales-reply-history.js";

const MAX_COMPANY_NAME_LENGTH = 160;
const MAX_PROPOSAL_FIT_LENGTH = 2_000;
const MAX_RESEARCH_NOTES_LENGTH = 2_000;

export function buildSalesProposal(lead) {
  try {
    const researchCompletedAt = snapshotResearchCompletedAt(lead?.researchAudit);
    if (!lead || typeof lead !== "object" || Array.isArray(lead)
      || typeof lead.id !== "string" || lead.id.length === 0 || lead.id.length > 128
      || typeof lead.companyName !== "string" || lead.companyName.length === 0
      || lead.companyName.length > MAX_COMPANY_NAME_LENGTH || lead.companyName.trim() !== lead.companyName
      || typeof lead.proposalFit !== "string" || lead.proposalFit.length === 0
      || lead.proposalFit.length > MAX_PROPOSAL_FIT_LENGTH || lead.proposalFit.trim() !== lead.proposalFit
      || !validText(lead.researchNotes, MAX_RESEARCH_NOTES_LENGTH) || lead.researchNotes.includes("\0")
      || lead.researchComplete !== true || researchCompletedAt === null
      || hasSalesOptOutEvidence(lead)) return null;

    return Object.freeze({
      id: lead.id,
      companyName: lead.companyName,
      proposalFit: lead.proposalFit,
    });
  } catch {
    return null;
  }
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

function validText(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength
    && value.trim() === value;
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}
