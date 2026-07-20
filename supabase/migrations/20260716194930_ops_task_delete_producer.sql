begin;

create or replace function dashboard_private.delete_ops_task_v1_impl(
  p_task_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text := public.current_dashboard_role();
  v_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', (select auth.uid()),
    'task_id', p_task_id
  )::text);
  v_replay jsonb;
  v_task public.ops_tasks%rowtype;
  v_deleted_task_id uuid;
  v_response jsonb;
begin
  if p_task_id is null or p_request_id is null then
    raise exception 'ops_task_delete_invalid' using errcode = '22023';
  end if;

  v_replay := dashboard_private.ops_task_request_replay_v2(
    p_request_id, 'delete_ops_task_v1', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  select task.* into v_task
  from public.ops_tasks task
  where task.id = p_task_id
  for update of task;
  if not found then raise exception 'ops_task_not_found' using errcode = 'P0002'; end if;

  v_actor := dashboard_private.assert_ops_task_actor_v2(v_task, null);
  if dashboard_private.registration_task_has_subject_tracks(v_task.id)
    or not (
      v_role = 'admin'
      or (
        v_task.type = 'general'
        and v_actor in (v_task.requested_by, v_task.assignee_id, v_task.secondary_assignee_id)
      )
      or (v_actor = v_task.requested_by and v_task.status not in ('done', 'canceled'))
      or (
        v_role = 'staff'
        and (v_task.type = 'general' or v_task.status not in ('done', 'canceled'))
      )
    )
  then
    raise exception 'ops_task_delete_forbidden' using errcode = '42501';
  end if;

  delete from public.ops_tasks task
  where task.id = v_task.id
  returning task.id into v_deleted_task_id;
  if v_deleted_task_id is null then
    raise exception 'ops_task_delete_failed' using errcode = 'P0002';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_deleted_task_id,
    'deleted', true
  );
  return dashboard_private.finish_ops_task_request_v2(
    p_request_id, 'delete_ops_task_v1', v_fingerprint, v_response
  );
end;
$$;

create or replace function public.delete_ops_task_v1(
  p_task_id uuid,
  p_request_id uuid
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select dashboard_private.delete_ops_task_v1_impl(p_task_id, p_request_id);
$$;

revoke all on function dashboard_private.delete_ops_task_v1_impl(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_ops_task_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_ops_task_v1(uuid, uuid) to authenticated;

commit;
