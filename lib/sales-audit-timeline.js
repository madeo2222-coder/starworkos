import { isBoundedSalesReplyHistory } from "./sales-reply-history.js";

const MAX_EVENTS = 40;
const MIN_APPOINTMENT_LEAD_MS = 15 * 60 * 1000;

const REPLY_LABELS = Object.freeze({
  MATERIAL_REQUEST: "資料希望を受信",
  GENERAL_QUESTION: "一般質問を受信",
  SCHEDULING: "日程調整を受信",
  PRICE: "価格相談を受信",
  DISCOUNT: "値引き相談を受信",
  CONTRACT: "契約相談を受信",
  COMPLAINT: "クレームを受信",
  PERSONAL_DATA: "個人情報を含む返信を受信",
  OPT_OUT: "配信停止を受信",
  UNKNOWN: "要確認の返信を受信",
});

const APPOINTMENT_OUTCOME_LABELS = Object.freeze({
  FOLLOW_UP: "面談結果：次回対応",
  WON: "面談結果：受注",
  LOST: "面談結果：失注",
  NO_SHOW: "面談結果：不参加",
});

const SAFE_REPLY_RESOLUTION_TYPES = new Set(["MATERIAL_REQUEST", "GENERAL_QUESTION"]);

/**
 * Builds an immutable, read-only audit view from an already persisted lead.
 * It never writes data or invokes an external service.
 */
export function buildSalesAuditTimeline(rawLead, { limit = MAX_EVENTS } = {}) {
  const lead = snapshotLead(rawLead);
  if (!lead) return Object.freeze([]);

  const events = [];
  if (lead.researchAudit) {
    events.push(event(
      "RESEARCH_COMPLETED",
      "企業調査を完了",
      lead.researchAudit.completedAt,
      lead.researchAudit.actorId,
    ));
  }
  addAudit(events, "OUTREACH_APPROVED", "初回文面を承認", lead.outreachApproval);
  addDelivery(events, "OUTREACH_DELIVERED", "初回連絡を外部送信済みとして記録", lead.outreachDelivery);
  for (const followUp of lead.followUps) {
    addSaved(events, "FOLLOW_UP_SAVED", "追客メール案を保存", followUp.draft);
    addAudit(events, "FOLLOW_UP_APPROVED", "追客メール案を承認", followUp.approval);
    addDelivery(events, "FOLLOW_UP_DELIVERED", "追客メールを外部送信済みとして記録", followUp.delivery);
  }
  addSaved(events, "FOLLOW_UP_SAVED", "追客メール案を保存", lead.followUpDraft);
  addAudit(events, "FOLLOW_UP_APPROVED", "追客メール案を承認", lead.followUpApproval);

  for (const reply of lead.replies) {
    events.push(event(
      reply.type === "OPT_OUT" ? "OPT_OUT" : "INBOUND_REPLY",
      REPLY_LABELS[reply.type],
      reply.receivedAt,
      reply.actorId,
      reply.channel,
    ));
    if (reply.resolution?.kind === "SAFE_REPLY") {
      addAudit(events, "REPLY_APPROVED", "一次返信文面を承認", reply.resolution.approval);
      addDelivery(events, "REPLY_DELIVERED", "一次返信を外部送信済みとして記録", reply.resolution.delivery);
    } else if (reply.resolution?.kind === "MEETING_OPTIONS") {
      addSaved(events, "MEETING_OPTIONS_SAVED", "面談候補を保存", reply.resolution.draft);
      addAudit(events, "MEETING_OPTIONS_APPROVED", "面談候補を承認", reply.resolution.approval);
      addDelivery(events, "MEETING_OPTIONS_DELIVERED", "面談候補を外部送信済みとして記録", reply.resolution.delivery);
    }
  }

  addAudit(events, "REPLY_APPROVED", "一次返信文面を承認", lead.replyApproval);
  addDelivery(events, "REPLY_DELIVERED", "一次返信を外部送信済みとして記録", lead.replyDelivery);
  addSaved(events, "MEETING_OPTIONS_SAVED", "面談候補を保存", lead.meetingOptionsDraft);
  addAudit(events, "MEETING_OPTIONS_APPROVED", "面談候補を承認", lead.meetingOptionsApproval);
  addDelivery(events, "MEETING_OPTIONS_DELIVERED", "面談候補を外部送信済みとして記録", lead.meetingOptionsDelivery);
  if (lead.appointment) {
    events.push(event(
      "APPOINTMENT_CONFIRMED",
      "アポイントを確定",
      lead.appointment.confirmedAt,
      lead.appointment.confirmedBy,
      null,
      lead.appointment.selectedSlot,
    ));
  }
  addSaved(events, "APPOINTMENT_NOTICE_SAVED", "アポイント確定案内を保存", lead.appointmentNoticeDraft);
  addAudit(events, "APPOINTMENT_NOTICE_APPROVED", "アポイント確定案内を承認", lead.appointmentNoticeApproval);
  addDelivery(events, "APPOINTMENT_NOTICE_DELIVERED", "アポイント確定案内を外部送信済みとして記録", lead.appointmentNoticeDelivery);
  addSaved(events, "APPOINTMENT_REMINDER_SAVED", "アポイント前日案内を保存", lead.appointmentReminderDraft);
  addAudit(events, "APPOINTMENT_REMINDER_APPROVED", "アポイント前日案内を承認", lead.appointmentReminderApproval);
  addDelivery(events, "APPOINTMENT_REMINDER_DELIVERED", "アポイント前日案内を外部送信済みとして記録", lead.appointmentReminderDelivery);
  if (lead.appointmentOutcome) {
    events.push(event(
      "APPOINTMENT_OUTCOME_RECORDED",
      APPOINTMENT_OUTCOME_LABELS[lead.appointmentOutcome.result],
      lead.appointmentOutcome.recordedAt,
      lead.appointmentOutcome.actorId,
    ));
  }
  if (lead.postMeetingFollowUp) {
    events.push(event(
      "POST_MEETING_FOLLOW_UP_SCHEDULED",
      "面談後フォローを設定",
      lead.postMeetingFollowUp.createdAt,
      lead.postMeetingFollowUp.createdBy,
      null,
      lead.postMeetingFollowUp.dueAt,
    ));
    if (lead.postMeetingFollowUp.completedAt) {
      events.push(event(
        "POST_MEETING_FOLLOW_UP_COMPLETED",
        "面談後フォローを完了",
        lead.postMeetingFollowUp.completedAt,
        lead.postMeetingFollowUp.completedBy,
      ));
    }
  }

  events.sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  const boundedLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, MAX_EVENTS) : MAX_EVENTS;
  return Object.freeze(events.slice(-boundedLimit).map((entry) => Object.freeze(entry)));
}

function snapshotLead(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const rawFollowUps = value.followUps ?? [];
    if (!isBoundedSalesReplyHistory(value.replies)
      || !Array.isArray(rawFollowUps) || rawFollowUps.length > 2) return null;
    const replies = value.replies.map(snapshotReply);
    const followUps = rawFollowUps.map(snapshotFollowUp);
    if (replies.some((reply) => !reply) || followUps.some((followUp) => !followUp)) return null;
    const outreachApproval = snapshotAudit(value.outreachApproval);
    const outreachDelivery = snapshotDelivery(value.outreachDelivery);
    const replyApproval = snapshotAudit(value.replyApproval);
    const replyDelivery = snapshotDelivery(value.replyDelivery);
    const meetingOptionsDraft = snapshotMeetingDraft(value.meetingOptionsDraft);
    const meetingOptionsApproval = snapshotAudit(value.meetingOptionsApproval);
    const meetingOptionsDelivery = snapshotDelivery(value.meetingOptionsDelivery);
    const appointment = snapshotAppointment(value.appointment);
    const appointmentNoticeDraft = snapshotFollowUpDraft(value.appointmentNoticeDraft);
    const appointmentNoticeApproval = snapshotAudit(value.appointmentNoticeApproval);
    const appointmentNoticeDelivery = snapshotDelivery(value.appointmentNoticeDelivery);
    const appointmentReminderDraft = snapshotFollowUpDraft(value.appointmentReminderDraft);
    const appointmentReminderApproval = snapshotAudit(value.appointmentReminderApproval);
    const appointmentReminderDelivery = snapshotDelivery(value.appointmentReminderDelivery);
    const appointmentOutcome = snapshotAppointmentOutcome(value.appointmentOutcome);
    const postMeetingFollowUp = snapshotPostMeetingFollowUp(value.postMeetingFollowUp);
    const followUpDraft = snapshotFollowUpDraft(value.followUpDraft);
    const followUpApproval = snapshotAudit(value.followUpApproval);
    const researchAudit = snapshotResearchAudit(value.researchAudit);
    if (invalidOptional(value.researchAudit, researchAudit)
      || invalidOptional(value.outreachApproval, outreachApproval)
      || invalidOptional(value.outreachDelivery, outreachDelivery)
      || invalidOptional(value.replyApproval, replyApproval)
      || invalidOptional(value.replyDelivery, replyDelivery)
      || invalidOptional(value.meetingOptionsDraft, meetingOptionsDraft)
      || invalidOptional(value.meetingOptionsApproval, meetingOptionsApproval)
      || invalidOptional(value.meetingOptionsDelivery, meetingOptionsDelivery)
      || invalidOptional(value.appointment, appointment)
      || invalidOptional(value.appointmentNoticeDraft, appointmentNoticeDraft)
      || invalidOptional(value.appointmentNoticeApproval, appointmentNoticeApproval)
      || invalidOptional(value.appointmentNoticeDelivery, appointmentNoticeDelivery)
      || invalidOptional(value.appointmentReminderDraft, appointmentReminderDraft)
      || invalidOptional(value.appointmentReminderApproval, appointmentReminderApproval)
      || invalidOptional(value.appointmentReminderDelivery, appointmentReminderDelivery)
      || invalidOptional(value.appointmentOutcome, appointmentOutcome)
      || invalidOptional(value.postMeetingFollowUp, postMeetingFollowUp)
      || invalidOptional(value.followUpDraft, followUpDraft)
      || invalidOptional(value.followUpApproval, followUpApproval)) return null;
    const currentMeetingOptionsDeliveredAt = meetingOptionsDraft
      && meetingOptionsApproval && meetingOptionsDelivery
      ? meetingOptionsDelivery.recordedAt : null;
    const meetingOptionsDeliveredAt = latestTimestamp(
      currentMeetingOptionsDeliveredAt,
      ...replies
        .filter((reply) => reply.resolution?.kind === "MEETING_OPTIONS")
        .map((reply) => reply.resolution.delivery.recordedAt),
    );
    if (appointment && (!meetingOptionsDeliveredAt
      || Date.parse(appointment.confirmedAt) < Date.parse(meetingOptionsDeliveredAt)
      || Date.parse(appointment.selectedSlot)
        < Date.parse(appointment.confirmedAt) + MIN_APPOINTMENT_LEAD_MS)) return null;
    if (!chronological(
      researchAudit?.completedAt,
      outreachApproval?.approvedAt,
      outreachDelivery?.recordedAt,
    ) || !chronological(
      outreachDelivery?.recordedAt,
      ...followUps.flatMap((followUp) => [
        followUp.draft.savedAt,
        followUp.approval.approvedAt,
        followUp.delivery.recordedAt,
      ]),
    ) || !chronological(
      ...replies.map((reply) => reply.receivedAt),
    ) || !chronological(
      replies.at(-1)?.receivedAt,
      replyApproval?.approvedAt,
      replyDelivery?.recordedAt,
    ) || !chronological(
      meetingOptionsDraft?.savedAt,
      meetingOptionsApproval?.approvedAt,
      meetingOptionsDelivery?.recordedAt,
      appointment?.confirmedAt,
    ) || !chronological(
      appointment?.confirmedAt,
      appointmentNoticeDraft?.savedAt,
      appointmentNoticeApproval?.approvedAt,
      appointmentNoticeDelivery?.recordedAt,
      appointmentReminderDraft?.savedAt,
      appointmentReminderApproval?.approvedAt,
      appointmentReminderDelivery?.recordedAt,
    ) || !chronological(
      appointment?.confirmedAt,
      appointmentOutcome?.recordedAt,
      postMeetingFollowUp?.createdAt,
      postMeetingFollowUp?.dueAt,
    ) || !chronological(
      postMeetingFollowUp?.createdAt,
      postMeetingFollowUp?.completedAt,
    ) || !chronological(
      followUpDraft?.savedAt,
      followUpApproval?.approvedAt,
    )) return null;
    return {
      researchAudit,
      outreachApproval,
      outreachDelivery,
      replyApproval,
      replyDelivery,
      meetingOptionsDraft,
      meetingOptionsApproval,
      meetingOptionsDelivery,
      appointment,
      appointmentNoticeDraft,
      appointmentNoticeApproval,
      appointmentNoticeDelivery,
      appointmentReminderDraft,
      appointmentReminderApproval,
      appointmentReminderDelivery,
      appointmentOutcome,
      postMeetingFollowUp,
      followUpDraft,
      followUpApproval,
      followUps,
      replies,
    };
  } catch {
    return null;
  }
}

function snapshotFollowUp(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = snapshotFollowUpDraft(value.draft);
  const approval = snapshotAudit(value.approval);
  const delivery = snapshotDelivery(value.delivery);
  return draft && approval && delivery
    && chronological(draft.savedAt, approval.approvedAt, delivery.recordedAt)
    ? { draft, approval, delivery } : null;
}

function snapshotFollowUpDraft(value) {
  if (value === null || value === undefined) return null;
  return value && typeof value === "object" && !Array.isArray(value)
    && validText(value.savedBy, 128) && validTimestamp(value.savedAt)
    ? { savedBy: value.savedBy, savedAt: value.savedAt } : null;
}

function snapshotResearchAudit(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validResearchSources(value.sources)
    || !validText(value.actorId, 128) || !validTimestamp(value.completedAt)) return null;
  return { actorId: value.actorId, completedAt: value.completedAt };
}

function validResearchSources(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return false;
  const canonical = [];
  for (const source of value) {
    if (!validText(source, 512) || /[\s\u0000-\u001f\u007f]/u.test(source)) return false;
    try {
      const url = new URL(source);
      if (url.protocol !== "https:" || url.hostname.length === 0
        || url.username !== "" || url.password !== "" || url.href !== source) return false;
      canonical.push(url.href);
    } catch {
      return false;
    }
  }
  return new Set(canonical).size === canonical.length;
}

function invalidOptional(raw, snapshot) {
  return raw !== null && raw !== undefined && snapshot === null;
}

function snapshotReply(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !REPLY_LABELS[value.type] || !validTimestamp(value.receivedAt)
    || !validText(value.actorId, 128) || !validChannel(value.channel)) return null;
  let resolution = null;
  if (value.resolution !== undefined && value.resolution !== null) {
    if (value.resolution.kind === "SAFE_REPLY") {
      const approval = snapshotAudit(value.resolution.approval);
      const delivery = snapshotDelivery(value.resolution.delivery);
      if (!SAFE_REPLY_RESOLUTION_TYPES.has(value.type) || !approval || !delivery
        || Date.parse(approval.approvedAt) < Date.parse(value.receivedAt)
        || Date.parse(delivery.recordedAt) < Date.parse(approval.approvedAt)
        || delivery.channel !== value.channel) return null;
      resolution = { kind: "SAFE_REPLY", approval, delivery };
    } else if (value.resolution.kind === "MEETING_OPTIONS") {
      const draft = snapshotMeetingDraft(value.resolution.draft);
      const approval = snapshotAudit(value.resolution.approval);
      const delivery = snapshotDelivery(value.resolution.delivery);
      if (value.type !== "SCHEDULING" || !draft || !approval || !delivery
        || Date.parse(draft.savedAt) < Date.parse(value.receivedAt)
        || Date.parse(approval.approvedAt) < Date.parse(draft.savedAt)
        || Date.parse(delivery.recordedAt) < Date.parse(approval.approvedAt)
        || delivery.channel !== value.channel) return null;
      resolution = { kind: "MEETING_OPTIONS", draft, approval, delivery };
    } else return null;
  }
  return { type: value.type, receivedAt: value.receivedAt, actorId: value.actorId, channel: value.channel, resolution };
}

function snapshotAudit(value) {
  if (value === null || value === undefined) return null;
  return value && typeof value === "object" && !Array.isArray(value)
    && validText(value.actorId, 128) && validTimestamp(value.approvedAt)
    ? { actorId: value.actorId, approvedAt: value.approvedAt } : null;
}

function snapshotDelivery(value) {
  if (value === null || value === undefined) return null;
  return value && typeof value === "object" && !Array.isArray(value)
    && validText(value.actorId, 128) && validTimestamp(value.recordedAt) && validChannel(value.channel)
    ? { actorId: value.actorId, recordedAt: value.recordedAt, channel: value.channel } : null;
}

function snapshotMeetingDraft(value) {
  if (value === null || value === undefined) return null;
  return value && typeof value === "object" && !Array.isArray(value)
    && validText(value.savedBy, 128) && validTimestamp(value.savedAt)
    ? { savedBy: value.savedBy, savedAt: value.savedAt } : null;
}

function snapshotAppointment(value) {
  if (value === null || value === undefined) return null;
  return value && typeof value === "object" && !Array.isArray(value)
    && validText(value.confirmedBy, 128) && validTimestamp(value.confirmedAt)
    && validTimestamp(value.selectedSlot)
    ? { confirmedBy: value.confirmedBy, confirmedAt: value.confirmedAt, selectedSlot: value.selectedSlot } : null;
}

function snapshotAppointmentOutcome(value) {
  if (value === null || value === undefined) return null;
  return value && typeof value === "object" && !Array.isArray(value)
    && APPOINTMENT_OUTCOME_LABELS[value.result]
    && validText(value.notes, 2_000) && validText(value.actorId, 128)
    && validTimestamp(value.recordedAt)
    ? { result: value.result, actorId: value.actorId, recordedAt: value.recordedAt } : null;
}

function snapshotPostMeetingFollowUp(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validText(value.action, 2_000) || !validTimestamp(value.dueAt)
    || !validText(value.owner, 160) || !validText(value.createdBy, 128)
    || !validTimestamp(value.createdAt)) return null;
  const pending = value.completedBy === null && value.completedAt === null;
  const completed = validText(value.completedBy, 128) && validTimestamp(value.completedAt)
    && Date.parse(value.completedAt) >= Date.parse(value.createdAt);
  return pending || completed ? {
    dueAt: value.dueAt,
    createdBy: value.createdBy,
    createdAt: value.createdAt,
    completedBy: value.completedBy,
    completedAt: value.completedAt,
  } : null;
}

function addAudit(events, type, label, audit) {
  if (audit) events.push(event(type, label, audit.approvedAt, audit.actorId));
}

function addDelivery(events, type, label, delivery) {
  if (delivery) events.push(event(type, label, delivery.recordedAt, delivery.actorId, delivery.channel));
}

function addSaved(events, type, label, draft) {
  if (draft) events.push(event(type, label, draft.savedAt, draft.savedBy));
}

function event(type, label, occurredAt, actorId, channel = null, detail = null) {
  return { type, label, occurredAt, actorId, channel, detail };
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function validText(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && value.trim() === value;
}

function validChannel(value) {
  return value === "EMAIL" || value === "LINE";
}

function latestTimestamp(...values) {
  const timestamps = values.filter((value) => value !== null && value !== undefined);
  if (timestamps.length === 0) return null;
  return timestamps.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
}

function chronological(...values) {
  let previous = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const time = Date.parse(value);
    if (!Number.isFinite(time) || time < previous) return false;
    previous = time;
  }
  return true;
}
