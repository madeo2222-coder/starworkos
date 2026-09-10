const KNOWN_EXECUTION_ERROR_MESSAGES = [
  ["AI_PROVIDER_TIMEOUT", "AI提供元から規定時間内に回答を取得できませんでした。"],
  ["AI_PROVIDER_RATE_LIMIT", "AI提供元の利用上限により実行できませんでした。"],
  ["AI_PROVIDER_CONFIGURATION", "AI提供元の認証または設定を確認してください。"],
  ["AI_PROVIDER_UNAVAILABLE", "AI提供元へ接続できませんでした。"],
  ["AI_PROVIDER_REQUEST_REJECTED", "AI提供元がリクエストを受理しませんでした。"],
  ["AI_RESPONSE_INCOMPLETE", "AI提供元の回答が完了しませんでした。"],
  ["AI_RESPONSE_INVALID", "AI回答が所定の保存形式を満たしませんでした。"],
  ["AI_PROMPT_TOO_LARGE", "AI実行に使用する業務情報が上限を超えました。"],
  ["AI_RESULT_PERSISTENCE_FAILED", "AI実行結果を確定できませんでした。"],
  ["WORKFLOW_DATABASE_FAILED", "Workflow関連データの取得または保存に失敗しました。"],
  ["WORKFLOW_AI_EXECUTION_FAILED", "AI社員の実行中に問題が発生しました。"],
  ["EXTERNAL_AGENT", "外部エージェントの実行に失敗しました。"],
];

/**
 * Converts an audit value into a user-safe execution history message.
 * Database rows can outlive the code that wrote them, so never render an
 * unrecognized value directly to a browser.
 *
 * @param {unknown} value
 */
export function getExecutionErrorDisplayMessage(value) {
  const auditValue = typeof value === "string" ? value : "";

  for (const [code, message] of KNOWN_EXECUTION_ERROR_MESSAGES) {
    if (auditValue.includes(code)) {
      return message;
    }
  }

  return "実行に失敗しました。実行条件を確認して、もう一度お試しください。";
}
