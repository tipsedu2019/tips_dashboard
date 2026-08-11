begin;

do $migration$
declare
  v_dependency text;
begin
  foreach v_dependency in array array[
    'public.profiles',
    'dashboard_private.notification_rules',
    'dashboard_private.notification_deliveries',
    'public.ops_registration_observations',
    'public.ops_registration_appointments',
    'public.ops_task_events',
    'dashboard_private.registration_observation_runtime_settings'
  ]
  loop
    if pg_catalog.to_regclass(v_dependency) is null then
      raise exception 'dashboard_google_chat_profile_mentions_dependency_missing:%',
        v_dependency
        using errcode = '55000';
    end if;
  end loop;

  foreach v_dependency in array array[
    'dashboard_private.notification_profile_is_active_v1(uuid)',
    'public.registration_observation_schema_readiness_v1()',
    'public.registration_observation_runtime_version()',
    'public.common_notification_control_plane_runtime_version()',
    'dashboard_private.notification_runtime_dependency_ready_v1(text)',
    'dashboard_private.notification_canonical_json_v1(jsonb)',
    'dashboard_private.notification_sha256_hex_v1(text)'
  ]
  loop
    if pg_catalog.to_regprocedure(v_dependency) is null then
      raise exception 'dashboard_google_chat_profile_mentions_dependency_missing:%',
        v_dependency
        using errcode = '55000';
    end if;
  end loop;
end;
$migration$;

create or replace function dashboard_private.google_chat_canonical_uuid_array_v1(
  p_values uuid[]
)
returns uuid[]
language sql
immutable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.array_agg(value order by value),
    array[]::uuid[]
  )
  from (
    select distinct item.value
    from pg_catalog.unnest(coalesce(p_values, array[]::uuid[])) item(value)
    where item.value is not null
  ) canonical;
$$;

create or replace function dashboard_private.google_chat_uuid_array_distinct_v1(
  p_values uuid[]
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select p_values is not null
    and pg_catalog.array_position(p_values, null::uuid) is null
    and pg_catalog.cardinality(p_values) = (
      select pg_catalog.count(distinct item.value)
      from pg_catalog.unnest(p_values) item(value)
    );
$$;

create or replace function dashboard_private.google_chat_user_names_valid_v1(
  p_values text[]
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select p_values is not null
    and coalesce(
      (
        select pg_catalog.bool_and(
          item.value ~ '^users/[1-9][0-9]{0,31}$'
        )
        from pg_catalog.unnest(p_values) item(value)
      ),
      true
    );
$$;

create table dashboard_private.google_chat_profile_identities (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  account_email_snapshot text not null,
  chat_user_id text,
  source text,
  verification_status text not null,
  verified_at timestamptz,
  last_sync_status text not null,
  last_sync_at timestamptz not null,
  identity_revision bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_chat_profile_identities_email_check
    check (
      account_email_snapshot = pg_catalog.lower(pg_catalog.btrim(account_email_snapshot))
      and account_email_snapshot ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    ),
  constraint google_chat_profile_identities_user_id_check
    check (chat_user_id is null or chat_user_id ~ '^[1-9][0-9]{0,31}$'),
  constraint google_chat_profile_identities_source_check
    check (source is null or source in ('directory', 'manual')),
  constraint google_chat_profile_identities_verification_status_check
    check (verification_status in ('verified', 'unverified', 'not_found')),
  constraint google_chat_profile_identities_last_sync_status_check
    check (last_sync_status in ('ok', 'not_found', 'email_mismatch', 'provider_error')),
  constraint google_chat_profile_identities_revision_check
    check (identity_revision > 0),
  constraint google_chat_profile_identities_verified_shape_check
    check (
      (
        verification_status = 'verified'
        and chat_user_id is not null
        and source is not null
        and verified_at is not null
        and last_sync_status in ('ok', 'provider_error')
      )
      or
      (
        verification_status <> 'verified'
        and chat_user_id is null
        and source is null
        and verified_at is null
      )
    ),
  constraint google_chat_profile_identities_terminal_status_check
    check (
      (last_sync_status = 'ok' and verification_status = 'verified')
      or (last_sync_status = 'not_found' and verification_status = 'not_found')
      or (last_sync_status = 'email_mismatch' and verification_status = 'unverified')
      or last_sync_status = 'provider_error'
    )
);

create unique index google_chat_profile_identities_user_id_uidx
  on dashboard_private.google_chat_profile_identities(chat_user_id)
  where chat_user_id is not null;

create table dashboard_private.google_chat_profile_identity_audits (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null,
  before_identity jsonb not null,
  after_identity jsonb not null,
  created_at timestamptz not null default now(),
  constraint google_chat_profile_identity_audits_objects_check
    check (
      pg_catalog.jsonb_typeof(before_identity) = 'object'
      and pg_catalog.jsonb_typeof(after_identity) = 'object'
    )
);

create index google_chat_profile_identity_audits_profile_idx
  on dashboard_private.google_chat_profile_identity_audits(profile_id, created_at desc);

create table dashboard_private.google_chat_profile_identity_requests (
  request_id uuid primary key,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  request_fingerprint text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  constraint google_chat_profile_identity_requests_fingerprint_check
    check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint google_chat_profile_identity_requests_response_check
    check (pg_catalog.jsonb_typeof(response) = 'object')
);

create table dashboard_private.notification_rule_mention_settings (
  rule_id uuid primary key
    references dashboard_private.notification_rules(id) on delete cascade,
  mention_enabled boolean not null,
  revision bigint not null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_rule_mention_settings_revision_check
    check (revision > 0)
);

create table dashboard_private.notification_rule_mention_setting_audits (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references dashboard_private.notification_rules(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null,
  before_setting jsonb not null,
  after_setting jsonb not null,
  created_at timestamptz not null default now(),
  constraint notification_rule_mention_setting_audits_objects_check
    check (
      pg_catalog.jsonb_typeof(before_setting) = 'object'
      and pg_catalog.jsonb_typeof(after_setting) = 'object'
    )
);

create index notification_rule_mention_setting_audits_rule_idx
  on dashboard_private.notification_rule_mention_setting_audits(rule_id, created_at desc);

create table dashboard_private.notification_rule_mention_setting_requests (
  request_id uuid primary key,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  rule_id uuid not null references dashboard_private.notification_rules(id) on delete restrict,
  request_fingerprint text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  constraint notification_rule_mention_setting_requests_fingerprint_check
    check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint notification_rule_mention_setting_requests_response_check
    check (pg_catalog.jsonb_typeof(response) = 'object')
);

create table dashboard_private.notification_assignment_change_facts (
  fact_id uuid primary key default gen_random_uuid(),
  workflow_key text not null,
  source_type text not null,
  source_id text not null,
  source_revision bigint,
  context_entity_id uuid not null,
  role_key text not null,
  previous_profile_ids uuid[] not null,
  current_profile_ids uuid[] not null,
  occurred_at timestamptz not null default now(),
  constraint notification_assignment_change_facts_workflow_check
    check (workflow_key = 'registration'),
  constraint notification_assignment_change_facts_source_type_check
    check (source_type in ('registration_observation', 'registration_track_event')),
  constraint notification_assignment_change_facts_source_revision_check
    check (source_revision is null or source_revision >= 0),
  constraint notification_assignment_change_facts_kind_check
    check (role_key in ('subject_teacher', 'track_director')),
  constraint notification_assignment_change_facts_canonical_arrays_check
    check (
      previous_profile_ids = dashboard_private.google_chat_canonical_uuid_array_v1(previous_profile_ids)
      and current_profile_ids = dashboard_private.google_chat_canonical_uuid_array_v1(current_profile_ids)
      and previous_profile_ids is distinct from current_profile_ids
    ),
  constraint notification_assignment_change_facts_kind_source_check
    check (
      (
        role_key = 'subject_teacher'
        and source_type = 'registration_observation'
        and source_revision is not null
      )
      or
      (
        role_key = 'track_director'
        and source_type = 'registration_track_event'
        and source_revision is null
      )
    )
);

create unique index notification_assignment_change_facts_source_uidx
  on dashboard_private.notification_assignment_change_facts(
    workflow_key, source_type, source_id,
    coalesce(source_revision, -1), role_key
  );

create table dashboard_private.notification_delivery_mention_snapshots (
  delivery_id uuid primary key
    references dashboard_private.notification_deliveries(id) on delete restrict,
  rule_id uuid not null references dashboard_private.notification_rules(id) on delete restrict,
  setting_revision bigint not null,
  mention_enabled boolean not null,
  profile_ids uuid[] not null,
  user_names text[] not null,
  omitted jsonb not null,
  identity_revision_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint notification_delivery_mention_snapshots_setting_revision_check
    check (setting_revision > 0),
  constraint notification_delivery_mention_snapshots_profile_ids_check
    check (dashboard_private.google_chat_uuid_array_distinct_v1(profile_ids)),
  constraint notification_delivery_mention_snapshots_user_names_check
    check (dashboard_private.google_chat_user_names_valid_v1(user_names)),
  constraint notification_delivery_mention_snapshots_omitted_check
    check (pg_catalog.jsonb_typeof(omitted) = 'array'),
  constraint notification_delivery_mention_snapshots_fingerprint_check
    check (identity_revision_fingerprint ~ '^[a-f0-9]{64}$')
);

alter table dashboard_private.google_chat_profile_identities enable row level security;
alter table dashboard_private.google_chat_profile_identity_audits enable row level security;
alter table dashboard_private.google_chat_profile_identity_requests enable row level security;
alter table dashboard_private.notification_rule_mention_settings enable row level security;
alter table dashboard_private.notification_rule_mention_setting_audits enable row level security;
alter table dashboard_private.notification_rule_mention_setting_requests enable row level security;
alter table dashboard_private.notification_assignment_change_facts enable row level security;
alter table dashboard_private.notification_delivery_mention_snapshots enable row level security;

create or replace function dashboard_private.reject_google_chat_mention_row_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'google_chat_mention_row_immutable' using errcode = '55000';
end;
$$;

create trigger google_chat_profile_identity_audits_immutable
before update or delete on dashboard_private.google_chat_profile_identity_audits
for each row execute function dashboard_private.reject_google_chat_mention_row_mutation_v1();

create trigger google_chat_profile_identity_requests_immutable
before update or delete on dashboard_private.google_chat_profile_identity_requests
for each row execute function dashboard_private.reject_google_chat_mention_row_mutation_v1();

create trigger notification_rule_mention_setting_audits_immutable
before update or delete on dashboard_private.notification_rule_mention_setting_audits
for each row execute function dashboard_private.reject_google_chat_mention_row_mutation_v1();

create trigger notification_rule_mention_setting_requests_immutable
before update or delete on dashboard_private.notification_rule_mention_setting_requests
for each row execute function dashboard_private.reject_google_chat_mention_row_mutation_v1();

create trigger notification_assignment_change_facts_immutable
before update or delete on dashboard_private.notification_assignment_change_facts
for each row execute function dashboard_private.reject_google_chat_mention_row_mutation_v1();

create trigger notification_delivery_mention_snapshots_immutable
before update or delete on dashboard_private.notification_delivery_mention_snapshots
for each row execute function dashboard_private.reject_google_chat_mention_row_mutation_v1();

create or replace function dashboard_private.validate_notification_rule_mention_setting_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from dashboard_private.notification_rules rule
    where rule.id = new.rule_id
      and rule.channel_key = 'google_chat'
  ) then
    raise exception 'notification_mention_setting_rule_invalid'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_notification_rule_mention_setting
before insert or update of rule_id
on dashboard_private.notification_rule_mention_settings
for each row execute function dashboard_private.validate_notification_rule_mention_setting_v1();

create or replace function dashboard_private.prevent_adopted_mention_rule_channel_drift_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.channel_key = 'google_chat'
    and new.channel_key is distinct from 'google_chat'
    and exists (
      select 1
      from dashboard_private.notification_rule_mention_settings setting
      where setting.rule_id = old.id
    )
  then
    raise exception 'notification_mention_setting_rule_invalid'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger prevent_adopted_mention_rule_channel_drift
before update of channel_key on dashboard_private.notification_rules
for each row execute function dashboard_private.prevent_adopted_mention_rule_channel_drift_v1();

create or replace function dashboard_private.assert_google_chat_mentions_manager_v1(
  p_actor_profile_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select profile.role
  into v_role
  from public.profiles profile
  where profile.id = p_actor_profile_id;

  if p_actor_profile_id is null
    or v_role not in ('admin', 'staff')
    or not dashboard_private.notification_profile_is_active_v1(p_actor_profile_id)
  then
    raise exception 'google_chat_profile_mentions_access_denied'
      using errcode = '42501';
  end if;
  return v_role;
end;
$$;

create or replace function dashboard_private.google_chat_profile_identity_json_v1(
  p_profile_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'profileId', profile.id,
    'profileName', profile.name,
    'accountEmail', pg_catalog.lower(pg_catalog.btrim(account.email)),
    'dashboardRole', profile.role,
    'chatUserId', identity.chat_user_id,
    'resourceName', case
      when identity.chat_user_id is not null
        then 'users/' || identity.chat_user_id
      else null
    end,
    'source', identity.source,
    'verificationStatus', coalesce(identity.verification_status, 'unverified'),
    'verifiedAt', identity.verified_at,
    'lastSyncStatus', identity.last_sync_status,
    'lastSyncAt', identity.last_sync_at,
    'identityRevision', coalesce(identity.identity_revision, 0)::text,
    'eligible', (
      dashboard_private.notification_profile_is_active_v1(profile.id)
      and identity.verification_status = 'verified'
      and identity.chat_user_id is not null
      and identity.account_email_snapshot = pg_catalog.lower(pg_catalog.btrim(account.email))
    ) is true
  )
  from public.profiles profile
  join auth.users account on account.id = profile.id
  left join dashboard_private.google_chat_profile_identities identity
    on identity.profile_id = profile.id
  where profile.id = p_profile_id;
$$;

create or replace function public.list_google_chat_profile_identities_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform dashboard_private.assert_google_chat_mentions_manager_v1((select auth.uid()));

  select coalesce(
    pg_catalog.jsonb_agg(
      dashboard_private.google_chat_profile_identity_json_v1(profile.id)
      order by profile.name, profile.id
    ),
    '[]'::jsonb
  )
  into v_result
  from public.profiles profile
  join auth.users account on account.id = profile.id;

  return v_result;
end;
$$;

create or replace function public.read_google_chat_profile_identity_sync_source_v1(
  p_actor_profile_id uuid,
  p_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_chat_profile_mentions_service_role_required'
      using errcode = '42501';
  end if;
  perform dashboard_private.assert_google_chat_mentions_manager_v1(p_actor_profile_id);

  select pg_catalog.jsonb_build_object(
    'profileId', profile.id,
    'profileName', profile.name,
    'accountEmail', pg_catalog.lower(pg_catalog.btrim(account.email)),
    'dashboardRole', profile.role,
    'identityRevision', coalesce(identity.identity_revision, 0)::text
  )
  into v_result
  from public.profiles profile
  join auth.users account on account.id = profile.id
  left join dashboard_private.google_chat_profile_identities identity
    on identity.profile_id = profile.id
  where profile.id = p_profile_id;

  if v_result is null then
    raise exception 'google_chat_profile_identity_not_found'
      using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

create or replace function public.apply_google_chat_profile_identity_sync_v1(
  p_actor_profile_id uuid,
  p_profile_id uuid,
  p_account_email_snapshot text,
  p_lookup_mode text,
  p_candidate_chat_user_id text,
  p_sync_outcome text,
  p_expected_identity_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_email text;
  v_existing dashboard_private.google_chat_profile_identities%rowtype;
  v_before jsonb := '{}'::jsonb;
  v_response jsonb;
  v_fingerprint text;
  v_request dashboard_private.google_chat_profile_identity_requests%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_keep_verified boolean := false;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_chat_profile_mentions_service_role_required'
      using errcode = '42501';
  end if;
  perform dashboard_private.assert_google_chat_mentions_manager_v1(p_actor_profile_id);

  if p_profile_id is null
    or p_request_id is null
    or p_expected_identity_revision is null
    or p_expected_identity_revision < 0
    or p_lookup_mode not in ('auto', 'manual')
    or p_sync_outcome not in ('verified', 'not_found', 'email_mismatch', 'provider_error')
    or nullif(pg_catalog.btrim(p_account_email_snapshot), '') is null
    or (
      p_sync_outcome = 'verified'
      and (
        p_candidate_chat_user_id is null
        or pg_catalog.btrim(p_candidate_chat_user_id) !~ '^[1-9][0-9]{0,31}$'
      )
    )
    or (p_sync_outcome <> 'verified' and p_candidate_chat_user_id is not null)
  then
    raise exception 'google_chat_profile_identity_invalid'
      using errcode = '22023';
  end if;

  select pg_catalog.lower(pg_catalog.btrim(account.email))
  into v_current_email
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.id = p_profile_id
  for update of profile, account;

  if v_current_email is null then
    raise exception 'google_chat_profile_identity_not_found'
      using errcode = 'P0002';
  end if;
  if v_current_email is distinct from pg_catalog.lower(pg_catalog.btrim(p_account_email_snapshot)) then
    raise exception 'google_chat_profile_identity_source_changed'
      using errcode = '40001';
  end if;

  select * into v_existing
  from dashboard_private.google_chat_profile_identities identity
  where identity.profile_id = p_profile_id
  for update;

  v_fingerprint := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(
      pg_catalog.jsonb_build_object(
        'actorProfileId', p_actor_profile_id,
        'profileId', p_profile_id,
        'accountEmailSnapshot', v_current_email,
        'lookupMode', p_lookup_mode,
        'candidateChatUserId', p_candidate_chat_user_id,
        'syncOutcome', p_sync_outcome,
        'expectedIdentityRevision', p_expected_identity_revision
      )
    )
  );

  select * into v_request
  from dashboard_private.google_chat_profile_identity_requests request_row
  where request_row.request_id = p_request_id
  for update;
  if found then
    if v_request.request_fingerprint is distinct from v_fingerprint then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_request.response;
  end if;

  if coalesce(v_existing.identity_revision, 0) is distinct from p_expected_identity_revision then
    raise exception 'google_chat_profile_identity_revision_conflict'
      using errcode = '40001';
  end if;

  if v_existing.profile_id is not null then
    v_before := dashboard_private.google_chat_profile_identity_json_v1(p_profile_id);
  end if;

  v_keep_verified := p_sync_outcome = 'provider_error'
    and v_existing.verification_status = 'verified'
    and v_existing.chat_user_id is not null
    and v_existing.account_email_snapshot = v_current_email;

  insert into dashboard_private.google_chat_profile_identities(
    profile_id, account_email_snapshot, chat_user_id, source,
    verification_status, verified_at, last_sync_status, last_sync_at,
    identity_revision, created_at, updated_at
  ) values (
    p_profile_id,
    v_current_email,
    case
      when p_sync_outcome = 'verified' then pg_catalog.btrim(p_candidate_chat_user_id)
      when v_keep_verified then v_existing.chat_user_id
      else null
    end,
    case
      when p_sync_outcome = 'verified' and p_lookup_mode = 'auto' then 'directory'
      when p_sync_outcome = 'verified' then 'manual'
      when v_keep_verified then v_existing.source
      else null
    end,
    case
      when p_sync_outcome = 'verified' or v_keep_verified then 'verified'
      when p_sync_outcome = 'not_found' then 'not_found'
      else 'unverified'
    end,
    case
      when p_sync_outcome = 'verified' then v_now
      when v_keep_verified then v_existing.verified_at
      else null
    end,
    case when p_sync_outcome = 'verified' then 'ok' else p_sync_outcome end,
    v_now,
    p_expected_identity_revision + 1,
    coalesce(v_existing.created_at, v_now),
    v_now
  )
  on conflict (profile_id) do update
  set account_email_snapshot = excluded.account_email_snapshot,
      chat_user_id = excluded.chat_user_id,
      source = excluded.source,
      verification_status = excluded.verification_status,
      verified_at = excluded.verified_at,
      last_sync_status = excluded.last_sync_status,
      last_sync_at = excluded.last_sync_at,
      identity_revision = excluded.identity_revision,
      updated_at = excluded.updated_at;

  v_response := dashboard_private.google_chat_profile_identity_json_v1(p_profile_id);

  insert into dashboard_private.google_chat_profile_identity_audits(
    profile_id, actor_profile_id, request_id, before_identity, after_identity
  ) values (p_profile_id, p_actor_profile_id, p_request_id, v_before, v_response);

  insert into dashboard_private.google_chat_profile_identity_requests(
    request_id, actor_profile_id, profile_id, request_fingerprint, response
  ) values (p_request_id, p_actor_profile_id, p_profile_id, v_fingerprint, v_response);

  return v_response;
end;
$$;

create or replace function dashboard_private.notification_rule_mention_setting_json_v1(
  p_rule_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'ruleId', rule.id,
    'workflowKey', rule.workflow_key,
    'eventKey', rule.event_key,
    'channelKey', rule.channel_key,
    'mentionEnabled', setting.mention_enabled,
    'revision', setting.revision::text,
    'updatedAt', setting.updated_at,
    'editable', true
  )
  from dashboard_private.notification_rule_mention_settings setting
  join dashboard_private.notification_rules rule on rule.id = setting.rule_id
  where setting.rule_id = p_rule_id
    and rule.channel_key = 'google_chat';
$$;

create or replace function public.list_notification_rule_mention_settings_v1(
  p_workflow_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform dashboard_private.assert_google_chat_mentions_manager_v1((select auth.uid()));
  if nullif(pg_catalog.btrim(p_workflow_key), '') is null then
    raise exception 'notification_mention_setting_workflow_invalid'
      using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      dashboard_private.notification_rule_mention_setting_json_v1(setting.rule_id)
      order by rule.event_key, rule.id
    ),
    '[]'::jsonb
  )
  into v_result
  from dashboard_private.notification_rule_mention_settings setting
  join dashboard_private.notification_rules rule on rule.id = setting.rule_id
  where rule.workflow_key = pg_catalog.btrim(p_workflow_key)
    and rule.channel_key = 'google_chat';
  return v_result;
end;
$$;

create or replace function public.save_notification_rule_mention_setting_v1(
  p_rule_id uuid,
  p_mention_enabled boolean,
  p_expected_revision bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_setting dashboard_private.notification_rule_mention_settings%rowtype;
  v_request dashboard_private.notification_rule_mention_setting_requests%rowtype;
  v_before jsonb;
  v_response jsonb;
  v_fingerprint text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  perform dashboard_private.assert_google_chat_mentions_manager_v1(v_actor);
  if p_rule_id is null
    or p_mention_enabled is null
    or p_expected_revision is null
    or p_expected_revision < 0
    or p_request_id is null
  then
    raise exception 'notification_mention_setting_invalid'
      using errcode = '22023';
  end if;

  select setting.* into v_setting
  from dashboard_private.notification_rule_mention_settings setting
  join dashboard_private.notification_rules rule on rule.id = setting.rule_id
  where setting.rule_id = p_rule_id
    and rule.channel_key = 'google_chat'
  for update of setting;
  if not found then
    raise exception 'notification_mention_setting_not_found'
      using errcode = 'P0002';
  end if;
  if p_expected_revision < 1 then
    raise exception 'notification_mention_setting_invalid'
      using errcode = '22023';
  end if;

  v_fingerprint := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(
      pg_catalog.jsonb_build_object(
        'actorProfileId', v_actor,
        'ruleId', p_rule_id,
        'mentionEnabled', p_mention_enabled,
        'expectedRevision', p_expected_revision
      )
    )
  );

  select * into v_request
  from dashboard_private.notification_rule_mention_setting_requests request_row
  where request_row.request_id = p_request_id
  for update;
  if found then
    if v_request.request_fingerprint is distinct from v_fingerprint then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_request.response;
  end if;

  if v_setting.revision is distinct from p_expected_revision then
    raise exception 'notification_mention_setting_revision_conflict'
      using errcode = '40001';
  end if;

  v_before := dashboard_private.notification_rule_mention_setting_json_v1(p_rule_id);
  update dashboard_private.notification_rule_mention_settings setting
  set mention_enabled = p_mention_enabled,
      revision = setting.revision + 1,
      updated_by = v_actor,
      updated_at = v_now
  where setting.rule_id = p_rule_id;
  v_response := dashboard_private.notification_rule_mention_setting_json_v1(p_rule_id);

  insert into dashboard_private.notification_rule_mention_setting_audits(
    rule_id, actor_profile_id, request_id, before_setting, after_setting
  ) values (p_rule_id, v_actor, p_request_id, v_before, v_response);

  insert into dashboard_private.notification_rule_mention_setting_requests(
    request_id, actor_profile_id, rule_id, request_fingerprint, response
  ) values (p_request_id, v_actor, p_rule_id, v_fingerprint, v_response);

  return v_response;
end;
$$;

create or replace function dashboard_private.capture_registration_observation_teacher_change_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification_revision bigint;
begin
  if old.teacher_profile_id is not distinct from new.teacher_profile_id then
    return new;
  end if;

  select appointment.notification_revision
  into v_notification_revision
  from public.ops_registration_appointments appointment
  where appointment.id = new.appointment_id;
  if v_notification_revision is null then
    return new;
  end if;

  insert into dashboard_private.notification_assignment_change_facts(
    workflow_key, source_type, source_id, source_revision,
    context_entity_id, role_key, previous_profile_ids, current_profile_ids
  ) values (
    'registration', 'registration_observation', new.id::text,
    v_notification_revision, new.track_id, 'subject_teacher',
    dashboard_private.google_chat_canonical_uuid_array_v1(
      array[old.teacher_profile_id]
    ),
    dashboard_private.google_chat_canonical_uuid_array_v1(
      array[new.teacher_profile_id]
    )
  )
  on conflict do nothing;
  return new;
end;
$$;

create trigger capture_registration_observation_teacher_change
after update of teacher_profile_id
on public.ops_registration_observations
for each row execute function dashboard_private.capture_registration_observation_teacher_change_v1();

create or replace function dashboard_private.capture_registration_director_change_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_metadata jsonb;
  v_event_type text;
  v_track_id uuid;
  v_previous uuid;
  v_current uuid;
begin
  if new.event_type is distinct from 'registration_track_event'
    or nullif(pg_catalog.btrim(new.after_value), '') is null
  then
    return new;
  end if;

  begin
    v_payload := new.after_value::jsonb;
    if pg_catalog.jsonb_typeof(v_payload) is distinct from 'object'
      or pg_catalog.jsonb_typeof(v_payload -> 'version') is distinct from 'number'
      or (v_payload ->> 'version')::numeric is distinct from 2::numeric
      or pg_catalog.jsonb_typeof(v_payload -> 'event_type') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_payload -> 'track_id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_payload -> 'metadata') is distinct from 'object'
    then
      return new;
    end if;

    v_event_type := v_payload ->> 'event_type';
    if v_event_type not in (
      'director_default_resolved',
      'director_manual_override',
      'director_default_cleared'
    ) then
      return new;
    end if;
    v_track_id := (v_payload ->> 'track_id')::uuid;
    v_metadata := v_payload -> 'metadata';
    if v_metadata ? 'previousDirectorProfileId'
      and pg_catalog.jsonb_typeof(v_metadata -> 'previousDirectorProfileId')
        not in ('string', 'null')
    then
      return new;
    end if;
    if v_metadata ? 'directorProfileId'
      and pg_catalog.jsonb_typeof(v_metadata -> 'directorProfileId')
        not in ('string', 'null')
    then
      return new;
    end if;

    v_previous := nullif(v_metadata ->> 'previousDirectorProfileId', '')::uuid;
    v_current := nullif(v_metadata ->> 'directorProfileId', '')::uuid;
    if v_previous is not distinct from v_current
      or (v_event_type = 'director_default_cleared' and v_current is not null)
      or (v_event_type <> 'director_default_cleared' and v_current is null)
      or not exists (
        select 1
        from public.ops_registration_subject_tracks track
        where track.id = v_track_id
          and track.task_id = new.task_id
      )
    then
      return new;
    end if;

    insert into dashboard_private.notification_assignment_change_facts(
      workflow_key, source_type, source_id, source_revision,
      context_entity_id, role_key, previous_profile_ids, current_profile_ids
    ) values (
      'registration', 'registration_track_event', new.id::text, null,
      v_track_id, 'track_director',
      dashboard_private.google_chat_canonical_uuid_array_v1(array[v_previous]),
      dashboard_private.google_chat_canonical_uuid_array_v1(array[v_current])
    )
    on conflict do nothing;
  exception
    when data_exception then
      return new;
  end;
  return new;
end;
$$;

create trigger capture_registration_director_change
after insert on public.ops_task_events
for each row execute function dashboard_private.capture_registration_director_change_v1();

create or replace function public.resolve_google_chat_profile_mentions_v1(
  p_profile_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_ids uuid[] := array[]::uuid[];
  v_user_names text[] := array[]::text[];
  v_omitted jsonb := '[]'::jsonb;
  v_fingerprint text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_chat_profile_mentions_service_role_required'
      using errcode = '42501';
  end if;
  if p_profile_ids is null then
    raise exception 'google_chat_profile_mentions_input_invalid'
      using errcode = '22023';
  end if;

  with first_occurrence as (
    select item.profile_id, pg_catalog.min(item.ordinality) as ordinality
    from pg_catalog.unnest(p_profile_ids) with ordinality
      item(profile_id, ordinality)
    where item.profile_id is not null
    group by item.profile_id
  ), evaluated as (
    select
      input.profile_id,
      input.ordinality,
      identity.identity_revision,
      case
        when profile.id is null then 'identity_missing'
        when not dashboard_private.notification_profile_is_active_v1(profile.id)
          then 'profile_inactive'
        when identity.profile_id is null then 'identity_missing'
        when identity.verification_status is distinct from 'verified'
          or identity.chat_user_id is null
          or identity.account_email_snapshot is distinct from
            pg_catalog.lower(pg_catalog.btrim(account.email))
          then 'identity_unverified'
        else null
      end as omitted_reason,
      case
        when profile.id is not null
          and dashboard_private.notification_profile_is_active_v1(profile.id)
          and identity.verification_status = 'verified'
          and identity.chat_user_id is not null
          and identity.account_email_snapshot =
            pg_catalog.lower(pg_catalog.btrim(account.email))
        then 'users/' || identity.chat_user_id
        else null
      end as user_name
    from first_occurrence input
    left join public.profiles profile on profile.id = input.profile_id
    left join auth.users account on account.id = profile.id
    left join dashboard_private.google_chat_profile_identities identity
      on identity.profile_id = profile.id
  )
  select
    coalesce(
      pg_catalog.array_agg(row.profile_id order by row.ordinality)
        filter (where row.user_name is not null),
      array[]::uuid[]
    ),
    coalesce(
      pg_catalog.array_agg(row.user_name order by row.ordinality)
        filter (where row.user_name is not null),
      array[]::text[]
    ),
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'profile_id', row.profile_id,
          'reason', row.omitted_reason
        ) order by row.ordinality
      ) filter (where row.omitted_reason is not null),
      '[]'::jsonb
    ),
    dashboard_private.notification_sha256_hex_v1(
      dashboard_private.notification_canonical_json_v1(
        coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'profileId', row.profile_id,
              'identityRevision', row.identity_revision
            ) order by row.ordinality
          ) filter (where row.user_name is not null),
          '[]'::jsonb
        )
      )
    )
  into v_profile_ids, v_user_names, v_omitted, v_fingerprint
  from evaluated row;

  return pg_catalog.jsonb_build_object(
    'profile_ids', v_profile_ids,
    'user_names', v_user_names,
    'omitted', v_omitted,
    'identity_revision_fingerprint', v_fingerprint
  );
end;
$$;

create or replace function dashboard_private.prepare_google_chat_delivery_mention_snapshot_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_rule_id uuid,
  p_profile_ids uuid[],
  p_retry_frozen boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_setting dashboard_private.notification_rule_mention_settings%rowtype;
  v_snapshot dashboard_private.notification_delivery_mention_snapshots%rowtype;
  v_resolved jsonb;
  v_result jsonb;
  v_profile_ids uuid[];
  v_user_names text[];
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'google_chat_profile_mentions_service_role_required'
      using errcode = '42501';
  end if;
  if p_delivery_id is null
    or p_claim_token is null
    or p_rule_id is null
    or p_profile_ids is null
    or p_retry_frozen is null
  then
    raise exception 'google_chat_mention_snapshot_input_invalid'
      using errcode = '22023';
  end if;

  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
  for update;
  if not found
    or v_delivery.rule_id is distinct from p_rule_id
    or v_delivery.channel_key is distinct from 'google_chat'
    or v_delivery.status not in ('claimed', 'sending')
    or v_delivery.claim_token is distinct from p_claim_token
  then
    raise exception 'google_chat_mention_snapshot_claim_invalid'
      using errcode = '40001';
  end if;

  perform 1
  from dashboard_private.notification_rules rule
  where rule.id = p_rule_id
    and rule.channel_key = 'google_chat'
  for share;
  if not found then
    raise exception 'notification_mention_setting_not_found'
      using errcode = 'P0002';
  end if;

  select setting.* into v_setting
  from dashboard_private.notification_rule_mention_settings setting
  where setting.rule_id = p_rule_id
  for share;
  if not found then
    raise exception 'notification_mention_setting_not_found'
      using errcode = 'P0002';
  end if;

  select snapshot.* into v_snapshot
  from dashboard_private.notification_delivery_mention_snapshots snapshot
  where snapshot.delivery_id = p_delivery_id;

  if p_retry_frozen then
    if v_snapshot.delivery_id is null then
      raise exception 'google_chat_mention_snapshot_missing'
        using errcode = '40001';
    end if;
    return pg_catalog.jsonb_build_object(
      'profile_ids', v_snapshot.profile_ids,
      'user_names', v_snapshot.user_names,
      'omitted', v_snapshot.omitted,
      'identity_revision_fingerprint', v_snapshot.identity_revision_fingerprint,
      'mention_enabled', v_snapshot.mention_enabled,
      'setting_revision', v_snapshot.setting_revision
    );
  elsif v_snapshot.delivery_id is not null then
    raise exception 'google_chat_mention_snapshot_already_exists'
      using errcode = '40001';
  end if;

  perform profile.id
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.id = any(p_profile_ids)
  order by profile.id
  for share of profile, account;
  perform identity.profile_id
  from dashboard_private.google_chat_profile_identities identity
  where identity.profile_id = any(p_profile_ids)
  order by identity.profile_id
  for share;

  if v_setting.mention_enabled then
    v_resolved := public.resolve_google_chat_profile_mentions_v1(p_profile_ids);
  else
    v_resolved := pg_catalog.jsonb_build_object(
      'profile_ids', array[]::uuid[],
      'user_names', array[]::text[],
      'omitted', '[]'::jsonb,
      'identity_revision_fingerprint',
        dashboard_private.notification_sha256_hex_v1('[]')
    );
  end if;

  select coalesce(pg_catalog.array_agg(value::uuid order by ordinality), array[]::uuid[])
  into v_profile_ids
  from pg_catalog.jsonb_array_elements_text(v_resolved -> 'profile_ids')
    with ordinality item(value, ordinality);
  select coalesce(pg_catalog.array_agg(value order by ordinality), array[]::text[])
  into v_user_names
  from pg_catalog.jsonb_array_elements_text(v_resolved -> 'user_names')
    with ordinality item(value, ordinality);

  insert into dashboard_private.notification_delivery_mention_snapshots(
    delivery_id, rule_id, setting_revision, mention_enabled,
    profile_ids, user_names, omitted, identity_revision_fingerprint
  ) values (
    p_delivery_id, p_rule_id, v_setting.revision, v_setting.mention_enabled,
    v_profile_ids, v_user_names, v_resolved -> 'omitted',
    v_resolved ->> 'identity_revision_fingerprint'
  );

  v_result := v_resolved || pg_catalog.jsonb_build_object(
    'mention_enabled', v_setting.mention_enabled,
    'setting_revision', v_setting.revision
  );
  return v_result;
end;
$$;

alter table dashboard_private.google_chat_profile_identities owner to postgres;
alter table dashboard_private.google_chat_profile_identity_audits owner to postgres;
alter table dashboard_private.google_chat_profile_identity_requests owner to postgres;
alter table dashboard_private.notification_rule_mention_settings owner to postgres;
alter table dashboard_private.notification_rule_mention_setting_audits owner to postgres;
alter table dashboard_private.notification_rule_mention_setting_requests owner to postgres;
alter table dashboard_private.notification_assignment_change_facts owner to postgres;
alter table dashboard_private.notification_delivery_mention_snapshots owner to postgres;

revoke all on table dashboard_private.google_chat_profile_identities
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.google_chat_profile_identity_audits
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.google_chat_profile_identity_requests
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_rule_mention_settings
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_rule_mention_setting_audits
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_rule_mention_setting_requests
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_assignment_change_facts
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.notification_delivery_mention_snapshots
  from public, anon, authenticated, service_role;

alter function dashboard_private.google_chat_canonical_uuid_array_v1(uuid[])
  owner to postgres;
alter function dashboard_private.google_chat_uuid_array_distinct_v1(uuid[])
  owner to postgres;
alter function dashboard_private.google_chat_user_names_valid_v1(text[])
  owner to postgres;
alter function dashboard_private.reject_google_chat_mention_row_mutation_v1()
  owner to postgres;
alter function dashboard_private.validate_notification_rule_mention_setting_v1()
  owner to postgres;
alter function dashboard_private.prevent_adopted_mention_rule_channel_drift_v1()
  owner to postgres;
alter function dashboard_private.assert_google_chat_mentions_manager_v1(uuid)
  owner to postgres;
alter function dashboard_private.google_chat_profile_identity_json_v1(uuid)
  owner to postgres;
alter function dashboard_private.notification_rule_mention_setting_json_v1(uuid)
  owner to postgres;
alter function dashboard_private.capture_registration_observation_teacher_change_v1()
  owner to postgres;
alter function dashboard_private.capture_registration_director_change_v1()
  owner to postgres;
alter function dashboard_private.prepare_google_chat_delivery_mention_snapshot_v1(
  uuid, uuid, uuid, uuid[], boolean
) owner to postgres;
alter function public.list_google_chat_profile_identities_v1() owner to postgres;
alter function public.read_google_chat_profile_identity_sync_source_v1(uuid, uuid)
  owner to postgres;
alter function public.apply_google_chat_profile_identity_sync_v1(
  uuid, uuid, text, text, text, text, bigint, uuid
) owner to postgres;
alter function public.list_notification_rule_mention_settings_v1(text)
  owner to postgres;
alter function public.save_notification_rule_mention_setting_v1(
  uuid, boolean, bigint, uuid
) owner to postgres;
alter function public.resolve_google_chat_profile_mentions_v1(uuid[])
  owner to postgres;

revoke all on function dashboard_private.google_chat_canonical_uuid_array_v1(uuid[])
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.google_chat_uuid_array_distinct_v1(uuid[])
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.google_chat_user_names_valid_v1(text[])
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.reject_google_chat_mention_row_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.validate_notification_rule_mention_setting_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.prevent_adopted_mention_rule_channel_drift_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_google_chat_mentions_manager_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.google_chat_profile_identity_json_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_rule_mention_setting_json_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.capture_registration_observation_teacher_change_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.capture_registration_director_change_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.prepare_google_chat_delivery_mention_snapshot_v1(
  uuid, uuid, uuid, uuid[], boolean
) from public, anon, authenticated, service_role;

revoke all on function public.list_google_chat_profile_identities_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.read_google_chat_profile_identity_sync_source_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_google_chat_profile_identity_sync_v1(
  uuid, uuid, text, text, text, text, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.list_notification_rule_mention_settings_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function public.save_notification_rule_mention_setting_v1(
  uuid, boolean, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.resolve_google_chat_profile_mentions_v1(uuid[])
  from public, anon, authenticated, service_role;

grant execute on function public.list_google_chat_profile_identities_v1()
  to authenticated;
grant execute on function public.list_notification_rule_mention_settings_v1(text)
  to authenticated;
grant execute on function public.save_notification_rule_mention_setting_v1(
  uuid, boolean, bigint, uuid
) to authenticated;
grant execute on function public.read_google_chat_profile_identity_sync_source_v1(uuid, uuid)
  to service_role;
grant execute on function public.apply_google_chat_profile_identity_sync_v1(
  uuid, uuid, text, text, text, text, bigint, uuid
) to service_role;
grant execute on function public.resolve_google_chat_profile_mentions_v1(uuid[])
  to service_role;

commit;
