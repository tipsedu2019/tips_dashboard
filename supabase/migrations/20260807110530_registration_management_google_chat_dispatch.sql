begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function dashboard_private.record_registration_management_notification_v1(
  p_source_event_id uuid,
  p_event_key text,
  p_task_id uuid,
  p_track_id uuid,
  p_source_revision bigint,
  p_occurred_at timestamptz,
  p_actor_profile_id uuid
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
  v_subjects text[] := array[]::text[];
  v_actor_name text;
  v_status_label text;
  v_source_type text := 'ops_task_event';
  v_payload jsonb;
begin
  if p_source_event_id is null
    or p_task_id is null
    or p_track_id is null
    or p_occurred_at is null
    or p_event_key not in (
      'registration.case_created',
      'registration.consultation_completed',
      'registration.waiting_transitioned',
      'registration.admission_started'
    )
  then
    raise exception 'registration_management_notification_invalid' using errcode = '22023';
  end if;

  select task, track, detail
  into v_registration_source
  from public.ops_tasks task
  join public.ops_registration_subject_tracks track
    on track.task_id = task.id
   and track.id = p_track_id
  join public.ops_registration_details detail on detail.task_id = task.id
  where task.id = p_task_id
    and task.type = 'registration';
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  v_task := v_registration_source.task;
  v_track := v_registration_source.track;
  v_detail := v_registration_source.detail;

  select coalesce(
    pg_catalog.array_agg(
      track.subject order by dashboard_private.registration_subject_sort_order(track.subject), track.id
    ),
    array[]::text[]
  )
  into v_subjects
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id;

  select coalesce(nullif(profile.name, ''), nullif(profile.email, ''))
  into v_actor_name
  from public.profiles profile
  where profile.id = p_actor_profile_id;

  v_status_label := case p_event_key
    when 'registration.case_created' then '상담 신청'
    when 'registration.consultation_completed' then '상담 완료'
    when 'registration.waiting_transitioned' then '대기 신청'
    when 'registration.admission_started' then '등록 신청'
  end;

  v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'task_id', v_task.id,
    'track_id', v_track.id,
    'student_name', v_task.student_name,
    'grade', v_detail.school_grade,
    'subject', v_track.subject,
    'inquiry_at', v_detail.inquiry_at,
    'status', v_track.pipeline_status,
    'workflow_status', v_track.workflow_status,
    'current_status', v_status_label,
    'requester_profile_id', v_task.requested_by,
    'director_profile_id', v_track.director_profile_id,
    'memo', nullif(pg_catalog.btrim(coalesce(v_detail.request_note, '')), ''),
    'actor_name', v_actor_name,
    'actor_kind', case when p_actor_profile_id is null then 'system' else 'user' end,
    'source_event_id', p_source_event_id,
    'occurred_at', p_occurred_at
  )) || pg_catalog.jsonb_build_object(
    'subjects', pg_catalog.to_jsonb(v_subjects),
    'progress_line', case
      when nullif(v_actor_name, '') is null then '[진행] 관리팀 확인을 기다리고 있어요.'
      else '[진행] ' || v_actor_name || '님이 ' || v_status_label || ' 상태로 변경했어요.'
    end,
    'memo_line', case
      when nullif(pg_catalog.btrim(coalesce(v_detail.request_note, '')), '') is null then ''
      else '[메모] ' || pg_catalog.btrim(v_detail.request_note)
    end
  );

  perform dashboard_private.record_notification_event_v1(
    'global',
    'registration',
    p_event_key,
    v_source_type,
    p_source_event_id::text,
    p_source_revision,
    p_source_event_id::text,
    p_actor_profile_id,
    p_occurred_at,
    case when p_event_key = 'registration.case_created' then 1 else 2 end,
    v_payload,
    null,
    null
  );

  return p_source_event_id;
end;
$$;

create or replace function public.ensure_registration_case_created_notification_v1(
  p_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_role text;
  v_task public.ops_tasks%rowtype;
  v_source public.ops_task_events%rowtype;
  v_track_id uuid;
begin
  if v_actor is null or p_task_id is null then
    raise exception 'registration_management_notification_access_denied' using errcode = '42501';
  end if;

  select task.* into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration';
  if not found then
    raise exception 'registration_task_not_found' using errcode = 'P0002';
  end if;
  select profile.role into v_actor_role
  from public.profiles profile
  where profile.id = v_actor;
  if not (
    v_actor_role in ('admin', 'staff')
    or v_task.requested_by = v_actor
    or v_task.assignee_id = v_actor
    or v_task.secondary_assignee_id = v_actor
  ) then
    raise exception 'registration_management_notification_access_denied' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-case-chat:' || p_task_id::text, 0)
  );
  select event_row.* into v_source
  from public.ops_task_events event_row
  where event_row.task_id = p_task_id
    and event_row.event_type = 'registration_case_created'
  order by event_row.created_at, event_row.id
  limit 1;
  if not found then
    raise exception 'registration_case_created_source_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from dashboard_private.notification_events canonical
    where canonical.workflow_key = 'registration'
      and canonical.event_key = 'registration.case_created'
      and canonical.source_type = 'ops_task_event'
      and canonical.source_id = v_source.id::text
      and canonical.occurrence_key = v_source.id::text
  ) then
    return pg_catalog.jsonb_build_object(
      'taskId', p_task_id,
      'sourceEventIds', pg_catalog.jsonb_build_array(v_source.id)
    );
  end if;

  select track.id into v_track_id
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by dashboard_private.registration_subject_sort_order(track.subject), track.id
  limit 1;
  if v_track_id is null then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  perform dashboard_private.record_registration_management_notification_v1(
    v_source.id,
    'registration.case_created',
    p_task_id,
    v_track_id,
    null,
    v_source.created_at,
    v_source.actor_id
  );
  return pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'sourceEventIds', pg_catalog.jsonb_build_array(v_source.id)
  );
end;
$$;

create or replace function public.ensure_registration_workflow_notification_v1(
  p_track_id uuid,
  p_workflow_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_role text;
  v_task public.ops_tasks%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_registration_source record;
  v_source public.ops_task_events%rowtype;
  v_source_payload jsonb;
  v_destination text;
  v_event_key text;
begin
  if v_actor is null
    or p_track_id is null
    or p_workflow_revision is null
    or p_workflow_revision < 1
  then
    raise exception 'registration_management_notification_access_denied' using errcode = '42501';
  end if;

  select track, task into v_registration_source
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task on task.id = track.task_id
  where track.id = p_track_id
    and task.type = 'registration';
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  v_track := v_registration_source.track;
  v_task := v_registration_source.task;
  select profile.role into v_actor_role
  from public.profiles profile
  where profile.id = v_actor;
  if not (
    v_actor_role in ('admin', 'staff')
    or v_task.requested_by = v_actor
    or v_task.assignee_id = v_actor
    or v_task.secondary_assignee_id = v_actor
  ) then
    raise exception 'registration_management_notification_access_denied' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'registration-workflow-chat:' || p_track_id::text || ':' || p_workflow_revision::text,
    0
  ));
  select event_row.*
  into v_source
  from public.ops_task_events event_row
  where event_row.task_id = v_track.task_id
    and event_row.actor_id = v_actor
    and event_row.event_type = 'registration_track_event'
    and event_row.field_name = 'registration_track:' || p_track_id::text
    and event_row.after_value::jsonb ->> 'event_type' = 'registration_workflow_status_changed'
    and (event_row.after_value::jsonb -> 'metadata' ->> 'workflowRevision')::integer = p_workflow_revision
  order by event_row.created_at desc, event_row.id desc
  limit 1;
  if not found then
    raise exception 'registration_workflow_notification_source_not_found' using errcode = 'P0002';
  end if;
  v_source_payload := v_source.after_value::jsonb;

  v_destination := nullif(v_source_payload ->> 'destination', '');
  v_event_key := case
    when v_destination = 'consultation_completed'
      then 'registration.consultation_completed'
    when v_destination in ('waiting_current_class', 'waiting_new_class', 'waiting_next_opening')
      then 'registration.waiting_transitioned'
    when v_destination = 'enrollment_requested'
      then 'registration.admission_started'
    else null
  end;
  if v_event_key is null then
    return pg_catalog.jsonb_build_object(
      'trackId', p_track_id,
      'workflowRevision', p_workflow_revision,
      'sourceEventIds', '[]'::jsonb
    );
  end if;

  if not exists (
    select 1
    from dashboard_private.notification_events canonical
    where canonical.workflow_key = 'registration'
      and canonical.event_key = v_event_key
      and canonical.source_type = 'ops_task_event'
      and canonical.source_id = v_source.id::text
      and canonical.occurrence_key = v_source.id::text
  ) then
    perform dashboard_private.record_registration_management_notification_v1(
      v_source.id,
      v_event_key,
      v_track.task_id,
      v_track.id,
      p_workflow_revision,
      v_source.created_at,
      v_source.actor_id
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'trackId', p_track_id,
    'workflowRevision', p_workflow_revision,
    'sourceEventIds', pg_catalog.jsonb_build_array(v_source.id)
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
  select coalesce(
    pg_catalog.jsonb_agg(event_row.id order by event_row.created_at, event_row.id),
    '[]'::jsonb
  )
  into v_source_ids
  from public.ops_task_events event_row
  join dashboard_private.notification_events canonical
    on canonical.workflow_key = 'registration'
   and canonical.source_type = 'ops_task_event'
   and canonical.source_id = event_row.id::text
   and canonical.occurrence_key = event_row.id::text
  where event_row.task_id = p_task_id
    and canonical.event_key in (
      'registration.case_created',
      'registration.consultation_completed',
      'registration.waiting_transitioned',
      'registration.admission_started',
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
  v_render_payload jsonb;
  v_current_status text;
begin
  if p_source_event_id is null or p_actor_profile_id is null then
    raise exception 'registration_core_legacy_plan_invalid' using errcode = '22023';
  end if;
  select event_row.* into v_source
  from public.ops_task_events event_row
  where event_row.id = p_source_event_id
    and event_row.event_type in ('registration_track_event', 'registration_case_created');
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
      'registration.consultation_completed',
      'registration.waiting_transitioned',
      'registration.admission_started',
      'registration.registration_completed',
      'registration.case_closed'
    );
  if not found then
    raise exception 'registration_core_canonical_event_not_found' using errcode = 'P0002';
  end if;

  v_current_status := case v_canonical.event_key
    when 'registration.case_created' then '상담 신청'
    when 'registration.consultation_completed' then '상담 완료'
    when 'registration.waiting_transitioned' then '대기 신청'
    when 'registration.admission_started' then '등록 신청'
    when 'registration.registration_completed' then '등록 완료'
    when 'registration.case_closed' then '종료'
  end;
  v_render_payload := v_canonical.payload || pg_catalog.jsonb_build_object(
    'subjects', coalesce(
      v_canonical.payload -> 'subjects',
      pg_catalog.jsonb_build_array(v_canonical.payload ->> 'subject')
    ),
    'inquiry_at', coalesce(
      dashboard_private.registration_notification_kst_datetime_v1(
        nullif(v_canonical.payload ->> 'inquiry_at', '')::timestamptz,
        v_canonical.occurred_at
      ),
      '확인 필요'
    ),
    'current_status', coalesce(v_canonical.payload ->> 'current_status', v_current_status),
    'progress_line', coalesce(v_canonical.payload ->> 'progress_line', ''),
    'reason_line', case
      when nullif(v_canonical.payload ->> 'reason', '') is null then ''
      else '[사유] ' || (v_canonical.payload ->> 'reason')
    end,
    'memo_line', coalesce(v_canonical.payload ->> 'memo_line', case
      when nullif(v_canonical.payload ->> 'memo', '') is null then ''
      else '[메모] ' || (v_canonical.payload ->> 'memo')
    end)
  );

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
    'renderedTitle', dashboard_private.registration_render_fixed_template_v2(
      template.title_template, v_render_payload, template.allowed_variables
    ),
    'renderedBody', dashboard_private.registration_render_fixed_template_v2(
      template.body_template, v_render_payload, template.allowed_variables
    ),
    'href', '/admin/registration?taskId=' || v_task.id::text
      || case
        when nullif(v_canonical.payload ->> 'track_id', '') is null then ''
        else '&trackId=' || (v_canonical.payload ->> 'track_id')
      end,
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

alter function dashboard_private.record_registration_management_notification_v1(
  uuid, text, uuid, uuid, bigint, timestamptz, uuid
) owner to postgres;
revoke all on function dashboard_private.record_registration_management_notification_v1(
  uuid, text, uuid, uuid, bigint, timestamptz, uuid
) from public, anon, authenticated, service_role;

alter function public.ensure_registration_case_created_notification_v1(uuid) owner to postgres;
revoke all on function public.ensure_registration_case_created_notification_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ensure_registration_case_created_notification_v1(uuid)
  to authenticated;

alter function public.ensure_registration_workflow_notification_v1(uuid, integer) owner to postgres;
revoke all on function public.ensure_registration_workflow_notification_v1(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.ensure_registration_workflow_notification_v1(uuid, integer)
  to authenticated;

alter function public.list_registration_legacy_source_ids_v1(uuid) owner to postgres;
revoke all on function public.list_registration_legacy_source_ids_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_registration_legacy_source_ids_v1(uuid)
  to authenticated;

alter function public.get_registration_core_legacy_dispatch_plan_v1(uuid, uuid) owner to postgres;
revoke all on function public.get_registration_core_legacy_dispatch_plan_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_registration_core_legacy_dispatch_plan_v1(uuid, uuid)
  to service_role;

commit;
