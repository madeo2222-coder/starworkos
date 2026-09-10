import { NextResponse } from "next/server";
import { JOB_CREATE_MAX_BODY_BYTES, validateCreateInput } from "@/lib/external-agent-jobs";
import { readJsonBodyWithLimit } from "@/lib/request-body";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return NextResponse.json({ ok: false, error: "A valid Idempotency-Key header is required." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });

  const parsedBody = await readJsonBodyWithLimit(request, JOB_CREATE_MAX_BODY_BYTES);
  if (!parsedBody.ok) return NextResponse.json({ ok: false, error: "EXTERNAL_AGENT_JOB_PAYLOAD_TOO_LARGE" }, { status: 413 });
  const body = parsedBody.value;
  const validationError = validateCreateInput(body);
  if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
  const input = body as Record<string, string>;
  const { data, error } = await supabase.rpc("create_external_agent_job", {
    p_task_id: input.taskId,
    p_ai_employee_id: input.aiEmployeeId,
    p_provider: input.provider,
    p_capability: input.capability,
    p_repository: input.repository,
    p_base_branch: input.baseBranch,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    const code = error.message;
    const status = code.includes("AUTHENTICATION_REQUIRED") ? 401
      : code.includes("EXTERNAL_AGENT_JOB_FORBIDDEN") ? 403
      : code.includes("Task not found") || code.includes("AI Employee not found") ? 404
      : code.includes("not eligible") || code.includes("idempotency key conflicts") || code.includes("duplicate active") ? 409
      : 500;
    const errorCode = status === 401 ? "AUTHENTICATION_REQUIRED"
      : status === 403 ? "EXTERNAL_AGENT_JOB_FORBIDDEN"
      : status === 404 ? "EXTERNAL_AGENT_JOB_RESOURCE_NOT_FOUND"
      : code.includes("not eligible") ? "EXTERNAL_AGENT_JOB_NOT_ELIGIBLE"
      : code.includes("idempotency key conflicts") ? "EXTERNAL_AGENT_JOB_IDEMPOTENCY_CONFLICT"
      : code.includes("duplicate active") ? "EXTERNAL_AGENT_JOB_DUPLICATE_ACTIVE"
      : "EXTERNAL_AGENT_JOB_CREATE_FAILED";
    return NextResponse.json({ ok: false, error: errorCode }, { status });
  }
  return NextResponse.json({ ok: true, job: data }, { status: 201 });
}
