begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if pg_catalog.to_regclass(
    'dashboard_private.registration_customer_solapi_template_receipts'
  ) is null or pg_catalog.to_regclass(
    'dashboard_private.registration_customer_solapi_activation'
  ) is null or pg_catalog.to_regclass(
    'public.ops_registration_customer_messages'
  ) is null or pg_catalog.to_regclass(
    'dashboard_private.ops_registration_mutations'
  ) is null or pg_catalog.to_regprocedure(
    'dashboard_private.registration_customer_message_assert_actor_v1(uuid,uuid,text)'
  ) is null or pg_catalog.to_regprocedure(
    'dashboard_private.registration_customer_message_source_task_v1(text,uuid)'
  ) is null or pg_catalog.to_regprocedure(
    'dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)'
  ) is null or pg_catalog.to_regprocedure(
    'dashboard_private.registration_customer_message_source_facts_checksum_v1(jsonb)'
  ) is null then
    raise exception 'registration_customer_solapi_activation_dependency_missing'
      using errcode = '55000';
  end if;
end
$$;

create function dashboard_private.registration_customer_solapi_assert_kind_v1(
  p_message_kind text
)
returns void
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_message_kind is null or p_message_kind not in (
    'level_test_booking',
    'visit_consultation_booking',
    'appointment_reminder',
    'waiting_notice',
    'admission_application'
  ) then
    raise exception 'registration_customer_solapi_kind_invalid'
      using errcode = '22023';
  end if;
end;
$$;

alter function dashboard_private.registration_customer_solapi_assert_kind_v1(text)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_solapi_assert_kind_v1(text)
  from public, anon, authenticated, service_role;

create function dashboard_private.registration_customer_solapi_assert_admin_v1(
  p_actor_profile_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
begin
  select profile.role
  into v_actor_role
  from public.profiles profile
  where profile.id = p_actor_profile_id;

  if v_actor_role is distinct from 'admin' then
    raise exception 'registration_customer_message_admin_required'
      using errcode = '42501';
  end if;
end;
$$;

alter function dashboard_private.registration_customer_solapi_assert_admin_v1(uuid)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_solapi_assert_admin_v1(uuid)
  from public, anon, authenticated, service_role;

create function dashboard_private.registration_customer_solapi_assert_operator_v1(
  p_actor_profile_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
begin
  select profile.role
  into v_actor_role
  from public.profiles profile
  where profile.id = p_actor_profile_id;

  if v_actor_role is null or v_actor_role not in ('admin', 'staff') then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;
end;
$$;

alter function dashboard_private.registration_customer_solapi_assert_operator_v1(uuid)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_solapi_assert_operator_v1(uuid)
  from public, anon, authenticated, service_role;

create function dashboard_private.registration_customer_solapi_activation_result_v1(
  p_message_kind text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_activation dashboard_private.registration_customer_solapi_activation%rowtype;
begin
  select activation.*
  into v_activation
  from dashboard_private.registration_customer_solapi_activation activation
  where activation.message_kind = p_message_kind;

  if not found then
    raise exception 'registration_customer_solapi_activation_missing'
      using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'messageKind', v_activation.message_kind,
    'activationMode', v_activation.mode,
    'updatedAt', v_activation.updated_at,
    'liveTestRecorded', v_activation.live_test_message_id is not null
  );
end;
$$;

alter function dashboard_private.registration_customer_solapi_activation_result_v1(text)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_solapi_activation_result_v1(text)
  from public, anon, authenticated, service_role;

create function dashboard_private.enforce_registration_customer_solapi_delivery_gate_v1()
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
  v_live_message public.ops_registration_customer_messages%rowtype;
begin
  if tg_op = 'UPDATE' then
    v_must_check := (
      new.claim_active
      and (
        not old.claim_active
        or new.claim_token is distinct from old.claim_token
      )
    ) or (
      new.provider_attempt_count = 1
      and old.provider_attempt_count = 0
    );
  end if;

  if not v_must_check then
    return new;
  end if;

  select activation.*
  into v_activation
  from dashboard_private.registration_customer_solapi_activation activation
  where activation.message_kind = new.message_kind
  for share;

  if not found or v_activation.mode = 'off' then
    raise exception 'registration_customer_solapi_activation_off'
      using errcode = '40001';
  end if;

  select receipt.*
  into v_receipt
  from dashboard_private.registration_customer_solapi_template_receipts receipt
  where receipt.message_kind = new.message_kind
  for share;

  if not found
    or v_receipt.provider_status <> 'sendable'
    or v_receipt.catalog_checksum is distinct from v_receipt.provider_checksum
    or v_receipt.catalog_checksum is distinct from new.template_checksum then
    raise exception 'registration_customer_solapi_template_drift'
      using errcode = '40001';
  end if;

  if v_activation.mode = 'verification' then
    if new.task_id is distinct from v_activation.verification_task_id
      or new.recipient_hash is distinct from v_activation.verification_recipient_hash then
      raise exception 'registration_customer_solapi_verification_scope_mismatch'
        using errcode = '40001';
    end if;
  elsif v_activation.mode = 'live' then
    select message.*
    into v_live_message
    from public.ops_registration_customer_messages message
    where message.id = v_activation.live_test_message_id
      and message.status = 'accepted'
      and message.message_kind = new.message_kind
      and message.task_id = v_activation.verification_task_id
      and message.recipient_hash = v_activation.verification_recipient_hash
      and message.template_checksum = v_receipt.catalog_checksum
    for share;

    if not found
      or v_activation.live_test_confirmed_at is null then
      raise exception 'registration_customer_solapi_live_evidence_missing'
        using errcode = '40001';
    end if;
  else
    raise exception 'registration_customer_solapi_activation_off'
      using errcode = '40001';
  end if;

  return new;
end;
$$;

alter function dashboard_private.enforce_registration_customer_solapi_delivery_gate_v1()
  owner to postgres;
revoke all on function dashboard_private.enforce_registration_customer_solapi_delivery_gate_v1()
  from public, anon, authenticated, service_role;

create trigger enforce_registration_customer_solapi_delivery_gate_v1
after insert or update on public.ops_registration_customer_messages
for each row execute function dashboard_private.enforce_registration_customer_solapi_delivery_gate_v1();

create function public.record_registration_customer_solapi_template_receipt_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_receipt jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_verified_at timestamptz := pg_catalog.clock_timestamp();
  v_activation dashboard_private.registration_customer_solapi_activation%rowtype;
  v_receipt dashboard_private.registration_customer_solapi_template_receipts%rowtype;
begin
  perform dashboard_private.registration_customer_solapi_assert_kind_v1(p_message_kind);
  perform dashboard_private.registration_customer_solapi_assert_admin_v1(p_actor_profile_id);

  if p_receipt is null
    or pg_catalog.jsonb_typeof(p_receipt) <> 'object'
    or p_receipt - array[
      'templateId',
      'pfId',
      'catalogChecksum',
      'providerChecksum',
      'providerStatus'
    ]::text[] <> '{}'::jsonb
    or not p_receipt ?& array[
      'templateId',
      'pfId',
      'catalogChecksum',
      'providerChecksum',
      'providerStatus'
    ]::text[]
    or pg_catalog.jsonb_typeof(p_receipt -> 'templateId') <> 'string'
    or nullif(pg_catalog.btrim(p_receipt ->> 'templateId'), '') is null
    or pg_catalog.length(p_receipt ->> 'templateId') > 200
    or pg_catalog.jsonb_typeof(p_receipt -> 'pfId') <> 'string'
    or nullif(pg_catalog.btrim(p_receipt ->> 'pfId'), '') is null
    or pg_catalog.length(p_receipt ->> 'pfId') > 200
    or pg_catalog.jsonb_typeof(p_receipt -> 'catalogChecksum') <> 'string'
    or (p_receipt ->> 'catalogChecksum') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_receipt -> 'providerChecksum') <> 'string'
    or (p_receipt ->> 'providerChecksum') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_receipt -> 'providerStatus') <> 'string'
    or p_receipt ->> 'providerStatus' <> 'sendable'
    or p_receipt ->> 'catalogChecksum' <> p_receipt ->> 'providerChecksum' then
    raise exception 'registration_customer_solapi_template_receipt_invalid'
      using errcode = '22023';
  end if;

  select activation.*
  into v_activation
  from dashboard_private.registration_customer_solapi_activation activation
  where activation.message_kind = p_message_kind
  for update;
  if not found then
    raise exception 'registration_customer_solapi_activation_missing'
      using errcode = '55000';
  end if;

  if v_activation.mode <> 'off' then
    perform 1
    from dashboard_private.registration_customer_solapi_template_receipts receipt
    where receipt.message_kind = p_message_kind
      and receipt.template_id = pg_catalog.btrim(p_receipt ->> 'templateId')
      and receipt.pf_id = pg_catalog.btrim(p_receipt ->> 'pfId')
      and receipt.catalog_checksum = p_receipt ->> 'catalogChecksum'
      and receipt.provider_checksum = p_receipt ->> 'providerChecksum'
      and receipt.provider_status = 'sendable'
    for update;
    if not found then
      raise exception 'registration_customer_solapi_receipt_change_requires_off'
        using errcode = '40001';
    end if;
  end if;

  insert into dashboard_private.registration_customer_solapi_template_receipts(
    message_kind,
    template_id,
    pf_id,
    catalog_checksum,
    provider_checksum,
    provider_status,
    verified_by,
    verified_at
  ) values (
    p_message_kind,
    pg_catalog.btrim(p_receipt ->> 'templateId'),
    pg_catalog.btrim(p_receipt ->> 'pfId'),
    p_receipt ->> 'catalogChecksum',
    p_receipt ->> 'providerChecksum',
    'sendable',
    p_actor_profile_id,
    v_verified_at
  )
  on conflict (message_kind) do update
  set template_id = excluded.template_id,
      pf_id = excluded.pf_id,
      catalog_checksum = excluded.catalog_checksum,
      provider_checksum = excluded.provider_checksum,
      provider_status = excluded.provider_status,
      verified_by = excluded.verified_by,
      verified_at = excluded.verified_at
  returning * into v_receipt;

  return pg_catalog.jsonb_build_object(
    'messageKind', v_receipt.message_kind,
    'templateVerified', true,
    'verifiedAt', v_receipt.verified_at
  );
end;
$$;

alter function public.record_registration_customer_solapi_template_receipt_v1(uuid, text, jsonb)
  owner to postgres;
revoke all on function public.record_registration_customer_solapi_template_receipt_v1(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_registration_customer_solapi_template_receipt_v1(uuid, text, jsonb)
  to service_role;

create function public.set_registration_customer_solapi_activation_v1(
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
  v_live_message public.ops_registration_customer_messages%rowtype;
  v_mutation dashboard_private.ops_registration_mutations%rowtype;
  v_current_mode text;
  v_request_key text;
  v_verification_task_id uuid;
  v_verification_recipient_hash text;
  v_template_id text;
  v_pf_id text;
  v_catalog_checksum text;
  v_target_fingerprint jsonb;
  v_response jsonb;
  v_mutation_task_id uuid;
begin
  perform dashboard_private.registration_customer_solapi_assert_kind_v1(
    p_message_kind
  );
  perform dashboard_private.registration_customer_solapi_assert_admin_v1(
    p_actor_profile_id
  );

  if p_mode is null
    or p_mode not in ('off', 'verification', 'live')
    or p_evidence is null
    or pg_catalog.jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'registration_customer_solapi_activation_evidence_invalid'
      using errcode = '22023';
  end if;

  if p_mode = 'off' then
    if p_evidence - array['requestKey']::text[] <> '{}'::jsonb
      or not p_evidence ?& array['requestKey']::text[] then
      raise exception 'registration_customer_solapi_activation_evidence_invalid'
        using errcode = '22023';
    end if;
  elsif p_mode = 'verification' then
    if p_evidence - array[
      'requestKey',
      'verificationTaskId',
      'verificationRecipientHash',
      'templateId',
      'pfId',
      'catalogChecksum'
    ]::text[] <> '{}'::jsonb
      or not p_evidence ?& array[
        'requestKey',
        'verificationTaskId',
        'verificationRecipientHash',
        'templateId',
        'pfId',
        'catalogChecksum'
      ]::text[] then
      raise exception 'registration_customer_solapi_activation_evidence_invalid'
        using errcode = '22023';
    end if;
  else
    if p_evidence - array[
      'requestKey',
      'templateId',
      'pfId',
      'catalogChecksum'
    ]::text[] <> '{}'::jsonb
      or not p_evidence ?& array[
        'requestKey',
        'templateId',
        'pfId',
        'catalogChecksum'
      ]::text[] then
      raise exception 'registration_customer_solapi_activation_evidence_invalid'
        using errcode = '22023';
    end if;
  end if;

  if pg_catalog.jsonb_typeof(p_evidence -> 'requestKey') <> 'string'
    or (p_evidence ->> 'requestKey') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'registration_customer_solapi_activation_evidence_invalid'
      using errcode = '22023';
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
      raise exception 'registration_customer_solapi_activation_evidence_invalid'
        using errcode = '22023';
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
      raise exception 'registration_customer_solapi_activation_evidence_invalid'
        using errcode = '22023';
    end if;
    v_verification_task_id := (p_evidence ->> 'verificationTaskId')::uuid;
    v_verification_recipient_hash := p_evidence ->> 'verificationRecipientHash';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-customer-message-admin:'
        || p_actor_profile_id::text || ':' || v_request_key,
      0
    )
  );

  select activation.*
  into v_activation
  from dashboard_private.registration_customer_solapi_activation activation
  where activation.message_kind = p_message_kind
  for update;
  if not found then
    raise exception 'registration_customer_solapi_activation_missing'
      using errcode = '55000';
  end if;
  v_current_mode := v_activation.mode;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'messageKind', p_message_kind,
    'mode', p_mode,
    'evidence', p_evidence - 'requestKey'
  );

  select mutation.*
  into v_mutation
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = p_actor_profile_id
    and mutation.request_key = v_request_key;
  if found then
    if v_mutation.mutation_type = 'registration_customer_solapi_activation'
      and v_mutation.target_fingerprint = v_target_fingerprint then
      return v_mutation.response_payload;
    end if;
    raise exception 'registration_customer_message_mutation_conflict'
      using errcode = '23505';
  end if;

  if not (
    (v_current_mode = 'off' and p_mode = 'verification')
    or (v_current_mode = 'verification' and p_mode in ('live', 'off'))
    or (v_current_mode = 'live' and p_mode = 'off')
  ) then
    raise exception 'registration_customer_solapi_activation_transition_invalid'
      using errcode = '40001';
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
      raise exception 'registration_customer_solapi_template_drift'
        using errcode = '40001';
    end if;
  end if;

  if p_mode = 'verification' then
    perform dashboard_private.registration_customer_message_assert_actor_v1(
      p_actor_profile_id,
      v_verification_task_id,
      'admin'
    );
    v_mutation_task_id := v_verification_task_id;

    if v_activation.live_test_message_id is not null then
      select message.*
      into v_live_message
      from public.ops_registration_customer_messages message
      where message.id = v_activation.live_test_message_id
        and message.status = 'accepted'
        and message.message_kind = p_message_kind
        and message.task_id = v_verification_task_id
        and message.recipient_hash = v_verification_recipient_hash
        and message.template_checksum = v_receipt.catalog_checksum
      for share;

      if not found then
        v_activation.live_test_message_id := null;
        v_activation.live_test_confirmed_at := null;
      end if;
    end if;

    update dashboard_private.registration_customer_solapi_activation activation
    set mode = 'verification',
        verification_task_id = v_verification_task_id,
        verification_recipient_hash = v_verification_recipient_hash,
        live_test_message_id = v_activation.live_test_message_id,
        live_test_confirmed_at = v_activation.live_test_confirmed_at,
        updated_by = p_actor_profile_id
    where activation.message_kind = p_message_kind;
  elsif p_mode = 'live' then
    v_mutation_task_id := v_activation.verification_task_id;
    perform dashboard_private.registration_customer_message_assert_actor_v1(
      p_actor_profile_id,
      v_mutation_task_id,
      'admin'
    );

    select message.*
    into v_live_message
    from public.ops_registration_customer_messages message
    where message.id = v_activation.live_test_message_id
      and message.status = 'accepted'
      and message.message_kind = p_message_kind
      and message.task_id = v_activation.verification_task_id
      and message.recipient_hash = v_activation.verification_recipient_hash
      and message.template_checksum = v_receipt.catalog_checksum
    for share;

    if not found or v_activation.live_test_confirmed_at is null then
      raise exception 'registration_customer_solapi_live_evidence_missing'
        using errcode = '40001';
    end if;

    update dashboard_private.registration_customer_solapi_activation activation
    set mode = 'live',
        updated_by = p_actor_profile_id
    where activation.message_kind = p_message_kind;
  else
    v_mutation_task_id := v_activation.verification_task_id;
    perform dashboard_private.registration_customer_message_assert_actor_v1(
      p_actor_profile_id,
      v_mutation_task_id,
      'admin'
    );

    update dashboard_private.registration_customer_solapi_activation activation
    set mode = 'off',
        verification_task_id = null,
        verification_recipient_hash = null,
        updated_by = p_actor_profile_id
    where activation.message_kind = p_message_kind;
  end if;

  v_response := dashboard_private.registration_customer_solapi_activation_result_v1(
    p_message_kind
  );

  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    p_actor_profile_id,
    v_request_key,
    v_mutation_task_id,
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

create function public.record_registration_customer_solapi_live_test_receipt_v1(
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
  v_mutation dashboard_private.ops_registration_mutations%rowtype;
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_target_fingerprint jsonb;
  v_response jsonb;
begin
  perform dashboard_private.registration_customer_solapi_assert_kind_v1(
    p_message_kind
  );
  perform dashboard_private.registration_customer_solapi_assert_admin_v1(
    p_actor_profile_id
  );

  if p_message_id is null
    or p_received_at is null
    or p_received_at > pg_catalog.clock_timestamp()
    or v_request_key is null
    or v_request_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'registration_customer_solapi_live_test_receipt_invalid'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-customer-message-admin:'
        || p_actor_profile_id::text || ':' || v_request_key,
      0
    )
  );

  select activation.*
  into v_activation
  from dashboard_private.registration_customer_solapi_activation activation
  where activation.message_kind = p_message_kind
  for update;
  if not found then
    raise exception 'registration_customer_solapi_activation_missing'
      using errcode = '55000';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'messageKind', p_message_kind,
    'messageId', p_message_id,
    'receivedAt', p_received_at
  );

  select mutation.*
  into v_mutation
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = p_actor_profile_id
    and mutation.request_key = v_request_key;
  if found then
    if v_mutation.mutation_type = 'registration_customer_solapi_live_test_receipt'
      and v_mutation.target_fingerprint = v_target_fingerprint then
      return v_mutation.response_payload;
    end if;
    raise exception 'registration_customer_message_mutation_conflict'
      using errcode = '23505';
  end if;

  if v_activation.mode <> 'verification' then
    raise exception 'registration_customer_solapi_live_test_not_allowed'
      using errcode = '40001';
  end if;

  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id,
    v_activation.verification_task_id,
    'admin'
  );

  if v_activation.live_test_message_id is not null then
    raise exception 'registration_customer_solapi_live_test_receipt_conflict'
      using errcode = '23505';
  end if;

  select receipt.*
  into v_receipt
  from dashboard_private.registration_customer_solapi_template_receipts receipt
  where receipt.message_kind = p_message_kind
    and receipt.provider_status = 'sendable'
    and receipt.catalog_checksum = receipt.provider_checksum
  for share;
  if not found then
    raise exception 'registration_customer_solapi_template_drift'
      using errcode = '40001';
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
  for share;

  if not found
    or p_received_at < coalesce(v_message.resolved_at, v_message.updated_at, v_message.confirmed_at)
    or p_received_at < v_message.confirmed_at then
    raise exception 'registration_customer_solapi_live_test_evidence_mismatch'
      using errcode = '40001';
  end if;

  update dashboard_private.registration_customer_solapi_activation activation
  set live_test_message_id = p_message_id,
      live_test_confirmed_at = p_received_at,
      updated_by = p_actor_profile_id
  where activation.message_kind = p_message_kind;

  v_response := pg_catalog.jsonb_build_object(
    'messageKind', p_message_kind,
    'recorded', true,
    'receivedAt', p_received_at
  );

  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    p_actor_profile_id,
    v_request_key,
    v_activation.verification_task_id,
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

create function public.get_registration_customer_solapi_readiness_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_source_id uuid,
  p_template_contract jsonb
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
  v_live_message public.ops_registration_customer_messages%rowtype;
  v_source jsonb;
  v_task_id uuid;
  v_credentials_configured boolean;
  v_pf_id text;
  v_template_id text;
  v_catalog_checksum text;
  v_recipient_hash text;
  v_source_fingerprint text;
  v_source_facts_checksum text;
  v_pf_configured boolean;
  v_template_configured boolean;
  v_template_verified boolean := false;
  v_source_valid boolean := false;
  v_source_dirty boolean := false;
  v_activation_eligible boolean := false;
  v_duplicate_locked boolean := false;
  v_blockers jsonb := '[]'::jsonb;
begin
  perform dashboard_private.registration_customer_solapi_assert_kind_v1(
    p_message_kind
  );
  perform dashboard_private.registration_customer_solapi_assert_operator_v1(
    p_actor_profile_id
  );

  if p_source_id is null
    or p_template_contract is null
    or pg_catalog.jsonb_typeof(p_template_contract) <> 'object'
    or p_template_contract - array[
      'credentialsConfigured',
      'pfId',
      'templateId',
      'catalogChecksum',
      'recipientHash',
      'sourceFingerprint',
      'sourceFactsChecksum'
    ]::text[] <> '{}'::jsonb
    or not p_template_contract ?& array[
      'credentialsConfigured',
      'pfId',
      'templateId',
      'catalogChecksum',
      'recipientHash',
      'sourceFingerprint',
      'sourceFactsChecksum'
    ]::text[]
    or pg_catalog.jsonb_typeof(p_template_contract -> 'credentialsConfigured') <> 'boolean'
    or pg_catalog.jsonb_typeof(p_template_contract -> 'catalogChecksum') <> 'string'
    or (p_template_contract ->> 'catalogChecksum') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_template_contract -> 'recipientHash') <> 'string'
    or (p_template_contract ->> 'recipientHash') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_template_contract -> 'sourceFingerprint') <> 'string'
    or (p_template_contract ->> 'sourceFingerprint') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_template_contract -> 'sourceFactsChecksum') <> 'string'
    or (p_template_contract ->> 'sourceFactsChecksum') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_template_contract -> 'pfId') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_template_contract -> 'templateId') not in ('string', 'null') then
    raise exception 'registration_customer_solapi_readiness_contract_invalid'
      using errcode = '22023';
  end if;

  v_credentials_configured := (p_template_contract ->> 'credentialsConfigured')::boolean;
  v_pf_id := nullif(pg_catalog.btrim(p_template_contract ->> 'pfId'), '');
  v_template_id := nullif(pg_catalog.btrim(p_template_contract ->> 'templateId'), '');
  v_catalog_checksum := p_template_contract ->> 'catalogChecksum';
  v_recipient_hash := p_template_contract ->> 'recipientHash';
  v_source_fingerprint := p_template_contract ->> 'sourceFingerprint';
  v_source_facts_checksum := p_template_contract ->> 'sourceFactsChecksum';
  v_pf_configured := v_pf_id is not null;
  v_template_configured := v_template_id is not null;

  if (v_pf_id is not null and pg_catalog.length(v_pf_id) > 200)
    or (v_template_id is not null and pg_catalog.length(v_template_id) > 200) then
    raise exception 'registration_customer_solapi_readiness_contract_invalid'
      using errcode = '22023';
  end if;

  select activation.*
  into v_activation
  from dashboard_private.registration_customer_solapi_activation activation
  where activation.message_kind = p_message_kind;
  if not found then
    raise exception 'registration_customer_solapi_activation_missing'
      using errcode = '55000';
  end if;

  select receipt.*
  into v_receipt
  from dashboard_private.registration_customer_solapi_template_receipts receipt
  where receipt.message_kind = p_message_kind;
  if found then
    v_template_verified := v_receipt.provider_status = 'sendable'
      and v_receipt.catalog_checksum = v_receipt.provider_checksum
      and v_receipt.catalog_checksum = v_catalog_checksum
      and v_receipt.template_id = v_template_id
      and v_receipt.pf_id = v_pf_id;
  end if;

  begin
    v_task_id := dashboard_private.registration_customer_message_source_task_v1(
      p_message_kind,
      p_source_id
    );
    perform dashboard_private.registration_customer_message_assert_actor_v1(
      p_actor_profile_id,
      v_task_id,
      'send'
    );
    v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl(
      p_message_kind,
      p_source_id
    );
    v_source_valid := true;
    v_source_dirty := dashboard_private.registration_customer_message_source_facts_checksum_v1(
      v_source
    ) is distinct from v_source_facts_checksum;
  exception
    when sqlstate '22023' then
      v_source_valid := false;
      v_source_dirty := false;
  end;

  if v_activation.mode = 'verification' then
    v_activation_eligible := v_source_valid
      and v_task_id = v_activation.verification_task_id
      and v_recipient_hash = v_activation.verification_recipient_hash;
  elsif v_activation.mode = 'live' then
    select message.*
    into v_live_message
    from public.ops_registration_customer_messages message
    where message.id = v_activation.live_test_message_id
      and message.status = 'accepted'
      and message.message_kind = p_message_kind
      and message.task_id = v_activation.verification_task_id
      and message.recipient_hash = v_activation.verification_recipient_hash
      and message.template_checksum = v_receipt.catalog_checksum;
    v_activation_eligible := found
      and v_activation.live_test_confirmed_at is not null;
  end if;

  select exists (
    select 1
    from public.ops_registration_customer_messages message
    where message.message_kind = p_message_kind
      and message.source_fingerprint = v_source_fingerprint
      and message.recipient_hash = v_recipient_hash
      and (
        (
          p_message_kind in (
            'level_test_booking',
            'visit_consultation_booking',
            'appointment_reminder'
          )
          and message.appointment_id = p_source_id
        )
        or (p_message_kind = 'waiting_notice' and message.track_id = p_source_id)
        or (p_message_kind = 'admission_application' and message.task_id = p_source_id)
      )
  ) into v_duplicate_locked;

  if v_activation.mode = 'off' then
    v_blockers := v_blockers || pg_catalog.jsonb_build_array('activation_off');
  elsif v_activation.mode = 'verification' and not v_activation_eligible then
    v_blockers := v_blockers || pg_catalog.jsonb_build_array(
      'verification_scope_mismatch'
    );
  elsif v_activation.mode = 'live' and not v_activation_eligible then
    v_blockers := v_blockers || pg_catalog.jsonb_build_array(
      'verification_scope_mismatch'
    );
  end if;
  if not v_credentials_configured then
    v_blockers := v_blockers || pg_catalog.jsonb_build_array('credentials_missing');
  end if;
  if not v_pf_configured then
    v_blockers := v_blockers || pg_catalog.jsonb_build_array('pf_missing');
  end if;
  if not v_template_configured then
    v_blockers := v_blockers || pg_catalog.jsonb_build_array('template_missing');
  end if;
  if v_receipt.message_kind is null then
    v_blockers := v_blockers || pg_catalog.jsonb_build_array(
      'template_not_verified'
    );
  elsif not v_template_verified then
    v_blockers := v_blockers || pg_catalog.jsonb_build_array('template_drift');
  end if;
  if not v_source_valid then
    v_blockers := v_blockers || pg_catalog.jsonb_build_array('source_invalid');
  elsif v_source_dirty then
    v_blockers := v_blockers || pg_catalog.jsonb_build_array('source_dirty');
  end if;
  if v_duplicate_locked then
    v_blockers := v_blockers || pg_catalog.jsonb_build_array('duplicate_locked');
  end if;

  return pg_catalog.jsonb_build_object(
    'runtimeReady', true,
    'activationMode', v_activation.mode,
    'activationEligible', v_activation_eligible,
    'credentialsConfigured', v_credentials_configured,
    'pfConfigured', v_pf_configured,
    'templateConfigured', v_template_configured,
    'templateVerified', v_template_verified,
    'verifiedAt', case when v_template_verified then v_receipt.verified_at else null end,
    'sourceValid', v_source_valid,
    'sendAllowed', pg_catalog.jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers
  );
end;
$$;

alter function public.get_registration_customer_solapi_readiness_v1(uuid, text, uuid, jsonb)
  owner to postgres;
revoke all on function public.get_registration_customer_solapi_readiness_v1(uuid, text, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.get_registration_customer_solapi_readiness_v1(uuid, text, uuid, jsonb)
  to service_role;

create function public.registration_customer_solapi_runtime_version()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select 1
$$;

alter function public.registration_customer_solapi_runtime_version()
  owner to postgres;
revoke all on function public.registration_customer_solapi_runtime_version()
  from public, anon, authenticated, service_role;
grant execute on function public.registration_customer_solapi_runtime_version()
  to authenticated, service_role;

commit;
