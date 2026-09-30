import { AgentAccessWorkspace } from "@/features/agent-api/agent-access-workspace";
export const dynamic = "force-dynamic";
export default function AgentAccessPage() {
  return <AgentAccessWorkspace apiEnabled={process.env.TIPS_AGENT_API_ENABLED === "true"} />;
}
