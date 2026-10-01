import Link from "next/link";
import { redirect } from "next/navigation";
import { buildSalesProposal } from "@/lib/sales-proposal.js";
import { parseSalesLeadRecord, SALES_LEAD_RECORD_PREFIX } from "@/lib/sales-lead-record.js";
import { createClient } from "@/utils/supabase/server";

type SalesTask = { id: string; content: string | null };

export default async function SalesProposalIndexPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase.from("tasks")
    .select("id, content")
    .like("content", `${SALES_LEAD_RECORD_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("提案書対象を取得できませんでした。");

  const proposals = ((data ?? []) as SalesTask[])
    .map((task) => parseSalesLeadRecord(task.id, task.content))
    .map(buildSalesProposal)
    .filter((proposal) => proposal !== null);

  return (
    <main className="min-h-screen bg-[#f7f7f5] px-4 py-6 md:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="os-surface rounded-[24px] p-6 md:p-8">
          <p className="os-eyebrow">Sales proposals</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-[-0.04em] text-zinc-950">企業別A4提案書</h1>
              <p className="mt-3 text-sm leading-6 text-zinc-500">監査付き企業調査が完了した案件の下書きを確認し、ブラウザから印刷またはPDF保存できます。</p>
            </div>
            <Link href="/sales" className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">営業司令塔へ戻る</Link>
          </div>
        </header>

        <section className="os-surface mt-6 rounded-[22px] p-6" aria-labelledby="proposal-list-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="proposal-list-heading" className="text-xl font-semibold text-zinc-950">提案書を選択</h2>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">最大100社</span>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {proposals.map((proposal) => (
              <Link key={proposal.id} href={`/sales/proposals/${proposal.id}`} className="os-card-hover rounded-2xl border border-zinc-200 bg-white p-4">
                <h3 className="font-semibold text-zinc-950">{proposal.companyName}</h3>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-500">{proposal.proposalFit}</p>
                <p className="mt-3 text-xs font-semibold text-blue-700">A4プレビューを開く →</p>
              </Link>
            ))}
            {proposals.length === 0 && (
              <p className="rounded-2xl bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500 md:col-span-2">監査付き企業調査が完了し、提案理由が登録された企業はありません。</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
