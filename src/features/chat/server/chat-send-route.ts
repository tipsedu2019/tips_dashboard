import { z } from 'zod';
import { AiHttpError, type AiRpc } from '../../ai-agent/server/ai-agent-auth.ts';
import { aiResponse, aiErrorResponse, aiJsonBody, aiQuery, aiWriteKey } from '../../ai-agent/server/ai-agent-routes.ts';
import { chatRpc, chatTokenHash, chatSendBodySchema, chatMessageSchema, chatGetSchema, chatOriginSchema, chatPreparedSchema, matchChatBody, sameChatIdentity, validateChatCompletion, type ChatIntent } from './chat-contract.ts';
import { dispatchGoogleChat, validateChatTransportIntent } from './google-chat-transport.ts';
import { type ChatRuntimeSlot } from './chat-space-catalog.ts';
export type ChatSendDependencies = {
    rpc: AiRpc;
    resolveSlot: (space: ChatIntent['spaceKey']) => ChatRuntimeSlot | null | Promise<ChatRuntimeSlot | null>;
    bridgeSourceId: (tokenHash: string) => Promise<string>;
    fetch: typeof fetch;
    completionOrigin?: string;
};
export function createChatSendHandler(d: ChatSendDependencies) {
    return async (request: Request) => {
        try {
            if (request.method !== 'POST')
                throw new AiHttpError(405, 'method_not_allowed');
            const hash = chatTokenHash(request), key = aiWriteKey(request);
            z.strictObject({}).parse(aiQuery(request));
            const body = chatSendBodySchema.parse(await aiJsonBody(request));
            const bridge = request.headers.get('x-bridge-event-id'), intent = request.headers.get('x-chat-intent-id');
            if ((bridge === null) === (intent === null))
                throw new AiHttpError(400, 'invalid_request');
            let outbox: ChatIntent;
            if (bridge !== null) {
                const source = chatMessageSchema.parse(bridge);
                if (!body.thread)
                    throw new AiHttpError(422, 'chat_thread_invalid');
                const bridgeSourceId = z.uuid().parse(await d.bridgeSourceId(hash));
                const origin = chatOriginSchema.parse(await chatRpc(d.rpc, hash, 'chat_outbox', { idempotencyKey: key, bridgeSourceId, sourceEventId: source, spaceKey: body.space, threadName: body.thread, text: body.text }));
                outbox = origin.outbox;
                matchChatBody(outbox, body);
                if (outbox.purpose !== 'bridge_reply' || outbox.bridgeSourceId !== bridgeSourceId || outbox.sourceEventId !== source)
                    throw new AiHttpError(503, 'ai_agent_api_unavailable');
                if (!origin.created)
                    return aiResponse({ outbox });
            }
            else {
                const id = z.uuid().parse(intent);
                outbox = chatGetSchema.parse(await chatRpc(d.rpc, hash, 'get', { id })).outbox;
                if (outbox.id !== id)
                    throw new AiHttpError(503, 'ai_agent_api_unavailable');
                matchChatBody(outbox, body);
            }
            if (['sending', 'sent', 'delivery_unknown', 'incident', 'cancelled', 'failed'].includes(outbox.state))
                return aiResponse({ outbox });
            const slot = await d.resolveSlot(outbox.spaceKey);
            if (!slot)
                throw new AiHttpError(403, 'ai_agent_space_forbidden');
            validateChatCompletion(outbox, slot.publicOrigin ?? d.completionOrigin);
            validateChatTransportIntent(outbox, slot);
            const prepared = chatPreparedSchema.parse(await chatRpc(d.rpc, hash, 'prepare_attempt', { id: outbox.id, revision: outbox.revision, idempotencyKey: key }));
            if (!sameChatIdentity(outbox, prepared.outbox))
                throw new AiHttpError(503, 'ai_agent_api_unavailable');
            if (prepared.attempt === null)
                return aiResponse({ outbox: prepared.outbox });
            const attempt = prepared.attempt;
            if (attempt.kind !== 'started' || attempt.seq !== '1' || attempt.outcome !== null || attempt.code !== null || attempt.outboxId !== outbox.id || attempt.attemptId !== prepared.outbox.activeAttemptId || prepared.outbox.state !== 'sending' || prepared.outbox.attemptCount !== outbox.attemptCount + 1 || BigInt(prepared.outbox.revision) !== BigInt(outbox.revision) + BigInt(1))
                throw new AiHttpError(503, 'ai_agent_api_unavailable');
            // RPC resolution is the committed boundary; no DB lock spans fetch.
            const currentSlot = await d.resolveSlot(outbox.spaceKey);
            if (!currentSlot || currentSlot.resourceName !== slot.resourceName || currentSlot.webhookUrl !== slot.webhookUrl || currentSlot.publicOrigin !== slot.publicOrigin)
                throw new AiHttpError(403, 'ai_agent_space_forbidden');
            const outcome = await dispatchGoogleChat(prepared.outbox, { slot, fetch: d.fetch });
            const recorded = chatPreparedSchema.parse(await chatRpc(d.rpc, hash, 'record_attempt', { id: outbox.id, attemptId: attempt.attemptId, idempotencyKey: key, ...outcome }));
            if (!sameChatIdentity(outbox, recorded.outbox) || !recorded.attempt || recorded.attempt.attemptId !== attempt.attemptId || recorded.attempt.outboxId !== outbox.id)
                throw new AiHttpError(503, 'ai_agent_api_unavailable');
            return aiResponse({ outbox: recorded.outbox });
        }
        catch (error) {
            return aiErrorResponse(error);
        }
    };
}
