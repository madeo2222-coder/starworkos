import { createClient } from "@/utils/supabase/server";
import { buildUnsentSalesAppointmentNotice } from "@/lib/sales-appointment-notice-export.js";
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
  const email = lead ? buildUnsentSalesAppointmentNotice(lead) : null;
  if (!email) return response("未送信のアポイント確定案内を出力できませんでした。", 409);
  return new Response(email, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="star-work-os-appointment-notice-${id}.eml"`,
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
