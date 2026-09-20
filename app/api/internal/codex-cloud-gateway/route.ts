import { NextResponse } from "next/server";
import {
  CODEX_GATEWAY_MAX_BODY_BYTES,
  CODEX_GATEWAY_MAX_ISSUES_TO_SCAN,
  CODEX_GITHUB_API_VERSION,
  buildCodexDelegationComment,
  buildCodexIssue,
  codexIssueContractDigest,
  findExistingCodexIssue,
  hasCodexDelegationComment,
  isTrustedCodexIssue,
  parseRepository,
  validateCodexGatewayPayload,
} from "@/lib/codex-cloud-github";
import { hasMinimumTokenLength, safeTokenEquals } from "@/lib/external-agent-dispatch";
import { readJsonBodyWithLimit } from "@/lib/request-body";
import { createServiceClient } from "@/utils/supabase/service";

export const runtime = "nodejs";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_TIMEOUT_MS = 10_000;

type CodexGatewayPayload = {
  job: {
    id: string;
    provider: string;
    capability: string;
    repository: string;
    baseBranch: string;
  };
  task: {
    title: string;
    content?: string | null;
    priority?: string | null;
    dueDate?: string | null;
  };
  executionPolicy?: {
    protectedActionsRequireHumanApproval?: string[];
  };
};

type DispatchClaim = {
  claimed?: boolean;
  issue_number?: number | null;
  issue_url?: string | null;
};

function githubHeaders(token: string) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": CODEX_GITHUB_API_VERSION,
    "user-agent": "star-work-os-codex-gateway",
  };
}

async function githubRequest(url: string, token: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      headers: { ...githubHeaders(token), ...(init.headers ?? {}) },
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const gatewayToken = process.env.EXTERNAL_AGENT_GATEWAY_TOKEN;
  if (!hasMinimumTokenLength(gatewayToken) || !safeTokenEquals(gatewayToken, suppliedToken)) {
    return NextResponse.json({ ok: false, error: "CODEX_GATEWAY_AUTHENTICATION_REQUIRED" }, { status: 401 });
  }

  const githubToken = process.env.CODEX_GITHUB_TOKEN;
  if (!hasMinimumTokenLength(githubToken, 20)) {
    return NextResponse.json({ ok: false, error: "CODEX_GATEWAY_NOT_CONFIGURED" }, { status: 503 });
  }
  const githubTokenValue = githubToken as string;

  const parsedBody = await readJsonBodyWithLimit(request, CODEX_GATEWAY_MAX_BODY_BYTES);
  if (!parsedBody.ok) return NextResponse.json({ ok: false, error: "CODEX_GATEWAY_PAYLOAD_TOO_LARGE" }, { status: 413 });

  const rawPayload = parsedBody.value;
  const validationError = validateCodexGatewayPayload(rawPayload);
  if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
  const payload = rawPayload as CodexGatewayPayload;

  const repository = parseRepository(payload.job.repository);
  if (!repository) return NextResponse.json({ ok: false, error: "UNSUPPORTED_CODEX_GATEWAY_JOB" }, { status: 400 });

  const issueContract = buildCodexIssue(payload);
  const contractDigest = codexIssueContractDigest(issueContract);
  const repoApi = `${GITHUB_API_BASE}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
  const supabase = createServiceClient();

  const { data: claimData, error: claimError } = await supabase.rpc("claim_codex_gateway_dispatch", {
    p_job_id: payload.job.id,
    p_contract_digest: contractDigest,
  });
  if (claimError) return NextResponse.json({ ok: false, error: "CODEX_GATEWAY_CLAIM_FAILED" }, { status: 409 });
  const claim = (claimData ?? {}) as DispatchClaim;

  let actorLogin: string;
  let issue: {
    number: number;
    title?: string;
    body?: string;
    html_url?: string;
    user?: { login?: string };
    pull_request?: unknown;
  };

  try {
    const actorResponse = await githubRequest(`${GITHUB_API_BASE}/user`, githubTokenValue);
    if (!actorResponse.ok) return NextResponse.json({ ok: false, error: "CODEX_GITHUB_IDENTITY_FAILED" }, { status: 502 });
    const actor = await actorResponse.json();
    if (typeof actor?.login !== "string" || !actor.login) {
      return NextResponse.json({ ok: false, error: "CODEX_GITHUB_IDENTITY_FAILED" }, { status: 502 });
    }
    actorLogin = actor.login;

    if (Number.isInteger(claim.issue_number) && (claim.issue_number ?? 0) > 0) {
      const issueResponse = await githubRequest(`${repoApi}/issues/${claim.issue_number}`, githubTokenValue);
      if (!issueResponse.ok) return NextResponse.json({ ok: false, error: "CODEX_GITHUB_ISSUE_LOOKUP_FAILED" }, { status: 502 });
      issue = await issueResponse.json();
      if (!isTrustedCodexIssue(issue, issueContract, actorLogin)) {
        return NextResponse.json({ ok: false, error: "CODEX_GITHUB_ISSUE_IDENTITY_MISMATCH" }, { status: 409 });
      }
    } else {
      if (!claim.claimed) {
        return NextResponse.json({ ok: false, error: "CODEX_GATEWAY_DISPATCH_IN_PROGRESS" }, { status: 409 });
      }

      const listResponse = await githubRequest(
        `${repoApi}/issues?state=all&sort=created&direction=desc&per_page=${CODEX_GATEWAY_MAX_ISSUES_TO_SCAN}`,
        githubTokenValue,
      );
      if (!listResponse.ok) return NextResponse.json({ ok: false, error: "CODEX_GITHUB_ISSUE_LOOKUP_FAILED" }, { status: 502 });
      const issues = await listResponse.json();
      issue = findExistingCodexIssue(issues, issueContract, actorLogin);

      if (!issue) {
        const createResponse = await githubRequest(`${repoApi}/issues`, githubTokenValue, {
          method: "POST",
          body: JSON.stringify({ title: issueContract.title, body: issueContract.body }),
        });
        if (!createResponse.ok) return NextResponse.json({ ok: false, error: "CODEX_GITHUB_ISSUE_CREATE_FAILED" }, { status: 502 });
        issue = await createResponse.json();
      }

      if (!isTrustedCodexIssue(issue, issueContract, actorLogin) || !Number.isInteger(issue.number) || issue.number < 1 || typeof issue.html_url !== "string") {
        return NextResponse.json({ ok: false, error: "CODEX_GITHUB_INVALID_ISSUE_RESPONSE" }, { status: 502 });
      }

      const { error: recordError } = await supabase.rpc("record_codex_gateway_issue", {
        p_job_id: payload.job.id,
        p_contract_digest: contractDigest,
        p_issue_number: issue.number,
        p_issue_url: issue.html_url,
      });
      if (recordError) return NextResponse.json({ ok: false, error: "CODEX_GATEWAY_ISSUE_RECORD_FAILED" }, { status: 409 });
    }

    if (!Number.isInteger(issue.number) || issue.number < 1) {
      return NextResponse.json({ ok: false, error: "CODEX_GITHUB_INVALID_ISSUE_RESPONSE" }, { status: 502 });
    }

    const commentsResponse = await githubRequest(`${repoApi}/issues/${issue.number}/comments?per_page=100`, githubTokenValue);
    if (!commentsResponse.ok) return NextResponse.json({ ok: false, error: "CODEX_GITHUB_COMMENT_LOOKUP_FAILED" }, { status: 502 });
    const comments = await commentsResponse.json();

    if (!hasCodexDelegationComment(comments, payload.job.id)) {
      const commentResponse = await githubRequest(`${repoApi}/issues/${issue.number}/comments`, githubTokenValue, {
        method: "POST",
        body: JSON.stringify({ body: buildCodexDelegationComment(payload.job.repository, payload.job.id) }),
      });
      if (!commentResponse.ok) return NextResponse.json({ ok: false, error: "CODEX_GITHUB_DELEGATION_FAILED" }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "CODEX_GITHUB_UNAVAILABLE" }, { status: 502 });
  }

  return NextResponse.json({ externalJobId: `github-issue:${issue.number}` }, { status: 202 });
}
