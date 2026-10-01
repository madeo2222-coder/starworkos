import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesIntegrationReadiness } from "../lib/sales-integration-readiness.js";

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
});
