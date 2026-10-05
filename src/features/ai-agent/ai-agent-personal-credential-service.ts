import { z } from 'zod';
import { AiCredentialError, credentialGrantSchema } from './ai-agent-credential-service';
import { type AiRequestActor, sameAiRequestActor } from './ai-agent-request-access';

const uuid = z.uuid();
const scope = z.enum([
  'ai-agent:requests:read', 'ai-agent:requests:claim', 'ai-agent:requests:update',
  'chat:outbox:read', 'chat:send',
]);
const grant = credentialGrantSchema.refine(
  value => !value.bridgeSourceId && !value.purposes?.includes('bridge_reply'),
  { message: 'personal_bridge_forbidden' },
);
const metadata = {
  id: uuid,
  label: z.string().trim().min(1).max(80),
  credentialKind: z.literal('personal'),
  ownerProfileId: uuid,
  issuerProfileId: uuid,
  scopes: z.array(scope).min(1),
  grant,
  expiresAt: z.iso.datetime({ offset: true }),
};
export const personalCredentialIssueSchema = z.strictObject({
  ...metadata,
  token: z.string().regex(/^tips_agent_[a-f0-9]{64}$/).nullable(),
});
export const personalCredentialListSchema = z.strictObject({
  supportEnabled: z.boolean(),
  total: z.number().int().nonnegative(),
  items: z.array(z.strictObject({
    ...metadata,
    createdAt: z.iso.datetime({ offset: true }),
    revokedAt: z.iso.datetime({ offset: true }).nullable(),
    lastUsedAt: z.iso.datetime({ offset: true }).nullable(),
  })),
});
export const personalCredentialCreateSchema = z.strictObject({
  label: metadata.label,
  ownerProfileId: uuid,
  scopes: metadata.scopes,
  grant,
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
});
export type AiPersonalCredentialCreate = z.infer<typeof personalCredentialCreateSchema>;
export type AiPersonalCredential = z.infer<typeof personalCredentialListSchema>['items'][number];

type Dependencies = {
  actor: AiRequestActor;
  getCurrentActor: () => AiRequestActor | null;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};
const definiteSqlStates = new Set(['42501', '22023', '23514', '55000', 'P0002', '54000']);

// This admin management client never creates a bot principal from a user JWT.
// Owner identity is required metadata; central credentials have a separate client.
export function createAiAgentPersonalCredentialService(d: Dependencies) {
  const active = () => ['admin', 'teacher'].includes(d.actor.role)
    && sameAiRequestActor(d.actor, d.getCurrentActor());
  const canCreate = () => active() && d.actor.role === 'admin';
  const check = (action: string) => {
    if (!active() || action === 'create' && !canCreate()) {
      throw new AiCredentialError(true, 'actor_changed');
    }
  };
  async function invoke(action: string, input: Record<string, unknown>) {
    check(action);
    let response;
    try {
      response = await d.rpc('ai_agent_personal_credential_api_v1', { p_action: action, p_input: input });
    } catch {
      check(action);
      throw new AiCredentialError(false);
    }
    check(action);
    if (response.error) {
      const code = typeof response.error === 'object' && response.error !== null && 'code' in response.error
        ? String(response.error.code) : '';
      throw new AiCredentialError(definiteSqlStates.has(code));
    }
    return response.data;
  }
  function parse<T>(schema: z.ZodType<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) throw new AiCredentialError(false, 'personal_credential_invalid');
    return result.data;
  }
  return {
    active,
    canCreate,
    async create(payload: AiPersonalCredentialCreate, key: string) {
      check('create');
      const input = personalCredentialCreateSchema.parse(payload);
      const result = parse(personalCredentialIssueSchema, await invoke('create', {
        ...input, idempotencyKey: uuid.parse(key),
      }));
      if (result.ownerProfileId !== input.ownerProfileId || result.issuerProfileId !== d.actor.userId) {
        throw new AiCredentialError(false, 'personal_credential_invalid');
      }
      return result;
    },
    async list(page: number, pageSize: number) {
      check('list');
      const input = z.strictObject({
        page: z.number().int().min(1).max(10000),
        pageSize: z.union([z.literal(10), z.literal(15), z.literal(20)]),
      }).parse({ page, pageSize });
      const result = parse(personalCredentialListSchema, await invoke('list', input));
      if (result.items.some(item => d.actor.role === 'teacher'
        ? item.ownerProfileId !== d.actor.userId : item.issuerProfileId !== d.actor.userId)) {
        throw new AiCredentialError(false, 'personal_credential_invalid');
      }
      return result;
    },
    async revoke(id: string, key: string) {
      check('revoke');
      const input = { id: uuid.parse(id), idempotencyKey: uuid.parse(key) };
      const result = parse(z.strictObject({ id: uuid, revokedAt: z.iso.datetime({ offset: true }) }),
        await invoke('revoke', input));
      if (result.id !== input.id) throw new AiCredentialError(false, 'personal_credential_invalid');
      return result;
    },
  };
}
