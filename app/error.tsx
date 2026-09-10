"use client";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ reset }: ErrorPageProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-7 text-center shadow-sm">
        <p className="text-sm font-semibold text-zinc-500">STAR WORK OS</p>
        <h1 className="mt-3 text-2xl font-bold text-zinc-950">
          画面を表示できませんでした
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          一時的な問題が発生しました。時間をおいて再試行してください。
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-xl bg-zinc-950 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800"
        >
          再試行する
        </button>
      </section>
    </main>
  );
}
