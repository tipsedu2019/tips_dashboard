begin;

-- A scheduled child must remain aligned with its parent appointment and track.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function dashboard_private.reconcile_registration_appointment_parent_v1(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_appointment public.ops_registration_appointments%rowtype;
  v_active_child_count integer := 0;
  v_non_canceled_child_count integer := 0;
  v_next_status text;
  v_notification_revision integer;
begin
  if p_appointment_id is null then
    return pg_catalog.jsonb_build_object('found', false);
  end if;

  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('found', false);
  end if;

  if v_appointment.kind not in ('level_test', 'visit_consultation')
    or v_appointment.status <> 'scheduled'
  then
    return pg_catalog.jsonb_build_object(
      'found', true,
      'status', v_appointment.status,
      'notification_revision', v_appointment.notification_revision,
      'changed', false
    );
  end if;

  if v_appointment.kind = 'level_test' then
    select
      pg_catalog.count(*) filter (where attempt.status in ('scheduled', 'in_progress')),
      pg_catalog.count(*) filter (where attempt.status <> 'canceled')
    into v_active_child_count, v_non_canceled_child_count
    from public.ops_registration_level_tests attempt
    where attempt.appointment_id = v_appointment.id;
  else
    select
      pg_catalog.count(*) filter (where consultation.status = 'scheduled'),
      pg_catalog.count(*) filter (where consultation.status <> 'canceled')
    into v_active_child_count, v_non_canceled_child_count
    from public.ops_registration_consultations consultation
    where consultation.appointment_id = v_appointment.id
      and consultation.mode = 'visit';
  end if;

  if v_active_child_count > 0 then
    return pg_catalog.jsonb_build_object(
      'found', true,
      'status', v_appointment.status,
      'notification_revision', v_appointment.notification_revision,
      'changed', false
    );
  end if;

  v_next_status := case
    when v_non_canceled_child_count = 0 then 'canceled'
    else 'completed'
  end;

  update public.ops_registration_appointments appointment
  set
    status = v_next_status,
    notification_revision = appointment.notification_revision + 1,
    updated_at = pg_catalog.now()
  where appointment.id = v_appointment.id
  returning appointment.notification_revision into v_notification_revision;

  perform dashboard_private.cancel_registration_appointment_reminders_v1(
    v_appointment.id,
    'source_status_changed',
    null,
    pg_catalog.clock_timestamp()
  );

  return pg_catalog.jsonb_build_object(
    'found', true,
    'status', v_next_status,
    'notification_revision', v_notification_revision,
    'changed', true
  );
end;
$$;

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

    if exists (
      select 1
      from public.ops_registration_level_tests attempt
      join public.ops_registration_subject_tracks track on track.id = attempt.track_id
      where attempt.appointment_id = v_appointment.id
        and (
          v_appointment.status <> 'scheduled'
          and attempt.status in ('scheduled', 'in_progress')
          or attempt.status = 'scheduled'
          and track.pipeline_status <> 'level_test_scheduled'
          or attempt.status = 'in_progress'
          and track.pipeline_status <> 'level_test_in_progress'
        )
    ) then
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

    if exists (
      select 1
      from public.ops_registration_consultations consultation
      join public.ops_registration_subject_tracks track on track.id = consultation.track_id
      where consultation.appointment_id = v_appointment.id
        and consultation.mode = 'visit'
        and (
          v_appointment.status <> 'scheduled'
          and consultation.status = 'scheduled'
          or consultation.status = 'scheduled'
          and track.pipeline_status <> 'visit_consultation_scheduled'
        )
    ) then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;
  end if;
end;
$$;

create or replace function dashboard_private.assert_registration_appointment_integrity_from_appointment_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.assert_registration_appointment_integrity_v1(
    coalesce(new.id, old.id)
  );
  return null;
end;
$$;

create or replace function dashboard_private.assert_registration_appointment_integrity_from_level_test_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.assert_registration_appointment_integrity_v1(
    coalesce(new.appointment_id, old.appointment_id)
  );
  return null;
end;
$$;

create or replace function dashboard_private.assert_registration_appointment_integrity_from_consultation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.assert_registration_appointment_integrity_v1(
    coalesce(new.appointment_id, old.appointment_id)
  );
  return null;
end;
$$;

create or replace function dashboard_private.assert_registration_appointment_integrity_from_track_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment_id uuid;
begin
  for v_appointment_id in
    select distinct attempt.appointment_id
    from public.ops_registration_level_tests attempt
    where attempt.track_id = coalesce(new.id, old.id)
    union
    select distinct consultation.appointment_id
    from public.ops_registration_consultations consultation
    where consultation.track_id = coalesce(new.id, old.id)
      and consultation.appointment_id is not null
  loop
    perform dashboard_private.assert_registration_appointment_integrity_v1(
      v_appointment_id
    );
  end loop;
  return null;
end;
$$;

alter function public.save_registration_consultation_result_v2(
  uuid, text, text, text, uuid, integer, text
) rename to save_registration_consultation_result_v2_base;

revoke all on function public.save_registration_consultation_result_v2_base(
  uuid, text, text, text, uuid, integer, text
) from public, anon, authenticated, service_role;

create function public.save_registration_consultation_result_v2(
  p_consultation_id uuid,
  p_outcome text,
  p_note text,
  p_waiting_kind text,
  p_class_id uuid,
  p_expected_workflow_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_response jsonb;
  v_appointment_id uuid;
  v_task_id uuid;
begin
  v_response := public.save_registration_consultation_result_v2_base(
    p_consultation_id,
    p_outcome,
    p_note,
    p_waiting_kind,
    p_class_id,
    p_expected_workflow_revision,
    p_request_key
  );

  select consultation.appointment_id, track.task_id
  into v_appointment_id, v_task_id
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where consultation.id = p_consultation_id;

  if v_appointment_id is not null then
    perform dashboard_private.reconcile_registration_appointment_parent_v1(
      v_appointment_id
    );
  end if;
  if v_task_id is not null then
    perform dashboard_private.recompute_registration_parent(v_task_id);
  end if;

  return v_response;
end;
$$;

do $repair$
declare
  v_appointment_id uuid;
begin
  update public.ops_registration_level_tests attempt
  set
    status = 'canceled',
    completed_at = coalesce(attempt.completed_at, pg_catalog.now()),
    updated_at = pg_catalog.now()
  from public.ops_registration_appointments appointment,
    public.ops_registration_subject_tracks track
  where attempt.appointment_id = appointment.id
    and track.id = attempt.track_id
    and attempt.status = 'scheduled'
    and (
      appointment.status <> 'scheduled'
      or track.pipeline_status <> 'level_test_scheduled'
    );

  update public.ops_registration_consultations consultation
  set
    status = 'canceled',
    updated_at = pg_catalog.now()
  from public.ops_registration_appointments appointment,
    public.ops_registration_subject_tracks track
  where consultation.appointment_id = appointment.id
    and track.id = consultation.track_id
    and consultation.mode = 'visit'
    and consultation.status = 'scheduled'
    and (
      appointment.status <> 'scheduled'
      or track.pipeline_status <> 'visit_consultation_scheduled'
    );

  for v_appointment_id in
    select appointment.id
    from public.ops_registration_appointments appointment
    where appointment.kind in ('level_test', 'visit_consultation')
      and appointment.status = 'scheduled'
    order by appointment.id
  loop
    perform dashboard_private.reconcile_registration_appointment_parent_v1(
      v_appointment_id
    );
  end loop;
end;
$repair$;

drop trigger if exists registration_appointment_integrity_on_appointment
  on public.ops_registration_appointments;
create constraint trigger registration_appointment_integrity_on_appointment
after insert or update or delete on public.ops_registration_appointments
deferrable initially deferred
for each row
execute function dashboard_private.assert_registration_appointment_integrity_from_appointment_v1();

drop trigger if exists registration_appointment_integrity_on_level_test
  on public.ops_registration_level_tests;
create constraint trigger registration_appointment_integrity_on_level_test
after insert or update or delete on public.ops_registration_level_tests
deferrable initially deferred
for each row
execute function dashboard_private.assert_registration_appointment_integrity_from_level_test_v1();

drop trigger if exists registration_appointment_integrity_on_consultation
  on public.ops_registration_consultations;
create constraint trigger registration_appointment_integrity_on_consultation
after insert or update or delete on public.ops_registration_consultations
deferrable initially deferred
for each row
execute function dashboard_private.assert_registration_appointment_integrity_from_consultation_v1();

drop trigger if exists registration_appointment_integrity_on_track
  on public.ops_registration_subject_tracks;
create constraint trigger registration_appointment_integrity_on_track
after update or delete on public.ops_registration_subject_tracks
deferrable initially deferred
for each row
execute function dashboard_private.assert_registration_appointment_integrity_from_track_v1();

do $verify$
declare
  v_appointment_id uuid;
begin
  for v_appointment_id in
    select appointment.id
    from public.ops_registration_appointments appointment
    where appointment.kind in ('level_test', 'visit_consultation')
    order by appointment.id
  loop
    perform dashboard_private.assert_registration_appointment_integrity_v1(
      v_appointment_id
    );
  end loop;
end;
$verify$;

alter function dashboard_private.reconcile_registration_appointment_parent_v1(uuid)
  owner to postgres;
alter function dashboard_private.assert_registration_appointment_integrity_v1(uuid)
  owner to postgres;
alter function dashboard_private.assert_registration_appointment_integrity_from_appointment_v1()
  owner to postgres;
alter function dashboard_private.assert_registration_appointment_integrity_from_level_test_v1()
  owner to postgres;
alter function dashboard_private.assert_registration_appointment_integrity_from_consultation_v1()
  owner to postgres;
alter function dashboard_private.assert_registration_appointment_integrity_from_track_v1()
  owner to postgres;
alter function public.save_registration_consultation_result_v2_base(
  uuid, text, text, text, uuid, integer, text
) owner to postgres;
alter function public.save_registration_consultation_result_v2(
  uuid, text, text, text, uuid, integer, text
) owner to postgres;

revoke all on function dashboard_private.reconcile_registration_appointment_parent_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_appointment_integrity_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_appointment_integrity_from_appointment_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_appointment_integrity_from_level_test_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_appointment_integrity_from_consultation_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_appointment_integrity_from_track_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.save_registration_consultation_result_v2(
  uuid, text, text, text, uuid, integer, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_registration_consultation_result_v2(
  uuid, text, text, text, uuid, integer, text
) to authenticated;

commit;
