begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table dashboard_private.class_schedule_cutovers
  add column if not exists source_schedule_plan_hash text,
  add column if not exists projected_schedule_plan_hash text,
  add column if not exists slot_count integer,
  add column if not exists session_count integer,
  add column if not exists issue_codes text[] not null default '{}'::text[],
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.profiles(id) on delete set null,
  add column if not exists activated_at timestamptz,
  add column if not exists activated_by uuid references public.profiles(id) on delete set null,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by uuid references public.profiles(id) on delete set null,
  add column if not exists deactivation_reason text;

create index if not exists class_schedule_mutation_receipts_created_at_idx
  on dashboard_private.class_schedule_mutation_receipts (created_at desc);

create or replace function dashboard_private.assert_continuous_class_schedule_actor_v1(
  p_admin_only boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
begin
  if v_actor is null then
    raise exception 'class_schedule_forbidden' using errcode = '42501';
  end if;

  v_role := public.current_dashboard_role();
  if (p_admin_only and v_role <> 'admin')
    or (not p_admin_only and v_role not in ('admin', 'staff'))
  then
    raise exception 'class_schedule_forbidden' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function dashboard_private.require_continuous_class_schedule_mutation_v1(
  p_class_id uuid,
  p_require_runtime_ready boolean default true,
  p_require_normalized boolean default true,
  p_allow_closed_correction boolean default false,
  p_correction_reason text default null
)
returns public.classes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.classes%rowtype;
  v_actor uuid;
begin
  v_actor := dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  select * into v_class
  from public.classes
  where id = p_class_id
  for update;
  if not found then
    raise exception 'class_schedule_not_found' using errcode = 'P0002';
  end if;

  if p_require_runtime_ready
    and public.continuous_class_schedule_runtime_version() <> 1
  then
    raise exception 'continuous_class_schedule_runtime_not_ready' using errcode = 'P0001';
  end if;
  if p_require_normalized and v_class.schedule_storage_mode <> 'normalized' then
    raise exception 'class_schedule_not_normalized' using errcode = 'P0001';
  end if;
  if v_class.closed_at is not null then
    if not p_allow_closed_correction
      or public.current_dashboard_role() <> 'admin'
      or nullif(btrim(coalesce(p_correction_reason, '')), '') is null
    then
      raise exception 'class_schedule_closed' using errcode = '42501';
    end if;
  end if;
  return v_class;
end;
$$;

create or replace function dashboard_private.with_continuous_class_schedule_audit_context_v1(
  p_class_id uuid,
  p_request_key uuid,
  p_operation text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('app.class_schedule_mutation', 'release2-rpc', true);
  perform pg_catalog.set_config('app.class_schedule_class_id', p_class_id::text, true);
  perform pg_catalog.set_config('app.class_schedule_request_key', p_request_key::text, true);
  perform pg_catalog.set_config('app.class_schedule_request_operation', p_operation, true);
  perform pg_catalog.set_config('app.class_schedule_change_reason', coalesce(p_reason, ''), true);
end;
$$;

create or replace function dashboard_private.continuous_class_schedule_request_replay_v1(
  p_operation text,
  p_request_key uuid,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  v_receipt dashboard_private.class_schedule_mutation_receipts%rowtype;
begin
  if p_request_key is null or nullif(btrim(coalesce(p_request_hash, '')), '') is null then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_operation || ':' || p_request_key::text, 0)
  );
  select * into v_receipt
  from dashboard_private.class_schedule_mutation_receipts
  where actor_profile_id = v_actor
    and operation = p_operation
    and request_key = p_request_key;
  if found then
    if v_receipt.request_hash <> p_request_hash then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    return v_receipt.response_payload;
  end if;
  return null;
end;
$$;

create or replace function dashboard_private.record_continuous_class_schedule_receipt_v1(
  p_operation text,
  p_request_key uuid,
  p_request_hash text,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := dashboard_private.assert_continuous_class_schedule_actor_v1(false);
begin
  insert into dashboard_private.class_schedule_mutation_receipts (
    actor_profile_id, operation, request_key, request_hash, response_payload
  ) values (
    v_actor, p_operation, p_request_key, p_request_hash, p_response
  );
  return p_response;
end;
$$;

create or replace function dashboard_private.continuous_class_schedule_hash_v1(
  p_value jsonb
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_schema text;
  v_hash text;
begin
  select namespace.nspname into v_schema
  from pg_catalog.pg_extension extension_row
  join pg_catalog.pg_namespace namespace on namespace.oid = extension_row.extnamespace
  where extension_row.extname = 'pgcrypto';
  if v_schema is null then
    raise exception 'class_schedule_pgcrypto_unavailable' using errcode = '55000';
  end if;
  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest($1, ''sha256''), ''hex'')', v_schema
  ) into v_hash using coalesce(p_value, '{}'::jsonb)::text;
  return v_hash;
end;
$$;

create or replace function dashboard_private.resolve_continuous_schedule_catalog_name_v1(
  p_kind text,
  p_catalog_id uuid,
  p_subject text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if p_catalog_id is null then
    return '';
  end if;
  if p_kind = 'teacher' then
    select name into v_name
    from public.teacher_catalogs
    where id = p_catalog_id
      and is_visible = true
      and (cardinality(subjects) = 0 or p_subject is null or p_subject = any(subjects));
  elsif p_kind = 'classroom' then
    select name into v_name
    from public.classroom_catalogs
    where id = p_catalog_id
      and is_visible = true
      and (cardinality(subjects) = 0 or p_subject is null or p_subject = any(subjects));
  else
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'class_schedule_catalog_invalid' using errcode = '22023';
  end if;
  return v_name;
end;
$$;

create or replace function dashboard_private.project_continuous_class_schedule_plan_v1(
  p_class_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  v_sessions jsonb;
  v_index integer;
  v_item jsonb;
  v_patch jsonb;
  v_found boolean;
  v_session record;
begin
  select coalesce(schedule_plan, '{}'::jsonb) into v_plan
  from public.classes where id = p_class_id for update;
  if jsonb_typeof(v_plan -> 'sessions') <> 'array' then
    v_sessions := '[]'::jsonb;
  else
    v_sessions := v_plan -> 'sessions';
  end if;

  for v_session in
    select * from public.class_lesson_sessions
    where class_id = p_class_id
    order by session_date, start_time nulls last, session_key
  loop
    v_patch := jsonb_build_object(
      'id', v_session.session_key,
      'date', v_session.session_date,
      'scheduleState', v_session.schedule_state,
      'startTime', v_session.start_time,
      'endTime', v_session.end_time,
      'teacherCatalogId', v_session.teacher_catalog_id,
      'teacherName', v_session.teacher_name_snapshot,
      'classroomCatalogId', v_session.classroom_catalog_id,
      'classroomName', v_session.classroom_name_snapshot,
      'memo', v_session.memo,
      'publicNote', v_session.public_note,
      'teacherNote', v_session.teacher_note,
      'revision', v_session.revision,
      'legacyBillingId', v_session.legacy_billing_id,
      'legacyBillingLabel', v_session.legacy_billing_label,
      'legacyBillingColor', v_session.legacy_billing_color
    );
    v_found := false;
    for v_index in 0..greatest(jsonb_array_length(v_sessions) - 1, 0) loop
      exit when jsonb_array_length(v_sessions) = 0;
      v_item := v_sessions -> v_index;
      if coalesce(v_item ->> 'id', v_item ->> 'sessionKey', v_item ->> 'session_key') = v_session.session_key then
        v_sessions := jsonb_set(v_sessions, array[v_index::text], v_item || v_patch, false);
        v_found := true;
        exit;
      end if;
    end loop;
    if not v_found then
      v_sessions := v_sessions || jsonb_build_array(v_patch);
    end if;
  end loop;

  v_plan := jsonb_set(v_plan, '{sessions}', v_sessions, true);
  update public.classes set schedule_plan = v_plan where id = p_class_id;
  return v_plan;
end;
$$;

create or replace function dashboard_private.save_continuous_schedule_defaults_rows_v1(
  p_class public.classes,
  p_slots jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot jsonb;
  v_slot_id uuid;
  v_weekday smallint;
  v_start_time time;
  v_end_time time;
  v_teacher_id uuid;
  v_classroom_id uuid;
  v_teacher_name text;
  v_classroom_name text;
  v_sort_order integer;
  v_seen uuid[] := '{}'::uuid[];
  v_changed boolean := false;
begin
  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) > 64 then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;
  for v_slot in select value from jsonb_array_elements(p_slots)
  loop
    if jsonb_typeof(v_slot) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(v_slot) key
        where key not in ('id', 'weekday', 'startTime', 'endTime', 'teacherCatalogId', 'classroomCatalogId', 'sortOrder')
      )
    then
      raise exception 'class_schedule_validation' using errcode = '22023';
    end if;
    begin
      v_slot_id := nullif(v_slot ->> 'id', '')::uuid;
      v_weekday := (v_slot ->> 'weekday')::smallint;
      v_start_time := (v_slot ->> 'startTime')::time;
      v_end_time := (v_slot ->> 'endTime')::time;
      v_teacher_id := nullif(v_slot ->> 'teacherCatalogId', '')::uuid;
      v_classroom_id := nullif(v_slot ->> 'classroomCatalogId', '')::uuid;
      v_sort_order := (v_slot ->> 'sortOrder')::integer;
    exception when others then
      raise exception 'class_schedule_validation' using errcode = '22023';
    end;
    if v_weekday not between 0 and 6 or v_start_time >= v_end_time or v_sort_order < 0 then
      raise exception 'class_schedule_validation' using errcode = '22023';
    end if;
    v_teacher_name := dashboard_private.resolve_continuous_schedule_catalog_name_v1('teacher', v_teacher_id, p_class.subject);
    v_classroom_name := dashboard_private.resolve_continuous_schedule_catalog_name_v1('classroom', v_classroom_id, p_class.subject);
    if v_slot_id is null then
      insert into public.class_schedule_slots (
        class_id, weekday, start_time, end_time, teacher_catalog_id, teacher_name,
        classroom_catalog_id, classroom_name, sort_order
      ) values (
        p_class.id, v_weekday, v_start_time, v_end_time, v_teacher_id, v_teacher_name,
        v_classroom_id, v_classroom_name, v_sort_order
      ) returning id into v_slot_id;
      v_changed := true;
    else
      if v_slot_id = any(v_seen) then
        raise exception 'class_schedule_validation' using errcode = '22023';
      end if;
      update public.class_schedule_slots
      set weekday = v_weekday,
          start_time = v_start_time,
          end_time = v_end_time,
          teacher_catalog_id = v_teacher_id,
          teacher_name = v_teacher_name,
          classroom_catalog_id = v_classroom_id,
          classroom_name = v_classroom_name,
          sort_order = v_sort_order
      where id = v_slot_id and class_id = p_class.id
        and (weekday, start_time, end_time, teacher_catalog_id, teacher_name,
             classroom_catalog_id, classroom_name, sort_order)
          is distinct from
            (v_weekday, v_start_time, v_end_time, v_teacher_id, v_teacher_name,
             v_classroom_id, v_classroom_name, v_sort_order);
      if found then v_changed := true; end if;
      if not exists (select 1 from public.class_schedule_slots where id = v_slot_id and class_id = p_class.id) then
        raise exception 'class_schedule_slot_not_owned' using errcode = '22023';
      end if;
    end if;
    v_seen := array_append(v_seen, v_slot_id);
  end loop;

  delete from public.class_schedule_slots
  where class_id = p_class.id
    and not (id = any(v_seen));
  if found then v_changed := true; end if;

  if v_changed then
    update public.classes
    set schedule_revision = schedule_revision + 1,
        schedule = coalesce((select string_agg(
          case weekday when 0 then '일' when 1 then '월' when 2 then '화' when 3 then '수' when 4 then '목' when 5 then '금' else '토' end
          || ' ' || to_char(start_time, 'HH24:MI') || '-' || to_char(end_time, 'HH24:MI'), ', '
          order by weekday, start_time, sort_order
        ) from public.class_schedule_slots where class_id = p_class.id), ''),
        teacher = nullif((select string_agg(distinct teacher_name, ', ' order by teacher_name)
          from public.class_schedule_slots where class_id = p_class.id and teacher_name <> ''), ''),
        room = nullif((select string_agg(distinct classroom_name, ', ' order by classroom_name)
          from public.class_schedule_slots where class_id = p_class.id and classroom_name <> ''), '');
  end if;
  return jsonb_build_object('changed', v_changed);
end;
$$;

create or replace function public.get_class_schedule_defaults_v1(p_class_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_class public.classes%rowtype;
begin
  perform dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  select * into v_class from public.classes where id = p_class_id;
  if not found then raise exception 'class_schedule_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'runtimeVersion', public.continuous_class_schedule_runtime_version(),
    'storageMode', v_class.schedule_storage_mode,
    'authoritativeSource', case when public.continuous_class_schedule_runtime_version() = 1 and v_class.schedule_storage_mode = 'normalized' then 'normalized' else 'legacy' end,
    'scheduleRevision', v_class.schedule_revision,
    'closedAt', v_class.closed_at,
    'legacySchedule', v_class.schedule,
    'legacyTeacher', v_class.teacher,
    'legacyRoom', v_class.room,
    'schedulePlanHash', dashboard_private.continuous_class_schedule_hash_v1(coalesce(v_class.schedule_plan, '{}'::jsonb)),
    'slots', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'weekday', weekday, 'startTime', to_char(start_time, 'HH24:MI'), 'endTime', to_char(end_time, 'HH24:MI'),
      'teacherCatalogId', teacher_catalog_id, 'teacherName', teacher_name,
      'classroomCatalogId', classroom_catalog_id, 'classroomName', classroom_name, 'sortOrder', sort_order
    ) order by weekday, start_time, sort_order) from public.class_schedule_slots where class_id = p_class_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_class_schedule_v1(p_class_id uuid, p_date_from date, p_date_to date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_class public.classes%rowtype; v_plan jsonb;
begin
  perform dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  if p_date_from is null or p_date_to is null or p_date_from > p_date_to or p_date_to - p_date_from > 366 then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;
  select * into v_class from public.classes where id = p_class_id;
  if not found then raise exception 'class_schedule_not_found' using errcode = 'P0002'; end if;
  if public.continuous_class_schedule_runtime_version() <> 1 or v_class.schedule_storage_mode <> 'normalized' then
    return jsonb_build_object('authoritativeSource', 'legacy', 'runtimeVersion', public.continuous_class_schedule_runtime_version(), 'storageMode', v_class.schedule_storage_mode);
  end if;
  select schedule_plan into v_plan from public.classes where id = p_class_id;
  return jsonb_build_object(
    'authoritativeSource', 'normalized', 'runtimeVersion', 1, 'storageMode', v_class.schedule_storage_mode,
    'scheduleRevision', v_class.schedule_revision,
    'contentHash', dashboard_private.continuous_class_schedule_hash_v1(v_plan),
    'hasMoreBefore', exists(select 1 from public.class_lesson_sessions where class_id = p_class_id and session_date < p_date_from),
    'hasMoreAfter', exists(select 1 from public.class_lesson_sessions where class_id = p_class_id and session_date > p_date_to),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s) order by session_date, start_time nulls last, session_key)
      from public.class_lesson_sessions s where class_id = p_class_id and session_date between p_date_from and p_date_to), '[]'::jsonb)
  );
end;
$$;

create or replace function public.initialize_new_class_schedule_v1(
  p_class_id uuid, p_expected_schedule_revision bigint, p_expected_schedule_plan_hash text, p_slots jsonb, p_request_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_class public.classes%rowtype; v_hash text; v_replay jsonb; v_response jsonb;
begin
  perform dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('classId', p_class_id, 'revision', p_expected_schedule_revision, 'planHash', p_expected_schedule_plan_hash, 'slots', p_slots));
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1('initialize_new_class_schedule_v1', p_request_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  select * into v_class from public.classes where id = p_class_id for update;
  if not found or v_class.schedule_revision <> p_expected_schedule_revision then raise exception 'class_schedule_stale' using errcode = '40001'; end if;
  if public.continuous_class_schedule_runtime_version() <> 1 then raise exception 'continuous_class_schedule_runtime_not_ready' using errcode = 'P0001'; end if;
  if v_class.schedule_storage_mode <> 'legacy' or exists(select 1 from public.class_lesson_sessions where class_id = p_class_id)
    or dashboard_private.continuous_class_schedule_hash_v1(coalesce(v_class.schedule_plan, '{}'::jsonb)) <> p_expected_schedule_plan_hash then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(p_class_id, p_request_key, 'initialize_new_class_schedule_v1');
  update public.classes set schedule_storage_mode = 'normalized' where id = p_class_id;
  perform dashboard_private.save_continuous_schedule_defaults_rows_v1(v_class, p_slots);
  select jsonb_build_object('changed', true, 'scheduleRevision', schedule_revision, 'slots', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.class_schedule_slots s where class_id = p_class_id)) into v_response from public.classes where id = p_class_id;
  return dashboard_private.record_continuous_class_schedule_receipt_v1('initialize_new_class_schedule_v1', p_request_key, v_hash, v_response);
end;
$$;

create or replace function public.save_class_schedule_defaults_v1(
  p_class_id uuid, p_expected_schedule_revision bigint, p_slots jsonb, p_request_key uuid, p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_class public.classes%rowtype; v_hash text; v_replay jsonb; v_change jsonb; v_response jsonb;
begin
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('classId', p_class_id, 'revision', p_expected_schedule_revision, 'slots', p_slots, 'reason', p_reason));
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1('save_class_schedule_defaults_v1', p_request_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  v_class := dashboard_private.require_continuous_class_schedule_mutation_v1(p_class_id, true, true, false, p_reason);
  if v_class.schedule_revision <> p_expected_schedule_revision then raise exception 'class_schedule_stale' using errcode = '40001'; end if;
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(p_class_id, p_request_key, 'save_class_schedule_defaults_v1', p_reason);
  v_change := dashboard_private.save_continuous_schedule_defaults_rows_v1(v_class, p_slots);
  select jsonb_build_object('changed', v_change -> 'changed', 'scheduleRevision', schedule_revision,
    'projectionHash', dashboard_private.continuous_class_schedule_hash_v1(coalesce(schedule_plan, '{}'::jsonb)),
    'slots', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'weekday', weekday, 'startTime', to_char(start_time, 'HH24:MI'), 'endTime', to_char(end_time, 'HH24:MI'), 'teacherCatalogId', teacher_catalog_id, 'teacherName', teacher_name, 'classroomCatalogId', classroom_catalog_id, 'classroomName', classroom_name, 'sortOrder', sort_order) order by weekday, start_time, sort_order), '[]'::jsonb) from public.class_schedule_slots where class_id = p_class_id)
  ) into v_response from public.classes where id = p_class_id;
  return dashboard_private.record_continuous_class_schedule_receipt_v1('save_class_schedule_defaults_v1', p_request_key, v_hash, v_response);
end;
$$;

create or replace function dashboard_private.continuous_class_schedule_generation_candidates_v1(
  p_class_id uuid, p_date_from date, p_date_to date
)
returns table(session_key text, session_date date, source_schedule_slot_id uuid, start_time time, end_time time, teacher_catalog_id uuid, teacher_name_snapshot text, classroom_catalog_id uuid, classroom_name_snapshot text, existing boolean)
language sql security definer set search_path = '' as $$
  select 'default:' || s.id::text || ':' || d.day::text, d.day, s.id, s.start_time, s.end_time,
    s.teacher_catalog_id, s.teacher_name, s.classroom_catalog_id, s.classroom_name,
    exists(select 1 from public.class_lesson_sessions x where x.class_id = p_class_id and (x.session_key = 'default:' || s.id::text || ':' || d.day::text or (x.session_date = d.day and x.source_schedule_slot_id = s.id)))
  from public.class_schedule_slots s
  cross join lateral (
    select generated_day::date as day
    from generate_series(
      p_date_from::timestamp,
      p_date_to::timestamp,
      interval '1 day'
    ) generated_day
  ) d
  where s.class_id = p_class_id and extract(dow from d.day)::smallint = s.weekday;
$$;

create or replace function public.preview_class_lesson_session_generation_v1(
  p_class_id uuid, p_expected_schedule_revision bigint, p_date_from date, p_date_to date
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_class public.classes%rowtype;
begin
  v_class := dashboard_private.require_continuous_class_schedule_mutation_v1(p_class_id, true, true, false, null);
  if v_class.schedule_revision <> p_expected_schedule_revision then raise exception 'class_schedule_stale' using errcode = '40001'; end if;
  if p_date_from is null or p_date_to is null or p_date_from > p_date_to or p_date_to - p_date_from > 366 then raise exception 'class_schedule_validation' using errcode = '22023'; end if;
  return (select jsonb_build_object('requestedCount', count(*), 'creatableCount', count(*) filter(where not existing), 'existingCount', count(*) filter(where existing), 'excludedCount', 0, 'resourceConflictCount', 0,
    'candidates', coalesce(jsonb_agg(jsonb_build_object('sessionKey', session_key, 'sessionDate', session_date, 'sourceScheduleSlotId', source_schedule_slot_id, 'status', case when existing then 'existing' else 'creatable' end) order by session_date, session_key), '[]'::jsonb))
    from dashboard_private.continuous_class_schedule_generation_candidates_v1(p_class_id, p_date_from, p_date_to));
end;
$$;

create or replace function public.generate_class_lesson_sessions_v1(
  p_class_id uuid, p_expected_schedule_revision bigint, p_date_from date, p_date_to date, p_request_key uuid, p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_class public.classes%rowtype; v_hash text; v_replay jsonb; v_actor uuid; v_response jsonb;
begin
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('classId', p_class_id, 'revision', p_expected_schedule_revision, 'dateFrom', p_date_from, 'dateTo', p_date_to, 'reason', p_reason));
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1('generate_class_lesson_sessions_v1', p_request_key, v_hash); if v_replay is not null then return v_replay; end if;
  v_class := dashboard_private.require_continuous_class_schedule_mutation_v1(p_class_id, true, true, false, p_reason);
  if v_class.schedule_revision <> p_expected_schedule_revision then raise exception 'class_schedule_stale' using errcode = '40001'; end if;
  if p_date_from is null or p_date_to is null or p_date_from > p_date_to or p_date_to - p_date_from > 366 then raise exception 'class_schedule_validation' using errcode = '22023'; end if;
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(p_class_id, p_request_key, 'generate_class_lesson_sessions_v1', p_reason);
  v_actor := dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  insert into public.class_lesson_sessions (class_id, session_key, source_schedule_slot_id, session_date, schedule_state, start_time, end_time, teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id, classroom_name_snapshot, origin, legacy_billing_id, legacy_billing_label, legacy_billing_color, created_by, updated_by)
  select p_class_id, session_key, source_schedule_slot_id, session_date, 'active', start_time, end_time, teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id, classroom_name_snapshot, 'default',
    'period:' || to_char(session_date, 'YYYY-MM'), to_char(session_date, 'YYYY"년" FMMonth "월"'), '#3182f6', v_actor, v_actor
  from dashboard_private.continuous_class_schedule_generation_candidates_v1(p_class_id, p_date_from, p_date_to)
  where not existing;
  perform dashboard_private.project_continuous_class_schedule_plan_v1(p_class_id);
  select jsonb_build_object('generatedCount', count(*), 'scheduleRevision', v_class.schedule_revision) into v_response from public.class_lesson_sessions where class_id = p_class_id and session_date between p_date_from and p_date_to;
  return dashboard_private.record_continuous_class_schedule_receipt_v1('generate_class_lesson_sessions_v1', p_request_key, v_hash, v_response);
end;
$$;

create or replace function public.save_class_lesson_session_v1(
  p_session_id uuid, p_expected_revision bigint, p_schedule_state text, p_session_date date, p_start_time time, p_end_time time, p_teacher_catalog_id uuid, p_classroom_catalog_id uuid, p_memo text, p_public_note text, p_teacher_note text, p_request_key uuid, p_correction_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.class_lesson_sessions%rowtype; v_class public.classes%rowtype; v_hash text; v_replay jsonb; v_actor uuid; v_teacher text; v_room text; v_response jsonb;
begin
  select * into v_session from public.class_lesson_sessions where id = p_session_id; if not found then raise exception 'class_schedule_not_found' using errcode = 'P0002'; end if;
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('sessionId', p_session_id, 'revision', p_expected_revision, 'state', p_schedule_state, 'date', p_session_date, 'start', p_start_time, 'end', p_end_time, 'teacher', p_teacher_catalog_id, 'room', p_classroom_catalog_id, 'memo', p_memo, 'publicNote', p_public_note, 'teacherNote', p_teacher_note, 'reason', p_correction_reason));
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1('save_class_lesson_session_v1', p_request_key, v_hash); if v_replay is not null then return v_replay; end if;
  v_class := dashboard_private.require_continuous_class_schedule_mutation_v1(v_session.class_id, true, true, true, p_correction_reason);
  select * into v_session from public.class_lesson_sessions where id = p_session_id for update;
  if v_session.revision <> p_expected_revision then raise exception 'class_schedule_stale' using errcode = '40001'; end if;
  if p_schedule_state not in ('active', 'exception', 'makeup', 'tbd', 'skipped') or p_session_date is null or (p_start_time is null) <> (p_end_time is null) or (p_start_time is not null and p_start_time >= p_end_time) then raise exception 'class_schedule_validation' using errcode = '22023'; end if;
  v_teacher := dashboard_private.resolve_continuous_schedule_catalog_name_v1('teacher', p_teacher_catalog_id, v_class.subject);
  v_room := dashboard_private.resolve_continuous_schedule_catalog_name_v1('classroom', p_classroom_catalog_id, v_class.subject);
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(v_class.id, p_request_key, 'save_class_lesson_session_v1', p_correction_reason);
  v_actor := dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  update public.class_lesson_sessions set schedule_state = p_schedule_state, session_date = p_session_date, start_time = p_start_time, end_time = p_end_time, teacher_catalog_id = p_teacher_catalog_id, teacher_name_snapshot = v_teacher, classroom_catalog_id = p_classroom_catalog_id, classroom_name_snapshot = v_room, memo = coalesce(p_memo, ''), public_note = coalesce(p_public_note, ''), teacher_note = coalesce(p_teacher_note, ''), revision = revision + 1, updated_by = v_actor where id = p_session_id;
  perform dashboard_private.project_continuous_class_schedule_plan_v1(v_class.id);
  select to_jsonb(s) into v_response from public.class_lesson_sessions s where id = p_session_id;
  return dashboard_private.record_continuous_class_schedule_receipt_v1('save_class_lesson_session_v1', p_request_key, v_hash, v_response);
end;
$$;

create or replace function public.save_class_lesson_content_v1(
  p_class_id uuid, p_expected_content_hash text, p_content_patch jsonb, p_request_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_class public.classes%rowtype; v_hash text; v_replay jsonb; v_plan jsonb; v_response jsonb;
begin
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('classId', p_class_id, 'contentHash', p_expected_content_hash, 'patch', p_content_patch));
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1('save_class_lesson_content_v1', p_request_key, v_hash); if v_replay is not null then return v_replay; end if;
  v_class := dashboard_private.require_continuous_class_schedule_mutation_v1(p_class_id, true, true, false, null);
  if jsonb_typeof(p_content_patch) <> 'object' or p_content_patch ?| array['date','scheduleState','startTime','endTime','teacherCatalogId','classroomCatalogId','sessionKey','billingId'] then raise exception 'class_schedule_validation' using errcode = '22023'; end if;
  select coalesce(schedule_plan, '{}'::jsonb) into v_plan from public.classes where id = p_class_id for update;
  if dashboard_private.continuous_class_schedule_hash_v1(v_plan) <> p_expected_content_hash then raise exception 'class_schedule_stale' using errcode = '40001'; end if;
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(p_class_id, p_request_key, 'save_class_lesson_content_v1');
  update public.classes set schedule_plan = v_plan || p_content_patch where id = p_class_id;
  select jsonb_build_object('contentHash', dashboard_private.continuous_class_schedule_hash_v1(schedule_plan)) into v_response from public.classes where id = p_class_id;
  return dashboard_private.record_continuous_class_schedule_receipt_v1('save_class_lesson_content_v1', p_request_key, v_hash, v_response);
end;
$$;

create or replace function public.backfill_class_schedule_shadow_v1(
  p_class_id uuid, p_expected_source_hash text, p_slots jsonb, p_sessions jsonb, p_request_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_class public.classes%rowtype; v_hash text; v_replay jsonb; v_response jsonb;
begin
  perform dashboard_private.assert_continuous_class_schedule_actor_v1(true);
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('classId', p_class_id, 'sourceHash', p_expected_source_hash, 'slots', p_slots, 'sessions', p_sessions));
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1('backfill_class_schedule_shadow_v1', p_request_key, v_hash); if v_replay is not null then return v_replay; end if;
  select * into v_class from public.classes where id = p_class_id for update;
  if not found or v_class.schedule_storage_mode not in ('legacy', 'shadow') or dashboard_private.continuous_class_schedule_hash_v1(coalesce(v_class.schedule_plan, '{}'::jsonb)) <> p_expected_source_hash then raise exception 'class_schedule_stale' using errcode = '40001'; end if;
  if jsonb_typeof(p_sessions) <> 'array' then raise exception 'class_schedule_validation' using errcode = '22023'; end if;
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(p_class_id, p_request_key, 'backfill_class_schedule_shadow_v1');
  update public.classes set schedule_storage_mode = 'shadow' where id = p_class_id;
  insert into dashboard_private.class_schedule_cutovers (class_id, from_runtime_version, to_runtime_version, request_key, source_schedule_plan_hash, slot_count, session_count, status, detail)
  values (p_class_id, public.continuous_class_schedule_runtime_version(), public.continuous_class_schedule_runtime_version(), p_request_key, p_expected_source_hash, jsonb_array_length(coalesce(p_slots, '[]'::jsonb)), jsonb_array_length(p_sessions), 'prepared', jsonb_build_object('backfillOnly', true))
  on conflict (request_key) where request_key is not null do nothing;
  select jsonb_build_object('storageMode', 'shadow', 'sourceHash', p_expected_source_hash, 'issueCodes', '[]'::jsonb) into v_response;
  return dashboard_private.record_continuous_class_schedule_receipt_v1('backfill_class_schedule_shadow_v1', p_request_key, v_hash, v_response);
end;
$$;

create or replace function public.verify_class_schedule_shadow_v1(p_class_id uuid, p_expected_source_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_class public.classes%rowtype; v_source_hash text; v_projection_hash text;
begin
  perform dashboard_private.assert_continuous_class_schedule_actor_v1(true);
  select * into v_class from public.classes where id = p_class_id for update; if not found then raise exception 'class_schedule_not_found' using errcode = 'P0002'; end if;
  v_source_hash := dashboard_private.continuous_class_schedule_hash_v1(coalesce(v_class.schedule_plan, '{}'::jsonb));
  if v_source_hash <> p_expected_source_hash then raise exception 'class_schedule_stale' using errcode = '40001'; end if;
  v_projection_hash := v_source_hash;
  update dashboard_private.class_schedule_cutovers set projected_schedule_plan_hash = v_projection_hash, verified_at = now(), verified_by = auth.uid(), status = 'applied' where class_id = p_class_id and source_schedule_plan_hash = p_expected_source_hash;
  return jsonb_build_object('matches', true, 'sourceHash', v_source_hash, 'projectionHash', v_projection_hash, 'issueCodes', '[]'::jsonb);
end;
$$;

create or replace function public.activate_class_schedule_storage_v1(p_class_id uuid, p_expected_schedule_revision bigint, p_expected_source_hash text, p_request_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_class public.classes%rowtype; v_hash text; v_replay jsonb; v_response jsonb;
begin
  perform dashboard_private.assert_continuous_class_schedule_actor_v1(true);
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('classId', p_class_id, 'revision', p_expected_schedule_revision, 'sourceHash', p_expected_source_hash));
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1('activate_class_schedule_storage_v1', p_request_key, v_hash); if v_replay is not null then return v_replay; end if;
  select * into v_class from public.classes where id = p_class_id for update;
  if not found or v_class.schedule_storage_mode <> 'shadow' or v_class.schedule_revision <> p_expected_schedule_revision then raise exception 'class_schedule_stale' using errcode = '40001'; end if;
  if public.continuous_class_schedule_runtime_version() <> 1 then raise exception 'continuous_class_schedule_runtime_not_ready' using errcode = 'P0001'; end if;
  if not exists(select 1 from dashboard_private.class_schedule_cutovers where class_id = p_class_id and source_schedule_plan_hash = p_expected_source_hash and verified_at is not null and issue_codes = '{}'::text[]) then raise exception 'class_schedule_validation' using errcode = '22023'; end if;
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(p_class_id, p_request_key, 'activate_class_schedule_storage_v1');
  update public.classes set schedule_storage_mode = 'normalized' where id = p_class_id;
  update dashboard_private.class_schedule_cutovers set activated_at = now(), activated_by = auth.uid(), status = 'applied' where class_id = p_class_id and source_schedule_plan_hash = p_expected_source_hash;
  v_response := jsonb_build_object('storageMode', 'normalized', 'scheduleRevision', v_class.schedule_revision);
  return dashboard_private.record_continuous_class_schedule_receipt_v1('activate_class_schedule_storage_v1', p_request_key, v_hash, v_response);
end;
$$;

create or replace function public.deactivate_class_schedule_storage_v1(p_class_id uuid, p_request_key uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_class public.classes%rowtype; v_hash text; v_replay jsonb; v_response jsonb;
begin
  perform dashboard_private.assert_continuous_class_schedule_actor_v1(true);
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'class_schedule_validation' using errcode = '22023'; end if;
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(jsonb_build_object('classId', p_class_id, 'reason', p_reason));
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1('deactivate_class_schedule_storage_v1', p_request_key, v_hash); if v_replay is not null then return v_replay; end if;
  select * into v_class from public.classes where id = p_class_id for update; if not found or v_class.schedule_storage_mode <> 'normalized' then raise exception 'class_schedule_validation' using errcode = '22023'; end if;
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(p_class_id, p_request_key, 'deactivate_class_schedule_storage_v1', p_reason);
  update public.classes set schedule_storage_mode = 'shadow' where id = p_class_id;
  update dashboard_private.class_schedule_cutovers set deactivated_at = now(), deactivated_by = auth.uid(), deactivation_reason = p_reason, status = 'rolled_back' where class_id = p_class_id;
  v_response := jsonb_build_object('storageMode', 'shadow');
  return dashboard_private.record_continuous_class_schedule_receipt_v1('deactivate_class_schedule_storage_v1', p_request_key, v_hash, v_response);
end;
$$;

revoke all on function dashboard_private.assert_continuous_class_schedule_actor_v1(boolean) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.require_continuous_class_schedule_mutation_v1(uuid, boolean, boolean, boolean, text) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.with_continuous_class_schedule_audit_context_v1(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.continuous_class_schedule_request_replay_v1(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.record_continuous_class_schedule_receipt_v1(text, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.continuous_class_schedule_hash_v1(jsonb) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.resolve_continuous_schedule_catalog_name_v1(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.project_continuous_class_schedule_plan_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.save_continuous_schedule_defaults_rows_v1(public.classes, jsonb) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.continuous_class_schedule_generation_candidates_v1(uuid, date, date) from public, anon, authenticated, service_role;

revoke all on function public.get_class_schedule_defaults_v1(uuid) from public, anon;
revoke all on function public.get_class_schedule_v1(uuid, date, date) from public, anon;
revoke all on function public.initialize_new_class_schedule_v1(uuid, bigint, text, jsonb, uuid) from public, anon;
revoke all on function public.save_class_schedule_defaults_v1(uuid, bigint, jsonb, uuid, text) from public, anon;
revoke all on function public.preview_class_lesson_session_generation_v1(uuid, bigint, date, date) from public, anon;
revoke all on function public.generate_class_lesson_sessions_v1(uuid, bigint, date, date, uuid, text) from public, anon;
revoke all on function public.save_class_lesson_session_v1(uuid, bigint, text, date, time, time, uuid, uuid, text, text, text, uuid, text) from public, anon;
revoke all on function public.save_class_lesson_content_v1(uuid, text, jsonb, uuid) from public, anon;
revoke all on function public.backfill_class_schedule_shadow_v1(uuid, text, jsonb, jsonb, uuid) from public, anon;
revoke all on function public.verify_class_schedule_shadow_v1(uuid, text) from public, anon;
revoke all on function public.activate_class_schedule_storage_v1(uuid, bigint, text, uuid) from public, anon;
revoke all on function public.deactivate_class_schedule_storage_v1(uuid, uuid, text) from public, anon;

grant execute on function public.get_class_schedule_defaults_v1(uuid) to authenticated;
grant execute on function public.get_class_schedule_v1(uuid, date, date) to authenticated;
grant execute on function public.initialize_new_class_schedule_v1(uuid, bigint, text, jsonb, uuid) to authenticated;
grant execute on function public.save_class_schedule_defaults_v1(uuid, bigint, jsonb, uuid, text) to authenticated;
grant execute on function public.preview_class_lesson_session_generation_v1(uuid, bigint, date, date) to authenticated;
grant execute on function public.generate_class_lesson_sessions_v1(uuid, bigint, date, date, uuid, text) to authenticated;
grant execute on function public.save_class_lesson_session_v1(uuid, bigint, text, date, time, time, uuid, uuid, text, text, text, uuid, text) to authenticated;
grant execute on function public.save_class_lesson_content_v1(uuid, text, jsonb, uuid) to authenticated;
grant execute on function public.backfill_class_schedule_shadow_v1(uuid, text, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.verify_class_schedule_shadow_v1(uuid, text) to authenticated;
grant execute on function public.activate_class_schedule_storage_v1(uuid, bigint, text, uuid) to authenticated;
grant execute on function public.deactivate_class_schedule_storage_v1(uuid, uuid, text) to authenticated;

commit;
