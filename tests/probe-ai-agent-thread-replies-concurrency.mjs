// Isolated PostgreSQL only. Two live sessions prove waits across rotated keys.
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
const actor=randomUUID(),source=randomUUID(),evidence=[];
const json=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
await query(`insert into auth.users(id,instance_id,aud,role,email) values('${actor}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','thread-race-${actor}@test.invalid');insert into public.profiles(id,role,name) values('${actor}','admin','synthetic reply concurrency') on conflict(id) do update set role='admin';update dashboard_private.ai_agent_chat_support set issuance_enabled=true;update dashboard_private.chat_space_configuration set configured=true,resource_name='spaces/THREAD_RACE' where space_key='space_1';`);
const keys=[];for(let n=0;n<2;n++){
 const input={label:'Synthetic Chat-only race',scopes:['chat:send','chat:outbox:read'],grant:{spaceKeys:['space_1'],purposes:['bridge_reply'],bridgeSourceId:source},idempotencyKey:randomUUID()};
 const result=JSON.parse((await query(`begin;select set_config('request.jwt.claim.sub','${actor}',true);set local role authenticated;select public.ai_agent_credential_api_v1('create',${json(input)});commit;`)).split('\n').at(-1));
 keys.push({id:result.id,hash:createHash('sha256').update(result.token).digest('hex')});
}
const call=(action,input,key=0)=>`public.ai_agent_chat_api_v1('${keys[key].hash}','${action}',${json(input)})`;
const body=(event,client=randomUUID())=>({idempotencyKey:randomUUID(),bridgeSourceId:source,sourceEventId:`spaces/THREAD_RACE/messages/${event}`,spaceKey:'space_1',threadName:'spaces/THREAD_RACE/threads/existing',text:'Synthetic reply',clientMessageId:client});
const rpc=async(action,input,key=0)=>JSON.parse(await query(`set role service_role;select ${call(action,input,key)};`));
async function race(name,first,second,expected){
 const b=session(),w=session();try{
  b.write(`begin;set local role service_role;select 'FIRST:'||${first}::text;select 'BLOCKER:'||pg_backend_pid();\n`);
  const result=JSON.parse((await b.line(/^FIRST:(.*)$/m))[1]),bp=Number((await b.line(/^BLOCKER:(\d+)$/m))[1]);
  w.write(`begin;select 'WRITER:'||pg_backend_pid();create function pg_temp.exercise() returns jsonb language plpgsql as $$declare r jsonb;begin r:=${second};return jsonb_build_object('state','00000','result',r);exception when others then return jsonb_build_object('state',SQLSTATE);end$$;set local role service_role;select 'SECOND:'||pg_temp.exercise()::text;\n`);
  const wp=Number((await w.line(/^WRITER:(\d+)$/m))[1]);let waited=false;
  for(let n=0;n<150;n++){if(await query(`select ${bp}=any(pg_blocking_pids(${wp})) and exists(select 1 from pg_stat_activity where pid=${wp} and wait_event_type='Lock');`)==='t'){waited=true;break;}await new Promise(r=>setTimeout(r,40));}
  assert.equal(waited,true,name+' actual lock wait');b.end('commit;\n');assert.equal((await b.complete).code,0);
  const next=JSON.parse((await w.line(/^SECOND:(.*)$/m))[1]);w.end('commit;\n');assert.equal((await w.complete).code,0);assert.equal(next.state,expected,name);evidence.push({name,actualLockWait:true,sqlstate:next.state});return {first:result,second:next.result};
 }finally{await closeSessions(b,w);}
}
const same=body('same-client');const duplicate=await race('rotated key same client gives one outbox',call('chat_outbox',same),call('chat_outbox',{...same,idempotencyKey:randomUUID()},1),'00000');assert.equal(duplicate.first.outbox.id,duplicate.second.outbox.id);assert.equal(duplicate.second.created,false);
const differentEvent=body('event-one');await race('same client with another event conflicts after client lock',call('chat_outbox',differentEvent),call('chat_outbox',{...differentEvent,sourceEventId:'spaces/THREAD_RACE/messages/event-two',idempotencyKey:randomUUID()},1),'23514');
await race('new clients for same event serialize unresolved gate',call('chat_outbox',body('same-event')),call('chat_outbox',body('same-event'),1),'55000');
async function sentPair(event){
 const first=await rpc('chat_outbox',body(event));await query("update dashboard_private.chat_space_send_budgets set last_dispatch_at=null where space_key='space_1';");
 const prepared=await rpc('prepare_attempt',{id:first.outbox.id,revision:first.outbox.revision,idempotencyKey:randomUUID()});
 const result={id:first.outbox.id,attemptId:prepared.attempt.attemptId,idempotencyKey:randomUUID(),outcome:'sent',code:'200',messageName:`spaces/THREAD_RACE/messages/sent_${event}`,threadName:'spaces/THREAD_RACE/threads/existing'};
 await rpc('record_attempt',result);const second=await rpc('chat_outbox',body(event),1);
 return {first:prepared.outbox,second:second.outbox,late:{...result,idempotencyKey:randomUUID()}};
}
const pair=await sentPair('late-first');await race('late incident commits before rotated-key follow-up prepare',call('record_attempt',pair.late),call('prepare_attempt',{id:pair.second.id,revision:pair.second.revision,idempotencyKey:randomUUID()},1),'55000');
assert.equal(await query(`select count(*) from dashboard_private.chat_delivery_attempts where outbox_id='${pair.second.id}';`),'0');
const reverse=await sentPair('prepare-first');await query("update dashboard_private.chat_space_send_budgets set last_dispatch_at=null where space_key='space_1';");
const permits=await race('prepare wins first; late incident waits without deadlock',call('prepare_attempt',{id:reverse.second.id,revision:reverse.second.revision,idempotencyKey:randomUUID()},1),call('record_attempt',reverse.late),'00000');assert.ok(permits.first.attempt);assert.equal(permits.second.outbox.state,'incident');
assert.equal(await query(`select count(*) from dashboard_private.chat_delivery_outbox where bridge_source_id='${source}';`),'7');
// Synthetic rows exist only inside the common runner's disposable project.
console.log(JSON.stringify({status:'passed',providerCalls:0,cases:evidence,linearization:'a committed prepare permit is not recalled by later evidence'}));
} finally {
// BEGIN GENERATED AI PROBE CLEANUP
// Generated: DO NOT EDIT. Regenerate: node scripts/generate-ai-agent-probe-runtime.mjs
await finishRuntime();
// END GENERATED AI PROBE CLEANUP
}
