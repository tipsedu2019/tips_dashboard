begin;
select no_plan();
set local statement_timeout = '30s';
set local lock_timeout = '5s';

-- All identities and relationships are synthetic, transaction-local, and rolled back.
create function pg_temp.student_filters(state text default null) returns jsonb language sql as $$
  select jsonb_build_object('kind','students','search','__enrollment_status__','status',state,
    'schoolCategory',null,'school',null,'grade',null)
$$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('95000000-0000-4000-8000-000000000900','authenticated','authenticated',
  'student-status@example.invalid','{}','{}',now(),now());
insert into public.profiles(id,role,name,email) values
  ('95000000-0000-4000-8000-000000000900','admin','합성 검증자','student-status@example.invalid')
on conflict(id) do update set role='admin';
insert into public.students(id,name,uid,school,grade,status,class_ids,waitlist_class_ids)
select ('95100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '__enrollment_status__ 학생 '||n,'enrollment-status-'||n,'상태학교 '||n,'중2',
  case when n in(1,2) then '퇴원' else '재원' end,'[]','[]' from generate_series(1,6) n;
insert into public.classes(id,name,class_type,subject,status,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan)
select ('95200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '__enrollment_status__ 수업 '||n,'정규','영어','수강','[]','[]','[]','[]','{}'
from generate_series(1,35) n;
-- Registered only, waiting only, neither, both, >30 classes, reciprocal-only.
update public.students set class_ids='["95200000-0000-4000-8000-000000000001","95200000-0000-4000-8000-000000000001"]'
  where id='95100000-0000-4000-8000-000000000001';
update public.students set waitlist_class_ids='["95200000-0000-4000-8000-000000000001"]'
  where id='95100000-0000-4000-8000-000000000002';
update public.students set class_ids='["95200000-0000-4000-8000-000000000999"]',waitlist_class_ids='["95200000-0000-4000-8000-000000000999"]'
  where id='95100000-0000-4000-8000-000000000003';
update public.students set class_ids='["95200000-0000-4000-8000-000000000001"]',
  waitlist_class_ids='["95200000-0000-4000-8000-000000000001","95200000-0000-4000-8000-000000000002"]'
  where id='95100000-0000-4000-8000-000000000004';
update public.students set class_ids=(select jsonb_agg(id::text) from public.classes where name like '__enrollment_status__%')
  where id='95100000-0000-4000-8000-000000000005';
update public.classes set student_ids='["95100000-0000-4000-8000-000000000001","95100000-0000-4000-8000-000000000006"]',
  waitlist_ids='["95100000-0000-4000-8000-000000000002","95100000-0000-4000-8000-000000000006"]'
  where id='95200000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000900',true);
with cases(n,state,registered,waiting) as (values (1,'재원',1,0),(2,'대기',0,1),(3,'퇴원',0,0),(4,'재원',1,1),(5,'재원',35,0),(6,'재원',1,0))
select is(dashboard_private.management_student_enrollment_summary_v1(('95100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid),
  jsonb_build_object('status',state,'registeredCount',registered,'waitlistCount',waiting),
  'canonical classification and deduplicated counts for student '||n) from cases;

with cases(state,expected) as (values ('재원',4),('대기',1),('퇴원',1)), results as (
  select *,public.list_management_numbered_page_v1('students',pg_temp.student_filters(state),1,10,'[]') page from cases
)
select ok((page->>'totalCount')::int=expected and jsonb_array_length(page->'rows')=expected
  and (public.get_management_stats_v1('students',pg_temp.student_filters(state))->>'total')::int=expected
  and (select count(*) from public.list_management_page_v1('students',pg_temp.student_filters(state),null,null,30))=expected,
  state||' filter agrees across numbered, cursor and stats endpoints') from results;
select is(public.list_management_filter_options_v1('students',pg_temp.student_filters('대기'))->'school',
  '["상태학교 2"]'::jsonb,'dependent school options use derived waiting status');
select is(public.list_management_numbered_page_v1('students',pg_temp.student_filters(),1,10,'[{"id":"status","desc":false},{"id":"title","desc":false}]')#>>'{rows,4,status}',
  '대기','ascending status order puts waiting between enrolled and withdrawn');
select is(public.list_management_numbered_page_v1('students',pg_temp.student_filters(),1,10,'[{"id":"status","desc":false},{"id":"title","desc":false}]')#>>'{rows,5,status}',
  '퇴원','withdrawn sorts last');
select diag(jsonb_build_object('evidence','student_enrollment_wire', 'page',
  public.list_management_numbered_page_v1('students',pg_temp.student_filters(),1,10,'[]'))::text);
with rows as (select jsonb_array_elements(public.list_management_numbered_page_v1('students',pg_temp.student_filters(),1,10,'[]')->'rows') row)
select ok(row->'status'=detail#>'{record,status}' and row->'registeredCount'=detail#>'{record,registeredCount}'
  and row->'waitlistCount'=detail#>'{record,waitlistCount}' and row->'storedStatus'=detail#>'{record,storedStatus}',
  'list/detail authoritative status and counts agree for '||(row->>'name'))
from rows cross join lateral public.get_management_detail_v1('students',(row->>'id')::uuid) detail;
select is(public.get_management_detail_v1('students','95100000-0000-4000-8000-000000000002')#>>'{record,storedStatus}',
  '퇴원','legacy stored status is retained separately for compatible writes');

create temporary table student_relation_pages as
select public.list_management_detail_relation_page_v1('students','95100000-0000-4000-8000-000000000005','enrollments',null,null,30) payload;
select ok(jsonb_array_length(payload#>'{page,rows}')=30 and (payload#>>'{page,hasMore}')::boolean,
  'relation details stay bounded at 30 while full count remains 35') from student_relation_pages;
with next_page as (
  select public.list_management_detail_relation_page_v1('students','95100000-0000-4000-8000-000000000005','enrollments',
    payload#>>'{page,nextCursor,sortValue}',(payload#>>'{page,nextCursor,id}')::uuid,30) payload from student_relation_pages
), all_rows as (
  select jsonb_array_elements(payload#>'{page,rows}') row from student_relation_pages
  union all select jsonb_array_elements(payload#>'{page,rows}') from next_page
)
select ok(count(*)=35 and count(distinct row->>'classId')=35,'relation pagination reaches all classes without duplicates') from all_rows;

select ok(not prosecdef and provolatile='s' and proconfig in(array['search_path='],array['search_path=""'])
  and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute'),
  proname||' retains stable invoker and authenticated-only execution') from pg_proc
where oid in('dashboard_private.management_student_enrollments_v1(uuid)'::regprocedure,'dashboard_private.management_student_enrollment_summary_v1(uuid)'::regprocedure);
select throws_ok($$select public.list_management_numbered_page_v1('students','{}',1,10,'[]')$$,
  '22023','management_filters_invalid','final patched numbered endpoint retains exact validation SQLSTATE');

reset role;
-- Exercise the active-status scan at a larger synthetic cardinality under caller RLS.
insert into public.students(id,name,uid,grade,status,class_ids,waitlist_class_ids)
select ('95300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '__enrollment_scale__ 학생 '||n,'enrollment-scale-'||n,'중2','재원',
  '["95200000-0000-4000-8000-000000000001"]','[]' from generate_series(1,1000) n;
insert into public.classes(id,name,class_type,subject,status,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan)
select ('95400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '__enrollment_scale__ 수업 '||n,'정규','영어','수강',
  jsonb_build_array('95300000-0000-4000-8000-'||lpad(n::text,12,'0')),'[]','[]','[]','{}'
from generate_series(1,500) n;
create function pg_temp.student_status_explain() returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute $query$explain (analyze,buffers,format json)
    select public.list_management_numbered_page_v1('students',
      '{"kind":"students","search":"__enrollment_scale__","status":"재원","schoolCategory":null,"school":null,"grade":null}',1,10,'[]')$query$ into result;
  return result;
end
$$;
set local role authenticated;
select diag(jsonb_build_object('evidence','student_enrollment_scale_plan','students',1000,'classes',535,'plan',pg_temp.student_status_explain())::text);
select is(public.list_management_numbered_page_v1('students',pg_temp.student_filters('재원') || '{"search":"__enrollment_scale__"}',1,10,'[]')->>'totalCount',
  '1000','filtered page count covers every student in the larger fixture');
reset role;
create policy student_enrollment_test_class_visibility on public.classes as restrictive for select to authenticated
  using(id <> '95200000-0000-4000-8000-000000000001');
create policy student_enrollment_test_student_visibility on public.students as restrictive for select to authenticated
  using(id <> '95100000-0000-4000-8000-000000000006');
set local role authenticated;
select is(dashboard_private.management_student_enrollment_summary_v1('95100000-0000-4000-8000-000000000001'),
  '{"status":"퇴원","registeredCount":0,"waitlistCount":0}'::jsonb,'hidden classes cannot leak through counts');
select is((select count(*) from dashboard_private.management_student_enrollments_v1('95100000-0000-4000-8000-000000000006')),
  0::bigint,'hidden student cannot expose reciprocal class memberships');
reset role;
set local role anon;
select throws_ok($$select dashboard_private.management_student_enrollment_summary_v1('95100000-0000-4000-8000-000000000001')$$,
  '42501',null,'anonymous users cannot execute helper');
reset role;
select finish();
rollback;
