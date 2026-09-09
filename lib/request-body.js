/**
 * Reads a request body without allowing a chunked request to grow unbounded in
 * memory. `Content-Length` is only an early rejection; the streamed byte count
 * is authoritative because clients may omit or lie about that header.
 *
 * @param {Request} request
 * @param {number} maxBytes
 * @returns {Promise<{ ok: true, text: string } | { ok: false }>}
 */
export async function readUtf8BodyWithLimit(request, maxBytes) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
    return { ok: false };
  }

  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false };
  } finally {
    reader.releaseLock();
  }

  return { ok: true, text: new TextDecoder().decode(Buffer.concat(chunks)) };
}

/**
 * @param {Request} request
 * @param {number} maxBytes
 * @returns {Promise<{ ok: true, value: unknown } | { ok: false }>}
 */
export async function readJsonBodyWithLimit(request, maxBytes) {
  const body = await readUtf8BodyWithLimit(request, maxBytes);
  if (!body.ok) return body;
  try {
    return { ok: true, value: JSON.parse(body.text) };
  } catch {
    return { ok: true, value: null };
  }
}
