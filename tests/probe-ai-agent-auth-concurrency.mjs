import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Only the common runner's owned loopback project and nonce are accepted.

// BEGIN GENERATED AI PROBE RUNTIME
// Generated: DO NOT EDIT. Regenerate: node scripts/generate-ai-agent-probe-runtime.mjs
const {closeSessions,selfTestBounds,startDeadline,configureContainer,session,query,finishRuntime}=(function createAiAgentProbeRuntime({assert,spawn,randomUUID}) {
  let container, overallDeadline;
  const ownedChildren = new Set(), ownedSessions = new Set();
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  function boundedProcess(command, args, timeoutMs = 40_000) {
    const child = spawn(command, args, {stdio:['pipe','pipe','pipe']});
    ownedChildren.add(child);
    let stdout='', stderr='', closed=false, timedOut=false, spawnError;
    const signals=[];
    child.stdout.on('data', data => {stdout+=data;});
    child.stderr.on('data', data => {stderr+=data;});
    child.stdin.on('error', error => {if(error.code!=='EPIPE') spawnError=error;});
    let finish;
    const exited = new Promise(resolve => {finish=resolve;});
    child.on('error', error => {spawnError=error;});
    child.on('close', (code, signal) => {
      closed=true;clearTimeout(deadline);ownedChildren.delete(child);
      finish({code,signal,stdout,stderr,out:stdout,err:stderr,timedOut,signals,spawnError});
    });
    let cancellation;
    async function cancel() {
      if(cancellation) return cancellation;
      cancellation=(async()=>{
        if(closed) return;
        child.stdin.destroy();
        signals.push('SIGTERM');child.kill('SIGTERM');
        if(await Promise.race([exited.then(()=>true),delay(750).then(()=>false)])) return;
        signals.push('SIGKILL');child.kill('SIGKILL');
        if(!await Promise.race([exited.then(()=>true),delay(1500).then(()=>false)])) {
          throw new Error('owned child failed confirmed reaping after SIGKILL');
        }
      })();
      return cancellation;
    }
    const deadline=setTimeout(()=>{timedOut=true;cancel().catch(error=>{
      // Failed reaping is an explicit failing result, never a successful cleanup.
      finish({code:null,stdout,stderr,out:stdout,err:stderr,timedOut,signals,spawnError:error});
    });},timeoutMs);
    const complete=exited.then(result=>{
      if(result.timedOut||result.spawnError) throw new Error(result.spawnError?.message||'owned child host deadline exceeded');
      return result;
    });
    complete.catch(()=>{}); // Interactive sessions may fail before their checkpoint is awaited.
    return {child,complete,exited,cancel,signals,get stdout(){return stdout;},get closed(){return closed;}};
  }
  async function closeSessions(...clients) {
    const results=await Promise.allSettled(clients.map(client=>client.close()));
    const failed=results.find(result=>result.status==='rejected');
    if(failed) throw failed.reason;
  }
  async function selfTestBounds() {
    // A real child ignores TERM and has no natural completion. KILL and close are required.
    const child=boundedProcess(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('READY');setInterval(()=>{},1000)"],1000);
    while(!child.stdout.includes('READY')&&!child.closed) await delay(10);
    await assert.rejects(child.complete,/host deadline/);
    const result=await child.exited;
    assert.deepEqual(result.signals,['SIGTERM','SIGKILL']);
    assert.equal(result.signal,'SIGKILL');assert.equal(ownedChildren.size,0);
    assert.throws(()=>process.kill(child.child.pid,0),{code:'ESRCH'});
    console.log(JSON.stringify({status:'passed',hungChildTimedOut:true,signals:result.signals,confirmedReaped:true}));
  }

  function startDeadline(){
  overallDeadline=setTimeout(async()=>{
    console.error('AI probe overall host deadline exceeded');process.exitCode=1;
    try {await closeSessions(...ownedSessions);}catch(error){console.error(error.message);}
    const results=await Promise.allSettled([...ownedChildren].map(child=>{
      // Every child here belongs to this process; never enumerate or kill foreign PIDs.
      child.kill('SIGKILL');return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('overall cleanup failed confirmed reaping')),2000);
        child.once('close',()=>{clearTimeout(timer);resolve();});
      });
    }));
    for(const result of results)if(result.status==='rejected')console.error(result.reason.message);
    process.exit(1);
  },180_000);
  }
  function session(timeoutMs = 40_000) {
    const tag=`ai_probe_${randomUUID()}`;
    const processChild=boundedProcess('docker',['exec','-i','-e',`PGAPPNAME=${tag}`,'-e','PGOPTIONS=-c statement_timeout=40000 -c idle_in_transaction_session_timeout=40000',container,'psql','-XqAt','--set','ON_ERROR_STOP=1','--set','VERBOSITY=verbose','-U','postgres','-d','postgres'],timeoutMs);
    const {child,complete}=processChild;
    let closePromise;
    const client={child,complete,
      write:sql=>child.stdin.write(sql),
      end:sql=>{if(!child.stdin.destroyed&&!child.stdin.writableEnded)child.stdin.end(sql);},
      async line(pattern){
        const deadline=Date.now()+20_000;
        while(Date.now()<deadline){
          const match=processChild.stdout.match(pattern);if(match)return match;
          if(processChild.closed){await complete;throw new Error('checkpoint child ended');}
          await delay(25);
        }
        throw new Error('AI probe checkpoint host deadline exceeded');
      },
      close(){
        if(closePromise)return closePromise;
        closePromise=(async()=>{
          client.end('rollback;\n');
          const clean=await Promise.race([processChild.exited.then(()=>true),delay(1500).then(()=>false)]);
          if(!clean)await processChild.cancel();
          // Docker client cancellation alone does not prove that its PostgreSQL session ended.
          // Terminate and verify only this exact randomly named session in this owned DB.
          if(!clean||(await processChild.exited).timedOut){
            const sql=`select pg_terminate_backend(pid) from pg_stat_activity where application_name='${tag}';select count(*) from pg_stat_activity where application_name='${tag}';`;
            let remaining;
            for(let n=0;n<3;n++){
              const control=boundedProcess('docker',['exec','-i',container,'psql','-XqAt','--set','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],3000);
              control.child.stdin.end(sql);const result=await control.complete;
              assert.equal(result.code,0,'owned session cancellation control failed');
              remaining=result.stdout.trim().split('\n').at(-1);if(remaining==='0')break;
              await delay(50);
            }
            assert.equal(remaining,'0','owned PostgreSQL session was not confirmed terminated');
          }
          ownedSessions.delete(client);
          await complete;
          if(!clean)throw new Error('session required forced cancellation during cleanup');
        })();
        return closePromise;
      }
    };
    ownedSessions.add(client);return client;
  }
  async function query(sql){const client=session(10_000);try{client.end(sql);const result=await client.complete;assert.equal(result.code,0,result.stderr.replace(/tips_agent_[a-f0-9]+/g,'[fixture-key]'));return result.stdout.trim();}finally{await client.close();}}

  function configureContainer(value){assert.match(value,/^supabase_db_tips_supabase_db_qa_[a-f0-9]{12}$/u);container=value;}
  async function finishRuntime(){
    clearTimeout(overallDeadline);
    await closeSessions(...ownedSessions);
    assert.equal(ownedChildren.size,0,'all owned child processes must be reaped');
  }
  return {closeSessions,selfTestBounds,startDeadline,configureContainer,session,query,finishRuntime};
})({assert,spawn,randomUUID});
if(process.argv.includes('--self-test-timeout')) {await selfTestBounds();process.exit(0);}
startDeadline();
// END GENERATED AI PROBE RUNTIME

try {
const url = new URL(process.env.TASK_LOCAL_DB_URL || 'https://invalid.invalid');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/postgres');
assert.match(process.env.TASK_LOCAL_DB_NONCE || '', /^[a-f0-9]{32}$/u);
const config = await readFile('supabase/config.toml', 'utf8');
const project = config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]{12})"/mu)?.[1];
assert.ok(project);
assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const container = `supabase_db_${project}`;
const actor = randomUUID();
const createKey = randomUUID();
const replayKey = randomUUID();
const creation = key => `public.ai_agent_user_api_v1('create',jsonb_build_object('title','downgrade fixture','body','synthetic','notifyOnDone',false,'idempotencyKey','${key}'))`;


// BEGIN GENERATED AI PROBE SESSION SETUP
// Generated: DO NOT EDIT. Regenerate: node scripts/generate-ai-agent-probe-runtime.mjs
configureContainer(container);
// END GENERATED AI PROBE SESSION SETUP

async function counts() {
  return JSON.parse(await query(`select jsonb_build_object('requests',(select count(*) from dashboard_private.ai_agent_requests where requester_id='${actor}'),'credentials',(select count(*) from dashboard_private.ai_agent_credentials where created_by='${actor}'));`));
}
await query(`update dashboard_private.ai_agent_chat_support set issuance_enabled=true;insert into auth.users(id,instance_id,aud,role,email) values('${actor}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ai-race-${actor}@test.invalid');
insert into public.profiles(id,role,name) values('${actor}','staff','synthetic race fixture') on conflict(id) do update set role=excluded.role;
begin;select set_config('request.jwt.claim.sub','${actor}',true);set local role authenticated;do $$begin perform ${creation(replayKey)};end$$;commit;`);

const evidence=[];
for(const [operation,role,expression] of [
  ['create','staff',creation(createKey)],
  ['create_replay','staff',creation(replayKey)],
  ['issue','admin',`public.ai_agent_credential_api_v1('create',jsonb_build_object('label','synthetic race','scopes',array['ai-agent:requests:read'],'grant','{"queues":["employee_requests"],"actions":["read"]}'::jsonb,'expiresAt',null,'idempotencyKey','${randomUUID()}'))`],
]) {
  await query(`update public.profiles set role='${role}' where id='${actor}';`);
  const before=await counts();
  const blocker=session();const writer=session();
  try {
    blocker.write(`begin;set local statement_timeout='30s';update public.profiles set role='viewer' where id='${actor}';select 'LOCKED:'||pg_backend_pid();\n`);
    const blockerPid=Number((await blocker.line(/^LOCKED:(\d+)$/mu))[1]);
    writer.write(`begin;set local statement_timeout='25s';set local lock_timeout='20s';select 'WRITER:'||pg_backend_pid();
create function pg_temp.exercise() returns text language plpgsql as $$begin perform ${expression};return '00000';exception when others then return SQLSTATE;end$$;
select set_config('request.jwt.claim.sub','${actor}',true);set local role authenticated;select 'STATE:'||pg_temp.exercise();\n`);
    const writerPid=Number((await writer.line(/^WRITER:(\d+)$/mu))[1]);
    let waited=false;
    const deadline=Date.now()+15_000;
    while(Date.now()<deadline) {
      waited=await query(`select ${blockerPid}=any(pg_blocking_pids(${writerPid})) and exists(select 1 from pg_stat_activity where pid=${writerPid} and wait_event_type='Lock');`)==='t';
      if(waited) break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(waited,true,`${operation} writer must reach an actual database lock checkpoint`);
    // The downgrader commits only after PostgreSQL proves the writer is waiting.
    blocker.end('commit;\n');
    assert.equal((await blocker.complete).code,0);
    const sqlstate=(await writer.line(/^STATE:([A-Z0-9]{5})$/mu))[1];
    writer.end('commit;\n');
    assert.equal((await writer.complete).code,0);
    const after=await counts();
    evidence.push({operation,blockerPid,writerPid,profileLockWaitObserved:waited,downgradeCommittedBeforeWriter:true,sqlstate,before,after});
  } finally {
    if(!blocker.child.stdin.destroyed) blocker.end('rollback;\n');
    if(!writer.child.stdin.destroyed) writer.end('rollback;\n');
    await closeSessions(blocker,writer);
  }
}
console.log(JSON.stringify({status:evidence.every(row=>row.sqlstate==='42501')?'passed':'failed',checkpoints:evidence}));
for(const row of evidence) {
  assert.equal(row.sqlstate,'42501',`${row.operation} must recheck current role after waiting for the profile lock`);
  assert.deepEqual(row.after,row.before,`${row.operation} must add no request/credential effects`);
}

} finally {
// BEGIN GENERATED AI PROBE CLEANUP
// Generated: DO NOT EDIT. Regenerate: node scripts/generate-ai-agent-probe-runtime.mjs
await finishRuntime();
// END GENERATED AI PROBE CLEANUP
}
