begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- The daily producer remains owned by the existing schedule. Its fixed UTC
-- expression is '0 1 * * *' (10:00 Asia/Seoul); this install does not alter it.

alter table public.ops_registration_details
  add column if not exists customer_message_recipient_revision bigint not null default 1;

alter table public.ops_registration_details
  drop constraint if exists ops_registration_details_customer_message_recipient_revision_check;

alter table public.ops_registration_details
  add constraint ops_registration_details_customer_message_recipient_revision_check
  check (customer_message_recipient_revision > 0);

create or replace function dashboard_private.bump_registration_customer_message_recipient_revision_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.regexp_replace(pg_catalog.coalesce(new.parent_phone, ''), '[^0-9]', '', 'g')
    is distinct from pg_catalog.regexp_replace(pg_catalog.coalesce(old.parent_phone, ''), '[^0-9]', '', 'g') then
    new.customer_message_recipient_revision := old.customer_message_recipient_revision + 1;
  else
    new.customer_message_recipient_revision := old.customer_message_recipient_revision;
  end if;
  return new;
end;
$$;

alter function dashboard_private.bump_registration_customer_message_recipient_revision_v1() owner to postgres;
revoke all on function dashboard_private.bump_registration_customer_message_recipient_revision_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists bump_registration_customer_message_recipient_revision
  on public.ops_registration_details;
create trigger bump_registration_customer_message_recipient_revision
before update of parent_phone on public.ops_registration_details
for each row execute function dashboard_private.bump_registration_customer_message_recipient_revision_v1();

create table dashboard_private.registration_customer_message_bundle_runtime (
  singleton boolean primary key default true check (singleton),
  installed_version integer not null default 1 check (installed_version = 1),
  active_version integer not null default 0 check (active_version in (0, 1)),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

insert into dashboard_private.registration_customer_message_bundle_runtime(singleton)
values (true)
on conflict (singleton) do nothing;

create table dashboard_private.registration_customer_message_bundle_runs (
  id uuid primary key default gen_random_uuid(),
  service_date date not null unique,
  scheduled_for timestamptz not null,
  started_at timestamptz not null,
  status text not null check (status in ('producing', 'ready', 'completed', 'failed_hold')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (scheduled_for = (service_date + time '10:00') at time zone 'Asia/Seoul')
);

create table dashboard_private.registration_customer_message_bundles (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references dashboard_private.registration_customer_message_bundle_runs(id) on delete restrict,
  task_id uuid not null references public.ops_tasks(id) on delete restrict,
  reservation_kind text not null check (reservation_kind in ('level_test', 'visit_consultation', 'observation')),
  delivery_kind text not null check (delivery_kind in ('booking', 'reminder')),
  service_date date,
  bundle_revision bigint not null default 1 check (bundle_revision > 0),
  replaces_bundle_id uuid references dashboard_private.registration_customer_message_bundles(id) on delete restrict,
  recipient_revision bigint not null check (recipient_revision > 0),
  source_fingerprint text not null check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'dispatching', 'accepted', 'unknown', 'failed_hold', 'canceled')),
  scheduled_for timestamptz,
  request_key uuid not null unique default gen_random_uuid(),
  claim_token uuid,
  claim_expires_at timestamptz,
  message_id uuid,
  refresh_count smallint not null default 0 check (refresh_count between 0 and 1),
  last_error_code text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (
    (delivery_kind = 'booking' and service_date is null and run_id is null and scheduled_for is null)
    or (delivery_kind = 'reminder' and service_date is not null and run_id is not null and scheduled_for is not null)
  )
);

create table dashboard_private.registration_customer_message_bundle_items (
  bundle_id uuid not null references dashboard_private.registration_customer_message_bundles(id) on delete restrict,
  sort_order smallint not null check (sort_order between 1 and 3),
  source_kind text not null check (source_kind in ('level_test', 'visit_consultation', 'observation')),
  source_id uuid not null,
  source_revision jsonb not null,
  track_id uuid not null references public.ops_registration_subject_tracks(id) on delete restrict,
  activity_id uuid,
  subject text not null check (subject in ('영어', '수학', '과학')),
  scheduled_at timestamptz not null,
  service_date date not null,
  place text not null check (nullif(pg_catalog.btrim(place), '') is not null),
  class_name text,
  teacher_name text,
  source_fact_hash text not null check (source_fact_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (bundle_id, sort_order),
  unique (bundle_id, source_kind, source_id, track_id),
  unique (bundle_id, subject),
  check ((class_name is null) = (teacher_name is null))
);

create unique index registration_customer_message_booking_bundle_revision_idx
  on dashboard_private.registration_customer_message_bundles(task_id, reservation_kind, delivery_kind, source_fingerprint, bundle_revision)
  where delivery_kind = 'booking';

create unique index registration_customer_message_reminder_bundle_revision_idx
  on dashboard_private.registration_customer_message_bundles(task_id, reservation_kind, delivery_kind, service_date, bundle_revision)
  where delivery_kind = 'reminder';

create or replace function dashboard_private.guard_registration_customer_message_bundle_item_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'registration_customer_message_bundle_item_immutable'
    using errcode = '55000';
end;
$$;

create trigger guard_registration_customer_message_bundle_item
before update or delete on dashboard_private.registration_customer_message_bundle_items
for each row execute function dashboard_private.guard_registration_customer_message_bundle_item_v1();

create or replace function dashboard_private.guard_registration_customer_message_bundle_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.task_id is distinct from old.task_id
    or new.reservation_kind is distinct from old.reservation_kind
    or new.delivery_kind is distinct from old.delivery_kind
    or new.service_date is distinct from old.service_date
    or new.bundle_revision is distinct from old.bundle_revision
    or new.replaces_bundle_id is distinct from old.replaces_bundle_id
    or new.recipient_revision is distinct from old.recipient_revision
    or new.source_fingerprint is distinct from old.source_fingerprint
    or new.run_id is distinct from old.run_id
    or new.scheduled_for is distinct from old.scheduled_for
    or new.request_key is distinct from old.request_key then
    raise exception 'registration_customer_message_bundle_snapshot_immutable'
      using errcode = '55000';
  end if;

  if not (
    (old.status = 'pending' and new.status in ('claimed', 'dispatching', 'failed_hold', 'canceled'))
    or (old.status = 'claimed' and new.status in ('pending', 'dispatching', 'failed_hold', 'canceled'))
    or (old.status = 'dispatching' and new.status in ('accepted', 'unknown', 'failed_hold'))
    or (old.status = new.status)
  ) then
    raise exception 'registration_customer_message_bundle_status_transition_invalid'
      using errcode = '55000';
  end if;

  if old.status = 'claimed' and new.status = 'pending'
    and (old.claim_expires_at is null or old.claim_expires_at > pg_catalog.clock_timestamp()) then
    raise exception 'registration_customer_message_bundle_claim_not_expired'
      using errcode = '55000';
  end if;

  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger guard_registration_customer_message_bundle
before update on dashboard_private.registration_customer_message_bundles
for each row execute function dashboard_private.guard_registration_customer_message_bundle_v1();

alter function dashboard_private.guard_registration_customer_message_bundle_item_v1() owner to postgres;
alter function dashboard_private.guard_registration_customer_message_bundle_v1() owner to postgres;
revoke all on function dashboard_private.guard_registration_customer_message_bundle_item_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.guard_registration_customer_message_bundle_v1()
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.collect_registration_customer_message_bundle_items_v1(
  p_task_id uuid,
  p_reservation_kind text,
  p_delivery_kind text,
  p_service_date date,
  p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_count integer;
  v_subject_count integer;
begin
  if p_reservation_kind not in ('level_test', 'visit_consultation', 'observation')
    or p_delivery_kind not in ('booking', 'reminder')
    or (p_delivery_kind = 'reminder' and p_service_date is null) then
    raise exception 'registration_customer_message_bundle_input_invalid' using errcode = '22023';
  end if;

  with candidates as (
    select appointment.id as source_id, 'level_test'::text as source_kind,
      pg_catalog.jsonb_build_object('appointmentNotificationRevision', appointment.notification_revision) as source_revision,
      level_test.track_id, level_test.id as activity_id, track.subject, appointment.scheduled_at,
      (appointment.scheduled_at at time zone 'Asia/Seoul')::date as service_date, appointment.place,
      null::text as class_name, null::text as teacher_name
    from public.ops_registration_appointments appointment
    join public.ops_registration_level_tests level_test on level_test.appointment_id = appointment.id
    join public.ops_registration_subject_tracks track on track.id = level_test.track_id
    where p_reservation_kind = 'level_test' and appointment.task_id = p_task_id
      and appointment.kind = 'level_test' and appointment.status = 'scheduled'
      and level_test.status = 'scheduled' and appointment.scheduled_at > p_now
    union all
    select appointment.id, 'visit_consultation'::text,
      pg_catalog.jsonb_build_object('appointmentNotificationRevision', appointment.notification_revision),
      consultation.track_id, consultation.id, track.subject, appointment.scheduled_at,
      (appointment.scheduled_at at time zone 'Asia/Seoul')::date, appointment.place,
      null::text, null::text
    from public.ops_registration_appointments appointment
    join public.ops_registration_consultations consultation on consultation.appointment_id = appointment.id
    join public.ops_registration_subject_tracks track on track.id = consultation.track_id
    where p_reservation_kind = 'visit_consultation' and appointment.task_id = p_task_id
      and appointment.kind = 'visit_consultation' and appointment.status = 'scheduled'
      and consultation.mode = 'visit' and consultation.status = 'scheduled' and appointment.scheduled_at > p_now
    union all
    select observation.id, 'observation'::text,
      pg_catalog.jsonb_build_object('appointmentNotificationRevision', appointment.notification_revision, 'observationRevision', observation.revision, 'bookingFactHash', observation.booking_fact_hash),
      observation.track_id, null::uuid, observation.subject, observation.starts_at, observation.session_date,
      observation.campus, observation.class_name_snapshot, observation.teacher_name_snapshot
    from public.ops_registration_observations observation
    join public.ops_registration_appointments appointment on appointment.id = observation.appointment_id
    where p_reservation_kind = 'observation' and observation.task_id = p_task_id
      and observation.status = 'scheduled' and observation.starts_at > p_now
  ), filtered as (
    select * from candidates
    where p_delivery_kind = 'booking' or service_date = p_service_date
  ), ordered as (
    select * from filtered order by scheduled_at, array_position(array['영어', '수학', '과학'], subject), source_id
  )
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'sourceKind', source_kind, 'sourceId', source_id, 'sourceRevision', source_revision,
      'trackId', track_id, 'activityId', activity_id, 'subject', subject, 'scheduledAt', scheduled_at,
      'serviceDate', service_date, 'place', place, 'className', class_name, 'teacherName', teacher_name,
      'sourceFactHash', pg_catalog.encode(extensions.digest(pg_catalog.jsonb_build_object(
        'sourceKind', source_kind, 'sourceId', source_id, 'sourceRevision', source_revision, 'trackId', track_id,
        'activityId', activity_id, 'subject', subject, 'scheduledAt', scheduled_at, 'serviceDate', service_date,
        'place', place, 'className', class_name, 'teacherName', teacher_name
      )::text, 'sha256'), 'hex')
    )), pg_catalog.count(*), pg_catalog.count(distinct subject)
  into v_items, v_count, v_subject_count
  from ordered;

  if pg_catalog.coalesce(v_count, 0) = 0 or v_count > 3 then
    raise exception 'registration_customer_message_bundle_source_ineligible' using errcode = '22023';
  end if;
  if v_subject_count <> v_count then
    raise exception 'registration_customer_message_bundle_source_ambiguous' using errcode = '22023';
  end if;
  return v_items;
end;
$$;

alter function dashboard_private.collect_registration_customer_message_bundle_items_v1(uuid, text, text, date, timestamptz) owner to postgres;
revoke all on function dashboard_private.collect_registration_customer_message_bundle_items_v1(uuid, text, text, date, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.materialize_registration_customer_message_bundle_v1(
  p_task_id uuid, p_reservation_kind text, p_delivery_kind text, p_service_date date, p_now timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_items jsonb;
  v_recipient_revision bigint;
  v_fingerprint text;
  v_run_id uuid;
  v_bundle_id uuid;
begin
  if p_delivery_kind = 'reminder' and p_service_date is null then
    raise exception 'registration_customer_message_bundle_input_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_task_id::text || ':' || p_reservation_kind || ':' || p_delivery_kind || ':' || pg_catalog.coalesce(p_service_date::text, ''), 0
  ));
  v_items := dashboard_private.collect_registration_customer_message_bundle_items_v1(
    p_task_id, p_reservation_kind, p_delivery_kind, p_service_date, p_now
  );
  select detail.customer_message_recipient_revision into strict v_recipient_revision
  from public.ops_registration_details detail where detail.task_id = p_task_id;
  v_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.jsonb_build_object('items', v_items, 'recipientRevision', v_recipient_revision)::text, 'sha256'
  ), 'hex');

  select bundle.id into v_bundle_id
  from dashboard_private.registration_customer_message_bundles bundle
  where bundle.task_id = p_task_id and bundle.reservation_kind = p_reservation_kind
    and bundle.delivery_kind = p_delivery_kind
    and ((p_delivery_kind = 'booking' and bundle.source_fingerprint = v_fingerprint)
      or (p_delivery_kind = 'reminder' and bundle.service_date = p_service_date))
    and bundle.status in ('pending', 'claimed', 'dispatching', 'accepted', 'unknown', 'failed_hold')
  order by bundle.bundle_revision desc limit 1;
  if v_bundle_id is not null then return v_bundle_id; end if;

  if p_delivery_kind = 'reminder' then
    insert into dashboard_private.registration_customer_message_bundle_runs(
      service_date, scheduled_for, started_at, status
    ) values (
      p_service_date,
      (p_service_date + time '10:00') at time zone 'Asia/Seoul',
      p_now,
      'producing'
    ) on conflict (service_date) do update set updated_at = pg_catalog.clock_timestamp()
    returning id into v_run_id;
  end if;

  insert into dashboard_private.registration_customer_message_bundles(
    run_id, task_id, reservation_kind, delivery_kind, service_date, recipient_revision,
    source_fingerprint, scheduled_for
  ) values (
    v_run_id, p_task_id, p_reservation_kind, p_delivery_kind, p_service_date, v_recipient_revision,
    v_fingerprint,
    case when p_delivery_kind = 'reminder' then (p_service_date + time '10:00') at time zone 'Asia/Seoul' else null end
  ) returning id into v_bundle_id;

  insert into dashboard_private.registration_customer_message_bundle_items(
    bundle_id, sort_order, source_kind, source_id, source_revision, track_id, activity_id,
    subject, scheduled_at, service_date, place, class_name, teacher_name, source_fact_hash
  )
  select v_bundle_id, item.ordinality::smallint, item.value ->> 'sourceKind', (item.value ->> 'sourceId')::uuid,
    item.value -> 'sourceRevision', (item.value ->> 'trackId')::uuid, nullif(item.value ->> 'activityId', '')::uuid,
    item.value ->> 'subject', (item.value ->> 'scheduledAt')::timestamptz, (item.value ->> 'serviceDate')::date,
    item.value ->> 'place', nullif(item.value ->> 'className', ''), nullif(item.value ->> 'teacherName', ''), item.value ->> 'sourceFactHash'
  from pg_catalog.jsonb_array_elements(v_items) with ordinality as item(value, ordinality);
  return v_bundle_id;
end;
$$;

revoke all on function dashboard_private.materialize_registration_customer_message_bundle_v1(uuid, text, text, date, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.resolve_registration_customer_message_bundle_source_v1(
  p_message_kind text,
  p_task_id uuid,
  p_service_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation_kind text;
  v_delivery_kind text;
  v_bundle_id uuid;
  v_bundle dashboard_private.registration_customer_message_bundles%rowtype;
  v_detail public.ops_registration_details%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'registration_customer_message_bundle_service_role_required' using errcode = '42501';
  end if;
  select case p_message_kind
    when 'level_test_booking_bundle' then 'level_test'
    when 'visit_consultation_booking_bundle' then 'visit_consultation'
    when 'observation_booking_bundle' then 'observation'
    when 'level_test_reminder_bundle' then 'level_test'
    when 'visit_consultation_reminder_bundle' then 'visit_consultation'
    when 'observation_reminder_bundle' then 'observation'
  end,
  case when p_message_kind like '%_reminder_bundle' then 'reminder' else 'booking' end
  into v_reservation_kind, v_delivery_kind;
  if v_reservation_kind is null or (v_delivery_kind = 'reminder' and p_service_date is null) then
    raise exception 'registration_customer_message_bundle_kind_invalid' using errcode = '22023';
  end if;

  v_bundle_id := dashboard_private.materialize_registration_customer_message_bundle_v1(
    p_task_id, v_reservation_kind, v_delivery_kind, p_service_date, pg_catalog.clock_timestamp()
  );
  select * into strict v_bundle from dashboard_private.registration_customer_message_bundles where id = v_bundle_id;
  select * into strict v_detail from public.ops_registration_details where task_id = p_task_id;

  return pg_catalog.jsonb_build_object(
    'messageKind', p_message_kind, 'sourceId', p_task_id, 'bundleId', v_bundle.id,
    'bundleRevision', v_bundle.bundle_revision, 'taskId', v_bundle.task_id,
    'reservationKind', v_bundle.reservation_kind, 'deliveryKind', v_bundle.delivery_kind,
    'serviceDate', v_bundle.service_date, 'recipientRevision', v_bundle.recipient_revision,
    'sourceFingerprint', v_bundle.source_fingerprint,
    'studentName', (select task.student_name from public.ops_tasks task where task.id = p_task_id),
    'parentPhoneDigits', pg_catalog.regexp_replace(pg_catalog.coalesce(v_detail.parent_phone, ''), '[^0-9]', '', 'g'),
    'items', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'sourceKind', item.source_kind, 'sourceId', item.source_id, 'sourceRevision', item.source_revision,
      'trackId', item.track_id, 'activityId', item.activity_id, 'subject', item.subject,
      'scheduledAt', item.scheduled_at, 'serviceDate', item.service_date, 'place', item.place,
      'className', item.class_name, 'teacherName', item.teacher_name, 'sourceFactHash', item.source_fact_hash
    ) order by item.sort_order) from dashboard_private.registration_customer_message_bundle_items item where item.bundle_id = v_bundle.id)
  );
end;
$$;

alter function public.resolve_registration_customer_message_bundle_source_v1(text, uuid, date) owner to postgres;
revoke all on function public.resolve_registration_customer_message_bundle_source_v1(text, uuid, date)
  from public, anon, authenticated;
grant execute on function public.resolve_registration_customer_message_bundle_source_v1(text, uuid, date) to service_role;

create or replace function public.get_registration_customer_message_bundle_runtime_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_runtime dashboard_private.registration_customer_message_bundle_runtime%rowtype;
  v_is_staff boolean;
begin
  if auth.role() = 'service_role' then
    v_is_staff := true;
  else
    select profile.role in ('admin', 'staff') into v_is_staff
    from public.profiles profile where profile.id = auth.uid();
  end if;
  if pg_catalog.coalesce(v_is_staff, false) is not true then
    raise exception 'registration_customer_message_bundle_runtime_forbidden' using errcode = '42501';
  end if;
  select * into strict v_runtime from dashboard_private.registration_customer_message_bundle_runtime where singleton;
  return pg_catalog.jsonb_build_object(
    'installedVersion', v_runtime.installed_version,
    'activeVersion', v_runtime.active_version
  );
end;
$$;

alter function public.get_registration_customer_message_bundle_runtime_v1() owner to postgres;
revoke all on function public.get_registration_customer_message_bundle_runtime_v1() from public, anon;
grant execute on function public.get_registration_customer_message_bundle_runtime_v1() to authenticated, service_role;

alter table dashboard_private.registration_customer_message_bundle_runtime enable row level security;
alter table dashboard_private.registration_customer_message_bundle_runs enable row level security;
alter table dashboard_private.registration_customer_message_bundles enable row level security;
alter table dashboard_private.registration_customer_message_bundle_items enable row level security;

revoke all on table dashboard_private.registration_customer_message_bundle_runtime from public, anon, authenticated, service_role;
revoke all on table dashboard_private.registration_customer_message_bundle_runs from public, anon, authenticated, service_role;
revoke all on table dashboard_private.registration_customer_message_bundles from public, anon, authenticated, service_role;
revoke all on table dashboard_private.registration_customer_message_bundle_items from public, anon, authenticated, service_role;

alter table dashboard_private.registration_customer_solapi_activation
  drop constraint registration_customer_solapi_activation_message_kind_check,
  add constraint registration_customer_solapi_activation_message_kind_check
  check (message_kind in (
    'level_test_booking', 'visit_consultation_booking', 'appointment_reminder', 'waiting_notice',
    'admission_application', 'observation_booking', 'observation_reminder',
    'level_test_booking_bundle', 'visit_consultation_booking_bundle', 'observation_booking_bundle',
    'level_test_reminder_bundle', 'visit_consultation_reminder_bundle', 'observation_reminder_bundle'
  ));

insert into dashboard_private.registration_customer_solapi_activation(message_kind, mode) values
  ('level_test_booking_bundle', 'off'),
  ('visit_consultation_booking_bundle', 'off'),
  ('observation_booking_bundle', 'off'),
  ('level_test_reminder_bundle', 'off'),
  ('visit_consultation_reminder_bundle', 'off'),
  ('observation_reminder_bundle', 'off')
on conflict (message_kind) do nothing;

alter table dashboard_private.registration_customer_solapi_template_receipts
  drop constraint registration_customer_solapi_template_receipts_kind_check_v2,
  add constraint registration_customer_solapi_template_receipts_kind_check_v3 check (message_kind in (
    'level_test_booking', 'visit_consultation_booking', 'appointment_reminder', 'waiting_notice',
    'admission_application', 'observation_booking', 'observation_reminder',
    'level_test_booking_bundle', 'visit_consultation_booking_bundle', 'observation_booking_bundle',
    'level_test_reminder_bundle', 'visit_consultation_reminder_bundle', 'observation_reminder_bundle'
  ));

create or replace function dashboard_private.registration_customer_solapi_assert_kind_v1(p_message_kind text)
returns void language plpgsql immutable security invoker set search_path = '' as $$
begin
  if p_message_kind is null or p_message_kind not in (
    'level_test_booking', 'visit_consultation_booking', 'appointment_reminder', 'waiting_notice',
    'admission_application', 'observation_booking', 'observation_reminder',
    'level_test_booking_bundle', 'visit_consultation_booking_bundle', 'observation_booking_bundle',
    'level_test_reminder_bundle', 'visit_consultation_reminder_bundle', 'observation_reminder_bundle'
  ) then
    raise exception 'registration_customer_solapi_kind_invalid' using errcode = '22023';
  end if;
end;
$$;
alter function dashboard_private.registration_customer_solapi_assert_kind_v1(text) owner to postgres;
revoke all on function dashboard_private.registration_customer_solapi_assert_kind_v1(text)
  from public, anon, authenticated, service_role;

alter table public.ops_registration_customer_message_previews
  add column bundle_id uuid references dashboard_private.registration_customer_message_bundles(id) on delete restrict;
alter table public.ops_registration_customer_messages
  add column bundle_id uuid references dashboard_private.registration_customer_message_bundles(id) on delete restrict;

alter table public.ops_registration_customer_message_previews
  drop constraint ops_registration_customer_message_previews_message_kind_check,
  drop constraint ops_registration_customer_message_previews_source_shape_check,
  add constraint ops_registration_customer_message_previews_message_kind_check check (message_kind in (
    'level_test_booking', 'visit_consultation_booking', 'appointment_reminder', 'waiting_notice',
    'admission_application', 'observation_booking', 'observation_reminder',
    'level_test_booking_bundle', 'visit_consultation_booking_bundle', 'observation_booking_bundle',
    'level_test_reminder_bundle', 'visit_consultation_reminder_bundle', 'observation_reminder_bundle'
  )),
  add constraint ops_registration_customer_message_previews_source_shape_check check (
    (message_kind in ('level_test_booking', 'visit_consultation_booking', 'appointment_reminder') and bundle_id is null and observation_id is null and appointment_id is not null and track_id is null)
    or (message_kind = 'waiting_notice' and bundle_id is null and observation_id is null and track_id is not null and appointment_id is null)
    or (message_kind = 'admission_application' and bundle_id is null and observation_id is null and track_id is null and appointment_id is null)
    or (message_kind in ('observation_booking', 'observation_reminder') and bundle_id is null and observation_id is not null and appointment_id is not null and track_id is not null and source_revision is not null)
    or (message_kind in ('level_test_booking_bundle', 'visit_consultation_booking_bundle', 'observation_booking_bundle', 'level_test_reminder_bundle', 'visit_consultation_reminder_bundle', 'observation_reminder_bundle') and bundle_id is not null and observation_id is null and appointment_id is null and track_id is null)
  );

alter table public.ops_registration_customer_messages
  drop constraint ops_registration_customer_messages_message_kind_check,
  drop constraint ops_registration_customer_messages_source_shape_check,
  add constraint ops_registration_customer_messages_message_kind_check check (message_kind in (
    'level_test_booking', 'visit_consultation_booking', 'appointment_reminder', 'waiting_notice',
    'admission_application', 'observation_booking', 'observation_reminder',
    'level_test_booking_bundle', 'visit_consultation_booking_bundle', 'observation_booking_bundle',
    'level_test_reminder_bundle', 'visit_consultation_reminder_bundle', 'observation_reminder_bundle'
  )),
  add constraint ops_registration_customer_messages_source_shape_check check (
    (message_kind in ('level_test_booking', 'visit_consultation_booking', 'appointment_reminder') and bundle_id is null and observation_id is null and appointment_id is not null and track_id is null)
    or (message_kind = 'waiting_notice' and bundle_id is null and observation_id is null and track_id is not null and appointment_id is null)
    or (message_kind = 'admission_application' and bundle_id is null and observation_id is null and track_id is null and appointment_id is null)
    or (message_kind in ('observation_booking', 'observation_reminder') and bundle_id is null and observation_id is not null and appointment_id is not null and track_id is not null and source_revision is not null)
    or (message_kind in ('level_test_booking_bundle', 'visit_consultation_booking_bundle', 'observation_booking_bundle', 'level_test_reminder_bundle', 'visit_consultation_reminder_bundle', 'observation_reminder_bundle') and bundle_id is not null and observation_id is null and appointment_id is null and track_id is null)
  );

create unique index ops_reg_customer_msg_booking_bundle_once_idx
  on public.ops_registration_customer_messages(bundle_id, message_kind, source_fingerprint)
  where message_kind in ('level_test_booking_bundle', 'visit_consultation_booking_bundle', 'observation_booking_bundle');

commit;
