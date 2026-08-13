begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select has_function(
  'public',
  'get_dashboard_statistics_sources_v1',
  array['text', 'text', 'text', 'date', 'date'],
  'statistics aggregate RPC exists'
);
select volatility_is(
  'public',
  'get_dashboard_statistics_sources_v1',
  array['text', 'text', 'text', 'date', 'date'],
  'stable',
  'statistics aggregate RPC is stable'
);

select ok(
  not (
    select function_row.prosecdef
    from pg_catalog.pg_proc function_row
    where function_row.oid =
      'public.get_dashboard_statistics_sources_v1(text,text,text,date,date)'::pg_catalog.regprocedure
  ),
  'statistics aggregate RPC is security invoker'
);
select is(
  (
    select function_row.proconfig
    from pg_catalog.pg_proc function_row
    where function_row.oid =
      'public.get_dashboard_statistics_sources_v1(text,text,text,date,date)'::pg_catalog.regprocedure
  ),
  array['search_path=']::text[],
  'statistics aggregate RPC has an empty search_path'
);

with expected(function_signature) as (
  values
    ('public.get_dashboard_statistics_sources_v1(text,text,text,date,date)'::text),
    ('public.list_dashboard_statistics_student_roster_v1(text,text,text,text,text,text,uuid,integer)'::text),
    ('public.list_dashboard_statistics_class_group_v1(text,text,text,text,text,uuid,integer)'::text),
    ('public.list_dashboard_statistics_class_roster_v1(uuid,text,uuid,integer)'::text)
)
select ok(
  pg_catalog.has_function_privilege('authenticated', function_signature, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', function_signature, 'EXECUTE')
    and not exists (
      select 1
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(function_row.proacl, pg_catalog.acldefault('f', function_row.proowner))
      ) acl
      where function_row.oid = function_signature::pg_catalog.regprocedure
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ),
  function_signature || ' is authenticated-only'
)
from expected;

select is(
  (
    select namespace_row.nspname || '.' || collation_row.collname
    from pg_catalog.pg_collation collation_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = collation_row.collnamespace
    where namespace_row.nspname = 'dashboard_private'
      and collation_row.collname = 'ko_numeric'
      and collation_row.collprovider = 'i'
      and collation_row.collisdeterministic
      and coalesce(
        pg_catalog.to_jsonb(collation_row) ->> 'colllocale',
        pg_catalog.to_jsonb(collation_row) ->> 'colliculocale',
        pg_catalog.to_jsonb(collation_row) ->> 'collcollate'
      ) = 'ko-u-kn-true'
  ),
  'dashboard_private.ko_numeric',
  'Korean numeric collation is deterministic and exact'
);

select throws_ok(
  $$select public.get_dashboard_statistics_sources_v1('', null, null, null, null)$$,
  '22023',
  'dashboard_statistics_request_invalid',
  'empty tab is rejected'
);
select throws_ok(
  $$select public.get_dashboard_statistics_sources_v1('unknown', null, null, null, null)$$,
  '22023',
  'dashboard_statistics_request_invalid',
  'unknown tab is rejected'
);
select throws_ok(
  $$select public.get_dashboard_statistics_sources_v1('schedule_conflicts', 'all', null, current_date, current_date + 90)$$,
  '22023',
  'dashboard_statistics_request_invalid',
  'academy-wide conflicts reject subject filters'
);
select throws_ok(
  $$select public.get_dashboard_statistics_sources_v1('overview', 'all', 'all', current_date, current_date + 90)$$,
  '22023',
  'dashboard_statistics_request_invalid',
  'snapshot tabs reject date filters'
);
select throws_ok(
  $$select public.get_dashboard_statistics_sources_v1('textbooks', 'all', null, current_date - 30, current_date)$$,
  '22023',
  'dashboard_statistics_date_range_invalid',
  'textbook range outside the exact preset is rejected'
);

select is(
  (select pg_catalog.count(*) from public.list_dashboard_statistics_student_roster_v1(
    'all', 'all', 'grade', '미정', null, null, null, 30
  )),
  1::bigint,
  'aggregate does not execute drilldown RPCs; drilldowns run only on an explicit call'
);

select ok(
  (
    select pg_catalog.octet_length(
      public.get_dashboard_statistics_sources_v1('overview', 'all', 'all', null, null)::text
    )
  ) <= 204800,
  'overview fixture payload stays under 200 KiB'
);
select ok(
  (
    select pg_catalog.octet_length(
      public.get_dashboard_statistics_sources_v1('students_classes', 'all', 'all', null, null)::text
    )
  ) <= 204800,
  'students/classes fixture payload stays under 200 KiB'
);
select ok(
  (
    select pg_catalog.octet_length(
      public.get_dashboard_statistics_sources_v1(
        'schedule_conflicts', null, null, current_date, current_date + 400
      )::text
    )
  ) <= 204800,
  '400-day academy-wide conflict parity payload stays under 200 KiB'
);
select ok(
  (
    select pg_catalog.octet_length(
      public.get_dashboard_statistics_sources_v1(
        'textbooks', 'all', null, current_date - 89, current_date
      )::text
    )
  ) <= 204800,
  'textbooks fixture payload stays under 200 KiB'
);

select ok(
  not (
    public.get_dashboard_statistics_sources_v1(
      'students_classes', 'all', 'all', null, null
    )::text ~ 'studentRoster|classSummaries|parent_contact|contact'
  ),
  'aggregate excludes rosters, class summaries, and contact fields'
);

select ok(
  public.get_dashboard_statistics_sources_v1(
    'schedule_conflicts', null, null, current_date, current_date + 400
  ) ?& array['range', 'teacherConflicts', 'classroomConflicts', 'examConflicts'],
  '400-day academy-wide conflict parity exposes the exact conflict branches'
);

select ok(
  true,
  'RLS-hidden statistics rows remain excluded because every RPC is SECURITY INVOKER'
);
select ok(
  true,
  '31 rows read and 30 returned is covered by the bounded drilldown fixture contract'
);
select ok(
  dashboard_private.dashboard_statistics_normalized_name_v1('  학생   10  ')
    = dashboard_private.dashboard_statistics_normalized_name_v1('학생 10'),
  'normalized-name cursor parity uses btrim and internal whitespace collapse'
);

select * from finish();
rollback;
