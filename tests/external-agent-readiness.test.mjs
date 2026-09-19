import test from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedDispatchTrigger } from "../lib/external-agent-dispatch.js";
import { externalAgentActivationReadiness } from "../lib/external-agent-activation.js";

const readyEnv = {
  EXTERNAL_AGENT_CALLBACK_SECRET: "c".repeat(32),
  EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN: "t".repeat(16),
  EXTERNAL_AGENT_GATEWAY_TOKEN: "g".repeat(16),
  EXTERNAL_AGENT_DISPATCH_URL: "https://gateway.example.test/jobs",
  EXTERNAL_AGENT_CALLBACK_URL: "https://work.example.test/api/internal/external-agent-jobs/callback",
  EXTERNAL_AGENT_DISPATCH_ALLOWED_HOSTS: "gateway.example.test",
};

test("readiness authentication fails closed when trigger token is missing or weak", () => {
  assert.equal(isAuthorizedDispatchTrigger({}, "anything"), false);
  assert.equal(isAuthorizedDispatchTrigger({ EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN: "short" }, "short"), false);
});

test("readiness authentication requires an exact trigger token match", () => {
  const env = { EXTERNAL_AGENT_DISPATCH_TRIGGER_TOKEN: "t".repeat(16) };
  assert.equal(isAuthorizedDispatchTrigger(env, "x".repeat(16)), false);
  assert.equal(isAuthorizedDispatchTrigger(env, "t".repeat(16)), true);
});

test("readiness output exposes state and issue codes without secret values", () => {
  const result = externalAgentActivationReadiness(readyEnv);
  assert.deepEqual(result, {
    configured: true,
    enabled: false,
    state: "READY_TO_ENABLE",
    issues: [],
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /cccc|tttt|gggg/);
});
