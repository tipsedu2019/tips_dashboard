begin;

create or replace function dashboard_private.normalize_registration_appointment_place_v1(
  p_kind text,
  p_place text
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_place text;
begin
  if p_kind = 'level_test' then
    v_place := nullif(pg_catalog.btrim(p_place), '');
    if v_place is null or v_place not in ('본관', '별관') then
      raise exception 'registration_level_test_place_invalid' using errcode = '22023';
    end if;
    return v_place;
  end if;
  return p_place;
end;
$$;

create or replace function dashboard_private.normalize_registration_level_test_appointment_v1(
  p_appointment jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_place text;
begin
  if p_appointment is null
    or pg_catalog.jsonb_typeof(p_appointment) = 'null'
    or pg_catalog.jsonb_typeof(p_appointment) <> 'object'
    or pg_catalog.jsonb_typeof(p_appointment -> 'place') is distinct from 'string'
  then
    return p_appointment;
  end if;

  v_place := dashboard_private.normalize_registration_appointment_place_v1(
    'level_test',
    p_appointment ->> 'place'
  );
  return pg_catalog.jsonb_set(
    p_appointment,
    '{place}',
    pg_catalog.to_jsonb(v_place),
    false
  );
end;
$$;

alter function dashboard_private.normalize_registration_appointment_place_v1(text, text)
  owner to postgres;
revoke all on function dashboard_private.normalize_registration_appointment_place_v1(text, text)
  from public, anon, service_role;
grant execute on function dashboard_private.normalize_registration_appointment_place_v1(text, text)
  to authenticated;

alter function dashboard_private.normalize_registration_level_test_appointment_v1(jsonb)
  owner to postgres;
revoke all on function dashboard_private.normalize_registration_level_test_appointment_v1(jsonb)
  from public, anon, service_role;
grant execute on function dashboard_private.normalize_registration_level_test_appointment_v1(jsonb)
  to authenticated;

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
language sql
volatile
security invoker
set search_path = ''
as $$
  select dashboard_private.create_registration_case_with_reminders_v1_impl(
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
    dashboard_private.normalize_registration_level_test_appointment_v1(
      p_level_test_appointment
    ),
    p_visit_appointment,
    p_director_overrides,
    p_request_key
  );
$$;

alter function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) owner to postgres;
revoke all on function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) from public, anon, service_role;
grant execute on function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) to authenticated;

create or replace function public.save_registration_shared_appointment(
  p_appointment_id uuid,
  p_task_id uuid,
  p_kind text,
  p_scheduled_at timestamptz,
  p_place text,
  p_track_ids uuid[],
  p_replace_remaining boolean,
  p_expected_notification_revision integer,
  p_request_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select dashboard_private.save_registration_shared_appointment_with_reminders_v1_impl(
    p_appointment_id,
    p_task_id,
    p_kind,
    p_scheduled_at,
    dashboard_private.normalize_registration_appointment_place_v1(
      p_kind,
      p_place
    ),
    p_track_ids,
    p_replace_remaining,
    p_expected_notification_revision,
    p_request_key
  );
$$;

alter function public.save_registration_shared_appointment(
  uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text
) owner to postgres;
revoke all on function public.save_registration_shared_appointment(
  uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text
) from public, anon, service_role;
grant execute on function public.save_registration_shared_appointment(
  uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text
) to authenticated;

commit;
