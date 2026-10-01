import test from "node:test";
import assert from "node:assert/strict";
import { buildUnsentSalesFollowUpEmail } from "../lib/sales-follow-up-email-export.js";

function lead(overrides = {}) {
  return {
    contact: "営業部 sales@example.com",
    optedOut: false,
    appointmentConfirmed: false,
    replies: [],
    followUps: [],
    outreachApproved: true,
    outreachDraft: {
      subject: "住宅設備延長保証のご相談",
      body: "初回のご案内です。",
      signature: "STAR WORK OS\n営業担当",
    },
    outreachApproval: {
      actorId: "reviewer-1",
      approvedAt: "2026-09-26T00:00:00.000Z",
    },
    outreachRecordedAt: "2026-09-26T01:00:00.000Z",
    outreachDelivery: {
      actorId: "sender-1",
      recordedAt: "2026-09-26T01:00:00.000Z",
      channel: "EMAIL",
    },
    followUpApproved: true,
    followUpApproval: {
      actorId: "reviewer-2",
      approvedAt: "2026-09-30T01:00:00.000Z",
    },
    followUpDraft: {
      subject: "先日のご案内について",
      body: "その後のご状況はいかがでしょうか。",
      signature: "STAR WORK OS\n営業担当",
      savedBy: "writer",
      savedAt: "2026-09-30T00:00:00.000Z",
    },
    ...overrides,
  };
}

test("builds an approved unsent follow-up email", () => {
  const eml = buildUnsentSalesFollowUpEmail(lead());
  assert.ok(eml);
  assert.match(eml, /^To: sales@example\.com\r\nSubject: =\?UTF-8\?B\?/u);
  assert.match(eml, /\r\nX-Unsent: 1\r\n\r\n/u);
  const encodedBody = eml.split("\r\n\r\n")[1].replace(/\r\n/gu, "");
  assert.equal(Buffer.from(encodedBody, "base64").toString("utf8"),
    "その後のご状況はいかがでしょうか。\r\n\r\nSTAR WORK OS\r\n営業担当");
});

test("builds the second follow-up only after a valid delivered first follow-up", () => {
  const eml = buildUnsentSalesFollowUpEmail(lead({
    outreachApproval: { actorId: "reviewer-1", approvedAt: "2026-09-19T23:00:00.000Z" },
    outreachRecordedAt: "2026-09-20T00:00:00.000Z",
    outreachDelivery: {
      actorId: "sender-1",
      recordedAt: "2026-09-20T00:00:00.000Z",
      channel: "EMAIL",
    },
    followUps: [{
      draft: {
        subject: "1回目のフォロー",
        body: "1回目の本文です。",
        signature: "STAR WORK OS\n営業担当",
        savedBy: "writer-1",
        savedAt: "2026-09-23T00:00:00.000Z",
      },
      approval: { actorId: "reviewer-1", approvedAt: "2026-09-23T01:00:00.000Z" },
      delivery: {
        actorId: "sender-1",
        recordedAt: "2026-09-23T02:00:00.000Z",
        channel: "EMAIL",
      },
    }],
  }));
  assert.ok(eml);
});

test("fails closed for unsafe or completed follow-up states", () => {
  assert.equal(buildUnsentSalesFollowUpEmail(lead({ followUpApproved: false })), null);
  assert.equal(buildUnsentSalesFollowUpEmail(lead({ optedOut: true })), null);
  assert.equal(buildUnsentSalesFollowUpEmail(lead({ appointmentConfirmed: true })), null);
  assert.equal(buildUnsentSalesFollowUpEmail(lead({ replies: [{}] })), null);
  assert.equal(buildUnsentSalesFollowUpEmail(lead({ followUps: [{}, {}] })), null);
  assert.equal(buildUnsentSalesFollowUpEmail(lead({ contact: "a@example.com b@example.com" })), null);
});

test("rejects missing or forged follow-up approval chronology", () => {
  assert.equal(buildUnsentSalesFollowUpEmail(lead({ followUpApproval: null })), null);
  assert.equal(buildUnsentSalesFollowUpEmail(lead({
    followUpApproval: { actorId: "reviewer-2", approvedAt: "2026-09-29T23:59:59.999Z" },
  })), null);
  assert.equal(buildUnsentSalesFollowUpEmail(lead({
    outreachDelivery: { ...lead().outreachDelivery, recordedAt: "2026-09-26T00:30:00.000Z" },
  })), null);
  assert.equal(buildUnsentSalesFollowUpEmail(lead({
    followUpDraft: { ...lead().followUpDraft, savedAt: "2026-09-29T00:59:59.999Z" },
  })), null);
  assert.equal(buildUnsentSalesFollowUpEmail(lead({
    followUpDraft: { ...lead().followUpDraft, signature: "差し替え署名" },
  })), null);
  assert.equal(buildUnsentSalesFollowUpEmail(lead({
    outreachApproval: { actorId: "reviewer-1", approvedAt: "2026-09-19T23:00:00.000Z" },
    outreachRecordedAt: "2026-09-20T00:00:00.000Z",
    outreachDelivery: {
      actorId: "sender-1",
      recordedAt: "2026-09-20T00:00:00.000Z",
      channel: "EMAIL",
    },
    followUps: [{
      draft: {
        ...lead().followUpDraft,
        savedAt: "2026-09-23T00:00:00.000Z",
      },
      approval: { actorId: "reviewer-1", approvedAt: "2026-09-22T23:59:59.999Z" },
      delivery: {
        actorId: "sender-1",
        recordedAt: "2026-09-23T01:00:00.000Z",
        channel: "EMAIL",
      },
    }],
  })), null);
});
