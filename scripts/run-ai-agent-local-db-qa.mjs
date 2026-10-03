import { fileURLToPath } from 'node:url';
import { runIsolatedSupabaseDbTests } from './run-isolated-supabase-db-tests.mjs';

const SUITES = Object.freeze({
  auth: Object.freeze({tests: ['supabase/tests/ai_agent_requests_authz_test.sql','supabase/tests/ai_agent_credentials_test.sql'], probes: ['tests/probe-ai-agent-auth-concurrency.mjs']}),
  all: Object.freeze({tests: ['supabase/tests/ai_agent_requests_authz_test.sql','supabase/tests/ai_agent_credentials_test.sql','supabase/tests/ai_agent_requests_transition_test.sql','supabase/tests/ai_agent_chat_outbox_test.sql'], probes: ['tests/probe-ai-agent-auth-concurrency.mjs','tests/probe-ai-agent-claim-concurrency.mjs']}),
});
const invalid = () => { throw new Error('ai_agent_local_db_arguments_invalid'); };
export function parseAiAgentDbArguments(argv) {
  const result = {execute:false, suite:'all', requestId:null};
  const seen = new Set();
  for (let index=0;index<argv.length;index++) {
    const flag=argv[index];
    if (!['--plan','--execute','--suite','--request-id'].includes(flag) || seen.has(flag)) invalid();
    seen.add(flag);
    if (flag==='--execute') result.execute=true;
    else if (flag==='--suite') result.suite=argv[++index];
    else if (flag==='--request-id') result.requestId=argv[++index];
  }
  if (!Object.hasOwn(SUITES,result.suite) || seen.has('--plan') && seen.has('--execute') || result.execute && !/^ai-agent-local-[a-z0-9][a-z0-9-]{0,64}$/u.test(result.requestId || '') || !result.execute && result.requestId !== null) invalid();
  return result;
}
export async function runAiAgentLocalDbQa({argv=process.argv.slice(2), root, log, runIsolated=runIsolatedSupabaseDbTests}={}) {
  const args=parseAiAgentDbArguments(argv);
  const suite=SUITES[args.suite];
  const delegated=['--review-head','--require-final','--lint',...suite.tests.flatMap(path=>['--test',path]),...suite.probes.flatMap(path=>['--probe',path])];
  if(args.execute) delegated.push('--execute','--authorized','--request-id',args.requestId);
  // The shared runner owns loopback DB/nonce, clean child environment, immutable
  // baseline verification, final migration hashes and failure-preserving cleanup.
  return runIsolated({argv:delegated,...(root ? {root}:{}),...(log ? {log}:{})});
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  runAiAgentLocalDbQa({log:entry=>process.stderr.write(`${entry}\n`)}).then(result=>process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
}
