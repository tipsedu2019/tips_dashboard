// Builtins-only capture: disposable DB producers, synthetic fixtures, rollback.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
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
const url=new URL(process.env.TASK_LOCAL_DB_URL || 'https://invalid.invalid');
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/postgres');assert.match(process.env.TASK_LOCAL_DB_NONCE || '',/^[a-f0-9]{32}$/);
const config=await readFile('supabase/config.toml','utf8');const project=config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]{12})"/m)?.[1];assert.ok(project);assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const container=`supabase_db_${project}`;
// BEGIN GENERATED AI PROBE SESSION SETUP
// Generated: DO NOT EDIT. Regenerate: node scripts/generate-ai-agent-probe-runtime.mjs
configureContainer(container);
// END GENERATED AI PROBE SESSION SETUP
try {
const configurationBefore=JSON.parse(await query("select jsonb_agg(to_jsonb(c) order by space_key) from dashboard_private.chat_space_configuration c;"));
const issuer=randomUUID(),owner=randomUUID(),credential=randomUUID(),expiredRequest=randomUUID();
const credentialHash=createHash('sha256').update('tips_agent_'+randomBytes(32).toString('hex')).digest('hex');
const nonceHash=createHash('sha256').update(randomBytes(32).toString('hex')).digest('hex');
const payloadHash=createHash('sha256').update('{}').digest('hex');
const key=()=>randomUUID();
const captured=name=>`(select data from captures where name='${name}')`;
const rid=name=>`${captured(name)}->>'id'`;
const cap=(name,kind,operation,input)=>`select pg_temp.capture('${name}','${kind}','${operation}',${typeof input==='string'?input:`'${JSON.stringify(input)}'::jsonb`});select 'AI_HTTP_STEP:${name}';`;
const claim=(name,version,generation)=>`jsonb_build_object('id',${rid(name)},'version','${version}','idempotencyKey','${key()}','claimTokenHash','${nonceHash}'${generation?`,'claimGeneration','${generation}'`:''})`;
const role=kind=>kind==='bot'?'set local role service_role;':`select set_config('request.jwt.claim.sub','${kind==='admin'?issuer:owner}',true);set local role authenticated;`;
let sql=`begin;set local statement_timeout='60s';
create temp table old_counts as select jsonb_build_object('events',(select count(*) from dashboard_private.notification_events),'deliveries',(select count(*) from dashboard_private.notification_deliveries)) as value;
insert into auth.users(id,instance_id,aud,role,email) values('${issuer}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','http-issuer@test.invalid'),('${owner}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','http-owner@test.invalid');
insert into public.profiles(id,role,name) values('${issuer}','admin','synthetic admin'),('${owner}','staff','synthetic owner') on conflict(id) do update set role=excluded.role;
insert into dashboard_private.ai_agent_credentials(id,created_by,label,token_hash,scopes,expires_at) values('${credential}','${issuer}','synthetic parity','${credentialHash}',array['ai-agent:requests:read','ai-agent:requests:claim','ai-agent:requests:update'],clock_timestamp()+interval '1 day');
insert into dashboard_private.ai_agent_credential_grants(credential_id,queues,actions,expires_at) values('${credential}',array['employee_requests'],array['read','claim','renew','progress','question','done'],clock_timestamp()+interval '1 day');
create temp table captures(name text primary key,kind text,operation text,data jsonb);grant all on captures to authenticated,service_role;
create function pg_temp.capture(n text,k text,op text,i jsonb) returns void language plpgsql as $$declare v jsonb;begin
 if k='bot' then v:=public.ai_agent_bot_api_v1('${credentialHash}',op,i);elsif k='policy' then v:=public.ai_agent_space_policy_api_v1(op,i);else v:=public.ai_agent_user_api_v1(op,i);end if;
 insert into captures values(n,k,op,v);end$$;
${role('user')}${cap('created','user','create',{title:'synthetic HTTP producer',body:'synthetic body',idempotencyKey:key(),notifyOnDone:false})}
${cap('employeeList','user','list',{page:1,pageSize:10,scope:'own'})}reset role;
${role('bot')}${cap('botList','bot','list',{status:'pending',limit:50})}
${cap('claimed','bot','claim',claim('created','1'))}
${cap('renewed','bot','renew',claim('created','2','1'))}
${cap('progress','bot','progress',claim('created','2','1')+`||jsonb_build_object('text','synthetic progress')`)}
`;
const questionInput=claim('created','3','1')+`||jsonb_build_object('text','synthetic question')`;
sql+=`${cap('question','bot','question',questionInput)}${cap('endedQuestionReplay','bot','question',questionInput)}reset role;
${role('user')}${cap('answer','user','append_message',`jsonb_build_object('id',${rid('created')},'version','4','idempotencyKey','${key()}','kind','answer','questionId',${captured('question')}->'message'->>'id','text','synthetic answer')`)}reset role;
${role('bot')}${cap('reclaimed','bot','claim',claim('created','5'))}reset role;
create function pg_temp.synthetic_permission(uuid,text,text) returns boolean language sql as $$select true$$;
insert into dashboard_private.ai_agent_action_registry(kind,permission_function,enabled) values('synthetic_http','pg_temp.synthetic_permission(uuid,text,text)'::regprocedure,true);
insert into dashboard_private.ai_agent_domain_action_grants(credential_id,kind,target,payload_hash,expires_at) values('${credential}','synthetic_http','synthetic/item','${payloadHash}',clock_timestamp()+interval '1 day');
${role('bot')}${cap('registered','bot','register_action',`jsonb_build_object('id',${rid('created')},'idempotencyKey','${key()}','claimTokenHash','${nonceHash}','claimGeneration','3','actionKey','${key()}','stepKey','synthetic-step','kind','synthetic_http','target','synthetic/item','payload','{}'::jsonb,'payloadHash','${payloadHash}')`)}
${cap('started','bot','start_action',`jsonb_build_object('id',${rid('created')},'actionId',${rid('registered')},'revision','1','idempotencyKey','${key()}','claimTokenHash','${nonceHash}','claimGeneration','3','target','synthetic/item','payloadHash','${payloadHash}')`)}reset role;
${role('user')}${cap('cancelled','user','cancel',`jsonb_build_object('id',${rid('created')},'version','6','idempotencyKey','${key()}')`)}reset role;
${role('bot')}${cap('lateResult','bot','record_action',`jsonb_build_object('id',${rid('created')},'actionId',${rid('registered')},'revision','2','idempotencyKey','${key()}','state','succeeded','target','synthetic/item','payloadHash','${payloadHash}','evidence',jsonb_build_object('resourceName','synthetic/item'))`)}
${cap('incident','bot','record_action',`jsonb_build_object('id',${rid('created')},'actionId',${rid('registered')},'revision','3','idempotencyKey','${key()}','state','failed','target','synthetic/item','payloadHash','${payloadHash}','evidence',jsonb_build_object('code','synthetic_contradiction'))`)}reset role;
${role('admin')}${cap('reconciled','user','reconcile_action',`jsonb_build_object('id',${rid('created')},'actionId',${rid('registered')},'revision','4','idempotencyKey','${key()}','state','succeeded','reason','synthetic concrete inspection','confirmed',true,'evidence',jsonb_build_object('type','manual_observation','target','synthetic/item','payloadHash','${payloadHash}','resourceName','synthetic/item','observedAt',clock_timestamp(),'observation','synthetic observed value'))`)}
reset role;
insert into dashboard_private.ai_agent_request_actions(request_id,credential_id,action_key,step_key,kind,target,payload,payload_hash,generation,state) select (${rid('created')})::uuid,'${credential}',gen_random_uuid(),'synthetic-page-'||n,'synthetic_http','synthetic/page/'||n,'{}','${payloadHash}',3,'succeeded' from generate_series(1,59)n;
insert into dashboard_private.ai_agent_action_events(action_id,seq,kind,actor_kind,actor_id,evidence) select (${rid('registered')})::uuid,n,case when n=56 then 'reconciled_manual_observation' else 'result' end,'user','${issuer}',jsonb_build_object('observation','synthetic durable observation','outcome','succeeded') from generate_series(6,56)n;
${role('admin')}${cap('actions','user','actions',`jsonb_build_object('id',${rid('created')},'limit',50)`)}
${cap('actionsLast','user','actions',`jsonb_build_object('id',${rid('created')},'limit',50,'cursor',${captured('actions')}->>'nextCursor')`)}
${cap('actionEvents','user','action_events',`jsonb_build_object('id',${rid('created')},'actionId',${rid('registered')},'limit',50)`)}
${cap('actionEventsLast','user','action_events',`jsonb_build_object('id',${rid('created')},'actionId',${rid('registered')},'limit',50,'cursor',${captured('actionEvents')}->>'nextCursor')`)}reset role;
-- Fixture-only slot and own policy, inside this disposable transaction.
update dashboard_private.chat_space_configuration set configured=true,resource_name='spaces/HTTP_OPTIN',public_origin='https://dashboard.test.invalid' where space_key='space_1';
insert into dashboard_private.chat_user_space_permissions(user_id,space_keys,configured_by) values('${owner}',array['space_1'],'${issuer}');
${role('user')}${cap('completionCreated','user','create',{title:'synthetic completion',body:'synthetic body',idempotencyKey:key(),notifyOnDone:true,notificationSpace:'space_1'})}reset role;
-- Preserve the existing revoked-policy completion capture, using actual current
-- policy loss after the allowed public create. The separate SQL happy path
-- proves that keeping this policy yields one pending intent.
delete from dashboard_private.chat_user_space_permissions where user_id='${owner}';
${role('bot')}${cap('completionClaim','bot','claim',claim('completionCreated','1'))}
`;
const doneInput=claim('completionCreated','2','1')+`||jsonb_build_object('result','synthetic completed')`;
sql+=`${cap('done','bot','done',doneInput)}${cap('endedDoneReplay','bot','done',doneInput)}reset role;
update dashboard_private.ai_agent_credentials set scopes=array['ai-agent:requests:claim','ai-agent:requests:update'] where id='${credential}';
${role('bot')}${cap('minimalEndedDoneReplay','bot','done',doneInput)}reset role;
update dashboard_private.ai_agent_credentials set scopes=array['ai-agent:requests:read','ai-agent:requests:claim','ai-agent:requests:update'] where id='${credential}';
${role('user')}${cap('notification','user','activity',`jsonb_build_object('id',${rid('completionCreated')})`)}reset role;
insert into dashboard_private.ai_agent_request_messages(request_id,message_seq,kind,text,author_kind,author_id,question_id) select (${rid('created')})::uuid,n,case when n=56 then 'answer' else 'comment' end,'synthetic history '||n,'user','${owner}',case when n=56 then (${captured('question')}->'message'->>'id')::uuid end from generate_series(4,56)n;
${role('user')}${cap('historyFirst','user','activity',`jsonb_build_object('id',${rid('created')},'limit',50)`)}${cap('historyLast','user','activity',`jsonb_build_object('id',${rid('created')},'afterMessageSeq','50','limit',50)`)}reset role;
insert into dashboard_private.ai_agent_requests(id,requester_id,title,body,status,version,claim_generation) values('${expiredRequest}','${owner}','synthetic expired resume','synthetic','processing',9007199254740993,9007199254740993);
${role('admin')}${cap('resumed','user','resume',`jsonb_build_object('id','${expiredRequest}','version','9007199254740993','idempotencyKey','${key()}','reason','synthetic expired review','confirmed',true)`)}reset role;
${role('user')}${cap('catalogEmployee','policy','catalog',{})}reset role;
${role('admin')}${cap('catalogAdmin','policy','catalog',{})}${cap('policyMissing','policy','get',{userId:owner})}${cap('policySet','policy','set',{userId:owner,revision:'0',spaceKeys:['space_1'],idempotencyKey:key()})}${cap('policyGet','policy','get',{userId:owner})}reset role;
select 'AI_HTTP_CAPTURE:'||jsonb_build_object('provenance',jsonb_build_object('kind','actual_disposable_db_gateway','synthetic',true,'providerCalls',0,'rolledBack',true),'oldNotificationCounts',jsonb_build_object('before',(select value from old_counts),'after',jsonb_build_object('events',(select count(*) from dashboard_private.notification_events),'deliveries',(select count(*) from dashboard_private.notification_deliveries))),'captures',(select jsonb_agg(to_jsonb(c) order by name) from captures c))::text;
rollback;
`;
const client=session();client.end(sql);
const result=await client.complete;
assert.equal(result.code,0,'synthetic HTTP producer capture failed');
const stdout=result.stdout;
await closeSessions(client);
assert.equal(await query(`select count(*) from dashboard_private.ai_agent_credentials where id='${credential}';`),'0','HTTP producer transaction must roll back its synthetic credential');
assert.equal(await query(`select count(*) from dashboard_private.chat_user_space_permissions where user_id='${owner}';`),'0','HTTP producer transaction must roll back its synthetic policy');
assert.deepEqual(JSON.parse(await query("select jsonb_agg(to_jsonb(c) order by space_key) from dashboard_private.chat_space_configuration c;")),configurationBefore,'HTTP producer transaction must roll back every slot fixture change');
const capture=stdout.split('\n').find(line=>line.startsWith('AI_HTTP_CAPTURE:'));assert.ok(capture,'producer capture absent');
const parsed=JSON.parse(capture.slice('AI_HTTP_CAPTURE:'.length));assert.equal(parsed.captures.length,34);assert.deepEqual(parsed.oldNotificationCounts.before,parsed.oldNotificationCounts.after);
assert.equal(parsed.captures.find(row=>row.name==='historyLast').data.messages.at(-1).seq,'56');
assert.deepEqual(Object.keys(parsed.captures.find(row=>row.name==='minimalEndedDoneReplay').data.request).sort(),['id','status','version']);
assert.ok(!capture.includes(credentialHash));assert.ok(!capture.includes(nonceHash));
// Capture actual canonical personal SQL producers privately in this same run.
const fixtureFingerprintSql="select encode(sha256(convert_to(jsonb_build_object('profiles',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from public.profiles p),'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb) from dashboard_private.ai_agent_requests r))::text,'UTF8')),'hex');";
for (const [field,path,prefix] of [
 ['personalCredential','supabase/tests/ai_agent_personal_owner_test.sql','AI_PERSONAL_CREDENTIAL_CAPTURE:'],
 ['personalRead','supabase/tests/agent_personal_dashboard_read_test.sql','AGENT_PERSONAL_DASHBOARD_READ_CAPTURE:'],
]) {
 const source=await readFile(path,'utf8');
 const fixturesBefore=await query(fixtureFingerprintSql);
 const output=await query("create extension if not exists pgtap with schema extensions;set search_path=public,extensions;set app.ai_personal_capture='on';\n"+source);
 assert.equal(await query(fixtureFingerprintSql),fixturesBefore,'personal producer transaction must restore every profile and request row');
 const lines=output.split('\n'),plans=lines.filter(line=>/^1\.\.[0-9]+$/.test(line)),passed=lines.filter(line=>/^ok [0-9]+(?:\s|$)/.test(line));
 // Emit only bounded assertion numbers, never TAP values or captured DTOs.
 const failedIds=lines.flatMap(line=>{const match=line.match(/^not ok ([0-9]+)(?:\s|$)/);return match?[Number(match[1])]:[];});
 if(failedIds.length)console.error(JSON.stringify({producer:field,failedCount:failedIds.length,failedIds:failedIds.slice(0,20)}));
 assert.ok(!lines.some(line=>/^(not ok|Bail out!)/i.test(line)||/#\s*(SKIP|TODO)\b/i.test(line)),'personal producer TAP must pass');
 assert.equal(plans.length,1);assert.equal(passed.length,Number(plans[0].slice(3)));
 const captures=lines.filter(line=>line.startsWith(prefix));assert.equal(captures.length,1);
 parsed[field]=JSON.parse(captures[0].slice(prefix.length));
}
console.log('AI_HTTP_CAPTURE:'+JSON.stringify(parsed));

} finally {
// BEGIN GENERATED AI PROBE CLEANUP
// Generated: DO NOT EDIT. Regenerate: node scripts/generate-ai-agent-probe-runtime.mjs
await finishRuntime();
// END GENERATED AI PROBE CLEANUP
}
