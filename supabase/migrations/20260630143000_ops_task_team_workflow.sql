alter table public.ops_tasks
  add column if not exists requested_team text,
  add column if not exists assignee_team text,
  add column if not exists start_at timestamptz;

alter table public.ops_tasks
  drop constraint if exists ops_tasks_status_check;

alter table public.ops_tasks
  add constraint ops_tasks_status_check
  check (status in (
    'requested',
    'confirmed',
    'in_progress',
    'review_requested',
    'done',
    'on_hold',
    'canceled'
  ));

create index if not exists ops_tasks_requested_team_idx
  on public.ops_tasks(requested_team)
  where requested_team is not null;

create index if not exists ops_tasks_assignee_team_idx
  on public.ops_tasks(assignee_team)
  where assignee_team is not null;

create index if not exists ops_tasks_start_at_idx
  on public.ops_tasks(start_at)
  where start_at is not null;

create index if not exists ops_tasks_review_requested_idx
  on public.ops_tasks(status)
  where status = 'review_requested';
