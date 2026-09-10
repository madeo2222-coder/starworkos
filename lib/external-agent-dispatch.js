import { timingSafeEqual } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Dispatch accepts only a job UUID. Keep the request budget deliberately
// small so an authenticated caller cannot make this internal endpoint buffer
// an arbitrary request body before validation.
export const DISPATCH_MAX_BODY_BYTES = 4 * 1024;
export const DISPATCH_RESPONSE_MAX_BODY_BYTES = 16 * 1024;

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function safeTokenEquals(expected, supplied) {
  if (typeof expected !== "string" || typeof supplied !== "string") return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length > 0 && expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function hasMinimumTokenLength(value, minimum = 16) {
  return typeof value === "string" && value.length >= minimum;
}

/**
 * @typedef {{ ok: false, error: "EXTERNAL_AGENT_DISPATCH_DISABLED" | "EXTERNAL_AGENT_DISPATCH_NOT_CONFIGURED" }} DispatchConfigError
 * @typedef {{ ok: true, url: string, callbackUrl: string, gatewayToken: string }} DispatchConfigSuccess
 * @typedef {DispatchConfigError | DispatchConfigSuccess} DispatchConfig
 */

/**
 * Resolve the operator-provided dispatch settings.
 *
 * The discriminated return type is intentional: route handlers must not be able
 * to call the gateway unless every required setting has been validated.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {DispatchConfig}
 */
export function dispatchConfig(env = process.env) {
  if (env.EXTERNAL_AGENT_DISPATCH_ENABLED !== "true") return { ok: false, error: "EXTERNAL_AGENT_DISPATCH_DISABLED" };
  const url = httpsUrl(env.EXTERNAL_AGENT_DISPATCH_URL);
  const callbackUrl = httpsUrl(env.EXTERNAL_AGENT_CALLBACK_URL);
  const gatewayToken = env.EXTERNAL_AGENT_GATEWAY_TOKEN;
  const allowedHosts = new Set((env.EXTERNAL_AGENT_DISPATCH_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean));
  if (!url || !callbackUrl || typeof gatewayToken !== "string" || gatewayToken.length < 16 || !allowedHosts.has(url.host)) {
    return { ok: false, error: "EXTERNAL_AGENT_DISPATCH_NOT_CONFIGURED" };
  }
  return { ok: true, url: url.toString(), callbackUrl: callbackUrl.toString(), gatewayToken };
}

export function validateDispatchRequest(value) {
  if (!value || typeof value !== "object" || !UUID_PATTERN.test(value.jobId ?? "")) return "INVALID_DISPATCH_REQUEST";
  return null;
}

export function dispatchPayload(job, callbackUrl) {
  return {
    job: {
      id: job.id,
      taskId: job.task_id,
      aiEmployeeId: job.ai_employee_id,
      provider: job.provider,
      capability: job.capability,
      repository: job.repository,
      baseBranch: job.base_branch,
      requestedAction: job.requested_action,
    },
    callbackUrl,
  };
}

export function parseDispatchResponse(value) {
  if (!value || typeof value !== "object" || typeof value.externalJobId !== "string" || !value.externalJobId.trim() || value.externalJobId.length > 200) return null;
  return { externalJobId: value.externalJobId };
}

/**
 * Read a gateway response without allowing a slow or unexpectedly large body
 * to keep a serverless invocation alive or consume unbounded memory.
 *
 * @param {Response} response
 * @param {number} [maximumBytes]
 * @returns {Promise<unknown | null>}
 */
export async function readBoundedJsonResponse(response, maximumBytes = DISPATCH_RESPONSE_MAX_BODY_BYTES) {
  const contentLength = response.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes).toString("utf8"));
  } catch {
    return null;
  }
}
