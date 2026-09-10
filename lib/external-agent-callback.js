import { createHmac, timingSafeEqual } from "node:crypto";

export const CALLBACK_MAX_AGE_SECONDS = 5 * 60;
export const CALLBACK_MAX_BODY_BYTES = 64 * 1024;
export const CALLBACK_MIN_SECRET_LENGTH = 32;

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,200}$/;

function validTimestamp(value) {
  // Unix timestamps for this integration are whole seconds. Reject other
  // Number()-coercible values (for example decimals and exponent notation)
  // before they reach signature verification.
  return typeof value === "string" && /^\d{10}$/.test(value);
}

function decodeSignature(signature) {
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/i.test(signature)) return null;
  return Buffer.from(signature, "hex");
}

export function createCallbackSignature({ secret, timestamp, nonce, body }) {
  if (!secret || !timestamp || !nonce || typeof body !== "string") return null;
  return createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
}

export function verifyCallbackSignature({ secret, timestamp, nonce, body, signature, now = Date.now() }) {
  if (typeof secret !== "string" || secret.length < CALLBACK_MIN_SECRET_LENGTH || !NONCE_PATTERN.test(nonce ?? "")) return false;
  if (!validTimestamp(timestamp)) return false;
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(now) || !Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > CALLBACK_MAX_AGE_SECONDS * 1000) return false;
  const expected = createCallbackSignature({ secret, timestamp, nonce, body });
  const expectedBuffer = decodeSignature(expected);
  const suppliedBuffer = decodeSignature(signature);
  return Boolean(expectedBuffer && suppliedBuffer && expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer));
}

export function mapCallbackDatabaseError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const constraintContext = `${error?.message ?? ""} ${error?.details ?? ""}`;
  const isReplay = code === "23505" && constraintContext.includes("external_agent_callback_nonces_pkey");
  if (isReplay) return { status: 409, error: "CALLBACK_REPLAY_DETECTED" };
  if (code === "P0001" || code === "23514") return { status: 409, error: "EXTERNAL_AGENT_JOB_RESULT_REJECTED" };
  return { status: 500, error: "EXTERNAL_AGENT_JOB_CALLBACK_FAILED" };
}
