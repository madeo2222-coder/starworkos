"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

type CompleteStepButtonProps = {
  workflowId: string;
  stepName: string;
  requiresHumanApproval: boolean;
};

export default function CompleteStepButton({
  workflowId,
  stepName,
  requiresHumanApproval,
}: CompleteStepButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleComplete() {
    const confirmed = window.confirm(
      `「${stepName}」を完了し、次のSTEPへ進めますか？`,
    );

    if (!confirmed) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const supabase = createClient();

      const { data, error } = await supabase.rpc(
        "complete_current_workflow_step",
        {
          p_workflow_id: workflowId,
          p_result: `${stepName}を人間が完了確認しました。`,
        },
      );

      if (error) {
        if (error.message.includes("HUMAN_APPROVAL_REQUIRED")) {
          setMessage(
            "このSTEPは人間承認が必要です。先に承認処理を行ってください。",
          );
          return;
        }

        setMessage(`STEPの更新に失敗しました：${error.message}`);
        return;
      }

      if (data?.workflow_status === "DONE") {
        setMessage("Workflow全体が完了しました。");
      } else {
        setMessage(
          `STEP ${data?.completed_step_order}を完了し、STEP ${data?.current_step_order}へ進みました。`,
        );
      }

      router.refresh();
    } catch {
      setMessage("予期しないエラーが発生しました。");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={handleComplete}
        disabled={isLoading}
        className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading
          ? "更新中..."
          : requiresHumanApproval
            ? "承認後にSTEPを完了"
            : "現在STEPを完了"}
      </button>

      {message && (
        <p className="mt-3 rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-700">
          {message}
        </p>
      )}
    </div>
  );
}