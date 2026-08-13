begin;

create table dashboard_private.dashboard_statistics_cache (
  actor_profile_id uuid not null,
  role text not null,
  contract_version text not null,
  request_hash text not null,
  tab text not null,
  generation bigint not null default 1,
  status text not null,
  claim_token uuid,
  lease_expires_at timestamptz,
  generated_at timestamptz,
  expires_at timestamptz,
  payload jsonb,
  constraint dashboard_statistics_cache_identity_unique
    unique (actor_profile_id, role, contract_version, request_hash),
  constraint dashboard_statistics_cache_role_valid
    check (role in ('admin', 'staff', 'teacher', 'assistant', 'viewer')),
  constraint dashboard_statistics_cache_contract_valid
    check (contract_version = 'dashboard-statistics-v1'),
  constraint dashboard_statistics_cache_hash_valid
    check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint dashboard_statistics_cache_tab_valid
    check (tab in ('overview', 'students_classes', 'schedule_conflicts', 'textbooks')),
  constraint dashboard_statistics_cache_generation_valid
    check (generation > 0),
  constraint dashboard_statistics_cache_status_valid
    check (status in ('computing', 'ready')),
  constraint dashboard_statistics_cache_state_valid
    check (
      (
        status = 'computing'
        and claim_token is not null
        and lease_expires_at is not null
        and generated_at is null
        and expires_at is null
        and payload is null
      )
      or
      (
        status = 'ready'
        and claim_token is null
        and lease_expires_at is null
        and generated_at is not null
        and expires_at is not null
        and payload is not null
        and pg_catalog.jsonb_typeof(payload) = 'object'
      )
    )
);

alter table dashboard_private.dashboard_statistics_cache enable row level security;
alter table dashboard_private.dashboard_statistics_cache force row level security;
alter table dashboard_private.dashboard_statistics_cache owner to postgres;

revoke all on table dashboard_private.dashboard_statistics_cache
  from public, anon, authenticated, service_role;

create or replace function public.read_dashboard_statistics_cache_v1(
  p_actor_profile_id uuid,
  p_role text,
  p_request_hash text,
  p_contract_version text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  cache_row dashboard_private.dashboard_statistics_cache%rowtype;
begin
  if p_actor_profile_id is null
    or p_role is null
    or p_role not in ('admin', 'staff', 'teacher', 'assistant', 'viewer')
    or p_request_hash is null
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_contract_version <> 'dashboard-statistics-v1' then
    raise exception 'dashboard_statistics_cache_request_invalid' using errcode = '22023';
  end if;

  select cache.*
  into cache_row
  from dashboard_private.dashboard_statistics_cache cache
  where cache.actor_profile_id = p_actor_profile_id
    and cache.role = p_role
    and cache.contract_version = p_contract_version
    and cache.request_hash = p_request_hash;

  if not found
    or cache_row.status <> 'ready'
    or cache_row.expires_at <= pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object('status', 'miss');
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'ready',
    'generation', cache_row.generation,
    'payload', cache_row.payload,
    'generated_at', cache_row.generated_at,
    'expires_at', cache_row.expires_at
  );
end;
$function$;

create or replace function public.claim_dashboard_statistics_cache_v1(
  p_actor_profile_id uuid,
  p_role text,
  p_request_hash text,
  p_contract_version text,
  p_tab text,
  p_force boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  cache_row dashboard_private.dashboard_statistics_cache%rowtype;
  next_claim_token uuid;
  claimed_at timestamptz;
begin
  if p_actor_profile_id is null
    or p_role is null
    or p_role not in ('admin', 'staff', 'teacher', 'assistant', 'viewer')
    or p_request_hash is null
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_contract_version <> 'dashboard-statistics-v1'
    or p_tab is null
    or p_tab not in ('overview', 'students_classes', 'schedule_conflicts', 'textbooks')
    or p_force is null then
    raise exception 'dashboard_statistics_cache_request_invalid' using errcode = '22023';
  end if;

  delete from dashboard_private.dashboard_statistics_cache cache
  where cache.ctid in (
    select expired.ctid
    from dashboard_private.dashboard_statistics_cache expired
    where expired.actor_profile_id = p_actor_profile_id
      and expired.expires_at < pg_catalog.clock_timestamp() - interval '24 hours'
    order by expires_at, role, contract_version, request_hash
    limit 20
  );

  claimed_at := pg_catalog.clock_timestamp();
  next_claim_token := pg_catalog.gen_random_uuid();

  insert into dashboard_private.dashboard_statistics_cache (
    actor_profile_id,
    role,
    contract_version,
    request_hash,
    tab,
    generation,
    status,
    claim_token,
    lease_expires_at
  ) values (
    p_actor_profile_id,
    p_role,
    p_contract_version,
    p_request_hash,
    p_tab,
    1,
    'computing',
    next_claim_token,
    claimed_at + interval '15 seconds'
  )
  on conflict (actor_profile_id, role, contract_version, request_hash) do nothing
  returning * into cache_row;

  if found then
    return pg_catalog.jsonb_build_object(
      'status', 'acquired',
      'generation', cache_row.generation,
      'claim_token', cache_row.claim_token,
      'lease_expires_at', cache_row.lease_expires_at
    );
  end if;

  select cache.*
  into strict cache_row
  from dashboard_private.dashboard_statistics_cache cache
  where cache.actor_profile_id = p_actor_profile_id
    and cache.role = p_role
    and cache.contract_version = p_contract_version
    and cache.request_hash = p_request_hash
  for update;

  if cache_row.tab <> p_tab then
    raise exception 'dashboard_statistics_cache_hash_collision' using errcode = '22023';
  end if;

  if not p_force
    and cache_row.status = 'ready'
    and cache_row.expires_at > pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object(
      'status', 'ready',
      'generation', cache_row.generation,
      'payload', cache_row.payload,
      'generated_at', cache_row.generated_at,
      'expires_at', cache_row.expires_at
    );
  end if;

  if not p_force
    and cache_row.status = 'computing'
    and cache_row.lease_expires_at > pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object(
      'status', 'wait',
      'generation', cache_row.generation,
      'lease_expires_at', cache_row.lease_expires_at
    );
  end if;

  claimed_at := pg_catalog.clock_timestamp();
  next_claim_token := pg_catalog.gen_random_uuid();
  update dashboard_private.dashboard_statistics_cache cache
  set generation = generation + 1,
      status = 'computing',
      claim_token = next_claim_token,
      lease_expires_at = claimed_at + interval '15 seconds',
      generated_at = null,
      expires_at = null,
      payload = null
  where cache.actor_profile_id = p_actor_profile_id
    and cache.role = p_role
    and cache.contract_version = p_contract_version
    and cache.request_hash = p_request_hash
  returning * into strict cache_row;

  return pg_catalog.jsonb_build_object(
    'status', 'acquired',
    'generation', cache_row.generation,
    'claim_token', cache_row.claim_token,
    'lease_expires_at', cache_row.lease_expires_at
  );
end;
$function$;

create or replace function public.finalize_dashboard_statistics_cache_v1(
  p_actor_profile_id uuid,
  p_role text,
  p_request_hash text,
  p_contract_version text,
  p_generation bigint,
  p_claim_token uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  cache_row dashboard_private.dashboard_statistics_cache%rowtype;
  stored_at timestamptz;
begin
  if p_actor_profile_id is null
    or p_role is null
    or p_role not in ('admin', 'staff', 'teacher', 'assistant', 'viewer')
    or p_request_hash is null
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_contract_version <> 'dashboard-statistics-v1'
    or p_generation is null
    or p_generation < 1
    or p_claim_token is null then
    raise exception 'dashboard_statistics_cache_request_invalid' using errcode = '22023';
  end if;

  select cache.*
  into cache_row
  from dashboard_private.dashboard_statistics_cache cache
  where cache.actor_profile_id = p_actor_profile_id
    and cache.role = p_role
    and cache.contract_version = p_contract_version
    and cache.request_hash = p_request_hash
  for update;

  if not found
    or cache_row.status <> 'computing'
    or cache_row.generation <> p_generation
    or cache_row.claim_token <> p_claim_token then
    return pg_catalog.jsonb_build_object('status', 'superseded');
  end if;

  if pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or (cache_row.tab = 'overview' and p_payload - array['summary'] <> '{}'::jsonb)
    or (cache_row.tab = 'students_classes' and p_payload - array['summary', 'studentBreakdowns', 'classGroups'] <> '{}'::jsonb)
    or (cache_row.tab = 'schedule_conflicts' and p_payload - array['range', 'teacherConflicts', 'classroomConflicts', 'examConflicts'] <> '{}'::jsonb)
    or (cache_row.tab = 'textbooks' and p_payload - array['range', 'activeTitles', 'activeClassesWithTextbook', 'activeClassesWithoutTextbook', 'progressSessions', 'updatedProgressSessions'] <> '{}'::jsonb) then
    raise exception 'dashboard_statistics_cache_payload_invalid' using errcode = '22023';
  end if;

  stored_at := pg_catalog.clock_timestamp();
  update dashboard_private.dashboard_statistics_cache cache
  set status = 'ready',
      claim_token = null,
      lease_expires_at = null,
      generated_at = stored_at,
      expires_at = stored_at + interval '10 minutes',
      payload = p_payload
  where cache.actor_profile_id = p_actor_profile_id
    and cache.role = p_role
    and cache.contract_version = p_contract_version
    and cache.request_hash = p_request_hash
    and cache.generation = p_generation
    and cache.claim_token = p_claim_token
  returning * into cache_row;

  if not found then
    return pg_catalog.jsonb_build_object('status', 'superseded');
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'stored',
    'generated_at', cache_row.generated_at,
    'expires_at', cache_row.expires_at
  );
end;
$function$;

create or replace function public.invalidate_dashboard_statistics_cache_v1(
  p_actor_profile_id uuid,
  p_role text,
  p_request_hash text,
  p_contract_version text,
  p_expected_generation bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  next_generation bigint;
begin
  if p_actor_profile_id is null
    or p_role is null
    or p_role not in ('admin', 'staff', 'teacher', 'assistant', 'viewer')
    or p_request_hash is null
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_contract_version <> 'dashboard-statistics-v1'
    or p_expected_generation is null
    or p_expected_generation < 1 then
    raise exception 'dashboard_statistics_cache_request_invalid' using errcode = '22023';
  end if;

  update dashboard_private.dashboard_statistics_cache cache
  set generation = generation + 1,
      status = 'computing',
      claim_token = pg_catalog.gen_random_uuid(),
      lease_expires_at = pg_catalog.clock_timestamp() - interval '1 millisecond',
      generated_at = null,
      expires_at = null,
      payload = null
  where cache.actor_profile_id = p_actor_profile_id
    and cache.role = p_role
    and cache.contract_version = p_contract_version
    and cache.request_hash = p_request_hash
    and cache.generation = p_expected_generation
  returning cache.generation into next_generation;

  if not found then
    return pg_catalog.jsonb_build_object('status', 'stale');
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'invalidated',
    'generation', next_generation
  );
end;
$function$;

alter function public.read_dashboard_statistics_cache_v1(uuid, text, text, text)
  owner to postgres;
alter function public.claim_dashboard_statistics_cache_v1(uuid, text, text, text, text, boolean)
  owner to postgres;
alter function public.finalize_dashboard_statistics_cache_v1(uuid, text, text, text, bigint, uuid, jsonb)
  owner to postgres;
alter function public.invalidate_dashboard_statistics_cache_v1(uuid, text, text, text, bigint)
  owner to postgres;

revoke all on function public.read_dashboard_statistics_cache_v1(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.claim_dashboard_statistics_cache_v1(uuid, text, text, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.finalize_dashboard_statistics_cache_v1(uuid, text, text, text, bigint, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.invalidate_dashboard_statistics_cache_v1(uuid, text, text, text, bigint)
  from public, anon, authenticated;

grant execute on function public.read_dashboard_statistics_cache_v1(uuid, text, text, text)
  to service_role;
grant execute on function public.claim_dashboard_statistics_cache_v1(uuid, text, text, text, text, boolean)
  to service_role;
grant execute on function public.finalize_dashboard_statistics_cache_v1(uuid, text, text, text, bigint, uuid, jsonb)
  to service_role;
grant execute on function public.invalidate_dashboard_statistics_cache_v1(uuid, text, text, text, bigint)
  to service_role;

comment on table dashboard_private.dashboard_statistics_cache is
  'Private actor-scoped ten-minute aggregate statistics cache; never stores drilldown rosters or raw source rows.';

commit;
