begin;

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure(
    'dashboard_private.write_registration_track_event_v2(uuid,uuid,text,text,text,text,jsonb,text,text)'
  ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.record_notification_event_v1(text,text,text,text,text,bigint,text,uuid,timestamptz,integer,jsonb,uuid,bigint)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.registration_appointment_reminders_runtime_version()'
    ) is null
  then
    raise exception 'registration_notification_handoff_runtime_not_ready'
      using errcode = '55000';
  end if;
end;
$$;

alter table public.ops_registration_consultations
  add column if not exists recipient_revision bigint not null default 1;

alter table public.ops_registration_consultations
  drop constraint if exists ops_registration_consultations_recipient_revision_check;
alter table public.ops_registration_consultations
  add constraint ops_registration_consultations_recipient_revision_check
  check (recipient_revision > 0);

-- The specialized rows are intentionally not exposed in the settings grid. They
-- are fixed compatibility contracts. This migration never changes any of the
-- four independently reversible flags seeded false by the common runtime:
-- notification_control_plane_dispatch_registration_enabled,
-- notification_control_plane_registration_phone_adapter_enabled,
-- notification_control_plane_registration_visit_adapter_enabled, and
-- notification_control_plane_registration_solapi_adapter_enabled.
create temporary table registration_notification_fixed_rules (
  rule_key text primary key,
  event_key text not null,
  audience_key text not null,
  channel_key text not null,
  title_template text not null,
  body_template text not null,
  allowed_variables jsonb not null,
  payload_schema_version integer not null
) on commit drop;

insert into registration_notification_fixed_rules(
  rule_key, event_key, audience_key, channel_key,
  title_template, body_template, allowed_variables, payload_schema_version
)
values
  (
    'registration.phone_consultation_ready|track_director|in_app',
    'registration.phone_consultation_ready', 'track_director', 'in_app',
    '[{subject}] 전화상담 대기',
    '{student_name} 학생 상담을 확인하세요.',
    '[
      {"key":"subject","token":"subject","pii_class":"none"},
      {"key":"student_name","token":"student_name","pii_class":"student_name"}
    ]'::jsonb,
    2
  ),
  (
    'registration.visit_scheduled|track_director|in_app',
    'registration.visit_scheduled', 'track_director', 'in_app',
    '[{subjects}] 방문상담 예약 배정',
    '{student_name} 학생 · {scheduled_at} · {place}',
    '[
      {"key":"subjects","token":"subjects","pii_class":"none"},
      {"key":"student_name","token":"student_name","pii_class":"student_name"},
      {"key":"scheduled_at","token":"scheduled_at","pii_class":"schedule"},
      {"key":"place","token":"place","pii_class":"location"}
    ]'::jsonb,
    2
  ),
  (
    'registration.visit_rescheduled|track_director|in_app',
    'registration.visit_rescheduled', 'track_director', 'in_app',
    '[{subjects}] 방문상담 예약 변경',
    '{student_name} 학생 · {scheduled_at} · {place}',
    '[
      {"key":"subjects","token":"subjects","pii_class":"none"},
      {"key":"student_name","token":"student_name","pii_class":"student_name"},
      {"key":"scheduled_at","token":"scheduled_at","pii_class":"schedule"},
      {"key":"place","token":"place","pii_class":"location"}
    ]'::jsonb,
    2
  ),
  (
    'registration.visit_replaced|track_director|in_app',
    'registration.visit_replaced', 'track_director', 'in_app',
    '[{subjects}] 방문상담 예약 교체',
    '{student_name} 학생 · {scheduled_at} · {place}',
    '[
      {"key":"subjects","token":"subjects","pii_class":"none"},
      {"key":"student_name","token":"student_name","pii_class":"student_name"},
      {"key":"scheduled_at","token":"scheduled_at","pii_class":"schedule"},
      {"key":"place","token":"place","pii_class":"location"}
    ]'::jsonb,
    2
  ),
  (
    'registration.visit_subject_deselected|track_director|in_app',
    'registration.visit_subject_deselected', 'track_director', 'in_app',
    '[{subjects}] 방문상담 과목 제외',
    '{student_name} 학생 · {scheduled_at} · {place}',
    '[
      {"key":"subjects","token":"subjects","pii_class":"none"},
      {"key":"student_name","token":"student_name","pii_class":"student_name"},
      {"key":"scheduled_at","token":"scheduled_at","pii_class":"schedule"},
      {"key":"place","token":"place","pii_class":"location"}
    ]'::jsonb,
    2
  ),
  (
    'registration.visit_canceled|track_director|in_app',
    'registration.visit_canceled', 'track_director', 'in_app',
    '[{subjects}] 방문상담 예약 취소',
    '{student_name} 학생 · {scheduled_at} · {place}',
    '[
      {"key":"subjects","token":"subjects","pii_class":"none"},
      {"key":"student_name","token":"student_name","pii_class":"student_name"},
      {"key":"scheduled_at","token":"scheduled_at","pii_class":"schedule"},
      {"key":"place","token":"place","pii_class":"location"}
    ]'::jsonb,
    2
  ),
  (
    'registration.visit_scheduled|management_team|google_chat',
    'registration.visit_scheduled', 'management_team', 'google_chat',
    '방문상담 예약 배정 · {student_name}',
    '{subjects} · {scheduled_at} · {place}',
    '[
      {"key":"subjects","token":"subjects","pii_class":"none"},
      {"key":"student_name","token":"student_name","pii_class":"student_name"},
      {"key":"scheduled_at","token":"scheduled_at","pii_class":"schedule"},
      {"key":"place","token":"place","pii_class":"location"}
    ]'::jsonb,
    2
  ),
  (
    'registration.visit_rescheduled|management_team|google_chat',
    'registration.visit_rescheduled', 'management_team', 'google_chat',
    '방문상담 예약 변경 · {student_name}',
    '{subjects} · {scheduled_at} · {place}',
    '[
      {"key":"subjects","token":"subjects","pii_class":"none"},
      {"key":"student_name","token":"student_name","pii_class":"student_name"},
      {"key":"scheduled_at","token":"scheduled_at","pii_class":"schedule"},
      {"key":"place","token":"place","pii_class":"location"}
    ]'::jsonb,
    2
  ),
  (
    'registration.visit_replaced|management_team|google_chat',
    'registration.visit_replaced', 'management_team', 'google_chat',
    '방문상담 예약 교체 · {student_name}',
    '{subjects} · {scheduled_at} · {place}',
    '[
      {"key":"subjects","token":"subjects","pii_class":"none"},
      {"key":"student_name","token":"student_name","pii_class":"student_name"},
      {"key":"scheduled_at","token":"scheduled_at","pii_class":"schedule"},
      {"key":"place","token":"place","pii_class":"location"}
    ]'::jsonb,
    2
  ),
  (
    'registration.visit_subject_deselected|management_team|google_chat',
    'registration.visit_subject_deselected', 'management_team', 'google_chat',
    '방문상담 과목 제외 · {student_name}',
    '{subjects} · {scheduled_at} · {place}',
    '[
      {"key":"subjects","token":"subjects","pii_class":"none"},
      {"key":"student_name","token":"student_name","pii_class":"student_name"},
      {"key":"scheduled_at","token":"scheduled_at","pii_class":"schedule"},
      {"key":"place","token":"place","pii_class":"location"}
    ]'::jsonb,
    2
  ),
  (
    'registration.visit_canceled|management_team|google_chat',
    'registration.visit_canceled', 'management_team', 'google_chat',
    '방문상담 예약 취소 · {student_name}',
    '{subjects} · {scheduled_at} · {place}',
    '[
      {"key":"subjects","token":"subjects","pii_class":"none"},
      {"key":"student_name","token":"student_name","pii_class":"student_name"},
      {"key":"scheduled_at","token":"scheduled_at","pii_class":"schedule"},
      {"key":"place","token":"place","pii_class":"location"}
    ]'::jsonb,
    2
  ),
  (
    'registration.admission_message_requested|applicant_guardian|customer_message',
    'registration.admission_message_requested', 'applicant_guardian', 'customer_message',
    '입학신청서 안내',
    '{student_name} 학생 입학신청서 안내',
    '[{"key":"student_name","token":"student_name","pii_class":"student_name"}]'::jsonb,
    2
  );

insert into dashboard_private.notification_rules(
  id, scope_key, workflow_key, event_key, channel_key, audience_key,
  rule_variant_key, delivery_mode, schedule_key, schedule_config,
  enabled, active_template_id, revision,
  created_by, created_actor_kind, updated_by, updated_actor_kind
)
select
  dashboard_private.notification_deterministic_uuid_v1(
    'registration-handoff-rule-v1', fixed.rule_key
  ),
  'global', 'registration', fixed.event_key, fixed.channel_key, fixed.audience_key,
  'immediate', 'immediate', null, null,
  true,
  dashboard_private.notification_deterministic_uuid_v1(
    'registration-handoff-template-v1', fixed.rule_key || '|1'
  ),
  1, null, 'system', null, 'system'
from registration_notification_fixed_rules fixed
on conflict do nothing;

insert into dashboard_private.notification_templates(
  id, rule_id, version, title_template, body_template, allowed_variables,
  payload_schema_version, checksum, created_by, created_actor_kind
)
select
  dashboard_private.notification_deterministic_uuid_v1(
    'registration-handoff-template-v1', fixed.rule_key || '|1'
  ),
  dashboard_private.notification_deterministic_uuid_v1(
    'registration-handoff-rule-v1', fixed.rule_key
  ),
  1, fixed.title_template, fixed.body_template, fixed.allowed_variables,
  fixed.payload_schema_version,
  dashboard_private.notification_seed_template_checksum_v1(
    fixed.title_template, fixed.body_template, fixed.allowed_variables,
    fixed.payload_schema_version
  ),
  null, 'system'
from registration_notification_fixed_rules fixed
on conflict do nothing;

create or replace function dashboard_private.registration_track_event_key_v1(
  p_event_type text,
  p_metadata jsonb
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_event_type in ('case_created', 'registration_case_created')
      then 'registration.case_created'
    when p_event_type in ('initial_inquiry_selected', 'inquiry_routed')
      then 'registration.inquiry_routed'
    when p_event_type in (
      'director_default_resolved', 'director_manual_override',
      'director_default_cleared'
    ) then 'registration.director_assigned'
    when p_event_type in ('phone_queue_created', 'phone_queue_reassigned')
      then 'registration.phone_consultation_ready'
    when p_event_type in ('level_test_scheduled', 'level_test_retake_scheduled')
      then 'registration.level_test_scheduled'
    when p_event_type = 'appointment_updated'
      and coalesce(p_metadata ->> 'kind', p_metadata ->> 'appointmentKind') = 'level_test'
      then 'registration.level_test_rescheduled'
    when p_event_type = 'appointment_replaced'
      and coalesce(p_metadata ->> 'kind', p_metadata ->> 'appointmentKind') = 'level_test'
      then 'registration.level_test_rescheduled'
    when p_event_type = 'level_test_started' then 'registration.level_test_started'
    when p_event_type in ('level_test_completed', 'level_test_result_recorded')
      then 'registration.level_test_completed'
    when p_event_type = 'level_test_absent' then 'registration.level_test_absent'
    when p_event_type = 'level_test_canceled'
      or (
        p_event_type = 'appointment_canceled'
        and coalesce(p_metadata ->> 'kind', p_metadata ->> 'appointmentKind') = 'level_test'
      ) then 'registration.level_test_canceled'
    when p_event_type = 'visit_scheduled' then 'registration.visit_scheduled'
    when p_event_type = 'appointment_updated'
      and coalesce(p_metadata ->> 'kind', p_metadata ->> 'appointmentKind', 'visit_consultation') = 'visit_consultation'
      then 'registration.visit_rescheduled'
    when p_event_type = 'appointment_replaced'
      and coalesce(p_metadata ->> 'kind', p_metadata ->> 'appointmentKind', 'visit_consultation') = 'visit_consultation'
      then 'registration.visit_replaced'
    when p_event_type = 'appointment_subject_deselected'
      and coalesce(p_metadata ->> 'kind', p_metadata ->> 'appointmentKind', 'visit_consultation') = 'visit_consultation'
      then 'registration.visit_subject_deselected'
    when p_event_type = 'appointment_canceled'
      and coalesce(p_metadata ->> 'kind', p_metadata ->> 'appointmentKind', 'visit_consultation') = 'visit_consultation'
      then 'registration.visit_canceled'
    when p_event_type = 'consultation_completed' then 'registration.consultation_completed'
    when p_event_type = 'waiting_transitioned' then 'registration.waiting_transitioned'
    when p_event_type = 'enrollment_decision_routed' then 'registration.enrollment_decided'
    when p_event_type = 'admission_batch_started' then 'registration.admission_started'
    when p_event_type in (
      'admission_batch_advanced', 'enrollment_rows_saved',
      'registration_enrollment_makeedu_updated', 'makeedu_registered'
    ) then 'registration.admission_advanced'
    when p_event_type in ('admission_batch_canceled', 'registration_enrollment_canceled')
      then 'registration.admission_canceled'
    when p_event_type in ('admission_batch_completed', 'registration_completed')
      then 'registration.registration_completed'
    when p_event_type in ('case_closed', 'registration_case_closed')
      then 'registration.case_closed'
    when p_event_type = 'track_reopened' then 'registration.track_reopened'
    when p_event_type = 'admission_message_requested'
      then 'registration.admission_message_requested'
    when p_event_type = 'admission_message_accepted'
      then 'registration.admission_message_accepted'
    when p_event_type = 'admission_message_failed'
      then 'registration.admission_message_failed'
    when p_event_type = 'admission_message_unknown'
      then 'registration.admission_message_unknown'
    when p_event_type = 'admission_message_reconciled'
      then 'registration.admission_message_reconciled'
    when p_event_type = 'admission_message_retry_released'
      then 'registration.admission_message_retry_released'
    else null
  end;
$$;

create or replace function dashboard_private.registration_render_fixed_template_v1(
  p_template text,
  p_payload jsonb
)
returns text
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  rendered text := p_template;
begin
  rendered := pg_catalog.replace(rendered, '{student_name}', coalesce(p_payload ->> 'student_name', ''));
  rendered := pg_catalog.replace(rendered, '{subject}', coalesce(p_payload ->> 'subject', ''));
  rendered := pg_catalog.replace(rendered, '{subjects}', coalesce(p_payload ->> 'subjects', ''));
  rendered := pg_catalog.replace(rendered, '{scheduled_at}', coalesce(p_payload ->> 'scheduled_at', ''));
  rendered := pg_catalog.replace(rendered, '{place}', coalesce(p_payload ->> 'place', ''));
  rendered := pg_catalog.replace(rendered, '{grade}', coalesce(p_payload ->> 'grade', ''));
  rendered := pg_catalog.replace(rendered, '{inquiry_at}', coalesce(p_payload ->> 'inquiry_at', ''));
  rendered := pg_catalog.replace(rendered, '{status}', coalesce(p_payload ->> 'status', ''));
  rendered := pg_catalog.replace(rendered, '{class_name}', coalesce(p_payload ->> 'class_name', ''));
  rendered := pg_catalog.replace(rendered, '{registration_checked}', coalesce(p_payload ->> 'registration_checked', ''));
  return rendered;
end;
$$;

create or replace function dashboard_private.write_registration_track_event_v2(
  p_task_id uuid,
  p_track_id uuid,
  p_event_type text,
  p_source text,
  p_destination text,
  p_reason_code text,
  p_metadata jsonb,
  p_actor_kind text,
  p_system_source text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.ops_tasks%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_occurred_at timestamptz := pg_catalog.clock_timestamp();
  v_event_id uuid;
  v_event_key text;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_payload jsonb;
  v_base_payload jsonb;
  v_occurrences jsonb := '[]'::jsonb;
  v_occurrence jsonb;
  v_source_type text := 'ops_task_event';
  v_source_id text;
  v_source_revision bigint;
  v_occurrence_key text;
  v_appointment_id uuid;
  v_appointment public.ops_registration_appointments%rowtype;
  v_consultation public.ops_registration_consultations%rowtype;
  v_track_ids uuid[] := array[]::uuid[];
  v_subjects text[] := array[]::text[];
  v_director_profile_ids uuid[] := array[]::uuid[];
  v_message public.ops_registration_messages%rowtype;
begin
  if p_actor_kind is null
    or p_actor_kind not in ('user', 'system', 'migration')
  then
    raise exception 'registration_event_actor_kind_invalid' using errcode = '22023';
  end if;
  if p_actor_kind = 'user' and (select auth.uid()) is null then
    raise exception 'registration_event_user_actor_required' using errcode = '42501';
  end if;
  if p_actor_kind = 'system'
    and nullif(pg_catalog.btrim(p_system_source), '') is null
  then
    raise exception 'registration_event_system_source_required' using errcode = '22023';
  end if;
  if p_actor_kind = 'system'
    and pg_catalog.btrim(p_system_source) !~ '^[a-z][a-z0-9_]{2,127}$'
  then
    raise exception 'registration_event_system_source_invalid' using errcode = '22023';
  end if;

  select task, track, detail
  into v_task, v_track, v_detail
  from public.ops_tasks task
  join public.ops_registration_subject_tracks track
    on track.task_id = task.id
  join public.ops_registration_details detail
    on detail.task_id = task.id
  where task.id = p_task_id
    and task.type = 'registration'
    and track.id = p_track_id;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name,
    before_value, after_value, created_at
  ) values (
    p_task_id,
    case when p_actor_kind = 'user' then (select auth.uid()) else null end,
    'registration_track_event',
    'registration_track:' || p_track_id::text,
    null,
    pg_catalog.jsonb_build_object(
      'version', 2,
      'event_type', p_event_type,
      'actor_profile_id', case when p_actor_kind = 'user' then (select auth.uid()) else null end,
      'actor_kind', p_actor_kind,
      'system_source', nullif(pg_catalog.btrim(p_system_source), ''),
      'track_id', p_track_id,
      'subject', v_track.subject,
      'source', p_source,
      'destination', p_destination,
      'reason_code', nullif(pg_catalog.btrim(p_reason_code), ''),
      'metadata', v_metadata,
      'occurred_at', v_occurred_at
    )::text,
    v_occurred_at
  )
  returning id into v_event_id;

  v_event_key := dashboard_private.registration_track_event_key_v1(
    p_event_type,
    v_metadata
  );
  if v_event_key is null then
    return v_event_id;
  end if;

  v_source_id := v_event_id::text;
  v_occurrence_key := v_event_id::text;
  v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'task_id', v_task.id,
    'track_id', v_track.id,
    'subject', v_track.subject,
    'student_name', v_task.student_name,
    'grade', v_detail.school_grade,
    'inquiry_at', v_detail.inquiry_at,
    'status', v_track.pipeline_status,
    'class_name', v_task.class_name,
    'registration_checked', coalesce(v_detail.admission_notice_sent, false),
    'requester_profile_id', v_task.requested_by,
    'director_profile_id', v_track.director_profile_id,
    'source', p_source,
    'destination', p_destination,
    'reason_code', nullif(pg_catalog.btrim(p_reason_code), ''),
    'actor_kind', p_actor_kind,
    'system_source', nullif(pg_catalog.btrim(p_system_source), ''),
    'source_event_id', v_event_id,
    'occurred_at', v_occurred_at
  ));
  v_base_payload := v_payload;

  if v_event_key like 'registration.visit_%' then
    if p_event_type = 'appointment_replaced' then
      if nullif(v_metadata ->> 'oldAppointmentId', '') is null
        or nullif(v_metadata ->> 'newAppointmentId', '') is null
        or nullif(v_metadata ->> 'oldNotificationRevision', '') is null
        or nullif(v_metadata ->> 'notificationRevision', '') is null
      then
        raise exception 'registration_visit_replacement_pair_required'
          using errcode = '22023';
      end if;
      -- A replacement is one raw semantic source row and one canonical event
      -- key, but the immutable old/new appointment revisions are two distinct
      -- aggregate occurrences. Replays of the other participant track resolve
      -- to these same two occurrence identities.
      v_occurrences := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'appointment_id', v_metadata ->> 'oldAppointmentId',
          'source_revision', v_metadata ->> 'oldNotificationRevision'
        ),
        pg_catalog.jsonb_build_object(
          'appointment_id', v_metadata ->> 'newAppointmentId',
          'source_revision', v_metadata ->> 'notificationRevision'
        )
      );
    else
      v_appointment_id := coalesce(
        nullif(v_metadata ->> 'appointmentId', '')::uuid,
        nullif(v_metadata ->> 'newAppointmentId', '')::uuid,
        nullif(v_metadata ->> 'oldAppointmentId', '')::uuid
      );
      if v_appointment_id is null then
        raise exception 'registration_visit_notification_appointment_required'
          using errcode = '22023';
      end if;
      v_occurrences := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'appointment_id', v_appointment_id,
        'source_revision', coalesce(
          nullif(v_metadata ->> 'notificationRevision', '')::bigint,
          nullif(v_metadata ->> 'newNotificationRevision', '')::bigint,
          nullif(v_metadata ->> 'oldNotificationRevision', '')::bigint
        )
      ));
    end if;
  elsif v_event_key = 'registration.phone_consultation_ready' then
    select consultation.* into v_consultation
    from public.ops_registration_consultations consultation
    where consultation.id = nullif(v_metadata ->> 'consultationId', '')::uuid
      and consultation.track_id = p_track_id
      and consultation.mode = 'phone';
    if not found then
      raise exception 'registration_phone_consultation_not_found' using errcode = 'P0002';
    end if;
    v_payload := pg_catalog.jsonb_strip_nulls(v_payload || pg_catalog.jsonb_build_object(
      'consultation_id', v_consultation.id,
      'director_profile_id', v_consultation.director_profile_id,
      'recipient_revision', v_consultation.recipient_revision::text,
      'phone_queue_state', p_event_type
    ));
  elsif v_event_key like 'registration.admission_message_%' then
    select message.* into v_message
    from public.ops_registration_messages message
    where message.id = nullif(v_metadata ->> 'messageId', '')::uuid
      and message.task_id = p_task_id
      and message.template_key = 'admission_application';
    if not found then
      raise exception 'registration_message_not_found' using errcode = 'P0002';
    end if;
    v_source_type := 'ops_registration_message';
    v_source_id := v_message.id::text;
    v_occurrence_key := v_message.request_key;
    v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'task_id', v_task.id,
      'track_id', v_track.id,
      'student_name', v_task.student_name,
      'message_id', v_message.id,
      'message_request_key', v_message.request_key,
      'message_status', v_message.status,
      'claim_active', v_message.claim_active,
      'actor_kind', p_actor_kind,
      'system_source', nullif(pg_catalog.btrim(p_system_source), ''),
      'source_event_id', v_event_id,
      'occurred_at', v_occurred_at
    ));
  end if;

  if pg_catalog.jsonb_array_length(v_occurrences) = 0 then
    v_occurrences := pg_catalog.jsonb_build_array('{}'::jsonb);
  end if;

  for v_occurrence in
    select entry.value
    from pg_catalog.jsonb_array_elements(v_occurrences) entry(value)
  loop
    if v_event_key like 'registration.visit_%' then
      v_appointment_id := nullif(v_occurrence ->> 'appointment_id', '')::uuid;
      select appointment.* into v_appointment
      from public.ops_registration_appointments appointment
      where appointment.id = v_appointment_id
        and appointment.task_id = p_task_id
        and appointment.kind = 'visit_consultation';
      if not found then
        raise exception 'registration_appointment_not_found' using errcode = 'P0002';
      end if;

      -- Reuse the prerequisite reminder resolver for the active participant set.
      -- A canceled/replaced visit can have no active participant row, so retain
      -- the persisted visit consultation snapshots as its cancellation fallback.
      v_track_ids := dashboard_private.registration_appointment_track_ids_v1(
        v_appointment_id
      );
      perform dashboard_private.registration_appointment_director_targets_v1(
        v_appointment_id
      );
      if pg_catalog.cardinality(v_track_ids) = 0 then
        select coalesce(
          pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id),
          array[]::uuid[]
        ) into v_track_ids
        from public.ops_registration_consultations consultation
        where consultation.appointment_id = v_appointment_id
          and consultation.mode = 'visit';
      end if;
      select
        coalesce(pg_catalog.array_agg(distinct track.subject order by track.subject), array[]::text[]),
        coalesce(pg_catalog.array_agg(distinct consultation.director_profile_id order by consultation.director_profile_id), array[]::uuid[])
      into v_subjects, v_director_profile_ids
      from pg_catalog.unnest(v_track_ids) participant(track_id)
      join public.ops_registration_subject_tracks track on track.id = participant.track_id
      left join public.ops_registration_consultations consultation
        on consultation.appointment_id = v_appointment_id
       and consultation.track_id = participant.track_id
       and consultation.mode = 'visit';

      v_source_type := 'registration_appointment';
      v_source_id := v_appointment_id::text;
      v_source_revision := coalesce(
        nullif(v_occurrence ->> 'source_revision', '')::bigint,
        v_appointment.notification_revision::bigint
      );
      if v_source_revision is distinct from v_appointment.notification_revision::bigint then
        raise exception 'registration_visit_notification_revision_mismatch'
          using errcode = '40001';
      end if;
      v_occurrence_key := 'registration:registration_appointment:'
        || v_appointment_id::text
        || ':source_revision:' || v_source_revision::text
        || ':immediate';
      v_occurred_at := v_appointment.updated_at;
      v_payload := pg_catalog.jsonb_strip_nulls(
        (v_base_payload - array[
          'track_id', 'subject', 'director_profile_id', 'source_event_id', 'occurred_at'
        ])
        || pg_catalog.jsonb_build_object(
          'appointment_id', v_appointment.id,
          'notification_revision', v_source_revision::text,
          'recipient_revision', v_appointment.recipient_revision::text,
          'scheduled_at', v_appointment.scheduled_at,
          'place', v_appointment.place,
          'appointment_status', v_appointment.status,
          'track_ids', pg_catalog.to_jsonb(v_track_ids),
          'subjects', pg_catalog.array_to_string(v_subjects, ' · '),
          'director_profile_ids', pg_catalog.to_jsonb(v_director_profile_ids),
          'occurred_at', v_occurred_at
        )
      );
      perform dashboard_private.cancel_registration_visit_superseded_v1(
        v_appointment_id,
        v_source_revision,
        'source_revision_changed'
      );
    end if;

    perform dashboard_private.record_notification_event_v1(
      'global',
      'registration',
      v_event_key,
      v_source_type,
      v_source_id,
      v_source_revision,
      v_occurrence_key,
      case when p_actor_kind = 'user' then (select auth.uid()) else null end,
      v_occurred_at,
      case when v_event_key in (
        'registration.case_created',
        'registration.registration_completed',
        'registration.case_closed'
      ) then 1 else 2 end,
      v_payload,
      null,
      null
    );
  end loop;

  return v_event_id;
end;
$$;

create or replace function dashboard_private.write_registration_track_event(
  p_task_id uuid,
  p_track_id uuid,
  p_event_type text,
  p_source text,
  p_destination text,
  p_reason text,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.write_registration_track_event_v2(
    p_task_id,
    p_track_id,
    p_event_type,
    p_source,
    p_destination,
    p_reason,
    p_metadata,
    'user',
    null
  );
end;
$$;

create or replace function dashboard_private.materialize_registration_phone_legacy_v1(
  p_source_event_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event dashboard_private.notification_events%rowtype;
  v_rule_id uuid;
  v_rule_revision bigint;
  v_template dashboard_private.notification_templates%rowtype;
  v_consultation public.ops_registration_consultations%rowtype;
  v_target_generation bigint;
  v_target_set_hash text;
  v_delivery_id uuid;
  v_ownership jsonb;
  v_result jsonb;
begin
  if p_source_event_id is null or p_request_id is null then
    raise exception 'registration_phone_projection_invalid' using errcode = '22023';
  end if;
  select event_row.* into v_event
  from dashboard_private.notification_events event_row
  where event_row.workflow_key = 'registration'
    and event_row.event_key = 'registration.phone_consultation_ready'
    and event_row.source_type = 'ops_task_event'
    and event_row.source_id = p_source_event_id::text
    and event_row.occurrence_key = p_source_event_id::text;
  if not found then
    raise exception 'registration_phone_notification_event_not_found'
      using errcode = 'P0002';
  end if;
  select consultation.* into v_consultation
  from public.ops_registration_consultations consultation
  where consultation.id = nullif(v_event.payload ->> 'consultation_id', '')::uuid
    and consultation.mode = 'phone'
    and consultation.status = 'waiting';
  if not found then
    raise exception 'registration_phone_consultation_not_found' using errcode = 'P0002';
  end if;
  select
    (snapshot.item ->> 'rule_id')::uuid,
    (snapshot.item ->> 'rule_revision')::bigint,
    template
  into v_rule_id, v_rule_revision, v_template
  from pg_catalog.jsonb_array_elements(v_event.rule_snapshot) snapshot(item)
  join dashboard_private.notification_templates template
    on template.id = (snapshot.item ->> 'template_id')::uuid
   and template.rule_id = (snapshot.item ->> 'rule_id')::uuid
  where snapshot.item ->> 'audience_key' = 'track_director'
    and snapshot.item ->> 'channel_key' = 'in_app'
    and (snapshot.item ->> 'enabled')::boolean
  limit 1;
  if not found then
    raise exception 'registration_phone_rule_not_found' using errcode = 'P0002';
  end if;

  v_target_generation := v_consultation.recipient_revision;
  v_target_set_hash := dashboard_private.notification_target_set_hash_v1(
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'target_kind', 'profile',
      'target_key', 'profile:' || v_consultation.director_profile_id::text,
      'target_profile_id', v_consultation.director_profile_id,
      'connection_key', null,
      'target_snapshot', pg_catalog.jsonb_build_object(
        'profile_id', v_consultation.director_profile_id
      )
    ))
  );
  v_delivery_id := dashboard_private.materialize_notification_delivery_v1(
    v_event.id,
    v_rule_id,
    v_rule_revision,
    v_template.id,
    v_target_generation,
    v_target_set_hash,
    'profile',
    'profile:' || v_consultation.director_profile_id::text,
    v_consultation.director_profile_id,
    null,
    pg_catalog.jsonb_build_object('profile_id', v_consultation.director_profile_id),
    dashboard_private.registration_render_fixed_template_v1(
      v_template.title_template, v_event.payload
    ),
    dashboard_private.registration_render_fixed_template_v1(
      v_template.body_template, v_event.payload
    ),
    '/admin/registration?taskId=' || (v_event.payload ->> 'task_id')
      || '&trackId=' || (v_event.payload ->> 'track_id'),
    v_event.occurred_at,
    null
  );

  if dashboard_private.notification_dispatch_enabled_v1(
    'registration', 'registration.phone_consultation_ready'
  ) then
    return pg_catalog.jsonb_build_object(
      'deliveryId', v_delivery_id,
      'acquired', false,
      'status', 'canonical_owned'
    );
  end if;

  v_ownership := public.begin_legacy_notification_dispatch_v1(
    'registration',
    v_event.occurrence_key,
    v_rule_id,
    'in_app',
    'profile:' || v_consultation.director_profile_id::text,
    v_target_generation,
    'registration_phone_legacy_bridge_v1',
    0,
    p_request_id
  );
  if not coalesce((v_ownership ->> 'acquired')::boolean, false) then
    return pg_catalog.jsonb_build_object(
      'deliveryId', v_delivery_id,
      'acquired', false,
      'status', coalesce(v_ownership ->> 'status', 'legacy_deduped')
    );
  end if;
  v_result := public.commit_legacy_notification_in_app_projection_v1(
    v_delivery_id,
    (v_ownership ->> 'claim_id')::uuid,
    (v_ownership ->> 'owner_generation')::bigint,
    (v_ownership ->> 'dispatch_token')::uuid
  );
  return v_result || pg_catalog.jsonb_build_object(
    'deliveryId', v_delivery_id,
    'acquired', true
  );
end;
$$;

create or replace function dashboard_private.cancel_registration_phone_projection_v1(
  p_consultation_id uuid,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_consultation_id is null
    or nullif(pg_catalog.btrim(p_reason), '') is null
  then
    raise exception 'registration_phone_cancel_invalid' using errcode = '22023';
  end if;
  update dashboard_private.notification_deliveries delivery
  set status = 'canceled',
      status_reason = p_reason,
      next_attempt_at = null,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      resolved_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.notification_events event_row
  where delivery.event_id = event_row.id
    and event_row.workflow_key = 'registration'
    and event_row.event_key = 'registration.phone_consultation_ready'
    and event_row.payload ->> 'consultation_id' = p_consultation_id::text
    and delivery.status in ('pending', 'retry_wait');

  update dashboard_private.notification_deliveries delivery
  set cancel_requested_at = coalesce(delivery.cancel_requested_at, pg_catalog.clock_timestamp()),
      cancel_reason = p_reason,
      updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.notification_events event_row
  where delivery.event_id = event_row.id
    and event_row.workflow_key = 'registration'
    and event_row.event_key = 'registration.phone_consultation_ready'
    and event_row.payload ->> 'consultation_id' = p_consultation_id::text
    and delivery.status = 'claimed';

  update public.dashboard_notifications notification
  set revoked_at = coalesce(notification.revoked_at, pg_catalog.clock_timestamp()),
      revoked_reason = coalesce(notification.revoked_reason, p_reason)
  from dashboard_private.notification_deliveries delivery,
       dashboard_private.notification_events event_row
  where notification.source_delivery_id = delivery.id
    and delivery.event_id = event_row.id
    and event_row.workflow_key = 'registration'
    and event_row.event_key = 'registration.phone_consultation_ready'
    and event_row.payload ->> 'consultation_id' = p_consultation_id::text
    and notification.read_at is null
    and notification.revoked_at is null;

  delete from public.dashboard_notifications notification
  where notification.type = 'registration_consultation'
    and notification.read_at is null
    and notification.source_delivery_id is null
    and notification.metadata ->> 'consultationId' = p_consultation_id::text;
end;
$$;

create or replace function dashboard_private.bump_registration_phone_recipient_revision_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.mode = 'phone'
    and new.mode = 'phone'
    and new.director_profile_id is distinct from old.director_profile_id
  then
    new.recipient_revision = old.recipient_revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists bump_registration_phone_recipient_revision_v1
  on public.ops_registration_consultations;
create trigger bump_registration_phone_recipient_revision_v1
before update of director_profile_id on public.ops_registration_consultations
for each row execute function dashboard_private.bump_registration_phone_recipient_revision_v1();

create or replace function dashboard_private.write_registration_phone_queue_event_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_event_type text;
  v_source_event_id uuid;
  v_request_id uuid;
  v_actor_kind text := case when (select auth.uid()) is null then 'system' else 'user' end;
  v_system_source text := case when (select auth.uid()) is null
    then 'registration_phone_queue_trigger' else null end;
begin
  if new.mode <> 'phone' then return new; end if;
  select track.task_id into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = new.track_id;
  if v_task_id is null then return new; end if;

  if tg_op = 'INSERT' and new.status = 'waiting' then
    v_event_type := 'phone_queue_created';
  elsif tg_op = 'UPDATE'
    and new.status = 'waiting'
    and new.director_profile_id is distinct from old.director_profile_id
  then
    v_event_type := 'phone_queue_reassigned';
  elsif tg_op = 'UPDATE'
    and old.status = 'waiting'
    and new.status in ('completed', 'canceled')
  then
    v_event_type := 'phone_queue_completed';
  end if;
  if v_event_type is null then return new; end if;

  if v_event_type = 'phone_queue_completed' then
    perform dashboard_private.cancel_registration_phone_projection_v1(
      new.id,
      case when new.status = 'completed' then 'source_status_changed' else 'source_canceled' end
    );
    return new;
  end if;
  if v_event_type = 'phone_queue_reassigned' then
    perform dashboard_private.cancel_registration_phone_projection_v1(
      new.id,
      'recipient_revoked'
    );
  end if;

  v_source_event_id := dashboard_private.write_registration_track_event_v2(
    v_task_id,
    new.track_id,
    v_event_type,
    case when v_event_type = 'phone_queue_created' then 'unassigned' else old.director_profile_id::text end,
    new.director_profile_id::text,
    null,
    pg_catalog.jsonb_build_object(
      'consultationId', new.id,
      'directorProfileId', new.director_profile_id,
      'recipientRevision', new.recipient_revision::text
    ),
    v_actor_kind,
    v_system_source
  );
  v_request_id := dashboard_private.notification_deterministic_uuid_v1(
    'registration-phone-legacy-projection-v1',
    v_source_event_id::text || '|' || new.recipient_revision::text
  );
  perform dashboard_private.materialize_registration_phone_legacy_v1(
    v_source_event_id,
    v_request_id
  );
  return new;
end;
$$;

drop trigger if exists write_registration_phone_queue_event_v1
  on public.ops_registration_consultations;
create trigger write_registration_phone_queue_event_v1
after insert or update of director_profile_id, status
on public.ops_registration_consultations
for each row execute function dashboard_private.write_registration_phone_queue_event_v1();

create or replace function dashboard_private.remove_registration_phone_direct_projection_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type = 'registration_consultation'
    and new.source_delivery_id is null
    and new.metadata ? 'consultationId'
    and not (new.metadata ? 'appointmentId')
    and exists (
      select 1
      from public.ops_registration_consultations consultation
      where consultation.id = nullif(new.metadata ->> 'consultationId', '')::uuid
        and consultation.mode = 'phone'
    )
    and exists (
      select 1
      from dashboard_private.notification_events event_row
      where event_row.workflow_key = 'registration'
        and event_row.event_key = 'registration.phone_consultation_ready'
        and event_row.payload ->> 'consultation_id' = new.metadata ->> 'consultationId'
    )
  then
    delete from public.dashboard_notifications notification
    where notification.id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists remove_registration_phone_direct_projection_v1
  on public.dashboard_notifications;
create trigger remove_registration_phone_direct_projection_v1
after insert on public.dashboard_notifications
for each row execute function dashboard_private.remove_registration_phone_direct_projection_v1();

create or replace function dashboard_private.cancel_registration_visit_superseded_v1(
  p_appointment_id uuid,
  p_keep_revision bigint,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update dashboard_private.notification_deliveries delivery
  set status = 'canceled',
      status_reason = p_reason,
      next_attempt_at = null,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      resolved_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.notification_events event_row
  where delivery.event_id = event_row.id
    and event_row.workflow_key = 'registration'
    and event_row.source_type = 'registration_appointment'
    and event_row.source_id = p_appointment_id::text
    and event_row.event_key like 'registration.visit_%'
    and event_row.source_revision is distinct from p_keep_revision
    and delivery.status in ('pending', 'retry_wait');

  update dashboard_private.notification_deliveries delivery
  set cancel_requested_at = coalesce(delivery.cancel_requested_at, pg_catalog.clock_timestamp()),
      cancel_reason = p_reason,
      updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.notification_events event_row
  where delivery.event_id = event_row.id
    and event_row.workflow_key = 'registration'
    and event_row.source_type = 'registration_appointment'
    and event_row.source_id = p_appointment_id::text
    and event_row.event_key like 'registration.visit_%'
    and event_row.source_revision is distinct from p_keep_revision
    and delivery.status = 'claimed';
end;
$$;

create or replace function public.get_registration_visit_legacy_dispatch_plan_v1(
  p_appointment_id uuid,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_appointment public.ops_registration_appointments%rowtype;
  v_task public.ops_tasks%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_actor_role text;
  v_items jsonb;
begin
  if p_appointment_id is null or p_actor_profile_id is null then
    raise exception 'registration_visit_legacy_plan_invalid' using errcode = '22023';
  end if;
  select appointment.* into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id
    and appointment.kind = 'visit_consultation';
  if not found then
    raise exception 'registration_appointment_not_found' using errcode = 'P0002';
  end if;
  select task.* into v_task
  from public.ops_tasks task
  where task.id = v_appointment.task_id
    and task.type = 'registration';
  if not found then
    raise exception 'registration_task_not_found' using errcode = 'P0002';
  end if;
  select profile.role into v_actor_role
  from public.profiles profile
  where profile.id = p_actor_profile_id;
  if not (
    v_actor_role in ('admin', 'staff')
    or v_task.requested_by = p_actor_profile_id
    or v_task.assignee_id = p_actor_profile_id
    or v_task.secondary_assignee_id = p_actor_profile_id
  ) then
    raise exception 'registration_visit_legacy_plan_forbidden' using errcode = '42501';
  end if;
  select event_row.* into v_event
  from dashboard_private.notification_events event_row
  where event_row.workflow_key = 'registration'
    and event_row.source_type = 'registration_appointment'
    and event_row.source_id = p_appointment_id::text
    and event_row.source_revision = v_appointment.notification_revision
    and event_row.occurrence_key = 'registration:registration_appointment:'
      || p_appointment_id::text
      || ':source_revision:' || v_appointment.notification_revision::text
      || ':immediate'
    and event_row.event_key in (
      'registration.visit_scheduled',
      'registration.visit_rescheduled',
      'registration.visit_replaced',
      'registration.visit_subject_deselected',
      'registration.visit_canceled'
    )
  order by event_row.created_at desc, event_row.id desc
  limit 1;
  if not found then
    raise exception 'registration_visit_notification_event_not_found'
      using errcode = 'P0002';
  end if;

  with participant as (
    select
      consultation.track_id,
      track.subject,
      consultation.director_profile_id,
      coalesce(nullif(profile.name, ''), nullif(profile.email, ''), '상담 책임자') as director_name
    from public.ops_registration_consultations consultation
    join public.ops_registration_subject_tracks track on track.id = consultation.track_id
    join public.profiles profile on profile.id = consultation.director_profile_id
    where consultation.appointment_id = p_appointment_id
      and consultation.mode = 'visit'
  ), director_target as (
    select
      participant.director_profile_id,
      pg_catalog.string_agg(distinct participant.subject, ' · ' order by participant.subject) as subjects,
      pg_catalog.string_agg(
        distinct participant.subject || ': ' || participant.director_name,
        E'\n' order by participant.subject || ': ' || participant.director_name
      ) as subject_directors
    from participant
    group by participant.director_profile_id
  ), enabled_rule as (
    select
      (snapshot.item ->> 'rule_id')::uuid as id,
      (snapshot.item ->> 'rule_revision')::bigint as revision,
      (snapshot.item ->> 'template_id')::uuid as active_template_id,
      snapshot.item ->> 'audience_key' as audience_key,
      snapshot.item ->> 'channel_key' as channel_key,
      template.checksum as template_checksum,
      template.title_template,
      template.body_template
    from pg_catalog.jsonb_array_elements(v_event.rule_snapshot) snapshot(item)
    join dashboard_private.notification_templates template
      on template.id = (snapshot.item ->> 'template_id')::uuid
     and template.rule_id = (snapshot.item ->> 'rule_id')::uuid
    where (snapshot.item ->> 'enabled')::boolean
      and (
        (snapshot.item ->> 'audience_key' = 'track_director'
          and snapshot.item ->> 'channel_key' = 'in_app')
        or (snapshot.item ->> 'audience_key' = 'management_team'
          and snapshot.item ->> 'channel_key' = 'google_chat')
      )
  ), target as (
    select
      enabled_rule.*,
      'profile'::text as target_kind,
      'profile:' || director_target.director_profile_id::text as target_key,
      director_target.director_profile_id as target_profile_id,
      null::text as connection_key,
      pg_catalog.jsonb_build_object(
        'profile_id', director_target.director_profile_id,
        'subjects', director_target.subjects
      ) as target_snapshot,
      director_target.subjects,
      director_target.subject_directors
    from enabled_rule
    join director_target on enabled_rule.audience_key = 'track_director'

    union all

    select
      enabled_rule.*,
      'connection',
      'connection:google_chat.management',
      null::uuid,
      'google_chat.management',
      pg_catalog.jsonb_build_object('connection_key', 'google_chat.management'),
      coalesce((select pg_catalog.string_agg(distinct participant.subject, ' · ' order by participant.subject) from participant), ''),
      coalesce((select pg_catalog.string_agg(distinct participant.subject || ': ' || participant.director_name, E'\n' order by participant.subject || ': ' || participant.director_name) from participant), '')
    from enabled_rule
    where enabled_rule.audience_key = 'management_team'
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'eventId', v_event.id,
    'eventKey', v_event.event_key,
    'occurrenceKey', v_event.occurrence_key,
    'ruleId', target.id,
    'ruleRevision', target.revision::text,
    'templateId', target.active_template_id,
    'templateChecksum', target.template_checksum,
    'channelKey', target.channel_key,
    'audienceKey', target.audience_key,
    'targetGeneration', v_appointment.recipient_revision::text,
    'targetKind', target.target_kind,
    'targetKey', target.target_key,
    'targetProfileId', target.target_profile_id,
    'connectionKey', target.connection_key,
    'targetSnapshot', target.target_snapshot,
    'renderedTitle', dashboard_private.registration_render_fixed_template_v1(
      target.title_template,
      v_event.payload || pg_catalog.jsonb_build_object('subjects', target.subjects)
    ),
    'renderedBody', dashboard_private.registration_render_fixed_template_v1(
      target.body_template,
      v_event.payload || pg_catalog.jsonb_build_object(
        'subjects', target.subjects,
        'subject_directors', target.subject_directors
      )
    ),
    'href', '/admin/registration?taskId=' || v_task.id::text
      || '&appointmentId=' || v_appointment.id::text || '&view=calendar',
    'scheduledFor', v_event.occurred_at
  ) order by target.id, target.target_key), '[]'::jsonb)
  into v_items
  from target;

  return pg_catalog.jsonb_build_object(
    'appointmentId', v_appointment.id,
    'notificationRevision', v_appointment.notification_revision,
    'recipientRevision', v_appointment.recipient_revision::text,
    'notifiedTrackIds', coalesce(v_event.payload -> 'track_ids', '[]'::jsonb),
    'sourceEventId', v_event.source_id,
    'items', v_items
  );
end;
$$;

create or replace function public.materialize_registration_visit_legacy_in_app_v1(
  p_appointment_id uuid,
  p_rule_id uuid,
  p_profile_id uuid,
  p_target_generation bigint,
  p_actor_profile_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  v_item jsonb;
  v_delivery_id uuid;
  v_target_set_hash text;
  v_ownership jsonb;
begin
  if p_appointment_id is null or p_rule_id is null or p_profile_id is null
    or p_target_generation is null or p_target_generation < 1
    or p_actor_profile_id is null or p_request_id is null
  then
    raise exception 'registration_visit_projection_invalid' using errcode = '22023';
  end if;
  v_plan := public.get_registration_visit_legacy_dispatch_plan_v1(
    p_appointment_id,
    p_actor_profile_id
  );
  select value into v_item
  from pg_catalog.jsonb_array_elements(v_plan -> 'items') entry(value)
  where value ->> 'ruleId' = p_rule_id::text
    and value ->> 'targetProfileId' = p_profile_id::text
    and value ->> 'targetGeneration' = p_target_generation::text
    and value ->> 'channelKey' = 'in_app'
  limit 1;
  if v_item is null then
    raise exception 'registration_visit_projection_forbidden' using errcode = '42501';
  end if;
  v_target_set_hash := dashboard_private.notification_target_set_hash_v1(
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'target_kind', v_item ->> 'targetKind',
      'target_key', v_item ->> 'targetKey',
      'target_profile_id', v_item ->> 'targetProfileId',
      'connection_key', null,
      'target_snapshot', v_item -> 'targetSnapshot'
    ))
  );
  v_delivery_id := dashboard_private.materialize_notification_delivery_v1(
    (v_item ->> 'eventId')::uuid,
    p_rule_id,
    (v_item ->> 'ruleRevision')::bigint,
    (v_item ->> 'templateId')::uuid,
    p_target_generation,
    v_target_set_hash,
    'profile',
    v_item ->> 'targetKey',
    p_profile_id,
    null,
    v_item -> 'targetSnapshot',
    v_item ->> 'renderedTitle',
    v_item ->> 'renderedBody',
    v_item ->> 'href',
    (v_item ->> 'scheduledFor')::timestamptz,
    null
  );
  if dashboard_private.notification_dispatch_enabled_v1(
    'registration', v_item ->> 'eventKey'
  ) then
    return pg_catalog.jsonb_build_object(
      'deliveryId', v_delivery_id,
      'acquired', false,
      'status', 'canonical_owned'
    );
  end if;
  v_ownership := public.begin_legacy_notification_dispatch_v1(
    'registration',
    v_item ->> 'occurrenceKey',
    p_rule_id,
    'in_app',
    v_item ->> 'targetKey',
    p_target_generation,
    'registration_visit_legacy_bridge_v1',
    0,
    p_request_id
  );
  return pg_catalog.jsonb_build_object(
    'deliveryId', v_delivery_id,
    'acquired', coalesce((v_ownership ->> 'acquired')::boolean, false),
    'claimId', v_ownership ->> 'claim_id',
    'ownerGeneration', v_ownership ->> 'owner_generation',
    'dispatchToken', v_ownership ->> 'dispatch_token'
  );
end;
$$;

create or replace function public.commit_registration_visit_legacy_in_app_v1(
  p_appointment_id uuid,
  p_rule_id uuid,
  p_profile_id uuid,
  p_target_generation bigint,
  p_actor_profile_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_materialized jsonb;
  v_committed jsonb;
begin
  v_materialized := public.materialize_registration_visit_legacy_in_app_v1(
    p_appointment_id,
    p_rule_id,
    p_profile_id,
    p_target_generation,
    p_actor_profile_id,
    p_request_id
  );
  if not coalesce((v_materialized ->> 'acquired')::boolean, false) then
    return v_materialized;
  end if;
  v_committed := public.commit_legacy_notification_in_app_projection_v1(
    (v_materialized ->> 'deliveryId')::uuid,
    (v_materialized ->> 'claimId')::uuid,
    (v_materialized ->> 'ownerGeneration')::bigint,
    (v_materialized ->> 'dispatchToken')::uuid
  );
  return v_materialized || v_committed || pg_catalog.jsonb_build_object(
    'committed', true
  );
end;
$$;

create or replace function public.materialize_registration_visit_legacy_google_chat_v1(
  p_appointment_id uuid,
  p_rule_id uuid,
  p_target_generation bigint,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  v_item jsonb;
  v_delivery_id uuid;
  v_target_set_hash text;
begin
  if p_appointment_id is null or p_rule_id is null
    or p_target_generation is null or p_target_generation < 1
    or p_actor_profile_id is null
  then
    raise exception 'registration_visit_google_chat_invalid' using errcode = '22023';
  end if;
  v_plan := public.get_registration_visit_legacy_dispatch_plan_v1(
    p_appointment_id,
    p_actor_profile_id
  );
  select value into v_item
  from pg_catalog.jsonb_array_elements(v_plan -> 'items') entry(value)
  where value ->> 'ruleId' = p_rule_id::text
    and value ->> 'targetGeneration' = p_target_generation::text
    and value ->> 'channelKey' = 'google_chat'
    and value ->> 'connectionKey' = 'google_chat.management'
  limit 1;
  if v_item is null then
    raise exception 'registration_visit_google_chat_forbidden' using errcode = '42501';
  end if;
  v_target_set_hash := dashboard_private.notification_target_set_hash_v1(
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'target_kind', 'connection',
      'target_key', v_item ->> 'targetKey',
      'target_profile_id', null,
      'connection_key', 'google_chat.management',
      'target_snapshot', v_item -> 'targetSnapshot'
    ))
  );
  v_delivery_id := dashboard_private.materialize_notification_delivery_v1(
    (v_item ->> 'eventId')::uuid,
    p_rule_id,
    (v_item ->> 'ruleRevision')::bigint,
    (v_item ->> 'templateId')::uuid,
    p_target_generation,
    v_target_set_hash,
    'connection',
    v_item ->> 'targetKey',
    null,
    'google_chat.management',
    v_item -> 'targetSnapshot',
    v_item ->> 'renderedTitle',
    v_item ->> 'renderedBody',
    v_item ->> 'href',
    (v_item ->> 'scheduledFor')::timestamptz,
    null
  );
  return v_item || pg_catalog.jsonb_build_object(
    'deliveryId', v_delivery_id,
    'canonicalOwned', dashboard_private.notification_dispatch_enabled_v1(
      'registration', v_item ->> 'eventKey'
    )
  );
end;
$$;

create or replace function public.begin_registration_visit_legacy_google_chat_v1(
  p_appointment_id uuid,
  p_rule_id uuid,
  p_target_generation bigint,
  p_actor_profile_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  v_item jsonb;
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_expected_owner_generation bigint := 0;
  v_attempt_request_id uuid;
  v_ownership jsonb;
begin
  if p_appointment_id is null or p_rule_id is null
    or p_target_generation is null or p_target_generation < 1
    or p_actor_profile_id is null or p_request_id is null
  then
    raise exception 'registration_visit_google_chat_begin_invalid'
      using errcode = '22023';
  end if;
  v_plan := public.get_registration_visit_legacy_dispatch_plan_v1(
    p_appointment_id,
    p_actor_profile_id
  );
  select value into v_item
  from pg_catalog.jsonb_array_elements(v_plan -> 'items') entry(value)
  where value ->> 'ruleId' = p_rule_id::text
    and value ->> 'targetGeneration' = p_target_generation::text
    and value ->> 'channelKey' = 'google_chat'
    and value ->> 'connectionKey' = 'google_chat.management'
  limit 1;
  if v_item is null then
    raise exception 'registration_visit_google_chat_begin_forbidden'
      using errcode = '42501';
  end if;
  if dashboard_private.notification_dispatch_enabled_v1(
    'registration', v_item ->> 'eventKey'
  ) then
    return pg_catalog.jsonb_build_object(
      'acquired', false,
      'status', 'canonical_owned'
    );
  end if;

  select ownership.* into v_claim
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.workflow_key = 'registration'
    and ownership.occurrence_key = v_item ->> 'occurrenceKey'
    and ownership.rule_id = p_rule_id
    and ownership.channel_key = 'google_chat'
    and ownership.target_key = v_item ->> 'targetKey'
    and ownership.target_generation = p_target_generation
  for update of ownership;
  if found then
    v_expected_owner_generation := v_claim.owner_generation;
    -- A definite rejection is the only visit outcome that an explicit failed-
    -- target retry may re-arm. Sent and delivery_unknown remain terminal so a
    -- blind retry can never call Google Chat twice.
    if v_claim.owner_kind = 'legacy'
      and v_claim.state = 'closed'
      and v_claim.terminal_outcome = 'failed'
    then
      v_expected_owner_generation := v_claim.owner_generation + 1;
      update dashboard_private.notification_dispatch_ownership_claims ownership
      set owner_generation = v_expected_owner_generation,
          state = 'reserved',
          dispatch_started_at = null,
          dispatch_token = null,
          provider_reference = null,
          terminal_outcome = null,
          updated_at = pg_catalog.clock_timestamp()
      where ownership.id = v_claim.id;
      insert into dashboard_private.notification_audit_logs(
        entity_kind, entity_id, action, actor_profile_id, actor_kind,
        before_summary, after_summary, reason_code
      ) values (
        'notification_dispatch_ownership', v_claim.id::text,
        'legacy_failed_target_retry_rearmed', p_actor_profile_id, 'user',
        pg_catalog.jsonb_build_object(
          'owner_generation', v_claim.owner_generation::text,
          'outcome', 'failed'
        ),
        pg_catalog.jsonb_build_object(
          'owner_generation', v_expected_owner_generation::text,
          'state', 'reserved'
        ),
        'explicit_failed_target_retry'
      );
    end if;
  end if;

  v_attempt_request_id := dashboard_private.notification_deterministic_uuid_v1(
    'registration-visit-google-chat-attempt-v1',
    p_request_id::text || '|' || v_expected_owner_generation::text
  );
  v_ownership := public.begin_legacy_notification_dispatch_v1(
    'registration',
    v_item ->> 'occurrenceKey',
    p_rule_id,
    'google_chat',
    v_item ->> 'targetKey',
    p_target_generation,
    'registration_visit_legacy_bridge_v1',
    v_expected_owner_generation,
    v_attempt_request_id
  );
  return v_ownership || pg_catalog.jsonb_build_object(
    'request_id', p_request_id
  );
end;
$$;

create or replace function public.finalize_registration_visit_legacy_google_chat_v1(
  p_delivery_id uuid,
  p_claim_id uuid,
  p_owner_generation bigint,
  p_dispatch_token uuid,
  p_outcome text,
  p_provider_reference text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
begin
  if p_delivery_id is null or p_claim_id is null
    or p_owner_generation is null or p_owner_generation < 0
    or p_dispatch_token is null
    or p_outcome not in ('sent', 'failed', 'delivery_unknown')
    or pg_catalog.octet_length(coalesce(p_provider_reference, '')) > 512
  then
    raise exception 'registration_visit_google_chat_finalize_invalid'
      using errcode = '22023';
  end if;
  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
    and delivery.channel_key = 'google_chat'
  for update of delivery;
  if not found then
    raise exception 'registration_visit_google_chat_delivery_not_found'
      using errcode = 'P0002';
  end if;
  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_delivery.event_id
    and event_row.workflow_key = 'registration'
    and event_row.event_key like 'registration.visit_%';
  select ownership.* into v_claim
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.id = p_claim_id
  for update of ownership;
  if not found
    or v_claim.workflow_key <> v_event.workflow_key
    or v_claim.occurrence_key <> v_event.occurrence_key
    or v_claim.rule_id <> v_delivery.rule_id
    or v_claim.channel_key <> v_delivery.channel_key
    or v_claim.target_key <> v_delivery.target_key
    or v_claim.target_generation <> v_delivery.target_generation
    or v_claim.owner_kind <> 'legacy'
    or v_claim.owner_generation <> p_owner_generation
    or v_claim.dispatch_token <> p_dispatch_token
  then
    raise exception 'registration_visit_google_chat_ownership_mismatch'
      using errcode = '40001';
  end if;
  perform public.finalize_legacy_notification_dispatch_v1(
    p_claim_id,
    p_owner_generation,
    p_dispatch_token,
    p_outcome,
    p_provider_reference
  );
  return pg_catalog.jsonb_build_object(
    'deliveryId', p_delivery_id,
    'claimId', p_claim_id,
    'status', p_outcome,
    'canonicalDeliveryStatus', v_delivery.status,
    'canonicalDeliveryReason', v_delivery.status_reason
  );
end;
$$;

create or replace function public.list_registration_legacy_source_ids_v1(
  p_task_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task public.ops_tasks%rowtype;
  v_role text;
  v_source_ids jsonb;
begin
  if v_actor is null or p_task_id is null then
    raise exception 'registration_legacy_source_access_denied' using errcode = '42501';
  end if;
  select task.* into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration';
  if not found then
    raise exception 'registration_task_not_found' using errcode = 'P0002';
  end if;
  select profile.role into v_role from public.profiles profile where profile.id = v_actor;
  if not (
    v_role in ('admin', 'staff')
    or v_task.requested_by = v_actor
    or v_task.assignee_id = v_actor
    or v_task.secondary_assignee_id = v_actor
  ) then
    raise exception 'registration_legacy_source_access_denied' using errcode = '42501';
  end if;
  select coalesce(pg_catalog.jsonb_agg(event_row.id order by event_row.created_at, event_row.id), '[]'::jsonb)
  into v_source_ids
  from public.ops_task_events event_row
  join dashboard_private.notification_events canonical
    on canonical.workflow_key = 'registration'
   and canonical.source_type = 'ops_task_event'
   and canonical.source_id = event_row.id::text
   and canonical.occurrence_key = event_row.id::text
  where event_row.task_id = p_task_id
    and event_row.event_type = 'registration_track_event'
    and canonical.event_key in (
      'registration.case_created',
      'registration.registration_completed',
      'registration.case_closed'
    );
  return pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'sourceEventIds', v_source_ids
  );
end;
$$;

create or replace function public.get_registration_core_legacy_dispatch_plan_v1(
  p_source_event_id uuid,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_source public.ops_task_events%rowtype;
  v_task public.ops_tasks%rowtype;
  v_canonical dashboard_private.notification_events%rowtype;
  v_actor_role text;
  v_items jsonb;
begin
  if p_source_event_id is null or p_actor_profile_id is null then
    raise exception 'registration_core_legacy_plan_invalid' using errcode = '22023';
  end if;
  select event_row.* into v_source
  from public.ops_task_events event_row
  where event_row.id = p_source_event_id
    and event_row.event_type = 'registration_track_event';
  if not found then
    raise exception 'registration_notification_source_not_found' using errcode = 'P0002';
  end if;
  select task.* into v_task
  from public.ops_tasks task
  where task.id = v_source.task_id
    and task.type = 'registration';
  if not found then
    raise exception 'registration_task_not_found' using errcode = 'P0002';
  end if;
  select profile.role into v_actor_role
  from public.profiles profile
  where profile.id = p_actor_profile_id;
  if not (
    v_source.actor_id = p_actor_profile_id
    or v_task.requested_by = p_actor_profile_id
    or v_task.assignee_id = p_actor_profile_id
    or v_task.secondary_assignee_id = p_actor_profile_id
    or v_actor_role in ('admin', 'staff')
  ) then
    raise exception 'registration_core_legacy_plan_forbidden' using errcode = '42501';
  end if;
  select event_row.* into v_canonical
  from dashboard_private.notification_events event_row
  where event_row.workflow_key = 'registration'
    and event_row.source_type = 'ops_task_event'
    and event_row.source_id = p_source_event_id::text
    and event_row.occurrence_key = p_source_event_id::text
    and event_row.event_key in (
      'registration.case_created',
      'registration.registration_completed',
      'registration.case_closed'
    );
  if not found then
    raise exception 'registration_core_canonical_event_not_found' using errcode = 'P0002';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'eventId', v_canonical.id,
    'eventKey', v_canonical.event_key,
    'occurrenceKey', v_canonical.occurrence_key,
    'ruleId', (snapshot.item ->> 'rule_id')::uuid,
    'ruleRevision', snapshot.item ->> 'rule_revision',
    'templateId', template.id,
    'templateChecksum', template.checksum,
    'channelKey', snapshot.item ->> 'channel_key',
    'audienceKey', snapshot.item ->> 'audience_key',
    'targetGeneration', '0',
    'targetKind', 'connection',
    'targetKey', 'connection:google_chat.management',
    'targetProfileId', null,
    'connectionKey', 'google_chat.management',
    'targetSnapshot', pg_catalog.jsonb_build_object('connection_key', 'google_chat.management'),
    'renderedTitle', dashboard_private.registration_render_fixed_template_v1(
      template.title_template, v_canonical.payload
    ),
    'renderedBody', dashboard_private.registration_render_fixed_template_v1(
      template.body_template, v_canonical.payload
    ),
    'href', '/admin/registration?taskId=' || v_task.id::text,
    'scheduledFor', v_canonical.occurred_at
  ) order by (snapshot.item ->> 'rule_id')::uuid), '[]'::jsonb)
  into v_items
  from pg_catalog.jsonb_array_elements(v_canonical.rule_snapshot) snapshot(item)
  join dashboard_private.notification_templates template
    on template.id = (snapshot.item ->> 'template_id')::uuid
   and template.rule_id = (snapshot.item ->> 'rule_id')::uuid
  where snapshot.item ->> 'audience_key' = 'management_team'
    and snapshot.item ->> 'channel_key' = 'google_chat'
    and (snapshot.item ->> 'enabled')::boolean;

  return pg_catalog.jsonb_build_object(
    'sourceEventId', p_source_event_id,
    'taskId', v_task.id,
    'items', v_items
  );
end;
$$;

create or replace function dashboard_private.registration_message_track_id_v1(
  p_task_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select track.id
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by case track.subject when '영어' then 1 else 2 end, track.id
  limit 1;
$$;

create or replace function dashboard_private.reconcile_registration_admission_delivery_state_v1(
  p_message_id uuid,
  p_outcome text,
  p_provider_reference text,
  p_allow_failed_to_sent boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_message public.ops_registration_messages%rowtype;
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_ownership dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_provider_reference text := nullif(pg_catalog.btrim(p_provider_reference), '');
  v_target_status text;
  v_target_reason text;
  v_failed_to_sent_correction boolean;
  v_unknown_resolution boolean;
  v_expected_attempt_count integer;
  v_updated_count integer := 0;
begin
  if p_message_id is null
    or p_outcome not in ('sent', 'failed', 'delivery_unknown')
    or p_allow_failed_to_sent is null
    or pg_catalog.octet_length(coalesce(v_provider_reference, '')) > 512
  then
    raise exception 'registration_admission_delivery_reconciliation_invalid'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'registration-admission-message:' || p_message_id::text, 0
  ));
  select message.* into v_message
  from public.ops_registration_messages message
  where message.id = p_message_id
    and message.template_key = 'admission_application'
  for update of message;
  if not found then
    raise exception 'registration_message_not_found' using errcode = 'P0002';
  end if;
  if v_message.status is distinct from (case p_outcome
    when 'sent' then 'accepted'
    when 'failed' then 'failed'
    else 'unknown'
  end) then
    raise exception 'registration_admission_delivery_business_conflict'
      using errcode = '40001';
  end if;
  v_provider_reference := coalesce(
    v_provider_reference,
    nullif(pg_catalog.btrim(v_message.provider_message_id), ''),
    nullif(pg_catalog.btrim(v_message.provider_group_id), '')
  );
  if pg_catalog.octet_length(coalesce(v_provider_reference, '')) > 512 then
    raise exception 'registration_admission_delivery_reconciliation_invalid'
      using errcode = '22023';
  end if;

  v_target_status := p_outcome;
  v_target_reason := case p_outcome
    when 'sent' then null
    when 'failed' then 'provider_definite_rejection'
    else 'provider_ambiguous_response'
  end;

  for v_delivery in
    select delivery.*
    from dashboard_private.notification_deliveries delivery
    join dashboard_private.notification_events event_row
      on event_row.id = delivery.event_id
    where event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.admission_message_requested'
      and event_row.source_type = 'ops_registration_message'
      and event_row.source_id = p_message_id::text
      and event_row.occurrence_key = v_message.request_key
      and delivery.channel_key = 'customer_message'
      and delivery.target_key = 'registration-message:' || p_message_id::text
    order by delivery.id
    for update of delivery
  loop
    select event_row.* into strict v_event
    from dashboard_private.notification_events event_row
    where event_row.id = v_delivery.event_id;

    select ownership.* into v_ownership
    from dashboard_private.notification_dispatch_ownership_claims ownership
    where ownership.workflow_key = v_event.workflow_key
      and ownership.occurrence_key = v_event.occurrence_key
      and ownership.rule_id = v_delivery.rule_id
      and ownership.channel_key = v_delivery.channel_key
      and ownership.target_key = v_delivery.target_key
      and ownership.target_generation = v_delivery.target_generation
    for update of ownership;
    if not found then
      raise exception 'registration_admission_delivery_ownership_missing'
        using errcode = '40001';
    end if;

    if v_ownership.dispatch_started_at is not null
      and v_ownership.dispatch_token is not null
    then
      if v_ownership.owner_generation >= 2147483647 then
        raise exception 'registration_admission_delivery_reconciliation_invalid'
          using errcode = '22023';
      end if;
      v_expected_attempt_count := (v_ownership.owner_generation + 1)::integer;
    else
      v_expected_attempt_count := v_delivery.attempt_count;
    end if;

    -- A legacy SOLAPI owner closes only the shared ownership/business evidence.
    -- The canonical delivery is an immutable shadow/rollback record and must
    -- remain skipped, canceled, or otherwise unchanged by legacy recovery.
    if v_ownership.owner_kind = 'legacy' then
      if v_ownership.state = 'closed'
        and v_ownership.terminal_outcome = p_outcome
        and v_ownership.provider_reference is not distinct from v_provider_reference
      then
        continue;
      end if;

      v_failed_to_sent_correction :=
        p_allow_failed_to_sent
        and p_outcome = 'sent'
        and v_message.status = 'accepted'
        and v_message.claim_active
        and v_provider_reference is not null
        and v_ownership.state = 'closed'
        and v_ownership.terminal_outcome = 'failed';
      v_unknown_resolution :=
        p_outcome in ('sent', 'failed')
        and v_message.status = case p_outcome
          when 'sent' then 'accepted'
          else 'failed'
        end
        and (p_outcome <> 'sent' or v_provider_reference is not null)
        and v_ownership.state = 'closed'
        and (
          v_ownership.terminal_outcome is null
          or v_ownership.terminal_outcome in ('delivery_unknown', p_outcome)
        );

      if v_ownership.state = 'closed'
        and v_ownership.terminal_outcome is not null
        and v_ownership.terminal_outcome is distinct from p_outcome
        and not v_failed_to_sent_correction
        and not v_unknown_resolution
      then
        raise exception 'registration_admission_delivery_ownership_terminal_conflict'
          using errcode = '40001';
      end if;
      if v_ownership.state not in ('dispatch_started', 'closed') then
        raise exception 'registration_admission_delivery_reconciliation_not_allowed'
          using errcode = '55000';
      end if;

      update dashboard_private.notification_dispatch_ownership_claims ownership
      set state = 'closed',
          provider_reference = v_provider_reference,
          terminal_outcome = p_outcome,
          updated_at = pg_catalog.clock_timestamp()
      where ownership.id = v_ownership.id;

      insert into dashboard_private.notification_audit_logs(
        entity_kind, entity_id, action, actor_profile_id, actor_kind,
        before_summary, after_summary, reason_code
      ) values (
        'notification_dispatch_ownership', v_ownership.id::text,
        case when v_failed_to_sent_correction or v_unknown_resolution
          then 'registration_admission_legacy_ownership_evidence_corrected'
          else 'registration_admission_legacy_ownership_evidence_recovered' end,
        (select auth.uid()),
        case when (select auth.uid()) is null then 'system' else 'user' end,
        pg_catalog.jsonb_build_object(
          'state', v_ownership.state,
          'terminal_outcome', v_ownership.terminal_outcome
        ),
        pg_catalog.jsonb_build_object(
          'state', 'closed',
          'terminal_outcome', p_outcome,
          'canonical_delivery_status', v_delivery.status,
          'canonical_delivery_unchanged', true
        ),
        case when v_failed_to_sent_correction
          or (v_unknown_resolution and p_outcome = 'sent')
          then 'provider_acceptance_evidence'
          else 'provider_terminal_evidence' end
      );
      v_updated_count := v_updated_count + 1;
      continue;
    end if;

    if v_delivery.status = v_target_status
      and v_ownership.state = 'closed'
      and v_ownership.terminal_outcome = p_outcome
      and v_ownership.provider_reference is not distinct from v_provider_reference
      and v_delivery.attempt_count >= v_expected_attempt_count
      and v_delivery.max_attempts >= v_expected_attempt_count
      and (
        p_outcome <> 'sent'
        or v_delivery.provider_message_id is not distinct from coalesce(
          v_provider_reference, v_delivery.provider_message_id
        )
      )
    then
      continue;
    end if;

    v_failed_to_sent_correction :=
      p_allow_failed_to_sent
      and v_delivery.status = 'failed'
      and p_outcome = 'sent'
      and v_message.status = 'accepted'
      and v_message.claim_active
      and v_provider_reference is not null
      and v_ownership.state = 'closed'
      and v_ownership.terminal_outcome = 'failed';
    v_unknown_resolution :=
      v_delivery.status = 'delivery_unknown'
      and p_outcome in ('sent', 'failed')
      and v_message.status = case p_outcome
        when 'sent' then 'accepted'
        else 'failed'
      end
      and (p_outcome <> 'sent' or v_provider_reference is not null)
      and v_ownership.state = 'closed'
      and (
        v_ownership.terminal_outcome is null
        or v_ownership.terminal_outcome in ('delivery_unknown', p_outcome)
      );

    if v_delivery.status in ('sent', 'failed')
      and v_delivery.status is distinct from v_target_status
      and not v_failed_to_sent_correction
    then
      raise exception 'registration_admission_delivery_terminal_conflict'
        using errcode = '40001';
    end if;
    if v_ownership.state = 'closed'
      and v_ownership.terminal_outcome is not null
      and v_ownership.terminal_outcome is distinct from p_outcome
      and not v_failed_to_sent_correction
      and not v_unknown_resolution
    then
      raise exception 'registration_admission_delivery_ownership_terminal_conflict'
        using errcode = '40001';
    end if;
    if v_delivery.status not in (
      'pending', 'claimed', 'sending', 'retry_wait', 'delivery_unknown',
      'skipped', v_target_status
    ) then
      raise exception 'registration_admission_delivery_reconciliation_not_allowed'
        using errcode = '55000';
    end if;
    if v_delivery.status = 'skipped'
      and v_delivery.status_reason not in ('legacy_skipped', 'shadow_mode')
    then
      raise exception 'registration_admission_delivery_reconciliation_not_allowed'
        using errcode = '55000';
    end if;

    update dashboard_private.notification_deliveries delivery
    set status = v_target_status,
        status_reason = v_target_reason,
        claimed_by = null,
        claim_token = null,
        lease_expires_at = null,
        next_attempt_at = null,
        attempt_count = greatest(delivery.attempt_count, v_expected_attempt_count),
        max_attempts = greatest(delivery.max_attempts, v_expected_attempt_count),
        provider_message_id = case when p_outcome = 'sent'
          then coalesce(v_provider_reference, delivery.provider_message_id)
          else delivery.provider_message_id end,
        last_error_code = case p_outcome
          when 'sent' then null
          when 'failed' then 'registration_admission_provider_definite_rejection'
          else 'registration_admission_provider_ambiguous_response'
        end,
        last_error_summary = case when p_outcome = 'sent' then null
          else 'registration admission delivery reconciled from provider evidence' end,
        sent_at = case when p_outcome = 'sent'
          then coalesce(delivery.sent_at, pg_catalog.clock_timestamp())
          else null end,
        resolved_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where delivery.id = v_delivery.id;

    update dashboard_private.notification_dispatch_ownership_claims ownership
    set state = 'closed',
        provider_reference = v_provider_reference,
        terminal_outcome = p_outcome,
        updated_at = pg_catalog.clock_timestamp()
    where ownership.id = v_ownership.id;

    insert into dashboard_private.notification_audit_logs(
      entity_kind, entity_id, action, actor_profile_id, actor_kind,
      before_summary, after_summary, reason_code
    ) values (
      'notification_delivery', v_delivery.id::text,
      case when v_failed_to_sent_correction or v_unknown_resolution
        then 'registration_admission_delivery_evidence_corrected'
        else 'registration_admission_delivery_recovered' end,
      (select auth.uid()),
      case when (select auth.uid()) is null then 'system' else 'user' end,
      pg_catalog.jsonb_build_object(
        'status', v_delivery.status,
        'ownership_state', v_ownership.state,
        'terminal_outcome', v_ownership.terminal_outcome
      ),
      pg_catalog.jsonb_build_object(
        'status', v_target_status,
        'ownership_state', 'closed',
        'terminal_outcome', p_outcome
      ),
      case when v_failed_to_sent_correction
        or (v_unknown_resolution and p_outcome = 'sent')
        then 'provider_acceptance_evidence'
        else 'provider_terminal_evidence' end
    );
    v_updated_count := v_updated_count + 1;
  end loop;

  return pg_catalog.jsonb_build_object(
    'messageId', p_message_id,
    'outcome', p_outcome,
    'updatedCount', v_updated_count
  );
end;
$$;

create or replace function public.claim_registration_admission_message(
  p_task_id uuid,
  p_message_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response jsonb;
  v_track_id uuid;
  v_message public.ops_registration_messages%rowtype;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_parent_phone_digits text;
  v_dispatch_started boolean := false;
begin
  if (select auth.uid()) is null
    or coalesce(public.current_dashboard_role(), '') not in ('admin', 'staff')
  then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_response := dashboard_private.claim_registration_admission_message_impl(
    p_task_id,
    p_message_request_key
  );
  if coalesce((v_response ->> 'shouldSend')::boolean, false) then
    v_track_id := dashboard_private.registration_message_track_id_v1(p_task_id);
    if v_track_id is null then
      raise exception 'registration_track_not_found' using errcode = 'P0002';
    end if;
    perform dashboard_private.write_registration_track_event_v2(
      p_task_id,
      v_track_id,
      'admission_message_requested',
      'enrollment_decided',
      'admission_message_pending',
      null,
      pg_catalog.jsonb_build_object(
        'messageId', v_response ->> 'messageId',
        'requestKey', v_response ->> 'messageRequestKey',
        'status', 'pending'
      ),
      'user',
      null
    );
  elsif v_response ->> 'claimStatus' = 'pending'
    and coalesce((v_response ->> 'claimActive')::boolean, false)
    and v_response ->> 'messageRequestKey' = pg_catalog.btrim(p_message_request_key)
  then
    select message.* into strict v_message
    from public.ops_registration_messages message
    where message.id = (v_response ->> 'messageId')::uuid
      and message.task_id = p_task_id
      and message.request_key = pg_catalog.btrim(p_message_request_key)
      and message.template_key = 'admission_application'
      and message.status = 'pending'
      and message.claim_active;
    select task.* into strict v_task
    from public.ops_tasks task
    where task.id = p_task_id and task.type = 'registration';
    select detail.* into strict v_detail
    from public.ops_registration_details detail
    where detail.task_id = p_task_id;
    select exists (
      select 1
      from dashboard_private.notification_events event_row
      join dashboard_private.notification_dispatch_ownership_claims ownership
        on ownership.workflow_key = event_row.workflow_key
       and ownership.occurrence_key = event_row.occurrence_key
       and ownership.channel_key = 'customer_message'
       and ownership.target_key = 'registration-message:' || v_message.id::text
      where event_row.workflow_key = 'registration'
        and event_row.event_key = 'registration.admission_message_requested'
        and event_row.source_type = 'ops_registration_message'
        and event_row.source_id = v_message.id::text
        and ownership.state in ('dispatch_started', 'closed')
    ) into v_dispatch_started;
    v_parent_phone_digits := pg_catalog.regexp_replace(
      coalesce(v_detail.parent_phone, ''), '\D+', '', 'g'
    );
    if not v_dispatch_started and (
      v_parent_phone_digits !~ '^01(0|1|[6-9])[0-9]{7,8}$'
      or pg_catalog.right(v_parent_phone_digits, 4) is distinct from v_message.recipient_last4
    ) then
      raise exception 'registration_frozen_recipient_unavailable' using errcode = '40001';
    end if;
    v_response := v_response || pg_catalog.jsonb_build_object(
      'claimStatus', 'pending',
      'messageRequestKey', pg_catalog.btrim(p_message_request_key),
      'shouldSend', true,
      'replayed', true,
      'studentName', v_task.student_name,
      'parentPhone', case when v_dispatch_started then '' else v_parent_phone_digits end,
      'commonRevision', v_detail.common_revision
    );
  end if;
  return v_response;
end;
$$;

create or replace function public.finalize_registration_admission_message(
  p_message_id uuid,
  p_result text,
  p_provider_result jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_response jsonb;
  v_track_id uuid;
  v_event_type text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'registration-admission-message:' || p_message_id::text, 0
  ));
  v_response := dashboard_private.finalize_registration_admission_message_impl(
    p_message_id,
    p_result,
    p_provider_result
  );
  perform dashboard_private.reconcile_registration_admission_delivery_state_v1(
    p_message_id,
    case v_response ->> 'currentStatus'
      when 'accepted' then 'sent'
      when 'failed' then 'failed'
      else 'delivery_unknown'
    end,
    coalesce(
      nullif(pg_catalog.btrim(p_provider_result ->> 'providerMessageId'), ''),
      nullif(pg_catalog.btrim(p_provider_result ->> 'providerGroupId'), ''),
      nullif(pg_catalog.btrim(p_provider_result ->> 'providerStatusCode'), ''),
      nullif(pg_catalog.btrim(p_provider_result ->> 'errorMessage'), '')
    ),
    p_result = 'accepted'
      and coalesce((v_response ->> 'applied')::boolean, false)
      and v_response ->> 'currentStatus' = 'accepted'
      and coalesce((v_response ->> 'claimActive')::boolean, false)
  );
  if coalesce((v_response ->> 'applied')::boolean, false) then
    v_track_id := dashboard_private.registration_message_track_id_v1(
      (v_response ->> 'taskId')::uuid
    );
    v_event_type := case v_response ->> 'currentStatus'
      when 'accepted' then 'admission_message_accepted'
      when 'failed' then 'admission_message_failed'
      else 'admission_message_unknown'
    end;
    perform dashboard_private.write_registration_track_event_v2(
      (v_response ->> 'taskId')::uuid,
      v_track_id,
      v_event_type,
      'pending',
      v_response ->> 'currentStatus',
      null,
      pg_catalog.jsonb_build_object(
        'messageId', p_message_id,
        'requestKey', v_response ->> 'messageRequestKey',
        'status', v_response ->> 'currentStatus'
      ),
      'system',
      'solapi_registration_route'
    );
  end if;
  return v_response;
end;
$$;

create or replace function public.reconcile_registration_admission_message(
  p_message_id uuid,
  p_resolution text,
  p_provider_evidence jsonb,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response jsonb;
  v_track_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'registration-admission-message:' || p_message_id::text, 0
  ));
  v_response := dashboard_private.reconcile_registration_admission_message_impl(
    p_message_id,
    p_resolution,
    p_provider_evidence,
    p_reason,
    p_request_key
  );
  perform dashboard_private.reconcile_registration_admission_delivery_state_v1(
    p_message_id,
    case v_response ->> 'nextStatus'
      when 'accepted' then 'sent'
      else 'failed'
    end,
    coalesce(
      nullif(pg_catalog.btrim(p_provider_evidence ->> 'providerMessageId'), ''),
      nullif(pg_catalog.btrim(p_provider_evidence ->> 'providerGroupId'), ''),
      nullif(pg_catalog.btrim(p_provider_evidence ->> 'observedStatusCode'), ''),
      nullif(pg_catalog.btrim(p_provider_evidence ->> 'observedStatusMessage'), '')
    ),
    v_response ->> 'previousStatus' = 'failed'
      and coalesce((v_response ->> 'previousClaimActive')::boolean, false)
      and v_response ->> 'nextStatus' = 'accepted'
      and coalesce((v_response ->> 'claimActive')::boolean, false)
  );
  delete from public.ops_task_events event_row
  where event_row.id = (
    select candidate.id
    from public.ops_task_events candidate
    where candidate.task_id = (v_response ->> 'taskId')::uuid
      and candidate.event_type = 'registration_admission_message_reconciled'
      and candidate.field_name = 'registration_admission_message:' || p_message_id::text
    order by candidate.created_at desc, candidate.id desc
    limit 1
  );
  if not exists (
    select 1
    from dashboard_private.notification_events event_row
    where event_row.workflow_key = 'registration'
      and event_row.source_type = 'ops_registration_message'
      and event_row.source_id = p_message_id::text
      and event_row.event_key = 'registration.admission_message_reconciled'
  ) then
    v_track_id := dashboard_private.registration_message_track_id_v1(
      (v_response ->> 'taskId')::uuid
    );
    perform dashboard_private.write_registration_track_event_v2(
      (v_response ->> 'taskId')::uuid,
      v_track_id,
      'admission_message_reconciled',
      v_response ->> 'previousStatus',
      v_response ->> 'nextStatus',
      null,
      pg_catalog.jsonb_build_object(
        'messageId', p_message_id,
        'requestKey', v_response ->> 'messageRequestKey',
        'status', v_response ->> 'nextStatus'
      ),
      'user',
      null
    );
  end if;
  return v_response;
end;
$$;

create or replace function public.release_registration_admission_message_retry(
  p_message_id uuid,
  p_provider_evidence jsonb,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response jsonb;
  v_track_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'registration-admission-message:' || p_message_id::text, 0
  ));
  v_response := dashboard_private.release_registration_admission_message_retry_impl(
    p_message_id,
    p_provider_evidence,
    p_reason,
    p_request_key
  );
  perform dashboard_private.reconcile_registration_admission_delivery_state_v1(
    p_message_id,
    'failed',
    coalesce(
      nullif(pg_catalog.btrim(p_provider_evidence ->> 'providerMessageId'), ''),
      nullif(pg_catalog.btrim(p_provider_evidence ->> 'providerGroupId'), ''),
      nullif(pg_catalog.btrim(p_provider_evidence ->> 'observedStatusCode'), ''),
      nullif(pg_catalog.btrim(p_provider_evidence ->> 'observedStatusMessage'), ''),
      nullif(pg_catalog.btrim(p_reason), '')
    ),
    false
  );
  delete from public.ops_task_events event_row
  where event_row.id = (
    select candidate.id
    from public.ops_task_events candidate
    where candidate.task_id = (v_response ->> 'taskId')::uuid
      and candidate.event_type = 'registration_admission_message_retry_released'
      and candidate.field_name = 'registration_admission_message:' || p_message_id::text
    order by candidate.created_at desc, candidate.id desc
    limit 1
  );
  if not exists (
    select 1
    from dashboard_private.notification_events event_row
    where event_row.workflow_key = 'registration'
      and event_row.source_type = 'ops_registration_message'
      and event_row.source_id = p_message_id::text
      and event_row.event_key = 'registration.admission_message_retry_released'
  ) then
    v_track_id := dashboard_private.registration_message_track_id_v1(
      (v_response ->> 'taskId')::uuid
    );
    perform dashboard_private.write_registration_track_event_v2(
      (v_response ->> 'taskId')::uuid,
      v_track_id,
      'admission_message_retry_released',
      'failed_hold',
      'retry_released',
      null,
      pg_catalog.jsonb_build_object(
        'messageId', p_message_id,
        'requestKey', v_response ->> 'messageRequestKey',
        'status', v_response ->> 'status'
      ),
      'user',
      null
    );
  end if;
  return v_response;
end;
$$;

create or replace function public.begin_registration_admission_delivery_v1(
  p_message_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_message public.ops_registration_messages%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_rule_id uuid;
  v_rule_revision bigint;
  v_template dashboard_private.notification_templates%rowtype;
  v_existing_ledger dashboard_private.notification_request_ledger%rowtype;
  v_target_key text;
  v_target_set_hash text;
  v_delivery_id uuid;
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_claim_token uuid;
  v_begun jsonb;
  v_ownership jsonb;
begin
  if auth.role() <> 'service_role' or p_message_id is null or p_request_id is null then
    raise exception 'registration_admission_delivery_forbidden' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'registration-admission-message:' || p_message_id::text, 0
  ));
  select message.* into v_message
  from public.ops_registration_messages message
  where message.id = p_message_id
    and message.template_key = 'admission_application'
    and message.claim_active
    and message.status = 'pending';
  if not found then
    raise exception 'registration_message_not_found' using errcode = 'P0002';
  end if;
  select event_row.* into v_event
  from dashboard_private.notification_events event_row
  where event_row.workflow_key = 'registration'
    and event_row.event_key = 'registration.admission_message_requested'
    and event_row.source_type = 'ops_registration_message'
    and event_row.source_id = p_message_id::text
    and event_row.occurrence_key = v_message.request_key;
  if not found then
    raise exception 'registration_admission_notification_event_not_found'
      using errcode = 'P0002';
  end if;
  select
    (snapshot.item ->> 'rule_id')::uuid,
    (snapshot.item ->> 'rule_revision')::bigint,
    template
  into v_rule_id, v_rule_revision, v_template
  from pg_catalog.jsonb_array_elements(v_event.rule_snapshot) snapshot(item)
  join dashboard_private.notification_templates template
    on template.id = (snapshot.item ->> 'template_id')::uuid
   and template.rule_id = (snapshot.item ->> 'rule_id')::uuid
  where snapshot.item ->> 'audience_key' = 'applicant_guardian'
    and snapshot.item ->> 'channel_key' = 'customer_message'
    and (snapshot.item ->> 'enabled')::boolean
  limit 1;
  if not found then
    raise exception 'registration_admission_notification_rule_not_found'
      using errcode = 'P0002';
  end if;

  v_target_key := 'registration-message:' || v_message.id::text;
  v_target_set_hash := dashboard_private.notification_target_set_hash_v1(
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'target_kind', 'customer_endpoint',
      'target_key', v_target_key,
      'target_profile_id', null,
      'connection_key', null,
      'target_snapshot', pg_catalog.jsonb_build_object(
        'message_id', v_message.id,
        'request_key_hash', pg_catalog.md5(v_message.request_key)
      )
    ))
  );
  v_delivery_id := dashboard_private.materialize_notification_delivery_v1(
    v_event.id,
    v_rule_id,
    v_rule_revision,
    v_template.id,
    0,
    v_target_set_hash,
    'customer_endpoint',
    v_target_key,
    null,
    null,
    pg_catalog.jsonb_build_object(
      'message_id', v_message.id,
      'request_key_hash', pg_catalog.md5(v_message.request_key)
    ),
    dashboard_private.registration_render_fixed_template_v1(
      v_template.title_template, v_event.payload
    ),
    dashboard_private.registration_render_fixed_template_v1(
      v_template.body_template, v_event.payload
    ),
    '/admin/registration?taskId=' || v_message.task_id::text,
    v_event.occurred_at,
    null
  );
  if dashboard_private.notification_dispatch_enabled_v1(
    'registration', 'registration.admission_message_requested'
  ) then
    select ownership.* into v_claim
    from dashboard_private.notification_dispatch_ownership_claims ownership
    where ownership.workflow_key = 'registration'
      and ownership.occurrence_key = v_event.occurrence_key
      and ownership.rule_id = v_rule_id
      and ownership.channel_key = 'customer_message'
      and ownership.target_key = v_target_key
      and ownership.target_generation = 0
      and ownership.owner_kind = 'canonical'
    for update of ownership;
    if not found then
      raise exception 'registration_admission_canonical_ownership_missing'
        using errcode = '40001';
    end if;
    select delivery.* into strict v_delivery
    from dashboard_private.notification_deliveries delivery
    where delivery.id = v_delivery_id
    for update of delivery;
    if v_claim.state = 'dispatch_started' then
      return pg_catalog.jsonb_build_object(
        'deliveryId', v_delivery_id,
        'acquired', false,
        'ownerKind', 'canonical',
        'requiresUnknownFinalization', true,
        'claimId', v_claim.id,
        'ownerGeneration', v_claim.owner_generation::text,
        'templateChecksum', v_template.checksum,
        'claimToken', v_delivery.claim_token,
        'dispatchToken', v_claim.dispatch_token,
        'status', 'dispatch_already_started'
      );
    end if;
    if v_claim.state <> 'reserved' or v_delivery.status not in ('pending', 'retry_wait') then
      return pg_catalog.jsonb_build_object(
        'deliveryId', v_delivery_id,
        'acquired', false,
        'ownerKind', 'canonical',
        'requiresUnknownFinalization', false,
        'claimId', v_claim.id,
        'ownerGeneration', v_claim.owner_generation::text,
        'templateChecksum', v_template.checksum,
        'status', 'canonical_owned'
      );
    end if;
    v_claim_token := p_request_id;
    update dashboard_private.notification_deliveries delivery
    set status = 'claimed',
        status_reason = null,
        claimed_by = 'registration-solapi-route-v1',
        claim_token = v_claim_token,
        lease_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes',
        next_attempt_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where delivery.id = v_delivery_id
      and delivery.status in ('pending', 'retry_wait');
    if not found then
      raise exception 'registration_admission_canonical_claim_conflict'
        using errcode = '40001';
    end if;
    v_begun := public.begin_notification_delivery_send_v1(
      v_delivery_id,
      v_claim_token
    );
    if v_begun ->> 'status' <> 'sending' then
      return pg_catalog.jsonb_build_object(
        'deliveryId', v_delivery_id,
        'acquired', false,
        'ownerKind', 'canonical',
        'requiresUnknownFinalization', false,
        'claimId', v_claim.id,
        'ownerGeneration', v_claim.owner_generation::text,
        'templateChecksum', v_template.checksum,
        'status', v_begun ->> 'status'
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'deliveryId', v_delivery_id,
      'acquired', true,
      'ownerKind', 'canonical',
      'requiresUnknownFinalization', false,
      'claimId', v_claim.id,
      'ownerGeneration', v_claim.owner_generation::text,
      'templateChecksum', v_template.checksum,
      'claimToken', v_claim_token,
      'dispatchToken', v_begun ->> 'dispatch_token',
      'status', 'dispatch_started'
    );
  end if;

  select ledger.* into v_existing_ledger
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = p_request_id;
  if found then
    return pg_catalog.jsonb_build_object(
      'deliveryId', v_delivery_id,
      'acquired', false,
      'ownerKind', 'legacy',
      'status', 'legacy_replayed',
      'requiresUnknownFinalization', coalesce(
        (v_existing_ledger.response_payload ->> 'acquired')::boolean,
        false
      ),
      'claimId', v_existing_ledger.response_payload ->> 'claim_id',
      'ownerGeneration', v_existing_ledger.response_payload ->> 'owner_generation',
      'templateChecksum', v_template.checksum,
      'dispatchToken', v_existing_ledger.response_payload ->> 'dispatch_token'
    );
  end if;
  v_ownership := public.begin_legacy_notification_dispatch_v1(
    'registration',
    v_event.occurrence_key,
    v_rule_id,
    'customer_message',
    v_target_key,
    0,
    'registration_solapi_legacy_bridge_v1',
    0,
    p_request_id
  );
  return pg_catalog.jsonb_build_object(
    'deliveryId', v_delivery_id,
    'acquired', coalesce((v_ownership ->> 'acquired')::boolean, false),
    'ownerKind', 'legacy',
    'claimId', v_ownership ->> 'claim_id',
    'ownerGeneration', v_ownership ->> 'owner_generation',
    'templateChecksum', v_template.checksum,
    'dispatchToken', v_ownership ->> 'dispatch_token',
    'status', v_ownership ->> 'status'
  );
end;
$$;

create or replace function public.finalize_registration_admission_delivery_v1(
  p_delivery_id uuid,
  p_claim_id uuid,
  p_owner_generation bigint,
  p_dispatch_token uuid,
  p_outcome text,
  p_provider_reference text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_result jsonb;
begin
  if auth.role() <> 'service_role'
    or p_delivery_id is null
    or p_claim_id is null
    or p_owner_generation is null or p_owner_generation < 0
    or p_dispatch_token is null
    or p_outcome not in ('sent', 'failed', 'delivery_unknown')
    or pg_catalog.octet_length(coalesce(p_provider_reference, '')) > 512
  then
    raise exception 'registration_admission_delivery_finalize_forbidden'
      using errcode = '42501';
  end if;
  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
    and delivery.channel_key = 'customer_message'
  for update of delivery;
  if not found then
    raise exception 'registration_admission_delivery_not_found' using errcode = 'P0002';
  end if;
  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_delivery.event_id
    and event_row.workflow_key = 'registration'
    and event_row.event_key = 'registration.admission_message_requested';
  select ownership.* into v_claim
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.id = p_claim_id
  for update of ownership;
  if not found
    or v_claim.workflow_key <> v_event.workflow_key
    or v_claim.occurrence_key <> v_event.occurrence_key
    or v_claim.rule_id <> v_delivery.rule_id
    or v_claim.channel_key <> v_delivery.channel_key
    or v_claim.target_key <> v_delivery.target_key
    or v_claim.target_generation <> v_delivery.target_generation
    or v_claim.owner_kind <> 'legacy'
    or v_claim.owner_generation <> p_owner_generation
    or v_claim.dispatch_token <> p_dispatch_token
  then
    raise exception 'registration_admission_delivery_ownership_mismatch'
      using errcode = '40001';
  end if;
  v_result := public.finalize_legacy_notification_dispatch_v1(
    p_claim_id,
    p_owner_generation,
    p_dispatch_token,
    p_outcome,
    p_provider_reference
  );
  return v_result || pg_catalog.jsonb_build_object(
    'deliveryId', p_delivery_id,
    'canonicalDeliveryStatus', v_delivery.status,
    'canonicalDeliveryReason', v_delivery.status_reason
  );
end;
$$;

create or replace function public.complete_registration_admission_delivery_v1(
  p_message_id uuid,
  p_delivery_id uuid,
  p_claim_id uuid,
  p_owner_generation bigint,
  p_claim_token uuid,
  p_dispatch_token uuid,
  p_result text,
  p_provider_result jsonb,
  p_outcome text,
  p_provider_reference text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_delivery dashboard_private.notification_deliveries%rowtype;
  v_event dashboard_private.notification_events%rowtype;
  v_claim dashboard_private.notification_dispatch_ownership_claims%rowtype;
  v_response jsonb;
  v_track_id uuid;
  v_event_type text;
  v_delivery_result jsonb;
begin
  if (select auth.role()) <> 'service_role'
    or p_message_id is null
    or p_delivery_id is null
    or p_claim_id is null
    or p_owner_generation is null or p_owner_generation < 0
    or p_dispatch_token is null
    or p_result not in ('accepted', 'failed', 'unknown')
    or p_provider_result is null
    or pg_catalog.jsonb_typeof(p_provider_result) <> 'object'
    or p_outcome not in ('sent', 'failed', 'delivery_unknown')
    or (p_result = 'accepted') <> (p_outcome = 'sent')
    or (p_result = 'failed') <> (p_outcome = 'failed')
    or (p_result = 'unknown') <> (p_outcome = 'delivery_unknown')
    or pg_catalog.octet_length(coalesce(p_provider_reference, '')) > 512
  then
    raise exception 'registration_admission_delivery_complete_invalid'
      using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'registration-admission-message:' || p_message_id::text, 0
  ));
  select delivery.* into v_delivery
  from dashboard_private.notification_deliveries delivery
  where delivery.id = p_delivery_id
    and delivery.channel_key = 'customer_message'
  for update of delivery;
  if not found then
    raise exception 'registration_admission_delivery_not_found' using errcode = 'P0002';
  end if;
  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = v_delivery.event_id
    and event_row.workflow_key = 'registration'
    and event_row.event_key = 'registration.admission_message_requested'
    and event_row.source_type = 'ops_registration_message'
    and event_row.source_id = p_message_id::text;
  select ownership.* into v_claim
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.id = p_claim_id
  for update of ownership;
  if not found
    or v_claim.workflow_key <> v_event.workflow_key
    or v_claim.occurrence_key <> v_event.occurrence_key
    or v_claim.rule_id <> v_delivery.rule_id
    or v_claim.channel_key <> v_delivery.channel_key
    or v_claim.target_key <> v_delivery.target_key
    or v_claim.target_generation <> v_delivery.target_generation
    or v_claim.owner_generation <> p_owner_generation
    or v_claim.state <> 'dispatch_started'
    or v_claim.dispatch_token <> p_dispatch_token
    or (v_claim.owner_kind = 'canonical' and (
      p_claim_token is null
      or v_delivery.claim_token <> p_claim_token
      or v_delivery.status <> 'sending'
    ))
    or (v_claim.owner_kind = 'legacy' and p_claim_token is not null)
  then
    raise exception 'registration_admission_delivery_ownership_mismatch'
      using errcode = '40001';
  end if;

  -- The business evidence row, canonical terminal event and dispatch ownership
  -- close in this one transaction. A crash cannot leave either side half done.
  v_response := dashboard_private.finalize_registration_admission_message_impl(
    p_message_id,
    p_result,
    p_provider_result
  );
  if v_response ->> 'currentStatus' is distinct from p_result then
    raise exception 'registration_admission_delivery_business_conflict'
      using errcode = '40001';
  end if;
  if coalesce((v_response ->> 'applied')::boolean, false) then
    v_track_id := dashboard_private.registration_message_track_id_v1(
      (v_response ->> 'taskId')::uuid
    );
    v_event_type := case v_response ->> 'currentStatus'
      when 'accepted' then 'admission_message_accepted'
      when 'failed' then 'admission_message_failed'
      else 'admission_message_unknown'
    end;
    perform dashboard_private.write_registration_track_event_v2(
      (v_response ->> 'taskId')::uuid,
      v_track_id,
      v_event_type,
      'pending',
      v_response ->> 'currentStatus',
      null,
      pg_catalog.jsonb_build_object(
        'messageId', p_message_id,
        'requestKey', v_response ->> 'messageRequestKey',
        'status', v_response ->> 'currentStatus'
      ),
      'system',
      'solapi_registration_route'
    );
  end if;

  if v_claim.owner_kind = 'canonical' then
    v_delivery_result := public.finalize_notification_delivery_v1(
      p_delivery_id,
      p_claim_token,
      p_outcome,
      case p_outcome
        when 'sent' then null
        when 'failed' then 'provider_definite_rejection'
        else 'provider_ambiguous_response'
      end,
      case when p_outcome = 'sent' then nullif(p_provider_reference, '') else null end,
      null,
      case when p_outcome = 'sent' then null else p_outcome end,
      case when p_outcome = 'sent' then null else nullif(p_provider_reference, '') end,
      null
    );
  else
    v_delivery_result := public.finalize_registration_admission_delivery_v1(
      p_delivery_id,
      p_claim_id,
      p_owner_generation,
      p_dispatch_token,
      p_outcome,
      p_provider_reference
    );
  end if;
  return v_response || pg_catalog.jsonb_build_object(
    'deliveryId', p_delivery_id,
    'deliveryOutcome', p_outcome,
    'ownerKind', v_claim.owner_kind,
    'deliveryResult', v_delivery_result
  );
end;
$$;

create or replace function public.registration_notification_handoffs_runtime_version()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select 1;
$$;

revoke all on function dashboard_private.registration_track_event_key_v1(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_render_fixed_template_v1(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.write_registration_track_event_v2(
  uuid, uuid, text, text, text, text, jsonb, text, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.write_registration_track_event(
  uuid, uuid, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.materialize_registration_phone_legacy_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.cancel_registration_phone_projection_v1(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.bump_registration_phone_recipient_revision_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.write_registration_phone_queue_event_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.remove_registration_phone_direct_projection_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.cancel_registration_visit_superseded_v1(uuid, bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_message_track_id_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.reconcile_registration_admission_delivery_state_v1(
  uuid, text, text, boolean
) from public, anon, authenticated, service_role;

revoke all on function public.get_registration_visit_legacy_dispatch_plan_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.materialize_registration_visit_legacy_in_app_v1(
  uuid, uuid, uuid, bigint, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.commit_registration_visit_legacy_in_app_v1(
  uuid, uuid, uuid, bigint, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.materialize_registration_visit_legacy_google_chat_v1(
  uuid, uuid, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.begin_registration_visit_legacy_google_chat_v1(
  uuid, uuid, bigint, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.finalize_registration_visit_legacy_google_chat_v1(
  uuid, uuid, bigint, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.list_registration_legacy_source_ids_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_registration_core_legacy_dispatch_plan_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_registration_admission_message(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_registration_admission_message(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_registration_admission_message(
  uuid, text, jsonb, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.release_registration_admission_message_retry(
  uuid, jsonb, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.begin_registration_admission_delivery_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_registration_admission_delivery_v1(
  uuid, uuid, bigint, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.complete_registration_admission_delivery_v1(
  uuid, uuid, uuid, bigint, uuid, uuid, text, jsonb, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.registration_notification_handoffs_runtime_version()
  from public, anon, authenticated, service_role;

grant execute on function public.get_registration_visit_legacy_dispatch_plan_v1(uuid, uuid)
  to service_role;
grant execute on function public.materialize_registration_visit_legacy_in_app_v1(
  uuid, uuid, uuid, bigint, uuid, uuid
) to service_role;
grant execute on function public.commit_registration_visit_legacy_in_app_v1(
  uuid, uuid, uuid, bigint, uuid, uuid
) to service_role;
grant execute on function public.materialize_registration_visit_legacy_google_chat_v1(
  uuid, uuid, bigint, uuid
) to service_role;
grant execute on function public.begin_registration_visit_legacy_google_chat_v1(
  uuid, uuid, bigint, uuid, uuid
) to service_role;
grant execute on function public.finalize_registration_visit_legacy_google_chat_v1(
  uuid, uuid, bigint, uuid, text, text
) to service_role;
grant execute on function public.list_registration_legacy_source_ids_v1(uuid)
  to authenticated;
grant execute on function public.get_registration_core_legacy_dispatch_plan_v1(uuid, uuid)
  to service_role;
grant execute on function public.claim_registration_admission_message(uuid, text)
  to authenticated;
grant execute on function public.finalize_registration_admission_message(uuid, text, jsonb)
  to service_role;
grant execute on function dashboard_private.reconcile_registration_admission_delivery_state_v1(
  uuid, text, text, boolean
) to service_role;
grant execute on function public.reconcile_registration_admission_message(
  uuid, text, jsonb, text, text
) to authenticated;
grant execute on function public.release_registration_admission_message_retry(
  uuid, jsonb, text, text
) to authenticated;
grant execute on function public.begin_registration_admission_delivery_v1(uuid, uuid)
  to service_role;
grant execute on function public.finalize_registration_admission_delivery_v1(
  uuid, uuid, bigint, uuid, text, text
) to service_role;
grant execute on function public.complete_registration_admission_delivery_v1(
  uuid, uuid, uuid, bigint, uuid, uuid, text, jsonb, text, text
) to service_role;
grant execute on function public.registration_notification_handoffs_runtime_version()
  to authenticated, service_role;

alter function dashboard_private.registration_track_event_key_v1(text, jsonb) owner to postgres;
alter function dashboard_private.registration_render_fixed_template_v1(text, jsonb) owner to postgres;
alter function dashboard_private.write_registration_track_event_v2(
  uuid, uuid, text, text, text, text, jsonb, text, text
) owner to postgres;
alter function dashboard_private.write_registration_track_event(
  uuid, uuid, text, text, text, text, jsonb
) owner to postgres;
alter function dashboard_private.materialize_registration_phone_legacy_v1(uuid, uuid)
  owner to postgres;
alter function dashboard_private.cancel_registration_phone_projection_v1(uuid, text)
  owner to postgres;
alter function dashboard_private.bump_registration_phone_recipient_revision_v1()
  owner to postgres;
alter function dashboard_private.write_registration_phone_queue_event_v1()
  owner to postgres;
alter function dashboard_private.remove_registration_phone_direct_projection_v1()
  owner to postgres;
alter function dashboard_private.cancel_registration_visit_superseded_v1(uuid, bigint, text)
  owner to postgres;
alter function public.get_registration_visit_legacy_dispatch_plan_v1(uuid, uuid)
  owner to postgres;
alter function public.materialize_registration_visit_legacy_in_app_v1(
  uuid, uuid, uuid, bigint, uuid, uuid
) owner to postgres;
alter function public.commit_registration_visit_legacy_in_app_v1(
  uuid, uuid, uuid, bigint, uuid, uuid
) owner to postgres;
alter function public.materialize_registration_visit_legacy_google_chat_v1(
  uuid, uuid, bigint, uuid
) owner to postgres;
alter function public.begin_registration_visit_legacy_google_chat_v1(
  uuid, uuid, bigint, uuid, uuid
) owner to postgres;
alter function public.finalize_registration_visit_legacy_google_chat_v1(
  uuid, uuid, bigint, uuid, text, text
) owner to postgres;
alter function public.list_registration_legacy_source_ids_v1(uuid) owner to postgres;
alter function public.get_registration_core_legacy_dispatch_plan_v1(uuid, uuid)
  owner to postgres;
alter function dashboard_private.registration_message_track_id_v1(uuid) owner to postgres;
alter function dashboard_private.reconcile_registration_admission_delivery_state_v1(
  uuid, text, text, boolean
) owner to postgres;
alter function public.claim_registration_admission_message(uuid, text) owner to postgres;
alter function public.finalize_registration_admission_message(uuid, text, jsonb) owner to postgres;
alter function public.reconcile_registration_admission_message(uuid, text, jsonb, text, text)
  owner to postgres;
alter function public.release_registration_admission_message_retry(uuid, jsonb, text, text)
  owner to postgres;
alter function public.begin_registration_admission_delivery_v1(uuid, uuid) owner to postgres;
alter function public.finalize_registration_admission_delivery_v1(
  uuid, uuid, bigint, uuid, text, text
) owner to postgres;
alter function public.complete_registration_admission_delivery_v1(
  uuid, uuid, uuid, bigint, uuid, uuid, text, jsonb, text, text
) owner to postgres;
alter function public.registration_notification_handoffs_runtime_version() owner to postgres;

commit;
