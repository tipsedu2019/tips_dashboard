begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A registration status is only a manually editable property. Notification
-- creation is a separate, explicit action that validates the message facts at
-- send time and never changes registration data.
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
  v_task public.ops_tasks%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_registration_source record;
  v_source public.ops_task_events%rowtype;
  v_event_key text;
  v_missing_fields text[] := array[]::text[];
  v_source_event_id uuid;
begin
  if v_actor is null
    or p_track_id is null
    or p_workflow_revision is null
    or p_workflow_revision < 1
  then
    raise exception 'registration_management_notification_access_denied'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles actor
    join auth.users account
      on account.id = actor.id
     and account.deleted_at is null
     and (
       account.banned_until is null
       or account.banned_until <= pg_catalog.now()
     )
    where actor.id = v_actor
      and actor.role in ('admin', 'staff')
  ) then
    raise exception 'registration_management_notification_access_denied'
      using errcode = '42501';
  end if;

  select task, track, detail
  into v_registration_source
  from public.ops_tasks task
  join public.ops_registration_subject_tracks track
    on track.task_id = task.id
  join public.ops_registration_details detail
    on detail.task_id = task.id
  where track.id = p_track_id
    and task.type = 'registration'
  for update of task, track;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  v_task := v_registration_source.task;
  v_track := v_registration_source.track;
  v_detail := v_registration_source.detail;

  if v_track.workflow_revision <> p_workflow_revision then
    raise exception 'registration_management_notification_refresh_required'
      using errcode = '23514';
  end if;

  v_event_key := case
    when v_track.workflow_status = 'consultation_requested'
      then 'registration.case_created'
    when v_track.workflow_status = 'consultation_completed'
      then 'registration.consultation_completed'
    when v_track.workflow_status in (
      'waiting_current_class',
      'waiting_new_class',
      'waiting_next_opening'
    ) then 'registration.waiting_transitioned'
    when v_track.workflow_status = 'enrollment_requested'
      then 'registration.admission_started'
    else null
  end;
  if v_event_key is null then
    return pg_catalog.jsonb_build_object(
      'trackId', v_track.id,
      'workflowRevision', v_track.workflow_revision,
      'sourceEventIds', '[]'::jsonb,
      'ready', false,
      'missingFields', pg_catalog.jsonb_build_array(
        '현재 진행상태에는 보낼 관리 알림이 없습니다'
      )
    );
  end if;

  if nullif(pg_catalog.btrim(coalesce(v_task.student_name, '')), '') is null then
    v_missing_fields := pg_catalog.array_append(v_missing_fields, '학생 이름');
  end if;
  if nullif(pg_catalog.btrim(coalesce(v_track.subject, '')), '') is null then
    v_missing_fields := pg_catalog.array_append(v_missing_fields, '과목');
  end if;
  if v_event_key = 'registration.case_created' then
    if nullif(pg_catalog.btrim(coalesce(v_detail.school_grade, '')), '') is null then
      v_missing_fields := pg_catalog.array_append(v_missing_fields, '학년');
    end if;
    if v_detail.inquiry_at is null then
      v_missing_fields := pg_catalog.array_append(v_missing_fields, '문의 시각');
    end if;
  end if;
  if pg_catalog.cardinality(v_missing_fields) > 0 then
    raise exception 'registration_management_notification_not_ready'
      using errcode = '23514', detail = pg_catalog.array_to_string(v_missing_fields, ', ');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'registration-workflow-chat:'
      || v_track.id::text
      || ':'
      || v_track.workflow_revision::text
      || ':'
      || v_event_key,
    0
  ));

  -- Reuse an already-created explicit request, or the original status audit
  -- event from older clients, so retries and mixed-version clients dedupe.
  with parsed_source_events as materialized (
    select
      event_row as source_event,
      dashboard_private.try_registration_event_jsonb_object(
        event_row.after_value
      ) as payload
    from public.ops_task_events event_row
    where event_row.task_id = v_track.task_id
      and event_row.event_type = 'registration_track_event'
      and event_row.field_name = 'registration_track:' || v_track.id::text
  )
  select (parsed.source_event).*
  into v_source
  from parsed_source_events parsed
  where (parsed.payload ->> 'event_type') in (
      'registration_management_notification_requested',
      'registration_workflow_status_changed'
    )
    and parsed.payload ->> 'destination' = v_track.workflow_status
    and (parsed.payload -> 'metadata' ->> 'workflowRevision')::integer
      = v_track.workflow_revision
    and coalesce(
      parsed.payload -> 'metadata' ->> 'eventKey',
      v_event_key
    ) = v_event_key
  order by
    case when parsed.payload ->> 'event_type'
      = 'registration_management_notification_requested' then 0 else 1 end,
    (parsed.source_event).created_at desc,
    (parsed.source_event).id desc
  limit 1;

  if not found then
    v_source_event_id := dashboard_private.write_registration_track_event_v2(
      v_track.task_id,
      v_track.id,
      'registration_management_notification_requested',
      v_track.workflow_status,
      v_track.workflow_status,
      'manual_notification',
      pg_catalog.jsonb_build_object(
        'workflowStatus', v_track.workflow_status,
        'workflowRevision', v_track.workflow_revision,
        'eventKey', v_event_key
      ),
      'user',
      null
    );
    select event_row.*
    into strict v_source
    from public.ops_task_events event_row
    where event_row.id = v_source_event_id;
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
      v_track.workflow_revision,
      v_source.created_at,
      v_source.actor_id
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'trackId', v_track.id,
    'workflowRevision', v_track.workflow_revision,
    'sourceEventIds', pg_catalog.jsonb_build_array(v_source.id),
    'ready', true,
    'missingFields', '[]'::jsonb
  );
end;
$$;

alter function public.ensure_registration_workflow_notification_v1(uuid, integer)
  owner to postgres;
revoke all on function public.ensure_registration_workflow_notification_v1(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.ensure_registration_workflow_notification_v1(uuid, integer)
  to authenticated;

-- The task-only producer predates per-status readiness and can bypass the
-- canonical track revision plus required-message-fact checks. Keep the exact
-- signature as a fail-closed compatibility boundary, but expose it to nobody.
create or replace function public.ensure_registration_case_created_notification_v1(
  p_task_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'registration_case_created_notification_retired'
    using errcode = '55000';
end;
$$;

alter function public.ensure_registration_case_created_notification_v1(uuid)
  owner to postgres;
revoke all on function public.ensure_registration_case_created_notification_v1(uuid)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
