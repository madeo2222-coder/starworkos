import { NextResponse } from "next/server";
import { externalAgentActivationReadiness } from "@/lib/external-agent-activation";
import { isAuthorizedDispatchTrigger } from "@/lib/external-agent-dispatch";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!isAuthorizedDispatchTrigger(process.env, suppliedToken)) {
    return NextResponse.json(
      { ok: false, error: "DISPATCH_AUTHENTICATION_REQUIRED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true, readiness: externalAgentActivationReadiness() },
    { headers: { "cache-control": "no-store" } },
  );
}
