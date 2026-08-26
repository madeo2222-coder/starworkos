import { NextResponse } from "next/server";
import { validateResultInput } from "@/lib/external-agent-jobs";
import { createServiceClient } from "@/utils/supabase/service";

export async function POST(request: Request) {
  const expectedToken = process.env.EXTERNAL_AGENT_RESULT_TOKEN;
  const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expectedToken || suppliedToken !== expectedToken) {
    return NextResponse.json({ ok: false, error: "Service authentication required." }, { status: 401 });
  }
  const body: unknown = await request.json().catch(() => null);
  const validationError = validateResultInput(body);
  if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
  const input = body as Record<string, unknown>;
  const supabase = createServiceClient();
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
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
  return NextResponse.json({ ok: true, job: data });
}
