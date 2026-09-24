// Explicit isolated socket transport only. No env URL/token lookup and no provider imports.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
const DOCKER = '/Users/hyunjun/.local/bin/docker';
const CONTAINER = 'tips_timetable_20260923';
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const json = value => quote(JSON.stringify(value)) + '::jsonb';
export function validateLocalArguments(argv) {
  assert.ok(argv.includes('--local'), 'Explicit --local required');
  const at = argv.indexOf('--container');
  assert.equal(at < 0 ? CONTAINER : argv[at + 1], CONTAINER, 'Only the approved synthetic container is accepted');
  assert.ok(argv.every((v,i) => ['--local','--container',CONTAINER,'--output'].includes(v) || argv[i-1] === '--output'), 'Unknown arguments / DB URLs are forbidden');
}
export class PsqlConnection {
  constructor(container = CONTAINER) {
    this.child = spawn(DOCKER, ['exec','-i',container,'sh','-c','exec psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=0 -v VERBOSITY=verbose 2>&1'], {stdio:['pipe','pipe','pipe']});
    this.buffer='';this.stderr='';this.pending=null;
    this.child.stdout.on('data', data => { this.buffer += data; this.drain(); });
    this.child.stderr.on('data', data => { this.stderr += data; });
    this.child.on('error',error=>this.pending?.reject(error));
    this.child.on('exit',code=>this.pending?.reject(Error(`psql exited ${code}`)));
  }
  drain() {
    const p=this.pending;if(!p)return;
    const marker=`${p.token} `, at=this.buffer.indexOf(marker);if(at<0)return;
    const end=this.buffer.indexOf('\n',at);if(end<0)return;
    const text=this.buffer.slice(0,at).trim(), code=this.buffer.slice(at+marker.length,end).trim();
    this.buffer=this.buffer.slice(end+1);this.pending=null;clearTimeout(p.timer);
    p.resolve({code:text.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] ?? code,text,stderr:text+'\n'+this.stderr.slice(p.errorStart)});
  }
  query(sql, timeoutMs = 45000) {
    assert.equal(this.pending,null,'One in-flight command per persistent connection');
    return new Promise((resolve,reject)=>{const token='done_'+randomUUID().replaceAll('-','');const timer=setTimeout(()=>{this.child.kill();reject(Error('psql command timed out'));},timeoutMs);this.pending={token,resolve,reject,timer,errorStart:this.stderr.length};this.child.stdin.write(`${sql}\n\\echo ${token} :SQLSTATE\n`);});
  }
  async ok(sql) {const r=await this.query(sql);assert.equal(r.code,'00000',r.stderr+'\n'+r.text);return r.text;}
  async value(sql) {return JSON.parse(await this.ok(sql));}
  async begin(actor, isolation='read committed') {await this.ok(`begin isolation level ${isolation}; set local statement_timeout='30s'; set local lock_timeout='20s'; ${actor ? `set local role authenticated; set local request.jwt.claim.sub=${quote(actor)}; set local request.jwt.claims=${quote(JSON.stringify({sub:actor,role:'authenticated'}))};` : ''}`);}
  close() {this.child.stdin.end('rollback;\n\\q\n');}
}
export async function verifyConcurrency(argv = process.argv.slice(2)) {
 validateLocalArguments(argv);
 const inspection=JSON.parse(execFileSync(DOCKER,['inspect',CONTAINER],{encoding:'utf8'}))[0];
 assert.equal(inspection.HostConfig.NetworkMode,'none');assert.deepEqual(inspection.NetworkSettings.Ports,{});assert.equal(inspection.State.Running,true);
 const a=new PsqlConnection(), b=new PsqlConnection(), observer=new PsqlConnection();
 const ids=Object.fromEntries(['admin','editor','teacher1','teacher2','room1','room2','legacy1','legacy2','generator','makeupClass','original','request','plan','target','item1','item2','slot1','slot2','generationSlot'].map(k=>[k,randomUUID()]));
 const prefix='task8-'+randomUUID().slice(0,8), teacher=n=>`${prefix}-teacher${n}`, room=n=>`${prefix}-room${n}`;
 const report={run:prefix,container:CONTAINER,transport:'network-none Docker Unix socket',ids,races:[],checks:[]};
 const rpc=(name,args)=>`select public.${name}(${Object.entries(args).map(([k,v])=>`${k}=>${v}`).join(',')})::text;`;
 const read=()=>observer.value(`select public.get_timetable_plan_v1(${quote(ids.plan)})::text;`);
 const gateway=(id,patch)=>rpc('update_class_operational_v1',{p_class_id:quote(id),p_patch:json(patch),p_request_key:quote(randomUUID())});
 const planCommand=async(itemId,name,slots)=>{const s=await read();return {operation:'save',planId:ids.plan,expectedMetaRevision:s.plan.metaRevision,expectedItemRevision:s.items.find(i=>i.id===itemId)?.revision??null,expectedShadowFingerprint:s.shadowFingerprint,requestKey:randomUUID(),item:{id:itemId,planId:ids.plan,name,subject:'영어',subjectAreaKey:null,grade:'중2',capacity:12,tuition:100000,defaultTeacherId:ids.teacher1,defaultClassroomId:ids.room1,durationMinutes:30,pendingSlots:[]},slots};};
 const planSql=command=>rpc('mutate_timetable_plan_item_v1',{p_command:json(command)});
 const placement=(itemId,slotId)=>[{id:slotId,itemId,planId:ids.plan,weekday:1,startMinute:1020,endMinute:1050,teacherId:ids.teacher1,classroomId:ids.room1,sourceSlotId:null}];
 const pids=await Promise.all([a.value('select pg_backend_pid();'),b.value('select pg_backend_pid();')]);assert.notEqual(...pids);report.backendPids=pids;
 async function race(name,first,second,expected='23P01',actors=[ids.admin,ids.admin]) {
  await a.begin(actors[0]);await b.begin(actors[1]);
  const initial=await a.query(first);assert.equal(initial.code,'00000',initial.stderr);
  let completed=false;const waiting=b.query(second).then(r=>{completed=true;return r;});
  let evidence;const deadline=Date.now()+10000;
  while(Date.now()<deadline&&!completed){const r=await observer.value(`select coalesce((select jsonb_build_object('pid',pid,'waitEventType',wait_event_type,'waitEvent',wait_event,'blockingPids',pg_blocking_pids(pid),'advisoryWaiting',(select count(*) from pg_locks where pid=${pids[1]} and locktype='advisory' and not granted),'query',query) from pg_stat_activity where pid=${pids[1]}),'{}')::text;`);if(r.waitEvent==='advisory'&&r.blockingPids.includes(pids[0])&&r.advisoryWaiting>0){evidence=r;break;}await delay(10);}
  assert.ok(evidence,`${name}: contender must actually block on the first backend's advisory lock`);
  await a.ok('commit;');const outcome=await waiting;await b.ok(outcome.code==='00000'?'commit;':'rollback;');
  assert.equal(outcome.code,expected,`${name}: ${outcome.stderr}`);
  const row={name,actors,barrier:'first writer owns transaction lock; second observed waiting before release',...evidence,firstCode:initial.code,secondCode:outcome.code,error:outcome.code==='00000'?null:outcome.stderr};report.races.push(row);console.log(JSON.stringify(row));return outcome;
 }
 async function resetOperating(){await observer.ok(`begin; select set_config('app.class_close_mutation','v1',true); update public.classes set status='개강 준비' where id in (${quote(ids.legacy1)},${quote(ids.legacy2)}); commit;`);}
 try {
  await observer.ok(`begin;
  insert into auth.users(id,instance_id,aud,role,email) values(${quote(ids.admin)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${quote(prefix+'-admin@test.invalid')}),(${quote(ids.editor)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${quote(prefix+'-editor@test.invalid')});
  insert into public.profiles(id,role,name) values(${quote(ids.admin)},'admin',${quote(prefix+' admin')}),(${quote(ids.editor)},'teacher',${quote(prefix+' editor')}) on conflict(id) do update set role=excluded.role;
  delete from public.teacher_catalogs where profile_id in (${quote(ids.editor)},${quote(ids.admin)});
  insert into public.teacher_catalogs(id,name,subjects) values(${quote(ids.teacher1)},${quote(teacher(1))},array['영어']),(${quote(ids.teacher2)},${quote(teacher(2))},array['영어']);
  update public.teacher_catalogs set profile_id=${quote(ids.editor)} where id=${quote(ids.teacher1)}; update public.profiles set teacher_catalog_id=${quote(ids.teacher1)} where id=${quote(ids.editor)};
  update public.teacher_catalogs set profile_id=${quote(ids.admin)} where id=${quote(ids.teacher2)};
  insert into public.classroom_catalogs(id,name,subjects) values(${quote(ids.room1)},${quote(room(1))},array['영어']),(${quote(ids.room2)},${quote(room(2))},array['영어']);
  insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan) values
  (${quote(ids.legacy1)},${quote(prefix+' legacy1')},'영어','개강 준비','legacy','월 17:00-17:30',${quote(teacher(1))},${quote(room(1))},'{}'),
  (${quote(ids.legacy2)},${quote(prefix+' legacy2')},'영어','개강 준비','legacy','월 17:00-17:30',${quote(teacher(1))},${quote(room(2))},'{}'),
  (${quote(ids.generator)},${quote(prefix+' generator')},'영어','개강 준비','normalized','','','','{}'),
  (${quote(ids.makeupClass)},${quote(prefix+' makeup')},'영어','개강 준비','normalized','',${quote(teacher(1))},${quote(room(2))},'{}');
  select set_config('app.class_schedule_mutation','release2-rpc',true);
  insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_catalog_id,classroom_catalog_id) values(${quote(ids.generationSlot)},${quote(ids.generator)},1,'17:00','17:30',${quote(ids.teacher1)},${quote(ids.room1)});
  insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,origin) values(${quote(ids.original)},${quote(ids.makeupClass)},'task8-original','2026-10-13','active','12:00','12:30',${quote(ids.teacher1)},${quote(ids.room2)},'manual');
  insert into public.makeup_requests(id,status,subject,approval_group,requester_id,class_id,class_name,request_kind,original_lesson_session_id,original_lesson_session_revision,makeup_slots) values(${quote(ids.request)},'approval_pending','영어','english',${quote(ids.admin)},${quote(ids.makeupClass)},${quote(prefix+' makeup')},'makeup_only',${quote(ids.original)},0,${json([{startAt:'2026-10-12T17:00:00+09:00',endAt:'2026-10-12T17:30:00+09:00',classroom:room(1)}])});
  update public.makeup_requests set teacher_catalog_id=${quote(ids.teacher1)},teacher_profile_id=${quote(ids.editor)},approver_teacher_catalog_id=${quote(ids.teacher2)},approver_profile_id=${quote(ids.admin)} where id=${quote(ids.request)};
  insert into public.timetable_plans(id,name,created_by) values(${quote(ids.plan)},${quote(prefix+' plan')},${quote(ids.admin)}),(${quote(ids.target)},${quote(prefix+' target')},${quote(ids.admin)});
  commit; set request.jwt.claim.sub=${quote(ids.admin)};`);
  await race('same teacher / distinct room',gateway(ids.legacy1,{status:'수강'}),gateway(ids.legacy2,{status:'수강'}));await resetOperating();
  await observer.ok(`update public.classes set teacher=${quote(teacher(2))},room=${quote(room(1))} where id=${quote(ids.legacy2)};`);
  await race('same room / distinct teacher',gateway(ids.legacy2,{status:'수강'}),gateway(ids.legacy1,{status:'수강'}));await resetOperating();
  await observer.ok(`insert into public.timetable_plan_members(plan_id,user_id,access) values(${quote(ids.plan)},${quote(ids.editor)},'editor');`);
  const one=await planCommand(ids.item1,'first',[]),two=await planCommand(ids.item2,'second',[]);
  await race('editors different items retained',planSql(one),planSql(two),'00000',[ids.admin,ids.editor]);assert.equal((await read()).items.length,2);
  const old=await planCommand(ids.item1,'winner',[]);await race('editors same item stale loser',planSql(old),planSql({...old,requestKey:randomUUID(),item:{...old.item,name:'loser'}}),'P0001',[ids.admin,ids.editor]);assert.equal((await read()).items.find(i=>i.id===ids.item1).name,'winner');
  // Receipt replay before version checks, but after current authorization.
  await b.begin(ids.admin);const replayB=JSON.parse(await b.ok(planSql(old)));await b.ok('commit;');assert.deepEqual(replayB,JSON.parse(await a.ok(`begin; set local role authenticated; set local request.jwt.claim.sub=${quote(ids.admin)}; ${planSql(old)}`)));await a.ok('commit;');report.checks.push('identical request replay returned immutable receipt');
  await observer.ok(`insert into public.timetable_plan_members(plan_id,user_id,access) values(${quote(ids.plan)},${quote(ids.editor)},'editor') on conflict(plan_id,user_id) do nothing;`);
  const editorCommand=await planCommand(ids.item2,'editor receipt',[]);await b.begin(ids.editor);await b.ok(planSql(editorCommand));await b.ok('commit;');await observer.ok(`delete from public.timetable_plan_members where plan_id=${quote(ids.plan)} and user_id=${quote(ids.editor)};`);
  await b.begin(ids.editor);const revoked=await b.query(planSql(editorCommand));assert.equal(revoked.code,'42501');await b.ok('rollback;');report.checks.push('current share revocation rejects existing receipt replay');
  const draft=await planCommand(ids.item1,'operating race',placement(ids.item1,ids.slot1));
  await race('operating first rejects old-shadow draft',gateway(ids.legacy1,{status:'수강'}),planSql(draft),'P0001');
  const refreshed=await planCommand(ids.item1,'operating race',placement(ids.item1,ids.slot1));await b.begin(ids.admin);assert.equal((await b.query(planSql(refreshed))).code,'23P01');await b.ok('rollback;');await resetOperating();
  const draftFirst=await planCommand(ids.item1,'draft first',placement(ids.item1,ids.slot1));await race('draft first does not reserve operating',planSql(draftFirst),gateway(ids.legacy1,{status:'수강'}),'00000');
  const conflictSnapshot=await read();assert.ok(conflictSnapshot.slots.some(s=>s.id===ids.slot1));assert.ok(conflictSnapshot.shadowSlots.some(s=>s.classId===ids.legacy1));report.conflictSnapshot=conflictSnapshot;await resetOperating();
  // New planner promotion and legacy management use the same actual lock.
  const transfer={source:{kind:'plan',planId:ids.plan},target:{kind:'operational'},mode:'copy',onConflict:'reject',itemIds:[ids.item1]};
  const preview=await observer.value(rpc('preview_timetable_plan_transfer_v1',{p_request:json(transfer)}));
  await race('planner promotion first / management loser',rpc('commit_timetable_plan_transfer_v1',{p_command:json({request:transfer,previewFingerprint:preview.fingerprint,requestKey:randomUUID()})}),gateway(ids.legacy1,{status:'수강'}));
  const promoted=await observer.value(`select jsonb_build_array(applied_class_id)::text from public.timetable_plan_items where id=${quote(ids.item1)};`);assert.equal(promoted.length,1);ids.promoted=promoted[0];
  await observer.ok(`begin;select set_config('app.class_close_mutation','v1',true);update public.classes set status='종강' where id=${quote(ids.promoted)};commit;`);
  const next=await planCommand(ids.item2,'management wins',placement(ids.item2,ids.slot2));await observer.ok(planSql(next));const request2={...transfer,itemIds:[ids.item2]};const preview2=await observer.value(rpc('preview_timetable_plan_transfer_v1',{p_request:json(request2)}));
  await race('management first / planner stale loser',gateway(ids.legacy1,{status:'수강'}),rpc('commit_timetable_plan_transfer_v1',{p_command:json({request:request2,previewFingerprint:preview2.fingerprint,requestKey:randomUUID()})}),'P0001');await resetOperating();
  const generate=()=>rpc('generate_class_lesson_sessions_v1',{p_class_id:quote(ids.generator),p_expected_schedule_revision:'0',p_date_from:quote('2026-10-12'),p_date_to:quote('2026-10-12'),p_request_key:quote(randomUUID())});
  const makeup=()=>`reset role; set local request.jwt.claim.role='service_role'; set local request.jwt.claims=${quote(JSON.stringify({sub:ids.admin,role:'service_role'}))}; ${rpc('transition_makeup_request_v2',{p_makeup_request_id:quote(ids.request),p_command:quote('approve'),p_patch:json({actor_profile_id:ids.admin,schedule_plan_before:{},schedule_plan_after:{},makeup_academic_event_ids:[],calendar_events:[]}),p_expected_status:quote('approval_pending'),p_request_id:quote(randomUUID())})}`;
  // Real public server approval path; no fixture mutation GUC is injected.
  await race('session generate first / makeup save loser',generate(),makeup());
  await observer.ok(`begin; select set_config('app.class_schedule_mutation','release2-rpc',true); delete from public.class_lesson_sessions where class_id=${quote(ids.generator)}; commit;`);
  await race('makeup save first / session generate loser',makeup(),generate());
  await observer.ok(`begin; select set_config('app.class_schedule_mutation','release2-rpc',true); delete from public.class_lesson_sessions where class_id in (${quote(ids.generator)},${quote(ids.makeupClass)}); commit;`);
  // RR pins a snapshot BEFORE the competing RC commit. Guard, not SET TRANSACTION, rejects both paths.
  await b.begin(ids.admin,'repeatable read');await b.ok(`select count(*) from public.classes where id=${quote(ids.legacy1)};`);
  await a.begin(ids.admin);await a.ok(gateway(ids.legacy1,{status:'수강'}));await a.ok('commit;');
  const rr=await b.query(gateway(ids.legacy2,{status:'수강'}));assert.equal(rr.code,'25001');assert.match(rr.stderr,/timetable_isolation_not_supported/);await b.ok('rollback;');
  await b.begin(null,'repeatable read');await b.ok('select count(*) from public.classes;');const direct=await b.query(`update public.classes set status='수강' where id=${quote(ids.legacy2)};`);assert.equal(direct.code,'25001');assert.match(direct.stderr,/timetable_isolation_not_supported/);await b.ok('rollback;');report.checks.push('snapshot-pinned RR public/direct writes return 25001/timetable_isolation_not_supported');
  // Real PostgreSQL MVCC collision remains 40001, on a scoped non-timetable row.
  await b.begin(null,'repeatable read');await b.ok(`select name from public.profiles where id=${quote(ids.admin)};`);await a.ok(`update public.profiles set name=${quote(prefix+' RC')} where id=${quote(ids.admin)};`);const serialization=await b.query(`update public.profiles set name='RR rejected' where id=${quote(ids.admin)};`);assert.equal(serialization.code,'40001');assert.match(serialization.stderr,/could not serialize access/);await b.ok('rollback;');report.serialization=serialization;
  const overlap=await observer.value(`with s as(select x from jsonb_array_elements(dashboard_private.read_timetable_operating_reference_v1()->'shadowSlots') x where x->>'classId' in (${quote(ids.legacy1)},${quote(ids.legacy2)},${quote(ids.promoted)})) select count(*)::int from s a join s b on a.x->>'id'<b.x->>'id' where dashboard_private.timetable_intersects_v1(a.x,b.x);`);assert.equal(overlap,0);report.finalWeeklyOverlaps=overlap;
  assert.equal(await observer.value(`select count(*)::int from public.classes where id=${quote(ids.legacy2)} and status='수강';`),0);
  report.passed=true;
 } finally {
  await Promise.allSettled([a.ok('rollback;'),b.ok('rollback;')]);
  try {await observer.ok(`begin; select set_config('app.class_close_mutation','v1',true); select set_config('app.class_schedule_mutation','release2-rpc',true); delete from public.class_lesson_sessions where class_id in (${quote(ids.generator)},${quote(ids.makeupClass)}); update public.classes set status='종강' where id in (${[ids.legacy1,ids.legacy2,ids.generator,ids.makeupClass,ids.promoted].filter(Boolean).map(quote)}); update public.timetable_plans set state='archived' where id in (${quote(ids.plan)},${quote(ids.target)}); commit;`);report.cleanup='only run-owned plans archived; classes closed and dated fixture sessions removed; IDs retained for audit';}catch(error){report.cleanupError=String(error);report.passed=false;process.exitCode=1;}
  const at=argv.indexOf('--output');if(at>=0)await writeFile(argv[at+1],JSON.stringify(report,null,2)+'\n');
  a.close();b.close();observer.close();
 }
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await verifyConcurrency();
