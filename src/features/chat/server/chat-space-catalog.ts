import { AiHttpError } from '../../ai-agent/server/ai-agent-auth.ts';
import { chatSpaceResourceSchema, type ChatIntent } from './chat-contract.ts';
export const CHAT_SPACE_CATALOG = Object.freeze([
    { spaceKey: 'space_1', label: '경영팀', resourceName: null, webhookEnv: 'TIPS_AI_CHAT_SPACE_1_WEBHOOK_URL' },
    { spaceKey: 'space_2', label: '관리팀', resourceName: null, webhookEnv: 'TIPS_AI_CHAT_SPACE_2_WEBHOOK_URL' },
    { spaceKey: 'space_3', label: '조교팀', resourceName: null, webhookEnv: 'TIPS_AI_CHAT_SPACE_3_WEBHOOK_URL' },
    { spaceKey: 'space_4', label: '영어팀', resourceName: null, webhookEnv: 'TIPS_AI_CHAT_SPACE_4_WEBHOOK_URL' },
    { spaceKey: 'space_5', label: '전체공지', resourceName: null, webhookEnv: 'TIPS_AI_CHAT_SPACE_5_WEBHOOK_URL' },
    { spaceKey: 'space_6', label: '수학팀', resourceName: null, webhookEnv: 'TIPS_AI_CHAT_SPACE_6_WEBHOOK_URL' },
    { spaceKey: 'space_7', label: '과학팀', resourceName: null, webhookEnv: 'TIPS_AI_CHAT_SPACE_7_WEBHOOK_URL' },
] as const);
export type ChatRuntimeSlot = {
    spaceKey: ChatIntent['spaceKey'];
    resourceName: string;
    webhookUrl: string;
    publicOrigin?: string;
};
export function chatWebhookTarget(slot: ChatRuntimeSlot, o: Pick<ChatIntent, 'spaceKey' | 'expectedSpace' | 'threadName' | 'purpose' | 'upstreamRequestId'>) {
    if (!CHAT_SPACE_CATALOG.some(s => s.spaceKey === slot.spaceKey) || slot.spaceKey !== o.spaceKey || !chatSpaceResourceSchema.safeParse(slot.resourceName).success || slot.resourceName !== o.expectedSpace)
        throw new AiHttpError(403, 'ai_agent_space_forbidden');
    let url: URL;
    try {
        url = new URL(slot.webhookUrl);
    }
    catch {
        throw new AiHttpError(403, 'ai_agent_space_forbidden');
    }
    const entries = [...url.searchParams.entries()];
    if (url.origin !== 'https://chat.googleapis.com' || url.username || url.password || url.hash || url.pathname !== `/v1/${slot.resourceName}/messages` || entries.length !== 2 || !['key', 'token'].every(k => url.searchParams.getAll(k).length === 1 && !!url.searchParams.get(k)) || entries.some(([k]) => !['key', 'token'].includes(k)))
        throw new AiHttpError(403, 'ai_agent_space_forbidden');
    if (o.purpose === 'bridge_reply' && (!o.threadName || !o.threadName.startsWith(`${slot.resourceName}/threads/`)))
        throw new AiHttpError(422, 'chat_thread_invalid');
    url.searchParams.set('requestId', o.upstreamRequestId);
    if (o.purpose === 'bridge_reply')
        url.searchParams.set('messageReplyOption', 'REPLY_MESSAGE_OR_FAIL');
    return url;
}
