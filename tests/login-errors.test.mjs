import test from "node:test";
import assert from "node:assert/strict";
import {
  getLoginSendErrorMessage,
  getLoginCallbackErrorCode,
  getLoginCallbackErrorMessage,
} from "../lib/login-errors.js";

test("email limits and delivery restrictions give different actionable messages", () => {
  assert.match(getLoginSendErrorMessage({ code: "over_email_send_rate_limit" }), /時間を置いて/);
  assert.match(getLoginSendErrorMessage({ code: "email_address_not_authorized" }), /配信設定/);
  assert.match(getLoginSendErrorMessage({ status: 429 }), /上限/);
});

test("missing browser state, mismatched links, and expired links remain distinct", () => {
  const missing = getLoginCallbackErrorCode({ code: "pkce_code_verifier_not_found" });
  assert.match(getLoginCallbackErrorMessage(missing), /同じSafari/);
  const mismatch = getLoginCallbackErrorCode({ code: "bad_code_verifier" });
  assert.notEqual(missing, mismatch);
  assert.match(getLoginCallbackErrorMessage(mismatch), /最後に届いた/);
  for (const code of ["otp_expired", "flow_state_expired", "flow_state_not_found"]) {
    assert.match(getLoginCallbackErrorMessage(getLoginCallbackErrorCode({ code })), /期限切れ/);
  }
});

test("provider details and arbitrary callback query values never reach the UI or redirect", () => {
  const sensitive = "token-secret https://internal.example/";
  const error = { code: sensitive, message: sensitive, status: 500 };
  assert.equal(getLoginCallbackErrorCode(error), "auth_callback_failed");
  assert.equal(getLoginCallbackErrorMessage(sensitive), "");
  assert.ok(!getLoginSendErrorMessage(error).includes(sensitive));
  assert.ok(!getLoginCallbackErrorMessage(getLoginCallbackErrorCode(error)).includes(sensitive));
});
