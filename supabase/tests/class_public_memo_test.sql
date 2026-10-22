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
select set_config('request.jwt.claim.sub',pg_temp.memo_id(901)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.memo_id(901),'role','authenticated')::text,true);
select throws_ok($$select public.update_class_operational_v1(pg_temp.memo_id(1),'{"public_memo":"unauthorized"}',pg_temp.memo_id(106),null)$$,'42501',null,'viewer cannot author public text');
reset role;
select is((select count(*) from dashboard_private.class_lesson_input_scopes),0::bigint,'no reusable scope remains');
select is((select schedule_plan#>>'{sessions,0,memo}' from public.classes where id=pg_temp.memo_id(1)),'PRIVATE','private lesson note stays private and unchanged');
select * from finish();
rollback;
