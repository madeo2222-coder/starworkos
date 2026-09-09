import { NextResponse } from "next/server";
import { dispatchConfig, dispatchPayload, hasMinimumTokenLength, parseDispatchResponse, safeTokenEquals, validateDispatchRequest } from "@/lib/external-agent-dispatch";
import { readJsonBodyWithLimit } from "@/lib/request-body";
import { createServiceClient } from "@/utils/supabase/service";

export const runtime = "nodejs";

const DISPATCH_TIMEOUT_MS = 10_000;
const DISPATCH_MAX_BODY_BYTES = 4 * 1024;

export async function POST(request: Request) {
  const config = dispatchConfig();
  if (!config.ok) return NextResponse.json({ ok: false, error: config.error }, { status: 503 });

  const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const triggerToken = process.env.EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN;
  if (!hasMinimumTokenLength(triggerToken) || !safeTokenEquals(triggerToken, suppliedToken)) {
    return NextResponse.json({ ok: false, error: "DISPATCH_AUTHENTICATION_REQUIRED" }, { status: 401 });
  }

  const parsedBody = await readJsonBodyWithLimit(request, DISPATCH_MAX_BODY_BYTES);
  if (!parsedBody.ok) return NextResponse.json({ ok: false, error: "DISPATCH_PAYLOAD_TOO_LARGE" }, { status: 413 });
  const body = parsedBody.value;
  const requestError = validateDispatchRequest(body);
  if (requestError) return NextResponse.json({ ok: false, error: requestError }, { status: 400 });
  const jobId = (body as { jobId: string }).jobId;

  const supabase = createServiceClient();
  const { data: job, error: jobError } = await supabase
    .from("external_agent_jobs")
    .select("id, task_id, ai_employee_id, provider, capability, repository, base_branch, requested_action, status")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) return NextResponse.json({ ok: false, error: "EXTERNAL_AGENT_JOB_LOOKUP_FAILED" }, { status: 500 });
  if (!job) return NextResponse.json({ ok: false, error: "EXTERNAL_AGENT_JOB_NOT_FOUND" }, { status: 404 });
  if (job.status !== "QUEUED") return NextResponse.json({ ok: false, error: "EXTERNAL_AGENT_JOB_NOT_QUEUED" }, { status: 409 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
  let gatewayResponse: Response;
  try {
    gatewayResponse = await fetch(config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.gatewayToken}`,
        "content-type": "application/json",
        "idempotency-key": `external-agent-job:${job.id}`,
      },
      body: JSON.stringify(dispatchPayload(job, config.callbackUrl)),
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    return NextResponse.json({ ok: false, error: "EXTERNAL_AGENT_GATEWAY_UNAVAILABLE" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
  if (!gatewayResponse.ok) return NextResponse.json({ ok: false, error: "EXTERNAL_AGENT_GATEWAY_REJECTED" }, { status: 502 });

  const dispatchResult = parseDispatchResponse(await gatewayResponse.json().catch(() => null));
  if (!dispatchResult) return NextResponse.json({ ok: false, error: "EXTERNAL_AGENT_GATEWAY_INVALID_RESPONSE" }, { status: 502 });

  const { data, error } = await supabase.rpc("update_external_agent_job_result", {
    p_job_id: job.id,
    p_status: "RUNNING",
    p_external_job_id: dispatchResult.externalJobId,
  });
  if (error) return NextResponse.json({ ok: false, error: "EXTERNAL_AGENT_JOB_DISPATCH_STATE_REJECTED" }, { status: 409 });
  return NextResponse.json({ ok: true, job: data }, { status: 202 });
}
