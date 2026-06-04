create extension if not exists pgcrypto;

create table if not exists public.ops_task_notification_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  team_key text not null,
  description text,
  webhook_secret_ref text not null,
  webhook_url_last4 text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_task_notification_channels_team_key_check
    check (team_key ~ '^[a-z0-9][a-z0-9_-]{1,48}$')
);

create unique index if not exists ops_task_notification_channels_team_key_idx
  on public.ops_task_notification_channels(team_key);

create table if not exists public.ops_task_automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('recurring', 'trigger')),
  target text check (
    target is null
    or target in ('todo', 'registration', 'transfer', 'withdrawal', 'word_retest', 'curriculum', 'academic_calendar')
  ),
  trigger_key text,
  enabled boolean not null default true,
  recurrence jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '{}'::jsonb,
  action jsonb not null default '{}'::jsonb,
  assignee jsonb not null default '{}'::jsonb,
  due jsonb not null default '{}'::jsonb,
  notification jsonb not null default '{}'::jsonb,
  notification_channel_id uuid references public.ops_task_notification_channels(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ops_task_automation_rules_kind_target_idx
  on public.ops_task_automation_rules(kind, target)
  where enabled = true;

alter table public.ops_tasks
  add column if not exists automation_rule_id uuid references public.ops_task_automation_rules(id) on delete set null,
  add column if not exists automation_source_type text,
  add column if not exists automation_source_id text,
  add column if not exists automation_source_key text,
  add column if not exists automation_generated_at timestamptz;

create unique index if not exists ops_tasks_automation_source_key_idx
  on public.ops_tasks(automation_source_key)
  where automation_source_key is not null;

create index if not exists ops_tasks_automation_rule_id_idx
  on public.ops_tasks(automation_rule_id)
  where automation_rule_id is not null;

create table if not exists public.ops_task_automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.ops_task_automation_rules(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  source_key text not null,
  event_key text,
  scheduled_for date,
  task_id uuid references public.ops_tasks(id) on delete set null,
  status text not null default 'created' check (status in ('created', 'updated', 'skipped', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  ran_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint ops_task_automation_runs_rule_source_key_unique unique (rule_id, source_key)
);

create index if not exists ops_task_automation_runs_source_idx
  on public.ops_task_automation_runs(source_type, source_id);

create table if not exists public.ops_task_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.ops_tasks(id) on delete cascade,
  rule_id uuid references public.ops_task_automation_rules(id) on delete set null,
  channel_id uuid references public.ops_task_notification_channels(id) on delete set null,
  thread_key text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  response_status integer,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ops_task_notification_deliveries_task_idx
  on public.ops_task_notification_deliveries(task_id);

create index if not exists ops_task_notification_deliveries_retry_idx
  on public.ops_task_notification_deliveries(status, next_retry_at)
  where status in ('pending', 'failed');

drop trigger if exists set_updated_at_ops_task_notification_channels on public.ops_task_notification_channels;
create trigger set_updated_at_ops_task_notification_channels
  before update on public.ops_task_notification_channels
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_ops_task_automation_rules on public.ops_task_automation_rules;
create trigger set_updated_at_ops_task_automation_rules
  before update on public.ops_task_automation_rules
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_ops_task_notification_deliveries on public.ops_task_notification_deliveries;
create trigger set_updated_at_ops_task_notification_deliveries
  before update on public.ops_task_notification_deliveries
  for each row execute function public.set_updated_at();

alter table public.ops_task_notification_channels enable row level security;
alter table public.ops_task_automation_rules enable row level security;
alter table public.ops_task_automation_runs enable row level security;
alter table public.ops_task_notification_deliveries enable row level security;

grant select, insert, update, delete on public.ops_task_notification_channels to authenticated;
grant select, insert, update, delete on public.ops_task_automation_rules to authenticated;
grant select, insert, update, delete on public.ops_task_automation_runs to authenticated;
grant select, insert, update, delete on public.ops_task_notification_deliveries to authenticated;

revoke truncate, references, trigger on public.ops_task_notification_channels from authenticated;
revoke truncate, references, trigger on public.ops_task_automation_rules from authenticated;
revoke truncate, references, trigger on public.ops_task_automation_runs from authenticated;
revoke truncate, references, trigger on public.ops_task_notification_deliveries from authenticated;

drop policy if exists ops_task_notification_channels_select on public.ops_task_notification_channels;
create policy ops_task_notification_channels_select
  on public.ops_task_notification_channels
  for select
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff'));

drop policy if exists ops_task_notification_channels_write on public.ops_task_notification_channels;
create policy ops_task_notification_channels_write
  on public.ops_task_notification_channels
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff'))
  with check (public.current_dashboard_role() in ('admin', 'staff'));

drop policy if exists ops_task_automation_rules_select on public.ops_task_automation_rules;
create policy ops_task_automation_rules_select
  on public.ops_task_automation_rules
  for select
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'assistant'));

drop policy if exists ops_task_automation_rules_write on public.ops_task_automation_rules;
create policy ops_task_automation_rules_write
  on public.ops_task_automation_rules
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff'))
  with check (public.current_dashboard_role() in ('admin', 'staff'));

drop policy if exists ops_task_automation_runs_select on public.ops_task_automation_runs;
create policy ops_task_automation_runs_select
  on public.ops_task_automation_runs
  for select
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'assistant'));

drop policy if exists ops_task_automation_runs_write on public.ops_task_automation_runs;
create policy ops_task_automation_runs_write
  on public.ops_task_automation_runs
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'assistant'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'assistant'));

drop policy if exists ops_task_notification_deliveries_select on public.ops_task_notification_deliveries;
create policy ops_task_notification_deliveries_select
  on public.ops_task_notification_deliveries
  for select
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'assistant'));

drop policy if exists ops_task_notification_deliveries_write on public.ops_task_notification_deliveries;
create policy ops_task_notification_deliveries_write
  on public.ops_task_notification_deliveries
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff', 'assistant'))
  with check (public.current_dashboard_role() in ('admin', 'staff', 'assistant'));
