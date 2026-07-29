"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type RunAiButtonProps = {
  workflowId: string;
  stepId: string;
};

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

      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "AI社員への依頼に失敗しました。",
        );
      }

      setMessage("AI社員の作業が完了しました。");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "AI社員の実行中にエラーが発生しました。",
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