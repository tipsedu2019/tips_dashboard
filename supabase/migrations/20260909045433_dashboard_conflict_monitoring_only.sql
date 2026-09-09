begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Keep historical task/link rows, but close every conflict-to-task entrypoint.
-- Stable signatures give stale internal callers a deterministic retired error.
create or replace function public.create_dashboard_conflict_task_v1(
  p_conflict jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception 'dashboard_conflict_task_retired' using errcode = '0A000';
end;
$function$;

create or replace function dashboard_private.create_dashboard_conflict_task_v1_impl(
  p_conflict jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception 'dashboard_conflict_task_retired' using errcode = '0A000';
end;
$function$;

revoke all on function public.create_dashboard_conflict_task_v1(jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.create_dashboard_conflict_task_v1_impl(jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_dashboard_conflict_task_links_v1(jsonb)
  from public, anon, authenticated, service_role;

commit;
