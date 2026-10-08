import { handleAiAgentRequest } from "@/features/ai-agent/server/ai-agent-production";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request) {return handleAiAgentRequest(request,{kind:'requests'});}
export async function POST(request:Request) {return handleAiAgentRequest(request,{kind:'requests'});}
