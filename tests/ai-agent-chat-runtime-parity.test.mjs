import {readCurrentAiCapture} from '../scripts/lib/ai-producer-receipt.mjs';
import test from 'node:test';
import {assertChatProducerParity} from './ai-agent-chat-runtime-assertions.mjs';

test('actual final SQL issuer/bridge/completion/attempt DTOs pass strict consumers and durable sender',async()=>{
 await assertChatProducerParity(await readCurrentAiCapture('chat'));
});
