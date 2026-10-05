-- Synthetic prerequisites for the focused, disposable owner QA database only.
-- This is not the reviewed dashboard baseline or provider JWT verification.
begin;
create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists dashboard_private;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap with schema public;
create table if not exists auth.users (
  id uuid primary key,
  instance_id uuid,
  aud text,
  role text,
  email text,
  raw_app_meta_data jsonb not null default '{}',
  raw_user_meta_data jsonb not null default '{}',
  deleted_at timestamptz,
  banned_until timestamptz
);
-- The image's initial auth schema predates some metadata fields used by the
-- reviewed AI chain. Supply these nullable prerequisites in this empty DB only.
alter table auth.users add column if not exists deleted_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;
create table if not exists public.profiles (
  id uuid primary key references auth.users(id),
  role text,
  name text
);
-- The runner separately replays byte-exact canonical legacy credential catalog
-- statements. It does not substitute a function or execute the legacy issuer.
-- The unchanged final authz suite counts the legacy notification stores to
-- check no-send behavior. Only empty counters are supplied; no legacy RPC,
-- trigger, provider or notification subsystem is reproduced by this fixture.
create table if not exists dashboard_private.notification_events (id uuid primary key default gen_random_uuid());
create table if not exists dashboard_private.notification_deliveries (id uuid primary key default gen_random_uuid());
alter table dashboard_private.notification_events enable row level security;
alter table dashboard_private.notification_deliveries enable row level security;
revoke all on dashboard_private.notification_events,dashboard_private.notification_deliveries from public,anon,authenticated,service_role;
-- Supabase's cached image may already initialize empty auth relations. Reuse
-- their real shape only in this newly created isolated DB; never accept rows.
do $synthetic_empty$
begin
  if exists(select 1 from auth.users) or exists(select 1 from public.profiles)
    or exists(select 1 from dashboard_private.notification_events)
    or exists(select 1 from dashboard_private.notification_deliveries) then
    raise exception using errcode='55000',message='personal_owner_fixture_not_empty';
  end if;
end
$synthetic_empty$;
alter table public.profiles enable row level security;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),auth.jwt()->>'sub')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),auth.jwt()->>'role')
$$;
create or replace function public.current_dashboard_role() returns text
language sql stable security definer set search_path='' as $$
  select p.role from public.profiles p where p.id=auth.uid()
$$;
-- Match the private-schema USAGE prerequisites; migration ACLs remain decisive.
grant usage on schema public,auth,extensions to anon,authenticated,service_role;
revoke all on schema dashboard_private from public,anon;
grant usage on schema dashboard_private to authenticated,service_role;
revoke all on auth.users,public.profiles from public,anon,authenticated,service_role;
revoke all on function public.current_dashboard_role() from public,anon,service_role;
grant execute on function public.current_dashboard_role() to authenticated;
commit;
