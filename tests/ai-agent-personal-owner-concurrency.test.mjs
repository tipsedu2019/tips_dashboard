import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedPersonalOwnerProcess,validatePersonalOwnerProbeTarget,requirePersonalOwnerSqlCompletion,requirePersonalOwnerSessionCleanup } from '../scripts/lib/ai-agent-personal-owner-concurrency-runtime.mjs';
import { requirePersonalOwnerConcurrentOutcome } from './probe-ai-agent-personal-owner-concurrency.mjs';

const nonce = 'a'.repeat(32), name = `tips-ai-agent-personal-owner-${nonce}`;
const target = () => ({ Name:`/${name}`,Image:'sha256:86a2e078779e5bdccda1f6f6c5063aa9779a322d1fface5fb408d051909b230f',Config:{Labels:{'tips.ai-agent-personal-owner-qa.owner':nonce}},HostConfig:{NetworkMode:'none',PortBindings:{}},NetworkSettings:{Ports:{}},Mounts:[] });

test('failed SQL exposes exact states and hashes without raw output or credentials',() => {
  const result = {code:3,signal:null,stdout:'private synthetic token',stderr:'ERROR: 42501: ai_agent_forbidden\nERROR: literal label\nDETAIL: private row'};
  assert.throws(() => requirePersonalOwnerSqlCompletion(result),error => {
    assert.deepEqual(error.diagnostics.sqlstates,['42501']);
    assert.match(error.diagnostics.stdoutSha256,/^[a-f0-9]{64}$/);
    assert.match(error.diagnostics.stderrSha256,/^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(error).includes('private'),false);
    return true;
  });
});

test('concurrent evidence requires actual exact SQLSTATE/domain and a strict safe shape',() => {
  assert.deepEqual(requirePersonalOwnerConcurrentOutcome({sqlstate:'55000',code:'ai_agent_conflict'},'55000','ai_agent_conflict'),{sqlstate:'55000',code:'ai_agent_conflict'});
  assert.deepEqual(requirePersonalOwnerConcurrentOutcome({sqlstate:'00000',code:null},'00000',null),{sqlstate:'00000',code:null});
  for (const value of [null,[],{sqlstate:'00000',code:null},{sqlstate:'40001',code:'ai_agent_conflict'},{sqlstate:'55000',code:'other message'},{sqlstate:'55000',code:'ai_agent_conflict',token:'unexpected'},{sqlstate:'55000',code:null}]) {
    assert.throws(() => requirePersonalOwnerConcurrentOutcome(value,'55000','ai_agent_conflict'),/concurrency_outcome_unexpected/);
  }
});

test('interactive QA refuses unrelated names/nonces/images and any network or mount/port target',() => {
  assert.doesNotThrow(() => validatePersonalOwnerProbeTarget(name,nonce,target()));
  for (const mutate of [
    value => { value.Name = '/unrelated'; },
    value => { value.Image = 'sha256:'+'0'.repeat(64); },
    value => { value.Config.Labels['tips.ai-agent-personal-owner-qa.owner'] = 'b'.repeat(32); },
    value => { value.HostConfig.NetworkMode = 'bridge'; },
    value => { value.Mounts = [{Source:'/outside',Destination:'/db'}]; },
    value => { value.HostConfig.PortBindings = {'5432/tcp':[{HostPort:'5432'}]}; },
    value => { value.NetworkSettings.Ports = {'5432/tcp':[{HostPort:'5432'}]}; },
  ]) {
    const value = target(); mutate(value);
    assert.throws(() => validatePersonalOwnerProbeTarget(name,nonce,value),/concurrency_target_not_(?:owned|isolated)/);
  }
  assert.throws(() => validatePersonalOwnerProbeTarget(name,'wrong',target()),/concurrency_target_not_owned/);
});

test('a real child ignoring TERM requires KILL and confirmed process reaping',async () => {
  const child = boundedPersonalOwnerProcess(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('READY');setInterval(()=>{},1000)"],{timeoutMs:1000});
  const deadline = Date.now()+900;
  while (!child.stdout.includes('READY') && !child.closed && Date.now()<deadline) await new Promise(done => setTimeout(done,10));
  assert.match(child.stdout,/READY/);
  await assert.rejects(child.complete,/concurrency_process_timeout/);
  const result = await child.exited;
  assert.deepEqual(result.signals,['SIGTERM','SIGKILL']);
  assert.equal(result.signal,'SIGKILL'); assert.equal(child.closed,true);
  assert.throws(() => process.kill(child.child.pid,0),{code:'ESRCH'});
});

test('a completed owned child is not signalled by later cleanup',async () => {
  const child = boundedPersonalOwnerProcess(process.execPath,['-e','process.exit(0)'],{timeoutMs:2000});
  assert.equal((await child.complete).code,0);
  await child.cancel();
  assert.deepEqual(child.signals,[]);
});

test('naturally reaped SQL exit 3 preserves the original state independently of absent-session cleanup',async () => {
  const child = boundedPersonalOwnerProcess(process.execPath,['-e',"process.stderr.write('ERROR: 42601: synthetic_syntax_failure');process.exit(3)"],{timeoutMs:2000});
  const result = await child.complete;
  assert.equal(result.code,3); assert.equal(child.closed,true);
  assert.deepEqual(requirePersonalOwnerSessionCleanup({natural:true,processResult:result,remaining:'0'}),{ownedChildReaped:true,ownedPostgresSessionAbsent:true});
  assert.throws(() => requirePersonalOwnerSqlCompletion(result),error => error.message === 'ai_agent_personal_owner_qa:concurrency_query_failed' && error.diagnostics.sqlstates.join(',') === '42601');
  assert.throws(() => requirePersonalOwnerSessionCleanup({natural:true,processResult:result,remaining:'1'}),/concurrency_backend_cleanup_unconfirmed/);
  assert.throws(() => requirePersonalOwnerSessionCleanup({natural:false,processResult:result,remaining:'0'}),/concurrency_session_cleanup_required_cancellation/);
  assert.throws(() => requirePersonalOwnerSessionCleanup({natural:true,processResult:{...result,problem:'concurrency_process_timeout'},remaining:'0'}),/concurrency_session_cleanup_required_cancellation/);
  await child.cancel(); assert.deepEqual(child.signals,[]);
});
