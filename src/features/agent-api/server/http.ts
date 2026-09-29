import { createHash } from "node:crypto";
import { z } from "zod";
import { agentOpenApi } from "./openapi.ts";

type Result = { data: unknown; error: unknown };
export type AgentRpc = (name: string, input: Record<string, unknown>) => PromiseLike<Result>;
const uuid = z.string().uuid();
const date = z.iso.date();
const query = z.object({ search: z.string().max(100).optional(), status: z.enum(["수강", "개강 준비", "종강"]).optional(), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict();
const preview = z.object({ expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), slotId: z.string().min(1).max(160), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440), reason: z.string().trim().min(1).max(300) }).strict().refine(v => v.endMinute > v.startMinute);
const commit = z.object({ previewToken: uuid, sourceReference: z.string().max(500).optional() }).strict();
const headers = { "Cache-Control": "no-store", "Vary": "Authorization", "X-Content-Type-Options": "nosniff" };
class HttpError extends Error {
  status: number;
  constructor(status: number, code: string) { super(code); this.status = status; }
}
function record(v: unknown): Record<string, unknown> | null { return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null; }
function response(body: unknown, status = 200) { return Response.json(body, { status, headers: { ...headers, ...(status === 429 ? { "Retry-After": "60" } : {}), ...(status === 401 ? { "WWW-Authenticate": 'Bearer realm="tips-agent"' } : {}) } }); }
const knownCodes = new Set(["agent_unauthorized", "agent_forbidden", "agent_scope_forbidden", "agent_class_not_active", "agent_not_found", "agent_invalid", "agent_invalid_range", "agent_no_change", "agent_unsupported_catalog_label", "agent_stale", "agent_preview_expired", "agent_idempotency_key_reused", "agent_preview_consumed", "agent_rate_limited", "timetable_resource_conflict", "class_schedule_stale", "class_schedule_closed", "class_schedule_forbidden", "continuous_class_schedule_runtime_not_ready", "agent_write_failed"]);
function errorStatus(code: string): number {
  if (code === "agent_unauthorized") return 401;
  if (["agent_forbidden", "agent_scope_forbidden", "agent_class_not_active", "class_schedule_closed", "class_schedule_forbidden"].includes(code)) return 403;
  if (code === "agent_not_found") return 404;
  if (code === "agent_rate_limited") return 429;
  if (["agent_stale", "agent_preview_expired", "agent_idempotency_key_reused", "agent_preview_consumed", "timetable_resource_conflict", "class_schedule_stale"].includes(code)) return 409;
  if (["agent_write_failed", "continuous_class_schedule_runtime_not_ready"].includes(code)) return 503;
  return 422;
}
async function jsonBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") throw new HttpError(415, "json_required");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "invalid_request");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 8192) { await reader.cancel(); throw new HttpError(413, "request_too_large"); } chunks.push(next.value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, "invalid_json"); }
  finally { reader.releaseLock(); }
}
export function createAgentApiHandler(dependencies: { enabled: () => boolean; rpc: AgentRpc; refreshPublicCache?: () => void | Promise<void> }) {
  return async (request: Request, path: string[]): Promise<Response> => {
    try {
      if (path.join("/") === "openapi" && request.method === "GET") return response(agentOpenApi);
      if (!dependencies.enabled()) throw new HttpError(503, "agent_api_disabled");
      const token = /^Bearer (tips_agent_[a-f0-9]{64})$/.exec(request.headers.get("authorization") || "")?.[1];
      if (!token) throw new HttpError(401, "agent_unauthorized");
      const url = new URL(request.url);
      // Duplicate query parameters are ambiguous: never silently accept one.
      if (new Set(url.searchParams.keys()).size !== [...url.searchParams.keys()].length) throw new HttpError(400, "invalid_request");
      const rawQuery = Object.fromEntries(url.searchParams);
      let action: string; let input: Record<string, unknown>;
      if (request.method === "GET" && path.length === 1 && path[0] === "health") { z.object({}).strict().parse(rawQuery); action = "health"; input = {}; }
      else if (request.method === "GET" && path.length === 1 && path[0] === "classes") { action = "classes"; input = query.parse(rawQuery); }
      else if (request.method === "GET" && path.length === 2 && path[0] === "classes") { z.object({}).strict().parse(rawQuery); action = "class"; input = { classId: uuid.parse(path[1]) }; }
      else if (request.method === "GET" && path.join("/") === "calendar/events") { action = "calendar"; input = z.object({ from: date, to: date }).strict().parse(rawQuery); }
      else if (request.method === "GET" && path.length === 2 && path[0] === "operations") { z.object({}).strict().parse(rawQuery); action = "operation"; input = { requestKey: uuid.parse(path[1]) }; }
      else if (request.method === "POST" && path.length === 4 && path[0] === "classes" && path[2] === "weekly-time" && path[3] === "preview") {
        z.object({}).strict().parse(rawQuery); action = "preview"; input = { ...preview.parse(await jsonBody(request)), classId: uuid.parse(path[1]) };
      } else if (request.method === "POST" && path.join("/") === "operations") {
        z.object({}).strict().parse(rawQuery); action = "commit"; input = { ...commit.parse(await jsonBody(request)), requestKey: uuid.parse(request.headers.get("idempotency-key")) };
      } else throw new HttpError(404, "route_not_found");
      const result = await dependencies.rpc("agent_api_v1", { p_token_hash: createHash("sha256").update(token).digest("hex"), p_action: action, p_input: input });
      if (result.error) {
        const err = record(result.error); const message = String(err?.message || "");
        if (knownCodes.has(message)) throw new HttpError(errorStatus(message), message);
        if (["22023", "22P02", "22007", "22008"].includes(String(err?.code))) throw new HttpError(422, "agent_invalid");
        throw new HttpError(503, "agent_api_unavailable");
      }
      const envelope = record(result.data);
      if (!envelope) throw new HttpError(503, "agent_api_unavailable");
      const error = record(envelope.error);
      if (error) { const code = String(error.code); throw new HttpError(knownCodes.has(code) ? errorStatus(code) : 503, knownCodes.has(code) ? code : "agent_api_unavailable"); }
      const data = record(envelope.data);
      if (!data) throw new HttpError(503, "agent_api_unavailable");
      // The durable business receipt remains authoritative if cache refresh fails.
      // Receipt lookup/replay can safely recover this separate, idempotent effect.
      let outgoing = data;
      if (data.state === "applied" && ["commit", "operation"].includes(action)) {
        let cacheState = "pending";
        try {
          if (dependencies.refreshPublicCache) { await dependencies.refreshPublicCache(); cacheState = "invalidated"; }
        } catch { /* Never relabel an already committed operation as failed. */ }
        outgoing = { ...data, publicCache: { state: cacheState } };
      }
      const failed = data.state === "failed";
      const failedCode = String(record(data.error)?.code || "agent_write_failed");
      // A known failed operation is persisted and returned with its receipt.
      // GET operation status itself succeeded even when the operation failed.
      return response({ data: outgoing, error: failed ? record(data.error) : null }, failed && action === "commit" ? errorStatus(failedCode) : 200);
    } catch (e) {
      if (e instanceof z.ZodError) return response({ data: null, error: { code: "invalid_request" } }, 400);
      if (e instanceof HttpError) return response({ data: null, error: { code: e.message } }, e.status);
      // Never return/log raw database exceptions, credentials or request bodies.
      return response({ data: null, error: { code: "agent_api_unavailable" } }, 503);
    }
  };
}
