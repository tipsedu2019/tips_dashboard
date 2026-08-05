begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if pg_catalog.to_regprocedure(
    'dashboard_private.notification_canonical_json_v1(jsonb)'
  ) is null or pg_catalog.to_regprocedure(
    'dashboard_private.notification_sha256_hex_v1(text)'
  ) is null then
    raise exception 'registration_customer_message_hash_dependency_missing'
      using errcode = '55000';
  end if;
end
$$;

alter table public.ops_registration_customer_message_previews
  add column source_facts_checksum text not null
  constraint ops_reg_customer_previews_source_facts_checksum_check
  check (source_facts_checksum ~ '^[a-f0-9]{64}$');

alter table public.ops_registration_customer_messages
  add column source_facts_checksum text not null
  constraint ops_reg_customer_messages_source_facts_checksum_check
  check (source_facts_checksum ~ '^[a-f0-9]{64}$');

create function dashboard_private.registration_customer_message_source_facts_checksum_v1(
  p_source jsonb
)
returns text
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_checksum_source jsonb;
  v_scheduled_at timestamptz;
begin
  if p_source is null or pg_catalog.jsonb_typeof(p_source) <> 'object' then
    raise exception 'registration_customer_message_source_facts_invalid'
      using errcode = '22023';
  end if;

  v_checksum_source := p_source - 'parentPhoneDigits';
  if p_source ? 'scheduledAt' then
    begin
      v_scheduled_at := (p_source ->> 'scheduledAt')::timestamptz;
    exception when others then
      raise exception 'registration_customer_message_source_facts_invalid'
        using errcode = '22023';
    end;
    if v_scheduled_at is null then
      raise exception 'registration_customer_message_source_facts_invalid'
        using errcode = '22023';
    end if;
    v_checksum_source := pg_catalog.jsonb_set(
      v_checksum_source,
      array['scheduledAt']::text[],
      pg_catalog.to_jsonb(extract(epoch from v_scheduled_at)),
      false
    );
  end if;

  return dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(
      pg_catalog.jsonb_build_object(
        'domain', 'registration-customer-message-source-facts-v1',
        'source', v_checksum_source
      )
    )
  );
end;
$$;

alter function dashboard_private.registration_customer_message_source_facts_checksum_v1(jsonb)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_message_source_facts_checksum_v1(jsonb)
  from public, anon, authenticated, service_role;

create function dashboard_private.registration_customer_message_assert_actor_v1(
  p_actor_profile_id uuid,
  p_task_id uuid,
  p_permission text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_task public.ops_tasks%rowtype;
  v_visible boolean := false;
begin
  select profile.role
  into v_actor_role
  from public.profiles profile
  where profile.id = p_actor_profile_id;

  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration';

  if v_actor_role is null or not found then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;

  v_visible := v_actor_role in ('admin', 'staff')
    or v_task.requested_by = p_actor_profile_id
    or v_task.assignee_id = p_actor_profile_id
    or v_task.secondary_assignee_id = p_actor_profile_id
    or exists (
      select 1
      from public.ops_registration_subject_tracks track
      where track.task_id = p_task_id
        and track.director_profile_id = p_actor_profile_id
    );

  if not v_visible then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;

  if p_permission = 'send' and v_actor_role not in ('admin', 'staff') then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  elsif p_permission = 'admin' and v_actor_role <> 'admin' then
    raise exception 'registration_customer_message_admin_required'
      using errcode = '42501';
  elsif p_permission = 'history'
    and v_actor_role not in ('admin', 'staff', 'teacher') then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  elsif p_permission not in ('send', 'admin', 'history') then
    raise exception 'registration_customer_message_permission_invalid'
      using errcode = '22023';
  end if;

  return v_actor_role;
end;
$$;

alter function dashboard_private.registration_customer_message_assert_actor_v1(uuid, uuid, text)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_message_assert_actor_v1(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create function dashboard_private.registration_customer_message_source_task_v1(
  p_message_kind text,
  p_source_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
begin
  if p_message_kind in (
    'level_test_booking',
    'visit_consultation_booking',
    'appointment_reminder'
  ) then
    select appointment.task_id
    into v_task_id
    from public.ops_registration_appointments appointment
    where appointment.id = p_source_id;
  elsif p_message_kind = 'waiting_notice' then
    select track.task_id
    into v_task_id
    from public.ops_registration_subject_tracks track
    where track.id = p_source_id;
  elsif p_message_kind = 'admission_application' then
    select task.id
    into v_task_id
    from public.ops_tasks task
    where task.id = p_source_id
      and task.type = 'registration';
  else
    raise exception 'registration_customer_message_kind_invalid'
      using errcode = '22023';
  end if;

  if v_task_id is null then
    raise exception 'registration_customer_message_source_invalid'
      using errcode = '22023';
  end if;

  return v_task_id;
end;
$$;

alter function dashboard_private.registration_customer_message_source_task_v1(text, uuid)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_message_source_task_v1(text, uuid)
  from public, anon, authenticated, service_role;

create function dashboard_private.resolve_registration_customer_message_source_v1_impl(
  p_message_kind text,
  p_source_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_task_id uuid;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_phone_digits text;
  v_appointment public.ops_registration_appointments%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_class public.classes%rowtype;
  v_subjects jsonb;
  v_tracks jsonb;
  v_expected_waiting_kind text;
begin
  v_task_id := dashboard_private.registration_customer_message_source_task_v1(
    p_message_kind,
    p_source_id
  );

  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
    and nullif(pg_catalog.btrim(task.student_name), '') is not null
  for share;

  if not found then
    raise exception 'registration_customer_message_source_invalid'
      using errcode = '22023';
  end if;

  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for share;

  if not found then
    raise exception 'registration_customer_message_source_invalid'
      using errcode = '22023';
  end if;

  v_phone_digits := pg_catalog.regexp_replace(
    coalesce(v_detail.parent_phone, ''),
    '[^0-9]',
    '',
    'g'
  );
  if v_phone_digits !~ '^01(0|1|[6-9])[0-9]{7,8}$' then
    raise exception 'registration_customer_message_source_invalid'
      using errcode = '22023';
  end if;

  if p_message_kind in (
    'level_test_booking',
    'visit_consultation_booking',
    'appointment_reminder'
  ) then
    select appointment.*
    into v_appointment
    from public.ops_registration_appointments appointment
    where appointment.id = p_source_id
      and appointment.task_id = v_task_id
      and appointment.status = 'scheduled'
      and appointment.scheduled_at > pg_catalog.clock_timestamp()
    for share;

    if not found
      or (p_message_kind = 'level_test_booking' and v_appointment.kind <> 'level_test')
      or (
        p_message_kind = 'visit_consultation_booking'
        and v_appointment.kind <> 'visit_consultation'
      ) then
      raise exception 'registration_customer_message_source_invalid'
        using errcode = '22023';
    end if;

    if v_appointment.kind = 'level_test' then
      perform 1
      from public.ops_registration_level_tests level_test
      join public.ops_registration_subject_tracks track
        on track.id = level_test.track_id
      where level_test.appointment_id = v_appointment.id
      order by level_test.id, track.id
      for share of level_test, track;

      select pg_catalog.jsonb_agg(participant.subject order by participant.subject_order)
      into v_subjects
      from (
        select distinct
          track.subject,
          case track.subject when '영어' then 1 when '수학' then 2 when '과학' then 3 else 99 end
            as subject_order
        from public.ops_registration_level_tests level_test
        join public.ops_registration_subject_tracks track
          on track.id = level_test.track_id
        join public.ops_registration_appointments appointment
          on appointment.id = level_test.appointment_id
        where level_test.appointment_id = v_appointment.id
          and level_test.status in ('scheduled', 'in_progress')
          and track.task_id = appointment.task_id
          and appointment.task_id = v_task_id
      ) participant;
    else
      perform 1
      from public.ops_registration_consultations consultation
      join public.ops_registration_subject_tracks track
        on track.id = consultation.track_id
      where consultation.appointment_id = v_appointment.id
      order by consultation.id, track.id
      for share of consultation, track;

      select pg_catalog.jsonb_agg(participant.subject order by participant.subject_order)
      into v_subjects
      from (
        select distinct
          track.subject,
          case track.subject when '영어' then 1 when '수학' then 2 when '과학' then 3 else 99 end
            as subject_order
        from public.ops_registration_consultations consultation
        join public.ops_registration_subject_tracks track
          on track.id = consultation.track_id
        join public.ops_registration_appointments appointment
          on appointment.id = consultation.appointment_id
        where consultation.appointment_id = v_appointment.id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled'
          and track.task_id = appointment.task_id
          and appointment.task_id = v_task_id
      ) participant;
    end if;

    if v_subjects is null or pg_catalog.jsonb_array_length(v_subjects) = 0 then
      raise exception 'registration_customer_message_source_invalid'
        using errcode = '22023';
    end if;

    return pg_catalog.jsonb_build_object(
      'messageKind', p_message_kind,
      'sourceId', p_source_id,
      'taskId', v_task_id,
      'trackId', null,
      'appointmentId', v_appointment.id,
      'sourceRevision', v_appointment.notification_revision,
      'studentName', pg_catalog.btrim(v_task.student_name),
      'parentPhoneDigits', v_phone_digits,
      'subjects', v_subjects,
      'appointmentKind', v_appointment.kind,
      'scheduledAt', v_appointment.scheduled_at,
      'place', pg_catalog.btrim(v_appointment.place)
    );
  elsif p_message_kind = 'waiting_notice' then
    select track.*
    into v_track
    from public.ops_registration_subject_tracks track
    where track.id = p_source_id
      and track.task_id = v_task_id
    for share;

    if not found then
      raise exception 'registration_customer_message_source_invalid'
        using errcode = '22023';
    end if;

    v_expected_waiting_kind := case v_track.workflow_status
      when 'waiting_current_class' then 'current_class'
      when 'waiting_new_class' then 'current_term_opening'
      when 'waiting_next_opening' then 'next_term_opening'
      else null
    end;

    if v_expected_waiting_kind is null
      or v_track.waiting_detail_kind is distinct from v_expected_waiting_kind then
      raise exception 'registration_customer_message_waiting_source_inconsistent'
        using errcode = '22023';
    end if;

    if v_track.pipeline_status = 'waiting'
      and v_track.waiting_kind is not null
      and v_track.waiting_kind is distinct from v_track.waiting_detail_kind then
      raise exception 'registration_customer_message_waiting_source_inconsistent'
        using errcode = '22023';
    end if;

    if v_track.waiting_detail_kind = 'current_class' then
      if v_track.waiting_detail_class_id is null then
        raise exception 'registration_customer_message_waiting_source_inconsistent'
          using errcode = '22023';
      end if;
      select class.*
      into v_class
      from public.classes class
      where class.id = v_track.waiting_detail_class_id
        and nullif(pg_catalog.btrim(class.name), '') is not null
      for share;
      if not found then
        raise exception 'registration_customer_message_waiting_source_inconsistent'
          using errcode = '22023';
      end if;
    elsif v_track.waiting_detail_class_id is not null then
      raise exception 'registration_customer_message_waiting_source_inconsistent'
        using errcode = '22023';
    end if;

    return pg_catalog.jsonb_build_object(
      'messageKind', p_message_kind,
      'sourceId', p_source_id,
      'taskId', v_task_id,
      'trackId', v_track.id,
      'appointmentId', null,
      'sourceRevision', v_track.workflow_revision,
      'studentName', pg_catalog.btrim(v_task.student_name),
      'parentPhoneDigits', v_phone_digits,
      'subjects', pg_catalog.jsonb_build_array(v_track.subject),
      'workflowStatus', v_track.workflow_status,
      'waitingKind', v_track.waiting_detail_kind,
      'waitingClassId', v_track.waiting_detail_class_id,
      'waitingClassName', case
        when v_track.waiting_detail_kind = 'current_class' then pg_catalog.btrim(v_class.name)
        else null
      end
    );
  end if;

  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for share;

  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track
    on track.id = enrollment.track_id
  where track.task_id = v_task_id
  order by enrollment.id
  for share of enrollment;

  if v_detail.admission_notice_sent or exists (
    select 1
    from public.ops_registration_messages legacy_message
    where legacy_message.task_id = v_task_id
      and legacy_message.template_key = 'admission_application'
      and (
        legacy_message.status = 'accepted'
        or legacy_message.claim_active
      )
  ) then
    raise exception 'registration_customer_message_admission_already_sent'
      using errcode = '23505';
  end if;

  select
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'trackId', eligible.id,
        'subject', eligible.subject,
        'workflowStatus', eligible.workflow_status,
        'workflowRevision', eligible.workflow_revision,
        'pipelineStatus', eligible.pipeline_status
      ) order by eligible.subject_order, eligible.id
    ),
    pg_catalog.jsonb_agg(eligible.subject order by eligible.subject_order)
  into v_tracks, v_subjects
  from (
    select distinct
      track.id,
      track.subject,
      track.workflow_status,
      track.workflow_revision,
      track.pipeline_status,
      case track.subject when '영어' then 1 when '수학' then 2 when '과학' then 3 else 99 end
        as subject_order
    from public.ops_registration_subject_tracks track
    where track.task_id = v_task_id
      and (
        track.workflow_status = 'enrollment_requested'
        or track.pipeline_status = 'enrollment_decided'
        or exists (
          select 1
          from public.ops_registration_enrollments enrollment
          where enrollment.track_id = track.id
            and enrollment.status = 'planned'
            and enrollment.admission_batch_id is null
        )
      )
  ) eligible;

  if v_tracks is null or pg_catalog.jsonb_array_length(v_tracks) = 0 then
    raise exception 'registration_customer_message_source_invalid'
      using errcode = '22023';
  end if;

  return pg_catalog.jsonb_build_object(
    'messageKind', p_message_kind,
    'sourceId', p_source_id,
    'taskId', v_task_id,
    'trackId', null,
    'appointmentId', null,
    'sourceRevision', v_detail.common_revision,
    'studentName', pg_catalog.btrim(v_task.student_name),
    'parentPhoneDigits', v_phone_digits,
    'subjects', v_subjects,
    'tracks', v_tracks
  );
end;
$$;

alter function dashboard_private.resolve_registration_customer_message_source_v1_impl(text, uuid)
  owner to postgres;
revoke all on function dashboard_private.resolve_registration_customer_message_source_v1_impl(text, uuid)
  from public, anon, authenticated, service_role;

create function dashboard_private.registration_customer_message_assert_contract_v1(
  p_contract jsonb,
  p_message_kind text
)
returns void
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_contract is null
    or pg_catalog.jsonb_typeof(p_contract) <> 'object'
    or p_contract - array[
      'parentPhoneDigits',
      'sourceFingerprint',
      'recipientHash',
      'templateKey',
      'templateRevision',
      'templateChecksum',
      'renderedVariablesChecksum',
      'renderedBodyChecksum',
      'renderedButtonsChecksum'
    ]::text[] <> '{}'::jsonb
    or not p_contract ?& array[
      'parentPhoneDigits',
      'sourceFingerprint',
      'recipientHash',
      'templateKey',
      'templateRevision',
      'templateChecksum',
      'renderedVariablesChecksum',
      'renderedBodyChecksum',
      'renderedButtonsChecksum'
    ]::text[]
    or pg_catalog.jsonb_typeof(p_contract -> 'parentPhoneDigits') <> 'string'
    or (p_contract ->> 'parentPhoneDigits') !~ '^01(0|1|[6-9])[0-9]{7,8}$'
    or pg_catalog.jsonb_typeof(p_contract -> 'sourceFingerprint') <> 'string'
    or (p_contract ->> 'sourceFingerprint') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_contract -> 'recipientHash') <> 'string'
    or (p_contract ->> 'recipientHash') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_contract -> 'templateKey') <> 'string'
    or p_contract ->> 'templateKey' <> p_message_kind
    or pg_catalog.jsonb_typeof(p_contract -> 'templateRevision') <> 'number'
    or (p_contract ->> 'templateRevision') !~ '^[1-9][0-9]*$'
    or (p_contract ->> 'templateRevision')::numeric > 2147483647
    or pg_catalog.jsonb_typeof(p_contract -> 'templateChecksum') <> 'string'
    or (p_contract ->> 'templateChecksum') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_contract -> 'renderedVariablesChecksum') <> 'string'
    or (p_contract ->> 'renderedVariablesChecksum') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_contract -> 'renderedBodyChecksum') <> 'string'
    or (p_contract ->> 'renderedBodyChecksum') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_contract -> 'renderedButtonsChecksum') <> 'string'
    or (p_contract ->> 'renderedButtonsChecksum') !~ '^[a-f0-9]{64}$' then
    raise exception 'registration_customer_message_contract_invalid'
      using errcode = '22023';
  end if;
end;
$$;

alter function dashboard_private.registration_customer_message_assert_contract_v1(jsonb, text)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_message_assert_contract_v1(jsonb, text)
  from public, anon, authenticated, service_role;

create function dashboard_private.registration_customer_message_provider_evidence_v1(
  p_provider_evidence jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_observed_at timestamptz;
begin
  if pg_catalog.jsonb_typeof(p_provider_evidence) <> 'object'
    or p_provider_evidence - array[
      'providerMessageId',
      'providerGroupId',
      'statusCode',
      'statusMessage',
      'observedAt',
      'requestKeyMatched'
    ]::text[] <> '{}'::jsonb
    or not p_provider_evidence ?& array[
      'statusCode',
      'statusMessage',
      'observedAt',
      'requestKeyMatched'
    ]::text[]
    or pg_catalog.jsonb_typeof(p_provider_evidence -> 'statusCode') <> 'string'
    or nullif(pg_catalog.btrim(p_provider_evidence ->> 'statusCode'), '') is null
    or pg_catalog.length(p_provider_evidence ->> 'statusCode') > 100
    or pg_catalog.jsonb_typeof(p_provider_evidence -> 'statusMessage') <> 'string'
    or nullif(pg_catalog.btrim(p_provider_evidence ->> 'statusMessage'), '') is null
    or pg_catalog.length(p_provider_evidence ->> 'statusMessage') > 500
    or pg_catalog.jsonb_typeof(p_provider_evidence -> 'observedAt') <> 'string'
    or pg_catalog.jsonb_typeof(p_provider_evidence -> 'requestKeyMatched') <> 'boolean'
    or (
      p_provider_evidence ? 'providerMessageId'
      and (
        pg_catalog.jsonb_typeof(p_provider_evidence -> 'providerMessageId') <> 'string'
        or nullif(pg_catalog.btrim(p_provider_evidence ->> 'providerMessageId'), '') is null
        or pg_catalog.length(p_provider_evidence ->> 'providerMessageId') > 200
      )
    )
    or (
      p_provider_evidence ? 'providerGroupId'
      and (
        pg_catalog.jsonb_typeof(p_provider_evidence -> 'providerGroupId') <> 'string'
        or nullif(pg_catalog.btrim(p_provider_evidence ->> 'providerGroupId'), '') is null
        or pg_catalog.length(p_provider_evidence ->> 'providerGroupId') > 200
      )
    ) then
    raise exception 'registration_customer_message_provider_evidence_invalid'
      using errcode = '22023';
  end if;

  begin
    v_observed_at := (p_provider_evidence ->> 'observedAt')::timestamptz;
  exception when others then
    raise exception 'registration_customer_message_provider_evidence_invalid'
      using errcode = '22023';
  end;

  if v_observed_at is null then
    raise exception 'registration_customer_message_provider_evidence_invalid'
      using errcode = '22023';
  end if;

  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'providerMessageId', nullif(pg_catalog.btrim(p_provider_evidence ->> 'providerMessageId'), ''),
    'providerGroupId', nullif(pg_catalog.btrim(p_provider_evidence ->> 'providerGroupId'), ''),
    'statusCode', pg_catalog.btrim(p_provider_evidence ->> 'statusCode'),
    'statusMessage', pg_catalog.btrim(p_provider_evidence ->> 'statusMessage'),
    'observedAt', v_observed_at,
    'requestKeyMatched', (p_provider_evidence ->> 'requestKeyMatched')::boolean
  ));
end;
$$;

alter function dashboard_private.registration_customer_message_provider_evidence_v1(jsonb)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_message_provider_evidence_v1(jsonb)
  from public, anon, authenticated, service_role;

create function dashboard_private.registration_customer_message_result_v1(
  p_message_id uuid,
  p_owner boolean,
  p_idempotent boolean,
  p_include_tokens boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_message public.ops_registration_customer_messages%rowtype;
begin
  select message.*
  into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id;

  if not found then
    raise exception 'registration_customer_message_not_found'
      using errcode = 'P0002';
  end if;

  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'ok', v_message.status = 'accepted',
    'messageId', v_message.id,
    'messageKind', v_message.message_kind,
    'currentStatus', v_message.status,
    'recipientLast4', v_message.recipient_last4,
    'confirmedAt', v_message.confirmed_at,
    'updatedAt', v_message.updated_at,
    'canCheck', (
      v_message.provider_attempt_count = 1
      and v_message.provider_attempt_started_at
        <= pg_catalog.clock_timestamp() - interval '15 minutes'
      and v_message.status in ('pending', 'unknown')
    ),
    'idempotent', p_idempotent,
    'owner', p_owner,
    'claimToken', case when p_include_tokens and p_owner then v_message.claim_token else null end,
    'dispatchToken', case when p_include_tokens and p_owner then v_message.dispatch_token else null end
  ));
end;
$$;

alter function dashboard_private.registration_customer_message_result_v1(uuid, boolean, boolean, boolean)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_message_result_v1(uuid, boolean, boolean, boolean)
  from public, anon, authenticated, service_role;

create function dashboard_private.registration_customer_message_assert_stored_contract_v1(
  p_message public.ops_registration_customer_messages,
  p_contract jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.registration_customer_message_assert_contract_v1(
    p_contract,
    p_message.message_kind
  );

  if p_contract ->> 'sourceFingerprint' <> p_message.source_fingerprint
    or p_contract ->> 'recipientHash' <> p_message.recipient_hash
    or p_contract ->> 'templateKey' <> p_message.template_key
    or (p_contract ->> 'templateRevision')::integer <> p_message.template_revision
    or p_contract ->> 'templateChecksum' <> p_message.template_checksum
    or p_contract ->> 'renderedVariablesChecksum' <> p_message.rendered_variables_checksum
    or p_contract ->> 'renderedBodyChecksum' <> p_message.rendered_body_checksum
    or p_contract ->> 'renderedButtonsChecksum' <> p_message.rendered_buttons_checksum then
    raise exception 'registration_customer_message_preview_stale'
      using errcode = '40001';
  end if;
end;
$$;

alter function dashboard_private.registration_customer_message_assert_stored_contract_v1(public.ops_registration_customer_messages, jsonb)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_message_assert_stored_contract_v1(public.ops_registration_customer_messages, jsonb)
  from public, anon, authenticated, service_role;

create function dashboard_private.registration_customer_message_assert_current_v1(
  p_message public.ops_registration_customer_messages,
  p_contract jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source_id uuid;
  v_source jsonb;
begin
  perform dashboard_private.registration_customer_message_assert_stored_contract_v1(
    p_message,
    p_contract
  );

  v_source_id := case
    when p_message.appointment_id is not null then p_message.appointment_id
    when p_message.track_id is not null then p_message.track_id
    else p_message.task_id
  end;
  v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl(
    p_message.message_kind,
    v_source_id
  );

  if p_contract ->> 'parentPhoneDigits' <> v_source ->> 'parentPhoneDigits'
    or p_message.source_revision is distinct from
      nullif(v_source ->> 'sourceRevision', '')::bigint
    or p_message.source_facts_checksum is distinct from
      dashboard_private.registration_customer_message_source_facts_checksum_v1(v_source) then
    raise exception 'registration_customer_message_preview_stale'
      using errcode = '40001';
  end if;
end;
$$;

alter function dashboard_private.registration_customer_message_assert_current_v1(public.ops_registration_customer_messages, jsonb)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_message_assert_current_v1(public.ops_registration_customer_messages, jsonb)
  from public, anon, authenticated, service_role;

create function dashboard_private.registration_customer_message_apply_admission_v1(
  p_message_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_message public.ops_registration_customer_messages%rowtype;
  v_occurred_at timestamptz := pg_catalog.clock_timestamp();
  v_field_name text;
begin
  select message.*
  into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id;

  if not found or v_message.message_kind <> 'admission_application'
    or v_message.status <> 'accepted' then
    return;
  end if;

  update public.ops_registration_details detail
  set admission_notice_sent = true,
      updated_at = v_occurred_at
  where detail.task_id = v_message.task_id
    and not detail.admission_notice_sent;

  v_field_name := 'registration_customer_message:' || v_message.id::text;
  insert into public.ops_task_events(
    task_id,
    actor_id,
    event_type,
    field_name,
    before_value,
    after_value,
    created_at
  )
  select
    v_message.task_id,
    v_message.confirmed_by,
    'customer_message_sent',
    v_field_name,
    null,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'eventType', 'customer_message_sent',
      'messageId', v_message.id,
      'messageKind', v_message.message_kind,
      'status', 'accepted',
      'occurredAt', v_occurred_at
    )::text,
    v_occurred_at
  where not exists (
    select 1
    from public.ops_task_events event
    where event.task_id = v_message.task_id
      and event.event_type = 'customer_message_sent'
      and event.field_name = v_field_name
  );
end;
$$;

alter function dashboard_private.registration_customer_message_apply_admission_v1(uuid)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_message_apply_admission_v1(uuid)
  from public, anon, authenticated, service_role;

create function public.resolve_registration_customer_message_source_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_source_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
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
  return dashboard_private.resolve_registration_customer_message_source_v1_impl(
    p_message_kind,
    p_source_id
  );
end;
$$;

alter function public.resolve_registration_customer_message_source_v1(uuid, text, uuid)
  owner to postgres;
revoke all on function public.resolve_registration_customer_message_source_v1(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_registration_customer_message_source_v1(uuid, text, uuid)
  to service_role;

create function public.create_registration_customer_message_preview_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_source_id uuid,
  p_contract jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_source jsonb;
  v_preview public.ops_registration_customer_message_previews%rowtype;
  v_created_at timestamptz := pg_catalog.clock_timestamp();
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
  perform dashboard_private.registration_customer_message_assert_contract_v1(
    p_contract,
    p_message_kind
  );
  v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl(
    p_message_kind,
    p_source_id
  );
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id,
    (v_source ->> 'taskId')::uuid,
    'send'
  );

  if p_contract ->> 'parentPhoneDigits' <> v_source ->> 'parentPhoneDigits' then
    raise exception 'registration_customer_message_preview_stale'
      using errcode = '40001';
  end if;

  insert into public.ops_registration_customer_message_previews(
    task_id,
    track_id,
    appointment_id,
    message_kind,
    source_fingerprint,
    source_facts_checksum,
    source_revision,
    recipient_hash,
    recipient_last4,
    template_key,
    template_revision,
    template_checksum,
    rendered_variables_checksum,
    rendered_body_checksum,
    rendered_buttons_checksum,
    created_by,
    created_at,
    expires_at
  ) values (
    (v_source ->> 'taskId')::uuid,
    nullif(v_source ->> 'trackId', '')::uuid,
    nullif(v_source ->> 'appointmentId', '')::uuid,
    p_message_kind,
    p_contract ->> 'sourceFingerprint',
    dashboard_private.registration_customer_message_source_facts_checksum_v1(v_source),
    nullif(v_source ->> 'sourceRevision', '')::bigint,
    p_contract ->> 'recipientHash',
    pg_catalog.right(p_contract ->> 'parentPhoneDigits', 4),
    p_message_kind,
    (p_contract ->> 'templateRevision')::integer,
    p_contract ->> 'templateChecksum',
    p_contract ->> 'renderedVariablesChecksum',
    p_contract ->> 'renderedBodyChecksum',
    p_contract ->> 'renderedButtonsChecksum',
    p_actor_profile_id,
    v_created_at,
    v_created_at + interval '15 minutes'
  )
  returning * into v_preview;

  return pg_catalog.jsonb_build_object(
    'previewId', v_preview.id,
    'expiresAt', v_preview.expires_at,
    'messageKind', v_preview.message_kind,
    'recipientLast4', v_preview.recipient_last4
  );
end;
$$;

alter function public.create_registration_customer_message_preview_v1(uuid, text, uuid, jsonb)
  owner to postgres;
revoke all on function public.create_registration_customer_message_preview_v1(uuid, text, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_registration_customer_message_preview_v1(uuid, text, uuid, jsonb)
  to service_role;

create function public.claim_registration_customer_message_v1(
  p_actor_profile_id uuid,
  p_preview_id uuid,
  p_request_key text,
  p_contract jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_preview public.ops_registration_customer_message_previews%rowtype;
  v_message public.ops_registration_customer_messages%rowtype;
  v_source jsonb;
  v_source_id uuid;
  v_dedupe_key text;
  v_claim_token uuid;
  v_dispatch_token uuid;
  v_consumed_at timestamptz;
begin
  if v_request_key is null
    or v_request_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'registration_customer_message_request_key_invalid'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-customer-message-request:' || v_request_key,
      0
    )
  );

  -- Exact replay lookup is executable logic and occurs before preview consumption.
  select message.*
  into v_message
  from public.ops_registration_customer_messages message
  where message.preview_id = p_preview_id
    and message.request_key = v_request_key
    and message.confirmed_by = p_actor_profile_id
  for update;

  if found then
    perform dashboard_private.registration_customer_message_assert_actor_v1(
      p_actor_profile_id,
      v_message.task_id,
      'send'
    );
    perform dashboard_private.registration_customer_message_assert_contract_v1(
      p_contract,
      v_message.message_kind
    );
    perform dashboard_private.registration_customer_message_assert_stored_contract_v1(
      v_message,
      p_contract
    );

    if v_message.status = 'pending'
      and v_message.provider_attempt_count = 1
      and v_message.provider_attempt_started_at is not null then
      update public.ops_registration_customer_messages message
      set status = 'unknown',
          claim_active = false,
          claim_token = null,
          claim_owner_id = null,
          claim_expires_at = null,
          claim_release_reason = 'marker_recovery',
          resolution_source = 'marker_recovery',
          resolved_by = null,
          resolved_at = pg_catalog.clock_timestamp()
      where message.id = v_message.id
      returning * into v_message;
      return dashboard_private.registration_customer_message_result_v1(
        v_message.id,
        false,
        true,
        false
      );
    end if;

    if v_message.status = 'pending'
      and v_message.provider_attempt_count = 0
      and v_message.provider_attempt_started_at is null then
      perform dashboard_private.registration_customer_message_assert_current_v1(
        v_message,
        p_contract
      );

      if not v_message.claim_active
        or v_message.claim_expires_at <= pg_catalog.clock_timestamp() then
        v_claim_token := gen_random_uuid();
        update public.ops_registration_customer_messages message
        set claim_active = true,
            claim_token = v_claim_token,
            claim_owner_id = p_actor_profile_id,
            claim_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes',
            claim_release_reason = null,
            error_code = null
        where message.id = v_message.id
          and message.status = 'pending'
          and message.provider_attempt_count = 0
          and message.provider_attempt_started_at is null
        returning * into v_message;
      end if;

      return dashboard_private.registration_customer_message_result_v1(
        v_message.id,
        true,
        true,
        true
      );
    end if;

    return dashboard_private.registration_customer_message_result_v1(
      v_message.id,
      false,
      true,
      false
    );
  end if;

  select message.*
  into v_message
  from public.ops_registration_customer_messages message
  where message.request_key = v_request_key
  for update;
  if found then
    raise exception 'registration_customer_message_request_key_conflict'
      using errcode = '23505';
  end if;

  select preview.*
  into v_preview
  from public.ops_registration_customer_message_previews preview
  where preview.id = p_preview_id
  for update;

  if not found then
    raise exception 'registration_customer_message_preview_not_found'
      using errcode = 'P0002';
  end if;
  if v_preview.created_by <> p_actor_profile_id then
    raise exception 'registration_customer_message_preview_owner_mismatch'
      using errcode = '42501';
  end if;
  if v_preview.consumed_at is not null then
    raise exception 'registration_customer_message_preview_consumed'
      using errcode = '23505';
  end if;
  if v_preview.expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'registration_customer_message_preview_expired'
      using errcode = '40001';
  end if;

  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id,
    v_preview.task_id,
    'send'
  );
  perform dashboard_private.registration_customer_message_assert_contract_v1(
    p_contract,
    v_preview.message_kind
  );

  if p_contract ->> 'sourceFingerprint' <> v_preview.source_fingerprint
    or p_contract ->> 'recipientHash' <> v_preview.recipient_hash
    or p_contract ->> 'templateKey' <> v_preview.template_key
    or (p_contract ->> 'templateRevision')::integer <> v_preview.template_revision
    or p_contract ->> 'templateChecksum' <> v_preview.template_checksum
    or p_contract ->> 'renderedVariablesChecksum' <> v_preview.rendered_variables_checksum
    or p_contract ->> 'renderedBodyChecksum' <> v_preview.rendered_body_checksum
    or p_contract ->> 'renderedButtonsChecksum' <> v_preview.rendered_buttons_checksum then
    raise exception 'registration_customer_message_preview_stale'
      using errcode = '40001';
  end if;

  v_source_id := case
    when v_preview.appointment_id is not null then v_preview.appointment_id
    when v_preview.track_id is not null then v_preview.track_id
    else v_preview.task_id
  end;
  v_dedupe_key := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(
      pg_catalog.jsonb_build_object(
        'messageKind', v_preview.message_kind,
        'sourceId', v_source_id,
        'sourceFingerprint', v_preview.source_fingerprint,
        'recipientHash', v_preview.recipient_hash
      )
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-customer-message-dedupe:' || v_dedupe_key,
      0
    )
  );

  select message.*
  into v_message
  from public.ops_registration_customer_messages message
  where message.dedupe_key = v_dedupe_key
  for update;
  if found then
    return dashboard_private.registration_customer_message_result_v1(
      v_message.id,
      false,
      false,
      false
    );
  end if;

  v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl(
    v_preview.message_kind,
    v_source_id
  );
  if p_contract ->> 'parentPhoneDigits' <> v_source ->> 'parentPhoneDigits'
    or v_preview.source_revision is distinct from
      nullif(v_source ->> 'sourceRevision', '')::bigint
    or v_preview.source_facts_checksum is distinct from
      dashboard_private.registration_customer_message_source_facts_checksum_v1(v_source) then
    raise exception 'registration_customer_message_preview_stale'
      using errcode = '40001';
  end if;

  v_claim_token := gen_random_uuid();
  v_dispatch_token := gen_random_uuid();
  begin
    insert into public.ops_registration_customer_messages(
      preview_id,
      task_id,
      track_id,
      appointment_id,
      message_kind,
      source_fingerprint,
      source_facts_checksum,
      source_revision,
      recipient_hash,
      recipient_last4,
      template_key,
      template_revision,
      template_checksum,
      rendered_variables_checksum,
      rendered_body_checksum,
      rendered_buttons_checksum,
      dedupe_key,
      request_key,
      status,
      claim_active,
      claim_token,
      claim_owner_id,
      claim_expires_at,
      dispatch_token,
      provider_attempt_count,
      confirmed_by
    ) values (
      v_preview.id,
      v_preview.task_id,
      v_preview.track_id,
      v_preview.appointment_id,
      v_preview.message_kind,
      v_preview.source_fingerprint,
      v_preview.source_facts_checksum,
      v_preview.source_revision,
      v_preview.recipient_hash,
      v_preview.recipient_last4,
      v_preview.template_key,
      v_preview.template_revision,
      v_preview.template_checksum,
      v_preview.rendered_variables_checksum,
      v_preview.rendered_body_checksum,
      v_preview.rendered_buttons_checksum,
      v_dedupe_key,
      v_request_key,
      'pending',
      true,
      v_claim_token,
      p_actor_profile_id,
      pg_catalog.clock_timestamp() + interval '5 minutes',
      v_dispatch_token,
      0,
      p_actor_profile_id
    )
    returning * into v_message;
  exception when unique_violation then
    select message.*
    into v_message
    from public.ops_registration_customer_messages message
    where message.dedupe_key = v_dedupe_key
    for update;
    if not found then
      raise exception 'registration_customer_message_request_key_conflict'
        using errcode = '23505';
    end if;
    return dashboard_private.registration_customer_message_result_v1(
      v_message.id,
      false,
      false,
      false
    );
  end;

  v_consumed_at := pg_catalog.clock_timestamp();
  update public.ops_registration_customer_message_previews preview
  set consumed_at = v_consumed_at
  where preview.id = v_preview.id
    and preview.consumed_at is null
    and preview.expires_at > v_consumed_at;
  if not found then
    raise exception 'registration_customer_message_preview_consumed'
      using errcode = '23505';
  end if;

  return dashboard_private.registration_customer_message_result_v1(
    v_message.id,
    true,
    false,
    true
  );
end;
$$;

alter function public.claim_registration_customer_message_v1(uuid, uuid, text, jsonb)
  owner to postgres;
revoke all on function public.claim_registration_customer_message_v1(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_registration_customer_message_v1(uuid, uuid, text, jsonb)
  to service_role;

create function public.release_registration_customer_message_pre_send_claim_v1(
  p_message_id uuid,
  p_claim_token uuid,
  p_error_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_error_code text := nullif(pg_catalog.btrim(p_error_code), '');
  v_message public.ops_registration_customer_messages%rowtype;
  v_actor_id uuid;
begin
  if v_error_code is null
    or pg_catalog.length(v_error_code) > 100
    or v_error_code !~ '^[a-z0-9_.:-]+$' then
    raise exception 'registration_customer_message_error_code_invalid'
      using errcode = '22023';
  end if;

  select message.*
  into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id
  for update;
  if not found then
    raise exception 'registration_customer_message_not_found'
      using errcode = 'P0002';
  end if;

  v_actor_id := coalesce(v_message.claim_owner_id, v_message.confirmed_by);
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    v_actor_id,
    v_message.task_id,
    'send'
  );

  if v_message.status <> 'pending'
    or v_message.provider_attempt_count <> 0
    or v_message.provider_attempt_started_at is not null
    or not v_message.claim_active
    or v_message.claim_token is distinct from p_claim_token then
    raise exception 'registration_customer_message_release_not_allowed'
      using errcode = '40001';
  end if;

  update public.ops_registration_customer_messages message
  set claim_active = false,
      claim_token = null,
      claim_owner_id = null,
      claim_expires_at = null,
      claim_release_reason = 'pre_send:' || v_error_code,
      error_code = v_error_code
  where message.id = v_message.id
    and message.status = 'pending'
    and message.provider_attempt_count = 0
    and message.provider_attempt_started_at is null
  returning * into v_message;

  return dashboard_private.registration_customer_message_result_v1(
    v_message.id,
    false,
    false,
    false
  );
end;
$$;

alter function public.release_registration_customer_message_pre_send_claim_v1(uuid, uuid, text)
  owner to postgres;
revoke all on function public.release_registration_customer_message_pre_send_claim_v1(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.release_registration_customer_message_pre_send_claim_v1(uuid, uuid, text)
  to service_role;

create function public.release_registration_customer_message_pre_send_claim_admin_v1(
  p_actor_profile_id uuid,
  p_message_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_message public.ops_registration_customer_messages%rowtype;
  v_mutation dashboard_private.ops_registration_mutations%rowtype;
  v_target jsonb;
  v_response jsonb;
begin
  if v_reason is null or pg_catalog.length(v_reason) > 500
    or v_request_key is null
    or v_request_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'registration_customer_message_admin_action_invalid'
      using errcode = '22023';
  end if;

  select message.*
  into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id
  for update;
  if not found then
    raise exception 'registration_customer_message_not_found'
      using errcode = 'P0002';
  end if;
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id,
    v_message.task_id,
    'admin'
  );

  v_target := pg_catalog.jsonb_build_object(
    'action', 'release_registration_customer_message_pre_send_claim_admin',
    'messageId', p_message_id,
    'reason', v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-customer-message-admin:' || p_actor_profile_id::text || ':' || v_request_key,
      0
    )
  );
  select mutation.*
  into v_mutation
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = p_actor_profile_id
    and mutation.request_key = v_request_key;
  if found then
    if v_mutation.mutation_type <> 'release_registration_customer_message_pre_send_claim_admin'
      or v_mutation.target_fingerprint is distinct from v_target then
      raise exception 'registration_customer_message_mutation_conflict'
        using errcode = '23505';
    end if;
    return v_mutation.response_payload;
  end if;

  if v_message.status <> 'pending'
    or v_message.provider_attempt_count <> 0
    or v_message.provider_attempt_started_at is not null
    or not v_message.claim_active
    or v_message.claim_expires_at > pg_catalog.clock_timestamp() then
    raise exception 'registration_customer_message_release_not_allowed'
      using errcode = '40001';
  end if;

  update public.ops_registration_customer_messages message
  set claim_active = false,
      claim_token = null,
      claim_owner_id = null,
      claim_expires_at = null,
      claim_release_reason = 'admin:' || v_reason,
      error_code = 'admin_pre_send_release'
  where message.id = v_message.id
    and message.status = 'pending'
    and message.provider_attempt_count = 0
    and message.provider_attempt_started_at is null
  returning * into v_message;

  v_response := dashboard_private.registration_customer_message_result_v1(
    v_message.id,
    false,
    false,
    false
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
    v_message.task_id,
    'release_registration_customer_message_pre_send_claim_admin',
    v_target,
    v_response
  );
  return v_response;
end;
$$;

alter function public.release_registration_customer_message_pre_send_claim_admin_v1(uuid, uuid, text, text)
  owner to postgres;
revoke all on function public.release_registration_customer_message_pre_send_claim_admin_v1(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.release_registration_customer_message_pre_send_claim_admin_v1(uuid, uuid, text, text)
  to service_role;

create function public.mark_registration_customer_message_attempt_started_v1(
  p_message_id uuid,
  p_claim_token uuid,
  p_dispatch_token uuid,
  p_contract jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_message public.ops_registration_customer_messages%rowtype;
  v_actor_id uuid;
  v_attempt_started_at timestamptz;
begin
  select message.*
  into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id
  for update;
  if not found then
    raise exception 'registration_customer_message_not_found'
      using errcode = 'P0002';
  end if;

  v_actor_id := coalesce(v_message.claim_owner_id, v_message.confirmed_by);
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    v_actor_id,
    v_message.task_id,
    'send'
  );
  perform dashboard_private.registration_customer_message_assert_contract_v1(
    p_contract,
    v_message.message_kind
  );
  perform dashboard_private.registration_customer_message_assert_stored_contract_v1(
    v_message,
    p_contract
  );

  if v_message.dispatch_token is distinct from p_dispatch_token
    or v_message.claim_token is distinct from p_claim_token then
    raise exception 'registration_customer_message_claim_invalid'
      using errcode = '42501';
  end if;

  if v_message.status <> 'pending'
    or v_message.provider_attempt_count = 1
    or v_message.provider_attempt_started_at is not null then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'messageId', v_message.id,
      'currentStatus', v_message.status
    );
  end if;

  if v_message.provider_attempt_count <> 0
    or not v_message.claim_active
    or v_message.claim_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'registration_customer_message_claim_invalid'
      using errcode = '40001';
  end if;

  perform dashboard_private.registration_customer_message_assert_current_v1(
    v_message,
    p_contract
  );
  v_attempt_started_at := pg_catalog.clock_timestamp();
  update public.ops_registration_customer_messages message
  set provider_attempt_count = 1,
      provider_attempt_started_at = v_attempt_started_at
  where message.id = v_message.id
    and message.status = 'pending'
    and message.provider_attempt_count = 0
    and message.provider_attempt_started_at is null
    and message.claim_active
    and message.claim_expires_at > v_attempt_started_at
    and message.claim_token = p_claim_token
    and message.dispatch_token = p_dispatch_token
  returning * into v_message;

  if not found then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'messageId', p_message_id,
      'currentStatus', 'pending'
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'messageId', v_message.id,
    'currentStatus', v_message.status,
    'dispatchToken', v_message.dispatch_token
  );
end;
$$;

alter function public.mark_registration_customer_message_attempt_started_v1(uuid, uuid, uuid, jsonb)
  owner to postgres;
revoke all on function public.mark_registration_customer_message_attempt_started_v1(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_registration_customer_message_attempt_started_v1(uuid, uuid, uuid, jsonb)
  to service_role;

create function public.finalize_registration_customer_message_v1(
  p_message_id uuid,
  p_dispatch_token uuid,
  p_result text,
  p_provider_result jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider_result jsonb;
  v_message public.ops_registration_customer_messages%rowtype;
begin
  if p_result not in ('accepted', 'failed_hold', 'unknown') then
    raise exception 'registration_customer_message_result_invalid'
      using errcode = '22023';
  end if;
  v_provider_result := dashboard_private.registration_customer_message_provider_evidence_v1(
    p_provider_result
  );

  select message.*
  into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id
  for update;
  if not found then
    raise exception 'registration_customer_message_not_found'
      using errcode = 'P0002';
  end if;
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    v_message.confirmed_by,
    v_message.task_id,
    'send'
  );

  if v_message.dispatch_token is distinct from p_dispatch_token
    or v_message.provider_attempt_count <> 1
    or v_message.provider_attempt_started_at is null then
    raise exception 'registration_customer_message_finalize_not_allowed'
      using errcode = '40001';
  end if;

  if v_message.status in ('accepted', 'failed_hold', 'unknown')
    and not (
      v_message.status = 'unknown'
      and v_message.resolution_source = 'marker_recovery'
    ) then
    if v_message.status = p_result
      and v_message.provider_evidence is not distinct from v_provider_result then
      return dashboard_private.registration_customer_message_result_v1(
        v_message.id,
        false,
        true,
        false
      );
    end if;
    raise exception 'registration_customer_message_finalize_conflict'
      using errcode = '40001';
  end if;

  update public.ops_registration_customer_messages message
  set status = p_result,
      claim_active = false,
      claim_token = null,
      claim_owner_id = null,
      claim_expires_at = null,
      claim_release_reason = null,
      provider_message_id = v_provider_result ->> 'providerMessageId',
      provider_group_id = v_provider_result ->> 'providerGroupId',
      provider_status_code = v_provider_result ->> 'statusCode',
      provider_status_message = v_provider_result ->> 'statusMessage',
      provider_evidence = v_provider_result,
      error_code = case when p_result = 'failed_hold' then 'provider_rejected' else null end,
      resolution_source = 'provider_send',
      resolved_by = null,
      resolved_at = pg_catalog.clock_timestamp()
  where message.id = v_message.id
    and message.dispatch_token = p_dispatch_token
    and message.provider_attempt_count = 1
  returning * into v_message;

  if p_result = 'accepted' and v_message.message_kind = 'admission_application' then
    perform dashboard_private.registration_customer_message_apply_admission_v1(v_message.id);
  end if;
  return dashboard_private.registration_customer_message_result_v1(
    v_message.id,
    false,
    false,
    false
  );
end;
$$;

alter function public.finalize_registration_customer_message_v1(uuid, uuid, text, jsonb)
  owner to postgres;
revoke all on function public.finalize_registration_customer_message_v1(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_registration_customer_message_v1(uuid, uuid, text, jsonb)
  to service_role;

create function public.list_registration_customer_messages_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_source_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_actor_role text;
  v_result jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'registration_customer_message_limit_invalid'
      using errcode = '22023';
  end if;
  v_task_id := dashboard_private.registration_customer_message_source_task_v1(
    p_message_kind,
    p_source_id
  );
  v_actor_role := dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id,
    v_task_id,
    'history'
  );

  if v_actor_role in ('admin', 'staff') then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'messageId', message.id,
          'messageKind', message.message_kind,
          'currentStatus', message.status,
          'confirmedAt', message.confirmed_at,
          'updatedAt', message.updated_at,
          'recipientLast4', message.recipient_last4,
          'canCheck', (
            message.provider_attempt_count = 1
            and message.provider_attempt_started_at
              <= pg_catalog.clock_timestamp() - interval '15 minutes'
            and message.status in ('pending', 'unknown')
          )
        ) order by message.created_at desc, message.id desc
      ),
      '[]'::jsonb
    )
    into v_result
    from (
      select outbox.*
      from public.ops_registration_customer_messages outbox
      where outbox.task_id = v_task_id
        and outbox.message_kind = p_message_kind
        and (
          outbox.appointment_id = p_source_id
          or outbox.track_id = p_source_id
          or (
            p_message_kind = 'admission_application'
            and outbox.task_id = p_source_id
          )
        )
      order by outbox.created_at desc, outbox.id desc
      limit p_limit
    ) message;
  else
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'messageKind', message.message_kind,
          'currentStatus', message.status,
          'confirmedAt', message.confirmed_at,
          'updatedAt', message.updated_at
        ) order by message.created_at desc, message.id desc
      ),
      '[]'::jsonb
    )
    into v_result
    from (
      select outbox.*
      from public.ops_registration_customer_messages outbox
      where outbox.task_id = v_task_id
        and outbox.message_kind = p_message_kind
        and (
          outbox.appointment_id = p_source_id
          or outbox.track_id = p_source_id
          or (
            p_message_kind = 'admission_application'
            and outbox.task_id = p_source_id
          )
        )
      order by outbox.created_at desc, outbox.id desc
      limit p_limit
    ) message;
  end if;
  return v_result;
end;
$$;

alter function public.list_registration_customer_messages_v1(uuid, text, uuid, integer)
  owner to postgres;
revoke all on function public.list_registration_customer_messages_v1(uuid, text, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_registration_customer_messages_v1(uuid, text, uuid, integer)
  to service_role;

create function public.record_registration_customer_message_provider_check_v1(
  p_actor_profile_id uuid,
  p_message_id uuid,
  p_resolution text,
  p_provider_evidence jsonb,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_message public.ops_registration_customer_messages%rowtype;
  v_provider_evidence jsonb;
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
begin
  select message.*
  into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id
  for update;
  if not found then
    raise exception 'registration_customer_message_not_found'
      using errcode = 'P0002';
  end if;
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id,
    v_message.task_id,
    'send'
  );

  -- The same service-only signature provides the server with lookup context.
  -- Browser input still contains only messageId and this branch is never public.
  if p_resolution = 'lookup_context' then
    if coalesce(p_provider_evidence, '{}'::jsonb) <> '{}'::jsonb
      or v_request_key is not null
      or v_message.provider_attempt_count <> 1
      or v_message.status not in ('pending', 'unknown')
      or v_message.provider_attempt_started_at
        > pg_catalog.clock_timestamp() - interval '15 minutes' then
      raise exception 'registration_customer_message_provider_check_not_allowed'
        using errcode = '40001';
    end if;
    return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'messageId', v_message.id,
      'providerMessageId', v_message.provider_message_id,
      'providerGroupId', v_message.provider_group_id,
      'requestKey', v_message.request_key
    ));
  end if;

  if p_resolution not in ('accepted', 'failed_hold') then
    raise exception 'registration_customer_message_resolution_invalid'
      using errcode = '22023';
  end if;
  v_provider_evidence := dashboard_private.registration_customer_message_provider_evidence_v1(
    p_provider_evidence
  );
  if v_request_key is distinct from v_message.request_key
    or coalesce((v_provider_evidence ->> 'requestKeyMatched')::boolean, false) is not true then
    raise exception 'registration_customer_message_provider_check_mismatch'
      using errcode = '40001';
  end if;
  if v_message.provider_attempt_count <> 1
    or v_message.provider_attempt_started_at is null
    or v_message.provider_attempt_started_at
      > pg_catalog.clock_timestamp() - interval '15 minutes'
    or v_message.status not in ('unknown', 'pending') then
    raise exception 'registration_customer_message_provider_check_not_allowed'
      using errcode = '40001';
  end if;

  update public.ops_registration_customer_messages message
  set status = p_resolution,
      claim_active = false,
      claim_token = null,
      claim_owner_id = null,
      claim_expires_at = null,
      claim_release_reason = null,
      provider_message_id = v_provider_evidence ->> 'providerMessageId',
      provider_group_id = v_provider_evidence ->> 'providerGroupId',
      provider_status_code = v_provider_evidence ->> 'statusCode',
      provider_status_message = v_provider_evidence ->> 'statusMessage',
      provider_evidence = v_provider_evidence,
      error_code = case when p_resolution = 'failed_hold' then 'provider_check_rejected' else null end,
      resolution_source = 'provider_check',
      resolved_by = p_actor_profile_id,
      resolved_at = pg_catalog.clock_timestamp()
  where message.id = v_message.id
    and message.provider_attempt_count = 1
    and message.status in ('unknown', 'pending')
  returning * into v_message;

  if p_resolution = 'accepted' and v_message.message_kind = 'admission_application' then
    perform dashboard_private.registration_customer_message_apply_admission_v1(v_message.id);
  end if;
  return dashboard_private.registration_customer_message_result_v1(
    v_message.id,
    false,
    false,
    false
  );
end;
$$;

alter function public.record_registration_customer_message_provider_check_v1(uuid, uuid, text, jsonb, text)
  owner to postgres;
revoke all on function public.record_registration_customer_message_provider_check_v1(uuid, uuid, text, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_registration_customer_message_provider_check_v1(uuid, uuid, text, jsonb, text)
  to service_role;

create function public.reconcile_registration_customer_message_v1(
  p_actor_profile_id uuid,
  p_message_id uuid,
  p_resolution text,
  p_provider_evidence jsonb,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_message public.ops_registration_customer_messages%rowtype;
  v_provider_evidence jsonb;
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_target jsonb;
  v_response jsonb;
  v_mutation dashboard_private.ops_registration_mutations%rowtype;
begin
  if p_resolution not in ('accepted', 'failed_hold') then
    raise exception 'registration_customer_message_resolution_invalid'
      using errcode = '22023';
  end if;
  if v_reason is null or pg_catalog.length(v_reason) > 500
    or v_request_key is null
    or v_request_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'registration_customer_message_admin_action_invalid'
      using errcode = '22023';
  end if;
  v_provider_evidence := dashboard_private.registration_customer_message_provider_evidence_v1(
    p_provider_evidence
  );
  if coalesce((v_provider_evidence ->> 'requestKeyMatched')::boolean, false) is not true then
    raise exception 'registration_customer_message_provider_check_mismatch'
      using errcode = '40001';
  end if;

  select message.*
  into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id
  for update;
  if not found then
    raise exception 'registration_customer_message_not_found'
      using errcode = 'P0002';
  end if;
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id,
    v_message.task_id,
    'admin'
  );

  v_target := pg_catalog.jsonb_build_object(
    'action', 'reconcile_registration_customer_message',
    'messageId', p_message_id,
    'resolution', p_resolution,
    'providerEvidence', v_provider_evidence,
    'reason', v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-customer-message-admin:' || p_actor_profile_id::text || ':' || v_request_key,
      0
    )
  );
  select mutation.*
  into v_mutation
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = p_actor_profile_id
    and mutation.request_key = v_request_key;
  if found then
    if v_mutation.mutation_type <> 'reconcile_registration_customer_message'
      or v_mutation.target_fingerprint is distinct from v_target then
      raise exception 'registration_customer_message_mutation_conflict'
        using errcode = '23505';
    end if;
    return v_mutation.response_payload;
  end if;

  if v_message.provider_attempt_count <> 1
    or v_message.provider_attempt_started_at is null
    or v_message.status not in ('unknown', 'failed_hold') then
    raise exception 'registration_customer_message_reconcile_not_allowed'
      using errcode = '40001';
  end if;

  update public.ops_registration_customer_messages message
  set status = p_resolution,
      claim_active = false,
      claim_token = null,
      claim_owner_id = null,
      claim_expires_at = null,
      claim_release_reason = null,
      provider_message_id = v_provider_evidence ->> 'providerMessageId',
      provider_group_id = v_provider_evidence ->> 'providerGroupId',
      provider_status_code = v_provider_evidence ->> 'statusCode',
      provider_status_message = v_provider_evidence ->> 'statusMessage',
      provider_evidence = v_provider_evidence,
      error_code = case when p_resolution = 'failed_hold' then 'admin_reconciled_failure' else null end,
      resolution_source = 'admin_reconcile',
      resolved_by = p_actor_profile_id,
      resolved_at = pg_catalog.clock_timestamp()
  where message.id = v_message.id
    and message.provider_attempt_count = 1
    and message.status in ('unknown', 'failed_hold')
  returning * into v_message;

  if p_resolution = 'accepted' and v_message.message_kind = 'admission_application' then
    perform dashboard_private.registration_customer_message_apply_admission_v1(v_message.id);
  end if;
  v_response := dashboard_private.registration_customer_message_result_v1(
    v_message.id,
    false,
    false,
    false
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
    v_message.task_id,
    'reconcile_registration_customer_message',
    v_target,
    v_response
  );
  return v_response;
end;
$$;

alter function public.reconcile_registration_customer_message_v1(uuid, uuid, text, jsonb, text, text)
  owner to postgres;
revoke all on function public.reconcile_registration_customer_message_v1(uuid, uuid, text, jsonb, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_registration_customer_message_v1(uuid, uuid, text, jsonb, text, text)
  to service_role;

commit;
