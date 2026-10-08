import { handleAiAgentRequest } from "@/features/ai-agent/server/ai-agent-production";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string;actionId:string;}>}) {
 const {id,actionId}=await context.params;
 return handleAiAgentRequest(request,{kind:'action',id,actionId});
}
export async function PATCH(request:Request,context:{params:Promise<{id:string;actionId:string;}>}) {
 const {id,actionId}=await context.params;
 return handleAiAgentRequest(request,{kind:'action',id,actionId});
}
