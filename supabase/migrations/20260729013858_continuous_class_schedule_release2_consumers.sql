alter table public.ops_registration_enrollments
  add column class_start_lesson_session_id uuid
    references public.class_lesson_sessions(id) on delete set null;

create index ops_registration_enrollments_class_start_lesson_session_id_idx
  on public.ops_registration_enrollments(class_start_lesson_session_id)
  where class_start_lesson_session_id is not null;

create or replace function dashboard_private.validate_registration_class_session(
  p_class_id uuid,
  p_date date,
  p_session_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_plan jsonb;
  v_session jsonb;
  v_state text;
  v_date_text text;
  v_number_text text;
  v_session_date date;
  v_session_number integer;
  v_canonical_key text;
begin
  select schedule_storage_mode, to_jsonb(schedule_plan)
  into v_mode, v_plan
  from public.classes
  where id = p_class_id;

  if not found or p_date is null or nullif(pg_catalog.btrim(p_session_key), '') is null then
    return jsonb_build_object('valid', false, 'sessionDate', null, 'sessionKey', null, 'sessionLabel', null);
  end if;

  if v_mode = 'normalized' then
    select session_date, session_key into v_session_date, v_canonical_key
    from public.class_lesson_sessions
    where class_id = p_class_id
      and session_date = p_date
      and session_key = pg_catalog.btrim(p_session_key)
      and schedule_state in ('active', 'makeup');
    if found then
      return jsonb_build_object(
        'valid', true,
        'sessionDate', to_char(v_session_date, 'YYYY-MM-DD'),
        'sessionKey', v_canonical_key,
        'sessionLabel', '수업'
      );
    end if;
    return jsonb_build_object('valid', false, 'sessionDate', null, 'sessionKey', null, 'sessionLabel', null);
  end if;

  for v_session in
    select item.value from jsonb_array_elements(case
      when jsonb_typeof(v_plan -> 'sessions') = 'array' then v_plan -> 'sessions'
      when jsonb_typeof(v_plan -> 'session_list') = 'array' then v_plan -> 'session_list'
      else '[]'::jsonb
    end) item(value)
  loop
    v_state := lower(coalesce(nullif(btrim(v_session ->> 'scheduleState'), ''), nullif(btrim(v_session ->> 'schedule_state'), ''), nullif(btrim(v_session ->> 'state'), ''), 'active'));
    if v_state not in ('active', 'normal', 'makeup') then continue; end if;
    v_date_text := coalesce(nullif(btrim(v_session ->> 'date'), ''), nullif(btrim(v_session ->> 'session_date'), ''), nullif(btrim(v_session ->> 'dateValue'), ''), nullif(btrim(v_session ->> 'date_value'), ''));
    v_number_text := coalesce(nullif(btrim(v_session ->> 'sessionNumber'), ''), nullif(btrim(v_session ->> 'session_number'), ''));
    if v_date_text !~ '^\d{4}-\d{2}-\d{2}$' or v_number_text !~ '^[1-9]\d*$' then continue; end if;
    begin
      v_session_date := v_date_text::date;
      v_session_number := v_number_text::integer;
    exception when others then continue;
    end;
    v_canonical_key := to_char(v_session_date, 'YYYY-MM-DD') || ':' || v_session_number::text;
    if v_session_date = p_date and v_canonical_key = btrim(p_session_key) then
      return jsonb_build_object('valid', true, 'sessionDate', to_char(v_session_date, 'YYYY-MM-DD'), 'sessionKey', v_canonical_key, 'sessionLabel', v_session_number::text || '회차');
    end if;
  end loop;
  return jsonb_build_object('valid', false, 'sessionDate', null, 'sessionKey', null, 'sessionLabel', null);
end;
$$;

create or replace function dashboard_private.sync_registration_enrollment_lesson_session_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_mode text; v_session_id uuid;
begin
  select schedule_storage_mode into v_mode from public.classes where id = new.class_id;
  if v_mode <> 'normalized' then
    new.class_start_lesson_session_id := null;
    return new;
  end if;
  if new.class_start_date is null or nullif(btrim(new.class_start_session_key), '') is null then
    new.class_start_lesson_session_id := null;
    return new;
  end if;
  select id into v_session_id from public.class_lesson_sessions
  where class_id = new.class_id and session_date = new.class_start_date
    and session_key = new.class_start_session_key and schedule_state in ('active', 'makeup');
  if v_session_id is null then raise exception 'registration_class_session_invalid' using errcode = '23514'; end if;
  new.class_start_lesson_session_id := v_session_id;
  return new;
end;
$$;

drop trigger if exists ops_registration_enrollments_sync_lesson_session on public.ops_registration_enrollments;
create trigger ops_registration_enrollments_sync_lesson_session
before insert or update of class_id, class_start_date, class_start_session_key
on public.ops_registration_enrollments
for each row execute function dashboard_private.sync_registration_enrollment_lesson_session_v1();

alter function public.save_registration_enrollment_rows(uuid, jsonb, text)
  rename to save_registration_enrollment_rows_legacy_v1;

create or replace function public.save_registration_enrollment_rows(
  p_track_id uuid,
  p_rows jsonb,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_sanitized_rows jsonb; v_result jsonb; v_input jsonb; v_requested_id uuid; v_actual_id uuid; v_saved_id uuid;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    return public.save_registration_enrollment_rows_legacy_v1(p_track_id, p_rows, p_request_key);
  end if;
  select coalesce(jsonb_agg(value - 'classStartLessonSessionId'), '[]'::jsonb)
  into v_sanitized_rows from jsonb_array_elements(p_rows);
  v_result := public.save_registration_enrollment_rows_legacy_v1(p_track_id, v_sanitized_rows, p_request_key);

  for v_input in select value from jsonb_array_elements(p_rows) loop
    if nullif(btrim(coalesce(v_input ->> 'classStartLessonSessionId', '')), '') is null then continue; end if;
    begin v_requested_id := (v_input ->> 'classStartLessonSessionId')::uuid;
    exception when others then raise exception 'registration_enrollment_rows_invalid' using errcode = '22023'; end;
    select enrollment.id, enrollment.class_start_lesson_session_id into v_saved_id, v_actual_id
    from jsonb_array_elements(coalesce(v_result -> 'rows', '[]'::jsonb)) saved
    join public.ops_registration_enrollments enrollment on enrollment.id = (saved.value ->> 'id')::uuid
    where enrollment.class_id = (v_input ->> 'classId')::uuid
      and enrollment.class_start_date::text = v_input ->> 'classStartDate'
      and enrollment.class_start_session_key = v_input ->> 'classStartSessionKey'
    limit 1;
    if v_saved_id is null or v_actual_id is distinct from v_requested_id then
      raise exception 'registration_class_session_invalid' using errcode = '23514';
    end if;
  end loop;

  select v_result || jsonb_build_object('rows', coalesce(jsonb_agg(saved.value || jsonb_build_object('classStartLessonSessionId', enrollment.class_start_lesson_session_id)), '[]'::jsonb))
  into v_result
  from jsonb_array_elements(coalesce(v_result -> 'rows', '[]'::jsonb)) saved
  join public.ops_registration_enrollments enrollment on enrollment.id = (saved.value ->> 'id')::uuid;
  return v_result;
end;
$$;

create or replace function public.preview_registration_lesson_session_backfill_v1()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'exactMatchCount', count(*) filter (where matched.id is not null),
    'ambiguousOrUnmatchedCount', count(*) filter (where matched.id is null)
  )
  from public.ops_registration_enrollments enrollment
  join public.classes class on class.id = enrollment.class_id and class.schedule_storage_mode = 'normalized'
  left join public.class_lesson_sessions matched
    on matched.class_id = enrollment.class_id
    and matched.session_date = enrollment.class_start_date
    and matched.session_key = enrollment.class_start_session_key
    and matched.schedule_state in ('active', 'makeup')
  where enrollment.class_start_lesson_session_id is null;
$$;

revoke all on function dashboard_private.sync_registration_enrollment_lesson_session_v1() from public, anon, authenticated, service_role;
alter function public.save_registration_enrollment_rows(uuid, jsonb, text) owner to postgres;
revoke execute on function public.save_registration_enrollment_rows_legacy_v1(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.save_registration_enrollment_rows(uuid, jsonb, text) from public, anon;
grant execute on function public.save_registration_enrollment_rows(uuid, jsonb, text) to authenticated;
revoke all on function public.preview_registration_lesson_session_backfill_v1() from public, anon;
grant execute on function public.preview_registration_lesson_session_backfill_v1() to authenticated;

alter table public.makeup_requests
  add column original_lesson_session_id uuid references public.class_lesson_sessions(id) on delete set null,
  add column original_lesson_session_revision bigint,
  add column makeup_lesson_session_ids jsonb not null default '[]'::jsonb,
  add column makeup_effect_revision bigint;

create index makeup_requests_original_lesson_session_id_idx
  on public.makeup_requests(original_lesson_session_id)
  where original_lesson_session_id is not null;

create or replace function dashboard_private.apply_normalized_makeup_effect_v1(
  p_request_id uuid,
  p_class_id uuid,
  p_calendar_events jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.makeup_requests%rowtype;
  v_session public.class_lesson_sessions%rowtype;
  v_slot jsonb;
  v_new_ids jsonb := '[]'::jsonb;
  v_new_id uuid;
begin
  select * into v_request from public.makeup_requests where id = p_request_id for update;
  select * into v_session from public.class_lesson_sessions
    where id = v_request.original_lesson_session_id and class_id = p_class_id for update;
  if not found or v_session.schedule_state not in ('active', 'makeup') then
    raise exception 'makeup_lesson_session_stale' using errcode = '40001';
  end if;
  if v_request.original_lesson_session_revision is distinct from v_session.revision then
    raise exception 'makeup_lesson_session_stale' using errcode = '40001';
  end if;
  update public.class_lesson_sessions set schedule_state = 'exception', revision = revision + 1
    where id = v_session.id;
  for v_slot in select value from jsonb_array_elements(v_request.makeup_slots) loop
    insert into public.class_lesson_sessions(
      class_id, session_key, session_date, schedule_state, start_time, end_time,
      teacher_catalog_id, teacher_name_snapshot, classroom_name_snapshot, origin,
      memo, created_by, updated_by
    ) values (
      p_class_id, 'makeup:' || p_request_id::text || ':' || (jsonb_array_length(v_new_ids) + 1)::text,
      (v_slot ->> 'startAt')::timestamptz::date, 'makeup',
      (v_slot ->> 'startAt')::timestamptz::time, (v_slot ->> 'endAt')::timestamptz::time,
      v_session.teacher_catalog_id, v_session.teacher_name_snapshot, v_slot ->> 'classroom', 'manual',
      coalesce(v_request.reason, ''), (select auth.uid()), (select auth.uid())
    ) returning id into v_new_id;
    v_new_ids := v_new_ids || jsonb_build_array(v_new_id);
  end loop;
  update public.makeup_requests set makeup_lesson_session_ids = v_new_ids,
    makeup_effect_revision = v_session.revision + 1 where id = p_request_id;
end;
$$;

create or replace function dashboard_private.revert_normalized_makeup_effect_v1(
  p_request_id uuid,
  p_class_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.makeup_requests%rowtype; v_session public.class_lesson_sessions%rowtype;
begin
  select * into v_request from public.makeup_requests where id = p_request_id for update;
  select * into v_session from public.class_lesson_sessions
    where id = v_request.original_lesson_session_id and class_id = p_class_id for update;
  if not found or v_session.revision is distinct from v_request.makeup_effect_revision then
    raise exception 'makeup_lesson_session_stale' using errcode = '40001';
  end if;
  if exists (select 1 from jsonb_array_elements_text(v_request.makeup_lesson_session_ids) item
    join public.class_lesson_sessions session on session.id = item.value::uuid
    where session.revision <> 0) then raise exception 'makeup_lesson_session_stale' using errcode = '40001'; end if;
  update public.class_lesson_sessions set schedule_state = 'active', revision = revision + 1 where id = v_session.id;
  delete from public.class_lesson_sessions where id in (select value::uuid from jsonb_array_elements_text(v_request.makeup_lesson_session_ids));
end;
$$;

alter function dashboard_private.notification_apply_makeup_calendar_effects_v1(uuid, uuid, jsonb, jsonb, uuid, uuid, jsonb, jsonb)
  rename to notification_apply_makeup_calendar_effects_legacy_v1;
alter function dashboard_private.notification_revert_makeup_calendar_effects_v1(uuid, uuid, jsonb, jsonb, uuid, uuid, jsonb)
  rename to notification_revert_makeup_calendar_effects_legacy_v1;

create or replace function dashboard_private.notification_apply_makeup_calendar_effects_v1(
  p_request_id uuid, p_class_id uuid, p_schedule_plan_before jsonb, p_schedule_plan_after jsonb,
  p_cancel_academic_event_id uuid, p_makeup_academic_event_id uuid, p_makeup_academic_event_ids jsonb, p_calendar_events jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare v_mode text; v_event jsonb;
begin
  select schedule_storage_mode into v_mode from public.classes where id = p_class_id;
  if v_mode <> 'normalized' then
    perform dashboard_private.notification_apply_makeup_calendar_effects_legacy_v1(p_request_id, p_class_id, p_schedule_plan_before, p_schedule_plan_after, p_cancel_academic_event_id, p_makeup_academic_event_id, p_makeup_academic_event_ids, p_calendar_events);
    return;
  end if;
  if p_calendar_events is null or jsonb_typeof(p_calendar_events) <> 'array' then raise exception 'makeup_calendar_effects_invalid' using errcode = '22023'; end if;
  perform dashboard_private.apply_normalized_makeup_effect_v1(p_request_id, p_class_id, p_calendar_events);
  for v_event in select value from jsonb_array_elements(p_calendar_events) loop
    insert into public.academic_events(id, title, date, type, grade, note)
    values ((v_event ->> 'id')::uuid, v_event ->> 'title', (v_event ->> 'date')::date, v_event ->> 'type', v_event ->> 'grade', v_event ->> 'note')
    on conflict (id) do update set title = excluded.title, date = excluded.date, type = excluded.type, grade = excluded.grade, note = excluded.note
    where strpos(coalesce(public.academic_events.note, ''), p_request_id::text) > 0;
  end loop;
end;
$$;

create or replace function dashboard_private.notification_revert_makeup_calendar_effects_v1(
  p_request_id uuid, p_class_id uuid, p_schedule_plan_before jsonb, p_schedule_plan_after jsonb,
  p_cancel_academic_event_id uuid, p_makeup_academic_event_id uuid, p_makeup_academic_event_ids jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare v_mode text;
begin
  select schedule_storage_mode into v_mode from public.classes where id = p_class_id;
  if v_mode <> 'normalized' then
    perform dashboard_private.notification_revert_makeup_calendar_effects_legacy_v1(p_request_id, p_class_id, p_schedule_plan_before, p_schedule_plan_after, p_cancel_academic_event_id, p_makeup_academic_event_id, p_makeup_academic_event_ids);
    return;
  end if;
  perform dashboard_private.revert_normalized_makeup_effect_v1(p_request_id, p_class_id);
  delete from public.academic_events event where strpos(coalesce(event.note, ''), '[[TIPS_MAKEUP]]') > 0 and strpos(coalesce(event.note, ''), p_request_id::text) > 0;
end;
$$;

alter function dashboard_private.create_makeup_request_v2_unguarded(jsonb, uuid)
  rename to create_makeup_request_v2_legacy_v1;

create or replace function dashboard_private.create_makeup_request_v2_unguarded(p_input jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_input jsonb; v_result jsonb; v_request_id uuid; v_session_id uuid; v_mode text; v_cancel_date date;
begin
  v_session_id := nullif(p_input ->> 'original_lesson_session_id', '')::uuid;
  v_input := p_input - 'original_lesson_session_id';
  select schedule_storage_mode into v_mode from public.classes where id = (v_input ->> 'class_id')::uuid;
  v_cancel_date := nullif(v_input ->> 'cancel_date', '')::date;
  if v_mode = 'normalized' and v_cancel_date is not null and v_session_id is null then raise exception 'makeup_lesson_session_required' using errcode = '22023'; end if;
  if v_session_id is not null and not exists (select 1 from public.class_lesson_sessions where id = v_session_id and class_id = (v_input ->> 'class_id')::uuid and session_date = v_cancel_date and schedule_state in ('active', 'makeup')) then raise exception 'makeup_lesson_session_invalid' using errcode = '22023'; end if;
  v_result := dashboard_private.create_makeup_request_v2_legacy_v1(v_input, p_request_id);
  v_request_id := (v_result -> 'request' ->> 'id')::uuid;
  if v_session_id is not null then
    update public.makeup_requests request set original_lesson_session_id = v_session_id,
      original_lesson_session_revision = session.revision
    from public.class_lesson_sessions session where request.id = v_request_id and session.id = v_session_id;
  end if;
  return v_result;
end;
$$;

alter function dashboard_private.apply_normalized_makeup_effect_v1(uuid, uuid, jsonb) owner to postgres;
alter function dashboard_private.revert_normalized_makeup_effect_v1(uuid, uuid) owner to postgres;
alter function dashboard_private.notification_apply_makeup_calendar_effects_v1(uuid, uuid, jsonb, jsonb, uuid, uuid, jsonb, jsonb) owner to postgres;
alter function dashboard_private.notification_revert_makeup_calendar_effects_v1(uuid, uuid, jsonb, jsonb, uuid, uuid, jsonb) owner to postgres;
alter function dashboard_private.create_makeup_request_v2_unguarded(jsonb, uuid) owner to postgres;
revoke all on function dashboard_private.apply_normalized_makeup_effect_v1(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.revert_normalized_makeup_effect_v1(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_apply_makeup_calendar_effects_v1(uuid, uuid, jsonb, jsonb, uuid, uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_revert_makeup_calendar_effects_v1(uuid, uuid, jsonb, jsonb, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.create_makeup_request_v2_unguarded(jsonb, uuid) from public, anon, authenticated, service_role;
