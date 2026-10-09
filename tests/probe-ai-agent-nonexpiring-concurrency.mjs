// Only the owned disposable PostgreSQL project; no provider or real credentials.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
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
// BEGIN GENERATED AI PROBE SESSION SETUP
// Generated: DO NOT EDIT. Regenerate: node scripts/generate-ai-agent-probe-runtime.mjs
configureContainer(container);
// END GENERATED AI PROBE SESSION SETUP
const actor=randomUUID(),capActor=randomUUID(),owner=randomUUID(),source=randomUUID(),evidence=[];
const record=row=>{evidence.push(row);console.log(JSON.stringify({event:'nonexpiring_case_passed',...row}));};
const prior=JSON.parse(await query("select jsonb_build_object('support',(select to_jsonb(s) from dashboard_private.ai_agent_chat_support s),'spaces',(select jsonb_agg(to_jsonb(c) order by space_key) from dashboard_private.chat_space_configuration c));"));
const json=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const asActor=(id=actor)=>`select set_config('request.jwt.claim.sub','${id}',true);set local role authenticated;`;
const input=()=>({label:'Synthetic indefinite race',scopes:['chat:outbox:read','chat:send'],grant:{spaceKeys:['space_1'],purposes:['bridge_reply'],bridgeSourceId:source},nonExpiring:true,expiresAt:null,idempotencyKey:randomUUID()});
const issue=i=>`public.ai_agent_credential_api_v1('create',${json(i)})`;
const last=async sql=>(await query(sql)).split('\n').at(-1);
await query(`insert into auth.users(id,instance_id,aud,role,email) values ${[actor,capActor,owner].map(id=>`('${id}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','expiry-${id}@test.invalid')`).join(',')};insert into public.profiles(id,role,name) values('${actor}','admin','Synthetic expiry issuer'),('${capActor}','admin','Synthetic capacity issuer'),('${owner}','teacher','Synthetic expiry owner') on conflict(id) do update set role=excluded.role;update dashboard_private.ai_agent_chat_support set issuance_enabled=true;update dashboard_private.chat_space_configuration set configured=true,resource_name='spaces/NE_RACE' where space_key='space_1';`);
async function fresh(){const r=JSON.parse(await last(`begin;${asActor()}select ${issue(input())};commit;`));assert.equal(r.expiresAt,null);return {id:r.id,hash:createHash('sha256').update(r.token).digest('hex')};}
const chat=(key,action,i)=>`public.ai_agent_chat_api_v1('${key.hash}','${action}',${json(i)})`;
async function race(name,firstSql,secondSetup,expression,state){
 const b=session(),w=session();try{
  b.write(`begin;${firstSql}select 'BLOCKER:'||pg_backend_pid();\n`);const bp=Number((await b.line(/^BLOCKER:(\d+)$/m))[1]);
  w.write(`begin;select 'WRITER:'||pg_backend_pid();create function pg_temp.exercise() returns jsonb language plpgsql as $$declare r jsonb;begin r:=${expression};return jsonb_build_object('state','00000','result',r);exception when others then return jsonb_build_object('state',SQLSTATE);end$$;${secondSetup}select 'SECOND:'||pg_temp.exercise()::text;\n`);
  const wp=Number((await w.line(/^WRITER:(\d+)$/m))[1]);let waited=false;
  for(let n=0;n<150;n++){if(await query(`select ${bp}=any(pg_blocking_pids(${wp})) and exists(select 1 from pg_stat_activity where pid=${wp} and wait_event_type='Lock');`)==='t'){waited=true;break;}await new Promise(r=>setTimeout(r,40));}
  assert.equal(waited,true,name+' actual lock wait');b.end('commit;\n');assert.equal((await b.complete).code,0);
  const next=JSON.parse((await w.line(/^SECOND:(.*)$/m))[1]);w.end('commit;\n');assert.equal((await w.complete).code,0);assert.equal(next.state,state,name);
  record({name,actualLockWait:true,sqlstate:next.state});return {first:b.child?await b.line(/^FIRST:(.*)$/m).then(m=>JSON.parse(m[1])).catch(()=>null):null,second:next.result};
 }finally{await closeSessions(b,w);}
}
const duplicateInput=input();
const duplicate=await race('same idempotency returns one raw token',`${asActor()}select 'FIRST:'||${issue(duplicateInput)}::text;`,asActor(),issue(duplicateInput),'00000');
assert.ok(typeof duplicate.first.token==='string');assert.equal(duplicate.second.token,null);assert.equal(duplicate.first.id,duplicate.second.id);
assert.equal(await last(`select count(*) from dashboard_private.ai_agent_request_receipts where principal_id='${actor}' and operation='credential_create' and idempotency_key='${duplicateInput.idempotencyKey}';`),'1');
await race('finite replay cannot alter indefinite expiry',`${asActor()}select 'FIRST:'||${issue(duplicateInput)}::text;`,asActor(),issue({...duplicateInput,nonExpiring:false}),'23514');
await race('OFF commits before waited issuance',"update dashboard_private.ai_agent_chat_support set issuance_enabled=false;",asActor(),issue(input()),'42501');
await query('update dashboard_private.ai_agent_chat_support set issuance_enabled=true;');
await race('issuer demotion commits before waited issuance',`update public.profiles set role='teacher' where id='${actor}';`,asActor(),issue(input()),'42501');
await query(`update public.profiles set role='admin' where id='${actor}';`);
await race('issuer ban commits before waited issuance',`update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id='${actor}';`,asActor(),issue(input()),'42501');
await query(`update auth.users set banned_until=null where id='${actor}';`);
const revoked=await fresh();
await race('credential revoke commits before waited read',`${asActor()}select public.ai_agent_credential_api_v1('revoke',${json({id:revoked.id,idempotencyKey:randomUUID()})});`,'set local role service_role;',chat(revoked,'list',{}),'28000');
const grantRevoked=await fresh();
await race('grant revoke commits before waited read',`update dashboard_private.chat_credential_space_grants set revoked_at=clock_timestamp() where credential_id='${grantRevoked.id}';`,'set local role service_role;',chat(grantRevoked,'list',{}),'42501');
const readFirst=await fresh();
await race('in-flight read completes before revoke linearizes',`set local role service_role;select 'FIRST:'||${chat(readFirst,'list',{})}::text;`,asActor(),`public.ai_agent_credential_api_v1('revoke',${json({id:readFirst.id,idempotencyKey:randomUUID()})})`,'00000');
assert.equal(await last(`select revoked_at is not null from dashboard_private.ai_agent_credentials where id='${readFirst.id}';`),'t');
// A central sender may record a completed provider attempt after grant revocation;
// it must not receive another dispatch permit. No provider is actually contacted.
const late=await fresh(),message={idempotencyKey:randomUUID(),clientMessageId:randomUUID(),bridgeSourceId:source,sourceEventId:'spaces/NE_RACE/messages/late',spaceKey:'space_1',threadName:'spaces/NE_RACE/threads/existing',text:'Synthetic reply'};
const box=JSON.parse(await last(`set role service_role;select ${chat(late,'chat_outbox',message)};`)).outbox;
await query("update dashboard_private.chat_space_send_budgets set last_dispatch_at=null where space_key='space_1';");
const prepared=JSON.parse(await last(`set role service_role;select ${chat(late,'prepare_attempt',{id:box.id,revision:box.revision,idempotencyKey:randomUUID()})};`));
await query(`update dashboard_private.chat_credential_space_grants set revoked_at=clock_timestamp() where credential_id='${late.id}';`);
const recorded=JSON.parse(await last(`set role service_role;select ${chat(late,'record_attempt',{id:box.id,attemptId:prepared.attempt.attemptId,idempotencyKey:randomUUID(),outcome:'sent',code:'200',messageName:'spaces/NE_RACE/messages/synthetic-confirmed',threadName:message.threadName})};`));assert.equal(recorded.outbox.state,'sent');
record({name:'late central result remains recordable after grant revoke',sqlstate:'00000',providerCalls:0});
// Batch setup under one transaction; only the twentieth-slot contenders race.
await query(`begin;${asActor(capActor)}${Array.from({length:19},()=>`select ${issue(input())}->>'id';`).join('')}commit;`);
const personal={ownerProfileId:owner,label:'Synthetic capacity contender',scopes:['ai-agent:requests:read'],grant:{queues:['employee_requests'],actions:['read']},expiresAt:null,idempotencyKey:randomUUID()};
await race('central indefinite wins twentieth slot over personal finite',`${asActor(capActor)}select 'FIRST:'||${issue(input())}::text;`,asActor(capActor),`public.ai_agent_personal_credential_api_v1('create',${json(personal)})`,'54000');
assert.equal(await last(`select count(*) from dashboard_private.ai_agent_credentials where created_by='${capActor}' and revoked_at is null and (expires_at is null or expires_at>clock_timestamp());`),'20');
for(const row of prior.spaces)await query(`update dashboard_private.chat_space_configuration set configured=${row.configured},resource_name=${row.resource_name===null?'null':"'"+row.resource_name+"'"},public_origin=${row.public_origin===null?'null':"'"+row.public_origin+"'"},revision=revision+1 where space_key='${row.space_key}';`);
await query(`update dashboard_private.ai_agent_chat_support set issuance_enabled=${prior.support.issuance_enabled},public_origin=${prior.support.public_origin===null?'null':"'"+prior.support.public_origin+"'"},revision=revision+1 where singleton;`);
console.log(JSON.stringify({status:'passed',providerCalls:0,realCredentials:false,cases:evidence,expiryMode:'explicit central Chat replies only'}));
} finally {
// BEGIN GENERATED AI PROBE CLEANUP
// Generated: DO NOT EDIT. Regenerate: node scripts/generate-ai-agent-probe-runtime.mjs
await finishRuntime();
// END GENERATED AI PROBE CLEANUP
}
