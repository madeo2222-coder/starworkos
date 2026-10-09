import { NextResponse } from "next/server";
import { POST as reconcileInternalJob } from "@/app/api/internal/agents-api-reconcile/route";
import { hasMinimumTokenLength } from "@/lib/external-agent-dispatch";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
  context: {
    params: Promise<{
      jobId: string;
    }>;
  },
) {
  const { jobId } = await context.params;
  if (!UUID_PATTERN.test(jobId)) {
    return NextResponse.json(
      { ok: false, error: "INVALID_AGENTS_RECONCILE_REQUEST" },
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
      { ok: false, error: "AGENTS_RECONCILE_JOB_LOOKUP_FAILED" },
      { status: 500 },
    );
  }
  if (!job) {
    return NextResponse.json(
      { ok: false, error: "AGENTS_RECONCILE_JOB_NOT_FOUND" },
      { status: 404 },
    );
  }

  if (
    job.status !== "RUNNING" &&
    job.status !== "WAITING_HUMAN_APPROVAL"
  ) {
    return NextResponse.json(
      { ok: false, error: "AGENTS_RECONCILE_JOB_STATE_MISMATCH" },
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
      { ok: false, error: "AGENTS_RECONCILE_TASK_LOOKUP_FAILED" },
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

  const triggerToken = process.env.EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN;
  if (!hasMinimumTokenLength(triggerToken)) {
    return NextResponse.json(
      { ok: false, error: "AGENTS_RECONCILE_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const internalRequest = new Request(
    "http://star-work-os.internal/api/internal/agents-api-reconcile",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${triggerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jobId }),
    },
  );

  return reconcileInternalJob(internalRequest);
}
