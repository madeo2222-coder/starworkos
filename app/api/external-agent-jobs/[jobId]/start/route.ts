import { NextResponse } from "next/server";
import { validateDispatchRequest } from "@/lib/external-agent-dispatch";
import { dispatchExternalAgentJob } from "@/lib/external-agent-dispatch-execution";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{
      jobId: string;
    }>;
  },
) {
  const { jobId } = await context.params;
  const requestError = validateDispatchRequest({ jobId });
  if (requestError) {
    return NextResponse.json(
      { ok: false, error: "INVALID_DISPATCH_REQUEST" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, error: "AUTHENTICATION_REQUIRED" },
      { status: 401 },
    );
  }

  const service = createServiceClient();
  const { data: job, error: jobError } = await service
    .from("external_agent_jobs")
    .select("id, task_id, repository, status")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError) {
    return NextResponse.json(
      { ok: false, error: "EXTERNAL_AGENT_JOB_LOOKUP_FAILED" },
      { status: 500 },
    );
  }
  if (!job) {
    return NextResponse.json(
      { ok: false, error: "EXTERNAL_AGENT_JOB_NOT_FOUND" },
      { status: 404 },
    );
  }
  if (job.status !== "QUEUED") {
    return NextResponse.json(
      { ok: false, error: "EXTERNAL_AGENT_JOB_NOT_QUEUED" },
      { status: 409 },
    );
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, project_id")
    .eq("id", job.task_id)
    .maybeSingle();

  if (taskError) {
    return NextResponse.json(
      { ok: false, error: "EXTERNAL_AGENT_TASK_LOOKUP_FAILED" },
      { status: 500 },
    );
  }
  if (!task) {
    return NextResponse.json(
      { ok: false, error: "EXTERNAL_AGENT_JOB_FORBIDDEN" },
      { status: 403 },
    );
  }

  const { data: authorization, error: authorizationError } = await service
    .from("external_agent_job_authorizations")
    .select("id")
    .eq("user_id", user.id)
    .eq("project_id", task.project_id)
    .eq("repository", job.repository)
    .eq("enabled", true)
    .maybeSingle();

  if (authorizationError) {
    return NextResponse.json(
      { ok: false, error: "EXTERNAL_AGENT_AUTHORIZATION_LOOKUP_FAILED" },
      { status: 500 },
    );
  }
  if (!authorization) {
    return NextResponse.json(
      { ok: false, error: "EXTERNAL_AGENT_JOB_FORBIDDEN" },
      { status: 403 },
    );
  }

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
