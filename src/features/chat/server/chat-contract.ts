import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AiHttpError, type AiRpc } from '../../ai-agent/server/ai-agent-auth.ts';
import { throwAiRpcError } from '../../ai-agent/server/ai-agent-repository.ts';
export const chatSpaceSchema = z.enum(['space_1', 'space_2', 'space_3', 'space_4', 'space_5', 'space_6', 'space_7']);
const uuid = z.uuid(), decimal = z.string().regex(/^[1-9][0-9]*$/), timestamp = z.iso.datetime({ offset: true });
export const chatSpaceResourceSchema = z.string().max(200).regex(/^spaces\/[A-Za-z0-9_-]+$/);
export const chatThreadSchema = z.string().max(500).regex(/^spaces\/[A-Za-z0-9_-]+\/threads\/[A-Za-z0-9_-]+$/);
export const chatMessageSchema = z.string().max(200).regex(/^spaces\/[A-Za-z0-9_-]+\/messages\/[A-Za-z0-9_.-]+$/);
const text = z.string().refine(v => v.trim().length > 0 && [...v].length <= 20000);
export const chatPayloadSchema = z.strictObject({ text, thread: z.strictObject({ name: chatThreadSchema }).optional() });
export const chatSendBodySchema = z.strictObject({ space: chatSpaceSchema, thread: chatThreadSchema.optional(), text });
export const chatStateSchema = z.enum(['pending', 'sending', 'sent', 'retry_wait', 'failed', 'delivery_unknown', 'cancelled', 'incident']);
export const chatOutboxSchema = z.strictObject({
    id: uuid, requestId: uuid.nullable(), completionEventId: uuid.nullable(), bridgeSourceId: uuid.nullable(), sourceEventId: chatMessageSchema.nullable(), purpose: z.enum(['ai_completion', 'bridge_reply']), spaceKey: chatSpaceSchema, expectedSpace: chatSpaceResourceSchema.nullable(), threadName: chatThreadSchema.nullable(), payload: chatPayloadSchema, payloadHash: z.string().regex(/^[a-f0-9]{64}$/), upstreamRequestId: uuid, state: chatStateSchema, revision: decimal, reason: z.string().max(200).nullable(), attemptCount: z.number().int().min(0).max(5), activeAttemptId: uuid.nullable(), leaseExpiresAt: timestamp.nullable(), readyAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
}).superRefine((o, ctx) => {
    const valid = o.purpose === 'bridge_reply' ? o.requestId === null && o.completionEventId === null && o.bridgeSourceId !== null && o.sourceEventId !== null && o.threadName !== null && o.payload.thread?.name === o.threadName : o.requestId !== null && o.completionEventId !== null && o.bridgeSourceId === null && o.sourceEventId === null && o.threadName === null && o.payload.thread === undefined;
    if (!valid)
        ctx.addIssue({ code: 'custom', message: 'Invalid intent identity' });
});
export const chatAttemptSchema = z.strictObject({ id: uuid, attemptId: uuid, outboxId: uuid, credentialId: uuid, seq: decimal, kind: z.enum(['started', 'result', 'lease_expired', 'incident']), outcome: z.string().max(100).nullable(), code: z.string().max(100).nullable(), messageName: z.string().max(500).nullable(), threadName: z.string().max(500).nullable(), createdAt: timestamp });
export const chatGetSchema = z.strictObject({ outbox: chatOutboxSchema, attempts: z.array(chatAttemptSchema).max(50) });
export const chatOriginSchema = z.strictObject({ outbox: chatOutboxSchema, created: z.boolean() });
export const chatPreparedSchema = z.strictObject({ outbox: chatOutboxSchema, attempt: chatAttemptSchema.nullable() });
export const chatListSchema = z.strictObject({ items: z.array(chatOutboxSchema).max(50), nextCursor: z.string().min(1).max(2048).nullable() });
export type ChatIntent = z.infer<typeof chatOutboxSchema>;
export type ChatSendBody = z.infer<typeof chatSendBodySchema>;
export type ChatOperation = 'chat_outbox' | 'get' | 'list' | 'prepare_attempt' | 'record_attempt';
export function chatTokenHash(request: Request) {
    const token = /^Bearer (tips_agent_[a-f0-9]{64})$/.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token)
        throw new AiHttpError(401, 'ai_agent_unauthorized');
    return createHash('sha256').update(token).digest('hex');
}
const errors: Readonly<Record<string, number>> = { chat_source_event_invalid: 422, chat_thread_invalid: 422, chat_payload_too_large: 422, chat_payload_invalid: 422, chat_rate_limited: 429 };
export async function chatRpc(rpc: AiRpc, tokenHash: string, operation: ChatOperation, input: Record<string, unknown>) {
    const result = await rpc('ai_agent_chat_api_v1', { p_token_hash: tokenHash, p_action: operation, p_input: input });
    if (result.error) {
        const message = typeof result.error === 'object' && result.error !== null && 'message' in result.error ? result.error.message : null;
        if (typeof message === 'string' && Object.prototype.hasOwnProperty.call(errors, message))
            throw new AiHttpError(errors[message], message);
        throwAiRpcError(result.error);
    }
    const schema = operation === 'list' ? chatListSchema : operation === 'get' ? chatGetSchema : operation === 'chat_outbox' ? chatOriginSchema : chatPreparedSchema;
    const parsed = schema.safeParse(result.data);
    if (!parsed.success)
        throw new AiHttpError(503, 'ai_agent_api_unavailable');
    return parsed.data;
}
// Compare fields, never the PostgreSQL jsonb::text hash with JSON.stringify bytes.
export function matchChatBody(o: ChatIntent, body: ChatSendBody) {
    if (o.spaceKey !== body.space || (o.threadName ?? undefined) !== body.thread || o.payload.text !== body.text || (o.payload.thread?.name ?? undefined) !== body.thread)
        throw new AiHttpError(409, 'ai_agent_idempotency_conflict');
}
export function sameChatIdentity(a: ChatIntent, b: ChatIntent) {
    return ['id', 'requestId', 'completionEventId', 'bridgeSourceId', 'sourceEventId', 'purpose', 'spaceKey', 'expectedSpace', 'threadName', 'payloadHash', 'upstreamRequestId'].every(k => a[k as keyof ChatIntent] === b[k as keyof ChatIntent]) && a.payload.text === b.payload.text && a.payload.thread?.name === b.payload.thread?.name;
}
export function validateChatCompletion(o: ChatIntent, origin: string | undefined) {
    if (o.purpose !== 'ai_completion')
        return;
    let approved: URL;
    try {
        approved = new URL(origin ?? '');
    }
    catch {
        throw new AiHttpError(403, 'ai_agent_space_forbidden');
    }
    if (approved.protocol !== 'https:' || approved.username || approved.password || approved.pathname !== '/' || approved.search || approved.hash)
        throw new AiHttpError(403, 'ai_agent_space_forbidden');
    const suffix = ` · 완료\n${approved.origin}/admin/ai-agent/${o.requestId}`;
    const title = o.payload.text.endsWith(suffix) ? o.payload.text.slice(0, -suffix.length) : '';
    if (!title.trim() || [...title].length > 200 || /[\u0000-\u001f\u007f<>\[\]()*_~`@]/.test(title) || title !== title.trim())
        throw new AiHttpError(422, 'chat_payload_invalid');
}
