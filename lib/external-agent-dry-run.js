export function evaluateDispatchDryRun(readiness, job) {
  if (!readiness?.configured) {
    return { ok: false, status: 503, error: "EXTERNAL_AGENT_DISPATCH_NOT_CONFIGURED" };
  }
  if (!job) {
    return { ok: false, status: 404, error: "EXTERNAL_AGENT_JOB_NOT_FOUND" };
  }
  if (job.status !== "QUEUED") {
    return { ok: false, status: 409, error: "EXTERNAL_AGENT_JOB_NOT_QUEUED" };
  }

  return {
    ok: true,
    status: 200,
    readiness: {
      configured: true,
      enabled: Boolean(readiness.enabled),
      state: readiness.state,
    },
    job: {
      id: job.id,
      taskId: job.task_id,
      aiEmployeeId: job.ai_employee_id,
      provider: job.provider,
      capability: job.capability,
      repository: job.repository,
      baseBranch: job.base_branch,
      requestedAction: job.requested_action,
      status: job.status,
    },
    wouldDispatch: Boolean(readiness.enabled),
  };
}
