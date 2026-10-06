import test from "node:test";
import assert from "node:assert/strict";
import {
  SALES_INTEGRATION_ACTIVATION_PLAN,
  buildSalesIntegrationActivationProgress,
} from "../lib/sales-integration-activation-plan.js";

test("keeps every activation phase descriptive and external execution disabled", () => {
  assert.equal(Object.isFrozen(SALES_INTEGRATION_ACTIVATION_PLAN), true);
  assert.equal(SALES_INTEGRATION_ACTIVATION_PLAN.length, 5);
  assert.equal(SALES_INTEGRATION_ACTIVATION_PLAN.every((phase) => (
    Object.isFrozen(phase) && phase.externalExecutionAllowed === false
  )), true);
});

test("requires a separate approval before the single-item test", () => {
  const finalPhase = SALES_INTEGRATION_ACTIVATION_PLAN.at(-1);

  assert.deepEqual({
    key: finalPhase.key,
    gate: finalPhase.gate,
    requiresSeparateApproval: finalPhase.requiresSeparateApproval,
    externalExecutionAllowed: finalPhase.externalExecutionAllowed,
  }, {
    key: "SINGLE_ITEM_TEST",
    gate: "SEPARATE_APPROVAL_REQUIRED",
    requiresSeparateApproval: true,
    externalExecutionAllowed: false,
  });
});

test("keeps non-send review and human approval ahead of any test", () => {
  assert.deepEqual(SALES_INTEGRATION_ACTIVATION_PLAN.map(({ key }) => key), [
    "DECIDE_DESTINATION",
    "CONFIGURE_CONNECTION",
    "REVIEW_DRAFT",
    "HUMAN_APPROVAL",
    "SINGLE_ITEM_TEST",
  ]);
});

test("moves configured but disabled integrations only to non-send review", () => {
  const progress = buildSalesIntegrationActivationProgress({
    ready: true,
    state: "CONFIGURED_NOT_ENABLED",
    deliveryEnabled: false,
  });

  assert.deepEqual({
    currentStep: progress.currentStep,
    totalSteps: progress.totalSteps,
    currentPhaseKey: progress.currentPhase.key,
    completedPhaseKeys: progress.completedPhaseKeys,
    externalExecutionAllowed: progress.externalExecutionAllowed,
  }, {
    currentStep: 3,
    totalSteps: 5,
    currentPhaseKey: "REVIEW_DRAFT",
    completedPhaseKeys: ["DECIDE_DESTINATION", "CONFIGURE_CONNECTION"],
    externalExecutionAllowed: false,
  });
  assert.equal(Object.isFrozen(progress), true);
  assert.equal(Object.isFrozen(progress.completedPhaseKeys), true);
});

test("fails closed at the operator decision for inconsistent or hostile readiness", () => {
  const hostileReadiness = new Proxy({}, {
    get() {
      throw new Error("readiness unavailable");
    },
  });

  for (const readiness of [
    null,
    { ready: false, state: "SETUP_REQUIRED", deliveryEnabled: false },
    { ready: true, state: "CONFIGURED_NOT_ENABLED", deliveryEnabled: true },
    hostileReadiness,
  ]) {
    const progress = buildSalesIntegrationActivationProgress(readiness);
    assert.equal(progress.currentStep, 1);
    assert.equal(progress.currentPhase.key, "DECIDE_DESTINATION");
    assert.equal(progress.externalExecutionAllowed, false);
  }
});
