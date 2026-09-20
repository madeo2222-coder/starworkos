import { NextResponse } from "next/server";
import { externalAgentActivationReadiness } from "@/lib/external-agent-activation";
import { evaluateDispatchDryRun } from "@/lib/external-agent-dry-run";
import { DISPATCH_MAX_BODY_BYTES, isAuthorizedDispatchTrigger, validateDispatchRequest } from "@/lib/external-agent-dispatch";
import { readJsonBodyWithLimit } from "@/lib/request-body";
import { createServiceClient } from "@/utils/supabase/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!isAuthorizedDispatchTrigger(process.env, suppliedToken)) {
    return NextResponse.json(
      { ok: false, error: "DISPATCH_AUTHENTICATION_REQUIRED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const parsedBody = await readJsonBodyWithLimit(request, DISPATCH_MAX_BODY_BYTES);
  if (!parsedBody.ok) {
    return NextResponse.json(
      { ok: false, error: "DISPATCH_PAYLOAD_TOO_LARGE" },
      { status: 413, headers: { "cache-control": "no-store" } },
    );
  }

  const requestError = validateDispatchRequest(parsedBody.value);
  if (requestError) {
    return NextResponse.json(
      { ok: false, error: requestError },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const readiness = externalAgentActivationReadiness();
  if (!readiness.configured) {
    return NextResponse.json(
      { ok: false, error: "EXTERNAL_AGENT_DISPATCH_NOT_CONFIGURED", readiness },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const jobId = (parsedBody.value as { jobId: string }).jobId;
  const supabase = createServiceClient();
  const { data: job, error } = await supabase
    .from("external_agent_jobs")
    .select("id, task_id, ai_employee_id, provider, capability, repository, base_branch, requested_action, status")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "EXTERNAL_AGENT_JOB_LOOKUP_FAILED" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  const result = evaluateDispatchDryRun(readiness, job);
  return NextResponse.json(result, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
