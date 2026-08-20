begin;

alter table public.ops_tasks
  add column if not exists completed_by uuid references public.profiles(id) on delete restrict,
  add column if not exists completed_by_label text;

create index if not exists ops_tasks_completed_by_idx
  on public.ops_tasks(completed_by)
  where completed_by is not null;

comment on column public.ops_tasks.completed_by is
  'Authenticated profile captured when the task first enters done; immutable audit link retained while the task is completed.';

comment on column public.ops_tasks.completed_by_label is
  'Safe display-name snapshot for the authenticated profile that completed the task; cleared for every non-done state.';

-- Only recover historical values from an exact completion event that occurred at
-- the recorded completion time. Older rows without that evidence stay null so
-- the UI can truthfully show that their processor was not recorded.
-- Transfer and withdrawal source triggers observe any parent-row update. Reuse
-- their existing deferred-details guard so this historical repair cannot emit
-- a new notification source or delivery.
select pg_catalog.set_config('app.ops_transition_defer_details', 'true', true);

with completion_events as (
  select distinct on (task.id)
    task.id,
    event.actor_id,
    coalesce(
      nullif(pg_catalog.btrim(profile.name), ''),
      nullif(pg_catalog.btrim(profile.login_id), ''),
      profile.id::text
    ) as actor_label
  from public.ops_tasks task
  join public.ops_task_events event
    on event.task_id = task.id
  join public.profiles profile
    on profile.id = event.actor_id
  where task.status = 'done'
    and task.completed_by is null
    and task.completed_at is not null
    and event.actor_id is not null
    and (
      (task.type in ('transfer', 'withdrawal') and event.event_type = task.type || '.completed')
      or (task.type = 'general' and event.event_type = 'task.completed')
      or (task.type = 'word_retest' and event.event_type = 'word_retest.completed')
    )
    and event.created_at between task.completed_at - interval '5 minutes'
      and task.completed_at + interval '5 minutes'
  order by task.id, event.created_at desc, event.id desc
)
update public.ops_tasks task
set
  completed_by = completion_events.actor_id,
  completed_by_label = completion_events.actor_label
from completion_events
where task.id = completion_events.id;

select pg_catalog.set_config('app.ops_transition_defer_details', '', true);
select pg_catalog.set_config('app.ops_transition_parent_details_changed', '', true);

-- This trigger deliberately runs before the existing `write_...` notification
-- trigger. It removes client-supplied audit-field changes before that trigger
-- compares task details, so neither a spoofed actor nor the later audit write
-- can create an extra notification source.
create or replace function public.normalize_ops_task_completion_actor_input()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.completed_by := null;
    new.completed_by_label := null;
  elsif old.status = 'done' then
    new.completed_by := old.completed_by;
    new.completed_by_label := old.completed_by_label;
  else
    new.completed_by := null;
    new.completed_by_label := null;
  end if;

  return new;
end;
$$;

alter function public.normalize_ops_task_completion_actor_input() owner to postgres;
revoke execute on function public.normalize_ops_task_completion_actor_input()
  from public, anon, authenticated;

drop trigger if exists v_normalize_ops_task_completion_actor_input on public.ops_tasks;
create trigger v_normalize_ops_task_completion_actor_input
before insert or update on public.ops_tasks
for each row execute function public.normalize_ops_task_completion_actor_input();

create or replace function public.set_ops_task_completion_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_label text;
begin
  if v_actor is not null then
    select coalesce(
      nullif(pg_catalog.btrim(profile.name), ''),
      nullif(pg_catalog.btrim(profile.login_id), ''),
      profile.id::text
    )
    into v_actor_label
    from public.profiles profile
    where profile.id = v_actor;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'done' then
      new.completed_by := v_actor;
      new.completed_by_label := v_actor_label;
    else
      new.completed_by := null;
      new.completed_by_label := null;
    end if;
    return new;
  end if;

  if new.status = 'done' then
    if old.status is distinct from 'done' then
      new.completed_by := v_actor;
      new.completed_by_label := v_actor_label;
    else
      new.completed_by := old.completed_by;
      new.completed_by_label := old.completed_by_label;
    end if;
  else
    new.completed_by := null;
    new.completed_by_label := null;
  end if;

  return new;
end;
$$;

alter function public.set_ops_task_completion_actor() owner to postgres;
revoke execute on function public.set_ops_task_completion_actor()
  from public, anon, authenticated;

-- PostgreSQL runs same-kind triggers alphabetically. Keep this after the
-- existing notification source triggers so completion attribution does not
-- create a second notification event for an otherwise status-only change.
drop trigger if exists zz_set_ops_task_completion_actor on public.ops_tasks;
create trigger zz_set_ops_task_completion_actor
before insert or update on public.ops_tasks
for each row execute function public.set_ops_task_completion_actor();

-- The established page RPC cannot expose a profile join to every task reader:
-- profile RLS is deliberately narrower than task RLS. Keep its pagination and
-- filtering contract, then append the safe snapshot already stored on the
-- authorized task row.
create or replace function public.list_ops_task_page_v2(
  p_type text,
  p_filters jsonb,
  p_cursor_sort_values jsonb,
  p_cursor_id uuid,
  p_limit integer
)
returns table(id uuid, row_data jsonb, sort_values jsonb)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    page.id,
    page.row_data || pg_catalog.jsonb_build_object(
      'completedById', task.completed_by,
      'completedByLabel', coalesce(task.completed_by_label, '')
    ) as row_data,
    page.sort_values
  from public.list_ops_task_page_v1(
    p_type,
    p_filters,
    p_cursor_sort_values,
    p_cursor_id,
    p_limit
  ) page
  join public.ops_tasks task on task.id = page.id
$function$;

revoke all on function public.list_ops_task_page_v2(text,jsonb,jsonb,uuid,integer)
  from public, anon;
grant execute on function public.list_ops_task_page_v2(text,jsonb,jsonb,uuid,integer)
  to authenticated;

commit;
