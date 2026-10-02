import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { HttpError, record, response, errorStatus, jsonBody, knownCodes, type AgentRpc } from "./http.ts";
import { classEditRequest, editWindow, pastLessonStateCorrectionRequest } from "./class-edit-contract.ts";
import { classWorkspace, compileClassEdit, compilePastLessonStateCorrection, EditError } from "./class-edit-compiler.mjs";
import { agentEditOpenApi } from "./openapi-v2.ts";

const uuid = z.string().uuid();
const empty = z.object({}).strict();
const operationBody = z.object({ previewToken: uuid, sourceReference: z.string().max(500).optional() }).strict();
const catalogQuery = z.object({ kind: z.enum(["teachers", "classrooms"]), search: z.string().max(100).default(""), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict();
type CorrectionProof = { input: z.infer<typeof pastLessonStateCorrectionRequest>; context: Record<string, unknown>; command: Record<string, unknown> };
// RPC context is server-private. Every HTTP projection is an explicit allowlist.
function projectResult(action: string, data: Record<string, unknown>, correction?: CorrectionProof): Record<string, unknown> {
  if (action === "preview" && data.kind === "past_lesson_state_correction") {
    const reviewHash = data.unknownOccupancyReviewHash;
    const count = data.unknownOccupancyCount;
    if (!correction || typeof reviewHash !== "string" || !/^[a-f0-9]{64}$/.test(reviewHash)
      || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0
      || typeof data.reviewOnly !== "boolean") throw new HttpError(503,"agent_api_unavailable");
    const {input,context,command}=correction, window={from:input.date,to:input.date};
    const acknowledged=input.acknowledgeUnknownOccupancy === true;
    if (data.reviewOnly !== !acknowledged || data.reviewRequired !== data.reviewOnly
      || (acknowledged && reviewHash !== input.blockerReviewHash)
      || data.classId !== context.id || data.lessonId !== input.lessonId || data.date !== input.date
      || data.expectedState !== command.expectedState || data.state !== command.state
      || record(data.window)?.from !== input.date || record(data.window)?.to !== input.date
      || !record(data.beforeContext)) throw new HttpError(503,"agent_api_unavailable");
    const before=classWorkspace(data.beforeContext,window), baseline=classWorkspace(context,window);
    if (before.id !== baseline.id || before.version !== input.expectedVersion || before.verificationHash !== baseline.verificationHash) throw new HttpError(503,"agent_api_unavailable");
    const shared = {kind:data.kind,reviewOnly:data.reviewOnly,reviewRequired:data.reviewOnly,blockerReviewHash:reviewHash,unknownOccupancyCount:count,
      warnings:count ? [{code:"unknown_occupancy",count}] : [],before};
    if (data.reviewOnly) {
      if (data.previewToken !== null) throw new HttpError(503,"agent_api_unavailable");
      return {...shared,previewToken:null};
    }
    if (!uuid.safeParse(data.previewToken).success || !z.iso.datetime({offset:true}).safeParse(data.expiresAt).success
      || !record(data.afterContext) || record(data.notifications)?.state !== "not_requested") throw new HttpError(503,"agent_api_unavailable");
    const after=classWorkspace(data.afterContext,window);
    const expected={...before,lessons:before.lessons.map(row => row.id === input.lessonId && row.date === input.date ? {...row,state:input.nextState} : row)};
    const observable = (workspace: Record<string,unknown>) => Object.fromEntries(Object.entries(workspace).filter(([key])=>!["version","verificationHash"].includes(key)));
    if (before.lessons.filter(row=>row.id === input.lessonId && row.date === input.date && row.state === input.expectedState && row.materialized).length !== 1
      || JSON.stringify(observable(after)) !== JSON.stringify(observable(expected))) throw new HttpError(503,"agent_api_unavailable");
    return {...shared,previewToken:data.previewToken,expiresAt:data.expiresAt,after,notifications:{state:"not_requested"}};
  }
  if (action === "preview") return { previewToken:data.previewToken, expiresAt:data.expiresAt, before:classWorkspace(data.beforeContext,data.window), after:classWorkspace(data.afterContext,data.window), notifications:data.notifications };
  if (["commit", "operation"].includes(action)) return Object.fromEntries([
    ...["operationId","state","error","replayed","retryWithNewKey","appliedAt","executor","actorProfileId","sourceReference","requesterVerified","notifications","externalSync","reply"].filter(key => Object.prototype.hasOwnProperty.call(data,key)).map(key => [key,data[key]]),
    ...(data.state === "applied" ? [["class",classWorkspace(data.classContext,data.window)]] : []),
  ]);
  return data;
}
type SafeFailure = { code: "agent_api_unavailable"; requestId: string; phase: string; sqlstate?: string };
const safeSqlstate = (value: unknown) => typeof value === "string" && /^[0-9A-Z]{5}$/.test(value) ? value : undefined;
export function createAgentEditApiHandler(dependencies: { enabled: () => boolean; rpc: AgentRpc; refreshPublicCache?: () => void | Promise<void>; logError?: (failure: SafeFailure) => void }) {
  return async (request: Request, path: string[]): Promise<Response> => {
    const requestId = randomUUID();
    let phase = "request";
    let sqlstate: string | undefined;
    try {
      if (request.method === "GET" && path.join("/") === "openapi") return response(agentEditOpenApi);
      if (!dependencies.enabled()) throw new HttpError(503,"agent_api_disabled");
      const token = /^Bearer (tips_agent_[a-f0-9]{64})$/.exec(request.headers.get("authorization") || "")?.[1];
      if (!token) throw new HttpError(401,"agent_unauthorized");
      const hash = createHash("sha256").update(token).digest("hex");
      const call = async (action: string, input: Record<string, unknown>) => {
        phase = action;
        sqlstate = undefined;
        const result = await dependencies.rpc("agent_api_v2", {p_token_hash:hash,p_action:action,p_input:input});
        const rpcError = record(result.error); const envelope = record(result.data);
        const err = rpcError || record(envelope?.error);
        if (err) {
          const code = String(rpcError ? err.message : err.code);
          if (knownCodes.has(code)) throw new HttpError(errorStatus(code),code);
          if (String(err.code) === "23P01") throw new HttpError(409,"timetable_resource_conflict");
          if (["22023","22P02","22007","22008"].includes(String(err.code))) throw new HttpError(422,"agent_invalid");
          sqlstate = safeSqlstate(rpcError ? err.code : err.sqlstate ?? err.code);
          throw new HttpError(503,"agent_api_unavailable");
        }
        const data = record(envelope?.data);
        if (!data) throw new HttpError(503,"agent_api_unavailable");
        return data;
      };
      const query = new URL(request.url).searchParams;
      if (new Set(query.keys()).size !== [...query.keys()].length) throw new HttpError(400,"invalid_request");
      const rawQuery = Object.fromEntries(query);
      let action: string; let data: Record<string, unknown>; let correction: CorrectionProof | undefined;
      if (request.method === "GET" && path.join("/") === "health") { empty.parse(rawQuery); action="health"; data=await call(action,{}); }
      else if (request.method === "GET" && path[0] === "classes" && path.length === 2) {
        const window=editWindow.parse(rawQuery); action="workspace";
        const context=await call("context",{classId:uuid.parse(path[1])}); phase="projection";
        data=classWorkspace(context,window);
      } else if (request.method === "GET" && path[0] === "classes" && path.length === 3 && path[2] === "catalogs") {
        const q=catalogQuery.parse(rawQuery); const context=await call("context",{classId:uuid.parse(path[1])});
        phase="projection";
        const catalogs=record(context.catalogs); const list=catalogs?.[q.kind];
        if (!Array.isArray(list)) throw new HttpError(503,"agent_api_unavailable");
        const matches=list.map(record).filter((row): row is Record<string,unknown> => Boolean(row && row.isVisible !== false && String(row.name).toLocaleLowerCase().includes(q.search.toLocaleLowerCase())));
        action="catalogs"; data={kind:q.kind,page:q.page,pageSize:20,total:matches.length,items:matches.slice((q.page-1)*20,q.page*20).map(row=>({id:row.id,name:row.name,subjects:row.subjects}))};
      } else if (request.method === "POST" && path.length === 4 && path[0] === "classes" && path[2] === "lesson-state-corrections" && path[3] === "preview") {
        empty.parse(rawQuery); const input=pastLessonStateCorrectionRequest.parse(await jsonBody(request,8192)); const classId=uuid.parse(path[1]);
        const context=await call("context",{classId});
        phase="compile";
        const command=compilePastLessonStateCorrection(context,input);
        correction={input,context,command};
        action="preview"; data=await call(action,{classId,expectedVersion:input.expectedVersion,command});
        if (data.kind !== "past_lesson_state_correction") throw new HttpError(503,"agent_api_unavailable");
      } else if (request.method === "POST" && path.length === 4 && path[0] === "classes" && path[2] === "changes" && path[3] === "preview") {
        empty.parse(rawQuery); const input=classEditRequest.parse(await jsonBody(request,32768)); const classId=uuid.parse(path[1]);
        const context=await call("context",{classId});
        phase="compile";
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
      phase="projection";
      let outgoing=projectResult(action,data,correction);
      if (data.state === "applied" && ["commit","operation"].includes(action)) {
        let state="pending";
        try { if (dependencies.refreshPublicCache) { await dependencies.refreshPublicCache(); state="invalidated"; } } catch { /* Commit is durable regardless of cache failure. */ }
        outgoing={...outgoing,publicCache:{state}};
      }
      return response({data:outgoing,error:data.state === "failed" ? data.error : null}, data.state === "failed" && action === "commit" ? errorStatus(String(record(data.error)?.code || "agent_write_failed")) : 200);
    } catch (error) {
      if (error instanceof z.ZodError) return response({data:null,error:{code:"invalid_request"}},400);
      if (error instanceof EditError && knownCodes.has(error.message)) return response({data:null,error:{code:error.message}},errorStatus(error.message));
      if (error instanceof HttpError && error.message !== "agent_api_unavailable") return response({data:null,error:{code:error.message}},error.status);
      const state=sqlstate ?? safeSqlstate(record(error)?.code);
      const failure: SafeFailure={code:"agent_api_unavailable",requestId,phase,...(state ? {sqlstate:state} : {})};
      // A transport failure can leave a write uncertain. Correlate only fixed
      // phases and validated SQLSTATEs; never log request or raw error content.
      try { if (dependencies.logError) dependencies.logError(failure); else console.error(failure); } catch { /* Diagnostics never change recovery behavior. */ }
      const unavailable=response({data:null,error:failure},503);
      unavailable.headers.set("X-Request-Id",requestId);
      return unavailable;
    }
  };
}
