/**
 * Human-gated rollout sequence for sales integrations.
 *
 * This plan is intentionally descriptive: it never enables delivery, performs
 * provider requests, or treats configuration readiness as permission to send.
 */
export const SALES_INTEGRATION_ACTIVATION_PLAN = Object.freeze([
  phase(
    "DECIDE_DESTINATION",
    "接続先を決める",
    "送信元メール、LINE公式アカウント、登録先カレンダーを利用者が指定します。",
    "OPERATOR_DECISION",
  ),
  phase(
    "CONFIGURE_CONNECTION",
    "管理者が接続情報を設定",
    "秘密情報を画面へ出さず、管理者だけが接続情報を登録します。",
    "ADMIN_CONFIGURATION",
  ),
  phase(
    "REVIEW_DRAFT",
    "非送信で下書きを確認",
    "外部へ送信・登録せず、宛先と内容だけを確認します。",
    "NO_EXTERNAL_REQUEST",
  ),
  phase(
    "HUMAN_APPROVAL",
    "人が宛先と内容を承認",
    "実行対象を1件に限定し、担当者が最終確認します。",
    "HUMAN_GATE",
  ),
  phase(
    "SINGLE_ITEM_TEST",
    "別承認後に1件だけテスト",
    "この画面では解禁しません。実行機能の追加と別承認が必要です。",
    "SEPARATE_APPROVAL_REQUIRED",
    true,
  ),
]);

export function buildSalesIntegrationActivationProgress(readiness) {
  const configured = isConfiguredButDisabled(readiness);
  const currentPhaseIndex = configured ? 2 : 0;

  return Object.freeze({
    currentStep: currentPhaseIndex + 1,
    totalSteps: SALES_INTEGRATION_ACTIVATION_PLAN.length,
    currentPhase: SALES_INTEGRATION_ACTIVATION_PLAN[currentPhaseIndex],
    completedPhaseKeys: Object.freeze(
      SALES_INTEGRATION_ACTIVATION_PLAN
        .slice(0, currentPhaseIndex)
        .map(({ key }) => key),
    ),
    externalExecutionAllowed: false,
  });
}

function isConfiguredButDisabled(readiness) {
  try {
    return readiness !== null
      && (typeof readiness === "object" || typeof readiness === "function")
      && readiness.ready === true
      && readiness.state === "CONFIGURED_NOT_ENABLED"
      && readiness.deliveryEnabled === false;
  } catch {
    return false;
  }
}

function phase(key, label, description, gate, requiresSeparateApproval = false) {
  return Object.freeze({
    key,
    label,
    description,
    gate,
    requiresSeparateApproval,
    externalExecutionAllowed: false,
  });
}
