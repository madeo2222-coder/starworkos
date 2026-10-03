import { NextResponse } from "next/server";
import {
  AGENTS_API_MAX_RESULT_BYTES,
  agentsApiConfig,
  parseAgentsSessionExternalJobId,
  selectAgentsResultArtifact,
  selectCompletedRootTurn,
  validateAgentsResult,
} from "@/lib/agents-api-codex";
import { publishAgentsResultToGithub } from "@/lib/agents-api-github-publisher";
import { hasMinimumTokenLength, isAuthorizedDispatchTrigger } from "@/lib/external-agent-dispatch";
import { readJsonBodyWithLimit } from "@/lib/request-body";
import { createServiceClient } from "@/utils/supabase/service";

export const runtime = "nodejs";

const OPENAI_API_BASE = "https://api.openai.com/v1";
const MAX_BODY_BYTES = 8 * 1024;
const TIMEOUT_MS = 15_000;

function openAIHeaders(apiKey: string) {
  return { authorization: `Bearer ${apiKey}`, "openai-beta": "agents=v1" };
}

async function request(url: string, apiKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { headers: openAIHeaders(apiKey), signal: controller.signal, cache: "no-store", redirect: "error" });
  } finally {
    clearTimeout(timeout);
  }
}

async function json(response: Response) {
  try { return await response.json(); } catch { return null; }
}

async function boundedText(response: Response, maximumBytes: number) {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8");
}

export async function POST(requestObject: Request) {
  const suppliedToken = requestObject.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!isAuthorizedDispatchTrigger(process.env, suppliedToken)) {
    return NextResponse.json({ ok: false, error: "AGENTS_RECONCILE_AUTHENTICATION_REQUIRED" }, { status: 401 });
  }

  const config = agentsApiConfig();
  if (!config.ok) return NextResponse.json({ ok: false, error: config.error }, { status: 503 });
  const githubToken = process.env.CODEX_GITHUB_TOKEN;
  if (!hasMinimumTokenLength(githubToken, 20)) {
    return NextResponse.json({ ok: false, error: "AGENTS_RECONCILE_GITHUB_NOT_CONFIGURED" }, { status: 503 });
  }

  const parsedBody = await readJsonBodyWithLimit(requestObject, MAX_BODY_BYTES);
  if (!parsedBody.ok) return NextResponse.json({ ok: false, error: "AGENTS_RECONCILE_PAYLOAD_TOO_LARGE" }, { status: 413 });
  const jobId = (parsedBody.value as { jobId?: unknown })?.jobId;
  if (typeof jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    return NextResponse.json({ ok: false, error: "INVALID_AGENTS_RECONCILE_REQUEST" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: job, error: jobError } = await supabase
    .from("external_agent_jobs")
    .select("id, provider, capability, repository, base_branch, status, external_job_id, task_snapshot, branch_name, commit_sha, pull_request_number, pull_request_url")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) return NextResponse.json({ ok: false, error: "AGENTS_RECONCILE_JOB_LOOKUP_FAILED" }, { status: 500 });
  if (!job) return NextResponse.json({ ok: false, error: "AGENTS_RECONCILE_JOB_NOT_FOUND" }, { status: 404 });
  if (job.status === "WAITING_HUMAN_APPROVAL") return NextResponse.json({ ok: true, state: "WAITING_HUMAN_APPROVAL", job });
  if (job.status !== "RUNNING" || job.provider !== "openai_codex" || job.capability !== "software_development") {
    return NextResponse.json({ ok: false, error: "AGENTS_RECONCILE_JOB_STATE_MISMATCH" }, { status: 409 });
  }

  const sessionId = parseAgentsSessionExternalJobId(job.external_job_id);
  if (!sessionId) return NextResponse.json({ ok: false, error: "AGENTS_RECONCILE_INVALID_SESSION_ID" }, { status: 409 });
  const task = job.task_snapshot;
  if (!task || typeof task !== "object" || Array.isArray(task) || typeof task.title !== "string" || !task.title.trim()) {
    return NextResponse.json({ ok: false, error: "AGENTS_RECONCILE_TASK_SNAPSHOT_INVALID" }, { status: 409 });
  }

  try {
    const sessionResponse = await request(`${OPENAI_API_BASE}/agents/sessions/${encodeURIComponent(sessionId)}`, config.apiKey);
    if (!sessionResponse.ok) return NextResponse.json({ ok: false, error: "AGENTS_RECONCILE_SESSION_LOOKUP_FAILED" }, { status: 502 });
    const session = await json(sessionResponse);
    if (session?.status === "failed") return NextResponse.json({ ok: false, error: "AGENTS_SESSION_FAILED" }, { status: 409 });
    if (session?.status === "requires_action") return NextResponse.json({ ok: false, error: "AGENTS_SESSION_REQUIRES_ACTION" }, { status: 409 });
    if (session?.status !== "idle") return NextResponse.json({ ok: true, state: "RUNNING", jobId: job.id }, { status: 202 });

    const turnsResponse = await request(`${OPENAI_API_BASE}/agents/sessions/${encodeURIComponent(sessionId)}/turns?order=desc&limit=20`, config.apiKey);
    if (!turnsResponse.ok) return NextResponse.json({ ok: false, error: "AGENTS_RECONCILE_TURNS_LOOKUP_FAILED" }, { status: 502 });
    const turns = await json(turnsResponse);
    const rootTurns = Array.isArray(turns?.data) ? turns.data.filter((turn: { subagent_id?: string | null }) => turn?.subagent_id == null) : [];
    if (rootTurns.some((turn: { status?: string }) => turn?.status === "failed" || turn?.status === "cancelled")) {
      return NextResponse.json({ ok: false, error: "AGENTS_ROOT_TURN_FAILED" }, { status: 409 });
    }
    const completedTurn = selectCompletedRootTurn(rootTurns);
    if (!completedTurn) return NextResponse.json({ ok: true, state: "RUNNING", jobId: job.id }, { status: 202 });

    const artifactsResponse = await request(`${OPENAI_API_BASE}/agents/sessions/${encodeURIComponent(sessionId)}/artifacts?order=desc&limit=100`, config.apiKey);
    if (!artifactsResponse.ok) return NextResponse.json({ ok: false, error: "AGENTS_RECONCILE_ARTIFACT_LIST_FAILED" }, { status: 502 });
    const artifacts = await json(artifactsResponse);
    const artifact = selectAgentsResultArtifact(artifacts?.data, completedTurn.id);
    if (!artifact) return NextResponse.json({ ok: false, error: "AGENTS_RESULT_ARTIFACT_MISSING" }, { status: 409 });

    const artifactResponse = await request(
      `${OPENAI_API_BASE}/agents/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifact.id)}/content`,
      config.apiKey,
    );
    if (!artifactResponse.ok) return NextResponse.json({ ok: false, error: "AGENTS_RESULT_ARTIFACT_DOWNLOAD_FAILED" }, { status: 502 });
    const artifactText = await boundedText(artifactResponse, AGENTS_API_MAX_RESULT_BYTES);
    if (artifactText === null) return NextResponse.json({ ok: false, error: "AGENTS_RESULT_ARTIFACT_TOO_LARGE" }, { status: 413 });
    let rawResult: unknown;
    try { rawResult = JSON.parse(artifactText); } catch { rawResult = null; }
    const result = validateAgentsResult(rawResult);
    if (!result || result.files.length === 0) return NextResponse.json({ ok: false, error: "AGENTS_RESULT_ARTIFACT_INVALID" }, { status: 409 });

    const published = await publishAgentsResultToGithub({
      repository: job.repository,
      baseBranch: job.base_branch,
      jobId: job.id,
      taskTitle: task.title,
      result,
      token: githubToken as string,
    });
    if (!published.ok) return NextResponse.json({ ok: false, error: published.error }, { status: 409 });

    const { data: updated, error: updateError } = await supabase.rpc("update_external_agent_job_result", {
      p_job_id: job.id,
      p_status: "WAITING_HUMAN_APPROVAL",
      p_external_job_id: job.external_job_id,
      p_branch_name: published.branch,
      p_commit_sha: published.commitSha,
      p_pull_request_number: published.pullRequestNumber,
      p_pull_request_url: published.pullRequestUrl,
      p_result_summary: result.summary || "Agents API result is ready for human review.",
    });
    if (updateError) return NextResponse.json({ ok: false, error: "AGENTS_RECONCILE_STATE_UPDATE_REJECTED" }, { status: 409 });
    return NextResponse.json({ ok: true, state: "WAITING_HUMAN_APPROVAL", job: updated });
  } catch {
    return NextResponse.json({ ok: false, error: "AGENTS_RECONCILE_UNAVAILABLE" }, { status: 502 });
  }
}
