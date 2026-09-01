import { NextResponse } from "next/server";
import { verifyCallbackSignature } from "@/lib/external-agent-callback";
import { validateResultInput } from "@/lib/external-agent-jobs";
import { createServiceClient } from "@/utils/supabase/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-external-agent-signature");
  const timestamp = request.headers.get("x-external-agent-timestamp");
  const nonce = request.headers.get("x-external-agent-nonce");
  const secret = process.env.EXTERNAL_AGENT_CALLBACK_SECRET;

  if (!verifyCallbackSignature({ secret, timestamp, nonce, body: rawBody, signature })) {
    return NextResponse.json({ ok: false, error: "CALLBACK_AUTHENTICATION_FAILED" }, { status: 401 });
  }

  const body: unknown = (() => {
    try { return JSON.parse(rawBody); } catch { return null; }
  })();
  const validationError = validateResultInput(body);
  if (validationError) return NextResponse.json({ ok: false, error: "INVALID_CALLBACK_PAYLOAD" }, { status: 400 });

  const supabase = createServiceClient();
  const { error: nonceError } = await supabase
    .from("external_agent_callback_nonces")
    .insert({ nonce, received_at: new Date().toISOString() });
  if (nonceError) {
    const isReplay = nonceError.code === "23505";
    return NextResponse.json({ ok: false, error: isReplay ? "CALLBACK_REPLAY_DETECTED" : "CALLBACK_NONCE_RECORD_FAILED" }, { status: isReplay ? 409 : 500 });
  }

  const input = body as Record<string, unknown>;
  const { data, error } = await supabase.rpc("update_external_agent_job_result", {
    p_job_id: input.jobId,
    p_status: input.status,
    p_external_job_id: input.externalJobId ?? null,
    p_branch_name: input.branchName ?? null,
    p_commit_sha: input.commitSha ?? null,
    p_pull_request_number: input.pullRequestNumber ?? null,
    p_pull_request_url: input.pullRequestUrl ?? null,
    p_result_summary: input.resultSummary ?? null,
    p_error_code: input.errorCode ?? null,
    p_error_summary: input.errorSummary ?? null,
    p_started_at: input.startedAt ?? null,
    p_completed_at: input.completedAt ?? null,
  });
  if (error) return NextResponse.json({ ok: false, error: "EXTERNAL_AGENT_JOB_RESULT_REJECTED" }, { status: 409 });
  return NextResponse.json({ ok: true, job: data });
}
