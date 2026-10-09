import { supabase } from "@/lib/supabase";
import type { PersonalConnectionService } from "./personal-connection-contract";

// Authenticated browser RPC only. Never accept owner/issuer/scope from callers,
// retry mutations, log raw failures, or send a credential to a second service.
async function call(action: string, input: object, signal: AbortSignal): Promise<unknown> {
  if (!supabase) throw new Error("personal_connection_unavailable");
  const { data, error } = await supabase.rpc("agent_personal_connection_v1", { p_action: action, p_input: input }).abortSignal(signal).retry(false);
  if (error) throw new Error("personal_connection_failed");
  return data;
}
export const personalConnectionService: PersonalConnectionService = Object.freeze<PersonalConnectionService>({
  load: ({ signal, ...input }) => call("snapshot", input, signal),
  targets: ({ signal, ...input }) => call("targets", input, signal),
  issue: input => call("issue", input, AbortSignal.timeout(15_000)),
  revoke: input => call("revoke", input, AbortSignal.timeout(15_000)),
});
