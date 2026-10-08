import { handleAiAgentSpacePolicy } from '@/features/ai-agent/server/ai-agent-production';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {return handleAiAgentSpacePolicy(request,{kind:'spaces'});}
