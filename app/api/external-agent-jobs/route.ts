import { NextResponse } from "next/server";
import { validateCreateInput } from "@/lib/external-agent-jobs";
import { createClient } from "@/utils/supabase/server";

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const validationError = validateCreateInput(body);
  if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return NextResponse.json({ ok: false, error: "A valid Idempotency-Key header is required." }, { status: 400 });
  }

  const input = body as Record<string, string>;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });

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
    const status = error.message.includes("not found") ? 404 : error.message.includes("not eligible") ? 409 : 400;
    return NextResponse.json({ ok: false, error: error.message }, { status });
  }
  return NextResponse.json({ ok: true, job: data }, { status: 201 });
}
