import { createHash } from "node:crypto";
import { z } from "zod";
import { HttpError, record, response, errorStatus, jsonBody, knownCodes, type AgentRpc } from "./http.ts";
import { classEditRequest, editWindow } from "./class-edit-contract.ts";
import { classWorkspace, compileClassEdit, EditError } from "./class-edit-compiler.mjs";
import { agentEditOpenApi } from "./openapi-v2.ts";

const uuid = z.string().uuid();
const empty = z.object({}).strict();
const operationBody = z.object({ previewToken: uuid, sourceReference: z.string().max(500).optional() }).strict();
const catalogQuery = z.object({ kind: z.enum(["teachers", "classrooms"]), search: z.string().max(100).default(""), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict();
// RPC context is server-private. Every HTTP projection is an explicit allowlist.
function projectResult(action: string, data: Record<string, unknown>): Record<string, unknown> {
  if (action === "preview") return { previewToken:data.previewToken, expiresAt:data.expiresAt, before:classWorkspace(data.beforeContext,data.window), after:classWorkspace(data.afterContext,data.window), notifications:data.notifications };
  if (["commit", "operation"].includes(action)) return Object.fromEntries([
    ...["operationId","state","error","replayed","retryWithNewKey","appliedAt","executor","actorProfileId","sourceReference","requesterVerified","notifications","externalSync","reply"].filter(key => Object.prototype.hasOwnProperty.call(data,key)).map(key => [key,data[key]]),
    ...(data.state === "applied" ? [["class",classWorkspace(data.classContext,data.window)]] : []),
  ]);
  return data;
}
export function createAgentEditApiHandler(dependencies: { enabled: () => boolean; rpc: AgentRpc; refreshPublicCache?: () => void | Promise<void> }) {
  return async (request: Request, path: string[]): Promise<Response> => {
    try {
      if (request.method === "GET" && path.join("/") === "openapi") return response(agentEditOpenApi);
      if (!dependencies.enabled()) throw new HttpError(503,"agent_api_disabled");
      const token = /^Bearer (tips_agent_[a-f0-9]{64})$/.exec(request.headers.get("authorization") || "")?.[1];
      if (!token) throw new HttpError(401,"agent_unauthorized");
      const hash = createHash("sha256").update(token).digest("hex");
      const call = async (action: string, input: Record<string, unknown>) => {
        const result = await dependencies.rpc("agent_api_v2", {p_token_hash:hash,p_action:action,p_input:input});
        const rpcError = record(result.error); const envelope = record(result.data);
        const err = rpcError || record(envelope?.error);
        if (err) {
          const code = String(rpcError ? err.message : err.code);
          if (knownCodes.has(code)) throw new HttpError(errorStatus(code),code);
          if (String(err.code) === "23P01") throw new HttpError(409,"timetable_resource_conflict");
          if (["22023","22P02","22007","22008"].includes(String(err.code))) throw new HttpError(422,"agent_invalid");
          throw new HttpError(503,"agent_api_unavailable");
        }
        const data = record(envelope?.data);
        if (!data) throw new HttpError(503,"agent_api_unavailable");
        return data;
      };
      const query = new URL(request.url).searchParams;
      if (new Set(query.keys()).size !== [...query.keys()].length) throw new HttpError(400,"invalid_request");
      const rawQuery = Object.fromEntries(query);
      let action: string; let data: Record<string, unknown>;
      if (request.method === "GET" && path.join("/") === "health") { empty.parse(rawQuery); action="health"; data=await call(action,{}); }
      else if (request.method === "GET" && path[0] === "classes" && path.length === 2) {
        const window=editWindow.parse(rawQuery); action="workspace";
        data=classWorkspace(await call("context",{classId:uuid.parse(path[1])}),window);
      } else if (request.method === "GET" && path[0] === "classes" && path.length === 3 && path[2] === "catalogs") {
        const q=catalogQuery.parse(rawQuery); const context=await call("context",{classId:uuid.parse(path[1])});
        const catalogs=record(context.catalogs); const list=catalogs?.[q.kind];
        if (!Array.isArray(list)) throw new HttpError(503,"agent_api_unavailable");
        const matches=list.map(record).filter((row): row is Record<string,unknown> => Boolean(row && row.isVisible !== false && String(row.name).toLocaleLowerCase().includes(q.search.toLocaleLowerCase())));
        action="catalogs"; data={kind:q.kind,page:q.page,pageSize:20,total:matches.length,items:matches.slice((q.page-1)*20,q.page*20).map(row=>({id:row.id,name:row.name,subjects:row.subjects}))};
      } else if (request.method === "POST" && path.length === 4 && path[0] === "classes" && path[2] === "changes" && path[3] === "preview") {
        empty.parse(rawQuery); const input=classEditRequest.parse(await jsonBody(request,32768)); const classId=uuid.parse(path[1]);
        const context=await call("context",{classId});
        const command=compileClassEdit(context,input);
        action="preview"; data=await call(action,{classId,expectedVersion:input.expectedVersion,command});
      } else if (request.method === "POST" && path.join("/") === "operations") {
        empty.parse(rawQuery); const input=operationBody.parse(await jsonBody(request));
        action="commit"; data=await call(action,{...input,requestKey:uuid.parse(request.headers.get("idempotency-key"))});
      } else if (request.method === "GET" && path.length === 2 && path[0] === "operations") {
        empty.parse(rawQuery); action="operation"; data=await call(action,{requestKey:uuid.parse(path[1])});
      } else if (request.method === "GET" && path.join("/") === "operations") {
        const input=z.object({page:z.coerce.number().int().min(1).max(10000).default(1)}).strict().parse(rawQuery);
        action="operations"; data=await call(action,input);
      } else throw new HttpError(404,"route_not_found");
      let outgoing=projectResult(action,data);
      if (data.state === "applied" && ["commit","operation"].includes(action)) {
        let state="pending";
        try { if (dependencies.refreshPublicCache) { await dependencies.refreshPublicCache(); state="invalidated"; } } catch { /* Commit is durable regardless of cache failure. */ }
        outgoing={...outgoing,publicCache:{state}};
      }
      return response({data:outgoing,error:data.state === "failed" ? data.error : null}, data.state === "failed" && action === "commit" ? errorStatus(String(record(data.error)?.code || "agent_write_failed")) : 200);
    } catch (error) {
      if (error instanceof z.ZodError) return response({data:null,error:{code:"invalid_request"}},400);
      if (error instanceof EditError && knownCodes.has(error.message)) return response({data:null,error:{code:error.message}},errorStatus(error.message));
      if (error instanceof HttpError) return response({data:null,error:{code:error.message}},error.status);
      return response({data:null,error:{code:"agent_api_unavailable"}},503);
    }
  };
}
