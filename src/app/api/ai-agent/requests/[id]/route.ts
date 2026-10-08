import { handleAiAgentRequest } from "@/features/ai-agent/server/ai-agent-production";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string;}>}) {
 const {id}=await context.params;
 return handleAiAgentRequest(request,{kind:'request',id});
}
export async function PATCH(request:Request,context:{params:Promise<{id:string;}>}) {
 const {id}=await context.params;
 return handleAiAgentRequest(request,{kind:'request',id});
}
