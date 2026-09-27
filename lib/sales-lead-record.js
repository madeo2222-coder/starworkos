export const SALES_LEAD_RECORD_PREFIX = "STAR_WORK_OS_SALES_LEAD_V1\n";

const MAX_RECORD_LENGTH = 12_000;
const SALES_REPLY_TYPES = new Set([
  "MATERIAL_REQUEST", "GENERAL_QUESTION", "SCHEDULING", "PRICE", "DISCOUNT",
  "CONTRACT", "COMPLAINT", "PERSONAL_DATA", "OPT_OUT", "UNKNOWN",
]);
const SAFE_REPLY_DRAFT_TYPES = new Set(["MATERIAL_REQUEST", "GENERAL_QUESTION"]);
const MEETING_DURATIONS = new Set([30, 45, 60]);
const MIN_MEETING_LEAD_MS = 30 * 60 * 1000;
const MAX_MEETING_LEAD_MS = 180 * 24 * 60 * 60 * 1000;
const MIN_APPOINTMENT_LEAD_MS = 15 * 60 * 1000;

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

// Reply approval is attached only to the persisted draft and never sends it.
export function saveSalesReplyDraft(id, content, input) {
  const record = editableReplyRecord(id, content);
  if (!record) return null;
  try {
    const draft = {
      subject: cleanText(input.subject),
      body: cleanText(input.body),
      signature: cleanText(input.signature),
    };
    if (!validDraft(draft)) return null;
    return encodeRecord({ ...record, replyDraft: draft, replyApproved: false, replyApproval: null });
  } catch {
    return null;
  }
}

export function approveSalesReplyDraft(id, content, actorId, approvedAt) {
  const record = editableReplyRecord(id, content);
  if (!record || record.replyApproved === true || !validDraft(record.replyDraft)
    || !validText(record.replyDraft.signature, 500)
    || !validText(actorId, 128) || !validTimestamp(approvedAt)) return null;
  return encodeRecord({
    ...record, replyApproved: true, replyApproval: { actorId, approvedAt },
  });
}

// Records a reply delivery completed outside WORK OS. This transition never sends it.
export function recordSalesReplyDelivery(id, content, actorId, recordedAt) {
  const lead = parseSalesLeadRecord(id, content);
  if (!lead || lead.optedOut || lead.appointmentConfirmed || !lead.replyApproved
    || lead.replyRecordedAt !== null || lead.followUps.length !== 0
    || lead.replies.length !== 1 || !SAFE_REPLY_DRAFT_TYPES.has(lead.replies[0].type)
    || !validText(actorId, 128) || !validTimestamp(recordedAt)) return null;
  try {
    const record = JSON.parse(content.slice(SALES_LEAD_RECORD_PREFIX.length));
    const reply = record.replies[0];
    if (!validDraft(record.replyDraft) || !validAudit(record.replyApproval)
      || !validReply(reply)
      || (record.replyDelivery !== undefined && record.replyDelivery !== null)) return null;
    return encodeRecord({
      ...record,
      replyRecordedAt: recordedAt,
      replyDelivery: { actorId, recordedAt, channel: reply.channel },
    });
  } catch {
    return null;
  }
}

// Stores reviewable meeting candidates for scheduling replies. It never creates calendar events.
export function saveSalesMeetingOptions(id, content, rawSlots, durationMinutes, actorId, savedAt) {
  const record = editableMeetingRecord(id, content);
  if (!record || !validText(actorId, 128) || !validTimestamp(savedAt)
    || !MEETING_DURATIONS.has(durationMinutes)) return null;
  try {
    if (!Array.isArray(rawSlots)) return null;
    const slots = rawSlots.filter((slot) => slot !== "");
    if (slots.length < 2 || slots.length > 3 || !slots.every(validTimestamp)) return null;
    const savedTime = Date.parse(savedAt);
    const times = slots.map((slot) => Date.parse(slot));
    if (new Set(slots).size !== slots.length
      || times.some((time) => time < savedTime + MIN_MEETING_LEAD_MS
        || time > savedTime + MAX_MEETING_LEAD_MS)) return null;
    slots.sort((a, b) => Date.parse(a) - Date.parse(b));
    const draft = {
      slots,
      timeZone: "Asia/Tokyo",
      durationMinutes,
      savedBy: actorId,
      savedAt,
    };
    if (!validMeetingOptionsDraft(draft)) return null;
    return encodeRecord({
      ...record,
      meetingOptionsDraft: draft,
      meetingOptionsApproved: false,
      meetingOptionsApproval: null,
    });
  } catch {
    return null;
  }
}

export function approveSalesMeetingOptions(id, content, actorId, approvedAt) {
  const record = editableMeetingRecord(id, content);
  if (!record || record.meetingOptionsApproved === true
    || !validMeetingOptionsDraft(record.meetingOptionsDraft)
    || !validText(actorId, 128) || !validTimestamp(approvedAt)) return null;
  const approvedTime = Date.parse(approvedAt);
  if (approvedTime < Date.parse(record.meetingOptionsDraft.savedAt)
    || record.meetingOptionsDraft.slots.some((slot) => Date.parse(slot)
      < approvedTime + MIN_MEETING_LEAD_MS)) return null;
  return encodeRecord({
    ...record,
    meetingOptionsApproved: true,
    meetingOptionsApproval: { actorId, approvedAt },
  });
}

// Records meeting candidates delivered outside WORK OS. This transition never sends them.
export function recordSalesMeetingOptionsDelivery(id, content, actorId, recordedAt) {
  const lead = parseSalesLeadRecord(id, content);
  if (!lead || lead.optedOut || lead.appointmentConfirmed || !lead.meetingOptionsApproved
    || lead.meetingOptionsRecordedAt !== null || lead.replyRecordedAt !== null
    || lead.followUps.length !== 0 || lead.replies.length !== 1
    || lead.replies[0].type !== "SCHEDULING" || !validText(actorId, 128)
    || !validTimestamp(recordedAt)) return null;
  try {
    const record = JSON.parse(content.slice(SALES_LEAD_RECORD_PREFIX.length));
    const reply = record.replies[0];
    const recordedTime = Date.parse(recordedAt);
    if (!validMeetingOptionsDraft(record.meetingOptionsDraft)
      || !validAudit(record.meetingOptionsApproval) || !validReply(reply)
      || (record.meetingOptionsDelivery !== undefined && record.meetingOptionsDelivery !== null)
      || (record.meetingOptionsRecordedAt !== undefined && record.meetingOptionsRecordedAt !== null)
      || recordedTime < Date.parse(record.meetingOptionsApproval.approvedAt)
      || recordedTime < Date.parse(record.meetingOptionsDraft.savedAt)
      || record.meetingOptionsDraft.slots.some((slot) => Date.parse(slot)
        < recordedTime + MIN_MEETING_LEAD_MS)) return null;
    return encodeRecord({
      ...record,
      meetingOptionsRecordedAt: recordedAt,
      meetingOptionsDelivery: { actorId, recordedAt, channel: reply.channel },
    });
  } catch {
    return null;
  }
}

// Confirms a prospect-selected option. It never creates a calendar event or sends an invite.
export function confirmSalesAppointment(id, content, rawInput, actorId, confirmedAt) {
  const lead = parseSalesLeadRecord(id, content);
  if (!lead || lead.optedOut || lead.appointmentConfirmed || !lead.meetingOptionsApproved
    || lead.meetingOptionsRecordedAt === null || !lead.meetingOptionsDraft
    || lead.replies.length !== 1 || lead.replies[0].type !== "SCHEDULING"
    || !validText(actorId, 128) || !validTimestamp(confirmedAt)) return null;
  try {
    const input = {
      selectedSlot: rawInput.selectedSlot,
      meetingUrl: cleanText(rawInput.meetingUrl),
      notes: cleanText(rawInput.notes),
    };
    const confirmedTime = Date.parse(confirmedAt);
    if (!validTimestamp(input.selectedSlot)
      || !lead.meetingOptionsDraft.slots.includes(input.selectedSlot)
      || !validMeetingUrl(input.meetingUrl) || !optionalText(input.notes, 1_000)
      || confirmedTime < Date.parse(lead.meetingOptionsRecordedAt)
      || Date.parse(input.selectedSlot) < confirmedTime + MIN_APPOINTMENT_LEAD_MS) return null;
    const record = JSON.parse(content.slice(SALES_LEAD_RECORD_PREFIX.length));
    if (record.appointment !== undefined && record.appointment !== null) return null;
    const appointment = {
      selectedSlot: input.selectedSlot,
      timeZone: record.meetingOptionsDraft.timeZone,
      durationMinutes: record.meetingOptionsDraft.durationMinutes,
      meetingUrl: input.meetingUrl,
      notes: input.notes,
      confirmedBy: actorId,
      confirmedAt,
    };
    if (!validAppointment(appointment)) return null;
    return encodeRecord({ ...record, appointmentConfirmed: true, appointment });
  } catch {
    return null;
  }
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
      || Date.parse(recordedAt) < Date.parse(record.outreachApproval.approvedAt)
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

// Captures a reply received outside WORK OS. It classifies work but never replies.
export function recordSalesReply(id, content, rawInput, actorId, receivedAt) {
  const lead = parseSalesLeadRecord(id, content);
  if (!lead || lead.optedOut || lead.appointmentConfirmed || !lead.outreachApproved
    || lead.outreachRecordedAt === null || lead.replies.length !== 0
    || lead.followUps.length !== 0 || !validText(actorId, 128)
    || !validTimestamp(receivedAt)) return null;
  try {
    const input = {
      channel: rawInput.channel,
      type: rawInput.type,
      message: cleanText(rawInput.message),
    };
    const reply = { ...input, actorId, receivedAt };
    if (!validReply(reply)) return null;
    const record = JSON.parse(content.slice(SALES_LEAD_RECORD_PREFIX.length));
    if (!validDraft(record.outreachDraft) || !validAudit(record.outreachApproval)
      || !validDelivery(record.outreachDelivery)
      || record.outreachRecordedAt !== record.outreachDelivery.recordedAt) return null;
    return encodeRecord({
      ...record,
      optedOut: reply.type === "OPT_OUT",
      replies: [reply],
      replyDraft: null,
      replyApproved: false,
      replyApproval: null,
      replyRecordedAt: null,
      replyDelivery: null,
      meetingOptionsDraft: null,
      meetingOptionsApproved: false,
      meetingOptionsApproval: null,
      meetingOptionsRecordedAt: null,
      meetingOptionsDelivery: null,
    });
  } catch {
    return null;
  }
}

function editableMeetingRecord(id, content) {
  const lead = parseSalesLeadRecord(id, content);
  if (!lead || lead.optedOut || lead.appointmentConfirmed || !lead.outreachApproved
    || lead.outreachRecordedAt === null || lead.followUps.length !== 0
    || lead.replies.length !== 1 || lead.replies[0].type !== "SCHEDULING"
    || lead.replyRecordedAt !== null || lead.meetingOptionsRecordedAt !== null) return null;
  try {
    const record = JSON.parse(content.slice(SALES_LEAD_RECORD_PREFIX.length));
    if (!validDraft(record.outreachDraft) || !validAudit(record.outreachApproval)
      || !validDelivery(record.outreachDelivery)
      || record.outreachRecordedAt !== record.outreachDelivery.recordedAt) return null;
    return record;
  } catch {
    return null;
  }
}

function editableReplyRecord(id, content) {
  const lead = parseSalesLeadRecord(id, content);
  if (!lead || lead.optedOut || lead.appointmentConfirmed || !lead.outreachApproved
    || lead.outreachRecordedAt === null || lead.followUps.length !== 0
    || lead.replies.length !== 1 || !SAFE_REPLY_DRAFT_TYPES.has(lead.replies[0].type)
    || lead.replyRecordedAt !== null) return null;
  try {
    const record = JSON.parse(content.slice(SALES_LEAD_RECORD_PREFIX.length));
    if (!validDraft(record.outreachDraft) || !validAudit(record.outreachApproval)
      || !validDelivery(record.outreachDelivery)
      || record.outreachRecordedAt !== record.outreachDelivery.recordedAt) return null;
    return record;
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

function validReply(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && (value.channel === "EMAIL" || value.channel === "LINE")
    && SALES_REPLY_TYPES.has(value.type)
    && validText(value.message, 4_000) && !value.message.includes("\u0000")
    && validText(value.actorId, 128) && validTimestamp(value.receivedAt);
}

function validMeetingOptionsDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !Array.isArray(value.slots) || value.slots.length < 2 || value.slots.length > 3
    || value.timeZone !== "Asia/Tokyo" || !MEETING_DURATIONS.has(value.durationMinutes)
    || !validText(value.savedBy, 128) || !validTimestamp(value.savedAt)
    || !value.slots.every(validTimestamp) || new Set(value.slots).size !== value.slots.length) return false;
  const savedTime = Date.parse(value.savedAt);
  return value.slots.every((slot, index) => {
    const slotTime = Date.parse(slot);
    return slotTime >= savedTime + MIN_MEETING_LEAD_MS
      && slotTime <= savedTime + MAX_MEETING_LEAD_MS
      && (index === 0 || Date.parse(value.slots[index - 1]) < slotTime);
  });
}

function validMeetingUrl(value) {
  if (!validText(value, 512) || /[\s\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0
      && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function validAppointment(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && validTimestamp(value.selectedSlot) && value.timeZone === "Asia/Tokyo"
    && MEETING_DURATIONS.has(value.durationMinutes) && validMeetingUrl(value.meetingUrl)
    && typeof value.notes === "string" && optionalText(value.notes, 1_000)
    && validText(value.confirmedBy, 128)
    && validTimestamp(value.confirmedAt);
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
    appointment: null,
    researchComplete: false,
    outreachApproved: false,
    outreachRecordedAt: null,
    outreachDelivery: null,
    replyDraft: null,
    replyApproved: false,
    replyApproval: null,
    replyRecordedAt: null,
    replyDelivery: null,
    meetingOptionsDraft: null,
    meetingOptionsApproved: false,
    meetingOptionsApproval: null,
    meetingOptionsRecordedAt: null,
    meetingOptionsDelivery: null,
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
    if (typeof value.optedOut !== "boolean"
      || typeof value.appointmentConfirmed !== "boolean"
      || typeof value.researchComplete !== "boolean"
      || typeof value.outreachApproved !== "boolean"
      || typeof value.replyApproved !== "boolean"
      || typeof value.meetingOptionsApproved !== "boolean") return null;
    if (!optionalText(value.website, 512) || !optionalText(value.contact, 254) || !optionalText(value.proposalFit, 2_000)) return null;
    if (value.researchComplete === true && !validText(value.researchNotes, 2_000)) return null;
    if (value.outreachDraft !== undefined && !validDraft(value.outreachDraft)) return null;
    if (value.outreachApproval !== null && value.outreachApproval !== undefined
      && !validAudit(value.outreachApproval)) return null;
    if (value.outreachRecordedAt !== null && value.outreachRecordedAt !== undefined
      && !validTimestamp(value.outreachRecordedAt)) return null;
    if (value.outreachDelivery !== null && value.outreachDelivery !== undefined
      && !validDelivery(value.outreachDelivery)) return null;
    if (value.replyDraft !== null && value.replyDraft !== undefined
      && !validDraft(value.replyDraft)) return null;
    if (value.replyApproval !== null && value.replyApproval !== undefined
      && !validAudit(value.replyApproval)) return null;
    if (value.replyRecordedAt !== null && value.replyRecordedAt !== undefined
      && !validTimestamp(value.replyRecordedAt)) return null;
    if (value.replyDelivery !== null && value.replyDelivery !== undefined
      && !validDelivery(value.replyDelivery)) return null;
    if (value.meetingOptionsDraft !== null && value.meetingOptionsDraft !== undefined
      && !validMeetingOptionsDraft(value.meetingOptionsDraft)) return null;
    if (value.meetingOptionsApproval !== null && value.meetingOptionsApproval !== undefined
      && !validAudit(value.meetingOptionsApproval)) return null;
    if (value.meetingOptionsRecordedAt !== null && value.meetingOptionsRecordedAt !== undefined
      && !validTimestamp(value.meetingOptionsRecordedAt)) return null;
    if (value.meetingOptionsDelivery !== null && value.meetingOptionsDelivery !== undefined
      && !validDelivery(value.meetingOptionsDelivery)) return null;
    if (value.appointment !== null && value.appointment !== undefined
      && !validAppointment(value.appointment)) return null;
    if (value.outreachApproved === true
      && (!validDraft(value.outreachDraft) || !validAudit(value.outreachApproval))) return null;
    if (value.outreachApproved === false
      && value.outreachApproval !== null && value.outreachApproval !== undefined) return null;
    if (typeof value.outreachRecordedAt === "string"
      && (value.outreachApproved !== true || !validDelivery(value.outreachDelivery)
        || value.outreachDelivery.recordedAt !== value.outreachRecordedAt
        || Date.parse(value.outreachRecordedAt) < Date.parse(value.outreachApproval.approvedAt))) return null;
    if (value.outreachDelivery !== null && value.outreachDelivery !== undefined
      && typeof value.outreachRecordedAt !== "string") return null;
    if (value.meetingOptionsApproved === true
      && (!validMeetingOptionsDraft(value.meetingOptionsDraft)
        || !validAudit(value.meetingOptionsApproval)
        || Date.parse(value.meetingOptionsApproval.approvedAt)
          < Date.parse(value.meetingOptionsDraft.savedAt)
        || value.meetingOptionsDraft.slots.some((slot) => Date.parse(slot)
          < Date.parse(value.meetingOptionsApproval.approvedAt) + MIN_MEETING_LEAD_MS))) return null;
    if (value.replyApproved === true
      && (!validDraft(value.replyDraft) || !validAudit(value.replyApproval))) return null;
    if (value.replyApproved === false
      && value.replyApproval !== null && value.replyApproval !== undefined) return null;
    if (typeof value.replyRecordedAt === "string"
      && (value.replyApproved !== true || !validDelivery(value.replyDelivery)
        || value.replyDelivery.recordedAt !== value.replyRecordedAt)) return null;
    if (value.replyDelivery !== null && value.replyDelivery !== undefined
      && typeof value.replyRecordedAt !== "string") return null;
    if (!Array.isArray(value.replies) || value.replies.length > 8
      || !value.replies.every(validReply)) return null;
    if (value.meetingOptionsDraft !== null && value.meetingOptionsDraft !== undefined
      && (value.replies.length !== 1 || value.replies[0].type !== "SCHEDULING")) return null;
    if (value.meetingOptionsApproved === false
      && value.meetingOptionsApproval !== null && value.meetingOptionsApproval !== undefined) return null;
    if (typeof value.meetingOptionsRecordedAt === "string"
      && (value.meetingOptionsApproved !== true
        || !validMeetingOptionsDraft(value.meetingOptionsDraft)
        || !validAudit(value.meetingOptionsApproval)
        || !validDelivery(value.meetingOptionsDelivery)
        || value.meetingOptionsDelivery.recordedAt !== value.meetingOptionsRecordedAt
        || value.replies.length !== 1 || value.replies[0].type !== "SCHEDULING"
        || value.meetingOptionsDelivery.channel !== value.replies[0].channel
        || Date.parse(value.meetingOptionsRecordedAt) < Date.parse(value.meetingOptionsApproval.approvedAt)
        || Date.parse(value.meetingOptionsRecordedAt) < Date.parse(value.meetingOptionsDraft.savedAt)
        || value.meetingOptionsDraft.slots.some((slot) => Date.parse(slot)
          < Date.parse(value.meetingOptionsRecordedAt) + MIN_MEETING_LEAD_MS))) return null;
    if (value.meetingOptionsDelivery !== null && value.meetingOptionsDelivery !== undefined
      && typeof value.meetingOptionsRecordedAt !== "string") return null;
    if (value.appointmentConfirmed === true
      && (!validAppointment(value.appointment)
        || typeof value.meetingOptionsRecordedAt !== "string"
        || !validMeetingOptionsDraft(value.meetingOptionsDraft)
        || !value.meetingOptionsDraft.slots.includes(value.appointment.selectedSlot)
        || value.appointment.timeZone !== value.meetingOptionsDraft.timeZone
        || value.appointment.durationMinutes !== value.meetingOptionsDraft.durationMinutes
        || Date.parse(value.appointment.confirmedAt) < Date.parse(value.meetingOptionsRecordedAt)
        || Date.parse(value.appointment.selectedSlot)
          < Date.parse(value.appointment.confirmedAt) + MIN_APPOINTMENT_LEAD_MS)) return null;
    if (value.appointment !== null && value.appointment !== undefined
      && value.appointmentConfirmed !== true) return null;
    if (typeof value.replyRecordedAt === "string"
      && (value.replies.length !== 1 || value.replyDelivery.channel !== value.replies[0].channel)) return null;

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
      appointment: value.appointment ? Object.freeze({
        selectedSlot: value.appointment.selectedSlot,
        timeZone: value.appointment.timeZone,
        durationMinutes: value.appointment.durationMinutes,
        meetingUrl: value.appointment.meetingUrl,
        notes: value.appointment.notes,
        confirmedBy: value.appointment.confirmedBy,
        confirmedAt: value.appointment.confirmedAt,
      }) : null,
      researchComplete: value.researchComplete === true,
      outreachApproved: value.outreachApproved === true,
      outreachRecordedAt: typeof value.outreachRecordedAt === "string" ? value.outreachRecordedAt : null,
      outreachDelivery: value.outreachDelivery ? Object.freeze({
        actorId: value.outreachDelivery.actorId,
        recordedAt: value.outreachDelivery.recordedAt,
        channel: value.outreachDelivery.channel,
      }) : null,
      replyDraft: value.replyDraft ? Object.freeze({
        subject: value.replyDraft.subject,
        body: value.replyDraft.body,
        signature: value.replyDraft.signature,
      }) : null,
      replyApproved: value.replyApproved === true,
      replyApproval: value.replyApproval ? Object.freeze({
        actorId: value.replyApproval.actorId,
        approvedAt: value.replyApproval.approvedAt,
      }) : null,
      replyRecordedAt: typeof value.replyRecordedAt === "string" ? value.replyRecordedAt : null,
      replyDelivery: value.replyDelivery ? Object.freeze({
        actorId: value.replyDelivery.actorId,
        recordedAt: value.replyDelivery.recordedAt,
        channel: value.replyDelivery.channel,
      }) : null,
      meetingOptionsDraft: value.meetingOptionsDraft ? Object.freeze({
        slots: Object.freeze(value.meetingOptionsDraft.slots.slice()),
        timeZone: value.meetingOptionsDraft.timeZone,
        durationMinutes: value.meetingOptionsDraft.durationMinutes,
        savedBy: value.meetingOptionsDraft.savedBy,
        savedAt: value.meetingOptionsDraft.savedAt,
      }) : null,
      meetingOptionsApproved: value.meetingOptionsApproved === true,
      meetingOptionsApproval: value.meetingOptionsApproval ? Object.freeze({
        actorId: value.meetingOptionsApproval.actorId,
        approvedAt: value.meetingOptionsApproval.approvedAt,
      }) : null,
      meetingOptionsRecordedAt: typeof value.meetingOptionsRecordedAt === "string"
        ? value.meetingOptionsRecordedAt : null,
      meetingOptionsDelivery: value.meetingOptionsDelivery ? Object.freeze({
        actorId: value.meetingOptionsDelivery.actorId,
        recordedAt: value.meetingOptionsDelivery.recordedAt,
        channel: value.meetingOptionsDelivery.channel,
      }) : null,
      followUps: Array.isArray(value.followUps) ? value.followUps.slice(0, 8) : [],
      replies: value.replies.map((reply) => Object.freeze({
        channel: reply.channel,
        type: reply.type,
        message: reply.message,
        actorId: reply.actorId,
        receivedAt: reply.receivedAt,
      })),
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
