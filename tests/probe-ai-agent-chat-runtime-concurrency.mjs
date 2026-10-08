// Real PostgreSQL waits in the common runner's disposable nonce project only.
import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {readFile} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';

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
const url=new URL(process.env.TASK_LOCAL_DB_URL||'https://invalid.invalid');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/postgres');assert.match(process.env.TASK_LOCAL_DB_NONCE||'',/^[a-f0-9]{32}$/);
const config=await readFile('supabase/config.toml','utf8'),project=config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]{12})"/m)?.[1];assert.ok(project);assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const container=`supabase_db_${project}`;
const actor=randomUUID(),source=randomUUID(),key=randomUUID();const evidence=[];

// BEGIN GENERATED AI PROBE SESSION SETUP
// Generated: DO NOT EDIT. Regenerate: node scripts/generate-ai-agent-probe-runtime.mjs
configureContainer(container);
// END GENERATED AI PROBE SESSION SETUP

const prior=JSON.parse(await query(`select jsonb_build_object('support',(select to_jsonb(s) from dashboard_private.ai_agent_chat_support s),'spaces',(select jsonb_agg(to_jsonb(c) order by space_key) from dashboard_private.chat_space_configuration c));`));
const user=sql=>`select set_config('request.jwt.claim.sub','${actor}',true);set local role authenticated;${sql}`;
const service=sql=>`set local role service_role;${sql}`;
const input={label:'synthetic runtime race',scopes:['ai-agent:requests:read','chat:send','chat:outbox:read'],grant:{queues:['employee_requests'],actions:['read'],spaceKeys:['space_1'],purposes:['ai_completion','bridge_reply'],bridgeSourceId:source},expiresAt:null,idempotencyKey:key};
const literal=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const create=p=>`public.ai_agent_credential_api_v1('create',${literal(p)})`;
const configInput=async(enabled,origin)=>({revision:JSON.parse(await query("select public.ai_agent_chat_configuration_api_v1('get','{}');")).revision,idempotencyKey:randomUUID(),issuanceEnabled:enabled,publicOrigin:origin,spaces:Array.from({length:7},(_,i)=>({spaceKey:`space_${i+1}`,resourceName:i?null:origin?'spaces/RUNTIME_RACE':null}))});
const sync=p=>`public.ai_agent_chat_configuration_api_v1('sync',${literal(p)})`;
async function waiting(blocker,writer){const until=Date.now()+15000;while(Date.now()<until){if(await query(`select ${blocker}=any(pg_blocking_pids(${writer})) and exists(select 1 from pg_stat_activity where pid=${writer} and wait_event_type='Lock');`)==='t')return true;await new Promise(r=>setTimeout(r,40));}return false;}
async function race(name,blockSql,writeSql,expect='42501',finish='commit'){
 const b=session(),w=session();try{b.write(`begin;set local statement_timeout='35s';${blockSql};select 'BLOCKER:'||pg_backend_pid();\n`);const bp=Number((await b.line(/^BLOCKER:(\d+)$/m))[1]);
  w.write(`begin;set local statement_timeout='30s';set local lock_timeout='25s';select 'WRITER:'||pg_backend_pid();create function pg_temp.exercise() returns text language plpgsql as $$begin ${writeSql.expression};return '00000';exception when others then return SQLSTATE;end$$;${writeSql.role}select 'STATE:'||pg_temp.exercise();\n`);const wp=Number((await w.line(/^WRITER:(\d+)$/m))[1]);assert.equal(await waiting(bp,wp),true,name+' actual wait');b.end(finish+';\n');assert.equal((await b.complete).code,0);const state=(await w.line(/^STATE:([A-Z0-9]{5})$/m))[1];w.end('commit;\n');assert.equal((await w.complete).code,0);assert.equal(state,expect,name);evidence.push({name,actualLockWait:true,sqlstate:state,blockerCommittedFirst:finish==='commit'});if(name.startsWith('prepare cfg first'))return JSON.parse((await b.line(/^PREPARED:(.*)$/m))[1]);
 }finally{for(const s of [b,w])if(!s.child.stdin.destroyed)s.end('rollback;\n');await closeSessions(b,w);}}
await query(`insert into auth.users(id,instance_id,aud,role,email) values('${actor}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','runtime-race-${actor}@test.invalid');insert into public.profiles(id,role,name) values('${actor}','admin','synthetic runtime') on conflict(id) do update set role='admin';`);
await query(`select ${sync(await configInput(true,'https://dashboard.test.invalid'))};`);
await race('support disable wins before new issuance',service(`select ${sync(await configInput(false,'https://dashboard.test.invalid'))}`),{role:user(''),expression:`perform ${create(input)}`});
assert.equal(await query(`select count(*) from dashboard_private.ai_agent_credentials where created_by='${actor}';`),'0');
await query(`select ${sync(await configInput(true,'https://dashboard.test.invalid'))};`);
await race('actor downgrade wins before new issuance',`update public.profiles set role='viewer' where id='${actor}'`,{role:user(''),expression:`perform ${create(input)}`});
await query(`update public.profiles set role='admin' where id='${actor}';`);
// Duplicate create waits on the issuer lock. Only one first response may carry a raw key.
const b=session(),w=session();let first,replay;try{
 b.write(`begin;${user(`select 'FIRST:'||${create(input)}::text;`)}select 'BLOCKER:'||pg_backend_pid();\n`);first=JSON.parse((await b.line(/^FIRST:(.*)$/m))[1]);const bp=Number((await b.line(/^BLOCKER:(\d+)$/m))[1]);
 w.write(`begin;select 'WRITER:'||pg_backend_pid();${user(`select 'REPLAY:'||${create(input)}::text;`)}\n`);const wp=Number((await w.line(/^WRITER:(\d+)$/m))[1]);assert.equal(await waiting(bp,wp),true);b.end('commit;\n');assert.equal((await b.complete).code,0);replay=JSON.parse((await w.line(/^REPLAY:(.*)$/m))[1]);w.end('commit;\n');assert.equal((await w.complete).code,0);assert.match(first.token,/^tips_agent_[a-f0-9]{64}$/);assert.equal(replay.token,null);assert.equal(first.id,replay.id);evidence.push({name:'duplicate create one key one raw response',actualLockWait:true,sqlstate:'00000'});
}finally{for(const s of [b,w])if(!s.child.stdin.destroyed)s.end('rollback;\n');await closeSessions(b,w);}
assert.deepEqual(JSON.parse(await query(`select jsonb_build_object('keys',(select count(*) from dashboard_private.ai_agent_credentials where created_by='${actor}'),'grants',(select count(*) from dashboard_private.ai_agent_credential_grants where credential_id='${first.id}'),'receipts',(select count(*) from dashboard_private.ai_agent_request_receipts where principal_id='${actor}' and operation='credential_create'));`)),{keys:1,grants:1,receipts:1});
for(const op of ['replay','revoke']){
 const expr=op==='replay'?create(input):`public.ai_agent_credential_api_v1('revoke',${literal({id:first.id,idempotencyKey:randomUUID()})})`;
 await race('actor downgrade before '+op,`update public.profiles set role='viewer' where id='${actor}'`,{role:user(''),expression:`perform ${expr}`});await query(`update public.profiles set role='admin' where id='${actor}';`);
}
const p1=await configInput(true,'https://dashboard.test.invalid'),p2={...p1,idempotencyKey:randomUUID()};
await race('config CAS one winner',service(`select ${sync(p1)}`),{role:service(''),expression:`perform ${sync(p2)}`},'55000');
const hash=createHash('sha256').update(first.token).digest('hex');
const bridge=JSON.parse(await query(`select public.ai_agent_chat_bridge_grant_v1('${hash}');`));
async function completion(title,origin){if(origin!==undefined)await query(`select ${sync(await configInput(true,origin))};`);const rid=randomUUID(),eid=randomUUID();
 await query(`insert into dashboard_private.ai_agent_requests(id,requester_id,title,body,status,result,notify_on_done,notification_space) values('${rid}','${actor}',${"'"+title.replaceAll("'","''")+"'"},'PRIVATE_BODY','done','PRIVATE_RESULT',true,'space_1');insert into dashboard_private.ai_agent_request_events(id,request_id,event_seq,kind,actor_kind,actor_id,requester_id,version) values('${eid}','${rid}',1,'done','user','${actor}','${actor}',1);select dashboard_private.ai_agent_completion_outbox_v1(r,'${eid}') from dashboard_private.ai_agent_requests r where id='${rid}';`);
 return JSON.parse(await query(`select dashboard_private.chat_outbox_json_v1(o) from dashboard_private.chat_delivery_outbox o where request_id='${rid}';`));}
const hostile=await completion('<users/all> @everyone https://evil.invalid *title*\n\u202e','https://dashboard.test.invalid');
const safeEmpty=await completion('<>@*[]');
const prep=o=>`public.ai_agent_chat_api_v1('${hash}','prepare_attempt',${literal({id:o.id,revision:o.revision,idempotencyKey:randomUUID()})})`;
const before=JSON.parse(await query(`select jsonb_build_object('attempts',(select count(*) from dashboard_private.chat_delivery_attempts where outbox_id='${hostile.id}'),'budget',(select count from dashboard_private.chat_send_global_budget));`));
await race('origin sync wins before prepare; attempt and budget rollback',service(`select ${sync(await configInput(true,'https://changed.test.invalid'))}`),{role:service(''),expression:`perform ${prep(hostile)}`},'55000');
const after=JSON.parse(await query(`select jsonb_build_object('attempts',(select count(*) from dashboard_private.chat_delivery_attempts where outbox_id='${hostile.id}'),'budget',(select count from dashboard_private.chat_send_global_budget));`));assert.deepEqual(after,before);
await query(`select ${sync(await configInput(true,'https://dashboard.test.invalid'))};update dashboard_private.chat_space_send_budgets set last_dispatch_at=null where space_key='space_1';`);
// Opposite order: prepare has cfg SHARE and a durable attempt; sync waits for commit.
const cfgChange=await configInput(true,'https://after-commit.test.invalid');
const prepared=await race('prepare cfg first; sync waits until committed attempt',service(`select 'PREPARED:'||${prep(safeEmpty)}::text`),{role:service(''),expression:`perform ${sync(cfgChange)}`},'00000');
const committed=JSON.parse(await query(`select dashboard_private.chat_outbox_json_v1(o) from dashboard_private.chat_delivery_outbox o where id='${safeEmpty.id}';`));assert.equal(committed.state,'sending');assert.equal(committed.attemptCount,1);
const recorded=JSON.parse(await query(`select public.ai_agent_chat_api_v1('${hash}','record_attempt',${literal({id:safeEmpty.id,attemptId:prepared.attempt.attemptId,idempotencyKey:randomUUID(),outcome:'unknown',code:'synthetic_timeout'})});`));assert.equal(recorded.outbox.state,'delivery_unknown');
const unconfigured=await completion('<>@*[]',null);assert.equal(unconfigured.state,'cancelled');assert.equal(unconfigured.expectedSpace,null);
await query(`update dashboard_private.chat_credential_space_grants set revoked_at=clock_timestamp() where credential_id='${first.id}';`);
const denied=await query(`do $$begin perform public.ai_agent_chat_bridge_grant_v1('${hash}');raise exception 'unexpected_success';exception when sqlstate '42501' then raise notice 'BRIDGE_DENIED:42501';end$$;select '42501';`);assert.equal(denied,'42501');
// Restore only this probe's synthetic mutable configuration. Preserve monotonic revisions.
for(const row of prior.spaces){await query(`update dashboard_private.chat_space_configuration set configured=${row.configured},resource_name=${row.resource_name===null?'null':"'"+row.resource_name+"'"},public_origin=${row.public_origin===null?'null':"'"+row.public_origin+"'"},revision=revision+1 where space_key='${row.space_key}';`);}
await query(`update dashboard_private.ai_agent_chat_support set issuance_enabled=${prior.support.issuance_enabled},public_origin=${prior.support.public_origin===null?'null':"'"+prior.support.public_origin+"'"},revision=revision+1 where singleton;`);
console.log(JSON.stringify({status:'passed',checkpoints:evidence,providerCalls:0,originConflictRollback:{before,after},committedAttemptBeforeLaterSync:true}));
// Synthetic fixture-only DTOs for an independent strict consumer, never provider data.
console.log('AI_CHAT_RUNTIME_CAPTURE:'+JSON.stringify({provenance:{kind:'actual_disposable_db_gateway',synthetic:true,providerCalls:0},first,replay,bridge,hostile,safeEmpty,prepared,recorded,unconfigured,bridgeGrantLoss:{code:'42501',message:'ai_agent_grant_forbidden'}}));

} finally {
// BEGIN GENERATED AI PROBE CLEANUP
// Generated: DO NOT EDIT. Regenerate: node scripts/generate-ai-agent-probe-runtime.mjs
await finishRuntime();
// END GENERATED AI PROBE CLEANUP
}
