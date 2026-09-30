import { createClient } from "@supabase/supabase-js";
import { revalidatePath, revalidateTag } from "next/cache";
import { invalidatePublicClassesCache } from "@/server/public-classes-cache-invalidation.js";
import { createAgentEditApiHandler } from "./http-v2.ts";
import { createAgentApiHandler } from "./http.ts";
import { createAgentCalendarHandler } from "./http-calendar.ts";

const dependencies = {
  enabled: () => process.env.TIPS_AGENT_API_ENABLED === "true",
  refreshPublicCache: () => invalidatePublicClassesCache({ revalidateTag, revalidatePath }),
  rpc: async (name: string, input: Record<string, unknown>) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("agent_api_unavailable");
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    return await client.rpc(name, input);
  },
};

export const handleAgentApiRequest = createAgentApiHandler(dependencies);
const handleClassEdit = createAgentEditApiHandler(dependencies);
const handleCalendar = createAgentCalendarHandler(dependencies);
export const handleAgentEditApiRequest = (request: Request, path: string[]) => path[0] === "calendar" ? handleCalendar(request, path) : handleClassEdit(request, path);
