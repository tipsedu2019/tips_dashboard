create table if not exists public.class_schedule_sync_groups (
  id uuid primary key default gen_random_uuid(),
  term_id uuid references public.class_terms(id) on delete set null,
  name text not null,
  subject text,
  color text not null default '#3182f6',
  note text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.class_schedule_sync_groups
  add column if not exists term_id uuid references public.class_terms(id) on delete set null,
  add column if not exists name text,
  add column if not exists subject text,
  add column if not exists color text not null default '#3182f6',
  add column if not exists note text not null default '',
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.class_schedule_sync_group_members (
  group_id uuid not null references public.class_schedule_sync_groups(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  primary key (group_id, class_id)
);

alter table public.class_schedule_sync_group_members
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_at timestamptz default now();

create unique index if not exists class_schedule_sync_group_members_class_id_key
  on public.class_schedule_sync_group_members (class_id);

alter table public.progress_logs
  add column if not exists progress_key text,
  add column if not exists session_id text,
  add column if not exists session_order integer,
  add column if not exists status text,
  add column if not exists range_start text,
  add column if not exists range_end text,
  add column if not exists range_label text,
  add column if not exists public_note text,
  add column if not exists teacher_note text,
  add column if not exists updated_at timestamptz default now();

create unique index if not exists progress_logs_progress_key_key
  on public.progress_logs (progress_key)
  where progress_key is not null;

create index if not exists progress_logs_session_lookup_idx
  on public.progress_logs (class_id, session_id, textbook_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'progress_logs_status_check'
  ) then
    alter table public.progress_logs
      add constraint progress_logs_status_check
      check (status in ('pending', 'partial', 'done') or status is null);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'set_updated_at_class_schedule_sync_groups'
  ) then
    create trigger set_updated_at_class_schedule_sync_groups
      before update on public.class_schedule_sync_groups
      for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_updated_at_progress_logs'
  ) then
    create trigger set_updated_at_progress_logs
      before update on public.progress_logs
      for each row execute function public.set_updated_at();
  end if;
end
$$;

alter table public.progress_logs enable row level security;
alter table public.class_schedule_sync_groups enable row level security;
alter table public.class_schedule_sync_group_members enable row level security;

drop policy if exists progress_logs_authenticated_select on public.progress_logs;
create policy progress_logs_authenticated_select
  on public.progress_logs
  for select
  to authenticated
  using (true);

drop policy if exists progress_logs_teacher_write on public.progress_logs;
create policy progress_logs_teacher_write
  on public.progress_logs
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff', 'teacher')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff', 'teacher')
    )
  );

drop policy if exists class_schedule_sync_groups_authenticated_select on public.class_schedule_sync_groups;
create policy class_schedule_sync_groups_authenticated_select
  on public.class_schedule_sync_groups
  for select
  to authenticated
  using (true);

drop policy if exists class_schedule_sync_groups_staff_write on public.class_schedule_sync_groups;
create policy class_schedule_sync_groups_staff_write
  on public.class_schedule_sync_groups
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff')
    )
  );

drop policy if exists class_schedule_sync_group_members_authenticated_select on public.class_schedule_sync_group_members;
create policy class_schedule_sync_group_members_authenticated_select
  on public.class_schedule_sync_group_members
  for select
  to authenticated
  using (true);

drop policy if exists class_schedule_sync_group_members_staff_write on public.class_schedule_sync_group_members;
create policy class_schedule_sync_group_members_staff_write
  on public.class_schedule_sync_group_members
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'staff')
    )
  );
