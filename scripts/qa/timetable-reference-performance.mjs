import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {writeFile,readFile,readdir} from 'node:fs/promises';
import {PsqlConnection,validateLocalArguments} from '../verify-timetable-concurrency.mjs';
validateLocalArguments(process.argv.slice(2));const db=new PsqlConnection();const prefix=randomUUID().slice(0,8),id=n=>`${prefix}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const report={mode:'PostgreSQL17 network-none Docker socket; timings include psql IPC',classCount:200,historyWeeks:13,datedSessions:7800,measurements:[]};
try{
 await db.ok(`begin; set local statement_timeout='35s'; insert into auth.users(id,instance_id,aud,role,email) values('${id(1)}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${prefix}@test.invalid');insert into public.profiles(id,role,name) values('${id(1)}','admin','reference performance') on conflict(id) do update set role='admin';set local request.jwt.claim.sub='${id(1)}';
 create function pg_temp.pid(n int) returns uuid language sql immutable as $$select ('${prefix}-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
 insert into public.teacher_catalogs(id,name,subjects) select pg_temp.pid(100+n),'${prefix}-t'||n,array['영어'] from generate_series(0,19)n;
 insert into public.classroom_catalogs(id,name,subjects) select pg_temp.pid(200+n),'${prefix}-r'||n,array['영어'] from generate_series(0,19)n;
 select set_config('app.class_close_mutation','v1',true);
 insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule_plan) select pg_temp.pid(1000+n),'${prefix}-class'||n,'영어',case when n<100 then '종강' else '개강 준비' end,'normalized','{}' from generate_series(0,199)n;
 insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,schedule_plan) values(pg_temp.pid(1200),'guard performance','영어','수강','legacy','월 21:00-21:30','${prefix}-t0','${prefix}-r0','{}');
 insert into public.timetable_plans(id,name,created_by) values(pg_temp.pid(2),'reference performance',pg_temp.pid(1));
 select set_config('app.class_schedule_mutation','release2-rpc',true);
 insert into public.class_lesson_sessions(class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,origin)
 select pg_temp.pid(1000+n),'history-'||w||'-'||d,date '2025-01-06'+w*7+d,'active',time '08:00'+(n/20)*interval '30 minutes',time '08:30'+(n/20)*interval '30 minutes',pg_temp.pid(100+n%20),pg_temp.pid(200+n%20),'manual' from generate_series(0,199)n cross join generate_series(0,12)w cross join generate_series(0,4,2)d;
 set constraints all immediate;set constraints all deferred;`);
 for(const [name,sql,repetitions] of [['operatingReference',`select public.get_timetable_operational_reference_v1()::text;`,5],['revisionPoll',`select public.get_timetable_plan_revision_v1('${id(2)}')::text;`,5],['guardedOperatingWrite',null,3]]){
  const samples=[];for(let n=0;n<repetitions;n++){const query=sql??`select public.update_class_operational_v1('${id(1200)}','{"schedule":"월 21:0${n+1}-21:30"}','${randomUUID()}')::text;`;const start=performance.now();const result=await db.ok(query);samples.push({durationMs:performance.now()-start,payloadBytes:Buffer.byteLength(result)});if(name==='operatingReference')assert.ok(JSON.parse(result).datedSessions.length>=report.datedSessions);}
  report.measurements.push({name,samples});console.log(JSON.stringify(report.measurements.at(-1)));
 }
 const migration=(await readdir('supabase/migrations')).find(n=>n.startsWith('20260923085008'));
 const source=await readFile('supabase/migrations/'+migration,'utf8');
 const original=source.match(/create or replace function dashboard_private\.read_timetable_operating_reference_v1\(\)[\s\S]*?end \$f\$;/i)[0].replace('dashboard_private.read_timetable_operating_reference_v1()', 'pg_temp.original_timetable_reference()');
 await db.ok(original+"set local statement_timeout='120s';");
 const started=performance.now();const before=await db.query('create temp table original_reference as select pg_temp.original_timetable_reference() value;',125000);
 report.original={durationMs:performance.now()-started,code:before.code};
 assert.equal(before.code,'00000',before.text);
 report.equality=await db.value("select jsonb_build_object('jsonbExact',value=dashboard_private.read_timetable_operating_reference_v1(),'payloadBytes',octet_length(value::text),'datedRows',jsonb_array_length(value->'datedSessions'))::text from original_reference;");
 assert.equal(report.equality.jsonbExact,true);console.log(JSON.stringify({original:report.original,equality:report.equality}));
 report.passed=true;
}finally{await db.ok('rollback;');db.close();await writeFile('docs/qa/timetable-presets-20260923/performance-reference.json',JSON.stringify(report,null,2));}
