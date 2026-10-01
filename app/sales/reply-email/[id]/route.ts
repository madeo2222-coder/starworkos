import { createClient } from "@/utils/supabase/server";
import { buildUnsentSalesReplyEmail } from "@/lib/sales-reply-email-export.js";
import { parseSalesLeadRecord } from "@/lib/sales-lead-record.js";

type SalesTask = { id: string; content: string | null };
const UUID_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return response("Unauthorized", 401);
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return response("Not found", 404);
  const { data, error } = await supabase.from("tasks")
    .select("id, content").eq("id", id).maybeSingle();
  const task = data as SalesTask | null;
  if (error || !task) return response("Not found", 404);
  const lead = parseSalesLeadRecord(task.id, task.content);
  const email = lead ? buildUnsentSalesReplyEmail(lead) : null;
  if (!email) return response("未送信の一次返信メールを出力できませんでした。", 409);
  return new Response(email, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="star-work-os-sales-reply-${id}.eml"`,
      "content-type": "message/rfc822; charset=us-ascii",
      "x-content-type-options": "nosniff",
    },
  });
}

function response(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
