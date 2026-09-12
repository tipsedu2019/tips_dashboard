begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Require the scheduler dependency; operational scheduling is activated separately.
do $$ begin
  if to_regclass('cron.job') is null then
    raise exception 'recruiting_requires_pg_cron' using errcode = '55000';
  end if;
end $$;

create table public.recruiting_applications (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  phone text not null check (phone ~ '^\+?[0-9]{8,15}$'),
  subject text not null check (subject in ('영어', '수학', '과학')),
  experience text not null check (char_length(experience) between 1 and 2000),
  motivation text not null check (char_length(motivation) between 10 and 3000),
  portfolio_url text check (portfolio_url is null or (char_length(portfolio_url) <= 1000 and portfolio_url ~ '^https://')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  consent_version text not null,
  -- Retention is constrained to 365 or 730 days, not an unbounded row identifier.
  -- squawk-ignore prefer-bigint-over-int
  retention_days integer not null,
  created_at timestamptz not null default now(),
  consented_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint recruiting_consent_policy check (
    (consent_version = 'talent-pool-v1' and retention_days = 365)
    or (consent_version = 'talent-pool-v2' and retention_days = 730)
  ),
  constraint recruiting_retention_window check (expires_at = consented_at + make_interval(days => retention_days))
);
create index recruiting_applications_received_idx on public.recruiting_applications (created_at desc, id desc);
create index recruiting_applications_expiry_idx on public.recruiting_applications (expires_at);

-- Random request IDs survive an explicit deletion only until the original expiry,
-- preventing a delayed retry from recreating deleted personal information.
create table public.recruiting_application_receipts (
  request_id uuid primary key,
  application_id uuid references public.recruiting_applications(id) on delete set null,
  received_at timestamptz not null,
  expires_at timestamptz not null
);
create index recruiting_application_receipts_expiry_idx on public.recruiting_application_receipts (expires_at);
create table public.recruiting_application_rate_limits (
  fingerprint text primary key check (fingerprint ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  -- The RPC saturates counters at each quota + 1 (maximum 101) and resets windows.
  -- squawk-ignore prefer-bigint-over-int
  request_count integer not null check (request_count > 0),
  expires_at timestamptz not null
);
create index recruiting_application_rate_limits_expiry_idx on public.recruiting_application_rate_limits (expires_at);
create table public.recruiting_retention_status (
  singleton boolean primary key default true check (singleton),
  last_succeeded_at timestamptz not null
);

alter table public.recruiting_applications enable row level security;
alter table public.recruiting_application_receipts enable row level security;
alter table public.recruiting_application_rate_limits enable row level security;
alter table public.recruiting_retention_status enable row level security;
revoke all on public.recruiting_applications, public.recruiting_application_receipts,
  public.recruiting_application_rate_limits, public.recruiting_retention_status from public, anon, authenticated;
grant select, insert, update, delete on public.recruiting_applications, public.recruiting_application_receipts,
  public.recruiting_application_rate_limits, public.recruiting_retention_status to service_role;
grant select, delete on public.recruiting_applications to authenticated;
grant select on public.recruiting_retention_status to authenticated;

create policy recruiting_admin_read on public.recruiting_applications for select to authenticated
  using ((select auth.uid()) is not null and (select public.current_dashboard_role()) = 'admin' and expires_at > now());
create policy recruiting_admin_delete on public.recruiting_applications for delete to authenticated
  using ((select auth.uid()) is not null and (select public.current_dashboard_role()) = 'admin');
create policy recruiting_admin_retention_read on public.recruiting_retention_status for select to authenticated
  using ((select auth.uid()) is not null and (select public.current_dashboard_role()) = 'admin');

create function public.purge_expired_recruiting_applications_v1()
returns jsonb language plpgsql security invoker set search_path = '' set statement_timeout = '5s'
as $$
declare v_applications integer; v_receipts integer; v_rates integer;
begin
  delete from public.recruiting_applications where expires_at <= now();
  get diagnostics v_applications = row_count;
  delete from public.recruiting_application_receipts where expires_at <= now();
  get diagnostics v_receipts = row_count;
  delete from public.recruiting_application_rate_limits where expires_at <= now();
  get diagnostics v_rates = row_count;
  insert into public.recruiting_retention_status(singleton, last_succeeded_at) values (true, now())
    on conflict (singleton) do update set last_succeeded_at = excluded.last_succeeded_at;
  return jsonb_build_object('applications', v_applications, 'receipts', v_receipts, 'rateLimits', v_rates);
end;
$$;
revoke all on function public.purge_expired_recruiting_applications_v1() from public, anon, authenticated;
grant execute on function public.purge_expired_recruiting_applications_v1() to service_role;

create function public.submit_recruiting_application_v1(
  p_request_id uuid, p_request_hash text, p_ip_fingerprint text,
  p_contact_fingerprint text, p_global_fingerprint text,
  p_name text, p_phone text, p_subject text, p_experience text, p_motivation text,
  p_portfolio_url text, p_consent_version text, p_retention_days integer
)
returns jsonb language plpgsql security invoker set search_path = ''
  set statement_timeout = '5s' set lock_timeout = '3s'
as $$
declare
  v_receipt public.recruiting_application_receipts%rowtype;
  v_hash text; v_id uuid; v_now timestamptz := now(); v_expiry timestamptz;
  v_quota record; v_bucket timestamptz; v_count integer;
begin
  if p_request_id is null or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_ip_fingerprint is null or p_ip_fingerprint !~ '^[0-9a-f]{64}$'
    or p_contact_fingerprint is null or p_contact_fingerprint !~ '^[0-9a-f]{64}$'
    or p_global_fingerprint is null or p_global_fingerprint !~ '^[0-9a-f]{64}$'
    or p_name is null or char_length(p_name) not between 2 and 80
    or p_phone is null or p_phone !~ '^\+?[0-9]{8,15}$'
    or p_subject is null or p_subject not in ('영어', '수학', '과학')
    or p_experience is null or char_length(p_experience) not between 1 and 2000
    or p_motivation is null or char_length(p_motivation) not between 10 and 3000
    or (p_portfolio_url is not null and (char_length(p_portfolio_url) > 1000 or p_portfolio_url !~ '^https://'))
    or p_consent_version is null or p_retention_days is null
    or not ((p_consent_version = 'talent-pool-v1' and p_retention_days = 365)
      or (p_consent_version = 'talent-pool-v2' and p_retention_days = 730))
  then raise exception 'recruiting_request_invalid' using errcode = '22023'; end if;

  -- An unhealthy/missing cleanup job closes intake; expired content is also hidden
  -- by RLS immediately, even before the hourly physical purge.
  if not exists (select 1 from public.recruiting_retention_status
    where singleton and last_succeeded_at > v_now - interval '3 hours')
  then return jsonb_build_object('status', 'unavailable'); end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 7119));
  select * into v_receipt from public.recruiting_application_receipts where request_id = p_request_id;
  if found then
    if v_receipt.application_id is null or v_receipt.expires_at <= v_now then
      return jsonb_build_object('status', 'gone');
    end if;
    select request_hash into v_hash from public.recruiting_applications where id = v_receipt.application_id;
    if v_hash is distinct from p_request_hash then return jsonb_build_object('status', 'conflict'); end if;
    return jsonb_build_object('status', 'accepted', 'applicationId', v_receipt.application_id, 'receivedAt', v_receipt.received_at);
  end if;

  -- Global quota first bounds both total intake and creation of fingerprint rows.
  -- Atomic upserts serialize across instances. Replays do not consume quota.
  for v_quota in select * from (values
    (p_global_fingerprint, 3600, 100), (p_ip_fingerprint, 3600, 5), (p_contact_fingerprint, 86400, 3)
  ) as quotas(fingerprint, seconds, maximum)
  loop
    v_bucket := to_timestamp(floor(extract(epoch from v_now) / v_quota.seconds) * v_quota.seconds);
    insert into public.recruiting_application_rate_limits(fingerprint, window_started_at, request_count, expires_at)
      values (v_quota.fingerprint, v_bucket, 1, v_bucket + interval '2 days')
      on conflict (fingerprint) do update set
        window_started_at = excluded.window_started_at,
        request_count = case when public.recruiting_application_rate_limits.window_started_at = excluded.window_started_at
          then least(public.recruiting_application_rate_limits.request_count + 1, v_quota.maximum + 1) else 1 end,
        expires_at = excluded.expires_at
      returning request_count into v_count;
    if v_count > v_quota.maximum then
      return jsonb_build_object('status', 'rate_limited', 'retryAfter', greatest(1, ceil(extract(epoch from (v_bucket + make_interval(secs => v_quota.seconds) - v_now)))::integer));
    end if;
  end loop;

  v_id := gen_random_uuid();
  v_expiry := v_now + make_interval(days => p_retention_days);
  insert into public.recruiting_applications(id, name, phone, subject, experience, motivation,
    portfolio_url, request_hash, consent_version, retention_days, created_at, consented_at, expires_at)
    values (v_id, p_name, p_phone, p_subject, p_experience, p_motivation, p_portfolio_url,
      p_request_hash, p_consent_version, p_retention_days, v_now, v_now, v_expiry);
  insert into public.recruiting_application_receipts(request_id, application_id, received_at, expires_at)
    values (p_request_id, v_id, v_now, v_expiry);
  return jsonb_build_object('status', 'accepted', 'applicationId', v_id, 'receivedAt', v_now);
end;
$$;
revoke all on function public.submit_recruiting_application_v1(uuid, text, text, text, text, text, text, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.submit_recruiting_application_v1(uuid, text, text, text, text, text, text, text, text, text, text, text, integer) to service_role;

-- Installation does not schedule jobs or purge rows. Intake stays unavailable until
-- scripts/operations/activate-recruiting-retention.sql is explicitly executed.
commit;
