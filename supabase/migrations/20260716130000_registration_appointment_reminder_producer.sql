begin;

set local lock_timeout = '5s';

do $$
declare
  v_runtime integer;
begin
  if pg_catalog.to_regprocedure(
    'public.common_notification_control_plane_runtime_version()'
  ) is null then
    raise exception 'registration_notification_common_runtime_missing';
  end if;
  execute 'select public.common_notification_control_plane_runtime_version()'
    into v_runtime;
  if v_runtime is distinct from 1 then
    raise exception 'registration_notification_common_runtime_mismatch';
  end if;
end;
$$;

alter table public.ops_registration_appointments
  add column if not exists recipient_revision bigint not null default 1;

alter table public.ops_registration_appointments
  drop constraint if exists ops_registration_appointments_recipient_revision_check;
alter table public.ops_registration_appointments
  add constraint ops_registration_appointments_recipient_revision_check
  check (recipient_revision > 0);

create table dashboard_private.registration_appointment_reminder_applicability (
  appointment_kind text not null,
  audience_key text not null,
  channel_key text not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (appointment_kind, audience_key, channel_key),
  constraint registration_appointment_reminder_applicability_kind_check
    check (appointment_kind in ('level_test', 'visit_consultation')),
  constraint registration_appointment_reminder_applicability_cell_check
    check (
      (appointment_kind = 'level_test'
        and audience_key = 'management_team'
        and channel_key in ('in_app', 'google_chat'))
      or
      (appointment_kind = 'visit_consultation'
        and (
          (audience_key = 'track_director' and channel_key = 'in_app')
          or (audience_key = 'management_team' and channel_key = 'google_chat')
        ))
    )
);

alter table dashboard_private.registration_appointment_reminder_applicability
  enable row level security;
revoke all on table dashboard_private.registration_appointment_reminder_applicability
  from public, anon, authenticated, service_role;

insert into dashboard_private.registration_appointment_reminder_applicability(
  appointment_kind,
  audience_key,
  channel_key
) values
  ('level_test', 'management_team', 'in_app'),
  ('level_test', 'management_team', 'google_chat'),
  ('visit_consultation', 'track_director', 'in_app'),
  ('visit_consultation', 'management_team', 'google_chat');

alter table dashboard_private.notification_settings_ui_registry
  drop constraint notification_settings_ui_registry_immediate_check;
alter table dashboard_private.notification_settings_ui_registry
  add constraint notification_settings_ui_registry_delivery_check
  check (
    (
      delivery_mode = 'immediate'
      and rule_variant_key = 'immediate'
      and schedule_key is null
      and schedule_config is null
    )
    or
    (
      delivery_mode = 'scheduled'
      and rule_variant_key = schedule_key
      and dashboard_private.notification_schedule_config_valid_v1(
        workflow_key,
        event_key,
        schedule_key,
        schedule_config
      )
    )
  );

alter function dashboard_private.notification_seed_template_payload_v1(uuid)
  rename to notification_seed_template_payload_without_registration_reminders_v1;

create function dashboard_private.notification_seed_template_payload_v1(
  p_rule_id uuid
)
returns table (
  title_template text,
  body_template text,
  allowed_variables jsonb,
  payload_schema_version integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from dashboard_private.notification_settings_ui_registry registry
    where registry.rule_id = p_rule_id
      and registry.workflow_key = 'registration'
      and registry.event_key = 'registration.appointment_reminder_due'
  ) then
    return query select
      '예약 알림 · {학생}'::text,
      E'{예약종류} 예약이 예정되어 있습니다.\n예약일시: {예약일시}\n장소: {장소}\n과목: {과목}'::text,
      '[
        {"key":"student_name","token":"학생","pii_class":"student_name"},
        {"key":"appointment_kind","token":"예약종류","pii_class":"none"},
        {"key":"scheduled_at","token":"예약일시","pii_class":"schedule"},
        {"key":"place","token":"장소","pii_class":"location"},
        {"key":"subjects","token":"과목","pii_class":"none"}
      ]'::jsonb,
      2;
    return;
  end if;

  return query
  select payload.*
  from dashboard_private.notification_seed_template_payload_without_registration_reminders_v1(
    p_rule_id
  ) payload;
end;
$$;

revoke all on function dashboard_private.notification_seed_template_payload_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_seed_template_payload_without_registration_reminders_v1(uuid)
  from public, anon, authenticated, service_role;

-- registration_reminder_seed_rows
with
variant_catalog(
  variant_key,
  variant_label,
  variant_sort,
  schedule_config
) as (
  values
    (
      'previous_day_at'::text,
      '예약 전날 14:00'::text,
      1,
      pg_catalog.jsonb_build_object(
        'anchor_key', 'appointment_scheduled_at',
        'local_time', '14:00',
        'timezone', 'Asia/Seoul'
      )
    ),
    (
      'same_day_at'::text,
      '예약 당일 14:00'::text,
      2,
      pg_catalog.jsonb_build_object(
        'anchor_key', 'appointment_scheduled_at',
        'local_time', '14:00',
        'timezone', 'Asia/Seoul'
      )
    ),
    (
      'offset_before'::text,
      '예약 1시간 전'::text,
      3,
      pg_catalog.jsonb_build_object(
        'anchor_key', 'appointment_scheduled_at',
        'lead_minutes', 60,
        'timezone', 'Asia/Seoul'
      )
    )
),
cell_catalog(
  audience_key,
  audience_label,
  channel_key,
  channel_label,
  cell_sort
) as (
  values
    ('management_team'::text, '관리팀'::text, 'in_app'::text, '대시보드'::text, 1),
    ('track_director'::text, '과목별 상담 책임자'::text, 'in_app'::text, '대시보드'::text, 2),
    ('management_team'::text, '관리팀'::text, 'google_chat'::text, '구글챗'::text, 3)
),
seed as (
  select
    dashboard_private.notification_deterministic_uuid_v1(
      'notification-rule-v1',
      pg_catalog.concat_ws(
        '|',
        'global',
        'registration',
        'registration.appointment_reminder_due',
        cell.audience_key,
        cell.channel_key,
        variant.variant_key
      )
    ) as rule_id,
    variant.variant_key,
    variant.variant_label,
    variant.variant_sort,
    variant.schedule_config,
    cell.audience_key,
    cell.audience_label,
    cell.channel_key,
    cell.channel_label,
    cell.cell_sort
  from variant_catalog variant
  cross join cell_catalog cell
)
insert into dashboard_private.notification_settings_ui_registry(
  rule_id,
  workflow_key,
  workflow_label,
  workflow_sort,
  event_key,
  event_label,
  group_label,
  trigger_description,
  event_sort,
  audience_key,
  audience_label,
  channel_key,
  channel_label,
  cell_sort,
  rule_variant_key,
  delivery_mode,
  schedule_key,
  schedule_config,
  initial_enabled,
  source_trigger_kind
)
select
  seed.rule_id,
  'registration',
  '등록',
  3,
  'registration.appointment_reminder_due',
  '예약 알림',
  '예약 알림',
  seed.variant_label,
  4,
  seed.audience_key,
  seed.audience_label,
  seed.channel_key,
  seed.channel_label,
  seed.variant_sort * 10 + seed.cell_sort,
  seed.variant_key,
  'scheduled',
  seed.variant_key,
  seed.schedule_config,
  false,
  null
from seed
order by seed.variant_sort, seed.cell_sort
on conflict do nothing;

with registry as (
  select registry.*
  from dashboard_private.notification_settings_ui_registry registry
  where registry.workflow_key = 'registration'
    and registry.event_key = 'registration.appointment_reminder_due'
)
insert into dashboard_private.notification_rules(
  id,
  scope_key,
  workflow_key,
  event_key,
  channel_key,
  audience_key,
  rule_variant_key,
  delivery_mode,
  schedule_key,
  schedule_config,
  enabled,
  active_template_id,
  revision,
  created_by,
  created_actor_kind,
  updated_by,
  updated_actor_kind
)
select
  registry.rule_id,
  'global',
  registry.workflow_key,
  registry.event_key,
  registry.channel_key,
  registry.audience_key,
  registry.rule_variant_key,
  registry.delivery_mode,
  registry.schedule_key,
  registry.schedule_config,
  false as enabled,
  dashboard_private.notification_deterministic_uuid_v1(
    'notification-template-v1',
    registry.rule_id::text || '|1'
  ),
  1,
  null,
  'system',
  null,
  'system'
from registry
order by registry.cell_sort, registry.rule_id
on conflict do nothing;

with registry as (
  select registry.*
  from dashboard_private.notification_settings_ui_registry registry
  where registry.workflow_key = 'registration'
    and registry.event_key = 'registration.appointment_reminder_due'
), template_payload as (
  select
    registry.rule_id,
    '예약 알림 · {학생}'::text as title_template,
    E'{예약종류} 예약이 예정되어 있습니다.\n예약일시: {예약일시}\n장소: {장소}\n과목: {과목}'::text
      as body_template,
    '[
      {"key":"student_name","token":"학생","pii_class":"student_name"},
      {"key":"appointment_kind","token":"예약종류","pii_class":"none"},
      {"key":"scheduled_at","token":"예약일시","pii_class":"schedule"},
      {"key":"place","token":"장소","pii_class":"location"},
      {"key":"subjects","token":"과목","pii_class":"none"}
    ]'::jsonb as allowed_variables,
    2 as payload_schema_version
  from registry
)
insert into dashboard_private.notification_templates(
  id,
  rule_id,
  version,
  title_template,
  body_template,
  allowed_variables,
  payload_schema_version,
  checksum,
  created_by,
  created_actor_kind
)
select
  dashboard_private.notification_deterministic_uuid_v1(
    'notification-template-v1',
    template_payload.rule_id::text || '|1'
  ),
  template_payload.rule_id,
  1,
  template_payload.title_template,
  template_payload.body_template,
  template_payload.allowed_variables,
  template_payload.payload_schema_version,
  dashboard_private.notification_seed_template_checksum_v1(
    template_payload.title_template,
    template_payload.body_template,
    template_payload.allowed_variables,
    template_payload.payload_schema_version
  ),
  null,
  'system'
from template_payload
order by template_payload.rule_id
on conflict do nothing;

do $$
begin
  if (
    select pg_catalog.count(*)
    from dashboard_private.notification_rules rule
    where rule.scope_key = 'global'
      and rule.workflow_key = 'registration'
      and rule.event_key = 'registration.appointment_reminder_due'
  ) <> 9 then
    raise exception 'registration_reminder_seed_count_invalid';
  end if;
  if exists (
    select 1
    from dashboard_private.notification_rules rule
    join dashboard_private.notification_settings_ui_registry registry
      on registry.rule_id = rule.id
    where rule.workflow_key = 'registration'
      and rule.event_key = 'registration.appointment_reminder_due'
      and (
        rule.enabled
        or registry.initial_enabled
        or rule.revision <> 1
        or rule.delivery_mode <> 'scheduled'
        or rule.rule_variant_key <> rule.schedule_key
        or rule.schedule_config <> registry.schedule_config
        or not dashboard_private.notification_schedule_config_valid_v1(
          rule.workflow_key,
          rule.event_key,
          rule.schedule_key,
          rule.schedule_config
        )
      )
  ) then
    raise exception 'registration_reminder_seed_contract_invalid';
  end if;
  if (
    select pg_catalog.count(*)
    from dashboard_private.notification_templates template
    join dashboard_private.notification_rules rule on rule.id = template.rule_id
    where rule.workflow_key = 'registration'
      and rule.event_key = 'registration.appointment_reminder_due'
      and template.version = 1
      and template.id = rule.active_template_id
  ) <> 9 then
    raise exception 'registration_reminder_template_seed_invalid';
  end if;
end;
$$;
-- registration_reminder_seed_complete

create or replace function dashboard_private.calculate_registration_reminder_schedule_v1(
  p_schedule_key text,
  p_schedule_config jsonb,
  p_scheduled_at timestamptz
)
returns timestamptz
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_local_scheduled_at timestamp;
  v_local_date date;
  v_local_time time;
  v_lead_minutes integer;
begin
  if p_scheduled_at is null then
    raise exception 'registration_reminder_scheduled_at_required' using errcode = '22023';
  end if;
  if not dashboard_private.notification_schedule_config_valid_v1(
    'registration',
    'registration.appointment_reminder_due',
    p_schedule_key,
    p_schedule_config
  ) then
    raise exception 'registration_reminder_schedule_config_invalid' using errcode = '22023';
  end if;

  v_local_scheduled_at := p_scheduled_at at time zone 'Asia/Seoul';
  v_local_date := v_local_scheduled_at::date;

  if p_schedule_key = 'offset_before' then
    v_lead_minutes := (p_schedule_config ->> 'lead_minutes')::integer;
    return p_scheduled_at - pg_catalog.make_interval(mins => v_lead_minutes);
  end if;

  v_local_time := (p_schedule_config ->> 'local_time')::time;
  if p_schedule_key = 'previous_day_at' then
    return ((v_local_date - 1) + v_local_time) at time zone 'Asia/Seoul';
  end if;
  if p_schedule_key = 'same_day_at' then
    return (v_local_date + v_local_time) at time zone 'Asia/Seoul';
  end if;
  raise exception 'registration_reminder_schedule_config_invalid' using errcode = '22023';
end;
$$;

-- KST proof matrix: 00:00, 00:30, 13:59, 14:00, 14:01, 23:59.
-- Calendar boundaries: 2027-01-01, leap day 2028-02-29, and 2028-03-01.

create or replace function dashboard_private.registration_appointment_reminder_applicable_v1(
  p_kind text,
  p_audience_key text,
  p_channel_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from dashboard_private.registration_appointment_reminder_applicability applicability
    where applicability.appointment_kind = p_kind
      and applicability.audience_key = p_audience_key
      and applicability.channel_key = p_channel_key
  );
$$;

create or replace function dashboard_private.assert_registration_reminder_access_v1()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.role in ('admin', 'staff')
  ) then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
end;
$$;

create or replace function dashboard_private.assert_registration_reminder_runtime_v1()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_common integer;
  v_registration integer;
begin
  if pg_catalog.to_regprocedure(
    'public.common_notification_control_plane_runtime_version()'
  ) is null then
    raise exception 'registration_notification_common_runtime_missing';
  end if;
  execute 'select public.common_notification_control_plane_runtime_version()'
    into v_common;
  if v_common is distinct from 1 then
    raise exception 'registration_notification_common_runtime_mismatch';
  end if;

  if pg_catalog.to_regprocedure(
    'public.registration_appointment_reminders_runtime_version()'
  ) is null then
    raise exception 'registration_appointment_reminders_runtime_missing';
  end if;
  execute 'select public.registration_appointment_reminders_runtime_version()'
    into v_registration;
  if v_registration is distinct from 1 then
    raise exception 'registration_appointment_reminders_runtime_mismatch';
  end if;
end;
$$;

create or replace function dashboard_private.registration_appointment_track_ids_v1(
  p_appointment_id uuid
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.array_agg(
      participant.track_id order by
        case track.subject when '영어' then 1 when '수학' then 2 else 3 end,
        participant.track_id
    ),
    array[]::uuid[]
  )
  from (
    select level_test.track_id
    from public.ops_registration_level_tests level_test
    where level_test.appointment_id = p_appointment_id
      and level_test.status in ('scheduled', 'in_progress')
    union
    select consultation.track_id
    from public.ops_registration_consultations consultation
    where consultation.appointment_id = p_appointment_id
      and consultation.mode = 'visit'
      and consultation.status = 'scheduled'
  ) participant
  join public.ops_registration_subject_tracks track on track.id = participant.track_id;
$$;

create or replace function dashboard_private.registration_appointment_director_targets_v1(
  p_appointment_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(target.item order by target.profile_id),
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'target_kind', 'audience',
        'target_key', 'audience:track_director',
        'target_profile_id', null,
        'connection_key', null,
        'target_snapshot', pg_catalog.jsonb_build_object(
          'audience_key', 'track_director'
        )
      )
    )
  )
  from (
    select distinct
      track.director_profile_id as profile_id,
      pg_catalog.jsonb_build_object(
        'target_kind', 'profile',
        'target_key', 'profile:' || track.director_profile_id::text,
        'target_profile_id', track.director_profile_id,
        'connection_key', null,
        'target_snapshot', pg_catalog.jsonb_build_object(
          'profile_id', track.director_profile_id
        )
      ) as item
    from pg_catalog.unnest(
      dashboard_private.registration_appointment_track_ids_v1(p_appointment_id)
    ) participant(track_id)
    join public.ops_registration_subject_tracks track on track.id = participant.track_id
    join public.profiles profile on profile.id = track.director_profile_id
    where track.director_profile_id is not null
      and dashboard_private.is_active_registration_director(track.director_profile_id)
      and dashboard_private.notification_profile_is_active_v1(track.director_profile_id)
  ) target;
$$;

create or replace function dashboard_private.registration_appointment_director_target_hash_v1(
  p_appointment_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select dashboard_private.notification_target_set_hash_v1(
    dashboard_private.registration_appointment_director_targets_v1(p_appointment_id)
  );
$$;

create or replace function dashboard_private.registration_appointment_rule_snapshot_v1(
  p_kind text,
  p_enabled_only boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'rule_id', rule.id,
        'rule_revision', rule.revision::text,
        'template_id', rule.active_template_id,
        'audience_key', rule.audience_key,
        'channel_key', rule.channel_key,
        'connection_key', case
          when rule.channel_key = 'google_chat' then 'google_chat.management'
          else null
        end,
        'rule_variant_key', rule.rule_variant_key,
        'schedule_key', rule.schedule_key,
        'schedule_config', rule.schedule_config,
        'enabled', rule.enabled
      ) order by
        case rule.rule_variant_key
          when 'previous_day_at' then 1
          when 'same_day_at' then 2
          when 'offset_before' then 3
          else 4
        end,
        rule.audience_key,
        rule.channel_key,
        rule.id
    ),
    '[]'::jsonb
  )
  from dashboard_private.notification_rules rule
  where rule.scope_key = 'global'
    and rule.workflow_key = 'registration'
    and rule.event_key = 'registration.appointment_reminder_due'
    and (not p_enabled_only or rule.enabled)
    and (
      p_kind is null
      or dashboard_private.registration_appointment_reminder_applicable_v1(
        p_kind,
        rule.audience_key,
        rule.channel_key
      )
    );
$$;

create or replace function dashboard_private.registration_appointment_source_snapshot_v1(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_appointment public.ops_registration_appointments%rowtype;
  v_track_ids uuid[];
  v_subjects text[];
  v_director_profile_ids uuid[];
  v_management_profile_ids uuid[];
  v_participants jsonb;
  v_student_name text;
begin
  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id;
  if not found then
    return null;
  end if;

  v_track_ids := dashboard_private.registration_appointment_track_ids_v1(
    p_appointment_id
  );
  select coalesce(
    pg_catalog.array_agg(
      track.subject order by
        case track.subject when '영어' then 1 when '수학' then 2 else 3 end,
        track.id
    ),
    array[]::text[]
  )
  into v_subjects
  from public.ops_registration_subject_tracks track
  where track.id = any(v_track_ids);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'track_id', track.id,
        'subject', track.subject,
        'director_profile_id', track.director_profile_id
      ) order by
        case track.subject when '영어' then 1 when '수학' then 2 else 3 end,
        track.id
    ),
    '[]'::jsonb
  )
  into v_participants
  from public.ops_registration_subject_tracks track
  where track.id = any(v_track_ids);

  select coalesce(
    pg_catalog.array_agg(distinct track.director_profile_id order by track.director_profile_id)
      filter (where track.director_profile_id is not null),
    array[]::uuid[]
  )
  into v_director_profile_ids
  from public.ops_registration_subject_tracks track
  join public.profiles profile on profile.id = track.director_profile_id
  where track.id = any(v_track_ids)
    and dashboard_private.is_active_registration_director(track.director_profile_id)
    and dashboard_private.notification_profile_is_active_v1(track.director_profile_id);

  select coalesce(
    pg_catalog.array_agg(profile.id order by profile.id),
    array[]::uuid[]
  )
  into v_management_profile_ids
  from public.profiles profile
  where profile.role in ('admin', 'staff')
    and dashboard_private.notification_profile_is_active_v1(profile.id);

  select task.student_name
  into v_student_name
  from public.ops_tasks task
  where task.id = v_appointment.task_id;

  return pg_catalog.jsonb_build_object(
    'appointment_id', v_appointment.id,
    'task_id', v_appointment.task_id,
    'student_name', coalesce(v_student_name, ''),
    'kind', v_appointment.kind,
    'scheduled_at', v_appointment.scheduled_at,
    'place', v_appointment.place,
    'status', v_appointment.status,
    'notification_revision', v_appointment.notification_revision,
    'recipient_revision', v_appointment.recipient_revision::text,
    'track_ids', pg_catalog.to_jsonb(v_track_ids),
    'subjects', pg_catalog.to_jsonb(v_subjects),
    'participants', v_participants,
    'director_profile_ids', pg_catalog.to_jsonb(v_director_profile_ids),
    'management_profile_ids', pg_catalog.to_jsonb(v_management_profile_ids),
    'current_rules', dashboard_private.registration_appointment_rule_snapshot_v1(
      v_appointment.kind,
      false
    )
  );
end;
$$;

create or replace function dashboard_private.materialize_registration_appointment_reminders_v1(
  p_appointment_id uuid,
  p_now timestamptz default pg_catalog.clock_timestamp()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_appointment public.ops_registration_appointments%rowtype;
  v_snapshot jsonb;
  v_rule dashboard_private.notification_rules%rowtype;
  v_scheduled_for timestamptz;
  v_occurrence_key text;
  v_payload jsonb;
  v_event_occurred_at timestamptz;
  v_event_payload jsonb;
  v_recorded jsonb;
  v_jobs jsonb := '[]'::jsonb;
begin
  if p_appointment_id is null or p_now is null then
    raise exception 'registration_reminder_materialization_invalid' using errcode = '22023';
  end if;
  perform dashboard_private.assert_registration_reminder_runtime_v1();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration:appointment:' || p_appointment_id::text, 0)
  );

  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id
  for update of appointment;
  if not found then
    raise exception 'registration_appointment_not_found' using errcode = 'P0002';
  end if;
  if v_appointment.status <> 'scheduled' then
    return '[]'::jsonb;
  end if;

  v_snapshot := dashboard_private.registration_appointment_source_snapshot_v1(
    p_appointment_id
  );
  v_payload := pg_catalog.jsonb_build_object(
    'actor_kind', 'system',
    'system_source', 'registration_reminder_materializer',
    'task', pg_catalog.jsonb_build_object(
      'id', v_appointment.task_id,
      'student_name', v_snapshot ->> 'student_name'
    ),
    'appointment', pg_catalog.jsonb_build_object(
      'kind', v_appointment.kind,
      'scheduled_at', pg_catalog.to_char(
        v_appointment.scheduled_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'place', v_appointment.place
    ),
    'track_ids', v_snapshot -> 'track_ids',
    'subjects', v_snapshot -> 'subjects'
  );

  for v_rule in
    select rule.*
    from dashboard_private.notification_rules rule
    where rule.scope_key = 'global'
      and rule.workflow_key = 'registration'
      and rule.event_key = 'registration.appointment_reminder_due'
      and rule.enabled
      and dashboard_private.registration_appointment_reminder_applicable_v1(
        v_appointment.kind,
        rule.audience_key,
        rule.channel_key
      )
    order by rule.id
    for share of rule
  loop
    v_scheduled_for := dashboard_private.calculate_registration_reminder_schedule_v1(
      v_rule.schedule_key,
      v_rule.schedule_config,
      v_appointment.scheduled_at
    );

    if v_scheduled_for >= v_appointment.scheduled_at then
      insert into dashboard_private.notification_audit_logs(
        scope_key,
        entity_kind,
        entity_id,
        action,
        actor_profile_id,
        actor_kind,
        before_summary,
        after_summary,
        reason_code
      )
      select
        'global',
        'registration_appointment',
        v_appointment.id::text,
        'reminder_rule_skipped',
        null,
        'system',
        null,
        pg_catalog.jsonb_build_object(
          'rule_id', v_rule.id,
          'rule_revision', v_rule.revision::text,
          'scheduled_for', v_scheduled_for
        ),
        'not_before_appointment'
      where not exists (
        select 1
        from dashboard_private.notification_audit_logs existing_audit
        where existing_audit.scope_key = 'global'
          and existing_audit.entity_kind = 'registration_appointment'
          and existing_audit.entity_id = v_appointment.id::text
          and existing_audit.action = 'reminder_rule_skipped'
          and existing_audit.actor_kind = 'system'
          and existing_audit.reason_code = 'not_before_appointment'
          and existing_audit.after_summary = pg_catalog.jsonb_build_object(
            'rule_id', v_rule.id,
            'rule_revision', v_rule.revision::text,
            'scheduled_for', v_scheduled_for
          )
      );
      continue;
    end if;

    if not (p_now < v_scheduled_for and v_scheduled_for < v_appointment.scheduled_at) then
      continue;
    end if;

    v_occurrence_key :=
      'registration:registration_appointment:' || v_appointment.id::text
      || ':source_revision:' || v_appointment.notification_revision::text
      || ':rule:' || v_rule.id::text
      || ':rule_revision:' || v_rule.revision::text;

    select event_row.occurred_at, event_row.payload
    into v_event_occurred_at, v_event_payload
    from dashboard_private.notification_events event_row
    where event_row.scope_key = 'global'
      and event_row.workflow_key = 'registration'
      and event_row.source_type = 'registration_appointment'
      and event_row.source_id = v_appointment.id::text
      and event_row.event_key = 'registration.appointment_reminder_due'
      and event_row.occurrence_key = v_occurrence_key
    for update of event_row;

    v_recorded := dashboard_private.record_notification_event_v1(
      'global',
      'registration',
      'registration.appointment_reminder_due',
      'registration_appointment',
      v_appointment.id::text,
      v_appointment.notification_revision,
      v_occurrence_key,
      null,
      v_scheduled_for,
      2,
      v_payload,
      v_rule.id,
      v_rule.revision
    );

    if v_recorded ->> 'event_id' is null or v_recorded ->> 'fanout_job_id' is null then
      raise exception 'registration_reminder_common_record_invalid' using errcode = '40001';
    end if;

    update dashboard_private.notification_event_fanout_jobs job
    set
      scheduled_for = v_scheduled_for,
      scheduled_for_source = 'event',
      next_attempt_at = v_scheduled_for,
      target_generation = v_appointment.recipient_revision,
      updated_at = pg_catalog.clock_timestamp()
    where job.id = (v_recorded ->> 'fanout_job_id')::uuid
      and job.event_id = (v_recorded ->> 'event_id')::uuid;
    if not found then
      raise exception 'registration_reminder_common_job_missing' using errcode = '40001';
    end if;

    v_jobs := v_jobs || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'job_kind', 'fanout',
        'job_id', v_recorded ->> 'fanout_job_id'
      )
    );
  end loop;

  return v_jobs;
end;
$$;

create or replace function dashboard_private.cancel_registration_appointment_reminders_v1(
  p_appointment_id uuid,
  p_reason_code text default 'source_revision_changed',
  p_keep_notification_revision integer default null,
  p_now timestamptz default pg_catalog.clock_timestamp()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_canceled_count integer := 0;
  v_cancel_requested_count integer := 0;
begin
  if p_appointment_id is null
    or p_reason_code not in ('source_revision_changed', 'source_status_changed')
    or p_now is null
  then
    raise exception 'registration_reminder_cancel_invalid' using errcode = '22023';
  end if;
  perform dashboard_private.assert_registration_reminder_runtime_v1();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration:appointment:' || p_appointment_id::text, 0)
  );

  with canceled as (
    update dashboard_private.notification_deliveries delivery
    set
      status = 'canceled',
      status_reason = p_reason_code,
      next_attempt_at = null,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      resolved_at = p_now,
      updated_at = p_now
    from dashboard_private.notification_events event_row
    where delivery.event_id = event_row.id
      and event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.appointment_reminder_due'
      and event_row.source_type = 'registration_appointment'
      and event_row.source_id = p_appointment_id::text
      and (
        p_keep_notification_revision is null
        or event_row.source_revision is distinct from p_keep_notification_revision
      )
      and delivery.status in ('pending', 'retry_wait')
    returning delivery.id
  )
  select pg_catalog.count(*) into v_canceled_count from canceled;

  with cancel_requested as (
    update dashboard_private.notification_deliveries delivery
    set
      cancel_requested_at = coalesce(delivery.cancel_requested_at, p_now),
      cancel_reason = p_reason_code,
      updated_at = p_now
    from dashboard_private.notification_events event_row
    where delivery.event_id = event_row.id
      and event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.appointment_reminder_due'
      and event_row.source_type = 'registration_appointment'
      and event_row.source_id = p_appointment_id::text
      and (
        p_keep_notification_revision is null
        or event_row.source_revision is distinct from p_keep_notification_revision
      )
      and delivery.status = 'claimed'
    returning delivery.id
  )
  select pg_catalog.count(*) into v_cancel_requested_count from cancel_requested;

  return pg_catalog.jsonb_build_object(
    'canceled_count', v_canceled_count,
    'cancel_requested_count', v_cancel_requested_count
  );
end;
$$;

create or replace function dashboard_private.preview_registration_appointment_reminders_v1(
  p_kind text,
  p_scheduled_at timestamptz,
  p_track_ids uuid[]
)
returns table (
  rule_id uuid,
  rule_revision text,
  variant_key text,
  scheduled_for timestamptz,
  audience_key text,
  channel_key text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
begin
  perform dashboard_private.assert_registration_reminder_runtime_v1();
  perform dashboard_private.assert_registration_reminder_access_v1();
  if p_kind not in ('level_test', 'visit_consultation')
    or p_scheduled_at is null
    or p_track_ids is null
    or pg_catalog.cardinality(p_track_ids) not between 1 and 2
    or exists (
      select 1
      from pg_catalog.unnest(p_track_ids) track_id(value)
      where track_id.value is null
    )
  then
    raise exception 'registration_reminder_preview_invalid' using errcode = '22023';
  end if;

  return query
  select
    rule.id,
    rule.revision::text,
    rule.rule_variant_key,
    calculated.scheduled_for,
    rule.audience_key,
    rule.channel_key
  from dashboard_private.notification_rules rule
  cross join lateral (
    select dashboard_private.calculate_registration_reminder_schedule_v1(
      rule.schedule_key,
      rule.schedule_config,
      p_scheduled_at
    ) as scheduled_for
  ) calculated
  where rule.scope_key = 'global'
    and rule.workflow_key = 'registration'
    and rule.event_key = 'registration.appointment_reminder_due'
    and rule.enabled
    and dashboard_private.registration_appointment_reminder_applicable_v1(
      p_kind,
      rule.audience_key,
      rule.channel_key
    )
    and v_now < calculated.scheduled_for
    and calculated.scheduled_for < p_scheduled_at
  order by calculated.scheduled_for, rule.id;
end;
$$;

create or replace function public.preview_registration_appointment_reminders_v1(
  p_kind text,
  p_scheduled_at timestamptz,
  p_track_ids uuid[]
)
returns table (
  rule_id uuid,
  rule_revision text,
  variant_key text,
  scheduled_for timestamptz,
  audience_key text,
  channel_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from dashboard_private.preview_registration_appointment_reminders_v1(
    p_kind,
    p_scheduled_at,
    p_track_ids
  );
$$;

create or replace function dashboard_private.append_registration_notification_jobs_v1(
  p_response jsonb,
  p_jobs jsonb
)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when coalesce(pg_catalog.jsonb_array_length(p_jobs), 0) = 0 then p_response
    else pg_catalog.jsonb_set(
      p_response,
      '{notificationJobs}',
      coalesce(p_response -> 'notificationJobs', '[]'::jsonb) || p_jobs,
      true
    )
  end;
$$;

create or replace function dashboard_private.assert_registration_intake_runtime_dependencies_v1()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subject_runtime integer;
  v_intake_runtime integer;
begin
  if pg_catalog.to_regprocedure(
    'public.registration_subject_tracks_runtime_version()'
  ) is null then
    raise exception 'registration_subject_tracks_runtime_missing';
  end if;
  execute 'select public.registration_subject_tracks_runtime_version()'
    into v_subject_runtime;
  if v_subject_runtime is distinct from 1 then
    raise exception 'registration_subject_tracks_runtime_mismatch';
  end if;

  if pg_catalog.to_regprocedure(
    'public.registration_intake_workflow_runtime_version()'
  ) is null then
    raise exception 'registration_intake_workflow_runtime_missing';
  end if;
  execute 'select public.registration_intake_workflow_runtime_version()'
    into v_intake_runtime;
  if v_intake_runtime is distinct from 1 then
    raise exception 'registration_intake_workflow_runtime_mismatch';
  end if;
end;
$$;

create or replace function dashboard_private.create_registration_case_with_reminders_v1_impl(
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
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_response jsonb;
  v_appointment jsonb;
  v_task_id uuid;
  v_appointment_id uuid;
  v_expected_revision integer;
  v_persisted_revision integer;
  v_receipt_is_stale boolean := false;
  v_jobs jsonb := '[]'::jsonb;
begin
  perform dashboard_private.assert_registration_intake_runtime_dependencies_v1();
  perform dashboard_private.assert_registration_reminder_runtime_v1();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-control-plane-workflow:registration',
    0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'registration:workflow:create:' || coalesce((select auth.uid())::text, '')
      || ':' || coalesce(p_request_key, ''),
    0
  ));

  v_response := dashboard_private.create_registration_case_with_initial_workflow_v1_impl(
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

  if v_response ? 'notificationJobs' then
    return v_response;
  end if;
  v_task_id := nullif(v_response ->> 'taskId', '')::uuid;

  for v_appointment in
    select value
    from pg_catalog.jsonb_array_elements(
      coalesce(v_response -> 'appointments', '[]'::jsonb)
    ) appointment(value)
  loop
    v_appointment_id := nullif(v_appointment ->> 'id', '')::uuid;
    v_expected_revision := nullif(v_appointment ->> 'notificationRevision', '')::integer;
    select appointment.notification_revision
    into v_persisted_revision
    from public.ops_registration_appointments appointment
    where appointment.id = v_appointment_id
      and appointment.task_id = v_task_id;
    if not found or v_persisted_revision is distinct from v_expected_revision then
      v_receipt_is_stale := true;
      exit;
    end if;
  end loop;

  if not v_receipt_is_stale then
    for v_appointment in
      select value
      from pg_catalog.jsonb_array_elements(
        coalesce(v_response -> 'appointments', '[]'::jsonb)
      ) appointment(value)
    loop
      v_jobs := v_jobs || dashboard_private.materialize_registration_appointment_reminders_v1(
        (v_appointment ->> 'id')::uuid,
        pg_catalog.clock_timestamp()
      );
    end loop;
  end if;
  v_response := pg_catalog.jsonb_set(
    v_response,
    '{notificationJobs}',
    case when v_receipt_is_stale then '[]'::jsonb else v_jobs end,
    true
  );
  update dashboard_private.ops_registration_mutations mutation
  set response_payload = v_response
  where mutation.actor_id = v_actor_id
    and mutation.request_key = nullif(pg_catalog.btrim(p_request_key), '')
    and mutation.task_id = v_task_id
    and mutation.mutation_type = 'create_case_with_initial_workflow_v1';
  if not found then
    raise exception 'registration_initial_receipt_missing' using errcode = '40001';
  end if;
  return v_response;
end;
$$;

create or replace function dashboard_private.save_registration_shared_appointment_with_reminders_v1_impl(
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
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_response jsonb;
  v_current_appointment_id uuid;
  v_old_appointment_id uuid;
  v_current_revision integer;
  v_persisted_revision integer;
  v_before_targets jsonb := '[]'::jsonb;
  v_after_targets jsonb := '[]'::jsonb;
  v_previous_target_set_hash text;
  v_current_target_set_hash text;
  v_recipient_revision bigint;
  v_target_job_id uuid;
  v_source_event_id uuid;
  v_event_track_id uuid;
  v_jobs jsonb := '[]'::jsonb;
begin
  perform dashboard_private.assert_registration_reminder_runtime_v1();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-control-plane-workflow:registration',
    0
  ));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration:workflow:' || p_task_id::text, 0)
  );
  if p_kind = 'visit_consultation' and p_appointment_id is not null then
    v_before_targets := dashboard_private.registration_appointment_director_targets_v1(
      p_appointment_id
    );
  end if;
  v_response := dashboard_private.save_registration_shared_appointment_impl(
    p_appointment_id,
    p_task_id,
    p_kind,
    p_scheduled_at,
    p_place,
    p_track_ids,
    p_replace_remaining,
    p_expected_notification_revision,
    p_request_key
  );

  -- The base mutation receipt is upgraded with notificationJobs below. A replay of
  -- that final receipt must not cancel or rematerialize anything, even if the same
  -- appointment has since advanced to a newer source revision.
  if v_response ? 'notificationJobs' then
    return v_response;
  end if;

  v_current_appointment_id := nullif(v_response ->> 'appointmentId', '')::uuid;
  v_old_appointment_id := nullif(v_response ->> 'oldAppointmentId', '')::uuid;
  v_current_revision := nullif(v_response ->> 'notificationRevision', '')::integer;

  if v_current_appointment_id is not null then
    select appointment.notification_revision
    into v_persisted_revision
    from public.ops_registration_appointments appointment
    where appointment.id = v_current_appointment_id;
    if not found or v_persisted_revision is distinct from v_current_revision then
      v_response := pg_catalog.jsonb_set(
        v_response,
        '{notificationJobs}',
        coalesce(v_response -> 'notificationJobs', '[]'::jsonb),
        true
      );
      update dashboard_private.ops_registration_mutations mutation
      set response_payload = v_response
      where mutation.actor_id = v_actor_id
        and mutation.request_key = nullif(pg_catalog.btrim(p_request_key), '')
        and mutation.task_id = p_task_id
        and mutation.mutation_type = 'save_appointment';
      return v_response;
    end if;
  end if;

  if p_kind = 'visit_consultation'
    and p_appointment_id is not null
    and v_current_appointment_id = p_appointment_id
  then
    v_after_targets := dashboard_private.registration_appointment_director_targets_v1(
      v_current_appointment_id
    );
    if v_before_targets <> v_after_targets then
      v_previous_target_set_hash := dashboard_private.notification_target_set_hash_v1(
        v_before_targets
      );
      v_current_target_set_hash := dashboard_private.notification_target_set_hash_v1(
        v_after_targets
      );
      update public.ops_registration_appointments appointment
      set
        recipient_revision = recipient_revision + 1,
        updated_at = pg_catalog.now()
      where appointment.id = v_current_appointment_id
        and appointment.notification_revision = v_current_revision
      returning appointment.recipient_revision
      into v_recipient_revision;
      if not found then
        raise exception 'registration_appointment_revision_conflict' using errcode = '40001';
      end if;

      select track.id
      into v_event_track_id
      from public.ops_registration_subject_tracks track
      where track.task_id = p_task_id
        and track.id = any(coalesce(p_track_ids, array[]::uuid[]))
      order by track.id
      limit 1;
      if v_event_track_id is null then
        raise exception 'registration_appointment_tracks_required' using errcode = '22023';
      end if;

      v_source_event_id := dashboard_private.write_registration_track_event_v2(
        p_task_id,
        v_event_track_id,
        'appointment_recipient_set_changed',
        'visit_consultation_scheduled',
        'visit_consultation_scheduled',
        null,
        pg_catalog.jsonb_build_object(
          'appointmentId', v_current_appointment_id,
          'notificationRevision', v_current_revision,
          'previousTargetSetHash', v_previous_target_set_hash,
          'currentTargetSetHash', v_current_target_set_hash,
          'recipientRevision', v_recipient_revision::text,
          'activeTrackIds', pg_catalog.to_jsonb(p_track_ids),
          'recipientSetChanged', true
        ),
        'user',
        null
      );
      v_target_job_id := dashboard_private.enqueue_notification_target_reconciliation_job_v1(
        'registration',
        'registration_appointment',
        v_current_appointment_id::text,
        v_current_revision,
        v_source_event_id,
        'recipient_set_changed',
        v_recipient_revision,
        v_previous_target_set_hash,
        v_current_target_set_hash
      );
      v_jobs := v_jobs || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'job_kind', 'target_reconciliation',
          'job_id', v_target_job_id
        )
      );
      v_response := pg_catalog.jsonb_set(
        v_response,
        '{recipientRevision}',
        pg_catalog.to_jsonb(v_recipient_revision::text),
        true
      );
    end if;
  end if;

  if v_old_appointment_id is not null
    and v_old_appointment_id is distinct from v_current_appointment_id
  then
    perform dashboard_private.cancel_registration_appointment_reminders_v1(
      v_old_appointment_id,
      'source_revision_changed',
      null,
      pg_catalog.clock_timestamp()
    );
  end if;
  if v_current_appointment_id is not null then
    perform dashboard_private.cancel_registration_appointment_reminders_v1(
      v_current_appointment_id,
      'source_revision_changed',
      v_current_revision,
      pg_catalog.clock_timestamp()
    );
    v_jobs := v_jobs || dashboard_private.materialize_registration_appointment_reminders_v1(
      v_current_appointment_id,
      pg_catalog.clock_timestamp()
    );
  end if;
  v_response := pg_catalog.jsonb_set(
    v_response,
    '{notificationJobs}',
    coalesce(v_response -> 'notificationJobs', '[]'::jsonb) || v_jobs,
    true
  );
  update dashboard_private.ops_registration_mutations mutation
  set response_payload = v_response
  where mutation.actor_id = v_actor_id
    and mutation.request_key = nullif(pg_catalog.btrim(p_request_key), '')
    and mutation.task_id = p_task_id
    and mutation.mutation_type = 'save_appointment';
  if not found then
    raise exception 'registration_appointment_receipt_missing' using errcode = '40001';
  end if;
  return v_response;
end;
$$;

create or replace function dashboard_private.cancel_registration_appointment_with_reminders_v1_impl(
  p_appointment_id uuid,
  p_expected_notification_revision integer,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_response jsonb;
begin
  perform dashboard_private.assert_registration_reminder_runtime_v1();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-control-plane-workflow:registration',
    0
  ));
  select appointment.task_id
  into v_task_id
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id;
  if v_task_id is null then
    raise exception 'registration_appointment_not_found' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration:workflow:' || v_task_id::text, 0)
  );
  v_response := dashboard_private.cancel_registration_appointment_impl(
    p_appointment_id,
    p_expected_notification_revision,
    p_reason,
    p_request_key
  );
  perform dashboard_private.cancel_registration_appointment_reminders_v1(
    p_appointment_id,
    'source_status_changed',
    null,
    pg_catalog.clock_timestamp()
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.complete_registration_level_test_with_reminders_v1_impl(
  p_attempt_id uuid,
  p_status text,
  p_material_link text,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_appointment_id uuid;
  v_task_id uuid;
  v_response jsonb;
  v_appointment_status text;
begin
  perform dashboard_private.assert_registration_reminder_runtime_v1();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-control-plane-workflow:registration',
    0
  ));
  select level_test.appointment_id, track.task_id
  into v_appointment_id, v_task_id
  from public.ops_registration_level_tests level_test
  join public.ops_registration_subject_tracks track on track.id = level_test.track_id
  where level_test.id = p_attempt_id;
  if v_appointment_id is null then
    raise exception 'registration_appointment_not_found' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration:workflow:' || v_task_id::text, 0)
  );
  v_response := dashboard_private.complete_registration_level_test_attempt_impl(
    p_attempt_id,
    p_status,
    p_material_link,
    p_request_key
  );
  select appointment.status into v_appointment_status
  from public.ops_registration_appointments appointment
  where appointment.id = v_appointment_id;
  if v_appointment_status <> 'scheduled' then
    perform dashboard_private.cancel_registration_appointment_reminders_v1(
      v_appointment_id,
      'source_status_changed',
      null,
      pg_catalog.clock_timestamp()
    );
  end if;
  return v_response;
end;
$$;

create or replace function dashboard_private.complete_registration_consultation_with_reminders_v1_impl(
  p_consultation_id uuid,
  p_outcome text,
  p_waiting_kind text,
  p_class_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_appointment_id uuid;
  v_task_id uuid;
  v_response jsonb;
  v_appointment_status text;
begin
  perform dashboard_private.assert_registration_reminder_runtime_v1();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-control-plane-workflow:registration',
    0
  ));
  select consultation.appointment_id, track.task_id
  into v_appointment_id, v_task_id
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where consultation.id = p_consultation_id;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration:workflow:' || v_task_id::text, 0)
  );
  v_response := dashboard_private.complete_registration_consultation_impl(
    p_consultation_id,
    p_outcome,
    p_waiting_kind,
    p_class_id,
    p_request_key
  );
  if v_appointment_id is not null then
    select appointment.status into v_appointment_status
    from public.ops_registration_appointments appointment
    where appointment.id = v_appointment_id;
    if v_appointment_status <> 'scheduled' then
      perform dashboard_private.cancel_registration_appointment_reminders_v1(
        v_appointment_id,
        'source_status_changed',
        null,
        pg_catalog.clock_timestamp()
      );
    end if;
  end if;
  return v_response;
end;
$$;

create or replace function dashboard_private.assign_registration_track_director_with_reminders_v1_impl(
  p_track_id uuid,
  p_director_profile_id uuid,
  p_assignment_source text,
  p_rule_key text,
  p_expected_common_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_assignment_source text := nullif(pg_catalog.btrim(p_assignment_source), '');
  v_rule_key text := nullif(pg_catalog.btrim(p_rule_key), '');
  v_task_id uuid;
  v_appointment_id uuid;
  v_consultation_id uuid;
  v_detail public.ops_registration_details%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_resolution jsonb;
  v_next_source text;
  v_next_rule_key text;
  v_event_type text;
  v_next_assigned_at timestamptz;
  v_assignment_changed boolean;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_before_targets jsonb := '[]'::jsonb;
  v_after_targets jsonb := '[]'::jsonb;
  v_previous_target_set_hash text;
  v_current_target_set_hash text;
  v_response jsonb;
  v_source_event_id uuid;
  v_notification_revision integer;
  v_recipient_revision bigint;
  v_target_job_id uuid;
begin
  perform dashboard_private.assert_registration_reminder_runtime_v1();
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_assignment_source not in ('default', 'manual', 'clear_default') then
    raise exception 'registration_director_assignment_source_invalid' using errcode = '22023';
  end if;
  if p_expected_common_revision is null or p_expected_common_revision <= 0 then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-control-plane-workflow:registration',
    0
  ));

  select track.task_id into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration:workflow:' || v_task_id::text, 0)
  );

  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select detail.* into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;
  select track.* into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  select consultation.id, consultation.appointment_id
  into v_consultation_id, v_appointment_id
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
    and consultation.mode = 'visit'
    and consultation.status = 'scheduled'
  order by consultation.id
  limit 1;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id,
    p_track_id,
    'assign_director'
  );
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', p_track_id,
    'directorProfileId', p_director_profile_id,
    'assignmentSource', v_assignment_source,
    'ruleKey', v_rule_key,
    'expectedCommonRevision', p_expected_common_revision
  );
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'assign_director'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then
    return v_response;
  end if;

  if v_appointment_id is null then
    return dashboard_private.assign_registration_track_director_impl(
      p_track_id,
      p_director_profile_id,
      p_assignment_source,
      p_rule_key,
      p_expected_common_revision,
      p_request_key
    );
  end if;
  if v_detail.common_revision <> p_expected_common_revision then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
  end if;
  if v_track.pipeline_status in ('registered', 'not_registered', 'inquiry_closed') then
    raise exception 'registration_director_assignment_terminal' using errcode = '40001';
  end if;
  if v_assignment_source = 'clear_default' or p_director_profile_id is null then
    raise exception 'registration_visit_director_required' using errcode = '22023';
  end if;

  v_resolution := dashboard_private.resolve_registration_default_director(
    v_track.subject,
    v_detail.school_grade,
    v_detail.inquiry_at
  );
  if v_assignment_source = 'default' then
    if v_rule_key is null
      or v_track.director_assignment_source is not null
        and v_track.director_assignment_source <> 'default'
      or v_resolution ->> 'status' <> 'resolved'
      or nullif(v_resolution ->> 'profileId', '')::uuid
        is distinct from p_director_profile_id
      or v_resolution ->> 'ruleKey' is distinct from v_rule_key
    then
      raise exception 'registration_director_default_stale' using errcode = '40001';
    end if;
    v_next_source := 'default';
    v_next_rule_key := v_rule_key;
    v_event_type := 'director_default_resolved';
  else
    if v_rule_key is not null then
      raise exception 'registration_director_manual_invalid' using errcode = '22023';
    end if;
    v_next_source := 'manual';
    v_next_rule_key := null;
    v_event_type := 'director_manual_override';
  end if;
  if not dashboard_private.is_active_registration_director(p_director_profile_id) then
    raise exception 'registration_director_refresh_required' using errcode = '40001';
  end if;

  perform 1
  from public.ops_registration_appointments appointment
  where appointment.id = v_appointment_id
    and appointment.status = 'scheduled'
  for update of appointment;
  if not found then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;
  perform 1
  from public.ops_registration_consultations consultation
  where consultation.appointment_id = v_appointment_id
    and consultation.mode = 'visit'
    and consultation.status = 'scheduled'
  order by consultation.track_id, consultation.id
  for update of consultation;

  v_before_targets := dashboard_private.registration_appointment_director_targets_v1(
    v_appointment_id
  );
  v_previous_target_set_hash := dashboard_private.notification_target_set_hash_v1(
    v_before_targets
  );

  v_assignment_changed :=
    v_track.director_profile_id is distinct from p_director_profile_id
    or v_track.director_assignment_source is distinct from v_next_source
    or v_track.director_assignment_rule_key is distinct from v_next_rule_key;
  v_next_assigned_at := case
    when v_assignment_changed then pg_catalog.now()
    else v_track.director_assigned_at
  end;
  if v_assignment_changed then
    update public.ops_registration_subject_tracks track
    set
      director_profile_id = p_director_profile_id,
      director_assignment_source = v_next_source,
      director_assignment_rule_key = v_next_rule_key,
      director_assigned_at = v_next_assigned_at,
      updated_at = pg_catalog.now()
    where track.id = p_track_id;
    update public.ops_registration_consultations consultation
    set
      director_profile_id = p_director_profile_id,
      updated_at = pg_catalog.now()
    where consultation.id = v_consultation_id;
  end if;

  v_source_event_id := dashboard_private.write_registration_track_event_v2(
    v_task_id,
    p_track_id,
    v_event_type,
    coalesce(v_track.director_assignment_source, 'unassigned'),
    coalesce(v_next_source, 'unassigned'),
    null,
    pg_catalog.jsonb_build_object(
      'appointmentId', v_appointment_id,
      'previousDirectorProfileId', v_track.director_profile_id,
      'directorProfileId', p_director_profile_id,
      'ruleKey', v_next_rule_key,
      'recipientSetChanged', (
        v_before_targets
          <> dashboard_private.registration_appointment_director_targets_v1(
            v_appointment_id
          )
      )
    ),
    'user',
    null
  );

  v_after_targets := dashboard_private.registration_appointment_director_targets_v1(
    v_appointment_id
  );
  v_current_target_set_hash := dashboard_private.notification_target_set_hash_v1(
    v_after_targets
  );
  if v_before_targets <> v_after_targets then
    update public.ops_registration_appointments appointment
    set
      recipient_revision = recipient_revision + 1,
      updated_at = pg_catalog.now()
    where appointment.id = v_appointment_id
    returning appointment.notification_revision, appointment.recipient_revision
    into v_notification_revision, v_recipient_revision;
    v_target_job_id := dashboard_private.enqueue_notification_target_reconciliation_job_v1(
      'registration',
      'registration_appointment',
      v_appointment_id::text,
      v_notification_revision,
      v_source_event_id,
      'recipient_set_changed',
      v_recipient_revision,
      v_previous_target_set_hash,
      v_current_target_set_hash
    );
  else
    select appointment.notification_revision, appointment.recipient_revision
    into v_notification_revision, v_recipient_revision
    from public.ops_registration_appointments appointment
    where appointment.id = v_appointment_id;
  end if;

  perform dashboard_private.recompute_registration_parent(v_task_id);
  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'commonRevision', v_detail.common_revision,
    'trackId', p_track_id,
    'subject', v_track.subject,
    'status', v_track.pipeline_status,
    'directorProfileId', p_director_profile_id,
    'directorAssignmentSource', v_next_source,
    'directorAssignmentRuleKey', v_next_rule_key,
    'directorAssignedAt', v_next_assigned_at,
    'consultationId', v_consultation_id,
    'appointmentId', v_appointment_id,
    'notificationRevision', v_notification_revision,
    'recipientRevision', v_recipient_revision::text,
    'notificationId', null,
    'notificationDedupeKey', null,
    'requiresDirectorAssignment', false
  );
  if v_target_job_id is not null then
    v_response := dashboard_private.append_registration_notification_jobs_v1(
      v_response,
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'job_kind', 'target_reconciliation',
          'job_id', v_target_job_id
        )
      )
    );
  end if;
  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_task_id,
    'assign_director',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.update_registration_case_common_with_reminders_v1_impl(
  p_task_id uuid,
  p_student_name text,
  p_school_grade text,
  p_school_name text,
  p_parent_phone text,
  p_student_phone text,
  p_campus text,
  p_inquiry_at timestamptz,
  p_request_note text,
  p_priority text,
  p_expected_common_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_before_student_name text;
  v_after_student_name text := nullif(pg_catalog.btrim(p_student_name), '');
  v_response jsonb;
  v_appointment record;
  v_new_notification_revision integer;
  v_jobs jsonb := '[]'::jsonb;
begin
  perform dashboard_private.assert_registration_reminder_runtime_v1();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-control-plane-workflow:registration',
    0
  ));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration:workflow:' || p_task_id::text, 0)
  );

  select task.student_name
  into v_before_student_name
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  for update of task;
  if not found then
    raise exception 'registration_task_not_found' using errcode = 'P0002';
  end if;

  v_response := dashboard_private.update_registration_case_common_impl(
    p_task_id,
    p_student_name,
    p_school_grade,
    p_school_name,
    p_parent_phone,
    p_student_phone,
    p_campus,
    p_inquiry_at,
    p_request_note,
    p_priority,
    p_expected_common_revision,
    p_request_key
  );

  if v_response ? 'notificationJobs' then
    return v_response;
  end if;

  if v_before_student_name is distinct from v_after_student_name then
    for v_appointment in
      select appointment.id
      from public.ops_registration_appointments appointment
      where appointment.task_id = p_task_id
        and appointment.status = 'scheduled'
      order by appointment.id
      for update of appointment
    loop
      update public.ops_registration_appointments appointment
      set
        notification_revision = notification_revision + 1,
        updated_at = pg_catalog.now()
      where appointment.id = v_appointment.id
      returning appointment.notification_revision
      into v_new_notification_revision;

      perform dashboard_private.cancel_registration_appointment_reminders_v1(
        v_appointment.id,
        'source_revision_changed',
        v_new_notification_revision,
        pg_catalog.clock_timestamp()
      );
      v_jobs := v_jobs || dashboard_private.materialize_registration_appointment_reminders_v1(
        v_appointment.id,
        pg_catalog.clock_timestamp()
      );
    end loop;
  end if;

  v_response := pg_catalog.jsonb_set(
    v_response,
    '{notificationJobs}',
    v_jobs,
    true
  );
  update dashboard_private.ops_registration_mutations mutation
  set response_payload = v_response
  where mutation.actor_id = v_actor_id
    and mutation.request_key = nullif(pg_catalog.btrim(p_request_key), '')
    and mutation.task_id = p_task_id
    and mutation.mutation_type = 'update_common';
  if not found then
    raise exception 'registration_common_receipt_missing' using errcode = '40001';
  end if;
  return v_response;
end;
$$;

alter function dashboard_private.update_registration_case_common_with_reminders_v1_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
) owner to postgres;
revoke all on function dashboard_private.update_registration_case_common_with_reminders_v1_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
) from public, anon, service_role;
grant execute on function dashboard_private.update_registration_case_common_with_reminders_v1_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
) to authenticated;

revoke all on function dashboard_private.update_registration_case_common_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
) from public, anon, authenticated, service_role;

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
    p_level_test_appointment,
    p_visit_appointment,
    p_director_overrides,
    p_request_key
  );
$$;

create or replace function public.update_registration_case_common(
  p_task_id uuid,
  p_student_name text,
  p_school_grade text,
  p_school_name text,
  p_parent_phone text,
  p_student_phone text,
  p_campus text,
  p_inquiry_at timestamptz,
  p_request_note text,
  p_priority text,
  p_expected_common_revision integer,
  p_request_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select dashboard_private.update_registration_case_common_with_reminders_v1_impl(
    p_task_id,
    p_student_name,
    p_school_grade,
    p_school_name,
    p_parent_phone,
    p_student_phone,
    p_campus,
    p_inquiry_at,
    p_request_note,
    p_priority,
    p_expected_common_revision,
    p_request_key
  );
$$;

revoke execute on function public.update_registration_case_common(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
) from public, anon;
grant execute on function public.update_registration_case_common(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
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
    p_place,
    p_track_ids,
    p_replace_remaining,
    p_expected_notification_revision,
    p_request_key
  );
$$;

create or replace function public.cancel_registration_appointment(
  p_appointment_id uuid,
  p_expected_notification_revision integer,
  p_reason text,
  p_request_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select dashboard_private.cancel_registration_appointment_with_reminders_v1_impl(
    p_appointment_id,
    p_expected_notification_revision,
    p_reason,
    p_request_key
  );
$$;

create or replace function public.complete_registration_level_test_attempt(
  p_attempt_id uuid,
  p_status text,
  p_material_link text,
  p_request_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select dashboard_private.complete_registration_level_test_with_reminders_v1_impl(
    p_attempt_id,
    p_status,
    p_material_link,
    p_request_key
  );
$$;

create or replace function public.complete_registration_consultation(
  p_consultation_id uuid,
  p_outcome text,
  p_waiting_kind text,
  p_class_id uuid,
  p_request_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select dashboard_private.complete_registration_consultation_with_reminders_v1_impl(
    p_consultation_id,
    p_outcome,
    p_waiting_kind,
    p_class_id,
    p_request_key
  );
$$;

create or replace function public.assign_registration_track_director(
  p_track_id uuid,
  p_director_profile_id uuid,
  p_assignment_source text,
  p_rule_key text,
  p_expected_common_revision integer,
  p_request_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select dashboard_private.assign_registration_track_director_with_reminders_v1_impl(
    p_track_id,
    p_director_profile_id,
    p_assignment_source,
    p_rule_key,
    p_expected_common_revision,
    p_request_key
  );
$$;

create or replace function public.list_registration_notification_sources_v1(
  p_cursor jsonb default null,
  p_batch_size integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cursor_scheduled_at timestamptz;
  v_cursor_id uuid;
  v_count integer;
  v_items jsonb;
  v_next_cursor jsonb;
begin
  perform dashboard_private.assert_registration_reminder_runtime_v1();
  if p_batch_size is null or p_batch_size not between 1 and 500 then
    raise exception 'registration_notification_source_cursor_invalid' using errcode = '22023';
  end if;
  if p_cursor is not null then
    if pg_catalog.jsonb_typeof(p_cursor) <> 'object'
      or not (p_cursor ?& array['scheduled_at', 'id']::text[])
      or p_cursor - array['scheduled_at', 'id']::text[] <> '{}'::jsonb
    then
      raise exception 'registration_notification_source_cursor_invalid' using errcode = '22023';
    end if;
    begin
      v_cursor_scheduled_at := (p_cursor ->> 'scheduled_at')::timestamptz;
      v_cursor_id := (p_cursor ->> 'id')::uuid;
    exception
      when others then
        raise exception 'registration_notification_source_cursor_invalid' using errcode = '22023';
    end;
  end if;

  with page as (
    select appointment.id, appointment.scheduled_at
    from public.ops_registration_appointments appointment
    where appointment.status = 'scheduled'
      and appointment.kind in ('level_test', 'visit_consultation')
      and appointment.scheduled_at > pg_catalog.now()
      and (
        v_cursor_scheduled_at is null
        or (appointment.scheduled_at, appointment.id)
          > (v_cursor_scheduled_at, v_cursor_id)
      )
    order by appointment.scheduled_at, appointment.id
    limit p_batch_size + 1
  )
  select pg_catalog.count(*) into v_count from page;

  with page as (
    select appointment.id, appointment.scheduled_at
    from public.ops_registration_appointments appointment
    where appointment.status = 'scheduled'
      and appointment.kind in ('level_test', 'visit_consultation')
      and appointment.scheduled_at > pg_catalog.now()
      and (
        v_cursor_scheduled_at is null
        or (appointment.scheduled_at, appointment.id)
          > (v_cursor_scheduled_at, v_cursor_id)
      )
    order by appointment.scheduled_at, appointment.id
    limit p_batch_size
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      dashboard_private.registration_appointment_source_snapshot_v1(page.id)
        - 'current_rules'
      order by page.scheduled_at, page.id
    ),
    '[]'::jsonb
  )
  into v_items
  from page;

  if v_count > p_batch_size then
    select pg_catalog.jsonb_build_object(
      'scheduled_at', appointment.scheduled_at,
      'id', appointment.id
    )
    into v_next_cursor
    from public.ops_registration_appointments appointment
    where appointment.status = 'scheduled'
      and appointment.kind in ('level_test', 'visit_consultation')
      and appointment.scheduled_at > pg_catalog.now()
      and (
        v_cursor_scheduled_at is null
        or (appointment.scheduled_at, appointment.id)
          > (v_cursor_scheduled_at, v_cursor_id)
      )
    order by appointment.scheduled_at, appointment.id
    offset (p_batch_size - 1)
    limit 1;
  end if;

  return pg_catalog.jsonb_build_object(
    'items', v_items,
    'rules', dashboard_private.registration_appointment_rule_snapshot_v1(null, false),
    'next_cursor', v_next_cursor,
    'done', v_count <= p_batch_size
  );
end;
$$;

create or replace function public.get_registration_notification_source_snapshot_v1(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
begin
  perform dashboard_private.assert_registration_reminder_runtime_v1();
  if p_appointment_id is null then
    raise exception 'registration_notification_source_invalid' using errcode = '22023';
  end if;
  v_snapshot := dashboard_private.registration_appointment_source_snapshot_v1(
    p_appointment_id
  );
  if v_snapshot is null then
    raise exception 'registration_appointment_not_found' using errcode = 'P0002';
  end if;
  return v_snapshot;
end;
$$;

create or replace function public.list_registration_notification_target_items_v1(
  p_appointment_id uuid,
  p_cursor jsonb default null,
  p_batch_size integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cutoff_at timestamptz := pg_catalog.clock_timestamp();
  v_cursor_scheduled_for timestamptz;
  v_cursor_event_id uuid;
  v_cursor_rule_id uuid;
  v_count integer;
  v_items jsonb;
  v_next_cursor jsonb;
begin
  perform dashboard_private.assert_registration_reminder_runtime_v1();
  if p_appointment_id is null
    or p_batch_size is null
    or p_batch_size not between 1 and 500
  then
    raise exception 'registration_notification_target_cursor_invalid' using errcode = '22023';
  end if;
  if p_cursor is not null then
    if pg_catalog.jsonb_typeof(p_cursor) <> 'object'
      or not (p_cursor ?& array['cutoff_at', 'scheduled_for', 'event_id', 'rule_id']::text[])
      or p_cursor - array['cutoff_at', 'scheduled_for', 'event_id', 'rule_id']::text[] <> '{}'::jsonb
    then
      raise exception 'registration_notification_target_cursor_invalid' using errcode = '22023';
    end if;
    begin
      v_cutoff_at := (p_cursor ->> 'cutoff_at')::timestamptz;
      v_cursor_scheduled_for := (p_cursor ->> 'scheduled_for')::timestamptz;
      v_cursor_event_id := (p_cursor ->> 'event_id')::uuid;
      v_cursor_rule_id := (p_cursor ->> 'rule_id')::uuid;
    exception
      when others then
        raise exception 'registration_notification_target_cursor_invalid' using errcode = '22023';
    end;
  end if;

  with candidates as (
    select
      event_row.id as event_id,
      rule.id as rule_id,
      rule.revision as rule_revision,
      rule.active_template_id as template_id,
      rule.audience_key,
      rule.channel_key,
      rule.rule_variant_key,
      job.scheduled_for
    from dashboard_private.notification_events event_row
    join dashboard_private.notification_rules rule
      on rule.id = event_row.materialized_rule_id
     and rule.revision = event_row.materialized_rule_revision
    join dashboard_private.notification_event_fanout_jobs job
      on job.event_id = event_row.id
    join public.ops_registration_appointments appointment
      on appointment.id::text = event_row.source_id
     and appointment.notification_revision = event_row.source_revision
    where event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.appointment_reminder_due'
      and event_row.source_type = 'registration_appointment'
      and event_row.source_id = p_appointment_id::text
      and appointment.kind = 'visit_consultation'
      and appointment.status = 'scheduled'
      and rule.enabled
      and rule.audience_key = 'track_director'
      and rule.channel_key = 'in_app'
      and job.scheduled_for > v_cutoff_at
      and job.scheduled_for < appointment.scheduled_at
      and (
        v_cursor_scheduled_for is null
        or (job.scheduled_for, event_row.id, rule.id)
          > (v_cursor_scheduled_for, v_cursor_event_id, v_cursor_rule_id)
      )
    order by job.scheduled_for, event_row.id, rule.id
    limit p_batch_size + 1
  )
  select pg_catalog.count(*) into v_count from candidates;

  with candidates as (
    select
      event_row.id as event_id,
      rule.id as rule_id,
      rule.revision as rule_revision,
      rule.active_template_id as template_id,
      rule.audience_key,
      rule.channel_key,
      rule.rule_variant_key,
      job.scheduled_for
    from dashboard_private.notification_events event_row
    join dashboard_private.notification_rules rule
      on rule.id = event_row.materialized_rule_id
     and rule.revision = event_row.materialized_rule_revision
    join dashboard_private.notification_event_fanout_jobs job
      on job.event_id = event_row.id
    join public.ops_registration_appointments appointment
      on appointment.id::text = event_row.source_id
     and appointment.notification_revision = event_row.source_revision
    where event_row.workflow_key = 'registration'
      and event_row.event_key = 'registration.appointment_reminder_due'
      and event_row.source_type = 'registration_appointment'
      and event_row.source_id = p_appointment_id::text
      and appointment.kind = 'visit_consultation'
      and appointment.status = 'scheduled'
      and rule.enabled
      and rule.audience_key = 'track_director'
      and rule.channel_key = 'in_app'
      and job.scheduled_for > v_cutoff_at
      and job.scheduled_for < appointment.scheduled_at
      and (
        v_cursor_scheduled_for is null
        or (job.scheduled_for, event_row.id, rule.id)
          > (v_cursor_scheduled_for, v_cursor_event_id, v_cursor_rule_id)
      )
    order by job.scheduled_for, event_row.id, rule.id
    limit p_batch_size
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'event_id', candidate.event_id,
        'rule_id', candidate.rule_id,
        'rule_revision', candidate.rule_revision::text,
        'template_id', candidate.template_id,
        'audience_key', candidate.audience_key,
        'channel_key', candidate.channel_key,
        'connection_key', null,
        'rule_variant_key', candidate.rule_variant_key,
        'scheduled_for', candidate.scheduled_for
      ) order by candidate.scheduled_for, candidate.event_id, candidate.rule_id
    ),
    '[]'::jsonb
  )
  into v_items
  from candidates candidate;

  if v_count > p_batch_size then
    select pg_catalog.jsonb_build_object(
      'cutoff_at', v_cutoff_at,
      'scheduled_for', candidate.scheduled_for,
      'event_id', candidate.event_id,
      'rule_id', candidate.rule_id
    )
    into v_next_cursor
    from (
      select
        event_row.id as event_id,
        rule.id as rule_id,
        job.scheduled_for
      from dashboard_private.notification_events event_row
      join dashboard_private.notification_rules rule
        on rule.id = event_row.materialized_rule_id
       and rule.revision = event_row.materialized_rule_revision
      join dashboard_private.notification_event_fanout_jobs job
        on job.event_id = event_row.id
      join public.ops_registration_appointments appointment
        on appointment.id::text = event_row.source_id
       and appointment.notification_revision = event_row.source_revision
      where event_row.workflow_key = 'registration'
        and event_row.event_key = 'registration.appointment_reminder_due'
        and event_row.source_type = 'registration_appointment'
        and event_row.source_id = p_appointment_id::text
        and appointment.kind = 'visit_consultation'
        and appointment.status = 'scheduled'
        and rule.enabled
        and rule.audience_key = 'track_director'
        and rule.channel_key = 'in_app'
        and job.scheduled_for > v_cutoff_at
        and job.scheduled_for < appointment.scheduled_at
        and (
          v_cursor_scheduled_for is null
          or (job.scheduled_for, event_row.id, rule.id)
            > (v_cursor_scheduled_for, v_cursor_event_id, v_cursor_rule_id)
        )
      order by job.scheduled_for, event_row.id, rule.id
      offset (p_batch_size - 1)
      limit 1
    ) candidate;
  end if;

  return pg_catalog.jsonb_build_object(
    'items', v_items,
    'next_cursor', v_next_cursor,
    'done', v_count <= p_batch_size
  );
end;
$$;

create or replace function public.apply_notification_target_reconciliation_batch_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_expected_cursor text,
  p_batch jsonb,
  p_next_cursor text,
  p_done boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.notification_target_reconciliation_jobs%rowtype;
  v_delivery jsonb;
  v_delivery_id uuid;
  v_canceled integer := 0;
  v_inserted integer := 0;
  v_revoked integer := 0;
begin
  if p_job_id is null
    or p_claim_token is null
    or p_batch is null
    or pg_catalog.jsonb_typeof(p_batch) <> 'object'
    or not (p_batch ?& array['source_revision', 'target_generation', 'target_set_hash', 'deliveries']::text[])
    or p_batch - array['source_revision', 'target_generation', 'target_set_hash', 'deliveries']::text[] <> '{}'::jsonb
    or (
      p_batch -> 'source_revision' <> 'null'::jsonb
      and (p_batch ->> 'source_revision') !~ '^[1-9][0-9]*$'
    )
    or (p_batch ->> 'target_generation') !~ '^(0|[1-9][0-9]*)$'
    or (p_batch ->> 'target_set_hash') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_batch -> 'deliveries') <> 'array'
    or p_done is null
    or (p_done and p_next_cursor is not null)
    or (not p_done and nullif(p_next_cursor, '') is null)
  then
    raise exception 'notification_target_reconciliation_batch_invalid' using errcode = '22023';
  end if;

  select job.* into v_job
  from dashboard_private.notification_target_reconciliation_jobs job
  where job.id = p_job_id
  for update of job;
  if not found or v_job.status <> 'claimed' or v_job.claim_token <> p_claim_token then
    raise exception 'notification_reconciliation_claim_mismatch' using errcode = '40001';
  end if;
  if nullif(v_job.cursor ->> 'value', '') is distinct from nullif(p_expected_cursor, '') then
    raise exception 'notification_reconciliation_cursor_conflict' using errcode = '40001';
  end if;

  if (case
        when p_batch -> 'source_revision' = 'null'::jsonb then null
        else (p_batch ->> 'source_revision')::bigint
      end) is distinct from v_job.source_revision
    or (p_batch ->> 'target_generation')::bigint <> v_job.target_generation
    or p_batch ->> 'target_set_hash' <> v_job.current_target_set_hash
    or exists (
      select 1
      from dashboard_private.notification_target_reconciliation_jobs newer
      where newer.workflow_key = v_job.workflow_key
        and newer.source_type = v_job.source_type
        and newer.source_id = v_job.source_id
        and newer.target_generation > v_job.target_generation
        and newer.created_at >= v_job.created_at
    )
  then
    return pg_catalog.jsonb_build_object(
      'outcome', 'superseded',
      'canceled_count', 0,
      'delivery_count', 0,
      'revoked_count', 0,
      'cursor', nullif(v_job.cursor ->> 'value', '')
    );
  end if;

  with canceled as (
    update dashboard_private.notification_deliveries delivery
    set
      status = 'canceled',
      status_reason = 'recipient_revoked',
      next_attempt_at = null,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      resolved_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.notification_events event_row
    where delivery.event_id = event_row.id
      and event_row.workflow_key = v_job.workflow_key
      and event_row.source_type = v_job.source_type
      and event_row.source_id = v_job.source_id
      and event_row.source_revision is not distinct from v_job.source_revision
      and (
        v_job.workflow_key <> 'registration'
        or exists (
          select 1
          from dashboard_private.notification_rules rule
          where rule.id = delivery.rule_id
            and rule.audience_key = 'track_director'
            and rule.channel_key = 'in_app'
        )
      )
      and delivery.target_generation < v_job.target_generation
      and delivery.status in ('pending', 'retry_wait')
    returning delivery.id
  ), requested as (
    update dashboard_private.notification_deliveries delivery
    set
      cancel_requested_at = coalesce(
        delivery.cancel_requested_at,
        pg_catalog.clock_timestamp()
      ),
      cancel_reason = 'recipient_revoked',
      updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.notification_events event_row
    where delivery.event_id = event_row.id
      and event_row.workflow_key = v_job.workflow_key
      and event_row.source_type = v_job.source_type
      and event_row.source_id = v_job.source_id
      and event_row.source_revision is not distinct from v_job.source_revision
      and (
        v_job.workflow_key <> 'registration'
        or exists (
          select 1
          from dashboard_private.notification_rules rule
          where rule.id = delivery.rule_id
            and rule.audience_key = 'track_director'
            and rule.channel_key = 'in_app'
        )
      )
      and delivery.target_generation < v_job.target_generation
      and delivery.status = 'claimed'
    returning delivery.id
  )
  select (select pg_catalog.count(*) from canceled)
    + (select pg_catalog.count(*) from requested)
  into v_canceled;

  with revoked as (
    update public.dashboard_notifications notification
    set
      revoked_at = coalesce(notification.revoked_at, pg_catalog.clock_timestamp()),
      revoked_reason = coalesce(notification.revoked_reason, 'recipient_revoked')
    from dashboard_private.notification_deliveries delivery,
         dashboard_private.notification_events event_row
    where notification.source_delivery_id = delivery.id
      and delivery.event_id = event_row.id
      and event_row.workflow_key = v_job.workflow_key
      and event_row.source_type = v_job.source_type
      and event_row.source_id = v_job.source_id
      and event_row.source_revision is not distinct from v_job.source_revision
      and (
        v_job.workflow_key <> 'registration'
        or exists (
          select 1
          from dashboard_private.notification_rules rule
          where rule.id = delivery.rule_id
            and rule.audience_key = 'track_director'
            and rule.channel_key = 'in_app'
        )
      )
      and delivery.target_generation < v_job.target_generation
      and notification.revoked_at is null
      and notification.read_at is null
      and not exists (
        select 1
        from public.dashboard_notification_read_receipts receipt
        where receipt.notification_id = notification.id
          and receipt.profile_id = notification.recipient_profile_id
      )
    returning notification.id
  )
  select pg_catalog.count(*) into v_revoked from revoked;

  for v_delivery in
    select value
    from pg_catalog.jsonb_array_elements(p_batch -> 'deliveries')
  loop
    if pg_catalog.jsonb_typeof(v_delivery) <> 'object'
      or not (v_delivery ?& array[
        'event_id', 'rule_id', 'rule_revision', 'template_id', 'target_kind',
        'target_key', 'target_profile_id', 'connection_key', 'target_snapshot',
        'rendered_title', 'rendered_body', 'href', 'scheduled_for'
      ]::text[])
      or v_delivery - array[
        'event_id', 'rule_id', 'rule_revision', 'template_id', 'target_kind',
        'target_key', 'target_profile_id', 'connection_key', 'target_snapshot',
        'rendered_title', 'rendered_body', 'href', 'scheduled_for'
      ]::text[] <> '{}'::jsonb
      or (v_delivery ->> 'rule_revision') !~ '^[1-9][0-9]*$'
      or not exists (
        select 1
        from dashboard_private.notification_events event_row
        where event_row.id = (v_delivery ->> 'event_id')::uuid
          and event_row.workflow_key = v_job.workflow_key
          and event_row.source_type = v_job.source_type
          and event_row.source_id = v_job.source_id
          and event_row.source_revision is not distinct from v_job.source_revision
      )
    then
      raise exception 'notification_target_reconciliation_delivery_invalid'
        using errcode = '22023';
    end if;

    v_delivery_id := dashboard_private.materialize_notification_delivery_v1(
      (v_delivery ->> 'event_id')::uuid,
      (v_delivery ->> 'rule_id')::uuid,
      (v_delivery ->> 'rule_revision')::bigint,
      (v_delivery ->> 'template_id')::uuid,
      v_job.target_generation,
      v_job.current_target_set_hash,
      v_delivery ->> 'target_kind',
      v_delivery ->> 'target_key',
      case when v_delivery -> 'target_profile_id' = 'null'::jsonb then null
        else (v_delivery ->> 'target_profile_id')::uuid end,
      case when v_delivery -> 'connection_key' = 'null'::jsonb then null
        else v_delivery ->> 'connection_key' end,
      v_delivery -> 'target_snapshot',
      v_delivery ->> 'rendered_title',
      v_delivery ->> 'rendered_body',
      case when v_delivery -> 'href' = 'null'::jsonb then null
        else v_delivery ->> 'href' end,
      (v_delivery ->> 'scheduled_for')::timestamptz
    );
    perform v_delivery_id;
    v_inserted := v_inserted + 1;
  end loop;

  -- A recipient generation may have no future rule/event while every rule is disabled.
  -- A terminal empty page still completes cancellation/revocation. Non-empty pages
  -- retain the common per-event/rule canonical target-set hash verification.
  if (
      pg_catalog.jsonb_array_length(p_batch -> 'deliveries') = 0
      and not p_done
      and dashboard_private.notification_target_set_hash_v1('[]'::jsonb)
        <> v_job.current_target_set_hash
    ) or exists (
      select 1
      from (
        select pg_catalog.jsonb_agg(
          delivery.value order by delivery.ordinality
        ) as deliveries
        from pg_catalog.jsonb_array_elements(p_batch -> 'deliveries')
          with ordinality delivery(value, ordinality)
        group by
          delivery.value ->> 'event_id',
          delivery.value ->> 'rule_id',
          delivery.value ->> 'rule_revision'
      ) target_page
      where dashboard_private.notification_target_set_hash_v1(target_page.deliveries)
        <> v_job.current_target_set_hash
    )
  then
    raise exception 'notification_target_set_hash_mismatch' using errcode = '22023';
  end if;

  update dashboard_private.notification_target_reconciliation_jobs job
  set
    cursor = case when p_next_cursor is null then '{}'::jsonb
      else pg_catalog.jsonb_build_object('value', p_next_cursor) end,
    canceled_count = job.canceled_count + v_canceled,
    fanout_count = job.fanout_count + v_inserted,
    updated_at = pg_catalog.clock_timestamp()
  where job.id = v_job.id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'applied',
    'canceled_count', v_canceled,
    'delivery_count', v_inserted,
    'revoked_count', v_revoked,
    'cursor', p_next_cursor,
    'done', p_done
  );
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception 'notification_target_reconciliation_batch_invalid' using errcode = '22023';
end;
$$;

revoke all on function dashboard_private.calculate_registration_reminder_schedule_v1(text, jsonb, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_appointment_reminder_applicable_v1(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_reminder_access_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_reminder_runtime_v1()
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_appointment_track_ids_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_appointment_director_targets_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_appointment_director_target_hash_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_appointment_rule_snapshot_v1(text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_appointment_source_snapshot_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.materialize_registration_appointment_reminders_v1(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.cancel_registration_appointment_reminders_v1(uuid, text, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.preview_registration_appointment_reminders_v1(text, timestamptz, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.append_registration_notification_jobs_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_intake_runtime_dependencies_v1()
  from public, anon, authenticated, service_role;

-- Only the SECURITY DEFINER reminder wrappers may invoke the pre-existing mutation
-- implementations. Authenticated callers must not bypass event/job production.
revoke all on function dashboard_private.create_registration_case_with_initial_workflow_v1_impl(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.save_registration_shared_appointment_impl(
  uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.cancel_registration_appointment_impl(
  uuid, integer, text, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.complete_registration_level_test_attempt_impl(
  uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.complete_registration_consultation_impl(
  uuid, text, text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assign_registration_track_director_impl(
  uuid, uuid, text, text, integer, text
) from public, anon, authenticated, service_role;

revoke all on function dashboard_private.create_registration_case_with_reminders_v1_impl(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.create_registration_case_with_reminders_v1_impl(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) to authenticated;

revoke all on function dashboard_private.save_registration_shared_appointment_with_reminders_v1_impl(
  uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.save_registration_shared_appointment_with_reminders_v1_impl(
  uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text
) to authenticated;

revoke all on function dashboard_private.cancel_registration_appointment_with_reminders_v1_impl(
  uuid, integer, text, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.cancel_registration_appointment_with_reminders_v1_impl(
  uuid, integer, text, text
) to authenticated;

revoke all on function dashboard_private.complete_registration_level_test_with_reminders_v1_impl(
  uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.complete_registration_level_test_with_reminders_v1_impl(
  uuid, text, text, text
) to authenticated;

revoke all on function dashboard_private.complete_registration_consultation_with_reminders_v1_impl(
  uuid, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.complete_registration_consultation_with_reminders_v1_impl(
  uuid, text, text, uuid, text
) to authenticated;

revoke all on function dashboard_private.assign_registration_track_director_with_reminders_v1_impl(
  uuid, uuid, text, text, integer, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.assign_registration_track_director_with_reminders_v1_impl(
  uuid, uuid, text, text, integer, text
) to authenticated;

revoke execute on function public.preview_registration_appointment_reminders_v1(text, timestamptz, uuid[])
  from public, anon;
grant execute on function public.preview_registration_appointment_reminders_v1(text, timestamptz, uuid[])
  to authenticated;

revoke execute on function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) from public, anon;
grant execute on function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) to authenticated;
revoke execute on function public.save_registration_shared_appointment(
  uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text
) from public, anon;
grant execute on function public.save_registration_shared_appointment(
  uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text
) to authenticated;
revoke execute on function public.cancel_registration_appointment(uuid, integer, text, text)
  from public, anon;
grant execute on function public.cancel_registration_appointment(uuid, integer, text, text)
  to authenticated;
revoke execute on function public.complete_registration_level_test_attempt(uuid, text, text, text)
  from public, anon;
grant execute on function public.complete_registration_level_test_attempt(uuid, text, text, text)
  to authenticated;
revoke execute on function public.complete_registration_consultation(uuid, text, text, uuid, text)
  from public, anon;
grant execute on function public.complete_registration_consultation(uuid, text, text, uuid, text)
  to authenticated;
revoke execute on function public.assign_registration_track_director(uuid, uuid, text, text, integer, text)
  from public, anon;
grant execute on function public.assign_registration_track_director(uuid, uuid, text, text, integer, text)
  to authenticated;

revoke all on function public.list_registration_notification_sources_v1(jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.list_registration_notification_sources_v1(jsonb, integer)
  to service_role;
revoke all on function public.get_registration_notification_source_snapshot_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.get_registration_notification_source_snapshot_v1(uuid)
  to service_role;
revoke all on function public.list_registration_notification_target_items_v1(uuid, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.list_registration_notification_target_items_v1(uuid, jsonb, integer)
  to service_role;

create or replace function public.registration_appointment_reminders_runtime_version()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select 1;
$$;

revoke execute on function public.registration_appointment_reminders_runtime_version()
  from public, anon;
grant execute on function public.registration_appointment_reminders_runtime_version()
  to authenticated, service_role;

commit;
