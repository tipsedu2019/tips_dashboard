begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- This is the only persistent global runtime transition for Release 2.
-- Per-class shadow -> normalized activation remains an explicit admin RPC.
do $$
declare
  v_before dashboard_private.continuous_class_schedule_runtime%rowtype;
  v_after dashboard_private.continuous_class_schedule_runtime%rowtype;
begin
  select *
  into v_before
  from dashboard_private.continuous_class_schedule_runtime
  where singleton = true
  for update;

  if not found or v_before.version <> 0 then
    raise exception 'continuous_class_schedule_runtime_activation_guard_failed'
      using errcode = '40001';
  end if;

  update dashboard_private.continuous_class_schedule_runtime
  set version = 1,
      updated_at = now(),
      updated_by = null
  where singleton = true
    and version = 0
  returning * into v_after;

  if not found then
    raise exception 'continuous_class_schedule_runtime_activation_guard_failed'
      using errcode = '40001';
  end if;

  insert into public.dashboard_audit_logs (
    actor_profile_id,
    actor_email,
    actor_role,
    action,
    entity_table,
    entity_id,
    entity_label,
    before_record,
    after_record,
    class_id,
    request_key,
    request_operation,
    change_reason
  ) values (
    null,
    current_user,
    'database_migration',
    'UPDATE',
    'continuous_class_schedule_runtime',
    'singleton',
    'Release 2 continuous class schedule runtime',
    jsonb_build_object(
      'singleton', v_before.singleton,
      'version', v_before.version,
      'updatedAt', v_before.updated_at,
      'updatedBy', v_before.updated_by
    ),
    jsonb_build_object(
      'singleton', v_after.singleton,
      'version', v_after.version,
      'updatedAt', v_after.updated_at,
      'updatedBy', v_after.updated_by
    ),
    null,
    null,
    'continuous_class_schedule_release2_runtime_activate',
    'Separate Release 2 runtime activation after G6 rollback rehearsal'
  );
end;
$$;

commit;
