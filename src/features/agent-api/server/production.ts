import { createClient } from "@supabase/supabase-js";
import { createAgentApiHandler } from "./http.ts";

export const handleAgentApiRequest = createAgentApiHandler({
  enabled: () => process.env.TIPS_AGENT_API_ENABLED === "true",
  rpc: async (name, input) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("agent_api_unavailable");
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    return await client.rpc(name, input);
  },
});
