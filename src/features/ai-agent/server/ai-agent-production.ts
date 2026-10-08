import { createClient } from '@supabase/supabase-js';
import { type AiDependencies, AiHttpError } from './ai-agent-auth.ts';
import { createAiAgentRouteHandler } from './ai-agent-routes.ts';
import { createAiAgentSpacePolicyHandler } from './ai-agent-space-policy-route.ts';
function configured(name:string) {const value=process.env[name]?.trim();if(!value)throw new AiHttpError(503,'ai_agent_api_unavailable');return value;}
export const aiAgentProductionDependencies:AiDependencies = {
 employeeClient:token=>{
  const client=createClient(configured('NEXT_PUBLIC_SUPABASE_URL'),configured('NEXT_PUBLIC_SUPABASE_ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`}}});
  return {auth:{getUser:async supplied=>{const result=await client.auth.getUser(supplied);return {data:{user:result.data.user?{id:result.data.user.id}:null},error:result.error};}},rpc:(name,input)=>client.rpc(name,input).abortSignal(AbortSignal.timeout(8000)).retry(false)};
 },
 botRpc:(name,input)=>{
  const client=createClient(configured('NEXT_PUBLIC_SUPABASE_URL'),configured('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  return client.rpc(name,input).abortSignal(AbortSignal.timeout(8000)).retry(false);
 },
};
export const handleAiAgentRequest=createAiAgentRouteHandler(aiAgentProductionDependencies);
export const handleAiAgentSpacePolicy=createAiAgentSpacePolicyHandler(aiAgentProductionDependencies);
