begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Appointment integrity is scoped to the appointment and its active child rows.
-- The manual registration workflow is intentionally independent and must not
-- block scheduling or editing an appointment.
create or replace function dashboard_private.assert_registration_appointment_integrity_v1(
  p_appointment_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_appointment public.ops_registration_appointments%rowtype;
begin
  if p_appointment_id is null then
    return;
  end if;

  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id;
  if not found or v_appointment.kind not in ('level_test', 'visit_consultation') then
    return;
  end if;

  if v_appointment.kind = 'level_test' then
    if v_appointment.status = 'scheduled'
      and not exists (
        select 1
        from public.ops_registration_level_tests attempt
        where attempt.appointment_id = v_appointment.id
          and attempt.status in ('scheduled', 'in_progress')
      )
    then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;

    if v_appointment.status <> 'scheduled'
      and exists (
        select 1
        from public.ops_registration_level_tests attempt
        where attempt.appointment_id = v_appointment.id
          and attempt.status in ('scheduled', 'in_progress')
      )
    then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;
  else
    if v_appointment.status = 'scheduled'
      and not exists (
        select 1
        from public.ops_registration_consultations consultation
        where consultation.appointment_id = v_appointment.id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled'
      )
    then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;

    if v_appointment.status <> 'scheduled'
      and exists (
        select 1
        from public.ops_registration_consultations consultation
        where consultation.appointment_id = v_appointment.id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled'
      )
    then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;
  end if;
end;
$$;

alter function dashboard_private.assert_registration_appointment_integrity_v1(uuid)
  owner to postgres;
revoke all on function dashboard_private.assert_registration_appointment_integrity_v1(uuid)
  from public, anon, authenticated, service_role;

commit;
