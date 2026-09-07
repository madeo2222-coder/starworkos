import { createHmac, timingSafeEqual } from "node:crypto";

export const CALLBACK_MAX_AGE_SECONDS = 5 * 60;

function decodeSignature(signature) {
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/i.test(signature)) return null;
  return Buffer.from(signature, "hex");
}

export function createCallbackSignature({ secret, timestamp, nonce, body }) {
  if (!secret || !timestamp || !nonce || typeof body !== "string") return null;
  return createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
}

export function verifyCallbackSignature({ secret, timestamp, nonce, body, signature, now = Date.now() }) {
  if (!secret || typeof nonce !== "string" || nonce.length < 16 || nonce.length > 200) return false;
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > CALLBACK_MAX_AGE_SECONDS * 1000) return false;
  const expected = createCallbackSignature({ secret, timestamp, nonce, body });
  const expectedBuffer = decodeSignature(expected);
  const suppliedBuffer = decodeSignature(signature);
  return Boolean(expectedBuffer && suppliedBuffer && expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer));
}
