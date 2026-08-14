import { PUBLIC_CLASSES_SUMMARY_CACHE_TAG } from "./public-classes-cache.js";

export { PUBLIC_CLASSES_SUMMARY_CACHE_TAG };

const REASONS = new Set(["class", "textbook", "progress", "schedule"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function validRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const keys = Object.keys(input).sort();
  if (keys.length !== 2 || keys[0] !== "reason" || keys[1] !== "requestId") return false;
  return REASONS.has(input.reason) && UUID_PATTERN.test(input.requestId);
}

/**
 * @param {{
 *   authenticate?: (request: Request) => Promise<{ role: string } | null>,
 *   revalidateTag: (tag: string, profile: string) => void,
 *   revalidatePath: (path: string) => void,
 * }} options
 */
export function createPublicClassesCacheInvalidationResponder({
  authenticate = async (_request) => ({ role: "" }),
  revalidateTag,
  revalidatePath,
} = {}) {
  return async function respond(input, request) {
    if (!validRequest(input)) return { status: 400, body: { ok: false, error: "public_classes_cache_request_invalid" } };
    const identity = await authenticate(request);
    if (!identity) return { status: 401, body: { ok: false, error: "public_classes_cache_unauthorized" } };
    if (!["admin", "staff"].includes(String(identity.role || "").trim())) {
      return { status: 403, body: { ok: false, error: "public_classes_cache_forbidden" } };
    }
    try {
      revalidateTag(PUBLIC_CLASSES_SUMMARY_CACHE_TAG, "max");
      revalidatePath("/api/public-classes");
      return { status: 200, body: { ok: true, requestId: input.requestId } };
    } catch {
      return { status: 503, body: { ok: false, error: "public_classes_cache_refresh_pending", requestId: input.requestId } };
    }
  };
}

export async function requestPublicClassesCacheInvalidation({
  reason,
  requestId,
  accessToken = "",
  fetcher = fetch,
} = {}) {
  const headers = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    const response = await fetcher("/api/public-classes/cache/invalidate", {
      method: "POST",
      headers,
      body: JSON.stringify({ reason, requestId }),
    });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.ok) return { status: "refreshed", reason, requestId };
  } catch {
    // A successful business mutation must not be rolled back for cache delivery.
  }
  return { status: "pending", reason, requestId };
}

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
