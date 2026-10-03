import { NextResponse } from "next/server";
import {
  AGENTS_API_MAX_ARCHIVE_BYTES,
  agentsApiConfig,
  buildAgentsApiSessionRequest,
  validateAgentsApiPayload,
} from "@/lib/agents-api-codex";
import { hasMinimumTokenLength, safeTokenEquals } from "@/lib/external-agent-dispatch";
import { readJsonBodyWithLimit } from "@/lib/request-body";

export const runtime = "nodejs";

const OPENAI_AGENTS_URL = "https://api.openai.com/v1/agents/sessions";
const GITHUB_API_BASE = "https://api.github.com";
const GATEWAY_MAX_BODY_BYTES = 32 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

type AgentsGatewayPayload = {
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
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedBytes(response: Response, maximumBytes: number) {
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
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export async function POST(request: Request) {
  const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const gatewayToken = process.env.EXTERNAL_AGENT_GATEWAY_TOKEN;
  if (!hasMinimumTokenLength(gatewayToken) || !safeTokenEquals(gatewayToken, suppliedToken)) {
    return NextResponse.json({ ok: false, error: "AGENTS_GATEWAY_AUTHENTICATION_REQUIRED" }, { status: 401 });
  }

  const config = agentsApiConfig();
  if (!config.ok) return NextResponse.json({ ok: false, error: config.error }, { status: 503 });

  const githubToken = process.env.CODEX_GITHUB_TOKEN;
  if (!hasMinimumTokenLength(githubToken, 20)) {
    return NextResponse.json({ ok: false, error: "AGENTS_GATEWAY_GITHUB_NOT_CONFIGURED" }, { status: 503 });
  }

  const parsedBody = await readJsonBodyWithLimit(request, GATEWAY_MAX_BODY_BYTES);
  if (!parsedBody.ok) return NextResponse.json({ ok: false, error: "AGENTS_GATEWAY_PAYLOAD_TOO_LARGE" }, { status: 413 });
  const validationError = validateAgentsApiPayload(parsedBody.value);
  if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
  const payload = parsedBody.value as AgentsGatewayPayload;

  const [owner, repository] = payload.job.repository.split("/");
  const archiveUrl = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/tarball/${encodeURIComponent(payload.job.baseBranch)}`;

  let archive: Buffer | null;
  try {
    const archiveResponse = await fetchWithTimeout(archiveUrl, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${githubToken}`,
        "x-github-api-version": "2026-03-10",
        "user-agent": "star-work-os-agents-gateway",
      },
      redirect: "follow",
    });
    if (!archiveResponse.ok) return NextResponse.json({ ok: false, error: "AGENTS_GATEWAY_REPOSITORY_ARCHIVE_FAILED" }, { status: 502 });
    archive = await readBoundedBytes(archiveResponse, AGENTS_API_MAX_ARCHIVE_BYTES);
    if (!archive) return NextResponse.json({ ok: false, error: "AGENTS_GATEWAY_REPOSITORY_ARCHIVE_TOO_LARGE" }, { status: 413 });
  } catch {
    return NextResponse.json({ ok: false, error: "AGENTS_GATEWAY_REPOSITORY_UNAVAILABLE" }, { status: 502 });
  }

  const sessionRequest = buildAgentsApiSessionRequest(payload, archive.toString("base64"), config.model);
  try {
    const agentsResponse = await fetchWithTimeout(OPENAI_AGENTS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        "openai-beta": "agents=v1",
        "idempotency-key": `star-work-os-agent:${payload.job.id}`,
      },
      body: JSON.stringify(sessionRequest),
      redirect: "error",
    });
    if (!agentsResponse.ok) return NextResponse.json({ ok: false, error: "AGENTS_API_SESSION_CREATE_FAILED" }, { status: 502 });
    const session = await agentsResponse.json();
    if (typeof session?.id !== "string" || !/^sess_[A-Za-z0-9_-]+$/.test(session.id)) {
      return NextResponse.json({ ok: false, error: "AGENTS_API_INVALID_SESSION_RESPONSE" }, { status: 502 });
    }
    return NextResponse.json({ externalJobId: `agents-session:${session.id}` }, { status: 202 });
  } catch {
    return NextResponse.json({ ok: false, error: "AGENTS_API_UNAVAILABLE" }, { status: 502 });
  }
}
