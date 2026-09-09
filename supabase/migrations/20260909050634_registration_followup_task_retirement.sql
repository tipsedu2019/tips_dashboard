begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Stop the legacy task producers. Existing links and audit rows remain readable.
drop trigger if exists create_registration_first_consultation_task_v1
  on public.ops_registration_enrollments;
drop trigger if exists sync_registration_first_consultation_task_v1
  on public.class_lesson_sessions;
drop trigger if exists cancel_registration_followup_task_v1
  on public.ops_registration_enrollments;

create or replace function dashboard_private.create_registration_first_consultation_task_v1()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  return new;
end;
$$;
create or replace function dashboard_private.sync_registration_first_consultation_task_v1()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  return new;
end;
$$;
create or replace function dashboard_private.cancel_registration_followup_task_v1()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  return new;
end;
$$;

alter function dashboard_private.create_registration_first_consultation_task_v1() owner to postgres;
alter function dashboard_private.sync_registration_first_consultation_task_v1() owner to postgres;
alter function dashboard_private.cancel_registration_followup_task_v1() owner to postgres;
revoke all on function dashboard_private.create_registration_first_consultation_task_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.sync_registration_first_consultation_task_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.cancel_registration_followup_task_v1()
  from public, anon, authenticated, service_role;

update public.ops_task_automation_rules
set enabled = false, updated_at = pg_catalog.clock_timestamp()
where enabled
  and kind = 'trigger'
  and action ->> 'type' = 'create_follow_up_task'
  and (target, trigger_key) in (
    ('registration', 'registration.completed'),
    ('transfer', 'transfer.completed'),
    ('withdrawal', 'withdrawal.completed'),
    ('word_retest', 'word_retest.completed')
  );

-- These exact task actions are retired; distinct events/actions remain available.
alter table public.ops_task_automation_rules
  add constraint ops_task_automation_retired_followup_disabled check (
    not (enabled
      and kind = 'trigger'
      and action ->> 'type' = 'create_follow_up_task'
      and (target, trigger_key) in (
        ('registration', 'registration.completed'),
        ('transfer', 'transfer.completed'),
        ('withdrawal', 'withdrawal.completed'),
        ('word_retest', 'word_retest.completed')
      )
    )
  ) not valid;

-- Owner-only maintenance operation. Its provenance joins exclude manual tasks;
-- the general-type fence avoids operational transition notification producers.
create or replace function dashboard_private.retire_registration_followup_tasks_v1()
returns integer language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_task_ids uuid[];
  v_count integer;
begin
  select coalesce(pg_catalog.array_agg(candidate.id), array[]::uuid[])
  into v_task_ids
  from (
    select task.id
    from public.ops_tasks task
    where task.type = 'general'
      and task.status not in ('done', 'canceled')
      and (
        exists (
          select 1 from dashboard_private.registration_first_consultation_task_links link
          where link.task_id = task.id
        )
        or exists (
          select 1
          from public.ops_task_automation_runs run
          join public.ops_task_automation_rules rule on rule.id = run.rule_id
          where run.task_id = task.id
            and rule.kind = 'trigger'
            and rule.action ->> 'type' = 'create_follow_up_task'
            and (rule.target, rule.trigger_key) in (
              ('registration', 'registration.completed'),
              ('transfer', 'transfer.completed'),
              ('withdrawal', 'withdrawal.completed'),
              ('word_retest', 'word_retest.completed')
            )
        )
      )
    order by task.id
    for update of task
  ) candidate;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value, payload
  )
  select task.id, null, 'registration_followup_task_retired', 'status', task.status, 'canceled',
    pg_catalog.jsonb_build_object(
      'reason', 'feature_retired', 'source', 'system',
      'migration', '20260909050634_registration_followup_task_retirement'
    )
  from public.ops_tasks task
  where task.id = any(v_task_ids);

  update public.ops_tasks task
  set status = 'canceled', completed_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where task.id = any(v_task_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
alter function dashboard_private.retire_registration_followup_tasks_v1() owner to postgres;
revoke all on function dashboard_private.retire_registration_followup_tasks_v1()
  from public, anon, authenticated, service_role;

select dashboard_private.retire_registration_followup_tasks_v1();

commit;
