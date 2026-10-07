import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
const q=x=>"'"+String(x).replaceAll("'","''")+"'",j=x=>q(JSON.stringify(x))+'::jsonb';
export async function runDeadlineConcurrency(runtime,parseTap) {
 const issuer=randomUUID(),claimHash=createHash('sha256').update(randomUUID()).digest('hex');
 const employee=id=>`select set_config('request.jwt.claim.sub',${q(id)},true);set local role authenticated;`;
 const last=async sql=>(await runtime.query(sql)).split('\n').at(-1);
 const call=(hash,family,action,input)=>`public.ai_agent_${family}_api_v1(${q(hash)},${q(action)},${j(input)})`;
 await runtime.query(`insert into auth.users(id,instance_id,aud,role,email) values(${q(issuer)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${q(issuer+'@test.invalid')});insert into public.profiles(id,role,name) values(${q(issuer)},'admin','Synthetic expiry issuer') on conflict(id) do update set role=excluded.role,name=excluded.name;update dashboard_private.chat_space_configuration set configured=true,resource_name='spaces/EXPIRY_FIXTURE',public_origin='https://synthetic.invalid' where space_key='space_2';`);
 const proof=[];
 for(const operation of ['claim','claim_replay','done_replay','done_fk','prepare_budget','prepare_replay'])for(const deadline of ['credential','grant']) {
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
   'outbox',(select jsonb_agg(to_jsonb(x) order by x.id) from dashboard_private.chat_delivery_outbox x where request_id=${q(rid)}),
   'attempts',(select jsonb_agg(to_jsonb(x) order by x.id) from dashboard_private.chat_delivery_attempts x where credential_id=${q(cid)}),
   'receipts',(select jsonb_agg(to_jsonb(x) order by x.operation,x.idempotency_key) from dashboard_private.ai_agent_request_receipts x where principal_id=${q(cid)}),
   'usage',(select jsonb_build_array(rate_count,rate_window,last_used_at) from dashboard_private.ai_agent_credentials where id=${q(cid)}),
   'global',(select to_jsonb(x) from dashboard_private.chat_send_global_budget x where singleton),
   'space',(select to_jsonb(x) from dashboard_private.chat_space_send_budgets x where space_key='space_2'))::text;`);
  const before=await snapshot(),first=runtime.session(),second=runtime.session();
  try {
   first.write(`begin;${block}select 'LOCKED:'||pg_backend_pid();\n`);const blocker=Number((await first.line(/^LOCKED:(\d+)$/mu))[1]);
   // Only this selected deadline expires. Other authority remains current.
   await runtime.query(`update dashboard_private.${table} set expires_at=clock_timestamp()+interval '2 seconds' where ${column}=${q(cid)};`);
   second.write(`begin;select 'WRITER:'||pg_backend_pid();create function pg_temp.expiry_call() returns text language plpgsql as $$begin perform ${expr};return '00000';exception when others then return SQLSTATE||':'||SQLERRM;end$$;create temp table expiry_outcome(v text);grant all on expiry_outcome to service_role;set local role service_role;insert into expiry_outcome values(pg_temp.expiry_call());select 'OUTCOME:'||v from expiry_outcome;set local role postgres;select plan(1);select is(v,${q(deadline==='credential'?'28000:ai_agent_unauthorized':'42501:ai_agent_grant_forbidden')},'expired after observed downstream wait') from expiry_outcome;select * from finish();\n`);
   const writer=Number((await second.line(/^WRITER:(\d+)$/mu))[1]);assert.equal(await runtime.waitForLock(writer,blocker),true);
   let expired=false;const until=Date.now()+3500;
   for(let n=0;Date.now()<until;n++) {
    const marker=`EXPIRED_${n}:`;
    first.write(`select ${q(marker)}||(expires_at<=clock_timestamp())::text from dashboard_private.${table} where ${column}=${q(cid)};\n`);
    expired=(await first.line(new RegExp('^'+marker+'(true|false)$','mu')))[1]==='true';if(expired)break;
    await new Promise(r=>setTimeout(r,30));
   }
   assert.equal(expired,true,'database clock must prove expiry before releasing blocker');first.end('commit;\n');runtime.requireComplete(await first.complete);
   const expected=deadline==='credential'?'28000:ai_agent_unauthorized':'42501:ai_agent_grant_forbidden';assert.equal((await second.line(/^OUTCOME:(.*)$/mu))[1],expected);
   second.end('commit;\n');const result=await second.complete;runtime.requireComplete(result);const tap=parseTap(result.stdout);
   assert.equal(await snapshot(),before,'denial must roll back every request/receipt/dispatch/accounting effect');
   proof.push({operation,deadline,lockWaitObserved:true,expiryObserved:true,sqlstate:expected.split(':')[0],effectsUnchanged:true,tap});
  } finally {await runtime.closeSessions(first,second);}
 }
 assert.equal(proof.length,12);return{status:'passed',cases:proof,providerSend:false};
}
