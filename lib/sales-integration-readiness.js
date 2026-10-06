/**
 * Reports whether each external delivery integration has been configured.
 * This module never reads secret values into UI output and never contacts a
 * provider. Actual delivery remains disabled until a separately approved gate
 * is added for each provider.
 */
export const MAX_INTEGRATION_SECRET_LENGTH = 8_192;
export const MAX_INTEGRATION_IDENTIFIER_LENGTH = 512;

export function buildSalesIntegrationReadiness(env = process.env) {
  return Object.freeze([
    readiness("EMAIL", "メール送信", "Resend", [
      ["SALES_EMAIL_PROVIDER", (value) => value === "resend"],
      ["RESEND_API_KEY", validSecret],
      ["SALES_FROM_EMAIL", validEmailAddress],
    ], env, {
      decision: "送信元メールアドレス",
      setup: "送信元メールとResend接続を管理者が登録する",
      review: "承認済み下書きで非送信確認を行う",
    }),
    readiness("LINE", "LINE送信", "LINE公式アカウント", [
      ["LINE_CHANNEL_ACCESS_TOKEN", validSecret],
      ["LINE_CHANNEL_SECRET", validSecret],
    ], env, {
      decision: "使用するLINE公式アカウント",
      setup: "使用するLINE公式アカウントを決め、接続情報を管理者が登録する",
      review: "承認済み下書きで非送信確認を行う",
    }),
    readiness("CALENDAR", "カレンダー登録", "Google カレンダー", [
      ["SALES_CALENDAR_PROVIDER", (value) => value === "google"],
      ["GOOGLE_CLIENT_ID", validIdentifier],
      ["GOOGLE_CLIENT_SECRET", validSecret],
      ["GOOGLE_REFRESH_TOKEN", validSecret],
      ["SALES_CALENDAR_ID", validIdentifier],
    ], env, {
      decision: "予定を登録するGoogleカレンダー",
      setup: "登録先のGoogleカレンダーを決め、接続情報を管理者が登録する",
      review: "予定案を確認し、登録しない状態で内容を検証する",
    }),
  ]);
}

function readiness(key, label, provider, requirements, env, nextActions) {
  const missing = requirements
    .filter(([name, validate]) => !validate(readEnvironmentValue(env, name)))
    .map(([name]) => name);
  return Object.freeze({
    key,
    label,
    provider,
    ready: missing.length === 0,
    state: missing.length === 0 ? "CONFIGURED_NOT_ENABLED" : "SETUP_REQUIRED",
    missing: Object.freeze(missing),
    deliveryEnabled: false,
    operatorDecision: nextActions.decision,
    nextAction: missing.length === 0 ? nextActions.review : nextActions.setup,
  });
}

function readEnvironmentValue(env, name) {
  try {
    if (env === null || (typeof env !== "object" && typeof env !== "function")) return undefined;
    return env[name];
  } catch {
    return undefined;
  }
}

function validConfigurationValue(value, maxLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validSecret(value) {
  return validConfigurationValue(value, MAX_INTEGRATION_SECRET_LENGTH);
}

function validIdentifier(value) {
  return validConfigurationValue(value, MAX_INTEGRATION_IDENTIFIER_LENGTH);
}

function validEmailAddress(value) {
  if (!validConfigurationValue(value, 254)) return false;

  const parts = value.split("@");
  if (parts.length !== 2) return false;

  const [localPart, domain] = parts;
  if (localPart.length === 0 || localPart.length > 64) return false;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(localPart)) return false;
  if (localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..")) return false;
  if (domain.length === 0 || domain.length > 253) return false;

  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[A-Za-z0-9-]+$/u.test(label)
    && !label.startsWith("-")
    && !label.endsWith("-")
  ));
}
