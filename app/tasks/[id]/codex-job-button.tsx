"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Feedback =
  | { kind: "idle"; message: "" }
  | { kind: "success" | "error"; message: string };

type JobResponse = {
  ok?: boolean;
  error?: string;
  job?: {
    id?: string;
    status?: string;
  };
};

const ERROR_MESSAGES: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "ログイン状態を確認してください。",
  EXTERNAL_AGENT_JOB_FORBIDDEN:
    "このプロジェクトからCodexへ渡す許可設定がまだ完了していません。",
  EXTERNAL_AGENT_JOB_RESOURCE_NOT_FOUND:
    "Taskまたは担当AIを確認できませんでした。",
  EXTERNAL_AGENT_JOB_NOT_FOUND:
    "登録したCodexジョブを確認できませんでした。",
  EXTERNAL_AGENT_JOB_NOT_QUEUED:
    "このCodexジョブはすでに実行開始済みです。",
  EXTERNAL_AGENT_JOB_NOT_ELIGIBLE:
    "このTaskの現在の状態ではCodexへ依頼できません。",
  EXTERNAL_AGENT_JOB_IDEMPOTENCY_CONFLICT:
    "同じ依頼キーが別の内容に使われています。もう一度お試しください。",
  EXTERNAL_AGENT_JOB_DUPLICATE_ACTIVE:
    "このTaskにはすでに実行中または確認待ちのCodexジョブがあります。",
  EXTERNAL_AGENT_JOB_CREATE_FAILED:
    "Codexジョブを登録できませんでした。接続設定を確認してください。",
  EXTERNAL_AGENT_JOB_PAYLOAD_TOO_LARGE:
    "依頼内容が大きすぎます。",
  EXTERNAL_AGENT_DISPATCH_DISABLED:
    "Codex実行はまだ有効化されていません。依頼はキューに保存済みです。",
  EXTERNAL_AGENT_DISPATCH_NOT_CONFIGURED:
    "Codex接続設定が不足しています。依頼はキューに保存済みです。",
  EXTERNAL_AGENT_GATEWAY_REJECTED:
    "Codex側が実行開始を受け付けませんでした。依頼はキューに保存済みです。",
  EXTERNAL_AGENT_GATEWAY_INVALID_RESPONSE:
    "Codex側の応答を確認できませんでした。依頼はキューに保存済みです。",
  EXTERNAL_AGENT_GATEWAY_UNAVAILABLE:
    "Codexへ接続できませんでした。依頼はキューに保存済みです。",
  EXTERNAL_AGENT_JOB_DISPATCH_STATE_REJECTED:
    "Codexは開始しましたが、実行状態の保存に失敗しました。管理者確認が必要です。",
};

export default function CodexJobButton({
  taskId,
  aiEmployeeId,
}: {
  taskId: string;
  aiEmployeeId: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({
    kind: "idle",
    message: "",
  });

  async function createAndStartJob() {
    setSubmitting(true);
    setFeedback({ kind: "idle", message: "" });

    try {
      const createResponse = await fetch("/api/external-agent-jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          taskId,
          aiEmployeeId,
          provider: "openai_codex",
          capability: "software_development",
          repository: "madeo2222-coder/starworkos",
          baseBranch: "main",
        }),
      });

      const createPayload = (await createResponse
        .json()
        .catch(() => ({}))) as JobResponse;

      if (!createResponse.ok || !createPayload.ok) {
        if (createResponse.status === 401) {
          router.push("/login");
          return;
        }

        const code = createPayload.error ?? "";
        setFeedback({
          kind: "error",
          message:
            ERROR_MESSAGES[code] ??
            "Codexジョブを登録できませんでした。画面を更新してもう一度お試しください。",
        });
        return;
      }

      const jobId = createPayload.job?.id;
      if (!jobId) {
        setFeedback({
          kind: "error",
          message:
            "Codexジョブは登録されましたが、実行開始用のIDを取得できませんでした。",
        });
        router.refresh();
        return;
      }

      const startResponse = await fetch(
        `/api/external-agent-jobs/${encodeURIComponent(jobId)}/start`,
        { method: "POST" },
      );
      const startPayload = (await startResponse
        .json()
        .catch(() => ({}))) as JobResponse;

      if (!startResponse.ok || !startPayload.ok) {
        if (startResponse.status === 401) {
          router.push("/login");
          return;
        }

        const code = startPayload.error ?? "";
        setFeedback({
          kind: "error",
          message:
            ERROR_MESSAGES[code] ??
            "依頼はキューに保存済みですが、Codexの実行開始に失敗しました。",
        });
        router.refresh();
        return;
      }

      setFeedback({
        kind: "success",
        message:
          "Codexへ開発依頼を渡し、実行を開始しました。状態はこの画面で確認できます。",
      });
      router.refresh();
    } catch {
      setFeedback({
        kind: "error",
        message:
          "Codexとの通信に失敗しました。保存済み状態を画面更新後に確認してください。",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={createAndStartJob}
        disabled={submitting}
        className="rounded-xl bg-violet-700 px-6 py-3 text-sm font-bold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Codexへ引継ぎ中…" : "Codexへ開発依頼を開始"}
      </button>

      {feedback.kind !== "idle" && (
        <p
          className={`mt-3 rounded-lg p-3 text-sm leading-6 ${
            feedback.kind === "success"
              ? "bg-emerald-100 text-emerald-900"
              : "bg-red-100 text-red-900"
          }`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
