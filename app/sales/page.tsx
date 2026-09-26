import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { buildSalesWorkQueue } from "@/lib/sales-work-queue.js";
import {
  createSalesLeadRecord,
  parseSalesLeadRecord,
  SALES_LEAD_RECORD_PREFIX,
} from "@/lib/sales-lead-record.js";

type SalesTask = {
  id: string;
  content: string | null;
};

const actionLabels: Record<string, string> = {
  STOP_CONTACT: "配信停止を確認",
  HUMAN_REVIEW: "人間が判断",
  PREPARE_MEETING_OPTIONS: "面談候補を作成",
  PREPARE_REPLY: "一次返信案を作成",
  PREPARE_OUTREACH: "初回提案を作成",
  PREPARE_FOLLOW_UP: "追客案を作成",
  RESEARCH_COMPANY: "企業調査を実施",
  NO_ACTION: "送信記録を確認",
};

const roleLabels: Record<string, string> = {
  researcher: "企業リサーチ担当AI",
  sales_writer: "営業文面担当AI",
  scheduler: "日程調整担当AI",
  sales_manager: "営業責任者",
  delivery_operator: "送信管理担当",
};

async function createSalesLead(formData: FormData) {
  "use server";

  const content = createSalesLeadRecord({
    companyName: String(formData.get("companyName") ?? ""),
    website: String(formData.get("website") ?? ""),
    contact: String(formData.get("contact") ?? ""),
    proposalFit: String(formData.get("proposalFit") ?? ""),
  });

  if (!content) throw new Error("入力内容を確認してください。");

  const lead = parseSalesLeadRecord("preview", content);
  if (!lead) throw new Error("入力内容を確認してください。");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("tasks").insert({
    title: `営業見込み：${lead.companyName}`,
    content,
    priority: "高",
    status: "NEW",
  });

  if (error) throw new Error("見込み企業を登録できませんでした。");
  revalidatePath("/sales");
}

export default async function SalesCommandCenterPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("tasks")
    .select("id, content")
    .like("content", `${SALES_LEAD_RECORD_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error("営業案件を取得できませんでした。");

  const leads = ((data ?? []) as SalesTask[])
    .map((task) => parseSalesLeadRecord(task.id, task.content))
    .filter((lead) => lead !== null);
  const queue = buildSalesWorkQueue(leads);
  const leadMap = new Map(leads.map((lead) => [lead.id, lead]));

  return (
    <main className="min-h-screen bg-[#f7f7f5] px-4 py-5 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="os-surface rounded-[24px] p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="os-eyebrow">AI sales department</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-zinc-950 md:text-4xl">営業司令塔</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
                見込み企業を登録すると、WORK OSが担当AIと次の作業を整理します。現在は準備・確認までで、メールやLINEは送信しません。
              </p>
            </div>
            <Link href="/dashboard" className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">Dashboardへ戻る</Link>
          </div>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <Summary label="見込み企業" value={leads.length} />
          <Summary label="次の作業" value={queue.counts.queued} />
          <Summary label="要確認データ" value={queue.counts.invalid + queue.counts.duplicate} tone="amber" />
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-12">
          <div className="os-surface rounded-[22px] p-6 xl:col-span-5">
            <p className="os-eyebrow">New prospect</p>
            <h2 className="mt-2 text-xl font-semibold text-zinc-950">見込み企業を登録</h2>
            <form action={createSalesLead} className="mt-5 space-y-4">
              <Field label="企業名" name="companyName" required placeholder="例：〇〇工務店" />
              <Field label="Webサイト" name="website" type="url" placeholder="https://example.com" />
              <Field label="連絡先" name="contact" placeholder="メールアドレス、担当部署など" />
              <label className="block text-sm font-semibold text-zinc-800">
                提案できそうな理由
                <textarea name="proposalFit" maxLength={2000} rows={4} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-500" placeholder="相手企業に響きそうなポイント" />
              </label>
              <button type="submit" className="w-full rounded-xl bg-zinc-950 px-4 py-3 text-sm font-semibold text-white hover:bg-zinc-800">登録して担当AIへ振り分ける</button>
            </form>
          </div>

          <div className="os-surface rounded-[22px] p-6 xl:col-span-7">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="os-eyebrow">Priority queue</p>
                <h2 className="mt-2 text-xl font-semibold text-zinc-950">次にやる営業仕事</h2>
              </div>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">外部送信OFF</span>
            </div>

            <div className="mt-5 space-y-3">
              {queue.items.map((item, index) => {
                const lead = leadMap.get(item.leadId);
                return (
                  <article key={item.leadId} className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <div className="flex items-start gap-4">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-zinc-950 text-sm font-bold text-white">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-semibold text-zinc-950">{item.companyName}</h3>
                          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">{roleLabels[item.ownerRole] ?? item.ownerRole}</span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-zinc-800">{actionLabels[item.action] ?? item.action}</p>
                        {lead?.proposalFit && <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{lead.proposalFit}</p>}
                      </div>
                    </div>
                  </article>
                );
              })}
              {queue.items.length === 0 && (
                <div className="rounded-2xl bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500">見込み企業を登録すると、次の作業がここに並びます。</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Summary({ label, value, tone = "zinc" }: { label: string; value: number; tone?: "zinc" | "amber" }) {
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${tone === "amber" ? "border-amber-200 bg-amber-50" : "border-zinc-200 bg-white"}`}>
      <p className="text-sm font-medium text-zinc-600">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-zinc-950">{value}</p>
    </div>
  );
}

function Field({ label, name, type = "text", required = false, placeholder }: { label: string; name: string; type?: string; required?: boolean; placeholder: string }) {
  return (
    <label className="block text-sm font-semibold text-zinc-800">
      {label}
      <input name={name} type={type} required={required} maxLength={type === "url" ? 512 : 254} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-500" placeholder={placeholder} />
    </label>
  );
}
