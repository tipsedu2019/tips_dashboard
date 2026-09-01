begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Registration collaboration belongs to the director and management team.
-- Keep the general task collaboration model unchanged, while making every
-- direct or security-definer write to registration comments, attachments, and
-- events fail closed for teachers and inactive accounts.
create or replace function dashboard_private.enforce_registration_collaboration_write_role_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task_id uuid;
  v_registration_task boolean := false;
begin
  if tg_op = 'INSERT' then
    v_task_id := new.task_id;
  elsif tg_op = 'DELETE' then
    v_task_id := old.task_id;
  else
    select exists (
      select 1
      from public.ops_tasks task
      where task.id = old.task_id
        and task.type = 'registration'
    )
    into v_registration_task;
    v_task_id := case when v_registration_task then old.task_id else new.task_id end;
  end if;

  if not v_registration_task then
    select exists (
      select 1
      from public.ops_tasks task
      where task.id = v_task_id
        and task.type = 'registration'
    )
    into v_registration_task;
  end if;

  if v_registration_task
    and v_actor is not null
    and not exists (
      select 1
      from public.profiles actor
      join auth.users account
        on account.id = actor.id
       and account.deleted_at is null
       and (
         account.banned_until is null
         or account.banned_until <= pg_catalog.now()
       )
      where actor.id = v_actor
        and actor.role in ('admin', 'staff')
    )
  then
    raise exception 'registration_collaboration_write_access_denied'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function dashboard_private.enforce_registration_collaboration_write_role_v1()
  owner to postgres;
revoke all on function dashboard_private.enforce_registration_collaboration_write_role_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists enforce_registration_collaboration_write_role_v1
  on public.ops_task_comments;
create trigger enforce_registration_collaboration_write_role_v1
  before insert or delete or update on public.ops_task_comments
  for each row execute function
    dashboard_private.enforce_registration_collaboration_write_role_v1();

drop trigger if exists enforce_registration_collaboration_write_role_v1
  on public.ops_task_attachments;
create trigger enforce_registration_collaboration_write_role_v1
  before insert or delete or update on public.ops_task_attachments
  for each row execute function
    dashboard_private.enforce_registration_collaboration_write_role_v1();

drop trigger if exists enforce_registration_collaboration_write_role_v1
  on public.ops_task_events;
create trigger enforce_registration_collaboration_write_role_v1
  before insert or delete or update on public.ops_task_events
  for each row execute function
    dashboard_private.enforce_registration_collaboration_write_role_v1();

drop policy if exists ops_task_comments_write on public.ops_task_comments;
create policy ops_task_comments_write
  on public.ops_task_comments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.ops_tasks task
      where task.id = ops_task_comments.task_id
        and (
          task.type <> 'registration'
          or dashboard_private.registration_observation_current_actor_is_active_manager_v1()
        )
    )
  );

drop policy if exists ops_task_attachments_write on public.ops_task_attachments;
create policy ops_task_attachments_write
  on public.ops_task_attachments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.ops_tasks task
      where task.id = ops_task_attachments.task_id
        and (
          task.type <> 'registration'
          or dashboard_private.registration_observation_current_actor_is_active_manager_v1()
        )
    )
  );

drop policy if exists ops_task_events_write on public.ops_task_events;
create policy ops_task_events_write
  on public.ops_task_events
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.ops_tasks task
      where task.id = ops_task_events.task_id
        and (
          task.type <> 'registration'
          or dashboard_private.registration_observation_current_actor_is_active_manager_v1()
        )
    )
    and (
      not exists (
        select 1
        from public.ops_registration_subject_tracks track
        where track.task_id = ops_task_events.task_id
      )
      or event_type not in (
        'registration_track_event',
        'legacy_registration_imported',
        'customer_message_sent',
        'registration_admission_message_reconciled',
        'registration_admission_message_retry_released',
        'registration_subject_removed'
      )
    )
  );

comment on function dashboard_private.enforce_registration_collaboration_write_role_v1()
  is 'Allows registration collaboration writes, including security-definer RPC writes, only for active admin/staff callers while preserving internal null-actor audit writers.';

commit;
