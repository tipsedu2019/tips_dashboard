-- Final definitions from 20260923085008 and (room assertion) 20260716192000.
-- Eleven domain SQLSTATE literals plus scoped approval/revert audit context.
-- CREATE OR REPLACE retains ACL/owner; errors roll back the whole statement.
-- Genuine PostgreSQL serialization failures remain 40001.
begin;

-- Source: 20260923085008_timetable_operational_conflict_guards.sql
CREATE OR REPLACE FUNCTION dashboard_private.transition_makeup_request_v2_unguarded(p_makeup_request_id uuid, p_command text, p_patch jsonb, p_expected_status text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid;
  actor_role text;
  before_row public.makeup_requests%rowtype;
  after_row public.makeup_requests%rowtype;
  ledger dashboard_private.notification_request_ledger%rowtype;
  fingerprint text;
  source_result jsonb;
  response jsonb;
  event_type text;
  note text := nullif(pg_catalog.btrim(coalesce(p_patch ->> 'note', '')), '');
  next_status text;
  latest_refund_at timestamptz;
  latest_submit_or_approve_at timestamptz;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  if p_command = 'approve' then
    if (select auth.role()) is distinct from 'service_role' then
      raise exception 'makeup_approval_server_required' using errcode = '42501';
    end if;
    actor_id := nullif(p_patch ->> 'actor_profile_id', '')::uuid;
    select profile.role into actor_role
    from public.profiles profile
    where profile.id = actor_id;
  else
    actor_id := (select auth.uid());
    actor_role := public.current_dashboard_role();
  end if;
  if actor_id is null or p_makeup_request_id is null or p_request_id is null
    or p_command is null
    or p_expected_status is null or p_patch is null
    or pg_catalog.jsonb_typeof(p_patch) <> 'object'
    or p_command not in (
      'approve', 'revision_requested', 'reject', 'refund_requested',
      'refund_completed', 'resubmit', 'approval_canceled'
    )
  then
    raise exception 'makeup_request_transition_invalid' using errcode = '22023';
  end if;

    if (p_command = 'approve' and p_patch - array[
      'actor_profile_id', 'final_note', 'schedule_plan_before', 'schedule_plan_after',
      'cancel_academic_event_id', 'makeup_academic_event_id',
      'makeup_academic_event_ids', 'calendar_events'
    ]::text[] <> '{}'::jsonb)
    or (p_command in ('revision_requested', 'reject', 'refund_requested',
      'refund_completed', 'approval_canceled')
      and p_patch - array['note']::text[] <> '{}'::jsonb)
    or (p_command = 'resubmit' and p_patch - array[
      'request_kind', 'subject', 'approval_group', 'teacher_catalog_id',
      'teacher_profile_id', 'class_id', 'class_name', 'reason', 'cancel_date',
      'makeup_start_at', 'makeup_end_at', 'makeup_classroom', 'makeup_slots',
      'approver_teacher_catalog_id', 'approver_profile_id'
    ]::text[] <> '{}'::jsonb)
  then
    raise exception 'makeup_request_transition_patch_invalid' using errcode = '22023';
  end if;

  fingerprint := pg_catalog.md5((case
    when p_command = 'approve' then pg_catalog.jsonb_build_object(
      'actor_id', actor_id,
      'makeup_request_id', p_makeup_request_id,
      'command', p_command,
      'final_note', p_patch ->> 'final_note',
      'expected_status', p_expected_status
    )
    else pg_catalog.jsonb_build_object(
      'actor_id', actor_id,
      'makeup_request_id', p_makeup_request_id,
      'command', p_command,
      'patch', p_patch,
      'expected_status', p_expected_status
    )
  end)::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notification-request:' || p_request_id::text, 0)
  );
  select receipt.* into ledger
  from dashboard_private.notification_request_ledger receipt
  where receipt.request_id = p_request_id;
  if found then
    if ledger.request_kind <> 'transition_makeup_request_v2'
      or ledger.request_fingerprint <> fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return ledger.response_payload;
  end if;

  select request.* into before_row
  from public.makeup_requests request
  where request.id = p_makeup_request_id
  for update of request;
  if not found then
    raise exception 'makeup_request_not_found' using errcode = 'P0002';
  end if;
  if before_row.status <> p_expected_status then
    raise exception 'makeup_request_stale_status' using errcode = 'P0001';
  end if;

  if p_command = 'approve' then
    if before_row.status <> 'approval_pending'
      or before_row.approver_profile_id is distinct from actor_id
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    select pg_catalog.max(event_row.created_at) filter (
      where event_row.event_type = 'refund_requested'
    ), pg_catalog.max(event_row.created_at) filter (
      where event_row.event_type in ('submitted', 'resubmitted', 'approved')
    ) into latest_refund_at, latest_submit_or_approve_at
    from public.makeup_request_events event_row
    where event_row.request_id = before_row.id;
    next_status := case
      when latest_refund_at is not null
        and latest_refund_at > coalesce(latest_submit_or_approve_at, '-infinity'::timestamptz)
        then 'refund_pending'
      when before_row.request_kind in ('cancel_makeup', 'makeup_only') then 'completed'
      else 'makeup_pending'
    end;
    if next_status = 'refund_pending' then
      if p_patch - array['actor_profile_id', 'final_note']::text[] <> '{}'::jsonb then
        raise exception 'makeup_refund_approval_patch_invalid' using errcode = '22023';
      end if;
    else
      if not (
        p_patch ? 'schedule_plan_before'
        and p_patch ? 'schedule_plan_after'
        and p_patch ? 'makeup_academic_event_ids'
        and p_patch ? 'calendar_events'
      ) then
        raise exception 'makeup_calendar_effects_invalid' using errcode = '22023';
      end if;
      perform 1
      from public.classes class_row
      where class_row.id = before_row.class_id
      for update of class_row;
      if not found then
        raise exception 'makeup_request_source_changed' using errcode = 'P0001';
      end if;
      if not exists (
        select 1
        from public.classes class_row
        join public.teacher_catalogs teacher
          on teacher.id = before_row.teacher_catalog_id
        join public.teacher_catalogs approver
          on approver.id = before_row.approver_teacher_catalog_id
        where class_row.id = before_row.class_id
          and pg_catalog.btrim(class_row.name) = pg_catalog.btrim(before_row.class_name)
          and pg_catalog.btrim(class_row.subject) = pg_catalog.btrim(before_row.subject)
          and pg_catalog.btrim(teacher.name) = pg_catalog.btrim(class_row.teacher)
          and teacher.profile_id is not distinct from before_row.teacher_profile_id
          and approver.profile_id is not distinct from before_row.approver_profile_id
      ) then
        raise exception 'makeup_request_source_changed' using errcode = 'P0001';
      end if;
      perform dashboard_private.notification_assert_makeup_room_available_v1(
        before_row.id
      );
      -- Only a validated server transition may establish schedule/audit context.
    -- Restore every setting so callers cannot retain direct-write permission.
    declare previous_context jsonb := '{}'::jsonb; context_key text;
    begin
      foreach context_key in array array['app.class_schedule_mutation','app.class_schedule_class_id','app.class_schedule_request_key','app.class_schedule_request_operation','app.class_schedule_change_reason'] loop
        previous_context := previous_context || jsonb_build_object(context_key, current_setting(context_key, true));
      end loop;
      perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
        before_row.class_id, p_request_id, 'makeup_' || p_command, coalesce(note, p_patch->>'final_note')
      );
    perform dashboard_private.notification_apply_makeup_calendar_effects_v1(
        before_row.id,
        before_row.class_id,
        p_patch -> 'schedule_plan_before',
        p_patch -> 'schedule_plan_after',
        nullif(p_patch ->> 'cancel_academic_event_id', '')::uuid,
        nullif(p_patch ->> 'makeup_academic_event_id', '')::uuid,
        p_patch -> 'makeup_academic_event_ids',
        p_patch -> 'calendar_events'
      );
      foreach context_key in array array['app.class_schedule_mutation','app.class_schedule_class_id','app.class_schedule_request_key','app.class_schedule_request_operation','app.class_schedule_change_reason'] loop
        perform set_config(context_key, coalesce(previous_context->>context_key, ''), true);
      end loop;
    end;
    end if;
    update public.makeup_requests request
    set status = next_status,
        approved_by = actor_id,
        approved_at = pg_catalog.clock_timestamp(),
        completed_by = case when next_status = 'completed' then actor_id else null end,
        completed_at = case when next_status = 'completed'
          then pg_catalog.clock_timestamp() else null end,
        final_note = nullif(p_patch ->> 'final_note', ''),
        returned_reason = null,
        rejected_reason = null,
        schedule_plan_before = case when next_status = 'refund_pending'
          then request.schedule_plan_before else p_patch -> 'schedule_plan_before' end,
        schedule_plan_after = case when next_status = 'refund_pending'
          then request.schedule_plan_after else p_patch -> 'schedule_plan_after' end,
        cancel_academic_event_id = case when next_status = 'refund_pending'
          then request.cancel_academic_event_id
          else nullif(p_patch ->> 'cancel_academic_event_id', '')::uuid end,
        makeup_academic_event_id = case when next_status = 'refund_pending'
          then request.makeup_academic_event_id
          else nullif(p_patch ->> 'makeup_academic_event_id', '')::uuid end,
        makeup_academic_event_ids = case when next_status = 'refund_pending'
          then request.makeup_academic_event_ids
          else p_patch -> 'makeup_academic_event_ids' end
    where request.id = before_row.id
    returning * into after_row;
    event_type := 'approved';
    note := nullif(p_patch ->> 'final_note', '');
  elsif p_command = 'revision_requested' then
    if before_row.status <> 'approval_pending'
      or before_row.approver_profile_id is distinct from actor_id
      or note is null
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    update public.makeup_requests request
    set status = 'revision_requested', returned_reason = note
    where request.id = before_row.id returning * into after_row;
    event_type := 'revision_requested';
  elsif p_command = 'reject' then
    if before_row.status <> 'approval_pending'
      or before_row.approver_profile_id is distinct from actor_id
      or note is null
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    update public.makeup_requests request
    set status = 'rejected', rejected_reason = note
    where request.id = before_row.id returning * into after_row;
    event_type := 'rejected';
  elsif p_command = 'refund_requested' then
    if before_row.status <> 'makeup_pending'
      or not (
        coalesce(before_row.requester_id = actor_id, false)
        or coalesce(actor_role in ('admin', 'staff'), false)
      )
      or note is null
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    update public.makeup_requests request
    set status = 'approval_pending',
        approved_by = null,
        approved_at = null,
        completed_by = null,
        completed_at = null,
        final_note = null,
        returned_reason = null,
        rejected_reason = null
    where request.id = before_row.id returning * into after_row;
    event_type := 'refund_requested';
  elsif p_command = 'refund_completed' then
    if before_row.status <> 'refund_pending'
      or coalesce(actor_role in ('admin', 'staff'), false) = false
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    update public.makeup_requests request
    set status = 'completed',
        completed_by = actor_id,
        completed_at = pg_catalog.clock_timestamp(),
        final_note = coalesce(note, request.final_note)
    where request.id = before_row.id returning * into after_row;
    event_type := 'refund_completed';
  elsif p_command = 'resubmit' then
    if before_row.status <> 'revision_requested'
      or before_row.requester_id is distinct from actor_id
      or not coalesce(
        dashboard_private.notification_makeup_input_valid_v1(
          p_patch || pg_catalog.jsonb_build_object('requester_id', before_row.requester_id),
          before_row.created_at
        ),
        false
      )
    then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    update public.makeup_requests request
    set status = 'approval_pending',
        request_kind = p_patch ->> 'request_kind',
        subject = p_patch ->> 'subject',
        approval_group = p_patch ->> 'approval_group',
        teacher_catalog_id = nullif(p_patch ->> 'teacher_catalog_id', '')::uuid,
        teacher_profile_id = nullif(p_patch ->> 'teacher_profile_id', '')::uuid,
        class_id = nullif(p_patch ->> 'class_id', '')::uuid,
        class_name = coalesce(p_patch ->> 'class_name', ''),
        reason = coalesce(p_patch ->> 'reason', ''),
        cancel_date = nullif(p_patch ->> 'cancel_date', '')::date,
        makeup_start_at = nullif(p_patch ->> 'makeup_start_at', '')::timestamptz,
        makeup_end_at = nullif(p_patch ->> 'makeup_end_at', '')::timestamptz,
        makeup_classroom = nullif(p_patch ->> 'makeup_classroom', ''),
        makeup_slots = coalesce(p_patch -> 'makeup_slots', '[]'::jsonb),
        approver_teacher_catalog_id = nullif(
          p_patch ->> 'approver_teacher_catalog_id', ''
        )::uuid,
        approver_profile_id = nullif(p_patch ->> 'approver_profile_id', '')::uuid,
        returned_reason = null,
        rejected_reason = null,
        approved_by = null,
        approved_at = null,
        completed_by = null,
        completed_at = null
    where request.id = before_row.id returning * into after_row;
    event_type := 'resubmitted';
  elsif p_command = 'approval_canceled' then
    if (
      (before_row.status = 'completed'
        and coalesce(before_row.approver_profile_id = actor_id, false))
      or (before_row.status = 'makeup_pending'
        and (
          coalesce(before_row.approver_profile_id = actor_id, false)
          or coalesce(actor_role in ('admin', 'staff'), false)
        ))
    ) is not true then
      raise exception 'makeup_request_transition_forbidden' using errcode = '42501';
    end if;
    -- Only a validated server transition may establish schedule/audit context.
    -- Restore every setting so callers cannot retain direct-write permission.
    declare previous_context jsonb := '{}'::jsonb; context_key text;
    begin
      foreach context_key in array array['app.class_schedule_mutation','app.class_schedule_class_id','app.class_schedule_request_key','app.class_schedule_request_operation','app.class_schedule_change_reason'] loop
        previous_context := previous_context || jsonb_build_object(context_key, current_setting(context_key, true));
      end loop;
      perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
        before_row.class_id, p_request_id, 'makeup_' || p_command, coalesce(note, p_patch->>'final_note')
      );
    perform dashboard_private.notification_revert_makeup_calendar_effects_v1(
      before_row.id,
      before_row.class_id,
      before_row.schedule_plan_before,
      before_row.schedule_plan_after,
      before_row.cancel_academic_event_id,
      before_row.makeup_academic_event_id,
      before_row.makeup_academic_event_ids
    );
      foreach context_key in array array['app.class_schedule_mutation','app.class_schedule_class_id','app.class_schedule_request_key','app.class_schedule_request_operation','app.class_schedule_change_reason'] loop
        perform set_config(context_key, coalesce(previous_context->>context_key, ''), true);
      end loop;
    end;
    update public.makeup_requests request
    set status = 'canceled',
        canceled_by = actor_id,
        canceled_at = pg_catalog.clock_timestamp()
    where request.id = before_row.id returning * into after_row;
    event_type := 'approval_canceled';
  else
    raise exception 'makeup_request_transition_invalid' using errcode = '22023';
  end if;

  source_result := dashboard_private.record_makeup_notification_source_v2(
    after_row.id,
    event_type,
    before_row.status,
    after_row.status,
    note,
    p_request_id,
    actor_id
  );
  if event_type = 'approval_canceled' then
    perform dashboard_private.cancel_makeup_unsent_deliveries_v1(
      after_row.id,
      (source_result ->> 'canonical_event_id')::uuid
    );
  end if;
  response := pg_catalog.jsonb_build_object(
    'request', pg_catalog.to_jsonb(after_row),
    'sourceEventId', source_result ->> 'source_event_id'
  );
  insert into dashboard_private.notification_request_ledger(
    request_id, request_kind, request_fingerprint, response_payload
  ) values (p_request_id, 'transition_makeup_request_v2', fingerprint, response);
  return response;
end;
$function$
;

-- Source: 20260923085008_timetable_operational_conflict_guards.sql
CREATE OR REPLACE FUNCTION dashboard_private.notification_revert_makeup_calendar_effects_legacy_v1(p_request_id uuid, p_class_id uuid, p_schedule_plan_before jsonb, p_schedule_plan_after jsonb, p_cancel_academic_event_id uuid, p_makeup_academic_event_id uuid, p_makeup_academic_event_ids jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  if p_request_id is null
    or p_class_id is null
    or p_schedule_plan_before is null
    or pg_catalog.jsonb_typeof(p_schedule_plan_before) <> 'object'
    or p_schedule_plan_after is null
    or pg_catalog.jsonb_typeof(p_schedule_plan_after) <> 'object'
    or p_makeup_academic_event_ids is null
    or pg_catalog.jsonb_typeof(p_makeup_academic_event_ids) <> 'array'
  then
    raise exception 'makeup_calendar_revert_invalid' using errcode = '22023';
  end if;

  update public.classes class_row
  set schedule_plan = p_schedule_plan_before
  where class_row.id = p_class_id
    and coalesce(class_row.schedule_plan, '{}'::jsonb) in (
      p_schedule_plan_before,
      p_schedule_plan_after
    );
  if not found then
    raise exception 'makeup_schedule_plan_stale' using errcode = 'P0001';
  end if;

  delete from public.academic_events event_row
  where pg_catalog.strpos(coalesce(event_row.note, ''), '[[TIPS_MAKEUP]]') > 0
    and pg_catalog.strpos(coalesce(event_row.note, ''), p_request_id::text) > 0
    and (
      event_row.id = p_cancel_academic_event_id
      or event_row.id = p_makeup_academic_event_id
      or event_row.id::text in (
        select item.value
        from pg_catalog.jsonb_array_elements_text(p_makeup_academic_event_ids) item(value)
      )
    );
end;
$function$
;

-- Source: 20260923085008_timetable_operational_conflict_guards.sql
CREATE OR REPLACE FUNCTION dashboard_private.notification_apply_makeup_calendar_effects_legacy_v1(p_request_id uuid, p_class_id uuid, p_schedule_plan_before jsonb, p_schedule_plan_after jsonb, p_cancel_academic_event_id uuid, p_makeup_academic_event_id uuid, p_makeup_academic_event_ids jsonb, p_calendar_events jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  calendar_event jsonb;
  allowed_event_ids uuid[];
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  if p_request_id is null
    or p_class_id is null
    or p_schedule_plan_before is null
    or pg_catalog.jsonb_typeof(p_schedule_plan_before) <> 'object'
    or p_schedule_plan_after is null
    or pg_catalog.jsonb_typeof(p_schedule_plan_after) <> 'object'
    or p_makeup_academic_event_ids is null
    or pg_catalog.jsonb_typeof(p_makeup_academic_event_ids) <> 'array'
    or p_calendar_events is null
    or pg_catalog.jsonb_typeof(p_calendar_events) <> 'array'
  then
    raise exception 'makeup_calendar_effects_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements_text(p_makeup_academic_event_ids) item(value)
    where item.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'makeup_calendar_effects_invalid' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.array_agg(distinct event_id), array[]::uuid[])
  into allowed_event_ids
  from (
    select p_cancel_academic_event_id as event_id
    union all
    select p_makeup_academic_event_id
    union all
    select item.value::uuid
    from pg_catalog.jsonb_array_elements_text(p_makeup_academic_event_ids) item(value)
  ) event_ids
  where event_id is not null;

  if pg_catalog.cardinality(allowed_event_ids) = 0
    or pg_catalog.jsonb_array_length(p_calendar_events)
      <> pg_catalog.cardinality(allowed_event_ids)
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_calendar_events) item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'object'
        or item.value - array['id', 'title', 'date', 'type', 'grade', 'note']::text[]
          <> '{}'::jsonb
        or coalesce(item.value ->> 'id', '')
          !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or nullif(pg_catalog.btrim(item.value ->> 'title'), '') is null
        or pg_catalog.length(item.value ->> 'title') > 200
        or coalesce(item.value ->> 'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or coalesce(item.value ->> 'type', '') <> '팁스'
        or coalesce(item.value ->> 'grade', '') <> 'all'
        or nullif(pg_catalog.btrim(item.value ->> 'note'), '') is null
        or pg_catalog.length(item.value ->> 'note') > 4000
        or pg_catalog.strpos(item.value ->> 'note', '[[TIPS_MAKEUP]]') = 0
        or pg_catalog.strpos(item.value ->> 'note', p_request_id::text) = 0
    )
  then
    raise exception 'makeup_calendar_effects_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_calendar_events) item(value)
    where not ((item.value ->> 'id')::uuid = any(allowed_event_ids))
  ) or (
    select pg_catalog.count(distinct (item.value ->> 'id')::uuid)
    from pg_catalog.jsonb_array_elements(p_calendar_events) item(value)
  ) <> pg_catalog.cardinality(allowed_event_ids)
  then
    raise exception 'makeup_calendar_effects_mismatch' using errcode = '22023';
  end if;

  update public.classes class_row
  set schedule_plan = p_schedule_plan_after
  where class_row.id = p_class_id
    and coalesce(class_row.schedule_plan, '{}'::jsonb) = p_schedule_plan_before;
  if not found then
    raise exception 'makeup_schedule_plan_stale' using errcode = 'P0001';
  end if;

  for calendar_event in
    select item.value
    from pg_catalog.jsonb_array_elements(p_calendar_events) item(value)
    order by item.value ->> 'id'
  loop
    insert into public.academic_events(id, title, date, type, grade, note)
    values (
      (calendar_event ->> 'id')::uuid,
      calendar_event ->> 'title',
      (calendar_event ->> 'date')::date,
      calendar_event ->> 'type',
      calendar_event ->> 'grade',
      calendar_event ->> 'note'
    )
    on conflict (id) do update
    set title = excluded.title,
        date = excluded.date,
        type = excluded.type,
        grade = excluded.grade,
        note = excluded.note
    where pg_catalog.strpos(
      coalesce(public.academic_events.note, ''), '[[TIPS_MAKEUP]]'
    ) > 0
      and pg_catalog.strpos(
        coalesce(public.academic_events.note, ''), p_request_id::text
      ) > 0;
    if not found then
      raise exception 'makeup_calendar_event_conflict' using errcode = '23P01';
    end if;
  end loop;
end;
$function$
;

-- Source: 20260923085008_timetable_operational_conflict_guards.sql
CREATE OR REPLACE FUNCTION dashboard_private.revert_normalized_makeup_effect_v1(p_request_id uuid, p_class_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_request public.makeup_requests%rowtype; v_session public.class_lesson_sessions%rowtype;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  select * into v_request from public.makeup_requests where id = p_request_id for update;
  select * into v_session from public.class_lesson_sessions
    where id = v_request.original_lesson_session_id and class_id = p_class_id for update;
  if not found or v_session.revision is distinct from v_request.makeup_effect_revision then
    raise exception 'makeup_lesson_session_stale' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements_text(v_request.makeup_lesson_session_ids) item
    join public.class_lesson_sessions session on session.id = item.value::uuid
    where session.revision <> 0) then raise exception 'makeup_lesson_session_stale' using errcode = 'P0001'; end if;
  update public.class_lesson_sessions set schedule_state = 'active', revision = revision + 1 where id = v_session.id;
  delete from public.class_lesson_sessions where id in (select value::uuid from jsonb_array_elements_text(v_request.makeup_lesson_session_ids));
end;
$function$
;

-- Source: 20260923085008_timetable_operational_conflict_guards.sql
CREATE OR REPLACE FUNCTION dashboard_private.apply_normalized_makeup_effect_v1(p_request_id uuid, p_class_id uuid, p_calendar_events jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request public.makeup_requests%rowtype;
  v_session public.class_lesson_sessions%rowtype;
  v_slot jsonb;
  v_new_ids jsonb := '[]'::jsonb;
  v_new_id uuid;
begin
  perform dashboard_private.lock_timetable_operating_resources_v1();
  select * into v_request from public.makeup_requests where id = p_request_id for update;
  select * into v_session from public.class_lesson_sessions
    where id = v_request.original_lesson_session_id and class_id = p_class_id for update;
  if not found or v_session.schedule_state not in ('active', 'makeup') then
    raise exception 'makeup_lesson_session_stale' using errcode = 'P0001';
  end if;
  if v_request.original_lesson_session_revision is distinct from v_session.revision then
    raise exception 'makeup_lesson_session_stale' using errcode = 'P0001';
  end if;
  update public.class_lesson_sessions set schedule_state = 'exception', revision = revision + 1
    where id = v_session.id;
  for v_slot in select value from jsonb_array_elements(v_request.makeup_slots) loop
    if ((v_slot->>'endAt')::timestamptz at time zone 'Asia/Seoul')::date
       <> ((v_slot->>'startAt')::timestamptz at time zone 'Asia/Seoul')::date
       and not (((v_slot->>'endAt')::timestamptz at time zone 'Asia/Seoul')::date = ((v_slot->>'startAt')::timestamptz at time zone 'Asia/Seoul')::date + 1
         and ((v_slot->>'endAt')::timestamptz at time zone 'Asia/Seoul')::time = '00:00'::time) then
      raise exception using errcode='22023',message='class_schedule_validation';
    end if;
    insert into public.class_lesson_sessions(
      class_id, session_key, session_date, schedule_state, start_time, end_time,
      teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id, classroom_name_snapshot, origin,
      memo, created_by, updated_by
    ) values (
      p_class_id, 'makeup:' || p_request_id::text || ':' || (jsonb_array_length(v_new_ids) + 1)::text,
      ((v_slot ->> 'startAt')::timestamptz at time zone 'Asia/Seoul')::date, 'makeup',
      ((v_slot ->> 'startAt')::timestamptz at time zone 'Asia/Seoul')::time, case when ((v_slot->>'endAt')::timestamptz at time zone 'Asia/Seoul')::date > ((v_slot->>'startAt')::timestamptz at time zone 'Asia/Seoul')::date then '24:00'::time else ((v_slot ->> 'endAt')::timestamptz at time zone 'Asia/Seoul')::time end,
      v_session.teacher_catalog_id, v_session.teacher_name_snapshot, (select min(id::text)::uuid from public.classroom_catalogs where name = v_slot ->> 'classroom' having count(*)=1), v_slot ->> 'classroom', 'manual',
      coalesce(v_request.reason, ''), (select auth.uid()), (select auth.uid())
    ) returning id into v_new_id;
    v_new_ids := v_new_ids || jsonb_build_array(v_new_id);
  end loop;
  update public.makeup_requests set makeup_lesson_session_ids = v_new_ids,
    makeup_effect_revision = v_session.revision + 1 where id = p_request_id;
end;
$function$
;

-- Source: 20260716192000_notification_makeup_adapter.sql
create or replace function dashboard_private.notification_assert_makeup_room_available_v1(
  p_request_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room text;
begin
  if p_request_id is null or not exists (
    select 1 from public.makeup_requests request_row where request_row.id = p_request_id
  ) then
    raise exception 'makeup_request_not_found' using errcode = 'P0002';
  end if;

  -- 여러 슬롯의 잠금 순서를 고정해 교차 강의실 승인도 교착 없이 직렬화한다.
  for v_room in
    select distinct slot.room_key
    from dashboard_private.notification_makeup_room_slots_v1(p_request_id) slot
    order by slot.room_key
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('makeup-room:' || v_room, 0)
    );
  end loop;

  -- advisory lock 대기 뒤 최신 커밋 상태를 다시 읽는다. 먼저 완료된 승인만
  -- 점유로 간주하므로 동일 시각 동시 승인 두 건 중 하나만 성공한다.
  if exists (
    select 1
    from dashboard_private.notification_makeup_room_slots_v1(p_request_id) current_slot
    join public.makeup_requests other_request
      on other_request.id <> p_request_id
     and other_request.status in ('makeup_pending', 'completed')
    cross join lateral dashboard_private.notification_makeup_room_slots_v1(
      other_request.id
    ) occupied_slot
    where current_slot.room_key = occupied_slot.room_key
      and current_slot.start_at < occupied_slot.end_at
      and occupied_slot.start_at < current_slot.end_at
  ) then
    raise exception 'makeup_room_collision' using errcode = '23P01';
  end if;
end;
$$;

commit;
