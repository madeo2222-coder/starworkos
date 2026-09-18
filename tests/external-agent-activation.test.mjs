import test from "node:test";
import assert from "node:assert/strict";
import { externalAgentActivationReadiness } from "../lib/external-agent-activation.js";

const readyEnv = {
  EXTERNAL_AGENT_CALLBACK_SECRET: "c".repeat(32),
  EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN: "t".repeat(16),
  EXTERNAL_AGENT_GATEWAY_TOKEN: "g".repeat(16),
  EXTERNAL_AGENT_DISPATCH_URL: "https://gateway.example.test/jobs",
  EXTERNAL_AGENT_CALLBACK_URL: "https://work.example.test/api/internal/external-agent-jobs/callback",
  EXTERNAL_AGENT_DISPATCH_ALLOWED_HOSTS: "gateway.example.test",
};

test("preflight can validate a fully configured integration while dispatch stays disabled", () => {
  assert.deepEqual(externalAgentActivationReadiness(readyEnv), {
    configured: true,
    enabled: false,
    state: "READY_TO_ENABLE",
    issues: [],
  });
});

test("preflight reports enabled separately from configuration readiness", () => {
  assert.deepEqual(externalAgentActivationReadiness({
    ...readyEnv,
    EXTERNAL_AGENT_DISPATCH_ENABLED: "true",
  }), {
    configured: true,
    enabled: true,
    state: "ENABLED",
    issues: [],
  });
});

test("preflight fails closed without exposing secret values", () => {
  const result = externalAgentActivationReadiness({
    EXTERNAL_AGENT_CALLBACK_SECRET: "short",
    EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN: "",
    EXTERNAL_AGENT_GATEWAY_TOKEN: "short",
    EXTERNAL_AGENT_DISPATCH_URL: "http://gateway.example.test/jobs",
    EXTERNAL_AGENT_CALLBACK_URL: "not-a-url",
    EXTERNAL_AGENT_DISPATCH_ALLOWED_HOSTS: "other.example.test",
  });

  assert.equal(result.configured, false);
  assert.equal(result.state, "NOT_READY");
  assert.deepEqual(result.issues.sort(), [
    "CALLBACK_SECRET_MISSING_OR_WEAK",
    "CALLBACK_URL_INVALID",
    "DISPATCH_TRIGGER_TOKEN_MISSING_OR_WEAK",
    "DISPATCH_URL_INVALID",
    "GATEWAY_TOKEN_MISSING_OR_WEAK",
  ].sort());

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /short|gatewayToken|callbackSecret|triggerToken/);
});

test("preflight rejects a gateway host that is not explicitly allowlisted", () => {
  const result = externalAgentActivationReadiness({
    ...readyEnv,
    EXTERNAL_AGENT_DISPATCH_ALLOWED_HOSTS: "different.example.test",
  });
  assert.equal(result.configured, false);
  assert.deepEqual(result.issues, ["DISPATCH_HOST_NOT_ALLOWED"]);
});
