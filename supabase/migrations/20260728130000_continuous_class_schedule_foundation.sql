begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create schema if not exists dashboard_private;

alter table public.classes
  add column if not exists schedule_revision bigint not null default 0,
  add column if not exists schedule_storage_mode text not null default 'legacy',
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'classes_schedule_revision_nonnegative'
      and conrelid = 'public.classes'::regclass
  ) then
    alter table public.classes
      add constraint classes_schedule_revision_nonnegative
      check (schedule_revision >= 0);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'classes_schedule_storage_mode_check'
      and conrelid = 'public.classes'::regclass
  ) then
    alter table public.classes
      add constraint classes_schedule_storage_mode_check
      check (schedule_storage_mode in ('legacy', 'shadow', 'normalized'));
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'classes_closed_by_fkey'
      and conrelid = 'public.classes'::regclass
  ) then
    alter table public.classes
      add constraint classes_closed_by_fkey
      foreign key (closed_by)
      references public.profiles(id)
      on delete set null;
  end if;
end
$$;

create table if not exists public.class_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  teacher_catalog_id uuid references public.teacher_catalogs(id) on delete set null,
  teacher_name text not null default '',
  classroom_catalog_id uuid references public.classroom_catalogs(id) on delete set null,
  classroom_name text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_schedule_slots_time_order_check check (start_time < end_time),
  constraint class_schedule_slots_sort_order_nonnegative check (sort_order >= 0),
  constraint class_schedule_slots_class_time_key
    unique (class_id, weekday, start_time, end_time)
);

create index if not exists class_schedule_slots_class_sort_idx
  on public.class_schedule_slots (class_id, weekday, start_time, sort_order);

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'set_updated_at_class_schedule_slots'
      and tgrelid = 'public.class_schedule_slots'::regclass
      and not tgisinternal
  ) then
    create trigger set_updated_at_class_schedule_slots
      before update on public.class_schedule_slots
      for each row execute function public.set_updated_at();
  end if;
end
$$;

create table if not exists public.class_lesson_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  session_key text not null,
  source_schedule_slot_id uuid
    references public.class_schedule_slots(id) on delete set null,
  session_date date not null,
  schedule_state text not null,
  start_time time,
  end_time time,
  teacher_catalog_id uuid references public.teacher_catalogs(id) on delete set null,
  teacher_name_snapshot text not null default '',
  classroom_catalog_id uuid references public.classroom_catalogs(id) on delete set null,
  classroom_name_snapshot text not null default '',
  origin text not null,
  makeup_of_session_id uuid
    references public.class_lesson_sessions(id) on delete restrict,
  legacy_billing_id text not null default '',
  legacy_billing_label text not null default '',
  legacy_billing_color text not null default '',
  memo text not null default '',
  public_note text not null default '',
  teacher_note text not null default '',
  revision bigint not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_lesson_sessions_class_key unique (class_id, session_key),
  constraint class_lesson_sessions_state_check
    check (schedule_state in ('active', 'exception', 'makeup', 'tbd', 'skipped')),
  constraint class_lesson_sessions_origin_check
    check (origin in ('default', 'manual', 'legacy')),
  constraint class_lesson_sessions_revision_nonnegative check (revision >= 0),
  constraint class_lesson_sessions_time_pair_check
    check (
      (start_time is null and end_time is null)
      or (start_time is not null and end_time is not null and start_time < end_time)
    )
);

create unique index if not exists class_lesson_sessions_default_source_key
  on public.class_lesson_sessions (class_id, session_date, source_schedule_slot_id)
  where source_schedule_slot_id is not null;

create index if not exists class_lesson_sessions_class_date_idx
  on public.class_lesson_sessions (class_id, session_date, start_time, id);

create index if not exists class_lesson_sessions_class_state_date_idx
  on public.class_lesson_sessions (class_id, schedule_state, session_date);

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'set_updated_at_class_lesson_sessions'
      and tgrelid = 'public.class_lesson_sessions'::regclass
      and not tgisinternal
  ) then
    create trigger set_updated_at_class_lesson_sessions
      before update on public.class_lesson_sessions
      for each row execute function public.set_updated_at();
  end if;
end
$$;

create table if not exists dashboard_private.class_schedule_mutation_receipts (
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  operation text not null,
  request_key uuid not null,
  request_hash text not null,
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_profile_id, operation, request_key),
  constraint class_schedule_mutation_receipts_operation_nonblank
    check (btrim(operation) <> ''),
  constraint class_schedule_mutation_receipts_hash_nonblank
    check (btrim(request_hash) <> '')
);

create or replace function public.continuous_class_schedule_runtime_version()
returns integer
language sql
stable
set search_path = ''
as $$
  select 0;
$$;

revoke all on table dashboard_private.class_schedule_mutation_receipts
  from public, anon, authenticated;
revoke all on function public.continuous_class_schedule_runtime_version()
  from public;
grant execute on function public.continuous_class_schedule_runtime_version()
  to authenticated;

alter table public.class_schedule_slots enable row level security;
alter table public.class_lesson_sessions enable row level security;

drop policy if exists class_schedule_slots_authenticated_select
  on public.class_schedule_slots;
create policy class_schedule_slots_authenticated_select
  on public.class_schedule_slots
  for select
  to authenticated
  using (true);

drop policy if exists class_lesson_sessions_authenticated_select
  on public.class_lesson_sessions;
create policy class_lesson_sessions_authenticated_select
  on public.class_lesson_sessions
  for select
  to authenticated
  using (true);

revoke all
  on public.class_schedule_slots, public.class_lesson_sessions
  from public, anon, authenticated;
grant select on public.class_schedule_slots, public.class_lesson_sessions
  to authenticated;

drop trigger if exists dashboard_audit_class_schedule_slots
  on public.class_schedule_slots;
create trigger dashboard_audit_class_schedule_slots
  after insert or update or delete on public.class_schedule_slots
  for each row execute function public.log_dashboard_audit_event();

drop trigger if exists dashboard_audit_class_lesson_sessions
  on public.class_lesson_sessions;
create trigger dashboard_audit_class_lesson_sessions
  after insert or update or delete on public.class_lesson_sessions
  for each row execute function public.log_dashboard_audit_event();

commit;
