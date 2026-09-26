import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { buildSalesWorkQueue } from "@/lib/sales-work-queue.js";
import {
  completeSalesResearch,
  saveSalesOutreachDraft,
  approveSalesOutreachDraft,
  recordSalesOutreachDelivery,
  createSalesLeadRecord,
  parseSalesLeadRecord,
  SALES_LEAD_RECORD_PREFIX,
} from "@/lib/sales-lead-record.js";

type SalesTask = {
  id: string;
  content: string | null;
  updated_at: string;
};

async function recordOutreachDelivery(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  const channel = formData.get("channel");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || (channel !== "EMAIL" && channel !== "LINE")
    || formData.get("confirmed") !== "yes") redirect("/sales?notice=delivery-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  const content = recordSalesOutreachDelivery(
    id, task.content, user.id, new Date().toISOString(), channel,
  );
  if (!content) redirect("/sales?notice=delivery-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=delivery-recorded");
}

async function reviewOutreach(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  const operation = formData.get("operation");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || (operation !== "save" && operation !== "approve")) redirect("/sales?notice=outreach-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  if (operation === "approve" && formData.get("confirmed") !== "yes")
    redirect("/sales?notice=outreach-invalid");
  const content = operation === "save"
    ? saveSalesOutreachDraft(id, task.content, {
      subject: formData.get("subject"), body: formData.get("body"), signature: formData.get("signature"),
    })
    : approveSalesOutreachDraft(id, task.content, user.id, new Date().toISOString());
  if (!content) redirect("/sales?notice=outreach-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect(operation === "save" ? "/sales?notice=draft-saved" : "/sales?notice=draft-approved");
}

async function recordResearch(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || version.length > 64) redirect("/sales?notice=conflict");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "NEW")
    redirect("/sales?notice=conflict");
  const content = completeSalesResearch(id, task.content, String(formData.get("notes") ?? ""));
  if (!content) redirect("/sales?notice=invalid");
  const result = await supabase.from("tasks")
    .update({ content, status: "PLANNING" })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "NEW")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=research-saved");
}

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

export default async function SalesCommandCenterPage({ searchParams }: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("tasks")
    .select("id, content, updated_at")
    .like("content", `${SALES_LEAD_RECORD_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error("営業案件を取得できませんでした。");

  const leads = ((data ?? []) as SalesTask[])
    .map((task) => parseSalesLeadRecord(task.id, task.content))
    .filter((lead) => lead !== null);
  const queue = buildSalesWorkQueue(leads);
  const leadMap = new Map(leads.map((lead) => [lead.id, lead]));
  const versions = new Map(((data ?? []) as SalesTask[]).map((task) => [task.id, task.updated_at]));
  const notices: Record<string, string> = {
    "draft-saved": "提案文を保存しました。保存済みの内容を確認して承認してください。",
    "draft-approved": "文面を承認しました。まだ送信されていません。",
    "delivery-recorded": "外部での送信完了を記録しました。WORK OSからの送信は行っていません。",
    "delivery-invalid": "承認済み文面・送信手段・送信確認を見直してください。二重記録はできません。",
    "outreach-invalid": "件名・本文・署名と確認チェックを見直してください。進行済みの案件は変更できません。",
    "research-saved": "調査結果を保存しました。次は初回提案の準備です。",
    conflict: "保存できませんでした。他の更新や権限を確認し、再読み込みしてください。",
    invalid: "調査結果を入力してください。この案件はすでに進行している可能性があります。",
  };

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
        {notice && notices[notice] && <p role="status" className="mt-4 rounded-xl bg-blue-50 p-4 text-sm text-blue-900">{notices[notice]}</p>}

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
              <button type="submit" className="w-full rounded-xl bg-zinc-950 px-4 py-3 text-sm font-semibold text-white hover:bg-zinc-800">登録して次の作業を確認</button>
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
                        {lead?.researchNotes && <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">調査結果：{lead.researchNotes}</p>}
                        {lead?.researchComplete && (item.action === "PREPARE_OUTREACH" || item.reason === "WAIT_FOR_HUMAN_SEND_RECORD") && (
                          <div className="mt-4 space-y-3">
                            <details className="rounded-xl border border-zinc-200 p-3">
                              <summary className="cursor-pointer text-sm font-semibold">提案文を作成・編集</summary>
                              <p className="mt-2 text-xs text-zinc-500">ひな形を編集して保存してください。保存すると承認は解除されます。</p>
                              <form action={reviewOutreach} className="mt-3 space-y-3">
                                <input type="hidden" name="id" value={item.leadId} />
                                <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                <input type="hidden" name="operation" value="save" />
                                <label className="block text-xs font-semibold">件名
                                  <input name="subject" required maxLength={160} defaultValue={lead.outreachDraft?.subject ?? "住宅設備延長保証に関するご相談"} className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm" />
                                </label>
                                <label className="block text-xs font-semibold">本文
                                  <textarea name="body" required maxLength={4000} rows={7} defaultValue={lead.outreachDraft?.body ?? `${lead.companyName} ご担当者様\n\n突然のご連絡失礼いたします。\n住宅設備の延長保証について、貴社のお取り組みを伺いながらご紹介の機会をいただければと存じます。\n\nご関心がございましたら、Web面談のご都合をお知らせいただけますでしょうか。\nどうぞよろしくお願いいたします。`} className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm" />
                                </label>
                                <label className="block text-xs font-semibold">署名（会社名・氏名・連絡先）
                                  <textarea name="signature" maxLength={500} rows={3} defaultValue={lead.outreachDraft?.signature ?? ""} className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm" />
                                </label>
                                <button className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white">文面を保存・承認待ちへ</button>
                              </form>
                            </details>
                            {lead.outreachDraft && (
                              <section className="rounded-xl bg-zinc-50 p-3" aria-label="保存済み提案文">
                                <p className="text-xs font-semibold">{lead.outreachApproved ? "文面承認済み・未送信" : "保存済み・承認待ち"}</p>
                                <p className="mt-2 text-sm font-semibold">{lead.outreachDraft.subject}</p>
                                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{lead.outreachDraft.body}</p>
                                <p className="mt-3 whitespace-pre-wrap text-sm">{lead.outreachDraft.signature || "署名を入力して保存してください。"}</p>
                                {!lead.outreachApproved && (
                                  <form action={reviewOutreach} className="mt-3 space-y-3">
                                    <input type="hidden" name="id" value={item.leadId} />
                                    <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                    <input type="hidden" name="operation" value="approve" />
                                    <label className="flex items-start gap-2 text-xs">
                                      <input type="checkbox" name="confirmed" value="yes" required />
                                      上の保存済み文面と署名を確認しました（未保存の編集内容は対象外）。
                                    </label>
                                    <button disabled={!lead.outreachDraft.signature} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">保存済み文面を承認（送信なし）</button>
                                  </form>
                                )}
                                {lead.outreachApproved && item.reason === "WAIT_FOR_HUMAN_SEND_RECORD" && (
                                  <form action={recordOutreachDelivery} className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                                    <input type="hidden" name="id" value={item.leadId} />
                                    <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                    <label className="block text-xs font-semibold">外部で送信した手段
                                      <select name="channel" required defaultValue="EMAIL" className="mt-1 w-full rounded-lg border border-amber-300 bg-white p-2 text-sm">
                                        <option value="EMAIL">メール</option>
                                        <option value="LINE">LINE</option>
                                      </select>
                                    </label>
                                    <label className="flex items-start gap-2 text-xs">
                                      <input type="checkbox" name="confirmed" value="yes" required />
                                      上の承認済み文面を、選択した手段で実際に送信しました。
                                    </label>
                                    <p className="text-[11px] leading-4 text-amber-800">この操作は送信処理ではなく、外部で送った事実の記録だけを行います。</p>
                                    <button className="rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-white">送信済みとして記録</button>
                                  </form>
                                )}
                              </section>
                            )}
                          </div>
                        )}
                        {item.action === "RESEARCH_COMPANY" && (
                          <form action={recordResearch} className="mt-3 space-y-2">
                            <input type="hidden" name="id" value={item.leadId} />
                            <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                            <label className="block text-xs font-semibold text-zinc-700">
                              調査結果（確認した情報・出典）
                              <textarea name="notes" required maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm" />
                            </label>
                            <button className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white">調査完了・提案準備へ</button>
                          </form>
                        )}
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
