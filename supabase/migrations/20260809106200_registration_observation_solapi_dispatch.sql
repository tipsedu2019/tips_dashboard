begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- The public runtime-version contract is authenticated-user scoped in the
-- core schema. Provider-capable service-role definers must re-read that same
-- source of truth without manufacturing an end-user identity.
create or replace function dashboard_private.registration_observation_runtime_version_impl()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_version integer;
begin
  if (select auth.role()) <> 'service_role' and (
    v_actor is null
    or not exists (
      select 1
      from public.profiles profile
      join auth.users account on account.id = profile.id
      where profile.id = v_actor
        and account.deleted_at is null
        and (account.banned_until is null or account.banned_until <= pg_catalog.now())
    )
  ) then
    raise exception 'registration_observation_runtime_access_denied'
      using errcode = '42501';
  end if;

  select setting.activation_version
  into strict v_version
  from dashboard_private.registration_observation_runtime_settings setting
  where setting.singleton = true;
  return v_version;
end;
$$;

alter function dashboard_private.registration_observation_runtime_version_impl()
  owner to postgres;
revoke all on function dashboard_private.registration_observation_runtime_version_impl()
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.registration_observation_runtime_version_impl()
  to authenticated;

-- Keep the proven five-kind implementations as ungranted private capabilities.
-- The public names below become explicit service-role capabilities with
-- observation-aware branches.
alter function dashboard_private.registration_customer_message_source_task_v1(text, uuid)
  rename to registration_customer_message_source_task_pre_observation_v1;
alter function dashboard_private.resolve_registration_customer_message_source_v1_impl(text, uuid)
  rename to resolve_registration_customer_message_source_pre_observation_v1;
alter function dashboard_private.registration_customer_message_assert_current_v1(
  public.ops_registration_customer_messages, jsonb
) rename to registration_customer_message_assert_current_pre_observation_v1;
alter function dashboard_private.registration_customer_message_result_v1(
  uuid, boolean, boolean, boolean
) rename to registration_customer_message_result_pre_observation_v1;

revoke all on function dashboard_private.registration_customer_message_source_task_pre_observation_v1(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.resolve_registration_customer_message_source_pre_observation_v1(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_customer_message_assert_current_pre_observation_v1(
  public.ops_registration_customer_messages, jsonb
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_customer_message_result_pre_observation_v1(
  uuid, boolean, boolean, boolean
) from public, anon, authenticated, service_role;

create function dashboard_private.registration_customer_message_stored_source_id_v1(
  p_observation_id uuid,
  p_appointment_id uuid,
  p_track_id uuid,
  p_task_id uuid
)
returns uuid
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;
  return coalesce(p_observation_id, p_appointment_id, p_track_id, p_task_id);
end;
$$;

alter function dashboard_private.registration_customer_message_stored_source_id_v1(
  uuid, uuid, uuid, uuid
) owner to postgres;
revoke all on function dashboard_private.registration_customer_message_stored_source_id_v1(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

-- Once a provider-capable marker exists, current source eligibility is no
-- longer the authority for recording the outcome. Validate the immutable
-- message receipt and its captured observation ownership instead. This keeps
-- terminal or superseded source state from erasing an already-started attempt
-- while still rejecting a row spliced onto another task or observation.
create function dashboard_private.registration_customer_message_assert_stored_observation_v1(
  p_message public.ops_registration_customer_messages
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;
  if p_message.message_kind not in ('observation_booking', 'observation_reminder')
    or not exists (
      select 1
      from public.ops_registration_customer_messages message
      join public.ops_registration_observations observation
        on observation.id = message.observation_id
      join public.ops_registration_appointments appointment
        on appointment.id = message.appointment_id
      join public.ops_registration_subject_tracks track
        on track.id = message.track_id
      where message.id = p_message.id
        and message.preview_id is not distinct from p_message.preview_id
        and message.task_id = p_message.task_id
        and message.track_id = p_message.track_id
        and message.appointment_id = p_message.appointment_id
        and message.observation_id = p_message.observation_id
        and message.message_kind = p_message.message_kind
        and message.source_revision = p_message.source_revision
        and message.source_fingerprint = p_message.source_fingerprint
        and message.source_facts_checksum = p_message.source_facts_checksum
        and message.recipient_hash = p_message.recipient_hash
        and message.template_key = p_message.template_key
        and message.template_revision = p_message.template_revision
        and message.template_checksum = p_message.template_checksum
        and message.rendered_variables_checksum = p_message.rendered_variables_checksum
        and message.rendered_body_checksum = p_message.rendered_body_checksum
        and message.rendered_buttons_checksum = p_message.rendered_buttons_checksum
        and message.dedupe_key = p_message.dedupe_key
        and message.request_key = p_message.request_key
        and message.delivery_origin = p_message.delivery_origin
        and message.scheduled_job_id is not distinct from p_message.scheduled_job_id
        and message.scheduled_source_identity is not distinct from p_message.scheduled_source_identity
        and observation.task_id = p_message.task_id
        and observation.track_id = p_message.track_id
        and observation.appointment_id = p_message.appointment_id
        and appointment.task_id = p_message.task_id
        and appointment.kind = 'observation_class'
        and track.task_id = p_message.task_id
        and track.subject = observation.subject
        and (
          (
            message.delivery_origin = 'manual'
            and message.confirmed_by is not null
            and exists (
              select 1
              from public.ops_registration_customer_message_previews preview
              where message.preview_id = p_message.preview_id
                and preview.id = message.preview_id
                and preview.created_by = message.confirmed_by
                and preview.task_id = message.task_id
                and preview.track_id = message.track_id
                and preview.appointment_id = message.appointment_id
                and preview.observation_id = message.observation_id
                and preview.message_kind = message.message_kind
                and preview.source_revision = message.source_revision
                and preview.source_fingerprint = p_message.source_fingerprint
                and preview.source_facts_checksum = message.source_facts_checksum
                and preview.recipient_hash = message.recipient_hash
                and preview.template_key = message.template_key
                and preview.template_revision = message.template_revision
                and preview.template_checksum = message.template_checksum
                and preview.rendered_variables_checksum = message.rendered_variables_checksum
                and preview.rendered_body_checksum = message.rendered_body_checksum
                and preview.rendered_buttons_checksum = message.rendered_buttons_checksum
                and preview.consumed_at is not null
            )
            and exists (
              select 1
              from dashboard_private.registration_observation_domain_events event
              where event.observation_id = message.observation_id
                and event.appointment_id = message.appointment_id
                and event.notification_revision = p_message.source_revision
                and event.event_kind in ('observation_scheduled', 'observation_rescheduled')
            )
          )
          or (
            message.delivery_origin = 'scheduled'
            and message.confirmed_by is null
            and exists (
              select 1
              from dashboard_private.registration_customer_reminder_jobs job
              join dashboard_private.registration_observation_domain_events event
                on event.event_id = job.source_event_id
              where job.job_id = message.scheduled_job_id
                and job.message_id = message.id
                and job.task_id = message.task_id
                and job.appointment_id = message.appointment_id
                and job.observation_id = message.observation_id
                and job.message_kind = message.message_kind
                and job.source_revision = message.source_revision
                and job.source_identity = message.scheduled_source_identity
                and event.observation_id = message.observation_id
                and event.appointment_id = message.appointment_id
                and event.notification_revision = p_message.source_revision
                and event.event_kind in ('observation_scheduled', 'observation_rescheduled')
            )
          )
        )
    )
  then
    raise exception 'registration_customer_message_stored_identity_invalid'
      using errcode = '40001';
  end if;
end;
$$;

alter function dashboard_private.registration_customer_message_assert_stored_observation_v1(
  public.ops_registration_customer_messages
) owner to postgres;
revoke all on function dashboard_private.registration_customer_message_assert_stored_observation_v1(
  public.ops_registration_customer_messages
) from public, anon, authenticated, service_role;

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
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;
  if p_message_kind in ('observation_booking', 'observation_reminder') then
    select observation.task_id
    into v_task_id
    from public.ops_registration_observations observation
    where observation.id = p_source_id;
    if v_task_id is null then
      raise exception 'registration_customer_message_source_invalid'
        using errcode = '22023';
    end if;
    return v_task_id;
  end if;
  return dashboard_private.registration_customer_message_source_task_pre_observation_v1(
    p_message_kind,
    p_source_id
  );
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
  v_observation public.ops_registration_observations%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_class public.classes%rowtype;
  v_classroom public.classroom_catalogs%rowtype;
  v_current jsonb;
  v_phone_digits text;
  v_latest_notification_revision integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;
  if p_message_kind not in ('observation_booking', 'observation_reminder') then
    return dashboard_private.resolve_registration_customer_message_source_pre_observation_v1(
      p_message_kind,
      p_source_id
    );
  end if;

  select observation.*
  into v_observation
  from public.ops_registration_observations observation
  where observation.id = p_source_id
  for share;
  if not found or v_observation.status <> 'scheduled' then
    raise exception 'registration_customer_message_source_ineligible'
      using errcode = '22023';
  end if;

  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = v_observation.appointment_id
    and appointment.task_id = v_observation.task_id
    and appointment.kind = 'observation_class'
    and appointment.status = 'scheduled'
    and appointment.scheduled_at > pg_catalog.clock_timestamp()
  for share;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_observation.track_id
    and track.task_id = v_observation.task_id
    and track.subject = v_observation.subject
  for share;
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_observation.task_id
    and task.type = 'registration'
    and nullif(pg_catalog.btrim(task.student_name), '') is not null
  for share;
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_observation.task_id
  for share;
  select class.*
  into v_class
  from public.classes class
  where class.id = v_observation.class_id
    and class.subject = v_observation.subject
    and class.closed_at is null
  for share;
  select classroom.*
  into v_classroom
  from public.classroom_catalogs classroom
  where classroom.id = v_observation.classroom_catalog_id
    and classroom.is_visible
    and classroom.campus in ('본관', '별관')
  for share;

  if v_appointment.id is null
    or v_track.id is null
    or v_task.id is null
    or v_detail.task_id is null
    or v_class.id is null
    or v_classroom.id is null
    or v_appointment.scheduled_at is distinct from v_observation.starts_at
    or v_appointment.place is distinct from v_observation.campus
    or v_classroom.campus is distinct from v_observation.campus
    or v_class.name is distinct from v_observation.class_name_snapshot
  then
    raise exception 'registration_customer_message_source_ineligible'
      using errcode = '22023';
  end if;

  select event.notification_revision
  into v_latest_notification_revision
  from dashboard_private.registration_observation_domain_events event
  where event.observation_id = v_observation.id
    and event.appointment_id = v_appointment.id
    and event.event_kind in ('observation_scheduled', 'observation_rescheduled')
  order by event.occurred_at desc, event.event_id desc
  limit 1;
  if v_latest_notification_revision is distinct from v_appointment.notification_revision then
    raise exception 'registration_customer_message_source_ineligible'
      using errcode = '22023';
  end if;

  begin
    v_current := dashboard_private.resolve_registration_observation_session_v1(
      v_observation.track_id,
      v_observation.class_id,
      v_observation.session_authority,
      v_observation.class_lesson_session_id,
      v_observation.legacy_session_key
    );
  exception
    when sqlstate '22023' or sqlstate 'P0002' then
      raise exception 'registration_customer_message_source_ineligible'
        using errcode = '22023';
  end;

  if v_observation.booking_fact_hash is distinct from v_current ->> 'bookingFactHash' then
    raise exception 'registration_customer_reminder_booking_fact_changed'
      using errcode = '40001';
  end if;
  if (v_current ->> 'classId')::uuid is distinct from v_observation.class_id
    or v_current ->> 'subject' is distinct from v_observation.subject
    or (v_current ->> 'startsAt')::timestamptz is distinct from v_observation.starts_at
    or (v_current ->> 'classroomCatalogId')::uuid is distinct from v_observation.classroom_catalog_id
    or v_current ->> 'className' is distinct from v_observation.class_name_snapshot
    or v_current ->> 'campus' is distinct from v_observation.campus
  then
    raise exception 'registration_customer_message_source_ineligible'
      using errcode = '22023';
  end if;

  v_phone_digits := pg_catalog.regexp_replace(
    coalesce(v_detail.parent_phone, ''),
    '[^0-9]',
    '',
    'g'
  );
  if v_phone_digits !~ '^01(0|1|[6-9])[0-9]{7,8}$' then
    raise exception 'registration_customer_message_source_ineligible'
      using errcode = '22023';
  end if;

  return pg_catalog.jsonb_build_object(
    'messageKind', p_message_kind,
    'sourceId', v_observation.id,
    'taskId', v_observation.task_id,
    'trackId', v_observation.track_id,
    'observationId', v_observation.id,
    'appointmentId', v_observation.appointment_id,
    'sourceRevision', v_appointment.notification_revision,
    'sessionSourceRevision', v_current -> 'sourceRevision',
    'bookingFactHash', v_current ->> 'bookingFactHash',
    'studentName', pg_catalog.btrim(v_task.student_name),
    'parentPhoneDigits', v_phone_digits,
    'subject', v_observation.subject,
    'className', v_current ->> 'className',
    'scheduledAt', (v_current ->> 'startsAt')::timestamptz,
    'place', v_current ->> 'classroomName',
    'campus', v_classroom.campus,
    'teacherName', v_current ->> 'teacherName'
  );
end;
$$;

alter function dashboard_private.resolve_registration_customer_message_source_v1_impl(text, uuid)
  owner to postgres;
revoke all on function dashboard_private.resolve_registration_customer_message_source_v1_impl(text, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.resolve_registration_customer_message_source_v1(
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
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;
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
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;
  if p_message.message_kind not in ('observation_booking', 'observation_reminder') then
    perform dashboard_private.registration_customer_message_assert_current_pre_observation_v1(
      p_message,
      p_contract
    );
    return;
  end if;
  perform dashboard_private.registration_customer_message_assert_stored_contract_v1(
    p_message,
    p_contract
  );
  v_source_id := dashboard_private.registration_customer_message_stored_source_id_v1(
    p_message.observation_id,
    p_message.appointment_id,
    p_message.track_id,
    p_message.task_id
  );
  v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl(
    p_message.message_kind,
    v_source_id
  );
  if p_contract ->> 'parentPhoneDigits' is distinct from v_source ->> 'parentPhoneDigits'
    or p_message.source_revision is distinct from nullif(v_source ->> 'sourceRevision', '')::bigint
    or p_message.source_facts_checksum is distinct from
      dashboard_private.registration_customer_message_source_facts_checksum_v1(v_source)
  then
    raise exception 'registration_customer_message_preview_stale'
      using errcode = '40001';
  end if;
end;
$$;

alter function dashboard_private.registration_customer_message_assert_current_v1(
  public.ops_registration_customer_messages, jsonb
) owner to postgres;
revoke all on function dashboard_private.registration_customer_message_assert_current_v1(
  public.ops_registration_customer_messages, jsonb
) from public, anon, authenticated, service_role;

create function dashboard_private.registration_customer_message_result_v1(
  p_message_id uuid,
  p_allowed boolean,
  p_idempotent boolean,
  p_claim_owned boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_message public.ops_registration_customer_messages%rowtype;
  v_result jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;
  select message.*
  into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id;
  if not found then
    raise exception 'registration_customer_message_not_found'
      using errcode = 'P0002';
  end if;
  v_result := dashboard_private.registration_customer_message_result_pre_observation_v1(
    p_message_id,
    p_allowed,
    p_idempotent,
    p_claim_owned
  );
  if v_message.message_kind in ('observation_booking', 'observation_reminder') then
    perform dashboard_private.registration_customer_message_assert_stored_observation_v1(
      v_message
    );
    v_result := v_result || pg_catalog.jsonb_build_object(
      'sourceId', v_message.observation_id,
      'observationId', v_message.observation_id
    );
  end if;
  return v_result;
end;
$$;

alter function dashboard_private.registration_customer_message_result_v1(
  uuid, boolean, boolean, boolean
) owner to postgres;
revoke all on function dashboard_private.registration_customer_message_result_v1(
  uuid, boolean, boolean, boolean
) from public, anon, authenticated, service_role;

alter function public.create_registration_customer_message_preview_v1(uuid, text, uuid, jsonb)
  rename to create_registration_customer_message_preview_pre_observation_v1;
alter function public.create_registration_customer_message_preview_pre_observation_v1(uuid, text, uuid, jsonb)
  set schema dashboard_private;
alter function public.claim_registration_customer_message_v1(uuid, uuid, text, jsonb)
  rename to claim_registration_customer_message_pre_observation_v1;
alter function public.claim_registration_customer_message_pre_observation_v1(uuid, uuid, text, jsonb)
  set schema dashboard_private;
alter function public.release_registration_customer_message_pre_send_claim_v1(uuid, uuid, text)
  rename to release_registration_customer_message_pre_send_claim_legacy_v1;
alter function public.release_registration_customer_message_pre_send_claim_legacy_v1(uuid, uuid, text)
  set schema dashboard_private;
alter function public.release_registration_customer_message_pre_send_claim_admin_v1(uuid, uuid, text, text)
  rename to release_reg_customer_msg_claim_admin_legacy_v1;
alter function public.release_reg_customer_msg_claim_admin_legacy_v1(uuid, uuid, text, text)
  set schema dashboard_private;
alter function public.mark_registration_customer_message_attempt_started_v1(uuid, uuid, uuid, jsonb)
  rename to mark_registration_customer_message_attempt_started_legacy_v1;
alter function public.mark_registration_customer_message_attempt_started_legacy_v1(uuid, uuid, uuid, jsonb)
  set schema dashboard_private;
alter function public.finalize_registration_customer_message_v1(uuid, uuid, text, jsonb)
  rename to finalize_registration_customer_message_pre_observation_v1;
alter function public.finalize_registration_customer_message_pre_observation_v1(uuid, uuid, text, jsonb)
  set schema dashboard_private;
alter function public.read_registration_customer_message_preview_target_v1(uuid, uuid)
  rename to read_registration_customer_message_preview_target_legacy_v1;
alter function public.read_registration_customer_message_preview_target_legacy_v1(uuid, uuid)
  set schema dashboard_private;
alter function public.list_registration_customer_messages_v1(uuid, text, uuid, integer)
  rename to list_registration_customer_messages_pre_observation_v1;
alter function public.list_registration_customer_messages_pre_observation_v1(uuid, text, uuid, integer)
  set schema dashboard_private;
alter function public.record_registration_customer_message_provider_check_v1(uuid, uuid, text, jsonb, text)
  rename to record_registration_customer_message_provider_check_legacy_v1;
alter function public.record_registration_customer_message_provider_check_legacy_v1(uuid, uuid, text, jsonb, text)
  set schema dashboard_private;
alter function public.reconcile_registration_customer_message_v1(uuid, uuid, text, jsonb, text, text)
  rename to reconcile_registration_customer_message_pre_observation_v1;
alter function public.reconcile_registration_customer_message_pre_observation_v1(uuid, uuid, text, jsonb, text, text)
  set schema dashboard_private;

revoke all on function dashboard_private.create_registration_customer_message_preview_pre_observation_v1(uuid, text, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.claim_registration_customer_message_pre_observation_v1(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.release_registration_customer_message_pre_send_claim_legacy_v1(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.release_reg_customer_msg_claim_admin_legacy_v1(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.mark_registration_customer_message_attempt_started_legacy_v1(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.finalize_registration_customer_message_pre_observation_v1(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.read_registration_customer_message_preview_target_legacy_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.list_registration_customer_messages_pre_observation_v1(uuid, text, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.record_registration_customer_message_provider_check_legacy_v1(uuid, uuid, text, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.reconcile_registration_customer_message_pre_observation_v1(uuid, uuid, text, jsonb, text, text)
  from public, anon, authenticated, service_role;

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
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;
  v_task_id := dashboard_private.registration_customer_message_source_task_v1(
    p_message_kind,
    p_source_id
  );
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id,
    v_task_id,
    'send'
  );
  if p_message_kind not in ('observation_booking', 'observation_reminder') then
    return dashboard_private.create_registration_customer_message_preview_pre_observation_v1(
      p_actor_profile_id,
      p_message_kind,
      p_source_id,
      p_contract
    );
  end if;
  perform dashboard_private.registration_customer_message_assert_contract_v1(
    p_contract,
    p_message_kind
  );
  v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl(
    p_message_kind,
    p_source_id
  );
  if p_contract ->> 'parentPhoneDigits' is distinct from v_source ->> 'parentPhoneDigits' then
    raise exception 'registration_customer_message_preview_stale'
      using errcode = '40001';
  end if;
  insert into public.ops_registration_customer_message_previews(
    task_id,
    track_id,
    appointment_id,
    observation_id,
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
    (v_source ->> 'trackId')::uuid,
    (v_source ->> 'appointmentId')::uuid,
    (v_source ->> 'observationId')::uuid,
    p_message_kind,
    p_contract ->> 'sourceFingerprint',
    dashboard_private.registration_customer_message_source_facts_checksum_v1(v_source),
    (v_source ->> 'sourceRevision')::bigint,
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
  ) returning * into v_preview;
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
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied'
      using errcode = '42501';
  end if;
  select preview.*
  into v_preview
  from public.ops_registration_customer_message_previews preview
  where preview.id = p_preview_id;
  if found and v_preview.message_kind not in ('observation_booking', 'observation_reminder') then
    perform dashboard_private.registration_customer_message_assert_actor_v1(
      p_actor_profile_id,
      v_preview.task_id,
      'send'
    );
    return dashboard_private.claim_registration_customer_message_pre_observation_v1(
      p_actor_profile_id,
      p_preview_id,
      p_request_key,
      p_contract
    );
  end if;
  if v_request_key is null
    or v_request_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'registration_customer_message_request_key_invalid'
      using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-customer-message-request:' || v_request_key, 0)
  );

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
      and v_message.provider_attempt_count = 0
      and v_message.provider_attempt_started_at is null
    then
      perform dashboard_private.registration_customer_message_assert_current_v1(v_message, p_contract);
      if not v_message.claim_active
        or v_message.claim_expires_at <= pg_catalog.clock_timestamp()
      then
        v_claim_token := gen_random_uuid();
        update public.ops_registration_customer_messages message
        set claim_active = true,
            claim_token = v_claim_token,
            claim_owner_id = p_actor_profile_id,
            claim_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes',
            claim_release_reason = null,
            error_code = null
        where message.id = v_message.id
        returning * into v_message;
      end if;
      return dashboard_private.registration_customer_message_result_v1(
        v_message.id, true, true, true
      );
    end if;
    return dashboard_private.registration_customer_message_result_v1(
      v_message.id, false, true, false
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
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id,
    v_preview.task_id,
    'send'
  );
  if v_preview.message_kind = 'observation_reminder' then
    raise exception 'registration_customer_message_delivery_origin_invalid'
      using errcode = '22023';
  end if;
  if v_preview.message_kind <> 'observation_booking'
    or v_preview.consumed_at is not null
    or v_preview.expires_at <= pg_catalog.clock_timestamp()
  then
    raise exception 'registration_customer_message_preview_stale'
      using errcode = '40001';
  end if;
  perform dashboard_private.registration_customer_message_assert_contract_v1(
    p_contract,
    v_preview.message_kind
  );
  if p_contract ->> 'sourceFingerprint' is distinct from v_preview.source_fingerprint
    or p_contract ->> 'recipientHash' is distinct from v_preview.recipient_hash
    or p_contract ->> 'templateKey' is distinct from v_preview.template_key
    or (p_contract ->> 'templateRevision')::integer is distinct from v_preview.template_revision
    or p_contract ->> 'templateChecksum' is distinct from v_preview.template_checksum
    or p_contract ->> 'renderedVariablesChecksum' is distinct from v_preview.rendered_variables_checksum
    or p_contract ->> 'renderedBodyChecksum' is distinct from v_preview.rendered_body_checksum
    or p_contract ->> 'renderedButtonsChecksum' is distinct from v_preview.rendered_buttons_checksum
  then
    raise exception 'registration_customer_message_preview_stale'
      using errcode = '40001';
  end if;

  v_source_id := dashboard_private.registration_customer_message_stored_source_id_v1(
    v_preview.observation_id,
    v_preview.appointment_id,
    v_preview.track_id,
    v_preview.task_id
  );
  v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl(
    v_preview.message_kind,
    v_source_id
  );
  if p_contract ->> 'parentPhoneDigits' is distinct from v_source ->> 'parentPhoneDigits'
    or v_preview.source_revision is distinct from (v_source ->> 'sourceRevision')::bigint
    or v_preview.source_facts_checksum is distinct from
      dashboard_private.registration_customer_message_source_facts_checksum_v1(v_source)
  then
    raise exception 'registration_customer_message_preview_stale'
      using errcode = '40001';
  end if;
  perform dashboard_private.assert_registration_observation_runtime_v1();

  v_dedupe_key := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(
      pg_catalog.jsonb_build_object(
        'messageKind', v_preview.message_kind,
        'observationId', v_preview.observation_id,
        'sourceRevision', v_preview.source_revision
      )
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-customer-message-dedupe:' || v_dedupe_key, 0)
  );
  select message.*
  into v_message
  from public.ops_registration_customer_messages message
  where message.dedupe_key = v_dedupe_key
     or (
       message.observation_id = v_preview.observation_id
       and message.message_kind = v_preview.message_kind
       and message.source_revision = v_preview.source_revision
     )
  order by message.created_at
  limit 1
  for update;
  if found then
    return dashboard_private.registration_customer_message_result_v1(
      v_message.id, false, false, false
    );
  end if;

  v_claim_token := gen_random_uuid();
  v_dispatch_token := gen_random_uuid();
  insert into public.ops_registration_customer_messages(
    preview_id, task_id, track_id, appointment_id, observation_id,
    message_kind, source_fingerprint, source_facts_checksum, source_revision,
    recipient_hash, recipient_last4, template_key, template_revision,
    template_checksum, rendered_variables_checksum, rendered_body_checksum,
    rendered_buttons_checksum, dedupe_key, request_key, status, claim_active,
    claim_token, claim_owner_id, claim_expires_at, dispatch_token,
    provider_attempt_count, confirmed_by
  ) values (
    v_preview.id, v_preview.task_id, v_preview.track_id, v_preview.appointment_id,
    v_preview.observation_id, v_preview.message_kind, v_preview.source_fingerprint,
    v_preview.source_facts_checksum, v_preview.source_revision,
    v_preview.recipient_hash, v_preview.recipient_last4, v_preview.template_key,
    v_preview.template_revision, v_preview.template_checksum,
    v_preview.rendered_variables_checksum, v_preview.rendered_body_checksum,
    v_preview.rendered_buttons_checksum, v_dedupe_key, v_request_key, 'pending',
    true, v_claim_token, p_actor_profile_id,
    pg_catalog.clock_timestamp() + interval '5 minutes', v_dispatch_token, 0,
    p_actor_profile_id
  ) returning * into v_message;

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
    v_message.id, true, false, true
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
  v_message public.ops_registration_customer_messages%rowtype;
  v_actor_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  select message.* into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id;
  if not found then
    raise exception 'registration_customer_message_not_found' using errcode = 'P0002';
  end if;
  v_actor_id := coalesce(v_message.claim_owner_id, v_message.confirmed_by);
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    v_actor_id, v_message.task_id, 'send'
  );
  if v_message.message_kind in ('observation_booking', 'observation_reminder') then
    perform dashboard_private.registration_customer_message_assert_stored_observation_v1(
      v_message
    );
  end if;
  return dashboard_private.release_registration_customer_message_pre_send_claim_legacy_v1(
    p_message_id, p_claim_token, p_error_code
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
  v_message public.ops_registration_customer_messages%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  select message.* into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id;
  if not found then
    raise exception 'registration_customer_message_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id, v_message.task_id, 'admin'
  );
  if v_message.message_kind in ('observation_booking', 'observation_reminder') then
    perform dashboard_private.registration_customer_message_assert_stored_observation_v1(
      v_message
    );
  end if;
  return dashboard_private.release_reg_customer_msg_claim_admin_legacy_v1(
    p_actor_profile_id, p_message_id, p_reason, p_request_key
  );
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
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  select message.* into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id
  for update;
  if not found then
    raise exception 'registration_customer_message_not_found' using errcode = 'P0002';
  end if;
  v_actor_id := coalesce(v_message.claim_owner_id, v_message.confirmed_by);
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    v_actor_id, v_message.task_id, 'send'
  );
  if v_message.message_kind not in ('observation_booking', 'observation_reminder') then
    return dashboard_private.mark_registration_customer_message_attempt_started_legacy_v1(
      p_message_id, p_claim_token, p_dispatch_token, p_contract
    );
  end if;
  perform dashboard_private.registration_customer_message_assert_contract_v1(
    p_contract, v_message.message_kind
  );
  perform dashboard_private.registration_customer_message_assert_stored_contract_v1(
    v_message, p_contract
  );
  if v_message.dispatch_token is distinct from p_dispatch_token
    or v_message.claim_token is distinct from p_claim_token
  then
    raise exception 'registration_customer_message_claim_invalid' using errcode = '42501';
  end if;
  if v_message.status <> 'pending'
    or v_message.provider_attempt_count = 1
    or v_message.provider_attempt_started_at is not null
  then
    return pg_catalog.jsonb_build_object(
      'allowed', false, 'messageId', v_message.id, 'currentStatus', v_message.status
    );
  end if;
  if not v_message.claim_active
    or v_message.claim_expires_at <= pg_catalog.clock_timestamp()
  then
    raise exception 'registration_customer_message_claim_invalid' using errcode = '40001';
  end if;
  perform dashboard_private.registration_customer_message_assert_current_v1(v_message, p_contract);
  -- Gate B-R: this exact transaction is the final authorization before a
  -- provider-capable marker can be committed.
  perform dashboard_private.assert_registration_observation_runtime_v1();
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
      'allowed', false, 'messageId', p_message_id, 'currentStatus', 'pending'
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'allowed', true, 'messageId', v_message.id,
    'currentStatus', v_message.status, 'dispatchToken', v_message.dispatch_token
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
  v_message public.ops_registration_customer_messages%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  select message.* into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id;
  if not found then
    raise exception 'registration_customer_message_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    v_message.confirmed_by, v_message.task_id, 'send'
  );
  if v_message.message_kind in ('observation_booking', 'observation_reminder') then
    perform dashboard_private.registration_customer_message_assert_stored_observation_v1(
      v_message
    );
  end if;
  return dashboard_private.finalize_registration_customer_message_pre_observation_v1(
    p_message_id, p_dispatch_token, p_result, p_provider_result
  );
end;
$$;

alter function public.finalize_registration_customer_message_v1(uuid, uuid, text, jsonb)
  owner to postgres;
revoke all on function public.finalize_registration_customer_message_v1(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_registration_customer_message_v1(uuid, uuid, text, jsonb)
  to service_role;

create function public.read_registration_customer_message_preview_target_v1(
  p_actor_profile_id uuid,
  p_preview_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_preview public.ops_registration_customer_message_previews%rowtype;
  v_source_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  select preview.* into v_preview
  from public.ops_registration_customer_message_previews preview
  where preview.id = p_preview_id;
  if not found then
    raise exception 'registration_customer_message_preview_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id, v_preview.task_id, 'send'
  );
  if v_preview.message_kind not in ('observation_booking', 'observation_reminder') then
    return dashboard_private.read_registration_customer_message_preview_target_legacy_v1(
      p_actor_profile_id, p_preview_id
    );
  end if;
  if v_preview.created_by <> p_actor_profile_id then
    raise exception 'registration_customer_message_preview_owner_mismatch' using errcode = '42501';
  end if;
  v_source_id := dashboard_private.registration_customer_message_stored_source_id_v1(
    v_preview.observation_id, v_preview.appointment_id,
    v_preview.track_id, v_preview.task_id
  );
  return pg_catalog.jsonb_build_object(
    'taskId', v_preview.task_id,
    'messageKind', v_preview.message_kind,
    'sourceId', v_source_id,
    'observationId', v_preview.observation_id
  );
end;
$$;

alter function public.read_registration_customer_message_preview_target_v1(uuid, uuid)
  owner to postgres;
revoke all on function public.read_registration_customer_message_preview_target_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_registration_customer_message_preview_target_v1(uuid, uuid)
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
set timezone = 'UTC'
as $$
declare
  v_task_id uuid;
  v_actor_role text;
  v_result jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  v_task_id := dashboard_private.registration_customer_message_source_task_v1(
    p_message_kind, p_source_id
  );
  v_actor_role := dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id, v_task_id, 'history'
  );
  if p_message_kind not in ('observation_booking', 'observation_reminder') then
    return dashboard_private.list_registration_customer_messages_pre_observation_v1(
      p_actor_profile_id, p_message_kind, p_source_id, p_limit
    );
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'registration_customer_message_limit_invalid' using errcode = '22023';
  end if;
  if v_actor_role in ('admin', 'staff') then
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'messageId', message.id,
        'messageKind', message.message_kind,
        'sourceId', message.observation_id,
        'observationId', message.observation_id,
        'currentStatus', message.status,
        'confirmedByName', case when message.delivery_origin = 'scheduled'
          then '자동 발송' else coalesce(nullif(pg_catalog.btrim(profile.name), ''), '담당자') end,
        'confirmedAt', message.confirmed_at,
        'updatedAt', message.updated_at,
        'recipientLast4', message.recipient_last4,
        'canCheck', (
          message.delivery_origin = 'manual'
          and message.provider_attempt_count = 1
          and message.provider_attempt_started_at <= pg_catalog.clock_timestamp() - interval '15 minutes'
          and message.status in ('pending', 'unknown')
        ),
        'deliveryOrigin', message.delivery_origin
      ) order by message.created_at desc, message.id desc
    ), '[]'::jsonb)
    into v_result
    from (
      select outbox.*
      from public.ops_registration_customer_messages outbox
      where outbox.task_id = v_task_id
        and outbox.message_kind = p_message_kind
        and outbox.observation_id = p_source_id
      order by outbox.created_at desc, outbox.id desc
      limit p_limit
    ) message
    left join public.profiles profile on profile.id = message.confirmed_by;
  else
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'messageKind', message.message_kind,
        'sourceId', message.observation_id,
        'observationId', message.observation_id,
        'currentStatus', message.status,
        'confirmedByName', case when message.delivery_origin = 'scheduled'
          then '자동 발송' else coalesce(nullif(pg_catalog.btrim(profile.name), ''), '담당자') end,
        'confirmedAt', message.confirmed_at,
        'updatedAt', message.updated_at,
        'deliveryOrigin', message.delivery_origin
      ) order by message.created_at desc, message.id desc
    ), '[]'::jsonb)
    into v_result
    from (
      select outbox.*
      from public.ops_registration_customer_messages outbox
      where outbox.task_id = v_task_id
        and outbox.message_kind = p_message_kind
        and outbox.observation_id = p_source_id
      order by outbox.created_at desc, outbox.id desc
      limit p_limit
    ) message
    left join public.profiles profile on profile.id = message.confirmed_by;
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
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  select message.* into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id;
  if not found then
    raise exception 'registration_customer_message_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id, v_message.task_id, 'send'
  );
  if v_message.message_kind in ('observation_booking', 'observation_reminder') then
    perform dashboard_private.registration_customer_message_assert_stored_observation_v1(
      v_message
    );
  end if;
  return dashboard_private.record_registration_customer_message_provider_check_legacy_v1(
    p_actor_profile_id, p_message_id, p_resolution, p_provider_evidence, p_request_key
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
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  select message.* into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id;
  if not found then
    raise exception 'registration_customer_message_not_found' using errcode = 'P0002';
  end if;
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id, v_message.task_id, 'admin'
  );
  if v_message.message_kind in ('observation_booking', 'observation_reminder') then
    perform dashboard_private.registration_customer_message_assert_stored_observation_v1(
      v_message
    );
  end if;
  return dashboard_private.reconcile_registration_customer_message_pre_observation_v1(
    p_actor_profile_id, p_message_id, p_resolution,
    p_provider_evidence, p_reason, p_request_key
  );
end;
$$;

alter function public.reconcile_registration_customer_message_v1(uuid, uuid, text, jsonb, text, text)
  owner to postgres;
revoke all on function public.reconcile_registration_customer_message_v1(uuid, uuid, text, jsonb, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_registration_customer_message_v1(uuid, uuid, text, jsonb, text, text)
  to service_role;

create or replace function public.claim_registration_customer_reminder_job_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_job dashboard_private.registration_customer_reminder_jobs%rowtype;
  v_activation dashboard_private.registration_customer_solapi_activation%rowtype;
  v_receipt dashboard_private.registration_customer_solapi_template_receipts%rowtype;
  v_live_message public.ops_registration_customer_messages%rowtype;
  v_source jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501';
  end if;
  if not (select settings.enabled
          from dashboard_private.registration_customer_reminder_settings settings
          where settings.singleton) then
    return null;
  end if;
  insert into dashboard_private.registration_customer_reminder_worker_heartbeats(
    singleton, succeeded_at, updated_at
  ) values (true, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())
  on conflict (singleton) do update
    set succeeded_at = excluded.succeeded_at, updated_at = excluded.updated_at;
  perform dashboard_private.materialize_registration_observation_solapi_events_v1(100);
  perform dashboard_private.sync_registration_customer_reminder_jobs_v1();

  update public.ops_registration_customer_messages message
  set status = 'unknown',
      error_code = 'scheduled_marker_recovery',
      resolution_source = 'scheduled_marker_recovery',
      resolved_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.registration_customer_reminder_jobs job
  where job.message_kind = 'observation_reminder'
    and job.status = 'dispatching'
    and job.message_id = message.id
    and message.delivery_origin = 'scheduled'
    and message.status = 'pending'
    and message.provider_attempt_count = 1
    and message.provider_attempt_started_at <= pg_catalog.clock_timestamp() - interval '15 minutes';
  update dashboard_private.registration_customer_reminder_jobs job
  set status = case when message.status = 'unknown' then 'delivery_unknown' else 'completed' end,
      claim_token = null,
      claim_expires_at = null,
      last_error_code = case
        when message.status = 'unknown' then 'provider_dispatch_uncertain'
        when message.status = 'failed_hold' then 'provider_rejected'
        else null
      end
  from public.ops_registration_customer_messages message
  where job.message_kind = 'observation_reminder'
    and job.message_id = message.id
    and job.status = 'dispatching'
    and message.status in ('accepted', 'unknown', 'failed_hold');
  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'pending',
      claim_token = null,
      claim_expires_at = null,
      available_at = pg_catalog.clock_timestamp(),
      last_error_code = 'claim_lease_expired'
  where job.message_kind = 'observation_reminder'
    and job.status = 'claimed'
    and job.message_id is null
    and job.claim_expires_at <= pg_catalog.clock_timestamp();

  for v_job in
    select job.*
    from dashboard_private.registration_customer_reminder_jobs job
    join public.ops_registration_appointments appointment
      on appointment.id = job.appointment_id
    where job.status = 'pending'
      and job.available_at <= pg_catalog.clock_timestamp()
      and job.due_at <= pg_catalog.clock_timestamp()
      and appointment.status = 'scheduled'
      and appointment.scheduled_at > pg_catalog.clock_timestamp()
      and case job.message_kind
        when 'appointment_reminder' then true
        when 'observation_reminder' then
          public.registration_observation_runtime_version() = 1
        else false
      end
    order by job.due_at, job.job_id
    for update of job skip locked
    limit 100
  loop
    select activation.* into v_activation
    from dashboard_private.registration_customer_solapi_activation activation
    where activation.message_kind = v_job.message_kind;
    select receipt.* into v_receipt
    from dashboard_private.registration_customer_solapi_template_receipts receipt
    where receipt.message_kind = v_job.message_kind
      and receipt.provider_status = 'sendable'
      and receipt.catalog_checksum = receipt.provider_checksum;

    if v_job.message_kind = 'appointment_reminder' then
      if v_activation.mode is distinct from 'live'
        or v_receipt.message_kind is null
      then
        continue;
      end if;
      select message.* into v_live_message
      from public.ops_registration_customer_messages message
      where message.id = v_activation.live_test_message_id
        and message.status = 'accepted'
        and message.message_kind = 'appointment_reminder'
        and message.task_id = v_activation.verification_task_id
        and message.recipient_hash = v_activation.verification_recipient_hash
        and message.template_checksum = v_receipt.catalog_checksum;
      if not found or v_activation.live_test_confirmed_at is null then
        continue;
      end if;
      if v_job.source_revision is distinct from (
        select appointment.notification_revision
        from public.ops_registration_appointments appointment
        where appointment.id = v_job.appointment_id
      ) then
        continue;
      end if;
    else
      if public.registration_observation_runtime_version() <> 1 then
        continue;
      end if;
      if v_receipt.message_kind is null
        or v_activation.mode not in ('verification', 'live')
      then
        continue;
      end if;
      if v_activation.mode = 'verification' and (
        v_job.task_id is distinct from v_activation.verification_task_id
        or v_job.activation_mode_snapshot is distinct from 'verification'
        or v_job.verification_started_at is distinct from v_activation.updated_at
        or v_job.verification_recipient_hash is distinct from v_activation.verification_recipient_hash
        or not exists (
          select 1
          from dashboard_private.registration_observation_domain_events source_event
          where source_event.event_id = v_job.source_event_id
            and source_event.occurred_at >= v_job.verification_started_at
        )
      ) then
        update dashboard_private.registration_customer_reminder_jobs job
        set status = 'canceled', available_at = null,
            claim_token = null, claim_expires_at = null,
            last_error_code = 'verification_scope_changed'
        where job.job_id = v_job.job_id;
        continue;
      end if;
      if v_activation.mode = 'live' and (
        v_job.activation_mode_snapshot is distinct from 'live'
        or v_activation.automatic_delivery_cutoff_at is null
        or not exists (
          select 1
          from dashboard_private.registration_observation_domain_events source_event
          where source_event.event_id = v_job.source_event_id
            and source_event.occurred_at >= v_activation.automatic_delivery_cutoff_at
        )
      ) then
        update dashboard_private.registration_customer_reminder_jobs job
        set status = 'canceled', available_at = null,
            claim_token = null, claim_expires_at = null,
            last_error_code = 'pre_cutoff_backlog'
        where job.job_id = v_job.job_id;
        continue;
      end if;
      begin
        v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl(
          'observation_reminder', v_job.observation_id
        );
      exception
        when sqlstate '40001' then
          update dashboard_private.registration_customer_reminder_jobs job
          set status = 'source_dirty', available_at = null,
              claim_token = null, claim_expires_at = null,
              last_error_code = 'booking_fact_changed'
          where job.job_id = v_job.job_id;
          continue;
        when sqlstate '22023' or sqlstate 'P0002' then
          update dashboard_private.registration_customer_reminder_jobs job
          set status = 'canceled', available_at = null,
              claim_token = null, claim_expires_at = null,
              last_error_code = 'source_ineligible'
          where job.job_id = v_job.job_id;
          continue;
      end;
      if v_job.booking_fact_hash is distinct from v_source ->> 'bookingFactHash' then
        update dashboard_private.registration_customer_reminder_jobs job
        set status = 'source_dirty', available_at = null,
            claim_token = null, claim_expires_at = null,
            last_error_code = 'booking_fact_changed'
        where job.job_id = v_job.job_id;
        continue;
      end if;
    end if;

    update dashboard_private.registration_customer_reminder_jobs job
    set status = 'claimed',
        claim_token = gen_random_uuid(),
        claim_expires_at = pg_catalog.clock_timestamp() + interval '2 minutes',
        last_error_code = null
    where job.job_id = v_job.job_id
    returning * into v_job;
    if v_job.message_kind = 'appointment_reminder' then
      return pg_catalog.jsonb_build_object(
        'jobId', v_job.job_id,
        'appointmentId', v_job.appointment_id,
        'claimToken', v_job.claim_token,
        'sourceRevision', v_job.source_revision,
        'scheduledFor', v_job.scheduled_for,
        'requestKey', v_job.request_key
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'jobId', v_job.job_id,
      'messageKind', v_job.message_kind,
      'appointmentId', v_job.appointment_id,
      'observationId', v_job.observation_id,
      'claimToken', v_job.claim_token,
      'sourceRevision', v_job.source_revision,
      'scheduledFor', v_job.scheduled_for,
      'requestKey', v_job.request_key
    );
  end loop;
  return null;
end;
$$;

alter function public.claim_registration_customer_reminder_job_v1() owner to postgres;
revoke all on function public.claim_registration_customer_reminder_job_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.claim_registration_customer_reminder_job_v1()
  to service_role;

create or replace function public.read_registration_customer_reminder_source_v1(
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.registration_customer_reminder_jobs%rowtype;
  v_source jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501';
  end if;
  select job.* into v_job
  from dashboard_private.registration_customer_reminder_jobs job
  where job.job_id = p_job_id
    and job.status = 'claimed'
    and job.claim_token = p_claim_token
    and job.claim_expires_at > pg_catalog.clock_timestamp()
  for update;
  if not found then
    raise exception 'registration_customer_reminder_claim_invalid' using errcode = '40001';
  end if;
  if v_job.message_kind = 'observation_reminder' then
    perform dashboard_private.assert_registration_observation_runtime_v1();
    begin
      v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl('observation_reminder', v_job.observation_id);
    exception
      when sqlstate '22023' or sqlstate 'P0002' then
        raise exception 'registration_customer_message_source_ineligible' using errcode = '22023';
    end;
    if (v_source ->> 'appointmentId')::uuid is distinct from v_job.appointment_id
      or (v_source ->> 'observationId')::uuid is distinct from v_job.observation_id
      or (v_source ->> 'sourceRevision')::bigint is distinct from v_job.source_revision
      or v_source ->> 'bookingFactHash' is distinct from v_job.booking_fact_hash
    then
      raise exception 'registration_customer_reminder_booking_fact_changed' using errcode = '40001';
    end if;
    return v_source;
  elsif v_job.message_kind = 'appointment_reminder' then
    return dashboard_private.resolve_registration_customer_message_source_v1_impl('appointment_reminder', v_job.appointment_id);
  end if;
  raise exception 'registration_customer_reminder_claim_invalid' using errcode = '40001';
end;
$$;

alter function public.read_registration_customer_reminder_source_v1(uuid, uuid)
  owner to postgres;
revoke all on function public.read_registration_customer_reminder_source_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_registration_customer_reminder_source_v1(uuid, uuid)
  to service_role;

create or replace function public.release_registration_customer_reminder_job_v1(
  p_job_id uuid,
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
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501';
  end if;
  if v_error_code is null or pg_catalog.octet_length(v_error_code) > 120 then
    raise exception 'registration_customer_reminder_release_invalid' using errcode = '22023';
  end if;
  update dashboard_private.registration_customer_reminder_jobs job
  set status = case v_error_code
        when 'source_ineligible' then 'canceled'
        when 'runtime_inactive' then 'canceled'
        when 'booking_fact_changed' then 'source_dirty'
        when 'source_revision_unstable' then 'source_dirty'
        else 'pending'
      end,
      claim_token = null,
      claim_expires_at = null,
      available_at = case
        when v_error_code in (
          'source_ineligible', 'runtime_inactive',
          'booking_fact_changed', 'source_revision_unstable'
        ) then null
        else pg_catalog.clock_timestamp() + interval '5 minutes'
      end,
      last_error_code = v_error_code
  where job.job_id = p_job_id
    and job.status = 'claimed'
    and job.claim_token = p_claim_token
    and job.message_id is null;
  return pg_catalog.jsonb_build_object('released', found, 'jobId', p_job_id);
end;
$$;

alter function public.release_registration_customer_reminder_job_v1(uuid, uuid, text)
  owner to postgres;
revoke all on function public.release_registration_customer_reminder_job_v1(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.release_registration_customer_reminder_job_v1(uuid, uuid, text)
  to service_role;

alter function public.begin_registration_customer_reminder_dispatch_v1(uuid, uuid, jsonb, jsonb)
  rename to begin_registration_customer_reminder_dispatch_legacy_v1;
alter function public.begin_registration_customer_reminder_dispatch_legacy_v1(uuid, uuid, jsonb, jsonb)
  set schema dashboard_private;
revoke all on function dashboard_private.begin_registration_customer_reminder_dispatch_legacy_v1(
  uuid, uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;

create function public.begin_registration_customer_reminder_dispatch_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_contract jsonb,
  p_readiness_contract jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_kind text;
  v_job dashboard_private.registration_customer_reminder_jobs%rowtype;
  v_settings dashboard_private.registration_customer_reminder_settings%rowtype;
  v_activation dashboard_private.registration_customer_solapi_activation%rowtype;
  v_receipt dashboard_private.registration_customer_solapi_template_receipts%rowtype;
  v_live_message public.ops_registration_customer_messages%rowtype;
  v_existing public.ops_registration_customer_messages%rowtype;
  v_source jsonb;
  v_source_facts_checksum text;
  v_message public.ops_registration_customer_messages%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_expected_due_at timestamptz;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501';
  end if;
  select job.message_kind into v_kind
  from dashboard_private.registration_customer_reminder_jobs job
  where job.job_id = p_job_id;
  if v_kind = 'appointment_reminder' then
    return dashboard_private.begin_registration_customer_reminder_dispatch_legacy_v1(
      p_job_id, p_claim_token, p_contract, p_readiness_contract
    );
  end if;
  if v_kind is distinct from 'observation_reminder' then
    raise exception 'registration_customer_reminder_claim_invalid' using errcode = '40001';
  end if;
  perform dashboard_private.registration_customer_message_assert_contract_v1(
    p_contract, 'observation_reminder'
  );
  if p_readiness_contract is null
    or pg_catalog.jsonb_typeof(p_readiness_contract) <> 'object'
    or p_readiness_contract - array[
      'credentialsConfigured', 'pfId', 'templateId', 'catalogChecksum',
      'recipientHash', 'sourceFingerprint', 'sourceFactsChecksum'
    ]::text[] <> '{}'::jsonb
    or not p_readiness_contract ?& array[
      'credentialsConfigured', 'pfId', 'templateId', 'catalogChecksum',
      'recipientHash', 'sourceFingerprint', 'sourceFactsChecksum'
    ]::text[]
    or coalesce((p_readiness_contract ->> 'credentialsConfigured')::boolean, false) is not true
    or (p_readiness_contract ->> 'catalogChecksum') !~ '^[a-f0-9]{64}$'
    or (p_readiness_contract ->> 'recipientHash') !~ '^[a-f0-9]{64}$'
    or (p_readiness_contract ->> 'sourceFingerprint') !~ '^[a-f0-9]{64}$'
    or (p_readiness_contract ->> 'sourceFactsChecksum') !~ '^[a-f0-9]{64}$'
  then
    raise exception 'registration_customer_reminder_contract_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-customer-reminder:' || p_job_id::text, 0)
  );
  select job.* into v_job
  from dashboard_private.registration_customer_reminder_jobs job
  where job.job_id = p_job_id
    and job.message_kind = 'observation_reminder'
    and job.status = 'claimed'
    and job.claim_token = p_claim_token
    and job.claim_expires_at > v_now
  for update;
  if not found then
    raise exception 'registration_customer_reminder_claim_invalid' using errcode = '40001';
  end if;
  select settings.* into strict v_settings
  from dashboard_private.registration_customer_reminder_settings settings
  where settings.singleton
  for share;
  if v_settings.enabled is not true
    or not dashboard_private.registration_customer_reminder_schedule_ready_v1()
  then
    raise exception 'registration_customer_reminder_not_ready' using errcode = '55000';
  end if;

  v_expected_due_at := v_job.scheduled_for - pg_catalog.make_interval(hours => v_settings.lead_hours);
  if v_job.due_at is distinct from v_expected_due_at then
    if v_job.scheduled_for >= v_now + pg_catalog.make_interval(hours => v_settings.lead_hours) then
      update dashboard_private.registration_customer_reminder_jobs job
      set status = 'pending', claim_token = null, claim_expires_at = null,
          due_at = v_expected_due_at,
          available_at = greatest(v_now, v_expected_due_at),
          last_error_code = 'settings_changed'
      where job.job_id = v_job.job_id;
    else
      update dashboard_private.registration_customer_reminder_jobs job
      set status = 'canceled', claim_token = null, claim_expires_at = null,
          available_at = null, last_error_code = 'lead_time_changed_insufficient'
      where job.job_id = v_job.job_id;
    end if;
    return pg_catalog.jsonb_build_object(
      'allowed', false, 'messageId', null, 'dispatchToken', null,
      'currentStatus', 'settings_refresh_required'
    );
  end if;

  select activation.* into strict v_activation
  from dashboard_private.registration_customer_solapi_activation activation
  where activation.message_kind = 'observation_reminder'
  for share;
  select receipt.* into v_receipt
  from dashboard_private.registration_customer_solapi_template_receipts receipt
  where receipt.message_kind = 'observation_reminder'
  for share;
  if v_job.activation_mode_snapshot = 'verification' and (
    v_activation.mode is distinct from 'verification'
    or v_job.task_id is distinct from v_activation.verification_task_id
    or v_job.verification_started_at is distinct from v_activation.updated_at
    or v_job.verification_recipient_hash is distinct from v_activation.verification_recipient_hash
    or p_readiness_contract ->> 'recipientHash' is distinct from v_activation.verification_recipient_hash
    or not exists (
      select 1
      from dashboard_private.registration_observation_domain_events source_event
      where source_event.event_id = v_job.source_event_id
        and source_event.occurred_at >= v_job.verification_started_at
    )
  ) then
    update dashboard_private.registration_customer_reminder_jobs job
    set status = 'canceled', claim_token = null, claim_expires_at = null,
        available_at = null, last_error_code = 'verification_scope_changed'
    where job.job_id = v_job.job_id;
    return pg_catalog.jsonb_build_object(
      'allowed', false, 'messageId', null, 'dispatchToken', null,
      'currentStatus', 'canceled'
    );
  end if;
  if v_activation.mode not in ('verification', 'live')
    or v_receipt.message_kind is null
    or v_receipt.provider_status is distinct from 'sendable'
    or v_receipt.catalog_checksum is distinct from v_receipt.provider_checksum
    or v_receipt.catalog_checksum is distinct from p_readiness_contract ->> 'catalogChecksum'
    or v_receipt.template_id is distinct from nullif(pg_catalog.btrim(p_readiness_contract ->> 'templateId'), '')
    or v_receipt.pf_id is distinct from nullif(pg_catalog.btrim(p_readiness_contract ->> 'pfId'), '')
  then
    raise exception 'registration_customer_reminder_not_ready' using errcode = '55000';
  end if;
  if v_activation.mode = 'live' then
    if v_job.activation_mode_snapshot is distinct from 'live'
      or v_activation.automatic_delivery_cutoff_at is null
      or not exists (
        select 1
        from dashboard_private.registration_observation_domain_events source_event
        where source_event.event_id = v_job.source_event_id
          and source_event.occurred_at >= v_activation.automatic_delivery_cutoff_at
      )
    then
      raise exception 'registration_customer_reminder_not_ready' using errcode = '55000';
    end if;
    select message.* into v_live_message
    from public.ops_registration_customer_messages message
    where message.id = v_activation.live_test_message_id
      and message.status = 'accepted'
      and message.message_kind = 'observation_reminder'
      and message.task_id = v_activation.verification_task_id
      and message.recipient_hash = v_activation.verification_recipient_hash
      and message.template_checksum = v_receipt.catalog_checksum;
    if not found or v_activation.live_test_confirmed_at is null then
      raise exception 'registration_customer_reminder_not_ready' using errcode = '55000';
    end if;
  end if;

  begin
    v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl(
      'observation_reminder', v_job.observation_id
    );
  exception
    when sqlstate '40001' then
      update dashboard_private.registration_customer_reminder_jobs job
      set status = 'source_dirty', claim_token = null, claim_expires_at = null,
          available_at = null, last_error_code = 'booking_fact_changed'
      where job.job_id = v_job.job_id;
      return pg_catalog.jsonb_build_object(
        'allowed', false, 'messageId', null, 'dispatchToken', null,
        'currentStatus', 'source_dirty'
      );
  end;
  if v_job.booking_fact_hash is distinct from v_source ->> 'bookingFactHash'
    or (v_source ->> 'sourceRevision')::bigint is distinct from v_job.source_revision
  then
    update dashboard_private.registration_customer_reminder_jobs job
    set status = 'source_dirty', claim_token = null, claim_expires_at = null,
        available_at = null, last_error_code = 'booking_fact_changed'
    where job.job_id = v_job.job_id;
    return pg_catalog.jsonb_build_object(
      'allowed', false, 'messageId', null, 'dispatchToken', null,
      'currentStatus', 'source_dirty'
    );
  end if;
  if v_job.session_source_revision is distinct from v_source -> 'sessionSourceRevision' then
    if v_job.source_refresh_count = 0 then
      update dashboard_private.registration_customer_reminder_jobs job
      set session_source_revision = v_source -> 'sessionSourceRevision',
          source_refresh_count = 1
      where job.job_id = v_job.job_id;
      return pg_catalog.jsonb_build_object(
        'allowed', false, 'messageId', null, 'dispatchToken', null,
        'currentStatus', 'refresh_required'
      );
    end if;
    update dashboard_private.registration_customer_reminder_jobs job
    set status = 'source_dirty', claim_token = null, claim_expires_at = null,
        available_at = null, last_error_code = 'source_revision_unstable'
    where job.job_id = v_job.job_id;
    return pg_catalog.jsonb_build_object(
      'allowed', false, 'messageId', null, 'dispatchToken', null,
      'currentStatus', 'source_dirty'
    );
  end if;

  v_source_facts_checksum :=
    dashboard_private.registration_customer_message_source_facts_checksum_v1(v_source);
  if v_source ->> 'parentPhoneDigits' is distinct from p_contract ->> 'parentPhoneDigits'
    or v_source_facts_checksum is distinct from p_readiness_contract ->> 'sourceFactsChecksum'
    or p_contract ->> 'recipientHash' is distinct from p_readiness_contract ->> 'recipientHash'
    or p_contract ->> 'sourceFingerprint' is distinct from p_readiness_contract ->> 'sourceFingerprint'
    or p_contract ->> 'templateChecksum' is distinct from p_readiness_contract ->> 'catalogChecksum'
  then
    raise exception 'registration_customer_reminder_source_stale' using errcode = '40001';
  end if;

  select message.* into v_existing
  from public.ops_registration_customer_messages message
  where message.observation_id = v_job.observation_id
    and message.message_kind = 'observation_reminder'
    and message.source_revision = v_job.source_revision
  for update;
  if found then
    update dashboard_private.registration_customer_reminder_jobs job
    set status = 'completed', claim_token = null, claim_expires_at = null,
        message_id = v_existing.id, last_error_code = 'duplicate_locked'
    where job.job_id = v_job.job_id;
    return pg_catalog.jsonb_build_object(
      'allowed', false, 'messageId', v_existing.id,
      'dispatchToken', v_existing.dispatch_token,
      'currentStatus', 'duplicate_locked'
    );
  end if;

  -- This shared singleton lock is the final authorization before the marker.
  -- It both rechecks a committed runtime rollback after any duplicate-row wait
  -- and prevents a new 1 -> 0 transition from committing ahead of this insert.
  begin
    perform 1
    from dashboard_private.registration_observation_runtime_settings runtime
    where runtime.singleton
      and runtime.activation_version = 1
    for share;
    if not found then
      raise exception 'registration_observation_runtime_inactive' using errcode = '55000';
    end if;
    perform dashboard_private.assert_registration_observation_runtime_v1();
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'registration_observation_runtime_inactive' then
        raise;
      end if;
      update dashboard_private.registration_customer_reminder_jobs job
      set status = 'canceled', claim_token = null, claim_expires_at = null,
          available_at = null, last_error_code = 'runtime_inactive'
      where job.job_id = v_job.job_id;
      return pg_catalog.jsonb_build_object(
        'allowed', false, 'messageId', null, 'dispatchToken', null,
        'currentStatus', 'runtime_inactive'
      );
  end;

  insert into public.ops_registration_customer_messages(
    preview_id, task_id, track_id, appointment_id, observation_id,
    message_kind, source_fingerprint, source_facts_checksum, source_revision,
    recipient_hash, recipient_last4, template_key, template_revision,
    template_checksum, rendered_variables_checksum, rendered_body_checksum,
    rendered_buttons_checksum, dedupe_key, request_key, status, claim_active,
    dispatch_token, provider_attempt_started_at, provider_attempt_count,
    confirmed_by, confirmed_at, delivery_origin, scheduled_job_id, scheduled_for
  ) values (
    null, v_job.task_id, (v_source ->> 'trackId')::uuid, v_job.appointment_id,
    v_job.observation_id, 'observation_reminder',
    p_contract ->> 'sourceFingerprint', v_source_facts_checksum, v_job.source_revision,
    p_contract ->> 'recipientHash', pg_catalog.right(p_contract ->> 'parentPhoneDigits', 4),
    'observation_reminder', (p_contract ->> 'templateRevision')::integer,
    p_contract ->> 'templateChecksum', p_contract ->> 'renderedVariablesChecksum',
    p_contract ->> 'renderedBodyChecksum', p_contract ->> 'renderedButtonsChecksum',
    dashboard_private.notification_sha256_hex_v1(
      dashboard_private.notification_canonical_json_v1(
        pg_catalog.jsonb_build_object(
          'messageKind', 'observation_reminder',
          'jobId', v_job.job_id,
          'deliveryOrigin', 'scheduled'
        )
      )
    ),
    v_job.request_key::text, 'pending', false, gen_random_uuid(),
    pg_catalog.clock_timestamp(), 1, null, pg_catalog.clock_timestamp(),
    'scheduled', v_job.job_id, v_job.scheduled_for
  ) returning * into v_message;
  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'dispatching', claim_token = null, claim_expires_at = null,
      message_id = v_message.id, last_error_code = null
  where job.job_id = v_job.job_id
    and job.appointment_id = v_message.appointment_id
    and job.message_kind = v_message.message_kind
    and job.source_revision = v_message.source_revision
    and job.source_identity = v_message.scheduled_source_identity;
  return pg_catalog.jsonb_build_object(
    'allowed', true, 'messageId', v_message.id,
    'dispatchToken', v_message.dispatch_token, 'currentStatus', 'pending'
  );
exception
  when unique_violation then
    select message.* into v_existing
    from public.ops_registration_customer_messages message
    where message.observation_id = v_job.observation_id
      and message.message_kind = 'observation_reminder'
      and message.source_revision = v_job.source_revision;
    if v_existing.id is null then
      raise;
    end if;
    update dashboard_private.registration_customer_reminder_jobs job
    set status = 'completed', claim_token = null, claim_expires_at = null,
        message_id = v_existing.id, last_error_code = 'duplicate_locked'
    where job.job_id = p_job_id;
    return pg_catalog.jsonb_build_object(
      'allowed', false, 'messageId', v_existing.id,
      'dispatchToken', v_existing.dispatch_token,
      'currentStatus', 'duplicate_locked'
    );
end;
$$;

alter function public.begin_registration_customer_reminder_dispatch_v1(uuid, uuid, jsonb, jsonb)
  owner to postgres;
revoke all on function public.begin_registration_customer_reminder_dispatch_v1(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_registration_customer_reminder_dispatch_v1(uuid, uuid, jsonb, jsonb)
  to service_role;

create or replace function public.finalize_registration_customer_reminder_dispatch_v1(
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
set timezone = 'UTC'
as $$
declare
  v_message public.ops_registration_customer_messages%rowtype;
  v_provider_result jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501';
  end if;
  if p_result not in ('accepted', 'failed_hold', 'unknown') then
    raise exception 'registration_customer_reminder_finalize_invalid' using errcode = '22023';
  end if;
  v_provider_result := dashboard_private.registration_customer_message_provider_evidence_v1(
    p_provider_result
  );
  select message.* into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id
  for update;
  if not found
    or v_message.delivery_origin <> 'scheduled'
    or v_message.message_kind not in ('appointment_reminder', 'observation_reminder')
    or v_message.dispatch_token is distinct from p_dispatch_token
    or v_message.provider_attempt_count <> 1
    or v_message.provider_attempt_started_at is null
  then
    raise exception 'registration_customer_reminder_finalize_not_allowed' using errcode = '40001';
  end if;
  if v_message.status in ('accepted', 'unknown', 'failed_hold') then
    return pg_catalog.jsonb_build_object(
      'ok', v_message.status = 'accepted', 'messageId', v_message.id,
      'currentStatus', v_message.status, 'idempotent', true,
      'confirmedByName', '자동 발송', 'confirmedAt', v_message.confirmed_at,
      'updatedAt', v_message.updated_at, 'recipientLast4', v_message.recipient_last4,
      'canCheck', false
    );
  end if;
  update public.ops_registration_customer_messages message
  set status = p_result,
      provider_message_id = v_provider_result ->> 'providerMessageId',
      provider_group_id = v_provider_result ->> 'providerGroupId',
      provider_status_code = v_provider_result ->> 'statusCode',
      provider_status_message = v_provider_result ->> 'statusMessage',
      provider_evidence = v_provider_result,
      error_code = case when p_result = 'failed_hold' then 'provider_rejected' else null end,
      resolution_source = 'scheduled_provider_send',
      resolved_by = null,
      resolved_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where message.id = v_message.id
  returning * into v_message;
  update dashboard_private.registration_customer_reminder_jobs job
  set status = case when p_result = 'unknown' then 'delivery_unknown' else 'completed' end,
      claim_token = null,
      claim_expires_at = null,
      last_error_code = case
        when p_result = 'failed_hold' then 'provider_rejected'
        when p_result = 'unknown' then 'provider_dispatch_uncertain'
        else null
      end
  where job.job_id = v_message.scheduled_job_id
    and job.appointment_id = v_message.appointment_id
    and job.message_kind = v_message.message_kind
    and job.source_revision = v_message.source_revision
    and job.source_identity = v_message.scheduled_source_identity
    and job.message_id = v_message.id;
  if not found then
    raise exception 'registration_customer_reminder_finalize_not_allowed' using errcode = '40001';
  end if;
  return pg_catalog.jsonb_build_object(
    'ok', v_message.status = 'accepted', 'messageId', v_message.id,
    'currentStatus', v_message.status, 'idempotent', false,
    'confirmedByName', '자동 발송', 'confirmedAt', v_message.confirmed_at,
    'updatedAt', v_message.updated_at, 'recipientLast4', v_message.recipient_last4,
    'canCheck', false
  );
end;
$$;

alter function public.finalize_registration_customer_reminder_dispatch_v1(uuid, uuid, text, jsonb)
  owner to postgres;
revoke all on function public.finalize_registration_customer_reminder_dispatch_v1(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_registration_customer_reminder_dispatch_v1(uuid, uuid, text, jsonb)
  to service_role;

alter function public.set_registration_customer_solapi_activation_v1(uuid, text, text, jsonb)
  rename to set_registration_customer_solapi_activation_pre_observation_v1;
alter function public.set_registration_customer_solapi_activation_pre_observation_v1(uuid, text, text, jsonb)
  set schema dashboard_private;
revoke all on function dashboard_private.set_registration_customer_solapi_activation_pre_observation_v1(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;

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
  v_result jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  perform dashboard_private.registration_customer_solapi_assert_admin_v1(
    p_actor_profile_id
  );
  v_result := dashboard_private.set_registration_customer_solapi_activation_pre_observation_v1(
    p_actor_profile_id, p_message_kind, p_mode, p_evidence
  );
  if p_message_kind = 'observation_reminder' and p_mode = 'off' then
    update dashboard_private.registration_customer_reminder_jobs job
    set status = 'canceled', claim_token = null, claim_expires_at = null,
        available_at = null, last_error_code = 'activation_off'
    where job.message_kind = 'observation_reminder'
      and job.status in ('pending', 'claimed')
      and job.message_id is null;
  end if;
  return v_result;
end;
$$;

alter function public.set_registration_customer_solapi_activation_v1(uuid, text, text, jsonb)
  owner to postgres;
revoke all on function public.set_registration_customer_solapi_activation_v1(uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.set_registration_customer_solapi_activation_v1(uuid, text, text, jsonb)
  to service_role;

alter function public.get_registration_customer_solapi_readiness_v1(uuid, text, uuid, jsonb)
  rename to get_registration_customer_solapi_readiness_pre_observation_v1;
alter function public.get_registration_customer_solapi_readiness_pre_observation_v1(uuid, text, uuid, jsonb)
  set schema dashboard_private;
revoke all on function dashboard_private.get_registration_customer_solapi_readiness_pre_observation_v1(
  uuid, text, uuid, jsonb
) from public, anon, authenticated, service_role;

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
  v_task_id uuid;
  v_readiness jsonb;
  v_blockers jsonb;
  v_runtime_ready boolean;
  v_duplicate_locked boolean;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  v_task_id := dashboard_private.registration_customer_message_source_task_v1(
    p_message_kind, p_source_id
  );
  perform dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id, v_task_id, 'send'
  );
  v_readiness := dashboard_private.get_registration_customer_solapi_readiness_pre_observation_v1(
    p_actor_profile_id, p_message_kind, p_source_id, p_template_contract
  );
  if p_message_kind not in ('observation_booking', 'observation_reminder') then
    return v_readiness;
  end if;
  v_runtime_ready := public.registration_observation_runtime_version() = 1;
  v_blockers := coalesce(v_readiness -> 'blockers', '[]'::jsonb)
    - 'runtime_not_ready' - 'duplicate_locked';
  select exists(
    select 1
    from public.ops_registration_customer_messages message
    where message.message_kind = p_message_kind
      and message.observation_id = p_source_id
      and message.source_fingerprint = p_template_contract ->> 'sourceFingerprint'
      and message.recipient_hash = p_template_contract ->> 'recipientHash'
  ) into v_duplicate_locked;
  if not v_runtime_ready then
    v_blockers := v_blockers || pg_catalog.jsonb_build_array('runtime_not_ready');
  end if;
  if v_duplicate_locked then
    v_blockers := v_blockers || pg_catalog.jsonb_build_array('duplicate_locked');
  end if;
  return v_readiness || pg_catalog.jsonb_build_object(
    'runtimeReady', v_runtime_ready,
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

alter function public.get_registration_customer_reminder_settings_v1(uuid)
  rename to get_registration_customer_reminder_settings_pre_observation_v1;
alter function public.get_registration_customer_reminder_settings_pre_observation_v1(uuid)
  set schema dashboard_private;
alter function public.set_registration_customer_reminder_settings_v1(uuid, boolean, smallint, bigint, jsonb)
  rename to set_registration_customer_reminder_settings_pre_observation_v1;
alter function public.set_registration_customer_reminder_settings_pre_observation_v1(uuid, boolean, smallint, bigint, jsonb)
  set schema dashboard_private;
revoke all on function dashboard_private.get_registration_customer_reminder_settings_pre_observation_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.set_registration_customer_reminder_settings_pre_observation_v1(
  uuid, boolean, smallint, bigint, jsonb
) from public, anon, authenticated, service_role;

create function public.get_registration_customer_reminder_settings_v1(
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_settings dashboard_private.registration_customer_reminder_settings%rowtype;
  v_active_kinds jsonb;
  v_ready boolean;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  perform dashboard_private.registration_customer_solapi_assert_operator_v1(
    p_actor_profile_id
  );
  select settings.* into strict v_settings
  from dashboard_private.registration_customer_reminder_settings settings
  where settings.singleton;
  select coalesce(pg_catalog.jsonb_agg(active.message_kind order by active.sort_order), '[]'::jsonb)
  into v_active_kinds
  from (
    select activation.message_kind,
      case activation.message_kind when 'appointment_reminder' then 1 else 2 end as sort_order
    from dashboard_private.registration_customer_solapi_activation activation
    where (activation.message_kind = 'appointment_reminder' and activation.mode = 'live')
       or (activation.message_kind = 'observation_reminder' and activation.mode in ('verification', 'live'))
  ) active;
  v_ready := v_settings.enabled
    and pg_catalog.jsonb_array_length(v_active_kinds) > 0
    and dashboard_private.registration_customer_reminder_schedule_ready_v1();
  return pg_catalog.jsonb_build_object(
    'enabled', v_settings.enabled,
    'leadHours', v_settings.lead_hours,
    'revision', v_settings.revision::text,
    'updatedAt', v_settings.updated_at,
    'ready', v_ready,
    'status', case when v_ready then 'ready' else 'not_ready' end,
    'editable', true,
    'activeKinds', v_active_kinds
  );
end;
$$;

alter function public.get_registration_customer_reminder_settings_v1(uuid)
  owner to postgres;
revoke all on function public.get_registration_customer_reminder_settings_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_registration_customer_reminder_settings_v1(uuid)
  to service_role;

create function public.set_registration_customer_reminder_settings_v1(
  p_actor_profile_id uuid,
  p_enabled boolean,
  p_lead_hours smallint,
  p_expected_revision bigint,
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
  v_settings dashboard_private.registration_customer_reminder_settings%rowtype;
  v_active_count integer;
  v_observation_active boolean;
  v_template_count integer;
  v_template record;
  v_receipt dashboard_private.registration_customer_solapi_template_receipts%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_message_access_denied' using errcode = '42501';
  end if;
  perform dashboard_private.registration_customer_solapi_assert_admin_v1(
    p_actor_profile_id
  );
  if p_enabled is null
    or p_lead_hours not between 1 and 72
    or p_expected_revision is null
  then
    raise exception 'registration_customer_reminder_settings_invalid' using errcode = '22023';
  end if;
  select settings.* into strict v_settings
  from dashboard_private.registration_customer_reminder_settings settings
  where settings.singleton
  for update;
  if v_settings.revision <> p_expected_revision then
    raise exception 'registration_customer_reminder_settings_conflict' using errcode = '40001';
  end if;
  select count(*)::integer,
    coalesce(bool_or(
      activation.message_kind = 'observation_reminder'
      and activation.mode in ('verification', 'live')
    ), false)
  into v_active_count, v_observation_active
  from dashboard_private.registration_customer_solapi_activation activation
  where (activation.message_kind = 'appointment_reminder' and activation.mode = 'live')
     or (activation.message_kind = 'observation_reminder' and activation.mode in ('verification', 'live'));

  if p_enabled then
    if v_active_count = 0
      or p_template_contract is null
      or pg_catalog.jsonb_typeof(p_template_contract) <> 'object'
    then
      raise exception 'registration_customer_reminder_not_ready' using errcode = '55000';
    end if;
    if not v_observation_active then
      if p_template_contract - array['templateId', 'pfId', 'catalogChecksum']::text[] <> '{}'::jsonb
        or not p_template_contract ?& array['templateId', 'pfId', 'catalogChecksum']::text[]
        or (p_template_contract ->> 'catalogChecksum') !~ '^[a-f0-9]{64}$'
      then
        raise exception 'registration_customer_reminder_settings_invalid' using errcode = '22023';
      end if;
      select receipt.* into v_receipt
      from dashboard_private.registration_customer_solapi_template_receipts receipt
      where receipt.message_kind = 'appointment_reminder';
      if v_receipt.message_kind is null
        or v_receipt.provider_status is distinct from 'sendable'
        or v_receipt.catalog_checksum is distinct from v_receipt.provider_checksum
        or v_receipt.template_id is distinct from nullif(pg_catalog.btrim(p_template_contract ->> 'templateId'), '')
        or v_receipt.pf_id is distinct from nullif(pg_catalog.btrim(p_template_contract ->> 'pfId'), '')
        or v_receipt.catalog_checksum is distinct from p_template_contract ->> 'catalogChecksum'
      then
        raise exception 'registration_customer_reminder_not_ready' using errcode = '55000';
      end if;
    else
      if p_template_contract - array['templates']::text[] <> '{}'::jsonb
        or not p_template_contract ? 'templates'
        or pg_catalog.jsonb_typeof(p_template_contract -> 'templates') <> 'array'
      then
        raise exception 'registration_customer_reminder_settings_invalid' using errcode = '22023';
      end if;
      select count(*)::integer into v_template_count
      from pg_catalog.jsonb_array_elements(p_template_contract -> 'templates') item(value);
      if v_template_count <> v_active_count
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements(p_template_contract -> 'templates') item(value)
          where pg_catalog.jsonb_typeof(item.value) <> 'object'
            or item.value - array['messageKind','templateId','pfId','catalogChecksum']::text[] <> '{}'::jsonb
            or not item.value ?& array['messageKind','templateId','pfId','catalogChecksum']::text[]
            or item.value ->> 'messageKind' not in ('appointment_reminder', 'observation_reminder')
            or (item.value ->> 'catalogChecksum') !~ '^[a-f0-9]{64}$'
        )
        or exists (
          select item.value ->> 'messageKind'
          from pg_catalog.jsonb_array_elements(p_template_contract -> 'templates') item(value)
          group by item.value ->> 'messageKind'
          having count(*) <> 1
        )
      then
        raise exception 'registration_customer_reminder_settings_invalid' using errcode = '22023';
      end if;
      for v_template in
        select item.value as value
        from pg_catalog.jsonb_array_elements(p_template_contract -> 'templates') item(value)
      loop
        if not exists (
          select 1
          from dashboard_private.registration_customer_solapi_activation activation
          where activation.message_kind = v_template.value ->> 'messageKind'
            and (
              (activation.message_kind = 'appointment_reminder' and activation.mode = 'live')
              or (activation.message_kind = 'observation_reminder' and activation.mode in ('verification', 'live'))
            )
        ) then
          raise exception 'registration_customer_reminder_settings_invalid' using errcode = '22023';
        end if;
        select receipt.* into v_receipt
        from dashboard_private.registration_customer_solapi_template_receipts receipt
        where receipt.message_kind = v_template.value ->> 'messageKind';
        if v_receipt.message_kind is null
          or v_receipt.provider_status is distinct from 'sendable'
          or v_receipt.catalog_checksum is distinct from v_receipt.provider_checksum
          or v_receipt.template_id is distinct from nullif(pg_catalog.btrim(v_template.value ->> 'templateId'), '')
          or v_receipt.pf_id is distinct from nullif(pg_catalog.btrim(v_template.value ->> 'pfId'), '')
          or v_receipt.catalog_checksum is distinct from v_template.value ->> 'catalogChecksum'
        then
          raise exception 'registration_customer_reminder_not_ready' using errcode = '55000';
        end if;
      end loop;
    end if;
    if not dashboard_private.registration_customer_reminder_schedule_ready_v1() then
      raise exception 'registration_customer_reminder_not_ready' using errcode = '55000';
    end if;
  end if;

  if p_enabled = v_settings.enabled and p_lead_hours <> v_settings.lead_hours then
    update dashboard_private.registration_customer_reminder_jobs job
    set due_at = job.scheduled_for - pg_catalog.make_interval(hours => p_lead_hours),
        available_at = case
          when job.scheduled_for >= pg_catalog.clock_timestamp() + pg_catalog.make_interval(hours => p_lead_hours)
            then greatest(
              pg_catalog.clock_timestamp(),
              job.scheduled_for - pg_catalog.make_interval(hours => p_lead_hours)
            )
          else null
        end,
        status = case
          when job.scheduled_for >= pg_catalog.clock_timestamp() + pg_catalog.make_interval(hours => p_lead_hours)
            then 'pending'
          else 'canceled'
        end,
        last_error_code = case
          when job.scheduled_for >= pg_catalog.clock_timestamp() + pg_catalog.make_interval(hours => p_lead_hours)
            then 'settings_changed'
          else 'lead_time_changed_insufficient'
        end
    where job.message_kind = 'observation_reminder'
      and job.status = 'pending'
      and job.message_id is null
      and job.claim_token is null;
  end if;

  update dashboard_private.registration_customer_reminder_settings settings
  set enabled = p_enabled,
      lead_hours = p_lead_hours,
      revision = settings.revision + 1,
      updated_by = p_actor_profile_id,
      updated_at = pg_catalog.clock_timestamp()
  where settings.singleton;
  if not p_enabled then
    update dashboard_private.registration_customer_reminder_jobs job
    set status = 'pending', claim_token = null, claim_expires_at = null,
        available_at = pg_catalog.clock_timestamp(), last_error_code = 'automation_disabled'
    where job.status = 'claimed'
      and job.message_id is null;
  end if;
  return public.get_registration_customer_reminder_settings_v1(p_actor_profile_id);
end;
$$;

alter function public.set_registration_customer_reminder_settings_v1(
  uuid, boolean, smallint, bigint, jsonb
) owner to postgres;
revoke all on function public.set_registration_customer_reminder_settings_v1(
  uuid, boolean, smallint, bigint, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.set_registration_customer_reminder_settings_v1(
  uuid, boolean, smallint, bigint, jsonb
) to service_role;

create function public.inspect_registration_observation_solapi_readiness_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_schedule_base jsonb;
  v_last_succeeded_at timestamptz;
  v_result jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_observation_solapi_readiness_unauthorized'
      using errcode = '42501';
  end if;
  v_schedule_base := dashboard_private.inspect_registration_customer_reminder_schedule_v1();
  select heartbeat.succeeded_at into v_last_succeeded_at
  from dashboard_private.registration_customer_reminder_worker_heartbeats heartbeat
  where heartbeat.singleton;
  select pg_catalog.jsonb_build_object(
    'runtimeReady', public.registration_observation_runtime_version() = 1,
    'settingsEnabled', settings.enabled,
    'leadHours', settings.lead_hours,
    'schedule', pg_catalog.jsonb_build_object(
      'installed', coalesce((v_schedule_base ->> 'installed')::boolean, false),
      'active', coalesce((v_schedule_base ->> 'active')::boolean, false),
      'contractReady', coalesce((v_schedule_base ->> 'contractReady')::boolean, false),
      'vaultReady', coalesce((v_schedule_base ->> 'vaultReady')::boolean, false),
      'heartbeatCurrent', v_last_succeeded_at is not null
        and v_last_succeeded_at >= pg_catalog.clock_timestamp() - interval '5 minutes',
      'lastSucceededAt', v_last_succeeded_at
    ),
    'bookingMode', booking.mode,
    'reminderMode', reminder.mode,
    'bookingReceipt', exists(
      select 1
      from dashboard_private.registration_customer_solapi_template_receipts receipt
      where receipt.message_kind = 'observation_booking'
        and receipt.provider_status = 'sendable'
    ),
    'reminderReceipt', exists(
      select 1
      from dashboard_private.registration_customer_solapi_template_receipts receipt
      where receipt.message_kind = 'observation_reminder'
        and receipt.provider_status = 'sendable'
    ),
    'reminderCutoffAt', reminder.automatic_delivery_cutoff_at,
    'observationMessages', (
      select count(*)
      from public.ops_registration_customer_messages message
      where message.message_kind in ('observation_booking', 'observation_reminder')
    ),
    'providerAttemptMarkers', (
      select count(*)
      from public.ops_registration_customer_messages message
      where message.message_kind in ('observation_booking', 'observation_reminder')
        and message.provider_attempt_count = 1
    ),
    'pending', (
      select count(*)
      from dashboard_private.registration_customer_reminder_jobs job
      where job.message_kind = 'observation_reminder' and job.status = 'pending'
    ),
    'sourceDirty', (
      select count(*)
      from dashboard_private.registration_customer_reminder_jobs job
      where job.message_kind = 'observation_reminder' and job.status = 'source_dirty'
    ),
    'deliveryUnknown', (
      select count(*)
      from dashboard_private.registration_customer_reminder_jobs job
      where job.message_kind = 'observation_reminder' and job.status = 'delivery_unknown'
    )
  ) into v_result
  from dashboard_private.registration_customer_reminder_settings settings
  join dashboard_private.registration_customer_solapi_activation booking
    on booking.message_kind = 'observation_booking'
  join dashboard_private.registration_customer_solapi_activation reminder
    on reminder.message_kind = 'observation_reminder'
  where settings.singleton;
  return v_result;
end;
$$;

alter function public.inspect_registration_observation_solapi_readiness_v1()
  owner to postgres;
revoke all on function public.inspect_registration_observation_solapi_readiness_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.inspect_registration_observation_solapi_readiness_v1()
  to service_role;

-- Gate B installs inert. Any pre-existing observation event, job, receipt,
-- message, marker, or enabled runtime means this migration is being applied at
-- the wrong operational boundary and the transaction must roll back.
do $$
begin
  if coalesce((
      select settings.activation_version
      from dashboard_private.registration_observation_runtime_settings settings
      where settings.singleton
    ), -1) <> 0
    or exists (select 1 from dashboard_private.registration_observation_domain_events)
    or exists (select 1 from dashboard_private.registration_observation_solapi_event_consumptions)
    or exists (
      select 1 from dashboard_private.registration_customer_reminder_jobs job
      where job.message_kind = 'observation_reminder'
    )
    or (
      select count(*)
      from dashboard_private.registration_customer_solapi_activation activation
      where activation.message_kind in ('observation_booking', 'observation_reminder')
        and activation.mode = 'off'
    ) <> 2
    or exists (
      select 1
      from dashboard_private.registration_customer_solapi_template_receipts receipt
      where receipt.message_kind in ('observation_booking', 'observation_reminder')
    )
    or exists (
      select 1
      from public.ops_registration_customer_messages message
      where message.message_kind in ('observation_booking', 'observation_reminder')
    )
    or exists (
      select 1
      from public.ops_registration_customer_messages message
      where message.message_kind in ('observation_booking', 'observation_reminder')
        and message.provider_attempt_count = 1
    )
  then
    raise exception 'registration_observation_solapi_inert_bootstrap_failed'
      using errcode = '55000';
  end if;
end;
$$;

commit;
