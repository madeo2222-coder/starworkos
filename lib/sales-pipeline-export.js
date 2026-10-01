import { planSalesNextWork } from "./sales-orchestrator.js";
import {
  hasSalesOptOutEvidence,
  isBoundedSalesReplyHistory,
} from "./sales-reply-history.js";

const MAX_EXPORT_ROWS = 100;
const MIN_APPOINTMENT_LEAD_MS = 15 * 60 * 1000;
const MEETING_DURATIONS = new Set([30, 45, 60]);

const HEADERS = Object.freeze([
  "企業名",
  "Webサイト",
  "案件状態",
  "初回送信",
  "返信件数",
  "最新返信",
  "追客回数",
  "アポ日時",
  "面談結果",
  "面談後フォロー期限",
  "面談後フォロー状態",
  "配信停止",
  "次担当",
  "次の作業",
]);

const REPLY_LABELS = Object.freeze({
  MATERIAL_REQUEST: "資料希望",
  GENERAL_QUESTION: "一般質問",
  SCHEDULING: "日程調整",
  PRICE: "価格相談",
  DISCOUNT: "値引き相談",
  CONTRACT: "契約相談",
  COMPLAINT: "クレーム",
  PERSONAL_DATA: "個人情報",
  OPT_OUT: "配信停止",
  UNKNOWN: "要確認",
});

const ROLE_LABELS = Object.freeze({
  researcher: "企業調査担当",
  sales_writer: "営業文面担当",
  scheduler: "日程調整担当",
  sales_manager: "営業責任者",
  delivery_operator: "送信管理担当",
});

const ACTION_LABELS = Object.freeze({
  RESEARCH_COMPANY: "企業調査",
  PREPARE_OUTREACH: "初回提案を準備",
  PREPARE_FOLLOW_UP: "追客案を準備",
  PREPARE_REPLY: "一次返信案を準備",
  PREPARE_MEETING_OPTIONS: "面談候補を準備",
  CONFIRM_MEETING: "アポ確定を記録",
  PREPARE_APPOINTMENT_NOTICE: "アポ確定案内を準備",
  PREPARE_APPOINTMENT_REMINDER: "アポ前日案内を準備",
  RECORD_APPOINTMENT_OUTCOME: "面談結果を記録",
  SCHEDULE_POST_MEETING_FOLLOW_UP: "面談後フォローを設定",
  COMPLETE_POST_MEETING_FOLLOW_UP: "面談後フォローを完了",
  HUMAN_REVIEW: "人間確認",
  STOP_CONTACT: "連絡停止を確認",
  NO_ACTION: "対応待ち",
});

/**
 * Builds a bounded, spreadsheet-safe snapshot of the sales pipeline.
 *
 * The export deliberately excludes contact details, message bodies, research
 * notes, meeting notes, URLs for appointments, and actor identifiers.
 */
export function buildSalesPipelineCsv(rawLeads, { now = new Date() } = {}) {
  const leads = snapshotLeads(rawLeads);
  const nowValue = snapshotDate(now);
  if (!leads || !nowValue) return null;

  const rows = [HEADERS];
  for (const lead of leads) {
    const plan = planSalesNextWork(lead.planInput, { now: nowValue });
    if (plan.reason.startsWith("INVALID_")) continue;
    rows.push([
      lead.companyName,
      lead.website,
      pipelineStage(lead),
      lead.outreachRecordedAt ? "送信済み" : "未送信",
      String(lead.replies.length),
      latestReplyLabel(lead.replies),
      String(lead.followUps.length),
      lead.appointment?.selectedSlot ?? "",
      appointmentOutcomeLabel(lead.appointmentOutcome),
      lead.postMeetingFollowUp?.dueAt ?? "",
      postMeetingFollowUpStatus(lead.postMeetingFollowUp),
      lead.optedOut ? "停止" : "継続可",
      plan.ownerRole ? ROLE_LABELS[plan.ownerRole] ?? "要確認" : "—",
      ACTION_LABELS[plan.action] ?? "要確認",
    ]);
  }

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function snapshotLeads(value) {
  try {
    if (!Array.isArray(value)) return null;
    const result = [];
    const seen = new Set();
    for (const rawLead of value.slice(0, 500)) {
      const lead = snapshotLead(rawLead);
      if (!lead || seen.has(lead.id)) continue;
      seen.add(lead.id);
      result.push(lead);
      if (result.length === MAX_EXPORT_ROWS) break;
    }
    return result;
  } catch {
    return null;
  }
}

function snapshotLead(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    if (!validText(value.id, 128) || !validText(value.companyName, 160)
      || !optionalUrl(value.website) || !isBoundedSalesReplyHistory(value.replies)
      || !Array.isArray(value.followUps)
      || value.followUps.length > 2) return null;
    const replies = value.replies.map(snapshotReply);
    const followUps = value.followUps.map(snapshotFollowUp);
    if (replies.some((reply) => !reply) || followUps.some((followUp) => !followUp)
      || invalidOptionalTimestamp(value.outreachRecordedAt)
      || invalidOptionalTimestamp(value.replyRecordedAt)
      || invalidOptionalTimestamp(value.meetingOptionsRecordedAt)) return null;
    if (replies.length > 0 && !validTimestamp(value.outreachRecordedAt)
      || followUps.length > 0 && !validTimestamp(value.outreachRecordedAt)
      || followUps.some((followUp, index) => Date.parse(followUp.recordedAt)
        < Date.parse(index === 0 ? value.outreachRecordedAt : followUps[index - 1].recordedAt))
      || replies.some((reply, index) => Date.parse(reply.receivedAt)
        < Date.parse(index === 0 ? value.outreachRecordedAt : replies[index - 1].receivedAt)
        || followUps.length > 0
          && Date.parse(reply.receivedAt) < Date.parse(followUps.at(-1).recordedAt))) return null;
    const appointment = snapshotAppointment(value.appointment);
    const appointmentOutcome = snapshotAppointmentOutcome(value.appointmentOutcome);
    const postMeetingFollowUp = snapshotPostMeetingFollowUp(value.postMeetingFollowUp);
    const meetingOptionsApproved = value.meetingOptionsApproved === true;
    const meetingOptionsRecordedAt = validTimestamp(value.meetingOptionsRecordedAt)
      ? value.meetingOptionsRecordedAt : null;
    // Any persisted or malformed suppression evidence fails safe. The internal
    // pipeline must never label an uncertain lead as contactable.
    const optedOut = hasSalesOptOutEvidence(value);
    if (value.appointment !== null && value.appointment !== undefined && !appointment
      || value.appointmentConfirmed === true && !appointment
      || value.appointmentConfirmed === true && (!meetingOptionsApproved
        || !meetingOptionsRecordedAt
        || appointment.confirmedAt < Date.parse(meetingOptionsRecordedAt)
        || appointment.startsAt < appointment.confirmedAt + MIN_APPOINTMENT_LEAD_MS)
      || appointment && value.appointmentConfirmed !== true
      || value.appointmentOutcome !== null && value.appointmentOutcome !== undefined && !appointmentOutcome
      || value.postMeetingFollowUp !== null && value.postMeetingFollowUp !== undefined && !postMeetingFollowUp)
      return null;
    return {
      id: value.id,
      companyName: value.companyName,
      website: value.website ?? "",
      optedOut,
      appointmentConfirmed: value.appointmentConfirmed === true,
      appointment,
      appointmentOutcome,
      postMeetingFollowUp,
      researchComplete: value.researchComplete === true,
      outreachApproved: value.outreachApproved === true,
      outreachRecordedAt: validTimestamp(value.outreachRecordedAt) ? value.outreachRecordedAt : null,
      replyApproved: value.replyApproved === true,
      replyRecordedAt: validTimestamp(value.replyRecordedAt) ? value.replyRecordedAt : null,
      meetingOptionsApproved,
      meetingOptionsRecordedAt,
      followUps,
      replies,
      planInput: {
        optedOut,
        appointmentConfirmed: value.appointmentConfirmed,
        appointment: value.appointment,
        appointmentNoticeDraft: value.appointmentNoticeDraft,
        appointmentNoticeApproved: value.appointmentNoticeApproved,
        appointmentNoticeRecordedAt: value.appointmentNoticeRecordedAt,
        appointmentReminderDraft: value.appointmentReminderDraft,
        appointmentReminderApproved: value.appointmentReminderApproved,
        appointmentReminderRecordedAt: value.appointmentReminderRecordedAt,
        appointmentOutcome,
        postMeetingFollowUp,
        researchComplete: value.researchComplete,
        researchNotes: value.researchNotes,
        researchAudit: value.researchAudit,
        outreachApproved: value.outreachApproved,
        outreachRecordedAt: value.outreachRecordedAt,
        replyApproved: value.replyApproved,
        replyRecordedAt: value.replyRecordedAt,
        meetingOptionsApproved: value.meetingOptionsApproved,
        meetingOptionsRecordedAt: value.meetingOptionsRecordedAt,
        followUpDraft: value.followUpDraft,
        followUpApproved: value.followUpApproved,
        followUps,
        replies,
      },
    };
  } catch {
    return null;
  }
}

function snapshotReply(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !REPLY_LABELS[value.type] || !validTimestamp(value.receivedAt)) return null;
  return { type: value.type, receivedAt: value.receivedAt };
}

function snapshotFollowUp(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validTimestamp(value.recordedAt)) return null;
  return { recordedAt: value.recordedAt };
}

function snapshotAppointment(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validTimestamp(value.selectedSlot)
    || !MEETING_DURATIONS.has(value.durationMinutes)
    || !validText(value.confirmedBy, 128)
    || !validTimestamp(value.confirmedAt)) return null;
  const startsAt = Date.parse(value.selectedSlot);
  return {
    selectedSlot: value.selectedSlot,
    startsAt,
    confirmedAt: Date.parse(value.confirmedAt),
  };
}

function snapshotAppointmentOutcome(value) {
  if (value === null || value === undefined) return null;
  return value && typeof value === "object" && !Array.isArray(value)
    && ["FOLLOW_UP", "WON", "LOST", "NO_SHOW"].includes(value.result)
    && validTimestamp(value.recordedAt)
    ? { result: value.result, recordedAt: value.recordedAt } : null;
}

function snapshotPostMeetingFollowUp(value) {
  if (value === null || value === undefined) return null;
  return value && typeof value === "object" && !Array.isArray(value)
    && validTimestamp(value.dueAt) && validTimestamp(value.createdAt)
    && (value.completedAt === null || validTimestamp(value.completedAt))
    ? { dueAt: value.dueAt, createdAt: value.createdAt, completedAt: value.completedAt } : null;
}

function pipelineStage(lead) {
  if (lead.optedOut) return "配信停止";
  if (lead.postMeetingFollowUp?.completedAt) return "面談後フォロー完了";
  if (lead.postMeetingFollowUp) return "面談後フォロー中";
  if (lead.appointmentOutcome) return "面談結果記録済み";
  if (lead.appointmentConfirmed && lead.appointment) return "アポ確定";
  if (lead.replies.length > 0) return "返信対応中";
  if (lead.outreachRecordedAt) return "返信待ち";
  if (lead.outreachApproved) return "初回送信待ち";
  if (lead.researchComplete) return "提案準備中";
  return "企業調査前";
}

function appointmentOutcomeLabel(value) {
  if (!value) return "未記録";
  return { FOLLOW_UP: "次回対応", WON: "受注", LOST: "失注", NO_SHOW: "不参加" }[value.result]
    ?? "要確認";
}

function postMeetingFollowUpStatus(value) {
  if (!value) return "未設定";
  return value.completedAt ? "完了" : "未完了";
}

function latestReplyLabel(replies) {
  if (replies.length === 0) return "なし";
  const latest = replies.reduce((left, right) => (
    Date.parse(left.receivedAt) >= Date.parse(right.receivedAt) ? left : right
  ));
  return REPLY_LABELS[latest.type] ?? "要確認";
}

function csvCell(value) {
  let cell = String(value ?? "").replace(/[\r\n]+/g, " ");
  if (/^[=+\-@\t]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replaceAll('"', '""')}"`;
}

function snapshotDate(value) {
  try {
    const time = value instanceof Date ? value.getTime() : NaN;
    return Number.isFinite(time) ? new Date(time) : null;
  } catch {
    return null;
  }
}

function validText(value, maxLength) {
  return typeof value === "string" && value.length > 0
    && value.length <= maxLength && value.trim() === value;
}

function optionalUrl(value) {
  if (value === "" || value === null || value === undefined) return true;
  if (typeof value !== "string" || value.length > 512 || value.trim() !== value) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function invalidOptionalTimestamp(value) {
  return value !== null && value !== undefined && !validTimestamp(value);
}
