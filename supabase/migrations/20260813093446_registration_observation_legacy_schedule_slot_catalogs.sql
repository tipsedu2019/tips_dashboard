begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
declare
  v_definition text;
begin
  if pg_catalog.to_regprocedure(
    'dashboard_private.registration_observation_effective_legacy_slots_v1(uuid)'
  ) is null
    or pg_catalog.to_regclass('public.teacher_catalogs') is null
    or pg_catalog.to_regclass('public.classroom_catalogs') is null
  then
    raise exception 'registration_observation_legacy_schedule_catalog_dependency_missing'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'dashboard_private.registration_observation_effective_legacy_slots_v1(uuid)'::regprocedure
  )
  into v_definition;
  if pg_catalog.strpos(pg_catalog.lower(v_definition), 'null::uuid as teacher_catalog_id') = 0
    or pg_catalog.strpos(pg_catalog.lower(v_definition), 'null::uuid as classroom_catalog_id') = 0
  then
    raise exception 'registration_observation_legacy_schedule_catalog_dependency_drift'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function dashboard_private.registration_observation_effective_legacy_slots_v1(
  p_class_id uuid
)
returns setof public.class_schedule_slots
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_class public.classes%rowtype;
  v_slots jsonb;
begin
  if p_class_id is null then
    return;
  end if;

  return query
  select slot.*
  from public.class_schedule_slots slot
  where slot.class_id = p_class_id
  order by slot.sort_order, slot.weekday, slot.start_time, slot.id;
  if found then
    return;
  end if;

  select class.*
  into v_class
  from public.classes class
  where class.id = p_class_id
    and class.schedule_storage_mode in ('legacy', 'shadow');
  if not found then
    return;
  end if;

  begin
    v_slots := dashboard_private.registration_customer_message_legacy_slots_v1(
      v_class.schedule,
      v_class.teacher,
      v_class.room
    );
  exception
    when sqlstate '22023' then
      return;
  end;

  return query
  select
    null::uuid as id,
    v_class.id as class_id,
    (slot.value ->> 'weekday')::smallint as weekday,
    (slot.value ->> 'startTime')::time as start_time,
    (slot.value ->> 'endTime')::time as end_time,
    case when teacher_pick.match_count = 1
      then teacher_pick.selected_id
      else null::uuid
    end as teacher_catalog_id,
    slot.value ->> 'teacherName' as teacher_name,
    case when classroom_pick.match_count = 1
      then classroom_pick.selected_id
      else null::uuid
    end as classroom_catalog_id,
    slot.value ->> 'classroomName' as classroom_name,
    (slot.value ->> 'sortOrder')::integer as sort_order,
    null::timestamptz as created_at,
    null::timestamptz as updated_at
  from pg_catalog.jsonb_array_elements(v_slots) slot(value)
  left join lateral (
    select
      pg_catalog.count(*)::integer as match_count,
      pg_catalog.min(teacher.id::text)::uuid as selected_id
    from public.teacher_catalogs teacher
    where teacher.is_visible = true
      and teacher.profile_id is not null
      and pg_catalog.lower(teacher.name)
        = pg_catalog.lower(slot.value ->> 'teacherName')
      and (
        pg_catalog.cardinality(teacher.subjects) = 0
        or dashboard_private.registration_observation_teacher_subject_matches_v1(
          v_class.subject,
          teacher.subjects
        )
      )
  ) teacher_pick on true
  left join lateral (
    select
      pg_catalog.count(*)::integer as match_count,
      pg_catalog.min(classroom.id::text)::uuid as selected_id
    from public.classroom_catalogs classroom
    where classroom.is_visible = true
      and classroom.campus in ('본관', '별관')
      and pg_catalog.lower(classroom.name)
        = pg_catalog.lower(slot.value ->> 'classroomName')
      and (
        pg_catalog.cardinality(classroom.subjects) = 0
        or v_class.subject = any(classroom.subjects)
      )
  ) classroom_pick on true
  order by
    (slot.value ->> 'sortOrder')::integer,
    (slot.value ->> 'weekday')::smallint,
    (slot.value ->> 'startTime')::time,
    (slot.value ->> 'endTime')::time;
end;
$$;

alter function dashboard_private.registration_observation_effective_legacy_slots_v1(uuid)
  owner to postgres;
revoke all on function dashboard_private.registration_observation_effective_legacy_slots_v1(uuid)
  from public, anon, authenticated, service_role;

commit;
