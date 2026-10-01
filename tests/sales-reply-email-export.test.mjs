import test from "node:test";
import assert from "node:assert/strict";
import { buildUnsentSalesReplyEmail } from "../lib/sales-reply-email-export.js";

function lead(overrides = {}) {
  return {
    contact: "営業部 sales@example.com",
    optedOut: false,
    appointmentConfirmed: false,
    outreachApproved: true,
    outreachDraft: {
      subject: "住宅設備延長保証のご相談",
      body: "初回のご案内です。",
      signature: "STAR WORK OS\n営業担当",
    },
    outreachApproval: {
      actorId: "reviewer-1",
      approvedAt: "2026-09-27T00:00:00.000Z",
    },
    outreachRecordedAt: "2026-09-27T01:00:00.000Z",
    outreachDelivery: {
      actorId: "sender-1",
      recordedAt: "2026-09-27T01:00:00.000Z",
      channel: "EMAIL",
    },
    replyApproved: true,
    replyApproval: {
      actorId: "reviewer-2",
      approvedAt: "2026-09-28T02:00:00.000Z",
    },
    replyRecordedAt: null,
    replyDelivery: null,
    replyDraft: {
      subject: "Re: 資料のご希望について",
      body: "ご返信ありがとうございます。\n資料を準備します。",
      signature: "STAR WORK OS\n営業担当",
    },
    replies: [{
      channel: "EMAIL", type: "MATERIAL_REQUEST", message: "資料希望",
      actorId: "operator", receivedAt: "2026-09-28T01:00:00.000Z",
    }],
    followUps: [],
    ...overrides,
  };
}

test("builds an unsent approved safe reply for one email recipient", () => {
  const eml = buildUnsentSalesReplyEmail(lead());
  assert.ok(eml);
  assert.match(eml, /^To: sales@example\.com\r\nSubject: =\?UTF-8\?B\?/u);
  assert.match(eml, /\r\nX-Unsent: 1\r\n\r\n/u);
  const encodedBody = eml.split("\r\n\r\n")[1].replace(/\r\n/gu, "");
  assert.equal(Buffer.from(encodedBody, "base64").toString("utf8"),
    "ご返信ありがとうございます。\r\n資料を準備します。\r\n\r\nSTAR WORK OS\r\n営業担当");
});

test("supports a safe email reply after an earlier resolved reply", () => {
  const eml = buildUnsentSalesReplyEmail(lead({
    replies: [
      {
        channel: "EMAIL", type: "GENERAL_QUESTION", message: "先の質問です。",
        actorId: "operator-1", receivedAt: "2026-09-27T02:00:00.000Z",
        resolution: {
          kind: "SAFE_REPLY",
          draft: {
            subject: "Re: 先の質問について",
            body: "先の質問への回答です。",
            signature: "STAR WORK OS\n営業担当",
          },
          approval: { actorId: "reviewer-1", approvedAt: "2026-09-27T03:00:00.000Z" },
          delivery: {
            actorId: "sender-1", recordedAt: "2026-09-27T04:00:00.000Z", channel: "EMAIL",
          },
        },
      },
      {
        channel: "EMAIL", type: "GENERAL_QUESTION", message: "追加質問です。",
        actorId: "operator-2", receivedAt: "2026-09-28T01:00:00.000Z",
      },
    ],
  }));
  assert.ok(eml);
});

test("supports a safe email reply after a valid delivered follow-up", () => {
  const eml = buildUnsentSalesReplyEmail(lead({
    outreachApproval: { actorId: "reviewer-1", approvedAt: "2026-09-19T00:00:00.000Z" },
    outreachRecordedAt: "2026-09-19T01:00:00.000Z",
    outreachDelivery: {
      actorId: "sender-1", recordedAt: "2026-09-19T01:00:00.000Z", channel: "EMAIL",
    },
    followUps: [{
      draft: {
        subject: "先日のご案内について",
        body: "その後のご状況はいかがでしょうか。",
        signature: "STAR WORK OS\n営業担当",
        savedBy: "writer-1",
        savedAt: "2026-09-22T01:00:00.000Z",
      },
      approval: { actorId: "reviewer-1", approvedAt: "2026-09-22T02:00:00.000Z" },
      delivery: {
        actorId: "sender-1", recordedAt: "2026-09-22T03:00:00.000Z", channel: "EMAIL",
      },
    }],
  }));
  assert.ok(eml);
});

test("rejects missing or forged reply approval chronology", () => {
  assert.equal(buildUnsentSalesReplyEmail(lead({ replyApproval: null })), null);
  assert.equal(buildUnsentSalesReplyEmail(lead({
    replyApproval: { actorId: "reviewer-2", approvedAt: "2026-09-28T00:59:59.999Z" },
  })), null);
  assert.equal(buildUnsentSalesReplyEmail(lead({
    outreachDelivery: { ...lead().outreachDelivery, recordedAt: "2026-09-27T00:59:59.999Z" },
  })), null);
  assert.equal(buildUnsentSalesReplyEmail(lead({
    outreachRecordedAt: "2026-09-26T23:59:59.999Z",
    outreachDelivery: {
      ...lead().outreachDelivery,
      recordedAt: "2026-09-26T23:59:59.999Z",
    },
  })), null);
  assert.equal(buildUnsentSalesReplyEmail(lead({
    replies: [{ ...lead().replies[0], receivedAt: "2026-09-27T00:59:59.999Z" }],
  })), null);
  assert.equal(buildUnsentSalesReplyEmail(lead({
    replyDelivery: {
      actorId: "sender-2", recordedAt: "2026-09-28T03:00:00.000Z", channel: "EMAIL",
    },
  })), null);
});

test("rejects altered resolved reply history", () => {
  const priorReply = {
    channel: "EMAIL", type: "GENERAL_QUESTION", message: "先の質問です。",
    actorId: "operator-1", receivedAt: "2026-09-27T02:00:00.000Z",
    resolution: {
      kind: "SAFE_REPLY",
      draft: {
        subject: "Re: 先の質問について",
        body: "先の質問への回答です。",
        signature: "STAR WORK OS\n営業担当",
      },
      approval: { actorId: "reviewer-1", approvedAt: "2026-09-27T03:00:00.000Z" },
      delivery: {
        actorId: "sender-1", recordedAt: "2026-09-27T04:00:00.000Z", channel: "EMAIL",
      },
    },
  };
  const currentReply = lead().replies[0];
  assert.equal(buildUnsentSalesReplyEmail(lead({
    replies: [{ ...priorReply, resolution: { ...priorReply.resolution, approval: null } }, currentReply],
  })), null);
  assert.equal(buildUnsentSalesReplyEmail(lead({
    replies: [{
      ...priorReply,
      resolution: {
        ...priorReply.resolution,
        delivery: { ...priorReply.resolution.delivery, channel: "LINE" },
      },
    }, currentReply],
  })), null);
  assert.equal(buildUnsentSalesReplyEmail(lead({
    replies: [priorReply, { ...currentReply, receivedAt: "2026-09-27T03:59:59.999Z" }],
  })), null);
});

test("fails closed for LINE, unsafe, unapproved, sent, suppressed, or ambiguous replies", () => {
  assert.equal(buildUnsentSalesReplyEmail(lead({ replies: [{ channel: "LINE", type: "MATERIAL_REQUEST" }] })), null);
  assert.equal(buildUnsentSalesReplyEmail(lead({ replies: [{ channel: "EMAIL", type: "CONTRACT" }] })), null);
  assert.equal(buildUnsentSalesReplyEmail(lead({ replyApproved: false })), null);
  assert.equal(buildUnsentSalesReplyEmail(lead({ replyRecordedAt: "2026-09-28T02:00:00.000Z" })), null);
  assert.equal(buildUnsentSalesReplyEmail(lead({ optedOut: true })), null);
  assert.equal(buildUnsentSalesReplyEmail(lead({
    optedOut: false,
    replies: [
      ...lead().replies,
      { channel: "EMAIL", type: "OPT_OUT", receivedAt: "2026-09-28T02:00:00.000Z" },
    ],
  })), null);
  assert.equal(buildUnsentSalesReplyEmail(lead({ contact: "a@example.com b@example.com" })), null);
});

test("rejects header injection and incomplete or oversized drafts", () => {
  assert.equal(buildUnsentSalesReplyEmail(lead({
    replyDraft: { ...lead().replyDraft, subject: "安全\r\nBcc: evil@example.com" },
  })), null);
  assert.equal(buildUnsentSalesReplyEmail(lead({
    replyDraft: { ...lead().replyDraft, signature: "" },
  })), null);
  assert.equal(buildUnsentSalesReplyEmail(lead({
    replyDraft: { ...lead().replyDraft, body: "a".repeat(4_001) },
  })), null);
});
