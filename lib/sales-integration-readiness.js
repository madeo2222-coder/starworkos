/**
 * Reports whether each external delivery integration has been configured.
 * This module never reads secret values into UI output and never contacts a
 * provider. Actual delivery remains disabled until a separately approved gate
 * is added for each provider.
 */
export function buildSalesIntegrationReadiness(env = process.env) {
  return Object.freeze([
    readiness("EMAIL", "メール送信", "Resend", [
      "SALES_EMAIL_PROVIDER",
      "RESEND_API_KEY",
      "SALES_FROM_EMAIL",
    ], env),
    readiness("LINE", "LINE送信", "LINE公式アカウント", [
      "LINE_CHANNEL_ACCESS_TOKEN",
      "LINE_CHANNEL_SECRET",
    ], env),
    readiness("CALENDAR", "カレンダー登録", "Google カレンダー", [
      "SALES_CALENDAR_PROVIDER",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REFRESH_TOKEN",
      "SALES_CALENDAR_ID",
    ], env),
  ]);
}

function readiness(key, label, provider, requiredKeys, env) {
  const missing = requiredKeys.filter((name) => !configured(env?.[name]));
  return Object.freeze({
    key,
    label,
    provider,
    ready: missing.length === 0,
    state: missing.length === 0 ? "CONFIGURED_NOT_ENABLED" : "SETUP_REQUIRED",
    missing: Object.freeze(missing),
    deliveryEnabled: false,
  });
}

function configured(value) {
  return typeof value === "string" && value.trim().length > 0;
}
