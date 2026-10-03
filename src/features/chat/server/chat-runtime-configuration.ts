import { z } from 'zod';
import { type AiRpc, AiHttpError } from '../../ai-agent/server/ai-agent-auth.ts';
import { chatSpaceSchema, chatSpaceResourceSchema } from './chat-contract.ts';
import { CHAT_SPACE_CATALOG, chatWebhookTarget, type ChatRuntimeSlot } from './chat-space-catalog.ts';
export const chatConfigurationSchema = z.strictObject({ revision: z.string().regex(/^[1-9][0-9]*$/), issuanceEnabled: z.boolean(), publicOrigin: z.string().nullable(), spaces: z.array(z.strictObject({ spaceKey: chatSpaceSchema, resourceName: chatSpaceResourceSchema.nullable(), revision: z.string().regex(/^[1-9][0-9]*$/) })).length(7) }).refine(v => new Set(v.spaces.map(s => s.spaceKey)).size === 7);
export function canonicalChatOrigin(value: string | undefined | null) {
    if (!value)
        return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin !== value)
            return null;
        return url.origin;
    }
    catch {
        return null;
    }
}
export function readChatRuntimeEnvironment(env: Record<string, string | undefined>) {
    const origin = canonicalChatOrigin(env.TIPS_AI_CHAT_PUBLIC_ORIGIN);
    const enabled = env.TIPS_AI_CHAT_ENABLED === 'true';
    const slots = CHAT_SPACE_CATALOG.map((entry, i) => {
        const resourceName = env[`TIPS_AI_CHAT_SPACE_${i + 1}_RESOURCE_NAME`], webhookUrl = env[entry.webhookEnv];
        if (!resourceName && !webhookUrl)
            return null;
        if (!enabled || !origin || !resourceName || !webhookUrl)
            throw new AiHttpError(403, 'ai_agent_space_forbidden');
        const slot = { spaceKey: entry.spaceKey, resourceName, webhookUrl, publicOrigin: origin };
        chatWebhookTarget(slot, { spaceKey: entry.spaceKey, expectedSpace: resourceName, purpose: 'ai_completion', threadName: null, upstreamRequestId: '00000000-0000-4000-8000-000000000000' });
        return slot;
    });
    return { enabled, origin, slots };
}
export function createProductionChatResolver(rpc: AiRpc, env: () => Record<string, string | undefined> = () => process.env) {
    return async (space: z.infer<typeof chatSpaceSchema>): Promise<ChatRuntimeSlot | null> => {
        const runtime = readChatRuntimeEnvironment(env());
        if (!runtime.enabled)
            return null;
        const result = await rpc('ai_agent_chat_configuration_api_v1', { p_action: 'get', p_input: {} });
        if (result.error)
            throw new AiHttpError(503, 'ai_agent_api_unavailable');
        const parsed = chatConfigurationSchema.safeParse(result.data);
        if (!parsed.success)
            throw new AiHttpError(503, 'ai_agent_api_unavailable');
        if (parsed.data.publicOrigin !== runtime.origin || parsed.data.spaces.some(row => row.resourceName !== (runtime.slots.find(slot => slot?.spaceKey === row.spaceKey)?.resourceName ?? null)))
            throw new AiHttpError(403, 'ai_agent_space_forbidden');
        return runtime.slots.find(slot => slot?.spaceKey === space) ?? null;
    };
}
export async function resolveBridgeSource(rpc: AiRpc, hash: string) {
    const result = await rpc('ai_agent_chat_bridge_grant_v1', { p_token_hash: hash });
    if (result.error) {
        const { throwAiRpcError } = await import('../../ai-agent/server/ai-agent-repository.ts');
        throwAiRpcError(result.error);
    }
    const value = z.strictObject({ bridgeSourceId: z.uuid(), spaceKeys: z.array(chatSpaceSchema).min(1), purposes: z.array(z.enum(['ai_completion', 'bridge_reply'])).min(1) }).safeParse(result.data);
    if (!value.success || !value.data.purposes.includes('bridge_reply'))
        throw new AiHttpError(503, 'ai_agent_api_unavailable');
    return value.data.bridgeSourceId;
}
