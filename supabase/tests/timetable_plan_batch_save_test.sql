-- Rollback-only synthetic fixtures. Run against the complete ordered local
-- migration chain, including the save_batch extension. No provider is invoked.
begin;
do $$begin
 if not exists(select 1 from pg_catalog.pg_extension where extname='pgtap') then
  create extension pgtap with schema extensions;
 end if;
end $$;
select no_plan();

-- Batch DTO fixture setup start
create function pg_temp.bid(n int) returns uuid language sql immutable as $$
 select ('be3b1000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.bday(d int) returns date language sql stable as $$
 select (now() at time zone 'Asia/Seoul')::date+7+
  ((d-extract(dow from (now() at time zone 'Asia/Seoul')::date)::int+7)%7)
$$;

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
select pg_temp.bid(n),'00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','batch-'||n||'@test.invalid','{}','{}'
from generate_series(901,904) n;
insert into public.profiles(id,role,name,email)
select pg_temp.bid(n),case n when 901 then 'admin' when 902 then 'staff' when 903 then 'teacher' else 'assistant' end,
 'Synthetic batch actor '||n,'batch-'||n||'@test.invalid'
from generate_series(901,904) n on conflict(id) do update set role=excluded.role;
insert into public.teacher_catalogs(id,name,subjects) values
 (pg_temp.bid(101),'Synthetic batch teacher A',array['영어팀']),
 (pg_temp.bid(102),'Synthetic batch teacher B',array['영어']),
 (pg_temp.bid(103),'Synthetic batch deleted teacher',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values
 (pg_temp.bid(201),'Synthetic batch room A',array['영어']),
 (pg_temp.bid(202),'Synthetic batch room B',array['영어']),
 (pg_temp.bid(203),'Synthetic batch deleted room',array['영어']);

-- Nonempty operational/history sentinels stay separate from the draft plans.
insert into public.classes(id,name,subject,grade,status,schedule_storage_mode,
 schedule,teacher,room,schedule_plan,student_ids,waitlist_ids,lessons)
values
 (pg_temp.bid(3001),'Synthetic retained batch class','영어','중2','수강','normalized',
  '토 09:00-10:00','Synthetic batch teacher A','Synthetic batch room A','{}',
  jsonb_build_array(pg_temp.bid(8001)),'[]',
  '[{"id":"retained-batch-lesson","progress":"preserve"}]'),
 (pg_temp.bid(3002),'Synthetic scoped unknown room','영어','중2','수강','legacy',
  '수 18:00-19:00','Synthetic batch teacher B','미정','{}','[]','[]','[]');
insert into public.students(id,name,class_ids,waitlist_class_ids)
values(pg_temp.bid(8001),'Synthetic retained batch student',jsonb_build_array(pg_temp.bid(3001)),'[]');
insert into public.student_class_enrollment_history(id,student_id,class_id,action,next_mode,memo)
values(pg_temp.bid(8002),pg_temp.bid(8001),pg_temp.bid(3001),'enrolled','enrolled','Synthetic retained batch history');
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,
 teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name)
values(pg_temp.bid(3003),pg_temp.bid(3001),6,'09:00','10:00',
 pg_temp.bid(101),pg_temp.bid(201),'Synthetic batch teacher A','Synthetic batch room A');
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,
 schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,
 source_schedule_slot_id,origin,memo)
values(pg_temp.bid(3004),pg_temp.bid(3001),'batch-retained-dated',pg_temp.bday(2),
 'active','15:00','16:00',pg_temp.bid(101),pg_temp.bid(201),pg_temp.bid(3003),
 'manual','Synthetic retained dated reservation');
insert into dashboard_private.notification_events(id,workflow_key,event_key,
 source_type,source_id,occurrence_key,occurred_at,payload_schema_version,payload,rule_snapshot)
values(pg_temp.bid(8003),'registration','synthetic_batch_retained',
 'batch_test',pg_temp.bid(8001)::text,'batch-test-retained',now(),1,
 '{"synthetic":true,"preserve":"history"}','[]');
insert into public.ops_task_notification_deliveries(id,status,payload)
values(pg_temp.bid(8004),'sent','{"synthetic":true,"preserve":"retained"}');
insert into public.makeup_notification_deliveries(id,trigger_kind,channel,status,title,body)
values(pg_temp.bid(8005),'submitted','dashboard_personal','disabled','Synthetic retained delivery','Never dispatch');
-- Historical owner fixtures do not give the authenticated RPC a baseline bypass.
update dashboard_private.timetable_operating_write_baselines
set reference=dashboard_private.read_timetable_operating_reference_v1()
where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;
select set_config('app.class_schedule_mutation','',true);

create function pg_temp.bslot(p int,i int,a int,b int,t int default 101,r int default 201,
 d int default 1,s int default null,source_id uuid default null)
returns jsonb language sql as $$
 select jsonb_build_object('id',pg_temp.bid(coalesce(s,100000+i)),
  'itemId',pg_temp.bid(i),'planId',pg_temp.bid(p),'weekday',d,
  'startMinute',a,'endMinute',b,'teacherId',pg_temp.bid(t),'classroomId',pg_temp.bid(r),
  'sourceSlotId',source_id)
$$;
create function pg_temp.bsave(p int,i int,rev bigint,a int default 600,b int default 660,
 t int default 101,r int default 201,d int default 1,s int default null,source_id uuid default null)
returns jsonb language sql as $$
 select jsonb_build_object('operation','save','expectedItemRevision',rev,
  'item',jsonb_build_object('id',pg_temp.bid(i),'planId',pg_temp.bid(p),
   'name','Synthetic batch lesson '||i,'subject','영어','subjectAreaKey',null,'grade','중2',
   'capacity',12,'tuition',100000,'defaultTeacherId',pg_temp.bid(t),
   'defaultClassroomId',pg_temp.bid(r),'durationMinutes',60,'pendingSlots','[]'::jsonb),
  'slots',jsonb_build_array(pg_temp.bslot(p,i,a,b,t,r,d,s,source_id)))
$$;
create function pg_temp.bdelete(i int,rev bigint) returns jsonb language sql as $$
 select jsonb_build_object('operation','delete','itemId',pg_temp.bid(i),'expectedItemRevision',rev)
$$;
create function pg_temp.bcommand(p int,edits jsonb,k text) returns jsonb language sql as $$
 select jsonb_build_object('operation','save_batch','planId',pg_temp.bid(p),
  'expectedMetaRevision',(v->>'metaRevision')::bigint,
  'expectedChangeSequence',(v->>'changeSequence')::bigint,
  'expectedShadowFingerprint',v->>'shadowFingerprint','requestKey',k,'edits',edits)
 from (select public.get_timetable_plan_revision_v1(pg_temp.bid(p)) v) x
$$;
create function pg_temp.bseed(p int,n int default 0) returns void
language plpgsql as $$begin
 insert into public.timetable_plans(id,name,created_by)
 values(pg_temp.bid(p),'Synthetic batch plan '||p,pg_temp.bid(901));
 insert into public.timetable_plan_items(id,plan_id,name,subject,grade,capacity,tuition,
  default_teacher_id,default_classroom_id,duration_minutes)
 select pg_temp.bid(p*100+g),pg_temp.bid(p),'Synthetic batch lesson '||(p*100+g),
  '영어','중2',12,100000,pg_temp.bid(101),pg_temp.bid(201),60
 from generate_series(1,n) g;
 insert into public.timetable_plan_slots(id,plan_id,item_id,weekday,start_minute,end_minute,
  teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name)
 select pg_temp.bid(100000+p*100+g),pg_temp.bid(p),pg_temp.bid(p*100+g),1,
  600+60*(g-1),660+60*(g-1),pg_temp.bid(101),pg_temp.bid(201),
  'Synthetic batch teacher A','Synthetic batch room A'
 from generate_series(1,n) g;
end $$;

select pg_temp.bseed(1,2); -- two-item swap
select pg_temp.bseed(2,3); -- three-item cycle
select pg_temp.bseed(3,2); -- save/create/delete mixture
select pg_temp.bseed(4,3); -- unchanged rollback baseline for rejection matrix
select pg_temp.bseed(5,1); -- tombstone grandfathering
select pg_temp.bseed(6,1); -- applied item
select pg_temp.bseed(7);   -- final item capacity including an applied item
select pg_temp.bseed(8);   -- final slot capacity
select pg_temp.bseed(9,1); -- archived plan
select pg_temp.bseed(10,1);-- imported slot provenance
select pg_temp.bseed(12);  -- dated validation
select pg_temp.bseed(13);  -- independent resources and adjacent intervals
select pg_temp.bseed(14);  -- old save/delete wire contract
update public.timetable_plan_slots set teacher_catalog_id=pg_temp.bid(103),
 classroom_catalog_id=pg_temp.bid(203),teacher_name='Synthetic batch deleted teacher',
 classroom_name='Synthetic batch deleted room' where item_id=pg_temp.bid(501);
update public.timetable_plan_items set default_teacher_id=pg_temp.bid(103),
 default_classroom_id=pg_temp.bid(203) where id=pg_temp.bid(501);
delete from public.teacher_catalogs where id=pg_temp.bid(103);
delete from public.classroom_catalogs where id=pg_temp.bid(203);
insert into dashboard_private.timetable_plan_transfers(id,request_key,actor_id,source_plan_id,result)
values(pg_temp.bid(7001),'synthetic-batch-applied',pg_temp.bid(901),pg_temp.bid(6),'{"preserve":"applied history"}');
update public.timetable_plan_items set state='applied',applied_class_id=pg_temp.bid(3001),
 applied_transfer_id=pg_temp.bid(7001),applied_at=now() where id=pg_temp.bid(601);
insert into public.timetable_plan_items(id,plan_id,name,subject)
select pg_temp.bid(200000+g),pg_temp.bid(7),'Synthetic capacity item '||g,'영어'
from generate_series(1,500) g;
update public.timetable_plan_items set state='applied',applied_class_id=pg_temp.bid(3001),
 applied_transfer_id=pg_temp.bid(7001),applied_at=now() where id=pg_temp.bid(200500);
insert into public.timetable_plan_items(id,plan_id,name,subject)
select pg_temp.bid(800+g),pg_temp.bid(8),'Synthetic slot capacity item '||g,'영어'
from generate_series(1,4) g;
insert into public.timetable_plan_slots(id,plan_id,item_id,weekday,start_minute,end_minute,
 teacher_catalog_id,classroom_catalog_id,teacher_name,classroom_name)
select pg_temp.bid(300000+g),pg_temp.bid(8),pg_temp.bid(801+(g-1)/500),
 case (g-1)/500 when 0 then 0 when 1 then 2 when 2 then 3 else 4 end,
 (g-1)%500,1+(g-1)%500,pg_temp.bid(101),pg_temp.bid(201),
 'Synthetic batch teacher A','Synthetic batch room A' from generate_series(1,2000) g;
update public.timetable_plans set state='archived' where id=pg_temp.bid(9);
update public.timetable_plan_items set source_class_id=pg_temp.bid(3001) where id=pg_temp.bid(1001);
update public.timetable_plan_slots set source_slot_id=pg_temp.bid(3003) where item_id=pg_temp.bid(1001);
update public.timetable_plans set target_start_date=pg_temp.bday(2),target_end_date=pg_temp.bday(2)
where id=pg_temp.bid(12);
insert into public.timetable_plan_members(plan_id,user_id,access)
values(pg_temp.bid(4),pg_temp.bid(903),'editor');

-- The helper only snapshots local fixture state. The exercised public RPC is
-- always invoked under the caller's real authenticated role, never definer.
create function pg_temp.bstate(pid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'plan',(select to_jsonb(p) from public.timetable_plans p where id=pid),
  'items',(select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from public.timetable_plan_items i where plan_id=pid),
  'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.timetable_plan_slots s where plan_id=pid),
  'members',(select coalesce(jsonb_agg(to_jsonb(m) order by user_id),'[]') from public.timetable_plan_members m where plan_id=pid),
  'signals',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.timetable_invalidation_signals s),
  'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by actor_id,operation,request_key),'[]') from dashboard_private.timetable_plan_mutation_receipts r),
  'transfers',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from dashboard_private.timetable_plan_transfers t))
$$;
create function pg_temp.breject(c jsonb,code text,label text,description text)
returns setof text language plpgsql as $$
declare before_state jsonb:=pg_temp.bstate((c->>'planId')::uuid);
begin
 return next throws_ok(format('select public.mutate_timetable_plan_item_v1(%L::jsonb)',c::text),
  code,label,description||': exact SQLSTATE and message');
 return next is(pg_temp.bstate((c->>'planId')::uuid),before_state,
  description||': items, slots, revisions, members, signals, receipts and transfers unchanged');
end $$;
create function pg_temp.bhistory() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='{}'; relation text; rows jsonb;
begin
 foreach relation in array array['public.classes','public.class_schedule_slots',
  'public.class_lesson_sessions','public.students','public.student_class_enrollment_history',
  'dashboard_private.notification_events','dashboard_private.notification_deliveries',
  'public.ops_task_notification_deliveries','public.makeup_notification_deliveries'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by id),''[]'') from %s t',relation) into rows;
  result:=result||jsonb_build_object(relation,rows);
 end loop;
 return result||jsonb_build_object('staffProfiles',
  (select jsonb_agg(to_jsonb(p) order by id) from public.profiles p where id in(pg_temp.bid(902),pg_temp.bid(903),pg_temp.bid(904))));
end $$;
create temp table batch_history_before as select pg_temp.bhistory() value;
grant select on batch_history_before to authenticated;
create temp table batch_commands(key text primary key,command jsonb);
create temp table batch_results(key text primary key,result jsonb);
grant all on batch_commands,batch_results to authenticated;
create temp table batch_function_before as
select proowner,proacl,proconfig,prosecdef,provolatile from pg_proc
where oid='public.mutate_timetable_plan_item_v1(jsonb)'::regprocedure;

select set_config('request.jwt.claim.sub',pg_temp.bid(901)::text,true);
set local role authenticated;

-- Swaps and cycles must be validated against the final set, not the previous
-- counterpart. Keeping original slot IDs proves that old-row provenance survives.
insert into batch_commands values('swap',pg_temp.bcommand(1,jsonb_build_array(
 jsonb_set(pg_temp.bsave(1,101,1,660,720),'{item,pendingSlots}',jsonb_build_array(
  jsonb_build_object('id',pg_temp.bid(999001),'reason','invalid_time',
   'sourceText',jsonb_build_object('weekday',4,'start','미정','end',null)::text,
   'weekday',4,'startMinute',null,'endMinute',null,'teacherId',null,'classroomId',null))),
 pg_temp.bsave(1,102,1,600,660)),'batch-swap'));
insert into batch_results select 'swap',public.mutate_timetable_plan_item_v1(command)
from batch_commands where key='swap';
-- Batch DTO fixture setup end
select has_function('public','mutate_timetable_plan_item_v1',array['jsonb'],'batch extends the existing public signature');
select ok(position('save_batch' in pg_get_functiondef('public.mutate_timetable_plan_item_v1(jsonb)'::regprocedure))>0,
 'the final installed ordered mutator contains the batch branch');
select is((select pg_get_userbyid(proowner) from pg_proc where oid='public.mutate_timetable_plan_item_v1(jsonb)'::regprocedure),
 'postgres'::name,'batch preserves the existing postgres owner');
select is((select proacl from pg_proc where oid='public.mutate_timetable_plan_item_v1(jsonb)'::regprocedure),
 (select proacl from pg_proc where oid='public.mutate_timetable_plan_v1(jsonb)'::regprocedure),
 'batch preserves the same explicit ACL as the unchanged sibling mutator');
select is((select proconfig from pg_proc where oid='public.mutate_timetable_plan_item_v1(jsonb)'::regprocedure),
 (select proconfig from pg_proc where oid='public.mutate_timetable_plan_v1(jsonb)'::regprocedure),
 'batch preserves the unchanged sibling mutator configuration');
select ok((select prosecdef and provolatile='v' and proconfig @> array['search_path=""']
 from pg_proc where oid='public.mutate_timetable_plan_item_v1(jsonb)'::regprocedure),
 'batch remains volatile security definer with an empty search path');
select ok(has_function_privilege('authenticated','public.mutate_timetable_plan_item_v1(jsonb)','execute'),
 'authenticated execution remains granted');
select ok(not has_function_privilege('anon','public.mutate_timetable_plan_item_v1(jsonb)','execute'),
 'anonymous execution remains denied');
select ok(not has_function_privilege('authenticated','dashboard_private.validate_timetable_item_slots_v1(uuid,uuid,text,jsonb,jsonb)','execute'),
 'validator remains private');
select ok(not has_table_privilege('authenticated','dashboard_private.timetable_plan_mutation_receipts','select'),
 'receipt table remains private');
select ok((select jsonb_array_length(value->'public.students')>0
 and jsonb_array_length(value->'public.class_lesson_sessions')>0
 and jsonb_array_length(value->'public.student_class_enrollment_history')>0
 and jsonb_array_length(value->'dashboard_private.notification_events')>0
 and jsonb_array_length(value->'public.ops_task_notification_deliveries')>0
 and jsonb_array_length(value->'public.makeup_notification_deliveries')>0 from batch_history_before),
 'history and no-send assertions use nonempty synthetic sentinels');

select is((select count(*) from batch_results where key='swap'),1::bigint,
 'two occupied lessons exchange time through the actual batch RPC');
select is((select array_agg(start_minute order by item_id) from public.timetable_plan_slots where plan_id=pg_temp.bid(1)),
 array[660,600],'both swapped final placements committed');
select is((select array_agg(revision order by id) from public.timetable_plan_items where plan_id=pg_temp.bid(1)),
 array[2,2]::bigint[],'each swapped item revision increments once');
select is((select change_sequence from public.timetable_plans where id=pg_temp.bid(1)),1::bigint,
 'the whole swap emits one plan change sequence');
select is((select change_sequence from public.timetable_invalidation_signals where plan_id=pg_temp.bid(1)),1::bigint,
 'the whole swap emits one invalidation sequence');
select is((select meta_revision from public.timetable_plans where id=pg_temp.bid(1)),0::bigint,
 'batch item save leaves metadata revision unchanged');
select is((select array_agg(response_key order by response_key) from batch_results r,
 jsonb_object_keys(r.result) response_key where r.key='swap'),
 array['acknowledgements','committedChangeSequence','committedMetaRevision','planId','requestKey','snapshot'],
 'batch response has exactly the agreed wire envelope');
select is((select result->>'planId' from batch_results where key='swap'),pg_temp.bid(1)::text,'receipt identifies the requested plan');
select is((select result->>'requestKey' from batch_results where key='swap'),'batch-swap','receipt identifies the immutable request');
select is((select result->'committedMetaRevision' from batch_results where key='swap'),'0'::jsonb,'committed meta revision is numeric');
select is((select result->'committedChangeSequence' from batch_results where key='swap'),'1'::jsonb,'committed sequence is numeric');
select is((select jsonb_agg(a order by a->>'itemId') from batch_results,jsonb_array_elements(result->'acknowledgements') a where key='swap'),
 jsonb_build_array(jsonb_build_object('itemId',pg_temp.bid(101),'operation','save','itemRevision',2),
 jsonb_build_object('itemId',pg_temp.bid(102),'operation','save','itemRevision',2)),
 'acknowledgements cover every swapped item exactly once');
select is((select result->'snapshot' from batch_results where key='swap'),public.get_timetable_plan_v1(pg_temp.bid(1)),
 'successful receipt snapshot is the real committed PlanSnapshot');

select lives_ok($$insert into batch_results values('cycle',public.mutate_timetable_plan_item_v1(
 pg_temp.bcommand(2,jsonb_build_array(pg_temp.bsave(2,201,1,660,720),
 pg_temp.bsave(2,202,1,720,780),pg_temp.bsave(2,203,1,600,660)),'batch-cycle')))$$,
 'three occupied lessons can rotate in one atomic batch');
select is((select array_agg(start_minute order by item_id) from public.timetable_plan_slots where plan_id=pg_temp.bid(2)),
 array[660,720,600],'all three cycle placements committed together');
select is((select change_sequence from public.timetable_plans where id=pg_temp.bid(2)),1::bigint,
 'three-item cycle still advances the plan only once');

select lives_ok($$insert into batch_results values('mixed',public.mutate_timetable_plan_item_v1(
 pg_temp.bcommand(3,jsonb_build_array(pg_temp.bsave(3,301,1,660,720),
 pg_temp.bdelete(302,1),pg_temp.bsave(3,303,null,600,660)),'batch-mixed')))$$,
 'save create and delete share one final-set transaction');
select is((select array_agg(id order by id) from public.timetable_plan_items where plan_id=pg_temp.bid(3)),
 array[pg_temp.bid(301),pg_temp.bid(303)],'mixed final set removes deleted item and creates the new item');
select is((select array_agg(start_minute order by item_id) from public.timetable_plan_slots where plan_id=pg_temp.bid(3)),
 array[660,600],'mixed final set can use the placement vacated by a delete');
select is((select jsonb_agg(a order by a->>'itemId') from batch_results,jsonb_array_elements(result->'acknowledgements') a where key='mixed'),
 jsonb_build_array(jsonb_build_object('itemId',pg_temp.bid(301),'operation','save','itemRevision',2),
 jsonb_build_object('itemId',pg_temp.bid(302),'operation','delete','itemRevision',null),
 jsonb_build_object('itemId',pg_temp.bid(303),'operation','save','itemRevision',1)),
 'mixed acknowledgements identify save/delete and null deleted revision exactly');
select is((select result->'snapshot' from batch_results where key='mixed'),public.get_timetable_plan_v1(pg_temp.bid(3)),
 'mixed response snapshot includes the full committed final set');

select lives_ok($$select public.mutate_timetable_plan_item_v1(pg_temp.bcommand(13,jsonb_build_array(
 pg_temp.bsave(13,1301,null,600,660),pg_temp.bsave(13,1302,null,600,660,102,202),
 pg_temp.bsave(13,1303,null,660,720)),'batch-independent'))$$,
 'distinct resources may coincide and same resources may use adjacent half-open intervals');

-- Every failed batch compares all persisted fixture state including private
-- receipts. An early valid save or delete must not survive a later failure.
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(
 pg_temp.bsave(4,401,1,780,840),pg_temp.bsave(4,402,1,720,780)),'batch-last-overlap'),
 '23P01','timetable_resource_conflict','last edit overlaps untouched item: full batch rolls back');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(
 pg_temp.bdelete(401,1),pg_temp.bsave(4,410,null,660,720)),'batch-delete-then-conflict'),
 '23P01','timetable_resource_conflict','earlier delete rolls back when later create overlaps');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(
 pg_temp.bsave(4,401,1,800,860),pg_temp.bsave(4,402,1,800,860)),'batch-final-overlap'),
 '23P01','timetable_resource_conflict','two edited items cannot overlap in the final set');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(
 pg_temp.bsave(4,410,null,800,860),pg_temp.bsave(4,411,null,800,860,102,201)),'batch-room-only'),
 '23P01','timetable_resource_conflict','final same room conflicts despite distinct teachers');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(
 pg_temp.bsave(4,410,null,800,860),pg_temp.bsave(4,411,null,800,860,101,202)),'batch-teacher-only'),
 '23P01','timetable_resource_conflict','final same teacher conflicts despite distinct rooms');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,410,null,800,860,101,201,5)
 ||jsonb_build_object('slots',jsonb_build_array(pg_temp.bslot(4,410,800,860,101,201,5),
 pg_temp.bslot(4,410,820,880,102,202,5,100411)))),'batch-same-item'),
 '23P01','timetable_resource_conflict','same item cannot overlap itself even with distinct resources');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(
 pg_temp.bsave(4,401,1,780,840),pg_temp.bsave(4,410,null,800,800)),'batch-last-invalid'),
 '22023','timetable_invalid','last invalid time rolls back the earlier valid edit');

-- Observed versions are stale domain failures, never a fabricated 40001.
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,401,1,780,840)),'batch-meta-stale')
 ||'{"expectedMetaRevision":1}', 'P0001','timetable_stale','metadata revision mismatch');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,401,1,780,840)),'batch-sequence-stale')
 ||'{"expectedChangeSequence":1}', 'P0001','timetable_stale','plan change sequence mismatch');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,401,2,780,840)),'batch-item-stale'),
 'P0001','timetable_stale','item revision mismatch');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(
 pg_temp.bsave(4,401,1,780,840),pg_temp.bsave(4,402,2,840,900)),'batch-last-item-stale'),
 'P0001','timetable_stale','later stale item rejects every preceding edit');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,410,1,780,840)),'batch-create-stale'),
 'P0001','timetable_stale','new item requires null expected revision');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,401,null,780,840)),'batch-existing-null'),
 'P0001','timetable_stale','existing item cannot be mistaken for a new item');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bdelete(401,2)),'batch-delete-stale'),
 'P0001','timetable_stale','delete preserves item revision guard');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,401,1,780,840)),'batch-shadow-stale')
 ||'{"expectedShadowFingerprint":"synthetic-old-fingerprint"}',
 'P0001','timetable_stale','operating reference fingerprint mismatch');

-- Strict JSON contract and UUID-normalized identities.
select * from pg_temp.breject(pg_temp.bcommand(4,'[]','batch-empty'),
 '22023','timetable_invalid','empty batch rejected');
select * from pg_temp.breject(pg_temp.bcommand(4,'{}','batch-nonarray'),
 '22023','timetable_invalid','nonarray edits rejected');
select * from pg_temp.breject(pg_temp.bcommand(4,'[null]','batch-null-edit'),
 '22023','timetable_invalid','primitive edit rejected without invoking object readers');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(jsonb_set(pg_temp.bsave(4,401,1),'{item}','null')),'batch-null-item'),
 '22023','timetable_invalid','null item rejected before metadata readers');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,401,1)||'{"slots":[null]}'),'batch-null-slot'),
 '22023','timetable_invalid','primitive slot rejected before key readers');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(jsonb_set(pg_temp.bsave(4,401,1),'{item,pendingSlots}','{}')),'batch-nonarray-pending'),
 '22023','timetable_invalid','pending slots require an array before length checks');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(jsonb_set(pg_temp.bsave(4,401,1),'{item,pendingSlots}','[null]')),'batch-null-pending'),
 '22023','timetable_invalid','primitive pending diagnostic rejected');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bdelete(401,1)),'batch-no-sequence')-'expectedChangeSequence',
 '22023','timetable_invalid','missing expected change sequence rejected');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bdelete(401,1)),'batch-string-sequence')
 ||'{"expectedChangeSequence":"0"}', '22023','timetable_invalid','string version is not a numeric version');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bdelete(401,1)),'batch-negative-meta')
 ||'{"expectedMetaRevision":-1}', '22023','timetable_invalid','negative metadata revision rejected');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bdelete(401,1)),'batch-blank-fingerprint')
 ||'{"expectedShadowFingerprint":""}', '22023','timetable_invalid','empty fingerprint rejected');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,401,1)-'expectedItemRevision'),'batch-missing-item-revision'),
 '22023','timetable_invalid','missing expected item revision rejected');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bdelete(401,null)),'batch-null-delete-revision'),
 '22023','timetable_invalid','delete cannot use null expected item revision');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,401,0)),'batch-zero-item-revision'),
 '22023','timetable_invalid','existing item revision must be positive');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,401,1)),'batch-unknown-envelope')
 ||'{"canEdit":true}', '22023','timetable_invalid','unknown top-level privilege fields rejected');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(jsonb_set(pg_temp.bsave(4,401,1),'{item,capacity}','-1')),'batch-negative-capacity'),
 '22023','timetable_invalid','negative class capacity rejected before writes');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,401,1)
 ||'{"force":true}'),'batch-unknown-edit'), '22023','timetable_invalid','unknown edit fields rejected');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(jsonb_set(pg_temp.bsave(4,401,1),'{item,state}','"applied"')),'batch-item-state'),
 '22023','timetable_invalid','server-owned lifecycle field injection rejected');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(jsonb_set(pg_temp.bsave(4,401,1),'{item,sourceClassId}',to_jsonb(pg_temp.bid(3001)))),'batch-item-source'),
 '22023','timetable_invalid','server-owned source class injection rejected');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bdelete(401,1),pg_temp.bdelete(401,1)),'batch-duplicate-edit'),
 '22023','timetable_invalid','same item cannot appear twice in one batch');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bdelete(401,1),
 pg_temp.bdelete(401,1)||jsonb_build_object('itemId',upper(pg_temp.bid(401)::text))),'batch-uuid-case'),
 '22023','timetable_invalid','equivalent mixed-case UUIDs cannot bypass duplicate edit rejection');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bdelete(401,1),
 pg_temp.bdelete(401,1)||jsonb_build_object('itemId',replace(pg_temp.bid(401)::text,'-',''))),'batch-uuid-compact'),
 '22023','timetable_invalid','equivalent compact UUIDs cannot bypass duplicate edit rejection');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,401,1),pg_temp.bdelete(401,1)),'batch-save-delete-same'),
 '22023','timetable_invalid','save plus delete of one item is ambiguous and rejected');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,101,2,780,840)),'batch-other-plan-item'),
 '22023','timetable_invalid','item UUID from another plan cannot be reassigned');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(jsonb_set(pg_temp.bsave(4,401,1),'{item,planId}',to_jsonb(pg_temp.bid(1)))),'batch-item-plan'),
 '22023','timetable_invalid','nested item plan must match command plan');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,401,1,780,840,101,201,1,100102)),'batch-other-plan-slot'),
 '22023','timetable_invalid','another plan slot UUID cannot be stolen');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,401,1,780,840,101,201,1,100402)),'batch-other-item-slot'),
 '22023','timetable_invalid','another item slot UUID cannot be reassigned');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bdelete(402,1),
 pg_temp.bsave(4,401,1,780,840,101,201,1,100402)),'batch-delete-steal-slot'),
 '22023','timetable_invalid','deleting an owner does not erase original slot provenance');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,410,null,780,840,101,201,5,100410,pg_temp.bid(3003))),'batch-forged-source'),
 '22023','timetable_invalid','new slot cannot invent a source slot UUID');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,410,null,780,840,101,201,5)
 ||jsonb_build_object('slots',jsonb_build_array(pg_temp.bslot(4,410,780,840,101,201,5),
 pg_temp.bslot(4,410,840,900,101,201,5)||jsonb_build_object('id',upper(pg_temp.bid(100410)::text))))),'batch-slot-uuid-case'),
 '22023','timetable_invalid','equivalent mixed-case duplicate slot IDs rejected before any upsert');

-- Original baseline, not rows already written by the batch, governs resource
-- validation. An unchanged unavailable slot may retain display-only tombstones.
select lives_ok($$insert into batch_results values('tombstone',public.mutate_timetable_plan_item_v1(
 pg_temp.bcommand(5,jsonb_build_array(jsonb_set(pg_temp.bsave(5,501,1,600,660,103,203),
 '{item,name}','"Synthetic renamed unavailable lesson"')),'batch-tombstone')))$$,
 'name-only edit keeps the original deleted resource placement');
select ok((select exists(select 1 from jsonb_array_elements(result#>'{snapshot,catalogs,teachers}') x
 where x->>'id'=pg_temp.bid(103)::text and (x->>'isMissing')::boolean and x->>'name'='Synthetic batch deleted teacher')
 and exists(select 1 from jsonb_array_elements(result#>'{snapshot,catalogs,classrooms}') x
 where x->>'id'=pg_temp.bid(203)::text and (x->>'isMissing')::boolean and x->>'name'='Synthetic batch deleted room')
 from batch_results where key='tombstone'), 'batch snapshot retains resource UUID and unavailable display snapshots');
select lives_ok($$select public.mutate_timetable_plan_item_v1(pg_temp.bcommand(5,jsonb_build_array(
 jsonb_set(pg_temp.bsave(5,501,2,600,660,103,203),'{slots,0,id}',
 to_jsonb(upper(pg_temp.bid(100501)::text)))),'batch-tombstone-uuid-case'))$$,
 'mixed-case slot UUID keeps unchanged deleted-resource snapshots');
select is((select jsonb_build_array(teacher_name,classroom_name) from public.timetable_plan_slots where item_id=pg_temp.bid(501)),
 '["Synthetic batch deleted teacher","Synthetic batch deleted room"]'::jsonb,
 'canonical baseline lookup preserves saved labels when catalogs are absent');
select * from pg_temp.breject(pg_temp.bcommand(5,jsonb_build_array(pg_temp.bsave(5,501,3,660,720,103,203)),'batch-move-tombstone'),
 '22023','timetable_invalid','moving a deleted resource slot is not grandfathered');
select * from pg_temp.breject(pg_temp.bcommand(5,jsonb_build_array(pg_temp.bsave(5,502,null,660,720,103,203)),'batch-create-tombstone'),
 '22023','timetable_invalid','new placement cannot use deleted catalog IDs');
select lives_ok($$select public.mutate_timetable_plan_item_v1(pg_temp.bcommand(10,jsonb_build_array(
 jsonb_set(pg_temp.bsave(10,1001,1,660,720,101,201,1,null,pg_temp.bid(3003)),
 '{slots,0,id}',to_jsonb(upper(pg_temp.bid(101001)::text)))),'batch-retained-source'))$$,
 'mixed-case own slot ID retains exact original normalized source provenance');
select is((select source_slot_id from public.timetable_plan_slots where item_id=pg_temp.bid(1001)),pg_temp.bid(3003),
 'batch preserves the server-owned source slot ID');
select * from pg_temp.breject(pg_temp.bcommand(10,jsonb_build_array(pg_temp.bsave(10,1001,2,720,780)),'batch-source-clear'),
 '22023','timetable_invalid','client cannot clear existing source provenance');

-- Operating weekly, unknown and dated occupancy is not a preset constraint.
-- Savepoints keep each case independent; internal conflict rejections above remain.
savepoint independent_operating;
select lives_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,410,null,540,600,101,202,6)),'batch-operating-teacher'))$q$,'preset saves independently: changed placement conflicts with an operating teacher');
rollback to independent_operating;
savepoint independent_operating;
select lives_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,410,null,540,600,102,201,6)),'batch-operating-room'))$q$,'preset saves independently: changed placement conflicts with an operating room');
rollback to independent_operating;
savepoint independent_operating;
select lives_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,410,null,1080,1140,102,201,3)),'batch-operating-unknown'))$q$,'preset saves independently: unassigned operating room retains its known teacher collision');
rollback to independent_operating;
savepoint independent_operating;
select lives_ok($q$select public.mutate_timetable_plan_item_v1(pg_temp.bcommand(12,jsonb_build_array(pg_temp.bsave(12,1201,null,900,960,101,202,2)),'batch-dated'))$q$,'preset saves independently: target-period dated teacher reservation remains authoritative');
rollback to independent_operating;

-- Plan and item lifecycle restrictions do not disappear inside the batch.
select * from pg_temp.breject(pg_temp.bcommand(6,jsonb_build_array(pg_temp.bsave(6,601,1,660,720)),'batch-applied-save'),
 '42501','timetable_forbidden','applied item cannot be edited');
select * from pg_temp.breject(pg_temp.bcommand(6,jsonb_build_array(pg_temp.bdelete(601,1)),'batch-applied-delete'),
 '42501','timetable_forbidden','applied item cannot be deleted');
select * from pg_temp.breject(pg_temp.bcommand(9,jsonb_build_array(pg_temp.bsave(9,901,1,660,720)),'batch-archived'),
 '42501','timetable_forbidden','archived plan remains read-only');

-- Capacity limits apply to the final whole plan, including untouched/applied
-- rows; size rejection precedes expensive slot occupancy checks.
select * from pg_temp.breject(pg_temp.bcommand(7,jsonb_build_array(pg_temp.bsave(7,701,null)||'{"slots":[]}'),'batch-501-items'),
 '22023','timetable_capacity','501st item is rejected including the applied item in total');
select * from pg_temp.breject(pg_temp.bcommand(8,jsonb_build_array(pg_temp.bsave(8,810,null,600,601,101,201,5)),'batch-2001-total-slots'),
 '22023','timetable_capacity','2001st final plan slot is rejected');
select * from pg_temp.breject(pg_temp.bcommand(4,(select jsonb_agg(pg_temp.bdelete(10000+n,1))
 from generate_series(1,501) n),'batch-501-edits'),
 '22023','timetable_invalid','more than 500 edits rejected before nonexistent-item checks');
select * from pg_temp.breject(pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,410,null)
 ||jsonb_build_object('slots',(select jsonb_agg(pg_temp.bslot(4,410,600,660,101,201,1,400000+n))
 from generate_series(1,2001) n))),'batch-2001-edit-slots'),
 '22023','timetable_capacity','more than 2000 candidate slots rejected before overlap checks');
select lives_ok($$select public.mutate_timetable_plan_item_v1(pg_temp.bcommand(7,jsonb_build_array(
 pg_temp.bdelete(200001,1),pg_temp.bsave(7,701,null)||'{"slots":[]}'),'batch-capacity-replace'))$$,
 'delete plus create at 500 total items uses final capacity rather than intermediate count');
select is((select count(*) from public.timetable_plan_items where plan_id=pg_temp.bid(7)),500::bigint,
 'capacity replacement commits exactly 500 items');

-- Receipt replay uses the same immutable command. Later commits may make the
-- receipt snapshot older, but replay must not rewrite current data or sequences.
insert into batch_commands values('swap-later',pg_temp.bcommand(1,jsonb_build_array(pg_temp.bsave(1,101,2,720,780)),'batch-swap-later'));
select lives_ok($$select public.mutate_timetable_plan_item_v1(command) from batch_commands where key='swap-later'$$,
 'later independent commit advances the same plan');
insert into batch_results values('before-replay',pg_temp.bstate(pg_temp.bid(1)));
select is((select public.mutate_timetable_plan_item_v1(command) from batch_commands where key='swap'),
 (select result from batch_results where key='swap'),'immutable batch receipt replays exactly after later edits');
select is(pg_temp.bstate(pg_temp.bid(1)),(select result from batch_results where key='before-replay'),
 'receipt replay does not restore its older snapshot or emit another write');
select * from pg_temp.breject((select jsonb_set(command,'{edits,0,item,name}','"Different replay body"') from batch_commands where key='swap'),
 '22023','timetable_invalid','same request key with a changed body rejected before stale guards');

-- Old clients retain the unmodified save/delete envelope and response shape.
insert into batch_commands values('old-save',
 (pg_temp.bcommand(14,'[]','batch-old-save')-'expectedChangeSequence'-'edits')
 ||jsonb_build_object('operation','save','expectedItemRevision',null)
 ||(pg_temp.bsave(14,1401,null)-'operation'-'expectedItemRevision'));
select lives_ok($$insert into batch_results select 'old-save',public.mutate_timetable_plan_item_v1(command)
 from batch_commands where key='old-save'$$,'existing single-item save remains compatible');
select is((select result#>>'{item,id}' from batch_results where key='old-save'),pg_temp.bid(1401)::text,
 'old save still returns the saved item');
select ok((select result ?& array['planId','metaRevision','changeSequence','shadowFingerprint','item','slots','removedItemIds']
 and not(result ? 'acknowledgements') from batch_results where key='old-save'),'old save response shape is preserved');
select lives_ok($$insert into batch_results values('old-delete',public.mutate_timetable_plan_item_v1(
 (pg_temp.bcommand(14,'[]','batch-old-delete')-'expectedChangeSequence'-'edits')
 ||jsonb_build_object('operation','delete','itemId',pg_temp.bid(1401),'expectedItemRevision',1)))$$,
 'existing single-item delete remains compatible');
select is((select result->'removedItemIds' from batch_results where key='old-delete'),jsonb_build_array(pg_temp.bid(1401)),
 'old delete still acknowledges its removed item');

-- Live authority wins over stale JWT claims, former membership and receipts.
insert into batch_commands values('denied',pg_temp.bcommand(4,jsonb_build_array(pg_temp.bsave(4,401,1,780,840)),'batch-denied'));
reset role;
update public.profiles set role='teacher' where id=pg_temp.bid(901);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.bid(901),'role','authenticated','user_role','admin')::text,true);
set local role authenticated;
select * from pg_temp.breject((select command from batch_commands where key='swap'),
 '42501','timetable_forbidden','demoted admin cannot replay its successful batch receipt');
select * from pg_temp.breject((select command from batch_commands where key='denied'),
 '42501','timetable_forbidden','stale admin claim cannot submit a new batch');
reset role;
update public.profiles set role='admin' where id=pg_temp.bid(901);
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub',pg_temp.bid(902)::text,true);
set local role authenticated;
select * from pg_temp.breject((select command from batch_commands where key='denied'),
 '42501','timetable_forbidden','staff cannot batch edit director presets');
select throws_ok($$select public.list_timetable_plans_v1()$$,'42501','timetable_forbidden','final list override remains director-only');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.bid(903)::text,true);
set local role authenticated;
select * from pg_temp.breject((select command from batch_commands where key='denied'),
 '42501','timetable_forbidden','historical editor membership cannot grant batch permission');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.bid(904)::text,true);
set local role authenticated;
select * from pg_temp.breject((select command from batch_commands where key='denied'),
 '42501','timetable_forbidden','assistant cannot batch edit director presets');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select throws_ok($$select public.mutate_timetable_plan_item_v1('{}')$$,'42501',null,'anonymous caller cannot execute batch or old mutation');
reset role;

-- Force deferred checks before comparing no-send/history and leave all fixtures
-- inside this rollback. No actual dispatch, operating application or role change
-- escapes the transaction.
set constraints all immediate;
select is(pg_temp.bhistory(),(select value from batch_history_before),
 'all batch successes and failures preserve operating classes, slots, sessions, students, staff, history and delivery rows exactly');
select is((select count(*) from dashboard_private.timetable_operating_write_baselines where transaction_id=txid_current()),0::bigint,
 'draft-only batches create no operating write baseline');
select is((select row(proowner,proacl,proconfig,prosecdef,provolatile)::text from pg_proc
 where oid='public.mutate_timetable_plan_item_v1(jsonb)'::regprocedure),
 (select row(proowner,proacl,proconfig,prosecdef,provolatile)::text from batch_function_before),
 'batch execution preserves owner ACL and function configuration');
select * from finish();
rollback;
