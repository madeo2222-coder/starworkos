import {
  dispatchConfig,
  dispatchPayload,
  parseDispatchResponse,
  readBoundedJsonResponse,
} from "@/lib/external-agent-dispatch";
import { createServiceClient } from "@/utils/supabase/service";

const DISPATCH_TIMEOUT_MS = 10_000;

type DispatchExecutionResult =
  | { ok: true; status: 202; job: unknown }
  | { ok: false; status: number; error: string };

export async function dispatchExternalAgentJob(
  jobId: string,
): Promise<DispatchExecutionResult> {
  const config = dispatchConfig();
  if (!config.ok) {
    return { ok: false, status: 503, error: config.error };
  }

  const supabase = createServiceClient();
  const { data: job, error: jobError } = await supabase
    .from("external_agent_jobs")
    .select(
      "id, task_id, ai_employee_id, provider, capability, repository, base_branch, requested_action, status, task_snapshot",
    )
    .eq("id", jobId)
    .maybeSingle();

  if (jobError) {
    return {
      ok: false,
      status: 500,
      error: "EXTERNAL_AGENT_JOB_LOOKUP_FAILED",
    };
  }
  if (!job) {
    return {
      ok: false,
      status: 404,
      error: "EXTERNAL_AGENT_JOB_NOT_FOUND",
    };
  }
  if (job.status !== "QUEUED") {
    return {
      ok: false,
      status: 409,
      error: "EXTERNAL_AGENT_JOB_NOT_QUEUED",
    };
  }

  const snapshot = job.task_snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      ok: false,
      status: 409,
      error: "EXTERNAL_AGENT_TASK_SNAPSHOT_MISSING",
    };
  }

  const task = snapshot as Record<string, unknown>;
  if (typeof task.title !== "string" || !task.title.trim()) {
    return {
      ok: false,
      status: 409,
      error: "EXTERNAL_AGENT_TASK_SNAPSHOT_INVALID",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);

  try {
    const gatewayResponse = await fetch(config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.gatewayToken}`,
        "content-type": "application/json",
        "idempotency-key": `external-agent-job:${job.id}`,
      },
      body: JSON.stringify(dispatchPayload(job, task, config.callbackUrl)),
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });

    if (!gatewayResponse.ok) {
      return {
        ok: false,
        status: 502,
        error: "EXTERNAL_AGENT_GATEWAY_REJECTED",
      };
    }

    const dispatchResult = parseDispatchResponse(
      await readBoundedJsonResponse(gatewayResponse),
    );
    if (!dispatchResult) {
      return {
        ok: false,
        status: 502,
        error: "EXTERNAL_AGENT_GATEWAY_INVALID_RESPONSE",
      };
    }

    const { data, error } = await supabase.rpc(
      "update_external_agent_job_result",
      {
        p_job_id: job.id,
        p_status: "RUNNING",
        p_external_job_id: dispatchResult.externalJobId,
      },
    );

    if (error) {
      return {
        ok: false,
        status: 409,
        error: "EXTERNAL_AGENT_JOB_DISPATCH_STATE_REJECTED",
      };
    }

    return { ok: true, status: 202, job: data };
  } catch {
    return {
      ok: false,
      status: 502,
      error: "EXTERNAL_AGENT_GATEWAY_UNAVAILABLE",
    };
  } finally {
    clearTimeout(timeout);
  }
}
