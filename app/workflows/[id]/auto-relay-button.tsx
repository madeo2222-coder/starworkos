"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

type AutoRelayButtonProps = {
  workflowId: string;
};

type WorkflowRow = {
  id: string;
  status: string;
  current_step_order: number;
};

type WorkflowStepRow = {
  id: string;
  step_order: number;
  name: string;
  status: string;
  requires_human_approval: boolean | null;
};

type RunAiResponse = {
  ok?: boolean;
  error?: string;
};

type CompleteStepResponse = {
  workflow_status?: string;
  completed_step_order?: number;
  current_step_order?: number;
};

const MAX_RELAY_STEPS = 20;

export default function AutoRelayButton({
  workflowId,
}: AutoRelayButtonProps) {
  const router = useRouter();

  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [currentAction, setCurrentAction] = useState("");
  const [completedCount, setCompletedCount] = useState(0);

  async function handleAutoRelay() {
    const confirmed = window.confirm(
      [
        "現在のSTEPからAI社員の自動リレーを開始します。",
        "",
        "AI実行に成功したSTEPだけを完了し、次工程へ進めます。",
        "人間承認が必要なSTEPまたはエラーが発生したSTEPで停止します。",
        "",
        "開始してよろしいですか？",
      ].join("\n"),
    );

    if (!confirmed) {
      return;
    }

    setIsRunning(true);
    setMessage("");
    setCurrentAction("");
    setCompletedCount(0);

    const supabase = createClient();

    try {
      for (
        let relayCount = 0;
        relayCount < MAX_RELAY_STEPS;
        relayCount += 1
      ) {
        const { data: workflowData, error: workflowError } =
          await supabase
            .from("workflows")
            .select(`
              id,
              status,
              current_step_order
            `)
            .eq("id", workflowId)
            .maybeSingle();

        if (workflowError) {
          throw new Error(
            `Workflowの取得に失敗しました：${workflowError.message}`,
          );
        }

        if (!workflowData) {
          throw new Error("対象のWorkflowが見つかりません。");
        }

        const workflow = workflowData as WorkflowRow;

        if (workflow.status === "DONE") {
          setCurrentAction("");
          setMessage(
            `Workflow全体が完了しました。完了STEP数：${relayCount}`,
          );
          router.refresh();
          return;
        }

        const { data: stepData, error: stepError } =
          await supabase
            .from("workflow_steps")
            .select(`
              id,
              step_order,
              name,
              status,
              requires_human_approval
            `)
            .eq("workflow_id", workflowId)
            .eq("step_order", workflow.current_step_order)
            .maybeSingle();

        if (stepError) {
          throw new Error(
            `現在STEPの取得に失敗しました：${stepError.message}`,
          );
        }

        if (!stepData) {
          throw new Error(
            `STEP ${workflow.current_step_order}が見つかりません。`,
          );
        }

        const step = stepData as WorkflowStepRow;

        if (step.requires_human_approval) {
          setCurrentAction("");
          setMessage(
            [
              `STEP ${step.step_order}「${step.name}」で停止しました。`,
              "この工程は人間の承認が必要です。",
              "内容を確認して承認後、再度自動リレーを実行してください。",
            ].join("\n"),
          );

          router.refresh();
          return;
        }

        setCurrentAction(
          `STEP ${step.step_order}「${step.name}」をAI社員が処理しています...`,
        );

        const aiResponse = await fetch(
          `/api/workflow-steps/${step.id}/run-ai`,
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

        const aiResult =
          (await aiResponse.json()) as RunAiResponse;

        if (!aiResponse.ok || !aiResult.ok) {
          throw new Error(
            [
              `STEP ${step.step_order}「${step.name}」でAI実行に失敗しました。`,
              aiResult.error ??
                "AI社員から正常な結果を取得できませんでした。",
            ].join("\n"),
          );
        }

        setCurrentAction(
          `STEP ${step.step_order}「${step.name}」を完了処理しています...`,
        );

        const { data: completeData, error: completeError } =
          await supabase.rpc(
            "complete_current_workflow_step",
            {
              p_workflow_id: workflowId,
              p_result: [
                `STEP ${step.step_order}「${step.name}」`,
                "AI社員の実行成功を確認し、自動リレーで完了しました。",
              ].join("："),
            },
          );

        if (completeError) {
          if (
            completeError.message.includes(
              "HUMAN_APPROVAL_REQUIRED",
            )
          ) {
            setCurrentAction("");
            setMessage(
              [
                `STEP ${step.step_order}「${step.name}」で停止しました。`,
                "この工程は人間の承認が必要です。",
              ].join("\n"),
            );

            router.refresh();
            return;
          }

          throw new Error(
            [
              `STEP ${step.step_order}「${step.name}」の完了処理に失敗しました。`,
              completeError.message,
            ].join("\n"),
          );
        }

        const completed =
          completeData as CompleteStepResponse | null;

        const newCompletedCount = relayCount + 1;
        setCompletedCount(newCompletedCount);

        if (completed?.workflow_status === "DONE") {
          setCurrentAction("");
          setMessage(
            `Workflow全体が完了しました。完了STEP数：${newCompletedCount}`,
          );

          router.refresh();
          return;
        }

        setMessage(
          [
            `STEP ${step.step_order}「${step.name}」が完了しました。`,
            completed?.current_step_order
              ? `STEP ${completed.current_step_order}へ進みます。`
              : "次のSTEPへ進みます。",
          ].join("\n"),
        );

        router.refresh();
      }

      throw new Error(
        `安全上の上限である${MAX_RELAY_STEPS}工程に到達したため停止しました。`,
      );
    } catch (error) {
      setCurrentAction("");

      setMessage(
        error instanceof Error
          ? error.message
          : "自動リレー中に予期しないエラーが発生しました。",
      );

      router.refresh();
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
      <div>
        <p className="text-sm font-bold text-blue-900">
          AI社員 自動リレー
        </p>

        <p className="mt-2 text-sm leading-6 text-blue-800">
          現在のSTEPから、AI PM・AI Architect・AI
          Developer・AI QA・AI Knowledgeへ順番に仕事を引き継ぎます。
        </p>
      </div>

      <button
        type="button"
        onClick={handleAutoRelay}
        disabled={isRunning}
        className="mt-4 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRunning
          ? "AI社員が自動リレー中..."
          : "全工程をAI社員へ依頼する"}
      </button>

      {isRunning && (
        <div className="mt-4 rounded-xl bg-white p-4">
          <p className="text-xs font-bold text-blue-700">
            完了STEP数：{completedCount}
          </p>

          <p className="mt-2 text-sm text-gray-700">
            {currentAction || "処理を準備しています..."}
          </p>
        </div>
      )}

      {message && (
        <p className="mt-4 whitespace-pre-wrap rounded-xl bg-white px-4 py-3 text-sm leading-6 text-gray-700">
          {message}
        </p>
      )}
    </div>
  );
}