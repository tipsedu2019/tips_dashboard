begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

lock table public.profiles in share row exclusive mode;
lock table public.classes in share row exclusive mode;
lock table public.class_lesson_sessions in share row exclusive mode;
lock table public.teacher_catalogs in share row exclusive mode;
lock table public.classroom_catalogs in share row exclusive mode;
lock table public.ops_tasks in share row exclusive mode;
lock table public.ops_registration_subject_tracks in share row exclusive mode;
lock table public.ops_registration_appointments in share row exclusive mode;

alter table public.ops_registration_subject_tracks
  add column observation_return_workflow_status text,
  add column observation_attempt_count bigint not null default 0;

alter table public.ops_registration_subject_tracks
  drop constraint if exists ops_registration_subject_tracks_workflow_status_check,
  add constraint ops_registration_subject_tracks_workflow_status_check check (
    workflow_status in (
      'inquiry',
      'level_test_requested',
      'consultation_requested',
      'consultation_completed',
      'observation_requested',
      'observation_feedback_pending',
      'observation_completed',
      'waiting_current_class',
      'waiting_new_class',
      'waiting_next_opening',
      'enrollment_requested',
      'payment_in_progress',
      'registered',
      'not_registered',
      'inquiry_only'
    )
  ),
  add constraint ops_registration_subject_tracks_observation_return_workflow_status_check
    check (
      observation_return_workflow_status is null
      or observation_return_workflow_status in (
        'consultation_completed',
        'waiting_current_class',
        'waiting_new_class',
        'waiting_next_opening'
      )
    ),
  add constraint ops_registration_subject_tracks_observation_return_workflow_pair_check
    check (
      (workflow_status in (
        'observation_requested',
        'observation_feedback_pending',
        'observation_completed'
      )) = (observation_return_workflow_status is not null)
    ),
  add constraint ops_registration_subject_tracks_observation_attempt_count_check
    check (observation_attempt_count >= 0);

alter table public.ops_registration_appointments
  drop constraint if exists ops_registration_appointments_kind_check,
  add constraint ops_registration_appointments_kind_check
    check (kind in ('level_test', 'visit_consultation', 'observation_class'));

alter table public.classroom_catalogs
  add column campus text,
  add constraint classroom_catalogs_campus_check
    check (campus is null or campus in ('본관', '별관'));

create table dashboard_private.registration_observation_runtime_settings (
  singleton boolean primary key default true check (singleton),
  activation_version integer not null default 0 check (activation_version in (0, 1)),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

insert into dashboard_private.registration_observation_runtime_settings(
  singleton,
  activation_version
)
values (true, 0);

create table public.ops_registration_observations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  track_id uuid not null references public.ops_registration_subject_tracks(id) on delete cascade,
  appointment_id uuid not null unique references public.ops_registration_appointments(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete restrict,
  session_authority text not null,
  class_lesson_session_id uuid references public.class_lesson_sessions(id) on delete restrict,
  legacy_session_key text,
  session_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  session_schedule_state text not null,
  session_source_revision bigint,
  legacy_session_source_hash text,
  source_revision jsonb not null,
  booking_fact_hash text not null,
  teacher_catalog_id uuid not null references public.teacher_catalogs(id) on delete restrict,
  teacher_profile_id uuid not null references public.profiles(id) on delete restrict,
  classroom_catalog_id uuid not null references public.classroom_catalogs(id) on delete restrict,
  subject text not null,
  class_name_snapshot text not null,
  teacher_name_snapshot text not null,
  classroom_name_snapshot text not null,
  campus text not null,
  textbook_snapshot jsonb not null default '[]'::jsonb,
  progress_snapshot text not null default '',
  status text not null default 'scheduled',
  attendance text,
  attendance_recorded_by uuid references public.profiles(id) on delete set null,
  attendance_recorded_at timestamptz,
  suitability_result text,
  feedback_reason text,
  feedback_submitted_by uuid references public.profiles(id) on delete set null,
  feedback_submitted_at timestamptz,
  feedback_revision bigint not null default 0,
  decision_kind text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  revision bigint not null default 1,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_registration_observations_session_authority_check
    check (session_authority in ('normalized', 'legacy')),
  constraint ops_registration_observations_session_source_columns_check
    check (
      (
        session_authority = 'normalized'
        and class_lesson_session_id is not null
        and session_source_revision is not null
        and legacy_session_key is null
        and legacy_session_source_hash is null
      )
      or
      (
        session_authority = 'legacy'
        and class_lesson_session_id is null
        and session_source_revision is null
        and nullif(pg_catalog.btrim(legacy_session_key), '') is not null
        and nullif(pg_catalog.btrim(legacy_session_source_hash), '') is not null
      )
    ),
  constraint ops_registration_observations_source_revision_shape_check
    check (
      (
        source_revision = pg_catalog.jsonb_build_object(
          'authority', 'normalized',
          'sessionId', source_revision ->> 'sessionId',
          'revision', (source_revision ->> 'revision')::bigint
        )
        and source_revision ->> 'authority' = 'normalized'
        and (source_revision ->> 'sessionId')::uuid is not null
        and pg_catalog.jsonb_typeof(source_revision -> 'revision') = 'number'
        and (source_revision ->> 'revision')::bigint >= 0
      )
      or
      (
        source_revision = pg_catalog.jsonb_build_object(
          'authority', 'legacy',
          'sessionKey', source_revision ->> 'sessionKey',
          'contentHash', source_revision ->> 'contentHash'
        )
        and source_revision ->> 'authority' = 'legacy'
        and nullif(pg_catalog.btrim(source_revision ->> 'sessionKey'), '') is not null
        and nullif(pg_catalog.btrim(source_revision ->> 'contentHash'), '') is not null
      )
    ),
  constraint ops_registration_observations_source_revision_columns_check
    check (
      (
        session_authority = 'normalized'
        and source_revision ->> 'authority' = 'normalized'
        and source_revision ->> 'sessionId' = class_lesson_session_id::text
        and (source_revision ->> 'revision')::bigint = session_source_revision
      )
      or
      (
        session_authority = 'legacy'
        and source_revision ->> 'authority' = 'legacy'
        and source_revision ->> 'sessionKey' = legacy_session_key
        and source_revision ->> 'contentHash' = legacy_session_source_hash
      )
    ),
  constraint ops_registration_observations_time_order_check
    check (starts_at < ends_at),
  constraint ops_registration_observations_schedule_state_check
    check (nullif(pg_catalog.btrim(session_schedule_state), '') is not null),
  constraint ops_registration_observations_status_check
    check (status in (
      'scheduled',
      'attended_feedback_pending',
      'completed',
      'no_show',
      'canceled'
    )),
  constraint ops_registration_observations_attendance_check
    check (attendance is null or attendance in ('attended', 'no_show')),
  constraint ops_registration_observations_attendance_actor_check
    check (
      (
        attendance is null
        and attendance_recorded_by is null
        and attendance_recorded_at is null
      )
      or
      (
        attendance is not null
        and attendance_recorded_by is not null
        and attendance_recorded_at is not null
      )
    ),
  constraint ops_registration_observations_status_facts_check
    check (
      (
        status = 'scheduled'
        and attendance is null
        and suitability_result is null
        and feedback_reason is null
        and feedback_submitted_by is null
        and feedback_submitted_at is null
      )
      or
      (
        status = 'attended_feedback_pending'
        and attendance is not null
        and attendance = 'attended'
        and suitability_result is null
        and feedback_reason is null
        and feedback_submitted_by is null
        and feedback_submitted_at is null
      )
      or
      (
        status = 'completed'
        and attendance is not null
        and attendance = 'attended'
        and suitability_result is not null
        and suitability_result in ('fit', 'unfit')
        and nullif(pg_catalog.btrim(feedback_reason), '') is not null
        and feedback_submitted_by is not null
        and feedback_submitted_at is not null
      )
      or
      (
        status = 'no_show'
        and attendance is not null
        and attendance = 'no_show'
        and suitability_result is null
        and feedback_reason is null
        and feedback_submitted_by is null
        and feedback_submitted_at is null
      )
      or
      (
        status = 'canceled'
        and attendance is null
        and suitability_result is null
        and feedback_reason is null
        and feedback_submitted_by is null
        and feedback_submitted_at is null
      )
    ),
  constraint ops_registration_observations_decision_kind_check
    check (
      decision_kind is null
      or decision_kind in (
        'enrollment',
        'waiting_current_class',
        'waiting_new_class',
        'waiting_next_opening',
        'not_registered',
        're_observation'
      )
    ),
  constraint ops_registration_observations_decision_actor_check
    check (
      (
        decision_kind is null
        and decided_by is null
        and decided_at is null
      )
      or
      (
        decision_kind is not null
        and decided_by is not null
        and decided_at is not null
      )
    ),
  constraint ops_registration_observations_revisions_check
    check (
      revision > 0
      and feedback_revision >= 0
      and (session_source_revision is null or session_source_revision >= 0)
    ),
  constraint ops_registration_observations_text_facts_check
    check (
      nullif(pg_catalog.btrim(subject), '') is not null
      and nullif(pg_catalog.btrim(class_name_snapshot), '') is not null
      and nullif(pg_catalog.btrim(teacher_name_snapshot), '') is not null
      and nullif(pg_catalog.btrim(classroom_name_snapshot), '') is not null
      and nullif(pg_catalog.btrim(booking_fact_hash), '') is not null
      and campus in ('본관', '별관')
    ),
  constraint ops_registration_observations_textbook_snapshot_check
    check (pg_catalog.jsonb_typeof(textbook_snapshot) = 'array')
);

create unique index ops_registration_observations_open_track_key
  on public.ops_registration_observations(track_id)
  where decision_kind is null
    and status in ('scheduled', 'attended_feedback_pending', 'completed', 'no_show');
create index ops_registration_observations_track_decision_status_idx
  on public.ops_registration_observations(track_id, decision_kind, status, created_at desc, id desc);
create index ops_registration_observations_teacher_status_idx
  on public.ops_registration_observations(teacher_profile_id, status, starts_at, id);
create index ops_registration_observations_task_idx
  on public.ops_registration_observations(task_id);
create index ops_registration_observations_class_idx
  on public.ops_registration_observations(class_id);
create index ops_registration_observations_session_idx
  on public.ops_registration_observations(class_lesson_session_id)
  where class_lesson_session_id is not null;
create index ops_registration_observations_teacher_catalog_idx
  on public.ops_registration_observations(teacher_catalog_id);
create index ops_registration_observations_classroom_catalog_idx
  on public.ops_registration_observations(classroom_catalog_id);
create index ops_registration_observations_attendance_actor_idx
  on public.ops_registration_observations(attendance_recorded_by)
  where attendance_recorded_by is not null;
create index ops_registration_observations_feedback_actor_idx
  on public.ops_registration_observations(feedback_submitted_by)
  where feedback_submitted_by is not null;
create index ops_registration_observations_decision_actor_idx
  on public.ops_registration_observations(decided_by)
  where decided_by is not null;
create index ops_registration_observations_created_actor_idx
  on public.ops_registration_observations(created_by)
  where created_by is not null;
create index ops_registration_observations_updated_actor_idx
  on public.ops_registration_observations(updated_by)
  where updated_by is not null;

create table dashboard_private.registration_observation_mutation_requests (
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  operation text not null check (operation in (
    'activate',
    'enter',
    'book',
    'reschedule',
    'cancel',
    'withdraw',
    'record_attendance',
    'submit_feedback',
    'correct_feedback',
    'decide'
  )),
  request_key text not null check (pg_catalog.btrim(request_key) <> ''),
  track_id uuid references public.ops_registration_subject_tracks(id) on delete cascade,
  request_fingerprint text not null check (pg_catalog.btrim(request_fingerprint) <> ''),
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_profile_id, request_key),
  check ((operation = 'activate') = (track_id is null))
);

create index registration_observation_mutation_requests_track_created_idx
  on dashboard_private.registration_observation_mutation_requests(track_id, created_at desc);

create table dashboard_private.registration_observation_domain_events (
  event_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.ops_registration_observations(id) on delete restrict,
  appointment_id uuid not null references public.ops_registration_appointments(id) on delete restrict,
  notification_revision integer not null check (notification_revision > 0),
  event_kind text not null check (event_kind in (
    'observation_scheduled',
    'observation_rescheduled',
    'observation_canceled',
    'observation_attendance_recorded',
    'observation_no_show',
    'observation_feedback_submitted'
  )),
  booking_fact_hash text not null check (pg_catalog.btrim(booking_fact_hash) <> ''),
  source_revision jsonb not null,
  occurred_at timestamptz not null default now(),
  unique (observation_id, notification_revision, event_kind),
  constraint registration_observation_domain_events_source_revision_shape_check
    check (
      (
        source_revision = pg_catalog.jsonb_build_object(
          'authority', 'normalized',
          'sessionId', source_revision ->> 'sessionId',
          'revision', (source_revision ->> 'revision')::bigint
        )
        and source_revision ->> 'authority' = 'normalized'
        and (source_revision ->> 'sessionId')::uuid is not null
        and pg_catalog.jsonb_typeof(source_revision -> 'revision') = 'number'
        and (source_revision ->> 'revision')::bigint >= 0
      )
      or
      (
        source_revision = pg_catalog.jsonb_build_object(
          'authority', 'legacy',
          'sessionKey', source_revision ->> 'sessionKey',
          'contentHash', source_revision ->> 'contentHash'
        )
        and source_revision ->> 'authority' = 'legacy'
        and nullif(pg_catalog.btrim(source_revision ->> 'sessionKey'), '') is not null
        and nullif(pg_catalog.btrim(source_revision ->> 'contentHash'), '') is not null
      )
    )
);

create index registration_observation_domain_events_occurred_idx
  on dashboard_private.registration_observation_domain_events(occurred_at, event_id);
create index registration_observation_domain_events_observation_occurred_idx
  on dashboard_private.registration_observation_domain_events(observation_id, occurred_at, event_id);
create index registration_observation_domain_events_appointment_occurred_idx
  on dashboard_private.registration_observation_domain_events(appointment_id, occurred_at, event_id);

alter table public.ops_registration_observations enable row level security;

create or replace function dashboard_private.registration_observation_track_director_profile_id_matches_v1(
  p_track_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ops_registration_subject_tracks track
    join public.profiles profile
      on profile.id = (select auth.uid())
    join auth.users account
      on account.id = profile.id
    where track.id = p_track_id
      and track.director_profile_id = profile.id
      and account.deleted_at is null
      and (account.banned_until is null or account.banned_until <= pg_catalog.now())
  );
$$;

alter function dashboard_private.registration_observation_track_director_profile_id_matches_v1(uuid)
  owner to postgres;
revoke all on function dashboard_private.registration_observation_track_director_profile_id_matches_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.registration_observation_track_director_profile_id_matches_v1(uuid)
  to authenticated;

drop policy if exists ops_registration_observations_select on public.ops_registration_observations;
create policy ops_registration_observations_select
on public.ops_registration_observations
for select
to authenticated
using (
  (select public.current_dashboard_role()) in ('admin', 'staff')
  or dashboard_private.registration_observation_track_director_profile_id_matches_v1(
    track_id
  )
);

create or replace function dashboard_private.registration_observation_runtime_version_impl()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_version integer;
begin
  if v_actor is null
    or not exists (
      select 1
      from public.profiles profile
      join auth.users account on account.id = profile.id
      where profile.id = v_actor
        and account.deleted_at is null
        and (account.banned_until is null or account.banned_until <= pg_catalog.now())
    )
  then
    raise exception 'registration_observation_runtime_access_denied'
      using errcode = '42501';
  end if;

  select setting.activation_version
  into strict v_version
  from dashboard_private.registration_observation_runtime_settings setting
  where setting.singleton = true;
  return v_version;
end;
$$;

create or replace function dashboard_private.registration_observation_schema_readiness_v1_impl()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text;
  v_runtime_version integer;
  v_missing text[] := array[]::text[];
  v_token text;
  v_relation_name text;
  v_column_name text;
  v_helper_oid oid;
  v_helper_definition text;
begin
  select profile.role
  into v_role
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.id = v_actor
    and account.deleted_at is null
    and (account.banned_until is null or account.banned_until <= pg_catalog.now());
  if v_actor is null or v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'registration_observation_readiness_access_denied'
      using errcode = '42501';
  end if;

  v_runtime_version :=
    dashboard_private.registration_observation_runtime_version_impl();

  for v_token in
    select function_signature
    from pg_catalog.unnest(array[
      'public.list_registration_observation_sessions_v1(uuid,uuid,date,date)',
      'public.get_registration_observation_manager_detail_v1(uuid,integer)',
      'public.get_registration_observation_manager_attempt_v1(uuid,uuid)',
      'dashboard_private.registration_observation_legacy_session_content_hash_v1(jsonb,text)',
      'public.enter_registration_observation_v1(uuid,integer,text)',
      'public.save_registration_observation_booking_v1(uuid,uuid,uuid,text,uuid,text,integer,integer,bigint,text)',
      'public.cancel_registration_observation_v1(uuid,integer,bigint,text)',
      'public.withdraw_registration_observation_v1(uuid,text,text,uuid,integer,bigint,bigint,text,text)',
      'public.get_registration_observation_feedback_v1(uuid)',
      'public.record_registration_observation_attendance_v1(uuid,bigint,integer,text)',
      'public.submit_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,integer,text)',
      'public.correct_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,text,text)',
      'public.decide_registration_observation_v1(uuid,text,uuid,bigint,bigint,integer,text)',
      'dashboard_private.validate_registration_observation_class_start_source_v1(uuid,uuid,uuid,date,text,uuid)',
      'dashboard_private.normalize_registration_enrollment_rows_request_v1(jsonb)',
      'dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)',
      'dashboard_private.registration_appointment_track_ids_v1(uuid)'
    ]::text[]) function_signature
  loop
    if pg_catalog.to_regprocedure(v_token) is null then
      v_missing := pg_catalog.array_append(v_missing, v_token);
    end if;
  end loop;

  for v_token, v_relation_name in
    select item.token, item.relation_name
    from (values
      ('public.ops_registration_observations', 'public.ops_registration_observations'),
      ('dashboard_private.registration_observation_mutation_requests', 'dashboard_private.registration_observation_mutation_requests'),
      ('dashboard_private.registration_observation_domain_events', 'dashboard_private.registration_observation_domain_events'),
      ('dashboard_private.registration_observation_runtime_settings', 'dashboard_private.registration_observation_runtime_settings')
    ) item(token, relation_name)
  loop
    if pg_catalog.to_regclass(v_relation_name) is null then
      v_missing := pg_catalog.array_append(v_missing, v_token);
    end if;
  end loop;

  for v_token, v_relation_name, v_column_name in
    select item.token, item.relation_name, item.column_name
    from (values
      ('public.ops_registration_subject_track_summaries.observation_attempt_count', 'public.ops_registration_subject_track_summaries', 'observation_attempt_count'),
      ('public.ops_registration_enrollments.class_start_source_observation_id', 'public.ops_registration_enrollments', 'class_start_source_observation_id'),
      ('public.ops_registration_appointment_calendar.observation_id', 'public.ops_registration_appointment_calendar', 'observation_id'),
      ('public.ops_registration_appointment_calendar.observation_track_id', 'public.ops_registration_appointment_calendar', 'observation_track_id'),
      ('public.ops_registration_appointment_calendar.observation_class_id', 'public.ops_registration_appointment_calendar', 'observation_class_id'),
      ('public.ops_registration_appointment_calendar.observation_class_name', 'public.ops_registration_appointment_calendar', 'observation_class_name'),
      ('public.ops_registration_appointment_calendar.observation_ends_at', 'public.ops_registration_appointment_calendar', 'observation_ends_at'),
      ('public.ops_registration_appointment_calendar.observation_teacher_name', 'public.ops_registration_appointment_calendar', 'observation_teacher_name'),
      ('public.ops_registration_appointment_calendar.observation_classroom_name', 'public.ops_registration_appointment_calendar', 'observation_classroom_name')
    ) item(token, relation_name, column_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = pg_catalog.to_regclass(v_relation_name)
        and attribute.attname = v_column_name
        and attribute.attnum > 0
        and not attribute.attisdropped
    ) then
      v_missing := pg_catalog.array_append(v_missing, v_token);
    end if;
  end loop;

  v_helper_oid := pg_catalog.to_regprocedure(
    'dashboard_private.registration_appointment_track_ids_v1(uuid)'
  )::oid;
  if v_helper_oid is null then
    v_missing := pg_catalog.array_append(
      v_missing,
      'dashboard_private.registration_appointment_track_ids_v1(uuid)'
    );
  else
    v_helper_definition := pg_catalog.lower(
      pg_catalog.regexp_replace(
        pg_catalog.pg_get_functiondef(v_helper_oid),
        '[[:space:]]+',
        ' ',
        'g'
      )
    );
    if v_helper_definition not like '%ops_registration_level_tests%'
      or v_helper_definition not like '%ops_registration_consultations%'
      or v_helper_definition not like '%ops_registration_observations%'
      or v_helper_definition not like '%observation_class%'
    then
      v_missing := pg_catalog.array_append(
        v_missing,
        'dashboard_private.registration_appointment_track_ids_v1(uuid)'
      );
    end if;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    where relation.oid = pg_catalog.to_regclass(
      'public.ops_registration_appointment_calendar'
    )
      and coalesce(relation.reloptions, array[]::text[])
        @> array['security_invoker=true']::text[]
  ) then
    v_missing := pg_catalog.array_append(
      v_missing,
      'public.ops_registration_appointment_calendar.security_invoker'
    );
  end if;

  if exists (
    select 1
    from public.class_lesson_sessions lesson
    left join public.classroom_catalogs classroom
      on classroom.id = lesson.classroom_catalog_id
    where lesson.session_date >= current_date
      and lesson.schedule_state in ('active', 'makeup')
      and (
        lesson.classroom_catalog_id is null
        or classroom.id is null
        or classroom.campus is null
        or classroom.campus not in ('본관', '별관')
      )
  ) or exists (
    select 1
    from public.classes class
    join public.class_schedule_slots slot on slot.class_id = class.id
    left join public.classroom_catalogs classroom
      on classroom.id = slot.classroom_catalog_id
    where class.schedule_storage_mode in ('legacy', 'shadow')
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          case
            when pg_catalog.jsonb_typeof(class.schedule_plan -> 'sessions') = 'array'
              then class.schedule_plan -> 'sessions'
            when pg_catalog.jsonb_typeof(class.schedule_plan -> 'session_list') = 'array'
              then class.schedule_plan -> 'session_list'
            else '[]'::jsonb
          end
        ) session(value)
        where coalesce(
          session.value ->> 'date',
          session.value ->> 'sessionDate',
          session.value ->> 'session_date'
        ) >= pg_catalog.to_char(current_date, 'YYYY-MM-DD')
          and pg_catalog.lower(coalesce(
            nullif(pg_catalog.btrim(session.value ->> 'scheduleState'), ''),
            nullif(pg_catalog.btrim(session.value ->> 'schedule_state'), ''),
            nullif(pg_catalog.btrim(session.value ->> 'state'), ''),
            'active'
          )) in ('active', 'makeup', 'normal')
      )
      and (
        slot.classroom_catalog_id is null
        or classroom.id is null
        or classroom.campus is null
        or classroom.campus not in ('본관', '별관')
      )
  ) then
    v_missing := pg_catalog.array_append(
      v_missing,
      'classroom_catalogs.campus_backfill'
    );
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct missing_item order by missing_item),
    array[]::text[]
  )
  into v_missing
  from pg_catalog.unnest(v_missing) missing(missing_item);

  return pg_catalog.jsonb_build_object(
    'schemaReady', pg_catalog.cardinality(v_missing) = 0,
    'missingObjects', pg_catalog.to_jsonb(v_missing),
    'runtimeVersion', v_runtime_version
  );
end;
$$;

create or replace function dashboard_private.assert_registration_observation_runtime_v1()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (
    select setting.activation_version
    from dashboard_private.registration_observation_runtime_settings setting
    where setting.singleton = true
  ) is distinct from 1 then
    raise exception 'registration_observation_runtime_inactive'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function dashboard_private.activate_registration_observation_runtime_v1_impl(
  p_expected_current_version integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text;
  v_fingerprint text;
  v_existing dashboard_private.registration_observation_mutation_requests%rowtype;
  v_current_version integer;
  v_readiness jsonb;
  v_response jsonb;
begin
  select profile.role
  into v_role
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where profile.id = v_actor
    and account.deleted_at is null
    and (account.banned_until is null or account.banned_until <= pg_catalog.now());
  if v_actor is null or v_role is distinct from 'admin' then
    raise exception 'registration_observation_activation_access_denied'
      using errcode = '42501';
  end if;
  if p_expected_current_version is null
    or nullif(pg_catalog.btrim(p_request_key), '') is null
  then
    raise exception 'registration_observation_activation_invalid'
      using errcode = '22023';
  end if;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'expectedCurrentVersion', p_expected_current_version
  )::text;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-observation-activate:'
        || v_actor::text || ':' || p_request_key,
      0
    )
  );

  select request.*
  into v_existing
  from dashboard_private.registration_observation_mutation_requests request
  where request.actor_profile_id = v_actor
    and request.request_key = p_request_key;
  if found then
    if v_existing.operation <> 'activate'
      or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception 'registration_observation_request_conflict'
        using errcode = '23505';
    end if;
    return v_existing.response_payload;
  end if;

  select setting.activation_version
  into strict v_current_version
  from dashboard_private.registration_observation_runtime_settings setting
  where setting.singleton = true
  for update;

  if p_expected_current_version <> 0 or v_current_version <> 0 then
    raise exception 'registration_observation_runtime_transition_rejected'
      using errcode = '55000';
  end if;

  v_readiness :=
    dashboard_private.registration_observation_schema_readiness_v1_impl();
  if (v_readiness ->> 'schemaReady')::boolean is distinct from true
    or v_readiness -> 'missingObjects' <> '[]'::jsonb
    or (v_readiness ->> 'runtimeVersion')::integer <> 0
  then
    raise exception 'registration_observation_schema_not_ready'
      using errcode = '55000';
  end if;

  update dashboard_private.registration_observation_runtime_settings
  set activation_version = 1,
      updated_at = pg_catalog.now(),
      updated_by = v_actor
  where singleton = true;

  v_response := pg_catalog.jsonb_build_object(
    'operation', 'activate',
    'requestKey', p_request_key,
    'previousVersion', 0,
    'runtimeVersion', 1,
    'readiness', v_readiness
  );
  insert into dashboard_private.registration_observation_mutation_requests(
    actor_profile_id,
    operation,
    request_key,
    track_id,
    request_fingerprint,
    response_payload
  )
  values (
    v_actor,
    'activate',
    p_request_key,
    null,
    v_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function public.registration_observation_schema_readiness_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select dashboard_private.registration_observation_schema_readiness_v1_impl();
$$;

create or replace function public.registration_observation_runtime_version()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select dashboard_private.registration_observation_runtime_version_impl();
$$;

create or replace function public.activate_registration_observation_runtime_v1(
  p_expected_current_version integer,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.activate_registration_observation_runtime_v1_impl(
    p_expected_current_version,
    p_request_key
  );
$$;

revoke all on table public.ops_registration_observations
  from public, anon, authenticated, service_role;
grant select on table public.ops_registration_observations to authenticated;

revoke all on table dashboard_private.registration_observation_runtime_settings
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.registration_observation_mutation_requests
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.registration_observation_domain_events
  from public, anon, authenticated, service_role;

revoke all on function dashboard_private.registration_observation_schema_readiness_v1_impl()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_observation_runtime_version_impl()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.activate_registration_observation_runtime_v1_impl(integer, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_observation_runtime_v1()
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.registration_observation_schema_readiness_v1_impl()
  to authenticated;
grant execute on function dashboard_private.registration_observation_runtime_version_impl()
  to authenticated;
grant execute on function dashboard_private.activate_registration_observation_runtime_v1_impl(integer, text)
  to authenticated;
grant execute on function dashboard_private.assert_registration_observation_runtime_v1()
  to authenticated;

revoke all on function public.registration_observation_schema_readiness_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.registration_observation_runtime_version()
  from public, anon, authenticated, service_role;
revoke all on function public.activate_registration_observation_runtime_v1(integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.registration_observation_schema_readiness_v1()
  to authenticated;
grant execute on function public.registration_observation_runtime_version()
  to authenticated;
grant execute on function public.activate_registration_observation_runtime_v1(integer, text)
  to authenticated;

commit;
