begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select has_function(
  'public',
  'list_ops_task_page_v1',
  array['text', 'jsonb', 'jsonb', 'uuid', 'integer'],
  'task page RPC exists'
);
select has_function(
  'public',
  'get_ops_task_list_stats_v1',
  array['text', 'jsonb'],
  'task stats RPC exists'
);

with expected(signature) as (
  values
    ('public.list_ops_task_page_v1(text,jsonb,jsonb,uuid,integer)'::text),
    ('public.get_ops_task_list_stats_v1(text,jsonb)'::text)
)
select ok(
  not (
    select proc.prosecdef
    from pg_catalog.pg_proc proc
    where proc.oid = signature::pg_catalog.regprocedure
  )
  and (
    select proc.proconfig = array['search_path=']::text[]
    from pg_catalog.pg_proc proc
    where proc.oid = signature::pg_catalog.regprocedure
  )
  and pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
  and not pg_catalog.has_function_privilege('public', signature, 'EXECUTE'),
  signature || ' is fixed-search-path security-invoker and authenticated-only'
)
from expected;

select throws_ok(
  $$select public.list_ops_task_page_v1('general', '{}'::jsonb, null, null, 30)$$,
  '22023', 'ops_task_filters_invalid',
  'missing general filter keys are rejected'
);
select throws_ok(
  $$select public.list_ops_task_page_v1('general', jsonb_build_object(
    'taskType','general','search','','statuses',jsonb_build_array(),
    'queue','inbox','requestedById',null,'requestedTeam',null,
    'assigneeId',null,'assigneeTeam',null,'focus','none','sort','due',
    'unknown',true
  ), null, null, 30)$$,
  '22023', 'ops_task_filters_invalid',
  'unknown filter keys are rejected'
);
select throws_ok(
  $$select public.list_ops_task_page_v1('general', jsonb_build_object(
    'taskType','general','search','','statuses',jsonb_build_array(),
    'queue','inbox','requestedById',null,'requestedTeam',null,
    'assigneeId',null,'assigneeTeam',null,'focus','none','sort','due'
  ), null, null, 31)$$,
  '22023', 'ops_task_page_limit_invalid',
  'page limit above 30 is rejected'
);

select throws_ok(
  $$select public.list_ops_task_page_v1('withdrawal', jsonb_build_object(
    'taskType','withdrawal','search','','statuses',jsonb_build_array(),
    'view','applicant','subject',null,'teacher',null,'period','all',
    'dateFrom',null,'dateTo',null,'filterColumn',null,
    'sortColumn','action','sortDirection','asc'
  ), null, null, 30)$$,
  '22023', 'ops_task_filters_invalid',
  'action is never a sortable request column'
);

select throws_ok(
  $$select public.list_ops_task_page_v1('word_retest', jsonb_build_object(
    'taskType','word_retest','search','','statuses',jsonb_build_array(),
    'queue','assistant','branch',null,'period','all','dateFrom',null,'dateTo',null,
    'teacherId',null,'classId',null,'includeClosed',false,
    'tableSortColumn','select','tableSortDirection','asc'
  ), null, null, 30)$$,
  '22023', 'ops_task_filters_invalid',
  'select is never a sortable request column'
);

select throws_ok(
  $$select public.list_ops_task_page_v1('general', jsonb_build_object(
    'taskType','general','search','','statuses',jsonb_build_array(),
    'queue','completed','requestedById',null,'requestedTeam',null,
    'assigneeId',null,'assigneeTeam',null,'focus','none','sort','due'
  ), jsonb_build_array(10), '00000000-0000-0000-0000-000000000001', 30)$$,
  '22023', 'ops_task_cursor_invalid',
  'completed cursor timestamp type is exact'
);

insert into public.ops_tasks(
  id, title, type, status, priority, completed_at, created_at, updated_at
)
select
  ('e2000000-0000-0000-0000-' || pg_catalog.lpad(ordinal::text, 12, '0'))::uuid,
  '__task2_page_fixture__ ' || ordinal,
  'general',
  'done',
  'normal',
  '2026-08-13 00:00:00+00'::timestamptz + ordinal * interval '1 minute',
  '2026-08-01 00:00:00+00'::timestamptz + ordinal * interval '1 minute',
  '2026-08-13 00:00:00+00'::timestamptz + ordinal * interval '1 minute'
from pg_catalog.generate_series(1, 32) ordinal;

create temporary table task2_first_page on commit drop as
select *
from public.list_ops_task_page_v1(
  'general',
  jsonb_build_object(
    'taskType','general','search','__task2_page_fixture__','statuses',jsonb_build_array(),
    'queue','completed','requestedById',null,'requestedTeam',null,
    'assigneeId',null,'assigneeTeam',null,'focus','none','sort','due'
  ),
  null,
  null,
  30
);

select is((select pg_catalog.count(*)::integer from task2_first_page), 31, 'RPC returns 30 plus one boundary row');

with boundary as (
  select id, sort_values
  from task2_first_page
  order by (sort_values ->> 0)::timestamptz desc, id asc
  offset 29 limit 1
), second_page as (
  select page.*
  from boundary
  cross join lateral public.list_ops_task_page_v1(
    'general',
    jsonb_build_object(
      'taskType','general','search','__task2_page_fixture__','statuses',jsonb_build_array(),
      'queue','completed','requestedById',null,'requestedTeam',null,
      'assigneeId',null,'assigneeTeam',null,'focus','none','sort','due'
    ),
    boundary.sort_values,
    boundary.id,
    30
  ) page
)
select is((select pg_catalog.count(*)::integer from second_page), 2, '31st and 32nd rows remain after the client boundary cursor');

select is(
  (public.get_ops_task_list_stats_v1(
    'general',
    jsonb_build_object(
      'taskType','general','search','__task2_page_fixture__','statuses',jsonb_build_array(),
      'queue','completed','requestedById',null,'requestedTeam',null,
      'assigneeId',null,'assigneeTeam',null,'focus','none','sort','due'
    ) ->> 'total')::integer,
  32,
  'stats uses the same filter semantics as the page'
);

with stats as (
  select public.get_ops_task_list_stats_v1(
    'general',
    jsonb_build_object(
      'taskType','general','search','__task2_page_fixture__','statuses',jsonb_build_array(),
      'queue','completed','requestedById',null,'requestedTeam',null,
      'assigneeId',null,'assigneeTeam',null,'focus','none','sort','due'
    )
  ) as value
)
select ok(
  pg_catalog.jsonb_typeof(value -> 'byView') = 'object'
  and pg_catalog.jsonb_typeof(value -> 'metrics') = 'object'
  and pg_catalog.jsonb_typeof(value -> 'facets') = 'object',
  'stats returns authoritative sibling counts metrics and facet catalogs'
)
from stats;

with stats as (
  select public.get_ops_task_list_stats_v1(
    'general',
    jsonb_build_object(
      'taskType','general','search','__task2_page_fixture__','statuses',jsonb_build_array(),
      'queue','completed','requestedById',null,'requestedTeam',null,
      'assigneeId',null,'assigneeTeam',null,'focus','none','sort','due'
    )
  ) as value
)
select ok(
  pg_catalog.jsonb_array_length(value #> '{facets,requestedBy}') <= 100
  and pg_catalog.jsonb_array_length(value #> '{facets,requestedTeam}') <= 100
  and pg_catalog.jsonb_array_length(value #> '{facets,assignee}') <= 100
  and pg_catalog.jsonb_array_length(value #> '{facets,assigneeTeam}') <= 100,
  'general filter facet catalogs stay bounded to 100 options each'
)
from stats;

select finish();
rollback;
