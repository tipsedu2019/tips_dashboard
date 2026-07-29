begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table dashboard_private.class_schedule_cutovers
  add column if not exists source_backfill_hash text,
  add column if not exists expected_slot_rows_hash text,
  add column if not exists expected_session_rows_hash text;

create or replace function dashboard_private.continuous_class_schedule_backfill_source_hash_v1(
  p_class public.classes
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select dashboard_private.continuous_class_schedule_hash_v1(
    jsonb_build_object(
      'schedulePlan', coalesce((p_class).schedule_plan, '{}'::jsonb),
      'schedule', coalesce((p_class).schedule, ''),
      'teacher', coalesce((p_class).teacher, ''),
      'room', coalesce((p_class).room, '')
    )
  )
$$;

create or replace function dashboard_private.normalize_continuous_class_schedule_backfill_slots_v1(
  p_class_id uuid,
  p_slots jsonb
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_slot jsonb;
  v_class_id uuid;
  v_weekday smallint;
  v_start_time time;
  v_end_time time;
  v_sort_order integer;
  v_slot_key text;
  v_seen_keys text[] := '{}'::text[];
  v_normalized jsonb := '[]'::jsonb;
begin
  if p_class_id is null
    or p_slots is null
    or jsonb_typeof(p_slots) <> 'array'
  then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;
  if jsonb_array_length(p_slots) > 64 then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;

  for v_slot in
    select value
    from jsonb_array_elements(p_slots)
  loop
    if jsonb_typeof(v_slot) <> 'object'
      or v_slot
        - 'classId'
        - 'weekday'
        - 'startTime'
        - 'endTime'
        - 'teacherCatalogId'
        - 'teacherName'
        - 'classroomCatalogId'
        - 'classroomName'
        - 'sortOrder' <> '{}'::jsonb
      or not (
        v_slot ?& array[
          'classId',
          'weekday',
          'startTime',
          'endTime',
          'teacherCatalogId',
          'teacherName',
          'classroomCatalogId',
          'classroomName',
          'sortOrder'
        ]::text[]
      )
      or jsonb_typeof(v_slot -> 'classId') is distinct from 'string'
      or jsonb_typeof(v_slot -> 'weekday') is distinct from 'number'
      or jsonb_typeof(v_slot -> 'startTime') is distinct from 'string'
      or jsonb_typeof(v_slot -> 'endTime') is distinct from 'string'
      or jsonb_typeof(v_slot -> 'teacherCatalogId') is distinct from 'null'
      or jsonb_typeof(v_slot -> 'teacherName') is distinct from 'string'
      or jsonb_typeof(v_slot -> 'classroomCatalogId') is distinct from 'null'
      or jsonb_typeof(v_slot -> 'classroomName') is distinct from 'string'
      or jsonb_typeof(v_slot -> 'sortOrder') is distinct from 'number'
      or (v_slot ->> 'startTime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or (v_slot ->> 'endTime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    then
      raise exception 'class_schedule_validation' using errcode = '22023';
    end if;

    begin
      v_class_id := (v_slot ->> 'classId')::uuid;
      v_weekday := (v_slot ->> 'weekday')::smallint;
      v_start_time := (v_slot ->> 'startTime')::time;
      v_end_time := (v_slot ->> 'endTime')::time;
      v_sort_order := (v_slot ->> 'sortOrder')::integer;
    exception
      when others then
        raise exception 'class_schedule_validation' using errcode = '22023';
    end;

    if v_class_id <> p_class_id
      or v_weekday not between 0 and 6
      or v_start_time >= v_end_time
      or v_sort_order < 0
    then
      raise exception 'class_schedule_validation' using errcode = '22023';
    end if;

    v_slot_key := v_weekday::text
      || ':' || to_char(v_start_time, 'HH24:MI')
      || ':' || to_char(v_end_time, 'HH24:MI');
    if v_slot_key = any(v_seen_keys) then
      raise exception 'class_schedule_validation' using errcode = '22023';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_slot_key);

    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'classId', p_class_id,
      'weekday', v_weekday,
      'startTime', to_char(v_start_time, 'HH24:MI'),
      'endTime', to_char(v_end_time, 'HH24:MI'),
      'teacherCatalogId', null,
      'teacherName', btrim(v_slot ->> 'teacherName'),
      'classroomCatalogId', null,
      'classroomName', btrim(v_slot ->> 'classroomName'),
      'sortOrder', v_sort_order
    ));
  end loop;

  select coalesce(
    jsonb_agg(
      slot
      order by
        (slot ->> 'weekday')::integer,
        slot ->> 'startTime',
        slot ->> 'endTime',
        (slot ->> 'sortOrder')::integer
    ),
    '[]'::jsonb
  )
  into v_normalized
  from jsonb_array_elements(v_normalized) slot;

  return v_normalized;
end;
$$;

create or replace function dashboard_private.normalize_continuous_class_schedule_backfill_sessions_v1(
  p_class_id uuid,
  p_sessions jsonb
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_session jsonb;
  v_class_id uuid;
  v_session_key text;
  v_session_date date;
  v_schedule_state text;
  v_seen_keys text[] := '{}'::text[];
  v_normalized jsonb := '[]'::jsonb;
begin
  if p_class_id is null
    or p_sessions is null
    or jsonb_typeof(p_sessions) <> 'array'
  then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;
  if jsonb_array_length(p_sessions) > 10000 then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;

  for v_session in
    select value
    from jsonb_array_elements(p_sessions)
  loop
    if jsonb_typeof(v_session) <> 'object'
      or v_session
        - 'classId'
        - 'sessionKey'
        - 'sessionDate'
        - 'scheduleState'
        - 'startTime'
        - 'endTime'
        - 'teacherCatalogId'
        - 'teacherNameSnapshot'
        - 'classroomCatalogId'
        - 'classroomNameSnapshot'
        - 'memo'
        - 'origin'
        - 'legacyBillingId'
        - 'legacyBillingLabel'
        - 'legacyBillingColor' <> '{}'::jsonb
      or not (
        v_session ?& array[
          'classId',
          'sessionKey',
          'sessionDate',
          'scheduleState',
          'startTime',
          'endTime',
          'teacherCatalogId',
          'teacherNameSnapshot',
          'classroomCatalogId',
          'classroomNameSnapshot',
          'memo',
          'origin',
          'legacyBillingId',
          'legacyBillingLabel',
          'legacyBillingColor'
        ]::text[]
      )
      or jsonb_typeof(v_session -> 'classId') is distinct from 'string'
      or jsonb_typeof(v_session -> 'sessionKey') is distinct from 'string'
      or jsonb_typeof(v_session -> 'sessionDate') is distinct from 'string'
      or jsonb_typeof(v_session -> 'scheduleState') is distinct from 'string'
      or jsonb_typeof(v_session -> 'startTime') is distinct from 'null'
      or jsonb_typeof(v_session -> 'endTime') is distinct from 'null'
      or jsonb_typeof(v_session -> 'teacherCatalogId') is distinct from 'null'
      or jsonb_typeof(v_session -> 'teacherNameSnapshot') is distinct from 'string'
      or jsonb_typeof(v_session -> 'classroomCatalogId') is distinct from 'null'
      or jsonb_typeof(v_session -> 'classroomNameSnapshot') is distinct from 'string'
      or jsonb_typeof(v_session -> 'memo') is distinct from 'string'
      or jsonb_typeof(v_session -> 'origin') is distinct from 'string'
      or jsonb_typeof(v_session -> 'legacyBillingId') is distinct from 'string'
      or jsonb_typeof(v_session -> 'legacyBillingLabel') is distinct from 'string'
      or jsonb_typeof(v_session -> 'legacyBillingColor') is distinct from 'string'
      or (v_session ->> 'sessionDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    then
      raise exception 'class_schedule_validation' using errcode = '22023';
    end if;

    begin
      v_class_id := (v_session ->> 'classId')::uuid;
      v_session_date := (v_session ->> 'sessionDate')::date;
    exception
      when others then
        raise exception 'class_schedule_validation' using errcode = '22023';
    end;
    v_session_key := btrim(v_session ->> 'sessionKey');
    v_schedule_state := btrim(v_session ->> 'scheduleState');

    if v_class_id <> p_class_id
      or v_session_key = ''
      or length(v_session_key) > 512
      or v_schedule_state not in ('active', 'exception', 'makeup', 'tbd', 'skipped')
      or btrim(v_session ->> 'teacherNameSnapshot') <> ''
      or btrim(v_session ->> 'classroomNameSnapshot') <> ''
      or btrim(v_session ->> 'origin') <> 'legacy'
      or v_session_key = any(v_seen_keys)
    then
      raise exception 'class_schedule_validation' using errcode = '22023';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_session_key);

    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'classId', p_class_id,
      'sessionKey', v_session_key,
      'sessionDate', to_char(v_session_date, 'YYYY-MM-DD'),
      'scheduleState', v_schedule_state,
      'startTime', null,
      'endTime', null,
      'teacherCatalogId', null,
      'teacherNameSnapshot', '',
      'classroomCatalogId', null,
      'classroomNameSnapshot', '',
      'memo', btrim(v_session ->> 'memo'),
      'origin', 'legacy',
      'legacyBillingId', btrim(v_session ->> 'legacyBillingId'),
      'legacyBillingLabel', btrim(v_session ->> 'legacyBillingLabel'),
      'legacyBillingColor', btrim(v_session ->> 'legacyBillingColor'),
      'sourceScheduleSlotId', null,
      'makeupOfSessionId', null,
      'publicNote', '',
      'teacherNote', '',
      'revision', 0
    ));
  end loop;

  select coalesce(
    jsonb_agg(session order by session ->> 'sessionKey'),
    '[]'::jsonb
  )
  into v_normalized
  from jsonb_array_elements(v_normalized) session;

  return v_normalized;
end;
$$;

create or replace function dashboard_private.continuous_class_schedule_legacy_sessions_v1(
  p_class_id uuid,
  p_schedule_plan jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  if jsonb_typeof(coalesce(p_schedule_plan, '{}'::jsonb) -> 'sessions')
    is distinct from 'array'
  then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'classId', p_class_id,
      'sessionKey', coalesce(
        nullif(btrim(item ->> 'id'), ''),
        nullif(btrim(item ->> 'sessionId'), ''),
        nullif(btrim(item ->> 'session_id'), ''),
        ''
      ),
      'sessionDate', coalesce(
        nullif(btrim(item ->> 'date'), ''),
        nullif(btrim(item ->> 'dateValue'), ''),
        nullif(btrim(item ->> 'date_value'), ''),
        ''
      ),
      'scheduleState', coalesce(
        nullif(btrim(item ->> 'scheduleState'), ''),
        nullif(btrim(item ->> 'schedule_state'), ''),
        nullif(btrim(item ->> 'state'), ''),
        'active'
      ),
      'startTime', null,
      'endTime', null,
      'teacherCatalogId', null,
      'teacherNameSnapshot', '',
      'classroomCatalogId', null,
      'classroomNameSnapshot', '',
      'memo', btrim(coalesce(item ->> 'memo', '')),
      'origin', 'legacy',
      'legacyBillingId', coalesce(
        nullif(btrim(item ->> 'billingId'), ''),
        nullif(btrim(item ->> 'billing_id'), ''),
        ''
      ),
      'legacyBillingLabel', coalesce(
        nullif(btrim(item ->> 'billingLabel'), ''),
        nullif(btrim(item ->> 'billing_label'), ''),
        ''
      ),
      'legacyBillingColor', coalesce(
        nullif(btrim(item ->> 'billingColor'), ''),
        nullif(btrim(item ->> 'billing_color'), ''),
        ''
      )
    )),
    '[]'::jsonb
  )
  into v_payload
  from jsonb_array_elements(p_schedule_plan -> 'sessions') item
  where jsonb_typeof(item) = 'object';

  return dashboard_private.normalize_continuous_class_schedule_backfill_sessions_v1(
    p_class_id,
    v_payload
  );
end;
$$;

create or replace function dashboard_private.read_continuous_class_schedule_shadow_rows_v1(
  p_class_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slots jsonb;
  v_sessions jsonb;
begin
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'classId', slot.class_id,
        'weekday', slot.weekday,
        'startTime', to_char(slot.start_time, 'HH24:MI'),
        'endTime', to_char(slot.end_time, 'HH24:MI'),
        'teacherCatalogId', slot.teacher_catalog_id,
        'teacherName', slot.teacher_name,
        'classroomCatalogId', slot.classroom_catalog_id,
        'classroomName', slot.classroom_name,
        'sortOrder', slot.sort_order
      )
      order by slot.weekday, slot.start_time, slot.end_time, slot.sort_order
    ),
    '[]'::jsonb
  )
  into v_slots
  from public.class_schedule_slots slot
  where slot.class_id = p_class_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'classId', session.class_id,
        'sessionKey', session.session_key,
        'sessionDate', to_char(session.session_date, 'YYYY-MM-DD'),
        'scheduleState', session.schedule_state,
        'startTime', case
          when session.start_time is null then null
          else to_char(session.start_time, 'HH24:MI')
        end,
        'endTime', case
          when session.end_time is null then null
          else to_char(session.end_time, 'HH24:MI')
        end,
        'teacherCatalogId', session.teacher_catalog_id,
        'teacherNameSnapshot', session.teacher_name_snapshot,
        'classroomCatalogId', session.classroom_catalog_id,
        'classroomNameSnapshot', session.classroom_name_snapshot,
        'memo', session.memo,
        'origin', session.origin,
        'legacyBillingId', session.legacy_billing_id,
        'legacyBillingLabel', session.legacy_billing_label,
        'legacyBillingColor', session.legacy_billing_color,
        'sourceScheduleSlotId', session.source_schedule_slot_id,
        'makeupOfSessionId', session.makeup_of_session_id,
        'publicNote', session.public_note,
        'teacherNote', session.teacher_note,
        'revision', session.revision
      )
      order by session.session_key
    ),
    '[]'::jsonb
  )
  into v_sessions
  from public.class_lesson_sessions session
  where session.class_id = p_class_id;

  return jsonb_build_object('slots', v_slots, 'sessions', v_sessions);
end;
$$;

create or replace function dashboard_private.build_continuous_class_schedule_plan_v1(
  p_class_id uuid,
  p_base_plan jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan jsonb := coalesce(p_base_plan, '{}'::jsonb);
  v_sessions jsonb;
  v_index integer;
  v_item jsonb;
  v_patch jsonb;
  v_found boolean;
  v_session record;
begin
  if jsonb_typeof(v_plan -> 'sessions') <> 'array' then
    v_sessions := '[]'::jsonb;
  else
    v_sessions := v_plan -> 'sessions';
  end if;

  for v_session in
    select *
    from public.class_lesson_sessions
    where class_id = p_class_id
    order by session_date, start_time nulls last, session_key
  loop
    v_patch := jsonb_build_object(
      'id', v_session.session_key,
      'date', v_session.session_date,
      'scheduleState', v_session.schedule_state,
      'startTime', v_session.start_time,
      'endTime', v_session.end_time,
      'teacherCatalogId', v_session.teacher_catalog_id,
      'teacherName', v_session.teacher_name_snapshot,
      'classroomCatalogId', v_session.classroom_catalog_id,
      'classroomName', v_session.classroom_name_snapshot,
      'memo', v_session.memo,
      'publicNote', v_session.public_note,
      'teacherNote', v_session.teacher_note,
      'revision', v_session.revision,
      'legacyBillingId', v_session.legacy_billing_id,
      'legacyBillingLabel', v_session.legacy_billing_label,
      'legacyBillingColor', v_session.legacy_billing_color
    );
    v_found := false;
    for v_index in 0..greatest(jsonb_array_length(v_sessions) - 1, 0)
    loop
      exit when jsonb_array_length(v_sessions) = 0;
      v_item := v_sessions -> v_index;
      if coalesce(
        nullif(btrim(v_item ->> 'id'), ''),
        nullif(btrim(v_item ->> 'sessionKey'), ''),
        nullif(btrim(v_item ->> 'session_key'), '')
      ) = v_session.session_key
      then
        v_sessions := jsonb_set(
          v_sessions,
          array[v_index::text],
          v_item || v_patch,
          false
        );
        v_found := true;
        exit;
      end if;
    end loop;
    if not v_found then
      v_sessions := v_sessions || jsonb_build_array(v_patch);
    end if;
  end loop;

  return jsonb_set(v_plan, '{sessions}', v_sessions, true);
end;
$$;

create or replace function public.backfill_class_schedule_shadow_v1(
  p_class_id uuid,
  p_expected_source_hash text,
  p_slots jsonb,
  p_sessions jsonb,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.classes%rowtype;
  v_hash text;
  v_replay jsonb;
  v_actor uuid;
  v_slots jsonb;
  v_sessions jsonb;
  v_expected_sessions jsonb;
  v_actual jsonb;
  v_projection_hash text;
  v_source_defaults_hash text;
  v_source_schedule_plan_hash text;
  v_slot_rows_hash text;
  v_session_rows_hash text;
  v_response jsonb;
begin
  v_actor := dashboard_private.assert_continuous_class_schedule_actor_v1(true);
  if nullif(btrim(coalesce(p_expected_source_hash, '')), '') is null
    or p_request_key is null
  then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;

  v_slots := dashboard_private.normalize_continuous_class_schedule_backfill_slots_v1(
    p_class_id,
    p_slots
  );
  v_sessions := dashboard_private.normalize_continuous_class_schedule_backfill_sessions_v1(
    p_class_id,
    p_sessions
  );
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(
    jsonb_build_object(
      'classId', p_class_id,
      'sourceHash', p_expected_source_hash,
      'slots', v_slots,
      'sessions', v_sessions
    )
  );
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1(
    'backfill_class_schedule_shadow_v1',
    p_request_key,
    v_hash
  );
  if v_replay is not null then
    return v_replay;
  end if;

  select *
  into v_class
  from public.classes
  where id = p_class_id
  for update;
  if not found then
    raise exception 'class_schedule_not_found' using errcode = 'P0002';
  end if;
  if v_class.schedule_storage_mode not in ('legacy', 'shadow')
    or dashboard_private.continuous_class_schedule_backfill_source_hash_v1(
      v_class
    ) <> p_expected_source_hash
  then
    raise exception 'class_schedule_stale' using errcode = '40001';
  end if;
  if exists (
    select 1
    from dashboard_private.class_schedule_cutovers cutover
    where cutover.class_id = p_class_id
      and cutover.activated_at is not null
  ) then
    raise exception 'class_schedule_already_activated' using errcode = '22023';
  end if;

  v_expected_sessions :=
    dashboard_private.continuous_class_schedule_legacy_sessions_v1(
      p_class_id,
      coalesce(v_class.schedule_plan, '{}'::jsonb)
    );
  if v_sessions is distinct from v_expected_sessions then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;

  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    p_class_id,
    p_request_key,
    'backfill_class_schedule_shadow_v1'
  );

  insert into public.class_lesson_sessions as existing (
    class_id,
    session_key,
    source_schedule_slot_id,
    session_date,
    schedule_state,
    start_time,
    end_time,
    teacher_catalog_id,
    teacher_name_snapshot,
    classroom_catalog_id,
    classroom_name_snapshot,
    origin,
    makeup_of_session_id,
    legacy_billing_id,
    legacy_billing_label,
    legacy_billing_color,
    memo,
    public_note,
    teacher_note,
    revision,
    created_by,
    updated_by
  )
  select
    p_class_id,
    session ->> 'sessionKey',
    null,
    (session ->> 'sessionDate')::date,
    session ->> 'scheduleState',
    null,
    null,
    null,
    '',
    null,
    '',
    'legacy',
    null,
    session ->> 'legacyBillingId',
    session ->> 'legacyBillingLabel',
    session ->> 'legacyBillingColor',
    session ->> 'memo',
    '',
    '',
    0,
    v_actor,
    v_actor
  from jsonb_array_elements(v_sessions) session
  on conflict (class_id, session_key) do update
  set source_schedule_slot_id = null,
      session_date = excluded.session_date,
      schedule_state = excluded.schedule_state,
      start_time = null,
      end_time = null,
      teacher_catalog_id = null,
      teacher_name_snapshot = '',
      classroom_catalog_id = null,
      classroom_name_snapshot = '',
      origin = 'legacy',
      makeup_of_session_id = null,
      legacy_billing_id = excluded.legacy_billing_id,
      legacy_billing_label = excluded.legacy_billing_label,
      legacy_billing_color = excluded.legacy_billing_color,
      memo = excluded.memo,
      public_note = '',
      teacher_note = '',
      revision = 0,
      updated_by = excluded.updated_by
  where existing.source_schedule_slot_id is not null
    or existing.session_date is distinct from excluded.session_date
    or existing.schedule_state is distinct from excluded.schedule_state
    or existing.start_time is not null
    or existing.end_time is not null
    or existing.teacher_catalog_id is not null
    or existing.teacher_name_snapshot is distinct from ''
    or existing.classroom_catalog_id is not null
    or existing.classroom_name_snapshot is distinct from ''
    or existing.origin is distinct from 'legacy'
    or existing.makeup_of_session_id is not null
    or existing.legacy_billing_id is distinct from excluded.legacy_billing_id
    or existing.legacy_billing_label is distinct from excluded.legacy_billing_label
    or existing.legacy_billing_color is distinct from excluded.legacy_billing_color
    or existing.memo is distinct from excluded.memo
    or existing.public_note is distinct from ''
    or existing.teacher_note is distinct from ''
    or existing.revision is distinct from 0;

  delete from public.class_lesson_sessions session
  where session.class_id = p_class_id
    and not exists (
      select 1
      from jsonb_array_elements(v_sessions) expected
      where expected ->> 'sessionKey' = session.session_key
    );

  insert into public.class_schedule_slots as existing (
    class_id,
    weekday,
    start_time,
    end_time,
    teacher_catalog_id,
    teacher_name,
    classroom_catalog_id,
    classroom_name,
    sort_order
  )
  select
    p_class_id,
    (slot ->> 'weekday')::smallint,
    (slot ->> 'startTime')::time,
    (slot ->> 'endTime')::time,
    null,
    slot ->> 'teacherName',
    null,
    slot ->> 'classroomName',
    (slot ->> 'sortOrder')::integer
  from jsonb_array_elements(v_slots) slot
  on conflict (class_id, weekday, start_time, end_time) do update
  set teacher_catalog_id = null,
      teacher_name = excluded.teacher_name,
      classroom_catalog_id = null,
      classroom_name = excluded.classroom_name,
      sort_order = excluded.sort_order
  where existing.teacher_catalog_id is not null
    or existing.teacher_name is distinct from excluded.teacher_name
    or existing.classroom_catalog_id is not null
    or existing.classroom_name is distinct from excluded.classroom_name
    or existing.sort_order is distinct from excluded.sort_order;

  delete from public.class_schedule_slots slot
  where slot.class_id = p_class_id
    and not exists (
      select 1
      from jsonb_array_elements(v_slots) expected
      where (expected ->> 'weekday')::smallint = slot.weekday
        and (expected ->> 'startTime')::time = slot.start_time
        and (expected ->> 'endTime')::time = slot.end_time
    );

  v_actual :=
    dashboard_private.read_continuous_class_schedule_shadow_rows_v1(p_class_id);
  if v_actual -> 'slots' is distinct from v_slots
    or v_actual -> 'sessions' is distinct from v_sessions
  then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;

  v_slot_rows_hash := dashboard_private.continuous_class_schedule_hash_v1(
    v_actual -> 'slots'
  );
  v_session_rows_hash := dashboard_private.continuous_class_schedule_hash_v1(
    v_actual -> 'sessions'
  );
  v_projection_hash := dashboard_private.continuous_class_schedule_hash_v1(
    dashboard_private.build_continuous_class_schedule_plan_v1(
      p_class_id,
      coalesce(v_class.schedule_plan, '{}'::jsonb)
    )
  );
  v_source_schedule_plan_hash :=
    dashboard_private.continuous_class_schedule_hash_v1(
      coalesce(v_class.schedule_plan, '{}'::jsonb)
    );
  v_source_defaults_hash := dashboard_private.continuous_class_schedule_hash_v1(
    jsonb_build_object(
      'schedule', coalesce(v_class.schedule, ''),
      'teacher', coalesce(v_class.teacher, ''),
      'room', coalesce(v_class.room, '')
    )
  );

  update public.classes
  set schedule_storage_mode = 'shadow'
  where id = p_class_id
    and schedule_storage_mode is distinct from 'shadow';

  insert into dashboard_private.class_schedule_cutovers (
    class_id,
    from_runtime_version,
    to_runtime_version,
    request_key,
    source_schedule_plan_hash,
    source_backfill_hash,
    projected_schedule_plan_hash,
    expected_slot_rows_hash,
    expected_session_rows_hash,
    slot_count,
    session_count,
    issue_codes,
    status,
    detail
  )
  values (
    p_class_id,
    public.continuous_class_schedule_runtime_version(),
    public.continuous_class_schedule_runtime_version(),
    p_request_key,
    v_source_schedule_plan_hash,
    p_expected_source_hash,
    v_projection_hash,
    v_slot_rows_hash,
    v_session_rows_hash,
    jsonb_array_length(v_actual -> 'slots'),
    jsonb_array_length(v_actual -> 'sessions'),
    '{}'::text[],
    'prepared',
    jsonb_build_object(
      'backfillOnly', true,
      'sourceDefaultsHash', v_source_defaults_hash
    )
  );

  v_response := jsonb_build_object(
    'storageMode', 'shadow',
    'sourceHash', p_expected_source_hash,
    'slotCount', jsonb_array_length(v_actual -> 'slots'),
    'sessionCount', jsonb_array_length(v_actual -> 'sessions'),
    'projectionHash', v_projection_hash,
    'issueCodes', '[]'::jsonb
  );
  return dashboard_private.record_continuous_class_schedule_receipt_v1(
    'backfill_class_schedule_shadow_v1',
    p_request_key,
    v_hash,
    v_response
  );
end;
$$;

create or replace function public.verify_class_schedule_shadow_v1(
  p_class_id uuid,
  p_expected_source_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.classes%rowtype;
  v_cutover dashboard_private.class_schedule_cutovers%rowtype;
  v_source_hash text;
  v_source_defaults_hash text;
  v_actual jsonb;
  v_slot_rows_hash text;
  v_session_rows_hash text;
  v_projection_hash text;
  v_issue_codes text[] := '{}'::text[];
begin
  perform dashboard_private.assert_continuous_class_schedule_actor_v1(true);
  select *
  into v_class
  from public.classes
  where id = p_class_id
  for update;
  if not found then
    raise exception 'class_schedule_not_found' using errcode = 'P0002';
  end if;
  if v_class.schedule_storage_mode <> 'shadow' then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;

  v_source_hash :=
    dashboard_private.continuous_class_schedule_backfill_source_hash_v1(
      v_class
    );
  if v_source_hash <> p_expected_source_hash then
    raise exception 'class_schedule_stale' using errcode = '40001';
  end if;

  select *
  into v_cutover
  from dashboard_private.class_schedule_cutovers cutover
  where cutover.class_id = p_class_id
    and cutover.source_backfill_hash = p_expected_source_hash
    and cutover.activated_at is null
  order by cutover.created_at desc, cutover.id desc
  limit 1
  for update;
  if not found then
    raise exception 'class_schedule_not_found' using errcode = 'P0002';
  end if;

  v_actual :=
    dashboard_private.read_continuous_class_schedule_shadow_rows_v1(p_class_id);
  v_slot_rows_hash := dashboard_private.continuous_class_schedule_hash_v1(
    v_actual -> 'slots'
  );
  v_session_rows_hash := dashboard_private.continuous_class_schedule_hash_v1(
    v_actual -> 'sessions'
  );
  v_projection_hash := dashboard_private.continuous_class_schedule_hash_v1(
    dashboard_private.build_continuous_class_schedule_plan_v1(
      p_class_id,
      coalesce(v_class.schedule_plan, '{}'::jsonb)
    )
  );
  v_source_defaults_hash := dashboard_private.continuous_class_schedule_hash_v1(
    jsonb_build_object(
      'schedule', coalesce(v_class.schedule, ''),
      'teacher', coalesce(v_class.teacher, ''),
      'room', coalesce(v_class.room, '')
    )
  );

  if jsonb_array_length(v_actual -> 'slots') <> v_cutover.slot_count then
    v_issue_codes := array_append(v_issue_codes, 'slot_count_mismatch');
  end if;
  if jsonb_array_length(v_actual -> 'sessions') <> v_cutover.session_count then
    v_issue_codes := array_append(v_issue_codes, 'session_count_mismatch');
  end if;
  if v_slot_rows_hash is distinct from v_cutover.expected_slot_rows_hash then
    v_issue_codes := array_append(v_issue_codes, 'slot_payload_mismatch');
  end if;
  if v_session_rows_hash is distinct from v_cutover.expected_session_rows_hash then
    v_issue_codes := array_append(v_issue_codes, 'session_payload_mismatch');
  end if;
  if v_projection_hash is distinct from v_cutover.projected_schedule_plan_hash then
    v_issue_codes := array_append(v_issue_codes, 'projection_mismatch');
  end if;
  if v_source_defaults_hash is distinct from
    (v_cutover.detail ->> 'sourceDefaultsHash')
  then
    v_issue_codes := array_append(v_issue_codes, 'source_defaults_mismatch');
  end if;

  update dashboard_private.class_schedule_cutovers
  set verified_at = now(),
      verified_by = auth.uid(),
      issue_codes = v_issue_codes,
      status = case
        when cardinality(v_issue_codes) = 0 then 'applied'
        else 'failed'
      end,
      detail = detail || jsonb_build_object(
        'lastVerifiedSlotRowsHash', v_slot_rows_hash,
        'lastVerifiedSessionRowsHash', v_session_rows_hash,
        'lastVerifiedProjectionHash', v_projection_hash,
        'lastVerifiedSourceDefaultsHash', v_source_defaults_hash
      )
  where id = v_cutover.id;

  return jsonb_build_object(
    'matches', cardinality(v_issue_codes) = 0,
    'sourceHash', v_source_hash,
    'projectionHash', v_projection_hash,
    'slotCount', jsonb_array_length(v_actual -> 'slots'),
    'sessionCount', jsonb_array_length(v_actual -> 'sessions'),
    'issueCodes', to_jsonb(v_issue_codes)
  );
end;
$$;

create or replace function public.activate_class_schedule_storage_v1(
  p_class_id uuid,
  p_expected_schedule_revision bigint,
  p_expected_source_hash text,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.classes%rowtype;
  v_hash text;
  v_replay jsonb;
  v_verification jsonb;
  v_cutover_id uuid;
  v_response jsonb;
begin
  perform dashboard_private.assert_continuous_class_schedule_actor_v1(true);
  v_hash := dashboard_private.continuous_class_schedule_hash_v1(
    jsonb_build_object(
      'classId', p_class_id,
      'revision', p_expected_schedule_revision,
      'sourceHash', p_expected_source_hash
    )
  );
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1(
    'activate_class_schedule_storage_v1',
    p_request_key,
    v_hash
  );
  if v_replay is not null then
    return v_replay;
  end if;

  select *
  into v_class
  from public.classes
  where id = p_class_id
  for update;
  if not found
    or v_class.schedule_storage_mode <> 'shadow'
    or v_class.schedule_revision <> p_expected_schedule_revision
  then
    raise exception 'class_schedule_stale' using errcode = '40001';
  end if;
  if public.continuous_class_schedule_runtime_version() <> 1 then
    raise exception 'continuous_class_schedule_runtime_not_ready'
      using errcode = 'P0001';
  end if;

  v_verification := public.verify_class_schedule_shadow_v1(
    p_class_id,
    p_expected_source_hash
  );
  if (v_verification ->> 'matches')::boolean is distinct from true then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;

  select cutover.id
  into v_cutover_id
  from dashboard_private.class_schedule_cutovers cutover
  where cutover.class_id = p_class_id
    and cutover.source_backfill_hash = p_expected_source_hash
    and cutover.activated_at is null
    and cutover.status = 'applied'
    and cutover.verified_at is not null
    and cutover.issue_codes = '{}'::text[]
  order by cutover.created_at desc, cutover.id desc
  limit 1
  for update;
  if not found then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;

  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    p_class_id,
    p_request_key,
    'activate_class_schedule_storage_v1'
  );
  update public.classes
  set schedule_storage_mode = 'normalized'
  where id = p_class_id;
  update dashboard_private.class_schedule_cutovers
  set activated_at = now(),
      activated_by = auth.uid(),
      status = 'applied'
  where id = v_cutover_id;

  v_response := jsonb_build_object(
    'storageMode', 'normalized',
    'scheduleRevision', v_class.schedule_revision,
    'projectionHash', v_verification ->> 'projectionHash'
  );
  return dashboard_private.record_continuous_class_schedule_receipt_v1(
    'activate_class_schedule_storage_v1',
    p_request_key,
    v_hash,
    v_response
  );
end;
$$;

revoke all on function dashboard_private.normalize_continuous_class_schedule_backfill_slots_v1(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.continuous_class_schedule_backfill_source_hash_v1(public.classes)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.normalize_continuous_class_schedule_backfill_sessions_v1(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.continuous_class_schedule_legacy_sessions_v1(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.read_continuous_class_schedule_shadow_rows_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.build_continuous_class_schedule_plan_v1(uuid, jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.backfill_class_schedule_shadow_v1(uuid, text, jsonb, jsonb, uuid)
  from public, anon;
revoke all on function public.verify_class_schedule_shadow_v1(uuid, text)
  from public, anon;
revoke all on function public.activate_class_schedule_storage_v1(uuid, bigint, text, uuid)
  from public, anon;
grant execute on function public.backfill_class_schedule_shadow_v1(uuid, text, jsonb, jsonb, uuid)
  to authenticated;
grant execute on function public.verify_class_schedule_shadow_v1(uuid, text)
  to authenticated;
grant execute on function public.activate_class_schedule_storage_v1(uuid, bigint, text, uuid)
  to authenticated;

commit;
