import { aiAgentProductionDependencies } from '../../ai-agent/server/ai-agent-production.ts';
import { createChatSendHandler } from './chat-send-route.ts';
import { createChatOutboxHandler } from './chat-outbox.ts';
import { createProductionChatResolver, resolveBridgeSource } from './chat-runtime-configuration.ts';
const rpc = aiAgentProductionDependencies.botRpc;
export const handleChatSend = createChatSendHandler({ rpc, resolveSlot: createProductionChatResolver(rpc), bridgeSourceId: hash => resolveBridgeSource(rpc, hash), fetch: (...args) => fetch(...args) });
export const handleChatOutbox = createChatOutboxHandler({ rpc });
