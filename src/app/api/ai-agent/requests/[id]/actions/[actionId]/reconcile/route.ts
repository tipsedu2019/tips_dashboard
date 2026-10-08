import { handleAiAgentRequest } from "@/features/ai-agent/server/ai-agent-production";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request,context:{params:Promise<{id:string;actionId:string;}>}) {
 const {id,actionId}=await context.params;
 return handleAiAgentRequest(request,{kind:'reconcile',id,actionId});
}
