import { aiRequestSchema, aiRequestListSchema, aiActivitySchema, aiBotListSchema, aiClaimMutationSchema, aiMessageMutationSchema, aiDoneMutationSchema, aiActionSchema, aiActionsSchema, aiActionJournalSchema } from '../ai-agent-request-contract.ts';
import { AiHttpError, type AiPrincipal } from './ai-agent-auth.ts';
export type AiOperation = 'create'|'list'|'activity'|'append_message'|'cancel'|'resume'|'claim'|'renew'|'progress'|'question'|'done'|'register_action'|'start_action'|'record_action'|'reconcile_action'|'actions'|'action_events';
export const aiErrorStatuses:Readonly<Record<string,number>> = {
  ai_agent_unauthorized:401,ai_agent_forbidden:403,ai_agent_scope_forbidden:403,ai_agent_grant_forbidden:403,ai_agent_action_forbidden:403,ai_agent_space_forbidden:403,
  ai_agent_not_found:404,ai_agent_conflict:409,ai_agent_stale_version:409,ai_agent_claim_lost:409,ai_agent_terminal:409,ai_agent_question_conflict:409,ai_agent_effect_unresolved:409,ai_agent_immutable:409,ai_agent_idempotency_conflict:409,
  ai_agent_precondition_required:428,ai_agent_idempotency_required:428,ai_agent_rate_limited:429,ai_agent_invalid:422,ai_agent_evidence_required:422,ai_agent_review_required:422,ai_agent_cursor_invalid:422,
};
export function throwAiRpcError(error:unknown):never {
  const entry=error && typeof error==='object' ? error as {message?:unknown;code?:unknown} : null;
  const code=typeof entry?.message==='string'?entry.message:'';
  if(Object.prototype.hasOwnProperty.call(aiErrorStatuses,code)) throw new AiHttpError(aiErrorStatuses[code],code);
  if(['22023','22P02','22007','22008'].includes(String(entry?.code))) throw new AiHttpError(422,'ai_agent_invalid');
  throw new AiHttpError(503,'ai_agent_api_unavailable');
}
export function parseAiAgentOutput(operation:AiOperation,kind:AiPrincipal['kind'],data:unknown):unknown {
  const schema=operation==='list'?(kind==='bot'?aiBotListSchema:aiRequestListSchema):operation==='activity'?aiActivitySchema:operation==='actions'?aiActionsSchema:operation==='action_events'?aiActionJournalSchema:
    ['claim','renew'].includes(operation)?aiClaimMutationSchema:['append_message','progress','question'].includes(operation)?aiMessageMutationSchema:operation==='done'?aiDoneMutationSchema:
    ['register_action','start_action','record_action','reconcile_action'].includes(operation)?aiActionSchema:aiRequestSchema;
  const result=schema.safeParse(data);
  if(!result.success) throw new AiHttpError(503,'ai_agent_api_unavailable');
  return result.data;
}
export async function executeAiOperation(principal:AiPrincipal,operation:AiOperation,input:Record<string,unknown>) {
  const result=await principal.rpc(principal.kind==='bot'?'ai_agent_bot_api_v1':'ai_agent_user_api_v1',{...(principal.kind==='bot'?{p_token_hash:principal.tokenHash}:{}),p_action:operation,p_input:input});
  if(result.error) throwAiRpcError(result.error);
  return parseAiAgentOutput(operation,principal.kind,result.data);
}
