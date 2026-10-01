import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesPipelineCsv } from "../lib/sales-pipeline-export.js";

const NOW = new Date("2026-09-28T00:00:00.000Z");

function lead(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    companyName: "テスト株式会社",
    website: "https://example.com",
    optedOut: false,
    appointmentConfirmed: false,
    appointment: null,
    appointmentOutcome: null,
    postMeetingFollowUp: null,
    researchComplete: true,
    outreachApproved: true,
    outreachRecordedAt: "2026-09-20T00:00:00.000Z",
    replyApproved: false,
    replyRecordedAt: null,
    meetingOptionsApproved: false,
    meetingOptionsRecordedAt: null,
    followUps: [],
    replies: [],
    contact: "secret@example.com",
    researchNotes: "内部調査メモ",
    ...overrides,
  };
}

function confirmedAppointmentState(overrides = {}) {
  const {
    selectedSlot = "2026-09-29T01:00:00.000Z",
    durationMinutes = 30,
    confirmedBy = "scheduler",
    confirmedAt = "2026-09-25T03:00:00.000Z",
    ...stateOverrides
  } = overrides;
  return {
    replies: [{ type: "SCHEDULING", receivedAt: "2026-09-25T00:00:00.000Z" }],
    meetingOptionsApproved: true,
    meetingOptionsRecordedAt: "2026-09-25T02:00:00.000Z",
    appointmentConfirmed: true,
    appointment: { selectedSlot, durationMinutes, confirmedBy, confirmedAt },
    ...stateOverrides,
  };
}

test("exports a bounded sales pipeline without sensitive details", () => {
  const csv = buildSalesPipelineCsv([lead()], { now: NOW });

  assert.match(csv, /^\uFEFF"企業名","Webサイト","案件状態"/);
  assert.match(csv, /"テスト株式会社","https:\/\/example\.com","返信待ち"/);
  assert.match(csv, /"営業文面担当","追客案を準備"/);
  assert.doesNotMatch(csv, /secret@example\.com|内部調査メモ/);
});

test("excludes a lead with forged supplied research evidence", () => {
  const csv = buildSalesPipelineCsv([
    lead({
      companyName: "監査不正社",
      researchAudit: {
        actorId: "researcher-1",
        completedAt: "invalid",
        sources: ["https://example.com/company"],
      },
    }),
    lead({ companyName: "正常社" }),
  ], { now: NOW });

  assert.doesNotMatch(csv, /監査不正社/u);
  assert.match(csv, /正常社/u);
});

test("reports reply, opt-out, and appointment states", () => {
  const csv = buildSalesPipelineCsv([
    lead({
      companyName: "返信社",
      replies: [{ type: "PRICE", receivedAt: "2026-09-27T02:00:00.000Z" }],
    }),
    lead({ companyName: "停止社", optedOut: true }),
    lead({
      companyName: "面談社",
      ...confirmedAppointmentState(),
    }),
  ], { now: NOW });

  assert.match(csv, /"返信社"[^\r\n]+"返信対応中"[^\r\n]+"価格相談"/);
  assert.match(csv, /"停止社"[^\r\n]+"配信停止"[^\r\n]+"停止"/);
  assert.match(csv, /"面談社"[^\r\n]+"アポ確定"[^\r\n]+"2026-09-29T01:00:00.000Z"/);
});

test("exports a ninth final opt-out without truncating reply history", () => {
  const replies = Array.from({ length: 9 }, (_, index) => ({
    type: index === 8 ? "OPT_OUT" : "GENERAL_QUESTION",
    receivedAt: `2026-09-${20 + index}T00:00:00.000Z`,
  }));
  const csv = buildSalesPipelineCsv([lead({ companyName: "上限停止社", replies, optedOut: true })], {
    now: new Date("2026-09-29T00:00:00.000Z"),
  });
  assert.match(csv, /"上限停止社"[^\r\n]+"配信停止"[^\r\n]+"9","配信停止"/);
});

test("exports final opt-out evidence as stopped before the cached flag catches up", () => {
  const replies = Array.from({ length: 9 }, (_, index) => ({
    type: index === 8 ? "OPT_OUT" : "GENERAL_QUESTION",
    receivedAt: `2026-09-${20 + index}T00:00:00.000Z`,
  }));
  const csv = buildSalesPipelineCsv([lead({
    companyName: "停止反映待ち社", replies, optedOut: false,
  })], { now: new Date("2026-09-29T00:00:00.000Z") });
  assert.match(csv, /"停止反映待ち社"[^\r\n]+"配信停止"[^\r\n]+"9","配信停止"[^\r\n]+"停止"/);
});

test("exports malformed cached opt-out evidence as stopped", () => {
  const csv = buildSalesPipelineCsv([lead({
    companyName: "停止状態確認社", optedOut: "false",
  })], { now: NOW });
  assert.match(csv, /"停止状態確認社"[^\r\n]+"配信停止"[^\r\n]+"停止"/);
});

test("exports appointment outcome and post-meeting follow-up status without private details", () => {
  const csv = buildSalesPipelineCsv([lead({
    companyName: "次回提案社",
    ...confirmedAppointmentState({ selectedSlot: "2026-09-27T01:00:00.000Z" }),
    appointmentOutcome: { result: "FOLLOW_UP", recordedAt: "2026-09-27T02:00:00.000Z" },
    postMeetingFollowUp: {
      dueAt: "2026-10-01T01:00:00.000Z",
      createdAt: "2026-09-27T02:30:00.000Z",
      completedAt: null,
      action: "社外秘の見積条件",
      owner: "担当者A",
    },
  })], { now: NOW });

  assert.match(csv, /"次回提案社"[^\r\n]+"面談後フォロー中"/);
  assert.match(csv, /"次回対応","2026-10-01T01:00:00.000Z","未完了"/);
  assert.doesNotMatch(csv, /社外秘の見積条件|担当者A/);
});

test("excludes forged appointment outcome and post-meeting follow-up chronology", () => {
  const confirmed = confirmedAppointmentState({ selectedSlot: "2026-09-27T01:00:00.000Z" });
  const appointmentOutcome = {
    result: "FOLLOW_UP",
    recordedAt: "2026-09-27T02:00:00.000Z",
  };
  const postMeetingFollowUp = {
    dueAt: "2026-10-01T01:00:00.000Z",
    createdAt: "2026-09-27T02:30:00.000Z",
    completedAt: null,
  };
  const csv = buildSalesPipelineCsv([
    lead({
      companyName: "未確定結果社",
      appointmentConfirmed: false,
      appointment: null,
      appointmentOutcome,
    }),
    lead({
      companyName: "面談終了前結果社",
      ...confirmed,
      appointmentOutcome: {
        ...appointmentOutcome,
        recordedAt: "2026-09-27T01:29:59.999Z",
      },
    }),
    lead({
      companyName: "結果前フォロー社",
      ...confirmed,
      appointmentOutcome,
      postMeetingFollowUp: {
        ...postMeetingFollowUp,
        createdAt: "2026-09-27T01:59:59.999Z",
      },
    }),
    lead({
      companyName: "作成前期限社",
      ...confirmed,
      appointmentOutcome,
      postMeetingFollowUp: {
        ...postMeetingFollowUp,
        dueAt: "2026-09-27T02:29:59.999Z",
      },
    }),
    lead({
      companyName: "作成前完了社",
      ...confirmed,
      appointmentOutcome,
      postMeetingFollowUp: {
        ...postMeetingFollowUp,
        completedAt: "2026-09-27T02:29:59.999Z",
      },
    }),
    lead({
      companyName: "結果なしフォロー社",
      ...confirmed,
      appointmentOutcome: null,
      postMeetingFollowUp,
    }),
    lead({
      companyName: "対象外結果フォロー社",
      ...confirmed,
      appointmentOutcome: { ...appointmentOutcome, result: "WON" },
      postMeetingFollowUp,
    }),
    lead({ companyName: "正常社" }),
  ], { now: NOW });

  assert.doesNotMatch(csv,
    /未確定結果社|面談終了前結果社|結果前フォロー社|作成前期限社|作成前完了社|結果なしフォロー社|対象外結果フォロー社/u);
  assert.match(csv, /正常社/u);
});

test("excludes missing and forged appointment confirmation chronology", () => {
  const valid = confirmedAppointmentState({
    selectedSlot: "2026-09-25T05:00:00.000Z",
    confirmedAt: "2026-09-25T03:00:00.000Z",
  });
  const csv = buildSalesPipelineCsv([
    lead({
      companyName: "確定監査欠落社",
      ...valid,
      appointment: {
        selectedSlot: valid.appointment.selectedSlot,
        durationMinutes: valid.appointment.durationMinutes,
      },
    }),
    lead({
      companyName: "候補送信前確定社",
      ...valid,
      appointment: { ...valid.appointment, confirmedAt: "2026-09-25T01:59:59.999Z" },
    }),
    lead({
      companyName: "開始直前確定社",
      ...valid,
      appointment: { ...valid.appointment, selectedSlot: "2026-09-25T03:14:59.999Z" },
    }),
    lead({ companyName: "正常確定社", ...valid }),
  ], { now: NOW });

  assert.doesNotMatch(csv, /確定監査欠落社|候補送信前確定社|開始直前確定社/u);
  assert.match(csv, /正常確定社/u);
});

test("excludes forged approval and delivery chronology", () => {
  const csv = buildSalesPipelineCsv([
    lead({
      companyName: "未承認返信記録社",
      replies: [{ type: "GENERAL_QUESTION", receivedAt: "2026-09-27T00:00:00.000Z" }],
      replyRecordedAt: "2026-09-27T01:00:00.000Z",
    }),
    lead({
      companyName: "返信前候補送信社",
      replies: [{ type: "SCHEDULING", receivedAt: "2026-09-27T00:00:00.000Z" }],
      meetingOptionsApproved: true,
      meetingOptionsRecordedAt: "2026-09-26T23:59:59.999Z",
    }),
    lead({ companyName: "正常社" }),
  ], { now: NOW });

  assert.doesNotMatch(csv, /未承認返信記録社|返信前候補送信社/u);
  assert.match(csv, /正常社/u);
});

test("excludes oversized, reordered, and planner-invalid histories", () => {
  const csv = buildSalesPipelineCsv([
    lead({
      companyName: "追客超過社",
      followUps: [
        { recordedAt: "2026-09-21T00:00:00.000Z" },
        { recordedAt: "2026-09-22T00:00:00.000Z" },
        { recordedAt: "2026-09-23T00:00:00.000Z" },
      ],
    }),
    lead({
      companyName: "追客逆転社",
      followUps: [
        { recordedAt: "2026-09-22T00:00:00.000Z" },
        { recordedAt: "2026-09-21T00:00:00.000Z" },
      ],
    }),
    lead({
      companyName: "返信逆転社",
      replies: [
        { type: "PRICE", receivedAt: "2026-09-22T00:00:00.000Z" },
        { type: "CONTRACT", receivedAt: "2026-09-21T00:00:00.000Z" },
      ],
    }),
    lead({
      companyName: "内部状態不正社",
      appointmentConfirmed: true,
      appointment: { selectedSlot: "2026-09-29T01:00:00.000Z" },
    }),
    lead({ companyName: "正常社" }),
  ], { now: NOW });

  assert.doesNotMatch(csv, /追客超過社|追客逆転社|返信逆転社|内部状態不正社/u);
  assert.match(csv, /正常社/u);
});

test("neutralizes spreadsheet formulas and quotes CSV values", () => {
  const csv = buildSalesPipelineCsv([lead({
    companyName: "=HYPERLINK(\"https://evil.example\")",
    website: "https://example.com/a,b",
  })], { now: NOW });

  assert.match(csv, /"'=HYPERLINK\(""https:\/\/evil\.example""\)"/);
  assert.match(csv, /"https:\/\/example\.com\/a,b"/);
});

test("deduplicates ids, ignores malformed records, and caps rows at 100", () => {
  const first = lead({ id: "same-id", companyName: "先頭" });
  const rows = [first, { ...first, companyName: "重複" }, { id: "broken" }];
  for (let index = 0; index < 110; index += 1) rows.push(lead({ companyName: `企業${index}` }));
  const csv = buildSalesPipelineCsv(rows, { now: NOW });
  const lines = csv.trim().split("\r\n");

  assert.equal(lines.length, 101);
  assert.match(csv, /先頭/);
  assert.doesNotMatch(csv, /重複/);
});

test("fails closed for invalid batches and clocks", () => {
  assert.equal(buildSalesPipelineCsv(null, { now: NOW }), null);
  assert.equal(buildSalesPipelineCsv([], { now: new Date("invalid") }), null);
});
