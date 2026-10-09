import { NextResponse } from "next/server";
import {
  DISPATCH_MAX_BODY_BYTES,
  hasMinimumTokenLength,
  isAuthorizedDispatchTrigger,
  validateDispatchRequest,
} from "@/lib/external-agent-dispatch";
import { dispatchExternalAgentJob } from "@/lib/external-agent-dispatch-execution";
import { readJsonBodyWithLimit } from "@/lib/request-body";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const suppliedToken = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  const triggerToken = process.env.EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN;

  if (
    !hasMinimumTokenLength(triggerToken) ||
    !isAuthorizedDispatchTrigger(process.env, suppliedToken)
  ) {
    return NextResponse.json(
      { ok: false, error: "DISPATCH_AUTHENTICATION_REQUIRED" },
      { status: 401 },
    );
  }

  const parsedBody = await readJsonBodyWithLimit(
    request,
    DISPATCH_MAX_BODY_BYTES,
  );
  if (!parsedBody.ok) {
    return NextResponse.json(
      { ok: false, error: "DISPATCH_PAYLOAD_TOO_LARGE" },
      { status: 413 },
    );
  }

  const requestError = validateDispatchRequest(parsedBody.value);
  if (requestError) {
    return NextResponse.json(
      { ok: false, error: requestError },
      { status: 400 },
    );
  }

  const jobId = (parsedBody.value as { jobId: string }).jobId;
  const result = await dispatchExternalAgentJob(jobId);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json(
    { ok: true, job: result.job },
    { status: result.status },
  );
}
