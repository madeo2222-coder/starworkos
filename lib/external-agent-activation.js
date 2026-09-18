import { CALLBACK_MIN_SECRET_LENGTH } from "./external-agent-callback.js";
import { hasMinimumTokenLength } from "./external-agent-dispatch.js";

function parseHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export const ACTIVATION_ISSUES = Object.freeze({
  CALLBACK_SECRET: "CALLBACK_SECRET_MISSING_OR_WEAK",
  DISPATCH_TRIGGER_TOKEN: "DISPATCH_TRIGGER_TOKEN_MISSING_OR_WEAK",
  GATEWAY_TOKEN: "GATEWAY_TOKEN_MISSING_OR_WEAK",
  DISPATCH_URL: "DISPATCH_URL_INVALID",
  CALLBACK_URL: "CALLBACK_URL_INVALID",
  DISPATCH_HOST: "DISPATCH_HOST_NOT_ALLOWED",
});

export function externalAgentActivationReadiness(env = process.env) {
  const issues = [];
  const callbackSecret = env.EXTERNAL_AGENT_CALLBACK_SECRET;
  const triggerToken = env.EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN;
  const gatewayToken = env.EXTERNAL_AGENT_GATEWAY_TOKEN;
  const dispatchUrl = parseHttpsUrl(env.EXTERNAL_AGENT_DISPATCH_URL);
  const callbackUrl = parseHttpsUrl(env.EXTERNAL_AGENT_CALLBACK_URL);
  const allowedHosts = new Set(
    (env.EXTERNAL_AGENT_DISPATCH_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  );

  if (typeof callbackSecret !== "string" || callbackSecret.length < CALLBACK_MIN_SECRET_LENGTH) {
    issues.push(ACTIVATION_ISSUES.CALLBACK_SECRET);
  }
  if (!hasMinimumTokenLength(triggerToken)) {
    issues.push(ACTIVATION_ISSUES.DISPATCH_TRIGGER_TOKEN);
  }
  if (!hasMinimumTokenLength(gatewayToken)) {
    issues.push(ACTIVATION_ISSUES.GATEWAY_TOKEN);
  }
  if (!dispatchUrl) {
    issues.push(ACTIVATION_ISSUES.DISPATCH_URL);
  }
  if (!callbackUrl) {
    issues.push(ACTIVATION_ISSUES.CALLBACK_URL);
  }
  if (dispatchUrl && !allowedHosts.has(dispatchUrl.host)) {
    issues.push(ACTIVATION_ISSUES.DISPATCH_HOST);
  }

  const configured = issues.length === 0;
  const enabled = env.EXTERNAL_AGENT_DISPATCH_ENABLED === "true";

  return {
    configured,
    enabled,
    state: configured ? (enabled ? "ENABLED" : "READY_TO_ENABLE") : "NOT_READY",
    issues,
  };
}
