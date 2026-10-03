import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

// Only the common runner's nonce-bound loopback project is accepted.

// Self-contained: the guarded common runner stages this file without helper modules.
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
if(process.argv.includes('--self-test-timeout')) {await selfTestBounds();process.exit(0);}
const overallDeadline=setTimeout(async()=>{
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

try {
const url=new URL(process.env.TASK_LOCAL_DB_URL||'https://invalid.invalid');
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/postgres');
assert.match(process.env.TASK_LOCAL_DB_NONCE||'',/^[a-f0-9]{32}$/u);
const config=await readFile('supabase/config.toml','utf8');
const project=config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]{12})"/mu)?.[1];
assert.ok(project);assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const container=`supabase_db_${project}`;
const actor=randomUUID(),target=randomUUID(),key=randomUUID();
const expression=(revision,k=key)=>`public.ai_agent_space_policy_api_v1('set',jsonb_build_object('userId','${target}','revision','${revision}','spaceKeys','["space_1"]'::jsonb,'idempotencyKey','${k}'))`;

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

async function counts(){return JSON.parse(await query(`select jsonb_build_object('policies',(select count(*) from dashboard_private.chat_user_space_permissions where user_id='${target}'),'events',(select count(*) from dashboard_private.ai_agent_space_policy_events where user_id='${target}'),'receipts',(select count(*) from dashboard_private.ai_agent_request_receipts where resource_id='${target}' and operation='space_policy_set'));`));}
async function waiting(writerPid,blockerPid){const deadline=Date.now()+15_000;while(Date.now()<deadline){if(await query(`select ${blockerPid}=any(pg_blocking_pids(${writerPid})) and exists(select 1 from pg_stat_activity where pid=${writerPid} and wait_event_type='Lock');`)==='t')return true;await new Promise(resolve=>setTimeout(resolve,50));}return false;}
const authenticate=`select set_config('request.jwt.claim.sub','${actor}',true);set local role authenticated;`;
await query(`insert into auth.users(id,instance_id,aud,role,email) values('${actor}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','policy-admin-${actor}@test.invalid'),('${target}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','policy-target-${target}@test.invalid');insert into public.profiles(id,role,name) values('${actor}','admin','policy race'),('${target}','staff','policy race') on conflict(id) do update set role=excluded.role;`);
const evidence=[];
for(const [operation,who] of [['admin_downgrade',actor],['target_downgrade',target]]){
 await query(`update public.profiles set role='admin' where id='${actor}';update public.profiles set role='staff' where id='${target}';`);
 const before=await counts(),blocker=session(),writer=session();
 try{
  blocker.write(`begin;set local statement_timeout='30s';update public.profiles set role='viewer' where id='${who}';select 'LOCKED:'||pg_backend_pid();\n`);
  const bp=Number((await blocker.line(/^LOCKED:(\d+)$/mu))[1]);
  writer.write(`begin;set local statement_timeout='25s';set local lock_timeout='20s';select 'WRITER:'||pg_backend_pid();create function pg_temp.exercise() returns text language plpgsql as $$begin perform ${expression('0')};return '00000';exception when others then return SQLSTATE;end$$;${authenticate}select 'STATE:'||pg_temp.exercise();\n`);
  const wp=Number((await writer.line(/^WRITER:(\d+)$/mu))[1]);assert.equal(await waiting(wp,bp),true);
  blocker.end('commit;\n');assert.equal((await blocker.complete).code,0);
  const state=(await writer.line(/^STATE:([A-Z0-9]{5})$/mu))[1];writer.end('commit;\n');assert.equal((await writer.complete).code,0);
  const after=await counts();assert.equal(state,'42501');assert.deepEqual(after,before);evidence.push({operation,profileLockWaitObserved:true,sqlstate:state,before,after});
 }finally{if(!blocker.child.stdin.destroyed)blocker.end('rollback;\n');if(!writer.child.stdin.destroyed)writer.end('rollback;\n');await closeSessions(blocker,writer);}
}
await query(`update public.profiles set role='admin' where id='${actor}';update public.profiles set role='staff' where id='${target}';`);
const first=session(),second=session();
try{
 first.write(`begin;set local statement_timeout='30s';${authenticate}select ${expression('0')};select 'FIRST:'||pg_backend_pid();\n`);
 const fp=Number((await first.line(/^FIRST:(\d+)$/mu))[1]);
 second.write(`begin;set local statement_timeout='25s';set local lock_timeout='20s';select 'SECOND:'||pg_backend_pid();create function pg_temp.exercise() returns text language plpgsql as $$begin perform ${expression('0',randomUUID())};return '00000';exception when others then return SQLSTATE;end$$;${authenticate}select 'STATE:'||pg_temp.exercise();\n`);
 const sp=Number((await second.line(/^SECOND:(\d+)$/mu))[1]);assert.equal(await waiting(sp,fp),true);first.end('commit;\n');assert.equal((await first.complete).code,0);
 const state=(await second.line(/^STATE:([A-Z0-9]{5})$/mu))[1];second.end('commit;\n');assert.equal((await second.complete).code,0);assert.equal(state,'55000');assert.deepEqual(await counts(),{policies:1,events:1,receipts:1});evidence.push({operation:'first_create_CAS',policyLockWaitObserved:true,sqlstate:state,effects:await counts()});
}finally{if(!first.child.stdin.destroyed)first.end('rollback;\n');if(!second.child.stdin.destroyed)second.end('rollback;\n');await closeSessions(first,second);}
// Exact replay must also wait for and reject an actor downgrade.
const blocker=session(),replay=session();
try{
 blocker.write(`begin;update public.profiles set role='viewer' where id='${actor}';select 'LOCKED:'||pg_backend_pid();\n`);const bp=Number((await blocker.line(/^LOCKED:(\d+)$/mu))[1]);
 replay.write(`begin;set local statement_timeout='25s';set local lock_timeout='20s';select 'WRITER:'||pg_backend_pid();create function pg_temp.exercise() returns text language plpgsql as $$begin perform ${expression('0')};return '00000';exception when others then return SQLSTATE;end$$;${authenticate}select 'STATE:'||pg_temp.exercise();\n`);const rp=Number((await replay.line(/^WRITER:(\d+)$/mu))[1]);assert.equal(await waiting(rp,bp),true);blocker.end('commit;\n');assert.equal((await blocker.complete).code,0);const state=(await replay.line(/^STATE:([A-Z0-9]{5})$/mu))[1];replay.end('commit;\n');assert.equal((await replay.complete).code,0);assert.equal(state,'42501');assert.deepEqual(await counts(),{policies:1,events:1,receipts:1});evidence.push({operation:'replay_admin_downgrade',profileLockWaitObserved:true,sqlstate:state,effects:await counts()});
}finally{if(!blocker.child.stdin.destroyed)blocker.end('rollback;\n');if(!replay.child.stdin.destroyed)replay.end('rollback;\n');await closeSessions(blocker,replay);}
console.log(JSON.stringify({status:'passed',checkpoints:evidence}));

} finally {
  clearTimeout(overallDeadline);
  await closeSessions(...ownedSessions);
  assert.equal(ownedChildren.size,0,'all owned child processes must be reaped');
}
