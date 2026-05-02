create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists name text,
  add column if not exists login_id text,
  add column if not exists email text,
  add column if not exists teacher_catalog_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_teacher_catalog_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_teacher_catalog_id_fkey
      foreign key (teacher_catalog_id) references public.teacher_catalogs(id) on delete set null;
  end if;
end
$$;

create unique index if not exists profiles_login_id_key
  on public.profiles (lower(login_id))
  where login_id is not null;

create unique index if not exists profiles_email_key
  on public.profiles (lower(email))
  where email is not null;

create index if not exists profiles_teacher_catalog_id_idx
  on public.profiles (teacher_catalog_id);

alter table public.teacher_catalogs
  add column if not exists profile_id uuid,
  add column if not exists account_email text,
  add column if not exists dashboard_role text not null default 'teacher';

update public.teacher_catalogs
set dashboard_role = 'teacher'
where dashboard_role is null or dashboard_role not in ('admin', 'staff', 'teacher', 'viewer');

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'teacher_catalogs_profile_id_fkey'
  ) then
    alter table public.teacher_catalogs
      add constraint teacher_catalogs_profile_id_fkey
      foreign key (profile_id) references public.profiles(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'teacher_catalogs_dashboard_role_check'
  ) then
    alter table public.teacher_catalogs
      add constraint teacher_catalogs_dashboard_role_check
      check (dashboard_role in ('admin', 'staff', 'teacher', 'viewer'));
  end if;
end
$$;

create unique index if not exists teacher_catalogs_profile_id_key
  on public.teacher_catalogs (profile_id)
  where profile_id is not null;

create index if not exists teacher_catalogs_account_email_idx
  on public.teacher_catalogs (lower(account_email))
  where account_email is not null;

create table if not exists public.dashboard_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid,
  actor_email text,
  actor_role text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  entity_table text not null,
  entity_id text,
  entity_label text,
  before_record jsonb,
  after_record jsonb,
  changed_at timestamptz not null default now()
);

alter table public.dashboard_audit_logs enable row level security;

drop policy if exists dashboard_audit_logs_staff_select on public.dashboard_audit_logs;
create policy dashboard_audit_logs_staff_select
  on public.dashboard_audit_logs
  for select
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff'));

drop policy if exists dashboard_audit_logs_authenticated_insert on public.dashboard_audit_logs;
create policy dashboard_audit_logs_authenticated_insert
  on public.dashboard_audit_logs
  for insert
  to authenticated
  with check (true);

create or replace function public.log_dashboard_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  audit_before jsonb;
  audit_after jsonb;
  audit_subject jsonb;
  audit_entity_id text;
  audit_entity_label text;
begin
  if tg_op = 'DELETE' then
    audit_before := to_jsonb(old);
    audit_after := null;
  elsif tg_op = 'UPDATE' then
    audit_before := to_jsonb(old);
    audit_after := to_jsonb(new);
  else
    audit_before := null;
    audit_after := to_jsonb(new);
  end if;

  audit_subject := coalesce(audit_after, audit_before, '{}'::jsonb);
  audit_entity_id := audit_subject ->> 'id';
  audit_entity_label := coalesce(
    audit_subject ->> 'name',
    audit_subject ->> 'title',
    audit_subject ->> 'email',
    audit_subject ->> 'login_id',
    audit_entity_id
  );

  insert into public.dashboard_audit_logs (
    actor_profile_id,
    actor_email,
    actor_role,
    action,
    entity_table,
    entity_id,
    entity_label,
    before_record,
    after_record
  )
  values (
    auth.uid(),
    lower(coalesce(auth.jwt() ->> 'email', '')),
    public.current_dashboard_role(),
    tg_op,
    tg_table_name,
    audit_entity_id,
    audit_entity_label,
    audit_before,
    audit_after
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists dashboard_audit_teacher_catalogs on public.teacher_catalogs;
create trigger dashboard_audit_teacher_catalogs
  after insert or update or delete on public.teacher_catalogs
  for each row execute function public.log_dashboard_audit_event();

drop trigger if exists dashboard_audit_profiles on public.profiles;
create trigger dashboard_audit_profiles
  after insert or update or delete on public.profiles
  for each row execute function public.log_dashboard_audit_event();

drop trigger if exists dashboard_audit_students on public.students;
create trigger dashboard_audit_students
  after insert or update or delete on public.students
  for each row execute function public.log_dashboard_audit_event();

drop trigger if exists dashboard_audit_classes on public.classes;
create trigger dashboard_audit_classes
  after insert or update or delete on public.classes
  for each row execute function public.log_dashboard_audit_event();

drop trigger if exists dashboard_audit_textbooks on public.textbooks;
create trigger dashboard_audit_textbooks
  after insert or update or delete on public.textbooks
  for each row execute function public.log_dashboard_audit_event();
