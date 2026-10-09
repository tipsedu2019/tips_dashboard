import { z } from 'zod';
import { AiHttpError, type AiRpc } from '../../ai-agent/server/ai-agent-auth.ts';
import { aiQuery, aiResponse, aiErrorResponse } from '../../ai-agent/server/ai-agent-routes.ts';
import { chatRpc, chatTokenHash, chatListSchema, chatStateSchema, chatGetSchema, chatMessageSchema, chatThreadSchema } from './chat-contract.ts';
const listQuerySchema = z.strictObject({ status: chatStateSchema.optional(), limit: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(50)).optional(), cursor: z.string().min(1).max(2048).optional() });
const querySchema = z.union([listQuerySchema, z.strictObject({ id: z.uuid().transform(v => v.toLowerCase()) }), z.strictObject({ clientMessageId: z.uuid().transform(v => v.toLowerCase()) })]);
export function createChatOutboxHandler(d: {
    rpc: AiRpc;
}) {
    return async (request: Request) => {
        try {
            if (request.method !== 'GET')
                throw new AiHttpError(405, 'method_not_allowed');
            const hash = chatTokenHash(request), query = querySchema.parse(aiQuery(request));
            if ('id' in query || 'clientMessageId' in query) {
                const receipt = chatGetSchema.parse(await chatRpc(d.rpc, hash, 'get', query));
                const outbox = receipt.outbox;
                if ('id' in query ? outbox.id !== query.id : outbox.clientMessageId !== query.clientMessageId)
                    throw new AiHttpError(503, 'ai_agent_api_unavailable');
                const result = outbox.state === 'sent' ? receipt.attempts.find(a => a.kind === 'result' && a.outcome === 'sent' && a.outboxId === outbox.id && a.attemptId === outbox.activeAttemptId) : undefined;
                let delivery = null;
                if (result) {
                    const parsedMessage = chatMessageSchema.safeParse(result.messageName), parsedThread = chatThreadSchema.safeParse(result.threadName);
                    if (!parsedMessage.success || !parsedThread.success)
                        throw new AiHttpError(503, 'ai_agent_api_unavailable');
                    const message = parsedMessage.data, thread = parsedThread.data;
                    if (!message.startsWith(`${outbox.expectedSpace}/messages/`) || !thread.startsWith(`${outbox.expectedSpace}/threads/`) || outbox.threadName !== null && thread !== outbox.threadName)
                        throw new AiHttpError(503, 'ai_agent_api_unavailable');
                    delivery = { messageName: message, threadName: thread };
                }
                return aiResponse({ outbox, delivery });
            }
            const input = { ...(query.limit === undefined ? {} : { limit: query.limit }), ...(query.cursor === undefined ? {} : { cursor: query.cursor }), ...(query.status === undefined || query.status === 'pending' ? {} : { state: query.status }) };
            return aiResponse(chatListSchema.parse(await chatRpc(d.rpc, hash, 'list', input)));
        }
        catch (error) {
            return aiErrorResponse(error);
        }
    };
}
