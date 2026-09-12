import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { createIntakeStore, authenticateRecruitingAdmin, supabaseSettings, type RecruitingEnvironment, type RecruitingStore, type AdminIdentity } from "./recruiting-store.ts";
import { APPLICATION_UUID, parseApplication, readBoundedJson, RecruitingRequestError, record } from "./recruiting-validation.ts";
import { RECRUITING_PAGE_SIZE } from "../recruiting-policy.ts";

function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", ...headers } });
}
function error(code: string, status: number, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return json({ ok: false, code, ...extra }, status, headers);
}
export function allowedOrigins(env: RecruitingEnvironment): Set<string> | null {
  const values = (env.RECRUITING_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!values.length) return null;
  try {
    for (const value of values) {
      const url = new URL(value);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (url.origin !== value || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) return null;
    }
    return new Set(values);
  } catch { return null; }
}
function originAllowed(request: Request, origins: Set<string>) {
  return origins.has(request.headers.get("origin") || "");
}
function fingerprint(secret: string, kind: string, value: string) {
  return createHmac("sha256", secret).update(`${kind}\0${value}`).digest("hex");
}
function clientAddress(request: Request, env: RecruitingEnvironment) {
  // Only the hosting platform's trusted header may affect the IP budget. Missing
  // metadata shares a conservative budget; arbitrary X-Forwarded-For is ignored.
  if (env.VERCEL !== "1") return "unresolved";
  const address = (request.headers.get("x-vercel-forwarded-for") || "").split(",")[0].trim();
  return isIP(address) ? address : "unresolved";
}
/** Temporary operator-only parity check. Never reads auth, applications or quotas. */
export function createRecruitingProxyProbeHandler({ env = process.env }: { env?: RecruitingEnvironment } = {}) {
  return async (request: Request) => {
    const deny = () => error("method_not_allowed", 405, {}, { Allow: "POST" });
    const secret = (env.RECRUITING_PROXY_PROBE_SECRET || "").trim();
    if (request.method !== "GET" || new URL(request.url).search || secret.length < 32) return deny();
    const authorization = Buffer.from(request.headers.get("authorization") || "", "utf8");
    const expected = Buffer.from(`Bearer ${secret}`, "utf8");
    if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) return deny();
    const address = clientAddress(request, env);
    return json({
      addressHash: createHmac("sha256", secret).update(address).digest("hex"),
      resolved: address !== "unresolved",
    });
  };
}
export function createRecruitingApplicationHandler({ env = process.env, store }: { env?: RecruitingEnvironment; store?: RecruitingStore } = {}) {
  return async (request: Request) => {
    if (request.method !== "POST") return error("method_not_allowed", 405, {}, { Allow: "POST" });
    const origins = allowedOrigins(env);
    const { url, serviceKey } = supabaseSettings(env);
    const secret = (env.RECRUITING_RATE_LIMIT_SECRET || "").trim();
    if (env.RECRUITING_APPLICATIONS_ENABLED !== "true" || !url || !serviceKey || !origins || secret.length < 32) return error("recruiting_unavailable", 503);
    if (!originAllowed(request, origins)) return error("origin_not_allowed", 403);
    if (new URL(request.url).search) return error("invalid_request", 400);
    try {
      const parsed = parseApplication(await readBoundedJson(request));
      if (!parsed.data) return error("invalid_request", 400, { fieldErrors: Object.fromEntries((parsed.fields || ["form"]).map((field) => [field, "입력 내용을 확인해 주세요."])) });
      if (request.signal.aborted) return error("request_cancelled", 400);
      const data = parsed.data;
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8000)]);
      const result = await (store || createIntakeStore(env)).submit({
        ...data,
        requestHash: fingerprint(secret, "request", JSON.stringify(data)),
        ipFingerprint: fingerprint(secret, "ip", clientAddress(request, env)),
        contactFingerprint: fingerprint(secret, "contact", data.phone),
        globalFingerprint: fingerprint(secret, "global", "recruiting"),
      }, signal);
      if (result.status === "accepted") {
        if (!APPLICATION_UUID.test(result.applicationId) || !Number.isFinite(Date.parse(result.receivedAt))) return error("recruiting_unavailable", 503);
        return json({ ok: true, applicationId: result.applicationId, receivedAt: result.receivedAt }, 201);
      }
      if (result.status === "rate_limited") return error("rate_limited", 429, {}, { "Retry-After": String(Math.min(86400, Math.max(1, result.retryAfter))) });
      if (result.status === "conflict") return error("request_id_reused", 409);
      if (result.status === "gone") return error("application_no_longer_retained", 410);
      return error("recruiting_unavailable", 503);
    } catch (failure) {
      if (failure instanceof RecruitingRequestError) return error(failure.code, failure.status);
      // Never return or log provider exceptions, submitted values, hashes or keys.
      return error("recruiting_unavailable", 503);
    }
  };
}
export function createRecruitingAdminHandlers({ env = process.env, authenticate = (request: Request) => authenticateRecruitingAdmin(request, env) }: { env?: RecruitingEnvironment; authenticate?: (request: Request) => Promise<AdminIdentity> } = {}) {
  async function run(request: Request, id?: string) {
    if (!((!id && request.method === "GET") || (id && ["GET", "DELETE"].includes(request.method)))) return error("method_not_allowed", 405);
    try {
      const identity = await authenticate(request);
      if ("status" in identity) return error(identity.status === 401 ? "unauthorized" : "recruiting_unavailable", identity.status);
      if (identity.role !== "admin") return error("forbidden", 403);
      const params = new URL(request.url).searchParams;
      if (id) {
        if (!APPLICATION_UUID.test(id) || [...params].length) return error("invalid_request", 400);
        if (request.method === "DELETE") {
          const origins = allowedOrigins(env);
          if (!origins) return error("recruiting_unavailable", 503);
          if (!originAllowed(request, origins)) return error("origin_not_allowed", 403);
          const body = await readBoundedJson(request, 128);
          if (!record(body) || Object.keys(body).length !== 1 || body.confirm !== true) return error("invalid_request", 400);
          const removed = await identity.store.remove(id);
          return removed ? json({ ok: true }) : error("not_found", 404);
        }
        const application = await identity.store.detail(id);
        return application ? json({ ok: true, application }) : error("not_found", 404);
      }
      if ([...params.keys()].some((key) => !["page", "pageSize"].includes(key)) || params.getAll("page").length > 1 || params.getAll("pageSize").length > 1) return error("invalid_request", 400);
      const rawPage = params.get("page") || "1";
      const pageSize = Number(params.get("pageSize") || RECRUITING_PAGE_SIZE);
      if (!/^[1-9]\d{0,3}$/u.test(rawPage) || ![10, 15, 20].includes(pageSize)) return error("invalid_request", 400);
      const result = await identity.store.list(Number(rawPage), pageSize);
      return json({ ok: true, ...result, page: Number(rawPage), pageSize });
    } catch (failure) {
      if (failure instanceof RecruitingRequestError) return error(failure.code, failure.status);
      return error("recruiting_unavailable", 503);
    }
  }
  return { list: (request: Request) => run(request), detail: (request: Request, id: string) => run(request, id) };
}
