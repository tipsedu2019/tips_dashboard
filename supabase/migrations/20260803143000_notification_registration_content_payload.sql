begin;

set local lock_timeout = '5s';

create or replace function dashboard_private.registration_notification_kst_datetime_v1(
  p_value timestamptz,
  p_reference timestamptz default pg_catalog.now()
)
returns text
language sql
stable
strict
security definer
set search_path = ''
as $$
  select case
    when extract(year from p_value at time zone 'Asia/Seoul')
      = extract(year from p_reference at time zone 'Asia/Seoul')
      then pg_catalog.to_char(p_value at time zone 'Asia/Seoul', 'FMMM"월 "FMDD"일"')
    else pg_catalog.to_char(p_value at time zone 'Asia/Seoul', 'YYYY"년 "FMMM"월 "FMDD"일"')
  end
  || '(' || (array['일','월','화','수','목','금','토'])[
    extract(dow from p_value at time zone 'Asia/Seoul')::integer + 1
  ] || ') '
  || pg_catalog.to_char(p_value at time zone 'Asia/Seoul', 'HH24:MI');
$$;

create or replace function dashboard_private.registration_render_fixed_template_v2(
  p_template text,
  p_payload jsonb,
  p_allowed_variables jsonb
)
returns text
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  v_rendered text := p_template;
  v_variable record;
  v_match text[];
  v_value text;
begin
  if pg_catalog.jsonb_typeof(p_allowed_variables) <> 'array'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_allowed_variables) variable(item)
      where pg_catalog.jsonb_typeof(variable.item) <> 'object'
        or coalesce(variable.item ->> 'token', '') !~ '^[a-z][a-z0-9_]{0,63}$'
        or coalesce(variable.item ->> 'key', '') = ''
    )
  then
    raise exception 'registration_notification_template_allowlist_invalid'
      using errcode = '22023';
  end if;

  for v_match in
    select match_row
    from pg_catalog.regexp_matches(p_template, '\{([^{}]+)\}', 'g') match_row
  loop
    if not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_allowed_variables) variable(item)
      where variable.item ->> 'token' = v_match[1]
    ) then
      raise exception 'registration_notification_template_token_not_allowed:%', v_match[1]
        using errcode = '22023';
    end if;
  end loop;

  for v_variable in
    select distinct variable.item ->> 'token' as token
    from pg_catalog.jsonb_array_elements(p_allowed_variables) variable(item)
    order by variable.item ->> 'token'
  loop
    if pg_catalog.jsonb_typeof(p_payload -> v_variable.token) = 'array' then
      select coalesce(pg_catalog.string_agg(value.item #>> '{}', ' · ' order by value.ordinal), '')
      into v_value
      from pg_catalog.jsonb_array_elements(p_payload -> v_variable.token)
        with ordinality value(item, ordinal);
    else
      v_value := coalesce(p_payload ->> v_variable.token, '');
    end if;
    v_rendered := pg_catalog.replace(
      v_rendered,
      '{' || v_variable.token || '}',
      v_value
    );
  end loop;
  return v_rendered;
end;
$$;

create or replace function dashboard_private.write_registration_track_event_payload_v3(
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
  v_registration_source record;
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
  v_message public.ops_registration_messages%rowtype;
  v_track_ids uuid[] := array[]::uuid[];
  v_subjects text[] := array[]::text[];
  v_all_subjects text[] := array[]::text[];
  v_deselected_subjects text[] := array[]::text[];
  v_remaining_subjects text[] := array[]::text[];
  v_registered_subjects text[] := array[]::text[];
  v_registered_classes text[] := array[]::text[];
  v_director_profile_ids uuid[] := array[]::uuid[];
  v_actor_name text;
  v_actor_team text;
  v_progress_actor text;
  v_previous_appointment_payload jsonb;
  v_before_scheduled_at timestamptz;
  v_after_scheduled_at timestamptz;
  v_before_place text;
  v_after_place text;
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
  into v_registration_source
  from public.ops_tasks task
  join public.ops_registration_subject_tracks track on track.task_id = task.id
  join public.ops_registration_details detail on detail.task_id = task.id
  where task.id = p_task_id
    and task.type = 'registration'
    and track.id = p_track_id;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  v_task := v_registration_source.task;
  v_track := v_registration_source.track;
  v_detail := v_registration_source.detail;

  select coalesce(
    pg_catalog.array_agg(
      track.subject order by dashboard_private.registration_subject_sort_order(track.subject)
    ),
    array[]::text[]
  )
  into v_all_subjects
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id;

  select coalesce(
    pg_catalog.array_agg(
      track.subject order by dashboard_private.registration_subject_sort_order(track.subject)
    ) filter (where track.pipeline_status = 'registered'),
    array[]::text[]
  )
  into v_registered_subjects
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id;
  if nullif(pg_catalog.btrim(coalesce(v_task.class_name, '')), '') is not null then
    v_registered_classes := array[pg_catalog.btrim(v_task.class_name)];
  end if;

  if p_actor_kind = 'user' then
    select coalesce(nullif(profile.name, ''), nullif(profile.email, '')), profile.role
    into v_actor_name, v_actor_team
    from public.profiles profile
    where profile.id = (select auth.uid());
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
    'reason', coalesce(
      nullif(pg_catalog.btrim(v_metadata ->> 'reason'), ''),
      nullif(pg_catalog.btrim(p_reason_code), '')
    ),
    'memo', nullif(pg_catalog.btrim(v_metadata ->> 'memo'), ''),
    'actor_kind', p_actor_kind,
    'system_source', nullif(pg_catalog.btrim(p_system_source), ''),
    'source_event_id', v_event_id,
    'occurred_at', v_occurred_at
  )) || pg_catalog.jsonb_build_object(
    'subjects', pg_catalog.to_jsonb(v_all_subjects),
    'deselected_subjects', '[]'::jsonb,
    'remaining_subjects', pg_catalog.to_jsonb(v_all_subjects),
    'actor_name', v_actor_name,
    'actor_team', v_actor_team,
    'registered_subjects', pg_catalog.to_jsonb(v_registered_subjects),
    'registered_classes', pg_catalog.to_jsonb(v_registered_classes),
    'progress_actor', null,
    'before_scheduled_at', null,
    'after_scheduled_at', null,
    'before_place', null,
    'after_place', null
  );
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
    select coalesce(nullif(profile.name, ''), nullif(profile.email, ''))
    into v_progress_actor
    from public.profiles profile
    where profile.id = v_consultation.director_profile_id;
    v_payload := pg_catalog.jsonb_strip_nulls(v_payload || pg_catalog.jsonb_build_object(
      'consultation_id', v_consultation.id,
      'director_profile_id', v_consultation.director_profile_id,
      'recipient_revision', v_consultation.recipient_revision::text,
      'phone_queue_state', p_event_type
    )) || pg_catalog.jsonb_build_object(
      'subjects', pg_catalog.jsonb_build_array(v_track.subject),
      'progress_actor', v_progress_actor
    );
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

      if pg_catalog.jsonb_typeof(v_metadata -> 'activeTrackIds') = 'array'
        and pg_catalog.jsonb_array_length(v_metadata -> 'activeTrackIds') > 0
      then
        begin
          select coalesce(
            pg_catalog.array_agg(
              track.id order by dashboard_private.registration_subject_sort_order(track.subject), track.id
            ),
            array[]::uuid[]
          )
          into v_track_ids
          from (
            select distinct selected.value::uuid as track_id
            from pg_catalog.jsonb_array_elements_text(
              v_metadata -> 'activeTrackIds'
            ) selected(value)
          ) selected
          join public.ops_registration_subject_tracks track
            on track.id = selected.track_id
           and track.task_id = p_task_id;
        exception when invalid_text_representation then
          raise exception 'registration_visit_notification_tracks_invalid'
            using errcode = '22023';
        end;
        if pg_catalog.cardinality(v_track_ids)
          <> pg_catalog.jsonb_array_length(v_metadata -> 'activeTrackIds')
        then
          raise exception 'registration_visit_notification_tracks_invalid'
            using errcode = '22023';
        end if;
      else
        v_track_ids := dashboard_private.registration_appointment_track_ids_v1(
          v_appointment_id
        );
      end if;

      perform dashboard_private.registration_appointment_director_targets_v1(
        v_appointment_id
      );
      if pg_catalog.cardinality(v_track_ids) = 0 then
        select coalesce(
          pg_catalog.array_agg(
            participant.track_id
            order by dashboard_private.registration_subject_sort_order(participant.subject),
              participant.track_id
          ),
          array[]::uuid[]
        )
        into v_track_ids
        from (
          select distinct consultation.track_id, track.subject
          from public.ops_registration_consultations consultation
          join public.ops_registration_subject_tracks track on track.id = consultation.track_id
          where consultation.appointment_id = v_appointment_id
            and consultation.mode = 'visit'
        ) participant;
      end if;

      select coalesce(
        pg_catalog.array_agg(
          subject_row.subject
          order by dashboard_private.registration_subject_sort_order(subject_row.subject)
        ),
        array[]::text[]
      )
      into v_subjects
      from (
        select distinct track.subject
        from pg_catalog.unnest(v_track_ids) participant(track_id)
        join public.ops_registration_subject_tracks track on track.id = participant.track_id
      ) subject_row;
      if pg_catalog.jsonb_typeof(v_metadata -> 'canceledTrackIds') = 'array' then
        begin
          select coalesce(
            pg_catalog.array_agg(
              subject_row.subject
              order by dashboard_private.registration_subject_sort_order(subject_row.subject)
            ),
            array[]::text[]
          )
          into v_deselected_subjects
          from (
            select distinct track.subject
            from pg_catalog.jsonb_array_elements_text(
              v_metadata -> 'canceledTrackIds'
            ) canceled(value)
            join public.ops_registration_subject_tracks track
              on track.id = canceled.value::uuid
             and track.task_id = p_task_id
          ) subject_row;
        exception when invalid_text_representation then
          raise exception 'registration_visit_notification_tracks_invalid'
            using errcode = '22023';
        end;
      else
        v_deselected_subjects := array[]::text[];
      end if;

      if pg_catalog.jsonb_typeof(v_metadata -> 'activeTrackIds') = 'array' then
        begin
          select coalesce(
            pg_catalog.array_agg(
              subject_row.subject
              order by dashboard_private.registration_subject_sort_order(subject_row.subject)
            ),
            array[]::text[]
          )
          into v_remaining_subjects
          from (
            select distinct track.subject
            from pg_catalog.jsonb_array_elements_text(
              v_metadata -> 'activeTrackIds'
            ) active(value)
            join public.ops_registration_subject_tracks track
              on track.id = active.value::uuid
             and track.task_id = p_task_id
          ) subject_row;
        exception when invalid_text_representation then
          raise exception 'registration_visit_notification_tracks_invalid'
            using errcode = '22023';
        end;
      else
        v_remaining_subjects := v_subjects;
      end if;

      select coalesce(
        pg_catalog.array_agg(distinct track.director_profile_id order by track.director_profile_id)
          filter (where track.director_profile_id is not null),
        array[]::uuid[]
      )
      into v_director_profile_ids
      from pg_catalog.unnest(v_track_ids) participant(track_id)
      join public.ops_registration_subject_tracks track on track.id = participant.track_id;

      if pg_catalog.cardinality(v_subjects) > 0
        and not exists (
          select 1
          from pg_catalog.unnest(v_track_ids) participant(track_id)
          join public.ops_registration_subject_tracks track on track.id = participant.track_id
          where track.director_profile_id is null
        )
      then
        v_progress_actor := case pg_catalog.cardinality(v_subjects)
          when 1 then v_subjects[1] || '팀 담당 원장님'
          when 2 then v_subjects[1] || '팀과 ' || v_subjects[2] || '팀 담당 원장님'
          else pg_catalog.array_to_string(v_subjects[1:pg_catalog.cardinality(v_subjects) - 1], '팀, ')
            || '팀과 ' || v_subjects[pg_catalog.cardinality(v_subjects)] || '팀 담당 원장님'
        end;
      else
        v_progress_actor := null;
      end if;

      select previous_event.payload
      into v_previous_appointment_payload
      from dashboard_private.notification_events previous_event
      where previous_event.workflow_key = 'registration'
        and previous_event.source_type = 'registration_appointment'
        and previous_event.source_id = v_appointment_id::text
        and previous_event.source_revision < v_appointment.notification_revision
        and previous_event.event_key like 'registration.visit_%'
      order by previous_event.source_revision desc, previous_event.created_at desc
      limit 1;

      v_before_scheduled_at := coalesce(
        nullif(v_metadata ->> 'oldScheduledAt', '')::timestamptz,
        nullif(v_previous_appointment_payload ->> 'scheduled_at', '')::timestamptz
      );
      v_before_place := coalesce(
        nullif(v_metadata ->> 'oldPlace', ''),
        nullif(v_previous_appointment_payload ->> 'place', '')
      );
      v_after_scheduled_at := case
        when v_event_key = 'registration.visit_canceled' then null
        else v_appointment.scheduled_at
      end;
      v_after_place := case
        when v_event_key = 'registration.visit_canceled' then null
        else v_appointment.place
      end;

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
          'director_profile_ids', pg_catalog.to_jsonb(v_director_profile_ids),
          'occurred_at', v_occurred_at
        )
      ) || pg_catalog.jsonb_build_object(
        'subjects', pg_catalog.to_jsonb(v_subjects),
        'deselected_subjects', pg_catalog.to_jsonb(v_deselected_subjects),
        'remaining_subjects', pg_catalog.to_jsonb(v_remaining_subjects),
        'actor_name', v_actor_name,
        'actor_team', v_actor_team,
        'registered_subjects', pg_catalog.to_jsonb(v_registered_subjects),
        'registered_classes', pg_catalog.to_jsonb(v_registered_classes),
        'progress_actor', v_progress_actor,
        'before_scheduled_at', v_before_scheduled_at,
        'after_scheduled_at', v_after_scheduled_at,
        'before_place', v_before_place,
        'after_place', v_after_place
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
language sql
volatile
security definer
set search_path = ''
as $$
  select dashboard_private.write_registration_track_event_payload_v3(
    p_task_id,
    p_track_id,
    p_event_type,
    p_source,
    p_destination,
    p_reason_code,
    p_metadata,
    p_actor_kind,
    p_system_source
  );
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
  v_rule_selection record;
  v_consultation public.ops_registration_consultations%rowtype;
  v_target_generation bigint;
  v_target_set_hash text;
  v_delivery_id uuid;
  v_ownership jsonb;
  v_result jsonb;
  v_render_payload jsonb;
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
    rule.id as rule_id,
    (snapshot.item ->> 'rule_revision')::bigint as rule_revision,
    template as template,
    template.allowed_variables as allowed_variables
  into v_rule_selection
  from pg_catalog.jsonb_array_elements(v_event.rule_snapshot) snapshot(item)
  join dashboard_private.notification_rules rule
    on rule.id = (snapshot.item ->> 'rule_id')::uuid
   and rule.active_template_id is not null
  join dashboard_private.notification_templates template
    on template.id = (snapshot.item ->> 'template_id')::uuid
   and template.rule_id = rule.id
  where snapshot.item ->> 'audience_key' = 'track_director'
    and snapshot.item ->> 'channel_key' = 'in_app'
    and (snapshot.item ->> 'enabled')::boolean
    and rule.scope_key = 'global'
    and rule.workflow_key = 'registration'
    and rule.event_key = 'registration.phone_consultation_ready'
    and rule.audience_key = 'track_director'
    and rule.channel_key = 'in_app'
    and (
      rule.revision > (snapshot.item ->> 'rule_revision')::bigint
      or rule.active_template_id = template.id
    )
  limit 1;
  if not found then
    raise exception 'registration_phone_rule_not_found' using errcode = 'P0002';
  end if;
  v_rule_id := v_rule_selection.rule_id;
  v_rule_revision := v_rule_selection.rule_revision;
  v_template := v_rule_selection.template;
  v_render_payload := v_event.payload || pg_catalog.jsonb_build_object(
    'subjects', coalesce(v_event.payload -> 'subjects', pg_catalog.jsonb_build_array(v_event.payload ->> 'subject')),
    'progress_line', case
      when nullif(v_event.payload ->> 'progress_actor', '') is null then ''
      else '[진행] ' || (v_event.payload ->> 'progress_actor') || '님의 상담 확인을 기다리고 있어요.'
    end,
    'reason_line', case
      when nullif(v_event.payload ->> 'reason', '') is null then ''
      else '[사유] ' || (v_event.payload ->> 'reason')
    end,
    'memo_line', case
      when nullif(v_event.payload ->> 'memo', '') is null then ''
      else '[메모] ' || (v_event.payload ->> 'memo')
    end
  );

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
    dashboard_private.registration_render_fixed_template_v2(
      v_template.title_template,
      v_render_payload,
      v_template.allowed_variables
    ),
    dashboard_private.registration_render_fixed_template_v2(
      v_template.body_template,
      v_render_payload,
      v_template.allowed_variables
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
  update public.dashboard_notifications notification
  set type = 'registration_consultation',
      metadata = notification.metadata || pg_catalog.jsonb_build_object(
        'taskId', v_event.payload ->> 'task_id',
        'trackId', v_event.payload ->> 'track_id',
        'consultationId', v_consultation.id,
        'subject', v_event.payload ->> 'subject',
        'directorProfileId', v_consultation.director_profile_id
      )
  where notification.source_delivery_id = v_delivery_id;
  return v_result || pg_catalog.jsonb_build_object(
    'deliveryId', v_delivery_id,
    'acquired', true
  );
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
      pg_catalog.string_agg(
        distinct participant.subject,
        ' · ' order by participant.subject
      ) as subjects,
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
      rule.audience_key,
      rule.channel_key,
      template.checksum as template_checksum,
      template.title_template,
      template.body_template,
      template.allowed_variables
    from pg_catalog.jsonb_array_elements(v_event.rule_snapshot) snapshot(item)
    join dashboard_private.notification_rules rule
      on rule.id = (snapshot.item ->> 'rule_id')::uuid
    join dashboard_private.notification_templates template
      on template.id = (snapshot.item ->> 'template_id')::uuid
     and template.rule_id = rule.id
    where (snapshot.item ->> 'enabled')::boolean
      and rule.scope_key = 'global'
      and rule.workflow_key = 'registration'
      and rule.event_key = v_event.event_key
      and (
        rule.revision > (snapshot.item ->> 'rule_revision')::bigint
        or rule.active_template_id = template.id
      )
      and (
        (rule.audience_key = 'track_director' and rule.channel_key = 'in_app')
        or (rule.audience_key = 'management_team' and rule.channel_key = 'google_chat')
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
      coalesce((
        select pg_catalog.string_agg(
          distinct participant.subject,
          ' · ' order by participant.subject
        )
        from participant
      ), ''),
      coalesce((
        select pg_catalog.string_agg(
          distinct participant.subject || ': ' || participant.director_name,
          E'\n' order by participant.subject || ': ' || participant.director_name
        )
        from participant
      ), '')
    from enabled_rule
    where enabled_rule.audience_key = 'management_team'
  ), rendered_target as (
    select
      target.*,
      v_event.payload || pg_catalog.jsonb_build_object(
        'subjects', coalesce(nullif(target.subjects, ''), v_event.payload ->> 'subjects'),
        'scheduled_at', dashboard_private.registration_notification_kst_datetime_v1(
          nullif(v_event.payload ->> 'scheduled_at', '')::timestamptz,
          v_event.occurred_at
        ),
        'before_schedule', dashboard_private.registration_notification_kst_datetime_v1(
          nullif(v_event.payload ->> 'before_scheduled_at', '')::timestamptz,
          v_event.occurred_at
        ),
        'after_schedule', dashboard_private.registration_notification_kst_datetime_v1(
          coalesce(
            nullif(v_event.payload ->> 'after_scheduled_at', '')::timestamptz,
            nullif(v_event.payload ->> 'scheduled_at', '')::timestamptz
          ),
          v_event.occurred_at
        ),
        'after_place', coalesce(v_event.payload ->> 'after_place', v_event.payload ->> 'place'),
        'before_appointment', coalesce(
          dashboard_private.registration_notification_kst_datetime_v1(
            nullif(v_event.payload ->> 'before_scheduled_at', '')::timestamptz,
            v_event.occurred_at
          ) || ' · ' || nullif(v_event.payload ->> 'before_place', ''),
          ''
        ),
        'after_appointment', coalesce(
          dashboard_private.registration_notification_kst_datetime_v1(
            coalesce(
              nullif(v_event.payload ->> 'after_scheduled_at', '')::timestamptz,
              nullif(v_event.payload ->> 'scheduled_at', '')::timestamptz
            ),
            v_event.occurred_at
          ) || ' · ' || coalesce(v_event.payload ->> 'after_place', v_event.payload ->> 'place'),
          ''
        ),
        'deselected_subjects', coalesce(v_event.payload -> 'deselected_subjects', '[]'::jsonb),
        'other_active_subjects', coalesce(v_event.payload -> 'remaining_subjects', '[]'::jsonb),
        'retained_schedule', dashboard_private.registration_notification_kst_datetime_v1(
          nullif(v_event.payload ->> 'scheduled_at', '')::timestamptz,
          v_event.occurred_at
        ),
        'retained_place', v_event.payload ->> 'place',
        'canceled_schedule', dashboard_private.registration_notification_kst_datetime_v1(
          nullif(v_event.payload ->> 'scheduled_at', '')::timestamptz,
          v_event.occurred_at
        ),
        'canceled_place', v_event.payload ->> 'place',
        'progress_line', case
          when nullif(v_event.payload ->> 'progress_actor', '') is null then ''
          else '[진행] ' || (v_event.payload ->> 'progress_actor') || '의 일정 확인을 기다리고 있어요.'
        end,
        'reason_line', case
          when nullif(v_event.payload ->> 'reason', '') is null then ''
          else '[사유] ' || (v_event.payload ->> 'reason')
        end,
        'memo_line', case
          when nullif(v_event.payload ->> 'memo', '') is null then ''
          else '[메모] ' || (v_event.payload ->> 'memo')
        end,
        'subject_directors', target.subject_directors
      ) as render_payload
    from target
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'eventId', v_event.id,
    'eventKey', v_event.event_key,
    'occurrenceKey', v_event.occurrence_key,
    'ruleId', rendered_target.id,
    'ruleRevision', rendered_target.revision::text,
    'templateId', rendered_target.active_template_id,
    'templateChecksum', rendered_target.template_checksum,
    'channelKey', rendered_target.channel_key,
    'audienceKey', rendered_target.audience_key,
    'targetGeneration', v_appointment.recipient_revision::text,
    'targetKind', rendered_target.target_kind,
    'targetKey', rendered_target.target_key,
    'targetProfileId', rendered_target.target_profile_id,
    'connectionKey', rendered_target.connection_key,
    'targetSnapshot', rendered_target.target_snapshot,
    'renderedTitle', dashboard_private.registration_render_fixed_template_v2(
      rendered_target.title_template,
      rendered_target.render_payload,
      rendered_target.allowed_variables
    ),
    'renderedBody', dashboard_private.registration_render_fixed_template_v2(
      rendered_target.body_template,
      rendered_target.render_payload,
      rendered_target.allowed_variables
    ),
    'href', '/admin/registration?taskId=' || v_task.id::text
      || '&appointmentId=' || v_appointment.id::text || '&view=calendar',
    'scheduledFor', v_event.occurred_at
  ) order by rendered_target.id, rendered_target.target_key), '[]'::jsonb)
  into v_items
  from rendered_target;

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

create or replace function dashboard_private.assign_registration_track_director_impl(
  p_track_id uuid,
  p_director_profile_id uuid,
  p_assignment_source text,
  p_rule_key text,
  p_expected_common_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_assignment_source text := nullif(pg_catalog.btrim(p_assignment_source), '');
  v_rule_key text := nullif(pg_catalog.btrim(p_rule_key), '');
  v_task_id uuid;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_resolution jsonb;
  v_visit_appointment_id uuid;
  v_phone_consultation_id uuid;
  v_phone_director_id uuid;
  v_notification_id uuid;
  v_notification_dedupe_key text;
  v_source_event_id uuid;
  v_projection_request_id uuid;
  v_event_type text;
  v_next_source text;
  v_next_rule_key text;
  v_next_assigned_at timestamptz;
  v_assignment_changed boolean;
  v_phone_created boolean := false;
  v_canonical_projection_exists boolean := false;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_assignment_source is null
    or v_assignment_source not in ('default', 'manual', 'clear_default')
  then
    raise exception 'registration_director_assignment_source_invalid' using errcode = '22023';
  end if;
  if p_expected_common_revision is null or p_expected_common_revision <= 0 then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', null,
    'trackId', p_track_id,
    'directorProfileId', p_director_profile_id,
    'assignmentSource', v_assignment_source,
    'ruleKey', v_rule_key,
    'expectedCommonRevision', p_expected_common_revision
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_set(
    v_target_fingerprint,
    '{taskId}',
    pg_catalog.to_jsonb(v_task_id),
    true
  );

  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  select consultation.appointment_id
  into v_visit_appointment_id
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
    and consultation.mode = 'visit'
    and consultation.status = 'scheduled'
  order by consultation.id
  limit 1;
  if v_visit_appointment_id is not null then
    perform 1
    from public.ops_registration_appointments appointment
    where appointment.id = v_visit_appointment_id
    for update;
  end if;
  perform 1
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
    and consultation.status in ('waiting', 'scheduled')
  order by consultation.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id,
    p_track_id,
    'assign_director'
  );
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'assign_director'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then
    return v_response;
  end if;
  if v_detail.common_revision <> p_expected_common_revision then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
  end if;
  if v_track.pipeline_status in ('registered', 'not_registered', 'inquiry_closed') then
    raise exception 'registration_director_assignment_terminal' using errcode = '40001';
  end if;
  if v_visit_appointment_id is not null then
    raise exception 'registration_visit_reassign_requires_reschedule' using errcode = '40001';
  end if;

  v_resolution := dashboard_private.resolve_registration_default_director(
    v_track.subject,
    v_detail.school_grade,
    v_detail.inquiry_at
  );
  if v_assignment_source = 'default' then
    if p_director_profile_id is null or v_rule_key is null
      or v_track.director_assignment_source is not null
        and v_track.director_assignment_source <> 'default'
      or v_resolution ->> 'status' <> 'resolved'
      or nullif(v_resolution ->> 'profileId', '')::uuid is distinct from p_director_profile_id
      or v_resolution ->> 'ruleKey' is distinct from v_rule_key
    then
      raise exception 'registration_director_default_stale' using errcode = '40001';
    end if;
    if not dashboard_private.is_active_subject_director(
      p_director_profile_id,
      v_track.subject
    ) then
      raise exception 'registration_director_refresh_required' using errcode = '40001';
    end if;
    v_next_source := 'default';
    v_next_rule_key := v_rule_key;
    v_event_type := 'director_default_resolved';
  elsif v_assignment_source = 'manual' then
    if p_director_profile_id is null or v_rule_key is not null then
      raise exception 'registration_director_manual_invalid' using errcode = '22023';
    end if;
    if not dashboard_private.is_active_subject_director(
      p_director_profile_id,
      v_track.subject
    ) then
      raise exception 'registration_director_refresh_required' using errcode = '40001';
    end if;
    v_next_source := 'manual';
    v_next_rule_key := null;
    v_event_type := 'director_manual_override';
  else
    if p_director_profile_id is not null or v_rule_key is not null
      or v_track.director_assignment_source is not null
        and v_track.director_assignment_source <> 'default'
    then
      raise exception 'registration_director_clear_denied' using errcode = '40001';
    end if;
    if v_resolution ->> 'status' = 'resolved' then
      raise exception 'registration_director_default_stale' using errcode = '40001';
    end if;
    v_next_source := null;
    v_next_rule_key := null;
    v_event_type := 'director_default_cleared';
  end if;

  v_assignment_changed :=
    v_track.director_profile_id is distinct from p_director_profile_id
    or v_track.director_assignment_source is distinct from v_next_source
    or v_track.director_assignment_rule_key is distinct from v_next_rule_key;
  v_next_assigned_at := case
    when p_director_profile_id is null then null
    when v_assignment_changed then pg_catalog.now()
    else v_track.director_assigned_at
  end;
  if v_assignment_changed then
    update public.ops_registration_subject_tracks
    set director_profile_id = p_director_profile_id,
        director_assignment_source = v_next_source,
        director_assignment_rule_key = v_next_rule_key,
        director_assigned_at = v_next_assigned_at,
        updated_at = pg_catalog.now()
    where id = p_track_id;
  end if;

  select consultation.id, consultation.director_profile_id
  into v_phone_consultation_id, v_phone_director_id
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
    and consultation.mode = 'phone'
    and consultation.status = 'waiting'
  order by consultation.id
  limit 1
  for update;

  if p_director_profile_id is not null then
    if v_phone_consultation_id is not null then
      delete from public.dashboard_notifications notification
      where notification.type = 'registration_consultation'
        and notification.read_at is null
        and notification.source_delivery_id is null
        and notification.recipient_profile_id is distinct from p_director_profile_id
        and notification.metadata ->> 'consultationId' = v_phone_consultation_id::text;
      if v_phone_director_id is distinct from p_director_profile_id then
        update public.ops_registration_consultations
        set director_profile_id = p_director_profile_id,
            updated_at = pg_catalog.now()
        where id = v_phone_consultation_id;
      end if;
    elsif v_track.pipeline_status = 'consultation_waiting' then
      insert into public.ops_registration_consultations(
        track_id,
        appointment_id,
        mode,
        status,
        director_profile_id,
        ready_at,
        ready_source
      ) values (
        p_track_id,
        null,
        'phone',
        'waiting',
        p_director_profile_id,
        v_track.stage_entered_at,
        'director_resolved'
      )
      returning id into v_phone_consultation_id;
      v_phone_created := true;
    end if;

    if v_phone_consultation_id is not null then
      v_notification_dedupe_key :=
        'registration:' || v_task_id::text || ':track:' || p_track_id::text
        || ':consultation:' || v_phone_consultation_id::text
        || ':director:' || p_director_profile_id::text;
      select notification.id
      into v_notification_id
      from public.dashboard_notifications notification
      where notification.type = 'registration_consultation'
        and notification.recipient_profile_id = p_director_profile_id
        and notification.source_delivery_id is not null
        and notification.metadata ->> 'consultationId' = v_phone_consultation_id::text
        and notification.revoked_at is null
      order by notification.created_at desc, notification.id desc
      limit 1;

      select exists (
        select 1
        from dashboard_private.notification_events event_row
        join dashboard_private.notification_deliveries delivery
          on delivery.event_id = event_row.id
        where event_row.workflow_key = 'registration'
          and event_row.event_key = 'registration.phone_consultation_ready'
          and event_row.payload ->> 'consultation_id' = v_phone_consultation_id::text
          and delivery.target_profile_id = p_director_profile_id
          and delivery.status not in ('canceled', 'dead_letter')
      )
      into v_canonical_projection_exists;

      if v_notification_id is null and not v_canonical_projection_exists then
        v_source_event_id := dashboard_private.write_registration_track_event_v2(
          v_task_id,
          p_track_id,
          'phone_queue_created',
          'unassigned',
          p_director_profile_id::text,
          null,
          pg_catalog.jsonb_build_object(
            'consultationId', v_phone_consultation_id,
            'directorProfileId', p_director_profile_id,
            'recipientRevision', (
              select consultation.recipient_revision::text
              from public.ops_registration_consultations consultation
              where consultation.id = v_phone_consultation_id
            )
          ),
          'user',
          null
        );
        v_projection_request_id := dashboard_private.notification_deterministic_uuid_v1(
          'registration-phone-legacy-projection-v1',
          v_source_event_id::text || '|repair'
        );
        perform dashboard_private.materialize_registration_phone_legacy_v1(
          v_source_event_id,
          v_projection_request_id
        );
        select notification.id
        into v_notification_id
        from public.dashboard_notifications notification
        where notification.type = 'registration_consultation'
          and notification.recipient_profile_id = p_director_profile_id
          and notification.source_delivery_id is not null
          and notification.metadata ->> 'consultationId' = v_phone_consultation_id::text
          and notification.revoked_at is null
        order by notification.created_at desc, notification.id desc
        limit 1;
      end if;
    end if;
  elsif v_phone_consultation_id is not null then
    perform dashboard_private.cancel_registration_phone_projection_v1(
      v_phone_consultation_id,
      'recipient_revoked'
    );
  end if;

  if v_assignment_changed then
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      p_track_id,
      v_event_type,
      coalesce(v_track.director_assignment_source, 'unassigned'),
      coalesce(v_next_source, 'unassigned'),
      null,
      pg_catalog.jsonb_build_object(
        'previousDirectorProfileId', v_track.director_profile_id,
        'directorProfileId', p_director_profile_id,
        'ruleKey', v_next_rule_key,
        'consultationId', v_phone_consultation_id,
        'notificationDedupeKey', v_notification_dedupe_key
      )
    );
  elsif v_phone_created then
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      p_track_id,
      'director_phone_queue_repaired',
      v_track.pipeline_status,
      v_track.pipeline_status,
      null,
      pg_catalog.jsonb_build_object(
        'directorProfileId', p_director_profile_id,
        'consultationId', v_phone_consultation_id,
        'notificationDedupeKey', v_notification_dedupe_key
      )
    );
  end if;

  perform dashboard_private.recompute_registration_parent(v_task_id);
  select pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'commonRevision', v_detail.common_revision,
    'trackId', track.id,
    'subject', track.subject,
    'status', track.pipeline_status,
    'directorProfileId', track.director_profile_id,
    'directorAssignmentSource', track.director_assignment_source,
    'directorAssignmentRuleKey', track.director_assignment_rule_key,
    'directorAssignedAt', track.director_assigned_at,
    'consultationId', v_phone_consultation_id,
    'notificationId', v_notification_id,
    'notificationDedupeKey', v_notification_dedupe_key,
    'requiresDirectorAssignment', track.director_profile_id is null
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;

  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_task_id,
    'assign_director',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

revoke all on function dashboard_private.registration_notification_kst_datetime_v1(
  timestamptz,
  timestamptz
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_render_fixed_template_v2(
  text,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_appointment_rule_snapshot_v1(
  text,
  boolean
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_appointment_source_snapshot_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.write_registration_track_event_payload_v3(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.write_registration_track_event_v2(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.materialize_registration_phone_legacy_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_registration_visit_legacy_dispatch_plan_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assign_registration_track_director_impl(
  uuid,
  uuid,
  text,
  text,
  integer,
  text
) from public, anon, authenticated, service_role;

grant execute on function public.get_registration_visit_legacy_dispatch_plan_v1(uuid, uuid)
  to authenticated;

alter function dashboard_private.registration_notification_kst_datetime_v1(
  timestamptz,
  timestamptz
) owner to postgres;
alter function dashboard_private.registration_render_fixed_template_v2(text, jsonb, jsonb)
  owner to postgres;
alter function dashboard_private.registration_appointment_rule_snapshot_v1(text, boolean)
  owner to postgres;
alter function dashboard_private.registration_appointment_source_snapshot_v1(uuid)
  owner to postgres;
alter function dashboard_private.write_registration_track_event_payload_v3(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text
) owner to postgres;
alter function dashboard_private.write_registration_track_event_v2(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text
) owner to postgres;
alter function dashboard_private.materialize_registration_phone_legacy_v1(uuid, uuid)
  owner to postgres;
alter function public.get_registration_visit_legacy_dispatch_plan_v1(uuid, uuid)
  owner to postgres;
alter function dashboard_private.assign_registration_track_director_impl(
  uuid,
  uuid,
  text,
  text,
  integer,
  text
) owner to postgres;

create or replace function dashboard_private.registration_appointment_rule_snapshot_v1(
  p_kind text,
  p_enabled_only boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'rule_id', rule.id,
        'rule_revision', rule.revision::text,
        'template_id', rule.active_template_id,
        'template_checksum', template.checksum,
        'template_allowed_variables', template.allowed_variables,
        'content_contract_version', coalesce(
          template.content_contract_version,
          contract_row.contract_version
        ),
        'audience_key', rule.audience_key,
        'channel_key', rule.channel_key,
        'connection_key', case
          when rule.channel_key = 'google_chat' then 'google_chat.management'
          else null
        end,
        'rule_variant_key', rule.rule_variant_key,
        'schedule_key', rule.schedule_key,
        'schedule_config', rule.schedule_config,
        'enabled', rule.enabled
      ) order by
        case rule.rule_variant_key
          when 'previous_day_at' then 1
          when 'same_day_at' then 2
          when 'offset_before' then 3
          else 4
        end,
        rule.audience_key,
        rule.channel_key,
        rule.id
    ),
    '[]'::jsonb
  )
  from dashboard_private.notification_rules rule
  join dashboard_private.notification_templates template
    on template.id = rule.active_template_id
   and template.rule_id = rule.id
  join dashboard_private.notification_rule_content_contracts contract_row
    on contract_row.rule_id = rule.id
  where rule.scope_key = 'global'
    and rule.workflow_key = 'registration'
    and rule.event_key = 'registration.appointment_reminder_due'
    and (not p_enabled_only or rule.enabled)
    and (
      p_kind is null
      or dashboard_private.registration_appointment_reminder_applicable_v1(
        p_kind,
        rule.audience_key,
        rule.channel_key
      )
    );
$$;

create or replace function dashboard_private.registration_appointment_source_snapshot_v1(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_appointment public.ops_registration_appointments%rowtype;
  v_track_ids uuid[];
  v_subjects text[];
  v_director_profile_ids uuid[];
  v_management_profile_ids uuid[];
  v_participants jsonb;
  v_student_name text;
  v_progress_actor text;
begin
  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id;
  if not found then
    return null;
  end if;

  v_track_ids := dashboard_private.registration_appointment_track_ids_v1(
    p_appointment_id
  );
  select coalesce(
    pg_catalog.array_agg(
      track.subject order by
        dashboard_private.registration_subject_sort_order(track.subject),
        track.id
    ),
    array[]::text[]
  )
  into v_subjects
  from public.ops_registration_subject_tracks track
  where track.id = any(v_track_ids);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'track_id', track.id,
        'subject', track.subject,
        'director_profile_id', track.director_profile_id,
        'director_name', coalesce(nullif(profile.name, ''), nullif(profile.email, ''))
      ) order by
        dashboard_private.registration_subject_sort_order(track.subject),
        track.id
    ),
    '[]'::jsonb
  )
  into v_participants
  from public.ops_registration_subject_tracks track
  left join public.profiles profile on profile.id = track.director_profile_id
  where track.id = any(v_track_ids);

  select coalesce(
    pg_catalog.array_agg(distinct track.director_profile_id order by track.director_profile_id)
      filter (where track.director_profile_id is not null),
    array[]::uuid[]
  )
  into v_director_profile_ids
  from public.ops_registration_subject_tracks track
  join public.profiles profile on profile.id = track.director_profile_id
  where track.id = any(v_track_ids)
    and dashboard_private.is_active_subject_director(
      track.director_profile_id,
      track.subject
    )
    and dashboard_private.notification_profile_is_active_v1(track.director_profile_id);

  if pg_catalog.cardinality(v_track_ids) > 0
    and pg_catalog.cardinality(v_director_profile_ids) > 0
    and not exists (
      select 1
      from public.ops_registration_subject_tracks track
      where track.id = any(v_track_ids)
        and (
          track.director_profile_id is null
          or not dashboard_private.is_active_subject_director(
            track.director_profile_id,
            track.subject
          )
          or not dashboard_private.notification_profile_is_active_v1(
            track.director_profile_id
          )
        )
    )
  then
    v_progress_actor := case pg_catalog.cardinality(v_subjects)
      when 1 then v_subjects[1] || '팀 담당 원장님'
      when 2 then v_subjects[1] || '팀과 ' || v_subjects[2] || '팀 담당 원장님'
      else pg_catalog.array_to_string(v_subjects[1:pg_catalog.cardinality(v_subjects) - 1], '팀, ')
        || '팀과 ' || v_subjects[pg_catalog.cardinality(v_subjects)] || '팀 담당 원장님'
    end;
  end if;

  select coalesce(
    pg_catalog.array_agg(profile.id order by profile.id),
    array[]::uuid[]
  )
  into v_management_profile_ids
  from public.profiles profile
  where profile.role in ('admin', 'staff')
    and dashboard_private.notification_profile_is_active_v1(profile.id);

  select task.student_name
  into v_student_name
  from public.ops_tasks task
  where task.id = v_appointment.task_id;

  return pg_catalog.jsonb_build_object(
    'appointment_id', v_appointment.id,
    'task_id', v_appointment.task_id,
    'student_name', coalesce(v_student_name, ''),
    'kind', v_appointment.kind,
    'scheduled_at', v_appointment.scheduled_at,
    'place', v_appointment.place,
    'status', v_appointment.status,
    'notification_revision', v_appointment.notification_revision,
    'recipient_revision', v_appointment.recipient_revision::text,
    'track_ids', pg_catalog.to_jsonb(v_track_ids),
    'subjects', pg_catalog.to_jsonb(v_subjects),
    'participants', v_participants,
    'director_profile_ids', pg_catalog.to_jsonb(v_director_profile_ids),
    'management_profile_ids', pg_catalog.to_jsonb(v_management_profile_ids),
    'progress_actor', v_progress_actor,
    'current_rules', dashboard_private.registration_appointment_rule_snapshot_v1(
      v_appointment.kind,
      false
    )
  );
end;
$$;

commit;
