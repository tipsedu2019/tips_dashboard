begin;
select no_plan();
set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

-- Transaction-only fixtures: no workers, provider calls, or remote execution.
create function pg_temp.numbered_filters(kind text, overrides jsonb default '{}'::jsonb)
returns jsonb language sql as $f$
  select (case kind
    when 'students' then '{"kind":"students","search":"__numbered__","status":null,"schoolCategory":null,"school":null,"grade":null}'::jsonb
    when 'classes' then '{"kind":"classes","search":"__numbered__","status":null,"periodId":null,"subject":null,"grade":null,"teacher":null,"classroom":null}'::jsonb
    else '{"kind":"textbooks","search":"__numbered__","status":null,"subject":null,"publisher":null}'::jsonb
  end) || overrides
$f$;

select has_function('public','list_management_numbered_page_v1',array['text','jsonb','integer','integer','jsonb'],'numbered management RPC exists');
select ok(
  not p.prosecdef and p.provolatile='s'
  and p.proconfig in (array['search_path=']::text[],array['search_path=""']::text[])
  and pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
  and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
  and not pg_catalog.has_function_privilege('public',p.oid,'EXECUTE'),
  'fixed-search-path stable invoker keeps authenticated-only ACL'
) from pg_catalog.pg_proc p where p.oid='public.list_management_numbered_page_v1(text,jsonb,integer,integer,jsonb)'::regprocedure;
select ok(c.relrowsecurity, c.relname || ' retains RLS') from pg_catalog.pg_class c
where c.oid in ('public.students'::regclass,'public.classes'::regclass,'public.textbooks'::regclass);
select has_function('public','list_management_page_v1',array['text','jsonb','text','uuid','integer'],'cursor RPC is preserved');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('94000000-0000-4000-8000-000000000900','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'numbered-qa@example.invalid',crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
insert into public.profiles(id,role,name,email,created_at,updated_at)
values ('94000000-0000-4000-8000-000000000900','admin','페이지 검증자','numbered-qa@example.invalid',now(),now())
on conflict(id) do update set role='admin';

insert into public.academic_schools(id,name,category) values ('94000000-0000-4000-8000-000000000901','__numbered_school__','middle');
insert into public.students(id,name,uid,school,grade,contact,parent_contact,status,class_ids,waitlist_class_ids)
select ('94100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, '__numbered__ 학생 '||n, 'numbered-'||n,
  '__numbered_school__',case when n%2=0 then '중3' else '중2' end,'0107'||lpad(n::text,7,'0'),'0108'||lpad(n::text,7,'0'),
  case when n=111 then '퇴원' else '재원' end,'[]','[]' from generate_series(1,111) n;
insert into public.textbooks(id,title,name,subject,school_level,grade_level,school_levels,grade_levels,sub_subject,publisher,price,tags,lessons,status)
select ('94300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'__numbered__ 교재 '||n,'__numbered__ 교재 '||n,
  'english','middle','m2',array['middle'],array['m2'],'기타',case when n%2=0 then '출판 2' else '출판 1' end,n*1000,'{}','[]','active'
from generate_series(1,111) n;
insert into public.textbooks(id,title,name,subject,school_level,grade_level,school_levels,grade_levels,sub_subject,publisher,price,tags,lessons,status)
values
  ('94300000-0000-4000-8000-000000000201','정렬전용 1','정렬전용 1','math','middle','m2',array['middle'],array['m2'],'기타','출판',1000,'{}','[]','active'),
  ('94300000-0000-4000-8000-000000000202','정렬전용 2','정렬전용 2','english','middle','m2',array['middle'],array['m2'],'기타','출판',2000,'{}','[]','active');
insert into public.classes(id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan)
select ('94200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'__numbered__ 수업 '||n,'정규','영어','중2',
  case when n%2=0 then '교사 2' else '교사 1' end,'월 18:00','1강',12,n*10000,'수강',
  jsonb_build_array('94100000-0000-4000-8000-'||lpad(n::text,12,'0')),'[]',
  jsonb_build_array('94300000-0000-4000-8000-'||lpad(n::text,12,'0')),'[]','{}' from generate_series(1,111) n;
insert into public.class_schedule_sync_groups(id,name,subject) values ('94000000-0000-4000-8000-000000000902','__numbered_period__','영어');
insert into public.class_schedule_sync_group_members(group_id,class_id)
select '94000000-0000-4000-8000-000000000902',('94200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(101,111) n;

set local role authenticated;
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000900',true);

-- Literal expectations for direct page 11; no earlier page needs to be fetched.
with pages as (
  select kind,public.list_management_numbered_page_v1(kind,pg_temp.numbered_filters(kind),11,10,'[]') page
  from (values ('students'),('classes'),('textbooks')) kinds(kind)
)
select ok((page->>'page')::integer=11 and (page->>'pageSize')::integer=10
  and (page->>'totalCount')::integer=111 and jsonb_array_length(page->'rows')=10
  and page#>>'{rows,0,id}' = case kind when 'students' then '94100000-0000-4000-8000-000000000101'
    when 'classes' then '94200000-0000-4000-8000-000000000101' else '94300000-0000-4000-8000-000000000101' end,
  kind||' page 11 contains the requested parent rows and full count') from pages;

with pages as (
  select kind,public.list_management_numbered_page_v1(kind,pg_temp.numbered_filters(kind),12,10,'[]') page
  from (values ('students'),('classes'),('textbooks')) kinds(kind)
)
select ok(jsonb_array_length(page->'rows')=1 and (page->>'totalCount')::integer=111,
  kind||' final partial page retains full total') from pages;
with pages as (
  select kind,public.list_management_numbered_page_v1(kind,pg_temp.numbered_filters(kind),2147483647,20,'[]') page
  from (values ('students'),('classes'),('textbooks')) kinds(kind)
)
select ok(page->'rows'='[]'::jsonb and (page->>'page')::bigint=2147483647 and (page->>'totalCount')::integer=111,
  kind||' out-of-range page preserves requested index and count without integer overflow') from pages;
select is(jsonb_array_length(public.list_management_numbered_page_v1('students',pg_temp.numbered_filters('students'),1,size,'[]')->'rows'),size,
  'allowed page size '||size) from (values (10),(15),(20)) sizes(size);

with all_pages as (
  select row_data->>'id' id from generate_series(1,12) n cross join lateral
    jsonb_array_elements(public.list_management_numbered_page_v1('students',pg_temp.numbered_filters('students'),n,10,'[]')->'rows') row_data
)
select ok(count(*)=111 and count(distinct id)=111,'static traversal has no omitted or duplicated students') from all_pages;
select is(public.list_management_numbered_page_v1('students',pg_temp.numbered_filters('students'),1,10,'[]')#>>'{rows,1,name}',
  '__numbered__ 학생 2','Korean numeric collation orders 2 before 10');
select is(public.list_management_numbered_page_v1('students',pg_temp.numbered_filters('students'),1,10,'[{"id":"status","desc":true},{"id":"title","desc":false}]')#>>'{rows,0,status}',
  '퇴원','descending primary student status reverses the business status order');
select is(public.list_management_numbered_page_v1('students',pg_temp.numbered_filters('students'),1,10,'[{"id":"grade","desc":false}]')#>>'{rows,1,id}',
  '94100000-0000-4000-8000-000000000003','equal selected sort keys use ascending unique ID, not incidental scan order');
select is(public.list_management_numbered_page_v1('classes',pg_temp.numbered_filters('classes'),1,10,'[{"id":"teacher","desc":false},{"id":"title","desc":true}]')#>>'{rows,0,name}',
  '__numbered__ 수업 111','class secondary descending title is applied globally');
select is(public.list_management_numbered_page_v1('textbooks',pg_temp.numbered_filters('textbooks'),1,10,'[{"id":"price","desc":true}]')#>>'{rows,0,price}',
  '111000','textbook numeric price sorts globally');
select is(public.list_management_numbered_page_v1('textbooks',pg_temp.numbered_filters('textbooks','{"search":"정렬전용"}'),1,10,'[]')#>>'{rows,0,title}',
  '정렬전용 2','default textbook ordering prioritizes subject before title');
select is(public.list_management_numbered_page_v1('classes',pg_temp.numbered_filters('classes'),11,10,'[]')#>>'{rows,0,studentCount}',
  '1','selected class parent is enriched with canonical roster count');
select is(public.list_management_numbered_page_v1('textbooks',pg_temp.numbered_filters('textbooks'),11,10,'[]')#>>'{rows,0,activeClassCount}',
  '1','selected textbook parent is enriched with related class count');

with numbered as (
  select kind,public.list_management_numbered_page_v1(kind,pg_temp.numbered_filters(kind),1,10,'[{"id":"title","desc":false}]')#>'{rows,0}' row_data
  from (values ('students'),('classes'),('textbooks')) kinds(kind)
)
select ok(cursor_page.row_data is not null and numbered.row_data=cursor_page.row_data,
  numbered.kind||' DTO has a matching final cursor counterpart with an identical projection')
from numbered left join lateral public.list_management_page_v1(numbered.kind,pg_temp.numbered_filters(numbered.kind),null,null,10) cursor_page
  on numbered.row_data->>'id'=cursor_page.row_data->>'id';

-- Count and list apply exactly the same combined predicate, including period membership.
with cases(kind,overrides,expected) as (values
  ('students','{"status":"재원","schoolCategory":"middle","school":"__numbered_school__","grade":"중3"}'::jsonb,55),
  ('classes','{"periodId":"94000000-0000-4000-8000-000000000902","status":"수강","subject":"영어","grade":"중2","teacher":"교사 1","classroom":"1강"}'::jsonb,6),
  ('textbooks','{"status":"active","subject":"english","publisher":"출판 2"}'::jsonb,55)
), results as (
  select *,public.list_management_numbered_page_v1(kind,pg_temp.numbered_filters(kind,overrides),1,10,'[]') page from cases
)
select ok((page->>'totalCount')::integer=expected and jsonb_array_length(page->'rows')=least(expected,10)
  and (public.get_management_stats_v1(kind,pg_temp.numbered_filters(kind,overrides))->>'total')::integer=expected,
  kind||' combined filters match existing full-filter stats') from results;
select is(public.list_management_numbered_page_v1(kind,pg_temp.numbered_filters(kind,'{"search":"no-such-numbered-fixture"}'),1,10,'[]'),
  '{"rows":[],"page":1,"pageSize":10,"totalCount":0}'::jsonb,kind||' truly empty result')
from (values ('students'),('classes'),('textbooks')) kinds(kind);

-- Invalid inputs report 22023 against the final active function, not a prior definition.
select throws_ok(format('select public.list_management_numbered_page_v1(%L,%L::jsonb,%s,10,''[]'')','students',pg_temp.numbered_filters('students'),bad),
  '22023','management_page_invalid','invalid page '||bad) from (values ('0'),('-1'),('null')) invalid(bad);
select throws_ok(format('select public.list_management_numbered_page_v1(%L,%L::jsonb,1,%s,''[]'')','students',pg_temp.numbered_filters('students'),bad),
  '22023','management_page_size_invalid','invalid size '||bad) from (values ('5'),('30'),('null')) invalid(bad);
select throws_ok(format('select public.list_management_numbered_page_v1(%L,%L::jsonb,1,10,%s)','students',pg_temp.numbered_filters('students'),bad),
  '22023','management_sort_invalid','invalid sort '||bad) from (values
  ('null'),('''null''::jsonb'),('''{}''::jsonb'),('''[{"id":"teacher","desc":false}]''::jsonb'),
  ('''[{"id":"title","desc":"asc"}]''::jsonb'),('''[{"id":"title","desc":false,"extra":true}]''::jsonb'),
  ('''[{"id":"title","desc":false},{"id":"title","desc":true}]''::jsonb'),
  ('''[{"id":"title","desc":false},{"id":"school","desc":false},{"id":"grade","desc":false}]''::jsonb')) invalid(bad);
select throws_ok($$select public.list_management_numbered_page_v1('students','{}',1,10,'[]')$$,'22023','management_filters_invalid','missing filters');
select throws_ok($$select public.list_management_numbered_page_v1('students',pg_temp.numbered_filters('students','{"search":null}'),1,10,'[]')$$,'22023','management_filters_invalid','null search');
select throws_ok($$select public.list_management_numbered_page_v1('classes',pg_temp.numbered_filters('students'),1,10,'[]')$$,'22023','management_filters_invalid','cross-kind filters');
select throws_ok($$select public.list_management_numbered_page_v1(null,pg_temp.numbered_filters('students'),1,10,'[]')$$,'22023','management_filters_invalid','null kind');
select throws_ok($$select public.list_management_numbered_page_v1('students',pg_temp.numbered_filters('students','{"grade":2}'),1,10,'[]')$$,'22023','management_filters_invalid','non-string filter');
select throws_ok($$select public.list_management_numbered_page_v1('students',pg_temp.numbered_filters('students','{"extra":true}'),1,10,'[]')$$,'22023','management_filters_invalid','unknown filter');
select throws_ok(format('select public.list_management_numbered_page_v1(''classes'',%L::jsonb,1,10,%L::jsonb)',
  pg_temp.numbered_filters('classes'),jsonb_build_array(jsonb_build_object('id',column_id,'desc',false))),
  '22023','management_sort_invalid','derived sort stays disabled: '||column_id)
from (values ('enrollmentStatus'),('weeklyHours')) columns(column_id);
with columns(kind,ids) as (values
  ('students',array['title','status','school','grade','contact','parentContact']),
  ('classes',array['title','status','subject','grade','schedule','teacher','classroom','capacity','tuition']),
  ('textbooks',array['title','status','subject','publisher','price','updatedAt'])
)
select lives_ok(format('select public.list_management_numbered_page_v1(%L,%L::jsonb,1,10,%L::jsonb)',
  kind,pg_temp.numbered_filters(kind),jsonb_build_array(jsonb_build_object('id',column_id,'desc',descending))),
  kind||' accepts scalar sort '||column_id||' desc='||descending)
from columns cross join lateral unnest(ids) column_id cross join (values (false),(true)) directions(descending);

-- A temporary restrictive policy proves both totals and page keys obey caller RLS.
reset role;
create policy numbered_test_student_visibility on public.students as restrictive for select to authenticated
  using(id <> '94100000-0000-4000-8000-000000000111');
create policy numbered_test_class_visibility on public.classes as restrictive for select to authenticated
  using(id <> '94200000-0000-4000-8000-000000000111');
create policy numbered_test_textbook_visibility on public.textbooks as restrictive for select to authenticated
  using(id <> '94300000-0000-4000-8000-000000000111');
set local role authenticated;
with pages as (
  select kind,public.list_management_numbered_page_v1(kind,pg_temp.numbered_filters(kind),12,10,'[]') page
  from (values ('students'),('classes'),('textbooks')) kinds(kind)
)
select ok((page->>'totalCount')::integer=110 and page->'rows'='[]'::jsonb,kind||' RLS hides parent from both count and page') from pages;
reset role;

-- Removal of the final row preserves the requested page so the controller can re-request 11.
-- Honor the final roster-delete guard by first unlinking this fixture's class roster.
update public.classes set student_ids='[]'::jsonb where id='94200000-0000-4000-8000-000000000111';
delete from public.students where id='94100000-0000-4000-8000-000000000111';
select is(public.list_management_numbered_page_v1('students',pg_temp.numbered_filters('students'),12,10,'[]'),
  '{"rows":[],"page":12,"pageSize":10,"totalCount":110}'::jsonb,'last-page deletion keeps count authoritative');

create function pg_temp.numbered_explain(query text) returns jsonb language plpgsql as $f$
declare result jsonb;
begin execute 'explain (analyze,buffers,format json) '||query into result; return result; end
$f$;
create temporary table numbered_wrapper_plans on commit drop as
select kind,page,pg_temp.numbered_explain(format('select public.list_management_numbered_page_v1(%L,%L::jsonb,%s,10,''[]'')',kind,pg_temp.numbered_filters(kind),page)) plan
from (values ('students'),('classes'),('textbooks')) kinds(kind) cross join (values(1),(6),(12)) pages(page);
select ok(plan#>>'{0,Execution Time}' is not null and plan#>>'{0,Plan,Shared Hit Blocks}' is not null,
  kind||' records wrapper timing/buffers for page '||page) from numbered_wrapper_plans;
-- Preserve the complete observed plans in verbose TAP evidence. These wrapper plans
-- measure total RPC cost only; nested enrichment bounds require nested statement plans.
select diag(jsonb_build_object('evidence','management_numbered_wrapper_plan','kind',kind,'page',page,'plan',plan)::text)
from numbered_wrapper_plans order by kind,page;

set local role anon;
select throws_ok($$select public.list_management_numbered_page_v1('students','{}',1,10,'[]')$$,'42501',null,'anonymous caller cannot execute numbered endpoint');
reset role;
select finish();
rollback;
