begin;
select no_plan();
set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '2s';

-- Six visible tasks must not require thousands of buffer accesses to plan
-- unrelated registration, withdrawal, transfer and retest display branches.
insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('93005000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'source-plan@example.invalid', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into public.profiles(id, role, name, email)
values ('93005000-0000-4000-8000-000000000001', 'staff', '성능 검증', 'source-plan@example.invalid')
on conflict(id) do update set role = excluded.role, name = excluded.name;
select set_config('request.jwt.claims', '{"sub":"93005000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '93005000-0000-4000-8000-000000000001', true);
insert into public.ops_tasks(id, title, type, status, priority, requested_by, assignee_id, due_at)
select ('93005001-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'source-plan-fixture', case when n = 6 then 'textbook' else 'general' end,
  'requested', 'normal', '93005000-0000-4000-8000-000000000001',
  '93005000-0000-4000-8000-000000000001', current_date
from generate_series(1, 6) n;

create function pg_temp.source_plan_filters()
returns jsonb language sql as $$
  select '{"taskType":"general","search":"source-plan-fixture","statuses":[],"queue":"inbox","requestedById":null,"requestedTeam":null,"assigneeId":null,"assigneeTeam":null,"focus":"none","sort":"due"}'::jsonb
$$;
create function pg_temp.source_plan_explain(p_source text)
returns jsonb language plpgsql security invoker as $$
declare plan jsonb;
begin
  execute format('explain (analyze, buffers, format json) select count(*) from dashboard_private.%I(''general'', pg_temp.source_plan_filters())', p_source) into plan;
  return plan -> 0;
end
$$;
set local role authenticated;

select is((public.get_ops_task_list_stats_v1('general', pg_temp.source_plan_filters()) ->> 'total')::int,
  6, 'stats retains all six visible general/textbook tasks');
select is((public.get_ops_task_list_stats_v1('general', pg_temp.source_plan_filters()) #>> '{metrics,mine}')::int,
  6, 'stats retains the current actor metric');
select is((public.get_ops_task_list_stats_v1('general', pg_temp.source_plan_filters()) #>> '{byView,sent}')::int,
  6, 'stats retains sibling queue counts');
select is((public.get_ops_task_list_stats_v1('general', pg_temp.source_plan_filters()) #>> '{facets,assignee,0,count}')::int,
  6, 'stats retains assignee facet counts');

-- Warm the same path first; the budget measures logical work, not machine speed.
select count(*) from dashboard_private.ops_task_page_source_v1('general', pg_temp.source_plan_filters());
select count(*) from dashboard_private.ops_task_numbered_keys_v1('general', pg_temp.source_plan_filters());
create temp table source_plan_evidence as
select name, pg_temp.source_plan_explain(name) as plan from (values
  ('ops_task_page_source_v1'::text), ('ops_task_numbered_keys_v1'::text)
) sources(name);
select diag(jsonb_build_object('source', name, 'sharedBlocks',
  (plan #>> '{Plan,Shared Hit Blocks}')::bigint + (plan #>> '{Plan,Shared Read Blocks}')::bigint,
  'executionMs', plan -> 'Execution Time', 'scope', 'local_synthetic_six_tasks_warm')::text)
from source_plan_evidence;
select cmp_ok(
  (plan #>> '{Plan,Shared Hit Blocks}')::bigint + (plan #>> '{Plan,Shared Read Blocks}')::bigint,
  '<'::text, 200::bigint,
  name || ' stays below 200 shared buffer accesses for six tasks with real authenticated RLS'
) from source_plan_evidence;

select throws_ok(
  $$select public.get_ops_task_list_stats_v1('general', '{}'::jsonb)$$,
  '22023', 'ops_task_filters_invalid', 'invalid filters retain exact SQLSTATE 22023'
);
reset role;
select ok(
  not p.prosecdef and p.provolatile = 's'
  and ('search_path=' = any(p.proconfig) or 'search_path=""' = any(p.proconfig))
  and 'TimeZone=Asia/Seoul' = any(p.proconfig)
  and has_function_privilege('authenticated', p.oid, 'execute')
  and not has_function_privilege('anon', p.oid, 'execute')
  and not has_function_privilege('public', p.oid, 'execute'),
  'source remains stable, security invoker, fixed path/timezone and authenticated only'
) from pg_proc p where p.oid in (
  'dashboard_private.ops_task_page_source_v1(text,jsonb)'::regprocedure,
  'dashboard_private.ops_task_numbered_keys_v1(text,jsonb)'::regprocedure
);
select * from finish();
rollback;
