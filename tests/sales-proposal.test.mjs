import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSalesProposal } from "../lib/sales-proposal.js";

function validLead(overrides = {}) {
  return {
    id: "lead-1",
    companyName: "テスト工務店",
    proposalFit: "引き渡し後の顧客支援を強化できる可能性",
    contact: "secret@example.com",
    researchNotes: "社内限定の調査メモ",
    researchComplete: true,
    researchAudit: {
      actorId: "researcher-1",
      completedAt: "2026-10-01T00:00:00.000Z",
      sources: ["https://example.com/company"],
    },
    optedOut: false,
    ...overrides,
  };
}

test("builds a minimal immutable proposal without internal sales details", () => {
  const proposal = buildSalesProposal(validLead());
  assert.deepEqual(proposal, {
    id: "lead-1",
    companyName: "テスト工務店",
    proposalFit: "引き渡し後の顧客支援を強化できる可能性",
  });
  assert.ok(Object.isFrozen(proposal));
  assert.equal("contact" in proposal, false);
  assert.equal("researchNotes" in proposal, false);
  assert.equal("researchAudit" in proposal, false);
});

test("requires a valid audited research completion before proposal generation", () => {
  assert.equal(buildSalesProposal(validLead({ researchComplete: false, researchAudit: null })), null);
  assert.equal(buildSalesProposal(validLead({ researchAudit: null })), null);
  assert.equal(buildSalesProposal(validLead({
    researchAudit: { ...validLead().researchAudit, actorId: "" },
  })), null);
  assert.equal(buildSalesProposal(validLead({
    researchAudit: { ...validLead().researchAudit, completedAt: "invalid" },
  })), null);
  assert.equal(buildSalesProposal(validLead({
    researchAudit: { ...validLead().researchAudit, sources: [] },
  })), null);
  assert.equal(buildSalesProposal(validLead({
    researchAudit: { ...validLead().researchAudit, sources: ["http://example.com/company"] },
  })), null);
  assert.equal(buildSalesProposal(validLead({
    researchAudit: {
      ...validLead().researchAudit,
      sources: ["https://example.com/company", "https://example.com/company"],
    },
  })), null);
});

test("requires bounded and safe research notes before proposal generation", () => {
  assert.equal(buildSalesProposal(validLead({ researchNotes: "" })), null);
  assert.equal(buildSalesProposal(validLead({ researchNotes: "x".repeat(2_001) })), null);
  assert.equal(buildSalesProposal(validLead({ researchNotes: "確認済み\0差し替え" })), null);
});

test("rejects suppressed, incomplete, oversized, and hostile proposal input", () => {
  assert.equal(buildSalesProposal(validLead({ optedOut: true })), null);
  assert.equal(buildSalesProposal(validLead({
    optedOut: false, replies: [{ type: "OPT_OUT" }],
  })), null);
  assert.equal(buildSalesProposal(validLead({
    optedOut: false, replies: [{}],
  })), null);
  assert.equal(buildSalesProposal(validLead({ proposalFit: "" })), null);
  assert.equal(buildSalesProposal(validLead({ companyName: `企業${"x".repeat(160)}` })), null);
  assert.equal(buildSalesProposal(new Proxy({}, { get() { throw new Error("blocked"); } })), null);
});

test("proposal page authenticates before one RLS-scoped row read and has no external send path", () => {
  const page = readFileSync(new URL("../app/sales/proposals/[id]/page.tsx", import.meta.url), "utf8");
  assert.ok(page.indexOf("supabase.auth.getUser()") < page.indexOf('.from("tasks")'));
  assert.ok(page.includes('.select("id, content")'));
  assert.ok(page.includes('.eq("id", id)'));
  assert.doesNotMatch(page, /service_role|\.insert\(|\.update\(|\.delete\(|fetch\(|openai|lead\.contact|lead\.researchNotes/ui);
});

test("proposal copy does not promise price, coverage, term, or contract conditions", () => {
  const page = readFileSync(new URL("../app/sales/proposals/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /価格、保証範囲、保証期間、契約条件を確約するものではありません/u);
  assert.match(page, /人間による承認後/u);
});

test("proposal index explains audited research readiness", () => {
  const page = readFileSync(new URL("../app/sales/proposals/page.tsx", import.meta.url), "utf8");
  assert.match(page, /監査付き企業調査が完了した案件/u);
  assert.match(page, /監査付き企業調査が完了し、提案理由が登録された企業はありません/u);
});
