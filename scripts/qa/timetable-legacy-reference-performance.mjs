import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PsqlConnection } from '../verify-timetable-concurrency.mjs';
const container=process.argv[process.argv.indexOf('--container')+1];
assert.ok(process.argv.includes('--local') && /^tips_timetable_legacyperf_[a-z0-9_]+$/.test(container));
const inspection=JSON.parse(execFileSync('/Users/hyunjun/.local/bin/docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspection.HostConfig.NetworkMode,'none');assert.deepEqual(inspection.NetworkSettings.Ports,{});
const db=new PsqlConnection(container),prefix=randomUUID().slice(0,8);
const id=n=>`${prefix}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const report={classCount:50,legacySessions:6400,source:'synthetic field shape and aggregate volume only; no production rows copied',measurements:[]};
const value=async sql=>JSON.parse(await db.ok(sql));
try {
 await db.ok(`begin;set local statement_timeout='8s';create function pg_temp.pid(n int) returns uuid language sql immutable as $$select ('${prefix}-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
 insert into auth.users(id,instance_id,aud,role,email) values('${id(1)}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${prefix}@test.invalid');
 insert into public.profiles(id,role,name) values('${id(1)}','admin','legacy perf') on conflict(id) do update set role='admin';set local request.jwt.claim.sub='${id(1)}';
 insert into public.teacher_catalogs(id,name,subjects) values('${id(2)}','${prefix}-teacher',array['영어']);
 insert into public.classroom_catalogs(id,name,subjects) values('${id(3)}','${prefix}-room',array['영어']);
 insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule_plan)
 select pg_temp.pid(100+n),'legacy-'||n,'영어','개강 준비','legacy','{}' from generate_series(0,49)n;`);
 const oldSource=await readFile('supabase/migrations/20260923134651_timetable_reference_aggregation.sql','utf8');
 const previous=oldSource.match(/create or replace function dashboard_private\.read_timetable_operating_reference_v1\(\)[\s\S]*?end \$f\$;/)[0].replace('dashboard_private.read_timetable_operating_reference_v1()','pg_temp.previous_reference()');
 await db.ok(previous);
 const valid={id:'valid',date:'2026-10-05',startTime:'09:00',endTime:'10:00',teacherCatalogId:id(2),classroomCatalogId:id(3)};
 const cases=[valid,{...valid,id:'names',teacherCatalogId:null,classroomCatalogId:null,teacherName:prefix+'-teacher',classroomName:prefix+'-room'},null,'bad',7,{...valid,id:'duplicate'},{...valid,id:'duplicate'},{...valid,id:'',sessionKey:'fallback'},{...valid,id:null,sessionKey:'session-key'},{...valid,id:null},{...valid,id:'bad-date',date:'invalid'},{...valid,id:'seconds',endTime:'10:00:00.125'},{...valid,id:'skipped',scheduleState:'skipped'},{...valid,id:'tbd',scheduleState:'tbd'},{...valid,id:'missing-resource',teacherCatalogId:null}];
 const literal=JSON.stringify({sessions:cases}).replaceAll("'","''");
 await db.ok(`update public.classes set schedule_plan='${literal}'::jsonb where id='${id(100)}';update public.classes set schedule_plan='{"sessions":{}}' where id='${id(101)}';`);
 report.semanticParity=await value('select jsonb_build_object(\'exactJson\',pg_temp.previous_reference()=dashboard_private.read_timetable_operating_reference_v1())::text;');
 assert.equal(report.semanticParity.exactJson,true);
 // Real legacy learning-content keys must not create a new unknown occupancy.
 const before=await value('select dashboard_private.read_timetable_operating_reference_v1()::text;');
 await db.ok(`update public.classes set schedule_plan=jsonb_set(jsonb_set(schedule_plan,'{sessions,14,textbookEntries}','[{"textbookId":"book","progress":"done"}]'),'{sessions,14,progressStatus}','"완료"') where id='${id(100)}';`);
 const after=await value('select dashboard_private.read_timetable_operating_reference_v1()::text;');
 assert.deepEqual(after,before);report.legacyContentOccupancyUnchanged=true;
 await db.ok(`update public.classes c set schedule_plan=jsonb_build_object('sessions',(select jsonb_agg(jsonb_build_object('id','session-'||n,'sessionKey','session-'||n,'date',(date '2026-01-01'+n)::text,'scheduleState','active','state','counted','sessionNumber',n,'billingId','fixture','billingColor','gray','billingLabel','fixture','originalDate',null,'makeupDate',null,'isForced',false,'memo',repeat('x',800),'publicNote','','teacherNote','','textbookEntries','[]'::jsonb,'progressStatus','대기') order by n) from generate_series(0,127)n)) where c.id between '${id(100)}' and '${id(149)}';`);
 await db.ok("savepoint previous_performance;set local statement_timeout='2s';");
 const started=performance.now();const old=await db.query('select md5(pg_temp.previous_reference()::text);',10000);
 report.previous={sqlstate:old.code,durationMs:performance.now()-started};assert.equal(old.code,'57014');
 await db.ok('rollback to previous_performance;');
 for(let n=0;n<3;n++){
  const start=performance.now();const result=await value("with r as materialized(select dashboard_private.read_timetable_operating_reference_v1() x) select jsonb_build_object('datedRows',jsonb_array_length(x->'datedSessions'),'unresolvedRows',jsonb_array_length(x->'datedUnresolvedOccupancies'),'fingerprint',x->>'datedFingerprint')::text from r;");
  const ms=performance.now()-start;assert.equal(result.unresolvedRows,6400);assert.ok(ms<8000);report.measurements.push({name:'legacyReference',durationMs:ms,...result});
 }
 // Establish historical occupancy, then exercise the same signup trigger that failed in production preflight.
 await db.ok('update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();set constraints all immediate;set constraints all deferred;');
 const start=performance.now();
 await db.ok(`insert into auth.users(id,instance_id,aud,role,email) values('${id(10)}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${prefix}-signup@test.invalid');set constraints all immediate;set constraints all deferred;`);
 report.measurements.push({name:'actualSignupAndDeferredGuards',durationMs:performance.now()-start});
 assert.ok(report.measurements.at(-1).durationMs<8000);
 report.passed=true;console.log(JSON.stringify(report));
} finally {await db.ok('rollback;');db.close();await writeFile('docs/qa/timetable-presets-20260923/performance-legacy-reference.json',JSON.stringify(report,null,2)+'\n');}
