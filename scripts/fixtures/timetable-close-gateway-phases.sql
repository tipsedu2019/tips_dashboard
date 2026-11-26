-- Synthetic-only input from the original gateway regression; all writes roll back.
set local timezone='Asia/Seoul';
set local datestyle='ISO, MDY';
set local statement_timeout='8s';
set local lock_timeout='2s';
set local track_functions='pl';
create function pg_temp.proof_id(n int) returns uuid language sql immutable as
$$select ('fe101234-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
-- Synthetic fixture preparation only. Measured writer and validator calls use
-- origin mode, original application triggers, and the final migration body.
set local session_replication_role=replica;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values(pg_temp.proof_id(901),'authenticated','authenticated','close-proof-admin@test.invalid','{}','{}');
insert into public.profiles(id,role,name) values(pg_temp.proof_id(901),'admin','Synthetic proof administrator')
on conflict(id) do update set role='admin';
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version)
values(true,1) on conflict(singleton) do update set version=1;
insert into public.class_schedule_sync_groups(id,name,is_default)
select pg_temp.proof_id(902),'Synthetic proof default',true
where not exists(select 1 from public.class_schedule_sync_groups where is_default);
insert into public.teacher_catalogs(id,name,subjects)
select pg_temp.proof_id(100+n),'Proof teacher '||n,array['영어'] from generate_series(1,3) n;
insert into public.classroom_catalogs(id,name,subjects)
select pg_temp.proof_id(200+n),'Proof room '||n,array['영어'] from generate_series(1,3) n;
insert into public.classes(id,name,subject,class_type,grade,teacher,room,schedule,status,
 capacity,fee,student_ids,waitlist_ids,textbook_ids,textbook_usage,lessons,schedule_storage_mode,schedule_plan)
select pg_temp.proof_id(n),'Proof class '||n,'영어','정규','중1','Proof teacher '||n,'Proof room '||n,
 '월 09:00-10:00','수강',12,100000,'[]','[]','[]','{}','[]',case when n=3 then 'normalized' else 'legacy' end,
 jsonb_build_object('amount',1,'sessions',case when n=3 then '[]'::jsonb else jsonb_build_array(
 jsonb_build_object('id','proof-active-'||n,'date','2050-01-03','state','active','scheduleState','active',
 'startTime','09:00','endTime','10:00','teacherCatalogId',pg_temp.proof_id(100+n),'classroomCatalogId',pg_temp.proof_id(200+n)),
 jsonb_build_object('id','proof-makeup-'||n,'date','2050-01-04','state','makeup','scheduleState','makeup',
 'startTime','14:00','endTime','15:00','teacherCatalogId',pg_temp.proof_id(100+n),'classroomCatalogId',pg_temp.proof_id(200+n))) end)
from generate_series(1,3) n;
insert into public.class_schedule_sync_group_members(group_id,class_id)
select g.id,pg_temp.proof_id(n) from public.class_schedule_sync_groups g cross join generate_series(1,3) n where g.is_default;
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_catalog_id,teacher_name,classroom_catalog_id,classroom_name)
values(pg_temp.proof_id(301),pg_temp.proof_id(3),1,'09:00','10:00',pg_temp.proof_id(103),'Proof teacher 3',pg_temp.proof_id(203),'Proof room 3');
insert into public.class_lesson_sessions(id,class_id,session_key,source_schedule_slot_id,session_date,schedule_state,start_time,end_time,
 teacher_catalog_id,classroom_catalog_id,teacher_name_snapshot,classroom_name_snapshot,origin)
values(pg_temp.proof_id(302),pg_temp.proof_id(3),'proof-normalized',pg_temp.proof_id(301),'2050-01-03','active','09:00','10:00',
 pg_temp.proof_id(103),pg_temp.proof_id(203),'Proof teacher 3','Proof room 3','default');
insert into public.makeup_requests(id,class_id,status,subject,approval_group,class_name,teacher_catalog_id,cancel_date,
 makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots)
values(pg_temp.proof_id(401),pg_temp.proof_id(2),'completed','영어','english','Proof class 2',pg_temp.proof_id(102),'2050-01-03',
 '2050-01-04 14:00+09','2050-01-04 15:00+09','Proof room 2',
 '[{"startAt":"2050-01-04T05:00:00.000Z","endAt":"2050-01-04T06:00:00.000Z","classroom":"Proof room 2"}]');
insert into public.makeup_request_events(id,request_id,event_type,payload)
values(pg_temp.proof_id(402),pg_temp.proof_id(401),'created','{}');
insert into public.academic_events(id,date,title,note)
values(pg_temp.proof_id(403),'2050-01-01','Synthetic proof calendar','Synthetic only');
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub',pg_temp.proof_id(901)::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.proof_id(901),'role','authenticated')::text,true);

create function pg_temp.proof_calls() returns bigint language sql volatile as
$$select coalesce(sum(calls),0)::bigint from pg_stat_xact_user_functions
 where funcid='dashboard_private.read_timetable_operating_reference_v1()'::regprocedure$$;
create temp table proof_gateway_before as select pg_temp.proof_calls() reader_calls,
 (select coalesce(sum(calls),0) from pg_stat_xact_user_functions where funcid='dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure) validator_calls,
 (select coalesce(sum(calls),0) from pg_stat_xact_user_functions where funcid='dashboard_private.assert_timetable_operational_conflicts_v1()'::regprocedure) assertion_calls;
select set_config('test.proof_gateway_patch',jsonb_build_object('name',name,'class_type',class_type,'subject',subject,'subject_area_key',subject_area_key,
 'grade',grade,'teacher',teacher,'room',room,'schedule',schedule,'capacity',capacity,'fee',fee,
 'status','종강','textbook_ids',textbook_ids,'textbook_usage',textbook_usage)::text,true)
from public.classes where id=pg_temp.proof_id(1);
create function pg_temp.assert_stable_gateway() returns jsonb language plpgsql as $gateway$
declare evidence jsonb;answer jsonb:=current_setting('test.proof_gateway_result')::jsonb;
begin
 select jsonb_build_object('reads',pg_temp.proof_calls()-b.reader_calls,
  'validations',(select coalesce(sum(calls),0)-b.validator_calls from pg_stat_xact_user_functions where funcid='dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure),
  'assertions',(select coalesce(sum(calls),0)-b.assertion_calls from pg_stat_xact_user_functions where funcid='dashboard_private.assert_timetable_operational_conflicts_v1()'::regprocedure),
  'status',answer#>>'{classRow,status}','receiptStatus',answer#>>'{closeResult,status}',
  'proofs',(select count(*) from dashboard_private.timetable_validation_reuse_proofs where transaction_id=txid_current()))
 into evidence from pg_temp.proof_gateway_before b;
 if evidence is distinct from '{"reads":2,"validations":3,"assertions":2,"status":"종강","receiptStatus":"종강","proofs":0}'::jsonb
 then raise exception 'direct authenticated gateway boundary mismatch: %',evidence;end if;
 return evidence;
end $gateway$;

-- Invoker-only observation after RESET ROLE. No privileged wrapper around the
-- actual authenticated RPC/finalizer and no product helper is called here.
-- Snapshots and stored tokens stay in this transaction; output is boolean only.
create temp table gateway_checkpoint(snapshot text, proof jsonb);
create function pg_temp.gateway_observation(stage text) returns jsonb
language plpgsql volatile as $$
declare saved jsonb; baseline jsonb; snapshot_now text:=pg_current_snapshot()::text;
 checkpoint record; result jsonb;
begin
 select to_jsonb(p) into saved from dashboard_private.timetable_validation_reuse_proofs p
 where transaction_id=txid_current();
 select reference into baseline from dashboard_private.timetable_operating_write_baselines
 where transaction_id=txid_current();
 if stage='gateway' then
  insert into pg_temp.gateway_checkpoint values(snapshot_now,saved);
 end if;
 select * into strict checkpoint from pg_temp.gateway_checkpoint;
 perform pg_stat_clear_snapshot();
 select jsonb_build_object(
  'readCommitted',current_setting('transaction_isolation')='read committed',
  'snapshotStable',snapshot_now=checkpoint.snapshot,
  'snapshotMatchesProof',snapshot_now=checkpoint.proof#>>'{input_token,snapshot}',
  'storedProofUnchanged',saved is not distinct from checkpoint.proof,
  'proofExists',saved is not null,'baselineExists',baseline is not null,
  'baselineHashMatches',saved->>'baseline_hash'=to_jsonb(sha256(convert_to(baseline::text,'UTF8')))#>>'{}',
  'otherClientOrWriterAbsent',not exists(select 1 from pg_stat_activity a
   where a.pid<>pg_backend_pid() and (a.backend_type in('client backend','autovacuum worker','logical replication worker','parallel worker') or a.backend_xid is not null)),
  'reads',pg_temp.proof_calls()-b.reader_calls,
  'validations',(select coalesce(sum(calls),0)-b.validator_calls from pg_stat_xact_user_functions where funcid='dashboard_private.validate_timetable_operating_reference_v1()'::regprocedure),
  'assertions',(select coalesce(sum(calls),0)-b.assertion_calls from pg_stat_xact_user_functions where funcid='dashboard_private.assert_timetable_operational_conflicts_v1()'::regprocedure),
  'status',current_setting('test.proof_gateway_result')::jsonb#>>'{classRow,status}',
  'receiptStatus',current_setting('test.proof_gateway_result')::jsonb#>>'{closeResult,status}',
  'savedStatus',(select status from public.classes where id=pg_temp.proof_id(1)),
  'closedInTransaction',(select closed_at=transaction_timestamp() from public.classes where id=pg_temp.proof_id(1)),
  'rosterAndWaitlistEmpty',(select student_ids='[]'::jsonb and waitlist_ids='[]'::jsonb from public.classes where id=pg_temp.proof_id(1)),
  'receipts',(select count(*) from dashboard_private.class_schedule_mutation_receipts where request_key='fe101234-0000-4000-8000-000000000801'))
 into result from pg_temp.proof_gateway_before b;
 return result;
end$$;
