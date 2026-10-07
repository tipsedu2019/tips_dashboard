import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {lineBefore} from './helpers/ai-personal-probe-runtime.mjs';
const q=x=>"'"+String(x).replaceAll("'","''")+"'",j=x=>q(JSON.stringify(x))+'::jsonb';
export async function runPersonalInstallGuardProbe(runtime,parseTap) {
 const source=await readFile('supabase/migrations/20261007062153_ai_agent_personal_owner.sql','utf8');
 const blocks=[...source.matchAll(/^do \$ai_personal_first_install\$([\s\S]*?)^\$ai_personal_first_install\$;/gmu)];
 assert.equal(blocks.length,1,'exercise the exact canonical first-install guard');
 const guard='create function pg_temp.actual_install_guard() returns void language plpgsql as $ai_personal_first_install$'+blocks[0][1]+'$ai_personal_first_install$;';
 const tables=['ai_agent_credentials','ai_agent_request_events','ai_agent_action_events','chat_delivery_attempts'];
 const truncate='truncate '+tables.map(t=>'dashboard_private.'+t).join(',')+' cascade;';
 const actor=randomUUID(),rid=randomUUID(),cid=randomUUID(),hash=createHash('sha256').update(randomUUID()).digest('hex');
 const state="jsonb_build_object("+[...tables,'ai_agent_chat_support'].map(t=>q(t)+', (select jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text) from dashboard_private.'+t+' x)').join(',')+")";
 // The complete guard experiment is one rollback-only transaction, restoring
 // every earlier synthetic producer/concurrency fixture, including cascades.
 const output=await runtime.query(`begin;select plan(10);${truncate}
update dashboard_private.ai_agent_chat_support set issuance_enabled=false where singleton;
${guard}
create temp table guard_before(v jsonb);insert into guard_before values(${state});
select lives_ok('select pg_temp.actual_install_guard()','disabled empty first installation is accepted');
select is(${state},(select v from guard_before),'successful guard performs no data mutation');
update dashboard_private.ai_agent_chat_support set issuance_enabled=true where singleton;
select throws_ok('select pg_temp.actual_install_guard()','55000','ai_agent_personal_install_issuance_not_disabled','enabled issuance prevents installation');
delete from dashboard_private.ai_agent_chat_support where singleton;
select throws_ok('select pg_temp.actual_install_guard()','55000','ai_agent_personal_install_issuance_not_disabled','missing singleton prevents installation');
insert into dashboard_private.ai_agent_chat_support(singleton,issuance_enabled) values(true,false);
insert into auth.users(id,instance_id,aud,role,email) values(${q(actor)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${q(actor+'@test.invalid')});
insert into public.profiles(id,role,name) values(${q(actor)},'admin','Synthetic installation guard') on conflict(id) do update set role=excluded.role,name=excluded.name;
insert into dashboard_private.ai_agent_credentials(id,created_by,label,token_hash,scopes,expires_at) values(${q(cid)},${q(actor)},'Synthetic guard key',${q(hash)},array['ai-agent:requests:read'],clock_timestamp()+interval '1 day');
update guard_before set v=${state};
select throws_ok('select pg_temp.actual_install_guard()','55000','ai_agent_personal_install_not_empty','existing credential prevents first-install shortcut');
select is(${state},(select v from guard_before),'denied credential case preserves all existing state');
${truncate}
insert into dashboard_private.ai_agent_requests(id,requester_id,title,body) values(${q(rid)},${q(actor)},'Synthetic user-only event','No credential or provider');
insert into dashboard_private.ai_agent_request_events(request_id,event_seq,kind,actor_kind,actor_id,requester_id,next_status,version) values(${q(rid)},1,'created','user',${q(actor)},${q(actor)},'pending',1);
select is((select count(*) from dashboard_private.ai_agent_credentials),0::bigint,'event-only case has no credential');
update guard_before set v=${state};
select throws_ok('select pg_temp.actual_install_guard()','55000','ai_agent_personal_install_not_empty','user-only event prevents first-install shortcut');
select is(${state},(select v from guard_before),'denied event case preserves all existing state');
select is((select count(*) from pg_constraint where connamespace='dashboard_private'::regnamespace and convalidated and conname in('ai_agent_credential_owner_fk','ai_agent_credential_owner_kind_check','ai_agent_event_owner_fk','ai_agent_action_owner_fk','chat_attempt_owner_fk')),5::bigint,'complete chain validates all owner constraints');
select * from finish();rollback;`);
 return {status:'passed',tap:parseTap(output),canonicalGuardSha256:createHash('sha256').update(blocks[0][0]).digest('hex'),fixtureTransactionRolledBack:true,providerSend:false};
}
export async function runDeadlineConcurrency(runtime,parseTap,deadline) {
 assert.ok(['credential','grant'].includes(deadline));
 const issuer=randomUUID(),claimHash=createHash('sha256').update(randomUUID()).digest('hex');
 const employee=id=>`select set_config('request.jwt.claim.sub',${q(id)},true);set local role authenticated;`;
 const last=async sql=>(await runtime.query(sql)).split('\n').at(-1);
 const call=(hash,family,action,input)=>`public.ai_agent_${family}_api_v1(${q(hash)},${q(action)},${j(input)})`;
 await runtime.query(`insert into auth.users(id,instance_id,aud,role,email) values(${q(issuer)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${q(issuer+'@test.invalid')});insert into public.profiles(id,role,name) values(${q(issuer)},'admin','Synthetic expiry issuer') on conflict(id) do update set role=excluded.role,name=excluded.name;update dashboard_private.chat_space_configuration set configured=true,resource_name='spaces/EXPIRY_FIXTURE',public_origin='https://synthetic.invalid' where space_key='space_2';`);
 const proof=[];
 for(const operation of ['claim','claim_replay','done_replay','done_fk','prepare_budget','prepare_replay']) {
  const owner=randomUUID(),cid=randomUUID(),hash=createHash('sha256').update(randomUUID()).digest('hex');
  await runtime.query(`insert into auth.users(id,instance_id,aud,role,email) values(${q(owner)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${q(owner+'@test.invalid')});insert into public.profiles(id,role,name) values(${q(owner)},'teacher','Synthetic expiry owner') on conflict(id) do update set role=excluded.role,name=excluded.name;insert into dashboard_private.chat_user_space_permissions(user_id,space_keys,revision,configured_by) values(${q(owner)},array['space_2'],1,${q(issuer)});`);
  await runtime.query(`insert into dashboard_private.ai_agent_credentials(id,created_by,owner_profile_id,credential_kind,label,token_hash,scopes,expires_at) values(${q(cid)},${q(issuer)},${q(owner)},'personal','Synthetic expiry key',${q(hash)},array['ai-agent:requests:read','ai-agent:requests:claim','ai-agent:requests:update','chat:outbox:read','chat:send'],clock_timestamp()+interval '1 day');insert into dashboard_private.ai_agent_credential_grants(credential_id,queues,actions,expires_at) values(${q(cid)},array['employee_requests'],array['read','claim','renew','progress','question','done'],clock_timestamp()+interval '1 day');insert into dashboard_private.chat_credential_space_grants(credential_id,space_keys,purposes,expires_at) values(${q(cid)},array['space_2'],array['ai_completion'],clock_timestamp()+interval '1 day');`);
  const notify=operation!=='claim'&&operation!=='claim_replay';
  const rid=await last(`begin;${employee(owner)}select public.ai_agent_user_api_v1('create',${j({title:'Synthetic deadline',body:'No provider call',notifyOnDone:notify,...(notify?{notificationSpace:'space_2'}:{}),idempotencyKey:randomUUID()})})->>'id';commit;`);assert.match(rid,/^[a-f0-9-]{36}$/u);
  const claim={id:rid,version:'1',idempotencyKey:randomUUID(),claimTokenHash:claimHash};
  const done={id:rid,version:'2',idempotencyKey:randomUUID(),claimTokenHash:claimHash,claimGeneration:'1',result:'Synthetic completed'};
  const invoke=async expr=>runtime.query(`begin;set local role service_role;select ${expr} is not null;commit;`);
  let expr=call(hash,'bot','claim',claim),block=`select 1 from dashboard_private.ai_agent_requests where id=${q(rid)} for update;`,oid;
  if(operation!=='claim')await invoke(expr);
  if(['done_replay','prepare_budget','prepare_replay'].includes(operation))await invoke(call(hash,'bot','done',done));
  if(operation.startsWith('done'))expr=call(hash,'bot','done',done);
  if(operation==='done_fk')block="select 1 from dashboard_private.chat_space_configuration where space_key='space_2' for update;";
  if(operation.startsWith('prepare')) {
   oid=await last(`select id::text from dashboard_private.chat_delivery_outbox where request_id=${q(rid)};`);
   const input={id:oid,revision:'1',idempotencyKey:randomUUID()};expr=call(hash,'chat','prepare_attempt',input);
   await runtime.query("update dashboard_private.chat_send_global_budget set count=0;update dashboard_private.chat_space_send_budgets set last_dispatch_at=null where space_key='space_2';");
   if(operation==='prepare_replay')await invoke(expr);
   block=operation==='prepare_budget'?"select 1 from dashboard_private.chat_send_global_budget where singleton for update;":`select 1 from dashboard_private.chat_delivery_outbox where id=${q(oid)} for update;`;
  }
  const table=deadline==='credential'?'ai_agent_credentials':operation.startsWith('prepare')?'chat_credential_space_grants':'ai_agent_credential_grants',column=deadline==='credential'?'id':'credential_id';
  const snapshot=()=>last(`select jsonb_build_object(
   'request',(select to_jsonb(r) from dashboard_private.ai_agent_requests r where id=${q(rid)}),
   'claim',(select jsonb_agg(to_jsonb(x) order by x.request_id) from dashboard_private.ai_agent_request_claims x where request_id=${q(rid)}),
   'messages',(select jsonb_agg(to_jsonb(x) order by x.id) from dashboard_private.ai_agent_request_messages x where request_id=${q(rid)}),
   'events',(select jsonb_agg(to_jsonb(x) order by x.id) from dashboard_private.ai_agent_request_events x where request_id=${q(rid)}),
   'actions',(select jsonb_agg(to_jsonb(x) order by x.id) from dashboard_private.ai_agent_request_actions x where request_id=${q(rid)}),
   'actionEvents',(select jsonb_agg(to_jsonb(x) order by x.action_id,x.seq) from dashboard_private.ai_agent_action_events x where action_id in(select id from dashboard_private.ai_agent_request_actions where request_id=${q(rid)})),
   'outbox',(select jsonb_agg(to_jsonb(x) order by x.id) from dashboard_private.chat_delivery_outbox x where request_id=${q(rid)}),
   'attempts',(select jsonb_agg(to_jsonb(x) order by x.id) from dashboard_private.chat_delivery_attempts x where credential_id=${q(cid)}),
   'receipts',(select jsonb_agg(to_jsonb(x) order by x.operation,x.idempotency_key) from dashboard_private.ai_agent_request_receipts x where principal_id=${q(cid)}),
   'usage',(select jsonb_build_array(rate_count,rate_window,last_used_at) from dashboard_private.ai_agent_credentials where id=${q(cid)}),
   'global',(select to_jsonb(x) from dashboard_private.chat_send_global_budget x where singleton),
   'space',(select to_jsonb(x) from dashboard_private.chat_space_send_budgets x where space_key='space_2'))::text;`);
  const before=await snapshot(),first=runtime.session(),second=runtime.session(),armer=runtime.session();
  try {
   first.write("select 'FIRST_READY:'||pg_backend_pid();\n");second.write("select 'SECOND_READY:'||pg_backend_pid();\n");armer.write("select 'ARMER_READY:'||pg_backend_pid();\n");
   await first.line(/^FIRST_READY:(\d+)$/mu);await second.line(/^SECOND_READY:(\d+)$/mu);await armer.line(/^ARMER_READY:(\d+)$/mu);
   first.write(`begin;${block}select 'LOCKED:'||pg_backend_pid();\n`);const blocker=Number((await first.line(/^LOCKED:(\d+)$/mu))[1]);
   // Only this selected deadline expires. Other authority remains current.
   armer.write(`begin;update dashboard_private.${table} set expires_at=clock_timestamp()+interval '2 seconds' where ${column}=${q(cid)};commit;select 'ARMED:'||(expires_at>clock_timestamp())::text from dashboard_private.${table} where ${column}=${q(cid)};\n`);
   assert.equal((await armer.line(/^ARMED:(true|false)$/mu))[1],'true','deadline must be current after committed arm');
   const until=Date.now()+3500;
   second.write(`begin;select 'WRITER:'||pg_backend_pid();create function pg_temp.expiry_call() returns text language plpgsql as $$begin perform ${expr};return '00000';exception when others then return SQLSTATE||':'||SQLERRM;end$$;create temp table expiry_outcome(v text);grant all on expiry_outcome to service_role;set local role service_role;insert into expiry_outcome values(pg_temp.expiry_call());select 'OUTCOME:'||v from expiry_outcome;set local role postgres;select plan(1);select is(v,${q(deadline==='credential'?'28000:ai_agent_unauthorized':'42501:ai_agent_grant_forbidden')},'expired after observed downstream wait') from expiry_outcome;select * from finish();\n`);
   const writer=Number((await second.line(/^WRITER:(\d+)$/mu))[1]);assert.equal(await runtime.waitForLock(writer,blocker,{observer:first,deadlineAt:until}),true);
   let expired=false;
   for(let n=0;Date.now()<until;n++) {
    const marker=`EXPIRED_${n}:`;
    first.write(`select ${q(marker)}||(expires_at<=clock_timestamp())::text from dashboard_private.${table} where ${column}=${q(cid)};\n`);
    expired=(await lineBefore(first,new RegExp('^'+marker+'(true|false)$','mu'),until))[1]==='true';if(expired)break;
    await new Promise(r=>setTimeout(r,30));
   }
   assert.ok(Date.now()<until,'release remains bounded from writer start');
   assert.equal(expired,true,'database clock must prove expiry before releasing blocker');first.end('commit;\n');runtime.requireComplete(await first.complete);
   const expected=deadline==='credential'?'28000:ai_agent_unauthorized':'42501:ai_agent_grant_forbidden';assert.equal((await second.line(/^OUTCOME:(.*)$/mu))[1],expected);
   second.end('commit;\n');const result=await second.complete;runtime.requireComplete(result);const tap=parseTap(result.stdout);
   assert.equal(await snapshot(),before,'denial must roll back every request/receipt/dispatch/accounting effect');
   proof.push({operation,deadline,lockWaitObserved:true,expiryObserved:true,sqlstate:expected.split(':')[0],effectsUnchanged:true,tap});
  } finally {await runtime.closeSessions(first,second,armer);}
 }
 assert.equal(proof.length,6);return{status:'passed',cases:proof,providerSend:false};
}

// Central domain dispatch also waits inside an adapter's permission callback.
// Each registry/grant/action fixture is transaction-local and rolled back.
export async function runCentralDomainDeadlineConcurrency(runtime,parseTap) {
 const results=[];
 for(const operation of ['register_action','start_action'])for(const replay of [false,true]) {
  const issuer=randomUUID(),owner=randomUUID(),cid=randomUUID(),rid=randomUUID();
  const hash=createHash('sha256').update(randomUUID()).digest('hex'),claimHash=createHash('sha256').update(randomUUID()).digest('hex'),payloadHash=createHash('sha256').update('{}').digest('hex');
  const lockKey=Number.parseInt(randomUUID().slice(0,7),16)+1;
  const registry='synthetic_deadline_'+randomUUID().replaceAll('-',''),target='synthetic/deadline';
  const call=(action,input)=>`public.ai_agent_bot_api_v1(${q(hash)},${q(action)},${input})`;
  const registered=call('register_action',j({id:rid,idempotencyKey:randomUUID(),claimTokenHash:claimHash,claimGeneration:'1',actionKey:randomUUID(),stepKey:'deadline-step',kind:registry,target,payload:{},payloadHash}));
  const started=call('start_action',`jsonb_build_object('id',${q(rid)},'actionId',(select v->>'id' from central_state where k='registered'),'revision','1','idempotencyKey',${q(randomUUID())},'claimTokenHash',${q(claimHash)},'claimGeneration','1','target',${q(target)},'payloadHash',${q(payloadHash)})`);
  const snapshot=`jsonb_build_object('request',(select to_jsonb(x) from dashboard_private.ai_agent_requests x where id=${q(rid)}),'claim',(select to_jsonb(x) from dashboard_private.ai_agent_request_claims x where request_id=${q(rid)}),'actions',(select jsonb_agg(to_jsonb(x) order by id) from dashboard_private.ai_agent_request_actions x where request_id=${q(rid)}),'events',(select jsonb_agg(to_jsonb(x) order by action_id,seq) from dashboard_private.ai_agent_action_events x where action_id in(select id from dashboard_private.ai_agent_request_actions where request_id=${q(rid)})),'receipts',(select jsonb_agg(to_jsonb(x) order by operation,idempotency_key) from dashboard_private.ai_agent_request_receipts x where principal_id=${q(cid)}),'usage',(select jsonb_build_array(rate_count,rate_window,last_used_at) from dashboard_private.ai_agent_credentials where id=${q(cid)}))`;
  const blocker=runtime.session(),writer=runtime.session();
  try {
   blocker.write("select 'BLOCKER_READY:'||pg_backend_pid();\n");writer.write("select 'WRITER_READY:'||pg_backend_pid();\n");
   await blocker.line(/^BLOCKER_READY:(\d+)$/mu);await writer.line(/^WRITER_READY:(\d+)$/mu);
   blocker.write(`begin;select pg_advisory_xact_lock(${lockKey});select 'BLOCKER:'||pg_backend_pid();\n`);const blockerPid=Number((await blocker.line(/^BLOCKER:(\d+)$/mu))[1]);
   const until=Date.now()+3500;
   writer.write(`begin;select 'WRITER:'||pg_backend_pid();
insert into auth.users(id,instance_id,aud,role,email) values(${q(issuer)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${q(issuer+'@test.invalid')}),(${q(owner)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${q(owner+'@test.invalid')});
insert into public.profiles(id,role,name) values(${q(issuer)},'admin','Synthetic central issuer'),(${q(owner)},'staff','Synthetic central requester') on conflict(id) do update set role=excluded.role,name=excluded.name;
insert into dashboard_private.ai_agent_credentials(id,created_by,label,token_hash,scopes,expires_at) values(${q(cid)},${q(issuer)},'Synthetic central deadline',${q(hash)},array['ai-agent:requests:read','ai-agent:requests:claim','ai-agent:requests:update'],clock_timestamp()+interval '1 day');
insert into dashboard_private.ai_agent_credential_grants(credential_id,queues,actions,expires_at) values(${q(cid)},array['employee_requests'],array['read','claim','renew','progress','question','done'],clock_timestamp()+interval '1 day');
create temp table central_wait(enabled boolean);insert into central_wait values(false);
create function pg_temp.deadline_domain_permission(u uuid,t text,h text) returns boolean language plpgsql as $$begin
 if u is distinct from ${q(owner)}::uuid or t is distinct from ${q(target)} or h is distinct from ${q(payloadHash)} then return false;end if;
 if (select enabled from central_wait) then perform pg_advisory_xact_lock(${lockKey});end if;return true;end$$;
insert into dashboard_private.ai_agent_action_registry(kind,permission_function,enabled) values(${q(registry)},'pg_temp.deadline_domain_permission(uuid,text,text)'::regprocedure,true);
insert into dashboard_private.ai_agent_domain_action_grants(credential_id,kind,target,payload_hash,expires_at) values(${q(cid)},${q(registry)},${q(target)},${q(payloadHash)},clock_timestamp()+interval '1 day');
insert into dashboard_private.ai_agent_requests(id,requester_id,title,body) values(${q(rid)},${q(owner)},'Synthetic domain deadline','No external action');
create temp table central_state(k text primary key,v jsonb);grant all on central_state to service_role;
set local role service_role;select ${call('claim',j({id:rid,version:'1',idempotencyKey:randomUUID(),claimTokenHash:claimHash}))} is not null;
${operation==='start_action'||replay?`insert into central_state values('registered',${registered});`:''}
${operation==='start_action'&&replay?`select ${started} is not null;`:''}
set local role postgres;update central_wait set enabled=true;
update dashboard_private.ai_agent_domain_action_grants set expires_at=clock_timestamp()+interval '2 seconds' where credential_id=${q(cid)};
select 'EXPIRY:'||extract(epoch from expires_at)::text from dashboard_private.ai_agent_domain_action_grants where credential_id=${q(cid)};
insert into central_state values('before',${snapshot});
create function pg_temp.central_expiry_call() returns text language plpgsql as $$begin perform ${operation==='register_action'?registered:started};return '00000';exception when others then return SQLSTATE||':'||SQLERRM;end$$;
set local role service_role;insert into central_state values('outcome',to_jsonb(pg_temp.central_expiry_call()));set local role postgres;
select 'OUTCOME:'||(v#>>'{}') from central_state where k='outcome';select plan(2);
select is((select v#>>'{}' from central_state where k='outcome'),'42501:ai_agent_action_forbidden','domain expires inside observed callback wait');
select is(${snapshot},(select v from central_state where k='before'),'denial rolls back action, journal, receipts, claim and rate');select * from finish();\n`);
   const writerPid=Number((await writer.line(/^WRITER:(\d+)$/mu))[1]);const expiry=(await writer.line(/^EXPIRY:([0-9]+(?:\.[0-9]+)?)$/mu))[1];
   assert.equal(await runtime.waitForLock(writerPid,blockerPid,{observer:blocker,deadlineAt:until}),true);
   let expired=false;
   for(let n=0;Date.now()<until;n++) {const marker=`CLOCK_${n}:`;blocker.write(`select ${q(marker)}||(clock_timestamp()>=to_timestamp(${expiry}))::text;\n`);expired=(await lineBefore(blocker,new RegExp('^'+marker+'(true|false)$','mu'),until))[1]==='true';if(expired)break;await new Promise(r=>setTimeout(r,30));}
   assert.ok(Date.now()<until,'central release remains bounded from writer start');assert.equal(expired,true);blocker.end('commit;\n');runtime.requireComplete(await blocker.complete);
   assert.equal((await writer.line(/^OUTCOME:(.*)$/mu))[1],'42501:ai_agent_action_forbidden');writer.end('rollback;\n');const done=await writer.complete;runtime.requireComplete(done);
   results.push({operation,replay,callbackLockWaitObserved:true,expiryObserved:true,sqlstate:'42501',tap:parseTap(done.stdout)});
  } finally {await runtime.closeSessions(blocker,writer);}
 }
 assert.equal(results.length,4);return {status:'passed',cases:results,providerSend:false,fixtureTransactionsRolledBack:true};
}
