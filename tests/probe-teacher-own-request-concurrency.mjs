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
const id=n=>`e7270000-0000-4000-8000-${String(n).padStart(12,'0')}`;
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
const begin=(actor,name)=>`begin;set local statement_timeout='15s';set local application_name='${name}';set local role authenticated;select set_config('request.jwt.claim.sub','${id(actor)}',true);\n`;
// Fixture preparation is scoped to this disposable DB and captured synthetic
// IDs. Actual authorization/API calls always use begin() and authenticated.
// No grants, RLS settings, or triggers are disabled by the probe.
const beginFixture=(actor,name)=>`begin;set local statement_timeout='15s';set local application_name='${name}';select set_config('request.jwt.claim.sub','${id(actor)}',true);\n`;
let managerKey=1000;
async function managerCommand(requestId,input){
 const updatedAt=await query(`select updated_at from public.ops_tasks where id='${requestId}';`);
 return `select public.update_ops_task_v2('${requestId}',${sqlLiteral(JSON.stringify(input))}::jsonb,${sqlLiteral(updatedAt)}::timestamptz,'${id(++managerKey)}');`;
}
const read=(domain,requestId)=>`select public.get_teacher_own_request_v1('${domain}','${requestId}');`;
const mutation=(domain,row,action,input,key)=>`select public.mutate_teacher_own_request_v1('${domain}','${row.id}','${action}',${sqlLiteral(JSON.stringify(input))}::jsonb,${sqlLiteral(row.revision)},'${id(key)}');\n`;
const waiting=async name=>(await query(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event_type='Lock';`))==='1';
let captures;
try{
 const fixture=await readFile('supabase/tests/teacher_own_request_workflow_test.sql','utf8');
 // Stop before independent rolled-back historical-routing tests.
 const fixtureEnd=fixture.indexOf('create function pg_temp.prior_makeup_input(');assert.ok(fixtureEnd>0);
 const bootstrap=fixture.slice(0,fixtureEnd).replace('begin;', 'begin; create extension if not exists pgtap with schema extensions; set local search_path=public,extensions;');
 const output=await query(bootstrap+`select pg_temp.own_actor(3);set local role authenticated;
 select jsonb_agg(jsonb_build_object('domain',domain,'input',input,'detail',payload,
  'page',public.get_teacher_own_requests_v1(domain,1,10),
  'referenceClassId',reference_class_id,'referenceMonth',reference_month,
  'refs',public.get_teacher_request_references_v1(domain,reference_class_id,reference_month),
  'unselectedRefs',public.get_teacher_request_references_v1(domain,null,'')) order by name)
 from(select *,case when domain='transfer' then (input->>'from_class_id')::uuid
   when domain in('withdrawal','makeup') then (input->>'class_id')::uuid else null end reference_class_id,
   case when domain='makeup' then '2026-11' else '' end reference_month from own_results) selected;
 reset role;commit;`);
 assert.doesNotMatch(output,/(?:^|\n)not ok \d+/);captures=json(output);assert.equal(captures.length,5);
 // Diagnose only this synthetic profile, returning booleans rather than
 // audit contents/hashes. UTC reproduces the rendering mismatch; matching
 // the seed zone must preserve the chain without changing its validation.
 assert.ok(fixture.includes("set local timezone='Asia/Seoul';"));
 const auditMatch=`select jsonb_build_object('timezone',current_setting('TimeZone'),'matchesStoredHash',
  (select l.after_hash=encode(extensions.digest(to_jsonb(p)::text,'sha256'),'hex')
   from public.profiles p join lateral(
    select after_hash from public.dashboard_audit_logs where entity_table='profiles' and entity_id=p.id::text
     and record_format in('full_v2','diff_v2') order by event_sequence desc limit 1
   )l on true where p.id='${id(3)}'));`;
 const utcAudit=json(await query("begin;set local timezone='UTC';"+auditMatch+'rollback;'));
 const seedAudit=json(await query(auditMatch));
 assert.deepEqual(utcAudit,{timezone:'UTC',matchesStoredHash:false});
 assert.deepEqual(seedAudit,{timezone:'Asia/Seoul',matchesStoredHash:true});
 const auditCount=()=>query(`select count(*) from public.dashboard_audit_logs where entity_table='profiles' and entity_id='${id(3)}';`);
 const beforeAuditCount=await auditCount();
 const preflight=await query(begin(1,'teacher-admin-revoke-preflight')+
  `update public.profiles set role='assistant' where id='${id(3)}';select role from public.profiles where id='${id(3)}';rollback;`);
 assert.equal(preflight.split('\n').at(-1),'assistant');
 assert.equal(await query(`select role from public.profiles where id='${id(3)}';`),'teacher');
 assert.equal(await auditCount(),beforeAuditCount);
 console.log(JSON.stringify({checkpoint:'audit-fixture-preflight',utcHashMatches:false,seedZoneHashMatches:true,adminUpdateRollback:true,committedProfileChanges:0}));
 const transfer=captures.find(item=>item.domain==='transfer').detail;
 const book=captures.find(item=>item.domain==='textbook').detail;
 const deliveriesBefore=await query('select count(*) from dashboard_private.notification_deliveries;');
 for(const domain of ['transfer','makeup']){
  const frame=captures.find(item=>item.domain===domain),table=domain==='makeup'?'makeup_requests':'ops_tasks';
  const field=domain==='transfer'?'student_id':'class_id';
  const original=domain==='transfer'?frame.input.student_id:frame.input.class_id;
  if(domain==='transfer') await query(begin(2,`teacher-null-reference-${domain}`)+(await managerCommand(frame.detail.id,{task:{student_id:null}}))+'commit;');
  else await query(beginFixture(2,`teacher-null-reference-${domain}`)+`update public.${table} set ${field}=null where id='${frame.detail.id}';commit;`);
  frame.nullReferenceDetail=json(await query(begin(3,`teacher-null-read-${domain}`)+read(domain,frame.detail.id)+'commit;'));
  assert.equal(frame.nullReferenceDetail.input,null);
  assert.deepEqual(frame.nullReferenceDetail.allowedActions,['change_request','cancel_request']);
  if(domain==='transfer') await query(begin(2,`teacher-restore-reference-${domain}`)+(await managerCommand(frame.detail.id,{task:{student_id:original}}))+'commit;');
  else await query(beginFixture(2,`teacher-restore-reference-${domain}`)+`update public.${table} set ${field}='${original}' where id='${frame.detail.id}';commit;`);
 }

 // Causal regression fixture: the sole instrumentation is an identity gate
 // in the source-ID projection. It pauses after ownership filtering but before
 // the outer statement returns. Old and fixed bodies get the identical gate.
 // Exact prior bytes are verified; production functions are never replaced.
 const migration=await readFile('supabase/migrations/20261027005334_teacher_own_request_workflow.sql','utf8');
 const start=migration.indexOf('create function public.get_teacher_own_requests_v1('),end=migration.indexOf('\nend $$;',start)+9;
 const fixed=migration.slice(start,end);
 const priorBlock=` with source as(
  select id,created_at from public.ops_tasks where p_domain in('transfer','withdrawal') and type=p_domain and requested_by=a
  union all select id,created_at from public.makeup_requests where p_domain='makeup' and requester_id=a
  union all select id,created_at from public.textbook_purchase_orders where p_domain='textbook' and created_by=a
 ),page as(select id from source order by created_at desc,id desc limit p_page_size offset((p_page-1)*p_page_size))
 select(select count(*) from source),(select coalesce(array_agg(id),'{}') from page) into total,ids;
 select coalesce(jsonb_agg(dashboard_private.teacher_request_state_v1(p_domain,id)-array['input','history','changes'] order by ord),'[]')
 into rows from unnest(ids) with ordinality a(id,ord);
`;
 const old=fixed.replace('total bigint;rows jsonb;','total bigint;rows jsonb;ids uuid[];').replace(/ -- The owner filter[\s\S]*?(?= return jsonb_build_object)/,priorBlock);
 assert.equal(createHash('sha256').update(old).digest('hex'),'c58167e6a44510ed750dbc0bbc7b0751472d75d6cc70c47e7c39c55575d67d82','diagnostic old function is the exact reviewed pre-fix body');
 await query(`create function dashboard_private.teacher_request_probe_identity(i uuid) returns uuid language plpgsql volatile as $$begin perform pg_advisory_xact_lock(727001);return i;end$$;`);
 for(const [name,definition] of [['old',old],['fixed',fixed]]){
  await query(definition.replace('public.get_teacher_own_requests_v1(',`public.teacher_request_probe_${name}(`).replace('select id,created_at from public.ops_tasks','select dashboard_private.teacher_request_probe_identity(id) as id,created_at from public.ops_tasks'));
  const gate=session("begin;set local statement_timeout='15s';select pg_advisory_xact_lock(727001);\\echo SNAPSHOT_HELD\n",true);
  await held(gate,'SNAPSHOT_HELD','identity gate held');
  const list=session(begin(3,`teacher-list-${name}`)+`select public.teacher_request_probe_${name}('transfer',1,10);commit;`);
  await until(()=>waiting(`teacher-list-${name}`),'owner filter reaches identical identity gate');
  await query(begin(1,'teacher-owner-reassign')+(await managerCommand(transfer.id,{task:{requested_by:id(4),title:'FOREIGN_NEW_OWNER_CANARY'}}))+'commit;');
  gate.child.stdin.end('commit;\n');assert.equal((await gate.done).code,0);
  const listed=await list.done;assert.equal(listed.code,0,listed.stderr);const snapshot=json(listed.stdout);
  assert.equal(snapshot.totalCount,1);assert.equal(snapshot.rows.length,1);
  assert.equal(snapshot.rows[0].requesterId,id(name==='old'?4:3));
  assert.equal(snapshot.rows[0].title==='FOREIGN_NEW_OWNER_CANARY',name==='old');
  const fresh=json(await query(begin(3,'teacher-list-after')+"select public.get_teacher_own_requests_v1('transfer',1,10);commit;"));assert.equal(fresh.totalCount,0);assert.deepEqual(fresh.rows,[]);
  const foreign=json(await query(begin(4,'teacher-new-owner')+"select public.get_teacher_own_requests_v1('transfer',1,10);commit;"));assert.equal(foreign.rows[0].requesterId,id(4));assert.equal(foreign.rows[0].title,'FOREIGN_NEW_OWNER_CANARY');
  await query(begin(1,'teacher-owner-restore')+(await managerCommand(transfer.id,{task:{requested_by:id(3),title:transfer.title}}))+'commit;');
 }
 const currentTransfer=json(await query(begin(3,'teacher-current-transfer')+read('transfer',transfer.id)+'commit;'));

 // Management commits a real processing flag while the teacher edit is waiting.
 const processing=session(begin(2,'teacher-processing-first')+(await managerCommand(transfer.id,{transfer:{fee_processed:true}}))+`\\echo PROCESSING_HELD\n`,true);
 await held(processing,'PROCESSING_HELD','manager processing holds parent');
 const edit=session(begin(3,'teacher-stale-edit')+mutation('transfer',currentTransfer,'update',{...currentTransfer.input,memo:'MUST_NOT_COMMIT'},211)+'commit;');
 await until(()=>waiting('teacher-stale-edit'),'teacher edit waits for processing');processing.child.stdin.end('commit;\n');assert.equal((await processing.done).code,0);
 const edited=await edit.done;assert.notEqual(edited.code,0);assert.match(edited.stderr,/23514: teacher_request_stale/);
 const afterProcessing=json(await query(begin(3,'teacher-after-processing')+read('transfer',transfer.id)+'commit;'));assert.notEqual(afterProcessing.input.memo,'MUST_NOT_COMMIT');assert.equal(afterProcessing.effectState,'observed');assert.ok(!afterProcessing.allowedActions.includes('update'));

 // A concurrent child insertion must conflict with the parent's FOR UPDATE,
 // then participate in CAS; it cannot be omitted from the teacher's snapshot.
 const child=session(beginFixture(2,'teacher-child-first')+`insert into public.textbook_purchase_order_lines(purchase_order_id,requested_textbook_title,requested_quantity,copy_scope,memo) values('${book.id}','가상 추가 행',1,'student','가상 추가 메모');\\echo CHILD_HELD\n`,true);
 await held(child,'CHILD_HELD','child FK parent key-share held');
 const withdraw=session(begin(3,'teacher-child-race')+mutation('textbook',book,'withdraw',{note:'가상 철회'},212)+'commit;');
 await until(()=>waiting('teacher-child-race'),'teacher withdraw waits for new child');child.child.stdin.end('commit;\n');assert.equal((await child.done).code,0);
 const withdrawn=await withdraw.done;assert.notEqual(withdrawn.code,0);assert.match(withdrawn.stderr,/23514: teacher_request_stale/);
 assert.equal(await query(`select status from public.textbook_purchase_orders where id='${book.id}';`),'requested');
 assert.equal(await query(`select count(*) from public.textbook_purchase_order_lines where purchase_order_id='${book.id}';`),'3');

 // Exercise the real pre-approval withdrawal and existing management reader.
 const makeupFrame=captures.find(item=>item.domain==='makeup');
 const currentMakeup=json(await query(begin(3,'teacher-makeup-before-withdraw')+read('makeup',makeupFrame.detail.id)+'commit;'));
 await query(begin(3,'teacher-makeup-withdraw')+mutation('makeup',currentMakeup,'withdraw',{note:'가상 본인 철회 검색 확인'},214)+'commit;');
 const closedFilter={view:'closed',subject:'all',teacher:'all',period:'all',dateFrom:'',dateTo:'',filterColumn:'canceledNote',search:'가상 본인 철회 검색 확인',sortColumn:null,sortDirection:null};
 makeupFrame.withdrawnManagerPage=json(await query(begin(2,'teacher-makeup-management-search')+`select public.list_makeup_numbered_page_v1(${sqlLiteral(JSON.stringify(closedFilter))}::jsonb,1,10);commit;`));
 assert.equal(makeupFrame.withdrawnManagerPage.totalCount,1);
 assert.equal(makeupFrame.withdrawnManagerPage.rows[0].id,makeupFrame.detail.id);

 // Cross-version same-key race: the legacy producer owns its receipt lock
 // before the new command starts. Preserve the exact prior command as a
 // separately named diagnostic function; no production function is replaced.
 const mutateStart=migration.indexOf('create function public.mutate_teacher_own_request_v1(');
 const mutateEnd=migration.indexOf('\nend $$;',mutateStart)+9;
 const legacyGuard=` -- Serialize the legacy textbook receipt check with its existing producer.
 -- Otherwise an uncommitted legacy submission can pass this check, then be
 -- replayed inside submit_teacher_textbook_request_v1 as a falsely safe origin.
 if p_domain='textbook' and p_action='create' then
  perform pg_advisory_xact_lock(hashtextextended('notification-request:'||p_request_id::text,0));
 end if;
`;
 const previousMutate=migration.slice(mutateStart,mutateEnd).replace(legacyGuard,'');
 assert.equal(createHash('sha256').update(previousMutate).digest('hex'),'922eecdf5f1083de7cdcb93c218d3e07f533e629c1df45106c9df78176418950');
 await query(previousMutate.replace('public.mutate_teacher_own_request_v1(', 'public.teacher_request_probe_old_mutate('));
 const bookInput=captures.find(item=>item.domain==='textbook').input;
 for(const [version,key] of [['old',901],['fixed',902]]){
  const beforeOrders=Number(await query('select count(*) from public.textbook_purchase_orders;'));
  const legacy=session(begin(3,`teacher-legacy-first-${version}`)+`select public.submit_teacher_textbook_request_v1('${id(key)}',${sqlLiteral(JSON.stringify(bookInput))}::jsonb);\\echo LEGACY_RECEIPT_HELD\n`,true);
  await held(legacy,'LEGACY_RECEIPT_HELD','legacy producer has uncommitted receipt');
  const legacyOrder=json(legacy.output()).orderId;assert.ok(legacyOrder);
  const entry=version==='old'?'public.teacher_request_probe_old_mutate':'public.mutate_teacher_own_request_v1';
  const current=session(begin(3,`teacher-cross-version-${version}`)+`select ${entry}('textbook',null,'create',${sqlLiteral(JSON.stringify(bookInput))}::jsonb,null,'${id(key)}');commit;`);
  await until(()=>waiting(`teacher-cross-version-${version}`),'current command waits on legacy receipt identity');
  legacy.child.stdin.end('commit;\n');assert.equal((await legacy.done).code,0);
  const currentResult=await current.done;
  if(version==='old'){
   assert.equal(currentResult.code,0,currentResult.stderr);assert.equal(json(currentResult.stdout).id,legacyOrder);
  }else{
   assert.notEqual(currentResult.code,0);assert.match(currentResult.stderr,/22023: idempotency_key_reused/);
  }
  assert.equal(Number(await query('select count(*) from public.textbook_purchase_orders;')),beforeOrders+1);
  assert.equal(await query(`select count(*) from dashboard_private.teacher_request_origins_v1 where domain='textbook' and request_id='${legacyOrder}';`),version==='old'?'1':'0');
  assert.equal(await query(`select count(*) from dashboard_private.teacher_request_receipts_v1 where request_key='${id(key)}';`),version==='old'?'1':'0');
  assert.equal(await query('select count(*) from dashboard_private.notification_deliveries;'),deliveriesBefore);
 }

 // Idempotent receipt replay cannot bypass a role revocation that wins first.
 // Use the existing admin-other-profile update policy and role-change guard.
 // A missing actor in a fixture is not evidence of production revocation.
 const revoke=session(begin(1,'teacher-admin-revoke')+`update public.profiles set role='assistant' where id='${id(3)}';\\echo ROLE_HELD\n`,true);
 await held(revoke,'ROLE_HELD','role revocation held');
 const replay=session(begin(3,'teacher-revoked-replay')+`select public.mutate_teacher_own_request_v1('textbook',null,'create',${sqlLiteral(JSON.stringify(captures.find(item=>item.domain==='textbook').input))}::jsonb,null,'${id(104)}');commit;`);
 await until(()=>waiting('teacher-revoked-replay'),'replay waits for current actor');revoke.child.stdin.end('commit;\n');assert.equal((await revoke.done).code,0);
 const replayed=await replay.done;assert.notEqual(replayed.code,0);assert.match(replayed.stderr,/42501: teacher_request_forbidden/);
 assert.equal(await query('select count(*) from dashboard_private.notification_deliveries;'),deliveriesBefore);
 console.log('TEACHER_OWN_CAPTURE:'+JSON.stringify(captures));
 console.log(JSON.stringify({status:'passed',scenarios:5,ownershipSnapshotCoherent:true,processingConflictSqlstate:'23514',childSetConflictSqlstate:'23514',legacyReceiptConflictSqlstate:'22023',legacyOriginRaceOldFailsNewPasses:true,revokedReplaySqlstate:'42501',providerCalls:0,producerPayloads:captures.length}));
}finally{for(const item of sessions)if(!item.child.stdin.writableEnded)item.child.stdin.end('rollback;\n');await Promise.all(sessions.map(item=>item.done));}
