"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ResultResponse = {
  ok?: boolean;
  state?: string;
  error?: string;
};

const ERROR_MESSAGES: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "ログイン状態を確認してください。",
  EXTERNAL_AGENT_JOB_FORBIDDEN:
    "このCodexジョブを確認する権限がありません。",
  AGENTS_RECONCILE_NOT_CONFIGURED:
    "成果回収の接続設定が不足しています。",
  AGENTS_API_BACKEND_DISABLED:
    "Agents APIがまだ有効化されていません。",
  AGENTS_API_NOT_CONFIGURED:
    "OpenAI Agents APIの設定が不足しています。",
  AGENTS_RECONCILE_GITHUB_NOT_CONFIGURED:
    "GitHub PR生成用の設定が不足しています。",
  AGENTS_RECONCILE_SESSION_LOOKUP_FAILED:
    "Codexの実行状態を取得できませんでした。",
  AGENTS_SESSION_FAILED:
    "Codex側の実行が失敗しました。",
  AGENTS_SESSION_REQUIRES_ACTION:
    "Codex側で追加操作が必要です。",
  AGENTS_ROOT_TURN_FAILED:
    "Codexの開発処理が失敗またはキャンセルされました。",
  AGENTS_RESULT_ARTIFACT_MISSING:
    "Codexの成果ファイルがまだ見つかりません。",
  AGENTS_RESULT_ARTIFACT_INVALID:
    "Codexの成果ファイルを安全に取り込めませんでした。",
  AGENTS_RECONCILE_UNAVAILABLE:
    "成果回収処理へ接続できませんでした。",
};

export default function CodexResultButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function reconcile() {
    setChecking(true);
    setMessage("");
    setFailed(false);

    try {
      const response = await fetch(
        `/api/external-agent-jobs/${encodeURIComponent(jobId)}/reconcile`,
        { method: "POST" },
      );
      const payload = (await response
        .json()
        .catch(() => ({}))) as ResultResponse;

      if (response.status === 401) {
        router.push("/login");
        return;
      }

      if (!response.ok || !payload.ok) {
        setFailed(true);
        setMessage(
          ERROR_MESSAGES[payload.error ?? ""] ??
            "成果回収に失敗しました。状態を更新してもう一度お試しください。",
        );
        router.refresh();
        return;
      }

      if (payload.state === "WAITING_HUMAN_APPROVAL") {
        setMessage(
          "Codexの成果を回収し、確認用GitHub PRを作成しました。",
        );
      } else {
        setMessage(
          "Codexはまだ実行中です。少し待ってからもう一度確認してください。",
        );
      }
      router.refresh();
    } catch {
      setFailed(true);
      setMessage(
        "成果回収の通信に失敗しました。画面更新後に状態を確認してください。",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={reconcile}
        disabled={checking}
        className="rounded-xl border border-violet-300 bg-white px-6 py-3 text-sm font-bold text-violet-900 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {checking ? "Codexの成果を確認中…" : "Codexの成果を取得・確認"}
      </button>

      {message && (
        <p
          className={`mt-3 rounded-lg p-3 text-sm leading-6 ${
            failed
              ? "bg-red-100 text-red-900"
              : "bg-emerald-100 text-emerald-900"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
