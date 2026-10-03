import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAiAgentDbArguments, runAiAgentLocalDbQa } from '../scripts/run-ai-agent-local-db-qa.mjs';

test('auth suite delegates exactly two tests to the shared guarded runner',async()=>{
  const calls=[];
  const result=await runAiAgentLocalDbQa({argv:['--plan','--suite','auth'],runIsolated:async options=>{calls.push(options);return {status:'plan'};}});
  assert.equal(result.status,'plan');
  assert.deepEqual(calls[0].argv,['--review-head','--require-final','--lint','--test','supabase/tests/ai_agent_requests_authz_test.sql','--test','supabase/tests/ai_agent_credentials_test.sql']);
});
test('all is fixed and contains Task 2 lifecycle and concurrency evidence',async()=>{
  let call;
  await runAiAgentLocalDbQa({argv:[],runIsolated:async options=>{call=options;return {status:'plan'};}});
  assert.deepEqual(call.argv.filter((_,i,a)=>a[i-1]==='--test'),['supabase/tests/ai_agent_requests_authz_test.sql','supabase/tests/ai_agent_credentials_test.sql','supabase/tests/ai_agent_requests_lifecycle_test.sql','supabase/tests/ai_agent_requests_idempotency_test.sql']);
  assert.deepEqual(call.argv.filter((_,i,a)=>a[i-1]==='--probe'),['tests/probe-ai-agent-concurrency.mjs']);
});
test('execute requires request identity and rejects external/custom targets',()=>{
  assert.equal(parseAiAgentDbArguments(['--execute','--suite','auth','--request-id','ai-agent-local-auth-01']).execute,true);
  for(const argv of [['--execute'],['--execute','--request-id','bad'],['--suite','unknown'],['--linked'],['--remote'],['--production'],['--db-url','postgres://remote'],['--test','x'],['--probe','x'],['--plan','--execute'],['--suite','auth','--suite','all']]) assert.throws(()=>parseAiAgentDbArguments(argv));
});
test('cleanup failure from common runner propagates as failure',async()=>{
  await assert.rejects(runAiAgentLocalDbQa({argv:['--execute','--suite','auth','--request-id','ai-agent-local-auth-01'],runIsolated:async()=>{throw new Error('isolated_supabase_db_cleanup_failed');}}),/cleanup_failed/);
});
