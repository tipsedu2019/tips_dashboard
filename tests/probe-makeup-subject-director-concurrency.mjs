import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Nonce-scoped disposable database only. No HTTP/provider/session access.
const url=new URL(process.env.TASK_LOCAL_DB_URL||'https://invalid.invalid');
assert.equal(url.hostname,'127.0.0.1');assert.ok(['postgres:','postgresql:'].includes(url.protocol));assert.equal(url.pathname,'/postgres');
assert.match(process.env.TASK_LOCAL_DB_NONCE||'',/^[a-f0-9]{32}$/);
const config=await readFile('supabase/config.toml','utf8');
const project=config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]+)"/m)?.[1];assert.ok(project);assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const container=`supabase_db_${project}`, sessions=[];
const id=n=>`aa041004-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sqlLiteral=value=>"'"+String(value).replaceAll("'","''")+"'";
function session(sql,hold=false){
 const child=spawn('docker',['exec','-i',container,'psql','-XqAt','--set','ON_ERROR_STOP=1','--set','VERBOSITY=verbose','-U','postgres','-d','postgres'],{stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));});
 // Match the original pgTAP seed: audited timestamptz JSON hashes retain
 // their session rendering. Never disable or rewrite the audit chain.
 const input="set timezone='Asia/Seoul';\n"+sql;
 child.stdin.on('error',()=>{});if(hold)child.stdin.write(input);else child.stdin.end(input);
 const result={child,done,output:()=>stdout,completed:null};
 done.then(value=>{result.completed=value;},error=>{result.completed={code:-1,stderr:String(error)};});
 sessions.push(result);return result;
}
async function query(sql){const result=await session(sql).done;assert.equal(result.code,0,result.stderr);return result.stdout.trim();}
async function until(check,label){const deadline=Date.now()+12000;while(Date.now()<deadline){if(await check())return;await delay(25);}throw Error(`checkpoint timeout: ${label}`);}
async function held(item,marker,label){await until(()=>{
 if(item.output().includes(marker))return true;
 if(item.completed)throw Error(`fixture ended before ${label}: ${item.completed.code}; ${item.completed.stderr}`);
 return false;
},label);}
const json=stdout=>JSON.parse(stdout.split('\n').findLast(line=>line.startsWith('{')||line.startsWith('[')));

const begin=(actor,name,role='service_role')=>`begin;set local statement_timeout='15s';set local application_name='${name}';set local role ${role};select subject_director_probe.actor(${actor},'${role}');\n`;
const waiting=async name=>(await query(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event_type='Lock';`))==='1';
const decide=(actor,key,command='approve',status='approval_pending')=>`select subject_director_probe.decide(${actor},${key},'${command}','${status}');`;
const count=table=>query(`select count(*) from ${table};`);
try{
 const fixture=await readFile('supabase/tests/makeup_subject_director_authority_test.sql','utf8');
 let seed=fixture.slice(0,fixture.indexOf('select ok(not has_table_privilege'));
 assert.ok(seed.includes('create function pg_temp.decide'));
 seed=seed.replace('select no_plan();','').replaceAll('pg_temp.','subject_director_probe.').replace('begin;','begin;create schema subject_director_probe;');
 await query(seed+`grant usage on schema subject_director_probe to authenticated,service_role;grant execute on all functions in schema subject_director_probe to authenticated,service_role;commit;`);
 const beforeEvents=Number(await count('public.makeup_request_events')),beforeCalendar=Number(await count('public.academic_events')),beforeDeliveries=await count('dashboard_private.notification_deliveries');
 const first=session(begin(901,'director-approve-first')+decide(901,701)+'\\echo APPROVAL_HELD\n',true);
 await held(first,'APPROVAL_HELD','first director approval held');
 const second=session(begin(902,'director-approve-second')+decide(902,702)+'commit;');
 await until(()=>waiting('director-approve-second'),'second director waits on approval effects');
 first.child.stdin.end('commit;\n');const firstResult=await first.done;assert.equal(firstResult.code,0,firstResult.stderr);
 const secondResult=await second.done;assert.notEqual(secondResult.code,0);assert.match(secondResult.stderr,/P0001: makeup_request_stale_status/);
 assert.equal(await query(`select approved_by from public.makeup_requests where id='${id(3)}';`),id(901));
 assert.equal(Number(await count('public.makeup_request_events')),beforeEvents+1);
 const calendarsAfter=await count('public.academic_events');assert.ok(Number(calendarsAfter)>beforeCalendar);
 const repeats=await Promise.all([1,2].map(n=>query(begin(901,'director-replay-'+n)+decide(901,701)+'commit;')));
 assert.equal(repeats.length,2);assert.equal(await count('public.academic_events'),calendarsAfter);assert.equal(Number(await count('public.makeup_request_events')),beforeEvents+1);
 console.log(JSON.stringify({scenario:'two-director-approval-and-repeated-key',status:'passed',loserSqlstate:'P0001',effects:1,duplicateEvents:0,providerCalls:0}));

 const cancel=session(begin(902,'director-cancel-first','authenticated')+decide(902,703,'approval_canceled','completed')+'\\echo CANCEL_HELD\n',true);
 await held(cancel,'CANCEL_HELD','other director cancellation held');
 const cancelOther=session(begin(901,'director-cancel-second','authenticated')+decide(901,704,'approval_canceled','completed')+'commit;');
 await until(()=>waiting('director-cancel-second'),'second cancellation waits');cancel.child.stdin.end('commit;\n');const canceled=await cancel.done;assert.equal(canceled.code,0,canceled.stderr);
 const staleCancel=await cancelOther.done;assert.notEqual(staleCancel.code,0);assert.match(staleCancel.stderr,/P0001: makeup_request_stale_status/);
 assert.equal(Number(await count('public.academic_events')),beforeCalendar);assert.equal(Number(await count('public.makeup_request_events')),beforeEvents+2);
 console.log(JSON.stringify({scenario:'two-director-cancel',status:'passed',loserSqlstate:'P0001',effectReversions:1,providerCalls:0}));

 await query(`insert into dashboard_private.teacher_request_changes_v1(id,domain,request_id,requester_id,kind,note) values('${id(720)}','makeup','${id(3)}','${id(901)}','cancel_request','Synthetic closure race');`);
 const revision=await query(`select md5(to_jsonb(c)::text) from dashboard_private.teacher_request_changes_v1 c where id='${id(720)}';`);
 const resolve=(kind,key)=>`select public.resolve_teacher_request_change_v1('${id(720)}','${kind}','Synthetic director note','${revision}','${id(key)}');`;
 const close=session(begin(902,'director-close-first','authenticated')+resolve('confirmed',721)+'\\echo CLOSE_HELD\n',true);
 await held(close,'CLOSE_HELD','first close held');const closeOther=session(begin(901,'director-close-second','authenticated')+resolve('rejected',722)+'commit;');
 await until(()=>waiting('director-close-second'),'second close waits');close.child.stdin.end('commit;\n');const closed=await close.done;assert.equal(closed.code,0,closed.stderr);
 const staleClose=await closeOther.done;assert.notEqual(staleClose.code,0);assert.match(staleClose.stderr,/23514: teacher_request_stale/);
 assert.equal(await query(`select status from dashboard_private.teacher_request_changes_v1 where id='${id(720)}';`),'confirmed');
 assert.equal(await query(`select count(*) from dashboard_private.teacher_request_history_v1 where input_snapshot->>'changeId'='${id(720)}';`),'1');
 assert.equal(await query(`select status from public.makeup_requests where id='${id(3)}';`),'canceled');
 console.log(JSON.stringify({scenario:'two-director-inbox-decision',status:'passed',loserSqlstate:'23514',historyEntries:1,underlyingStateUnchanged:true}));

 const revoke=session(`begin;set local statement_timeout='15s';delete from dashboard_private.makeup_subject_directors_v1 where profile_id='${id(901)}';\\echo MEMBERSHIP_HELD\n`,true);
 await held(revoke,'MEMBERSHIP_HELD','membership revocation held');
 const replay=session(begin(901,'director-revoked-replay')+decide(901,701)+'commit;');
 await until(()=>waiting('director-revoked-replay'),'receipt replay waits on membership');revoke.child.stdin.end('commit;\n');assert.equal((await revoke.done).code,0);
 const denied=await replay.done;assert.notEqual(denied.code,0);assert.match(denied.stderr,/42501: makeup_request_transition_forbidden/);
 assert.equal(await count('dashboard_private.notification_deliveries'),beforeDeliveries);
 console.log(JSON.stringify({scenario:'membership-revoked-before-receipt',status:'passed',sqlstate:'42501',providerCalls:0}));
 const revokeInbox=session(`begin;set local statement_timeout='15s';delete from dashboard_private.makeup_subject_directors_v1 where profile_id='${id(902)}';\\echo INBOX_MEMBERSHIP_HELD\n`,true);
 await held(revokeInbox,'INBOX_MEMBERSHIP_HELD','inbox membership revocation held');
 const replayInbox=session(begin(902,'director-inbox-revoked-replay','authenticated')+resolve('confirmed',721)+'commit;');
 await until(()=>waiting('director-inbox-revoked-replay'),'inbox receipt waits on membership');
 revokeInbox.child.stdin.end('commit;\n');assert.equal((await revokeInbox.done).code,0);
 const inboxDenied=await replayInbox.done;assert.notEqual(inboxDenied.code,0);assert.match(inboxDenied.stderr,/42501: teacher_request_forbidden/);
 assert.equal(await query(`select count(*) from dashboard_private.teacher_request_history_v1 where input_snapshot->>'changeId'='${id(720)}';`),'1');
 assert.equal(await query(`select status from dashboard_private.teacher_request_changes_v1 where id='${id(720)}';`),'confirmed');
 assert.equal(await count('dashboard_private.notification_deliveries'),beforeDeliveries);
 console.log(JSON.stringify({scenario:'inbox-membership-revoked-before-receipt',status:'passed',sqlstate:'42501',duplicateHistory:0,providerCalls:0}));
 console.log(JSON.stringify({status:'passed',scenarios:5,productionCalls:0,providerCalls:0}));
}finally{for(const item of sessions)if(!item.child.stdin.writableEnded)item.child.stdin.end('rollback;\n');await Promise.all(sessions.map(item=>item.done));}
