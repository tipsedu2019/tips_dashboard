begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if pg_catalog.to_regprocedure(
    'dashboard_private.registration_observation_teacher_subject_matches_v1(text,text[])'
  ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.resolve_continuous_schedule_catalog_name_v1(text,uuid,text)'
    ) is null
  then
    raise exception 'continuous_class_schedule_subject_alias_dependency_drift'
      using errcode = '55000';
  end if;
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
    select teacher.name
    into v_name
    from public.teacher_catalogs teacher
    where teacher.id = p_catalog_id
      and teacher.is_visible = true
      and (
        pg_catalog.cardinality(teacher.subjects) = 0
        or p_subject is null
        or dashboard_private.registration_observation_teacher_subject_matches_v1(
          p_subject,
          teacher.subjects
        )
      );
  elsif p_kind = 'classroom' then
    select classroom.name
    into v_name
    from public.classroom_catalogs classroom
    where classroom.id = p_catalog_id
      and classroom.is_visible = true
      and (
        pg_catalog.cardinality(classroom.subjects) = 0
        or p_subject is null
        or p_subject = any(classroom.subjects)
      );
  else
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'class_schedule_catalog_invalid' using errcode = '22023';
  end if;
  return v_name;
end;
$$;

revoke all on function dashboard_private.resolve_continuous_schedule_catalog_name_v1(
  text,
  uuid,
  text
) from public, anon, authenticated, service_role;

commit;
