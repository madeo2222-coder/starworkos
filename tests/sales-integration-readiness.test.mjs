import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_INTEGRATION_IDENTIFIER_LENGTH,
  MAX_INTEGRATION_SECRET_LENGTH,
  buildSalesIntegrationReadiness,
} from "../lib/sales-integration-readiness.js";

test("reports only configuration state and never enables delivery", () => {
  const integrations = buildSalesIntegrationReadiness({
    SALES_EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "secret",
    SALES_FROM_EMAIL: "sales@example.com",
    LINE_CHANNEL_ACCESS_TOKEN: "token",
    LINE_CHANNEL_SECRET: "secret",
    SALES_CALENDAR_PROVIDER: "google",
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_REFRESH_TOKEN: "refresh-token",
    SALES_CALENDAR_ID: "primary",
  });

  assert.deepEqual(integrations.map(({ key, state, deliveryEnabled, missing }) => ({
    key, state, deliveryEnabled, missing,
  })), [
    { key: "EMAIL", state: "CONFIGURED_NOT_ENABLED", deliveryEnabled: false, missing: [] },
    { key: "LINE", state: "CONFIGURED_NOT_ENABLED", deliveryEnabled: false, missing: [] },
    { key: "CALENDAR", state: "CONFIGURED_NOT_ENABLED", deliveryEnabled: false, missing: [] },
  ]);
  assert.deepEqual(integrations.map(({ key, nextAction }) => ({ key, nextAction })), [
    { key: "EMAIL", nextAction: "承認済み下書きで非送信確認を行う" },
    { key: "LINE", nextAction: "承認済み下書きで非送信確認を行う" },
    { key: "CALENDAR", nextAction: "予定案を確認し、登録しない状態で内容を検証する" },
  ]);
  assert.deepEqual(integrations.map(({ key, operatorDecision }) => ({ key, operatorDecision })), [
    { key: "EMAIL", operatorDecision: "送信元メールアドレス" },
    { key: "LINE", operatorDecision: "使用するLINE公式アカウント" },
    { key: "CALENDAR", operatorDecision: "予定を登録するGoogleカレンダー" },
  ]);
});

test("identifies missing setup keys without exposing secret values", () => {
  const [email, line, calendar] = buildSalesIntegrationReadiness({
    SALES_EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: " ",
    SALES_CALENDAR_PROVIDER: "google",
  });

  assert.equal(email.ready, false);
  assert.deepEqual(email.missing, ["RESEND_API_KEY", "SALES_FROM_EMAIL"]);
  assert.deepEqual(line.missing, ["LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET"]);
  assert.deepEqual(calendar.missing, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "SALES_CALENDAR_ID"]);
  assert.equal(email.deliveryEnabled, false);
  assert.equal(line.deliveryEnabled, false);
  assert.equal(calendar.deliveryEnabled, false);
  assert.equal(email.nextAction, "送信元メールとResend接続を管理者が登録する");
  assert.equal(line.nextAction, "使用するLINE公式アカウントを決め、接続情報を管理者が登録する");
  assert.equal(calendar.nextAction, "登録先のGoogleカレンダーを決め、接続情報を管理者が登録する");
});

test("rejects unsupported providers and malformed sender addresses", () => {
  const secret = "must-never-appear";
  const [email, line, calendar] = buildSalesIntegrationReadiness({
    SALES_EMAIL_PROVIDER: "smtp",
    RESEND_API_KEY: secret,
    SALES_FROM_EMAIL: "invalid-address",
    LINE_CHANNEL_ACCESS_TOKEN: secret,
    LINE_CHANNEL_SECRET: secret,
    SALES_CALENDAR_PROVIDER: "outlook",
    GOOGLE_CLIENT_ID: secret,
    GOOGLE_CLIENT_SECRET: secret,
    GOOGLE_REFRESH_TOKEN: secret,
    SALES_CALENDAR_ID: "primary",
  });

  assert.deepEqual(email.missing, ["SALES_EMAIL_PROVIDER", "SALES_FROM_EMAIL"]);
  assert.deepEqual(line.missing, []);
  assert.deepEqual(calendar.missing, ["SALES_CALENDAR_PROVIDER"]);
  assert.equal(JSON.stringify([email, line, calendar]).includes(secret), false);
});

test("accepts an ASCII sender mailbox with subdomains and addressing tags", () => {
  const [email] = buildSalesIntegrationReadiness({
    SALES_EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "secret",
    SALES_FROM_EMAIL: "sales+tokyo@example.co.jp",
  });

  assert.equal(email.ready, true);
  assert.equal(email.state, "CONFIGURED_NOT_ENABLED");
  assert.deepEqual(email.missing, []);
  assert.equal(email.deliveryEnabled, false);
});

test("fails closed for structurally unsafe sender mailboxes", () => {
  const unsafeAddresses = [
    "sales@@example.com",
    ".sales@example.com",
    "sales.@example.com",
    "sales..team@example.com",
    "sales@example..com",
    "sales@-example.com",
    "sales@example-.com",
    "sales@example",
    "sales@exa_mple.com",
    "営業@example.com",
    `${"x".repeat(65)}@example.com`,
  ];

  for (const address of unsafeAddresses) {
    const [email] = buildSalesIntegrationReadiness({
      SALES_EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "must-never-appear",
      SALES_FROM_EMAIL: address,
    });

    assert.equal(email.ready, false, address);
    assert.equal(email.state, "SETUP_REQUIRED", address);
    assert.deepEqual(email.missing, ["SALES_FROM_EMAIL"], address);
    assert.equal(email.deliveryEnabled, false, address);
    assert.equal(JSON.stringify(email).includes(address), false, address);
  }
});

test("fails closed when configuration access throws", () => {
  const hostileEnvironment = new Proxy({}, {
    get() {
      throw new Error("configuration access blocked");
    },
  });

  const integrations = buildSalesIntegrationReadiness(hostileEnvironment);

  assert.deepEqual(integrations.map(({ state, ready, deliveryEnabled }) => ({
    state, ready, deliveryEnabled,
  })), [
    { state: "SETUP_REQUIRED", ready: false, deliveryEnabled: false },
    { state: "SETUP_REQUIRED", ready: false, deliveryEnabled: false },
    { state: "SETUP_REQUIRED", ready: false, deliveryEnabled: false },
  ]);
});

test("rejects oversized, padded, and control-character configuration values", () => {
  const oversizedSecret = "x".repeat(MAX_INTEGRATION_SECRET_LENGTH + 1);
  const oversizedIdentifier = "x".repeat(MAX_INTEGRATION_IDENTIFIER_LENGTH + 1);
  const [email, line, calendar] = buildSalesIntegrationReadiness({
    SALES_EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: oversizedSecret,
    SALES_FROM_EMAIL: " sales@example.com",
    LINE_CHANNEL_ACCESS_TOKEN: "token\n",
    LINE_CHANNEL_SECRET: "secret",
    SALES_CALENDAR_PROVIDER: "google",
    GOOGLE_CLIENT_ID: oversizedIdentifier,
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_REFRESH_TOKEN: "refresh-token",
    SALES_CALENDAR_ID: "primary",
  });

  assert.deepEqual(email.missing, ["RESEND_API_KEY", "SALES_FROM_EMAIL"]);
  assert.deepEqual(line.missing, ["LINE_CHANNEL_ACCESS_TOKEN"]);
  assert.deepEqual(calendar.missing, ["GOOGLE_CLIENT_ID"]);
  assert.equal(JSON.stringify([email, line, calendar]).includes(oversizedSecret), false);
});

test("treats non-object configuration sources as entirely unconfigured", () => {
  for (const env of [null, "SALES_EMAIL_PROVIDER=resend", 1, true]) {
    const integrations = buildSalesIntegrationReadiness(env);
    assert.equal(integrations.every(({ ready, deliveryEnabled }) => !ready && !deliveryEnabled), true);
  }
});
