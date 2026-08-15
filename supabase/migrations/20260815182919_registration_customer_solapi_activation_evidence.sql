begin;

do $$
begin
  if exists (
    select 1
    from dashboard_private.registration_customer_solapi_activation activation
    where activation.mode <> 'off'
  ) then
    raise exception 'registration_customer_solapi_activation_evidence_requires_off'
      using errcode = '55000';
  end if;
end;
$$;

create table dashboard_private.registration_customer_solapi_activation_evidence (
  id uuid primary key default gen_random_uuid(),
  message_kind text not null check (message_kind in (
    'level_test_booking',
    'visit_consultation_booking',
    'appointment_reminder',
    'waiting_notice',
    'admission_application',
    'observation_booking',
    'observation_reminder'
  )),
  template_id text not null check (nullif(pg_catalog.btrim(template_id), '') is not null),
  pf_id text not null check (nullif(pg_catalog.btrim(pf_id), '') is not null),
  template_checksum text not null check (template_checksum ~ '^[a-f0-9]{64}$'),
  rendered_variables_checksum text not null check (rendered_variables_checksum ~ '^[a-f0-9]{64}$'),
  rendered_body_checksum text not null check (rendered_body_checksum ~ '^[a-f0-9]{64}$'),
  rendered_buttons_checksum text not null check (rendered_buttons_checksum ~ '^[a-f0-9]{64}$'),
  provider_payload_checksum text not null check (provider_payload_checksum ~ '^[a-f0-9]{64}$'),
  recipient_hash text not null check (recipient_hash ~ '^[a-f0-9]{64}$'),
  provider_message_id text not null check (nullif(pg_catalog.btrim(provider_message_id), '') is not null),
  provider_status_code text not null check (nullif(pg_catalog.btrim(provider_status_code), '') is not null),
  verified_at timestamptz not null,
  verified_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index registration_customer_solapi_activation_evidence_kind_verified_idx
  on dashboard_private.registration_customer_solapi_activation_evidence(
    message_kind,
    verified_at desc
  );

create unique index registration_customer_solapi_activation_evidence_provider_message_idx
  on dashboard_private.registration_customer_solapi_activation_evidence(provider_message_id);

create table dashboard_private.registration_customer_solapi_admin_mutations (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  request_key text not null check (
    request_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  mutation_type text not null check (nullif(pg_catalog.btrim(mutation_type), '') is not null),
  target_fingerprint jsonb not null check (pg_catalog.jsonb_typeof(target_fingerprint) = 'object'),
  response_payload jsonb not null check (pg_catalog.jsonb_typeof(response_payload) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (actor_id, request_key)
);

alter table public.ops_registration_customer_messages
  add column provider_payload_checksum text,
  add constraint ops_registration_customer_messages_provider_payload_checksum_check
    check (
      provider_payload_checksum is null
      or provider_payload_checksum ~ '^[a-f0-9]{64}$'
    );

alter table dashboard_private.registration_customer_solapi_activation
  drop constraint registration_customer_solapi_activation_shape_check,
  add column activation_evidence_id uuid,
  add constraint registration_customer_solapi_activation_evidence_fkey
    foreign key (activation_evidence_id)
    references dashboard_private.registration_customer_solapi_activation_evidence(id)
    on delete restrict;

do $$
declare
  v_constraint_name text;
begin
  select constraint_row.conname
  into v_constraint_name
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_attribute attribute_row
    on attribute_row.attrelid = constraint_row.conrelid
   and attribute_row.attnum = any(constraint_row.conkey)
  where constraint_row.conrelid =
      'dashboard_private.registration_customer_solapi_activation'::pg_catalog.regclass
    and constraint_row.contype = 'f'
    and attribute_row.attname = 'verification_task_id';

  if v_constraint_name is not null then
    execute pg_catalog.format(
      'alter table dashboard_private.registration_customer_solapi_activation drop constraint %I',
      v_constraint_name
    );
  end if;
end;
$$;

alter table dashboard_private.registration_customer_solapi_activation
  drop column live_test_message_id,
  drop column live_test_confirmed_at,
  add constraint registration_customer_solapi_activation_shape_check check (
    (
      mode = 'off'
      and verification_task_id is null
      and verification_recipient_hash is null
    )
    or (
      mode = 'verification'
      and verification_task_id is not null
      and verification_recipient_hash is not null
      and activation_evidence_id is null
      and updated_by is not null
    )
    or (
      mode = 'live'
      and verification_task_id is null
      and verification_recipient_hash is null
      and activation_evidence_id is not null
      and updated_by is not null
    )
  );

alter table dashboard_private.registration_customer_solapi_activation_evidence
  owner to postgres;
alter table dashboard_private.registration_customer_solapi_admin_mutations
  owner to postgres;
alter table dashboard_private.registration_customer_solapi_activation_evidence
  enable row level security;
alter table dashboard_private.registration_customer_solapi_admin_mutations
  enable row level security;
revoke all on table dashboard_private.registration_customer_solapi_activation_evidence
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.registration_customer_solapi_admin_mutations
  from public, anon, authenticated, service_role;

drop function public.finalize_registration_customer_message_v1(uuid, uuid, text, jsonb);

create function public.finalize_registration_customer_message_v1(
  p_message_id uuid,
  p_dispatch_token uuid,
  p_result text,
  p_provider_result jsonb,
  p_provider_payload_checksum text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_message public.ops_registration_customer_messages%rowtype;
  v_response jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  if p_result = 'accepted' and (
      p_provider_payload_checksum is null
      or p_provider_payload_checksum !~ '^[a-f0-9]{64}$'
    ) then
    raise exception 'registration_customer_message_provider_payload_checksum_invalid'
      using errcode = '22023';
  end if;
  if p_provider_payload_checksum is not null
    and p_provider_payload_checksum !~ '^[a-f0-9]{64}$' then
    raise exception 'registration_customer_message_provider_payload_checksum_invalid'
      using errcode = '22023';
  end if;

  select message.*
  into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id
  for update;
  if not found then
    raise exception 'registration_customer_message_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    v_message.confirmed_by,
    v_message.task_id,
    'send'
  );
  if v_message.message_kind in ('observation_booking', 'observation_reminder') then
    perform dashboard_private.registration_customer_message_assert_stored_observation_v1(v_message);
  end if;
  if v_message.provider_payload_checksum is not null
    and v_message.provider_payload_checksum is distinct from p_provider_payload_checksum then
    raise exception 'registration_customer_message_finalize_conflict' using errcode = '40001';
  end if;

  v_response := dashboard_private.finalize_registration_customer_message_pre_observation_v1(
    p_message_id,
    p_dispatch_token,
    p_result,
    p_provider_result
  );

  update public.ops_registration_customer_messages message
  set provider_payload_checksum = p_provider_payload_checksum
  where message.id = p_message_id
    and message.provider_payload_checksum is not distinct from v_message.provider_payload_checksum;
  if not found then
    raise exception 'registration_customer_message_finalize_conflict' using errcode = '40001';
  end if;
  return v_response;
end;
$$;

alter function public.finalize_registration_customer_message_v1(uuid, uuid, text, jsonb, text)
  owner to postgres;
revoke all on function public.finalize_registration_customer_message_v1(uuid, uuid, text, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_registration_customer_message_v1(uuid, uuid, text, jsonb, text)
  to service_role;

create or replace function dashboard_private.registration_customer_solapi_activation_result_v1(
  p_message_kind text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_activation dashboard_private.registration_customer_solapi_activation%rowtype;
begin
  select activation.*
  into strict v_activation
  from dashboard_private.registration_customer_solapi_activation activation
  where activation.message_kind = p_message_kind;
  return pg_catalog.jsonb_build_object(
    'messageKind', v_activation.message_kind,
    'activationMode', v_activation.mode,
    'updatedAt', v_activation.updated_at,
    'liveTestRecorded', v_activation.activation_evidence_id is not null
  );
end;
$$;

alter function dashboard_private.registration_customer_solapi_activation_result_v1(text)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_solapi_activation_result_v1(text)
  from public, anon, authenticated, service_role;

create or replace function public.record_registration_customer_solapi_live_test_receipt_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_message_id uuid,
  p_received_at timestamptz,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_activation dashboard_private.registration_customer_solapi_activation%rowtype;
  v_receipt dashboard_private.registration_customer_solapi_template_receipts%rowtype;
  v_message public.ops_registration_customer_messages%rowtype;
  v_mutation dashboard_private.registration_customer_solapi_admin_mutations%rowtype;
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_target_fingerprint jsonb;
  v_response jsonb;
  v_evidence_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  perform dashboard_private.registration_customer_solapi_assert_kind_v1(p_message_kind);
  perform dashboard_private.registration_customer_solapi_assert_admin_v1(p_actor_profile_id);
  if p_message_id is null
    or p_received_at is null
    or p_received_at > pg_catalog.clock_timestamp()
    or v_request_key is null
    or v_request_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'registration_customer_solapi_live_test_receipt_invalid'
      using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'messageKind', p_message_kind,
    'messageFingerprint', dashboard_private.notification_sha256_hex_v1(p_message_id::text),
    'receivedAt', p_received_at
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-customer-solapi-admin:' || p_actor_profile_id::text || ':' || v_request_key,
      0
    )
  );
  select mutation.*
  into v_mutation
  from dashboard_private.registration_customer_solapi_admin_mutations mutation
  where mutation.actor_id = p_actor_profile_id
    and mutation.request_key = v_request_key;
  if found then
    if v_mutation.mutation_type = 'registration_customer_solapi_live_test_receipt'
      and v_mutation.target_fingerprint = v_target_fingerprint then
      return v_mutation.response_payload;
    end if;
    raise exception 'registration_customer_message_mutation_conflict' using errcode = '23505';
  end if;

  select activation.*
  into v_activation
  from dashboard_private.registration_customer_solapi_activation activation
  where activation.message_kind = p_message_kind
  for update;
  if not found then
    raise exception 'registration_customer_solapi_activation_missing' using errcode = '55000';
  end if;
  if v_activation.mode <> 'verification' then
    raise exception 'registration_customer_solapi_live_test_not_allowed' using errcode = '40001';
  end if;
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id,
    v_activation.verification_task_id,
    'admin'
  );

  select receipt.*
  into v_receipt
  from dashboard_private.registration_customer_solapi_template_receipts receipt
  where receipt.message_kind = p_message_kind
    and receipt.provider_status = 'sendable'
    and receipt.catalog_checksum = receipt.provider_checksum
  for share;
  if not found then
    raise exception 'registration_customer_solapi_template_drift' using errcode = '40001';
  end if;

  select message.*
  into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id
    and message.status = 'accepted'
    and message.message_kind = p_message_kind
    and message.task_id = v_activation.verification_task_id
    and message.recipient_hash = v_activation.verification_recipient_hash
    and message.template_checksum = v_receipt.catalog_checksum
    and message.provider_payload_checksum ~ '^[a-f0-9]{64}$'
    and nullif(pg_catalog.btrim(message.provider_message_id), '') is not null
    and nullif(pg_catalog.btrim(message.provider_status_code), '') is not null
  for share;
  if not found
    or p_received_at < coalesce(v_message.resolved_at, v_message.updated_at, v_message.confirmed_at)
    or p_received_at < v_message.confirmed_at then
    raise exception 'registration_customer_solapi_live_test_evidence_mismatch'
      using errcode = '40001';
  end if;
  if exists (
    select 1
    from dashboard_private.registration_customer_solapi_activation_evidence evidence
    where evidence.provider_message_id = v_message.provider_message_id
  ) then
    raise exception 'registration_customer_solapi_live_test_receipt_conflict'
      using errcode = '23505';
  end if;

  insert into dashboard_private.registration_customer_solapi_activation_evidence(
    message_kind,
    template_id,
    pf_id,
    template_checksum,
    rendered_variables_checksum,
    rendered_body_checksum,
    rendered_buttons_checksum,
    provider_payload_checksum,
    recipient_hash,
    provider_message_id,
    provider_status_code,
    verified_at,
    verified_by
  ) values (
    p_message_kind,
    v_receipt.template_id,
    v_receipt.pf_id,
    v_message.template_checksum,
    v_message.rendered_variables_checksum,
    v_message.rendered_body_checksum,
    v_message.rendered_buttons_checksum,
    v_message.provider_payload_checksum,
    v_message.recipient_hash,
    v_message.provider_message_id,
    v_message.provider_status_code,
    p_received_at,
    p_actor_profile_id
  ) returning id into v_evidence_id;

  v_response := pg_catalog.jsonb_build_object(
    'messageKind', p_message_kind,
    'recorded', true,
    'evidenceId', v_evidence_id,
    'receivedAt', p_received_at
  );
  insert into dashboard_private.registration_customer_solapi_admin_mutations(
    actor_id,
    request_key,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    p_actor_profile_id,
    v_request_key,
    'registration_customer_solapi_live_test_receipt',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

alter function public.record_registration_customer_solapi_live_test_receipt_v1(uuid, text, uuid, timestamptz, text)
  owner to postgres;
revoke all on function public.record_registration_customer_solapi_live_test_receipt_v1(uuid, text, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_registration_customer_solapi_live_test_receipt_v1(uuid, text, uuid, timestamptz, text)
  to service_role;

create or replace function public.set_registration_customer_solapi_activation_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_mode text,
  p_evidence jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_activation dashboard_private.registration_customer_solapi_activation%rowtype;
  v_receipt dashboard_private.registration_customer_solapi_template_receipts%rowtype;
  v_evidence dashboard_private.registration_customer_solapi_activation_evidence%rowtype;
  v_mutation dashboard_private.registration_customer_solapi_admin_mutations%rowtype;
  v_current_mode text;
  v_request_key text;
  v_verification_task_id uuid;
  v_verification_recipient_hash text;
  v_activation_evidence_id uuid;
  v_template_id text;
  v_pf_id text;
  v_catalog_checksum text;
  v_target_fingerprint jsonb;
  v_response jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  perform dashboard_private.registration_customer_solapi_assert_kind_v1(p_message_kind);
  perform dashboard_private.registration_customer_solapi_assert_admin_v1(p_actor_profile_id);
  if p_mode is null
    or p_mode not in ('off', 'verification', 'live')
    or p_evidence is null
    or pg_catalog.jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'registration_customer_solapi_activation_evidence_invalid' using errcode = '22023';
  end if;

  if p_mode = 'off' then
    if p_evidence - array['requestKey']::text[] <> '{}'::jsonb
      or not p_evidence ?& array['requestKey']::text[] then
      raise exception 'registration_customer_solapi_activation_evidence_invalid' using errcode = '22023';
    end if;
  elsif p_mode = 'verification' then
    if p_evidence - array[
      'requestKey', 'verificationTaskId', 'verificationRecipientHash',
      'templateId', 'pfId', 'catalogChecksum'
    ]::text[] <> '{}'::jsonb
      or not p_evidence ?& array[
        'requestKey', 'verificationTaskId', 'verificationRecipientHash',
        'templateId', 'pfId', 'catalogChecksum'
      ]::text[] then
      raise exception 'registration_customer_solapi_activation_evidence_invalid' using errcode = '22023';
    end if;
  else
    if p_evidence - array[
      'requestKey', 'activationEvidenceId', 'templateId', 'pfId', 'catalogChecksum'
    ]::text[] <> '{}'::jsonb
      or not p_evidence ?& array[
        'requestKey', 'activationEvidenceId', 'templateId', 'pfId', 'catalogChecksum'
      ]::text[] then
      raise exception 'registration_customer_solapi_activation_evidence_invalid' using errcode = '22023';
    end if;
  end if;

  if pg_catalog.jsonb_typeof(p_evidence -> 'requestKey') <> 'string'
    or (p_evidence ->> 'requestKey') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'registration_customer_solapi_activation_evidence_invalid' using errcode = '22023';
  end if;
  v_request_key := p_evidence ->> 'requestKey';

  if p_mode in ('verification', 'live') then
    if pg_catalog.jsonb_typeof(p_evidence -> 'templateId') <> 'string'
      or nullif(pg_catalog.btrim(p_evidence ->> 'templateId'), '') is null
      or pg_catalog.length(p_evidence ->> 'templateId') > 200
      or pg_catalog.jsonb_typeof(p_evidence -> 'pfId') <> 'string'
      or nullif(pg_catalog.btrim(p_evidence ->> 'pfId'), '') is null
      or pg_catalog.length(p_evidence ->> 'pfId') > 200
      or pg_catalog.jsonb_typeof(p_evidence -> 'catalogChecksum') <> 'string'
      or (p_evidence ->> 'catalogChecksum') !~ '^[a-f0-9]{64}$' then
      raise exception 'registration_customer_solapi_activation_evidence_invalid' using errcode = '22023';
    end if;
    v_template_id := pg_catalog.btrim(p_evidence ->> 'templateId');
    v_pf_id := pg_catalog.btrim(p_evidence ->> 'pfId');
    v_catalog_checksum := p_evidence ->> 'catalogChecksum';
  end if;

  if p_mode = 'verification' then
    if pg_catalog.jsonb_typeof(p_evidence -> 'verificationTaskId') <> 'string'
      or (p_evidence ->> 'verificationTaskId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(p_evidence -> 'verificationRecipientHash') <> 'string'
      or (p_evidence ->> 'verificationRecipientHash') !~ '^[a-f0-9]{64}$' then
      raise exception 'registration_customer_solapi_activation_evidence_invalid' using errcode = '22023';
    end if;
    v_verification_task_id := (p_evidence ->> 'verificationTaskId')::uuid;
    v_verification_recipient_hash := p_evidence ->> 'verificationRecipientHash';
  elsif p_mode = 'live' then
    if pg_catalog.jsonb_typeof(p_evidence -> 'activationEvidenceId') <> 'string'
      or (p_evidence ->> 'activationEvidenceId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'registration_customer_solapi_activation_evidence_invalid' using errcode = '22023';
    end if;
    v_activation_evidence_id := (p_evidence ->> 'activationEvidenceId')::uuid;
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'messageKind', p_message_kind,
    'mode', p_mode,
    'evidence', p_evidence - 'requestKey'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-customer-solapi-admin:' || p_actor_profile_id::text || ':' || v_request_key,
      0
    )
  );
  select mutation.*
  into v_mutation
  from dashboard_private.registration_customer_solapi_admin_mutations mutation
  where mutation.actor_id = p_actor_profile_id
    and mutation.request_key = v_request_key;
  if found then
    if v_mutation.mutation_type = 'registration_customer_solapi_activation'
      and v_mutation.target_fingerprint = v_target_fingerprint then
      return v_mutation.response_payload;
    end if;
    raise exception 'registration_customer_message_mutation_conflict' using errcode = '23505';
  end if;

  select activation.*
  into v_activation
  from dashboard_private.registration_customer_solapi_activation activation
  where activation.message_kind = p_message_kind
  for update;
  if not found then
    raise exception 'registration_customer_solapi_activation_missing' using errcode = '55000';
  end if;
  v_current_mode := v_activation.mode;
  if not (
    (v_current_mode = 'off' and p_mode = 'verification')
    or (v_current_mode = 'verification' and p_mode in ('live', 'off'))
    or (v_current_mode = 'live' and p_mode = 'off')
  ) then
    raise exception 'registration_customer_solapi_activation_transition_invalid' using errcode = '40001';
  end if;

  if p_mode in ('verification', 'live') then
    select receipt.*
    into v_receipt
    from dashboard_private.registration_customer_solapi_template_receipts receipt
    where receipt.message_kind = p_message_kind
    for share;
    if not found
      or v_receipt.template_id is distinct from v_template_id
      or v_receipt.pf_id is distinct from v_pf_id
      or v_receipt.catalog_checksum is distinct from v_catalog_checksum
      or v_receipt.provider_checksum is distinct from v_catalog_checksum
      or v_receipt.provider_status <> 'sendable' then
      raise exception 'registration_customer_solapi_template_drift' using errcode = '40001';
    end if;
  end if;

  if p_mode = 'verification' then
    perform dashboard_private.registration_customer_message_assert_actor_v1(
      p_actor_profile_id,
      v_verification_task_id,
      'admin'
    );
    update dashboard_private.registration_customer_solapi_activation activation
    set mode = 'verification',
        verification_task_id = v_verification_task_id,
        verification_recipient_hash = v_verification_recipient_hash,
        activation_evidence_id = null,
        updated_by = p_actor_profile_id
    where activation.message_kind = p_message_kind;
  elsif p_mode = 'live' then
    perform dashboard_private.registration_customer_message_assert_actor_v1(
      p_actor_profile_id,
      v_activation.verification_task_id,
      'admin'
    );
    select evidence.*
    into v_evidence
    from dashboard_private.registration_customer_solapi_activation_evidence evidence
    where evidence.id = v_activation_evidence_id
    for share;
    if not found
      or v_evidence.message_kind <> p_message_kind
      or v_evidence.template_id is distinct from v_template_id
      or v_evidence.pf_id is distinct from v_pf_id
      or v_evidence.template_checksum is distinct from v_catalog_checksum
      or v_evidence.recipient_hash is distinct from v_activation.verification_recipient_hash then
      raise exception 'registration_customer_solapi_live_evidence_missing' using errcode = '40001';
    end if;
    update dashboard_private.registration_customer_solapi_activation activation
    set mode = 'live',
        verification_task_id = null,
        verification_recipient_hash = null,
        activation_evidence_id = v_activation_evidence_id,
        updated_by = p_actor_profile_id
    where activation.message_kind = p_message_kind;
  else
    update dashboard_private.registration_customer_solapi_activation activation
    set mode = 'off',
        verification_task_id = null,
        verification_recipient_hash = null,
        updated_by = p_actor_profile_id
    where activation.message_kind = p_message_kind;
  end if;

  if p_message_kind = 'observation_reminder' and p_mode = 'off' then
    update dashboard_private.registration_customer_reminder_jobs job
    set status = 'canceled',
        claim_token = null,
        claim_expires_at = null,
        available_at = null,
        last_error_code = 'activation_off'
    where job.message_kind = 'observation_reminder'
      and job.status in ('pending', 'claimed')
      and job.message_id is null;
  end if;
  v_response := dashboard_private.registration_customer_solapi_activation_result_v1(p_message_kind);
  insert into dashboard_private.registration_customer_solapi_admin_mutations(
    actor_id,
    request_key,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    p_actor_profile_id,
    v_request_key,
    'registration_customer_solapi_activation',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

alter function public.set_registration_customer_solapi_activation_v1(uuid, text, text, jsonb)
  owner to postgres;
revoke all on function public.set_registration_customer_solapi_activation_v1(uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.set_registration_customer_solapi_activation_v1(uuid, text, text, jsonb)
  to service_role;

create function dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
  p_message_kind text,
  p_template_id text,
  p_pf_id text,
  p_template_checksum text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from dashboard_private.registration_customer_solapi_activation activation
    join dashboard_private.registration_customer_solapi_activation_evidence evidence
      on activation.activation_evidence_id = evidence.id
    where activation.message_kind = p_message_kind
      and activation.mode = 'live'
      and evidence.message_kind = p_message_kind
      and evidence.template_id = p_template_id
      and evidence.pf_id = p_pf_id
      and evidence.template_checksum = p_template_checksum
  );
$$;

alter function dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
  text, text, text, text
) owner to postgres;
revoke all on function dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
  text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function dashboard_private.enforce_registration_customer_solapi_delivery_gate_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_must_check boolean := tg_op = 'INSERT';
  v_activation dashboard_private.registration_customer_solapi_activation%rowtype;
  v_receipt dashboard_private.registration_customer_solapi_template_receipts%rowtype;
begin
  if tg_op = 'UPDATE' then
    v_must_check := (
      new.claim_active
      and (not old.claim_active or new.claim_token is distinct from old.claim_token)
    ) or (
      new.provider_attempt_count = 1
      and old.provider_attempt_count = 0
    );
  end if;
  if not v_must_check then
    return new;
  end if;

  select activation.* into v_activation
  from dashboard_private.registration_customer_solapi_activation activation
  where activation.message_kind = new.message_kind
  for share;
  if not found or v_activation.mode = 'off' then
    raise exception 'registration_customer_solapi_activation_off' using errcode = '40001';
  end if;

  select receipt.* into v_receipt
  from dashboard_private.registration_customer_solapi_template_receipts receipt
  where receipt.message_kind = new.message_kind
  for share;
  if not found
    or v_receipt.provider_status <> 'sendable'
    or v_receipt.catalog_checksum is distinct from v_receipt.provider_checksum
    or v_receipt.catalog_checksum is distinct from new.template_checksum then
    raise exception 'registration_customer_solapi_template_drift' using errcode = '40001';
  end if;

  if v_activation.mode = 'verification' then
    if new.task_id is distinct from v_activation.verification_task_id
      or new.recipient_hash is distinct from v_activation.verification_recipient_hash then
      raise exception 'registration_customer_solapi_verification_scope_mismatch'
        using errcode = '40001';
    end if;
  elsif v_activation.mode = 'live' then
    if not dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
      new.message_kind,
      v_receipt.template_id,
      v_receipt.pf_id,
      v_receipt.catalog_checksum
    ) then
      raise exception 'registration_customer_solapi_live_evidence_missing'
        using errcode = '40001';
    end if;
  else
    raise exception 'registration_customer_solapi_activation_off' using errcode = '40001';
  end if;
  return new;
end;
$$;

alter function dashboard_private.enforce_registration_customer_solapi_delivery_gate_v1()
  owner to postgres;
revoke all on function dashboard_private.enforce_registration_customer_solapi_delivery_gate_v1()
  from public, anon, authenticated, service_role;

do $readiness_patch$
declare
  v_definition text;
  v_original text;
begin
  select pg_catalog.pg_get_functiondef(
    'dashboard_private.registration_customer_solapi_readiness_legacy_v1(uuid,text,uuid,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := pg_catalog.regexp_replace(
    v_definition,
    $pattern$\n  v_live_message public\.ops_registration_customer_messages%rowtype;$pattern$,
    '',
    'g'
  );
  v_definition := pg_catalog.regexp_replace(
    v_definition,
    $pattern$  elsif v_activation\.mode = 'live' then\n    select message\.\*\n    into v_live_message[\s\S]*?    v_activation_eligible := found\n      and v_activation\.live_test_confirmed_at is not null;$pattern$,
    $replacement$  elsif v_activation.mode = 'live' then
    v_activation_eligible := v_template_verified
      and dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
        p_message_kind, v_receipt.template_id, v_receipt.pf_id, v_receipt.catalog_checksum
      );$replacement$,
    'g'
  );
  if v_definition = v_original
    or v_definition ~ 'live_test_message_id|live_test_confirmed_at|v_live_message' then
    raise exception 'registration_customer_solapi_readiness_evidence_patch_failed'
      using errcode = '55000';
  end if;
  execute v_definition;
end;
  $readiness_patch$;

do $claim_patch$
declare
  v_definition text;
  v_original text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.claim_registration_customer_reminder_job_v1()'::pg_catalog.regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := pg_catalog.regexp_replace(
    v_definition,
    $pattern$\n  v_live_message public\.ops_registration_customer_messages%rowtype;$pattern$,
    '',
    'g'
  );
  v_definition := pg_catalog.regexp_replace(
    v_definition,
    $pattern$      select message\.\* into v_live_message[\s\S]*?      if not found or v_activation\.live_test_confirmed_at is null then\n        continue;\n      end if;$pattern$,
    $replacement$      if not dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
        v_job.message_kind, v_receipt.template_id, v_receipt.pf_id, v_receipt.catalog_checksum
      ) then
        continue;
      end if;$replacement$,
    'g'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    $needle$      if v_activation.mode = 'live' and (
        v_job.activation_mode_snapshot is distinct from 'live'$needle$,
    $replacement$      if v_activation.mode = 'live' and (
        not dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
          v_job.message_kind, v_receipt.template_id, v_receipt.pf_id, v_receipt.catalog_checksum
        )
        or v_job.activation_mode_snapshot is distinct from 'live'$replacement$
  );
  if v_definition = v_original
    or v_definition ~ 'live_test_message_id|live_test_confirmed_at|v_live_message'
    or v_definition !~ 'registration_customer_solapi_live_evidence_valid_v1' then
    raise exception 'registration_customer_solapi_claim_evidence_patch_failed'
      using errcode = '55000';
  end if;
  execute v_definition;
end;
  $claim_patch$;

do $legacy_begin_patch$
declare
  v_definition text;
  v_original text;
  v_start integer;
  v_end integer;
begin
  select pg_catalog.pg_get_functiondef(
    'dashboard_private.begin_registration_customer_reminder_dispatch_legacy_v1(uuid,uuid,jsonb,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := pg_catalog.replace(
    v_definition,
    $needle$
  v_live_message public.ops_registration_customer_messages%rowtype;$needle$,
    ''
  );
  v_start := pg_catalog.strpos(
    v_definition,
    $needle$  select message.* into v_live_message$needle$
  );
  if v_start = 0 then
    raise exception 'registration_customer_solapi_legacy_begin_evidence_patch_failed'
      using errcode = '55000';
  end if;
  v_end := pg_catalog.strpos(
    pg_catalog.substr(v_definition, v_start),
    $needle$  end if;$needle$
  );
  if v_end = 0 then
    raise exception 'registration_customer_solapi_legacy_begin_evidence_patch_failed'
      using errcode = '55000';
  end if;
  v_end := v_start + v_end + pg_catalog.length($needle$  end if;$needle$) - 2;
  v_definition := pg_catalog.substr(v_definition, 1, v_start - 1)
    || $replacement$  if not dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
    'appointment_reminder', v_receipt.template_id, v_receipt.pf_id, v_receipt.catalog_checksum
  ) then
    raise exception 'registration_customer_reminder_not_ready' using errcode = '55000';
  end if;$replacement$
    || pg_catalog.substr(v_definition, v_end + 1);
  if v_definition = v_original
    or v_definition ~ 'live_test_message_id|live_test_confirmed_at|v_live_message' then
    raise exception 'registration_customer_solapi_legacy_begin_evidence_patch_failed'
      using errcode = '55000';
  end if;
  execute v_definition;
end;
  $legacy_begin_patch$;

do $begin_patch$
declare
  v_definition text;
  v_original text;
  v_start integer;
  v_end integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := pg_catalog.replace(
    v_definition,
    $needle$
  v_live_message public.ops_registration_customer_messages%rowtype;$needle$,
    ''
  );
  v_start := pg_catalog.strpos(
    v_definition,
    $needle$    select message.* into v_live_message$needle$
  );
  if v_start = 0 then
    raise exception 'registration_customer_solapi_begin_evidence_patch_failed'
      using errcode = '55000';
  end if;
  v_end := pg_catalog.strpos(
    pg_catalog.substr(v_definition, v_start),
    $needle$    end if;$needle$
  );
  if v_end = 0 then
    raise exception 'registration_customer_solapi_begin_evidence_patch_failed'
      using errcode = '55000';
  end if;
  v_end := v_start + v_end + pg_catalog.length($needle$    end if;$needle$) - 2;
  v_definition := pg_catalog.substr(v_definition, 1, v_start - 1)
    || $replacement$    if not dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
      'observation_reminder', v_receipt.template_id, v_receipt.pf_id, v_receipt.catalog_checksum
    ) then
      raise exception 'registration_customer_reminder_not_ready' using errcode = '55000';
    end if;$replacement$
    || pg_catalog.substr(v_definition, v_end + 1);
  if v_definition = v_original
    or v_definition ~ 'live_test_message_id|live_test_confirmed_at|v_live_message' then
    raise exception 'registration_customer_solapi_begin_evidence_patch_failed'
      using errcode = '55000';
  end if;
  execute v_definition;
end;
  $begin_patch$;

commit;
