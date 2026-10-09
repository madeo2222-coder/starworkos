"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Feedback =
  | { kind: "idle"; message: "" }
  | { kind: "success" | "error"; message: string };

type CreateJobResponse = {
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

  async function createJob() {
    setSubmitting(true);
    setFeedback({ kind: "idle", message: "" });

    try {
      const response = await fetch("/api/external-agent-jobs", {
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

      const payload = (await response.json().catch(() => ({}))) as CreateJobResponse;

      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          router.push("/login");
          return;
        }

        const code = payload.error ?? "";
        setFeedback({
          kind: "error",
          message:
            ERROR_MESSAGES[code] ??
            "Codexジョブを登録できませんでした。画面を更新してもう一度お試しください。",
        });
        return;
      }

      setFeedback({
        kind: "success",
        message:
          "Codex連携キューへ登録しました。自動実行が始まると状態が「実行中」に変わります。",
      });
      router.refresh();
    } catch {
      setFeedback({
        kind: "error",
        message:
          "Codexジョブの登録通信に失敗しました。接続を確認してもう一度お試しください。",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={createJob}
        disabled={submitting}
        className="rounded-xl bg-violet-700 px-6 py-3 text-sm font-bold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Codex連携キューへ登録中…" : "Codexへ開発依頼を登録"}
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
