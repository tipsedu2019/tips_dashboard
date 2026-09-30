import { createHash } from "node:crypto";
import { z } from "zod";
import { HttpError, record, response, errorStatus, jsonBody, knownCodes, type AgentRpc } from "./http.ts";
import { calendarChange, calendarYear } from "./calendar-contract.ts";
import { CalendarError, calendarWorkspace, compileCalendarChange } from "./calendar-compiler.mjs";

const uuid=z.string().uuid();
const empty=z.object({}).strict();
const page=z.object({page:z.coerce.number().int().min(1).max(10000).default(1)}).strict();
const commit=z.object({previewToken:uuid,sourceReference:z.string().max(500).optional()}).strict();
function project(action:string,data:Record<string,unknown>) {
  if(action==='context') return calendarWorkspace(data);
  if(action==='preview') return {previewToken:data.previewToken,expiresAt:data.expiresAt,before:calendarWorkspace(data.beforeContext),after:calendarWorkspace(data.afterContext),diff:data.diff};
  if(['commit','operation'].includes(action)) return Object.fromEntries([
    ...['operationId','kind','state','error','replayed','retryWithNewKey','appliedAt','executor','actorProfileId','sourceReference','requesterVerified','notifications','externalSync','reply'].filter(key=>Object.prototype.hasOwnProperty.call(data,key)).map(key=>[key,data[key]]),
    ...(data.state==='applied' ? [['calendar',calendarWorkspace(data.calendarContext)]] : []),
  ]);
  return data;
}
export function createAgentCalendarHandler(dependencies:{enabled:()=>boolean;rpc:AgentRpc}) {
  return async(request:Request,path:string[]):Promise<Response>=>{
    try {
      if(!dependencies.enabled()) throw new HttpError(503,'agent_api_disabled');
      const token=/^Bearer (tips_agent_[a-f0-9]{64})$/.exec(request.headers.get('authorization')||'')?.[1];
      if(!token) throw new HttpError(401,'agent_unauthorized');
      const hash=createHash('sha256').update(token).digest('hex');
      const call=async(action:string,input:Record<string,unknown>)=>{
        const result=await dependencies.rpc('agent_calendar_api_v1',{p_token_hash:hash,p_action:action,p_input:input});
        const rpcError=record(result.error), envelope=record(result.data), error=rpcError || record(envelope?.error);
        if(error) {
          const code=String(rpcError?error.message:error.code);
          if(knownCodes.has(code)) throw new HttpError(errorStatus(code),code);
          if(['22023','22P02','22007','22008'].includes(String(error.code))) throw new HttpError(422,'agent_invalid');
          throw new HttpError(503,'agent_api_unavailable');
        }
        const data=record(envelope?.data);
        if(!data) throw new HttpError(503,'agent_api_unavailable');
        return data;
      };
      const query=new URL(request.url).searchParams;
      if(new Set(query.keys()).size!==[...query.keys()].length) throw new HttpError(400,'invalid_request');
      const raw=Object.fromEntries(query), route=path.join('/');
      let action:string,data:Record<string,unknown>;
      if(request.method==='GET' && route==='calendar/schools') {
        action='schools';data=await call(action,page.extend({search:z.string().max(100).default('')}).parse(raw));
      } else if(request.method==='GET' && path.length===3 && path[0]==='calendar' && path[1]==='schools') {
        const input=z.object({schoolYear:z.coerce.number().pipe(calendarYear)}).strict().parse(raw);
        action='context';data=await call(action,{...input,schoolId:uuid.parse(path[2])});
      } else if(request.method==='POST' && route==='calendar/changes/preview') {
        empty.parse(raw);const input=calendarChange.parse(await jsonBody(request,262144));
        const context=await call('context',{schoolId:input.schoolId,schoolYear:input.schoolYear});
        const command=compileCalendarChange(context,input);
        action='preview';data=await call(action,{schoolId:input.schoolId,schoolYear:input.schoolYear,expectedVersion:input.expectedVersion,command});
      } else if(request.method==='POST' && route==='calendar/operations') {
        empty.parse(raw);action='commit';data=await call(action,{...commit.parse(await jsonBody(request)),requestKey:uuid.parse(request.headers.get('idempotency-key'))});
      } else if(request.method==='GET' && route==='calendar/operations') {
        action='operations';data=await call(action,page.parse(raw));
      } else if(request.method==='GET' && path.length===3 && path[0]==='calendar' && path[1]==='operations') {
        empty.parse(raw);action='operation';data=await call(action,{requestKey:uuid.parse(path[2])});
      } else throw new HttpError(404,'route_not_found');
      return response({data:project(action,data),error:data.state==='failed'?data.error:null},data.state==='failed'&&action==='commit'?errorStatus(String(record(data.error)?.code||'agent_write_failed')):200);
    } catch(error) {
      if(error instanceof z.ZodError) return response({data:null,error:{code:'invalid_request'}},400);
      if(error instanceof CalendarError && knownCodes.has(error.message)) return response({data:null,error:{code:error.message}},errorStatus(error.message));
      if(error instanceof HttpError) return response({data:null,error:{code:error.message}},error.status);
      return response({data:null,error:{code:'agent_api_unavailable'}},503);
    }
  };
}
