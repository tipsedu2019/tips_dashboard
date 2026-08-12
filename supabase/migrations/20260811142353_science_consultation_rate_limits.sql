create table public.science_consultation_rate_limits (
  fingerprint text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  blocked_until timestamptz,
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 days'),

  constraint science_consultation_rate_fingerprint_check
    check (fingerprint ~ '^[a-f0-9]{64}$'),
  constraint science_consultation_rate_count_check
    check (request_count between 0 and 1000)
);

comment on table public.science_consultation_rate_limits is
  'Short-lived, irreversible request fingerprints used only to rate-limit the public science consultation endpoint.';

create index science_consultation_rate_limits_expires_at_idx
  on public.science_consultation_rate_limits (expires_at);

alter table public.science_consultation_rate_limits enable row level security;

revoke all on table public.science_consultation_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.science_consultation_rate_limits to service_role;

create policy "No direct client access"
on public.science_consultation_rate_limits
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

select cron.schedule(
  'science-consultation-rate-limit-cleanup',
  '47 3 * * *',
  $cron$
    delete from public.science_consultation_rate_limits
    where expires_at <= now();
  $cron$
);