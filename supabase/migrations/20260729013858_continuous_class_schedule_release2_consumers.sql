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
