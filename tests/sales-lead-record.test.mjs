import test from "node:test";
import assert from "node:assert/strict";
import {
  createSalesLeadRecord,
  updateSalesLeadProfile,
  completeSalesResearch,
  saveSalesOutreachDraft,
  approveSalesOutreachDraft,
  saveSalesReplyDraft,
  approveSalesReplyDraft,
  recordSalesReplyDelivery,
  saveSalesFollowUpDraft,
  approveSalesFollowUpDraft,
  recordSalesFollowUpDelivery,
  saveSalesMeetingOptions,
  approveSalesMeetingOptions,
  recordSalesMeetingOptionsDelivery,
  confirmSalesAppointment,
  prepareSalesAppointmentNotice,
  approveSalesAppointmentNotice,
  recordSalesAppointmentNoticeDelivery,
  prepareSalesAppointmentReminder,
  approveSalesAppointmentReminder,
  recordSalesAppointmentReminderDelivery,
  recordSalesAppointmentOutcome,
  scheduleSalesPostMeetingFollowUp,
  completeSalesPostMeetingFollowUp,
  recordSalesOutreachDelivery,
  recordSalesReply,
  parseSalesLeadRecord,
  SALES_LEAD_RECORD_PREFIX,
} from "../lib/sales-lead-record.js";

test("creates a bounded initial sales lead record", () => {
  const content = createSalesLeadRecord({
    companyName: " テスト工務店 ",
    website: "https://example.com",
    contact: "sales@example.com",
    proposalFit: "住宅設備延長保証の提案候補",
  });

  assert.ok(content?.startsWith(SALES_LEAD_RECORD_PREFIX));
  const lead = parseSalesLeadRecord("lead-1", content);
  assert.deepEqual(lead, {
    id: "lead-1",
    companyName: "テスト工務店",
    website: "https://example.com",
    contact: "sales@example.com",
    proposalFit: "住宅設備延長保証の提案候補",
    optedOut: false,
    researchNotes: "",
    researchAudit: null,
    outreachDraft: null,
    appointmentConfirmed: false,
    appointment: null,
    appointmentNoticeDraft: null,
    appointmentNoticeApproved: false,
    appointmentNoticeApproval: null,
    appointmentNoticeRecordedAt: null,
    appointmentNoticeDelivery: null,
    appointmentReminderDraft: null,
    appointmentReminderApproved: false,
    appointmentReminderApproval: null,
    appointmentReminderRecordedAt: null,
    appointmentReminderDelivery: null,
    appointmentOutcome: null,
    postMeetingFollowUp: null,
    researchComplete: false,
    outreachApproved: false,
    outreachApproval: null,
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
    followUpDraft: null,
    followUpApproved: false,
    followUpApproval: null,
    followUps: [],
    replies: [],
  });
  assert.equal(Object.isFrozen(lead.followUps), true);
  assert.equal(Object.isFrozen(lead.replies), true);
});

test("rejects unsafe or incomplete create input", () => {
  assert.equal(createSalesLeadRecord({ companyName: "" }), null);
  assert.equal(createSalesLeadRecord({ companyName: "企業", website: "javascript:alert(1)" }), null);
  assert.equal(createSalesLeadRecord({ companyName: "企業", proposalFit: "x".repeat(2_001) }), null);
});

test("updates prospect profile while preserving research and the saved outreach draft", () => {
  const saved = saveSalesOutreachDraft("lead-1", researchedRecord(), outreach);
  const updated = updateSalesLeadProfile("lead-1", saved, {
    companyName: "新しい工務店",
    website: "https://new.example.com",
    contact: "営業部 sales@new.example.com",
    proposalFit: "新築顧客向けの保証提案",
  });
  const lead = parseSalesLeadRecord("lead-1", updated);

  assert.equal(lead.companyName, "新しい工務店");
  assert.equal(lead.website, "https://new.example.com");
  assert.equal(lead.contact, "営業部 sales@new.example.com");
  assert.equal(lead.proposalFit, "新築顧客向けの保証提案");
  assert.equal(lead.researchNotes, "公式サイトを確認");
  assert.deepEqual(lead.outreachDraft, outreach);
});

test("profile edits revoke unsent outreach approval without losing the draft", () => {
  const saved = saveSalesOutreachDraft("lead-1", researchedRecord(), outreach);
  const approved = approveSalesOutreachDraft("lead-1", saved, "reviewer-1", approvalTime);
  const updated = updateSalesLeadProfile("lead-1", approved, {
    companyName: "工務店",
    website: "https://example.com",
    contact: "",
    proposalFit: "",
  });
  const lead = parseSalesLeadRecord("lead-1", updated);

  assert.equal(lead.outreachApproved, false);
  assert.deepEqual(lead.outreachDraft, outreach);
  assert.equal(JSON.parse(updated.slice(SALES_LEAD_RECORD_PREFIX.length)).outreachApproval, null);
});

test("profile edits fail closed after delivery and for invalid or unchanged input", () => {
  const initial = createSalesLeadRecord({ companyName: "工務店" });
  assert.equal(updateSalesLeadProfile("lead-1", initial, { companyName: "工務店" }), null);
  assert.equal(updateSalesLeadProfile("lead-1", initial, {
    companyName: "工務店", website: "javascript:alert(1)",
  }), null);
  assert.equal(updateSalesLeadProfile("lead-1", deliveredRecord(), {
    companyName: "変更後の工務店",
  }), null);
});

test("rejects malformed, oversized, and unrelated stored content", () => {
  assert.equal(parseSalesLeadRecord("lead-1", "other"), null);
  assert.equal(parseSalesLeadRecord("lead-1", `${SALES_LEAD_RECORD_PREFIX}{broken`), null);
  assert.equal(parseSalesLeadRecord("lead-1", `${SALES_LEAD_RECORD_PREFIX}${"x".repeat(12_001)}`), null);
});

test("fails closed for hostile objects", () => {
  const hostile = new Proxy({}, { get() { throw new Error("blocked"); } });
  assert.equal(createSalesLeadRecord(hostile), null);
});

const outreach = { subject: "ご提案", body: "Web面談のご相談です。", signature: "テスト株式会社 営業担当\nsales@example.com" };
const approvalTime = "2026-09-27T00:00:00.000Z";
const replyApprovalTime = "2026-09-27T02:15:00.000Z";
const meetingSavedTime = "2026-09-27T02:20:00.000Z";
const meetingApprovalTime = "2026-09-27T02:30:00.000Z";
const researchTime = "2026-09-26T23:30:00.000Z";
const researchSources = ["https://example.com/company"];

test("parser rejects an outreach draft before research completion", () => {
  const initial = createSalesLeadRecord({ companyName: "工務店" });

  assert.equal(parseSalesLeadRecord(
    "lead-1",
    changeRecord(initial, { outreachDraft: outreach }),
  ), null);
});

test("parser rejects research notes before research completion", () => {
  const initial = createSalesLeadRecord({ companyName: "工務店" });

  assert.equal(parseSalesLeadRecord(
    "lead-1",
    changeRecord(initial, { researchNotes: "公式サイトを確認済み" }),
  ), null);
});

function researchedRecord() {
  return completeSalesResearch(
    "lead-1",
    createSalesLeadRecord({ companyName: "工務店" }),
    "公式サイトを確認",
    researchSources,
    "researcher-1",
    researchTime,
  );
}
function changeRecord(content, changes) {
  return SALES_LEAD_RECORD_PREFIX + JSON.stringify({
    ...JSON.parse(content.slice(SALES_LEAD_RECORD_PREFIX.length)), ...changes,
  });
}

function deliveredRecord(channel = "EMAIL") {
  const saved = saveSalesOutreachDraft("lead-1", researchedRecord(), outreach);
  const approved = approveSalesOutreachDraft("lead-1", saved, "reviewer-1", approvalTime);
  return recordSalesOutreachDelivery("lead-1", approved, "operator-1", approvalTime, channel);
}

function deliveredEmailRecord() {
  const researched = completeSalesResearch(
    "lead-1",
    createSalesLeadRecord({ companyName: "工務店", contact: "sales@example.com" }),
    "公式サイトを確認",
    researchSources,
    "researcher-1",
    researchTime,
  );
  const saved = saveSalesOutreachDraft("lead-1", researched, outreach);
  const approved = approveSalesOutreachDraft("lead-1", saved, "reviewer-1", approvalTime);
  return recordSalesOutreachDelivery("lead-1", approved, "operator-1", approvalTime, "EMAIL");
}

test("draft approval applies to saved text and editing revokes it without losing research", () => {
  const saved = saveSalesOutreachDraft("lead-1", researchedRecord(), outreach);
  assert.equal(parseSalesLeadRecord("lead-1", saved).outreachApproved, false);
  const approved = approveSalesOutreachDraft("lead-1", saved, "reviewer-1", approvalTime);
  assert.equal(parseSalesLeadRecord("lead-1", approved).outreachApproved, true);
  assert.equal(parseSalesLeadRecord("lead-1", approved).outreachRecordedAt, null);
  const audit = JSON.parse(approved.slice(SALES_LEAD_RECORD_PREFIX.length)).outreachApproval;
  assert.deepEqual(audit, { actorId: "reviewer-1", approvedAt: approvalTime });
  const parsedApproval = parseSalesLeadRecord("lead-1", approved).outreachApproval;
  assert.deepEqual(parsedApproval, audit);
  assert.equal(Object.isFrozen(parsedApproval), true);
  assert.equal(approveSalesOutreachDraft("lead-1", approved, "reviewer-1", approvalTime), null);
  const edited = saveSalesOutreachDraft("lead-1", approved, { ...outreach, body: "改訂済みの文面" });
  const lead = parseSalesLeadRecord("lead-1", edited);
  assert.equal(lead.outreachApproved, false);
  assert.equal(lead.researchNotes, "公式サイトを確認");
  assert.equal(JSON.parse(edited.slice(SALES_LEAD_RECORD_PREFIX.length)).outreachApproval, null);
});

test("approval requires a saved draft, signature and server audit fields", () => {
  const record = researchedRecord();
  assert.equal(approveSalesOutreachDraft("lead-1", record, "reviewer", approvalTime), null);
  const unsigned = saveSalesOutreachDraft("lead-1", record, { ...outreach, signature: "" });
  assert.ok(unsigned);
  assert.equal(approveSalesOutreachDraft("lead-1", unsigned, "reviewer", approvalTime), null);
  const saved = saveSalesOutreachDraft("lead-1", record, outreach);
  assert.equal(approveSalesOutreachDraft("lead-1", saved, "", approvalTime), null);
  assert.equal(approveSalesOutreachDraft("lead-1", saved, "reviewer", "invalid"), null);
});

test("outreach approval cannot predate audited research", () => {
  const saved = saveSalesOutreachDraft("lead-1", researchedRecord(), outreach);
  const beforeResearch = "2026-09-26T23:29:59.000Z";

  assert.equal(approveSalesOutreachDraft(
    "lead-1", saved, "reviewer-1", beforeResearch,
  ), null);

  const approved = approveSalesOutreachDraft("lead-1", saved, "reviewer-1", approvalTime);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(approved, {
    outreachApproval: { actorId: "reviewer-1", approvedAt: beforeResearch },
  })), null);
});

test("records a manually completed delivery without changing the approved draft", () => {
  const saved = saveSalesOutreachDraft("lead-1", researchedRecord(), outreach);
  const approved = approveSalesOutreachDraft("lead-1", saved, "reviewer-1", approvalTime);
  const sentAt = "2026-09-27T01:00:00.000Z";
  const recorded = recordSalesOutreachDelivery("lead-1", approved, "operator-1", sentAt, "EMAIL");
  const lead = parseSalesLeadRecord("lead-1", recorded);
  assert.equal(lead.outreachApproved, true);
  assert.equal(lead.outreachRecordedAt, sentAt);
  assert.deepEqual(lead.outreachDraft, outreach);
  assert.deepEqual(lead.outreachDelivery, {
    actorId: "operator-1", recordedAt: sentAt, channel: "EMAIL",
  });
  assert.equal(recordSalesOutreachDelivery("lead-1", recorded, "operator-1", sentAt, "EMAIL"), null);
});

test("saves, approves, and records one manual follow-up with inherited signature", () => {
  const savedAt = "2026-09-30T00:00:00.000Z";
  const approvedAt = "2026-09-30T01:00:00.000Z";
  const recordedAt = "2026-09-30T02:00:00.000Z";
  const saved = saveSalesFollowUpDraft("lead-1", deliveredEmailRecord(), {
    subject: "先日のご案内について", body: "その後のご状況はいかがでしょうか。",
  }, "writer-1", savedAt);
  let lead = parseSalesLeadRecord("lead-1", saved);
  assert.equal(lead.followUpDraft.signature, outreach.signature);
  assert.equal(lead.followUpApproved, false);

  const approved = approveSalesFollowUpDraft("lead-1", saved, "reviewer-2", approvedAt);
  lead = parseSalesLeadRecord("lead-1", approved);
  assert.equal(lead.followUpApproved, true);
  assert.deepEqual(lead.followUpApproval, { actorId: "reviewer-2", approvedAt });

  const recorded = recordSalesFollowUpDelivery("lead-1", approved, "operator-2", recordedAt);
  lead = parseSalesLeadRecord("lead-1", recorded);
  assert.equal(lead.followUpDraft, null);
  assert.equal(lead.followUpApproved, false);
  assert.equal(lead.followUps.length, 1);
  assert.equal(Object.isFrozen(lead.followUps), true);
  assert.equal(Object.isFrozen(lead.followUps[0]), true);
  assert.equal(lead.followUps[0].recordedAt, recordedAt);
  assert.equal(lead.followUps[0].delivery.channel, "EMAIL");
  assert.equal(recordSalesFollowUpDelivery("lead-1", recorded, "operator-2", recordedAt), null);
});

test("follow-up workflow fails closed and accepts a later inbound reply", () => {
  const sent = deliveredEmailRecord();
  assert.equal(saveSalesFollowUpDraft("lead-1", sent, {
    subject: "早すぎる追客", body: "本文",
  }, "writer", "2026-09-29T23:59:59.000Z"), null);
  assert.equal(saveSalesFollowUpDraft("lead-1", sent, {
    subject: "安全\r\nBcc: evil@example.com", body: "本文",
  }, "writer", "2026-09-30T00:00:00.000Z"), null);

  const saved = saveSalesFollowUpDraft("lead-1", sent, {
    subject: "ご確認", body: "ご確認をお願いいたします。",
  }, "writer", "2026-09-30T00:00:00.000Z");
  const approved = approveSalesFollowUpDraft(
    "lead-1", saved, "reviewer", "2026-09-30T01:00:00.000Z",
  );
  assert.equal(recordSalesFollowUpDelivery(
    "lead-1", approved, "operator", "2026-09-30T00:59:59.000Z",
  ), null);
  const recorded = recordSalesFollowUpDelivery(
    "lead-1", approved, "operator", "2026-09-30T02:00:00.000Z",
  );
  const replied = recordSalesReply("lead-1", recorded, {
    channel: "EMAIL", type: "GENERAL_QUESTION", message: "質問があります",
  }, "operator", "2026-09-30T03:00:00.000Z");
  assert.equal(parseSalesLeadRecord("lead-1", replied).replies.length, 1);
  assert.equal(recordSalesReply("lead-1", recorded, {
    channel: "EMAIL", type: "GENERAL_QUESTION", message: "時系列不正",
  }, "operator", "2026-09-30T01:59:59.000Z"), null);
});

function approvedFollowUpRecord() {
  const saved = saveSalesFollowUpDraft("lead-1", deliveredEmailRecord(), {
    subject: "先日のご案内について",
    body: "その後のご状況はいかがでしょうか。",
  }, "writer-1", "2026-09-30T00:00:00.000Z");
  return approveSalesFollowUpDraft(
    "lead-1", saved, "reviewer-2", "2026-09-30T01:00:00.000Z",
  );
}

test("a new inbound reply revokes an unsent follow-up draft and approval", () => {
  const replied = recordSalesReply("lead-1", approvedFollowUpRecord(), {
    channel: "EMAIL", type: "GENERAL_QUESTION", message: "先ほどの件を確認したいです。",
  }, "operator-3", "2026-09-30T02:00:00.000Z");
  const lead = parseSalesLeadRecord("lead-1", replied);

  assert.equal(lead.replies.length, 1);
  assert.equal(lead.followUpDraft, null);
  assert.equal(lead.followUpApproved, false);
  assert.equal(lead.followUpApproval, null);
});

test("an opt-out preserves the pending follow-up approval audit", () => {
  const approved = approvedFollowUpRecord();
  const input = {
    channel: "EMAIL", type: "OPT_OUT", message: "今後の連絡は不要です。",
  };
  assert.equal(recordSalesReply(
    "lead-1", approved, input, "operator-3", "2026-09-30T00:30:00.000Z",
  ), null);

  const stopped = recordSalesReply(
    "lead-1", approved, input, "operator-3", "2026-09-30T02:00:00.000Z",
  );
  const lead = parseSalesLeadRecord("lead-1", stopped);

  assert.equal(lead.optedOut, true);
  assert.equal(lead.followUpApproved, true);
  assert.deepEqual(lead.followUpApproval, {
    actorId: "reviewer-2", approvedAt: "2026-09-30T01:00:00.000Z",
  });
  assert.equal(lead.replies.at(-1).type, "OPT_OUT");
  const raw = JSON.parse(stopped.slice(SALES_LEAD_RECORD_PREFIX.length));
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(stopped, {
    replies: [{ ...raw.replies[0], receivedAt: "2026-09-30T00:30:00.000Z" }],
  })), null);
});

test("delivery recording requires approval audit, actor, timestamp, and a supported channel", () => {
  const saved = saveSalesOutreachDraft("lead-1", researchedRecord(), outreach);
  const approved = approveSalesOutreachDraft("lead-1", saved, "reviewer-1", approvalTime);
  assert.equal(recordSalesOutreachDelivery("lead-1", saved, "operator", approvalTime, "EMAIL"), null);
  assert.equal(recordSalesOutreachDelivery("lead-1", approved, "", approvalTime, "EMAIL"), null);
  assert.equal(recordSalesOutreachDelivery("lead-1", approved, "operator", "invalid", "EMAIL"), null);
  assert.equal(recordSalesOutreachDelivery("lead-1", approved, "operator", approvalTime, "SMS"), null);
  const missingAudit = changeRecord(approved, { outreachApproval: null });
  assert.equal(recordSalesOutreachDelivery("lead-1", missingAudit, "operator", approvalTime, "LINE"), null);
});

test("delivery recording stops for suppressed and progressed leads", () => {
  const saved = saveSalesOutreachDraft("lead-1", researchedRecord(), outreach);
  const approved = approveSalesOutreachDraft("lead-1", saved, "reviewer-1", approvalTime);
  for (const changes of [
    { optedOut: true }, { appointmentConfirmed: true }, { researchComplete: false },
    { replies: [{}] }, { followUps: [{}] },
  ]) assert.equal(recordSalesOutreachDelivery(
    "lead-1", changeRecord(approved, changes), "operator", approvalTime, "EMAIL",
  ), null);
});

test("records one inbound reply and preserves its bounded audit fields", () => {
  const receivedAt = "2026-09-27T02:00:00.000Z";
  const recorded = recordSalesReply("lead-1", deliveredRecord(), {
    channel: "EMAIL", type: "MATERIAL_REQUEST", message: " 資料を送ってください。 ",
  }, "operator-2", receivedAt);
  const lead = parseSalesLeadRecord("lead-1", recorded);
  assert.deepEqual(lead.replies, [{
    channel: "EMAIL", type: "MATERIAL_REQUEST", message: "資料を送ってください。",
    actorId: "operator-2", receivedAt,
  }]);
  assert.equal(Object.isFrozen(lead.replies), true);
  assert.equal(Object.isFrozen(lead.replies[0]), true);
  assert.equal(lead.optedOut, false);
  assert.equal(lead.replyDraft, null);
  assert.equal(lead.replyApproved, false);
  assert.equal(lead.replyRecordedAt, null);
  assert.equal(lead.replyDelivery, null);
  assert.equal(recordSalesReply("lead-1", recorded, {
    channel: "EMAIL", type: "GENERAL_QUESTION", message: "追加質問",
  }, "operator-2", receivedAt), null);
});

function repliedRecord(type = "MATERIAL_REQUEST", channel = "EMAIL") {
  return recordSalesReply("lead-1", deliveredRecord(channel), {
    channel, type, message: "資料について確認したいです。",
  }, "operator-2", "2026-09-27T02:00:00.000Z");
}

const replyDraft = {
  subject: "Re: 資料のご希望について",
  body: "ご返信ありがとうございます。資料を準備いたします。",
  signature: "テスト株式会社 営業担当\nsales@example.com",
};

function approvedReplyRecord(type = "MATERIAL_REQUEST", channel = "EMAIL") {
  const saved = saveSalesReplyDraft("lead-1", repliedRecord(type, channel), replyDraft);
  return approveSalesReplyDraft("lead-1", saved, "reviewer-2", replyApprovalTime);
}

test("saves and approves a safe reply draft without recording a delivery", () => {
  const saved = saveSalesReplyDraft("lead-1", repliedRecord(), replyDraft);
  let lead = parseSalesLeadRecord("lead-1", saved);
  assert.deepEqual(lead.replyDraft, replyDraft);
  assert.equal(lead.replyApproved, false);
  assert.equal(lead.replyRecordedAt, null);

  const approved = approveSalesReplyDraft("lead-1", saved, "reviewer-2", replyApprovalTime);
  lead = parseSalesLeadRecord("lead-1", approved);
  assert.equal(lead.replyApproved, true);
  assert.equal(lead.replyRecordedAt, null);
  assert.deepEqual(lead.replyApproval, { actorId: "reviewer-2", approvedAt: replyApprovalTime });
  assert.equal(approveSalesReplyDraft("lead-1", approved, "reviewer-2", replyApprovalTime), null);

  const edited = saveSalesReplyDraft("lead-1", approved, { ...replyDraft, body: "修正版です。" });
  lead = parseSalesLeadRecord("lead-1", edited);
  assert.equal(lead.replyApproved, false);
  assert.equal(lead.replyApproval, null);
});

test("reply draft transitions reject sensitive, scheduling, suppressed, and invalid input", () => {
  for (const type of ["PRICE", "CONTRACT", "COMPLAINT", "OPT_OUT", "SCHEDULING"]) {
    assert.equal(saveSalesReplyDraft("lead-1", repliedRecord(type), replyDraft), null);
  }
  const safe = repliedRecord("GENERAL_QUESTION");
  assert.equal(saveSalesReplyDraft("lead-1", safe, { ...replyDraft, subject: "Re:\nBCC: bad@example.com" }), null);
  const unsigned = saveSalesReplyDraft("lead-1", safe, { ...replyDraft, signature: "" });
  assert.ok(unsigned);
  assert.equal(approveSalesReplyDraft("lead-1", unsigned, "reviewer", approvalTime), null);
  assert.equal(approveSalesReplyDraft("lead-1", saveSalesReplyDraft("lead-1", safe, replyDraft), "", approvalTime), null);
  assert.equal(saveSalesReplyDraft("lead-1", changeRecord(safe, { appointmentConfirmed: true }), replyDraft), null);
});

test("parser rejects forged reply approval and reply delivery state", () => {
  const safe = repliedRecord();
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(safe, { replyApproved: true })), null);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(safe, { replyRecordedAt: approvalTime })), null);
});

test("parser rejects a reply draft without an eligible unresolved reply", () => {
  for (const record of [
    deliveredRecord(),
    repliedRecord("PRICE"),
    repliedRecord("SCHEDULING"),
    repliedRecord("OPT_OUT"),
  ]) {
    assert.equal(parseSalesLeadRecord("lead-1", changeRecord(record, { replyDraft })), null);
  }
});

test("parser rejects forged core workflow flags and outreach audit state", () => {
  const initial = createSalesLeadRecord({ companyName: "工務店" });
  for (const changes of [
    { optedOut: "false" },
    { researchComplete: "true" },
    { outreachApproved: "true" },
    { replyApproved: "false" },
    { meetingOptionsApproved: "false" },
  ]) assert.equal(parseSalesLeadRecord("lead-1", changeRecord(initial, changes)), null);

  const saved = saveSalesOutreachDraft("lead-1", researchedRecord(), outreach);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(saved, {
    outreachApproved: true, outreachApproval: null,
  })), null);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(saved, {
    outreachApproval: { actorId: "forged", approvedAt: approvalTime },
  })), null);

  const approved = approveSalesOutreachDraft("lead-1", saved, "reviewer", approvalTime);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(approved, {
    outreachRecordedAt: "2026-09-26T23:59:59.000Z",
    outreachDelivery: {
      actorId: "operator", recordedAt: "2026-09-26T23:59:59.000Z", channel: "EMAIL",
    },
  })), null);
  assert.equal(recordSalesOutreachDelivery(
    "lead-1", approved, "operator", "2026-09-26T23:59:59.000Z", "EMAIL",
  ), null);
});

test("records a manually completed safe reply delivery with the inbound channel", () => {
  const recordedAt = "2026-09-27T03:00:00.000Z";
  const recorded = recordSalesReplyDelivery(
    "lead-1", approvedReplyRecord("GENERAL_QUESTION", "LINE"), "operator-3", recordedAt,
  );
  const lead = parseSalesLeadRecord("lead-1", recorded);
  assert.equal(lead.replyApproved, true);
  assert.equal(lead.replyRecordedAt, recordedAt);
  assert.deepEqual(lead.replyDelivery, {
    actorId: "operator-3", recordedAt, channel: "LINE",
  });
  assert.equal(recordSalesReplyDelivery("lead-1", recorded, "operator-3", recordedAt), null);
});

test("reply delivery recording requires approved safe content and valid server audit", () => {
  assert.equal(recordSalesReplyDelivery("lead-1", repliedRecord(), "operator", approvalTime), null);
  assert.equal(recordSalesReplyDelivery("lead-1", approvedReplyRecord(), "", approvalTime), null);
  assert.equal(recordSalesReplyDelivery("lead-1", approvedReplyRecord(), "operator", "invalid"), null);
  assert.equal(recordSalesReplyDelivery("lead-1", approvedReplyRecord("SCHEDULING"), "operator", approvalTime), null);
  const missingApproval = changeRecord(approvedReplyRecord(), { replyApproval: null });
  assert.equal(recordSalesReplyDelivery("lead-1", missingApproval, "operator", approvalTime), null);
});

const meetingSlots = [
  "2026-09-29T01:00:00.000Z",
  "2026-09-28T01:00:00.000Z",
  "2026-09-30T01:00:00.000Z",
];

test("saves sorted meeting options and requires a separate approval", () => {
  const scheduling = repliedRecord("SCHEDULING");
  const saved = saveSalesMeetingOptions(
    "lead-1", scheduling, meetingSlots, 45, "scheduler-1", meetingSavedTime,
  );
  let lead = parseSalesLeadRecord("lead-1", saved);
  assert.deepEqual(lead.meetingOptionsDraft, {
    slots: meetingSlots.slice().sort(),
    timeZone: "Asia/Tokyo",
    durationMinutes: 45,
    savedBy: "scheduler-1",
    savedAt: meetingSavedTime,
  });
  assert.equal(lead.meetingOptionsApproved, false);

  const approved = approveSalesMeetingOptions("lead-1", saved, "reviewer-3", meetingApprovalTime);
  lead = parseSalesLeadRecord("lead-1", approved);
  assert.equal(lead.meetingOptionsApproved, true);
  assert.deepEqual(lead.meetingOptionsApproval, { actorId: "reviewer-3", approvedAt: meetingApprovalTime });

  const edited = saveSalesMeetingOptions(
    "lead-1", approved, meetingSlots.slice(0, 2), 30, "scheduler-1", meetingSavedTime,
  );
  lead = parseSalesLeadRecord("lead-1", edited);
  assert.equal(lead.meetingOptionsApproved, false);
  assert.equal(lead.meetingOptionsApproval, null);
});

test("meeting options reject unsafe states, invalid windows, duplicates, and invalid duration", () => {
  const scheduling = repliedRecord("SCHEDULING");
  for (const [slots, duration] of [
    [[meetingSlots[0]], 30],
    [[meetingSlots[0], meetingSlots[0]], 30],
    [["2026-09-27T00:10:00.000Z", meetingSlots[0]], 30],
    [[meetingSlots[0], "2027-04-01T00:00:00.000Z"], 30],
    [meetingSlots.slice(0, 2), 90],
  ]) assert.equal(saveSalesMeetingOptions(
    "lead-1", scheduling, slots, duration, "scheduler", meetingSavedTime,
  ), null);
  assert.equal(saveSalesMeetingOptions(
    "lead-1", repliedRecord("GENERAL_QUESTION"), meetingSlots, 30, "scheduler", meetingSavedTime,
  ), null);
  assert.equal(saveSalesMeetingOptions(
    "lead-1", scheduling, meetingSlots, 30, "", meetingSavedTime,
  ), null);
});

test("meeting approval rejects missing drafts, forged audits, and repeated approval", () => {
  const scheduling = repliedRecord("SCHEDULING");
  assert.equal(approveSalesMeetingOptions("lead-1", scheduling, "reviewer", meetingApprovalTime), null);
  const saved = saveSalesMeetingOptions(
    "lead-1", scheduling, meetingSlots, 30, "scheduler", meetingSavedTime,
  );
  assert.equal(approveSalesMeetingOptions("lead-1", saved, "", meetingApprovalTime), null);
  assert.equal(approveSalesMeetingOptions(
    "lead-1", saved, "reviewer", "2026-09-28T00:45:00.000Z",
  ), null);
  assert.equal(approveSalesMeetingOptions(
    "lead-1", saved, "reviewer", "2026-09-26T00:00:00.000Z",
  ), null);
  const approved = approveSalesMeetingOptions("lead-1", saved, "reviewer", meetingApprovalTime);
  assert.equal(approveSalesMeetingOptions("lead-1", approved, "reviewer", meetingApprovalTime), null);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(saved, {
    meetingOptionsApproved: true, meetingOptionsApproval: null,
  })), null);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(saved, {
    meetingOptionsApproved: true,
    meetingOptionsApproval: { actorId: "reviewer", approvedAt: "2026-09-26T00:00:00.000Z" },
  })), null);
});

function approvedMeetingRecord(channel = "EMAIL") {
  const saved = saveSalesMeetingOptions(
    "lead-1", repliedRecord("SCHEDULING", channel), meetingSlots, 30, "scheduler", meetingSavedTime,
  );
  return approveSalesMeetingOptions("lead-1", saved, "reviewer", meetingApprovalTime);
}

test("records externally delivered meeting options with the inbound channel", () => {
  const recordedAt = "2026-09-27T03:00:00.000Z";
  const recorded = recordSalesMeetingOptionsDelivery(
    "lead-1", approvedMeetingRecord("LINE"), "operator-4", recordedAt,
  );
  const lead = parseSalesLeadRecord("lead-1", recorded);
  assert.equal(lead.meetingOptionsApproved, true);
  assert.equal(lead.meetingOptionsRecordedAt, recordedAt);
  assert.deepEqual(lead.meetingOptionsDelivery, {
    actorId: "operator-4", recordedAt, channel: "LINE",
  });
  assert.equal(recordSalesMeetingOptionsDelivery("lead-1", recorded, "operator-4", recordedAt), null);
});

test("meeting-option delivery rejects unapproved, stale, forged, and invalid audits", () => {
  const scheduling = repliedRecord("SCHEDULING");
  const saved = saveSalesMeetingOptions(
    "lead-1", scheduling, meetingSlots, 30, "scheduler", meetingSavedTime,
  );
  assert.equal(recordSalesMeetingOptionsDelivery("lead-1", saved, "operator", approvalTime), null);
  assert.equal(recordSalesMeetingOptionsDelivery("lead-1", approvedMeetingRecord(), "", approvalTime), null);
  assert.equal(recordSalesMeetingOptionsDelivery("lead-1", approvedMeetingRecord(), "operator", "invalid"), null);
  assert.equal(recordSalesMeetingOptionsDelivery(
    "lead-1", approvedMeetingRecord(), "operator", "2026-09-28T00:45:00.000Z",
  ), null);
  assert.equal(recordSalesMeetingOptionsDelivery(
    "lead-1", changeRecord(approvedMeetingRecord(), { meetingOptionsApproval: null }),
    "operator", approvalTime,
  ), null);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(approvedMeetingRecord(), {
    meetingOptionsRecordedAt: approvalTime,
    meetingOptionsDelivery: { actorId: "operator", recordedAt: approvalTime, channel: "LINE" },
  })), null);
});

function deliveredMeetingRecord(channel = "EMAIL") {
  return recordSalesMeetingOptionsDelivery(
    "lead-1", approvedMeetingRecord(channel), "operator-4", "2026-09-27T03:00:00.000Z",
  );
}

function confirmedAppointmentRecord(channel = "EMAIL") {
  return confirmSalesAppointment("lead-1", deliveredMeetingRecord(channel), {
    selectedSlot: "2026-09-28T01:00:00.000Z",
    meetingUrl: "https://zoom.us/j/123456789",
    notes: "営業責任者が参加",
  }, "scheduler-2", "2026-09-27T04:00:00.000Z");
}

test("confirms a prospect-selected appointment with a bounded web meeting URL", () => {
  const confirmedAt = "2026-09-27T04:00:00.000Z";
  const confirmed = confirmSalesAppointment("lead-1", deliveredMeetingRecord(), {
    selectedSlot: "2026-09-28T01:00:00.000Z",
    meetingUrl: " https://zoom.us/j/123456789 ",
    notes: " 営業責任者が参加 ",
  }, "scheduler-2", confirmedAt);
  const lead = parseSalesLeadRecord("lead-1", confirmed);
  assert.equal(lead.appointmentConfirmed, true);
  assert.deepEqual(lead.appointment, {
    selectedSlot: "2026-09-28T01:00:00.000Z",
    timeZone: "Asia/Tokyo",
    durationMinutes: 30,
    meetingUrl: "https://zoom.us/j/123456789",
    notes: "営業責任者が参加",
    confirmedBy: "scheduler-2",
    confirmedAt,
  });
  assert.equal(lead.appointmentNoticeApproved, false);
  assert.equal(lead.appointmentNoticeRecordedAt, null);
  assert.equal(lead.appointmentNoticeDraft.savedBy, "scheduler-2");
  assert.equal(lead.appointmentNoticeDraft.savedAt, confirmedAt);
  assert.match(lead.appointmentNoticeDraft.body, /2026.*09.*28.*10:00/u);
  assert.match(lead.appointmentNoticeDraft.body, /https:\/\/zoom\.us\/j\/123456789/u);
  assert.equal(confirmSalesAppointment("lead-1", confirmed, {
    selectedSlot: "2026-09-28T01:00:00.000Z", meetingUrl: "https://zoom.us/j/1", notes: "",
  }, "scheduler-2", confirmedAt), null);
});

test("approves and records a deterministic appointment notice through the original channel", () => {
  const confirmed = confirmedAppointmentRecord("LINE");
  const approved = approveSalesAppointmentNotice(
    "lead-1", confirmed, "reviewer-4", "2026-09-27T05:00:00.000Z",
  );
  let lead = parseSalesLeadRecord("lead-1", approved);
  assert.equal(lead.appointmentNoticeApproved, true);
  assert.deepEqual(lead.appointmentNoticeApproval, {
    actorId: "reviewer-4", approvedAt: "2026-09-27T05:00:00.000Z",
  });

  const recorded = recordSalesAppointmentNoticeDelivery(
    "lead-1", approved, "operator-5", "2026-09-27T06:00:00.000Z",
  );
  lead = parseSalesLeadRecord("lead-1", recorded);
  assert.equal(lead.appointmentNoticeRecordedAt, "2026-09-27T06:00:00.000Z");
  assert.deepEqual(lead.appointmentNoticeDelivery, {
    actorId: "operator-5", recordedAt: "2026-09-27T06:00:00.000Z", channel: "LINE",
  });
  assert.equal(recordSalesAppointmentNoticeDelivery(
    "lead-1", recorded, "operator-5", "2026-09-27T06:00:00.000Z",
  ), null);
});

test("appointment notice workflow restores legacy drafts and rejects stale or altered state", () => {
  const confirmed = confirmedAppointmentRecord();
  const legacy = changeRecord(confirmed, {
    appointmentNoticeDraft: null,
    appointmentNoticeApproved: false,
    appointmentNoticeApproval: null,
    appointmentNoticeRecordedAt: null,
    appointmentNoticeDelivery: null,
  });
  const prepared = prepareSalesAppointmentNotice(
    "lead-1", legacy, "scheduler-3", "2026-09-27T05:00:00.000Z",
  );
  assert.ok(prepared);
  assert.equal(prepareSalesAppointmentNotice(
    "lead-1", prepared, "scheduler-3", "2026-09-27T05:00:00.000Z",
  ), null);
  assert.equal(prepareSalesAppointmentNotice(
    "lead-1", legacy, "scheduler-3", "2026-09-28T01:00:00.000Z",
  ), null);
  const approved = approveSalesAppointmentNotice(
    "lead-1", prepared, "reviewer-4", "2026-09-27T06:00:00.000Z",
  );
  assert.equal(recordSalesAppointmentNoticeDelivery(
    "lead-1", approved, "operator-5", "2026-09-27T07:00:00.000Z",
  ), null);
  const raw = JSON.parse(prepared.slice(SALES_LEAD_RECORD_PREFIX.length));
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(prepared, {
    appointmentNoticeDraft: { ...raw.appointmentNoticeDraft, body: "改変済み" },
  })), null);
});

test("prepares, approves, and records an appointment reminder only in the final 24 hours", () => {
  const confirmed = confirmedAppointmentRecord("LINE");
  const noticeApproved = approveSalesAppointmentNotice(
    "lead-1", confirmed, "reviewer-4", "2026-09-27T05:00:00.000Z",
  );
  const noticeRecorded = recordSalesAppointmentNoticeDelivery(
    "lead-1", noticeApproved, "operator-5", "2026-09-27T06:00:00.000Z",
  );
  assert.equal(prepareSalesAppointmentReminder(
    "lead-1", noticeRecorded, "scheduler-4", "2026-09-27T00:59:59.000Z",
  ), null);

  const prepared = prepareSalesAppointmentReminder(
    "lead-1", noticeRecorded, "scheduler-4", "2026-09-27T06:30:00.000Z",
  );
  let lead = parseSalesLeadRecord("lead-1", prepared);
  assert.equal(lead.appointmentReminderApproved, false);
  assert.match(lead.appointmentReminderDraft.subject, /前日/u);
  assert.match(lead.appointmentReminderDraft.body, /2026.*09.*28.*10:00/u);
  assert.match(lead.appointmentReminderDraft.body, /https:\/\/zoom\.us\/j\/123456789/u);

  const approved = approveSalesAppointmentReminder(
    "lead-1", prepared, "reviewer-5", "2026-09-27T07:00:00.000Z",
  );
  const recorded = recordSalesAppointmentReminderDelivery(
    "lead-1", approved, "operator-6", "2026-09-27T07:30:00.000Z",
  );
  lead = parseSalesLeadRecord("lead-1", recorded);
  assert.deepEqual(lead.appointmentReminderDelivery, {
    actorId: "operator-6", recordedAt: "2026-09-27T07:30:00.000Z", channel: "LINE",
  });
  assert.equal(recordSalesAppointmentReminderDelivery(
    "lead-1", recorded, "operator-6", "2026-09-27T07:30:00.000Z",
  ), null);
});

test("appointment reminder rejects missing notice delivery, stale times, and altered content", () => {
  const confirmed = confirmedAppointmentRecord("LINE");
  assert.equal(prepareSalesAppointmentReminder(
    "lead-1", confirmed, "scheduler-4", "2026-09-27T06:30:00.000Z",
  ), null);
  const noticeApproved = approveSalesAppointmentNotice(
    "lead-1", confirmed, "reviewer-4", "2026-09-27T05:00:00.000Z",
  );
  const noticeRecorded = recordSalesAppointmentNoticeDelivery(
    "lead-1", noticeApproved, "operator-5", "2026-09-27T06:00:00.000Z",
  );
  const prepared = prepareSalesAppointmentReminder(
    "lead-1", noticeRecorded, "scheduler-4", "2026-09-27T06:30:00.000Z",
  );
  assert.equal(approveSalesAppointmentReminder(
    "lead-1", prepared, "reviewer-5", "2026-09-28T01:00:00.000Z",
  ), null);
  const raw = JSON.parse(prepared.slice(SALES_LEAD_RECORD_PREFIX.length));
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(prepared, {
    appointmentReminderDraft: { ...raw.appointmentReminderDraft, body: "改変済み" },
  })), null);
});

test("appointment confirmation rejects unsent, unknown, stale, and unsafe meeting data", () => {
  const input = {
    selectedSlot: "2026-09-28T01:00:00.000Z", meetingUrl: "https://meet.google.com/abc-defg-hij", notes: "",
  };
  assert.equal(confirmSalesAppointment("lead-1", approvedMeetingRecord(), input, "scheduler", approvalTime), null);
  assert.equal(confirmSalesAppointment("lead-1", deliveredMeetingRecord(), {
    ...input, selectedSlot: "2026-10-01T01:00:00.000Z",
  }, "scheduler", "2026-09-27T04:00:00.000Z"), null);
  for (const meetingUrl of ["http://zoom.us/j/1", "javascript:alert(1)", "https://user:pass@zoom.us/j/1"])
    assert.equal(confirmSalesAppointment("lead-1", deliveredMeetingRecord(), {
      ...input, meetingUrl,
    }, "scheduler", "2026-09-27T04:00:00.000Z"), null);
  assert.equal(confirmSalesAppointment(
    "lead-1", deliveredMeetingRecord(), input, "scheduler", "2026-09-28T00:50:00.000Z",
  ), null);
  assert.equal(confirmSalesAppointment(
    "lead-1", deliveredMeetingRecord(), input, "scheduler", "2026-09-27T02:00:00.000Z",
  ), null);
});

test("parser rejects forged or mismatched appointment state", () => {
  const delivered = deliveredMeetingRecord();
  const appointment = {
    selectedSlot: "2026-09-28T01:00:00.000Z", timeZone: "Asia/Tokyo", durationMinutes: 30,
    meetingUrl: "https://zoom.us/j/123", notes: "", confirmedBy: "scheduler",
    confirmedAt: "2026-09-27T04:00:00.000Z",
  };
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(delivered, { appointment })), null);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(delivered, {
    appointmentConfirmed: true, appointment: { ...appointment, selectedSlot: "2026-10-01T01:00:00.000Z" },
  })), null);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(delivered, {
    appointmentConfirmed: true, appointment: { ...appointment, durationMinutes: 60 },
  })), null);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(delivered, {
    appointmentConfirmed: true, appointment: { ...appointment, notes: undefined },
  })), null);
});

test("records one audited appointment outcome after the meeting ends", () => {
  const recordedAt = "2026-09-28T01:30:00.000Z";
  const recorded = recordSalesAppointmentOutcome("lead-1", confirmedAppointmentRecord(), {
    result: "FOLLOW_UP", notes: " 次回は見積条件を整理して提案する ",
  }, "sales-manager", recordedAt);
  const lead = parseSalesLeadRecord("lead-1", recorded);
  assert.deepEqual(lead.appointmentOutcome, {
    result: "FOLLOW_UP",
    notes: "次回は見積条件を整理して提案する",
    actorId: "sales-manager",
    recordedAt,
  });
  assert.equal(recordSalesAppointmentOutcome("lead-1", recorded, {
    result: "WON", notes: "二重記録",
  }, "sales-manager", recordedAt), null);
});

test("appointment outcome rejects early, incomplete, suppressed, and forged records", () => {
  const confirmed = confirmedAppointmentRecord();
  for (const input of [
    { result: "UNKNOWN", notes: "結果" },
    { result: "WON", notes: " " },
    { result: "LOST", notes: "x".repeat(2_001) },
  ]) assert.equal(recordSalesAppointmentOutcome(
    "lead-1", confirmed, input, "sales-manager", "2026-09-28T01:30:00.000Z",
  ), null);
  assert.equal(recordSalesAppointmentOutcome("lead-1", confirmed, {
    result: "NO_SHOW", notes: "先方不参加",
  }, "sales-manager", "2026-09-28T01:29:59.999Z"), null);
  assert.equal(recordSalesAppointmentOutcome("lead-1", confirmed, {
    result: "WON", notes: "受注",
  }, "", "2026-09-28T01:30:00.000Z"), null);
  assert.equal(recordSalesAppointmentOutcome("lead-1", changeRecord(confirmed, { optedOut: true }), {
    result: "LOST", notes: "停止済み",
  }, "sales-manager", "2026-09-28T01:30:00.000Z"), null);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(confirmed, {
    appointmentOutcome: {
      result: "WON", notes: "受注", actorId: "manager", recordedAt: "2026-09-28T01:29:59.999Z",
    },
  })), null);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(deliveredMeetingRecord(), {
    appointmentOutcome: {
      result: "WON", notes: "受注", actorId: "manager", recordedAt: "2026-09-28T01:30:00.000Z",
    },
  })), null);
});

test("schedules and completes one audited post-meeting follow-up", () => {
  const outcome = recordSalesAppointmentOutcome("lead-1", confirmedAppointmentRecord(), {
    result: "FOLLOW_UP", notes: "次回提案へ進む",
  }, "sales-manager", "2026-09-28T01:30:00.000Z");
  const scheduled = scheduleSalesPostMeetingFollowUp("lead-1", outcome, {
    action: " 見積条件を整理して次回提案資料を作成する ",
    dueAt: "2026-10-01T01:00:00.000Z",
    owner: " 営業責任者 ",
  }, "sales-manager", "2026-09-28T02:00:00.000Z");
  let lead = parseSalesLeadRecord("lead-1", scheduled);
  assert.deepEqual(lead.postMeetingFollowUp, {
    action: "見積条件を整理して次回提案資料を作成する",
    dueAt: "2026-10-01T01:00:00.000Z",
    owner: "営業責任者",
    createdBy: "sales-manager",
    createdAt: "2026-09-28T02:00:00.000Z",
    completedBy: null,
    completedAt: null,
  });

  const completed = completeSalesPostMeetingFollowUp(
    "lead-1", scheduled, "operator", "2026-09-30T03:00:00.000Z",
  );
  lead = parseSalesLeadRecord("lead-1", completed);
  assert.equal(lead.postMeetingFollowUp.completedBy, "operator");
  assert.equal(lead.postMeetingFollowUp.completedAt, "2026-09-30T03:00:00.000Z");
  assert.equal(completeSalesPostMeetingFollowUp(
    "lead-1", completed, "operator", "2026-09-30T03:01:00.000Z",
  ), null);
});

test("post-meeting follow-up rejects unsafe, mistimed, duplicate, and forged records", () => {
  const followUpOutcome = recordSalesAppointmentOutcome("lead-1", confirmedAppointmentRecord(), {
    result: "FOLLOW_UP", notes: "次回提案へ進む",
  }, "sales-manager", "2026-09-28T01:30:00.000Z");
  const wonOutcome = recordSalesAppointmentOutcome("lead-1", confirmedAppointmentRecord(), {
    result: "WON", notes: "受注",
  }, "sales-manager", "2026-09-28T01:30:00.000Z");
  for (const input of [
    { action: " ", dueAt: "2026-10-01T01:00:00.000Z", owner: "担当" },
    { action: "対応", dueAt: "2026-09-28T01:59:59.999Z", owner: "担当" },
    { action: "対応", dueAt: "2027-10-01T01:00:00.000Z", owner: "担当" },
    { action: "対応", dueAt: "2026-10-01T01:00:00.000Z", owner: " " },
  ]) assert.equal(scheduleSalesPostMeetingFollowUp(
    "lead-1", followUpOutcome, input, "manager", "2026-09-28T02:00:00.000Z",
  ), null);
  assert.equal(scheduleSalesPostMeetingFollowUp("lead-1", wonOutcome, {
    action: "不要", dueAt: "2026-10-01T01:00:00.000Z", owner: "担当",
  }, "manager", "2026-09-28T02:00:00.000Z"), null);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(followUpOutcome, {
    postMeetingFollowUp: {
      action: "改変", dueAt: "2026-09-28T01:00:00.000Z", owner: "担当",
      createdBy: "manager", createdAt: "2026-09-28T02:00:00.000Z",
      completedBy: null, completedAt: null,
    },
  })), null);
});

test("opt-out reply becomes sticky and unsafe reply input fails closed", () => {
  const receivedAt = "2026-09-27T02:00:00.000Z";
  const optedOut = recordSalesReply("lead-1", deliveredRecord("LINE"), {
    channel: "LINE", type: "OPT_OUT", message: "今後の案内は不要です。",
  }, "operator-2", receivedAt);
  assert.equal(parseSalesLeadRecord("lead-1", optedOut).optedOut, true);
  for (const input of [
    { channel: "SMS", type: "UNKNOWN", message: "本文" },
    { channel: "EMAIL", type: "OTHER", message: "本文" },
    { channel: "EMAIL", type: "GENERAL_QUESTION", message: " " },
    { channel: "EMAIL", type: "GENERAL_QUESTION", message: "x".repeat(4_001) },
    null,
  ]) assert.equal(recordSalesReply(
    "lead-1", deliveredRecord(), input, "operator-2", receivedAt,
  ), null);
});

test("records opt-out during an unfinished reply and after a confirmed appointment", () => {
  const pending = saveSalesReplyDraft("lead-1", repliedRecord(), replyDraft);
  const stopped = recordSalesReply("lead-1", pending, {
    channel: "EMAIL", type: "OPT_OUT", message: "以後の連絡は不要です。",
  }, "operator-3", "2026-09-27T02:30:00.000Z");
  let lead = parseSalesLeadRecord("lead-1", stopped);
  assert.equal(lead.optedOut, true);
  assert.equal(lead.replies.length, 2);
  assert.deepEqual(lead.replyDraft, replyDraft);

  const delivered = deliveredMeetingRecord();
  const confirmed = confirmSalesAppointment("lead-1", delivered, {
    selectedSlot: "2026-09-28T01:00:00.000Z",
    meetingUrl: "https://zoom.us/j/123456789",
    notes: "",
  }, "scheduler", "2026-09-27T04:00:00.000Z");
  const stoppedAfterAppointment = recordSalesReply("lead-1", confirmed, {
    channel: "EMAIL", type: "OPT_OUT", message: "今後のご案内は不要です。",
  }, "operator-3", "2026-09-27T05:00:00.000Z");
  lead = parseSalesLeadRecord("lead-1", stoppedAfterAppointment);
  assert.equal(lead.optedOut, true);
  assert.equal(lead.appointmentConfirmed, true);
  assert.equal(lead.replies.at(-1).type, "OPT_OUT");
});

test("archives the approved response before recording a later inbound reply", () => {
  const responded = recordSalesReplyDelivery(
    "lead-1", approvedReplyRecord(), "operator-3", "2026-09-27T03:00:00.000Z",
  );
  const next = recordSalesReply("lead-1", responded, {
    channel: "EMAIL", type: "GENERAL_QUESTION", message: "追加で確認したいです。",
  }, "operator-4", "2026-09-27T04:00:00.000Z");
  const lead = parseSalesLeadRecord("lead-1", next);
  assert.equal(lead.replies.length, 2);
  assert.equal(lead.replies[0].resolution.kind, "SAFE_REPLY");
  assert.deepEqual(lead.replies[0].resolution.approval, {
    actorId: "reviewer-2", approvedAt: replyApprovalTime,
  });
  assert.equal(lead.replies[0].resolution.delivery.recordedAt, "2026-09-27T03:00:00.000Z");
  assert.equal(lead.replyDraft, null);
  assert.equal(lead.replyApproved, false);
});

test("archives delivered meeting options before continuing the conversation", () => {
  const next = recordSalesReply("lead-1", deliveredMeetingRecord("LINE"), {
    channel: "LINE", type: "SCHEDULING", message: "別の日程もお願いします。",
  }, "operator-5", "2026-09-27T04:00:00.000Z");
  const lead = parseSalesLeadRecord("lead-1", next);
  assert.equal(lead.replies.length, 2);
  assert.equal(lead.replies[0].resolution.kind, "MEETING_OPTIONS");
  assert.equal(lead.replies[0].resolution.delivery.channel, "LINE");
  assert.equal(lead.meetingOptionsDraft, null);
  assert.equal(lead.meetingOptionsApproved, false);
});

test("rejects archived meeting options that became stale before delivery", () => {
  const next = recordSalesReply("lead-1", deliveredMeetingRecord("LINE"), {
    channel: "LINE", type: "SCHEDULING", message: "別の日程もお願いします。",
  }, "operator-5", "2026-09-27T04:00:00.000Z");
  const record = JSON.parse(next.slice(SALES_LEAD_RECORD_PREFIX.length));
  const resolution = record.replies[0].resolution;
  const forged = changeRecord(next, { replies: [{
    ...record.replies[0],
    resolution: {
      ...resolution,
      draft: {
        ...resolution.draft,
        slots: ["2026-09-27T03:15:00.000Z", ...resolution.draft.slots.slice(1)],
      },
    },
  }, record.replies[1]] });
  assert.equal(parseSalesLeadRecord("lead-1", forged), null);
});

test("bounds continuous reply history at eight entries", () => {
  const delivered = deliveredMeetingRecord();
  let content = confirmSalesAppointment("lead-1", delivered, {
    selectedSlot: "2026-09-28T01:00:00.000Z",
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    notes: "",
  }, "scheduler", "2026-09-27T04:00:00.000Z");
  for (let index = 1; index < 8; index += 1) {
    content = recordSalesReply("lead-1", content, {
      channel: "EMAIL", type: "GENERAL_QUESTION", message: `追加質問${index}`,
    }, "operator", `2026-09-27T${String(index + 4).padStart(2, "0")}:00:00.000Z`);
    assert.ok(content);
  }
  assert.equal(parseSalesLeadRecord("lead-1", content).replies.length, 8);
  assert.equal(recordSalesReply("lead-1", content, {
    channel: "EMAIL", type: "GENERAL_QUESTION", message: "9件目",
  }, "operator", "2026-09-27T12:00:00.000Z"), null);
  const stopped = recordSalesReply("lead-1", content, {
    channel: "EMAIL", type: "OPT_OUT", message: "今後の連絡は不要です。",
  }, "operator", "2026-09-27T12:00:00.000Z");
  const lead = parseSalesLeadRecord("lead-1", stopped);
  assert.equal(lead.replies.length, 9);
  assert.equal(lead.replies.at(-1).type, "OPT_OUT");
  assert.equal(lead.optedOut, true);
  assert.equal(recordSalesReply("lead-1", stopped, {
    channel: "EMAIL", type: "OPT_OUT", message: "重複停止",
  }, "operator", "2026-09-27T13:00:00.000Z"), null);
});

test("rejects forged reply chronology and replies received before outreach delivery", () => {
  const first = repliedRecord();
  assert.equal(recordSalesReply("lead-1", deliveredRecord(), {
    channel: "EMAIL", type: "GENERAL_QUESTION", message: "早すぎる返信",
  }, "operator", "2026-09-26T23:59:59.000Z"), null);
  const forged = changeRecord(first, { replies: [
    ...JSON.parse(first.slice(SALES_LEAD_RECORD_PREFIX.length)).replies,
    { channel: "EMAIL", type: "GENERAL_QUESTION", message: "逆順", actorId: "operator", receivedAt: "2026-09-27T01:00:00.000Z" },
  ] });
  assert.equal(parseSalesLeadRecord("lead-1", forged), null);
});

test("rejects approvals and meeting preparation timestamped before the inbound reply", () => {
  const safe = saveSalesReplyDraft("lead-1", repliedRecord(), replyDraft);
  assert.equal(approveSalesReplyDraft("lead-1", safe, "reviewer", approvalTime), null);
  const scheduling = repliedRecord("SCHEDULING");
  assert.equal(saveSalesMeetingOptions(
    "lead-1", scheduling, meetingSlots, 30, "scheduler", approvalTime,
  ), null);
});

test("reply intake requires a valid persisted delivery and server audit", () => {
  const receivedAt = "2026-09-27T02:00:00.000Z";
  const input = { channel: "EMAIL", type: "SCHEDULING", message: "来週を希望します。" };
  const saved = saveSalesOutreachDraft("lead-1", researchedRecord(), outreach);
  assert.equal(recordSalesReply("lead-1", saved, input, "operator", receivedAt), null);
  assert.equal(recordSalesReply("lead-1", deliveredRecord(), input, "", receivedAt), null);
  assert.equal(recordSalesReply("lead-1", deliveredRecord(), input, "operator", "invalid"), null);
  const deliveryMismatch = changeRecord(deliveredRecord(), { outreachRecordedAt: "2026-09-27T03:00:00.000Z" });
  assert.equal(recordSalesReply("lead-1", deliveryMismatch, input, "operator", receivedAt), null);
});

test("draft edits and approvals stop on contact suppression and progressed records", () => {
  const saved = saveSalesOutreachDraft("lead-1", researchedRecord(), outreach);
  for (const changes of [
    { researchComplete: false }, { optedOut: true }, { optedOut: "false" },
    { appointmentConfirmed: true }, { outreachRecordedAt: approvalTime },
    { replies: [{ type: "OPT_OUT" }] }, { followUps: [{}] },
  ]) {
    const blocked = changeRecord(saved, changes);
    assert.equal(saveSalesOutreachDraft("lead-1", blocked, outreach), null);
    assert.equal(approveSalesOutreachDraft("lead-1", blocked, "reviewer", approvalTime), null);
  }
});

test("rejects header injection, blank and oversized drafts, and malformed stored drafts", () => {
  const record = researchedRecord();
  for (const input of [
    { ...outreach, subject: "提案\nBCC: other@example.com" },
    { ...outreach, body: " " }, { ...outreach, body: "x".repeat(4001) },
    { ...outreach, signature: "x".repeat(501) }, null,
  ]) assert.equal(saveSalesOutreachDraft("lead-1", record, input), null);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(record, { outreachDraft: { subject: "不完全" } })), null);
  const large = changeRecord(record, { extra: "x".repeat(10_000) });
  assert.equal(saveSalesOutreachDraft("lead-1", large, { ...outreach, body: "x".repeat(4000) }), null);
});

test("research completion requires audited HTTPS sources and never grants approval or delivery", () => {
  const original = createSalesLeadRecord({ companyName: "工務店" });
  const complete = (notes, sources = researchSources, actorId = "researcher-1", completedAt = researchTime) => (
    completeSalesResearch("lead-1", original, notes, sources, actorId, completedAt)
  );
  assert.equal(complete(" "), null);
  assert.equal(complete("調査済み", []), null);
  assert.equal(complete("調査済み", ["http://example.com"]), null);
  assert.equal(complete("調査済み", ["https://example.com", "https://EXAMPLE.com/"]), null);
  assert.equal(complete("調査済み", ["https://user:pass@example.com"]), null);
  assert.equal(complete("調査済み", researchSources, "", researchTime), null);
  assert.equal(complete("調査済み", researchSources, "researcher-1", "invalid"), null);
  const updated = complete("公式サイトで新築住宅事業を確認", ["https://example.com", "https://example.org/about"]);
  const lead = parseSalesLeadRecord("lead-1", updated);
  assert.equal(lead.researchComplete, true);
  assert.deepEqual(lead.researchAudit, {
    sources: ["https://example.com/", "https://example.org/about"],
    actorId: "researcher-1",
    completedAt: researchTime,
  });
  assert.equal(Object.isFrozen(lead.researchAudit), true);
  assert.equal(Object.isFrozen(lead.researchAudit.sources), true);
  assert.equal(lead.outreachApproved, false);
  assert.equal(lead.outreachRecordedAt, null);
  assert.equal(completeSalesResearch(
    "lead-1", updated, "再実行", researchSources, "researcher-1", researchTime,
  ), null);
  for (const changes of [{ optedOut: true }, { replies: [{}] }, { outreachApproved: true }]) {
    const raw = JSON.parse(original.slice(SALES_LEAD_RECORD_PREFIX.length));
    const blocked = SALES_LEAD_RECORD_PREFIX + JSON.stringify({ ...raw, ...changes });
    assert.equal(completeSalesResearch(
      "lead-1", blocked, "調査済み", researchSources, "researcher-1", researchTime,
    ), null);
  }
});

test("research audit remains backward compatible and fails closed when altered", () => {
  const audited = researchedRecord();
  const raw = JSON.parse(audited.slice(SALES_LEAD_RECORD_PREFIX.length));
  const legacy = SALES_LEAD_RECORD_PREFIX + JSON.stringify({
    ...raw, schemaVersion: undefined, researchAudit: undefined,
  });
  assert.equal(parseSalesLeadRecord("lead-1", legacy).researchAudit, null);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(audited, { researchAudit: undefined })), null);

  for (const researchAudit of [
    { ...raw.researchAudit, completedAt: "invalid" },
    { ...raw.researchAudit, actorId: "" },
    { ...raw.researchAudit, sources: ["http://example.com/"] },
    { ...raw.researchAudit, sources: ["https://EXAMPLE.com/"] },
  ]) {
    assert.equal(parseSalesLeadRecord("lead-1", changeRecord(audited, { researchAudit })), null);
  }
  const pristine = createSalesLeadRecord({ companyName: "工務店" });
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(pristine, { researchAudit: raw.researchAudit })), null);
  assert.equal(parseSalesLeadRecord("lead-1", changeRecord(pristine, { schemaVersion: 3 })), null);
});
