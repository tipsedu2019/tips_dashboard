begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
declare
  v_event_kind_constraint text;
  v_expected_event_kind_constraint text;
begin
  if pg_catalog.to_regclass(
    'public.ops_registration_customer_message_previews'
  ) is null
    or pg_catalog.to_regclass(
      'public.ops_registration_customer_messages'
    ) is null
    or pg_catalog.to_regclass(
      'public.ops_registration_observations'
    ) is null
    or pg_catalog.to_regclass(
      'dashboard_private.registration_observation_domain_events'
    ) is null
    or pg_catalog.to_regclass(
      'dashboard_private.registration_customer_solapi_template_receipts'
    ) is null
    or pg_catalog.to_regclass(
      'dashboard_private.registration_customer_solapi_activation'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.registration_customer_solapi_assert_kind_v1(text)'
    ) is null then
    raise exception 'registration_observation_solapi_dependency_missing'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into v_event_kind_constraint
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
      'dashboard_private.registration_observation_domain_events'::regclass
    and constraint_row.contype = 'c'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) ~ 'event_kind';

  create temporary table registration_observation_solapi_expected_event_kind_gate (
    event_kind text,
    constraint registration_observation_solapi_expected_event_kind_gate_check
      check (event_kind in (
        'observation_scheduled',
        'observation_rescheduled',
        'observation_canceled',
        'observation_attendance_recorded',
        'observation_no_show',
        'observation_feedback_submitted'
      ))
  ) on commit drop;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into strict v_expected_event_kind_constraint
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid =
      'pg_temp.registration_observation_solapi_expected_event_kind_gate'::regclass
    and constraint_row.conname =
      'registration_observation_solapi_expected_event_kind_gate_check';

  if v_event_kind_constraint is null
    or pg_catalog.regexp_replace(
      v_event_kind_constraint,
      '[[:space:]]+',
      '',
      'g'
    ) is distinct from pg_catalog.regexp_replace(
      v_expected_event_kind_constraint,
      '[[:space:]]+',
      '',
      'g'
    ) then
    raise exception 'registration_observation_solapi_dependency_missing'
      using errcode = '55000';
  end if;
end;
$$;

alter table public.ops_registration_customer_message_previews
  add column observation_id uuid
    references public.ops_registration_observations(id) on delete restrict;

alter table public.ops_registration_customer_messages
  add column observation_id uuid
    references public.ops_registration_observations(id) on delete restrict;

create index ops_reg_customer_preview_observation_idx
  on public.ops_registration_customer_message_previews(
    observation_id,
    message_kind,
    source_revision,
    created_at desc
  )
  where observation_id is not null;

create index ops_reg_customer_message_observation_idx
  on public.ops_registration_customer_messages(
    observation_id,
    message_kind,
    source_revision,
    created_at desc
  )
  where observation_id is not null;

alter table public.ops_registration_customer_message_previews
  drop constraint ops_registration_customer_message_previews_message_kind_check,
  drop constraint ops_registration_customer_message_previews_source_shape_check,
  add constraint ops_registration_customer_message_previews_message_kind_check
    check (message_kind in (
      'level_test_booking',
      'visit_consultation_booking',
      'appointment_reminder',
      'waiting_notice',
      'admission_application',
      'observation_booking',
      'observation_reminder'
    )),
  add constraint ops_registration_customer_message_previews_source_shape_check
    check (
      (
        message_kind in (
          'level_test_booking',
          'visit_consultation_booking',
          'appointment_reminder'
        )
        and observation_id is null
        and appointment_id is not null
        and track_id is null
      )
      or (
        message_kind = 'waiting_notice'
        and observation_id is null
        and track_id is not null
        and appointment_id is null
      )
      or (
        message_kind = 'admission_application'
        and observation_id is null
        and track_id is null
        and appointment_id is null
      )
      or (
        message_kind in ('observation_booking', 'observation_reminder')
        and observation_id is not null
        and appointment_id is not null
        and track_id is not null
        and source_revision is not null
      )
    );

alter table public.ops_registration_customer_messages
  drop constraint ops_registration_customer_messages_message_kind_check,
  drop constraint ops_registration_customer_messages_source_shape_check,
  add constraint ops_registration_customer_messages_message_kind_check
    check (message_kind in (
      'level_test_booking',
      'visit_consultation_booking',
      'appointment_reminder',
      'waiting_notice',
      'admission_application',
      'observation_booking',
      'observation_reminder'
    )),
  add constraint ops_registration_customer_messages_source_shape_check
    check (
      (
        message_kind in (
          'level_test_booking',
          'visit_consultation_booking',
          'appointment_reminder'
        )
        and observation_id is null
        and appointment_id is not null
        and track_id is null
      )
      or (
        message_kind = 'waiting_notice'
        and observation_id is null
        and track_id is not null
        and appointment_id is null
      )
      or (
        message_kind = 'admission_application'
        and observation_id is null
        and track_id is null
        and appointment_id is null
      )
      or (
        message_kind in ('observation_booking', 'observation_reminder')
        and observation_id is not null
        and appointment_id is not null
        and track_id is not null
        and source_revision is not null
      )
    );

create unique index ops_reg_customer_msg_observation_revision_once_idx
  on public.ops_registration_customer_messages(
    observation_id,
    message_kind,
    source_revision
  )
  where message_kind in ('observation_booking', 'observation_reminder');

alter table dashboard_private.registration_customer_solapi_template_receipts
  drop constraint registration_customer_solapi_template_receip_message_kind_check,
  add constraint registration_customer_solapi_template_receipts_kind_check_v2
    check (message_kind in (
      'level_test_booking',
      'visit_consultation_booking',
      'appointment_reminder',
      'waiting_notice',
      'admission_application',
      'observation_booking',
      'observation_reminder'
    ));

alter table dashboard_private.registration_customer_solapi_activation
  add column automatic_delivery_cutoff_at timestamptz,
  drop constraint registration_customer_solapi_activation_message_kind_check,
  add constraint registration_customer_solapi_activation_message_kind_check
    check (message_kind in (
      'level_test_booking',
      'visit_consultation_booking',
      'appointment_reminder',
      'waiting_notice',
      'admission_application',
      'observation_booking',
      'observation_reminder'
    )),
  add constraint registration_customer_solapi_activation_automatic_cutoff_check
    check (
      (
        message_kind = 'observation_reminder'
        and (
          (mode = 'live' and automatic_delivery_cutoff_at is not null)
          or (mode <> 'live' and automatic_delivery_cutoff_at is null)
        )
      )
      or (
        message_kind <> 'observation_reminder'
        and automatic_delivery_cutoff_at is null
      )
    );

insert into dashboard_private.registration_customer_solapi_activation(
  message_kind,
  mode
) values
  ('observation_booking', 'off'),
  ('observation_reminder', 'off')
on conflict (message_kind) do nothing;

create or replace function dashboard_private.set_registration_customer_solapi_cutoff_v1()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if new.message_kind = 'observation_reminder' then
    if new.mode = 'live' and old.mode is distinct from 'live' then
      new.automatic_delivery_cutoff_at := pg_catalog.clock_timestamp();
    elsif new.mode <> 'live' then
      new.automatic_delivery_cutoff_at := null;
    end if;
  else
    new.automatic_delivery_cutoff_at := null;
  end if;

  return new;
end;
$$;

alter function dashboard_private.set_registration_customer_solapi_cutoff_v1()
  owner to postgres;
revoke all on function dashboard_private.set_registration_customer_solapi_cutoff_v1()
  from public, anon, authenticated, service_role;

create trigger set_registration_customer_solapi_cutoff
before update of mode on dashboard_private.registration_customer_solapi_activation
for each row
execute function dashboard_private.set_registration_customer_solapi_cutoff_v1();

create or replace function dashboard_private.registration_customer_solapi_assert_kind_v1(
  p_message_kind text
)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_message_kind is null or p_message_kind not in (
    'level_test_booking',
    'visit_consultation_booking',
    'appointment_reminder',
    'waiting_notice',
    'admission_application',
    'observation_booking',
    'observation_reminder'
  ) then
    raise exception 'registration_customer_solapi_kind_invalid'
      using errcode = '22023';
  end if;
end;
$$;

alter function dashboard_private.registration_customer_solapi_assert_kind_v1(text)
  owner to postgres;
revoke all on function dashboard_private.registration_customer_solapi_assert_kind_v1(text)
  from public, anon, authenticated, service_role;

commit;
