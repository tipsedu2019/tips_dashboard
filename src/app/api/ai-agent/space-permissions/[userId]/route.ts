import { handleAiAgentSpacePolicy } from '@/features/ai-agent/server/ai-agent-production';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{userId:string}>}) {
 const {userId}=await context.params;return handleAiAgentSpacePolicy(request,{kind:'space-permissions',userId});
}
export async function PATCH(request:Request,context:{params:Promise<{userId:string}>}) {
 const {userId}=await context.params;return handleAiAgentSpacePolicy(request,{kind:'space-permissions',userId});
}
