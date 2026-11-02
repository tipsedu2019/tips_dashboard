begin;
select no_plan();
set local timezone='Asia/Seoul';
set local datestyle='ISO, MDY';
set local statement_timeout='8s';
set local lock_timeout='5s';
set local role postgres;

-- Entirely synthetic fixtures and transaction-local instrumentation. The real
-- active reader/validator/gateway are used; every replacement rolls back.
create function pg_temp.gid(n int) returns uuid language sql immutable as
$$select ('ad140000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.gateway_actor(n int default 901) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.gid(n)::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.gid(n),'role','authenticated')::text,true);
end$$;
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
select pg_temp.gid(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
 'gateway-close-'||n||'@test.invalid','{}','{}' from generate_series(901,903) n;
insert into public.profiles(id,role,name) values
 (pg_temp.gid(901),'admin','Synthetic close administrator'),
 (pg_temp.gid(902),'admin','Synthetic second administrator'),
 (pg_temp.gid(903),'teacher','Synthetic unauthorized teacher')
on conflict(id) do update set role=excluded.role,name=excluded.name;
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version)
values(true,1) on conflict(singleton) do update set version=1;
insert into public.teacher_catalogs(id,name,subjects)
select pg_temp.gid(n+1000),'Gateway teacher '||n,array['영어'] from generate_series(101,119) n;
insert into public.classroom_catalogs(id,name,subjects)
select pg_temp.gid(n+2000),'Gateway room '||n,array['영어'] from generate_series(101,119) n;
insert into public.classes(id,name,class_type,subject,subject_area_key,grade,teacher,schedule,room,
 capacity,fee,status,student_ids,waitlist_ids,textbook_ids,textbook_usage,lessons,schedule_storage_mode,schedule_plan)
select pg_temp.gid(n),'Gateway class '||n,'정규','영어',null,
 case when n=108 then null else '중1' end,'Gateway teacher '||n,'월 09:00-10:00','Gateway room '||n,
 12,100000,case when n in(106,115,116) then '개강 준비' else '수강' end,'[]','[]',
 '["gateway-book"]','{"gateway-book":{"startDate":"2026-01-01","endDate":null,"title":"Synthetic book"}}',
 '[]',case when n=106 then 'normalized' else 'legacy' end,
 case when n in(115,116) then jsonb_build_object('sessions',jsonb_build_array(
 jsonb_build_object('id','retained-'||n,'date','2000-01-03','state','active','scheduleState','active',
 'startTime','14:00','endTime','15:00','teacherCatalogId',pg_temp.gid(1115),'classroomCatalogId',pg_temp.gid(2115))))
 else '{"sessions":[]}'::jsonb end
from generate_series(101,119) n;
-- Two disjoint weekly classes support a later real direct-writer collision.
update public.classes set teacher='Gateway teacher 113',room='Gateway room 113',schedule='월 11:00-12:00'
where id=pg_temp.gid(114);
insert into public.academic_subject_settings(subject,is_active,registration_create_enabled,grade_levels,sort_order)
values('과학',true,true,array['고1','고2','고3'],1000) on conflict(subject) do nothing;
insert into public.academic_subject_areas(subject,area_key,label,sort_order,is_active)
select '과학','physics','Synthetic physics',coalesce(max(sort_order),0)+1,true
from public.academic_subject_areas where subject='과학'
on conflict(subject,area_key) do update set is_active=true;
insert into public.classes(id,name,class_type,subject,subject_area_key,grade,teacher,schedule,room,
 capacity,fee,status,student_ids,waitlist_ids,textbook_ids,textbook_usage,lessons,schedule_storage_mode,schedule_plan)
select pg_temp.gid(120),'Gateway science class',class_type,'과학','physics','고1',teacher,'월 13:00-14:00',room,
 capacity,fee,status,student_ids,waitlist_ids,textbook_ids,textbook_usage,lessons,schedule_storage_mode,schedule_plan
from public.classes where id=pg_temp.gid(113);
-- Owner fixture boundary admits retained historical conflicts before any call
-- under test. Tested callers cannot read or replace the private baseline.
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;
select set_config('app.class_close_mutation','',true);
select pg_temp.gateway_actor();

create function pg_temp.gateway_patch(n int) returns jsonb language sql stable as $$
 select jsonb_build_object('name',name,'class_type',class_type,'subject',subject,
 'subject_area_key',subject_area_key,'grade',grade,'teacher',teacher,'schedule',schedule,'room',room,
 'capacity','012','fee','0100000','status','종강','textbook_ids',textbook_ids,'textbook_usage',textbook_usage)
 from public.classes where id=pg_temp.gid(n)
$$;
create temp table gateway_probe(
 singleton boolean primary key default true,scenario text default '',
 cancel_outer boolean default false,cancel_finalizer boolean default false,
 replace_baseline_after_inner boolean default false,shift_actor_after_inner boolean default false,
 remove_context_after_inner boolean default false,touch_operating_after_inner boolean default false,
 ban_actor_after_inner boolean default false,shift_timezone_after_inner boolean default false,
 shift_datestyle_after_inner boolean default false,touch_identity_after_inner text default ''
);
insert into gateway_probe(singleton) values(true);
create sequence pg_temp.gateway_reader_calls;
create sequence pg_temp.gateway_validator_calls;
create sequence pg_temp.gateway_assert_calls;
create sequence pg_temp.gateway_class_updates;
create temp table gateway_boundaries(
 stage text,baseline jsonb,actor uuid,api_role text,close_context text
);
create temp table gateway_originals as
select 'reader' kind,pg_get_functiondef('dashboard_private.read_timetable_operating_reference_v1()'::regprocedure) definition
union all select 'validator',pg_get_functiondef('dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure)
union all select 'assert',pg_get_functiondef('dashboard_private.assert_timetable_operational_conflicts_v1()'::regprocedure);
do $instrument$
declare definition text;
begin
 select o.definition into definition from gateway_originals o where kind='reader';
 execute replace(definition,'dashboard_private.read_timetable_operating_reference_v1()',
                            'pg_temp.gateway_read_original()');
 select o.definition into definition from gateway_originals o where kind='validator';
 execute replace(definition,'dashboard_private.validate_timetable_operating_reference_v1()',
                            'pg_temp.gateway_validate_original()');
 select o.definition into definition from gateway_originals o where kind='assert';
 execute replace(definition,'dashboard_private.assert_timetable_operational_conflicts_v1()',
                            'pg_temp.gateway_assert_original()');
end $instrument$;
create or replace function dashboard_private.read_timetable_operating_reference_v1()
returns jsonb language plpgsql volatile security definer set search_path='' as $$begin
 perform nextval('pg_temp.gateway_reader_calls'::regclass);
 return pg_temp.gateway_read_original();
end$$;
create or replace function dashboard_private.validate_timetable_operating_reference_v1()
returns jsonb language plpgsql security definer set search_path='' as $$
declare context text;
begin
 perform nextval('pg_temp.gateway_validator_calls'::regclass);
 get diagnostics context=PG_CONTEXT;
 insert into pg_temp.gateway_boundaries select
 case when strpos(context,'timetable_operating_finalize_v1')>0 then 'finalizer' else 'validator' end,
 reference,auth.uid(),current_setting('role',true),current_setting('app.class_close_mutation',true)
 from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();
 if (select cancel_finalizer from pg_temp.gateway_probe)
 and strpos(context,'timetable_operating_finalize_v1')>0 then
 raise exception using errcode='57014',message='gateway_probe_query_canceled';end if;
 return pg_temp.gateway_validate_original();
end$$;
create or replace function dashboard_private.assert_timetable_operational_conflicts_v1()
returns void language plpgsql security definer set search_path='' as $$
declare ordinal bigint;
begin
 ordinal:=nextval('pg_temp.gateway_assert_calls'::regclass);
 insert into pg_temp.gateway_boundaries select 'assert-'||ordinal,reference,auth.uid(),
 current_setting('role',true),current_setting('app.class_close_mutation',true)
 from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current();
 if ordinal=2 and (select cancel_outer from pg_temp.gateway_probe) then
 raise exception using errcode='57014',message='gateway_probe_query_canceled';end if;
 perform pg_temp.gateway_assert_original();
 if ordinal=1 and (select replace_baseline_after_inner from pg_temp.gateway_probe) then
 -- The live retained collision becomes newly introduced against this changed
 -- baseline. A proof bound to the original baseline must reject reuse.
 update dashboard_private.timetable_operating_write_baselines
 set reference=jsonb_set(reference,'{datedSessions}','[]') where transaction_id=txid_current();
 end if;
 if ordinal=1 and (select shift_actor_after_inner from pg_temp.gateway_probe) then
 perform pg_temp.gateway_actor(902);
 end if;
 if ordinal=1 and (select remove_context_after_inner from pg_temp.gateway_probe) then
 delete from dashboard_private.past_lesson_state_correction_contexts where transaction_id=txid_current();
 if not found then raise exception 'gateway_probe_missing_correction_context';end if;
 end if;
 if ordinal=1 and (select touch_operating_after_inner from pg_temp.gateway_probe) then
 update public.classes set schedule=schedule where id=pg_temp.gid(113);
 end if;
 if ordinal=1 and (select ban_actor_after_inner from pg_temp.gateway_probe) then
 update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=auth.uid();
 end if;
 if ordinal=1 and (select shift_timezone_after_inner from pg_temp.gateway_probe) then
 perform set_config('TimeZone','UTC',true);
 end if;
 if ordinal=1 and (select shift_datestyle_after_inner from pg_temp.gateway_probe) then
 perform set_config('DateStyle','ISO, DMY',true);
 end if;
 if ordinal=1 then
 case (select touch_identity_after_inner from pg_temp.gateway_probe)
 when 'classes' then update public.classes set id=id where id=pg_temp.gid(109);
 when 'teacher_catalogs' then update public.teacher_catalogs set id=id where id=pg_temp.gid(1109);
 when 'classroom_catalogs' then update public.classroom_catalogs set id=id where id=pg_temp.gid(2109);
 else null;end case;
 end if;
end$$;
create function pg_temp.gateway_update_probe() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform nextval('pg_temp.gateway_class_updates'::regclass);return new;
end$$;
create trigger gateway_class_update_probe after update on public.classes
for each row execute function pg_temp.gateway_update_probe();
create function pg_temp.gateway_reset(label text) returns void language plpgsql as $$begin
 perform setval('pg_temp.gateway_reader_calls'::regclass,1,false);
 perform setval('pg_temp.gateway_validator_calls'::regclass,1,false);
 perform setval('pg_temp.gateway_assert_calls'::regclass,1,false);
 perform setval('pg_temp.gateway_class_updates'::regclass,1,false);
 truncate pg_temp.gateway_boundaries;
 update pg_temp.gateway_probe set scenario=label,cancel_outer=false,cancel_finalizer=false,
 replace_baseline_after_inner=false,shift_actor_after_inner=false,remove_context_after_inner=false,
 touch_operating_after_inner=false,ban_actor_after_inner=false,shift_timezone_after_inner=false,
 shift_datestyle_after_inner=false,touch_identity_after_inner='';
end$$;
create function pg_temp.gateway_counts() returns jsonb language sql as $$
 select jsonb_build_object('reads',(select case when is_called then last_value else 0 end from pg_temp.gateway_reader_calls),
 'validations',(select case when is_called then last_value else 0 end from pg_temp.gateway_validator_calls),
 'assertions',(select case when is_called then last_value else 0 end from pg_temp.gateway_assert_calls),
 'updates',(select case when is_called then last_value else 0 end from pg_temp.gateway_class_updates))
$$;
create function pg_temp.gateway_flush() returns void language plpgsql as $$begin
 set constraints all immediate;set constraints all deferred;
end$$;
create function pg_temp.gateway_remaining_proofs() returns bigint language plpgsql security definer set search_path='' as $$
declare n bigint;
begin
 if to_regclass('dashboard_private.timetable_close_validation_proofs') is null then return 0;end if;
 execute 'select count(*) from dashboard_private.timetable_close_validation_proofs where transaction_id=txid_current()' into n;
 return n;
end$$;
create function pg_temp.gateway_state() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
 'classes',(select jsonb_agg(to_jsonb(c) order by id) from public.classes c),
 'students',(select jsonb_agg(to_jsonb(s) order by id) from public.students s),
 'claims',(select jsonb_agg(to_jsonb(e) order by id) from public.ops_registration_enrollments e),
 'history',(select jsonb_agg(to_jsonb(h) order by id) from public.student_class_enrollment_history h),
 'receipts',(select jsonb_agg(to_jsonb(r) order by actor_profile_id,operation,request_key) from dashboard_private.class_schedule_mutation_receipts r),
 'baseline',(select jsonb_agg(to_jsonb(b) order by transaction_id) from dashboard_private.timetable_operating_write_baselines b),
 'correctionContexts',(select jsonb_agg(to_jsonb(x) order by transaction_id) from dashboard_private.past_lesson_state_correction_contexts x),
 'actorContexts',(select jsonb_agg(jsonb_build_object('id',p.id,'role',p.role,
 'bannedUntil',u.banned_until,'deletedAt',u.deleted_at) order by p.id)
 from public.profiles p join auth.users u on u.id=p.id where p.id between pg_temp.gid(901) and pg_temp.gid(903)),
 'invalidation',(select jsonb_agg(to_jsonb(i) order by id) from public.timetable_invalidation_signals i),
 'events',(select count(*) from dashboard_private.notification_events),
 'deliveries',(select count(*) from dashboard_private.notification_deliveries))
$$;
create temp table gateway_evidence(k text primary key,v jsonb);
create temp table gateway_no_send as select
 (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_deliveries) deliveries;
grant all on gateway_evidence to authenticated;
grant select on gateway_boundaries,gateway_no_send to authenticated;

-- Broad UI patch: every requested value is equal AFTER typed population. This
-- is the expected RED on baseline: two class updates, four reads, three full
-- validations. Keep both explicit assertion calls and the fresh finalizer.
select pg_temp.gateway_reset('wide typed no-op');
insert into gateway_evidence values('signal-before',to_jsonb((select change_sequence from public.timetable_invalidation_signals where id='operating')));
set local role authenticated;
insert into gateway_evidence values('wide',public.update_class_operational_v1(pg_temp.gid(101),pg_temp.gateway_patch(101),pg_temp.gid(501)));
set local role postgres;
insert into gateway_evidence values('original-baseline',(select reference from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()));
select is(pg_temp.gateway_counts()->>'updates','1','unchanged wide UI close performs only the nested status UPDATE');
select is(pg_temp.gateway_counts()->>'assertions','2','unchanged wide UI close preserves inner and outer assertion invocations');
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":3,"validations":2,"assertions":2,"updates":1}'::jsonb,
 'unchanged wide close reads capture/inner/fresh-finalizer and validates inner/fresh-finalizer');
select is((select count(distinct baseline) from gateway_boundaries),1::bigint,
 'every observed boundary retains the identical immutable original reference');
select ok(exists(select 1 from gateway_boundaries where stage='finalizer'),
 'the successful close performs a fresh deferred full validation');
select is((select count(*) from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()),0::bigint,
 'deferred finalizer removes the original baseline after validating');
select is((select change_sequence from public.timetable_invalidation_signals where id='operating'),
 (select (v#>>'{}')::bigint+1 from gateway_evidence where k='signal-before'),
 'original-versus-final invalidation increments exactly once');
select is((select v->'classRow' from gateway_evidence where k='wide'),
 (select to_jsonb(c) from public.classes c where id=pg_temp.gid(101)),
 'wide close response contains the actual locked post-close class row');
select ok((select v#>>'{closeResult,classId}'=pg_temp.gid(101)::text
 and v#>>'{closeResult,status}'='종강' and v#>>'{classRow,closed_by}'=pg_temp.gid(901)::text
 and v#>>'{classRow,subject_area_key}' is null and v#>>'{classRow,capacity}'='12'
 and v#>>'{classRow,fee}'='100000' and v#>'{classRow,textbook_usage}'<>'{}'::jsonb
 from gateway_evidence where k='wide'),'typed null/numeric/textbook values and the nested close receipt are retained');
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts where actor_profile_id=pg_temp.gid(901)
 and request_key=pg_temp.gid(501) and operation in('close_class_atomic_v1','update_class_operational_v1')),2::bigint,
 'one nested close receipt and one outer operational receipt are recorded');
select pg_temp.gateway_reset('outer replay');
set local role authenticated;
select is(public.update_class_operational_v1(pg_temp.gid(101),
 -- A replay uses the exact original producer patch, including string numbers.
 pg_temp.gateway_patch(101),pg_temp.gid(501)),(select v from gateway_evidence where k='wide'),
 'same actor/key/payload returns the complete original outer receipt');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(101),'{"status":"종강","name":"different"}',pg_temp.gid(501))$q$,
 '22023','idempotency_key_reused','changed close payload cannot reuse an outer receipt key');
set local role postgres;
select is(pg_temp.gateway_counts(),'{"reads":0,"validations":0,"assertions":0,"updates":0}'::jsonb,
 'outer receipt replay performs no class write or timetable recomputation');

select pg_temp.gateway_reset('status-only no-op');
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(102),'{"status":"종강"}',pg_temp.gid(502))$q$,'status-only close succeeds');
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":3,"validations":2,"assertions":2,"updates":1}'::jsonb,
 'status-only close retains the same narrow no-op budget');

select pg_temp.gateway_reset('equal legacy expected plan');
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(112),
 pg_temp.gateway_patch(112)||jsonb_build_object('schedule_plan',schedule_plan),pg_temp.gid(512),schedule_plan)
 from public.classes where id=pg_temp.gid(112)$q$,'equal legacy expected plan passes the real source comparison');
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":3,"validations":2,"assertions":2,"updates":1}'::jsonb,
 'a validated equal legacy plan remains eligible for the typed no-op close');

select pg_temp.gateway_reset('nullable typed no-op');
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(108),pg_temp.gateway_patch(108),pg_temp.gid(508))$q$,
 'wide close accepts explicitly null fields already null in the locked row');
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":3,"validations":2,"assertions":2,"updates":1}'::jsonb,
 'null-safe typed equality also avoids the duplicate update');

-- The initially authorized actor changes after the inner close assertion.
-- Both actors are administrators, so the ordinary full path remains valid;
-- its validation may not be replaced with a proof for the earlier actor.
select pg_temp.gateway_reset('changed actor context');
update gateway_probe set shift_actor_after_inner=true;
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(103),pg_temp.gateway_patch(103),pg_temp.gid(503))$q$,
 'a changed authorized actor takes the ordinary full validation path');
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":4,"validations":3,"assertions":2,"updates":2}'::jsonb,
 'changed actor context cannot reuse the earlier inner validation');
select ok(exists(select 1 from gateway_boundaries where stage='assert-1' and actor=pg_temp.gid(901))
 and exists(select 1 from gateway_boundaries where stage='assert-2' and actor=pg_temp.gid(902)),
 'the context probe really observes two different authorized actors');
select pg_temp.gateway_actor();

select pg_temp.gateway_reset('real residual edits');
set local role authenticated;
insert into gateway_evidence values('changed',public.update_class_operational_v1(pg_temp.gid(104),
 pg_temp.gateway_patch(104)||'{"name":"Changed close metadata","grade":null,"textbook_ids":[]}',pg_temp.gid(504)));
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":4,"validations":3,"assertions":2,"updates":2}'::jsonb,
 'a real residual metadata/textbook/null change keeps the complete existing path');
select ok((select name='Changed close metadata' and grade is null and textbook_ids='[]'::jsonb
 and textbook_usage='{}'::jsonb and status='종강' from public.classes where id=pg_temp.gid(104)),
 'real metadata edits persist and the existing textbook-pruning trigger still runs');
select is((select v->'classRow' from gateway_evidence where k='changed'),
 (select to_jsonb(c) from public.classes c where id=pg_temp.gid(104)),
 'real residual edits return the final trigger-processed row');

-- A nested close receipt may predate this gateway invocation. It supplies no
-- freshly validated state that the outer assertion can reuse.
select pg_temp.gateway_reset('direct close before gateway');
set local role authenticated;
select lives_ok($q$select public.close_class_atomic_v1(pg_temp.gid(105),pg_temp.gid(505))$q$,'direct close succeeds before outer receipt exists');
set local role postgres;
select pg_temp.gateway_flush();
select pg_temp.gateway_reset('nested receipt replay');
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(105),'{"status":"종강"}',pg_temp.gid(505))$q$,
 'gateway still accepts an existing nested close receipt');
set local role postgres;
select is(pg_temp.gateway_counts()->>'validations','2','nested close replay and outer boundary still invoke the full validator');
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":3,"validations":3,"assertions":2,"updates":1}'::jsonb,
 'a prior direct-close receipt cannot arm no-op reuse for a later gateway invocation');
select ok(exists(select 1 from dashboard_private.class_schedule_mutation_receipts
 where actor_profile_id=pg_temp.gid(901) and request_key=pg_temp.gid(505) and operation='update_class_operational_v1'),
 'nested receipt replay still records the outer response');
select pg_temp.gateway_reset('nested replay with real edit');
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(105),'{"name":"Replay close edit"}',pg_temp.gid(605))$q$,
 'metadata on an already closed class remains an ordinary real edit');
set local role postgres;
select pg_temp.gateway_flush();
select is((select name from public.classes where id=pg_temp.gid(105)),'Replay close edit','real edit after direct close persists');
set local role authenticated;
select lives_ok($q$select public.close_class_atomic_v1(pg_temp.gid(118),pg_temp.gid(518))$q$,'second direct close establishes a nested-only receipt');
set local role postgres;
select pg_temp.gateway_flush();
select pg_temp.gateway_reset('nested replay with residual metadata');
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(118),
 '{"status":"종강","name":"Nested replay residual edit"}',pg_temp.gid(518))$q$,
 'nested close receipt replay preserves a real residual metadata edit');
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":3,"validations":3,"assertions":2,"updates":1}'::jsonb,
 'nested receipt replay with a real residual edit retains all guard invocations');
select is((select name from public.classes where id=pg_temp.gid(118)),'Nested replay residual edit',
 'residual metadata persists when nested close is replayed');

-- Invalid residual patches are validated after the nested close exactly as
-- before, and rejection rolls the entire attempted close back.
update public.academic_subject_areas set is_active=false where subject='과학' and area_key='physics';
insert into gateway_evidence values('rejections-before',pg_temp.gateway_state());
set local role authenticated;
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(107),'{"status":"종강","closed_at":null}',pg_temp.gid(707))$q$,
 '22023','class_schedule_validation','a forbidden field is rejected even on a would-be no-op close');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(106),'{"status":"종강","teacher":"Gateway teacher 106"}',pg_temp.gid(706))$q$,
 '22023','class_schedule_validation','normalized resource restrictions are checked before no-op eligibility');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(106),'{"status":"종강","schedule_plan":{"sessions":[]}}',pg_temp.gid(806),'{"sessions":[]}')$q$,
 '22023','class_schedule_validation','normalized schedule-plan restriction remains decisive');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(107),'{"status":"종강","schedule_plan":{"sessions":[]}}',pg_temp.gid(807),'{"stale":true}')$q$,
 'P0001','class_schedule_stale','stale expected-plan comparison remains decisive after nested close');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(109),'{"status":"종강","capacity":"bad-number"}',pg_temp.gid(709))$q$,
 '22P02',null,'normal PostgreSQL typed-population errors are preserved');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(109),'{"status":"invalid"}',pg_temp.gid(809))$q$,
 '22023','class_schedule_validation','invalid status remains a domain validation error');
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(120),pg_temp.gateway_patch(120),pg_temp.gid(820))$q$,
 '23514','science_subject_area_inactive_or_unknown','equal science fields still fire inactive-catalog validation on the ordinary update path');
select pg_temp.gateway_actor(903);
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(109),'{"status":"종강"}',pg_temp.gid(909))$q$,
 '42501','class_schedule_forbidden','unauthorized teacher cannot reach close no-op eligibility');
select pg_temp.gateway_actor();
set local role postgres;
select is(pg_temp.gateway_state(),(select v from gateway_evidence where k='rejections-before'),
 'invalid/stale/normalized/unauthorized attempts preserve rows, roster, receipts, baseline and invalidation');
update public.academic_subject_areas set is_active=true where subject='과학' and area_key='physics';
set local role anon;
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(109),'{"status":"종강"}',pg_temp.gid(919))$q$,
 '42501',null,'anon still lacks EXECUTE on the operational gateway');
set local role authenticated;
select throws_ok($q$select * from dashboard_private.timetable_operating_write_baselines$q$,
 '42501',null,'authenticated callers cannot forge the original timetable baseline');
set local role postgres;

-- Explicit query_canceled propagation: WHEN OTHERS does not catch 57014.
-- Inject at the retained outer boundary and at the real deferred validator;
-- these probes test cancellation semantics, not wall-clock latency.
create function pg_temp.gateway_cancel(n int,key int,flush boolean) returns jsonb language plpgsql as $$
declare code text;message text;
begin
 perform public.update_class_operational_v1(pg_temp.gid(n),pg_temp.gateway_patch(n),pg_temp.gid(key));
 if flush then perform pg_temp.gateway_flush();end if;
 return jsonb_build_object('code','00000');
exception when query_canceled then
 get stacked diagnostics code=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
 return jsonb_build_object('code',code,'message',message);
end$$;
select pg_temp.gateway_reset('cancel outer assertion');
update gateway_probe set cancel_outer=true;
insert into gateway_evidence values('cancel-before',pg_temp.gateway_state());
set local role authenticated;
insert into gateway_evidence values('cancel-outer',pg_temp.gateway_cancel(110,510,false));
set local role postgres;
select is((select v->>'code' from gateway_evidence where k='cancel-outer'),'57014','outer assertion cancellation propagates its exact SQLSTATE');
select is(pg_temp.gateway_counts()->>'assertions','2','cancellation reaches the preserved outer assertion boundary');
select is(pg_temp.gateway_state(),(select v from gateway_evidence where k='cancel-before'),
 'outer cancellation rolls back nested closure, all receipts, roster, baseline and invalidation');
select pg_temp.gateway_reset('cancel fresh finalizer');
update gateway_probe set cancel_finalizer=true;
insert into gateway_evidence values('final-cancel-before',pg_temp.gateway_state());
set local role authenticated;
insert into gateway_evidence values('cancel-finalizer',pg_temp.gateway_cancel(110,610,true));
set local role postgres;
select is((select v->>'code' from gateway_evidence where k='cancel-finalizer'),'57014','fresh finalizer cancellation is never swallowed by receipt/proof handling');
select is(pg_temp.gateway_state(),(select v from gateway_evidence where k='final-cancel-before'),
 'deferred cancellation rolls back the complete gateway operation');
select pg_temp.gateway_reset('retry original canceled key');
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(110),pg_temp.gateway_patch(110),pg_temp.gid(510))$q$,
 'a canceled close can retry the same original key and payload successfully');
set local role postgres;
select pg_temp.gateway_flush();
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts
 where actor_profile_id=pg_temp.gid(901) and request_key=pg_temp.gid(510)),2::bigint,
 'successful same-key retry records exactly one close and one operational receipt');

-- A previously validated close cannot bless an altered original baseline.
select pg_temp.gateway_reset('changed original baseline');
update gateway_probe set replace_baseline_after_inner=true;
insert into gateway_evidence values('baseline-drift-before',pg_temp.gateway_state());
set local role authenticated;
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(117),pg_temp.gateway_patch(117),pg_temp.gid(517))$q$,
 '23P01','timetable_resource_conflict','outer assertion revalidates when its original baseline binding changes');
set local role postgres;
select is(pg_temp.gateway_state(),(select v from gateway_evidence where k='baseline-drift-before'),
 'baseline drift rejection rolls back the entire close and the injected baseline change');

-- The deferred validator must read the final state even after a proved no-op
-- outer boundary. A subsequent direct writer can introduce a real conflict.
create function pg_temp.gateway_then_conflict() returns void language plpgsql as $$begin
 perform public.update_class_operational_v1(pg_temp.gid(111),pg_temp.gateway_patch(111),pg_temp.gid(511));
 update public.classes set schedule='월 11:00-12:00' where id=pg_temp.gid(113);
 perform pg_temp.gateway_flush();
end$$;
select pg_temp.gateway_reset('fresh finalizer after direct writer');
insert into gateway_evidence values('direct-conflict-before',pg_temp.gateway_state());
set local role authenticated;
select throws_ok($q$select pg_temp.gateway_then_conflict()$q$,'23P01','timetable_resource_conflict',
 'fresh finalizer rejects a new direct-writer collision after gateway close returns');
set local role postgres;
select is(pg_temp.gateway_state(),(select v from gateway_evidence where k='direct-conflict-before'),
 'final conflict rolls back both nested close and the later direct write');
select pg_temp.gateway_reset('ordinary direct writer');
select lives_ok($q$update public.classes set schedule='월 10:00-11:00' where id=pg_temp.gid(113)$q$,
 'a safe ordinary direct writer still queues a complete baseline');
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":2,"validations":1,"assertions":0,"updates":1}'::jsonb,
 'ordinary direct writer still captures and freshly validates the complete final reference');

-- Even an intervening guarded statement with unchanged values invalidates a
-- prior completed-validation proof. Its trigger boundary is the actual signal.
select pg_temp.gateway_reset('intervening operating statement');
update gateway_probe set touch_operating_after_inner=true;
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(119),pg_temp.gateway_patch(119),pg_temp.gid(519))$q$,
 'intervening harmless operating writer preserves normal class-close behavior');
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":4,"validations":3,"assertions":2,"updates":3}'::jsonb,
 'operating-after trigger invalidates accepted-state reuse before the outer assertion');

-- New writer/context tests use unrelated empty preparing classes, so fixtures
-- remain disjoint from the original timetable/roster regressions above.
insert into public.classes(id,name,class_type,subject,subject_area_key,grade,teacher,schedule,room,
 capacity,fee,status,student_ids,waitlist_ids,textbook_ids,textbook_usage,lessons,schedule_storage_mode,schedule_plan)
select pg_temp.gid(n),'Gateway safety class '||n,class_type,subject,subject_area_key,grade,teacher,schedule,room,
 capacity,fee,'개강 준비',student_ids,waitlist_ids,textbook_ids,textbook_usage,lessons,'legacy','{"sessions":[]}'
from public.classes cross join generate_series(402,412) n where id=pg_temp.gid(109);
select pg_temp.gateway_flush();
create temp table gateway_settings as select current_setting('TimeZone') timezone,current_setting('DateStyle') datestyle,
 coalesce(current_setting('app.class_schedule_mutation',true),'') schedule_context;

-- UPDATE OF id is a real operating boundary even when its value is unchanged.
-- Run each direct writer as authenticated, create accepted-state evidence with
-- the real assertion, then prove a second identity statement invalidates it.
select pg_temp.gateway_reset('class identity source');
set local role authenticated;
update public.classes set id=id where id=pg_temp.gid(109);
set local role postgres;
select is((select count(*) from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()),1::bigint,
 'authenticated class identity-only writer captures the complete original baseline');
select dashboard_private.assert_timetable_operational_conflicts_v1();
select case when to_regclass('dashboard_private.timetable_close_validation_proofs') is null
 then pass('baseline class identity probe has no proof surface')
 else is(pg_temp.gateway_remaining_proofs(),1::bigint,'class identity probe creates a real completion proof') end;
set local role authenticated;
update public.classes set id=id where id=pg_temp.gid(109);
set local role postgres;
select is(pg_temp.gateway_remaining_proofs(),0::bigint,'class identity-only writer invalidates the earlier completion proof');
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":3,"validations":2,"assertions":1,"updates":2}'::jsonb,
 'class identity-only source writes retain a fresh deferred full validation');

select pg_temp.gateway_reset('teacher identity source');
set local role authenticated;
update public.teacher_catalogs set id=id where id=pg_temp.gid(1109);
set local role postgres;
select is((select count(*) from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()),1::bigint,
 'authenticated teacher identity-only writer captures the complete original baseline');
select dashboard_private.assert_timetable_operational_conflicts_v1();
select case when to_regclass('dashboard_private.timetable_close_validation_proofs') is null
 then pass('baseline teacher identity probe has no proof surface')
 else is(pg_temp.gateway_remaining_proofs(),1::bigint,'teacher identity probe creates a real completion proof') end;
set local role authenticated;
update public.teacher_catalogs set id=id where id=pg_temp.gid(1109);
set local role postgres;
select is(pg_temp.gateway_remaining_proofs(),0::bigint,'teacher identity-only writer invalidates the earlier completion proof');
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":3,"validations":2,"assertions":1,"updates":0}'::jsonb,
 'teacher identity-only source writes retain a fresh deferred full validation');

select pg_temp.gateway_reset('classroom identity source');
set local role authenticated;
update public.classroom_catalogs set id=id where id=pg_temp.gid(2109);
set local role postgres;
select is((select count(*) from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()),1::bigint,
 'authenticated classroom identity-only writer captures the complete original baseline');
select dashboard_private.assert_timetable_operational_conflicts_v1();
select case when to_regclass('dashboard_private.timetable_close_validation_proofs') is null
 then pass('baseline classroom identity probe has no proof surface')
 else is(pg_temp.gateway_remaining_proofs(),1::bigint,'classroom identity probe creates a real completion proof') end;
set local role authenticated;
update public.classroom_catalogs set id=id where id=pg_temp.gid(2109);
set local role postgres;
select is(pg_temp.gateway_remaining_proofs(),0::bigint,'classroom identity-only writer invalidates the earlier completion proof');
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":3,"validations":2,"assertions":1,"updates":0}'::jsonb,
 'classroom identity-only source writes retain a fresh deferred full validation');

select pg_temp.gateway_reset('identity statement between close assertions');
update gateway_probe set touch_identity_after_inner='classes';
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(407),pg_temp.gateway_patch(407),pg_temp.gid(907))$q$,
 'class identity statement after inner close retains the ordinary gateway path');
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":4,"validations":3,"assertions":2,"updates":3}'::jsonb,
 'class identity statement prevents outer completed-validation reuse');
select pg_temp.gateway_reset('teacher identity statement between close assertions');
update gateway_probe set touch_identity_after_inner='teacher_catalogs';
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(408),pg_temp.gateway_patch(408),pg_temp.gid(908))$q$,
 'teacher identity statement after inner close retains the ordinary gateway path');
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":4,"validations":3,"assertions":2,"updates":2}'::jsonb,
 'teacher identity statement prevents outer completed-validation reuse');
select pg_temp.gateway_reset('classroom identity statement between close assertions');
update gateway_probe set touch_identity_after_inner='classroom_catalogs';
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(409),pg_temp.gateway_patch(409),pg_temp.gid(909))$q$,
 'classroom identity statement after inner close retains the ordinary gateway path');
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":4,"validations":3,"assertions":2,"updates":2}'::jsonb,
 'classroom identity statement prevents outer completed-validation reuse');

select pg_temp.gateway_reset('timezone context shift');
update gateway_probe set shift_timezone_after_inner=true;
insert into gateway_evidence values('timezone-before',pg_temp.gateway_state());
set local role authenticated;
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(411),pg_temp.gateway_patch(411),pg_temp.gid(911))$q$,
 '55000','audit_chain_continuity_invalid',
 'TimeZone shift retains the ordinary outer UPDATE audit rejection instead of reusing its prior context');
set local role postgres;
select is(pg_temp.gateway_state(),(select v from gateway_evidence where k='timezone-before'),
 'TimeZone context mismatch rolls back the nested close, audit, receipts and original baseline');
select set_config('TimeZone',(select timezone from gateway_settings),true);
select pg_temp.gateway_reset('datestyle context shift');
update gateway_probe set shift_datestyle_after_inner=true;
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(412),pg_temp.gateway_patch(412),pg_temp.gid(912))$q$,
 'DateStyle shift after inner close preserves ordinary validation');
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":4,"validations":3,"assertions":2,"updates":2}'::jsonb,
 'DateStyle binding prevents reuse of the earlier validated context');
select set_config('DateStyle',(select datestyle from gateway_settings),true);

-- Eligibility is global: a completely unrelated retained legacy makeup can
-- depend on an unlocked approved-history source. Both producer state shapes
-- must force the original full path, including an empty primary state field.
insert into public.classes(id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,
 student_ids,waitlist_ids,textbook_ids,textbook_usage,lessons,schedule_storage_mode,schedule_plan)
select pg_temp.gid(401),'Gateway unrelated retained makeup',class_type,subject,grade,teacher,schedule,room,
 capacity,fee,'개강 준비',student_ids,waitlist_ids,textbook_ids,textbook_usage,lessons,'legacy',
 jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object('id','global-makeup','date','2000-02-07',
 'scheduleState','makeup','state','makeup','startTime','18:00','endTime','19:00',
 'teacherCatalogId',pg_temp.gid(1117),'classroomCatalogId',pg_temp.gid(2117))))
from public.classes where id=pg_temp.gid(109);
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
select pg_temp.gateway_flush();
select ok(exists(select 1 from jsonb_array_elements(dashboard_private.read_timetable_operating_reference_v1()->'datedSessions') s
 where s->>'classId'=pg_temp.gid(401)::text and s->>'state'='makeup' and s->>'teacherId'=pg_temp.gid(1117)::text),
 'unrelated retained makeup fixture has real resolved historical occupancy');
select pg_temp.gateway_reset('global legacy makeup');
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(402),pg_temp.gateway_patch(402),pg_temp.gid(902))$q$,
 'unrelated legacy makeup retains normal close behavior');
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":4,"validations":3,"assertions":2,"updates":2}'::jsonb,
 'any unrelated retained legacy makeup disables outer validation reuse');
update public.classes set schedule_plan=jsonb_set(schedule_plan,'{sessions,0,scheduleState}','""') where id=pg_temp.gid(401);
select pg_temp.gateway_flush();
select pg_temp.gateway_reset('empty primary makeup state');
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(403),pg_temp.gateway_patch(403),pg_temp.gid(903))$q$,
 'empty primary scheduleState with secondary makeup still closes normally');
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":4,"validations":3,"assertions":2,"updates":2}'::jsonb,
 'empty primary scheduleState cannot hide secondary makeup from global eligibility');
update public.classes set schedule_plan='{"sessions":{}}' where id=pg_temp.gid(401);
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
select pg_temp.gateway_flush();
select pg_temp.gateway_reset('global malformed legacy history');
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(404),pg_temp.gateway_patch(404),pg_temp.gid(904))$q$,
 'retained malformed history keeps normal close semantics');
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":4,"validations":3,"assertions":2,"updates":2}'::jsonb,
 'unrelated malformed legacy history disables completed-validation reuse');
delete from public.classes where id=pg_temp.gid(401);
select pg_temp.gateway_flush();

-- Missing normalized UUIDs remain resolvable by exact snapshot names, but
-- those names are another unlocked producer. Test slots and sessions separately.
update public.classes set schedule_storage_mode='normalized',status='수강' where id=pg_temp.gid(406);
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_catalog_id,teacher_name,
 classroom_catalog_id,classroom_name) values(pg_temp.gid(4501),pg_temp.gid(406),3,'15:00','16:00',null,
 'Gateway teacher 117',null,'Gateway room 117');
select set_config('app.class_schedule_mutation',(select schedule_context from gateway_settings),true);
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
select pg_temp.gateway_flush();
select ok(exists(select 1 from jsonb_array_elements(dashboard_private.read_timetable_operating_reference_v1()->'shadowSlots') s
 where s->>'classId'=pg_temp.gid(406)::text and s->>'teacherId'=pg_temp.gid(1117)::text
 and s->>'classroomId'=pg_temp.gid(2117)::text),
 'normalized slot NULL UUIDs really resolve through known unique snapshot names');
select pg_temp.gateway_reset('global normalized slot fallback');
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(405),pg_temp.gateway_patch(405),pg_temp.gid(905))$q$,
 'known normalized name fallback retains normal unrelated close behavior');
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":4,"validations":3,"assertions":2,"updates":2}'::jsonb,
 'any normalized slot missing catalog UUIDs disables completed-validation reuse');
select set_config('app.class_schedule_mutation','release2-rpc',true);
update public.class_schedule_slots set teacher_catalog_id=pg_temp.gid(1117),classroom_catalog_id=pg_temp.gid(2117)
where id=pg_temp.gid(4501);
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,
 teacher_catalog_id,teacher_name_snapshot,classroom_catalog_id,classroom_name_snapshot,origin)
values(pg_temp.gid(4502),pg_temp.gid(406),'global-normalized-fallback','2000-03-06','active','15:00','16:00',
 null,'Gateway teacher 117',null,'Gateway room 117','manual');
select set_config('app.class_schedule_mutation',(select schedule_context from gateway_settings),true);
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
select pg_temp.gateway_flush();
select ok(exists(select 1 from jsonb_array_elements(dashboard_private.read_timetable_operating_reference_v1()->'datedSessions') s
 where s->>'classId'=pg_temp.gid(406)::text and s->>'teacherId'=pg_temp.gid(1117)::text
 and s->>'classroomId'=pg_temp.gid(2117)::text),
 'normalized session NULL UUIDs really resolve through known unique snapshot names');
select pg_temp.gateway_reset('global normalized session fallback');
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(410),pg_temp.gateway_patch(410),pg_temp.gid(910))$q$,
 'known normalized session fallback retains normal unrelated close behavior');
set local role postgres;
select pg_temp.gateway_flush();
select is(pg_temp.gateway_counts(),'{"reads":4,"validations":3,"assertions":2,"updates":2}'::jsonb,
 'any normalized session missing catalog UUIDs disables completed-validation reuse');
select set_config('app.class_schedule_mutation','release2-rpc',true);
delete from public.class_lesson_sessions where id=pg_temp.gid(4502);
delete from public.class_schedule_slots where id=pg_temp.gid(4501);
delete from public.classes where id=pg_temp.gid(406);
select set_config('app.class_schedule_mutation',(select schedule_context from gateway_settings),true);
select pg_temp.gateway_flush();

-- Acquire the real narrow historical exemption, then revoke it between the
-- inner and outer close boundaries. Equal occupancy and equal baseline alone
-- do not prove that the just-accepted authorization context is still valid.
create function pg_temp.gateway_past_day() returns date language sql stable as
$$select (now() at time zone 'Asia/Seoul')::date-1$$;
insert into public.classes(id,name,subject,status,schedule_storage_mode,schedule,teacher,room,
 schedule_plan,student_ids,waitlist_ids) values
 (pg_temp.gid(301),'Gateway historical correction','영어','수강','legacy',
 (array['일','월','화','수','목','금','토'])[extract(dow from pg_temp.gateway_past_day())::int+1]||' 17:00-19:00',
 'Gateway teacher 119','Gateway room 119',jsonb_build_object('sessions',jsonb_build_array(
 jsonb_build_object('id','gateway-retained-skipped','date',pg_temp.gateway_past_day(),
 'state','skipped','scheduleState','skipped','isForced',false,'startTime','17:00','endTime','19:00',
 'teacherCatalogId',pg_temp.gid(1119),'classroomCatalogId',pg_temp.gid(2119)))),'[]','[]'),
 (pg_temp.gid(302),'Gateway historical unknown','영어','개강 준비','legacy',
 '월 08:00-09:00','Gateway teacher 118','Gateway room 118',jsonb_build_object('sessions',jsonb_build_array(
 jsonb_build_object('id','gateway-historical-unknown','date',pg_temp.gateway_past_day(),
 'state','active','scheduleState','active','isForced',false,'startTime',null,'endTime',null,
 'teacherCatalogId',null,'classroomCatalogId',null))),'[]','[]'),
 (pg_temp.gid(303),'Gateway context close','영어','수강','legacy',
 '월 10:00-11:00','Gateway teacher 118','Gateway room 118','{"sessions":[]}','[]','[]');
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
select pg_temp.gateway_flush();
insert into gateway_evidence values('correction-source',(select schedule_plan from public.classes where id=pg_temp.gid(301)));
set local role authenticated;
insert into gateway_evidence values('context-review',public.preview_past_lesson_state_correction_v1(
 pg_temp.gid(301),(select v from gateway_evidence where k='correction-source'),'gateway-retained-skipped',
 pg_temp.gateway_past_day(),'skipped','active','Synthetic gateway context review',null,false));
select ok((select (v->>'unknownOccupancyCount')::int>0 from gateway_evidence where k='context-review'),
 'real historical correction review observes the retained wildcard blocker');
insert into gateway_evidence values('context-correction',public.save_past_lesson_state_correction_v1(
 pg_temp.gid(301),(select v from gateway_evidence where k='correction-source'),'gateway-retained-skipped',
 pg_temp.gateway_past_day(),'skipped','active','Synthetic gateway context review',pg_temp.gid(801),
 (select v->>'unknownOccupancyReviewHash' from gateway_evidence where k='context-review'),true));
set local role postgres;
select is((select count(*) from dashboard_private.past_lesson_state_correction_contexts where transaction_id=txid_current()),1::bigint,
 'real correction writer leaves its private pending validation context');
select pg_temp.gateway_reset('revoked private authorization context');
update gateway_probe set remove_context_after_inner=true;
insert into gateway_evidence values('context-revoke-before',pg_temp.gateway_state());
set local role authenticated;
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(303),'{"status":"종강"}',pg_temp.gid(803))$q$,
 '23P01','timetable_resource_conflict','outer assertion rejects equal occupancy whose private historical exemption was revoked');
set local role postgres;
select is(pg_temp.gateway_counts()->>'assertions','2','private-context revocation is checked at the preserved outer boundary');
select is(pg_temp.gateway_state(),(select v from gateway_evidence where k='context-revoke-before'),
 'context rejection restores the earlier correction context and baseline and rolls back the unrelated close');
select pg_temp.gateway_reset('changed historical authorization');
update gateway_probe set ban_actor_after_inner=true;
insert into gateway_evidence values('context-ban-before',pg_temp.gateway_state());
set local role authenticated;
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(303),'{"status":"종강"}',pg_temp.gid(804))$q$,
 '23P01','timetable_resource_conflict','outer assertion rejects an unchanged private exemption whose administrator became banned');
set local role postgres;
select is(pg_temp.gateway_state(),(select v from gateway_evidence where k='context-ban-before'),
 'authorization rejection rolls back the ban and unrelated close while retaining the earlier correction');
update gateway_probe set ban_actor_after_inner=false;
select lives_ok($q$select pg_temp.gateway_flush()$q$,'restored real correction authorization passes its fresh deferred validation');

-- These optional-surface checks pass on the unchanged baseline (which has no
-- reuse surface), and enforce private ACLs once the candidate is installed.
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) role_name
 where has_table_privilege(role_name,to_regclass('dashboard_private.timetable_close_validation_proofs'),
 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
 'completion proof storage exposes no read or write capability to API roles');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) role_name,
 unnest(array[to_regprocedure('dashboard_private.timetable_validation_actor_context_v1()'),
 to_regprocedure('dashboard_private.timetable_close_validation_reuse_eligible_v1()'),
 to_regprocedure('dashboard_private.arm_timetable_close_validation_reuse_v1(public.classes)')]) helper
 where has_function_privilege(role_name,helper,'EXECUTE')),
 'completion proof helpers expose no EXECUTE capability to API roles');
insert into gateway_evidence values('proof-surfaces',jsonb_build_object(
 'storage',to_regclass('dashboard_private.timetable_close_validation_proofs') is not null,
 'arm',to_regprocedure('dashboard_private.arm_timetable_close_validation_reuse_v1(public.classes)') is not null,
 'eligible',to_regprocedure('dashboard_private.timetable_close_validation_reuse_eligible_v1()') is not null));
set local role authenticated;
select case when not (select (v->>'storage')::boolean from gateway_evidence where k='proof-surfaces')
 then pass('unchanged baseline has no client-writable proof surface')
 else throws_ok($q$insert into dashboard_private.timetable_close_validation_proofs default values$q$,
 '42501',null,'authenticated caller cannot forge a completion proof') end;
select case when not (select (v->>'arm')::boolean from gateway_evidence where k='proof-surfaces')
 then pass('unchanged baseline has no client-callable proof arming helper')
 else throws_ok($q$select dashboard_private.arm_timetable_close_validation_reuse_v1(c)
 from public.classes c where id=pg_temp.gid(101)$q$,'42501',null,
 'authenticated caller cannot arm completed-validation reuse') end;
select case when not (select (v->>'eligible')::boolean from gateway_evidence where k='proof-surfaces')
 then pass('unchanged baseline has no client-callable eligibility helper')
 else throws_ok($q$select dashboard_private.timetable_close_validation_reuse_eligible_v1()$q$,
 '42501',null,'authenticated caller cannot invoke global reuse eligibility') end;
set local role postgres;
select is(pg_temp.gateway_remaining_proofs(),0::bigint,'fresh finalization leaves no reusable proof for the transaction');

select is((select count(*) from dashboard_private.notification_events),(select events from gateway_no_send),
 'all synthetic class-close/no-op/real-edit/rejection paths create no notification event');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from gateway_no_send),
 'all tested paths create no notification delivery');

-- Restore exact definitions before ending, independently of transaction rollback.
do $restore$declare r record;begin for r in select definition from gateway_originals loop execute r.definition;end loop;end $restore$;
select ok(not exists(select 1 from gateway_originals o where o.definition is distinct from
 case o.kind when 'reader' then pg_get_functiondef('dashboard_private.read_timetable_operating_reference_v1()'::regprocedure)
 when 'validator' then pg_get_functiondef('dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure)
 else pg_get_functiondef('dashboard_private.assert_timetable_operational_conflicts_v1()'::regprocedure) end),
 'runtime instrumentation restores every exact active function definition');
select ok((select bool_and(p.prosecdef and pg_get_userbyid(p.proowner)='postgres'
 and cardinality(p.proconfig)=1 and p.proconfig[1]=any(array['search_path=','search_path=""']))
 from pg_proc p where p.oid=any(array[
 'dashboard_private.read_timetable_operating_reference_v1()'::regprocedure,
 'dashboard_private.assert_timetable_operational_conflicts_v1()'::regprocedure,
 'dashboard_private.timetable_operating_finalize_v1()'::regprocedure]))
 and not exists(select 1 from unnest(array['anon','authenticated','service_role']) api_role,
 unnest(array['dashboard_private.read_timetable_operating_reference_v1()'::regprocedure,
 'dashboard_private.assert_timetable_operational_conflicts_v1()'::regprocedure,
 'dashboard_private.timetable_operating_finalize_v1()'::regprocedure]) private_function
 where has_function_privilege(api_role,private_function,'EXECUTE')),
 'reader, assertion wrapper and finalizer retain postgres-owned definer/empty-path/private ACL contracts');

-- #234 owner-approved policy: all actual session types release occupancy from
-- the KST close day. This projection does not delete lesson/history records.
select set_config('app.class_close_mutation','v1',true);
insert into public.classes(id,name,subject,status,schedule_storage_mode,closed_at,student_ids,waitlist_ids,schedule_plan)
values
 (pg_temp.gid(450),'Synthetic stamped close','영어','종강','legacy',
  ((now() at time zone 'Asia/Seoul')::date::text||' 00:30:00+09')::timestamptz,'[]','[]','{}'),
 (pg_temp.gid(451),'Synthetic undated close','영어','종강','legacy',null,'[]','[]','{}'),
 (pg_temp.gid(452),'Synthetic active peer','영어','수강','legacy',null,'[]','[]','{}'),
 (pg_temp.gid(453),'Synthetic prior stamped close','영어','종강','legacy',
  (((now() at time zone 'Asia/Seoul')::date-7)::text||' 00:30:00+09')::timestamptz,'[]','[]','{}');
select set_config('app.class_close_mutation','',true);
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;set constraints all deferred;
create temp table release_wire as
select jsonb_build_object('asOfDate',(now() at time zone 'Asia/Seoul')::date,
 'datedSessions',(select jsonb_agg(jsonb_build_object('id',kind||':'||delta,'classId',pg_temp.gid(450),
   'date',(now() at time zone 'Asia/Seoul')::date+delta,'state',kind) order by kind,delta)
   from unnest(array['active','exception','makeup','skipped','tbd']) kind cross join generate_series(-1,1) delta),
 'datedUnresolvedOccupancies',jsonb_build_array(
   jsonb_build_object('classId',pg_temp.gid(450),'date',(now() at time zone 'Asia/Seoul')::date,'reason','unresolved_resource'),
   jsonb_build_object('classId',pg_temp.gid(450),'date',null,'reason','incomplete_read'),
   jsonb_build_object('classId',pg_temp.gid(452),'date',(now() at time zone 'Asia/Seoul')::date,'reason','unresolved_resource')),
 'datedFingerprint','all-raw-history','shadowFingerprint','weekly-and-raw','datedComplete',false,
 'shadowSlots','[]'::jsonb,'unresolvedOccupancies','[]'::jsonb) value;
create temp table release_result as select dashboard_private.project_class_close_occupancy_v1(value) value from release_wire;
select is(jsonb_array_length((select value->'datedSessions' from release_result)),5,'all five source states retain yesterday only');
select ok(not exists(select 1 from release_result,jsonb_array_elements(value->'datedSessions') e
 where (e->>'date')::date>=(now() at time zone 'Asia/Seoul')::date),'close day and all future session states are nonoccupying');
select is(jsonb_array_length((select value->'datedUnresolvedOccupancies' from release_result)),2,
 'known closed-day uncertainty releases while date-unknown and active-peer blockers remain');
select is(jsonb_array_length((select value->'datedSessions' from release_wire)),15,'projection leaves raw source input unchanged');
select is((select value->'datedSessions' from release_result),
 (select jsonb_agg(e order by ord) from release_wire,jsonb_array_elements(value->'datedSessions') with ordinality a(e,ord)
 where (e->>'date')::date<(now() at time zone 'Asia/Seoul')::date),'past source JSON and multiplicity are preserved exactly');
select isnt((select value->>'datedFingerprint' from release_result),'all-raw-history','release updates dated fingerprint');
select isnt((select value->>'shadowFingerprint' from release_result),'weekly-and-raw','release updates operating fingerprint');
select is((select value->>'datedComplete' from release_result),'false','retained unknown remains incomplete');
-- Date-less legacy closed rows use current KST day, not end_date/updated_at or an invented historical close.
select is(jsonb_array_length(dashboard_private.project_class_close_occupancy_v1(
 (select jsonb_set(value,'{datedSessions}',replace((value->'datedSessions')::text,pg_temp.gid(450)::text,pg_temp.gid(451)::text)::jsonb) from release_wire))
 ->'datedSessions'),5,'undated legacy close releases current/future and conservatively retains the past');
-- An already-closed stamped row must use its stored day, not today's fallback.
select is(dashboard_private.project_class_close_occupancy_v1(jsonb_build_object(
 'datedSessions',(select jsonb_agg(jsonb_build_object('id','older-'||delta,'classId',pg_temp.gid(453),
 'date',(now() at time zone 'Asia/Seoul')::date+delta) order by delta) from unnest(array[-8,-7,-1,0]) delta),
 'datedUnresolvedOccupancies','[]'::jsonb,'datedFingerprint','prior-raw','shadowFingerprint','prior-shadow'))
 ->'datedSessions',jsonb_build_array(jsonb_build_object('id','older--8','classId',pg_temp.gid(453),
 'date',(now() at time zone 'Asia/Seoul')::date-8)),
 'already closed stamped class retains only dates before its original Korean close day');
set local timezone='UTC';
select is(dashboard_private.project_class_close_occupancy_v1((select value from release_wire)),
 (select value from release_result),'close day is KST independent of session timezone');
set local timezone='Asia/Seoul';
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) api_role
 where has_function_privilege(api_role,'dashboard_private.project_class_close_occupancy_v1(jsonb)','EXECUTE')),
 'release helper has no API execute grant');
-- No new reopen permission: the existing close guard still owns lifecycle writes.
set local role authenticated;
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(450),'{"status":"수강"}',pg_temp.gid(9450))$q$,
 '42501','class_close_requires_rpc','ordinary metadata writer cannot reopen a closed class');
set local role postgres;
-- Owner-only fixture restoration models a legitimately active reference; it is
-- not a new public reopen RPC or an operational data change.
savepoint release_reactivation;
select set_config('app.class_close_mutation','v1',true);
update public.classes set status='수강',closed_at=null,closed_by=null where id=pg_temp.gid(450);
select set_config('app.class_close_mutation','',true);
select is(jsonb_array_length(dashboard_private.project_class_close_occupancy_v1((select value from release_wire))->'datedSessions'),
 15,'reactivated lifecycle restores current/future operating rows');
rollback to release_reactivation;release release_reactivation;
select is((select status from public.classes where id=pg_temp.gid(450)),'종강','synthetic reactivation rollback preserves source status');
select ok((select closed_at is null from public.classes where id=pg_temp.gid(451)),'legacy fallback does not backfill a close date');

-- Actual producers, not only helper fixtures: stamped legacy/normalized classes
-- retain yesterday and release every current/future type in both query windows.
select set_config('app.class_close_mutation','v1',true);
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.teacher_catalogs(id,name,subjects) values(pg_temp.gid(1460),'Release fixture teacher',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.gid(2460),'Release fixture room',array['영어']);
insert into public.classes(id,name,subject,status,schedule_storage_mode,closed_at,student_ids,waitlist_ids,schedule_plan)
values(pg_temp.gid(460),'Release legacy source','영어','종강','legacy',now(),'[]','[]',
 jsonb_build_object('sessions',(select jsonb_agg(jsonb_build_object('id','legacy-'||delta||'-'||kind,
 'date',(now() at time zone 'Asia/Seoul')::date+delta,'scheduleState',kind,'isForced',true,
 'startTime','17:00','endTime','18:00','teacherCatalogId',pg_temp.gid(1460),'classroomCatalogId',pg_temp.gid(2460)) order by delta,kind)
 from generate_series(-1,1) delta cross join unnest(array['active','makeup']) kind))),
 (pg_temp.gid(461),'Release normalized source','영어','종강','normalized',now(),'[]','[]','{}'),
 (pg_temp.gid(462),'Release active peer','영어','수강','normalized',null,'[]','[]','{}'),
 (pg_temp.gid(464),'Release single reactivation target','영어','종강','normalized',now(),'[]','[]','{}'),
 (pg_temp.gid(463),'Release mixed target','영어','수강','legacy',null,'[]','[]',
 jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object('id','mixed-future',
 'date',(now() at time zone 'Asia/Seoul')::date+1,'scheduleState','active','startTime','17:00','endTime','18:00',
 'teacherCatalogId',pg_temp.gid(1460),'classroomCatalogId',pg_temp.gid(2460)))));
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,
 teacher_catalog_id,classroom_catalog_id,origin)
select pg_temp.gid(10000+row_number() over(order by delta,kind)::int),pg_temp.gid(461),'release-'||delta||'-'||kind,
 (now() at time zone 'Asia/Seoul')::date+delta,kind,'17:00','18:00',pg_temp.gid(1460),pg_temp.gid(2460),'manual'
from generate_series(-1,1) delta cross join unnest(array['active','exception','makeup','skipped','tbd']) kind;
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,
 teacher_catalog_id,classroom_catalog_id,origin)
values(pg_temp.gid(10020),pg_temp.gid(462),'active-peer',(now() at time zone 'Asia/Seoul')::date+1,
 'active','17:00','18:00',pg_temp.gid(1460),pg_temp.gid(2460),'manual'),
 (pg_temp.gid(10021),pg_temp.gid(464),'reactivation-single',(now() at time zone 'Asia/Seoul')::date+1,
 'active','17:00','18:00',pg_temp.gid(1460),pg_temp.gid(2460),'manual');
select set_config('app.class_close_mutation','',true);
select set_config('app.class_schedule_mutation','',true);
-- Only synthetic fixture arrangement admits the initial overlapping rows.
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;set constraints all deferred;
create temp table release_sources as select
 (select jsonb_agg(to_jsonb(c) order by id) from public.classes c where id in(pg_temp.gid(460),pg_temp.gid(461))) classes,
 (select jsonb_agg(to_jsonb(s) order by id) from public.class_lesson_sessions s where class_id=pg_temp.gid(461)) lessons,
 (select to_jsonb(s) from public.class_lesson_sessions s where id=pg_temp.gid(10021)) reactivation_lesson;
create temp table release_producers as select dashboard_private.read_timetable_operating_reference_v1() full_ref,
 dashboard_private.read_makeup_operating_reference_v1((now() at time zone 'Asia/Seoul')::date-1,(now() at time zone 'Asia/Seoul')::date+1) window_ref;
select ok(not exists(select 1 from release_producers,jsonb_array_elements((full_ref->'datedSessions')||(full_ref->'datedUnresolvedOccupancies')) x
 where x->>'classId' in(pg_temp.gid(460)::text,pg_temp.gid(461)::text)
 and (x->>'date')::date>=(now() at time zone 'Asia/Seoul')::date),
 'actual full reader releases legacy manual/makeup and all normalized future states');
select is((select count(*) from release_producers,jsonb_array_elements(full_ref->'datedSessions') x
 where x->>'classId'=pg_temp.gid(461)::text),5::bigint,'actual reader retains all five yesterday normalized states');
select is((select jsonb_agg(x order by x::text) from release_producers,jsonb_array_elements(full_ref->'datedSessions') x
 where x->>'classId' in(pg_temp.gid(460)::text,pg_temp.gid(461)::text)),
 (select jsonb_agg(x order by x::text) from release_producers,jsonb_array_elements(window_ref->'datedSessions') x
 where x->>'classId' in(pg_temp.gid(460)::text,pg_temp.gid(461)::text)),
 'global and bounded readers agree on retained synthetic sessions');
select is((select jsonb_agg(x order by x::text) from release_producers,jsonb_array_elements(full_ref->'datedUnresolvedOccupancies') x
 where x->>'classId' in(pg_temp.gid(460)::text,pg_temp.gid(461)::text)),
 (select jsonb_agg(x order by x::text) from release_producers,jsonb_array_elements(window_ref->'datedUnresolvedOccupancies') x
 where x->>'classId' in(pg_temp.gid(460)::text,pg_temp.gid(461)::text)),
 'global and bounded readers agree on retained synthetic blockers');
select is((select jsonb_agg(to_jsonb(c) order by id) from public.classes c where id in(pg_temp.gid(460),pg_temp.gid(461))),
 (select classes from release_sources),'both readers preserve original closed class source');
select is((select jsonb_agg(to_jsonb(s) order by id) from public.class_lesson_sessions s where class_id=pg_temp.gid(461)),
 (select lessons from release_sources),'both readers preserve all fifteen normalized source lessons');
-- A future source change in the same close is also nonoccupying under the
-- approved policy. No blanket assert/finalizer bypass or new mixed-input ban.
savepoint release_mixed_close;
set local role authenticated;
select lives_ok($q$select public.update_class_operational_v1(pg_temp.gid(463),
 '{"status":"종강","teacher":"Release fixture teacher","room":"Release fixture room","schedule":"월 17:00-18:00"}',pg_temp.gid(9463))$q$,
 'valid mixed close retains source edits but releases its future resource occupancy');
set local role postgres;
set constraints all immediate;set constraints all deferred;
select is((select schedule from public.classes where id=pg_temp.gid(463)),'월 17:00-18:00','mixed source schedule remains recorded');
select is((select count(*) from jsonb_array_elements(dashboard_private.read_timetable_operating_reference_v1()->'datedSessions') x
 where x->>'classId'=pg_temp.gid(463)::text),0::bigint,'mixed closed future source is nonoccupying');
rollback to release_mixed_close;release release_mixed_close;
-- Past source changes remain operating and cannot hide behind the close flag.
set local role authenticated;
select throws_ok($q$select public.update_class_operational_v1(pg_temp.gid(463),
 jsonb_build_object('status','종강','schedule_plan',
 jsonb_build_object('sessions',jsonb_build_array(jsonb_build_object('id','mixed-new-past',
 'date',(now() at time zone 'Asia/Seoul')::date-1,'scheduleState','active','startTime','17:00','endTime','18:00',
 'teacherCatalogId',pg_temp.gid(1460),'classroomCatalogId',pg_temp.gid(2460))))),pg_temp.gid(9464),
 (select schedule_plan from public.classes where id=pg_temp.gid(463)))$q$,
 '23P01','timetable_resource_conflict','mixed close cannot introduce a new pre-close dated collision');
set local role postgres;
select is((select status from public.classes where id=pg_temp.gid(463)),'수강','past conflict rolls back nested close');
select is((select schedule_plan#>>'{sessions,0,id}' from public.classes where id=pg_temp.gid(463)),
 'mixed-future','past conflict rolls back source patch');
select is((select count(*) from dashboard_private.class_schedule_mutation_receipts where request_key=pg_temp.gid(9464)),
 0::bigint,'past conflict rolls back inner and outer receipts');
-- Owner-only reactivation fixture must re-enter the original conflict validator.
-- No API capability or production reopen workflow is introduced.
create function pg_temp.release_reactivate_conflict() returns void language plpgsql as $$begin
 perform set_config('app.class_close_mutation','v1',true);
 update public.classes set status='수강',closed_at=null,closed_by=null where id=pg_temp.gid(464);
 perform set_config('app.class_close_mutation','',true);
 perform dashboard_private.assert_timetable_operational_conflicts_v1();
end$$;
select throws_ok($q$select pg_temp.release_reactivate_conflict()$q$,'23P01','timetable_resource_conflict',
 'single-session reactivation restores occupancy and rejects a newly live peer collision');
select is((select status from public.classes where id=pg_temp.gid(464)),'종강','failed synthetic reactivation rolls back state');
select is((select to_jsonb(s) from public.class_lesson_sessions s where id=pg_temp.gid(10021)),
 (select reactivation_lesson from release_sources),'failed reactivation preserves its exact source lesson');

select * from finish();
rollback;
