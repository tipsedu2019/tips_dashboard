import { z } from 'zod';
import { AiHttpError, type AiRpc } from '../../ai-agent/server/ai-agent-auth.ts';
import { aiQuery, aiResponse, aiErrorResponse } from '../../ai-agent/server/ai-agent-routes.ts';
import { chatRpc, chatTokenHash, chatListSchema, chatStateSchema } from './chat-contract.ts';
const querySchema = z.strictObject({ status: chatStateSchema.optional(), limit: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(50)).optional(), cursor: z.string().min(1).max(2048).optional() });
export function createChatOutboxHandler(d: {
    rpc: AiRpc;
}) {
    return async (request: Request) => {
        try {
            if (request.method !== 'GET')
                throw new AiHttpError(405, 'method_not_allowed');
            const hash = chatTokenHash(request), query = querySchema.parse(aiQuery(request));
            const input = { ...(query.limit === undefined ? {} : { limit: query.limit }), ...(query.cursor === undefined ? {} : { cursor: query.cursor }), ...(query.status === undefined || query.status === 'pending' ? {} : { state: query.status }) };
            return aiResponse(chatListSchema.parse(await chatRpc(d.rpc, hash, 'list', input)));
        }
        catch (error) {
            return aiErrorResponse(error);
        }
    };
}
