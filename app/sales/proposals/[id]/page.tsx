import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buildSalesProposal } from "@/lib/sales-proposal.js";
import { parseSalesLeadRecord } from "@/lib/sales-lead-record.js";
import { createClient } from "@/utils/supabase/server";
import { PrintProposalButton } from "./print-button";

export default async function SalesProposalPage({ params }: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();

  const { data: task, error } = await supabase.from("tasks")
    .select("id, content")
    .eq("id", id)
    .single();
  if (error || !task) notFound();

  const lead = parseSalesLeadRecord(String(task.id), task.content);
  const proposal = buildSalesProposal(lead);
  if (!proposal) notFound();

  return (
    <main className="sales-proposal-shell min-h-screen bg-zinc-100 px-4 py-6 text-zinc-950 md:px-8">
      <div className="sales-proposal-toolbar mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/sales/proposals" className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">提案書一覧へ戻る</Link>
        <PrintProposalButton />
      </div>

      <article className="sales-proposal-sheet mx-auto min-h-[297mm] w-[210mm] max-w-full border border-zinc-200 bg-white px-[16mm] py-[18mm] shadow-xl">
        <header className="border-b-2 border-zinc-950 pb-7">
          <p className="text-xs font-bold tracking-[0.2em] text-zinc-500">STAR WORK OS / SALES PROPOSAL</p>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">住宅設備延長保証のご提案</h1>
          <p className="mt-6 text-lg font-semibold">{proposal.companyName} 御中</p>
        </header>

        <section className="mt-9">
          <p className="text-sm leading-7 text-zinc-700">
            貴社のお客様により長く安心して住宅設備をご利用いただくため、延長保証を活用したアフターサポート体制づくりをご提案します。
          </p>
        </section>

        <section className="mt-9 rounded-2xl bg-zinc-50 p-6">
          <p className="text-xs font-bold tracking-[0.14em] text-zinc-500">BACKGROUND</p>
          <h2 className="mt-2 text-xl font-semibold">今回のご提案背景</h2>
          <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-zinc-700">{proposal.proposalFit}</p>
        </section>

        <section className="mt-9">
          <p className="text-xs font-bold tracking-[0.14em] text-zinc-500">DIRECTION</p>
          <h2 className="mt-2 text-xl font-semibold">ご提案の方向性</h2>
          <ul className="mt-5 grid gap-3 text-sm leading-6 text-zinc-700">
            <li className="rounded-xl border border-zinc-200 p-4"><strong className="text-zinc-950">安心の継続</strong><br />メーカー保証終了後も、住宅設備の不測の故障に備える選択肢を整えます。</li>
            <li className="rounded-xl border border-zinc-200 p-4"><strong className="text-zinc-950">顧客接点の強化</strong><br />引き渡し後の相談窓口を明確にし、長期的な関係づくりを支援します。</li>
            <li className="rounded-xl border border-zinc-200 p-4"><strong className="text-zinc-950">運用負担の整理</strong><br />保証受付から案内までの流れを確認し、貴社の運用に合う形を検討します。</li>
          </ul>
        </section>

        <section className="mt-9 border-t border-zinc-200 pt-7">
          <h2 className="text-lg font-semibold">次のステップ</h2>
          <p className="mt-3 text-sm leading-7 text-zinc-700">現在のアフターサポート体制とご要望をWeb面談で伺い、対象設備や運用方法を個別に整理します。</p>
        </section>

        <footer className="mt-10 border-t border-zinc-200 pt-5 text-[10px] leading-5 text-zinc-500">
          本資料はご相談用の提案下書きです。価格、保証範囲、保証期間、契約条件を確約するものではありません。正式な内容は個別確認と人間による承認後に確定します。
        </footer>
      </article>
    </main>
  );
}
