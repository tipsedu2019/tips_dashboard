import { AiHttpError } from '../../ai-agent/server/ai-agent-auth.ts';
import { chatPayloadSchema, chatMessageSchema, chatThreadSchema, type ChatIntent } from './chat-contract.ts';
import { chatWebhookTarget, type ChatRuntimeSlot } from './chat-space-catalog.ts';
export type ChatDispatchResult = {
    outcome: 'sent' | 'rejected_retryable' | 'rejected_permanent' | 'unknown';
    code: string;
    messageName?: string;
    threadName?: string;
};
export type ChatTransportDependencies = {
    slot: ChatRuntimeSlot;
    fetch: typeof fetch;
    deadlineMs?: number;
};
type TransportIntent = Pick<ChatIntent, 'purpose' | 'spaceKey' | 'expectedSpace' | 'threadName' | 'payload' | 'upstreamRequestId'>;
export function validateChatTransportIntent(o: TransportIntent, slot: ChatRuntimeSlot) {
    const parsed = chatPayloadSchema.safeParse(o.payload);
    if (!parsed.success)
        throw new AiHttpError(422, 'chat_payload_invalid');
    if (o.purpose === 'bridge_reply' ? parsed.data.thread?.name !== o.threadName : o.purpose !== 'ai_completion' || o.threadName !== null || parsed.data.thread !== undefined)
        throw new AiHttpError(422, 'chat_thread_invalid');
    const body = JSON.stringify(parsed.data);
    if (Buffer.byteLength(body, 'utf8') > 32000)
        throw new AiHttpError(422, 'chat_payload_too_large');
    return { url: chatWebhookTarget(slot, o), body };
}
export async function dispatchGoogleChat(o: TransportIntent, d: ChatTransportDependencies): Promise<ChatDispatchResult> {
    const { url, body } = validateChatTransportIntent(o, d.slot);
    const controller = new AbortController();
    const duration = Math.min(Math.max(d.deadlineMs ?? 8000, 1), 15000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('deadline')); }, duration); });
    try {
        const response = await Promise.race([d.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, redirect: 'error', signal: controller.signal }), deadline]);
        if (response.redirected || response.status >= 300 && response.status < 400)
            return { outcome: 'unknown', code: 'provider_redirect' };
        if (response.status === 429)
            return { outcome: 'rejected_retryable', code: '429' };
        if ([400, 401, 403, 404, 405, 413, 422].includes(response.status))
            return { outcome: 'rejected_permanent', code: String(response.status) };
        if (!response.ok)
            return { outcome: 'unknown', code: 'provider_ambiguous' };
        const reader = response.body?.getReader();
        if (!reader)
            return { outcome: 'unknown', code: 'success_evidence_missing' };
        let size = 0;
        const chunks: Uint8Array[] = [];
        try {
            for (;;) {
                const part = await Promise.race([reader.read(), deadline]);
                if (part.done)
                    break;
                size += part.value.byteLength;
                if (size > 131072) {
                    void reader.cancel().catch(() => { });
                    return { outcome: 'unknown', code: 'provider_response_invalid' };
                }
                chunks.push(part.value);
            }
        }
        finally {
            reader.releaseLock();
        }
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        const row = value && typeof value === 'object' ? value as {
            name?: unknown;
            thread?: {
                name?: unknown;
            };
        } : null;
        const message = chatMessageSchema.safeParse(row?.name), thread = chatThreadSchema.safeParse(row?.thread?.name);
        if (!message.success || !thread.success)
            return { outcome: 'unknown', code: 'success_evidence_missing' };
        if (!message.data.startsWith(`${o.expectedSpace}/messages/`) || !thread.data.startsWith(`${o.expectedSpace}/threads/`) || o.threadName !== null && thread.data !== o.threadName)
            return { outcome: 'unknown', code: 'provider_resource_mismatch' };
        return { outcome: 'sent', code: String(response.status), messageName: message.data, threadName: thread.data };
    }
    catch {
        return { outcome: 'unknown', code: 'provider_ambiguous' };
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
        controller.abort();
    }
}
