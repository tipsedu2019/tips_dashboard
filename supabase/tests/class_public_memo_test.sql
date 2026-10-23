begin;
select no_plan();
set local statement_timeout='45s';
create function pg_temp.memo_id(n integer) returns uuid language sql immutable as $$select ('ca220000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into dashboard_private.continuous_class_schedule_runtime(singleton,version) values(true,1) on conflict(singleton) do update set version=excluded.version;
insert into auth.users(id,instance_id,aud,role,email) values
(pg_temp.memo_id(900),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','public-memo-admin@example.invalid'),
(pg_temp.memo_id(901),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','public-memo-viewer@example.invalid');
insert into public.profiles(id,role,name) values(pg_temp.memo_id(900),'admin','Synthetic memo admin'),(pg_temp.memo_id(901),'viewer','Synthetic memo viewer') on conflict(id) do update set role=excluded.role;
select set_config('request.jwt.claim.sub',pg_temp.memo_id(900)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.memo_id(900),'role','authenticated')::text,true);
set local role authenticated;
select lives_ok($$select public.create_class_with_group_memberships_v1(jsonb_build_object('id',pg_temp.memo_id(1),'name','Synthetic public memo','status','개강 준비','public_memo','개념과 진도 안내 ✨ <script>text only</script>'),'{}'::uuid[])$$,'create accepts explicit public memo without group');
select is(public.get_management_detail_v1('classes',pg_temp.memo_id(1))#>>'{record,publicMemo}','개념과 진도 안내 ✨ <script>text only</script>','detail returns exact authored text');
select lives_ok($$select public.create_class_with_group_memberships_v1(jsonb_build_object('id',pg_temp.memo_id(2),'name','Synthetic old client','status','개강 준비'),'{}'::uuid[])$$,'old create without public memo still succeeds');
select is(public.get_management_detail_v1('classes',pg_temp.memo_id(2))#>>'{record,publicMemo}','','old create is empty, not a fallback');
select throws_ok($$select public.create_class_with_group_memberships_v1(jsonb_build_object('id',pg_temp.memo_id(3),'name','Synthetic invalid','public_memo',jsonb_build_object('memo','PRIVATE')),'{}'::uuid[])$$,'22023','class_public_memo_invalid','objects cannot be coerced to public text');
select is((select count(*) from public.classes where id=pg_temp.memo_id(3)),0::bigint,'invalid create is atomic');

select lives_ok($$select public.update_class_operational_v1(pg_temp.memo_id(1),jsonb_build_object('schedule_plan',jsonb_build_object('sessions',jsonb_build_array(
 jsonb_build_object('id','old-a','date','2026-10-01','state','active','sessionNumber',1,'billingLabel','10월','memo','PRIVATE','textbookEntries','[]'::jsonb),
 jsonb_build_object('id','old-b','date','2026-10-01','state','active','memo','PRIVATE')))),pg_temp.memo_id(100),'{}')$$,'lesson write retains public memo despite intentional same-date sessions');
select is((select public_memo from public.classes where id=pg_temp.memo_id(1)),'개념과 진도 안내 ✨ <script>text only</script>','lesson writer does not erase public memo');
create temporary table memo_before as select to_jsonb(c)-'public_memo'-'updated_at' as data from public.classes c where id=pg_temp.memo_id(1);
create temporary table memo_receipt as select public.update_class_operational_v1(pg_temp.memo_id(1),'{"public_memo":"다음 진도: 함수"}',pg_temp.memo_id(101),null) as data;
select is((select public_memo from public.classes where id=pg_temp.memo_id(1)),'다음 진도: 함수','memo-only update persists');
select is((select to_jsonb(c)-'public_memo'-'updated_at' from public.classes c where id=pg_temp.memo_id(1)),(select data from memo_before),'memo-only update preserves every other class field');
select is(public.update_class_operational_v1(pg_temp.memo_id(1),'{"public_memo":"다음 진도: 함수"}',pg_temp.memo_id(101),null),(select data from memo_receipt),'retry returns the same receipt');
select throws_ok($$select public.update_class_operational_v1(pg_temp.memo_id(1),'{"public_memo":"different"}',pg_temp.memo_id(101),null)$$,'22023','idempotency_key_reused','a request key cannot change its text');
select lives_ok($$select public.update_class_operational_v1(pg_temp.memo_id(1),'{"capacity":7}',pg_temp.memo_id(102),null)$$,'unrelated bulk-style patch succeeds');
select is((select public_memo from public.classes where id=pg_temp.memo_id(1)),'다음 진도: 함수','omitted field is preserved');
select throws_ok($$select public.update_class_operational_v1(pg_temp.memo_id(1),'{"public_memo":42}',pg_temp.memo_id(103),null)$$,'22023','class_public_memo_invalid','numeric public memo is rejected as an invalid type');
select is((select public_memo from public.classes where id=pg_temp.memo_id(1)),'다음 진도: 함수','failed update preserves the original');
select lives_ok($$select public.update_class_operational_v1(pg_temp.memo_id(1),'{"public_memo":""}',pg_temp.memo_id(104),null)$$,'explicit empty clears the memo');
select is(public.get_management_detail_v1('classes',pg_temp.memo_id(1))#>>'{record,publicMemo}','','clear is visible after readback');
select lives_ok($$select public.update_class_operational_v1(pg_temp.memo_id(1),'{"public_memo":null}',pg_temp.memo_id(105),null)$$,'null is canonicalized to empty text');
select is((select public_memo from public.classes where id=pg_temp.memo_id(1)),'','null does not fall back to any internal note');
-- Normalized lessons have their own writer. Metadata must neither submit nor
-- rebuild their schedule, including when the detail reader is consumed by UI.
reset role;
insert into public.teacher_catalogs(id,name,subjects) values(pg_temp.memo_id(910),'영어교사',array['영어']);
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.memo_id(911),'본관 2강',array['영어']);
insert into public.classes(id,name,subject,grade,status,schedule_storage_mode,schedule,teacher,room,schedule_plan)
values(pg_temp.memo_id(10),'Synthetic normalized memo','영어','중1','수강','normalized',E'월 19:30-21:30\n수 19:30-21:30\n금 19:30-21:30','영어교사','본관 2강',
 jsonb_build_object('sessions',(select jsonb_agg(jsonb_build_object('id','keep-'||n,'memo','PRIVATE memo '||n,'teacherNote','PRIVATE learning '||n,'billingLabel','10월') order by n) from generate_series(1,90)n)));
select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_schedule_slots(id,class_id,weekday,start_time,end_time,teacher_catalog_id,teacher_name,classroom_catalog_id,classroom_name,sort_order)
select pg_temp.memo_id((920+n)::int),pg_temp.memo_id(10),d,'19:30','21:30',pg_temp.memo_id(910),'영어교사',pg_temp.memo_id(911),'본관 2강',n
from unnest(array[1,3,5]) with ordinality x(d,n);
insert into public.class_lesson_sessions(class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,teacher_name_snapshot,classroom_catalog_id,classroom_name_snapshot,origin,legacy_billing_id,legacy_billing_label,memo,teacher_note)
select pg_temp.memo_id(10),'keep-'||n,date '2026-01-05'+((n-1)/3)*7+((n-1)%3)*2,'active','19:30','21:30',pg_temp.memo_id(910),'영어교사',pg_temp.memo_id(911),'본관 2강','manual','period:10','10월','PRIVATE memo '||n,'PRIVATE learning '||n
from generate_series(1,90)n;
select set_config('app.class_schedule_mutation','',true);
update dashboard_private.timetable_operating_write_baselines set reference=dashboard_private.read_timetable_operating_reference_v1() where transaction_id=txid_current();
set constraints all immediate;
set constraints all deferred;
create temp table memo_normalized_before as select
 (select to_jsonb(c)-'public_memo'-'updated_at' from public.classes c where id=pg_temp.memo_id(10)) class_row,
 (select jsonb_agg(to_jsonb(s) order by s.id) from public.class_schedule_slots s where class_id=pg_temp.memo_id(10)) slots,
 (select jsonb_agg(to_jsonb(s) order by s.id) from public.class_lesson_sessions s where class_id=pg_temp.memo_id(10)) lessons;
grant select on memo_normalized_before to authenticated;
set local role authenticated;
select is(public.get_management_detail_v1('classes',pg_temp.memo_id(10))#>>'{record,scheduleStorageMode}','normalized','detail exposes normalized ownership independently of defaults loading');
select is(public.get_management_detail_v1('classes',pg_temp.memo_id(1))#>>'{record,scheduleStorageMode}','legacy','detail preserves legacy ownership');
select throws_ok($$select public.update_class_operational_v1(pg_temp.memo_id(10),'{"public_memo":"not saved","room":"본관 2강"}',pg_temp.memo_id(110),null)$$,'22023','class_schedule_validation','unchanged schedule-owned key reproduces the reported error');
select is((select public_memo from public.classes where id=pg_temp.memo_id(10)),'','rejected mixed write is atomic');
create temp table memo_normalized_receipt as select public.update_class_operational_v1(pg_temp.memo_id(10),'{"status":"수강","public_memo":"함수 진도 안내 ✨"}',pg_temp.memo_id(111),null) as data;
select is(public.get_management_detail_v1('classes',pg_temp.memo_id(10))#>>'{record,publicMemo}','함수 진도 안내 ✨','normalized metadata saves and reopens without schedule keys');
select is(public.update_class_operational_v1(pg_temp.memo_id(10),'{"status":"수강","public_memo":"함수 진도 안내 ✨"}',pg_temp.memo_id(111),null),(select data from memo_normalized_receipt),'normalized metadata retry returns the original receipt');
select lives_ok($$select public.update_class_operational_v1(pg_temp.memo_id(10),'{"public_memo":""}',pg_temp.memo_id(112),null)$$,'normalized memo can be cleared');
select is((select to_jsonb(c)-'public_memo'-'updated_at' from public.classes c where id=pg_temp.memo_id(10)),(select class_row from memo_normalized_before),'all normalized class fields including revision and plan preserved');
select is((select jsonb_agg(to_jsonb(s) order by s.id) from public.class_schedule_slots s where class_id=pg_temp.memo_id(10)),(select slots from memo_normalized_before),'three slots preserved exactly');
select is((select jsonb_agg(to_jsonb(s) order by s.id) from public.class_lesson_sessions s where class_id=pg_temp.memo_id(10)),(select lessons from memo_normalized_before),'90 lessons and their IDs, learning, billing and memo preserved exactly');
select lives_ok('set constraints all immediate','normalized memo satisfies final deferred constraints');
select set_config('request.jwt.claim.sub',pg_temp.memo_id(901)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.memo_id(901),'role','authenticated')::text,true);
select throws_ok($$select public.update_class_operational_v1(pg_temp.memo_id(1),'{"public_memo":"unauthorized"}',pg_temp.memo_id(106),null)$$,'42501',null,'viewer cannot author public text');
reset role;
select is((select count(*) from dashboard_private.class_lesson_input_scopes),0::bigint,'no reusable scope remains');
select is((select schedule_plan#>>'{sessions,0,memo}' from public.classes where id=pg_temp.memo_id(1)),'PRIVATE','private lesson note stays private and unchanged');
select * from finish();
rollback;
