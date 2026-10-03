import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

// Only the common runner's nonce-bound loopback project is accepted.
const url=new URL(process.env.TASK_LOCAL_DB_URL||'https://invalid.invalid');
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/postgres');
assert.match(process.env.TASK_LOCAL_DB_NONCE||'',/^[a-f0-9]{32}$/u);
const config=await readFile('supabase/config.toml','utf8');
const project=config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]{12})"/mu)?.[1];
assert.ok(project);assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const container=`supabase_db_${project}`;
const actor=randomUUID(),target=randomUUID(),key=randomUUID();
const expression=(revision,k=key)=>`public.ai_agent_space_policy_api_v1('set',jsonb_build_object('userId','${target}','revision','${revision}','spaceKeys','["space_1"]'::jsonb,'idempotencyKey','${k}'))`;
function session(){
 const child=spawn('docker',['exec','-i',container,'psql','-XqAt','--set','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='',ended=false;
 const complete=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{ended=true;resolve({code,stdout,stderr});});});
 child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);
 return {child,complete,write:sql=>child.stdin.write(sql),end:sql=>child.stdin.end(sql),async line(pattern){const deadline=Date.now()+20_000;while(Date.now()<deadline){const match=stdout.match(pattern);if(match)return match;if(ended)throw new Error(`checkpoint ended: ${stderr}`);await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('policy checkpoint timeout');}};
}
async function query(sql){const s=session();s.end(sql);const r=await s.complete;assert.equal(r.code,0,r.stderr);return r.stdout.trim();}
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
 }finally{if(!blocker.child.stdin.destroyed)blocker.end('rollback;\n');if(!writer.child.stdin.destroyed)writer.end('rollback;\n');await Promise.allSettled([blocker.complete,writer.complete]);}
}
await query(`update public.profiles set role='admin' where id='${actor}';update public.profiles set role='staff' where id='${target}';`);
const first=session(),second=session();
try{
 first.write(`begin;set local statement_timeout='30s';${authenticate}select ${expression('0')};select 'FIRST:'||pg_backend_pid();\n`);
 const fp=Number((await first.line(/^FIRST:(\d+)$/mu))[1]);
 second.write(`begin;set local statement_timeout='25s';set local lock_timeout='20s';select 'SECOND:'||pg_backend_pid();create function pg_temp.exercise() returns text language plpgsql as $$begin perform ${expression('0',randomUUID())};return '00000';exception when others then return SQLSTATE;end$$;${authenticate}select 'STATE:'||pg_temp.exercise();\n`);
 const sp=Number((await second.line(/^SECOND:(\d+)$/mu))[1]);assert.equal(await waiting(sp,fp),true);first.end('commit;\n');assert.equal((await first.complete).code,0);
 const state=(await second.line(/^STATE:([A-Z0-9]{5})$/mu))[1];second.end('commit;\n');assert.equal((await second.complete).code,0);assert.equal(state,'55000');assert.deepEqual(await counts(),{policies:1,events:1,receipts:1});evidence.push({operation:'first_create_CAS',policyLockWaitObserved:true,sqlstate:state,effects:await counts()});
}finally{if(!first.child.stdin.destroyed)first.end('rollback;\n');if(!second.child.stdin.destroyed)second.end('rollback;\n');await Promise.allSettled([first.complete,second.complete]);}
// Exact replay must also wait for and reject an actor downgrade.
const blocker=session(),replay=session();
try{
 blocker.write(`begin;update public.profiles set role='viewer' where id='${actor}';select 'LOCKED:'||pg_backend_pid();\n`);const bp=Number((await blocker.line(/^LOCKED:(\d+)$/mu))[1]);
 replay.write(`begin;set local statement_timeout='25s';set local lock_timeout='20s';select 'WRITER:'||pg_backend_pid();create function pg_temp.exercise() returns text language plpgsql as $$begin perform ${expression('0')};return '00000';exception when others then return SQLSTATE;end$$;${authenticate}select 'STATE:'||pg_temp.exercise();\n`);const rp=Number((await replay.line(/^WRITER:(\d+)$/mu))[1]);assert.equal(await waiting(rp,bp),true);blocker.end('commit;\n');assert.equal((await blocker.complete).code,0);const state=(await replay.line(/^STATE:([A-Z0-9]{5})$/mu))[1];replay.end('commit;\n');assert.equal((await replay.complete).code,0);assert.equal(state,'42501');assert.deepEqual(await counts(),{policies:1,events:1,receipts:1});evidence.push({operation:'replay_admin_downgrade',profileLockWaitObserved:true,sqlstate:state,effects:await counts()});
}finally{if(!blocker.child.stdin.destroyed)blocker.end('rollback;\n');if(!replay.child.stdin.destroyed)replay.end('rollback;\n');await Promise.allSettled([blocker.complete,replay.complete]);}
console.log(JSON.stringify({status:'passed',checkpoints:evidence}));
