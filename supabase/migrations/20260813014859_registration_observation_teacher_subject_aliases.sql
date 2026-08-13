begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function dashboard_private.registration_observation_teacher_subject_matches_v1(
  p_track_subject text,
  p_teacher_subjects text[]
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_track_subject is null or p_teacher_subjects is null then false
    when pg_catalog.cardinality(p_teacher_subjects) = 0 then true
    when pg_catalog.btrim(p_track_subject) in ('영어', '영어팀') then
      p_teacher_subjects && array['영어', '영어팀']::text[]
    when pg_catalog.btrim(p_track_subject) in ('수학', '수학팀') then
      p_teacher_subjects && array['수학', '수학팀']::text[]
    when pg_catalog.btrim(p_track_subject) in ('과학', '과학팀') then
      p_teacher_subjects && array['과학', '과학팀']::text[]
    else pg_catalog.btrim(p_track_subject) = any(p_teacher_subjects)
  end;
$$;

alter function dashboard_private.registration_observation_teacher_subject_matches_v1(text, text[])
  owner to postgres;
revoke all on function dashboard_private.registration_observation_teacher_subject_matches_v1(text, text[])
  from public, anon, authenticated, service_role;

do $$
declare
  v_target jsonb;
  v_signature text;
  v_expected_occurrences integer;
  v_function regprocedure;
  v_definition text;
  v_occurrences integer;
  v_helper_occurrences integer;
  v_old_expression constant text := 'v_track.subject = any(teacher.subjects)';
  v_new_expression constant text := 'dashboard_private.registration_observation_teacher_subject_matches_v1(v_track.subject, teacher.subjects)';
begin
  for v_target in
    select value
    from pg_catalog.jsonb_array_elements(
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'signature',
          'dashboard_private.assert_registration_observation_current_session_v1(uuid,text)',
          'expected_occurrences', 3
        ),
        pg_catalog.jsonb_build_object(
          'signature',
          'dashboard_private.list_registration_observation_sessions_v1_impl(uuid,uuid,date,date)',
          'expected_occurrences', 1
        ),
        pg_catalog.jsonb_build_object(
          'signature',
          'dashboard_private.resolve_registration_observation_session_v1(uuid,uuid,text,uuid,text)',
          'expected_occurrences', 3
        )
      )
    )
  loop
    v_signature := v_target ->> 'signature';
    v_expected_occurrences := (v_target ->> 'expected_occurrences')::integer;
    v_function := pg_catalog.to_regprocedure(v_signature);

    if v_function is null then
      raise exception 'registration_observation_teacher_subject_dependency_drift'
        using errcode = '55000';
    end if;

    select pg_catalog.pg_get_functiondef(v_function::oid)
    into v_definition;

    v_occurrences := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old_expression, ''))
    ) / pg_catalog.length(v_old_expression);

    if v_occurrences is distinct from v_expected_occurrences then
      raise exception 'registration_observation_teacher_subject_dependency_drift'
        using errcode = '55000';
    end if;

    v_definition := pg_catalog.replace(
      v_definition,
      v_old_expression,
      v_new_expression
    );
    execute v_definition;

    select pg_catalog.pg_get_functiondef(v_function::oid)
    into v_definition;

    v_occurrences := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old_expression, ''))
    ) / pg_catalog.length(v_old_expression);
    v_helper_occurrences := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_new_expression, ''))
    ) / pg_catalog.length(v_new_expression);

    if v_occurrences <> 0
      or v_helper_occurrences is distinct from v_expected_occurrences
    then
      raise exception 'registration_observation_teacher_subject_dependency_drift'
        using errcode = '55000';
    end if;
  end loop;
end;
$$;

commit;
