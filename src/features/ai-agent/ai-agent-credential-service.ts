import { z } from 'zod';
import { type AiRequestActor, sameAiRequestActor } from './ai-agent-request-access';
const scope = z.enum(['ai-agent:requests:read', 'ai-agent:requests:claim', 'ai-agent:requests:update', 'chat:outbox:read', 'chat:send']);
const spaces = z.enum(['space_1', 'space_2', 'space_3', 'space_4', 'space_5', 'space_6', 'space_7']);
export const credentialGrantSchema = z.strictObject({ queues: z.array(z.literal('employee_requests')).optional(), actions: z.array(z.enum(['read', 'claim', 'renew', 'progress', 'question', 'done'])).optional(), spaceKeys: z.array(spaces).optional(), purposes: z.array(z.enum(['ai_completion', 'bridge_reply'])).optional(), bridgeSourceId: z.uuid().optional() });
const fields = { id: z.uuid(), label: z.string().min(1).max(80), scopes: z.array(scope), grant: credentialGrantSchema, expiresAt: z.iso.datetime({ offset: true }) };
export const credentialIssueSchema = z.strictObject({ ...fields, token: z.string().regex(/^tips_agent_[a-f0-9]{64}$/).nullable() });
export const credentialListSchema = z.strictObject({ supportEnabled: z.boolean(), total: z.number().int().nonnegative(), items: z.array(z.strictObject({ ...fields, createdAt: z.iso.datetime({ offset: true }), revokedAt: z.iso.datetime({ offset: true }).nullable(), lastUsedAt: z.iso.datetime({ offset: true }).nullable() })) });
export type AiCredential = z.infer<typeof credentialListSchema>['items'][number];
export type AiCredentialCreate = {
    label: string;
    scopes: z.infer<typeof scope>[];
    grant: z.infer<typeof credentialGrantSchema>;
    expiresAt: string | null;
};
export class AiCredentialError extends Error {
    constructor(public definite: boolean, message = 'credential_failed') { super(message); }
}
export function createAiAgentCredentialService(d: {
    actor: AiRequestActor;
    getCurrentActor: () => AiRequestActor | null;
    rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
        data: unknown;
        error: unknown;
    }>;
}) {
    const active = () => d.actor.role === 'admin' && sameAiRequestActor(d.actor, d.getCurrentActor());
    const check = () => {
        if (!active())
            throw new AiCredentialError(true, 'actor_changed');
    };
    async function invoke(action: string, input: Record<string, unknown>) {
        check();
        let response;
        try {
            response = await d.rpc('ai_agent_credential_api_v1', { p_action: action, p_input: input });
        }
        catch {
            check();
            throw new AiCredentialError(false);
        }
        check();
        if (response.error) {
            const code = typeof response.error === 'object' && response.error !== null && 'code' in response.error ? String(response.error.code) : '';
            throw new AiCredentialError(['42501', '22023', '23514', '55000', 'P0002', '54000'].includes(code));
        }
        return response.data;
    }
    return { active, list: async (page: number, pageSize: number) => { const input = z.strictObject({ page: z.number().int().positive(), pageSize: z.union([z.literal(10), z.literal(15), z.literal(20)]) }).parse({ page, pageSize }); return credentialListSchema.parse(await invoke('list', input)); },
        create: async (payload: AiCredentialCreate, key: string) => credentialIssueSchema.parse(await invoke('create', { ...payload, idempotencyKey: z.uuid().parse(key) })),
        revoke: async (id: string, key: string) => z.strictObject({ id: z.uuid(), revokedAt: z.iso.datetime({ offset: true }) }).parse(await invoke('revoke', { id: z.uuid().parse(id), idempotencyKey: z.uuid().parse(key) })) };
}
