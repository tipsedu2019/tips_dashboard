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
const providerErrorStatuses = new Set(['CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'ALREADY_EXISTS', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'OUT_OF_RANGE', 'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE', 'DATA_LOSS', 'UNAUTHENTICATED']);
const providerErrorReasons = new Set(['API_KEY_INVALID', 'API_KEY_SERVICE_BLOCKED', 'SERVICE_DISABLED', 'CREDENTIALS_MISSING', 'ACCESS_TOKEN_EXPIRED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']);
const providerErrorFields = new Map([
    ['parent', 'parent'], ['text', 'text'], ['message.text', 'text'],
    ['thread.name', 'thread_name'], ['message.thread.name', 'thread_name'],
    ['thread.thread_key', 'thread_key'], ['message.thread.thread_key', 'thread_key'],
    ['thread.threadKey', 'thread_key'], ['message.thread.threadKey', 'thread_key'],
    ['request_id', 'request_id'], ['requestId', 'request_id'],
    ['message_reply_option', 'reply_option'], ['messageReplyOption', 'reply_option'],
]);
function object(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function providerErrorCode(status: number, value: unknown) {
    const root = object(value), error = root && ('error' in root ? object(root.error) : root);
    if (!error || error.code !== status)
        return String(status);
    const parts = [String(status)];
    if (typeof error.status === 'string' && providerErrorStatuses.has(error.status))
        parts.push(error.status);
    let reason: string | undefined, field: string | undefined;
    for (const raw of Array.isArray(error.details) ? error.details.slice(0, 8) : []) {
        const detail = object(raw);
        if (!detail)
            continue;
        if (!reason && detail['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo' && (detail.domain === 'googleapis.com' || detail.domain === 'chat.googleapis.com') && typeof detail.reason === 'string' && providerErrorReasons.has(detail.reason))
            reason = detail.reason;
        if (!field && detail['@type'] === 'type.googleapis.com/google.rpc.BadRequest') {
            for (const violation of Array.isArray(detail.fieldViolations) ? detail.fieldViolations.slice(0, 8) : []) {
                const row = object(violation);
                if (row && typeof row.field === 'string')
                    field = providerErrorFields.get(row.field);
                if (field)
                    break;
            }
        }
    }
    if (reason)
        parts.push(reason);
    if (field)
        parts.push(`field_${field}`);
    // Only constants above reach the existing 100-character SQL code column.
    const code = parts.join('.');
    return code.length <= 100 ? code : String(status);
}
async function readProviderErrorCode(response: Response, deadline: Promise<never>) {
    // Never retain/log message, description, metadata, headers or raw response text.
    // Both the webhook's top-level Status and the HTTP JSON error envelope exist.
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
        reader = response.body?.getReader();
        if (!reader)
            return String(response.status);
        let size = 0;
        const chunks: Uint8Array[] = [];
        for (;;) {
            const part = await Promise.race([reader.read(), deadline]);
            if (part.done)
                break;
            size += part.value.byteLength;
            if (size > 16384)
                return String(response.status);
            chunks.push(part.value);
        }
        return providerErrorCode(response.status, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
    }
    catch {
        // A definite HTTP rejection stays definite even if its diagnostics fail.
        return String(response.status);
    }
    finally {
        if (reader) {
            void reader.cancel().catch(() => { });
            reader.releaseLock();
        }
    }
}
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
            return { outcome: 'rejected_permanent', code: await readProviderErrorCode(response, deadline) };
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
