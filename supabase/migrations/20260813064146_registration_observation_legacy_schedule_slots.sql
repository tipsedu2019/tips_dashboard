begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if pg_catalog.to_regprocedure(
    'dashboard_private.registration_customer_message_legacy_slots_v1(text,text,text)'
  ) is null
    or pg_catalog.to_regclass('public.class_schedule_slots') is null
  then
    raise exception 'registration_observation_legacy_schedule_dependency_missing'
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
    null::uuid as teacher_catalog_id,
    slot.value ->> 'teacherName' as teacher_name,
    null::uuid as classroom_catalog_id,
    slot.value ->> 'classroomName' as classroom_name,
    (slot.value ->> 'sortOrder')::integer as sort_order,
    null::timestamptz as created_at,
    null::timestamptz as updated_at
  from pg_catalog.jsonb_array_elements(v_slots) slot(value)
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

do $$
declare
  v_target jsonb;
  v_signature text;
  v_class_expression text;
  v_expected_occurrences integer;
  v_function regprocedure;
  v_definition text;
  v_old_from constant text := 'from public.class_schedule_slots slot';
  v_new_from text;
  v_old_occurrences integer;
  v_new_occurrences integer;
  v_lock_fragment constant text := E'    limit 1\n    for share;';
  v_lock_occurrences integer;
begin
  for v_target in
    select value
    from pg_catalog.jsonb_array_elements(
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'signature',
            'dashboard_private.list_registration_observation_sessions_v1_impl(uuid,uuid,date,date)',
          'class_expression', 'p_class_id',
          'expected_occurrences', 1
        ),
        pg_catalog.jsonb_build_object(
          'signature',
            'dashboard_private.resolve_registration_observation_session_v1(uuid,uuid,text,uuid,text)',
          'class_expression', 'p_class_id',
          'expected_occurrences', 2
        ),
        pg_catalog.jsonb_build_object(
          'signature',
            'dashboard_private.assert_registration_observation_current_session_v1(uuid,text)',
          'class_expression', 'v_observation.class_id',
          'expected_occurrences', 2
        ),
        pg_catalog.jsonb_build_object(
          'signature',
            'dashboard_private.get_registration_observation_notification_source_impl_v1(uuid)',
          'class_expression', 'v_class_id',
          'expected_occurrences', 2
        )
      )
    )
  loop
    v_signature := v_target ->> 'signature';
    v_class_expression := v_target ->> 'class_expression';
    v_expected_occurrences := (v_target ->> 'expected_occurrences')::integer;
    v_function := pg_catalog.to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'registration_observation_legacy_schedule_dependency_drift'
        using errcode = '55000';
    end if;

    select pg_catalog.pg_get_functiondef(v_function::oid)
    into v_definition;
    v_old_occurrences := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old_from, ''))
    ) / pg_catalog.length(v_old_from);
    if v_old_occurrences is distinct from v_expected_occurrences then
      raise exception 'registration_observation_legacy_schedule_dependency_drift'
        using errcode = '55000';
    end if;

    v_new_from := 'from dashboard_private.registration_observation_effective_legacy_slots_v1('
      || v_class_expression || ') slot';
    v_definition := pg_catalog.replace(
      v_definition,
      v_old_from,
      v_new_from
    );

    if v_signature =
      'dashboard_private.assert_registration_observation_current_session_v1(uuid,text)'
    then
      v_lock_occurrences := (
        pg_catalog.length(v_definition)
        - pg_catalog.length(
          pg_catalog.replace(v_definition, v_lock_fragment, '')
        )
      ) / pg_catalog.length(v_lock_fragment);
      if v_lock_occurrences is distinct from 1 then
        raise exception 'registration_observation_legacy_schedule_lock_drift'
          using errcode = '55000';
      end if;
      v_definition := pg_catalog.replace(
        v_definition,
        v_lock_fragment,
        '    limit 1;'
      );
    end if;

    execute v_definition;

    select pg_catalog.pg_get_functiondef(v_function::oid)
    into v_definition;
    v_old_occurrences := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old_from, ''))
    ) / pg_catalog.length(v_old_from);
    v_new_occurrences := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_new_from, ''))
    ) / pg_catalog.length(v_new_from);
    if v_old_occurrences <> 0
      or v_new_occurrences is distinct from v_expected_occurrences
    then
      raise exception 'registration_observation_legacy_schedule_install_failed'
        using errcode = '55000';
    end if;
  end loop;
end;
$$;

commit;
