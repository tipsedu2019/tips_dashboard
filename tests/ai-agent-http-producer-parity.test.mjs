import {readCurrentAiCapture} from '../scripts/lib/ai-producer-receipt.mjs';
import test from 'node:test';
import {assertHttpProducerParity,assertPersonalProducerParity} from './ai-agent-http-producer-assertions.mjs';

test('actual disposable DB producers pass real strict parsers and HTTP handlers',async()=>{
 await assertHttpProducerParity(await readCurrentAiCapture('http'));
});

test('current canonical personal SQL DTOs pass strict issuance consumers and actual read HTTP handlers',async()=>{
 await assertPersonalProducerParity(await readCurrentAiCapture('http'));
});
