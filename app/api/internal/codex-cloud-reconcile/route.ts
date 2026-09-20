import { NextResponse } from "next/server";
import {
  CODEX_RECONCILE_MAX_BODY_BYTES,
  extractRepositoryPullRequest,
  findFinalCodexComment,
  parseGithubIssueExternalJobId,
  summarizeCodexResult,
  validateReconcileRequest,
} from "@/lib/codex-cloud-reconciliation";
import {
  CODEX_GITHUB_API_VERSION,
  codexIssueContractDigest,
  parseRepository,
} from "@/lib/codex-cloud-github";
import { hasMinimumTokenLength, isAuthorizedDispatchTrigger } from "@/lib/external-agent-dispatch";
import { readJsonBodyWithLimit } from "@/lib/request-body";
import { createServiceClient } from "@/utils/supabase/service";

export const runtime = "nodejs";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_TIMEOUT_MS = 10_000;

function githubHeaders(token: string) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": CODEX_GITHUB_API_VERSION,
    "user-agent": "star-work-os-codex-reconciler",
  };
}

async function githubRequest(url: string, token: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: githubHeaders(token),
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
  const triggerToken = process.env.EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN;
  if (!hasMinimumTokenLength(triggerToken) || !isAuthorizedDispatchTrigger(process.env, suppliedToken)) {
    return NextResponse.json({ ok: false, error: "RECONCILE_AUTHENTICATION_REQUIRED" }, { status: 401 });
  }

  const githubToken = process.env.CODEX_GITHUB_TOKEN;
  if (!hasMinimumTokenLength(githubToken, 20)) {
    return NextResponse.json({ ok: false, error: "CODEX_RECONCILE_NOT_CONFIGURED" }, { status: 503 });
  }
  const githubTokenValue = githubToken as string;

  const parsedBody = await readJsonBodyWithLimit(request, CODEX_RECONCILE_MAX_BODY_BYTES);
  if (!parsedBody.ok) return NextResponse.json({ ok: false, error: "RECONCILE_PAYLOAD_TOO_LARGE" }, { status: 413 });
  const validationError = validateReconcileRequest(parsedBody.value);
  if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
  const jobId = (parsedBody.value as { jobId: string }).jobId;

  const supabase = createServiceClient();
  const { data: job, error: jobError } = await supabase
    .from("external_agent_jobs")
    .select("id, task_id, provider, capability, repository, base_branch, status, external_job_id, pull_request_number, pull_request_url")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) return NextResponse.json({ ok: false, error: "RECONCILE_JOB_LOOKUP_FAILED" }, { status: 500 });
  if (!job) return NextResponse.json({ ok: false, error: "RECONCILE_JOB_NOT_FOUND" }, { status: 404 });
  if (job.status === "WAITING_HUMAN_APPROVAL") return NextResponse.json({ ok: true, state: "WAITING_HUMAN_APPROVAL", job });
  if (job.status !== "RUNNING") return NextResponse.json({ ok: false, error: "RECONCILE_JOB_NOT_RUNNING" }, { status: 409 });
  if (job.provider !== "openai_codex" || job.capability !== "software_development") {
    return NextResponse.json({ ok: false, error: "RECONCILE_UNSUPPORTED_JOB" }, { status: 409 });
  }

  const issueNumber = parseGithubIssueExternalJobId(job.external_job_id);
  const repository = parseRepository(job.repository);
  if (!issueNumber || !repository) return NextResponse.json({ ok: false, error: "RECONCILE_INVALID_EXTERNAL_JOB" }, { status: 409 });

  const { data: dispatchRecord, error: dispatchRecordError } = await supabase
    .from("codex_gateway_dispatches")
    .select("job_id, contract_digest, issue_number, issue_url, delegated_at")
    .eq("job_id", job.id)
    .maybeSingle();
  if (dispatchRecordError) return NextResponse.json({ ok: false, error: "RECONCILE_DISPATCH_LOOKUP_FAILED" }, { status: 500 });
  if (
    !dispatchRecord ||
    dispatchRecord.delegated_at === null ||
    dispatchRecord.issue_number !== issueNumber ||
    typeof dispatchRecord.contract_digest !== "string"
  ) {
    return NextResponse.json({ ok: false, error: "RECONCILE_DISPATCH_IDENTITY_MISMATCH" }, { status: 409 });
  }

  const repoApi = `${GITHUB_API_BASE}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;

  try {
    const actorResponse = await githubRequest(`${GITHUB_API_BASE}/user`, githubTokenValue);
    if (!actorResponse.ok) return NextResponse.json({ ok: false, error: "RECONCILE_GITHUB_IDENTITY_FAILED" }, { status: 502 });
    const actor = await actorResponse.json();
    if (typeof actor?.login !== "string" || !actor.login) {
      return NextResponse.json({ ok: false, error: "RECONCILE_GITHUB_IDENTITY_FAILED" }, { status: 502 });
    }

    const issueResponse = await githubRequest(`${repoApi}/issues/${issueNumber}`, githubTokenValue);
    if (!issueResponse.ok) return NextResponse.json({ ok: false, error: "RECONCILE_ISSUE_LOOKUP_FAILED" }, { status: 502 });
    const issue = await issueResponse.json();
    const issueDigest = (
      typeof issue?.title === "string" && typeof issue?.body === "string"
        ? codexIssueContractDigest({ title: issue.title, body: issue.body })
        : null
    );
    if (
      issue?.pull_request ||
      issue?.user?.login !== actor.login ||
      issueDigest !== dispatchRecord.contract_digest ||
      issue?.html_url !== dispatchRecord.issue_url
    ) {
      return NextResponse.json({ ok: false, error: "RECONCILE_ISSUE_IDENTITY_MISMATCH" }, { status: 409 });
    }

    const commentsResponse = await githubRequest(`${repoApi}/issues/${issueNumber}/comments?per_page=100`, githubTokenValue);
    if (!commentsResponse.ok) return NextResponse.json({ ok: false, error: "RECONCILE_COMMENT_LOOKUP_FAILED" }, { status: 502 });
    const comments = await commentsResponse.json();
    const finalComment = findFinalCodexComment(comments);
    if (!finalComment) return NextResponse.json({ ok: true, state: "RUNNING", jobId: job.id }, { status: 202 });

    const summary = summarizeCodexResult(finalComment.body);
    const prReference = extractRepositoryPullRequest(finalComment.body, job.repository);
    if (!prReference) {
      return NextResponse.json({ ok: true, state: "RUNNING", jobId: job.id, reason: "WAITING_FOR_REVIEWABLE_PULL_REQUEST" }, { status: 202 });
    }

    let branchName: string | null = null;
    let commitSha: string | null = null;
    let pullRequestNumber: number | null = null;
    let pullRequestUrl: string | null = null;

    const prResponse = await githubRequest(`${repoApi}/pulls/${prReference.number}`, githubTokenValue);
    if (!prResponse.ok) return NextResponse.json({ ok: false, error: "RECONCILE_PULL_REQUEST_LOOKUP_FAILED" }, { status: 502 });
    const pr = await prResponse.json();
    if (
      pr?.html_url?.toLowerCase() !== prReference.url.toLowerCase() ||
      pr?.base?.ref !== job.base_branch ||
      pr?.state !== "open" ||
      pr?.head?.repo?.full_name?.toLowerCase() !== job.repository.toLowerCase() ||
      typeof pr?.head?.ref !== "string" ||
      !/^[0-9a-f]{40}$/i.test(pr?.head?.sha ?? "")
    ) {
      return NextResponse.json({ ok: false, error: "RECONCILE_PULL_REQUEST_IDENTITY_MISMATCH" }, { status: 409 });
    }
    branchName = pr.head.ref;
    commitSha = pr.head.sha;
    pullRequestNumber = pr.number;
    pullRequestUrl = pr.html_url;

    const { data: updated, error: updateError } = await supabase.rpc("update_external_agent_job_result", {
      p_job_id: job.id,
      p_status: "WAITING_HUMAN_APPROVAL",
      p_external_job_id: job.external_job_id,
      p_branch_name: branchName,
      p_commit_sha: commitSha,
      p_pull_request_number: pullRequestNumber,
      p_pull_request_url: pullRequestUrl,
      p_result_summary: summary || "Codex Cloud task completed and is ready for human review.",
    });
    if (updateError) return NextResponse.json({ ok: false, error: "RECONCILE_STATE_UPDATE_REJECTED" }, { status: 409 });

    return NextResponse.json({ ok: true, state: "WAITING_HUMAN_APPROVAL", job: updated });
  } catch {
    return NextResponse.json({ ok: false, error: "RECONCILE_GITHUB_UNAVAILABLE" }, { status: 502 });
  }
}
