const CACHE_INVALIDATION_TIMEOUT_MS = 3_000;

/**
 * @param {{
 *   reason: "class" | "textbook" | "progress" | "schedule",
 *   requestId: string,
 *   accessToken?: string,
 *   fetcher?: typeof fetch,
 *   timeoutMs?: number,
 * }} options
 */
export async function requestPublicClassesCacheInvalidation({
  reason,
  requestId,
  accessToken = "",
  fetcher = fetch,
  timeoutMs = CACHE_INVALIDATION_TIMEOUT_MS,
} = {}) {
  const headers = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const boundedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : CACHE_INVALIDATION_TIMEOUT_MS;
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller?.abort();
      reject(new Error("public_classes_cache_invalidation_timeout"));
    }, boundedTimeoutMs);
  });
  try {
    const response = await Promise.race([
      Promise.resolve(fetcher("/api/public-classes/cache/invalidate", {
        method: "POST",
        headers,
        body: JSON.stringify({ reason, requestId }),
        signal: controller?.signal,
      })),
      deadline,
    ]);
    const body = await Promise.race([
      Promise.resolve().then(() => response.json()).catch(() => null),
      deadline,
    ]);
    if (response.ok && body?.ok) return { status: "refreshed", reason, requestId };
  } catch {
    // A successful business mutation must not be rolled back for cache delivery.
  } finally {
    clearTimeout(timeout);
  }
  return { status: "pending", reason, requestId };
}

/**
 * @param {any} client
 * @param {"class" | "textbook" | "progress" | "schedule"} reason
 */
export async function invalidatePublicClassesCacheAfterMutation(client, reason) {
  let accessToken = "";
  try {
    const session = await client?.auth?.getSession?.();
    accessToken = String(session?.data?.session?.access_token || "");
  } catch {
    // The mutation is already committed; failed session lookup is a pending refresh.
  }
  const requestId = globalThis.crypto?.randomUUID?.();
  if (!requestId) return { status: "pending", reason, requestId: "" };
  return requestPublicClassesCacheInvalidation({ reason, requestId, accessToken });
}
