"use client";

export function PrintProposalButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800">
      印刷・PDF保存
    </button>
  );
}
