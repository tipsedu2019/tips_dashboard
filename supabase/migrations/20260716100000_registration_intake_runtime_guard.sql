begin;

create or replace function public.create_registration_case_with_initial_workflow_v1(
  p_student_name text,
  p_school_grade text,
  p_school_name text,
  p_parent_phone text,
  p_student_phone text,
  p_campus text,
  p_inquiry_at timestamptz,
  p_subjects text[],
  p_request_note text,
  p_priority text,
  p_subject_plans jsonb,
  p_level_test_appointment jsonb,
  p_visit_appointment jsonb,
  p_director_overrides jsonb,
  p_request_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_subject_runtime integer;
  v_intake_runtime integer;
begin
  if pg_catalog.to_regprocedure('public.registration_subject_tracks_runtime_version()') is null then
    raise exception 'registration_subject_tracks_runtime_missing';
  end if;
  begin
    execute 'select public.registration_subject_tracks_runtime_version()'
      into v_subject_runtime;
  exception
    when insufficient_privilege then
      raise exception 'registration_subject_tracks_runtime_unauthorized';
  end;
  if v_subject_runtime is distinct from 1 then
    raise exception 'registration_subject_tracks_runtime_mismatch';
  end if;

  if pg_catalog.to_regprocedure('public.registration_intake_workflow_runtime_version()') is null then
    raise exception 'registration_intake_workflow_runtime_missing';
  end if;
  begin
    execute 'select public.registration_intake_workflow_runtime_version()'
      into v_intake_runtime;
  exception
    when insufficient_privilege then
      raise exception 'registration_intake_workflow_runtime_unauthorized';
  end;
  if v_intake_runtime is distinct from 1 then
    raise exception 'registration_intake_workflow_runtime_mismatch';
  end if;

  return dashboard_private.create_registration_case_with_initial_workflow_v1_impl(
    p_student_name,
    p_school_grade,
    p_school_name,
    p_parent_phone,
    p_student_phone,
    p_campus,
    p_inquiry_at,
    p_subjects,
    p_request_note,
    p_priority,
    p_subject_plans,
    p_level_test_appointment,
    p_visit_appointment,
    p_director_overrides,
    p_request_key
  );
end;
$$;

alter function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) owner to postgres;
revoke execute on function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) from public, anon;
grant execute on function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) to authenticated;

commit;
