-- Synthetic rollback-only contract test. Run through the isolated PG17 runner
-- after all final migrations; never run against an operational database.
begin;
select no_plan();
set local timezone='Asia/Seoul';
set local statement_timeout='30s';
set local lock_timeout='5s';

create function pg_temp.hours_id(n integer) returns uuid language sql immutable as $$
 select ('f2080000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.hours_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.hours_id(n)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.hours_id(n),'role','authenticated')::text,true);
end $$;
insert into auth.users(id,instance_id,aud,role,email)
select pg_temp.hours_id(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
 'withdrawal-hours-'||n||'@synthetic.invalid' from generate_series(1,4)n;
insert into public.profiles(id,role,name,email)
select pg_temp.hours_id(n),case n when 1 then 'admin' when 2 then 'staff' else 'teacher' end,
 '가상 시수 사용자 '||n,'hours-'||n||'@synthetic.invalid' from generate_series(1,4)n
on conflict(id) do update set role=excluded.role,name=excluded.name,email=excluded.email;
insert into public.classes(id,name,subject,grade,teacher,status,schedule_storage_mode,schedule_plan,student_ids)
values(pg_temp.hours_id(20),'가상 시수 수업','수학','중3','가상 시수 사용자 3','개강 준비','legacy','{}',jsonb_build_array(pg_temp.hours_id(30))),
 (pg_temp.hours_id(21),'가상 다른 수업','수학','중3','가상 시수 사용자 3','개강 준비','legacy','{}','[]');
update public.classes set schedule='월수 19:30~21:30',schedule_plan='{"selectedDays":[1,3],"sessions":[
 {"id":"first","date":"2026-11-02","sessionNumber":1,"state":"active","billingId":"cycle"},
 {"id":"second","date":"2026-11-04","sessionNumber":2,"state":"active","billingId":"cycle"},
 {"id":"canceled","date":"2026-11-06","sessionNumber":3,"state":"canceled","billingId":"cycle"},
 {"id":"third","date":"2026-11-09","sessionNumber":4,"state":"active","billingId":"cycle","hours":2.5}]}'
 where id=pg_temp.hours_id(20);
create temp table hours_class_original as select schedule,schedule_plan from public.classes where id=pg_temp.hours_id(20);
insert into public.students(id,name,grade,class_ids,contact,parent_contact)
values(pg_temp.hours_id(30),'가상 시수 학생','중3',jsonb_build_array(pg_temp.hours_id(20)),'PRIVATE_CONTACT_CANARY','PRIVATE_PARENT_CANARY');

create function pg_temp.hours_input() returns jsonb language sql as $$
 select jsonb_build_object('student_id',pg_temp.hours_id(30),'memo','가상 시수 신청','class_id',pg_temp.hours_id(20),
 'withdrawal_date','2026-11-04','withdrawal_session','2','customer_reason','가상 사유','teacher_opinion','가상 의견','undistributed_textbooks','없음') $$;
create temp table hours_results(name text primary key,input jsonb,payload jsonb,request_key uuid);
grant all on hours_results to authenticated;
create function pg_temp.hours_create(n text,p jsonb,k integer) returns void language plpgsql as $$begin
 insert into hours_results values(n,p,public.mutate_teacher_own_request_v1('withdrawal',null,'create',p,null,pg_temp.hours_id(k)),pg_temp.hours_id(k));
end $$;
create function pg_temp.hours_current(n text) returns jsonb language sql as $$
 select public.get_teacher_own_request_v1('withdrawal',(payload->>'id')::uuid) from hours_results where name=n $$;
create function pg_temp.hours_update(n text,p jsonb,k integer) returns void language plpgsql as $$declare x record;v jsonb;begin
 select * into x from hours_results where name=n;
 v:=public.mutate_teacher_own_request_v1('withdrawal',(x.payload->>'id')::uuid,'update',p,x.payload->>'revision',pg_temp.hours_id(k));
 update hours_results set payload=v where name=n;
end $$;
create temp table hours_effects_before as select
 (select count(*) from public.class_lesson_sessions) sessions,
 (select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.students s) students,
 (select count(*) from dashboard_private.notification_deliveries) deliveries,
 (select count(*) from public.textbook_stock_moves) stock;

select pg_temp.hours_actor(3);set local role authenticated;
select lives_ok($q$select pg_temp.hours_create('normal',pg_temp.hours_input(),101)$q$,
 'eight-key teacher create derives hours from the locked class plan');
select is((pg_temp.hours_current('normal')#>>'{input,completed_lesson_hours}')::numeric,4::numeric,'owner readback returns server snapshot');
select is((pg_temp.hours_current('normal')#>>'{input,four_week_lesson_hours}')::numeric,16::numeric,'owner readback returns four-week snapshot');
select is(pg_temp.hours_current('normal')->>'requesterId',pg_temp.hours_id(3)::text,'hours do not alter the owner');
select ok(pg_temp.hours_current('normal')->'allowedActions' ?& array['update','withdraw'],'hours do not grant processing actions');
select ok(not((public.get_teacher_own_requests_v1('withdrawal',1,10)#>'{rows,0}') ? 'input'),'own list remains summary-only');
select lives_ok($q$select pg_temp.hours_create('zero',pg_temp.hours_input()||'{"withdrawal_date":"2026-11-06"}',102)$q$,
 'selected non-counted lesson has actual completed zero');
select is((pg_temp.hours_current('zero')#>>'{input,completed_lesson_hours}')::numeric,0::numeric,'zero completed readback is not missing');
select is((pg_temp.hours_current('zero')#>>'{input,four_week_lesson_hours}')::numeric,16::numeric,'zero completed does not erase the known denominator');
select lives_ok($q$select pg_temp.hours_create('partial-value',pg_temp.hours_input()||'{"withdrawal_date":"2026-11-05"}',104)$q$,
 'missing selected lesson preserves the known weekly operand');
select is(pg_temp.hours_current('partial-value')#>>'{input,completed_lesson_hours}','','unknown completed is not zero');
select lives_ok($q$select pg_temp.hours_create('legacy',pg_temp.hours_input(),105)$q$,'legacy eight-key create stays compatible');
select lives_ok($q$select pg_temp.hours_create('processed',pg_temp.hours_input(),106)$q$,'another calculated request can later be processed');
reset role;
select pg_temp.hours_actor(1);
update public.classes set schedule='',schedule_plan='{}' where id=pg_temp.hours_id(20);
select pg_temp.hours_actor(3);set local role authenticated;
select lives_ok($q$select pg_temp.hours_create('missing',pg_temp.hours_input(),103)$q$,'missing schedule does not invent fallback sessions');
select is(pg_temp.hours_current('missing')#>>'{input,completed_lesson_hours}',null::text,'entirely unknown readback retains legacy optional shape');
select ok(not(pg_temp.hours_current('missing')->'input' ?| array['completed_lesson_hours','four_week_lesson_hours']),'entirely unknown pair does not expand the old eight-key read contract');
-- A retry after a class edit preserves the first effect and does not recalculate.
select lives_ok($q$select public.mutate_teacher_own_request_v1('withdrawal',null,'create',input,null,request_key) from hours_results where name='normal'$q$,
 'receipt replay still succeeds after saved class schedule changes');
select is((pg_temp.hours_current('normal')#>>'{input,completed_lesson_hours}')::numeric,4::numeric,'replay preserves first calculated hours');
reset role;
select pg_temp.hours_actor(1);
update public.classes set schedule='',schedule_plan='{"sessions":[{"id":"zero-base","date":"2026-11-04","state":"canceled"}]}' where id=pg_temp.hours_id(20);
select pg_temp.hours_actor(3);set local role authenticated;
select lives_ok($q$select pg_temp.hours_create('zero-base',pg_temp.hours_input(),108)$q$,'canceled-only schedule derives genuine zero completed and zero baseline');
select is((pg_temp.hours_current('zero-base')#>>'{input,completed_lesson_hours}')::numeric,0::numeric,'public owner read retains genuine completed zero');
select is((pg_temp.hours_current('zero-base')#>>'{input,four_week_lesson_hours}')::numeric,0::numeric,'public owner read retains genuine zero denominator');
reset role;
select is((select four_week_lesson_hours from public.ops_withdrawal_details where task_id=(select(payload->>'id')::uuid from hours_results where name='zero-base')),0::numeric,
 'existing writer stores actual zero denominator, not NULL');
select pg_temp.hours_actor(1);
update public.ops_withdrawal_details set fee_processed=true where task_id=(select(payload->>'id')::uuid from hours_results where name='zero-base');
select pg_temp.hours_actor(3);set local role authenticated;
select is((pg_temp.hours_current('zero-base')#>>'{input,completed_lesson_hours}')::numeric,0::numeric,'processed immutable history keeps completed zero');
select is((pg_temp.hours_current('zero-base')#>>'{input,four_week_lesson_hours}')::numeric,0::numeric,'processed immutable history keeps zero denominator');
reset role;
select pg_temp.hours_actor(1);
update public.classes set schedule=o.schedule,schedule_plan=o.schedule_plan from hours_class_original o where id=pg_temp.hours_id(20);
-- Synthetic receipt from the intermediate contract; no past rows are edited.
insert into dashboard_private.teacher_request_receipts_v1(request_key,actor_id,domain,request_id,action,fingerprint,response)
select pg_temp.hours_id(107),pg_temp.hours_id(3),'withdrawal',(payload->>'id')::uuid,'create',
 md5(jsonb_build_object('actor',pg_temp.hours_id(3),'domain','withdrawal','id',null,'action','create',
 'input',input||'{"completed_lesson_hours":"4","four_week_lesson_hours":"16"}'::jsonb,'revision',null)::text),payload
 from hours_results where name='normal';
select pg_temp.hours_actor(3);set local role authenticated;
select lives_ok($q$select public.mutate_teacher_own_request_v1('withdrawal',null,'create',input||'{"completed_lesson_hours":"4","four_week_lesson_hours":"16"}',null,pg_temp.hours_id(107))
 from hours_results where name='normal'$q$,'exact old ten-key receipt replay preserves its first effect');
select is(jsonb_array_length(pg_temp.hours_current('normal')->'history'),1,'old ten-key receipt replay does not add history');
select throws_ok($q$select public.mutate_teacher_own_request_v1('withdrawal',null,'create',input,null,pg_temp.hours_id(107))
 from hours_results where name='normal'$q$,'22023','idempotency_key_reused','stripping old receipt quantities cannot change the original retry fingerprint');
select throws_ok($q$select pg_temp.hours_update('normal',pg_temp.hours_input()||'{"completed_lesson_hours":"4","four_week_lesson_hours":"16"}',109)$q$,
 '22023','teacher_request_input_invalid','fresh update rejects even numerically matching ten-key input');


select throws_ok(format($q$select public.mutate_teacher_own_request_v1('withdrawal',null,'create',pg_temp.hours_input()||%L::jsonb,null,pg_temp.hours_id(%s))$q$,
 patch::text,200+row_number() over ()),'22023','teacher_request_input_invalid',label)
from (values
 ('{"completed_lesson_hours":"999999.99","four_week_lesson_hours":"0.01"}'::jsonb,'fabricated bounded quantities are not accepted'),
 ('{"completed_lesson_hours":"4","four_week_lesson_hours":"16"}'::jsonb,'even matching calculated values are not wire inputs'),
 ('{"completed_lesson_hours":"4"}'::jsonb,'one optional key cannot silently clear the other'),
 ('{"four_week_lesson_hours":"16"}'::jsonb,'inverse incomplete pair is rejected'),
 ('{"completed_lesson_hours":null,"four_week_lesson_hours":"16"}'::jsonb,'JSON null is not the explicit unknown string'),
 ('{"completed_lesson_hours":0,"four_week_lesson_hours":"16"}'::jsonb,'numeric input cannot bypass the string DTO'),
 ('{"completed_lesson_hours":"-1","four_week_lesson_hours":"16"}'::jsonb,'negative hours are rejected'),
 ('{"completed_lesson_hours":"NaN","four_week_lesson_hours":"16"}'::jsonb,'NaN is rejected'),
 ('{"completed_lesson_hours":"Infinity","four_week_lesson_hours":"16"}'::jsonb,'Infinity is rejected'),
 ('{"completed_lesson_hours":"1e2","four_week_lesson_hours":"16"}'::jsonb,'input exponent coercion is rejected'),
 ('{"completed_lesson_hours":"1.234","four_week_lesson_hours":"16"}'::jsonb,'overprecision cannot be silently rounded'),
 ('{"completed_lesson_hours":"1000000","four_week_lesson_hours":"16"}'::jsonb,'numeric storage overflow is rejected before writer'),
 ('{"completed_lesson_hours":" 4 ","four_week_lesson_hours":"16"}'::jsonb,'whitespace coercion is rejected'),
 ('{"completed_lesson_hours":"04","four_week_lesson_hours":"16"}'::jsonb,'ambiguous leading zero input is rejected'),
 ('{"completed_lesson_hours":"4","four_week_lesson_hours":"16","fee_processed":true}'::jsonb,'hours do not admit management checklist injection'),
 ('{"completed_lesson_hours":"4","four_week_lesson_hours":"16","requested_by":"f2080000-0000-4000-8000-000000000004"}'::jsonb,'hours do not admit owner injection')
) cases(patch,label);

select lives_ok($q$select public.mutate_teacher_own_request_v1('withdrawal',null,'create',input,null,request_key) from hours_results where name='normal'$q$,
 'exact successful create replay keeps its original effect');
select is(jsonb_array_length(pg_temp.hours_current('normal')->'history'),1,'duplicate create does not duplicate history');
select throws_ok($q$select public.mutate_teacher_own_request_v1('withdrawal',null,'create',input||'{"completed_lesson_hours":"5"}',null,request_key) from hours_results where name='normal'$q$,
 '22023','idempotency_key_reused','changed calculated snapshot cannot reuse the create key');
select lives_ok($q$select pg_temp.hours_update('normal',pg_temp.hours_input()||'{"withdrawal_date":"2026-11-09"}',301)$q$,
 'own date update computes from the saved full plan');
select is((pg_temp.hours_current('normal')#>>'{input,completed_lesson_hours}')::numeric,6.5::numeric,'new selected date snapshot survives readback');
select lives_ok($q$select pg_temp.hours_update('normal',pg_temp.hours_input()||'{"withdrawal_date":"2026-11-09","memo":"legacy memo-only edit"}',302)$q$,
 'eight-key memo edit preserves the existing snapshot');
select is((pg_temp.hours_current('normal')#>>'{input,completed_lesson_hours}')::numeric,6.5::numeric,'unchanged selection retains its snapshot');
select lives_ok($q$select pg_temp.hours_update('normal',pg_temp.hours_input()||'{"withdrawal_date":"2026-11-05"}',303)$q$,
 'date without a saved lesson remains editable without inventing completed hours');
select is(pg_temp.hours_current('normal')#>>'{input,completed_lesson_hours}','','unknown selected-date completed hours are missing');
select is((pg_temp.hours_current('normal')#>>'{input,four_week_lesson_hours}')::numeric,16::numeric,'known weekly hours survive missing selected date');
select lives_ok($q$select pg_temp.hours_update('normal',pg_temp.hours_input(),304)$q$,'new known date restores a calculated snapshot');
select lives_ok($q$select pg_temp.hours_update('normal',pg_temp.hours_input()||'{"withdrawal_session":"999"}',305)$q$,
 'monthly display label is not an authoritative full-plan ordinal');
select is((pg_temp.hours_current('normal')#>>'{input,completed_lesson_hours}')::numeric,4::numeric,'session-label edit calculates from selected date, never caller quantity');
select lives_ok($q$select pg_temp.hours_update('normal',pg_temp.hours_input(),306)$q$,'selection label can return without changing formula');

select pg_temp.hours_actor(4);
select throws_ok($q$select pg_temp.hours_current('normal')$q$,'42501','teacher_request_forbidden','other teacher cannot read the saved hour pair');
select throws_ok($q$select pg_temp.hours_update('normal',pg_temp.hours_input(),307)$q$,
 '42501','teacher_request_forbidden','other teacher cannot write the saved hour pair');
select pg_temp.hours_actor(3);
select is((pg_temp.hours_current('normal')#>>'{input,completed_lesson_hours}')::numeric,4::numeric,'rejected other-owner write leaves snapshot intact');
select throws_ok($q$select public.create_ops_task_v2('{"type":"withdrawal","title":"forbidden generic writer"}',pg_temp.hours_id(308))$q$,
 '42501','ops_task_access_denied','generic management writer remains unavailable to teacher');
select throws_ok($q$select dashboard_private.teacher_request_ops_input_v1('withdrawal',pg_temp.hours_input(),null)$q$,
 '42501',null,'private input helper remains unavailable directly');

reset role;
select is((select completed_lesson_hours from public.ops_withdrawal_details where task_id=(select(payload->>'id')::uuid from hours_results where name='zero')),0::numeric,'writer stores numeric zero');
select is((select completed_lesson_hours from public.ops_withdrawal_details where task_id=(select(payload->>'id')::uuid from hours_results where name='missing')),null::numeric,'writer stores NULL for missing');
select is((select four_week_lesson_hours from public.ops_withdrawal_details where task_id=(select(payload->>'id')::uuid from hours_results where name='partial-value')),16::numeric,'writer preserves present operand beside missing operand');

-- Memo-only edits of an entirely unknown snapshot preserve both NULLs and
-- the historical eight-key shape even after subsequent management processing.
select pg_temp.hours_actor(3);set local role authenticated;
select lives_ok($q$select pg_temp.hours_update('missing',pg_temp.hours_input()||'{"memo":"retain entirely unknown"}',313)$q$,'unchanged-selection memo does not recalculate an unknown snapshot');
reset role;
select pg_temp.hours_actor(1);
update public.ops_withdrawal_details set fee_processed=true where task_id=(select(payload->>'id')::uuid from hours_results where name='missing');
select is((select completed_lesson_hours from public.ops_withdrawal_details where task_id=(select(payload->>'id')::uuid from hours_results where name='missing')),null::numeric,'unknown memo preserves stored completed NULL');
select is((select four_week_lesson_hours from public.ops_withdrawal_details where task_id=(select(payload->>'id')::uuid from hours_results where name='missing')),null::numeric,'unknown memo preserves stored denominator NULL');
select pg_temp.hours_actor(3);set local role authenticated;
select is(pg_temp.hours_current('missing')->'input',pg_temp.hours_input()||'{"memo":"retain entirely unknown"}'::jsonb,
 'processed unknown request retains its complete eight-key immutable snapshot');
reset role;

-- A management correction uses the existing unchanged detail writer. The own
-- editable reader must return the current values with the current revision.
select pg_temp.hours_actor(1);
select lives_ok($q$select dashboard_private.upsert_ops_task_detail_v2(d.task_id,'withdrawal',to_jsonb(d)||'{"completed_lesson_hours":"7.25","four_week_lesson_hours":"18"}')
 from public.ops_withdrawal_details d where d.task_id=(select(payload->>'id')::uuid from hours_results where name='normal')$q$,
 'management continues to use its existing detail writer and storage');
select pg_temp.hours_actor(3);set local role authenticated;
select is((pg_temp.hours_current('normal')#>>'{input,completed_lesson_hours}')::numeric,7.25::numeric,'editable own read returns current management-corrected hours');
select throws_ok($q$select pg_temp.hours_update('normal',pg_temp.hours_input(),309)$q$,
 '23514','teacher_request_stale','stale teacher snapshot cannot overwrite management correction');
update hours_results set payload=pg_temp.hours_current(name) where name='normal';
select lives_ok($q$select pg_temp.hours_update('normal',pg_temp.hours_input()||'{"memo":"current memo"}',310)$q$,'fresh eight-key note edit preserves management snapshot');
select is((pg_temp.hours_current('normal')#>>'{input,completed_lesson_hours}')::numeric,7.25::numeric,'fresh note edit did not recalculate or erase snapshot');
reset role;

-- The second finding: eight-key memo saves keep the effective pair in new
-- immutable history, so processing cannot erase the owner's retained values.
select pg_temp.hours_actor(1);
select lives_ok($q$select dashboard_private.upsert_ops_task_detail_v2(d.task_id,'withdrawal',to_jsonb(d)||'{"completed_lesson_hours":"7.25","four_week_lesson_hours":"18"}')
 from public.ops_withdrawal_details d where d.task_id=(select(payload->>'id')::uuid from hours_results where name='processed')$q$,'management snapshot can be retained by later teacher memo');
select pg_temp.hours_actor(3);set local role authenticated;
update hours_results set payload=pg_temp.hours_current(name) where name='processed';
select lives_ok($q$select pg_temp.hours_update('processed',pg_temp.hours_input()||'{"memo":"retain effective hours"}',312)$q$,'eight-key memo creates a complete immutable snapshot');
reset role;
select is((select(input_snapshot->>'completed_lesson_hours')::numeric from dashboard_private.teacher_request_history_v1
 where request_id=(select(payload->>'id')::uuid from hours_results where name='processed') and action='update' order by created_at desc,id desc limit 1),7.25::numeric,
 'new history stores the actual retained DB quantity');
select pg_temp.hours_actor(1);
update public.ops_withdrawal_details set fee_processed=true where task_id=(select(payload->>'id')::uuid from hours_results where name='processed');
select pg_temp.hours_actor(3);set local role authenticated;
select is((pg_temp.hours_current('processed')#>>'{input,completed_lesson_hours}')::numeric,7.25::numeric,'processing preserves memo-retained completed hours');
select is((pg_temp.hours_current('processed')#>>'{input,four_week_lesson_hours}')::numeric,18::numeric,'processing preserves memo-retained denominator');
reset role;

-- Historical invalid values are preserved in storage, not emitted as an
-- unparseable optional pair. An unchanged note edit must not fix them silently.
select pg_temp.hours_actor(1);
update public.ops_withdrawal_details set completed_lesson_hours='NaN'::numeric
 where task_id=(select(payload->>'id')::uuid from hours_results where name='normal');
select pg_temp.hours_actor(3);set local role authenticated;
select ok(not(pg_temp.hours_current('normal')->'input' ?| array['completed_lesson_hours','four_week_lesson_hours']),
 'invalid legacy numeric pair is omitted rather than breaking the strict DTO');
update hours_results set payload=pg_temp.hours_current(name) where name='normal';
select lives_ok($q$select pg_temp.hours_update('normal',pg_temp.hours_input()||'{"memo":"preserve historical invalid"}',311)$q$,
 'legacy invalid snapshot does not block unrelated own note edit');
reset role;
select is((select completed_lesson_hours::text from public.ops_withdrawal_details where task_id=(select(payload->>'id')::uuid from hours_results where name='normal')),'NaN',
 'read/update does not repair historical values without an explicit new snapshot');
select ok(not((select input_snapshot from dashboard_private.teacher_request_history_v1
 where request_id=(select(payload->>'id')::uuid from hours_results where name='normal') and action='update'
 order by created_at desc,id desc limit 1) ?| array['completed_lesson_hours','four_week_lesson_hours']),
 'invalid retained legacy pair is omitted from new history without repairing DB');
select pg_temp.hours_actor(1);
update public.ops_withdrawal_details set fee_processed=true where task_id=(select(payload->>'id')::uuid from hours_results where name='normal');
select pg_temp.hours_actor(3);set local role authenticated;
select ok(not(pg_temp.hours_current('normal')->'input' ?| array['completed_lesson_hours','four_week_lesson_hours']),
 'after processing, invalid legacy snapshot stays omitted from immutable owner read');
reset role;
select is((select completed_lesson_hours::text from public.ops_withdrawal_details where task_id=(select(payload->>'id')::uuid from hours_results where name='normal')),'NaN',
 'processing and owner read do not repair the invalid original stored value');
select pg_temp.hours_actor(1);
update public.ops_withdrawal_details set completed_lesson_hours=4,four_week_lesson_hours=16
 where task_id=(select(payload->>'id')::uuid from hours_results where name='normal');

-- Current profile authorization is checked on both read and exact replay.
update public.profiles set role='viewer' where id=pg_temp.hours_id(3);
select pg_temp.hours_actor(3);set local role authenticated;
select throws_ok($q$select pg_temp.hours_current('zero')$q$,'42501','teacher_request_forbidden','revoked teacher role cannot read hours');
select throws_ok($q$select public.mutate_teacher_own_request_v1('withdrawal',null,'create',input,null,request_key) from hours_results where name='zero'$q$,
 '42501','teacher_request_forbidden','role revocation blocks an otherwise exact replay');
reset role;
update public.profiles set role='teacher' where id=pg_temp.hours_id(3);
select pg_temp.hours_actor(3);set local role authenticated;

select lives_ok($q$select public.mutate_teacher_own_request_v1('withdrawal',(payload->>'id')::uuid,'withdraw','{"note":"가상 신청 철회"}',payload->>'revision',pg_temp.hours_id(401))
 from hours_results where name='zero'$q$,'owner can withdraw without changing the hour snapshot');
select is((pg_temp.hours_current('zero')#>>'{input,completed_lesson_hours}')::numeric,0::numeric,'withdrawal preserves explicit zero snapshot');
select is(pg_temp.hours_current('zero')->'allowedActions','[]'::jsonb,'withdrawn request gains no processing action');
reset role;

-- Processing observations lock direct writes and retain the last immutable
-- teacher input snapshot, exactly as the pre-existing owner contract does.
select pg_temp.hours_actor(1);
update public.ops_withdrawal_details set fee_processed=true
 where task_id=(select(payload->>'id')::uuid from hours_results where name='processed');
select pg_temp.hours_actor(3);set local role authenticated;
select is((pg_temp.hours_current('processed')#>>'{input,completed_lesson_hours}')::numeric,7.25::numeric,'processed request keeps the actual stored teacher snapshot');
select ok(not(pg_temp.hours_current('processed')->'allowedActions' ? 'update'),'observed processing never permits direct hour edits');
update hours_results set payload=pg_temp.hours_current(name) where name='processed';
select throws_ok($q$select pg_temp.hours_update('processed',pg_temp.hours_input(),402)$q$,
 '23514','teacher_request_state_conflict','processed request rejects a new direct hour snapshot');
reset role;

select is(dashboard_private.teacher_operational_common_ops_v1('{"type":"withdrawal","inlineState":{"completedLessonHours":4,"fourWeekLessonHours":16},"displayValues":{"completedLessonHours":"4","fourWeekLessonHours":"16","progress":"25%"}}')#>'{inlineState,completedLessonHours}',
 'null'::jsonb,'general teacher detail still redacts hours outside the own-request boundary');
select is(dashboard_private.teacher_operational_common_ops_v1('{"type":"withdrawal","displayValues":{"progress":"25%"}}')#>>'{displayValues,progress}','','common teacher progress remains redacted');
select is(dashboard_private.teacher_common_schedule_plan_v1(jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object(k,1.5))))#>array['sessions','0',k],
 '1.5'::jsonb,'management duration alias is preserved: '||k)
from unnest(array['lessonHours','lesson_hours','durationHours','duration_hours','sessionHours','session_hours','hours',
 'lessonMinutes','lesson_minutes','durationMinutes','duration_minutes','minutes']) k;
select is(dashboard_private.teacher_common_schedule_plan_v1('{"sessions":[{"lessonHours":"0","durationMinutes":0}]}')#>'{sessions,0,lessonHours}',
 '"0"'::jsonb,'projection preserves string zero without changing its type');
select ok(not(dashboard_private.teacher_common_schedule_plan_v1('{"sessions":[{"lessonHours":"1.5","minutes":null},{"hours":""}]}') ? 'withdrawalHoursUnavailable'),
 'supported decimal strings and absent durations do not disable calculation');
select is(dashboard_private.teacher_common_schedule_plan_v1('{"selected_days":[1,3],"session_list":[{"session_key":"lesson-a","session_date":"2026-10-28","session_number":1,"schedule_state":"active","start_time":"19:30","end_time":"21:30","legacyBillingId":"cycle-a","legacyBillingLabel":"11월"}],"billing_periods":[{"billing_id":"cycle-a","billing_label":"11월","start_date":"2026-10-28","end_date":"2026-11-25"}]}')#>>'{sessions,0,legacyBillingId}',
 'cycle-a','full schedule preserves the actual normalized projector billing identity');
select is(dashboard_private.teacher_common_schedule_plan_v1('{"selected_days":[1,3],"session_list":[{"date":"2026-10-28"}],"billing_periods":[{"start_date":"2026-10-28"}]}')#>'{selected_days}',
 '[1,3]'::jsonb,'legacy weekday alias is available to the same management formula');
select is(dashboard_private.teacher_common_schedule_plan_v1('{"billing_periods":[{"billing_id":"cycle-a","start_date":"2026-10-28"}]}')#>>'{billingPeriods,0,start_date}',
 '2026-10-28','legacy billing-period range alias is preserved');
select is(dashboard_private.teacher_common_schedule_plan_v1('{"sessions":[],"session_list":[{"hours":2}]}')->'sessions','[]'::jsonb,
 'canonical empty sessions still take priority over the legacy alias');
select is(dashboard_private.teacher_common_schedule_plan_v1(jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object('hours',v))))->'withdrawalHoursUnavailable',
 'true'::jsonb,'unsupported duration marks calculation unknown without exposing it: '||label)
from (values ('"PRIVATE_DURATION_CANARY"'::jsonb,'text'),('{"PRIVATE_DURATION_CANARY":1}'::jsonb,'object'),
 ('["PRIVATE_DURATION_CANARY"]'::jsonb,'array'),('true'::jsonb,'boolean'),('"1e2"'::jsonb,'coercible exponent'),('-1'::jsonb,'negative')) unsupported(v,label);
select ok(dashboard_private.teacher_common_schedule_plan_v1('{"sessions":[{"lessonHours":"PRIVATE_DURATION_CANARY","durationHours":2,"teacherNote":"PRIVATE_NOTE_CANARY","memo":"PRIVATE_MEMO_CANARY"}]}')::text not like '%PRIVATE_%',
 'unsupported duration and unrelated private strings never enter the teacher plan');
select ok(not((dashboard_private.teacher_common_schedule_plan_v1('{"sessions":[{"hours":{"PRIVATE_DURATION_CANARY":1}}]}')#>'{sessions,0}') ? 'hours'),
 'unsupported object is omitted, not returned as a scalar');
select is((select count(*) from dashboard_private.teacher_request_context_v1),0::bigint,'no mutation context escapes success or failure');
select is((select count(*) from public.class_lesson_sessions),(select sessions from hours_effects_before),'hour snapshots never apply schedule effects');
select is((select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.students s),(select students from hours_effects_before),'hour snapshots never change students or roster membership');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from hours_effects_before),'hour snapshots never materialize provider delivery');
select is((select count(*) from public.textbook_stock_moves),(select stock from hours_effects_before),'hour snapshots never change stock');
select ok(not has_function_privilege('authenticated','dashboard_private.calculate_teacher_withdrawal_hours_v1(jsonb,date)','EXECUTE'),'server calculation helper remains private');
select ok((select not prosecdef and provolatile='i' and proconfig @> array['search_path=""'] from pg_proc
 where oid='dashboard_private.calculate_teacher_withdrawal_hours_v1(jsonb,date)'::regprocedure),'pure helper is immutable invoker with empty search path');
select ok(not has_function_privilege('authenticated','dashboard_private.teacher_request_ops_input_v1(text,jsonb,uuid)','EXECUTE'),'input helper ACL remains private');
select ok(not has_function_privilege('authenticated','dashboard_private.teacher_request_state_v1(text,uuid)','EXECUTE'),'state helper ACL remains private');
select ok(not has_function_privilege('anon','public.mutate_teacher_own_request_v1(text,uuid,text,jsonb,text,uuid)','EXECUTE'),'anonymous mutation remains forbidden');
select ok(not (select prosecdef from pg_proc where oid='public.mutate_teacher_own_request_v1(text,uuid,text,jsonb,text,uuid)'::regprocedure),'public mutation remains security invoker');
select ok((select prosecdef and provolatile='s' and proconfig @> array['search_path=""'] from pg_proc
 where oid='dashboard_private.teacher_request_state_v1(text,uuid)'::regprocedure),'final state helper retains stable private definer and empty search path');

select * from finish();
rollback;
