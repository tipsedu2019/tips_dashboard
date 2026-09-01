begin;
select no_plan();
set local timezone='UTC';
set local statement_timeout='30s';

select has_function('public','get_class_textbook_sale_context_v1',array['jsonb'],'selected class-sale context exists');
create function pg_temp.tid(n integer)returns uuid language sql immutable as $$
  select ('5b200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.class_input(p jsonb default '{}')returns jsonb language sql immutable as $$
  select jsonb_build_object('classId',pg_temp.tid(600),'textbookId',pg_temp.tid(700),'chargeMonth','2099-08','locationId',pg_temp.tid(800))||p
$$;
create temp table sends_before as
select (select count(*)from dashboard_private.notification_events)events,
  (select count(*)from dashboard_private.notification_event_fanout_jobs)jobs,
  (select count(*)from dashboard_private.notification_deliveries)deliveries;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.tid(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','task5b2-'||n||'@example.invalid',
  crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}',now(),now()
from generate_series(901,903)n;
insert into public.profiles(id,role,name,email)values
  (pg_temp.tid(901),'admin','Task5b2 관리자','task5b2-901@example.invalid'),
  (pg_temp.tid(902),'staff','Task5b2 직원','task5b2-902@example.invalid'),
  (pg_temp.tid(903),'teacher','Task5b2 교사','task5b2-903@example.invalid')
on conflict(id)do update set role=excluded.role;
insert into public.textbook_inventory_locations(id,code,name,sort_order)
values(pg_temp.tid(800),'__t5b2_main__','Task5b2 본관',10);
insert into public.textbooks(id,title,name,subject,publisher,category,price,sale_price,school_level,grade_level,school_levels,grade_levels,sub_subject,status)
values(pg_temp.tid(700),'__t5b2_book__','__t5b2_book__','english','__t5b2_publisher__','독해',10001,10001,'middle','m2',array['middle'],array['m2'],'독해','active');
insert into public.students(id,name,uid,school,grade,contact,parent_contact,status,class_ids,waitlist_class_ids)
select pg_temp.tid(1000+n),'__t5b2_same_name','task5b2-student-'||n,
  case when n=1 then null when n=22 then '__t5b2_school_offpage' else '__t5b2_school_default' end,
  '중2','','','재원','[]','[]'
from generate_series(1,22)n;
insert into public.classes(id,name,class_type,subject,status,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan)
values(pg_temp.tid(600),'__t5b2_class__','정규','영어','수강',
  (select jsonb_agg(pg_temp.tid(1000+n)order by n)from generate_series(1,22)n)||jsonb_build_array(pg_temp.tid(1001),'legacy-school-id'),
  '[]','[]','[]','{}');
insert into public.textbook_stock_moves(id,textbook_id,location_id,move_type,quantity,unit_amount,amount,moved_at,copy_scope)
values(pg_temp.tid(2000),pg_temp.tid(700),pg_temp.tid(800),'sale_issue',-2,10001,0,'2099-08-01T00:00:00Z','student');
insert into public.textbook_sales(id,class_id,charge_month,sale_date,status,created_at,updated_at)
values(pg_temp.tid(3000),pg_temp.tid(600),'2099-08','2099-08-01','charged','2099-08-01T00:00:00Z',null);
insert into public.textbook_sale_lines(id,sale_id,student_id,class_id,textbook_id,charge_month,quantity,unit_price,location_id,status,copy_scope,created_at,updated_at)
values(pg_temp.tid(4000),pg_temp.tid(3000),pg_temp.tid(1022),null,pg_temp.tid(700),'2099-08-25',1,10001,pg_temp.tid(800),'paid','student','2099-08-01T00:00:00Z',null);

create temp table catalog_before as
select (select count(*)from public.students)students,
  (select count(*)from public.classes)classes,
  (select count(*)from public.textbooks)textbooks,
  (select count(*)from public.textbook_inventory_locations)locations,
  (select count(*)from public.textbook_stock_moves)moves,
  (select count(*)from public.textbook_sales)sales,
  (select count(*)from public.textbook_sale_lines)lines;

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.tid(901)::text,true);
select is(auth.uid(),pg_temp.tid(901),'wire actor is the actual authenticated admin');
select is(jsonb_array_length(public.get_class_textbook_sale_context_v1(pg_temp.class_input())->'students'),22,'selected context returns every associated record beyond20');
select is(jsonb_array_length(public.get_class_textbook_sale_context_v1(pg_temp.class_input())->'enrolledStudentIds'),24,'roster preserves22 identities, one repeat and one missing legacy ID');
select is(public.get_class_textbook_sale_context_v1(pg_temp.class_input())#>>'{enrolledStudentIds,22}',pg_temp.tid(1001)::text,'repeated enrolled identity remains in sequence');
select is(public.get_class_textbook_sale_context_v1(pg_temp.class_input())#>>'{enrolledStudentIds,23}','legacy-school-id','missing legacy identity remains in sequence');
select is(public.get_class_textbook_sale_context_v1(pg_temp.class_input())->'missingStudentIds','["legacy-school-id"]'::jsonb,'missing record remains only in missingStudentIds');
select is(public.get_class_textbook_sale_context_v1(pg_temp.class_input())#>'{students,0,school}','null'::jsonb,'nullable school is returned as an explicit null field');
select is(public.get_class_textbook_sale_context_v1(pg_temp.class_input())#>>'{students,21,school}','__t5b2_school_offpage','off-page school discriminator is present on the complete selected roster');
select is((select count(*)from jsonb_array_elements(public.get_class_textbook_sale_context_v1(pg_temp.class_input())->'students')s
  where s->>'name'='__t5b2_same_name'and s->>'grade'='중2'),22::bigint,'same name and grade do not collapse selected student records');
select ok(not exists(select 1 from jsonb_array_elements(public.get_class_textbook_sale_context_v1(pg_temp.class_input())->'students')s
  where (select array_agg(k order by k)from jsonb_object_keys(s)k)is distinct from array['grade','id','name','school']),
  'every class student is exact id name grade school');
select is((select count(*)from jsonb_array_elements(public.get_class_textbook_sale_context_v1(pg_temp.class_input())->'students')s
  join public.students p on p.id=(s->>'id')::uuid),22::bigint,'class context neither fabricates nor repairs student records');
select is((public.get_class_textbook_sale_context_v1(pg_temp.class_input())->>'duplicateLineCount')::int,1,'duplicate raw line count is unchanged');
select is(public.get_class_textbook_sale_context_v1(pg_temp.class_input())->'duplicateLineIds',jsonb_build_array(pg_temp.tid(4000)),'duplicate line IDs are unchanged');
select is(public.get_class_textbook_sale_context_v1(pg_temp.class_input())->'duplicateStudentIds',jsonb_build_array(pg_temp.tid(1022)),'duplicate student IDs are unchanged');
select is((public.get_class_textbook_sale_context_v1(pg_temp.class_input())->>'duplicateCount')::int,1,'duplicate distinct-student count is unchanged');
select is((public.get_class_textbook_sale_context_v1(pg_temp.class_input())#>>'{inventory,currentQuantity}')::int,-2,'selected-location negative balance is unchanged');
select is(public.get_class_textbook_sale_context_v1(pg_temp.class_input())->>'complete','true','selected context remains complete');
select ok(position('students as materialized(select s.id,s.name,s.grade,s.school from public.students s' in
  pg_get_functiondef('public.get_class_textbook_sale_context_v1(jsonb)'::regprocedure))>0,
  'final active function selects only the added physical school field');
select is((select array_agg(k order by k)from jsonb_object_keys((public.get_textbook_billing_handoff_context_v1('{"search":"__t5b2_book__","status":"all"}')->'students')->0)k),
  array['grade','id','name'],'billing student wire retains its exact three-field contract');
select throws_ok($$select public.get_class_textbook_sale_context_v1(pg_temp.class_input('{"extra":"x"}'))$$,'22023','textbook_context_input_invalid','extra input key remains exact22023');
select throws_ok($$select public.get_class_textbook_sale_context_v1(pg_temp.class_input('{"classId":"not-a-uuid"}'))$$,'22023','textbook_class_context_input_invalid','invalid UUID remains exact22023');
select throws_ok($$select public.get_class_textbook_sale_context_v1(pg_temp.class_input(jsonb_build_object('classId',pg_temp.tid(9999))))$$,'22023','textbook_class_context_unavailable','missing class remains exact22023');
select throws_ok($$select public.get_class_textbook_sale_context_v1(pg_temp.class_input(jsonb_build_object('textbookId',pg_temp.tid(9999))))$$,'22023','textbook_class_context_unavailable','missing textbook remains exact22023');
select throws_ok($$select public.get_class_textbook_sale_context_v1(pg_temp.class_input(jsonb_build_object('locationId',pg_temp.tid(9999))))$$,'22023','textbook_class_context_unavailable','missing location remains exact22023');
select lives_ok($$select public.get_class_textbook_sale_context_v1(pg_temp.class_input())$$,'admin selected context succeeds');
select set_config('request.jwt.claim.sub',pg_temp.tid(902)::text,true);
select lives_ok($$select public.get_class_textbook_sale_context_v1(pg_temp.class_input())$$,'staff selected context succeeds through current RLS and guard');
select set_config('request.jwt.claim.sub',pg_temp.tid(903)::text,true);
select throws_ok($$select public.get_class_textbook_sale_context_v1(pg_temp.class_input())$$,'42501','textbook_management_read_forbidden','teacher remains forbidden');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.get_class_textbook_sale_context_v1(pg_temp.class_input())$$,'42501','textbook_management_read_forbidden','authenticated role without identity remains forbidden');
set local role anon;
select throws_ok($$select public.get_class_textbook_sale_context_v1(pg_temp.class_input())$$,'42501',null,'anon execute remains revoked');

reset role;
select ok(not p.prosecdef and p.provolatile='s','final function remains stable security invoker')
from pg_proc p where p.oid='public.get_class_textbook_sale_context_v1(jsonb)'::regprocedure;
select is(p.proconfig,array['search_path=""']::text[],'final function keeps empty search_path')
from pg_proc p where p.oid='public.get_class_textbook_sale_context_v1(jsonb)'::regprocedure;
select ok(has_function_privilege('authenticated','public.get_class_textbook_sale_context_v1(jsonb)','EXECUTE'),'authenticated execute remains granted');
select ok(not has_function_privilege('anon','public.get_class_textbook_sale_context_v1(jsonb)','EXECUTE'),'anon execute remains revoked');
select is((select count(*)from public.students),(select students from catalog_before),'student catalog unchanged by reads');
select is((select count(*)from public.classes),(select classes from catalog_before),'class catalog unchanged by reads');
select is((select count(*)from public.textbooks),(select textbooks from catalog_before),'textbook catalog unchanged by reads');
select is((select count(*)from public.textbook_inventory_locations),(select locations from catalog_before),'location catalog unchanged by reads');
select is((select count(*)from public.textbook_stock_moves),(select moves from catalog_before),'stock movement catalog unchanged by reads');
select is((select count(*)from public.textbook_sales),(select sales from catalog_before),'sale catalog unchanged by reads');
select is((select count(*)from public.textbook_sale_lines),(select lines from catalog_before),'sale-line catalog unchanged by reads');
select is((select count(*)from dashboard_private.notification_events),(select events from sends_before),'no notification events');
select is((select count(*)from dashboard_private.notification_event_fanout_jobs),(select jobs from sends_before),'no fanout jobs');
select is((select count(*)from dashboard_private.notification_deliveries),(select deliveries from sends_before),'no deliveries');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.tid(901)::text,true);
select diag('TASK5B2_WIRE '||jsonb_build_object('method','getClassTextbookSaleContext','input',pg_temp.class_input(),
  'data',public.get_class_textbook_sale_context_v1(pg_temp.class_input()),'actorId',auth.uid())::text);
reset role;
select * from finish();
rollback;
