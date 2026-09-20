import { NextResponse } from "next/server";
import {
  CODEX_GATEWAY_MAX_BODY_BYTES,
  CODEX_GATEWAY_MAX_ISSUES_TO_SCAN,
  CODEX_GITHUB_API_VERSION,
  buildCodexDelegationComment,
  buildCodexIssue,
  codexIssueMarker,
  findExistingCodexIssue,
  hasCodexDelegationComment,
  parseRepository,
  validateCodexGatewayPayload,
} from "@/lib/codex-cloud-github";
import { hasMinimumTokenLength, safeTokenEquals } from "@/lib/external-agent-dispatch";
import { readJsonBodyWithLimit } from "@/lib/request-body";

export const runtime = "nodejs";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_TIMEOUT_MS = 10_000;

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

  const parsedBody = await readJsonBodyWithLimit(request, CODEX_GATEWAY_MAX_BODY_BYTES);
  if (!parsedBody.ok) return NextResponse.json({ ok: false, error: "CODEX_GATEWAY_PAYLOAD_TOO_LARGE" }, { status: 413 });

  const payload = parsedBody.value;
  const validationError = validateCodexGatewayPayload(payload);
  if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });

  const repository = parseRepository(payload.job.repository);
  if (!repository) return NextResponse.json({ ok: false, error: "UNSUPPORTED_CODEX_GATEWAY_JOB" }, { status: 400 });

  const issueContract = buildCodexIssue(payload);
  const marker = codexIssueMarker(payload.job.id);
  const repoApi = `${GITHUB_API_BASE}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;

  let issue;
  try {
    const listResponse = await githubRequest(
      `${repoApi}/issues?state=all&sort=created&direction=desc&per_page=${CODEX_GATEWAY_MAX_ISSUES_TO_SCAN}`,
      githubToken,
    );
    if (!listResponse.ok) return NextResponse.json({ ok: false, error: "CODEX_GITHUB_ISSUE_LOOKUP_FAILED" }, { status: 502 });
    const issues = await listResponse.json();
    issue = findExistingCodexIssue(issues, marker);

    if (!issue) {
      const createResponse = await githubRequest(`${repoApi}/issues`, githubToken, {
        method: "POST",
        body: JSON.stringify({ title: issueContract.title, body: issueContract.body }),
      });
      if (!createResponse.ok) return NextResponse.json({ ok: false, error: "CODEX_GITHUB_ISSUE_CREATE_FAILED" }, { status: 502 });
      issue = await createResponse.json();
    }

    if (!Number.isInteger(issue?.number) || issue.number < 1) {
      return NextResponse.json({ ok: false, error: "CODEX_GITHUB_INVALID_ISSUE_RESPONSE" }, { status: 502 });
    }

    const commentsResponse = await githubRequest(`${repoApi}/issues/${issue.number}/comments?per_page=100`, githubToken);
    if (!commentsResponse.ok) return NextResponse.json({ ok: false, error: "CODEX_GITHUB_COMMENT_LOOKUP_FAILED" }, { status: 502 });
    const comments = await commentsResponse.json();

    if (!hasCodexDelegationComment(comments, payload.job.id)) {
      const commentResponse = await githubRequest(`${repoApi}/issues/${issue.number}/comments`, githubToken, {
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
