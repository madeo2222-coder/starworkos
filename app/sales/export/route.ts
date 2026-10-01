import { createClient } from "@/utils/supabase/server";
import { buildSalesPipelineCsv } from "@/lib/sales-pipeline-export.js";
import { parseSalesLeadRecord, SALES_LEAD_RECORD_PREFIX } from "@/lib/sales-lead-record.js";

type SalesTask = {
  id: string;
  content: string | null;
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", {
    status: 401,
    headers: { "cache-control": "no-store" },
  });

  const { data, error } = await supabase
    .from("tasks")
    .select("id, content")
    .like("content", `${SALES_LEAD_RECORD_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return new Response("営業案件を取得できませんでした。", {
    status: 500,
    headers: { "cache-control": "no-store" },
  });

  const leads = ((data ?? []) as SalesTask[])
    .map((task) => parseSalesLeadRecord(task.id, task.content))
    .filter((lead) => lead !== null);
  const csv = buildSalesPipelineCsv(leads);
  if (csv === null) return new Response("営業案件を出力できませんでした。", {
    status: 500,
    headers: { "cache-control": "no-store" },
  });

  return new Response(csv, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": "attachment; filename=star-work-os-sales-pipeline.csv",
      "content-type": "text/csv; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
