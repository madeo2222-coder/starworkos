import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesFunnelMetrics } from "../lib/sales-funnel-metrics.js";

function lead(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    researchComplete: false,
    outreachApproved: false,
    outreachRecordedAt: null,
    replies: [],
    followUps: [],
    meetingOptionsApproved: false,
    meetingOptionsRecordedAt: null,
    appointmentConfirmed: false,
    appointment: null,
    appointmentOutcome: null,
    postMeetingFollowUp: null,
    optedOut: false,
    ...overrides,
  };
}

test("builds the registered-to-appointment funnel and conversion rates", () => {
  const sent = {
    researchComplete: true,
    outreachApproved: true,
    outreachRecordedAt: "2026-09-20T00:00:00.000Z",
  };
  const metrics = buildSalesFunnelMetrics([
    lead(),
    lead({ researchComplete: true }),
    lead(sent),
    lead({ ...sent, replies: [{ type: "GENERAL_QUESTION", receivedAt: "2026-09-21T00:00:00.000Z" }] }),
    lead({
      ...sent,
      replies: [{ type: "SCHEDULING", receivedAt: "2026-09-21T00:00:00.000Z" }],
      meetingOptionsApproved: true,
      meetingOptionsRecordedAt: "2026-09-21T01:00:00.000Z",
      appointmentConfirmed: true,
      appointment: {
        selectedSlot: "2026-09-28T01:00:00.000Z",
        durationMinutes: 30,
        confirmedBy: "scheduler",
        confirmedAt: "2026-09-21T02:00:00.000Z",
      },
    }),
  ]);

  assert.deepEqual(metrics.funnel.map(({ count }) => count), [5, 4, 3, 2, 1]);
  assert.equal(metrics.rates.replyRate, 66.7);
  assert.equal(metrics.rates.appointmentRate, 33.3);
});

test("reports audited appointment outcomes and overdue post-meeting work", () => {
  const appointment = {
    researchComplete: true,
    outreachApproved: true,
    outreachRecordedAt: "2026-09-20T00:00:00.000Z",
    replies: [{ type: "SCHEDULING", receivedAt: "2026-09-21T00:00:00.000Z" }],
    meetingOptionsApproved: true,
    meetingOptionsRecordedAt: "2026-09-21T01:00:00.000Z",
    appointmentConfirmed: true,
    appointment: {
      selectedSlot: "2026-09-28T01:00:00.000Z",
      durationMinutes: 30,
      confirmedBy: "scheduler",
      confirmedAt: "2026-09-21T02:00:00.000Z",
    },
  };
  const outcome = (result) => ({
    result,
    notes: "面談結果を確認済み",
    actorId: "sales-manager",
    recordedAt: "2026-09-28T02:00:00.000Z",
  });
  const metrics = buildSalesFunnelMetrics([
    lead({ ...appointment, appointmentOutcome: outcome("WON") }),
    lead({ ...appointment, appointmentOutcome: outcome("LOST") }),
    lead({ ...appointment, appointmentOutcome: outcome("NO_SHOW") }),
    lead({
      ...appointment,
      appointmentOutcome: outcome("FOLLOW_UP"),
      postMeetingFollowUp: {
        action: "次回提案を準備する",
        owner: "営業責任者",
        createdBy: "sales-manager",
        createdAt: "2026-09-28T02:30:00.000Z",
        dueAt: "2026-09-30T01:00:00.000Z",
        completedBy: null,
        completedAt: null,
      },
    }),
    lead(appointment),
  ], { now: new Date("2026-10-01T00:00:00.000Z") });

  assert.equal(metrics.counts.appointmentOutcomes, 4);
  assert.equal(metrics.counts.pendingAppointmentOutcomes, 1);
  assert.equal(metrics.counts.won, 1);
  assert.equal(metrics.counts.lost, 1);
  assert.equal(metrics.counts.noShow, 1);
  assert.equal(metrics.counts.nextAction, 1);
  assert.equal(metrics.counts.postMeetingFollowUps, 1);
  assert.equal(metrics.counts.overduePostMeetingFollowUps, 1);
  assert.equal(metrics.rates.appointmentOutcomeRate, 80);
  assert.equal(metrics.rates.winRate, 50);
});

test("excludes forged meeting results and inconsistent post-meeting work", () => {
  const appointment = {
    researchComplete: true,
    outreachApproved: true,
    outreachRecordedAt: "2026-09-20T00:00:00.000Z",
    replies: [{ type: "SCHEDULING", receivedAt: "2026-09-21T00:00:00.000Z" }],
    meetingOptionsApproved: true,
    meetingOptionsRecordedAt: "2026-09-21T01:00:00.000Z",
    appointmentConfirmed: true,
    appointment: {
      selectedSlot: "2026-09-28T01:00:00.000Z",
      durationMinutes: 30,
      confirmedBy: "scheduler",
      confirmedAt: "2026-09-21T02:00:00.000Z",
    },
  };
  const earlyOutcome = {
    result: "WON", notes: "早すぎる記録", actorId: "manager",
    recordedAt: "2026-09-28T01:10:00.000Z",
  };
  const inconsistentFollowUp = {
    action: "不要な次回対応", owner: "営業責任者", createdBy: "manager",
    createdAt: "2026-09-28T02:30:00.000Z", dueAt: "2026-09-30T01:00:00.000Z",
    completedBy: null, completedAt: null,
  };
  const metrics = buildSalesFunnelMetrics([
    lead(),
    lead({ ...appointment, appointmentOutcome: earlyOutcome }),
    lead({
      ...appointment,
      appointmentOutcome: {
        result: "LOST", notes: "失注", actorId: "manager",
        recordedAt: "2026-09-28T02:00:00.000Z",
      },
      postMeetingFollowUp: inconsistentFollowUp,
    }),
  ], { now: new Date("2026-10-01T00:00:00.000Z") });

  assert.equal(metrics.counts.registered, 1);
  assert.equal(metrics.counts.invalid, 2);
  assert.equal(metrics.counts.appointmentOutcomes, 0);
});

test("counts audited supporting outcomes without reading message contents", () => {
  const metrics = buildSalesFunnelMetrics([
    lead({
      researchComplete: true,
      outreachApproved: true,
      outreachRecordedAt: "2026-09-19T00:00:00.000Z",
      followUps: [{ recordedAt: "2026-09-20T00:00:00.000Z" }],
    }),
    lead({
      researchComplete: true,
      outreachApproved: true,
      outreachRecordedAt: "2026-09-20T00:00:00.000Z",
      replies: [{ type: "SCHEDULING", receivedAt: "2026-09-21T00:00:00.000Z", message: "秘密" }],
      meetingOptionsApproved: true,
      meetingOptionsRecordedAt: "2026-09-21T01:00:00.000Z",
    }),
    lead({
      researchComplete: true,
      outreachApproved: true,
      outreachRecordedAt: "2026-09-20T00:00:00.000Z",
      replies: [{ type: "OPT_OUT", receivedAt: "2026-09-21T00:00:00.000Z" }],
      optedOut: true,
    }),
  ]);

  assert.equal(metrics.counts.followUpLeads, 1);
  assert.equal(metrics.counts.meetingOptionsSent, 1);
  assert.equal(metrics.counts.optedOut, 1);
  assert.equal("message" in metrics.funnel[0], false);
});

test("excludes forged meeting-option approval and delivery chronology", () => {
  const sent = {
    researchComplete: true,
    outreachApproved: true,
    outreachRecordedAt: "2026-09-20T00:00:00.000Z",
    replies: [{ type: "SCHEDULING", receivedAt: "2026-09-21T00:00:00.000Z" }],
  };
  const metrics = buildSalesFunnelMetrics([
    lead({
      ...sent,
      meetingOptionsRecordedAt: "2026-09-21T01:00:00.000Z",
    }),
    lead({
      ...sent,
      meetingOptionsApproved: true,
      meetingOptionsRecordedAt: "2026-09-20T23:59:59.999Z",
    }),
    lead({
      ...sent,
      meetingOptionsApproved: true,
      meetingOptionsRecordedAt: "2026-09-21T01:00:00.000Z",
    }),
  ]);

  assert.equal(metrics.counts.invalid, 2);
  assert.equal(metrics.counts.registered, 1);
  assert.equal(metrics.counts.meetingOptionsSent, 1);
});

test("excludes appointments with missing or forged confirmation chronology", () => {
  const sent = {
    researchComplete: true,
    outreachApproved: true,
    outreachRecordedAt: "2026-09-20T00:00:00.000Z",
    replies: [{ type: "SCHEDULING", receivedAt: "2026-09-21T00:00:00.000Z" }],
    meetingOptionsApproved: true,
    meetingOptionsRecordedAt: "2026-09-21T01:00:00.000Z",
    appointmentConfirmed: true,
  };
  const validAppointment = {
    selectedSlot: "2026-09-21T03:00:00.000Z",
    durationMinutes: 30,
    confirmedBy: "scheduler",
    confirmedAt: "2026-09-21T02:00:00.000Z",
  };
  const metrics = buildSalesFunnelMetrics([
    lead({
      ...sent,
      appointment: { selectedSlot: validAppointment.selectedSlot, durationMinutes: 30 },
    }),
    lead({
      ...sent,
      appointment: { ...validAppointment, confirmedAt: "2026-09-21T00:59:59.999Z" },
    }),
    lead({
      ...sent,
      appointment: {
        ...validAppointment,
        selectedSlot: "2026-09-21T02:14:59.999Z",
      },
    }),
    lead({ ...sent, appointment: validAppointment }),
  ]);

  assert.equal(metrics.counts.invalid, 3);
  assert.equal(metrics.counts.registered, 1);
  assert.equal(metrics.counts.appointments, 1);
  assert.equal(metrics.rates.appointmentRate, 100);
});

test("rejects unsupported reply types and opt-out flags inconsistent with history", () => {
  const sent = {
    researchComplete: true,
    outreachApproved: true,
    outreachRecordedAt: "2026-09-20T00:00:00.000Z",
  };
  const reply = (type) => ({ type, receivedAt: "2026-09-21T00:00:00.000Z" });
  const invalidStates = [
    { optedOut: true },
    { optedOut: "false" },
    { optedOut: false, replies: [reply("OPT_OUT")] },
    { optedOut: true, replies: [reply("GENERAL_QUESTION")] },
    { optedOut: true, replies: [reply("OPT_OUT"), reply("OPT_OUT")] },
    { optedOut: true, replies: [reply("OPT_OUT"), reply("GENERAL_QUESTION")] },
    { replies: [reply("NOT_A_REPLY_TYPE")] },
    { replies: [reply("toString")] },
  ];
  for (const invalid of invalidStates) {
    const metrics = buildSalesFunnelMetrics([lead(sent), lead({ ...sent, ...invalid })]);
    assert.equal(metrics.counts.invalid, 1, JSON.stringify(invalid));
    assert.equal(metrics.counts.registered, 1);
    assert.equal(metrics.counts.outreachSent, 1);
    assert.equal(metrics.counts.replied, 0);
    assert.equal(metrics.counts.optedOut, 0);
    assert.equal(metrics.rates.replyRate, 0);
  }
});

test("counts a final opt-out at reply capacity and accepts the explicit UNKNOWN category", () => {
  const sent = {
    researchComplete: true,
    outreachApproved: true,
    outreachRecordedAt: "2026-09-20T00:00:00.000Z",
  };
  const replies = Array.from({ length: 9 }, (_, index) => ({
    type: index === 8 ? "OPT_OUT" : "GENERAL_QUESTION",
    receivedAt: `2026-09-${21 + index}T00:00:00.000Z`,
  }));
  const metrics = buildSalesFunnelMetrics([
    lead({ ...sent, optedOut: true, replies }),
    lead({ ...sent, replies: [{ type: "UNKNOWN", receivedAt: "2026-09-21T00:00:00.000Z" }] }),
  ]);
  assert.equal(metrics.counts.invalid, 0);
  assert.equal(metrics.counts.replied, 2);
  assert.equal(metrics.counts.optedOut, 1);
  assert.equal(metrics.rates.replyRate, 100);
});

test("shows unavailable rates instead of a misleading zero percent", () => {
  const metrics = buildSalesFunnelMetrics([lead()]);

  assert.equal(metrics.rates.replyRate, null);
  assert.equal(metrics.rates.appointmentRate, null);
});

test("excludes excess and out-of-order contact history from funnel denominators", () => {
  const sent = {
    researchComplete: true,
    outreachApproved: true,
    outreachRecordedAt: "2026-09-20T00:00:00.000Z",
  };
  const followUp = (day) => ({ recordedAt: `2026-09-${day}T00:00:00.000Z` });
  const reply = (day) => ({ type: "GENERAL_QUESTION", receivedAt: `2026-09-${day}T00:00:00.000Z` });
  const invalidHistories = [
    { followUps: [followUp(21), followUp(22), followUp(23)] },
    { followUps: [followUp(19)] },
    { followUps: [followUp(22), followUp(21)] },
    { replies: [reply(19)] },
    { replies: [reply(22), reply(21)] },
    { followUps: [followUp(22)], replies: [reply(21)] },
  ];
  for (const history of invalidHistories) {
    const metrics = buildSalesFunnelMetrics([lead(sent), lead({ ...sent, ...history })]);
    assert.equal(metrics.counts.invalid, 1, JSON.stringify(history));
    assert.equal(metrics.counts.registered, 1);
    assert.equal(metrics.counts.outreachSent, 1);
    assert.equal(metrics.counts.replied, 0);
    assert.equal(metrics.counts.followUpLeads, 0);
    assert.equal(metrics.rates.replyRate, 0);
  }
});

test("retains two follow-ups and ordered replies without mutating audit history", () => {
  const value = lead({
    researchComplete: true,
    outreachApproved: true,
    outreachRecordedAt: "2026-09-20T00:00:00.000Z",
    followUps: [
      { recordedAt: "2026-09-21T00:00:00.000Z" },
      { recordedAt: "2026-09-22T00:00:00Z" },
    ],
    replies: [
      { type: "GENERAL_QUESTION", receivedAt: "2026-09-22T00:00:00.000Z" },
      { type: "MATERIAL_REQUEST", receivedAt: "2026-09-23T00:00:00.000Z" },
    ],
  });
  const before = structuredClone(value);
  const metrics = buildSalesFunnelMetrics([value]);
  assert.equal(metrics.counts.invalid, 0);
  assert.equal(metrics.counts.registered, 1);
  assert.equal(metrics.counts.followUpLeads, 1);
  assert.equal(metrics.counts.replied, 1);
  assert.equal(metrics.rates.replyRate, 100);
  assert.deepEqual(value, before);
});

test("deduplicates, rejects forged chronology, and caps valid leads at 100", () => {
  const first = lead({ id: "same-id" });
  const input = [
    first,
    { ...first },
    lead({ replies: [{ type: "GENERAL_QUESTION", receivedAt: "2026-09-21T00:00:00.000Z" }] }),
  ];
  for (let index = 0; index < 110; index += 1) input.push(lead());
  const metrics = buildSalesFunnelMetrics(input);

  assert.equal(metrics.counts.registered, 100);
  assert.equal(metrics.counts.duplicate, 1);
  assert.equal(metrics.counts.invalid, 1);
});

test("fails closed for invalid batches and returns immutable results", () => {
  const metrics = buildSalesFunnelMetrics(null);

  assert.equal(metrics.invalidBatch, true);
  assert.equal(metrics.counts.registered, 0);
  assert.equal(Object.isFrozen(metrics), true);
  assert.equal(Object.isFrozen(metrics.funnel), true);
  assert.equal(Object.isFrozen(metrics.counts), true);
  assert.equal(Object.isFrozen(metrics.rates), true);
});
