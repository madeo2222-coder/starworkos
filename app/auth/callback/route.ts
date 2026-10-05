import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getLoginCallbackErrorCode } from "@/lib/login-errors";

function redirectToLogin(origin: string, error: string) {
  const destination = new URL("/login", origin);
  destination.searchParams.set("error", error);
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (searchParams.has("error")) {
    return redirectToLogin(origin, getLoginCallbackErrorCode({ code: searchParams.get("error_code") }));
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const response = NextResponse.redirect(`${origin}/dashboard`);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }

    return redirectToLogin(origin, getLoginCallbackErrorCode(error));
  }

  return redirectToLogin(origin, "auth_callback_failed");
}
