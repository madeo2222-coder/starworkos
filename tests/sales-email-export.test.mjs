import test from "node:test";
import assert from "node:assert/strict";
import { buildUnsentSalesEmail, salesEmailRecipient } from "../lib/sales-email-export.js";

function lead(overrides = {}) {
  return {
    contact: "営業部 sales@example.com",
    optedOut: false,
    appointmentConfirmed: false,
    outreachApproved: true,
    researchAudit: {
      sources: ["https://example.com/company"],
      actorId: "researcher-1",
      completedAt: "2026-09-27T23:00:00.000Z",
    },
    outreachApproval: {
      actorId: "reviewer-1",
      approvedAt: "2026-09-28T00:00:00.000Z",
    },
    outreachRecordedAt: null,
    outreachDelivery: null,
    outreachDraft: {
      subject: "住宅設備延長保証のご相談",
      body: "ご担当者様\n\n本文です。",
      signature: "STAR WORK OS\n営業担当",
    },
    replies: [],
    followUps: [],
    ...overrides,
  };
}

test("builds an unsent RFC 822 draft without sending or recording delivery", () => {
  const eml = buildUnsentSalesEmail(lead());
  assert.ok(eml);
  assert.match(eml, /^To: sales@example\.com\r\nSubject: =\?UTF-8\?B\?/u);
  assert.match(eml, /\r\nX-Unsent: 1\r\n\r\n/u);
  const encodedBody = eml.split("\r\n\r\n")[1].replace(/\r\n/gu, "");
  assert.equal(Buffer.from(encodedBody, "base64").toString("utf8"),
    "ご担当者様\r\n\r\n本文です。\r\n\r\nSTAR WORK OS\r\n営業担当");
});

test("extracts exactly one safe mailbox from a bounded contact", () => {
  assert.equal(salesEmailRecipient("営業部 sales@example.com"), "sales@example.com");
  assert.equal(salesEmailRecipient("sales@example.com / boss@example.com"), null);
  assert.equal(salesEmailRecipient("sales@example.com\r\nBcc: evil@example.com"), null);
  assert.equal(salesEmailRecipient("not-an-email"), null);
  assert.equal(salesEmailRecipient(".sales@example.com"), null);
});

test("fails closed unless the initial outreach is approved and still unsent", () => {
  assert.equal(buildUnsentSalesEmail(lead({ outreachApproved: false })), null);
  assert.equal(buildUnsentSalesEmail(lead({ outreachRecordedAt: "2026-09-28T00:00:00.000Z" })), null);
  assert.equal(buildUnsentSalesEmail(lead({ optedOut: true })), null);
  assert.equal(buildUnsentSalesEmail(lead({ replies: [{}] })), null);
  assert.equal(buildUnsentSalesEmail(lead({ followUps: [{}] })), null);
  assert.equal(buildUnsentSalesEmail(lead({ contact: "a@example.com b@example.com" })), null);
});

test("rejects missing or forged initial outreach approval chronology", () => {
  assert.equal(buildUnsentSalesEmail(lead({ outreachApproval: null })), null);
  assert.equal(buildUnsentSalesEmail(lead({
    outreachApproval: { actorId: "", approvedAt: "2026-09-28T00:00:00.000Z" },
  })), null);
  assert.equal(buildUnsentSalesEmail(lead({
    outreachApproval: { actorId: "reviewer-1", approvedAt: "invalid" },
  })), null);
  assert.equal(buildUnsentSalesEmail(lead({
    outreachApproval: { actorId: "reviewer-1", approvedAt: "2026-09-27T22:59:59.999Z" },
  })), null);
  assert.equal(buildUnsentSalesEmail(lead({
    researchAudit: { ...lead().researchAudit, sources: [] },
  })), null);
  assert.equal(buildUnsentSalesEmail(lead({
    outreachDelivery: {
      actorId: "sender-1",
      recordedAt: "2026-09-28T01:00:00.000Z",
      channel: "EMAIL",
    },
  })), null);
});

test("rejects header injection and incomplete or oversized drafts", () => {
  assert.equal(buildUnsentSalesEmail(lead({
    outreachDraft: { ...lead().outreachDraft, subject: "安全\r\nBcc: evil@example.com" },
  })), null);
  assert.equal(buildUnsentSalesEmail(lead({
    outreachDraft: { ...lead().outreachDraft, signature: "" },
  })), null);
  assert.equal(buildUnsentSalesEmail(lead({
    outreachDraft: { ...lead().outreachDraft, body: "a".repeat(4_001) },
  })), null);
});

test("folds long Unicode subjects into bounded MIME encoded words", () => {
  const eml = buildUnsentSalesEmail(lead({
    outreachDraft: { ...lead().outreachDraft, subject: "営業のご相談".repeat(20) },
  }));
  assert.ok(eml);
  const subjectLines = eml.split("\r\n").filter((line) => line.startsWith("Subject:") || line.startsWith(" =?"));
  assert.ok(subjectLines.length > 1);
  assert.ok(subjectLines.every((line) => line.length <= 80));
});
