import { AiAgentRequestDetail } from '@/features/ai-agent/ai-agent-request-detail';
export default async function AiAgentRequestPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <AiAgentRequestDetail id={id}/>;}
