begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- The shadow backfill used a time-tuple ON CONFLICT arbiter. It cannot use a
-- deferrable UNIQUE constraint, so preserve its tuple reconciliation explicitly.
create or replace function dashboard_private.reconcile_continuous_schedule_shadow_slots_v1(
  p_class_id uuid, p_slots jsonb
)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  update public.class_schedule_slots existing
  set teacher_catalog_id = null,
      teacher_name = expected.slot ->> 'teacherName',
      classroom_catalog_id = null,
      classroom_name = expected.slot ->> 'classroomName',
      sort_order = (expected.slot ->> 'sortOrder')::integer
  from jsonb_array_elements(p_slots) as expected(slot)
  where existing.class_id = p_class_id
    and (existing.weekday, existing.start_time, existing.end_time)
      = ((expected.slot ->> 'weekday')::smallint,
         (expected.slot ->> 'startTime')::time,
         (expected.slot ->> 'endTime')::time)
    and (existing.teacher_catalog_id, existing.teacher_name,
         existing.classroom_catalog_id, existing.classroom_name, existing.sort_order)
      is distinct from
        (null::uuid, expected.slot ->> 'teacherName', null::uuid,
         expected.slot ->> 'classroomName', (expected.slot ->> 'sortOrder')::integer);

  insert into public.class_schedule_slots (
    class_id, weekday, start_time, end_time, teacher_catalog_id, teacher_name,
    classroom_catalog_id, classroom_name, sort_order
  )
  select p_class_id, (expected.slot ->> 'weekday')::smallint,
    (expected.slot ->> 'startTime')::time, (expected.slot ->> 'endTime')::time,
    null, expected.slot ->> 'teacherName', null,
    expected.slot ->> 'classroomName', (expected.slot ->> 'sortOrder')::integer
  from jsonb_array_elements(p_slots) as expected(slot)
  where not exists (
    select 1 from public.class_schedule_slots existing
    where existing.class_id = p_class_id
      and (existing.weekday, existing.start_time, existing.end_time)
        = ((expected.slot ->> 'weekday')::smallint,
           (expected.slot ->> 'startTime')::time,
           (expected.slot ->> 'endTime')::time)
  );

  delete from public.class_schedule_slots existing
  where existing.class_id = p_class_id
    and not exists (
      select 1 from jsonb_array_elements(p_slots) as expected(slot)
      where (existing.weekday, existing.start_time, existing.end_time)
        = ((expected.slot ->> 'weekday')::smallint,
           (expected.slot ->> 'startTime')::time,
           (expected.slot ->> 'endTime')::time)
    );
end;
$function$;
revoke all on function dashboard_private.reconcile_continuous_schedule_shadow_slots_v1(uuid,jsonb)
  from public, anon, authenticated, service_role;

do $patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.backfill_class_schedule_shadow_v1(uuid,text,jsonb,jsonb,uuid)'::regprocedure);
  v_old text := $old$  insert into public.class_schedule_slots as existing (
    class_id,
    weekday,
    start_time,
    end_time,
    teacher_catalog_id,
    teacher_name,
    classroom_catalog_id,
    classroom_name,
    sort_order
  )
  select
    p_class_id,
    (slot ->> 'weekday')::smallint,
    (slot ->> 'startTime')::time,
    (slot ->> 'endTime')::time,
    null,
    slot ->> 'teacherName',
    null,
    slot ->> 'classroomName',
    (slot ->> 'sortOrder')::integer
  from jsonb_array_elements(v_slots) slot
  on conflict (class_id, weekday, start_time, end_time) do update
  set teacher_catalog_id = null,
      teacher_name = excluded.teacher_name,
      classroom_catalog_id = null,
      classroom_name = excluded.classroom_name,
      sort_order = excluded.sort_order
  where existing.teacher_catalog_id is not null
    or existing.teacher_name is distinct from excluded.teacher_name
    or existing.classroom_catalog_id is not null
    or existing.classroom_name is distinct from excluded.classroom_name
    or existing.sort_order is distinct from excluded.sort_order;

  delete from public.class_schedule_slots slot
  where slot.class_id = p_class_id
    and not exists (
      select 1
      from jsonb_array_elements(v_slots) expected
      where (expected ->> 'weekday')::smallint = slot.weekday
        and (expected ->> 'startTime')::time = slot.start_time
        and (expected ->> 'endTime')::time = slot.end_time
    );

$old$;
  v_new text := $new$  perform dashboard_private.reconcile_continuous_schedule_shadow_slots_v1(p_class_id, v_slots);

$new$;
begin
  if pg_catalog.strpos(v_definition, v_old) = 0 then
    raise exception 'class_schedule_backfill_definition_drift' using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end;
$patch$;

-- Defer uniqueness only while a defaults save updates existing slot IDs.
-- The helper restores immediate checking before returning.
alter table public.class_schedule_slots
  drop constraint class_schedule_slots_class_time_key;
alter table public.class_schedule_slots
  add constraint class_schedule_slots_class_time_key
  unique (class_id, weekday, start_time, end_time)
  deferrable initially immediate;

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
  v_seen_keys text[] := '{}'::text[];
  v_slot_key text;
  v_varied_resources boolean;
  v_projected_schedule text;
  v_projected_teacher text;
  v_projected_room text;
  v_updated integer;
  v_changed boolean := false;
begin
  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) > 64 then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;
  set constraints public.class_schedule_slots_class_time_key deferred;
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
    if v_weekday is null or v_weekday not between 0 and 6
      or v_start_time is null or v_end_time is null or v_start_time >= v_end_time
      or v_sort_order is null or v_sort_order < 0 then
      raise exception 'class_schedule_validation' using errcode = '22023';
    end if;
    v_slot_key := v_weekday::text || ':' || to_char(v_start_time, 'HH24:MI:SS')
      || ':' || to_char(v_end_time, 'HH24:MI:SS');
    if v_slot_key = any(v_seen_keys) then
      raise exception 'class_schedule_validation' using errcode = '22023';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_slot_key);
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

  -- Validate the final set and restore the normal immediate constraint mode.
  set constraints public.class_schedule_slots_class_time_key immediate;

  if v_changed then
    select count(distinct nullif(teacher_name, '')) > 1
        or count(distinct nullif(classroom_name, '')) > 1
    into v_varied_resources
    from public.class_schedule_slots where class_id = p_class.id;

    select coalesce(string_agg(
      (case weekday when 0 then '일' when 1 then '월' when 2 then '화'
        when 3 then '수' when 4 then '목' when 5 then '금' else '토' end)
      || ' ' || to_char(start_time, 'HH24:MI') || '-' || to_char(end_time, 'HH24:MI')
      || case when v_varied_resources
          and (teacher_name <> '' or classroom_name <> '')
        then ' (' || concat_ws(', ', nullif(teacher_name, ''), nullif(classroom_name, '')) || ')'
        else '' end,
      E'\n' order by weekday, start_time, sort_order, id
    ), '') into v_projected_schedule
    from public.class_schedule_slots where class_id = p_class.id;

    select nullif(string_agg(distinct teacher_name, ', ' order by teacher_name), '')
    into v_projected_teacher
    from public.class_schedule_slots
    where class_id = p_class.id and teacher_name <> '';

    select case when count(distinct nullif(classroom_name, '')) <= 1
      then max(nullif(classroom_name, ''))
      else string_agg(
        nullif(classroom_name, '') || '(' ||
          (case weekday when 0 then '일' when 1 then '월' when 2 then '화'
            when 3 then '수' when 4 then '목' when 5 then '금' else '토' end) || ')',
        ', ' order by weekday, start_time, sort_order, id
      ) end into v_projected_room
    from public.class_schedule_slots where class_id = p_class.id;

    update public.classes
    set schedule_revision = schedule_revision + 1,
        schedule = v_projected_schedule,
        teacher = v_projected_teacher,
        room = v_projected_room
    where id = p_class.id;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'class_schedule_not_found' using errcode = 'P0002';
    end if;
  end if;
  return jsonb_build_object('changed', v_changed);
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
  if v_class.schedule_revision <> p_expected_schedule_revision then raise exception 'class_schedule_stale' using errcode = 'P0001'; end if;
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(p_class_id, p_request_key, 'save_class_schedule_defaults_v1', p_reason);
  v_change := dashboard_private.save_continuous_schedule_defaults_rows_v1(v_class, p_slots);
  select jsonb_build_object('changed', v_change -> 'changed', 'scheduleRevision', schedule_revision,
    'projectionHash', dashboard_private.continuous_class_schedule_hash_v1(coalesce(schedule_plan, '{}'::jsonb)),
    'slots', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'weekday', weekday, 'startTime', to_char(start_time, 'HH24:MI'), 'endTime', to_char(end_time, 'HH24:MI'), 'teacherCatalogId', teacher_catalog_id, 'teacherName', teacher_name, 'classroomCatalogId', classroom_catalog_id, 'classroomName', classroom_name, 'sortOrder', sort_order) order by weekday, start_time, sort_order), '[]'::jsonb) from public.class_schedule_slots where class_id = p_class_id)
  ) into v_response from public.classes where id = p_class_id;
  return dashboard_private.record_continuous_class_schedule_receipt_v1('save_class_schedule_defaults_v1', p_request_key, v_hash, v_response);
end;
$$;

commit;
