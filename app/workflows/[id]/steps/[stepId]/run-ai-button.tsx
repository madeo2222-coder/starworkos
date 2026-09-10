"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type RunAiButtonProps = {
  workflowId: string;
  stepId: string;
};

type RunAiResponse = {
  ok?: boolean;
};

class RunAiUserError extends Error {}

function getRunAiFailureMessage(status: number) {
  if (status === 401) return "ログインし直して、もう一度お試しください。";
  if (status === 404) return "対象のWorkflow STEPが見つかりません。";
  if (status === 409) {
    return "Workflow STEPの状態が変更されたか、すでにAI実行中です。画面を更新してください。";
  }
  if (status === 413) return "AI実行リクエストが大きすぎます。";
  if (status === 503) return "AI実行の設定を確認してください。";

  return "AI社員への依頼に失敗しました。時間を置いて、もう一度お試しください。";
}

export default function RunAiButton({
  workflowId,
  stepId,
}: RunAiButtonProps) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState("");

  async function handleRunAi() {
    setIsRunning(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/workflow-steps/${stepId}/run-ai`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflowId,
          }),
        },
      );

      let result: RunAiResponse | null = null;

      try {
        const parsed: unknown = await response.json();
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          result = parsed as RunAiResponse;
        }
      } catch {
        // The response may be an HTML error page. Its parser error is not user-facing.
      }

      if (!response.ok || !result?.ok) {
        throw new RunAiUserError(getRunAiFailureMessage(response.status));
      }

      setMessage("AI社員の作業が完了しました。");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof RunAiUserError
          ? error.message
          : "AI社員の実行中に問題が発生しました。通信状態を確認して、もう一度お試しください。",
      );
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleRunAi}
        disabled={isRunning}
        className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRunning ? "AI社員が作業中..." : "AI社員へ依頼する"}
      </button>

      {message && (
        <p className="mt-3 text-sm text-gray-700">{message}</p>
      )}
    </div>
  );
}
