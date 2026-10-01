import test from "node:test";
import assert from "node:assert/strict";
import {
  hasSalesOptOutEvidence,
  requiresOptOutOnlyReplyIntake,
  salesReplyIntakeDefaultChannel,
} from "../lib/sales-reply-history.js";

const base = {
  appointmentConfirmed: false,
  replies: [],
  replyRecordedAt: null,
  meetingOptionsRecordedAt: null,
};

test("reply intake allows normal classifications before the first reply", () => {
  assert.equal(requiresOptOutOnlyReplyIntake(base), false);
});

test("reply intake allows only opt-out while the latest reply is unresolved", () => {
  assert.equal(requiresOptOutOnlyReplyIntake({
    ...base,
    replies: [{ type: "GENERAL_QUESTION" }],
  }), true);
  assert.equal(requiresOptOutOnlyReplyIntake({
    ...base,
    replies: [{ type: "SCHEDULING" }],
  }), true);
  assert.equal(requiresOptOutOnlyReplyIntake({
    ...base,
    replies: [{ type: "PRICE" }],
  }), true);
});

test("reply intake reopens normal classifications after the current response is recorded", () => {
  assert.equal(requiresOptOutOnlyReplyIntake({
    ...base,
    replies: [{ type: "GENERAL_QUESTION" }],
    replyRecordedAt: "2026-09-30T08:00:00.000Z",
  }), false);
  assert.equal(requiresOptOutOnlyReplyIntake({
    ...base,
    replies: [{ type: "SCHEDULING" }],
    meetingOptionsRecordedAt: "2026-09-30T08:00:00.000Z",
  }), false);
});

test("reply intake reserves the ninth slot for opt-out even after completed work", () => {
  const replies = Array.from({ length: 8 }, (_, index) => ({
    type: "GENERAL_QUESTION",
    receivedAt: `2026-09-30T${String(index).padStart(2, "0")}:00:00.000Z`,
  }));
  assert.equal(requiresOptOutOnlyReplyIntake({
    ...base,
    replies,
    replyRecordedAt: "2026-09-30T08:00:00.000Z",
  }), true);
});

test("reply intake fails closed for malformed records", () => {
  assert.equal(requiresOptOutOnlyReplyIntake(null), true);
  assert.equal(requiresOptOutOnlyReplyIntake({ ...base, replies: "invalid" }), true);
});

test("reply intake defaults to the latest conversation channel", () => {
  assert.equal(salesReplyIntakeDefaultChannel({
    ...base,
    outreachDelivery: { channel: "EMAIL" },
    replies: [{ type: "GENERAL_QUESTION", channel: "LINE" }],
  }), "LINE");
  assert.equal(salesReplyIntakeDefaultChannel({
    ...base,
    outreachDelivery: { channel: "LINE" },
  }), "LINE");
  assert.equal(salesReplyIntakeDefaultChannel({ ...base, outreachDelivery: null }), "EMAIL");
  assert.equal(salesReplyIntakeDefaultChannel(null), "EMAIL");
});

test("treats reply history as authoritative opt-out evidence", () => {
  assert.equal(hasSalesOptOutEvidence({ optedOut: false, replies: [{ type: "OPT_OUT" }] }), true);
  assert.equal(hasSalesOptOutEvidence({ optedOut: true, replies: [] }), true);
  assert.equal(hasSalesOptOutEvidence({ optedOut: false, replies: [] }), false);
  assert.equal(hasSalesOptOutEvidence({ optedOut: false, replies: "invalid" }), true);
});

test("fails closed when contact-suppression evidence is malformed", () => {
  assert.equal(hasSalesOptOutEvidence({ optedOut: "false", replies: [] }), true);
  assert.equal(hasSalesOptOutEvidence({ optedOut: false, replies: [{}] }), true);
  assert.equal(hasSalesOptOutEvidence({
    optedOut: false,
    replies: [{ type: "NOT_A_REPLY" }],
  }), true);
  assert.equal(hasSalesOptOutEvidence({
    optedOut: false,
    replies: Array.from({ length: 10 }, () => ({ type: "GENERAL_QUESTION" })),
  }), true);
  assert.equal(hasSalesOptOutEvidence({
    optedOut: false,
    replies: [{ type: "GENERAL_QUESTION" }],
  }), false);
});
