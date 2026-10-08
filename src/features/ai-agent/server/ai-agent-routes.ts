import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AI_REQUEST_STATUSES, aiCreateRequestSchema, aiRequestListQuerySchema, aiMessageInputSchema, aiDecimalSchema, aiSafeJsonObjectSchema } from '../ai-agent-request-contract.ts';
import { AiHttpError, authenticateAiAgent, type AiDependencies, type AiPrincipal } from './ai-agent-auth.ts';
import { executeAiOperation, type AiOperation } from './ai-agent-repository.ts';
import { createAgentResponseContract } from '../../agent-api/server/response-contract.ts';
export type AiRoute = {kind:'requests'}|{kind:'request'|'messages'|'resume'|'actions';id:string}|{kind:'action'|'reconcile';id:string;actionId:string};
const uuid=z.uuid(), hash=z.string().regex(/^[a-f0-9]{64}$/), timestamp=z.iso.datetime({offset:true});
const text=(max:number)=>z.string().refine(value=>value.trim().length>0 && [...value].length<=max);
const integer=z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(z.number().int().positive().max(50));
const page=z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(10000));
const cursor=z.string().min(1).max(2048);
const review=z.strictObject({reason:text(2000),confirmed:z.literal(true)});
const activityQuery=z.strictObject({afterMessageSeq:aiDecimalSchema.optional(),afterEventSeq:aiDecimalSchema.optional(),limit:integer.optional()});
const actionQuery=z.strictObject({limit:integer.optional(),cursor:cursor.optional()});
const botQuery=z.strictObject({status:z.literal('pending').optional(),limit:integer.optional(),cursor:z.string().min(1).max(512).optional()});
const employeeQuery=z.strictObject({page:page.optional(),pageSize:z.enum(['10','15','20']).transform(Number).optional(),scope:z.enum(['own','all']).optional(),status:z.enum(AI_REQUEST_STATUSES).optional(),search:z.string().max(200).optional()});
const registration=z.strictObject({actionKey:uuid,stepKey:text(100),kind:z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),target:text(500),payload:aiSafeJsonObjectSchema,payloadHash:hash});
const identity={revision:aiDecimalSchema,target:text(500),payloadHash:hash};
const effectEvidence=z.strictObject({resourceName:text(500).optional(),code:text(100).optional(),observation:text(5000).optional()});
const actionPatch=z.discriminatedUnion('state',[
 z.strictObject({state:z.literal('started'),...identity}),
 z.strictObject({state:z.literal('cancelled'),...identity,evidence:z.strictObject({code:text(100)})}),
 z.strictObject({state:z.literal('succeeded'),...identity,evidence:effectEvidence.refine(e=>!!e.resourceName)}),
 z.strictObject({state:z.literal('failed'),...identity,evidence:effectEvidence.refine(e=>!!e.code)}),
 z.strictObject({state:z.literal('unknown'),...identity,evidence:effectEvidence}),
]);
const resource=text(500).refine(value=>/^[A-Za-z][A-Za-z0-9_-]*(\/[A-Za-z0-9_.:-]+)+$/.test(value));
const reconcileEvidence=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('manual_observation'),target:text(500),payloadHash:hash,resourceName:resource,observedAt:timestamp,observation:text(5000)}),
 z.strictObject({type:z.literal('domain_receipt'),target:text(500),payloadHash:hash,receiptId:text(500)}),
]);
export const aiConflictRecoveryPolicy:Readonly<Record<string,'stop'|'refresh_and_revalidate_same_intent'>>={
 ai_agent_stale_version:'refresh_and_revalidate_same_intent',ai_agent_claim_lost:'stop',ai_agent_conflict:'stop',ai_agent_terminal:'stop',ai_agent_idempotency_conflict:'stop',ai_agent_effect_unresolved:'stop',ai_agent_question_conflict:'stop',ai_agent_immutable:'stop',
};
// Stale refresh is conditional on unchanged intent/owner/state and the same live
// generation. Keep the logical key. Unknown delivery uses same-key receipt lookup.
// No handler automatically reads, retries, releases or starts a second effect.
export function aiResponse(data:unknown,error:{code:string}|null=null,status=200) {
 return Response.json({data,error},{status,headers:{'Cache-Control':'no-store, private','Vary':'Authorization','X-Content-Type-Options':'nosniff',...(status===401?{'WWW-Authenticate':'Bearer realm="tips-ai-agent"'}:{}),...(status===429?{'Retry-After':'60'}:{})}});
}
export function aiErrorResponse(error:unknown) {
 if(error instanceof z.ZodError) return aiResponse(null,{code:'invalid_request'},400);
 if(error instanceof AiHttpError) return aiResponse(null,{code:error.message},error.status);
 return aiResponse(null,{code:'ai_agent_api_unavailable'},503);
}
export async function aiJsonBody(request:Request):Promise<unknown> {
 if(request.headers.get('content-type')?.split(';',1)[0].trim()!=='application/json') throw new AiHttpError(415,'json_required');
 const reader=request.body?.getReader();if(!reader) throw new AiHttpError(400,'invalid_request');
 let size=0;const chunks:Uint8Array[]=[];
 try {for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>131072){await reader.cancel();throw new AiHttpError(413,'request_too_large');}chunks.push(item.value);}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
 catch(error){if(error instanceof AiHttpError)throw error;throw new AiHttpError(400,'invalid_json');}finally{reader.releaseLock();}
}
export function aiQuery(request:Request) {
 const query=new URL(request.url).searchParams;
 if(new Set(query.keys()).size!==[...query.keys()].length) throw new AiHttpError(400,'invalid_request');
 return Object.fromEntries(query);
}
export function aiWriteKey(request:Request) {
 const key=request.headers.get('idempotency-key');if(key===null) throw new AiHttpError(428,'ai_agent_idempotency_required');return uuid.parse(key);
}
export function aiRequestVersion(request:Request) {
 const header=request.headers.get('if-match');if(header===null) throw new AiHttpError(428,'ai_agent_precondition_required');
 const value=/^"r([1-9][0-9]*)"$/.exec(header)?.[1];return aiDecimalSchema.parse(value);
}
function claimInput(request:Request,generationRequired:boolean) {
 const raw=request.headers.get('x-claim-token');if(raw===null) throw new AiHttpError(428,'ai_agent_precondition_required');
 const nonce=hash.parse(raw);const generation=request.headers.get('x-claim-generation');
 if(generationRequired && generation===null) throw new AiHttpError(428,'ai_agent_precondition_required');
 if(!generationRequired && generation!==null) throw new AiHttpError(400,'invalid_request');
 return {claimTokenHash:createHash('sha256').update(nonce).digest('hex'),...(generationRequired?{claimGeneration:aiDecimalSchema.parse(generation)}:{})};
}
function requireUser(principal:AiPrincipal,admin=false) {if(principal.kind!=='user'||admin&&principal.role!=='admin')throw new AiHttpError(403,'ai_agent_forbidden');}
function requireBot(principal:AiPrincipal) {if(principal.kind!=='bot')throw new AiHttpError(403,'ai_agent_forbidden');}
function noClaimHeaders(request:Request){if(request.headers.has('x-claim-token')||request.headers.has('x-claim-generation'))throw new AiHttpError(400,'invalid_request');}
async function selectOperation(request:Request,route:AiRoute,principal:AiPrincipal):Promise<{operation:AiOperation;input:Record<string,unknown>}> {
 const query=aiQuery(request),method=request.method;
 const id=route.kind==='requests'?undefined:uuid.parse(route.id);
 const actionId=route.kind==='action'||route.kind==='reconcile'?uuid.parse(route.actionId):undefined;
 if(method==='GET') {
  noClaimHeaders(request);
  if(route.kind==='requests') {
   const input=principal.kind==='bot'?botQuery.parse(query):aiRequestListQuerySchema.parse(employeeQuery.parse(query));
   if(principal.kind==='user' && 'scope' in input && input.scope==='all' && principal.role!=='admin')throw new AiHttpError(403,'ai_agent_forbidden');
   return {operation:'list',input};
  }
  if(route.kind==='request')return {operation:'activity',input:{id,...activityQuery.parse(query)}};
  if(route.kind==='actions')return {operation:'actions',input:{id,...actionQuery.parse(query)}};
  if(route.kind==='action')return {operation:'action_events',input:{id,actionId,...actionQuery.parse(query)}};
  throw new AiHttpError(405,'method_not_allowed');
 }
 z.strictObject({}).parse(query);
 const idempotencyKey=aiWriteKey(request);
 if(method==='POST' && route.kind==='requests') {requireUser(principal);noClaimHeaders(request);return {operation:'create',input:{...aiCreateRequestSchema.parse(await aiJsonBody(request)),idempotencyKey}};}
 if(method==='POST' && route.kind==='messages'){requireUser(principal);noClaimHeaders(request);const version=aiRequestVersion(request);return {operation:'append_message',input:{id,version,idempotencyKey,...aiMessageInputSchema.parse(await aiJsonBody(request))}};}
 if(method==='POST' && route.kind==='resume'){requireUser(principal,true);noClaimHeaders(request);const version=aiRequestVersion(request);return {operation:'resume',input:{id,version,idempotencyKey,...review.parse(await aiJsonBody(request))}};}
 if(method==='PATCH' && route.kind==='request') {
  const version=aiRequestVersion(request);
  if(principal.kind==='user'){noClaimHeaders(request);z.strictObject({status:z.literal('cancelled')}).parse(await aiJsonBody(request));return {operation:'cancel',input:{id,version,idempotencyKey}};}
  const body=z.discriminatedUnion('status',[
   z.strictObject({status:z.literal('processing'),message:text(5000).optional()}),
   z.strictObject({status:z.literal('question'),message:text(5000)}),
   z.strictObject({status:z.literal('done'),result:text(20000)}),
  ]).parse(await aiJsonBody(request));
  const operation=body.status==='processing'?(request.headers.has('x-claim-generation')?('message' in body && body.message!==undefined?'progress':'renew'):'claim'):body.status;
  if(operation==='claim' && 'message' in body && body.message!==undefined)throw new AiHttpError(400,'invalid_request');
  return {operation,input:{id,version,idempotencyKey,...claimInput(request,operation!=='claim'),...('message' in body && body.message!==undefined?{text:body.message}:{}),...('result' in body?{result:body.result}:{})}};
 }
 if(method==='POST' && route.kind==='actions'){requireBot(principal);return {operation:'register_action',input:{id,idempotencyKey,...claimInput(request,true),...registration.parse(await aiJsonBody(request))}};}
 if(method==='PATCH' && route.kind==='action'){
  requireBot(principal);const body=actionPatch.parse(await aiJsonBody(request));
  if(body.state==='started'){const {state,...input}=body;void state;return {operation:'start_action',input:{id,actionId,idempotencyKey,...claimInput(request,true),...input}};}
  if(body.state!=='cancelled')noClaimHeaders(request);
  return {operation:'record_action',input:{id,actionId,idempotencyKey,...body,...(body.state==='cancelled'?claimInput(request,true):{})}};
 }
 if(method==='POST' && route.kind==='reconcile'){requireUser(principal,true);noClaimHeaders(request);return {operation:'reconcile_action',input:{id,actionId,idempotencyKey,...z.strictObject({revision:aiDecimalSchema,outcome:z.enum(['succeeded','failed']),evidence:reconcileEvidence,...review.shape}).transform(({outcome,...rest})=>({...rest,state:outcome})).parse(await aiJsonBody(request))}};}
 throw new AiHttpError(405,'method_not_allowed');
}
export function createAiAgentRouteHandler(dependencies:AiDependencies) {
 return async(request:Request,route:AiRoute):Promise<Response>=>{
  const contract=createAgentResponseContract(request);
  try {
   const principal=await authenticateAiAgent(request,dependencies);
   const {operation,input}=await selectOperation(request,route,principal);
   if (typeof input.id==='string') contract.result('state',`/api/ai-agent/requests/${input.id}${typeof input.actionId==='string'?`/actions/${input.actionId}`:''}`);
   const data=await executeAiOperation(principal,operation,input);
   if (operation==='create' && data && typeof data==='object' && 'id' in data) contract.result('state',`/api/ai-agent/requests/${data.id}`);
   contract.accepted(principal.kind==='user'?'employee_session':'ai_request');
   return contract.finish(aiResponse(data),{data,error:null});
  }
  catch(error){return contract.finish(aiErrorResponse(error));}
 };
}
