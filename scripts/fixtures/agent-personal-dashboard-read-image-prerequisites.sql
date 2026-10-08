-- Fresh owned network-none image only; no incomplete public table stubs.
-- These GUC readers copy the earlier synthetic fixture's function definitions.
-- They do not verify a provider JWT. The reviewed capture has no auth function
-- fingerprints; all captured public/domain functions come from its baseline.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap with schema public;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
alter table auth.users add column if not exists deleted_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),auth.jwt()->>'sub')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),auth.jwt()->>'role')
$$;
do $empty$
begin
 if exists(select 1 from auth.users) or to_regclass('public.profiles') is not null
  or to_regprocedure('auth.uid()') is null or to_regprocedure('auth.jwt()') is null
  or to_regprocedure('auth.role()') is null then
  raise exception using errcode='55000',message='dashboard_read_image_prerequisites_invalid';
 end if;
end $empty$;
-- The unchanged forward public-content migration requires these managed
-- Storage relations. Reuse only the previous offline replay's empty shape;
-- this does not implement or test the Storage service or file operations.
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key,bucket_id text references storage.buckets(id));
alter table storage.objects enable row level security;
alter table storage.buckets owner to postgres;
alter table storage.objects owner to postgres;
revoke all on storage.buckets,storage.objects from public,anon,authenticated,service_role;
commit;
