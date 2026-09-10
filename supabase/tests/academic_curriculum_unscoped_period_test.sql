begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '45s';
set local lock_timeout = '5s';

create function pg_temp.fid(n integer) returns uuid language sql immutable as $$
  select ('ac100000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid
$$;

create function pg_temp.filters(extra jsonb default '{}'::jsonb)
returns jsonb language sql immutable as $$
  select pg_catalog.jsonb_build_object(
    'periodId', null,
    'search', '__unscoped_period__',
    'status', null,
    'subject', null,
    'grade', null,
    'teacher', null,
    'classroom', null,
    'viewMode', 'all'
  ) || extra
$$;

select has_function(
  'public',
  'get_academic_curriculum_page_v1',
  array['jsonb','text','uuid','integer','boolean'],
  'cursor curriculum API exists'
);
select has_function(
  'public',
  'get_academic_curriculum_numbered_page_v1',
  array['jsonb','integer','integer','boolean'],
  'numbered curriculum API exists'
);

with signatures(signature) as (values
  ('public.get_academic_curriculum_page_v1(jsonb,text,uuid,integer,boolean)'),
  ('public.get_academic_curriculum_numbered_page_v1(jsonb,integer,integer,boolean)')
)
select ok(
  pg_catalog.pg_get_userbyid(proc.proowner) = 'postgres'
    and not proc.prosecdef
    and proc.provolatile = 's'
    and proc.proconfig in (array['search_path='], array['search_path=""'])
    and pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
    and not pg_catalog.has_function_privilege('public', signature, 'EXECUTE'),
  signature || ' preserves owner, stable invoker mode, fixed path, and authenticated-only ACL'
)
from signatures
join pg_catalog.pg_proc proc on proc.oid = signature::pg_catalog.regprocedure;

select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'public.get_academic_curriculum_page_v1(jsonb,text,uuid,integer,boolean)'::pg_catalog.regprocedure
  ), 'v_default_period_id') = 0,
  'cursor API no longer injects the default period'
);
select ok(
  pg_catalog.strpos(pg_catalog.pg_get_functiondef(
    'public.get_academic_curriculum_numbered_page_v1(jsonb,integer,integer,boolean)'::pg_catalog.regprocedure
  ), 'v_default_period_id') = 0,
  'numbered API no longer injects the default period'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  pg_temp.fid(900),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'academic-unscoped-period@example.invalid',
  crypt('local-only', gen_salt('bf')),
  pg_catalog.now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  pg_catalog.now(),
  pg_catalog.now()
);
insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  pg_temp.fid(900),
  'admin',
  '무기간 조회 검증자',
  'academic-unscoped-period@example.invalid',
  pg_catalog.now(),
  pg_catalog.now()
)
on conflict (id) do update set role = excluded.role, updated_at = pg_catalog.now();

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.fid(900)::text, true);
select pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object('sub', pg_temp.fid(900), 'role', 'authenticated')::text,
  true
);

update public.class_schedule_sync_groups set is_default = false where is_default;
insert into public.class_schedule_sync_groups(id, name, subject, color, is_default, sort_order)
values
  (pg_temp.fid(901), '__unscoped_period_A__', '수학', '#3182f6', true, -1202),
  (pg_temp.fid(902), '__unscoped_period_B__', '수학', '#34c759', false, -1201);

insert into public.classes(
  id, name, class_type, subject, grade, teacher, schedule, room, capacity, fee,
  status, student_ids, waitlist_ids, textbook_ids, lessons, schedule_plan
)
values
  (pg_temp.fid(1), '__unscoped_period__ Alpha no group', '정규', '수학', '고1', '무기간 교사', '월 18:00-19:00', '본3', 12, 320000, '수강', '[]', '[]', '[]', '[]', '{}'),
  (pg_temp.fid(2), '__unscoped_period__ Beta group A', '정규', '수학', '고1', '무기간 교사', '화 18:00-19:00', '본3', 12, 320000, '수강', '[]', '[]', '[]', '[]', '{}'),
  (pg_temp.fid(3), '__unscoped_period__ Gamma group B', '정규', '수학', '고1', '무기간 교사', '수 18:00-19:00', '별4', 12, 320000, '개강 준비 중', '[]', '[]', '[]', '[]', '{}');

insert into public.class_schedule_sync_group_members(group_id, class_id, sort_order)
values
  (pg_temp.fid(901), pg_temp.fid(2), 0),
  (pg_temp.fid(902), pg_temp.fid(3), 0);

set local role authenticated;

create temporary table numbered_unscoped on commit drop as
select public.get_academic_curriculum_numbered_page_v1(pg_temp.filters(), 1, 10, true) data;
create temporary table cursor_unscoped on commit drop as
select public.get_academic_curriculum_page_v1(pg_temp.filters(), null, null, 30, true) data;

select is((data ->> 'totalCount')::integer, 3, 'numbered null period includes ungrouped and both grouped classes')
from numbered_unscoped;
select is(pg_catalog.jsonb_array_length(data -> 'rows'), 3, 'numbered null period returns all matching rows')
from numbered_unscoped;
select is(data -> 'resolvedPeriodId', 'null'::jsonb, 'numbered null period remains unresolved')
from numbered_unscoped;
select is(data #> '{filterOptions,periods}', '[]'::jsonb, 'numbered curriculum no longer publishes period options')
from numbered_unscoped;
select ok(
  data #> '{rows,0,classGroupIds}' = '[]'::jsonb
    and data #>> '{rows,0,id}' = pg_temp.fid(1)::text,
  'numbered null period includes the ungrouped class as 미분류'
)
from numbered_unscoped;

select is((data #>> '{stats,total}')::integer, 3, 'cursor null period stats include all three classes')
from cursor_unscoped;
select is(pg_catalog.jsonb_array_length(data -> 'rows'), 3, 'cursor null period returns all matching rows')
from cursor_unscoped;
select is(data -> 'resolvedPeriodId', 'null'::jsonb, 'cursor null period remains unresolved')
from cursor_unscoped;
select is(data #> '{filterOptions,periods}', '[]'::jsonb, 'cursor curriculum no longer publishes period options')
from cursor_unscoped;
select ok(
  exists (
    select 1
    from pg_catalog.jsonb_array_elements(data -> 'rows') row
    where row #>> '{row_data,id}' = pg_temp.fid(1)::text
      and row #> '{row_data,classGroupIds}' = '[]'::jsonb
  ),
  'cursor null period includes the ungrouped class'
)
from cursor_unscoped;

select is(
  (public.get_academic_curriculum_numbered_page_v1(
    pg_temp.filters(pg_catalog.jsonb_build_object('periodId', pg_temp.fid(901))), 1, 10, true
  ) ->> 'totalCount')::integer,
  1,
  'numbered explicit period UUID remains a compatible selector'
);
select is(
  pg_catalog.jsonb_array_length(public.get_academic_curriculum_page_v1(
    pg_temp.filters(pg_catalog.jsonb_build_object('periodId', '__unscoped_period_B__')), null, null, 30, true
  ) -> 'rows'),
  1,
  'cursor explicit period name remains a compatible selector'
);

select is(
  (public.get_academic_curriculum_numbered_page_v1(
    pg_temp.filters('{"status":"개강 준비"}'::jsonb), 1, 10, true
  ) ->> 'totalCount')::integer,
  1,
  'numbered status filter is preserved without a period scope'
);
select is(
  pg_catalog.jsonb_array_length(public.get_academic_curriculum_page_v1(
    pg_temp.filters('{"status":"개강 준비"}'::jsonb), null, null, 30, true
  ) -> 'rows'),
  1,
  'cursor status filter is preserved without a period scope'
);
select is(
  (public.get_academic_curriculum_numbered_page_v1(
    pg_temp.filters('{"search":"Alpha no group"}'::jsonb), 1, 10, true
  ) ->> 'totalCount')::integer,
  1,
  'numbered search filter is preserved without a period scope'
);
select is(
  pg_catalog.jsonb_array_length(public.get_academic_curriculum_page_v1(
    pg_temp.filters('{"search":"Gamma group B"}'::jsonb), null, null, 30, true
  ) -> 'rows'),
  1,
  'cursor search filter is preserved without a period scope'
);

reset role;
update public.profiles set role = 'teacher' where id = pg_temp.fid(900);
set local role authenticated;
select is(
  (public.get_academic_curriculum_numbered_page_v1(pg_temp.filters(), 1, 10, true) ->> 'totalCount')::integer,
  3,
  'teacher keeps final authenticated class-read visibility'
);

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select pg_catalog.set_config('request.jwt.claims', '{}'::text, true);
set local role anon;
select throws_ok(
  $$select public.get_academic_curriculum_page_v1(pg_temp.filters(), null, null, 30, true)$$,
  '42501',
  null,
  'anonymous cursor API execute remains denied'
);
select throws_ok(
  $$select public.get_academic_curriculum_numbered_page_v1(pg_temp.filters(), 1, 10, true)$$,
  '42501',
  null,
  'anonymous numbered API execute remains denied'
);

reset role;
select * from finish();
rollback;
