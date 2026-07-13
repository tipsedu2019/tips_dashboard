begin;

-- Registration subject-track mutation foundation.
-- This migration remains intentionally unapplied until every public mutation,
-- runtime adapter, readiness gate, and database verification fixture is complete.

create table dashboard_private.ops_registration_verification_checkpoints (
  operation_kind text not null check (operation_kind in (
    'admission_batch_before_first_claim',
    'current_class_wait_before_materialization',
    'withdrawal_after_parent_snapshot',
    'withdrawal_before_status_flip'
  )),
  task_id uuid not null,
  student_id uuid not null,
  armed_at timestamptz not null,
  expires_at timestamptz not null,
  released_at timestamptz,
  primary key (operation_kind, task_id, student_id),
  check (
    expires_at > armed_at
    and expires_at <= armed_at + interval '12 seconds'
    and (released_at is null or released_at >= armed_at)
  )
);

alter table dashboard_private.ops_registration_verification_checkpoints
  enable row level security;
revoke all on table dashboard_private.ops_registration_verification_checkpoints
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.registration_verification_checkpoint_lock_key(
  p_operation_kind text,
  p_task_id uuid,
  p_student_id uuid
)
returns bigint
language sql
immutable
security definer
set search_path = ''
as $$
  select pg_catalog.hashtextextended(
    'registration-verification-checkpoint:'
      || p_operation_kind || ':' || p_task_id::text || ':' || p_student_id::text,
    0
  );
$$;

alter function dashboard_private.registration_verification_checkpoint_lock_key(text, uuid, uuid)
  owner to postgres;
revoke execute on function dashboard_private.registration_verification_checkpoint_lock_key(text, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.await_registration_verification_checkpoint(
  p_operation_kind text,
  p_task_id uuid,
  p_student_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released_at timestamptz;
  v_expires_at timestamptz;
  v_lock_key bigint;
  v_lock_acquired boolean := false;
begin
  select checkpoint.released_at, checkpoint.expires_at
  into v_released_at, v_expires_at
  from dashboard_private.ops_registration_verification_checkpoints checkpoint
  where checkpoint.operation_kind = p_operation_kind
    and checkpoint.task_id = p_task_id
    and checkpoint.student_id = p_student_id;
  if not found or v_released_at is not null then
    return;
  end if;
  if pg_catalog.clock_timestamp() >= v_expires_at then
    raise exception 'registration_verification_checkpoint_timeout' using errcode = '57014';
  end if;

  v_lock_key := dashboard_private.registration_verification_checkpoint_lock_key(
    p_operation_kind, p_task_id, p_student_id
  );

  loop
    v_lock_acquired := pg_catalog.pg_try_advisory_xact_lock(v_lock_key);
    exit when v_lock_acquired;

    select checkpoint.released_at, checkpoint.expires_at
    into v_released_at, v_expires_at
    from dashboard_private.ops_registration_verification_checkpoints checkpoint
    where checkpoint.operation_kind = p_operation_kind
      and checkpoint.task_id = p_task_id
      and checkpoint.student_id = p_student_id;
    if not found then
      raise exception 'registration_verification_checkpoint_disarmed' using errcode = '57014';
    end if;
    if v_released_at is not null then
      return;
    end if;
    if pg_catalog.clock_timestamp() >= v_expires_at then
      raise exception 'registration_verification_checkpoint_timeout' using errcode = '57014';
    end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;

  loop
    select checkpoint.released_at, checkpoint.expires_at
    into v_released_at, v_expires_at
    from dashboard_private.ops_registration_verification_checkpoints checkpoint
    where checkpoint.operation_kind = p_operation_kind
      and checkpoint.task_id = p_task_id
      and checkpoint.student_id = p_student_id;
    if not found then
      raise exception 'registration_verification_checkpoint_disarmed' using errcode = '57014';
    end if;
    if v_released_at is not null then
      return;
    end if;
    if pg_catalog.clock_timestamp() >= v_expires_at then
      raise exception 'registration_verification_checkpoint_timeout' using errcode = '57014';
    end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;
end;
$$;

alter function dashboard_private.await_registration_verification_checkpoint(text, uuid, uuid)
  owner to postgres;
revoke execute on function dashboard_private.await_registration_verification_checkpoint(text, uuid, uuid)
  from public, anon, authenticated, service_role;

create function dashboard_private.arm_registration_verification_checkpoint_impl(
  p_operation_kind text,
  p_task_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if auth.role() <> 'service_role' then
    raise exception 'registration_service_role_required' using errcode = '42501';
  end if;
  if p_operation_kind not in (
    'admission_batch_before_first_claim',
    'current_class_wait_before_materialization',
    'withdrawal_after_parent_snapshot',
    'withdrawal_before_status_flip'
  ) then
    raise exception 'registration_verification_checkpoint_kind_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.ops_tasks task
    join public.students student on student.id = p_student_id
    where task.id = p_task_id
      and task.student_id = p_student_id
      and task.type = case
        when p_operation_kind in (
          'withdrawal_after_parent_snapshot',
          'withdrawal_before_status_flip'
        ) then 'withdrawal'
        else 'registration'
      end
      and task.status = 'in_progress'
      and student.status <> '퇴원'
      and task.memo like '[codex-registration-race-%'
      and student.name like '[codex-registration-race-%'
      and pg_catalog.split_part(task.memo, ']', 1)
        = pg_catalog.split_part(student.name, ']', 1)
  ) then
    raise exception 'registration_verification_fixture_scope_required' using errcode = '42501';
  end if;

  insert into dashboard_private.ops_registration_verification_checkpoints(
    operation_kind, task_id, student_id, armed_at, expires_at, released_at
  ) values (
    p_operation_kind, p_task_id, p_student_id,
    v_now, v_now + interval '12 seconds', null
  )
  on conflict (operation_kind, task_id, student_id) do update
  set
    armed_at = excluded.armed_at,
    expires_at = excluded.expires_at,
    released_at = null;

  return pg_catalog.jsonb_build_object(
    'operationKind', p_operation_kind,
    'taskId', p_task_id,
    'studentId', p_student_id,
    'status', 'armed'
  );
end;
$$;

alter function dashboard_private.arm_registration_verification_checkpoint_impl(text, uuid, uuid)
  owner to postgres;
revoke execute on function dashboard_private.arm_registration_verification_checkpoint_impl(text, uuid, uuid)
  from public, anon, authenticated;
grant usage on schema dashboard_private to service_role;
grant execute on function dashboard_private.arm_registration_verification_checkpoint_impl(text, uuid, uuid)
  to service_role;

create function public.arm_registration_verification_checkpoint(
  p_operation_kind text,
  p_task_id uuid,
  p_student_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.arm_registration_verification_checkpoint_impl(
    p_operation_kind, p_task_id, p_student_id
  );
$$;

revoke execute on function public.arm_registration_verification_checkpoint(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.arm_registration_verification_checkpoint(text, uuid, uuid)
  to service_role;

create function dashboard_private.wait_registration_verification_checkpoint_reached_impl(
  p_operation_kind text,
  p_task_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released_at timestamptz;
  v_expires_at timestamptz;
  v_wait_deadline timestamptz := pg_catalog.clock_timestamp() + interval '2 seconds';
  v_lock_key bigint;
  v_lock_acquired boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'registration_service_role_required' using errcode = '42501';
  end if;
  v_lock_key := dashboard_private.registration_verification_checkpoint_lock_key(
    p_operation_kind, p_task_id, p_student_id
  );

  loop
    select checkpoint.released_at, checkpoint.expires_at
    into v_released_at, v_expires_at
    from dashboard_private.ops_registration_verification_checkpoints checkpoint
    where checkpoint.operation_kind = p_operation_kind
      and checkpoint.task_id = p_task_id
      and checkpoint.student_id = p_student_id;
    if not found then
      raise exception 'registration_verification_checkpoint_not_armed' using errcode = '55000';
    end if;
    if v_released_at is not null then
      raise exception 'registration_verification_checkpoint_already_released' using errcode = '55000';
    end if;
    if pg_catalog.clock_timestamp() >= v_expires_at then
      raise exception 'registration_verification_checkpoint_timeout' using errcode = '57014';
    end if;

    v_lock_acquired := pg_catalog.pg_try_advisory_lock(v_lock_key);
    if not v_lock_acquired then
      return pg_catalog.jsonb_build_object(
        'operationKind', p_operation_kind,
        'taskId', p_task_id,
        'studentId', p_student_id,
        'status', 'reached'
      );
    end if;
    perform pg_catalog.pg_advisory_unlock(v_lock_key);
    v_lock_acquired := false;

    if pg_catalog.clock_timestamp() >= v_wait_deadline then
      raise exception 'registration_verification_checkpoint_not_reached' using errcode = '57014';
    end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;
exception
  when query_canceled then
    if v_lock_acquired then
      perform pg_catalog.pg_advisory_unlock(v_lock_key);
    end if;
    raise;
  when others then
    if v_lock_acquired then
      perform pg_catalog.pg_advisory_unlock(v_lock_key);
    end if;
    raise;
end;
$$;

alter function dashboard_private.wait_registration_verification_checkpoint_reached_impl(text, uuid, uuid)
  owner to postgres;
revoke execute on function dashboard_private.wait_registration_verification_checkpoint_reached_impl(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function dashboard_private.wait_registration_verification_checkpoint_reached_impl(text, uuid, uuid)
  to service_role;

create function public.wait_registration_verification_checkpoint_reached(
  p_operation_kind text,
  p_task_id uuid,
  p_student_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.wait_registration_verification_checkpoint_reached_impl(
    p_operation_kind, p_task_id, p_student_id
  );
$$;

revoke execute on function public.wait_registration_verification_checkpoint_reached(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.wait_registration_verification_checkpoint_reached(text, uuid, uuid)
  to service_role;

create function dashboard_private.release_registration_verification_checkpoint_impl(
  p_operation_kind text,
  p_task_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'registration_service_role_required' using errcode = '42501';
  end if;
  update dashboard_private.ops_registration_verification_checkpoints checkpoint
  set released_at = pg_catalog.clock_timestamp()
  where checkpoint.operation_kind = p_operation_kind
    and checkpoint.task_id = p_task_id
    and checkpoint.student_id = p_student_id
    and checkpoint.released_at is null
    and checkpoint.expires_at > pg_catalog.clock_timestamp();
  if not found then
    raise exception 'registration_verification_checkpoint_not_armed' using errcode = '55000';
  end if;
  return pg_catalog.jsonb_build_object(
    'operationKind', p_operation_kind,
    'taskId', p_task_id,
    'studentId', p_student_id,
    'status', 'released'
  );
end;
$$;

alter function dashboard_private.release_registration_verification_checkpoint_impl(text, uuid, uuid)
  owner to postgres;
revoke execute on function dashboard_private.release_registration_verification_checkpoint_impl(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function dashboard_private.release_registration_verification_checkpoint_impl(text, uuid, uuid)
  to service_role;

create function public.release_registration_verification_checkpoint(
  p_operation_kind text,
  p_task_id uuid,
  p_student_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.release_registration_verification_checkpoint_impl(
    p_operation_kind, p_task_id, p_student_id
  );
$$;

revoke execute on function public.release_registration_verification_checkpoint(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_registration_verification_checkpoint(text, uuid, uuid)
  to service_role;

create function dashboard_private.disarm_registration_verification_checkpoint_impl(
  p_operation_kind text,
  p_task_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'registration_service_role_required' using errcode = '42501';
  end if;
  delete from dashboard_private.ops_registration_verification_checkpoints checkpoint
  where checkpoint.operation_kind = p_operation_kind
    and checkpoint.task_id = p_task_id
    and checkpoint.student_id = p_student_id;
  v_removed := found;
  return pg_catalog.jsonb_build_object(
    'operationKind', p_operation_kind,
    'taskId', p_task_id,
    'studentId', p_student_id,
    'status', case when v_removed then 'disarmed' else 'missing' end
  );
end;
$$;

alter function dashboard_private.disarm_registration_verification_checkpoint_impl(text, uuid, uuid)
  owner to postgres;
revoke execute on function dashboard_private.disarm_registration_verification_checkpoint_impl(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function dashboard_private.disarm_registration_verification_checkpoint_impl(text, uuid, uuid)
  to service_role;

create function public.disarm_registration_verification_checkpoint(
  p_operation_kind text,
  p_task_id uuid,
  p_student_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.disarm_registration_verification_checkpoint_impl(
    p_operation_kind, p_task_id, p_student_id
  );
$$;

revoke execute on function public.disarm_registration_verification_checkpoint(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.disarm_registration_verification_checkpoint(text, uuid, uuid)
  to service_role;

create or replace function dashboard_private.assert_registration_mutation_access(
  p_task_id uuid,
  p_track_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  if p_action in (
    'complete_withdrawal_roster_transition',
    'complete_transfer_roster_transition'
  ) then
    if p_track_id is not null
      or not exists (
        select 1
        from public.ops_tasks task
        where task.id = p_task_id
          and (
            (p_action = 'complete_withdrawal_roster_transition' and task.type = 'withdrawal')
            or (p_action = 'complete_transfer_roster_transition' and task.type = 'transfer')
          )
      )
      or coalesce(public.current_dashboard_role(), '') not in ('admin', 'staff')
    then
      raise exception 'registration_access_denied' using errcode = '42501';
    end if;
    return;
  end if;

  if not exists (
    select 1
    from public.ops_tasks task
    where task.id = p_task_id
      and task.type = 'registration'
  ) then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  if p_track_id is not null and not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.id = p_track_id
      and track.task_id = p_task_id
  ) then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  if p_action = 'complete_consultation' then
    if public.current_dashboard_role() = 'admin' and exists (
      select 1
      from public.ops_registration_subject_tracks track
      where track.id = p_track_id
        and track.task_id = p_task_id
        and track.director_profile_id = (select auth.uid())
    ) then
      return;
    end if;
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  if public.current_dashboard_role() in ('admin', 'staff') then
    return;
  end if;

  raise exception 'registration_access_denied' using errcode = '42501';
end;
$$;

alter function dashboard_private.assert_registration_mutation_access(uuid, uuid, text)
  owner to postgres;
revoke execute on function dashboard_private.assert_registration_mutation_access(uuid, uuid, text)
  from public, anon, authenticated;

create or replace function dashboard_private.validate_registration_class_session(
  p_class_id uuid,
  p_date date,
  p_session_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  v_sessions jsonb;
  v_session jsonb;
  v_state text;
  v_date_text text;
  v_number_text text;
  v_session_date date;
  v_session_number integer;
  v_canonical_key text;
begin
  select to_jsonb(class.schedule_plan)
  into v_plan
  from public.classes class
  where class.id = p_class_id;

  if not found or p_date is null or nullif(pg_catalog.btrim(p_session_key), '') is null then
    return pg_catalog.jsonb_build_object(
      'valid', false,
      'sessionDate', null,
      'sessionKey', null,
      'sessionLabel', null
    );
  end if;

  v_sessions := case
    when pg_catalog.jsonb_typeof(v_plan -> 'sessions') = 'array' then v_plan -> 'sessions'
    when pg_catalog.jsonb_typeof(v_plan -> 'session_list') = 'array' then v_plan -> 'session_list'
    else '[]'::jsonb
  end;

  for v_session in
    select item.value
    from pg_catalog.jsonb_array_elements(v_sessions) item(value)
  loop
    v_state := pg_catalog.lower(coalesce(
      nullif(pg_catalog.btrim(v_session ->> 'scheduleState'), ''),
      nullif(pg_catalog.btrim(v_session ->> 'schedule_state'), ''),
      nullif(pg_catalog.btrim(v_session ->> 'state'), ''),
      'active'
    ));
    if v_state not in ('active', 'normal', 'makeup') then
      continue;
    end if;

    v_date_text := coalesce(
      nullif(pg_catalog.btrim(v_session ->> 'date'), ''),
      nullif(pg_catalog.btrim(v_session ->> 'session_date'), ''),
      nullif(pg_catalog.btrim(v_session ->> 'dateValue'), ''),
      nullif(pg_catalog.btrim(v_session ->> 'date_value'), '')
    );
    v_number_text := coalesce(
      nullif(pg_catalog.btrim(v_session ->> 'sessionNumber'), ''),
      nullif(pg_catalog.btrim(v_session ->> 'session_number'), '')
    );

    if v_date_text !~ '^\d{4}-\d{2}-\d{2}$'
      or v_number_text !~ '^[1-9]\d*$'
    then
      continue;
    end if;

    begin
      v_session_date := v_date_text::date;
      v_session_number := v_number_text::integer;
    exception
      when others then continue;
    end;

    v_canonical_key := pg_catalog.to_char(v_session_date, 'YYYY-MM-DD') || ':' || v_session_number::text;
    if v_session_date = p_date and v_canonical_key = pg_catalog.btrim(p_session_key) then
      return pg_catalog.jsonb_build_object(
        'valid', true,
        'sessionDate', pg_catalog.to_char(v_session_date, 'YYYY-MM-DD'),
        'sessionKey', v_canonical_key,
        'sessionLabel', v_session_number::text || '회차'
      );
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'valid', false,
    'sessionDate', null,
    'sessionKey', null,
    'sessionLabel', null
  );
end;
$$;

alter function dashboard_private.validate_registration_class_session(uuid, date, text)
  owner to postgres;
revoke execute on function dashboard_private.validate_registration_class_session(uuid, date, text)
  from public, anon, authenticated;

create or replace function dashboard_private.is_active_registration_director(
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id is not null and exists (
    select 1
    from public.profiles profile
    join public.teacher_catalogs teacher
      on teacher.profile_id = profile.id
    where profile.id = p_profile_id
      and profile.role = 'admin'
      and teacher.is_visible = true
  );
$$;

alter function dashboard_private.is_active_registration_director(uuid)
  owner to postgres;
revoke execute on function dashboard_private.is_active_registration_director(uuid)
  from public, anon, authenticated;

create or replace function dashboard_private.resolve_registration_default_director(
  p_subject text,
  p_school_grade text,
  p_inquiry_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subject text := nullif(pg_catalog.btrim(p_subject), '');
  v_grade text := pg_catalog.regexp_replace(coalesce(p_school_grade, ''), '\s+', '', 'g');
  v_effective_year integer;
  v_phase integer;
  v_owner_index integer;
  v_director_name text;
  v_profile_id uuid;
  v_match_count integer;
  v_rule_key text;
begin
  if p_inquiry_at is null then
    return pg_catalog.jsonb_build_object(
      'status', 'unavailable', 'profileId', null, 'ruleKey', null,
      'directorName', null, 'effectiveYear', null
    );
  end if;

  v_effective_year := extract(
    year from p_inquiry_at at time zone 'Asia/Seoul'
  )::integer;

  if v_subject = '수학' then
    if v_grade ~ '^(초[1-6]|중[1-3])$' then
      v_director_name := '강정은';
    elsif v_grade ~ '^고[1-3]$' then
      v_director_name := '양소윤';
    end if;
  elsif v_subject = '영어' then
    v_phase := case v_grade
      when '초4' then 0 when '중1' then 0 when '고1' then 0
      when '초5' then 1 when '중2' then 1 when '고2' then 1
      when '초6' then 2 when '중3' then 2 when '고3' then 2
      else null
    end;
    if v_phase is not null then
      v_owner_index := (((v_phase - (v_effective_year - 2026)) % 3) + 3) % 3;
      v_director_name := case v_owner_index
        when 0 then '강부희'
        when 1 then '정보영'
        when 2 then '김민경'
      end;
    end if;
  end if;

  if v_director_name is null then
    return pg_catalog.jsonb_build_object(
      'status', 'unavailable', 'profileId', null, 'ruleKey', null,
      'directorName', null, 'effectiveYear', v_effective_year
    );
  end if;

  select pg_catalog.count(*), (pg_catalog.array_agg(candidate.profile_id order by candidate.profile_id))[1]
  into v_match_count, v_profile_id
  from (
    select distinct profile.id as profile_id
    from public.teacher_catalogs teacher
    join public.profiles profile on profile.id = teacher.profile_id
    where teacher.name = v_director_name
      and teacher.is_visible = true
      and profile.role = 'admin'
  ) candidate;

  if v_match_count <> 1 then
    return pg_catalog.jsonb_build_object(
      'status', 'unavailable', 'profileId', null, 'ruleKey', null,
      'directorName', v_director_name, 'effectiveYear', v_effective_year
    );
  end if;

  v_rule_key := 'academic-director-v1:' || v_effective_year::text || ':' || v_subject || ':' || v_grade;
  return pg_catalog.jsonb_build_object(
    'status', 'resolved',
    'profileId', v_profile_id,
    'ruleKey', v_rule_key,
    'directorName', v_director_name,
    'effectiveYear', v_effective_year
  );
end;
$$;

alter function dashboard_private.resolve_registration_default_director(text, text, timestamptz)
  owner to postgres;
revoke execute on function dashboard_private.resolve_registration_default_director(text, text, timestamptz)
  from public, anon, authenticated;

create or replace function dashboard_private.assert_registration_track_director_ready(
  p_track_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_source text;
  v_rule_key text;
  v_subject text;
  v_grade text;
  v_inquiry_at timestamptz;
  v_resolution jsonb;
begin
  select
    track.director_profile_id,
    track.director_assignment_source,
    track.director_assignment_rule_key,
    track.subject,
    detail.school_grade,
    detail.inquiry_at
  into
    v_profile_id,
    v_source,
    v_rule_key,
    v_subject,
    v_grade,
    v_inquiry_at
  from public.ops_registration_subject_tracks track
  join public.ops_registration_details detail on detail.task_id = track.task_id
  where track.id = p_track_id
  for update of track;

  if not found
    or not dashboard_private.is_active_registration_director(v_profile_id)
  then
    raise exception 'registration_director_refresh_required' using errcode = '40001';
  end if;

  if v_source = 'default' then
    v_resolution := dashboard_private.resolve_registration_default_director(
      v_subject, v_grade, v_inquiry_at
    );
    if v_resolution ->> 'status' <> 'resolved'
      or (v_resolution ->> 'profileId')::uuid is distinct from v_profile_id
      or v_resolution ->> 'ruleKey' is distinct from v_rule_key
    then
      raise exception 'registration_director_refresh_required' using errcode = '40001';
    end if;
  elsif v_source not in ('manual', 'migration') then
    raise exception 'registration_director_refresh_required' using errcode = '40001';
  end if;
end;
$$;

alter function dashboard_private.assert_registration_track_director_ready(uuid)
  owner to postgres;
revoke execute on function dashboard_private.assert_registration_track_director_ready(uuid)
  from public, anon, authenticated;

create or replace function dashboard_private.transition_registration_track_status(
  p_track_id uuid,
  p_next_status text,
  p_next_waiting_kind text,
  p_next_retake_decision text,
  p_next_migration_review_required boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.ops_registration_subject_tracks%rowtype;
  v_status_changed boolean;
begin
  if p_next_status not in (
    'inquiry', 'migration_review', 'level_test_scheduled', 'level_test_in_progress',
    'consultation_waiting', 'visit_consultation_scheduled', 'waiting',
    'enrollment_decided', 'enrollment_processing', 'registered',
    'not_registered', 'inquiry_closed'
  ) then
    raise exception 'registration_track_status_invalid' using errcode = '22023';
  end if;
  if (p_next_status = 'waiting') is distinct from (p_next_waiting_kind is not null)
    or (p_next_status = 'migration_review') is distinct from coalesce(p_next_migration_review_required, false)
    or (p_next_status <> 'waiting' and p_next_retake_decision is not null)
    or p_next_waiting_kind is not null and p_next_waiting_kind not in (
      'current_class', 'current_term_opening', 'next_term_opening'
    )
    or p_next_retake_decision is not null and p_next_retake_decision not in ('required', 'not_required')
  then
    raise exception 'registration_track_state_invalid' using errcode = '22023';
  end if;

  select track.*
  into v_current
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
  for update;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  v_status_changed := v_current.pipeline_status is distinct from p_next_status;
  if not v_status_changed
    and v_current.waiting_kind is not distinct from p_next_waiting_kind
    and v_current.level_test_retake_decision is not distinct from p_next_retake_decision
    and v_current.migration_review_required is not distinct from p_next_migration_review_required
  then
    return false;
  end if;

  update public.ops_registration_subject_tracks
  set
    pipeline_status = p_next_status,
    waiting_kind = p_next_waiting_kind,
    level_test_retake_decision = p_next_retake_decision,
    level_test_retake_decided_at = case
      when p_next_retake_decision is null then null
      when level_test_retake_decision is distinct from p_next_retake_decision then pg_catalog.now()
      else level_test_retake_decided_at
    end,
    migration_review_required = p_next_migration_review_required,
    stage_entered_at = case
      when pipeline_status is distinct from p_next_status then pg_catalog.now()
      else stage_entered_at
    end,
    updated_at = pg_catalog.now()
  where id = p_track_id;

  return v_status_changed;
end;
$$;

alter function dashboard_private.transition_registration_track_status(uuid, text, text, text, boolean)
  owner to postgres;
revoke execute on function dashboard_private.transition_registration_track_status(uuid, text, text, text, boolean)
  from public, anon, authenticated;

create or replace function dashboard_private.write_registration_track_event(
  p_task_id uuid,
  p_track_id uuid,
  p_event_type text,
  p_source text,
  p_destination text,
  p_reason text,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject text;
  v_occurred_at timestamptz := pg_catalog.now();
begin
  select track.subject
  into v_subject
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = p_task_id;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value, created_at
  ) values (
    p_task_id,
    (select auth.uid()),
    'registration_track_event',
    'registration_track:' || p_track_id::text,
    null,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'eventType', p_event_type,
      'actorId', (select auth.uid()),
      'trackId', p_track_id,
      'subject', v_subject,
      'source', p_source,
      'destination', p_destination,
      'reason', nullif(pg_catalog.btrim(p_reason), ''),
      'metadata', coalesce(p_metadata, '{}'::jsonb),
      'occurredAt', v_occurred_at
    )::text,
    v_occurred_at
  );
end;
$$;

alter function dashboard_private.write_registration_track_event(uuid, uuid, text, text, text, text, jsonb)
  owner to postgres;
revoke execute on function dashboard_private.write_registration_track_event(uuid, uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;

create or replace function dashboard_private.derive_registration_parent_projection(
  p_task_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_projection jsonb;
begin
  if not exists (
    select 1
    from public.ops_tasks task
    where task.id = p_task_id
      and task.type = 'registration'
  ) or not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
  ) then
    raise exception 'registration_subject_track_coverage_mismatch' using errcode = '23514';
  end if;

  with tracks as (
    select track.*,
      case track.subject when '영어' then 0 when '수학' then 1 else 9 end as subject_order,
      case track.pipeline_status
        when 'inquiry' then 0
        when 'migration_review' then 0
        when 'level_test_scheduled' then 1
        when 'level_test_in_progress' then 1
        when 'consultation_waiting' then 2
        when 'visit_consultation_scheduled' then 2
        when 'waiting' then 3
        when 'enrollment_decided' then 4
        when 'enrollment_processing' then 5
        else 9
      end as workflow_order,
      track.pipeline_status in ('registered', 'not_registered', 'inquiry_closed') as terminal
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
  ), stats as (
    select
      pg_catalog.count(*) as track_count,
      pg_catalog.bool_and(pipeline_status = 'inquiry') as all_inquiry,
      pg_catalog.bool_and(terminal) as all_terminal,
      pg_catalog.bool_or(pipeline_status = 'registered') as any_registered
    from tracks
  ), open_batch as (
    select exists(
      select 1
      from public.ops_registration_admission_batches batch
      where batch.task_id = p_task_id
        and batch.status not in ('completed', 'canceled')
    ) as present
  ), selected_track as (
    select track.*
    from tracks track
    order by
      case when track.terminal then 1 else 0 end,
      track.workflow_order,
      track.subject_order,
      track.id
    limit 1
  ), selected_director as (
    select track.director_profile_id, profile.name as counselor
    from tracks track
    left join public.profiles profile on profile.id = track.director_profile_id
    where not track.terminal
    order by track.subject_order, track.id
    limit 1
  ), compatibility_enrollments as (
    select enrollment.*, track.subject_order
    from public.ops_registration_enrollments enrollment
    join tracks track on track.id = enrollment.track_id
    where enrollment.status <> 'canceled'
      and not (
        enrollment.status = 'planned'
        and enrollment.admission_batch_id is null
        and track.pipeline_status = 'registered'
      )
  ), representative_enrollment as (
    select enrollment.class_id, enrollment.textbook_id
    from compatibility_enrollments enrollment
    order by enrollment.subject_order, enrollment.sort_order, enrollment.id
    limit 1
  ), enrollment_stats as (
    select
      pg_catalog.count(*) as enrollment_count,
      coalesce(pg_catalog.bool_and(makeedu_registered), false) as all_makeedu
    from compatibility_enrollments
  ), latest_batch as (
    select batch.*
    from public.ops_registration_admission_batches batch
    where batch.task_id = p_task_id
      and batch.status <> 'canceled'
    order by batch.revision_number desc, batch.id desc
    limit 1
  ), values_to_project as (
    select
      case
        when stats.all_inquiry and not open_batch.present then 'requested'
        when stats.all_terminal and not open_batch.present and stats.any_registered then 'done'
        when stats.all_terminal and not open_batch.present then 'canceled'
        else 'in_progress'
      end as parent_status,
      (
        select pg_catalog.string_agg(track.subject, ', ' order by track.subject_order, track.id)
        from tracks track
      ) as subject,
      representative_enrollment.class_id,
      representative_enrollment.textbook_id,
      selected_director.director_profile_id,
      selected_director.counselor,
      case selected_track.pipeline_status
        when 'inquiry' then '0. 등록 문의'
        when 'migration_review' then '0. 등록 문의'
        when 'level_test_scheduled' then '1. 레벨테스트 예약'
        when 'level_test_in_progress' then '1. 레벨테스트 예약'
        when 'consultation_waiting' then '2. 상담 예약'
        when 'visit_consultation_scheduled' then '2. 상담 예약'
        when 'waiting' then case selected_track.waiting_kind
          when 'current_class' then '4-1. 현재반 대기 신청'
          when 'current_term_opening' then '4-2. 신규반 대기 신청'
          when 'next_term_opening' then '4-3. 다음 개강 알림 요청'
        end
        when 'enrollment_decided' then '5. 입학 등록 결정'
        when 'enrollment_processing' then case
          when latest_batch.status = 'draft' then '5-1. 입학신청서 발송 완료'
          else '6. 수납 확인'
        end
        when 'registered' then '7. 등록 완료'
        when 'not_registered' then '8. 미등록'
        when 'inquiry_closed' then '9. 문의만'
      end as pipeline_status,
      enrollment_stats.enrollment_count > 0 and enrollment_stats.all_makeedu as makeedu_registered,
      latest_batch.invoice_sent_at is not null as makeedu_invoice_sent,
      latest_batch.payment_confirmed_at is not null as payment_checked
    from stats
    cross join open_batch
    cross join selected_track
    left join selected_director on true
    left join representative_enrollment on true
    cross join enrollment_stats
    left join latest_batch on true
  )
  select pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'parentStatus', value.parent_status,
    'subject', value.subject,
    'classId', value.class_id,
    'textbookId', value.textbook_id,
    'secondaryAssigneeId', value.director_profile_id,
    'counselor', value.counselor,
    'pipelineStatus', value.pipeline_status,
    'makeeduRegistered', value.makeedu_registered,
    'makeeduInvoiceSent', value.makeedu_invoice_sent,
    'paymentChecked', value.payment_checked
  )
  into v_projection
  from values_to_project value;

  return v_projection;
end;
$$;

alter function dashboard_private.derive_registration_parent_projection(uuid)
  owner to postgres;
revoke execute on function dashboard_private.derive_registration_parent_projection(uuid)
  from public, anon, authenticated;

create or replace function dashboard_private.recompute_registration_parent(
  p_task_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.ops_tasks%rowtype;
  v_projection jsonb;
  v_next_status text;
  v_completed_at timestamptz;
begin
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_task_not_found' using errcode = 'P0002';
  end if;

  perform 1
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  v_projection := dashboard_private.derive_registration_parent_projection(p_task_id);
  v_next_status := v_projection ->> 'parentStatus';

  if v_next_status in ('done', 'canceled') then
    if v_task.status = v_next_status and v_task.completed_at is not null then
      v_completed_at := v_task.completed_at;
    elsif v_task.status in ('done', 'canceled') then
      select coalesce(
        v_task.completed_at,
        (
          select pg_catalog.max(event.created_at)
          from public.ops_task_events event
          where event.task_id = p_task_id
            and event.event_type in ('status_changed', 'updated', 'registration_track_event')
        ),
        v_task.updated_at,
        v_task.created_at,
        pg_catalog.now()
      )
      into v_completed_at;
    else
      v_completed_at := pg_catalog.now();
    end if;
  else
    v_completed_at := null;
  end if;

  update public.ops_tasks
  set
    status = v_next_status,
    completed_at = v_completed_at,
    subject = v_projection ->> 'subject',
    class_id = nullif(v_projection ->> 'classId', '')::uuid,
    textbook_id = nullif(v_projection ->> 'textbookId', '')::uuid,
    secondary_assignee_id = nullif(v_projection ->> 'secondaryAssigneeId', '')::uuid,
    updated_at = pg_catalog.now()
  where id = p_task_id;

  update public.ops_registration_details
  set
    pipeline_status = v_projection ->> 'pipelineStatus',
    counselor = nullif(v_projection ->> 'counselor', ''),
    makeedu_registered = coalesce((v_projection ->> 'makeeduRegistered')::boolean, false),
    makeedu_invoice_sent = coalesce((v_projection ->> 'makeeduInvoiceSent')::boolean, false),
    payment_checked = coalesce((v_projection ->> 'paymentChecked')::boolean, false),
    updated_at = pg_catalog.now()
  where task_id = p_task_id;
end;
$$;

alter function dashboard_private.recompute_registration_parent(uuid)
  owner to postgres;
revoke execute on function dashboard_private.recompute_registration_parent(uuid)
  from public, anon, authenticated;

create or replace function public.prevent_completed_operation_reopen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_projection jsonb;
  v_expected_status text;
begin
  if old.type = 'registration' and exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = old.id
  ) then
    v_projection := dashboard_private.derive_registration_parent_projection(old.id);
    v_expected_status := v_projection ->> 'parentStatus';
    if new.status is distinct from v_expected_status then
      raise exception 'registration_parent_projection_mismatch' using errcode = '23514';
    end if;
    if v_expected_status not in ('done', 'canceled') and new.completed_at is not null then
      raise exception 'registration_parent_projection_mismatch' using errcode = '23514';
    end if;
    if v_expected_status in ('done', 'canceled') then
      if old.status = v_expected_status and old.completed_at is not null
        and new.completed_at is distinct from old.completed_at
      then
        raise exception 'registration_parent_projection_mismatch' using errcode = '23514';
      end if;
      if new.completed_at is null then
        raise exception 'registration_parent_projection_mismatch' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if old.type <> 'general'
    and old.status = 'done'
    and new.status <> 'done'
  then
    raise exception '완료된 운영 업무는 관리 데이터가 반영되어 상태만 되돌릴 수 없습니다.';
  end if;
  return new;
end;
$$;

alter function public.prevent_completed_operation_reopen() owner to postgres;
revoke execute on function public.prevent_completed_operation_reopen()
  from public, anon, authenticated;

drop trigger if exists prevent_completed_operation_reopen on public.ops_tasks;
create trigger prevent_completed_operation_reopen
before update of status, completed_at on public.ops_tasks
for each row execute function public.prevent_completed_operation_reopen();

-- registration_backfill_parent_recompute
do $$
declare
  v_task record;
begin
  for v_task in
    select task.id
    from public.ops_tasks task
    where task.type = 'registration'
      and exists (
        select 1
        from public.ops_registration_subject_tracks track
        where track.task_id = task.id
      )
    order by task.id
  loop
    perform dashboard_private.recompute_registration_parent(v_task.id);
  end loop;

  if exists (
    select 1
    from public.ops_tasks task
    join public.ops_registration_details detail on detail.task_id = task.id
    cross join lateral dashboard_private.derive_registration_parent_projection(task.id) projection(value)
    where task.type = 'registration'
      and exists (
        select 1
        from public.ops_registration_subject_tracks track
        where track.task_id = task.id
      )
      and (
        task.status is distinct from projection.value ->> 'parentStatus'
        or task.subject is distinct from projection.value ->> 'subject'
        or task.class_id is distinct from nullif(projection.value ->> 'classId', '')::uuid
        or task.textbook_id is distinct from nullif(projection.value ->> 'textbookId', '')::uuid
        or task.secondary_assignee_id is distinct from nullif(projection.value ->> 'secondaryAssigneeId', '')::uuid
        or detail.pipeline_status is distinct from projection.value ->> 'pipelineStatus'
        or detail.counselor is distinct from nullif(projection.value ->> 'counselor', '')
        or detail.makeedu_registered is distinct from coalesce((projection.value ->> 'makeeduRegistered')::boolean, false)
        or detail.makeedu_invoice_sent is distinct from coalesce((projection.value ->> 'makeeduInvoiceSent')::boolean, false)
        or detail.payment_checked is distinct from coalesce((projection.value ->> 'paymentChecked')::boolean, false)
        or (task.status in ('done', 'canceled')) is distinct from (task.completed_at is not null)
      )
  ) then
    raise exception 'registration_parent_projection_mismatch' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.prevent_registration_compatibility_override()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_projection jsonb;
begin
  v_task_id := case when tg_table_name = 'ops_tasks' then new.id else new.task_id end;
  if not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = v_task_id
  ) then
    return new;
  end if;

  v_projection := dashboard_private.derive_registration_parent_projection(v_task_id);
  if tg_table_name = 'ops_tasks' then
    if new.subject is distinct from v_projection ->> 'subject'
      or new.class_id is distinct from nullif(v_projection ->> 'classId', '')::uuid
      or new.textbook_id is distinct from nullif(v_projection ->> 'textbookId', '')::uuid
      or new.secondary_assignee_id is distinct from nullif(v_projection ->> 'secondaryAssigneeId', '')::uuid
    then
      raise exception 'registration_compatibility_override_denied' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.pipeline_status is distinct from v_projection ->> 'pipelineStatus'
    or new.counselor is distinct from nullif(v_projection ->> 'counselor', '')
    or new.makeedu_registered is distinct from coalesce((v_projection ->> 'makeeduRegistered')::boolean, false)
    or new.makeedu_invoice_sent is distinct from coalesce((v_projection ->> 'makeeduInvoiceSent')::boolean, false)
    or new.payment_checked is distinct from coalesce((v_projection ->> 'paymentChecked')::boolean, false)
    or new.level_test_at is distinct from old.level_test_at
    or new.level_test_place is distinct from old.level_test_place
    or new.level_test_material_link is distinct from old.level_test_material_link
    or new.level_test_completed_at is distinct from old.level_test_completed_at
    or new.level_test_result is distinct from old.level_test_result
    or new.phone_consultation_at is distinct from old.phone_consultation_at
    or new.visit_consultation_at is distinct from old.visit_consultation_at
    or new.visit_consultation_place is distinct from old.visit_consultation_place
    or new.consultation_at is distinct from old.consultation_at
    or new.class_start_date is distinct from old.class_start_date
    or new.class_start_session is distinct from old.class_start_session
    or new.textbook_ready is distinct from old.textbook_ready
    or new.textbook_preparation is distinct from old.textbook_preparation
    or new.textbook_billing_issued is distinct from old.textbook_billing_issued
    or new.timetable_roster_updated is distinct from old.timetable_roster_updated
  then
    raise exception 'registration_compatibility_override_denied' using errcode = '23514';
  end if;
  return new;
end;
$$;

alter function public.prevent_registration_compatibility_override() owner to postgres;
revoke execute on function public.prevent_registration_compatibility_override()
  from public, anon, authenticated;

drop trigger if exists prevent_registration_compatibility_override on public.ops_tasks;
create trigger prevent_registration_compatibility_override
before update of subject, class_id, textbook_id, secondary_assignee_id on public.ops_tasks
for each row execute function public.prevent_registration_compatibility_override();

drop trigger if exists prevent_registration_compatibility_override on public.ops_registration_details;
create trigger prevent_registration_compatibility_override
before update on public.ops_registration_details
for each row execute function public.prevent_registration_compatibility_override();

create or replace function dashboard_private.apply_student_class_roster_mode(
  p_student_id uuid,
  p_class_id uuid,
  p_next_mode text,
  p_expected_mode text,
  p_claim_enrollment_id uuid,
  p_memo text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_class public.classes%rowtype;
  v_student_classes jsonb;
  v_student_waitlists jsonb;
  v_class_students jsonb;
  v_class_waitlists jsonb;
  v_student_enrolled boolean;
  v_student_waitlisted boolean;
  v_class_enrolled boolean;
  v_class_waitlisted boolean;
  v_current_mode text;
  v_next_mode text := pg_catalog.lower(nullif(pg_catalog.btrim(p_next_mode), ''));
  v_expected_mode text := pg_catalog.lower(nullif(pg_catalog.btrim(p_expected_mode), ''));
  v_claim_count integer;
  v_active_claim_id uuid;
  v_changed boolean;
begin
  if v_next_mode not in ('enrolled', 'waitlist', 'removed')
    or v_expected_mode not in ('enrolled', 'waitlist', 'removed')
  then
    raise exception 'registration_roster_mode_invalid' using errcode = '22023';
  end if;

  select student.*
  into v_student
  from public.students student
  where student.id = p_student_id
  for update;
  if not found then
    raise exception 'registration_student_not_found' using errcode = 'P0002';
  end if;

  perform 1
  from public.ops_registration_enrollments enrollment
  where enrollment.student_id = p_student_id
    and enrollment.class_id = p_class_id
    and enrollment.roster_active
  order by enrollment.id
  for update;

  select
    pg_catalog.count(*),
    (pg_catalog.array_agg(enrollment.id order by enrollment.id))[1]
  into v_claim_count, v_active_claim_id
  from public.ops_registration_enrollments enrollment
  where enrollment.student_id = p_student_id
    and enrollment.class_id = p_class_id
    and enrollment.roster_active;

  if v_claim_count > 1 then
    raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
  end if;
  if p_claim_enrollment_id is null and v_claim_count <> 0 then
    raise exception 'registration_student_class_claim_conflict' using errcode = '40001';
  end if;
  if p_claim_enrollment_id is not null
    and (v_claim_count <> 1 or v_active_claim_id is distinct from p_claim_enrollment_id)
  then
    raise exception 'registration_student_class_claim_conflict' using errcode = '40001';
  end if;

  select class.*
  into v_class
  from public.classes class
  where class.id = p_class_id
  for update;
  if not found then
    raise exception 'registration_class_not_found' using errcode = 'P0002';
  end if;

  v_student_classes := coalesce(v_student.class_ids, '[]'::jsonb);
  v_student_waitlists := coalesce(v_student.waitlist_class_ids, '[]'::jsonb);
  v_class_students := coalesce(v_class.student_ids, '[]'::jsonb);
  v_class_waitlists := coalesce(v_class.waitlist_ids, '[]'::jsonb);

  if pg_catalog.jsonb_typeof(v_student_classes) <> 'array'
    or pg_catalog.jsonb_typeof(v_student_waitlists) <> 'array'
    or pg_catalog.jsonb_typeof(v_class_students) <> 'array'
    or pg_catalog.jsonb_typeof(v_class_waitlists) <> 'array'
  then
    raise exception 'registration_roster_projection_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from (
      select element.value
      from pg_catalog.jsonb_array_elements(v_student_classes) element(value)
      union all
      select element.value
      from pg_catalog.jsonb_array_elements(v_student_waitlists) element(value)
      union all
      select element.value
      from pg_catalog.jsonb_array_elements(v_class_students) element(value)
      union all
      select element.value
      from pg_catalog.jsonb_array_elements(v_class_waitlists) element(value)
    ) roster_element
    where pg_catalog.jsonb_typeof(roster_element.value) <> 'string'
      or (roster_element.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'registration_roster_projection_invalid' using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(canonical.value) order by canonical.value),
    '[]'::jsonb
  )
  into v_student_classes
  from (
    select ((element.value #>> '{}')::uuid)::text as value
    from pg_catalog.jsonb_array_elements(v_student_classes) element(value)
  ) canonical;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(canonical.value) order by canonical.value),
    '[]'::jsonb
  )
  into v_student_waitlists
  from (
    select ((element.value #>> '{}')::uuid)::text as value
    from pg_catalog.jsonb_array_elements(v_student_waitlists) element(value)
  ) canonical;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(canonical.value) order by canonical.value),
    '[]'::jsonb
  )
  into v_class_students
  from (
    select ((element.value #>> '{}')::uuid)::text as value
    from pg_catalog.jsonb_array_elements(v_class_students) element(value)
  ) canonical;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(canonical.value) order by canonical.value),
    '[]'::jsonb
  )
  into v_class_waitlists
  from (
    select ((element.value #>> '{}')::uuid)::text as value
    from pg_catalog.jsonb_array_elements(v_class_waitlists) element(value)
  ) canonical;

  if pg_catalog.jsonb_array_length(v_student_classes) <> (
      select pg_catalog.count(distinct ((element.value #>> '{}')::uuid)::text)
      from pg_catalog.jsonb_array_elements(v_student_classes) element(value)
    )
    or pg_catalog.jsonb_array_length(v_student_waitlists) <> (
      select pg_catalog.count(distinct ((element.value #>> '{}')::uuid)::text)
      from pg_catalog.jsonb_array_elements(v_student_waitlists) element(value)
    )
    or pg_catalog.jsonb_array_length(v_class_students) <> (
      select pg_catalog.count(distinct ((element.value #>> '{}')::uuid)::text)
      from pg_catalog.jsonb_array_elements(v_class_students) element(value)
    )
    or pg_catalog.jsonb_array_length(v_class_waitlists) <> (
      select pg_catalog.count(distinct ((element.value #>> '{}')::uuid)::text)
      from pg_catalog.jsonb_array_elements(v_class_waitlists) element(value)
    )
  then
    raise exception 'registration_roster_projection_invalid' using errcode = '22023';
  end if;

  v_student_enrolled := v_student_classes ? p_class_id::text;
  v_student_waitlisted := v_student_waitlists ? p_class_id::text;
  v_class_enrolled := v_class_students ? p_student_id::text;
  v_class_waitlisted := v_class_waitlists ? p_student_id::text;

  if v_student_enrolled is distinct from v_class_enrolled
    or v_student_waitlisted is distinct from v_class_waitlisted
    or (v_student_enrolled and v_student_waitlisted)
    or (v_class_enrolled and v_class_waitlisted)
  then
    raise exception 'registration_roster_projection_invalid' using errcode = '23514';
  end if;

  v_current_mode := case
    when v_student_enrolled then 'enrolled'
    when v_student_waitlisted then 'waitlist'
    else 'removed'
  end;

  if v_current_mode = v_next_mode and p_claim_enrollment_id is null then
    return pg_catalog.jsonb_build_object(
      'studentId', p_student_id,
      'classId', p_class_id,
      'previousMode', v_current_mode,
      'nextMode', v_next_mode,
      'changed', false,
      'studentClassIds', v_student_classes,
      'studentWaitlistClassIds', v_student_waitlists,
      'classStudentIds', v_class_students,
      'classWaitlistIds', v_class_waitlists
    );
  end if;

  if v_current_mode <> v_expected_mode then
    raise exception 'registration_roster_mode_conflict' using errcode = '40001';
  end if;
  if v_current_mode = v_next_mode then
    return pg_catalog.jsonb_build_object(
      'studentId', p_student_id,
      'classId', p_class_id,
      'previousMode', v_current_mode,
      'nextMode', v_next_mode,
      'changed', false,
      'studentClassIds', v_student_classes,
      'studentWaitlistClassIds', v_student_waitlists,
      'classStudentIds', v_class_students,
      'classWaitlistIds', v_class_waitlists
    );
  end if;
  if v_next_mode = 'waitlist' and v_current_mode = 'enrolled' then
    raise exception 'registration_roster_mode_conflict' using errcode = '40001';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item.value) order by item.value), '[]'::jsonb)
  into v_student_classes
  from (
    select distinct source.value
    from (
      select element.value #>> '{}' as value
      from pg_catalog.jsonb_array_elements(v_student_classes) element(value)
      where element.value #>> '{}' <> p_class_id::text
      union all
      select p_class_id::text where v_next_mode = 'enrolled'
    ) source
  ) item;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item.value) order by item.value), '[]'::jsonb)
  into v_student_waitlists
  from (
    select distinct source.value
    from (
      select element.value #>> '{}' as value
      from pg_catalog.jsonb_array_elements(v_student_waitlists) element(value)
      where element.value #>> '{}' <> p_class_id::text
      union all
      select p_class_id::text where v_next_mode = 'waitlist'
    ) source
  ) item;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item.value) order by item.value), '[]'::jsonb)
  into v_class_students
  from (
    select distinct source.value
    from (
      select element.value #>> '{}' as value
      from pg_catalog.jsonb_array_elements(v_class_students) element(value)
      where element.value #>> '{}' <> p_student_id::text
      union all
      select p_student_id::text where v_next_mode = 'enrolled'
    ) source
  ) item;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item.value) order by item.value), '[]'::jsonb)
  into v_class_waitlists
  from (
    select distinct source.value
    from (
      select element.value #>> '{}' as value
      from pg_catalog.jsonb_array_elements(v_class_waitlists) element(value)
      where element.value #>> '{}' <> p_student_id::text
      union all
      select p_student_id::text where v_next_mode = 'waitlist'
    ) source
  ) item;

  update public.students
  set
    class_ids = v_student_classes,
    waitlist_class_ids = v_student_waitlists,
    status = case when v_next_mode in ('enrolled', 'waitlist') then '재원' else status end
  where id = p_student_id;

  update public.classes
  set
    student_ids = v_class_students,
    waitlist_ids = v_class_waitlists
  where id = p_class_id;

  if not (
    (v_next_mode = 'enrolled'
      and v_student_classes ? p_class_id::text
      and v_class_students ? p_student_id::text
      and not (v_student_waitlists ? p_class_id::text)
      and not (v_class_waitlists ? p_student_id::text))
    or (v_next_mode = 'waitlist'
      and v_student_waitlists ? p_class_id::text
      and v_class_waitlists ? p_student_id::text
      and not (v_student_classes ? p_class_id::text)
      and not (v_class_students ? p_student_id::text))
    or (v_next_mode = 'removed'
      and not (v_student_classes ? p_class_id::text)
      and not (v_student_waitlists ? p_class_id::text)
      and not (v_class_students ? p_student_id::text)
      and not (v_class_waitlists ? p_student_id::text))
  ) then
    raise exception 'registration_roster_projection_invalid' using errcode = '23514';
  end if;

  insert into public.student_class_enrollment_history(
    student_id, class_id, action, previous_mode, next_mode, memo, changed_by
  ) values (
    p_student_id,
    p_class_id,
    v_next_mode,
    case when v_current_mode = 'removed' then null else v_current_mode end,
    case when v_next_mode = 'removed' then null else v_next_mode end,
    coalesce(p_memo, ''),
    p_actor_id
  );
  v_changed := true;

  return pg_catalog.jsonb_build_object(
    'studentId', p_student_id,
    'classId', p_class_id,
    'previousMode', v_current_mode,
    'nextMode', v_next_mode,
    'changed', v_changed,
    'studentClassIds', v_student_classes,
    'studentWaitlistClassIds', v_student_waitlists,
    'classStudentIds', v_class_students,
    'classWaitlistIds', v_class_waitlists
  );
end;
$$;

alter function dashboard_private.apply_student_class_roster_mode(uuid, uuid, text, text, uuid, text, uuid)
  owner to postgres;
revoke execute on function dashboard_private.apply_student_class_roster_mode(uuid, uuid, text, text, uuid, text, uuid)
  from public, anon, authenticated;

create or replace function dashboard_private.apply_registration_current_class_wait(
  p_task_id uuid,
  p_track_id uuid,
  p_class_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_student public.students%rowtype;
  v_student_id uuid;
  v_match_count integer;
  v_class_subject text;
  v_enrollment_id uuid;
  v_name_key text;
  v_parent_phone_key text;
begin
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_task_not_found' using errcode = 'P0002';
  end if;

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  v_name_key := pg_catalog.lower(pg_catalog.regexp_replace(coalesce(v_task.student_name, ''), '\s+', '', 'g'));
  v_parent_phone_key := pg_catalog.regexp_replace(coalesce(v_detail.parent_phone, ''), '\D+', '', 'g');
  if v_name_key = '' or v_parent_phone_key = '' then
    raise exception 'registration_student_identity_required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-student:' || v_name_key || ':' || v_parent_phone_key, 0)
  );

  if v_task.student_id is not null then
    select student.*
    into v_student
    from public.students student
    where student.id = v_task.student_id
    for update;
    if not found
      or pg_catalog.lower(pg_catalog.regexp_replace(coalesce(v_student.name, ''), '\s+', '', 'g')) <> v_name_key
      or pg_catalog.regexp_replace(coalesce(v_student.parent_contact, ''), '\D+', '', 'g') <> v_parent_phone_key
      or (nullif(pg_catalog.btrim(v_detail.school_name), '') is not null and v_student.school is distinct from v_detail.school_name)
      or (nullif(pg_catalog.btrim(v_detail.student_phone), '') is not null and pg_catalog.regexp_replace(coalesce(v_student.contact, ''), '\D+', '', 'g') <> pg_catalog.regexp_replace(v_detail.student_phone, '\D+', '', 'g'))
    then
      raise exception 'registration_student_identity_mismatch' using errcode = '23514';
    end if;
    v_student_id := v_student.id;
  else
    select
      pg_catalog.count(*),
      (pg_catalog.array_agg(student.id order by student.id))[1]
    into v_match_count, v_student_id
    from public.students student
    where pg_catalog.lower(pg_catalog.regexp_replace(coalesce(student.name, ''), '\s+', '', 'g')) = v_name_key
      and pg_catalog.regexp_replace(coalesce(student.parent_contact, ''), '\D+', '', 'g') = v_parent_phone_key
      and (nullif(pg_catalog.btrim(v_detail.school_name), '') is null or student.school is not distinct from v_detail.school_name)
      and (nullif(pg_catalog.btrim(v_detail.student_phone), '') is null or pg_catalog.regexp_replace(coalesce(student.contact, ''), '\D+', '', 'g') = pg_catalog.regexp_replace(v_detail.student_phone, '\D+', '', 'g'));

    if v_match_count > 1 then
      raise exception 'registration_student_identity_ambiguous' using errcode = '23514';
    elsif v_match_count = 0 then
      insert into public.students(
        name, grade, school, contact, parent_contact, status, class_ids, waitlist_class_ids
      ) values (
        pg_catalog.btrim(v_task.student_name),
        v_detail.school_grade,
        v_detail.school_name,
        nullif(pg_catalog.btrim(v_detail.student_phone), ''),
        pg_catalog.btrim(v_detail.parent_phone),
        '재원',
        '[]'::jsonb,
        '[]'::jsonb
      ) returning * into v_student;
      v_student_id := v_student.id;
    else
      select student.*
      into v_student
      from public.students student
      where student.id = v_student_id
      for update;
    end if;

    update public.ops_tasks
    set student_id = v_student_id
    where id = p_task_id;
  end if;

  if v_student.status = '퇴원' then
    raise exception 'registration_student_reactivation_required' using errcode = '40001';
  end if;

  perform 1
  from public.ops_registration_enrollments enrollment
  where (
      enrollment.track_id = p_track_id
      and enrollment.status = 'waitlisted'
      and enrollment.roster_active
    ) or (
      enrollment.student_id = v_student_id
      and enrollment.class_id = p_class_id
      and enrollment.roster_active
    )
  order by enrollment.id
  for update;

  select pg_catalog.btrim(class.subject)
  into v_class_subject
  from public.classes class
  where class.id = p_class_id
  for update;
  if not found then
    raise exception 'registration_class_not_found' using errcode = 'P0002';
  end if;
  if v_class_subject is distinct from v_track.subject then
    raise exception 'registration_class_subject_mismatch' using errcode = '23514';
  end if;

  select enrollment.id
  into v_enrollment_id
  from public.ops_registration_enrollments enrollment
  where enrollment.track_id = p_track_id
    and enrollment.status = 'waitlisted'
    and enrollment.roster_active
  for update;

  if found then
    if not exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.id = v_enrollment_id
        and enrollment.student_id = v_student_id
        and enrollment.class_id = p_class_id
    ) then
      raise exception 'registration_student_class_already_active' using errcode = '40001';
    end if;
    perform dashboard_private.apply_student_class_roster_mode(
      v_student_id, p_class_id, 'waitlist', 'waitlist', v_enrollment_id,
      'registration_current_class_wait', p_actor_id
    );
    return;
  end if;

  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.student_id = v_student_id
      and enrollment.class_id = p_class_id
      and enrollment.roster_active
  ) then
    raise exception 'registration_student_class_already_active' using errcode = '40001';
  end if;

  -- verification_checkpoint_current_class_wait_before_materialization
  perform dashboard_private.await_registration_verification_checkpoint(
    'current_class_wait_before_materialization', p_task_id, v_student_id
  );

  insert into public.ops_registration_enrollments(
    track_id, student_id, class_id, status, roster_active, sort_order
  ) values (
    p_track_id, v_student_id, p_class_id, 'waitlisted', true, 0
  ) returning id into v_enrollment_id;

  perform dashboard_private.apply_student_class_roster_mode(
    v_student_id, p_class_id, 'waitlist', 'removed', v_enrollment_id,
    'registration_current_class_wait', p_actor_id
  );
end;
$$;

alter function dashboard_private.apply_registration_current_class_wait(uuid, uuid, uuid, uuid)
  owner to postgres;
revoke execute on function dashboard_private.apply_registration_current_class_wait(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

create function dashboard_private.set_student_class_roster_mode_impl(
  p_student_id uuid,
  p_class_id uuid,
  p_next_mode text,
  p_expected_mode text,
  p_memo text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_response jsonb;
begin
  if v_actor_id is null
    or not (public.current_dashboard_role() in ('admin', 'staff'))
  then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if pg_catalog.lower(nullif(pg_catalog.btrim(p_next_mode), '')) not in ('enrolled', 'waitlist', 'removed')
    or pg_catalog.lower(nullif(pg_catalog.btrim(p_expected_mode), '')) not in ('enrolled', 'waitlist', 'removed')
  then
    raise exception 'registration_roster_mode_conflict' using errcode = '22023';
  end if;

  v_response := dashboard_private.apply_student_class_roster_mode(
    p_student_id,
    p_class_id,
    pg_catalog.lower(pg_catalog.btrim(p_next_mode)),
    pg_catalog.lower(pg_catalog.btrim(p_expected_mode)),
    null,
    coalesce(p_memo, ''),
    v_actor_id
  );
  return v_response;
end;
$$;

alter function dashboard_private.set_student_class_roster_mode_impl(uuid, uuid, text, text, text)
  owner to postgres;
revoke execute on function dashboard_private.set_student_class_roster_mode_impl(uuid, uuid, text, text, text) from public, anon;
grant execute on function dashboard_private.set_student_class_roster_mode_impl(uuid, uuid, text, text, text) to authenticated;

create function public.set_student_class_roster_mode(
  p_student_id uuid,
  p_class_id uuid,
  p_next_mode text,
  p_expected_mode text,
  p_memo text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.set_student_class_roster_mode_impl(
    p_student_id, p_class_id, p_next_mode, p_expected_mode, p_memo
  );
$$;

revoke execute on function public.set_student_class_roster_mode(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.set_student_class_roster_mode(uuid, uuid, text, text, text) to authenticated;

-- Guard bodies are defined here so their invariant logic can be reviewed with
-- the gateway. Their direct-DML triggers are installed only after the runtime
-- probe and every ready/maintenance/legacy client adapter are complete.
create or replace function dashboard_private.prevent_ops_roster_completion_bypass()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_parent_type text;
begin
  if tg_table_name = 'ops_tasks' then
    if tg_op = 'INSERT' and new.type in ('withdrawal', 'transfer') and new.status = 'done' then
      raise exception 'ops_roster_completion_requires_rpc' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE'
      and old.type is distinct from new.type
      and (old.type in ('withdrawal', 'transfer') or new.type in ('withdrawal', 'transfer'))
    then
      raise exception 'ops_roster_type_immutable' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE'
      and new.type in ('withdrawal', 'transfer')
      and old.status is distinct from new.status
      and new.status = 'done'
      and current_user <> 'postgres'
    then
      raise exception 'ops_roster_completion_requires_rpc' using errcode = '42501';
    end if;
    return new;
  end if;

  select task.type
  into v_parent_type
  from public.ops_tasks task
  where task.id = new.task_id
  for update;
  if not found
    or (tg_table_name = 'ops_withdrawal_details' and v_parent_type <> 'withdrawal')
    or (tg_table_name = 'ops_transfer_details' and v_parent_type <> 'transfer')
  then
    raise exception 'ops_roster_detail_type_mismatch' using errcode = '23514';
  end if;
  if new.timetable_roster_updated
    and (tg_op = 'INSERT' or not old.timetable_roster_updated)
    and current_user <> 'postgres'
  then
    raise exception 'ops_roster_completion_requires_rpc' using errcode = '42501';
  end if;
  return new;
end;
$$;

alter function dashboard_private.prevent_ops_roster_completion_bypass() owner to postgres;
revoke execute on function dashboard_private.prevent_ops_roster_completion_bypass()
  from public, anon, authenticated;

create or replace function dashboard_private.prevent_direct_roster_array_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'postgres' then
    if tg_op = 'INSERT' then
      if tg_table_name = 'students' and (
        pg_catalog.jsonb_typeof(coalesce(new.class_ids, '[]'::jsonb)) <> 'array'
        or pg_catalog.jsonb_typeof(coalesce(new.waitlist_class_ids, '[]'::jsonb)) <> 'array'
        or pg_catalog.jsonb_array_length(coalesce(new.class_ids, '[]'::jsonb)) <> 0
        or pg_catalog.jsonb_array_length(coalesce(new.waitlist_class_ids, '[]'::jsonb)) <> 0
      ) then
        raise exception 'registration_roster_write_requires_rpc' using errcode = '42501';
      elsif tg_table_name = 'classes' and (
        pg_catalog.jsonb_typeof(coalesce(new.student_ids, '[]'::jsonb)) <> 'array'
        or pg_catalog.jsonb_typeof(coalesce(new.waitlist_ids, '[]'::jsonb)) <> 'array'
        or pg_catalog.jsonb_array_length(coalesce(new.student_ids, '[]'::jsonb)) <> 0
        or pg_catalog.jsonb_array_length(coalesce(new.waitlist_ids, '[]'::jsonb)) <> 0
      ) then
        raise exception 'registration_roster_write_requires_rpc' using errcode = '42501';
      end if;
    else
      raise exception 'registration_roster_write_requires_rpc' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

alter function dashboard_private.prevent_direct_roster_array_write() owner to postgres;
revoke execute on function dashboard_private.prevent_direct_roster_array_write()
  from public, anon, authenticated;

create or replace function dashboard_private.prevent_direct_student_status_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'postgres' and old.status is distinct from new.status then
    raise exception 'student_status_transition_requires_workflow' using errcode = '42501';
  end if;
  return new;
end;
$$;

alter function dashboard_private.prevent_direct_student_status_write() owner to postgres;
revoke execute on function dashboard_private.prevent_direct_student_status_write()
  from public, anon, authenticated;

create or replace function dashboard_private.prevent_linked_roster_entity_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_name = 'students' then
    if pg_catalog.jsonb_array_length(coalesce(old.class_ids, '[]'::jsonb)) > 0
      or pg_catalog.jsonb_array_length(coalesce(old.waitlist_class_ids, '[]'::jsonb)) > 0
      or exists (
        select 1 from public.classes class
        where coalesce(class.student_ids, '[]'::jsonb) ? old.id::text
          or coalesce(class.waitlist_ids, '[]'::jsonb) ? old.id::text
      )
    then
      raise exception 'registration_roster_cleanup_required' using errcode = '23503';
    end if;
    if exists (
      select 1 from public.student_class_enrollment_history history
      where history.student_id = old.id
    ) or exists (
      select 1 from public.ops_registration_enrollments enrollment
      where enrollment.student_id = old.id
    ) then
      raise exception 'registration_history_preservation_required' using errcode = '23503';
    end if;
  else
    if pg_catalog.jsonb_array_length(coalesce(old.student_ids, '[]'::jsonb)) > 0
      or pg_catalog.jsonb_array_length(coalesce(old.waitlist_ids, '[]'::jsonb)) > 0
      or exists (
        select 1 from public.students student
        where coalesce(student.class_ids, '[]'::jsonb) ? old.id::text
          or coalesce(student.waitlist_class_ids, '[]'::jsonb) ? old.id::text
      )
    then
      raise exception 'registration_roster_cleanup_required' using errcode = '23503';
    end if;
    if exists (
      select 1 from public.student_class_enrollment_history history
      where history.class_id = old.id
    ) or exists (
      select 1 from public.ops_registration_enrollments enrollment
      where enrollment.class_id = old.id
    ) then
      raise exception 'registration_history_preservation_required' using errcode = '23503';
    end if;
  end if;
  return old;
end;
$$;

alter function dashboard_private.prevent_linked_roster_entity_delete() owner to postgres;
revoke execute on function dashboard_private.prevent_linked_roster_entity_delete()
  from public, anon, authenticated;

create function dashboard_private.create_registration_case_impl(
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
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_student_name text := nullif(pg_catalog.btrim(p_student_name), '');
  v_school_grade text := nullif(pg_catalog.btrim(p_school_grade), '');
  v_school_name text := nullif(pg_catalog.btrim(p_school_name), '');
  v_parent_phone text := nullif(pg_catalog.btrim(p_parent_phone), '');
  v_student_phone text := nullif(pg_catalog.btrim(p_student_phone), '');
  v_campus text := nullif(pg_catalog.btrim(p_campus), '');
  v_request_note text := nullif(pg_catalog.btrim(p_request_note), '');
  v_priority text := nullif(pg_catalog.btrim(p_priority), '');
  v_parent_phone_digits text;
  v_subjects text[];
  v_task_id uuid;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null
    or (public.current_dashboard_role() in ('admin', 'staff')) is not true
  then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(coalesce(p_subjects, array[]::text[])) subject(value)
    where subject.value is null
      or nullif(pg_catalog.btrim(subject.value), '') is null
      or pg_catalog.btrim(subject.value) not in ('영어', '수학')
  ) then
    raise exception 'registration_subject_invalid' using errcode = '22023';
  end if;
  select coalesce(
    pg_catalog.array_agg(distinct pg_catalog.btrim(subject.value) order by pg_catalog.btrim(subject.value)),
    array[]::text[]
  )
  into v_subjects
  from pg_catalog.unnest(coalesce(p_subjects, array[]::text[])) subject(value)
  where nullif(pg_catalog.btrim(subject.value), '') is not null;
  if pg_catalog.cardinality(v_subjects) = 0 then
    raise exception 'registration_subjects_required' using errcode = '22023';
  end if;
  if pg_catalog.cardinality(v_subjects) not between 1 and 2 then
    raise exception 'registration_subject_invalid' using errcode = '22023';
  end if;
  if v_student_name is null then
    raise exception 'registration_student_name_required' using errcode = '22023';
  end if;
  if v_school_grade is null then
    raise exception 'registration_school_grade_required' using errcode = '22023';
  end if;
  v_parent_phone_digits := pg_catalog.regexp_replace(coalesce(v_parent_phone, ''), '\D+', '', 'g');
  if v_parent_phone_digits !~ '^01(0|1|[6-9])[0-9]{7,8}$' then
    raise exception 'registration_parent_phone_invalid' using errcode = '22023';
  end if;
  if p_inquiry_at is null then
    raise exception 'registration_inquiry_at_required' using errcode = '22023';
  end if;
  if v_campus is null or v_campus not in ('본관', '별관') then
    raise exception 'registration_campus_invalid' using errcode = '22023';
  end if;
  if v_priority is null or v_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'registration_priority_invalid' using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'studentName', v_student_name,
    'schoolGrade', v_school_grade,
    'schoolName', v_school_name,
    'parentPhone', v_parent_phone,
    'studentPhone', v_student_phone,
    'campus', v_campus,
    'inquiryAt', p_inquiry_at,
    'subjects', pg_catalog.to_jsonb(v_subjects),
    'requestNote', v_request_note,
    'priority', v_priority
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select
    mutation.response_payload,
    mutation.mutation_type = 'create_case'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  insert into public.ops_tasks(
    title, type, status, priority, requested_by, student_id,
    student_name, campus, subject, memo
  ) values (
    '등록: ' || v_student_name,
    'registration',
    'requested',
    v_priority,
    v_actor_id,
    null,
    v_student_name,
    v_campus,
    pg_catalog.array_to_string(v_subjects, ', '),
    null
  ) returning id into v_task_id;

  insert into public.ops_registration_details(
    task_id, inquiry_at, school_grade, school_name, parent_phone,
    student_phone, request_note, pipeline_status, common_revision
  ) values (
    v_task_id, p_inquiry_at, v_school_grade, v_school_name, v_parent_phone,
    v_student_phone, v_request_note, '0. 등록 문의', 1
  );

  insert into public.ops_registration_subject_tracks(
    task_id, subject, pipeline_status, migration_review_required
  )
  select v_task_id, subject.value, 'inquiry', false
  from pg_catalog.unnest(v_subjects) subject(value)
  order by case subject.value when '영어' then 0 else 1 end;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value
  ) values (
    v_task_id,
    v_actor_id,
    'registration_case_created',
    'registration_case',
    null,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'actorId', v_actor_id,
      'subjects', pg_catalog.to_jsonb(v_subjects),
      'occurredAt', pg_catalog.now()
    )::text
  );

  perform dashboard_private.recompute_registration_parent(v_task_id);

  select pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'commonRevision', 1,
    'subjects', pg_catalog.to_jsonb(v_subjects),
    'tracks', coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', track.id,
          'taskId', track.task_id,
          'subject', track.subject,
          'status', track.pipeline_status,
          'directorProfileId', track.director_profile_id,
          'directorAssignmentSource', track.director_assignment_source,
          'directorAssignmentRuleKey', track.director_assignment_rule_key,
          'waitingKind', track.waiting_kind,
          'levelTestRetakeDecision', track.level_test_retake_decision,
          'migrationReviewRequired', track.migration_review_required,
          'stageEnteredAt', track.stage_entered_at
        ) order by case track.subject when '영어' then 0 else 1 end, track.id
      ),
      '[]'::jsonb
    )
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id;

  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'create_case', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.create_registration_case_impl(
  text, text, text, text, text, text, timestamptz, text[], text, text, text
) owner to postgres;
revoke execute on function dashboard_private.create_registration_case_impl(text, text, text, text, text, text, timestamptz, text[], text, text, text) from public, anon;
grant execute on function dashboard_private.create_registration_case_impl(text, text, text, text, text, text, timestamptz, text[], text, text, text) to authenticated;

create function public.create_registration_case(
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
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.create_registration_case_impl(
    p_student_name, p_school_grade, p_school_name, p_parent_phone,
    p_student_phone, p_campus, p_inquiry_at, p_subjects,
    p_request_note, p_priority, p_request_key
  );
$$;

revoke execute on function public.create_registration_case(text, text, text, text, text, text, timestamptz, text[], text, text, text) from public, anon;
grant execute on function public.create_registration_case(text, text, text, text, text, text, timestamptz, text[], text, text, text) to authenticated;

create function dashboard_private.sync_registration_case_subjects_impl(
  p_task_id uuid,
  p_subjects text[],
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_subjects text[];
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_track record;
  v_remaining_count integer;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(coalesce(p_subjects, array[]::text[])) subject(value)
    where subject.value is null
      or nullif(pg_catalog.btrim(subject.value), '') is null
      or pg_catalog.btrim(subject.value) not in ('영어', '수학')
  ) then
    raise exception 'registration_subject_invalid' using errcode = '22023';
  end if;
  select coalesce(
    pg_catalog.array_agg(distinct pg_catalog.btrim(subject.value) order by pg_catalog.btrim(subject.value)),
    array[]::text[]
  )
  into v_subjects
  from pg_catalog.unnest(coalesce(p_subjects, array[]::text[])) subject(value)
  where nullif(pg_catalog.btrim(subject.value), '') is not null;
  if pg_catalog.cardinality(v_subjects) = 0 then
    raise exception 'registration_last_subject_required' using errcode = '22023';
  end if;
  if pg_catalog.cardinality(v_subjects) not between 1 and 2 then
    raise exception 'registration_subject_invalid' using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'subjects', pg_catalog.to_jsonb(v_subjects)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  perform 1
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by track.id
  for update;
  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'sync_subjects'
  );

  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'sync_subjects'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  perform 1
  from public.ops_registration_level_tests level_test
  join public.ops_registration_subject_tracks track on track.id = level_test.track_id
  where track.task_id = p_task_id
  order by level_test.id
  for update of level_test;
  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = p_task_id
  order by consultation.id
  for update of consultation;
  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = p_task_id
  order by enrollment.id
  for update of enrollment;
  for v_track in
    select track.*
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and not (track.subject = any(v_subjects))
    order by track.id
  loop
    if v_track.pipeline_status <> 'inquiry'
      or v_track.director_assignment_source in ('manual', 'migration')
      or exists (
        select 1 from public.ops_registration_level_tests level_test
        where level_test.track_id = v_track.id
      )
      or exists (
        select 1 from public.ops_registration_consultations consultation
        where consultation.track_id = v_track.id
      )
      or exists (
        select 1 from public.ops_registration_enrollments enrollment
        where enrollment.track_id = v_track.id
      )
      or exists (
        select 1
        from public.ops_task_events event
        where event.task_id = p_task_id
          and event.field_name = 'registration_track:' || v_track.id::text
          and not (
            event.event_type = 'registration_track_event'
            and (event.after_value::jsonb ->> 'eventType') = 'director_default_resolved'
          )
      )
    then
      raise exception 'registration_subject_removal_blocked' using errcode = '40001';
    end if;

    insert into public.ops_task_events(
      task_id, actor_id, event_type, field_name, before_value, after_value
    ) values (
      p_task_id,
      v_actor_id,
      'registration_subject_removed',
      'registration_subject',
      v_track.subject,
      pg_catalog.jsonb_build_object(
        'version', 1,
        'actorId', v_actor_id,
        'trackId', v_track.id,
        'subject', v_track.subject,
        'directorProfileId', v_track.director_profile_id,
        'directorAssignmentSource', v_track.director_assignment_source,
        'directorAssignmentRuleKey', v_track.director_assignment_rule_key,
        'occurredAt', pg_catalog.now()
      )::text
    );
    delete from public.ops_registration_subject_tracks where id = v_track.id;
  end loop;

  insert into public.ops_registration_subject_tracks(
    task_id, subject, pipeline_status, migration_review_required
  )
  select p_task_id, subject.value, 'inquiry', false
  from pg_catalog.unnest(v_subjects) subject(value)
  where not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and track.subject = subject.value
  )
  order by case subject.value when '영어' then 0 else 1 end;

  select pg_catalog.count(*)
  into v_remaining_count
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id;
  if v_remaining_count not between 1 and 2
    or v_remaining_count <> pg_catalog.cardinality(v_subjects)
    or exists (
      select 1
      from pg_catalog.unnest(v_subjects) subject(value)
      where not exists (
        select 1
        from public.ops_registration_subject_tracks track
        where track.task_id = p_task_id
          and track.subject = subject.value
      )
    )
  then
    raise exception 'registration_subject_track_coverage_mismatch' using errcode = '23514';
  end if;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value
  ) values (
    p_task_id,
    v_actor_id,
    'registration_subjects_synced',
    'registration_subjects',
    null,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'actorId', v_actor_id,
      'subjects', pg_catalog.to_jsonb(v_subjects),
      'occurredAt', pg_catalog.now()
    )::text
  );
  perform dashboard_private.recompute_registration_parent(p_task_id);

  select pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'subjects', pg_catalog.to_jsonb(v_subjects),
    'tracks', coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', track.id,
          'taskId', track.task_id,
          'subject', track.subject,
          'status', track.pipeline_status,
          'directorProfileId', track.director_profile_id,
          'directorAssignmentSource', track.director_assignment_source,
          'directorAssignmentRuleKey', track.director_assignment_rule_key,
          'waitingKind', track.waiting_kind,
          'levelTestRetakeDecision', track.level_test_retake_decision,
          'migrationReviewRequired', track.migration_review_required,
          'stageEnteredAt', track.stage_entered_at
        ) order by case track.subject when '영어' then 0 else 1 end, track.id
      ),
      '[]'::jsonb
    )
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id;

  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, p_task_id, 'sync_subjects', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.sync_registration_case_subjects_impl(uuid, text[], text)
  owner to postgres;
revoke execute on function dashboard_private.sync_registration_case_subjects_impl(uuid, text[], text)
  from public, anon;
grant execute on function dashboard_private.sync_registration_case_subjects_impl(uuid, text[], text)
  to authenticated;

create function public.sync_registration_case_subjects(
  p_task_id uuid,
  p_subjects text[],
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.sync_registration_case_subjects_impl(
    p_task_id, p_subjects, p_request_key
  );
$$;

revoke execute on function public.sync_registration_case_subjects(uuid, text[], text)
  from public, anon;
grant execute on function public.sync_registration_case_subjects(uuid, text[], text)
  to authenticated;

create function dashboard_private.update_registration_case_common_impl(
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
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_student_name text := nullif(pg_catalog.btrim(p_student_name), '');
  v_school_grade text := nullif(pg_catalog.btrim(p_school_grade), '');
  v_school_name text := nullif(pg_catalog.btrim(p_school_name), '');
  v_parent_phone text := nullif(pg_catalog.btrim(p_parent_phone), '');
  v_student_phone text := nullif(pg_catalog.btrim(p_student_phone), '');
  v_campus text := nullif(pg_catalog.btrim(p_campus), '');
  v_request_note text := nullif(pg_catalog.btrim(p_request_note), '');
  v_priority text := nullif(pg_catalog.btrim(p_priority), '');
  v_parent_phone_digits text;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_student public.students%rowtype;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_identity_changed boolean;
  v_identity_frozen boolean;
  v_student_matches boolean := false;
  v_clear_student_link boolean := false;
  v_next_revision integer;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_student_name is null then
    raise exception 'registration_student_name_required' using errcode = '22023';
  end if;
  if v_school_grade is null then
    raise exception 'registration_school_grade_required' using errcode = '22023';
  end if;
  v_parent_phone_digits := pg_catalog.regexp_replace(coalesce(v_parent_phone, ''), '\D+', '', 'g');
  if v_parent_phone_digits !~ '^01(0|1|[6-9])[0-9]{7,8}$' then
    raise exception 'registration_parent_phone_invalid' using errcode = '22023';
  end if;
  if p_inquiry_at is null then
    raise exception 'registration_inquiry_at_required' using errcode = '22023';
  end if;
  if v_campus is null or v_campus not in ('본관', '별관') then
    raise exception 'registration_campus_invalid' using errcode = '22023';
  end if;
  if v_priority is null or v_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'registration_priority_invalid' using errcode = '22023';
  end if;
  if p_expected_common_revision is null or p_expected_common_revision <= 0 then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'studentName', v_student_name,
    'schoolGrade', v_school_grade,
    'schoolName', v_school_name,
    'parentPhone', v_parent_phone,
    'studentPhone', v_student_phone,
    'campus', v_campus,
    'inquiryAt', p_inquiry_at,
    'requestNote', v_request_note,
    'priority', v_priority,
    'expectedCommonRevision', p_expected_common_revision
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by track.id
  for update;
  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'update_common'
  );

  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'update_common'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;
  if v_detail.common_revision <> p_expected_common_revision then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
  end if;

  v_identity_changed :=
    pg_catalog.lower(pg_catalog.regexp_replace(coalesce(v_task.student_name, ''), '\s+', '', 'g'))
      is distinct from pg_catalog.lower(pg_catalog.regexp_replace(v_student_name, '\s+', '', 'g'))
    or nullif(pg_catalog.btrim(v_detail.school_name), '') is distinct from v_school_name
    or pg_catalog.regexp_replace(coalesce(v_detail.parent_phone, ''), '\D+', '', 'g')
      is distinct from v_parent_phone_digits
    or nullif(pg_catalog.regexp_replace(coalesce(v_detail.student_phone, ''), '\D+', '', 'g'), '')
      is distinct from nullif(pg_catalog.regexp_replace(coalesce(v_student_phone, ''), '\D+', '', 'g'), '');

  if v_task.student_id is not null then
    select student.*
    into v_student
    from public.students student
    where student.id = v_task.student_id
    for update;
    if not found then
      raise exception 'registration_student_identity_mismatch' using errcode = '23514';
    end if;
    v_student_matches :=
      pg_catalog.lower(pg_catalog.regexp_replace(coalesce(v_student.name, ''), '\s+', '', 'g'))
        = pg_catalog.lower(pg_catalog.regexp_replace(v_student_name, '\s+', '', 'g'))
      and nullif(pg_catalog.btrim(v_student.school), '') is not distinct from v_school_name
      and pg_catalog.regexp_replace(coalesce(v_student.parent_contact, ''), '\D+', '', 'g')
        = v_parent_phone_digits
      and nullif(pg_catalog.regexp_replace(coalesce(v_student.contact, ''), '\D+', '', 'g'), '')
        is not distinct from nullif(pg_catalog.regexp_replace(coalesce(v_student_phone, ''), '\D+', '', 'g'), '');
  end if;

  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = p_task_id
  order by batch.id
  for update;
  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = p_task_id
  order by enrollment.id
  for update of enrollment;
  perform 1
  from public.ops_registration_messages message
  where message.task_id = p_task_id
    and message.template_key = 'admission_application'
  order by message.id
  for update;

  v_identity_frozen :=
    v_detail.admission_notice_sent
    or exists (
      select 1
      from public.ops_registration_admission_batches batch
      where batch.task_id = p_task_id
    )
    or exists (
      select 1
      from public.ops_registration_enrollments enrollment
      join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
      where track.task_id = p_task_id
        and not (
          enrollment.status = 'planned'
          and enrollment.admission_batch_id is null
        )
    )
    or exists (
      select 1
      from public.ops_registration_messages message
      where message.task_id = p_task_id
        and message.template_key = 'admission_application'
        and message.claim_active
    );
  if v_identity_changed and v_identity_frozen then
    raise exception 'registration_student_identity_correction_required' using errcode = '40001';
  end if;
  v_clear_student_link := v_identity_changed
    and v_task.student_id is not null
    and not v_student_matches;

  update public.ops_tasks
  set
    student_name = v_student_name,
    title = '등록: ' || v_student_name,
    campus = v_campus,
    priority = v_priority,
    student_id = case when v_clear_student_link then null else student_id end,
    updated_at = pg_catalog.now()
  where id = p_task_id;

  update public.ops_registration_details
  set
    inquiry_at = p_inquiry_at,
    school_grade = v_school_grade,
    school_name = v_school_name,
    parent_phone = v_parent_phone,
    student_phone = v_student_phone,
    request_note = v_request_note,
    common_revision = common_revision + 1,
    updated_at = pg_catalog.now()
  where task_id = p_task_id
  returning common_revision into v_next_revision;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value
  ) values (
    p_task_id,
    v_actor_id,
    'registration_common_info_updated',
    'registration_common',
    pg_catalog.jsonb_build_object(
      'commonRevision', v_detail.common_revision,
      'studentName', v_task.student_name,
      'schoolGrade', v_detail.school_grade,
      'schoolName', v_detail.school_name,
      'parentPhone', v_detail.parent_phone,
      'studentPhone', v_detail.student_phone,
      'campus', v_task.campus,
      'inquiryAt', v_detail.inquiry_at,
      'requestNote', v_detail.request_note,
      'priority', v_task.priority
    )::text,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'commonRevision', v_next_revision,
      'studentName', v_student_name,
      'schoolGrade', v_school_grade,
      'schoolName', v_school_name,
      'parentPhone', v_parent_phone,
      'studentPhone', v_student_phone,
      'campus', v_campus,
      'inquiryAt', p_inquiry_at,
      'requestNote', v_request_note,
      'priority', v_priority,
      'occurredAt', pg_catalog.now()
    )::text
  );
  if v_clear_student_link then
    insert into public.ops_task_events(
      task_id, actor_id, event_type, field_name, before_value, after_value
    ) values (
      p_task_id,
      v_actor_id,
      'student_link_recheck_required',
      'student_id',
      v_task.student_id::text,
      null
    );
  end if;

  perform dashboard_private.recompute_registration_parent(p_task_id);
  v_response := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'commonRevision', v_next_revision
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, p_task_id, 'update_common', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.update_registration_case_common_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
) owner to postgres;
revoke execute on function dashboard_private.update_registration_case_common_impl(uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text) from public, anon;
grant execute on function dashboard_private.update_registration_case_common_impl(uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text) to authenticated;

create function public.update_registration_case_common(
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
security invoker
set search_path = ''
as $$
  select dashboard_private.update_registration_case_common_impl(
    p_task_id, p_student_name, p_school_grade, p_school_name,
    p_parent_phone, p_student_phone, p_campus, p_inquiry_at,
    p_request_note, p_priority, p_expected_common_revision, p_request_key
  );
$$;

revoke execute on function public.update_registration_case_common(uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text) from public, anon;
grant execute on function public.update_registration_case_common(uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text) to authenticated;

create function dashboard_private.route_registration_inquiry_impl(
  p_track_id uuid,
  p_destination text,
  p_waiting_kind text,
  p_class_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_destination text := nullif(pg_catalog.btrim(p_destination), '');
  v_waiting_kind text := nullif(pg_catalog.btrim(p_waiting_kind), '');
  v_task_id uuid;
  v_source_status text;
  v_consultation_id uuid;
  v_enrollment_id uuid;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_destination is null
    or v_destination not in ('consultation_waiting', 'waiting', 'inquiry_closed')
  then
    raise exception 'registration_inquiry_destination_invalid' using errcode = '22023';
  end if;
  if v_destination = 'waiting' then
    if v_waiting_kind is null
      or v_waiting_kind not in ('current_class', 'current_term_opening', 'next_term_opening')
    then
      raise exception 'waiting_kind_required' using errcode = '22023';
    end if;
    if v_waiting_kind = 'current_class' and p_class_id is null then
      raise exception 'waiting_class_required' using errcode = '22023';
    end if;
    if v_waiting_kind <> 'current_class' and p_class_id is not null then
      raise exception 'waiting_class_not_allowed' using errcode = '22023';
    end if;
  elsif v_waiting_kind is not null then
    raise exception 'waiting_kind_not_allowed' using errcode = '22023';
  elsif p_class_id is not null then
    raise exception 'waiting_class_not_allowed' using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', null,
    'trackId', p_track_id,
    'destination', v_destination,
    'waitingKind', v_waiting_kind,
    'classId', p_class_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_set(
    v_target_fingerprint, '{taskId}', pg_catalog.to_jsonb(v_task_id), true
  );

  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;
  select track.pipeline_status
  into v_source_status
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, p_track_id, 'route_inquiry'
  );

  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'route_inquiry'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;
  if v_source_status <> 'inquiry' then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;

  if v_destination = 'consultation_waiting' then
    perform dashboard_private.assert_registration_track_director_ready(p_track_id);
    insert into public.ops_registration_consultations(
      track_id, appointment_id, mode, status, director_profile_id
    )
    select p_track_id, null, 'phone', 'waiting', track.director_profile_id
    from public.ops_registration_subject_tracks track
    where track.id = p_track_id
    returning id into v_consultation_id;
  elsif v_destination = 'waiting' and v_waiting_kind = 'current_class' then
    perform dashboard_private.apply_registration_current_class_wait(
      v_task_id, p_track_id, p_class_id, v_actor_id
    );
    select enrollment.id
    into v_enrollment_id
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.status = 'waitlisted'
      and enrollment.roster_active
    for update;
    if not found then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
  end if;

  perform dashboard_private.transition_registration_track_status(
    p_track_id,
    v_destination,
    case when v_destination = 'waiting' then v_waiting_kind else null end,
    null,
    false
  );
  perform dashboard_private.write_registration_track_event(
    v_task_id,
    p_track_id,
    'inquiry_routed',
    v_source_status,
    v_destination,
    null,
    pg_catalog.jsonb_build_object(
      'waitingKind', v_waiting_kind,
      'classId', p_class_id,
      'consultationId', v_consultation_id,
      'enrollmentId', v_enrollment_id
    )
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);

  select pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', track.id,
    'subject', track.subject,
    'status', track.pipeline_status,
    'waitingKind', track.waiting_kind,
    'consultationId', v_consultation_id,
    'enrollmentId', v_enrollment_id,
    'directorProfileId', track.director_profile_id,
    'stageEnteredAt', track.stage_entered_at
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;

  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'route_inquiry', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.route_registration_inquiry_impl(uuid, text, text, uuid, text)
  owner to postgres;
revoke execute on function dashboard_private.route_registration_inquiry_impl(uuid, text, text, uuid, text) from public, anon;
grant execute on function dashboard_private.route_registration_inquiry_impl(uuid, text, text, uuid, text) to authenticated;

create function public.route_registration_inquiry(
  p_track_id uuid,
  p_destination text,
  p_waiting_kind text,
  p_class_id uuid,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.route_registration_inquiry_impl(
    p_track_id, p_destination, p_waiting_kind, p_class_id, p_request_key
  );
$$;

revoke execute on function public.route_registration_inquiry(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.route_registration_inquiry(uuid, text, text, uuid, text) to authenticated;

create function dashboard_private.assign_registration_track_director_impl(
  p_track_id uuid,
  p_director_profile_id uuid,
  p_assignment_source text,
  p_rule_key text,
  p_expected_common_revision integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_assignment_source text := nullif(pg_catalog.btrim(p_assignment_source), '');
  v_rule_key text := nullif(pg_catalog.btrim(p_rule_key), '');
  v_task_id uuid;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_resolution jsonb;
  v_visit_appointment_id uuid;
  v_phone_consultation_id uuid;
  v_phone_director_id uuid;
  v_track_id uuid;
  v_notification_id uuid;
  v_notification_dedupe_key text;
  v_event_type text;
  v_next_source text;
  v_next_rule_key text;
  v_next_assigned_at timestamptz;
  v_assignment_changed boolean;
  v_phone_created boolean := false;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_assignment_source is null
    or v_assignment_source not in ('default', 'manual', 'clear_default')
  then
    raise exception 'registration_director_assignment_source_invalid' using errcode = '22023';
  end if;
  if p_expected_common_revision is null or p_expected_common_revision <= 0 then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', null,
    'trackId', p_track_id,
    'directorProfileId', p_director_profile_id,
    'assignmentSource', v_assignment_source,
    'ruleKey', v_rule_key,
    'expectedCommonRevision', p_expected_common_revision
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_set(
    v_target_fingerprint, '{taskId}', pg_catalog.to_jsonb(v_task_id), true
  );

  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  select consultation.appointment_id
  into v_visit_appointment_id
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
    and consultation.mode = 'visit'
    and consultation.status = 'scheduled'
  order by consultation.id
  limit 1;
  if v_visit_appointment_id is not null then
    perform 1
    from public.ops_registration_appointments appointment
    where appointment.id = v_visit_appointment_id
    for update;
  end if;
  perform 1
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
    and consultation.status in ('waiting', 'scheduled')
  order by consultation.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, p_track_id, 'assign_director'
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
  if v_receipt_found then return v_response; end if;
  if v_detail.common_revision <> p_expected_common_revision then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
  end if;
  if v_track.pipeline_status in ('registered', 'not_registered', 'inquiry_closed') then
    raise exception 'registration_director_assignment_terminal' using errcode = '40001';
  end if;
  if v_visit_appointment_id is not null then
    raise exception 'registration_visit_reassign_requires_reschedule' using errcode = '40001';
  end if;

  v_resolution := dashboard_private.resolve_registration_default_director(
    v_track.subject, v_detail.school_grade, v_detail.inquiry_at
  );
  if v_assignment_source = 'default' then
    if p_director_profile_id is null or v_rule_key is null
      or v_track.director_assignment_source is not null
        and v_track.director_assignment_source <> 'default'
      or v_resolution ->> 'status' <> 'resolved'
      or nullif(v_resolution ->> 'profileId', '')::uuid is distinct from p_director_profile_id
      or v_resolution ->> 'ruleKey' is distinct from v_rule_key
    then
      raise exception 'registration_director_default_stale' using errcode = '40001';
    end if;
    if not dashboard_private.is_active_registration_director(p_director_profile_id) then
      raise exception 'registration_director_refresh_required' using errcode = '40001';
    end if;
    v_next_source := 'default';
    v_next_rule_key := v_rule_key;
    v_event_type := 'director_default_resolved';
  elsif v_assignment_source = 'manual' then
    if p_director_profile_id is null or v_rule_key is not null then
      raise exception 'registration_director_manual_invalid' using errcode = '22023';
    end if;
    if not dashboard_private.is_active_registration_director(p_director_profile_id) then
      raise exception 'registration_director_refresh_required' using errcode = '40001';
    end if;
    v_next_source := 'manual';
    v_next_rule_key := null;
    v_event_type := 'director_manual_override';
  else
    if p_director_profile_id is not null or v_rule_key is not null
      or v_track.director_assignment_source is not null
        and v_track.director_assignment_source <> 'default'
    then
      raise exception 'registration_director_clear_denied' using errcode = '40001';
    end if;
    if v_resolution ->> 'status' = 'resolved' then
      raise exception 'registration_director_default_stale' using errcode = '40001';
    end if;
    v_next_source := null;
    v_next_rule_key := null;
    v_event_type := 'director_default_cleared';
  end if;

  v_assignment_changed :=
    v_track.director_profile_id is distinct from p_director_profile_id
    or v_track.director_assignment_source is distinct from v_next_source
    or v_track.director_assignment_rule_key is distinct from v_next_rule_key;
  v_next_assigned_at := case
    when p_director_profile_id is null then null
    when v_assignment_changed then pg_catalog.now()
    else v_track.director_assigned_at
  end;
  if v_assignment_changed then
    update public.ops_registration_subject_tracks
    set
      director_profile_id = p_director_profile_id,
      director_assignment_source = v_next_source,
      director_assignment_rule_key = v_next_rule_key,
      director_assigned_at = v_next_assigned_at,
      updated_at = pg_catalog.now()
    where id = p_track_id;
  end if;

  select consultation.id, consultation.director_profile_id
  into v_phone_consultation_id, v_phone_director_id
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
    and consultation.mode = 'phone'
    and consultation.status = 'waiting'
  order by consultation.id
  limit 1
  for update;

  if p_director_profile_id is not null then
    if v_phone_consultation_id is not null then
      delete from public.dashboard_notifications notification
      where notification.type = 'registration_consultation'
        and notification.read_at is null
        and notification.recipient_profile_id is distinct from p_director_profile_id
        and notification.dedupe_key =
          'registration:' || v_task_id::text || ':track:' || p_track_id::text
          || ':consultation:' || v_phone_consultation_id::text
          || ':director:' || v_phone_director_id::text;
      if v_phone_director_id is distinct from p_director_profile_id then
        update public.ops_registration_consultations
        set director_profile_id = p_director_profile_id,
            updated_at = pg_catalog.now()
        where id = v_phone_consultation_id;
      end if;
    elsif v_track.pipeline_status = 'consultation_waiting' then
      insert into public.ops_registration_consultations(
        track_id, appointment_id, mode, status, director_profile_id
      ) values (
        p_track_id, null, 'phone', 'waiting', p_director_profile_id
      ) returning id into v_phone_consultation_id;
      v_phone_created := true;
    end if;

    if v_phone_consultation_id is not null then
      v_notification_dedupe_key :=
        'registration:' || v_task_id::text || ':track:' || p_track_id::text
        || ':consultation:' || v_phone_consultation_id::text
        || ':director:' || p_director_profile_id::text;
      insert into public.dashboard_notifications as existing(
        recipient_profile_id, recipient_team, actor_profile_id, type,
        title, body, href, metadata, dedupe_key
      ) values (
        p_director_profile_id,
        null,
        v_actor_id,
        'registration_consultation',
        '[' || v_track.subject || '] 전화상담 대기',
        v_task.student_name || ' 학생 상담을 확인하세요.',
        '/admin/registration?taskId=' || v_task_id::text || '&trackId=' || p_track_id::text,
        pg_catalog.jsonb_build_object(
          'taskId', v_task_id,
          'trackId', p_track_id,
          'consultationId', v_phone_consultation_id,
          'subject', v_track.subject,
          'directorProfileId', p_director_profile_id
        ),
        v_notification_dedupe_key
      )
      on conflict (dedupe_key) do update
      set
        recipient_profile_id = excluded.recipient_profile_id,
        recipient_team = excluded.recipient_team,
        actor_profile_id = excluded.actor_profile_id,
        type = excluded.type,
        title = excluded.title,
        body = excluded.body,
        href = excluded.href,
        metadata = excluded.metadata,
        read_at = null,
        created_at = pg_catalog.now()
      where v_track.director_profile_id is distinct from p_director_profile_id
      returning existing.id into v_notification_id;
      if v_notification_id is null then
        select notification.id
        into v_notification_id
        from public.dashboard_notifications notification
        where notification.dedupe_key = v_notification_dedupe_key;
      end if;
    end if;
  elsif v_phone_consultation_id is not null then
    delete from public.dashboard_notifications notification
    where notification.type = 'registration_consultation'
      and notification.read_at is null
      and notification.dedupe_key =
        'registration:' || v_task_id::text || ':track:' || p_track_id::text
        || ':consultation:' || v_phone_consultation_id::text
        || ':director:' || v_phone_director_id::text;
  end if;

  if v_assignment_changed then
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      p_track_id,
      v_event_type,
      coalesce(v_track.director_assignment_source, 'unassigned'),
      coalesce(v_next_source, 'unassigned'),
      null,
      pg_catalog.jsonb_build_object(
        'previousDirectorProfileId', v_track.director_profile_id,
        'directorProfileId', p_director_profile_id,
        'ruleKey', v_next_rule_key,
        'consultationId', v_phone_consultation_id,
        'notificationDedupeKey', v_notification_dedupe_key
      )
    );
  elsif v_phone_created then
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      p_track_id,
      'director_phone_queue_repaired',
      v_track.pipeline_status,
      v_track.pipeline_status,
      null,
      pg_catalog.jsonb_build_object(
        'directorProfileId', p_director_profile_id,
        'consultationId', v_phone_consultation_id,
        'notificationDedupeKey', v_notification_dedupe_key
      )
    );
  end if;

  perform dashboard_private.recompute_registration_parent(v_task_id);
  select pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'commonRevision', v_detail.common_revision,
    'trackId', track.id,
    'subject', track.subject,
    'status', track.pipeline_status,
    'directorProfileId', track.director_profile_id,
    'directorAssignmentSource', track.director_assignment_source,
    'directorAssignmentRuleKey', track.director_assignment_rule_key,
    'directorAssignedAt', track.director_assigned_at,
    'consultationId', v_phone_consultation_id,
    'notificationId', v_notification_id,
    'notificationDedupeKey', v_notification_dedupe_key,
    'requiresDirectorAssignment', track.director_profile_id is null
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;

  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'assign_director', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.assign_registration_track_director_impl(uuid, uuid, text, text, integer, text)
  owner to postgres;
revoke execute on function dashboard_private.assign_registration_track_director_impl(uuid, uuid, text, text, integer, text) from public, anon;
grant execute on function dashboard_private.assign_registration_track_director_impl(uuid, uuid, text, text, integer, text) to authenticated;

create function public.assign_registration_track_director(
  p_track_id uuid,
  p_director_profile_id uuid,
  p_assignment_source text,
  p_rule_key text,
  p_expected_common_revision integer,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.assign_registration_track_director_impl(
    p_track_id, p_director_profile_id, p_assignment_source,
    p_rule_key, p_expected_common_revision, p_request_key
  );
$$;

revoke execute on function public.assign_registration_track_director(uuid, uuid, text, text, integer, text) from public, anon;
grant execute on function public.assign_registration_track_director(uuid, uuid, text, text, integer, text) to authenticated;

create function dashboard_private.save_registration_shared_appointment_impl(
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
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_place text := nullif(pg_catalog.btrim(p_place), '');
  v_track_ids uuid[];
  v_track_count integer;
  v_task_exists boolean := false;
  v_task_student_id uuid;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_appointment public.ops_registration_appointments%rowtype;
  v_appointment_id uuid;
  v_new_appointment_id uuid;
  v_activity_id uuid;
  v_activity_ids uuid[] := array[]::uuid[];
  v_existing_track_ids uuid[] := array[]::uuid[];
  v_scheduled_track_ids uuid[] := array[]::uuid[];
  v_added_track_ids uuid[] := array[]::uuid[];
  v_deselected_track_ids uuid[] := array[]::uuid[];
  v_active_track_ids uuid[] := array[]::uuid[];
  v_canceled_track_ids uuid[] := array[]::uuid[];
  v_requires_director_assignment_track_ids uuid[] := array[]::uuid[];
  v_attempt_number integer;
  v_latest_attempt_status text;
  v_active_activity_count integer;
  v_child_count integer := 0;
  v_terminal_child_count integer := 0;
  v_real_diff boolean := false;
  v_director_ready boolean;
  v_old_notification_revision integer;
  v_new_notification_revision integer := 1;
  v_old_appointment_status text;
  v_notification_targets jsonb := '[]'::jsonb;
  v_phone_consultation_id uuid;
  v_phone_director_id uuid;
  v_phone_consultation_count integer;
  v_wait_enrollment_id uuid;
  v_wait_student_id uuid;
  v_wait_class_id uuid;
  v_event_type text;
  v_track record;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('level_test', 'visit_consultation') then
    raise exception 'registration_appointment_kind_invalid' using errcode = '22023';
  end if;
  if p_scheduled_at is null then
    raise exception 'registration_appointment_scheduled_at_required' using errcode = '22023';
  end if;
  if v_place is null then
    raise exception 'registration_appointment_place_required' using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct track_id order by track_id),
    array[]::uuid[]
  )
  into v_track_ids
  from pg_catalog.unnest(coalesce(p_track_ids, array[]::uuid[])) selected(track_id)
  where track_id is not null;
  if pg_catalog.cardinality(v_track_ids) not between 1 and 2 then
    raise exception 'registration_appointment_tracks_required' using errcode = '22023';
  end if;
  if p_appointment_id is null
    and p_expected_notification_revision is not null
  then
    raise exception 'registration_appointment_revision_conflict' using errcode = '40001';
  end if;
  if p_appointment_id is null and coalesce(p_replace_remaining, false) then
    raise exception 'registration_appointment_replacement_requires_existing' using errcode = '22023';
  end if;
  if p_appointment_id is not null
    and p_expected_notification_revision is null
  then
    raise exception 'registration_appointment_revision_conflict' using errcode = '40001';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'appointmentId', p_appointment_id,
    'taskId', p_task_id,
    'kind', p_kind,
    'scheduledAt', p_scheduled_at,
    'place', v_place,
    'trackIds', pg_catalog.to_jsonb(v_track_ids),
    'replaceRemaining', coalesce(p_replace_remaining, false),
    'expectedNotificationRevision', p_expected_notification_revision
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select task.student_id
  into v_task_student_id
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  v_task_exists := found;
  if not v_task_exists then
    raise exception 'registration_appointment_task_mismatch' using errcode = '42501';
  end if;

  perform 1
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- appointment_parent_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by track.id
  for update;
  select pg_catalog.count(*)
  into v_track_count
  from public.ops_registration_subject_tracks track
  where track.id = any(v_track_ids)
    and track.task_id = p_task_id;
  if v_track_count <> pg_catalog.cardinality(v_track_ids) then
    raise exception 'registration_appointment_task_mismatch' using errcode = '22023';
  end if;

  -- appointment_row_lock
  if p_appointment_id is not null then
    select appointment.*
    into v_appointment
    from public.ops_registration_appointments appointment
    where appointment.id = p_appointment_id
      and appointment.task_id = p_task_id
    order by appointment.id
    for update;
    if not found or v_appointment.task_id is distinct from p_task_id then
      raise exception 'registration_appointment_task_mismatch' using errcode = '23514';
    end if;
    if v_appointment.kind is distinct from p_kind then
      raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
    end if;
  end if;

  -- appointment_activity_locks
  perform 1
  from public.ops_registration_level_tests attempt
  join public.ops_registration_subject_tracks track on track.id = attempt.track_id
  where track.task_id = p_task_id
  order by attempt.id
  for update of attempt;

  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = p_task_id
  order by consultation.id
  for update of consultation;

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'save_appointment'
  );

  -- appointment_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'save_appointment'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- appointment_stale_revision_check
  if p_appointment_id is not null
    and v_appointment.notification_revision is distinct from p_expected_notification_revision
  then
    raise exception 'registration_appointment_revision_conflict' using errcode = '40001';
  end if;

  if p_appointment_id is not null then
    if exists (
      select 1
      from public.ops_registration_level_tests attempt
      join public.ops_registration_subject_tracks track on track.id = attempt.track_id
      where attempt.appointment_id = p_appointment_id
        and track.task_id is distinct from p_task_id
    ) or exists (
      select 1
      from public.ops_registration_consultations consultation
      join public.ops_registration_subject_tracks track on track.id = consultation.track_id
      where consultation.appointment_id = p_appointment_id
        and track.task_id is distinct from p_task_id
    ) then
      raise exception 'registration_appointment_task_mismatch' using errcode = '23514';
    end if;

    if p_kind = 'level_test' then
      if exists (
        select 1
        from public.ops_registration_consultations consultation
        where consultation.appointment_id = p_appointment_id
      ) then
        raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
      end if;

      select
        pg_catalog.count(*),
        coalesce(
          pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id),
          array[]::uuid[]
        ),
        coalesce(
          pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id)
            filter (where attempt.status = 'scheduled'),
          array[]::uuid[]
        ),
        pg_catalog.count(*) filter (
          where attempt.status in ('in_progress', 'completed', 'absent', 'canceled')
        )
      into
        v_child_count,
        v_existing_track_ids,
        v_scheduled_track_ids,
        v_terminal_child_count
      from public.ops_registration_level_tests attempt
      where attempt.appointment_id = p_appointment_id;
    else
      if exists (
        select 1
        from public.ops_registration_level_tests attempt
        where attempt.appointment_id = p_appointment_id
      ) or exists (
        select 1
        from public.ops_registration_consultations consultation
        where consultation.appointment_id = p_appointment_id
          and consultation.mode <> 'visit'
      ) then
        raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
      end if;

      select
        pg_catalog.count(*),
        coalesce(
          pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id),
          array[]::uuid[]
        ),
        coalesce(
          pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id)
            filter (where consultation.status = 'scheduled'),
          array[]::uuid[]
        ),
        pg_catalog.count(*) filter (
          where consultation.status in ('completed', 'canceled')
        )
      into
        v_child_count,
        v_existing_track_ids,
        v_scheduled_track_ids,
        v_terminal_child_count
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = p_appointment_id
        and consultation.mode = 'visit';
    end if;

    if v_child_count = 0 then
      raise exception 'registration_appointment_tracks_required' using errcode = '23514';
    end if;
    if v_appointment.status <> 'scheduled' then
      raise exception 'registration_appointment_immutable' using errcode = '40001';
    end if;

    select coalesce(
      pg_catalog.array_agg(candidate.track_id order by candidate.track_id),
      array[]::uuid[]
    )
    into v_added_track_ids
    from (
      select selected.track_id
      from pg_catalog.unnest(v_track_ids) selected(track_id)
      except
      select existing.track_id
      from pg_catalog.unnest(v_existing_track_ids) existing(track_id)
    ) candidate;

    select coalesce(
      pg_catalog.array_agg(candidate.track_id order by candidate.track_id),
      array[]::uuid[]
    )
    into v_deselected_track_ids
    from (
      select existing.track_id
      from pg_catalog.unnest(v_scheduled_track_ids) existing(track_id)
      except
      select selected.track_id
      from pg_catalog.unnest(v_track_ids) selected(track_id)
    ) candidate;

    if coalesce(p_replace_remaining, false) then
      -- replacement_appointment_edit
      if v_terminal_child_count = 0
        or pg_catalog.cardinality(v_scheduled_track_ids) = 0
      then
        raise exception 'registration_appointment_immutable' using errcode = '40001';
      end if;
      if v_track_ids is distinct from v_scheduled_track_ids then
        raise exception 'registration_appointment_replacement_track_set_mismatch' using errcode = '22023';
      end if;

      for v_track in
        select track.*
        from pg_catalog.unnest(v_scheduled_track_ids) selected(track_id)
        join public.ops_registration_subject_tracks track on track.id = selected.track_id
        where track.task_id = p_task_id
        order by track.id
      loop
        if p_kind = 'level_test' then
          if v_track.pipeline_status <> 'level_test_scheduled' then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
        else
          if v_track.pipeline_status <> 'visit_consultation_scheduled' then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
          perform dashboard_private.assert_registration_track_director_ready(v_track.id);
        end if;
      end loop;

      update public.ops_registration_appointments appointment
      set
        notification_revision = notification_revision + 1,
        updated_at = pg_catalog.now()
      where appointment.id = p_appointment_id
      returning appointment.notification_revision into v_old_notification_revision;

      if p_kind = 'level_test' then
        update public.ops_registration_level_tests attempt
        set
          status = 'canceled',
          completed_at = pg_catalog.now(),
          updated_at = pg_catalog.now()
        where attempt.appointment_id = p_appointment_id
          and attempt.status = 'scheduled';
      else
        update public.ops_registration_consultations consultation
        set
          status = 'canceled',
          updated_at = pg_catalog.now()
        where consultation.appointment_id = p_appointment_id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled';
      end if;
      if not found then
        raise exception 'registration_appointment_immutable' using errcode = '40001';
      end if;
      v_canceled_track_ids := v_scheduled_track_ids;

      insert into public.ops_registration_appointments(
        task_id,
        kind,
        scheduled_at,
        place,
        status,
        notification_revision,
        created_by
      ) values (
        p_task_id,
        p_kind,
        p_scheduled_at,
        v_place,
        'scheduled',
        1,
        v_actor_id
      ) returning id into v_new_appointment_id;

      v_activity_ids := array[]::uuid[];
      for v_track in
        select track.*
        from pg_catalog.unnest(v_scheduled_track_ids) selected(track_id)
        join public.ops_registration_subject_tracks track on track.id = selected.track_id
        where track.task_id = p_task_id
        order by track.id
      loop
        if p_kind = 'level_test' then
          select coalesce(max(attempt.attempt_number), 0) + 1
          into v_attempt_number
          from public.ops_registration_level_tests attempt
          where attempt.track_id = v_track.id;

          insert into public.ops_registration_level_tests(
            track_id, appointment_id, attempt_number, status
          ) values (
            v_track.id, v_new_appointment_id, v_attempt_number, 'scheduled'
          ) returning id into v_activity_id;

          perform dashboard_private.transition_registration_track_status(
            v_track.id, 'level_test_scheduled', null, null, false
          );
        else
          insert into public.ops_registration_consultations(
            track_id, appointment_id, mode, status, director_profile_id
          ) values (
            v_track.id,
            v_new_appointment_id,
            'visit',
            'scheduled',
            v_track.director_profile_id
          ) returning id into v_activity_id;

          perform dashboard_private.transition_registration_track_status(
            v_track.id, 'visit_consultation_scheduled', null, null, false
          );
        end if;

        v_activity_ids := pg_catalog.array_append(v_activity_ids, v_activity_id);
        perform dashboard_private.write_registration_track_event(
          p_task_id,
          v_track.id,
          'appointment_replaced',
          v_track.pipeline_status,
          v_track.pipeline_status,
          null,
          pg_catalog.jsonb_build_object(
            'oldAppointmentId', p_appointment_id,
            'newAppointmentId', v_new_appointment_id,
            'oldNotificationRevision', v_old_notification_revision,
            'notificationRevision', v_new_notification_revision,
            'kind', p_kind,
            'oldScheduledAt', v_appointment.scheduled_at,
            'oldPlace', v_appointment.place,
            'scheduledAt', p_scheduled_at,
            'place', v_place,
            'activeTrackIds', pg_catalog.to_jsonb(v_scheduled_track_ids),
            'canceledTrackIds', pg_catalog.to_jsonb(v_canceled_track_ids),
            'activityId', v_activity_id,
            'attemptNumber', case when p_kind = 'level_test' then v_attempt_number else null end,
            'changeKind', 'appointment_replaced'
          )
        );
      end loop;

      if p_kind = 'level_test' then
        if exists (
          select 1
          from public.ops_registration_level_tests attempt
          where attempt.appointment_id = p_appointment_id
            and attempt.status in ('scheduled', 'in_progress')
        ) then
          v_old_appointment_status := 'scheduled';
        elsif not exists (
          select 1
          from public.ops_registration_level_tests attempt
          where attempt.appointment_id = p_appointment_id
            and attempt.status in ('completed', 'absent', 'canceled')
            and attempt.status <> 'canceled'
        ) then
          v_old_appointment_status := 'canceled';
        else
          v_old_appointment_status := 'completed';
        end if;
      else
        if exists (
          select 1
          from public.ops_registration_consultations consultation
          where consultation.appointment_id = p_appointment_id
            and consultation.mode = 'visit'
            and consultation.status = 'scheduled'
        ) then
          v_old_appointment_status := 'scheduled';
        elsif not exists (
          select 1
          from public.ops_registration_consultations consultation
          where consultation.appointment_id = p_appointment_id
            and consultation.mode = 'visit'
            and consultation.status <> 'canceled'
        ) then
          v_old_appointment_status := 'canceled';
        else
          v_old_appointment_status := 'completed';
        end if;
      end if;

      update public.ops_registration_appointments appointment
      set status = v_old_appointment_status, updated_at = pg_catalog.now()
      where appointment.id = p_appointment_id;

      perform dashboard_private.recompute_registration_parent(p_task_id);

      v_notification_targets := case
        when p_kind = 'visit_consultation' then pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'appointmentId', p_appointment_id,
            'notificationRevision', v_old_notification_revision
          ),
          pg_catalog.jsonb_build_object(
            'appointmentId', v_new_appointment_id,
            'notificationRevision', v_new_notification_revision
          )
        )
        else '[]'::jsonb
      end;
      v_response := pg_catalog.jsonb_build_object(
        'taskId', p_task_id,
        'appointmentId', v_new_appointment_id,
        'notificationRevision', v_new_notification_revision,
        'oldAppointmentId', p_appointment_id,
        'newAppointmentId', v_new_appointment_id,
        'trackIds', pg_catalog.to_jsonb(v_scheduled_track_ids),
        'activityIds', pg_catalog.to_jsonb(v_activity_ids),
        'requiresDirectorAssignmentTrackIds', '[]'::jsonb,
        'notificationTargets', v_notification_targets
      );

      insert into dashboard_private.ops_registration_mutations(
        actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
      ) values (
        v_actor_id, v_request_key, p_task_id, 'save_appointment',
        v_target_fingerprint, v_response
      );
      return v_response;
    end if;

    -- ordinary_appointment_edit
    if v_terminal_child_count > 0
      or v_child_count <> pg_catalog.cardinality(v_scheduled_track_ids)
    then
      raise exception 'registration_appointment_immutable' using errcode = '40001';
    end if;

    for v_track in
      select track.*
      from pg_catalog.unnest(v_track_ids) selected(track_id)
      join public.ops_registration_subject_tracks track on track.id = selected.track_id
      where track.task_id = p_task_id
      order by track.id
    loop
      if p_kind = 'level_test' then
        select pg_catalog.count(*)
        into v_active_activity_count
        from public.ops_registration_level_tests attempt
        where attempt.track_id = v_track.id
          and attempt.status in ('scheduled', 'in_progress')
          and attempt.appointment_id is distinct from p_appointment_id;
        if v_active_activity_count > 0 then
          raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
        end if;

        if v_track.id = any(v_existing_track_ids) then
          if v_track.pipeline_status <> 'level_test_scheduled' then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
        else
          select attempt.status
          into v_latest_attempt_status
          from public.ops_registration_level_tests attempt
          where attempt.track_id = v_track.id
          order by attempt.attempt_number desc, attempt.id desc
          limit 1;
          if (
            v_track.pipeline_status = 'inquiry'
            or (
              v_track.pipeline_status = 'waiting'
              and v_track.level_test_retake_decision = 'required'
            )
            or (
              v_track.pipeline_status = 'level_test_scheduled'
              and v_latest_attempt_status in ('absent', 'canceled')
            )
          ) is not true then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
        end if;
      else
        perform dashboard_private.assert_registration_track_director_ready(v_track.id);
        select pg_catalog.count(*)
        into v_active_activity_count
        from public.ops_registration_consultations consultation
        where consultation.track_id = v_track.id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled'
          and consultation.appointment_id is distinct from p_appointment_id;
        if v_active_activity_count > 0 then
          raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
        end if;

        if v_track.id = any(v_existing_track_ids) then
          if v_track.pipeline_status <> 'visit_consultation_scheduled' then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
        else
          if v_track.pipeline_status <> 'consultation_waiting' then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
          select pg_catalog.count(*)
          into v_phone_consultation_count
          from public.ops_registration_consultations consultation
          where consultation.track_id = v_track.id
            and consultation.mode = 'phone'
            and consultation.status = 'waiting';
          if v_phone_consultation_count <> 1 then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
        end if;
      end if;
    end loop;

    v_real_diff := v_appointment.scheduled_at is distinct from p_scheduled_at
      or v_appointment.place is distinct from v_place
      or v_track_ids is distinct from v_existing_track_ids;
    if not v_real_diff then
      if p_kind = 'level_test' then
        select coalesce(
          pg_catalog.array_agg(attempt.id order by attempt.track_id, attempt.id),
          array[]::uuid[]
        )
        into v_activity_ids
        from public.ops_registration_level_tests attempt
        where attempt.appointment_id = p_appointment_id
          and attempt.status = 'scheduled';
      else
        select coalesce(
          pg_catalog.array_agg(consultation.id order by consultation.track_id, consultation.id),
          array[]::uuid[]
        )
        into v_activity_ids
        from public.ops_registration_consultations consultation
        where consultation.appointment_id = p_appointment_id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled';
      end if;

      v_response := pg_catalog.jsonb_build_object(
        'taskId', p_task_id,
        'appointmentId', p_appointment_id,
        'notificationRevision', v_appointment.notification_revision,
        'trackIds', pg_catalog.to_jsonb(v_existing_track_ids),
        'activityIds', pg_catalog.to_jsonb(v_activity_ids),
        'requiresDirectorAssignmentTrackIds', '[]'::jsonb,
        'notificationTargets', '[]'::jsonb
      );
      insert into dashboard_private.ops_registration_mutations(
        actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
      ) values (
        v_actor_id, v_request_key, p_task_id, 'save_appointment',
        v_target_fingerprint, v_response
      );
      return v_response;
    end if;

    if p_kind = 'level_test' and pg_catalog.cardinality(v_added_track_ids) > 0 then
      perform 1
      from public.students student
      join (
        select distinct enrollment.student_id
        from public.ops_registration_enrollments enrollment
        join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
        where track.id = any(v_added_track_ids)
          and track.task_id = p_task_id
          and track.pipeline_status = 'waiting'
          and track.waiting_kind = 'current_class'
          and track.level_test_retake_decision = 'required'
          and enrollment.status = 'waitlisted'
          and enrollment.roster_active
          and enrollment.student_id is not null
      ) affected on affected.student_id = student.id
      order by student.id
      for update of student;

      perform 1
      from public.ops_registration_enrollments enrollment
      join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
      where track.id = any(v_added_track_ids)
        and track.task_id = p_task_id
        and track.pipeline_status = 'waiting'
        and track.waiting_kind = 'current_class'
        and track.level_test_retake_decision = 'required'
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active
      order by enrollment.id
      for update of enrollment;

      perform 1
      from public.classes class
      join (
        select distinct enrollment.class_id
        from public.ops_registration_enrollments enrollment
        join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
        where track.id = any(v_added_track_ids)
          and track.task_id = p_task_id
          and track.pipeline_status = 'waiting'
          and track.waiting_kind = 'current_class'
          and track.level_test_retake_decision = 'required'
          and enrollment.status = 'waitlisted'
          and enrollment.roster_active
      ) affected on affected.class_id = class.id
      order by class.id
      for update of class;

      for v_track in
        select track.*
        from pg_catalog.unnest(v_added_track_ids) selected(track_id)
        join public.ops_registration_subject_tracks track on track.id = selected.track_id
        where track.task_id = p_task_id
          and track.pipeline_status = 'waiting'
          and track.waiting_kind = 'current_class'
          and track.level_test_retake_decision = 'required'
        order by track.id
      loop
        select enrollment.id, enrollment.student_id, enrollment.class_id
        into v_wait_enrollment_id, v_wait_student_id, v_wait_class_id
        from public.ops_registration_enrollments enrollment
        join public.classes class on class.id = enrollment.class_id
        where enrollment.track_id = v_track.id
          and enrollment.status = 'waitlisted'
          and enrollment.roster_active
          and pg_catalog.btrim(class.subject) = v_track.subject
          and enrollment.student_id = v_task_student_id
        order by enrollment.id
        for update of enrollment, class;
        if not found or v_wait_student_id is null then
          raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
        end if;

        perform dashboard_private.apply_student_class_roster_mode(
          v_wait_student_id,
          v_wait_class_id,
          'removed',
          'waitlist',
          v_wait_enrollment_id,
          'level_test_retake_scheduled',
          v_actor_id
        );
        update public.ops_registration_enrollments enrollment
        set
          status = 'canceled',
          roster_active = false,
          roster_released_at = null,
          roster_release_reason = null,
          roster_release_source_task_id = null,
          roster_release_kind = null,
          updated_at = pg_catalog.now()
        where enrollment.id = v_wait_enrollment_id
          and enrollment.roster_active;
        if not found then
          raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
        end if;
      end loop;
    end if;

    update public.ops_registration_appointments appointment
    set
      scheduled_at = p_scheduled_at,
      place = v_place,
      notification_revision = notification_revision + 1,
      updated_at = pg_catalog.now()
    where appointment.id = p_appointment_id
    returning appointment.notification_revision into v_old_notification_revision;

    for v_track in
      select track.*
      from pg_catalog.unnest(v_deselected_track_ids) selected(track_id)
      join public.ops_registration_subject_tracks track on track.id = selected.track_id
      where track.task_id = p_task_id
      order by track.id
    loop
      v_phone_consultation_id := null;
      if p_kind = 'level_test' then
        update public.ops_registration_level_tests attempt
        set
          status = 'canceled',
          completed_at = pg_catalog.now(),
          updated_at = pg_catalog.now()
        where attempt.appointment_id = p_appointment_id
          and attempt.track_id = v_track.id
          and attempt.status = 'scheduled';
        if not found then
          raise exception 'registration_appointment_immutable' using errcode = '40001';
        end if;

        select pg_catalog.count(*)
        into v_active_activity_count
        from public.ops_registration_level_tests attempt
        where attempt.track_id = v_track.id
          and attempt.status in ('scheduled', 'in_progress');
        if v_active_activity_count = 0 then
          perform dashboard_private.transition_registration_track_status(
            v_track.id, 'inquiry', null, null, false
          );
        end if;
      else
        update public.ops_registration_consultations consultation
        set status = 'canceled', updated_at = pg_catalog.now()
        where consultation.appointment_id = p_appointment_id
          and consultation.track_id = v_track.id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled';
        if not found then
          raise exception 'registration_appointment_immutable' using errcode = '40001';
        end if;

        perform dashboard_private.transition_registration_track_status(
          v_track.id, 'consultation_waiting', null, null, false
        );
        v_director_ready := true;
        begin
          perform dashboard_private.assert_registration_track_director_ready(v_track.id);
        exception
          when sqlstate '40001' then
            if sqlerrm is distinct from 'registration_director_refresh_required' then
              raise;
            end if;
            v_director_ready := false;
        end;

        if v_director_ready then
          if exists (
            select 1
            from public.ops_registration_consultations consultation
            where consultation.mode = 'phone'
              and consultation.status = 'waiting'
              and consultation.track_id = v_track.id
          ) then
            raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
          end if;
          insert into public.ops_registration_consultations(
            track_id, appointment_id, mode, status, director_profile_id
          ) values (
            v_track.id, null, 'phone', 'waiting', v_track.director_profile_id
          ) returning id into v_phone_consultation_id;
        else
          v_requires_director_assignment_track_ids := pg_catalog.array_append(
            v_requires_director_assignment_track_ids, v_track.id
          );
        end if;
      end if;

      v_canceled_track_ids := pg_catalog.array_append(v_canceled_track_ids, v_track.id);
      perform dashboard_private.write_registration_track_event(
        p_task_id,
        v_track.id,
        'appointment_subject_deselected',
        v_track.pipeline_status,
        case
          when p_kind = 'level_test' and v_active_activity_count = 0 then 'inquiry'
          when p_kind = 'visit_consultation' then 'consultation_waiting'
          else v_track.pipeline_status
        end,
        'appointment_subject_deselected',
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_old_notification_revision,
          'kind', p_kind,
          'scheduledAt', p_scheduled_at,
          'place', v_place,
          'activeTrackIds', pg_catalog.to_jsonb(v_track_ids),
          'canceledTrackIds', pg_catalog.to_jsonb(v_deselected_track_ids),
          'phoneConsultationId', v_phone_consultation_id,
          'changeKind', 'appointment_subject_deselected'
        )
      );
      if p_kind = 'visit_consultation' and not v_director_ready then
        perform dashboard_private.write_registration_track_event(
          p_task_id,
          v_track.id,
          'director_assignment_required',
          'consultation_waiting',
          'consultation_waiting',
          'appointment_subject_deselected',
          pg_catalog.jsonb_build_object(
            'appointmentId', p_appointment_id,
            'notificationRevision', v_old_notification_revision,
            'changeKind', 'director_assignment_required'
          )
        );
      end if;
    end loop;

    for v_track in
      select track.*
      from pg_catalog.unnest(v_added_track_ids) selected(track_id)
      join public.ops_registration_subject_tracks track on track.id = selected.track_id
      where track.task_id = p_task_id
      order by track.id
    loop
      v_phone_consultation_id := null;
      if p_kind = 'level_test' then
        select coalesce(max(attempt.attempt_number), 0) + 1
        into v_attempt_number
        from public.ops_registration_level_tests attempt
        where attempt.track_id = v_track.id;
        insert into public.ops_registration_level_tests(
          track_id, appointment_id, attempt_number, status
        ) values (
          v_track.id, p_appointment_id, v_attempt_number, 'scheduled'
        ) returning id into v_activity_id;
        perform dashboard_private.transition_registration_track_status(
          v_track.id, 'level_test_scheduled', null, null, false
        );
      else
        update public.ops_registration_consultations consultation
        set status = 'canceled', updated_at = pg_catalog.now()
        where consultation.track_id = v_track.id
          and consultation.mode = 'phone'
          and consultation.status = 'waiting'
        returning consultation.id, consultation.director_profile_id
        into v_phone_consultation_id, v_phone_director_id;
        if not found then
          raise exception 'registration_invalid_source_state' using errcode = '40001';
        end if;

        delete from public.dashboard_notifications notification
        where notification.type = 'registration_consultation'
          and notification.read_at is null
          and notification.dedupe_key =
            'registration:' || p_task_id::text || ':track:' || v_track.id::text
            || ':consultation:' || v_phone_consultation_id::text
            || ':director:' || v_phone_director_id::text;

        insert into public.ops_registration_consultations(
          track_id, appointment_id, mode, status, director_profile_id
        ) values (
          v_track.id, p_appointment_id, 'visit', 'scheduled', v_track.director_profile_id
        ) returning id into v_activity_id;
        perform dashboard_private.transition_registration_track_status(
          v_track.id, 'visit_consultation_scheduled', null, null, false
        );
      end if;

      perform dashboard_private.write_registration_track_event(
        p_task_id,
        v_track.id,
        case
          when p_kind = 'level_test' and v_track.pipeline_status = 'inquiry'
            then 'level_test_scheduled'
          when p_kind = 'level_test' then 'level_test_retake_scheduled'
          else 'visit_scheduled'
        end,
        v_track.pipeline_status,
        case when p_kind = 'level_test' then 'level_test_scheduled' else 'visit_consultation_scheduled' end,
        null,
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_old_notification_revision,
          'kind', p_kind,
          'scheduledAt', p_scheduled_at,
          'place', v_place,
          'activityId', v_activity_id,
          'activeTrackIds', pg_catalog.to_jsonb(v_track_ids),
          'canceledTrackIds', pg_catalog.to_jsonb(v_deselected_track_ids),
          'changeKind', 'appointment_updated'
        )
      );
    end loop;

    for v_track in
      select track.*
      from public.ops_registration_subject_tracks track
      where track.task_id = p_task_id
        and track.id = any(v_track_ids)
        and track.id <> all(v_added_track_ids)
      order by track.id
    loop
      perform dashboard_private.write_registration_track_event(
        p_task_id,
        v_track.id,
        'appointment_updated',
        v_track.pipeline_status,
        v_track.pipeline_status,
        null,
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_old_notification_revision,
          'kind', p_kind,
          'scheduledAt', p_scheduled_at,
          'place', v_place,
          'activeTrackIds', pg_catalog.to_jsonb(v_track_ids),
          'canceledTrackIds', pg_catalog.to_jsonb(v_deselected_track_ids),
          'changeKind', 'appointment_updated'
        )
      );
    end loop;

    if p_kind = 'level_test' then
      select
        coalesce(
          pg_catalog.array_agg(attempt.id order by attempt.track_id, attempt.id),
          array[]::uuid[]
        ),
        coalesce(
          pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id),
          array[]::uuid[]
        )
      into v_activity_ids, v_active_track_ids
      from public.ops_registration_level_tests attempt
      where attempt.appointment_id = p_appointment_id
        and attempt.status = 'scheduled';
    else
      select
        coalesce(
          pg_catalog.array_agg(consultation.id order by consultation.track_id, consultation.id),
          array[]::uuid[]
        ),
        coalesce(
          pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id),
          array[]::uuid[]
        )
      into v_activity_ids, v_active_track_ids
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = p_appointment_id
        and consultation.mode = 'visit'
        and consultation.status = 'scheduled';
    end if;
    if v_active_track_ids is distinct from v_track_ids then
      raise exception 'registration_appointment_active_activity_exists' using errcode = '23514';
    end if;

    select coalesce(
      pg_catalog.array_agg(distinct track_id order by track_id),
      array[]::uuid[]
    )
    into v_requires_director_assignment_track_ids
    from pg_catalog.unnest(v_requires_director_assignment_track_ids) required(track_id);

    perform dashboard_private.recompute_registration_parent(p_task_id);
    v_notification_targets := case
      when p_kind = 'visit_consultation' then pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_old_notification_revision
        )
      )
      else '[]'::jsonb
    end;
    v_response := pg_catalog.jsonb_build_object(
      'taskId', p_task_id,
      'appointmentId', p_appointment_id,
      'notificationRevision', v_old_notification_revision,
      'trackIds', pg_catalog.to_jsonb(v_track_ids),
      'activityIds', pg_catalog.to_jsonb(v_activity_ids),
      'requiresDirectorAssignmentTrackIds',
        pg_catalog.to_jsonb(v_requires_director_assignment_track_ids),
      'notificationTargets', v_notification_targets
    );

    insert into dashboard_private.ops_registration_mutations(
      actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
    ) values (
      v_actor_id, v_request_key, p_task_id, 'save_appointment',
      v_target_fingerprint, v_response
    );
    return v_response;
  end if;

  for v_track in
    select track.*
    from pg_catalog.unnest(v_track_ids) selected(track_id)
    join public.ops_registration_subject_tracks track
      on track.id = selected.track_id
    where track.task_id = p_task_id
    order by track.id
  loop
    if p_kind = 'level_test' then
      select pg_catalog.count(*)
      into v_active_activity_count
      from public.ops_registration_level_tests attempt
      where attempt.track_id = v_track.id
        and attempt.status in ('scheduled', 'in_progress');
      if v_active_activity_count > 0 then
        raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
      end if;

      select attempt.status
      into v_latest_attempt_status
      from public.ops_registration_level_tests attempt
      where attempt.track_id = v_track.id
      order by attempt.attempt_number desc, attempt.id desc
      limit 1;

      if (
        v_track.pipeline_status = 'inquiry'
        or (
          v_track.pipeline_status = 'waiting'
          and v_track.level_test_retake_decision = 'required'
        )
        or (
          v_track.pipeline_status = 'level_test_scheduled'
          and v_latest_attempt_status in ('absent', 'canceled')
        )
      ) is not true then
        raise exception 'registration_invalid_source_state' using errcode = '40001';
      end if;
    else
      perform dashboard_private.assert_registration_track_director_ready(v_track.id);
      if v_track.pipeline_status <> 'consultation_waiting' then
        raise exception 'registration_invalid_source_state' using errcode = '40001';
      end if;

      select pg_catalog.count(*)
      into v_active_activity_count
      from public.ops_registration_consultations consultation
      where consultation.track_id = v_track.id
        and consultation.mode = 'visit'
        and consultation.status = 'scheduled';
      if v_active_activity_count > 0 then
        raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
      end if;

      select pg_catalog.count(*)
      into v_phone_consultation_count
      from public.ops_registration_consultations consultation
      where consultation.track_id = v_track.id
        and consultation.mode = 'phone'
        and consultation.status = 'waiting';
      if v_phone_consultation_count <> 1 then
        raise exception 'registration_invalid_source_state' using errcode = '40001';
      end if;
    end if;
  end loop;

  if p_kind = 'level_test' then
    -- current_class_retest_student_locks
    perform 1
    from public.students student
    join (
      select distinct enrollment.student_id
      from public.ops_registration_enrollments enrollment
      join public.ops_registration_subject_tracks track
        on track.id = enrollment.track_id
      where track.id = any(v_track_ids)
        and track.task_id = p_task_id
        and track.pipeline_status = 'waiting'
        and track.waiting_kind = 'current_class'
        and track.level_test_retake_decision = 'required'
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active
        and enrollment.student_id is not null
    ) affected on affected.student_id = student.id
    order by student.id
    for update of student;

    -- current_class_retest_claim_locks
    perform 1
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track
      on track.id = enrollment.track_id
    where track.id = any(v_track_ids)
      and track.task_id = p_task_id
      and track.pipeline_status = 'waiting'
      and track.waiting_kind = 'current_class'
      and track.level_test_retake_decision = 'required'
      and enrollment.status = 'waitlisted'
      and enrollment.roster_active
    order by enrollment.id
    for update of enrollment;

    -- current_class_retest_class_locks
    perform 1
    from public.classes class
    join (
      select distinct enrollment.class_id
      from public.ops_registration_enrollments enrollment
      join public.ops_registration_subject_tracks track
        on track.id = enrollment.track_id
      where track.id = any(v_track_ids)
        and track.task_id = p_task_id
        and track.pipeline_status = 'waiting'
        and track.waiting_kind = 'current_class'
        and track.level_test_retake_decision = 'required'
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active
    ) affected on affected.class_id = class.id
    order by class.id
    for update of class;

    for v_track in
      select track.*
      from pg_catalog.unnest(v_track_ids) selected(track_id)
      join public.ops_registration_subject_tracks track
        on track.id = selected.track_id
      where track.task_id = p_task_id
        and track.pipeline_status = 'waiting'
        and track.waiting_kind = 'current_class'
        and track.level_test_retake_decision = 'required'
      order by track.id
    loop
      select enrollment.id, enrollment.student_id, enrollment.class_id
      into v_wait_enrollment_id, v_wait_student_id, v_wait_class_id
      from public.ops_registration_enrollments enrollment
      join public.classes class on class.id = enrollment.class_id
      where enrollment.track_id = v_track.id
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active
        and pg_catalog.btrim(class.subject) = v_track.subject
        and enrollment.student_id = v_task_student_id
      order by enrollment.id
      for update of enrollment, class;
      if not found or v_wait_student_id is null then
        raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
      end if;

      perform dashboard_private.apply_student_class_roster_mode(
        v_wait_student_id,
        v_wait_class_id,
        'removed',
        'waitlist',
        v_wait_enrollment_id,
        'registration level-test retake scheduled',
        v_actor_id
      );

      -- current_class_retest_claim_deactivation
      update public.ops_registration_enrollments enrollment
      set
        status = 'canceled',
        roster_active = false,
        updated_at = pg_catalog.now()
      where enrollment.id = v_wait_enrollment_id
        and enrollment.roster_active;
      if not found then
        raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
      end if;
    end loop;
  end if;

  insert into public.ops_registration_appointments(
    task_id,
    kind,
    scheduled_at,
    place,
    status,
    notification_revision,
    created_by
  ) values (
    p_task_id,
    p_kind,
    p_scheduled_at,
    v_place,
    'scheduled',
    1,
    v_actor_id
  )
  returning id into v_appointment_id;

  for v_track in
    select track.*
    from pg_catalog.unnest(v_track_ids) selected(track_id)
    join public.ops_registration_subject_tracks track
      on track.id = selected.track_id
    where track.task_id = p_task_id
    order by track.id
  loop
    if p_kind = 'level_test' then
      select coalesce(max(attempt.attempt_number), 0) + 1
      into v_attempt_number
      from public.ops_registration_level_tests attempt
      where attempt.track_id = v_track.id;

      insert into public.ops_registration_level_tests(
        track_id,
        appointment_id,
        attempt_number,
        status
      ) values (
        v_track.id,
        v_appointment_id,
        v_attempt_number,
        'scheduled'
      )
      returning id into v_activity_id;

      v_event_type := case
        when v_track.pipeline_status = 'inquiry' then 'level_test_scheduled'
        else 'level_test_retake_scheduled'
      end;
      perform dashboard_private.transition_registration_track_status(
        v_track.id,
        'level_test_scheduled',
        null,
        null,
        false
      );
    else
      -- visit_phone_cancellation
      update public.ops_registration_consultations consultation
      set
        status = 'canceled',
        updated_at = pg_catalog.now()
      where consultation.track_id = v_track.id
        and consultation.mode = 'phone'
        and consultation.status = 'waiting'
      returning consultation.id, consultation.director_profile_id
      into v_phone_consultation_id, v_phone_director_id;
      if not found then
        raise exception 'registration_invalid_source_state' using errcode = '40001';
      end if;

      -- visit_phone_notification_cleanup
      delete from public.dashboard_notifications notification
      where notification.type = 'registration_consultation'
        and notification.read_at is null
        and notification.dedupe_key =
          'registration:' || p_task_id::text || ':track:' || v_track.id::text
          || ':consultation:' || v_phone_consultation_id::text
          || ':director:' || v_phone_director_id::text;

      insert into public.ops_registration_consultations(
        track_id,
        appointment_id,
        mode,
        status,
        director_profile_id
      ) values (
        v_track.id,
        v_appointment_id,
        'visit',
        'scheduled',
        v_track.director_profile_id
      )
      returning id into v_activity_id;

      v_event_type := 'visit_scheduled';
      perform dashboard_private.transition_registration_track_status(
        v_track.id,
        'visit_consultation_scheduled',
        null,
        null,
        false
      );
    end if;

    v_activity_ids := pg_catalog.array_append(v_activity_ids, v_activity_id);
    perform dashboard_private.write_registration_track_event(
      p_task_id,
      v_track.id,
      v_event_type,
      v_track.pipeline_status,
      case
        when p_kind = 'level_test' then 'level_test_scheduled'
        else 'visit_consultation_scheduled'
      end,
      null,
      pg_catalog.jsonb_build_object(
        'appointmentId', v_appointment_id,
        'notificationRevision', 1,
        'kind', p_kind,
        'scheduledAt', p_scheduled_at,
        'place', v_place,
        'activityId', v_activity_id,
        'attemptNumber', case when p_kind = 'level_test' then v_attempt_number else null end,
        'canceledPhoneConsultationId', case
          when p_kind = 'visit_consultation' then v_phone_consultation_id
          else null
        end,
        'activeTrackIds', pg_catalog.to_jsonb(v_track_ids),
        'canceledTrackIds', '[]'::jsonb,
        'changeKind', 'created'
      )
    );
  end loop;

  perform dashboard_private.recompute_registration_parent(p_task_id);

  v_response := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'appointmentId', v_appointment_id,
    'notificationRevision', 1,
    'kind', p_kind,
    'scheduledAt', p_scheduled_at,
    'place', v_place,
    'trackIds', pg_catalog.to_jsonb(v_track_ids),
    'activityIds', pg_catalog.to_jsonb(v_activity_ids),
    'requiresDirectorAssignmentTrackIds', '[]'::jsonb,
    'notificationTargets', case
      when p_kind = 'visit_consultation' then pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'appointmentId', v_appointment_id,
          'notificationRevision', 1
        )
      )
      else '[]'::jsonb
    end
  );

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
    p_task_id,
    'save_appointment',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.save_registration_shared_appointment_impl(uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text)
  owner to postgres;
revoke execute on function dashboard_private.save_registration_shared_appointment_impl(uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text) from public, anon;
grant execute on function dashboard_private.save_registration_shared_appointment_impl(uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text) to authenticated;

create function public.save_registration_shared_appointment(
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
security invoker
set search_path = ''
as $$
  select dashboard_private.save_registration_shared_appointment_impl(
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

revoke execute on function public.save_registration_shared_appointment(uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text) from public, anon;
grant execute on function public.save_registration_shared_appointment(uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text) to authenticated;

create function dashboard_private.cancel_registration_appointment_impl(
  p_appointment_id uuid,
  p_expected_notification_revision integer,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_task_id uuid;
  v_kind text;
  v_appointment public.ops_registration_appointments%rowtype;
  v_child_count integer := 0;
  v_scheduled_track_ids uuid[] := array[]::uuid[];
  v_active_track_ids uuid[] := array[]::uuid[];
  v_requires_director_assignment_track_ids uuid[] := array[]::uuid[];
  v_scheduled_count integer := 0;
  v_other_active_count integer := 0;
  v_new_appointment_status text;
  v_notification_revision integer;
  v_director_ready boolean;
  v_phone_consultation_id uuid;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_track record;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_appointment_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if p_expected_notification_revision is null then
    raise exception 'registration_appointment_revision_conflict' using errcode = '40001';
  end if;
  if v_reason is null then
    raise exception 'registration_appointment_cancel_reason_required' using errcode = '22023';
  end if;

  -- Resolve identifiers without treating this lookup as authority. The locked
  -- parent, tracks, appointment, and activities below remain authoritative.
  select appointment.task_id, appointment.kind
  into v_task_id, v_kind
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'appointmentId', p_appointment_id,
    'expectedNotificationRevision', p_expected_notification_revision,
    'reason', v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- A registration case has at most two tracks. Locking the complete parent
  -- set avoids adding a late track lock after the appointment tier.
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;

  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id
    and appointment.task_id = v_task_id
  order by appointment.id
  for update;
  if not found or v_appointment.kind is distinct from v_kind then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform 1
  from public.ops_registration_level_tests attempt
  join public.ops_registration_subject_tracks track on track.id = attempt.track_id
  where track.task_id = v_task_id
  order by attempt.id
  for update of attempt;

  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = v_task_id
  order by consultation.id
  for update of consultation;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, null, 'cancel_appointment'
  );

  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'cancel_appointment'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  if v_appointment.notification_revision is distinct from p_expected_notification_revision then
    raise exception 'registration_appointment_revision_conflict' using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.ops_registration_level_tests attempt
    join public.ops_registration_subject_tracks track on track.id = attempt.track_id
    where attempt.appointment_id = p_appointment_id
      and track.task_id is distinct from v_task_id
  ) or exists (
    select 1
    from public.ops_registration_consultations consultation
    join public.ops_registration_subject_tracks track on track.id = consultation.track_id
    where consultation.appointment_id = p_appointment_id
      and track.task_id is distinct from v_task_id
  ) then
    raise exception 'registration_appointment_task_mismatch' using errcode = '23514';
  end if;

  if v_kind = 'level_test' then
    if exists (
      select 1
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = p_appointment_id
    ) then
      raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
    end if;

    select
      pg_catalog.count(*),
      coalesce(
        pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id)
          filter (where attempt.status = 'scheduled'),
        array[]::uuid[]
      )
    into v_child_count, v_scheduled_track_ids
    from public.ops_registration_level_tests attempt
    where attempt.appointment_id = p_appointment_id;
  elsif v_kind = 'visit_consultation' then
    if exists (
      select 1
      from public.ops_registration_level_tests attempt
      where attempt.appointment_id = p_appointment_id
    ) or exists (
      select 1
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = p_appointment_id
        and (
          consultation.mode <> 'visit'
          or consultation.status not in ('scheduled', 'completed', 'canceled')
        )
    ) then
      raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
    end if;

    select
      pg_catalog.count(*),
      coalesce(
        pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id)
          filter (where consultation.status = 'scheduled'),
        array[]::uuid[]
      )
    into v_child_count, v_scheduled_track_ids
    from public.ops_registration_consultations consultation
    where consultation.appointment_id = p_appointment_id
      and consultation.mode = 'visit';
  else
    raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
  end if;

  if v_child_count = 0 then
    raise exception 'registration_appointment_tracks_required' using errcode = '23514';
  end if;
  v_scheduled_count := pg_catalog.cardinality(v_scheduled_track_ids);
  if v_scheduled_count = 0 then
    raise exception 'registration_appointment_immutable' using errcode = '40001';
  end if;
  if v_appointment.status <> 'scheduled' then
    raise exception 'registration_appointment_immutable' using errcode = '40001';
  end if;

  for v_track in
    select track.*
    from pg_catalog.unnest(v_scheduled_track_ids) selected(track_id)
    join public.ops_registration_subject_tracks track on track.id = selected.track_id
    where track.task_id = v_task_id
    order by track.id
  loop
    if v_kind = 'level_test' and v_track.pipeline_status <> 'level_test_scheduled' then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;
    if v_kind = 'visit_consultation'
      and v_track.pipeline_status <> 'visit_consultation_scheduled'
    then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;
  end loop;

  if v_kind = 'level_test' then
    update public.ops_registration_level_tests attempt
    set
      status = 'canceled',
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
    where attempt.appointment_id = p_appointment_id
      and attempt.status = 'scheduled';
    if not found then
      raise exception 'registration_appointment_immutable' using errcode = '40001';
    end if;

    select coalesce(
      pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id),
      array[]::uuid[]
    )
    into v_active_track_ids
    from public.ops_registration_level_tests attempt
    where attempt.appointment_id = p_appointment_id
      and attempt.status in ('scheduled', 'in_progress');

    if pg_catalog.cardinality(v_active_track_ids) > 0 then
      v_new_appointment_status := 'scheduled';
    elsif not exists (
      select 1
      from public.ops_registration_level_tests attempt
      where attempt.appointment_id = p_appointment_id
        and attempt.status <> 'canceled'
    ) then
      v_new_appointment_status := 'canceled';
    else
      v_new_appointment_status := 'completed';
    end if;
  else
    update public.ops_registration_consultations consultation
    set
      status = 'canceled',
      updated_at = pg_catalog.now()
    where consultation.appointment_id = p_appointment_id
      and consultation.mode = 'visit'
      and consultation.status = 'scheduled';
    if not found then
      raise exception 'registration_appointment_immutable' using errcode = '40001';
    end if;

    select coalesce(
      pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id),
      array[]::uuid[]
    )
    into v_active_track_ids
    from public.ops_registration_consultations consultation
    where consultation.appointment_id = p_appointment_id
      and consultation.mode = 'visit'
      and consultation.status = 'scheduled';

    if pg_catalog.cardinality(v_active_track_ids) > 0 then
      v_new_appointment_status := 'scheduled';
    elsif not exists (
      select 1
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = p_appointment_id
        and consultation.mode = 'visit'
        and consultation.status <> 'canceled'
    ) then
      v_new_appointment_status := 'canceled';
    else
      v_new_appointment_status := 'completed';
    end if;
  end if;

  update public.ops_registration_appointments appointment
  set
    status = v_new_appointment_status,
    notification_revision = notification_revision + 1,
    updated_at = pg_catalog.now()
  where appointment.id = p_appointment_id
  returning appointment.notification_revision into v_notification_revision;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  for v_track in
    select track.*
    from pg_catalog.unnest(v_scheduled_track_ids) selected(track_id)
    join public.ops_registration_subject_tracks track on track.id = selected.track_id
    where track.task_id = v_task_id
    order by track.id
  loop
    v_phone_consultation_id := null;
    if v_kind = 'level_test' then
      select pg_catalog.count(*)
      into v_other_active_count
      from public.ops_registration_level_tests attempt
      where attempt.track_id = v_track.id
        and attempt.status in ('scheduled', 'in_progress');

      if v_other_active_count = 0 then
        perform dashboard_private.transition_registration_track_status(
          v_track.id, 'inquiry', null, null, false
        );
      end if;

      perform dashboard_private.write_registration_track_event(
        v_task_id,
        v_track.id,
        'appointment_canceled',
        v_track.pipeline_status,
        case when v_other_active_count = 0 then 'inquiry' else v_track.pipeline_status end,
        v_reason,
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_notification_revision,
          'kind', v_kind,
          'scheduledAt', v_appointment.scheduled_at,
          'place', v_appointment.place,
          'changeKind', 'appointment_canceled',
          'activeTrackIds', pg_catalog.to_jsonb(v_active_track_ids),
          'canceledTrackIds', pg_catalog.to_jsonb(v_scheduled_track_ids)
        )
      );
    else
      perform dashboard_private.transition_registration_track_status(
        v_track.id, 'consultation_waiting', null, null, false
      );

      v_director_ready := true;
      begin
        perform dashboard_private.assert_registration_track_director_ready(v_track.id);
      exception
        when sqlstate '40001' then
          if sqlerrm is distinct from 'registration_director_refresh_required' then
            raise;
          end if;
          v_director_ready := false;
      end;

      if v_director_ready then
        if exists (
          select 1
          from public.ops_registration_consultations consultation
          where consultation.track_id = v_track.id
            and consultation.status in ('waiting', 'scheduled')
        ) then
          raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
        end if;

        insert into public.ops_registration_consultations(
          track_id,
          appointment_id,
          mode,
          status,
          director_profile_id
        ) values (
          v_track.id,
          null,
          'phone',
          'waiting',
          v_track.director_profile_id
        )
        returning id into v_phone_consultation_id;
      else
        v_requires_director_assignment_track_ids := pg_catalog.array_append(
          v_requires_director_assignment_track_ids,
          v_track.id
        );
      end if;

      perform dashboard_private.write_registration_track_event(
        v_task_id,
        v_track.id,
        'appointment_canceled',
        v_track.pipeline_status,
        'consultation_waiting',
        v_reason,
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_notification_revision,
          'kind', v_kind,
          'scheduledAt', v_appointment.scheduled_at,
          'place', v_appointment.place,
          'changeKind', 'appointment_canceled',
          'activeTrackIds', pg_catalog.to_jsonb(v_active_track_ids),
          'canceledTrackIds', pg_catalog.to_jsonb(v_scheduled_track_ids),
          'phoneConsultationId', v_phone_consultation_id
        )
      );

      if not v_director_ready then
        perform dashboard_private.write_registration_track_event(
          v_task_id,
          v_track.id,
          'director_assignment_required',
          'consultation_waiting',
          'consultation_waiting',
          v_reason,
          pg_catalog.jsonb_build_object(
            'appointmentId', p_appointment_id,
            'notificationRevision', v_notification_revision,
            'changeKind', 'director_assignment_required'
          )
        );
      end if;
    end if;
  end loop;

  select coalesce(
    pg_catalog.array_agg(distinct track_id order by track_id),
    array[]::uuid[]
  )
  into v_requires_director_assignment_track_ids
  from pg_catalog.unnest(v_requires_director_assignment_track_ids) required(track_id);

  perform dashboard_private.recompute_registration_parent(v_task_id);

  v_response := pg_catalog.jsonb_build_object(
    'appointmentId', p_appointment_id,
    'notificationRevision', v_notification_revision,
    'requiresDirectorAssignmentTrackIds',
      pg_catalog.to_jsonb(v_requires_director_assignment_track_ids),
    'notificationTargets', case
      when v_kind = 'visit_consultation' then pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_notification_revision
        )
      )
      else '[]'::jsonb
    end
  );

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
    'cancel_appointment',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.cancel_registration_appointment_impl(uuid, integer, text, text)
  owner to postgres;
revoke execute on function dashboard_private.cancel_registration_appointment_impl(uuid, integer, text, text) from public, anon;
grant execute on function dashboard_private.cancel_registration_appointment_impl(uuid, integer, text, text) to authenticated;

create function public.cancel_registration_appointment(
  p_appointment_id uuid,
  p_expected_notification_revision integer,
  p_reason text,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.cancel_registration_appointment_impl(
    p_appointment_id,
    p_expected_notification_revision,
    p_reason,
    p_request_key
  );
$$;

revoke execute on function public.cancel_registration_appointment(uuid, integer, text, text) from public, anon;
grant execute on function public.cancel_registration_appointment(uuid, integer, text, text) to authenticated;

create function dashboard_private.start_registration_level_test_attempt_impl(
  p_attempt_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_task_id uuid;
  v_track_id uuid;
  v_appointment_id uuid;
  v_attempt public.ops_registration_level_tests%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_active_track_ids uuid[] := array[]::uuid[];
  v_canceled_track_ids uuid[] := array[]::uuid[];
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_attempt_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  select track.task_id, attempt.track_id, attempt.appointment_id
  into v_task_id, v_track_id, v_appointment_id
  from public.ops_registration_level_tests attempt
  join public.ops_registration_subject_tracks track on track.id = attempt.track_id
  where attempt.id = p_attempt_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'attemptId', p_attempt_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- level_test_task_lock
  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- level_test_detail_lock
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- level_test_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;

  -- level_test_appointment_locks
  perform 1
  from public.ops_registration_appointments appointment
  where appointment.task_id = v_task_id
    and appointment.kind = 'level_test'
  order by appointment.id
  for update;

  -- level_test_attempt_locks
  perform 1
  from public.ops_registration_level_tests attempt
  join public.ops_registration_subject_tracks track on track.id = attempt.track_id
  where track.task_id = v_task_id
  order by attempt.id
  for update of attempt;

  -- level_test_consultation_locks
  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = v_task_id
    and consultation.status in ('waiting', 'scheduled')
  order by consultation.id
  for update of consultation;

  select attempt.*
  into v_attempt
  from public.ops_registration_level_tests attempt
  where attempt.id = p_attempt_id
    and attempt.track_id = v_track_id
    and attempt.appointment_id = v_appointment_id;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_track_id
    and track.task_id = v_task_id;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = v_appointment_id
    and appointment.task_id = v_task_id
    and appointment.kind = 'level_test';
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, v_track_id, 'start_level_test'
  );

  -- level_test_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'start_level_test'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- level_test_mutable_state_check
  if v_appointment.task_id is distinct from v_task_id
    or v_appointment.kind <> 'level_test'
    or v_appointment.status <> 'scheduled'
  then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;
  if v_attempt.status <> 'scheduled' then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;
  if v_track.pipeline_status <> 'level_test_scheduled' then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;

  update public.ops_registration_level_tests attempt
  set
    status = 'in_progress',
    started_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where attempt.id = p_attempt_id
    and attempt.status = 'scheduled'
  returning attempt.* into v_attempt;
  if not found then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;

  perform dashboard_private.transition_registration_track_status(
    v_track_id, 'level_test_in_progress', null, null, false
  );
  select coalesce(
    pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id),
    array[]::uuid[]
  )
  into v_active_track_ids
  from public.ops_registration_level_tests attempt
  where attempt.appointment_id = v_appointment_id
    and attempt.status in ('scheduled', 'in_progress');
  select coalesce(
    pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id),
    array[]::uuid[]
  )
  into v_canceled_track_ids
  from public.ops_registration_level_tests attempt
  where attempt.appointment_id = v_appointment_id
    and attempt.status = 'canceled';
  perform dashboard_private.write_registration_track_event(
    v_task_id,
    v_track_id,
    'level_test_started',
    v_track.pipeline_status,
    'level_test_in_progress',
    null,
    pg_catalog.jsonb_build_object(
      'appointmentId', v_appointment_id,
      'notificationRevision', v_appointment.notification_revision,
      'attemptId', p_attempt_id,
      'attemptNumber', v_attempt.attempt_number,
      'activeTrackIds', pg_catalog.to_jsonb(v_active_track_ids),
      'canceledTrackIds', pg_catalog.to_jsonb(v_canceled_track_ids),
      'changeKind', 'level_test_started'
    )
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);

  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', v_track_id,
    'attemptId', p_attempt_id,
    'appointmentId', v_appointment_id,
    'attemptNumber', v_attempt.attempt_number,
    'status', v_attempt.status,
    'startedAt', v_attempt.started_at,
    'trackStatus', 'level_test_in_progress',
    'appointmentStatus', v_appointment.status
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'start_level_test',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.start_registration_level_test_attempt_impl(uuid, text)
  owner to postgres;
revoke execute on function dashboard_private.start_registration_level_test_attempt_impl(uuid, text) from public, anon;
grant execute on function dashboard_private.start_registration_level_test_attempt_impl(uuid, text) to authenticated;

create function public.start_registration_level_test_attempt(
  p_attempt_id uuid,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.start_registration_level_test_attempt_impl(
    p_attempt_id, p_request_key
  );
$$;

revoke execute on function public.start_registration_level_test_attempt(uuid, text) from public, anon;
grant execute on function public.start_registration_level_test_attempt(uuid, text) to authenticated;

create function dashboard_private.complete_registration_level_test_attempt_impl(
  p_attempt_id uuid,
  p_status text,
  p_material_link text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_status text := pg_catalog.lower(nullif(pg_catalog.btrim(p_status), ''));
  v_material_link text := nullif(pg_catalog.btrim(p_material_link), '');
  v_task_id uuid;
  v_track_id uuid;
  v_appointment_id uuid;
  v_attempt public.ops_registration_level_tests%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_active_track_ids uuid[] := array[]::uuid[];
  v_canceled_track_ids uuid[] := array[]::uuid[];
  v_appointment_status text;
  v_next_track_status text;
  v_consultation_id uuid;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_status is null or v_status not in ('completed', 'absent', 'canceled') then
    raise exception 'registration_level_test_status_invalid' using errcode = '22023';
  end if;
  if p_attempt_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  select track.task_id, attempt.track_id, attempt.appointment_id
  into v_task_id, v_track_id, v_appointment_id
  from public.ops_registration_level_tests attempt
  join public.ops_registration_subject_tracks track on track.id = attempt.track_id
  where attempt.id = p_attempt_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'attemptId', p_attempt_id,
    'status', v_status,
    'materialLink', case when v_status = 'completed' then v_material_link else null end
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- level_test_task_lock
  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- level_test_detail_lock
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- level_test_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;

  -- level_test_appointment_locks
  perform 1
  from public.ops_registration_appointments appointment
  where appointment.task_id = v_task_id
    and appointment.kind = 'level_test'
  order by appointment.id
  for update;

  -- level_test_attempt_locks
  perform 1
  from public.ops_registration_level_tests attempt
  join public.ops_registration_subject_tracks track on track.id = attempt.track_id
  where track.task_id = v_task_id
  order by attempt.id
  for update of attempt;

  -- level_test_consultation_locks
  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = v_task_id
    and consultation.status in ('waiting', 'scheduled')
  order by consultation.id
  for update of consultation;

  select attempt.*
  into v_attempt
  from public.ops_registration_level_tests attempt
  where attempt.id = p_attempt_id
    and attempt.track_id = v_track_id
    and attempt.appointment_id = v_appointment_id;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_track_id
    and track.task_id = v_task_id;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = v_appointment_id
    and appointment.task_id = v_task_id
    and appointment.kind = 'level_test';
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, v_track_id, 'complete_level_test'
  );

  -- level_test_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'complete_level_test'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- level_test_mutable_state_check
  if v_appointment.task_id is distinct from v_task_id
    or v_appointment.kind <> 'level_test'
    or v_appointment.status <> 'scheduled'
  then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;
  if v_status = 'completed' then
    if v_attempt.status <> 'in_progress'
      or v_track.pipeline_status <> 'level_test_in_progress'
    then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;
    if v_material_link is null then
      raise exception 'registration_level_test_material_link_required' using errcode = '22023';
    end if;
    perform dashboard_private.assert_registration_track_director_ready(v_track_id);
    if exists (
      select 1
      from public.ops_registration_consultations consultation
      where consultation.track_id = v_track_id
        and consultation.status in ('waiting', 'scheduled')
    ) then
      raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
    end if;
  elsif v_status in ('absent', 'canceled') then
    if v_attempt.status not in ('scheduled', 'in_progress')
      or (
        v_attempt.status = 'scheduled'
        and v_track.pipeline_status <> 'level_test_scheduled'
      )
      or (
        v_attempt.status = 'in_progress'
        and v_track.pipeline_status <> 'level_test_in_progress'
      )
    then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;
  end if;

  update public.ops_registration_level_tests attempt
  set
    status = v_status,
    completed_at = pg_catalog.now(),
    material_link = case when v_status = 'completed' then v_material_link else null end,
    updated_at = pg_catalog.now()
  where attempt.id = p_attempt_id
    and attempt.status = v_attempt.status
  returning attempt.* into v_attempt;
  if not found then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;

  if v_status = 'completed' then
    insert into public.ops_registration_consultations(
      track_id, appointment_id, mode, status, director_profile_id
    ) values (
      v_track_id, null, 'phone', 'waiting', v_track.director_profile_id
    ) returning id into v_consultation_id;
    v_next_track_status := 'consultation_waiting';
  else
    v_next_track_status := 'level_test_scheduled';
  end if;

  perform dashboard_private.transition_registration_track_status(
    v_track_id,
    case when v_status = 'completed' then 'consultation_waiting' else 'level_test_scheduled' end,
    null,
    null,
    false
  );

  if exists (
    select 1
    from public.ops_registration_level_tests attempt
    where attempt.appointment_id = v_appointment_id
      and attempt.status in ('scheduled', 'in_progress')
  ) then
    v_appointment_status := 'scheduled';
  elsif not exists (
    select 1
    from public.ops_registration_level_tests attempt
    where attempt.appointment_id = v_appointment_id
      and attempt.status <> 'canceled'
  ) then
    v_appointment_status := 'canceled';
  else
    v_appointment_status := 'completed';
  end if;

  update public.ops_registration_appointments appointment
  set status = v_appointment_status, updated_at = pg_catalog.now()
  where appointment.id = v_appointment_id
    and appointment.status is distinct from v_appointment_status;

  select coalesce(
    pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id),
    array[]::uuid[]
  )
  into v_active_track_ids
  from public.ops_registration_level_tests attempt
  where attempt.appointment_id = v_appointment_id
    and attempt.status in ('scheduled', 'in_progress');
  select coalesce(
    pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id),
    array[]::uuid[]
  )
  into v_canceled_track_ids
  from public.ops_registration_level_tests attempt
  where attempt.appointment_id = v_appointment_id
    and attempt.status = 'canceled';

  perform dashboard_private.write_registration_track_event(
    v_task_id,
    v_track_id,
    case v_status
      when 'completed' then 'level_test_completed'
      when 'absent' then 'level_test_absent'
      else 'level_test_canceled'
    end,
    v_track.pipeline_status,
    v_next_track_status,
    null,
    pg_catalog.jsonb_build_object(
      'appointmentId', v_appointment_id,
      'notificationRevision', v_appointment.notification_revision,
      'attemptId', p_attempt_id,
      'attemptNumber', v_attempt.attempt_number,
      'resultStatus', v_status,
      'appointmentStatus', v_appointment_status,
      'consultationId', v_consultation_id,
      'activeTrackIds', pg_catalog.to_jsonb(v_active_track_ids),
      'canceledTrackIds', pg_catalog.to_jsonb(v_canceled_track_ids),
      'changeKind', 'level_test_result_recorded'
    )
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);

  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', v_track_id,
    'attemptId', p_attempt_id,
    'appointmentId', v_appointment_id,
    'attemptNumber', v_attempt.attempt_number,
    'status', v_attempt.status,
    'materialLink', v_attempt.material_link,
    'completedAt', v_attempt.completed_at,
    'trackStatus', v_next_track_status,
    'appointmentStatus', v_appointment_status,
    'consultationId', v_consultation_id
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'complete_level_test',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.complete_registration_level_test_attempt_impl(uuid, text, text, text)
  owner to postgres;
revoke execute on function dashboard_private.complete_registration_level_test_attempt_impl(uuid, text, text, text) from public, anon;
grant execute on function dashboard_private.complete_registration_level_test_attempt_impl(uuid, text, text, text) to authenticated;

create function public.complete_registration_level_test_attempt(
  p_attempt_id uuid,
  p_status text,
  p_material_link text,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.complete_registration_level_test_attempt_impl(
    p_attempt_id, p_status, p_material_link, p_request_key
  );
$$;

revoke execute on function public.complete_registration_level_test_attempt(uuid, text, text, text) from public, anon;
grant execute on function public.complete_registration_level_test_attempt(uuid, text, text, text) to authenticated;

create function dashboard_private.close_registration_level_test_track_impl(
  p_track_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_task_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_latest_attempt public.ops_registration_level_tests%rowtype;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'registration_level_test_close_reason_required' using errcode = '22023';
  end if;
  if p_track_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'trackId', p_track_id,
    'reason', v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- level_test_task_lock
  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- level_test_detail_lock
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- level_test_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;

  -- level_test_appointment_locks
  perform 1
  from public.ops_registration_appointments appointment
  where appointment.task_id = v_task_id
    and appointment.kind = 'level_test'
  order by appointment.id
  for update;

  -- level_test_attempt_locks
  perform 1
  from public.ops_registration_level_tests attempt
  join public.ops_registration_subject_tracks track on track.id = attempt.track_id
  where track.task_id = v_task_id
  order by attempt.id
  for update of attempt;

  -- level_test_consultation_locks
  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = v_task_id
    and consultation.status in ('waiting', 'scheduled')
  order by consultation.id
  for update of consultation;

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, p_track_id, 'close_level_test'
  );

  -- level_test_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'close_level_test'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- level_test_mutable_state_check
  if v_track.pipeline_status <> 'level_test_scheduled' then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.ops_registration_level_tests attempt
    where attempt.track_id = p_track_id
      and attempt.status in ('scheduled', 'in_progress')
  ) then
    raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
  end if;

  select attempt.*
  into v_latest_attempt
  from public.ops_registration_level_tests attempt
  where attempt.track_id = p_track_id
  order by attempt.attempt_number desc, attempt.id desc
  limit 1;
  if not found or v_latest_attempt.status not in ('absent', 'canceled') then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;

  perform dashboard_private.transition_registration_track_status(
    p_track_id, 'inquiry_closed', null, null, false
  );
  perform dashboard_private.write_registration_track_event(
    v_task_id,
    p_track_id,
    'level_test_track_closed',
    v_track.pipeline_status,
    'inquiry_closed',
    v_reason,
    pg_catalog.jsonb_build_object(
      'appointmentId', v_latest_attempt.appointment_id,
      'attemptId', v_latest_attempt.id,
      'attemptNumber', v_latest_attempt.attempt_number,
      'latestAttemptStatus', v_latest_attempt.status,
      'changeKind', 'level_test_track_closed'
    )
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);

  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', p_track_id,
    'status', 'inquiry_closed',
    'reason', v_reason,
    'latestAttemptId', v_latest_attempt.id,
    'latestAttemptStatus', v_latest_attempt.status,
    'appointmentId', v_latest_attempt.appointment_id
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'close_level_test',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.close_registration_level_test_track_impl(uuid, text, text)
  owner to postgres;
revoke execute on function dashboard_private.close_registration_level_test_track_impl(uuid, text, text) from public, anon;
grant execute on function dashboard_private.close_registration_level_test_track_impl(uuid, text, text) to authenticated;

create function public.close_registration_level_test_track(
  p_track_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.close_registration_level_test_track_impl(
    p_track_id, p_reason, p_request_key
  );
$$;

revoke execute on function public.close_registration_level_test_track(uuid, text, text) from public, anon;
grant execute on function public.close_registration_level_test_track(uuid, text, text) to authenticated;

create function dashboard_private.complete_registration_consultation_impl(
  p_consultation_id uuid,
  p_outcome text,
  p_waiting_kind text,
  p_class_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_outcome text := pg_catalog.lower(nullif(pg_catalog.btrim(p_outcome), ''));
  v_waiting_kind text := pg_catalog.lower(nullif(pg_catalog.btrim(p_waiting_kind), ''));
  v_task_id uuid;
  v_track_id uuid;
  v_appointment_id uuid;
  v_consultation public.ops_registration_consultations%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_next_track_status text;
  v_appointment_status text;
  v_active_track_ids uuid[] := array[]::uuid[];
  v_canceled_track_ids uuid[] := array[]::uuid[];
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_consultation_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_outcome is null
    or v_outcome not in ('enrollment', 'waiting', 'not_registered')
  then
    raise exception 'registration_consultation_outcome_invalid' using errcode = '22023';
  end if;
  if v_outcome = 'waiting' then
    if v_waiting_kind is null
      or v_waiting_kind not in ('current_class', 'current_term_opening', 'next_term_opening')
    then
      raise exception 'waiting_kind_required' using errcode = '22023';
    end if;
    if v_waiting_kind = 'current_class' and p_class_id is null then
      raise exception 'waiting_class_required' using errcode = '22023';
    end if;
    if v_waiting_kind <> 'current_class' and p_class_id is not null then
      raise exception 'waiting_class_not_allowed' using errcode = '22023';
    end if;
  elsif v_outcome <> 'waiting'
    and (v_waiting_kind is not null or p_class_id is not null)
  then
    raise exception 'registration_consultation_waiting_fields_not_allowed' using errcode = '22023';
  end if;

  select track.task_id, consultation.track_id, consultation.appointment_id
  into v_task_id, v_track_id, v_appointment_id
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where consultation.id = p_consultation_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'consultationId', p_consultation_id,
    'outcome', v_outcome,
    'waitingKind', case when v_outcome = 'waiting' then v_waiting_kind else null end,
    'classId', case
      when v_outcome = 'waiting' and v_waiting_kind = 'current_class' then p_class_id
      else null
    end
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- consultation_task_lock
  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- consultation_detail_lock
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- consultation_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;

  -- consultation_appointment_locks
  perform 1
  from public.ops_registration_appointments appointment
  where appointment.task_id = v_task_id
    and appointment.kind = 'visit_consultation'
  order by appointment.id
  for update;

  -- consultation_activity_locks
  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = v_task_id
  order by consultation.id
  for update of consultation;

  select consultation.*
  into v_consultation
  from public.ops_registration_consultations consultation
  where consultation.id = p_consultation_id
    and consultation.track_id = v_track_id;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_appointment_id := v_consultation.appointment_id;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_track_id
    and track.task_id = v_task_id;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_appointment_id is not null then
    select appointment.*
    into v_appointment
    from public.ops_registration_appointments appointment
    where appointment.id = v_appointment_id
      and appointment.task_id = v_task_id
      and appointment.kind = 'visit_consultation';
    if not found then
      raise exception 'registration_appointment_task_mismatch' using errcode = '23514';
    end if;
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, v_track_id, 'complete_consultation'
  );
  if public.current_dashboard_role() <> 'admin'
    or v_track.director_profile_id is distinct from v_actor_id
    or v_consultation.director_profile_id is distinct from v_actor_id
  then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform dashboard_private.assert_registration_track_director_ready(v_track_id);

  -- consultation_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'complete_consultation'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- consultation_mutable_state_check
  if v_consultation.mode = 'phone' then
    if v_consultation.status <> 'waiting'
      or v_consultation.appointment_id is not null
      or v_track.pipeline_status <> 'consultation_waiting'
    then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;
  elsif v_consultation.mode = 'visit' then
    if v_consultation.status <> 'scheduled'
      or v_consultation.appointment_id is null
      or v_track.pipeline_status <> 'visit_consultation_scheduled'
      or v_appointment.task_id is distinct from v_task_id
      or v_appointment.kind <> 'visit_consultation'
      or v_appointment.status <> 'scheduled'
    then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;
  else
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;

  if v_outcome = 'waiting' and v_waiting_kind = 'current_class' then
    perform dashboard_private.apply_registration_current_class_wait(
      v_task_id, v_track_id, p_class_id, v_actor_id
    );
  end if;

  update public.ops_registration_consultations consultation
  set
    status = 'completed',
    completed_at = pg_catalog.now(),
    outcome = v_outcome,
    updated_at = pg_catalog.now()
  where consultation.id = p_consultation_id
    and consultation.status = v_consultation.status
  returning consultation.* into v_consultation;
  if not found then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;

  if v_consultation.mode = 'phone' then
    delete from public.dashboard_notifications notification
    where notification.type = 'registration_consultation'
      and notification.read_at is null
      and notification.dedupe_key =
        'registration:' || v_task_id::text || ':track:' || v_track_id::text
        || ':consultation:' || v_consultation.id::text
        || ':director:' || v_consultation.director_profile_id::text;
  end if;

  v_next_track_status := case
    when v_outcome = 'enrollment' then 'enrollment_decided'
    when v_outcome = 'waiting' then 'waiting'
    else 'not_registered'
  end;
  perform dashboard_private.transition_registration_track_status(
    v_track_id,
    v_next_track_status,
    case when v_outcome = 'waiting' then v_waiting_kind else null end,
    null,
    false
  );

  if v_consultation.mode = 'visit' then
    if exists (
      select 1
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = v_appointment_id
        and consultation.mode = 'visit'
        and consultation.status = 'scheduled'
    ) then
      v_appointment_status := 'scheduled';
    elsif not exists (
      select 1
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = v_appointment_id
        and consultation.mode = 'visit'
        and consultation.status <> 'canceled'
    ) then
      v_appointment_status := 'canceled';
    else
      v_appointment_status := 'completed';
    end if;

    update public.ops_registration_appointments appointment
    set status = v_appointment_status, updated_at = pg_catalog.now()
    where appointment.id = v_appointment_id
      and appointment.status is distinct from v_appointment_status;

    select coalesce(
      pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id),
      array[]::uuid[]
    )
    into v_active_track_ids
    from public.ops_registration_consultations consultation
    where consultation.appointment_id = v_appointment_id
      and consultation.mode = 'visit'
      and consultation.status = 'scheduled';
    select coalesce(
      pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id),
      array[]::uuid[]
    )
    into v_canceled_track_ids
    from public.ops_registration_consultations consultation
    where consultation.appointment_id = v_appointment_id
      and consultation.mode = 'visit'
      and consultation.status = 'canceled';
  else
    v_appointment_status := null;
  end if;

  perform dashboard_private.write_registration_track_event(
    v_task_id,
    v_track_id,
    'consultation_completed',
    v_track.pipeline_status,
    v_next_track_status,
    null,
    pg_catalog.jsonb_build_object(
      'appointmentId', v_appointment_id,
      'notificationRevision', case
        when v_consultation.mode = 'visit' then v_appointment.notification_revision
        else null
      end,
      'consultationId', v_consultation.id,
      'mode', v_consultation.mode,
      'outcome', v_outcome,
      'waitingKind', case when v_outcome = 'waiting' then v_waiting_kind else null end,
      'classId', case
        when v_outcome = 'waiting' and v_waiting_kind = 'current_class' then p_class_id
        else null
      end,
      'appointmentStatus', v_appointment_status,
      'activeTrackIds', pg_catalog.to_jsonb(v_active_track_ids),
      'canceledTrackIds', pg_catalog.to_jsonb(v_canceled_track_ids),
      'changeKind', 'consultation_completed'
    )
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_track_id;
  v_response := pg_catalog.jsonb_build_object(
    'consultation', pg_catalog.jsonb_build_object(
      'id', v_consultation.id,
      'trackId', v_consultation.track_id,
      'appointmentId', v_consultation.appointment_id,
      'mode', v_consultation.mode,
      'status', v_consultation.status,
      'directorProfileId', v_consultation.director_profile_id,
      'completedAt', v_consultation.completed_at,
      'outcome', v_consultation.outcome,
      'createdAt', v_consultation.created_at,
      'updatedAt', v_consultation.updated_at
    ),
    'track', pg_catalog.jsonb_build_object(
      'id', v_track.id,
      'taskId', v_track.task_id,
      'subject', v_track.subject,
      'status', v_track.pipeline_status,
      'legacy', false,
      'directorProfileId', v_track.director_profile_id,
      'directorName', coalesce((
        select profile.name
        from public.profiles profile
        where profile.id = v_track.director_profile_id
      ), ''),
      'directorAssignmentSource', coalesce(v_track.director_assignment_source, ''),
      'directorAssignmentRuleKey', coalesce(v_track.director_assignment_rule_key, ''),
      'waitingKind', coalesce(v_track.waiting_kind, ''),
      'levelTestRetakeDecision', coalesce(v_track.level_test_retake_decision, ''),
      'migrationReviewRequired', v_track.migration_review_required,
      'stageEnteredAt', v_track.stage_entered_at
    )
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'complete_consultation',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.complete_registration_consultation_impl(uuid, text, text, uuid, text)
  owner to postgres;
revoke execute on function dashboard_private.complete_registration_consultation_impl(uuid, text, text, uuid, text) from public, anon;
grant execute on function dashboard_private.complete_registration_consultation_impl(uuid, text, text, uuid, text) to authenticated;

create function public.complete_registration_consultation(
  p_consultation_id uuid,
  p_outcome text,
  p_waiting_kind text,
  p_class_id uuid,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.complete_registration_consultation_impl(
    p_consultation_id, p_outcome, p_waiting_kind, p_class_id, p_request_key
  );
$$;

revoke execute on function public.complete_registration_consultation(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.complete_registration_consultation(uuid, text, text, uuid, text) to authenticated;

create function dashboard_private.transition_registration_waiting_impl(
  p_track_id uuid,
  p_action text,
  p_waiting_kind text,
  p_class_id uuid,
  p_retake_decision text,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_action text := pg_catalog.lower(nullif(pg_catalog.btrim(p_action), ''));
  v_waiting_kind text := pg_catalog.lower(nullif(pg_catalog.btrim(p_waiting_kind), ''));
  v_retake_decision text := pg_catalog.lower(nullif(pg_catalog.btrim(p_retake_decision), ''));
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_task_id uuid;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_identity_needed boolean := false;
  v_name_key text;
  v_parent_phone_key text;
  v_current_claim_count integer := 0;
  v_old_enrollment_id uuid;
  v_old_student_id uuid;
  v_old_class_id uuid;
  v_target_class_id uuid;
  v_enrollment_id uuid;
  v_canceled_enrollment_ids uuid[] := array[]::uuid[];
  v_next_status text;
  v_next_waiting_kind text;
  v_next_retake_decision text;
  v_keep_current_claim boolean := false;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_track_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_action is null
    or v_action not in (
      'change_waiting_kind', 'record_retest_required',
      'move_to_enrollment', 'close_not_registered'
    )
  then
    raise exception 'registration_waiting_action_invalid' using errcode = '22023';
  end if;

  if v_action = 'change_waiting_kind' then
    if v_waiting_kind is null
      or v_waiting_kind not in ('current_class', 'current_term_opening', 'next_term_opening')
      or v_retake_decision is not null
      or v_reason is not null
    then
      raise exception 'registration_waiting_arguments_invalid' using errcode = '22023';
    end if;
    if v_waiting_kind = 'current_class' and p_class_id is null then
      raise exception 'waiting_class_required' using errcode = '22023';
    end if;
    if v_waiting_kind <> 'current_class' and p_class_id is not null then
      raise exception 'waiting_class_not_allowed' using errcode = '22023';
    end if;
  elsif v_action = 'record_retest_required' then
    if v_waiting_kind is not null
      or p_class_id is not null
      or v_retake_decision is null
      or v_retake_decision <> 'required'
      or v_reason is not null
    then
      raise exception 'registration_waiting_arguments_invalid' using errcode = '22023';
    end if;
  elsif v_action = 'move_to_enrollment' then
    if v_waiting_kind is not null
      or p_class_id is not null
      or v_retake_decision is null
      or v_retake_decision <> 'not_required'
      or v_reason is not null
    then
      raise exception 'registration_waiting_arguments_invalid' using errcode = '22023';
    end if;
  elsif v_action = 'close_not_registered' then
    if v_waiting_kind is not null
      or p_class_id is not null
      or v_retake_decision is not null
      or v_reason is null
    then
      raise exception 'registration_waiting_arguments_invalid' using errcode = '22023';
    end if;
  end if;

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', p_track_id,
    'action', v_action,
    'waitingKind', v_waiting_kind,
    'classId', p_class_id,
    'retakeDecision', v_retake_decision,
    'reason', v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- waiting_task_lock
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- waiting_detail_lock
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- waiting_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- waiting_identity_lock
  v_identity_needed := v_track.waiting_kind = 'current_class'
    or (v_action = 'change_waiting_kind' and v_waiting_kind = 'current_class');
  if v_identity_needed then
    v_name_key := pg_catalog.lower(
      pg_catalog.regexp_replace(coalesce(v_task.student_name, ''), '\s+', '', 'g')
    );
    v_parent_phone_key := pg_catalog.regexp_replace(
      coalesce(v_detail.parent_phone, ''), '\D+', '', 'g'
    );
    if v_name_key = '' or v_parent_phone_key = '' then
      raise exception 'registration_student_identity_required' using errcode = '22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'registration-student:' || v_name_key || ':' || v_parent_phone_key,
        0
      )
    );
  end if;

  -- waiting_student_locks
  perform 1
  from public.students student
  where student.id = v_task.student_id
    or exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.track_id = p_track_id
        and enrollment.student_id = student.id
    )
    or (
      v_identity_needed
      and pg_catalog.lower(
        pg_catalog.regexp_replace(coalesce(student.name, ''), '\s+', '', 'g')
      ) = v_name_key
      and pg_catalog.regexp_replace(
        coalesce(student.parent_contact, ''), '\D+', '', 'g'
      ) = v_parent_phone_key
      and (
        nullif(pg_catalog.btrim(v_detail.school_name), '') is null
        or student.school is not distinct from v_detail.school_name
      )
      and (
        nullif(pg_catalog.btrim(v_detail.student_phone), '') is null
        or pg_catalog.regexp_replace(coalesce(student.contact, ''), '\D+', '', 'g')
          = pg_catalog.regexp_replace(v_detail.student_phone, '\D+', '', 'g')
      )
    )
  order by student.id
  for update;

  -- waiting_enrollment_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  where enrollment.track_id = p_track_id
    or (
      v_identity_needed
      and p_class_id is not null
      and enrollment.class_id = p_class_id
      and enrollment.roster_active
      and (
        enrollment.student_id = v_task.student_id
        or exists (
          select 1
          from public.students student
          where student.id = enrollment.student_id
            and pg_catalog.lower(
              pg_catalog.regexp_replace(coalesce(student.name, ''), '\s+', '', 'g')
            ) = v_name_key
            and pg_catalog.regexp_replace(
              coalesce(student.parent_contact, ''), '\D+', '', 'g'
            ) = v_parent_phone_key
            and (
              nullif(pg_catalog.btrim(v_detail.school_name), '') is null
              or student.school is not distinct from v_detail.school_name
            )
            and (
              nullif(pg_catalog.btrim(v_detail.student_phone), '') is null
              or pg_catalog.regexp_replace(
                coalesce(student.contact, ''), '\D+', '', 'g'
              ) = pg_catalog.regexp_replace(v_detail.student_phone, '\D+', '', 'g')
            )
        )
      )
    )
  order by enrollment.id
  for update;

  -- waiting_class_locks
  perform 1
  from public.classes class
  where class.id = p_class_id
    or exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.track_id = p_track_id
        and enrollment.class_id = class.id
    )
  order by class.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, p_track_id, 'transition_waiting'
  );

  -- waiting_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'transition_waiting'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- waiting_mutable_state_check
  if v_track.pipeline_status <> 'waiting' then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;

  select pg_catalog.count(*)
  into v_current_claim_count
  from public.ops_registration_enrollments enrollment
  where enrollment.track_id = p_track_id
    and enrollment.status = 'waitlisted'
    and enrollment.roster_active;
  if (
    v_track.waiting_kind = 'current_class' and v_current_claim_count <> 1
  ) or (
    v_track.waiting_kind <> 'current_class' and v_current_claim_count <> 0
  ) then
    raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
  end if;

  if v_track.waiting_kind = 'current_class' then
    select enrollment.id, enrollment.student_id, enrollment.class_id
    into v_old_enrollment_id, v_old_student_id, v_old_class_id
    from public.ops_registration_enrollments enrollment
    join public.classes class on class.id = enrollment.class_id
    where enrollment.track_id = p_track_id
      and enrollment.status = 'waitlisted'
      and enrollment.roster_active
      and enrollment.student_id = v_task.student_id
      and pg_catalog.btrim(class.subject) = v_track.subject
    order by enrollment.id
    limit 1;
    if not found or v_old_student_id is null or v_task.student_id is null then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
  end if;

  v_next_status := case
    when v_action = 'change_waiting_kind' then 'waiting'
    when v_action = 'record_retest_required' then 'waiting'
    when v_action = 'move_to_enrollment' then 'enrollment_decided'
    else 'not_registered'
  end;
  v_next_waiting_kind := case
    when v_action = 'change_waiting_kind' then v_waiting_kind
    when v_action = 'record_retest_required' then v_track.waiting_kind
    else null
  end;
  v_next_retake_decision := case
    when v_action = 'change_waiting_kind' then v_track.level_test_retake_decision
    when v_action = 'record_retest_required' then 'required'
    else null
  end;
  v_target_class_id := case
    when v_next_waiting_kind = 'current_class' and v_action = 'change_waiting_kind'
      then p_class_id
    when v_next_waiting_kind = 'current_class'
      then v_old_class_id
    else null
  end;
  v_keep_current_claim := v_old_enrollment_id is not null
    and v_next_waiting_kind = 'current_class'
    and v_target_class_id is not distinct from v_old_class_id;

  if v_old_enrollment_id is not null and v_keep_current_claim then
    perform dashboard_private.apply_student_class_roster_mode(
      v_old_student_id,
      v_old_class_id,
      'waitlist',
      'waitlist',
      v_old_enrollment_id,
      'registration_waiting_claim_validated',
      v_actor_id
    );
    v_enrollment_id := v_old_enrollment_id;
  elsif v_old_enrollment_id is not null then
    perform dashboard_private.apply_student_class_roster_mode(
      v_old_student_id,
      v_old_class_id,
      'removed',
      'waitlist',
      v_old_enrollment_id,
      'registration_waiting_claim_changed',
      v_actor_id
    );

    -- waiting_current_claim_deactivation
    update public.ops_registration_enrollments enrollment
    set
      status = 'canceled',
      roster_active = false,
      roster_released_at = null,
      roster_release_reason = null,
      roster_release_source_task_id = null,
      roster_release_kind = null,
      updated_at = pg_catalog.now()
    where enrollment.id = v_old_enrollment_id
      and enrollment.status = 'waitlisted'
      and enrollment.roster_active;
    if not found then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
    v_canceled_enrollment_ids := pg_catalog.array_append(
      v_canceled_enrollment_ids, v_old_enrollment_id
    );
  end if;

  if v_next_waiting_kind = 'current_class' and not v_keep_current_claim then
    perform dashboard_private.apply_registration_current_class_wait(
      v_task_id, p_track_id, v_target_class_id, v_actor_id
    );
    select enrollment.id
    into v_enrollment_id
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.class_id = v_target_class_id
      and enrollment.status = 'waitlisted'
      and enrollment.roster_active
    order by enrollment.id
    limit 1;
    if not found then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
  elsif v_next_waiting_kind <> 'current_class' then
    v_enrollment_id := null;
  end if;

  perform dashboard_private.transition_registration_track_status(
    p_track_id,
    v_next_status,
    v_next_waiting_kind,
    v_next_retake_decision,
    false
  );
  perform dashboard_private.write_registration_track_event(
    v_task_id,
    p_track_id,
    'waiting_transitioned',
    'waiting',
    v_next_status,
    case when v_action = 'close_not_registered' then v_reason else null end,
    pg_catalog.jsonb_build_object(
      'action', v_action,
      'waitingKind', v_next_waiting_kind,
      'classId', v_target_class_id,
      'retakeDecision', case
        when v_action in ('record_retest_required', 'move_to_enrollment')
          then v_retake_decision
        else v_next_retake_decision
      end,
      'enrollmentId', v_enrollment_id,
      'canceledEnrollmentIds', pg_catalog.to_jsonb(v_canceled_enrollment_ids)
    )
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', v_track.id,
    'subject', v_track.subject,
    'status', v_track.pipeline_status,
    'waitingKind', v_track.waiting_kind,
    'levelTestRetakeDecision', v_track.level_test_retake_decision,
    'enrollmentId', v_enrollment_id,
    'canceledEnrollmentIds', pg_catalog.to_jsonb(v_canceled_enrollment_ids),
    'stageEnteredAt', v_track.stage_entered_at
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'transition_waiting',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.transition_registration_waiting_impl(uuid, text, text, uuid, text, text, text)
  owner to postgres;
revoke execute on function dashboard_private.transition_registration_waiting_impl(uuid, text, text, uuid, text, text, text) from public, anon;
grant execute on function dashboard_private.transition_registration_waiting_impl(uuid, text, text, uuid, text, text, text) to authenticated;

create function public.transition_registration_waiting(
  p_track_id uuid,
  p_action text,
  p_waiting_kind text,
  p_class_id uuid,
  p_retake_decision text,
  p_reason text,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.transition_registration_waiting_impl(
    p_track_id, p_action, p_waiting_kind, p_class_id,
    p_retake_decision, p_reason, p_request_key
  );
$$;

revoke execute on function public.transition_registration_waiting(uuid, text, text, uuid, text, text, text) from public, anon;
grant execute on function public.transition_registration_waiting(uuid, text, text, uuid, text, text, text) to authenticated;

create function dashboard_private.route_registration_enrollment_decision_impl(
  p_track_id uuid,
  p_destination text,
  p_waiting_kind text,
  p_class_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_destination text := pg_catalog.lower(nullif(pg_catalog.btrim(p_destination), ''));
  v_waiting_kind text := pg_catalog.lower(nullif(pg_catalog.btrim(p_waiting_kind), ''));
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_task_id uuid;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_identity_needed boolean := false;
  v_name_key text;
  v_parent_phone_key text;
  v_enrollment_id uuid;
  v_canceled_enrollment_ids uuid[] := array[]::uuid[];
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_track_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_destination is null
    or v_destination not in ('waiting', 'not_registered')
  then
    raise exception 'registration_enrollment_destination_invalid' using errcode = '22023';
  end if;
  if v_destination = 'waiting' then
    if v_waiting_kind is null
      or v_waiting_kind not in ('current_class', 'current_term_opening', 'next_term_opening')
      or v_reason is not null
    then
      raise exception 'registration_enrollment_decision_arguments_invalid' using errcode = '22023';
    end if;
    if v_waiting_kind = 'current_class' and p_class_id is null then
      raise exception 'waiting_class_required' using errcode = '22023';
    end if;
    if v_waiting_kind <> 'current_class' and p_class_id is not null then
      raise exception 'waiting_class_not_allowed' using errcode = '22023';
    end if;
  elsif v_destination = 'not_registered' then
    if v_waiting_kind is not null
      or p_class_id is not null
      or v_reason is null
    then
      raise exception 'registration_enrollment_decision_arguments_invalid' using errcode = '22023';
    end if;
  end if;

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', p_track_id,
    'destination', v_destination,
    'waitingKind', v_waiting_kind,
    'classId', p_class_id,
    'reason', v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- enrollment_decision_task_lock
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- enrollment_decision_detail_lock
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- enrollment_decision_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- enrollment_decision_identity_lock
  v_identity_needed := v_destination = 'waiting' and v_waiting_kind = 'current_class';
  if v_identity_needed then
    v_name_key := pg_catalog.lower(
      pg_catalog.regexp_replace(coalesce(v_task.student_name, ''), '\s+', '', 'g')
    );
    v_parent_phone_key := pg_catalog.regexp_replace(
      coalesce(v_detail.parent_phone, ''), '\D+', '', 'g'
    );
    if v_name_key = '' or v_parent_phone_key = '' then
      raise exception 'registration_student_identity_required' using errcode = '22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'registration-student:' || v_name_key || ':' || v_parent_phone_key,
        0
      )
    );
  end if;

  -- enrollment_decision_student_locks
  perform 1
  from public.students student
  where student.id = v_task.student_id
    or exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.track_id = p_track_id
        and enrollment.student_id = student.id
    )
    or (
      v_identity_needed
      and pg_catalog.lower(
        pg_catalog.regexp_replace(coalesce(student.name, ''), '\s+', '', 'g')
      ) = v_name_key
      and pg_catalog.regexp_replace(
        coalesce(student.parent_contact, ''), '\D+', '', 'g'
      ) = v_parent_phone_key
      and (
        nullif(pg_catalog.btrim(v_detail.school_name), '') is null
        or student.school is not distinct from v_detail.school_name
      )
      and (
        nullif(pg_catalog.btrim(v_detail.student_phone), '') is null
        or pg_catalog.regexp_replace(coalesce(student.contact, ''), '\D+', '', 'g')
          = pg_catalog.regexp_replace(v_detail.student_phone, '\D+', '', 'g')
      )
    )
  order by student.id
  for update;

  -- enrollment_decision_enrollment_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  where enrollment.track_id = p_track_id
    or (
      v_identity_needed
      and enrollment.class_id = p_class_id
      and enrollment.roster_active
      and (
        enrollment.student_id = v_task.student_id
        or exists (
          select 1
          from public.students student
          where student.id = enrollment.student_id
            and pg_catalog.lower(
              pg_catalog.regexp_replace(coalesce(student.name, ''), '\s+', '', 'g')
            ) = v_name_key
            and pg_catalog.regexp_replace(
              coalesce(student.parent_contact, ''), '\D+', '', 'g'
            ) = v_parent_phone_key
            and (
              nullif(pg_catalog.btrim(v_detail.school_name), '') is null
              or student.school is not distinct from v_detail.school_name
            )
            and (
              nullif(pg_catalog.btrim(v_detail.student_phone), '') is null
              or pg_catalog.regexp_replace(
                coalesce(student.contact, ''), '\D+', '', 'g'
              ) = pg_catalog.regexp_replace(v_detail.student_phone, '\D+', '', 'g')
            )
        )
      )
    )
  order by enrollment.id
  for update;

  -- enrollment_decision_class_locks
  perform 1
  from public.classes class
  where class.id = p_class_id
    or exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.track_id = p_track_id
        and enrollment.class_id = class.id
    )
  order by class.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, p_track_id, 'route_enrollment_decision'
  );

  -- enrollment_decision_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'route_enrollment_decision'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- enrollment_decision_mutable_state_check
  if v_track.pipeline_status <> 'enrollment_decided' then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.roster_active
  ) then
    raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
  end if;

  -- enrollment_decision_cancel_unbatched_drafts
  with canceled as (
    update public.ops_registration_enrollments enrollment
    set
      status = 'canceled',
      roster_active = false,
      roster_released_at = null,
      roster_release_reason = null,
      roster_release_source_task_id = null,
      roster_release_kind = null,
      updated_at = pg_catalog.now()
    where enrollment.track_id = p_track_id
      and enrollment.status = 'planned'
      and enrollment.admission_batch_id is null
      and not enrollment.roster_active
    returning enrollment.id
  )
  select coalesce(
    pg_catalog.array_agg(canceled.id order by canceled.id),
    array[]::uuid[]
  )
  into v_canceled_enrollment_ids
  from canceled;

  if v_destination = 'waiting' and v_waiting_kind = 'current_class' then
    perform dashboard_private.apply_registration_current_class_wait(
      v_task_id, p_track_id, p_class_id, v_actor_id
    );
    select enrollment.id
    into v_enrollment_id
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = p_track_id
      and enrollment.class_id = p_class_id
      and enrollment.status = 'waitlisted'
      and enrollment.roster_active
    order by enrollment.id
    limit 1;
    if not found then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
  end if;

  perform dashboard_private.transition_registration_track_status(
    p_track_id,
    v_destination,
    case when v_destination = 'waiting' then v_waiting_kind else null end,
    null,
    false
  );
  perform dashboard_private.write_registration_track_event(
    v_task_id,
    p_track_id,
    'enrollment_decision_routed',
    'enrollment_decided',
    v_destination,
    case when v_destination = 'not_registered' then v_reason else null end,
    pg_catalog.jsonb_build_object(
      'waitingKind', case when v_destination = 'waiting' then v_waiting_kind else null end,
      'classId', case
        when v_destination = 'waiting' and v_waiting_kind = 'current_class' then p_class_id
        else null
      end,
      'enrollmentId', v_enrollment_id,
      'canceledEnrollmentIds', pg_catalog.to_jsonb(v_canceled_enrollment_ids)
    )
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', v_track.id,
    'subject', v_track.subject,
    'status', v_track.pipeline_status,
    'waitingKind', v_track.waiting_kind,
    'levelTestRetakeDecision', v_track.level_test_retake_decision,
    'enrollmentId', v_enrollment_id,
    'canceledEnrollmentIds', pg_catalog.to_jsonb(v_canceled_enrollment_ids),
    'stageEnteredAt', v_track.stage_entered_at
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'route_enrollment_decision',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.route_registration_enrollment_decision_impl(uuid, text, text, uuid, text, text)
  owner to postgres;
revoke execute on function dashboard_private.route_registration_enrollment_decision_impl(uuid, text, text, uuid, text, text) from public, anon;
grant execute on function dashboard_private.route_registration_enrollment_decision_impl(uuid, text, text, uuid, text, text) to authenticated;

create function public.route_registration_enrollment_decision(
  p_track_id uuid,
  p_destination text,
  p_waiting_kind text,
  p_class_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.route_registration_enrollment_decision_impl(
    p_track_id, p_destination, p_waiting_kind, p_class_id, p_reason, p_request_key
  );
$$;

revoke execute on function public.route_registration_enrollment_decision(uuid, text, text, uuid, text, text) from public, anon;
grant execute on function public.route_registration_enrollment_decision(uuid, text, text, uuid, text, text) to authenticated;

create function dashboard_private.save_registration_enrollment_rows_impl(
  p_track_id uuid,
  p_rows jsonb,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_allowed_keys text[] := array[
    'id', 'classId', 'textbookId', 'classStartDate',
    'classStartSessionKey', 'classStartSession', 'sortOrder'
  ];
  v_input_row jsonb;
  v_canonical_row jsonb;
  v_canonical_rows jsonb := '[]'::jsonb;
  v_row_id_text text;
  v_class_id_text text;
  v_textbook_id_text text;
  v_class_start_date_text text;
  v_class_start_session_key text;
  v_class_start_session text;
  v_sort_order_text text;
  v_row_id uuid;
  v_class_id uuid;
  v_textbook_id uuid;
  v_class_start_date date;
  v_sort_order integer;
  v_task_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_existing public.ops_registration_enrollments%rowtype;
  v_class record;
  v_session jsonb;
  v_saved_id uuid;
  v_submitted_ids uuid[] := array[]::uuid[];
  v_rows_response jsonb := '[]'::jsonb;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_track_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
  end if;

  -- enrollment_rows_shape_validation
  for v_input_row in
    select element.value
    from pg_catalog.jsonb_array_elements(p_rows) element(value)
  loop
    if pg_catalog.jsonb_typeof(v_input_row) <> 'object' then
      raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
    end if;
    if v_input_row ?| array[
      'status', 'makeeduRegistered', 'makeedu_registered',
      'admissionBatchId', 'admission_batch_id',
      'trackId', 'track_id', 'clientKey'
    ] or exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_input_row) supplied(key)
      where not (supplied.key = any(v_allowed_keys))
    ) then
      raise exception 'registration_enrollment_rows_unknown_key' using errcode = '22023';
    end if;

    if not (v_input_row ? 'classId')
      or pg_catalog.jsonb_typeof(v_input_row -> 'classId') <> 'string'
    then
      raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
    end if;
    v_class_id_text := pg_catalog.lower(pg_catalog.btrim(v_input_row ->> 'classId'));
    if v_class_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
    end if;

    if not (v_input_row ? 'sortOrder')
      or pg_catalog.jsonb_typeof(v_input_row -> 'sortOrder') <> 'number'
    then
      raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
    end if;
    v_sort_order_text := v_input_row ->> 'sortOrder';
    if v_sort_order_text !~ '^-?[0-9]+$' then
      raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
    end if;
    -- enrollment_rows_integer_casts
    begin
      if v_sort_order_text::numeric < -2147483648
        or v_sort_order_text::numeric > 2147483647
      then
        raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
      end if;
      v_sort_order := v_sort_order_text::integer;
    exception when numeric_value_out_of_range then
      raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
    end;

    if not (v_input_row ? 'id') or v_input_row -> 'id' = 'null'::jsonb then
      v_row_id_text := null;
    elsif pg_catalog.jsonb_typeof(v_input_row -> 'id') = 'string' then
      v_row_id_text := pg_catalog.lower(pg_catalog.btrim(v_input_row ->> 'id'));
      if v_row_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
      end if;
    else
      raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
    end if;

    if not (v_input_row ? 'textbookId')
      or v_input_row -> 'textbookId' = 'null'::jsonb
    then
      v_textbook_id_text := null;
    elsif pg_catalog.jsonb_typeof(v_input_row -> 'textbookId') = 'string' then
      v_textbook_id_text := pg_catalog.lower(
        pg_catalog.btrim(v_input_row ->> 'textbookId')
      );
      if v_textbook_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
      end if;
    else
      raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
    end if;

    if not (v_input_row ? 'classStartDate')
      or v_input_row -> 'classStartDate' = 'null'::jsonb
    then
      v_class_start_date_text := null;
    elsif pg_catalog.jsonb_typeof(v_input_row -> 'classStartDate') = 'string' then
      v_class_start_date_text := pg_catalog.btrim(v_input_row ->> 'classStartDate');
      if v_class_start_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
      end if;
    else
      raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
    end if;

    if not (v_input_row ? 'classStartSessionKey')
      or v_input_row -> 'classStartSessionKey' = 'null'::jsonb
    then
      v_class_start_session_key := null;
    elsif pg_catalog.jsonb_typeof(v_input_row -> 'classStartSessionKey') = 'string' then
      v_class_start_session_key := nullif(
        pg_catalog.btrim(v_input_row ->> 'classStartSessionKey'), ''
      );
    else
      raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
    end if;

    if not (v_input_row ? 'classStartSession')
      or v_input_row -> 'classStartSession' = 'null'::jsonb
    then
      v_class_start_session := null;
    elsif pg_catalog.jsonb_typeof(v_input_row -> 'classStartSession') = 'string' then
      v_class_start_session := nullif(
        pg_catalog.btrim(v_input_row ->> 'classStartSession'), ''
      );
    else
      raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
    end if;

    if not (
      (
        v_class_start_date_text is null
        and v_class_start_session_key is null
        and v_class_start_session is null
      ) or (
        v_class_start_date_text is not null
        and v_class_start_session_key is not null
        and v_class_start_session is not null
      )
    ) then
      raise exception 'registration_enrollment_schedule_incomplete' using errcode = '22023';
    end if;

    -- enrollment_rows_uuid_casts
    v_row_id := case when v_row_id_text is null then null else v_row_id_text::uuid end;
    v_class_id := v_class_id_text::uuid;
    v_textbook_id := case
      when v_textbook_id_text is null then null
      else v_textbook_id_text::uuid
    end;
    if v_class_start_date_text is null then
      v_class_start_date := null;
    else
      begin
        v_class_start_date := v_class_start_date_text::date;
      exception when others then
        raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
      end;
      if pg_catalog.to_char(v_class_start_date, 'YYYY-MM-DD') <> v_class_start_date_text then
        raise exception 'registration_enrollment_rows_invalid' using errcode = '22023';
      end if;
    end if;

    v_canonical_row := pg_catalog.jsonb_build_object(
      'id', v_row_id,
      'classId', v_class_id,
      'textbookId', v_textbook_id,
      'classStartDate', v_class_start_date,
      'classStartSessionKey', v_class_start_session_key,
      'classStartSession', v_class_start_session,
      'sortOrder', v_sort_order
    );
    v_canonical_rows := v_canonical_rows || pg_catalog.jsonb_build_array(v_canonical_row);
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_canonical_rows) row(value)
    where row.value ->> 'id' is not null
    group by row.value ->> 'id'
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'registration_enrollment_rows_duplicate_id' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_canonical_rows) row(value)
    group by row.value ->> 'classId'
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'registration_enrollment_rows_duplicate_class' using errcode = '22023';
  end if;
  select coalesce(
    pg_catalog.jsonb_agg(
      row.value order by
        case when row.value ->> 'id' is null then 1 else 0 end,
        row.value ->> 'id',
        row.value ->> 'classId'
    ),
    '[]'::jsonb
  )
  into v_canonical_rows
  from pg_catalog.jsonb_array_elements(v_canonical_rows) row(value);

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', p_track_id,
    'rows', v_canonical_rows
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- enrollment_rows_task_lock
  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- enrollment_rows_detail_lock
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- enrollment_rows_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- enrollment_rows_enrollment_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  where enrollment.track_id = p_track_id
  order by enrollment.id
  for update;

  -- enrollment_rows_class_locks
  perform 1
  from public.classes class
  where class.id in (
    select (row.value ->> 'classId')::uuid
    from pg_catalog.jsonb_array_elements(v_canonical_rows) row(value)
  )
  order by class.id
  for update;

  -- enrollment_rows_textbook_locks
  perform 1
  from public.textbooks textbook
  where textbook.id in (
    select (row.value ->> 'textbookId')::uuid
    from pg_catalog.jsonb_array_elements(v_canonical_rows) row(value)
    where row.value ->> 'textbookId' is not null
  )
  order by textbook.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, p_track_id, 'save_enrollment_rows'
  );

  -- enrollment_rows_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'save_enrollment_rows'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- enrollment_rows_mutable_state_check
  if v_track.pipeline_status not in ('enrollment_decided', 'registered') then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;

  for v_canonical_row in
    select row.value
    from pg_catalog.jsonb_array_elements(v_canonical_rows) row(value)
    order by
      case when row.value ->> 'id' is null then 1 else 0 end,
      row.value ->> 'id',
      row.value ->> 'classId'
  loop
    v_row_id := nullif(v_canonical_row ->> 'id', '')::uuid;
    v_class_id := (v_canonical_row ->> 'classId')::uuid;
    v_textbook_id := nullif(v_canonical_row ->> 'textbookId', '')::uuid;
    v_class_start_date := nullif(v_canonical_row ->> 'classStartDate', '')::date;
    v_class_start_session_key := nullif(
      pg_catalog.btrim(v_canonical_row ->> 'classStartSessionKey'), ''
    );
    v_class_start_session := nullif(
      pg_catalog.btrim(v_canonical_row ->> 'classStartSession'), ''
    );
    v_sort_order := (v_canonical_row ->> 'sortOrder')::integer;

    if v_row_id is not null then
      select enrollment.*
      into v_existing
      from public.ops_registration_enrollments enrollment
      where enrollment.id = v_row_id;
      if not found
        or v_existing.track_id is distinct from p_track_id
        or v_existing.status <> 'planned'
        or v_existing.admission_batch_id is not null
        or v_existing.student_id is not null
        or v_existing.roster_active
        or v_existing.roster_released_at is not null
        or v_existing.roster_release_reason is not null
        or v_existing.roster_release_source_task_id is not null
        or v_existing.roster_release_kind is not null
      then
        raise exception 'registration_enrollment_draft_not_editable' using errcode = '40001';
      end if;
    end if;

    select
      class.id,
      pg_catalog.btrim(class.subject) as subject,
      class.textbook_ids
    into v_class
    from public.classes class
    where class.id = v_class_id;
    if not found then
      raise exception 'registration_class_not_found' using errcode = 'P0002';
    end if;
    if pg_catalog.btrim(v_class.subject) is distinct from v_track.subject then
      raise exception 'registration_class_subject_mismatch' using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.track_id = p_track_id
        and enrollment.class_id = v_class_id
        and enrollment.id is distinct from v_row_id
        and (enrollment.status = 'planned' or enrollment.roster_active)
    ) then
      raise exception 'registration_enrollment_class_conflict' using errcode = '40001';
    end if;

    if v_textbook_id is not null and not (
      exists (
        select 1
        from public.textbooks textbook
        where textbook.id = v_textbook_id
      )
      and pg_catalog.jsonb_typeof(
        coalesce(pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb)
      ) = 'array'
      and coalesce(
        pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb
      ) ? v_textbook_id::text
    ) then
      raise exception 'registration_textbook_class_mismatch' using errcode = '23514';
    end if;

    if v_class_start_date is null
      and v_class_start_session_key is null
      and v_class_start_session is null
    then
      v_session := null;
    else
      v_session := dashboard_private.validate_registration_class_session(
        v_class_id, v_class_start_date, v_class_start_session_key
      );
      if coalesce((v_session ->> 'valid')::boolean, false) is not true
        or v_session ->> 'sessionLabel' is distinct from v_class_start_session
      then
        raise exception 'registration_class_session_invalid' using errcode = '23514';
      end if;
      v_class_start_date := (v_session ->> 'sessionDate')::date;
      v_class_start_session_key := v_session ->> 'sessionKey';
      v_class_start_session := v_session ->> 'sessionLabel';
    end if;

    if v_row_id is null then
      insert into public.ops_registration_enrollments(
        track_id,
        student_id,
        admission_batch_id,
        class_id,
        textbook_id,
        class_start_date,
        class_start_session_key,
        class_start_session,
        status,
        makeedu_registered,
        roster_active,
        roster_released_at,
        roster_release_reason,
        roster_release_source_task_id,
        roster_release_kind,
        sort_order
      ) values (
        p_track_id,
        null,
        null,
        v_class_id,
        v_textbook_id,
        v_class_start_date,
        v_class_start_session_key,
        v_class_start_session,
        'planned',
        false,
        false,
        null,
        null,
        null,
        null,
        v_sort_order
      )
      returning id into v_saved_id;
    else
      update public.ops_registration_enrollments enrollment
      set
        class_id = v_class_id,
        textbook_id = v_textbook_id,
        class_start_date = v_class_start_date,
        class_start_session_key = v_class_start_session_key,
        class_start_session = v_class_start_session,
        sort_order = v_sort_order,
        updated_at = pg_catalog.now()
      where enrollment.id = v_row_id
        and enrollment.track_id = p_track_id
        and enrollment.status = 'planned'
        and enrollment.admission_batch_id is null
        and enrollment.student_id is null
        and not enrollment.roster_active
      returning enrollment.id into v_saved_id;
      if not found then
        raise exception 'registration_enrollment_draft_not_editable' using errcode = '40001';
      end if;
    end if;
    v_submitted_ids := pg_catalog.array_append(v_submitted_ids, v_saved_id);
  end loop;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', enrollment.id,
        'trackId', enrollment.track_id,
        'studentId', enrollment.student_id,
        'admissionBatchId', enrollment.admission_batch_id,
        'classId', enrollment.class_id,
        'textbookId', enrollment.textbook_id,
        'classStartDate', enrollment.class_start_date,
        'classStartSessionKey', enrollment.class_start_session_key,
        'classStartSession', enrollment.class_start_session,
        'status', enrollment.status,
        'makeeduRegistered', enrollment.makeedu_registered,
        'rosterActive', enrollment.roster_active,
        'rosterReleasedAt', enrollment.roster_released_at,
        'rosterReleaseReason', enrollment.roster_release_reason,
        'rosterReleaseSourceTaskId', enrollment.roster_release_source_task_id,
        'rosterReleaseKind', enrollment.roster_release_kind,
        'sortOrder', enrollment.sort_order
      ) order by enrollment.sort_order, enrollment.class_id, enrollment.id
    ),
    '[]'::jsonb
  )
  into v_rows_response
  from public.ops_registration_enrollments enrollment
  where enrollment.id = any(v_submitted_ids);

  perform dashboard_private.write_registration_track_event(
    v_task_id,
    p_track_id,
    'enrollment_rows_saved',
    v_track.pipeline_status,
    v_track.pipeline_status,
    null,
    pg_catalog.jsonb_build_object(
      'rowIds', pg_catalog.to_jsonb(v_submitted_ids),
      'rowCount', pg_catalog.cardinality(v_submitted_ids),
      'rows', v_rows_response
    )
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);

  v_response := pg_catalog.jsonb_build_object(
    'trackId', p_track_id,
    'rows', v_rows_response
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'save_enrollment_rows',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.save_registration_enrollment_rows_impl(uuid, jsonb, text)
  owner to postgres;
revoke execute on function dashboard_private.save_registration_enrollment_rows_impl(uuid, jsonb, text) from public, anon;
grant execute on function dashboard_private.save_registration_enrollment_rows_impl(uuid, jsonb, text) to authenticated;

create function public.save_registration_enrollment_rows(
  p_track_id uuid,
  p_rows jsonb,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.save_registration_enrollment_rows_impl(
    p_track_id, p_rows, p_request_key
  );
$$;

revoke execute on function public.save_registration_enrollment_rows(uuid, jsonb, text) from public, anon;
grant execute on function public.save_registration_enrollment_rows(uuid, jsonb, text) to authenticated;

create function dashboard_private.claim_registration_admission_message_impl(
  p_task_id uuid,
  p_message_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_message_request_key text := nullif(pg_catalog.btrim(p_message_request_key), '');
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_message public.ops_registration_messages%rowtype;
  v_key_message public.ops_registration_messages%rowtype;
  v_eligible boolean := false;
  v_inserted boolean := false;
  v_student_name text;
  v_parent_phone text;
  v_parent_phone_digits text;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if p_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_message_request_key is null then
    raise exception 'message_request_key_required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-admission-message:' || v_message_request_key,
      0
    )
  );

  -- admission_claim_task_lock
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- admission_claim_detail_lock
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- admission_claim_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by track.id
  for update;

  -- admission_claim_enrollment_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = p_task_id
  order by enrollment.id
  for update of enrollment;

  -- admission_claim_message_locks
  perform 1
  from public.ops_registration_messages message
  where message.request_key = v_message_request_key
    or (
      message.task_id = p_task_id
      and message.template_key = 'admission_application'
    )
  order by message.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'claim_admission_message'
  );

  select message.*
  into v_key_message
  from public.ops_registration_messages message
  where message.request_key = v_message_request_key;
  if found and (
    v_key_message.task_id is distinct from p_task_id
    or v_key_message.template_key <> 'admission_application'
  ) then
    raise exception 'registration_message_request_key_reused' using errcode = '22023';
  end if;

  -- admission_claim_existing_active
  select message.*
  into v_message
  from public.ops_registration_messages message
  where message.task_id = p_task_id
    and message.template_key = 'admission_application'
    and message.claim_active
  order by message.created_at desc, message.id desc
  limit 1;
  if found then
    return pg_catalog.jsonb_build_object(
      'taskId', p_task_id,
      'messageId', v_message.id,
      'messageRequestKey', v_message.request_key,
      'claimStatus', v_message.status,
      'claimActive', true,
      'shouldSend', false,
      'retryRequiresNewMessageKey', false
    );
  end if;

  if v_key_message.id is not null then
    if v_key_message.status = 'failed' and not v_key_message.claim_active then
      return pg_catalog.jsonb_build_object(
        'taskId', p_task_id,
        'messageId', v_key_message.id,
        'messageRequestKey', v_key_message.request_key,
        'claimStatus', 'failed',
        'claimActive', false,
        'shouldSend', false,
        'retryRequiresNewMessageKey', true
      );
    end if;
    raise exception 'registration_message_request_key_reused' using errcode = '22023';
  end if;

  -- admission_claim_eligibility
  v_eligible := exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and track.pipeline_status = 'enrollment_decided'
  ) or exists (
    select 1
    from public.ops_registration_subject_tracks track
    join public.ops_registration_enrollments enrollment
      on enrollment.track_id = track.id
    where track.task_id = p_task_id
      and track.pipeline_status = 'registered'
      and enrollment.status = 'planned'
      and enrollment.admission_batch_id is null
  );
  if coalesce(v_detail.admission_notice_sent, false) then
    raise exception 'registration_admission_notice_already_sent' using errcode = '40001';
  end if;
  if not v_eligible then
    raise exception 'registration_admission_message_ineligible' using errcode = '40001';
  end if;

  v_student_name := nullif(pg_catalog.btrim(v_task.student_name), '');
  if v_student_name is null then
    raise exception 'registration_student_name_required' using errcode = '22023';
  end if;
  v_parent_phone := nullif(pg_catalog.btrim(v_detail.parent_phone), '');
  v_parent_phone_digits := pg_catalog.regexp_replace(
    coalesce(v_parent_phone, ''), '\D+', '', 'g'
  );
  if v_parent_phone_digits !~ '^01(0|1|[6-9])[0-9]{7,8}$' then
    raise exception 'registration_parent_phone_invalid' using errcode = '22023';
  end if;

  -- admission_claim_insert
  insert into public.ops_registration_messages(
    task_id,
    template_key,
    request_key,
    status,
    claim_active,
    recipient_last4,
    sent_by
  ) values (
    p_task_id,
    'admission_application',
    v_message_request_key,
    'pending',
    true,
    pg_catalog.right(v_parent_phone_digits, 4),
    v_actor_id
  )
  on conflict do nothing
  returning * into v_message;
  v_inserted := found;

  if v_inserted then
    return pg_catalog.jsonb_build_object(
      'taskId', p_task_id,
      'messageId', v_message.id,
      'messageRequestKey', v_message.request_key,
      'claimStatus', 'pending',
      'claimActive', true,
      'shouldSend', true,
      'retryRequiresNewMessageKey', false,
      'studentName', v_student_name,
      'parentPhone', v_parent_phone_digits,
      'commonRevision', v_detail.common_revision
    );
  end if;

  select message.*
  into v_key_message
  from public.ops_registration_messages message
  where message.request_key = v_message_request_key
  for update;
  if found and (
    v_key_message.task_id is distinct from p_task_id
    or v_key_message.template_key <> 'admission_application'
  ) then
    raise exception 'registration_message_request_key_reused' using errcode = '22023';
  end if;

  select message.*
  into v_message
  from public.ops_registration_messages message
  where message.task_id = p_task_id
    and message.template_key = 'admission_application'
    and message.claim_active
  order by message.created_at desc, message.id desc
  limit 1
  for update;
  if found then
    return pg_catalog.jsonb_build_object(
      'taskId', p_task_id,
      'messageId', v_message.id,
      'messageRequestKey', v_message.request_key,
      'claimStatus', v_message.status,
      'claimActive', true,
      'shouldSend', false,
      'retryRequiresNewMessageKey', false
    );
  end if;

  if v_key_message.id is not null
    and v_key_message.status = 'failed'
    and not v_key_message.claim_active
  then
    v_response := pg_catalog.jsonb_build_object(
      'taskId', p_task_id,
      'messageId', v_key_message.id,
      'messageRequestKey', v_key_message.request_key,
      'claimStatus', 'failed',
      'claimActive', false,
      'shouldSend', false,
      'retryRequiresNewMessageKey', true
    );
    return v_response;
  end if;
  raise exception 'registration_admission_message_claim_conflict' using errcode = '40001';
end;
$$;

alter function dashboard_private.claim_registration_admission_message_impl(uuid, text)
  owner to postgres;
revoke execute on function dashboard_private.claim_registration_admission_message_impl(uuid, text) from public, anon;
grant execute on function dashboard_private.claim_registration_admission_message_impl(uuid, text) to authenticated;

create function public.claim_registration_admission_message(
  p_task_id uuid,
  p_message_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.claim_registration_admission_message_impl(
    p_task_id, p_message_request_key
  );
$$;

revoke execute on function public.claim_registration_admission_message(uuid, text) from public, anon;
grant execute on function public.claim_registration_admission_message(uuid, text) to authenticated;

create function dashboard_private.finalize_registration_admission_message_impl(
  p_message_id uuid,
  p_result text,
  p_provider_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result text := pg_catalog.lower(nullif(pg_catalog.btrim(p_result), ''));
  v_task_id uuid;
  v_message public.ops_registration_messages%rowtype;
  v_provider_message_id text;
  v_provider_group_id text;
  v_provider_status_code text;
  v_provider_status_message text;
  v_error_message text;
  v_next_claim_active boolean;
  v_applied boolean := false;
  v_response jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'registration_service_role_required' using errcode = '42501';
  end if;
  if p_message_id is null then
    raise exception 'registration_message_not_found' using errcode = 'P0002';
  end if;
  if v_result is null or v_result not in ('accepted', 'failed', 'unknown') then
    raise exception 'registration_message_result_invalid' using errcode = '22023';
  end if;
  if p_provider_result is null
    or pg_catalog.jsonb_typeof(p_provider_result) <> 'object'
  then
    raise exception 'registration_provider_result_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_provider_result) supplied(key)
    where supplied.key not in (
      'providerMessageId', 'providerGroupId', 'providerStatusCode',
      'providerStatusMessage', 'errorMessage'
    )
  ) then
    raise exception 'registration_provider_result_unknown_key' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_each(p_provider_result) supplied(key, value)
    where supplied.value <> 'null'::jsonb
      and pg_catalog.jsonb_typeof(supplied.value) <> 'string'
  ) then
    raise exception 'registration_provider_result_invalid' using errcode = '22023';
  end if;

  v_provider_message_id := nullif(
    pg_catalog.btrim(p_provider_result ->> 'providerMessageId'), ''
  );
  v_provider_group_id := nullif(
    pg_catalog.btrim(p_provider_result ->> 'providerGroupId'), ''
  );
  v_provider_status_code := nullif(
    pg_catalog.btrim(p_provider_result ->> 'providerStatusCode'), ''
  );
  v_provider_status_message := nullif(
    pg_catalog.btrim(p_provider_result ->> 'providerStatusMessage'), ''
  );
  v_error_message := nullif(
    pg_catalog.btrim(p_provider_result ->> 'errorMessage'), ''
  );
  if v_result = 'accepted'
    and v_provider_message_id is null
    and v_provider_group_id is null
  then
    raise exception 'registration_provider_identity_required' using errcode = '22023';
  end if;

  select message.task_id
  into v_task_id
  from public.ops_registration_messages message
  where message.id = p_message_id
    and message.template_key = 'admission_application';
  if v_task_id is null then
    raise exception 'registration_message_not_found' using errcode = 'P0002';
  end if;

  -- admission_finalizer_task_lock
  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_message_not_found' using errcode = 'P0002';
  end if;

  -- admission_finalizer_detail_lock
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- admission_finalizer_message_lock
  select message.*
  into v_message
  from public.ops_registration_messages message
  where message.id = p_message_id
    and message.task_id = v_task_id
    and message.template_key = 'admission_application'
  for update;
  if not found then
    raise exception 'registration_message_not_found' using errcode = 'P0002';
  end if;

  -- admission_finalizer_state_machine
  if v_message.status = 'accepted' then
    v_applied := false;
  elsif v_message.status = 'failed' and not v_message.claim_active then
    v_applied := false;
  elsif v_message.status in ('pending', 'unknown') then
    if v_message.status = v_result then
      v_applied := false;
    else
      v_applied := true;
      v_next_claim_active := v_result <> 'failed';
    end if;
  elsif v_message.status = 'failed'
    and v_message.claim_active
    and v_result = 'accepted'
  then
    v_applied := true;
    v_next_claim_active := true;
  else
    v_applied := false;
  end if;

  if v_applied then
    update public.ops_registration_messages
    set
      status = v_result,
      claim_active = v_next_claim_active,
      provider_message_id = coalesce(v_provider_message_id, provider_message_id),
      provider_group_id = coalesce(v_provider_group_id, provider_group_id),
      provider_status_code = coalesce(v_provider_status_code, provider_status_code),
      provider_status_message = coalesce(
        v_provider_status_message, provider_status_message
      ),
      error_message = case
        when v_result = 'accepted' then null
        else coalesce(v_error_message, error_message)
      end,
      updated_at = pg_catalog.now()
    where id = p_message_id
      and status = v_message.status
      and claim_active = v_message.claim_active
    returning * into v_message;
    if not found then
      raise exception 'registration_message_state_conflict' using errcode = '40001';
    end if;
  end if;

  -- admission_finalizer_response
  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'messageId', v_message.id,
    'applied', v_applied,
    'currentStatus', v_message.status,
    'claimActive', v_message.claim_active,
    'messageRequestKey', v_message.request_key,
    'requiresAdmissionMark', v_message.status = 'accepted',
    'retryRequiresNewMessageKey',
      v_message.status = 'failed' and not v_message.claim_active
  );
  return v_response;
end;
$$;

alter function dashboard_private.finalize_registration_admission_message_impl(uuid, text, jsonb)
  owner to postgres;
revoke execute on function dashboard_private.finalize_registration_admission_message_impl(uuid, text, jsonb) from public, anon, authenticated;
grant usage on schema dashboard_private to service_role;
grant execute on function dashboard_private.finalize_registration_admission_message_impl(uuid, text, jsonb) to service_role;

create function public.finalize_registration_admission_message(
  p_message_id uuid,
  p_result text,
  p_provider_result jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.finalize_registration_admission_message_impl(
    p_message_id, p_result, p_provider_result
  );
$$;

revoke execute on function public.finalize_registration_admission_message(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.finalize_registration_admission_message(uuid, text, jsonb) to service_role;

create function dashboard_private.reconcile_registration_admission_message_impl(
  p_message_id uuid,
  p_resolution text,
  p_provider_evidence jsonb,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_resolution text := pg_catalog.lower(nullif(pg_catalog.btrim(p_resolution), ''));
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_provider_message_id text;
  v_provider_group_id text;
  v_lookup_request_key text;
  v_observed_state text;
  v_observed_status_code text;
  v_observed_status_message text;
  v_canonical_evidence jsonb;
  v_task_id uuid;
  v_message public.ops_registration_messages%rowtype;
  v_previous_status text;
  v_previous_claim_active boolean;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_occurred_at timestamptz := pg_catalog.now();
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if p_message_id is null then
    raise exception 'registration_message_not_found' using errcode = 'P0002';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'registration_reconciliation_reason_required' using errcode = '22023';
  end if;
  if v_resolution is null or v_resolution not in ('accepted', 'failed') then
    raise exception 'registration_reconciliation_resolution_invalid' using errcode = '22023';
  end if;
  if p_provider_evidence is null
    or pg_catalog.jsonb_typeof(p_provider_evidence) <> 'object'
  then
    raise exception 'registration_provider_evidence_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_provider_evidence) supplied(key)
    where supplied.key not in (
      'providerMessageId', 'providerGroupId', 'lookupRequestKey',
      'observedState', 'observedStatusCode', 'observedStatusMessage'
    )
  ) or exists (
    select 1
    from pg_catalog.jsonb_each(p_provider_evidence) supplied(key, value)
    where supplied.value <> 'null'::jsonb
      and pg_catalog.jsonb_typeof(supplied.value) <> 'string'
  ) then
    raise exception 'registration_provider_evidence_invalid' using errcode = '22023';
  end if;

  v_provider_message_id := nullif(
    pg_catalog.btrim(p_provider_evidence ->> 'providerMessageId'), ''
  );
  v_provider_group_id := nullif(
    pg_catalog.btrim(p_provider_evidence ->> 'providerGroupId'), ''
  );
  v_lookup_request_key := nullif(
    pg_catalog.btrim(p_provider_evidence ->> 'lookupRequestKey'), ''
  );
  v_observed_state := pg_catalog.lower(nullif(
    pg_catalog.btrim(p_provider_evidence ->> 'observedState'), ''
  ));
  v_observed_status_code := nullif(
    pg_catalog.btrim(p_provider_evidence ->> 'observedStatusCode'), ''
  );
  v_observed_status_message := nullif(
    pg_catalog.btrim(p_provider_evidence ->> 'observedStatusMessage'), ''
  );
  if v_observed_state is null
    or v_observed_state not in ('accepted', 'failed', 'not_found', 'closed')
  then
    raise exception 'registration_provider_evidence_invalid' using errcode = '22023';
  end if;
  v_canonical_evidence := pg_catalog.jsonb_build_object(
    'providerMessageId', v_provider_message_id,
    'providerGroupId', v_provider_group_id,
    'lookupRequestKey', v_lookup_request_key,
    'observedState', v_observed_state,
    'observedStatusCode', v_observed_status_code,
    'observedStatusMessage', v_observed_status_message
  );

  select message.task_id
  into v_task_id
  from public.ops_registration_messages message
  where message.id = p_message_id
    and message.template_key = 'admission_application';
  if v_task_id is null then
    raise exception 'registration_message_not_found' using errcode = 'P0002';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'messageId', p_message_id,
    'resolution', v_resolution,
    'providerEvidence', v_canonical_evidence,
    'reason', v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- admission_reconcile_task_lock
  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- admission_reconcile_detail_lock
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- admission_reconcile_message_lock
  select message.*
  into v_message
  from public.ops_registration_messages message
  where message.id = p_message_id
    and message.task_id = v_task_id
    and message.template_key = 'admission_application'
  for update;
  if not found then
    raise exception 'registration_message_not_found' using errcode = 'P0002';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, null, 'reconcile_admission_message'
  );

  -- admission_reconcile_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'reconcile_admission_message'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- admission_reconcile_mutable_state_check
  if v_provider_message_id is null
    and v_provider_group_id is null
    and v_lookup_request_key is distinct from v_message.request_key
  then
    raise exception 'registration_provider_lookup_identity_required' using errcode = '22023';
  end if;
  if v_message.status = 'pending' then
    raise exception 'registration_message_provider_check_required' using errcode = '40001';
  end if;
  if v_resolution = 'accepted' then
    if v_observed_state <> 'accepted'
      or (
        v_provider_message_id is null
        and v_provider_group_id is null
      )
    then
      raise exception 'registration_provider_acceptance_evidence_required' using errcode = '22023';
    end if;
    if not (
      (v_message.status = 'unknown' and v_message.claim_active)
      or (
        v_message.status = 'failed'
        and v_message.claim_active
        and v_resolution = 'accepted'
      )
    ) then
      raise exception 'registration_message_reconciliation_invalid_state' using errcode = '40001';
    end if;
  elsif v_resolution = 'failed' then
    if v_observed_state not in ('failed', 'not_found', 'closed') then
      raise exception 'registration_provider_failure_evidence_required' using errcode = '22023';
    end if;
    if not (
      v_message.status = 'unknown'
      and v_message.claim_active
      and v_resolution in ('accepted', 'failed')
    ) then
      raise exception 'registration_message_reconciliation_invalid_state' using errcode = '40001';
    end if;
  end if;

  v_previous_status := v_message.status;
  v_previous_claim_active := v_message.claim_active;
  update public.ops_registration_messages
  set
    status = v_resolution,
    claim_active = true,
    provider_message_id = coalesce(v_provider_message_id, provider_message_id),
    provider_group_id = coalesce(v_provider_group_id, provider_group_id),
    provider_status_code = coalesce(v_observed_status_code, provider_status_code),
    provider_status_message = coalesce(
      v_observed_status_message, provider_status_message
    ),
    error_message = case when v_resolution = 'accepted' then null else error_message end,
    updated_at = pg_catalog.now()
  where id = p_message_id
    and status = v_previous_status
    and claim_active = v_previous_claim_active
  returning * into v_message;
  if not found then
    raise exception 'registration_message_state_conflict' using errcode = '40001';
  end if;

  -- admission_reconcile_event
  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value, created_at
  ) values (
    v_task_id,
    v_actor_id,
    'registration_admission_message_reconciled',
    'registration_admission_message:' || p_message_id::text,
    null,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'eventType', 'registration_admission_message_reconciled',
      'actorId', v_actor_id,
      'messageId', p_message_id,
      'previousStatus', v_previous_status,
      'previousClaimActive', v_previous_claim_active,
      'nextStatus', v_message.status,
      'nextClaimActive', v_message.claim_active,
      'observedState', v_observed_state,
      'hasProviderIdentity',
        v_provider_message_id is not null or v_provider_group_id is not null,
      'reason', v_reason,
      'occurredAt', v_occurred_at
    )::text,
    v_occurred_at
  );

  -- admission_reconcile_response
  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'messageId', v_message.id,
    'messageRequestKey', v_message.request_key,
    'previousStatus', v_previous_status,
    'previousClaimActive', v_previous_claim_active,
    'nextStatus', v_message.status,
    'claimActive', v_message.claim_active,
    'requiresAdmissionMark', v_message.status = 'accepted',
    'requiresRetryRelease', v_message.status = 'failed'
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'reconcile_admission_message',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.reconcile_registration_admission_message_impl(uuid, text, jsonb, text, text)
  owner to postgres;
revoke execute on function dashboard_private.reconcile_registration_admission_message_impl(uuid, text, jsonb, text, text) from public, anon;
grant execute on function dashboard_private.reconcile_registration_admission_message_impl(uuid, text, jsonb, text, text) to authenticated;

create function public.reconcile_registration_admission_message(
  p_message_id uuid,
  p_resolution text,
  p_provider_evidence jsonb,
  p_reason text,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.reconcile_registration_admission_message_impl(
    p_message_id, p_resolution, p_provider_evidence, p_reason, p_request_key
  );
$$;

revoke execute on function public.reconcile_registration_admission_message(uuid, text, jsonb, text, text) from public, anon;
grant execute on function public.reconcile_registration_admission_message(uuid, text, jsonb, text, text) to authenticated;

create function dashboard_private.release_registration_admission_message_retry_impl(
  p_message_id uuid,
  p_provider_evidence jsonb,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_provider_message_id text;
  v_provider_group_id text;
  v_lookup_request_key text;
  v_observed_state text;
  v_observed_status_code text;
  v_observed_status_message text;
  v_canonical_evidence jsonb;
  v_task_id uuid;
  v_message public.ops_registration_messages%rowtype;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_occurred_at timestamptz := pg_catalog.now();
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if p_message_id is null then
    raise exception 'registration_message_not_found' using errcode = 'P0002';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'registration_retry_release_reason_required' using errcode = '22023';
  end if;
  if p_provider_evidence is null
    or pg_catalog.jsonb_typeof(p_provider_evidence) <> 'object'
  then
    raise exception 'registration_provider_evidence_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_provider_evidence) supplied(key)
    where supplied.key not in (
      'providerMessageId', 'providerGroupId', 'lookupRequestKey',
      'observedState', 'observedStatusCode', 'observedStatusMessage'
    )
  ) or exists (
    select 1
    from pg_catalog.jsonb_each(p_provider_evidence) supplied(key, value)
    where supplied.value <> 'null'::jsonb
      and pg_catalog.jsonb_typeof(supplied.value) <> 'string'
  ) then
    raise exception 'registration_provider_evidence_invalid' using errcode = '22023';
  end if;

  v_provider_message_id := nullif(
    pg_catalog.btrim(p_provider_evidence ->> 'providerMessageId'), ''
  );
  v_provider_group_id := nullif(
    pg_catalog.btrim(p_provider_evidence ->> 'providerGroupId'), ''
  );
  v_lookup_request_key := nullif(
    pg_catalog.btrim(p_provider_evidence ->> 'lookupRequestKey'), ''
  );
  v_observed_state := pg_catalog.lower(nullif(
    pg_catalog.btrim(p_provider_evidence ->> 'observedState'), ''
  ));
  v_observed_status_code := nullif(
    pg_catalog.btrim(p_provider_evidence ->> 'observedStatusCode'), ''
  );
  v_observed_status_message := nullif(
    pg_catalog.btrim(p_provider_evidence ->> 'observedStatusMessage'), ''
  );
  if v_observed_state is null
    or v_observed_state not in ('accepted', 'failed', 'not_found', 'closed')
  then
    raise exception 'registration_provider_evidence_invalid' using errcode = '22023';
  end if;
  if v_observed_state not in ('failed', 'not_found', 'closed') then
    raise exception 'registration_provider_failure_evidence_required' using errcode = '22023';
  end if;
  v_canonical_evidence := pg_catalog.jsonb_build_object(
    'providerMessageId', v_provider_message_id,
    'providerGroupId', v_provider_group_id,
    'lookupRequestKey', v_lookup_request_key,
    'observedState', v_observed_state,
    'observedStatusCode', v_observed_status_code,
    'observedStatusMessage', v_observed_status_message
  );

  select message.task_id
  into v_task_id
  from public.ops_registration_messages message
  where message.id = p_message_id
    and message.template_key = 'admission_application';
  if v_task_id is null then
    raise exception 'registration_message_not_found' using errcode = 'P0002';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'messageId', p_message_id,
    'providerEvidence', v_canonical_evidence,
    'reason', v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- admission_release_task_lock
  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- admission_release_detail_lock
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- admission_release_message_lock
  select message.*
  into v_message
  from public.ops_registration_messages message
  where message.id = p_message_id
    and message.task_id = v_task_id
    and message.template_key = 'admission_application'
  for update;
  if not found then
    raise exception 'registration_message_not_found' using errcode = 'P0002';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, null, 'release_admission_message_retry'
  );

  -- admission_release_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'release_admission_message_retry'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- admission_release_mutable_state_check
  if v_provider_message_id is null
    and v_provider_group_id is null
    and v_lookup_request_key is distinct from v_message.request_key
  then
    raise exception 'registration_provider_lookup_identity_required' using errcode = '22023';
  end if;
  if v_message.status <> 'failed' or not v_message.claim_active then
    raise exception 'registration_message_retry_release_invalid_state' using errcode = '40001';
  end if;
  if v_message.updated_at > pg_catalog.now() - interval '15 minutes' then
    raise exception 'registration_message_retry_release_too_early' using errcode = '40001';
  end if;

  -- admission_release_claim_update
  update public.ops_registration_messages
  set
    claim_active = false,
    updated_at = pg_catalog.now()
  where id = p_message_id
    and status = 'failed'
    and claim_active
  returning * into v_message;
  if not found then
    raise exception 'registration_message_state_conflict' using errcode = '40001';
  end if;

  -- admission_release_event
  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value, created_at
  ) values (
    v_task_id,
    v_actor_id,
    'registration_admission_message_retry_released',
    'registration_admission_message:' || p_message_id::text,
    null,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'eventType', 'registration_admission_message_retry_released',
      'actorId', v_actor_id,
      'messageId', p_message_id,
      'status', 'failed',
      'previousClaimActive', true,
      'nextClaimActive', false,
      'observedState', v_observed_state,
      'hasProviderIdentity',
        v_provider_message_id is not null or v_provider_group_id is not null,
      'reason', v_reason,
      'occurredAt', v_occurred_at
    )::text,
    v_occurred_at
  );

  -- admission_release_response
  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'messageId', v_message.id,
    'messageRequestKey', v_message.request_key,
    'status', v_message.status,
    'claimActive', v_message.claim_active,
    'retryRequiresNewMessageKey', true
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'release_admission_message_retry',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.release_registration_admission_message_retry_impl(uuid, jsonb, text, text)
  owner to postgres;
revoke execute on function dashboard_private.release_registration_admission_message_retry_impl(uuid, jsonb, text, text) from public, anon;
grant execute on function dashboard_private.release_registration_admission_message_retry_impl(uuid, jsonb, text, text) to authenticated;

create function public.release_registration_admission_message_retry(
  p_message_id uuid,
  p_provider_evidence jsonb,
  p_reason text,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.release_registration_admission_message_retry_impl(
    p_message_id, p_provider_evidence, p_reason, p_request_key
  );
$$;

revoke execute on function public.release_registration_admission_message_retry(uuid, jsonb, text, text) from public, anon;
grant execute on function public.release_registration_admission_message_retry(uuid, jsonb, text, text) to authenticated;

create function dashboard_private.mark_registration_admission_notice_sent_impl(
  p_task_id uuid,
  p_message_request_key text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_message_request_key text := nullif(pg_catalog.btrim(p_message_request_key), '');
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_detail public.ops_registration_details%rowtype;
  v_message public.ops_registration_messages%rowtype;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_occurred_at timestamptz := pg_catalog.now();
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if p_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_message_request_key is null then
    raise exception 'message_request_key_required' using errcode = '22023';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'messageRequestKey', v_message_request_key
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- admission_mark_task_lock
  perform 1
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- admission_mark_detail_lock
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- admission_mark_message_lock
  select message.*
  into v_message
  from public.ops_registration_messages message
  where message.task_id = p_task_id
    and message.template_key = 'admission_application'
    and message.request_key = v_message_request_key
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'mark_admission_notice'
  );

  -- admission_mark_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'mark_admission_notice'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- admission_mark_mutable_state_check
  if v_message.id is null
    or v_message.template_key <> 'admission_application'
    or v_message.status <> 'accepted'
  then
    raise exception 'registration_admission_message_not_accepted' using errcode = '40001';
  end if;

  -- admission_mark_task_level_guard
  if v_detail.admission_notice_sent then
    v_response := pg_catalog.jsonb_build_object(
      'taskId', p_task_id,
      'messageId', v_message.id,
      'messageRequestKey', v_message.request_key,
      'admissionNoticeSent', true,
      'applied', false
    );
    insert into dashboard_private.ops_registration_mutations(
      actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
    ) values (
      v_actor_id, v_request_key, p_task_id, 'mark_admission_notice',
      v_target_fingerprint, v_response
    );
    return v_response;
  end if;

  -- admission_mark_flag_update
  update public.ops_registration_details
  set
    admission_notice_sent = true,
    updated_at = pg_catalog.now()
  where task_id = p_task_id
    and not admission_notice_sent;
  if not found then
    raise exception 'registration_admission_notice_state_conflict' using errcode = '40001';
  end if;

  -- admission_mark_event
  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value, created_at
  ) values (
    p_task_id,
    v_actor_id,
    'customer_message_sent',
    'admission_application',
    null,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'eventType', 'customer_message_sent',
      'actorId', v_actor_id,
      'messageId', v_message.id,
      'templateKey', 'admission_application',
      'admissionNoticeSent', true,
      'occurredAt', v_occurred_at
    )::text,
    v_occurred_at
  );

  v_response := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'messageId', v_message.id,
    'messageRequestKey', v_message.request_key,
    'admissionNoticeSent', true,
    'applied', true
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, p_task_id, 'mark_admission_notice',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.mark_registration_admission_notice_sent_impl(uuid, text, text)
  owner to postgres;
revoke execute on function dashboard_private.mark_registration_admission_notice_sent_impl(uuid, text, text) from public, anon;
grant execute on function dashboard_private.mark_registration_admission_notice_sent_impl(uuid, text, text) to authenticated;

create function public.mark_registration_admission_notice_sent(
  p_task_id uuid,
  p_message_request_key text,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.mark_registration_admission_notice_sent_impl(
    p_task_id, p_message_request_key, p_request_key
  );
$$;

revoke execute on function public.mark_registration_admission_notice_sent(uuid, text, text) from public, anon;
grant execute on function public.mark_registration_admission_notice_sent(uuid, text, text) to authenticated;

create function dashboard_private.start_registration_admission_batch_impl(
  p_task_id uuid,
  p_track_ids uuid[],
  p_enrollment_ids uuid[],
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_track_ids uuid[];
  v_enrollment_ids uuid[];
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_student public.students%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_enrollment public.ops_registration_enrollments%rowtype;
  v_class record;
  v_session jsonb;
  v_name_key text;
  v_parent_phone_key text;
  v_student_id uuid;
  v_track_id uuid;
  v_match_count integer;
  v_selected_count integer;
  v_revision_number integer;
  v_batch_id uuid;
  v_source_status text;
  v_unique_constraint text;
  v_rows_response jsonb;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null or p_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(coalesce(p_track_ids, array[]::uuid[])) track_id
    where track_id is null
  ) or exists (
    select 1
    from pg_catalog.unnest(coalesce(p_enrollment_ids, array[]::uuid[])) enrollment_id
    where enrollment_id is null
  ) then
    raise exception 'registration_admission_batch_selection_invalid' using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct track_id order by track_id),
    array[]::uuid[]
  )
  into v_track_ids
  from pg_catalog.unnest(coalesce(p_track_ids, array[]::uuid[])) track_id;
  select coalesce(
    pg_catalog.array_agg(distinct enrollment_id order by enrollment_id),
    array[]::uuid[]
  )
  into v_enrollment_ids
  from pg_catalog.unnest(coalesce(p_enrollment_ids, array[]::uuid[])) enrollment_id;
  if pg_catalog.cardinality(v_track_ids) = 0
    or pg_catalog.cardinality(v_enrollment_ids) = 0
  then
    raise exception 'registration_admission_batch_selection_required' using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'trackIds', pg_catalog.to_jsonb(v_track_ids),
    'enrollmentIds', pg_catalog.to_jsonb(v_enrollment_ids)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- admission_batch_task_lock
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- admission_batch_detail_lock
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- admission_batch_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by track.id
  for update;

  -- admission_batch_identity_lock
  v_name_key := pg_catalog.lower(
    pg_catalog.regexp_replace(coalesce(v_task.student_name, ''), '\s+', '', 'g')
  );
  v_parent_phone_key := pg_catalog.regexp_replace(
    coalesce(v_detail.parent_phone, ''), '\D+', '', 'g'
  );
  if v_name_key = '' or v_parent_phone_key = '' then
    raise exception 'registration_student_identity_required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-student:' || v_name_key || ':' || v_parent_phone_key,
      0
    )
  );

  -- admission_batch_student_locks
  perform 1
  from public.students student
  where student.id = v_task.student_id
    or (
      pg_catalog.lower(
        pg_catalog.regexp_replace(coalesce(student.name, ''), '\s+', '', 'g')
      ) = v_name_key
      and pg_catalog.regexp_replace(
        coalesce(student.parent_contact, ''), '\D+', '', 'g'
      ) = v_parent_phone_key
      and (
        nullif(pg_catalog.btrim(v_detail.school_name), '') is null
        or student.school is not distinct from v_detail.school_name
      )
      and (
        nullif(pg_catalog.btrim(v_detail.student_phone), '') is null
        or pg_catalog.regexp_replace(coalesce(student.contact, ''), '\D+', '', 'g')
          = pg_catalog.regexp_replace(v_detail.student_phone, '\D+', '', 'g')
      )
    )
  order by student.id
  for update;

  -- admission_batch_batch_locks
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = p_task_id
  order by batch.id
  for update;

  -- admission_batch_enrollment_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = p_task_id
    or enrollment.id = any(v_enrollment_ids)
  order by enrollment.id
  for update of enrollment;

  -- admission_batch_class_locks
  perform 1
  from public.classes class
  where class.id in (
    select enrollment.class_id
    from public.ops_registration_enrollments enrollment
    where enrollment.id = any(v_enrollment_ids)
  )
  order by class.id
  for update;

  -- admission_batch_textbook_locks
  perform 1
  from public.textbooks textbook
  where textbook.id in (
    select enrollment.textbook_id
    from public.ops_registration_enrollments enrollment
    where enrollment.id = any(v_enrollment_ids)
      and enrollment.textbook_id is not null
  )
  order by textbook.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'start_admission_batch'
  );

  -- admission_batch_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'start_admission_batch'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- admission_batch_mutable_state_check
  if v_detail.admission_notice_sent is not true then
    raise exception 'registration_admission_notice_required' using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.ops_registration_admission_batches batch
    where batch.task_id = p_task_id
      and batch.status not in ('completed', 'canceled')
  ) then
    raise exception 'registration_admission_batch_already_open' using errcode = '40001';
  end if;
  if (
    select pg_catalog.count(*)
    from public.ops_registration_subject_tracks track
    where track.id = any(v_track_ids)
      and track.task_id = p_task_id
  ) <> pg_catalog.cardinality(v_track_ids) then
    raise exception 'registration_admission_batch_track_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.id = any(v_track_ids)
      and track.pipeline_status not in ('enrollment_decided', 'registered')
  ) then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;

  select pg_catalog.count(*)
  into v_selected_count
  from public.ops_registration_enrollments enrollment
  where enrollment.id = any(v_enrollment_ids);
  if v_selected_count <> pg_catalog.cardinality(v_enrollment_ids) then
    raise exception 'registration_admission_batch_enrollment_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.id = any(v_enrollment_ids)
      and (
        enrollment.track_id <> all(v_track_ids)
        or enrollment.status <> 'planned'
        or enrollment.admission_batch_id is not null
        or enrollment.student_id is not null
        or enrollment.roster_active
        or enrollment.roster_released_at is not null
        or enrollment.roster_release_reason is not null
        or enrollment.roster_release_source_task_id is not null
        or enrollment.roster_release_kind is not null
      )
  ) then
    raise exception 'registration_admission_batch_enrollment_invalid' using errcode = '40001';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(v_track_ids) selected(track_id)
    left join public.ops_registration_enrollments enrollment
      on enrollment.track_id = selected.track_id
      and enrollment.id = any(v_enrollment_ids)
    group by selected.track_id
    having pg_catalog.count(enrollment.id) < 1
  ) then
    raise exception 'registration_admission_batch_track_coverage_required' using errcode = '22023';
  end if;

  for v_enrollment in
    select enrollment.*
    from public.ops_registration_enrollments enrollment
    where enrollment.id = any(v_enrollment_ids)
    order by enrollment.id
  loop
    select track.*
    into v_track
    from public.ops_registration_subject_tracks track
    where track.id = v_enrollment.track_id;

    select
      class.id,
      pg_catalog.btrim(class.subject) as subject,
      class.textbook_ids,
      class.student_ids,
      class.waitlist_ids
    into v_class
    from public.classes class
    where class.id = v_enrollment.class_id;
    if not found then
      raise exception 'registration_class_not_found' using errcode = 'P0002';
    end if;
    if v_class.subject is distinct from v_track.subject then
      raise exception 'registration_class_subject_mismatch' using errcode = '23514';
    end if;
    if v_enrollment.textbook_id is not null and not (
      exists (
        select 1
        from public.textbooks textbook
        where textbook.id = v_enrollment.textbook_id
      )
      and pg_catalog.jsonb_typeof(
        coalesce(pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb)
      ) = 'array'
      and coalesce(
        pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb
      ) ? v_enrollment.textbook_id::text
    ) then
      raise exception 'registration_textbook_class_mismatch' using errcode = '23514';
    end if;
    if v_enrollment.class_start_date is null
      or nullif(pg_catalog.btrim(v_enrollment.class_start_session_key), '') is null
      or nullif(pg_catalog.btrim(v_enrollment.class_start_session), '') is null
    then
      raise exception 'registration_enrollment_schedule_incomplete' using errcode = '23514';
    end if;
    v_session := dashboard_private.validate_registration_class_session(
      v_enrollment.class_id,
      v_enrollment.class_start_date,
      v_enrollment.class_start_session_key
    );
    if coalesce((v_session ->> 'valid')::boolean, false) is not true
      or (v_session ->> 'sessionDate')::date is distinct from v_enrollment.class_start_date
      or v_session ->> 'sessionKey' is distinct from v_enrollment.class_start_session_key
      or v_session ->> 'sessionLabel' is distinct from v_enrollment.class_start_session
    then
      raise exception 'registration_class_session_invalid' using errcode = '23514';
    end if;
  end loop;

  if v_task.student_id is not null then
    select student.*
    into v_student
    from public.students student
    where student.id = v_task.student_id;
    if not found
      or pg_catalog.lower(
        pg_catalog.regexp_replace(coalesce(v_student.name, ''), '\s+', '', 'g')
      ) <> v_name_key
      or pg_catalog.regexp_replace(
        coalesce(v_student.parent_contact, ''), '\D+', '', 'g'
      ) <> v_parent_phone_key
      or (
        nullif(pg_catalog.btrim(v_detail.school_name), '') is not null
        and v_student.school is distinct from v_detail.school_name
      )
      or (
        nullif(pg_catalog.btrim(v_detail.student_phone), '') is not null
        and pg_catalog.regexp_replace(coalesce(v_student.contact, ''), '\D+', '', 'g')
          <> pg_catalog.regexp_replace(v_detail.student_phone, '\D+', '', 'g')
      )
    then
      raise exception 'registration_student_identity_mismatch' using errcode = '23514';
    end if;
    v_student_id := v_student.id;
  else
    select
      pg_catalog.count(*),
      (pg_catalog.array_agg(student.id order by student.id))[1]
    into v_match_count, v_student_id
    from public.students student
    where pg_catalog.lower(
        pg_catalog.regexp_replace(coalesce(student.name, ''), '\s+', '', 'g')
      ) = v_name_key
      and pg_catalog.regexp_replace(
        coalesce(student.parent_contact, ''), '\D+', '', 'g'
      ) = v_parent_phone_key
      and (
        nullif(pg_catalog.btrim(v_detail.school_name), '') is null
        or student.school is not distinct from v_detail.school_name
      )
      and (
        nullif(pg_catalog.btrim(v_detail.student_phone), '') is null
        or pg_catalog.regexp_replace(coalesce(student.contact, ''), '\D+', '', 'g')
          = pg_catalog.regexp_replace(v_detail.student_phone, '\D+', '', 'g')
      );
    if v_match_count > 1 then
      raise exception 'registration_student_identity_ambiguous' using errcode = '23514';
    elsif v_match_count = 0 then
      insert into public.students(
        name, grade, school, contact, parent_contact, status,
        class_ids, waitlist_class_ids
      ) values (
        pg_catalog.btrim(v_task.student_name),
        v_detail.school_grade,
        v_detail.school_name,
        nullif(pg_catalog.btrim(v_detail.student_phone), ''),
        pg_catalog.btrim(v_detail.parent_phone),
        '재원',
        '[]'::jsonb,
        '[]'::jsonb
      ) returning * into v_student;
      v_student_id := v_student.id;
    else
      select student.*
      into v_student
      from public.students student
      where student.id = v_student_id;
    end if;

    update public.ops_tasks task
    set student_id = v_student_id
    where task.id = p_task_id;
  end if;
  if v_student.status = '퇴원' then
    raise exception 'registration_student_reactivation_required' using errcode = '40001';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(v_student.class_ids, '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) <> 'array'
  then
    raise exception 'registration_roster_projection_invalid' using errcode = '23514';
  end if;
  for v_enrollment in
    select enrollment.*
    from public.ops_registration_enrollments enrollment
    where enrollment.id = any(v_enrollment_ids)
    order by enrollment.id
  loop
    select class.student_ids, class.waitlist_ids
    into v_class
    from public.classes class
    where class.id = v_enrollment.class_id;
    if pg_catalog.jsonb_typeof(
        coalesce(pg_catalog.to_jsonb(v_class.student_ids), '[]'::jsonb)
      ) <> 'array'
      or pg_catalog.jsonb_typeof(
        coalesce(pg_catalog.to_jsonb(v_class.waitlist_ids), '[]'::jsonb)
      ) <> 'array'
    then
      raise exception 'registration_roster_projection_invalid' using errcode = '23514';
    end if;
    if coalesce(v_student.class_ids, '[]'::jsonb) ? v_enrollment.class_id::text
      or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_enrollment.class_id::text
      or coalesce(pg_catalog.to_jsonb(v_class.student_ids), '[]'::jsonb) ? v_student_id::text
      or coalesce(pg_catalog.to_jsonb(v_class.waitlist_ids), '[]'::jsonb) ? v_student_id::text
    then
      raise exception 'registration_roster_mode_conflict' using errcode = '40001';
    end if;
    if exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.student_id = v_student_id
        and enrollment.class_id = v_enrollment.class_id
        and enrollment.roster_active
    ) then
      raise exception 'registration_student_class_already_active' using errcode = '40001';
    end if;
  end loop;

  select coalesce(max(batch.revision_number), 0) + 1
  into v_revision_number
  from public.ops_registration_admission_batches batch
  where batch.task_id = p_task_id;
  insert into public.ops_registration_admission_batches(
    task_id, revision_number, status
  ) values (
    p_task_id, v_revision_number, 'draft'
  ) returning id into v_batch_id;

  -- verification_checkpoint_admission_batch_before_first_claim
  perform dashboard_private.await_registration_verification_checkpoint(
    'admission_batch_before_first_claim', p_task_id, v_student_id
  );

  begin
    update public.ops_registration_enrollments enrollment
    set
      student_id = v_student_id,
      admission_batch_id = v_batch_id,
      roster_active = true,
      updated_at = pg_catalog.now()
    where enrollment.id = any(v_enrollment_ids)
      and enrollment.status = 'planned'
      and enrollment.admission_batch_id is null
      and enrollment.student_id is null
      and not enrollment.roster_active;
    get diagnostics v_selected_count = row_count;
    if v_selected_count <> pg_catalog.cardinality(v_enrollment_ids) then
      raise exception 'registration_admission_batch_enrollment_invalid' using errcode = '40001';
    end if;
  exception
    when unique_violation then
      get stacked diagnostics v_unique_constraint = constraint_name;
      if v_unique_constraint = 'ops_registration_enrollments_student_class_claim_uidx' then
        raise exception 'registration_student_class_already_active' using errcode = '40001';
      end if;
      raise;
  end;

  foreach v_track_id in array v_track_ids
  loop
    select track.*
    into v_track
    from public.ops_registration_subject_tracks track
    where track.id = v_track_id;
    v_source_status := v_track.pipeline_status;
    perform dashboard_private.transition_registration_track_status(
      v_track.id, 'enrollment_processing', null, null, false
    );
    perform dashboard_private.write_registration_track_event(
      p_task_id,
      v_track.id,
      'admission_batch_started',
      v_source_status,
      'enrollment_processing',
      null,
      pg_catalog.jsonb_build_object(
        'batchId', v_batch_id,
        'revisionNumber', v_revision_number,
        'enrollmentIds', pg_catalog.to_jsonb(v_enrollment_ids)
      )
    );
  end loop;
  perform dashboard_private.recompute_registration_parent(p_task_id);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', enrollment.id,
        'trackId', enrollment.track_id,
        'studentId', enrollment.student_id,
        'admissionBatchId', enrollment.admission_batch_id,
        'classId', enrollment.class_id,
        'textbookId', enrollment.textbook_id,
        'classStartDate', enrollment.class_start_date,
        'classStartSessionKey', enrollment.class_start_session_key,
        'classStartSession', enrollment.class_start_session,
        'status', enrollment.status,
        'makeeduRegistered', enrollment.makeedu_registered,
        'rosterActive', enrollment.roster_active,
        'rosterReleasedAt', enrollment.roster_released_at,
        'rosterReleaseReason', enrollment.roster_release_reason,
        'rosterReleaseSourceTaskId', enrollment.roster_release_source_task_id,
        'rosterReleaseKind', enrollment.roster_release_kind,
        'sortOrder', enrollment.sort_order
      ) order by enrollment.sort_order, enrollment.class_id, enrollment.id
    ),
    '[]'::jsonb
  )
  into v_rows_response
  from public.ops_registration_enrollments enrollment
  where enrollment.id = any(v_enrollment_ids);
  v_response := pg_catalog.jsonb_build_object(
    'batch', pg_catalog.jsonb_build_object(
      'id', v_batch_id,
      'taskId', p_task_id,
      'revisionNumber', v_revision_number,
      'status', 'draft',
      'invoiceSentAt', null,
      'paymentConfirmedAt', null,
      'createdAt', (
        select batch.created_at
        from public.ops_registration_admission_batches batch
        where batch.id = v_batch_id
      ),
      'updatedAt', (
        select batch.updated_at
        from public.ops_registration_admission_batches batch
        where batch.id = v_batch_id
      )
    ),
    'trackIds', pg_catalog.to_jsonb(v_track_ids),
    'enrollments', v_rows_response
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, p_task_id, 'start_admission_batch',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.start_registration_admission_batch_impl(uuid, uuid[], uuid[], text)
  owner to postgres;
revoke execute on function dashboard_private.start_registration_admission_batch_impl(uuid, uuid[], uuid[], text) from public, anon;
grant execute on function dashboard_private.start_registration_admission_batch_impl(uuid, uuid[], uuid[], text) to authenticated;

create function public.start_registration_admission_batch(
  p_task_id uuid,
  p_track_ids uuid[],
  p_enrollment_ids uuid[],
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.start_registration_admission_batch_impl(
    p_task_id, p_track_ids, p_enrollment_ids, p_request_key
  );
$$;

revoke execute on function public.start_registration_admission_batch(uuid, uuid[], uuid[], text) from public, anon;
grant execute on function public.start_registration_admission_batch(uuid, uuid[], uuid[], text) to authenticated;

create function dashboard_private.set_registration_enrollment_makeedu_impl(
  p_enrollment_id uuid,
  p_makeedu_registered boolean,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_task_id uuid;
  v_track_id uuid;
  v_batch_id uuid;
  v_batch public.ops_registration_admission_batches%rowtype;
  v_enrollment public.ops_registration_enrollments%rowtype;
  v_applied boolean := false;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null or p_enrollment_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null or p_makeedu_registered is null then
    raise exception 'registration_makeedu_arguments_invalid' using errcode = '22023';
  end if;

  select track.task_id, enrollment.track_id, enrollment.admission_batch_id
  into v_task_id, v_track_id, v_batch_id
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where enrollment.id = p_enrollment_id;
  if v_task_id is null or v_batch_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'enrollmentId', p_enrollment_id,
    'makeeduRegistered', p_makeedu_registered
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- makeedu_task_lock
  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- makeedu_detail_lock
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- makeedu_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;

  -- makeedu_batch_lock
  select batch.*
  into v_batch
  from public.ops_registration_admission_batches batch
  where batch.id = v_batch_id
    and batch.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_admission_batch_not_found' using errcode = 'P0002';
  end if;

  -- makeedu_enrollment_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  where enrollment.admission_batch_id = v_batch_id
  order by enrollment.id
  for update;
  select enrollment.*
  into v_enrollment
  from public.ops_registration_enrollments enrollment
  where enrollment.id = p_enrollment_id
    and enrollment.admission_batch_id = v_batch_id;
  if not found then
    raise exception 'registration_enrollment_not_found' using errcode = 'P0002';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, v_track_id, 'set_makeedu'
  );

  -- makeedu_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'set_makeedu'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- makeedu_mutable_state_check
  if v_batch.status <> 'draft'
    or v_enrollment.status <> 'planned'
    or v_enrollment.student_id is null
    or not v_enrollment.roster_active
  then
    raise exception 'registration_enrollment_makeedu_not_editable' using errcode = '40001';
  end if;
  if v_enrollment.makeedu_registered is distinct from p_makeedu_registered then
    update public.ops_registration_enrollments enrollment
    set
      makeedu_registered = p_makeedu_registered,
      updated_at = pg_catalog.now()
    where enrollment.id = p_enrollment_id
      and enrollment.admission_batch_id = v_batch_id
      and enrollment.status = 'planned';
    if not found then
      raise exception 'registration_enrollment_makeedu_not_editable' using errcode = '40001';
    end if;
    v_applied := true;
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      v_track_id,
      'registration_enrollment_makeedu_updated',
      'enrollment_processing',
      'enrollment_processing',
      null,
      pg_catalog.jsonb_build_object(
        'batchId', v_batch_id,
        'enrollmentId', p_enrollment_id,
        'makeeduRegistered', p_makeedu_registered
      )
    );
    perform dashboard_private.recompute_registration_parent(v_task_id);
  end if;

  select enrollment.*
  into v_enrollment
  from public.ops_registration_enrollments enrollment
  where enrollment.id = p_enrollment_id;
  v_response := pg_catalog.jsonb_build_object(
    'applied', v_applied,
    'enrollment', pg_catalog.jsonb_build_object(
      'id', v_enrollment.id,
      'trackId', v_enrollment.track_id,
      'studentId', v_enrollment.student_id,
      'admissionBatchId', v_enrollment.admission_batch_id,
      'classId', v_enrollment.class_id,
      'textbookId', v_enrollment.textbook_id,
      'classStartDate', v_enrollment.class_start_date,
      'classStartSessionKey', v_enrollment.class_start_session_key,
      'classStartSession', v_enrollment.class_start_session,
      'status', v_enrollment.status,
      'makeeduRegistered', v_enrollment.makeedu_registered,
      'rosterActive', v_enrollment.roster_active,
      'rosterReleasedAt', v_enrollment.roster_released_at,
      'rosterReleaseReason', v_enrollment.roster_release_reason,
      'rosterReleaseSourceTaskId', v_enrollment.roster_release_source_task_id,
      'rosterReleaseKind', v_enrollment.roster_release_kind,
      'sortOrder', v_enrollment.sort_order
    )
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'set_makeedu',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.set_registration_enrollment_makeedu_impl(uuid, boolean, text)
  owner to postgres;
revoke execute on function dashboard_private.set_registration_enrollment_makeedu_impl(uuid, boolean, text) from public, anon;
grant execute on function dashboard_private.set_registration_enrollment_makeedu_impl(uuid, boolean, text) to authenticated;

create function public.set_registration_enrollment_makeedu(
  p_enrollment_id uuid,
  p_makeedu_registered boolean,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.set_registration_enrollment_makeedu_impl(
    p_enrollment_id, p_makeedu_registered, p_request_key
  );
$$;

revoke execute on function public.set_registration_enrollment_makeedu(uuid, boolean, text) from public, anon;
grant execute on function public.set_registration_enrollment_makeedu(uuid, boolean, text) to authenticated;

create function dashboard_private.advance_registration_admission_batch_impl(
  p_batch_id uuid,
  p_action text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_action text := pg_catalog.lower(nullif(pg_catalog.btrim(p_action), ''));
  v_task_id uuid;
  v_batch public.ops_registration_admission_batches%rowtype;
  v_applied boolean := false;
  v_previous_status text;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null or p_batch_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_action is null
    or v_action not in ('invoice_sent', 'payment_confirmed')
  then
    raise exception 'registration_admission_batch_action_invalid' using errcode = '22023';
  end if;

  select batch.task_id
  into v_task_id
  from public.ops_registration_admission_batches batch
  where batch.id = p_batch_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'batchId', p_batch_id,
    'action', v_action
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- admission_advance_task_lock
  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- admission_advance_detail_lock
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- admission_advance_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;

  -- admission_advance_batch_lock
  select batch.*
  into v_batch
  from public.ops_registration_admission_batches batch
  where batch.id = p_batch_id
    and batch.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_admission_batch_not_found' using errcode = 'P0002';
  end if;

  -- admission_advance_enrollment_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  where enrollment.admission_batch_id = p_batch_id
  order by enrollment.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, null, 'advance_admission_batch'
  );

  -- admission_advance_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'advance_admission_batch'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- admission_advance_mutable_state_check
  v_previous_status := v_batch.status;
  if v_batch.status in ('completed', 'canceled') then
    raise exception 'registration_admission_batch_terminal' using errcode = '40001';
  end if;

  if v_action = 'invoice_sent' then
    if v_batch.status = 'draft' then
      if not exists (
        select 1
        from public.ops_registration_enrollments enrollment
        where enrollment.admission_batch_id = p_batch_id
          and enrollment.status <> 'canceled'
      ) or exists (
        select 1
        from public.ops_registration_enrollments enrollment
        where enrollment.admission_batch_id = p_batch_id
          and enrollment.status <> 'canceled'
          and not enrollment.makeedu_registered
      ) then
        raise exception 'registration_makeedu_incomplete' using errcode = '40001';
      end if;
      update public.ops_registration_admission_batches batch
      set
        status = 'invoiced',
        invoice_sent_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
      where batch.id = p_batch_id
        and batch.status = 'draft';
      if not found then
        raise exception 'registration_admission_batch_state_conflict' using errcode = '40001';
      end if;
      v_applied := true;
    elsif v_batch.status = 'invoiced' then
      v_applied := false;
    else
      raise exception 'registration_admission_batch_out_of_order' using errcode = '40001';
    end if;
  elsif v_action = 'payment_confirmed' then
    if v_batch.status = 'invoiced' then
      if v_batch.invoice_sent_at is null then
        raise exception 'registration_admission_batch_invoice_required' using errcode = '23514';
      end if;
      update public.ops_registration_admission_batches batch
      set
        status = 'paid',
        payment_confirmed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
      where batch.id = p_batch_id
        and batch.status = 'invoiced'
        and batch.invoice_sent_at is not null;
      if not found then
        raise exception 'registration_admission_batch_state_conflict' using errcode = '40001';
      end if;
      v_applied := true;
    elsif v_batch.status = 'paid' then
      v_applied := false;
    else
      raise exception 'registration_admission_batch_out_of_order' using errcode = '40001';
    end if;
  end if;

  select batch.*
  into v_batch
  from public.ops_registration_admission_batches batch
  where batch.id = p_batch_id;
  if v_applied then
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      track.id,
      'admission_batch_advanced',
      v_previous_status,
      v_batch.status,
      null,
      pg_catalog.jsonb_build_object(
        'batchId', p_batch_id,
        'revisionNumber', v_batch.revision_number,
        'action', v_action
      )
    )
    from public.ops_registration_subject_tracks track
    where track.task_id = v_task_id
      and exists (
        select 1
        from public.ops_registration_enrollments enrollment
        where enrollment.admission_batch_id = p_batch_id
          and enrollment.track_id = track.id
      );
    perform dashboard_private.recompute_registration_parent(v_task_id);
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'applied', v_applied,
    'batch', pg_catalog.jsonb_build_object(
      'id', v_batch.id,
      'taskId', v_batch.task_id,
      'revisionNumber', v_batch.revision_number,
      'status', v_batch.status,
      'invoiceSentAt', v_batch.invoice_sent_at,
      'paymentConfirmedAt', v_batch.payment_confirmed_at,
      'createdAt', v_batch.created_at,
      'updatedAt', v_batch.updated_at
    )
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'advance_admission_batch',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.advance_registration_admission_batch_impl(uuid, text, text)
  owner to postgres;
revoke execute on function dashboard_private.advance_registration_admission_batch_impl(uuid, text, text) from public, anon;
grant execute on function dashboard_private.advance_registration_admission_batch_impl(uuid, text, text) to authenticated;

create function public.advance_registration_admission_batch(
  p_batch_id uuid,
  p_action text,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.advance_registration_admission_batch_impl(
    p_batch_id, p_action, p_request_key
  );
$$;

revoke execute on function public.advance_registration_admission_batch(uuid, text, text) from public, anon;
grant execute on function public.advance_registration_admission_batch(uuid, text, text) to authenticated;

create function dashboard_private.cancel_registration_admission_batch_impl(
  p_batch_id uuid,
  p_resolutions jsonb,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_task_id uuid;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_batch public.ops_registration_admission_batches%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_resolution jsonb;
  v_normalized_resolution jsonb;
  v_resolutions jsonb := '[]'::jsonb;
  v_track_id_text text;
  v_destination text;
  v_waiting_kind text;
  v_class_id_text text;
  v_class_id uuid;
  v_name_key text;
  v_parent_phone_key text;
  v_has_historical_enrollment boolean;
  v_resolution_count integer;
  v_selected_count integer;
  v_rows_response jsonb;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null or p_batch_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'registration_cancellation_reason_required' using errcode = '22023';
  end if;
  if p_resolutions is null
    or pg_catalog.jsonb_typeof(p_resolutions) <> 'array'
  then
    raise exception 'registration_admission_resolutions_invalid' using errcode = '22023';
  end if;

  for v_resolution in
    select row.value
    from pg_catalog.jsonb_array_elements(p_resolutions) row(value)
  loop
    if pg_catalog.jsonb_typeof(v_resolution) <> 'object' then
      raise exception 'registration_admission_resolution_key_invalid' using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_resolution) key(value)
      where key.value not in ('trackId', 'destination', 'waitingKind', 'classId')
    ) then
      raise exception 'registration_admission_resolution_key_invalid' using errcode = '22023';
    end if;
    if not (v_resolution ? 'trackId')
      or pg_catalog.jsonb_typeof(v_resolution -> 'trackId') <> 'string'
      or not (v_resolution ? 'destination')
      or pg_catalog.jsonb_typeof(v_resolution -> 'destination') <> 'string'
    then
      raise exception 'registration_admission_resolution_invalid' using errcode = '22023';
    end if;

    v_track_id_text := pg_catalog.lower(pg_catalog.btrim(v_resolution ->> 'trackId'));
    v_destination := pg_catalog.lower(pg_catalog.btrim(v_resolution ->> 'destination'));
    if v_track_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or v_destination not in ('waiting', 'not_registered')
    then
      raise exception 'registration_admission_resolution_invalid' using errcode = '22023';
    end if;

    if not (v_resolution ? 'waitingKind')
      or v_resolution -> 'waitingKind' = 'null'::jsonb
    then
      v_waiting_kind := null;
    elsif pg_catalog.jsonb_typeof(v_resolution -> 'waitingKind') = 'string' then
      v_waiting_kind := pg_catalog.lower(
        nullif(pg_catalog.btrim(v_resolution ->> 'waitingKind'), '')
      );
    else
      raise exception 'registration_admission_resolution_invalid' using errcode = '22023';
    end if;
    if not (v_resolution ? 'classId')
      or v_resolution -> 'classId' = 'null'::jsonb
    then
      v_class_id_text := null;
    elsif pg_catalog.jsonb_typeof(v_resolution -> 'classId') = 'string' then
      v_class_id_text := pg_catalog.lower(
        nullif(pg_catalog.btrim(v_resolution ->> 'classId'), '')
      );
      if v_class_id_text is not null
        and v_class_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then
        raise exception 'registration_admission_resolution_invalid' using errcode = '22023';
      end if;
    else
      raise exception 'registration_admission_resolution_invalid' using errcode = '22023';
    end if;

    if v_destination = 'waiting' then
      if v_waiting_kind not in (
        'current_class', 'current_term_opening', 'next_term_opening'
      ) or (v_waiting_kind = 'current_class') is distinct from (v_class_id_text is not null)
      then
        raise exception 'registration_admission_resolution_invalid' using errcode = '22023';
      end if;
    elsif v_waiting_kind is not null or v_class_id_text is not null then
      raise exception 'registration_admission_resolution_invalid' using errcode = '22023';
    end if;

    v_normalized_resolution := pg_catalog.jsonb_build_object(
      'trackId', v_track_id_text::uuid,
      'destination', v_destination,
      'waitingKind', v_waiting_kind,
      'classId', case when v_class_id_text is null then null else v_class_id_text::uuid end
    );
    v_resolutions := v_resolutions || pg_catalog.jsonb_build_array(v_normalized_resolution);
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_resolutions) row(value)
    group by row.value ->> 'trackId'
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'registration_admission_resolution_duplicate' using errcode = '22023';
  end if;
  select coalesce(
    pg_catalog.jsonb_agg(row.value order by row.value ->> 'trackId'),
    '[]'::jsonb
  )
  into v_resolutions
  from pg_catalog.jsonb_array_elements(v_resolutions) row(value);

  select batch.task_id
  into v_task_id
  from public.ops_registration_admission_batches batch
  where batch.id = p_batch_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'batchId', p_batch_id,
    'resolutions', v_resolutions,
    'reason', v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- admission_cancel_task_lock
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- admission_cancel_detail_lock
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- admission_cancel_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
    or track.id in (
      select enrollment.track_id
      from public.ops_registration_enrollments enrollment
      where enrollment.admission_batch_id = p_batch_id
    )
  order by track.id
  for update;

  -- admission_cancel_identity_lock
  v_name_key := pg_catalog.lower(
    pg_catalog.regexp_replace(coalesce(v_task.student_name, ''), '\s+', '', 'g')
  );
  v_parent_phone_key := pg_catalog.regexp_replace(
    coalesce(v_detail.parent_phone, ''), '\D+', '', 'g'
  );
  if v_name_key = '' or v_parent_phone_key = '' then
    raise exception 'registration_student_identity_required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-student:' || v_name_key || ':' || v_parent_phone_key,
      0
    )
  );

  -- admission_cancel_student_locks
  perform 1
  from public.students student
  where student.id = v_task.student_id
    or exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.admission_batch_id = p_batch_id
        and enrollment.student_id = student.id
    )
  order by student.id
  for update;

  -- admission_cancel_batch_locks
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = v_task_id
  order by batch.id
  for update;
  select batch.*
  into v_batch
  from public.ops_registration_admission_batches batch
  where batch.id = p_batch_id
    and batch.task_id = v_task_id;
  if not found then
    raise exception 'registration_admission_batch_not_found' using errcode = 'P0002';
  end if;

  -- admission_cancel_enrollment_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = v_task_id
    or enrollment.admission_batch_id = p_batch_id
  order by enrollment.id
  for update of enrollment;

  -- admission_cancel_membership_invariant
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
    where enrollment.admission_batch_id = p_batch_id
      and track.task_id is distinct from v_task_id
  ) then
    raise exception 'registration_admission_batch_membership_invariant' using errcode = '23514';
  end if;

  -- admission_cancel_class_locks
  perform 1
  from public.classes class
  where class.id in (
    select enrollment.class_id
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
    where track.task_id = v_task_id
    union
    select (row.value ->> 'classId')::uuid
    from pg_catalog.jsonb_array_elements(v_resolutions) row(value)
    where row.value ->> 'classId' is not null
  )
  order by class.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, null, 'cancel_admission_batch'
  );

  -- admission_cancel_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'cancel_admission_batch'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- admission_cancel_mutable_state_check
  if v_batch.status not in ('draft', 'invoiced') then
    raise exception 'registration_admission_batch_finance_correction_required' using errcode = '40001';
  end if;
  select pg_catalog.count(*)
  into v_selected_count
  from public.ops_registration_enrollments enrollment
  where enrollment.admission_batch_id = p_batch_id;
  if v_selected_count = 0 or exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
      and (
        enrollment.status <> 'planned'
        or not enrollment.roster_active
        or enrollment.student_id is null
      )
  ) then
    raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
  end if;

  update public.ops_registration_enrollments enrollment
  set
    status = 'canceled',
    roster_active = false,
    roster_released_at = null,
    roster_release_reason = null,
    roster_release_source_task_id = null,
    roster_release_kind = null,
    updated_at = pg_catalog.now()
  where enrollment.admission_batch_id = p_batch_id
    and enrollment.status = 'planned'
    and enrollment.roster_active;
  get diagnostics v_resolution_count = row_count;
  if v_resolution_count <> v_selected_count then
    raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
      and (enrollment.status <> 'canceled' or enrollment.roster_active)
  ) then
    raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
  end if;

  update public.ops_registration_admission_batches batch
  set
    status = 'canceled',
    updated_at = pg_catalog.now()
  where batch.id = p_batch_id
    and batch.status in ('draft', 'invoiced');
  if not found then
    raise exception 'registration_admission_batch_state_conflict' using errcode = '40001';
  end if;

  for v_track in
    select track.*
    from public.ops_registration_subject_tracks track
    where exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.admission_batch_id = p_batch_id
        and enrollment.track_id = track.id
    )
    order by track.id
  loop
    select exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.track_id = v_track.id
        and enrollment.status = 'enrolled'
        and enrollment.admission_batch_id is distinct from p_batch_id
    )
    into v_has_historical_enrollment;
    select pg_catalog.count(*)
    into v_resolution_count
    from pg_catalog.jsonb_array_elements(v_resolutions) row(value)
    where (row.value ->> 'trackId')::uuid = v_track.id;
    select row.value
    into v_resolution
    from pg_catalog.jsonb_array_elements(v_resolutions) row(value)
    where (row.value ->> 'trackId')::uuid = v_track.id
    order by row.value ->> 'trackId'
    limit 1;

    if v_has_historical_enrollment then
      if v_resolution_count <> 0 then
        raise exception 'registration_admission_resolution_extra' using errcode = '22023';
      end if;
      perform dashboard_private.transition_registration_track_status(
        v_track.id, 'registered', null, null, false
      );
      perform dashboard_private.write_registration_track_event(
        v_task_id,
        v_track.id,
        'admission_batch_canceled',
        v_track.pipeline_status,
        'registered',
        v_reason,
        pg_catalog.jsonb_build_object(
          'batchId', p_batch_id,
          'restoredHistoricalEnrollment', true
        )
      );
      continue;
    end if;

    if v_resolution_count = 0 then
      raise exception 'registration_admission_resolution_missing' using errcode = '22023';
    elsif v_resolution_count > 1 then
      raise exception 'registration_admission_resolution_duplicate' using errcode = '22023';
    end if;
    v_destination := v_resolution ->> 'destination';
    v_waiting_kind := nullif(v_resolution ->> 'waitingKind', '');
    v_class_id := nullif(v_resolution ->> 'classId', '')::uuid;

    if v_destination = 'waiting' and v_waiting_kind = 'current_class' then
      if not exists (
        select 1
        from public.classes class
        where class.id = v_class_id
          and pg_catalog.btrim(class.subject) = v_track.subject
      ) then
        raise exception 'registration_class_subject_mismatch' using errcode = '23514';
      end if;
    end if;

    -- admission_cancel_other_drafts
    update public.ops_registration_enrollments enrollment
    set
      status = 'canceled',
      roster_active = false,
      roster_released_at = null,
      roster_release_reason = null,
      roster_release_source_task_id = null,
      roster_release_kind = null,
      updated_at = pg_catalog.now()
    where enrollment.track_id = v_track.id
      and enrollment.status = 'planned'
      and enrollment.admission_batch_id is null
      and not enrollment.roster_active;

    if v_destination = 'waiting' and v_waiting_kind = 'current_class' then
      perform dashboard_private.apply_registration_current_class_wait(
        v_task_id, v_track.id, v_class_id, v_actor_id
      );
    end if;
    perform dashboard_private.transition_registration_track_status(
      v_track.id,
      v_destination,
      case when v_destination = 'waiting' then v_waiting_kind else null end,
      null,
      false
    );
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      v_track.id,
      'admission_batch_canceled',
      v_track.pipeline_status,
      v_destination,
      v_reason,
      pg_catalog.jsonb_build_object(
        'batchId', p_batch_id,
        'waitingKind', case when v_destination = 'waiting' then v_waiting_kind else null end,
        'classId', case
          when v_destination = 'waiting' and v_waiting_kind = 'current_class' then v_class_id
          else null
        end,
        'restoredHistoricalEnrollment', false
      )
    );
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_resolutions) row(value)
    where not exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.admission_batch_id = p_batch_id
        and enrollment.track_id = (row.value ->> 'trackId')::uuid
    )
  ) then
    raise exception 'registration_admission_resolution_extra' using errcode = '22023';
  end if;
  perform dashboard_private.recompute_registration_parent(v_task_id);

  select batch.*
  into v_batch
  from public.ops_registration_admission_batches batch
  where batch.id = p_batch_id;
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', enrollment.id,
        'trackId', enrollment.track_id,
        'studentId', enrollment.student_id,
        'admissionBatchId', enrollment.admission_batch_id,
        'classId', enrollment.class_id,
        'textbookId', enrollment.textbook_id,
        'classStartDate', enrollment.class_start_date,
        'classStartSessionKey', enrollment.class_start_session_key,
        'classStartSession', enrollment.class_start_session,
        'status', enrollment.status,
        'makeeduRegistered', enrollment.makeedu_registered,
        'rosterActive', enrollment.roster_active,
        'rosterReleasedAt', enrollment.roster_released_at,
        'rosterReleaseReason', enrollment.roster_release_reason,
        'rosterReleaseSourceTaskId', enrollment.roster_release_source_task_id,
        'rosterReleaseKind', enrollment.roster_release_kind,
        'sortOrder', enrollment.sort_order
      ) order by enrollment.sort_order, enrollment.class_id, enrollment.id
    ),
    '[]'::jsonb
  )
  into v_rows_response
  from public.ops_registration_enrollments enrollment
  where enrollment.admission_batch_id = p_batch_id;
  v_response := pg_catalog.jsonb_build_object(
    'batch', pg_catalog.jsonb_build_object(
      'id', v_batch.id,
      'taskId', v_batch.task_id,
      'revisionNumber', v_batch.revision_number,
      'status', v_batch.status,
      'invoiceSentAt', v_batch.invoice_sent_at,
      'paymentConfirmedAt', v_batch.payment_confirmed_at,
      'createdAt', v_batch.created_at,
      'updatedAt', v_batch.updated_at
    ),
    'enrollments', v_rows_response
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'cancel_admission_batch',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.cancel_registration_admission_batch_impl(uuid, jsonb, text, text)
  owner to postgres;
revoke execute on function dashboard_private.cancel_registration_admission_batch_impl(uuid, jsonb, text, text) from public, anon;
grant execute on function dashboard_private.cancel_registration_admission_batch_impl(uuid, jsonb, text, text) to authenticated;

create function public.cancel_registration_admission_batch(
  p_batch_id uuid,
  p_resolutions jsonb,
  p_reason text,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.cancel_registration_admission_batch_impl(
    p_batch_id, p_resolutions, p_reason, p_request_key
  );
$$;

revoke execute on function public.cancel_registration_admission_batch(uuid, jsonb, text, text) from public, anon;
grant execute on function public.cancel_registration_admission_batch(uuid, jsonb, text, text) to authenticated;

create function dashboard_private.complete_registration_admission_batch_impl(
  p_batch_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_task_id uuid;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_batch public.ops_registration_admission_batches%rowtype;
  v_student public.students%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_enrollment public.ops_registration_enrollments%rowtype;
  v_class record;
  v_session jsonb;
  v_name_key text;
  v_parent_phone_key text;
  v_claim_count integer;
  v_claim_id uuid;
  v_row_count integer;
  v_track_id uuid;
  v_rows_response jsonb;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null or p_batch_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;

  select batch.task_id
  into v_task_id
  from public.ops_registration_admission_batches batch
  where batch.id = p_batch_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'batchId', p_batch_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- admission_complete_task_lock
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- admission_complete_detail_lock
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- admission_complete_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
    or track.id in (
      select enrollment.track_id
      from public.ops_registration_enrollments enrollment
      where enrollment.admission_batch_id = p_batch_id
    )
  order by track.id
  for update;

  -- admission_complete_identity_lock
  v_name_key := pg_catalog.lower(
    pg_catalog.regexp_replace(coalesce(v_task.student_name, ''), '\s+', '', 'g')
  );
  v_parent_phone_key := pg_catalog.regexp_replace(
    coalesce(v_detail.parent_phone, ''), '\D+', '', 'g'
  );
  if v_name_key = '' or v_parent_phone_key = '' or v_task.student_id is null then
    raise exception 'registration_student_identity_required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-student:' || v_name_key || ':' || v_parent_phone_key,
      0
    )
  );

  -- admission_complete_student_locks
  perform 1
  from public.students student
  where student.id = v_task.student_id
    or exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.admission_batch_id = p_batch_id
        and enrollment.student_id = student.id
    )
  order by student.id
  for update;
  select student.*
  into v_student
  from public.students student
  where student.id = v_task.student_id;

  -- admission_complete_batch_locks
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = v_task_id
  order by batch.id
  for update;
  select batch.*
  into v_batch
  from public.ops_registration_admission_batches batch
  where batch.id = p_batch_id
    and batch.task_id = v_task_id;
  if not found then
    raise exception 'registration_admission_batch_not_found' using errcode = 'P0002';
  end if;

  -- admission_complete_enrollment_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = v_task_id
    or enrollment.admission_batch_id = p_batch_id
  order by enrollment.id
  for update of enrollment;

  -- admission_complete_membership_invariant
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
    where enrollment.admission_batch_id = p_batch_id
      and track.task_id is distinct from v_task_id
  ) then
    raise exception 'registration_admission_batch_membership_invariant' using errcode = '23514';
  end if;

  -- admission_complete_class_locks
  perform 1
  from public.classes class
  where class.id in (
    select enrollment.class_id
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
  )
  order by class.id
  for update;

  -- admission_complete_textbook_locks
  perform 1
  from public.textbooks textbook
  where textbook.id in (
    select enrollment.textbook_id
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
      and enrollment.textbook_id is not null
  )
  order by textbook.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, null, 'complete_admission_batch'
  );

  -- admission_complete_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'complete_admission_batch'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- admission_complete_mutable_state_check
  if v_batch.status <> 'paid' then
    raise exception 'registration_admission_batch_not_paid' using errcode = '40001';
  end if;
  if v_batch.invoice_sent_at is null
    or v_batch.payment_confirmed_at is null
  then
    raise exception 'registration_admission_batch_finance_invariant' using errcode = '23514';
  end if;
  if v_student.id is null
    or pg_catalog.lower(
      pg_catalog.regexp_replace(coalesce(v_student.name, ''), '\s+', '', 'g')
    ) <> v_name_key
    or pg_catalog.regexp_replace(
      coalesce(v_student.parent_contact, ''), '\D+', '', 'g'
    ) <> v_parent_phone_key
    or (
      nullif(pg_catalog.btrim(v_detail.school_name), '') is not null
      and v_student.school is distinct from v_detail.school_name
    )
    or (
      nullif(pg_catalog.btrim(v_detail.student_phone), '') is not null
      and pg_catalog.regexp_replace(coalesce(v_student.contact, ''), '\D+', '', 'g')
        <> pg_catalog.regexp_replace(v_detail.student_phone, '\D+', '', 'g')
    )
  then
    raise exception 'registration_student_identity_mismatch' using errcode = '23514';
  end if;
  if v_student.status = '퇴원' then
    raise exception 'registration_student_reactivation_required' using errcode = '40001';
  end if;

  select pg_catalog.count(*)
  into v_row_count
  from public.ops_registration_enrollments enrollment
  where enrollment.admission_batch_id = p_batch_id;
  if v_row_count = 0 or exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
      and (
        enrollment.status <> 'planned'
        or not enrollment.roster_active
        or enrollment.student_id is distinct from v_student.id
        or not enrollment.makeedu_registered
      )
  ) then
    raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
  end if;

  for v_enrollment in
    select enrollment.*
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
    order by enrollment.class_id, enrollment.id
  loop
    select track.*
    into v_track
    from public.ops_registration_subject_tracks track
    where track.id = v_enrollment.track_id;
    if v_track.pipeline_status <> 'enrollment_processing' then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;

    select
      class.id,
      pg_catalog.btrim(class.subject) as subject,
      class.textbook_ids,
      class.student_ids,
      class.waitlist_ids
    into v_class
    from public.classes class
    where class.id = v_enrollment.class_id;
    if not found then
      raise exception 'registration_class_not_found' using errcode = 'P0002';
    end if;
    if v_class.subject is distinct from v_track.subject then
      raise exception 'registration_class_subject_mismatch' using errcode = '23514';
    end if;
    if exists (
      select 1
      from public.ops_registration_enrollments other
      where other.track_id = v_enrollment.track_id
        and other.class_id = v_enrollment.class_id
        and other.id <> v_enrollment.id
        and (other.status = 'planned' or other.roster_active)
    ) then
      raise exception 'registration_enrollment_class_conflict' using errcode = '40001';
    end if;
    if v_enrollment.textbook_id is not null and not (
      exists (
        select 1
        from public.textbooks textbook
        where textbook.id = v_enrollment.textbook_id
      )
      and pg_catalog.jsonb_typeof(
        coalesce(pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb)
      ) = 'array'
      and coalesce(
        pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb
      ) ? v_enrollment.textbook_id::text
    ) then
      raise exception 'registration_textbook_class_mismatch' using errcode = '23514';
    end if;
    if v_enrollment.class_start_date is null
      or nullif(pg_catalog.btrim(v_enrollment.class_start_session_key), '') is null
      or nullif(pg_catalog.btrim(v_enrollment.class_start_session), '') is null
    then
      raise exception 'registration_enrollment_schedule_incomplete' using errcode = '23514';
    end if;
    v_session := dashboard_private.validate_registration_class_session(
      v_enrollment.class_id,
      v_enrollment.class_start_date,
      v_enrollment.class_start_session_key
    );
    if coalesce((v_session ->> 'valid')::boolean, false) is not true
      or (v_session ->> 'sessionDate')::date is distinct from v_enrollment.class_start_date
      or v_session ->> 'sessionKey' is distinct from v_enrollment.class_start_session_key
      or v_session ->> 'sessionLabel' is distinct from v_enrollment.class_start_session
    then
      raise exception 'registration_class_session_invalid' using errcode = '23514';
    end if;

    select
      pg_catalog.count(*),
      (pg_catalog.array_agg(claim.id order by claim.id))[1]
    into v_claim_count, v_claim_id
    from public.ops_registration_enrollments claim
    where claim.student_id = v_student.id
      and claim.class_id = v_enrollment.class_id
      and claim.roster_active;
    if v_claim_count <> 1 or v_claim_id is distinct from v_enrollment.id then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;

    if pg_catalog.jsonb_typeof(coalesce(v_student.class_ids, '[]'::jsonb)) <> 'array'
      or pg_catalog.jsonb_typeof(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) <> 'array'
      or pg_catalog.jsonb_typeof(
        coalesce(pg_catalog.to_jsonb(v_class.student_ids), '[]'::jsonb)
      ) <> 'array'
      or pg_catalog.jsonb_typeof(
        coalesce(pg_catalog.to_jsonb(v_class.waitlist_ids), '[]'::jsonb)
      ) <> 'array'
    then
      raise exception 'registration_roster_projection_invalid' using errcode = '23514';
    end if;
    if coalesce(v_student.class_ids, '[]'::jsonb) ? v_enrollment.class_id::text
      or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_enrollment.class_id::text
      or coalesce(pg_catalog.to_jsonb(v_class.student_ids), '[]'::jsonb) ? v_student.id::text
      or coalesce(pg_catalog.to_jsonb(v_class.waitlist_ids), '[]'::jsonb) ? v_student.id::text
    then
      raise exception 'registration_roster_mode_conflict' using errcode = '40001';
    end if;
  end loop;

  for v_enrollment in
    select enrollment.*
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
    order by enrollment.class_id, enrollment.id
  loop
    perform dashboard_private.apply_student_class_roster_mode(
      v_enrollment.student_id,
      v_enrollment.class_id,
      'enrolled',
      'removed',
      v_enrollment.id,
      'registration_admission_batch_completed',
      v_actor_id
    );
  end loop;

  update public.ops_registration_enrollments enrollment
  set
    status = 'enrolled',
    roster_active = true,
    updated_at = pg_catalog.now()
  where enrollment.admission_batch_id = p_batch_id
    and enrollment.status = 'planned'
    and enrollment.roster_active;
  get diagnostics v_claim_count = row_count;
  if v_claim_count <> v_row_count then
    raise exception 'registration_admission_batch_claim_invariant' using errcode = '23514';
  end if;

  for v_track_id in
    select distinct enrollment.track_id
    from public.ops_registration_enrollments enrollment
    where enrollment.admission_batch_id = p_batch_id
    order by enrollment.track_id
  loop
    perform dashboard_private.transition_registration_track_status(
      v_track_id, 'registered', null, null, false
    );
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      v_track_id,
      'admission_batch_completed',
      'enrollment_processing',
      'registered',
      null,
      pg_catalog.jsonb_build_object('batchId', p_batch_id)
    );
  end loop;
  update public.ops_registration_admission_batches batch
  set
    status = 'completed',
    updated_at = pg_catalog.now()
  where batch.id = p_batch_id
    and batch.status = 'paid'
    and batch.invoice_sent_at is not null
    and batch.payment_confirmed_at is not null;
  if not found then
    raise exception 'registration_admission_batch_state_conflict' using errcode = '40001';
  end if;
  perform dashboard_private.recompute_registration_parent(v_task_id);

  select batch.*
  into v_batch
  from public.ops_registration_admission_batches batch
  where batch.id = p_batch_id;
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', enrollment.id,
        'trackId', enrollment.track_id,
        'studentId', enrollment.student_id,
        'admissionBatchId', enrollment.admission_batch_id,
        'classId', enrollment.class_id,
        'textbookId', enrollment.textbook_id,
        'classStartDate', enrollment.class_start_date,
        'classStartSessionKey', enrollment.class_start_session_key,
        'classStartSession', enrollment.class_start_session,
        'status', enrollment.status,
        'makeeduRegistered', enrollment.makeedu_registered,
        'rosterActive', enrollment.roster_active,
        'rosterReleasedAt', enrollment.roster_released_at,
        'rosterReleaseReason', enrollment.roster_release_reason,
        'rosterReleaseSourceTaskId', enrollment.roster_release_source_task_id,
        'rosterReleaseKind', enrollment.roster_release_kind,
        'sortOrder', enrollment.sort_order
      ) order by enrollment.sort_order, enrollment.class_id, enrollment.id
    ),
    '[]'::jsonb
  )
  into v_rows_response
  from public.ops_registration_enrollments enrollment
  where enrollment.admission_batch_id = p_batch_id;
  v_response := pg_catalog.jsonb_build_object(
    'batch', pg_catalog.jsonb_build_object(
      'id', v_batch.id,
      'taskId', v_batch.task_id,
      'revisionNumber', v_batch.revision_number,
      'status', v_batch.status,
      'invoiceSentAt', v_batch.invoice_sent_at,
      'paymentConfirmedAt', v_batch.payment_confirmed_at,
      'createdAt', v_batch.created_at,
      'updatedAt', v_batch.updated_at
    ),
    'enrollments', v_rows_response
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'complete_admission_batch',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.complete_registration_admission_batch_impl(uuid, text)
  owner to postgres;
revoke execute on function dashboard_private.complete_registration_admission_batch_impl(uuid, text) from public, anon;
grant execute on function dashboard_private.complete_registration_admission_batch_impl(uuid, text) to authenticated;

create function public.complete_registration_admission_batch(
  p_batch_id uuid,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.complete_registration_admission_batch_impl(
    p_batch_id, p_request_key
  );
$$;

revoke execute on function public.complete_registration_admission_batch(uuid, text) from public, anon;
grant execute on function public.complete_registration_admission_batch(uuid, text) to authenticated;

create function dashboard_private.cancel_registration_enrollment_impl(
  p_enrollment_id uuid,
  p_destination text,
  p_waiting_kind text,
  p_class_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_destination text := pg_catalog.lower(nullif(pg_catalog.btrim(p_destination), ''));
  v_waiting_kind text := pg_catalog.lower(nullif(pg_catalog.btrim(p_waiting_kind), ''));
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_task_id uuid;
  v_track_id uuid;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_enrollment public.ops_registration_enrollments%rowtype;
  v_student public.students%rowtype;
  v_name_key text;
  v_parent_phone_key text;
  v_remaining_live_count integer := 0;
  v_next_status text;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null or p_enrollment_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'registration_cancellation_reason_required' using errcode = '22023';
  end if;
  if v_destination is not null
    and v_destination not in ('enrollment_decided', 'waiting', 'not_registered')
  then
    raise exception 'registration_enrollment_cancellation_destination_invalid' using errcode = '22023';
  end if;

  select track.task_id, enrollment.track_id
  into v_task_id, v_track_id
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where enrollment.id = p_enrollment_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'enrollmentId', p_enrollment_id,
    'destination', v_destination,
    'waitingKind', v_waiting_kind,
    'classId', p_class_id,
    'reason', v_reason
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- enrollment_cancel_task_lock
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- enrollment_cancel_detail_lock
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- enrollment_cancel_track_lock
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_track_id
    and track.task_id = v_task_id;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  select enrollment.*
  into v_enrollment
  from public.ops_registration_enrollments enrollment
  where enrollment.id = p_enrollment_id;
  if not found then
    raise exception 'registration_enrollment_not_found' using errcode = 'P0002';
  end if;

  -- enrollment_cancel_identity_lock
  if v_enrollment.status = 'enrolled' and v_enrollment.roster_active then
    v_name_key := pg_catalog.lower(
      pg_catalog.regexp_replace(coalesce(v_task.student_name, ''), '\s+', '', 'g')
    );
    v_parent_phone_key := pg_catalog.regexp_replace(
      coalesce(v_detail.parent_phone, ''), '\D+', '', 'g'
    );
    if v_name_key = '' or v_parent_phone_key = '' then
      raise exception 'registration_student_identity_required' using errcode = '22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'registration-student:' || v_name_key || ':' || v_parent_phone_key,
        0
      )
    );
  end if;

  -- enrollment_cancel_student_lock
  perform 1
  from public.students student
  where student.id = v_enrollment.student_id
    or student.id = v_task.student_id
  order by student.id
  for update;

  -- enrollment_cancel_batch_locks
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = v_task_id
  order by batch.id
  for update;

  -- enrollment_cancel_enrollment_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  where enrollment.track_id = v_track_id
    or (
      v_enrollment.student_id is not null
      and enrollment.student_id = v_enrollment.student_id
      and enrollment.class_id = v_enrollment.class_id
    )
  order by enrollment.id
  for update;
  select enrollment.*
  into v_enrollment
  from public.ops_registration_enrollments enrollment
  where enrollment.id = p_enrollment_id
    and enrollment.track_id = v_track_id;

  -- enrollment_cancel_class_lock
  perform 1
  from public.classes class
  where class.id = v_enrollment.class_id
    or class.id = p_class_id
  order by class.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, v_track_id, 'cancel_enrollment'
  );

  -- enrollment_cancel_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'cancel_enrollment'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- enrollment_cancel_mutable_state_check
  if v_enrollment.status = 'waitlisted' then
    raise exception 'registration_waiting_transition_required' using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.ops_registration_admission_batches batch
    join public.ops_registration_enrollments enrollment
      on enrollment.admission_batch_id = batch.id
    where enrollment.track_id = v_track_id
      and batch.status not in ('completed', 'canceled')
  ) then
    raise exception 'registration_open_admission_batch' using errcode = '40001';
  end if;

  if v_enrollment.status = 'planned' then
    if v_enrollment.admission_batch_id is not null
      or v_enrollment.student_id is not null
      or v_enrollment.roster_active
      or v_destination is not null
      or v_waiting_kind is not null
      or p_class_id is not null
    then
      raise exception 'registration_enrollment_not_cancelable' using errcode = '40001';
    end if;
    update public.ops_registration_enrollments enrollment
    set
      status = 'canceled',
      roster_active = false,
      roster_released_at = null,
      roster_release_reason = null,
      roster_release_source_task_id = null,
      roster_release_kind = null,
      updated_at = pg_catalog.now()
    where enrollment.id = p_enrollment_id
      and enrollment.status = 'planned'
      and enrollment.admission_batch_id is null
      and enrollment.student_id is null
      and not enrollment.roster_active;
    if not found then
      raise exception 'registration_enrollment_not_cancelable' using errcode = '40001';
    end if;
    v_next_status := v_track.pipeline_status;
  elsif v_enrollment.status = 'enrolled' and v_enrollment.roster_active then
    if v_enrollment.student_id is null
      or v_enrollment.admission_batch_id is null
      or v_task.student_id is distinct from v_enrollment.student_id
      or v_track.pipeline_status <> 'registered'
    then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
    select student.*
    into v_student
    from public.students student
    where student.id = v_enrollment.student_id;
    if not found
      or pg_catalog.lower(
        pg_catalog.regexp_replace(coalesce(v_student.name, ''), '\s+', '', 'g')
      ) <> v_name_key
      or pg_catalog.regexp_replace(
        coalesce(v_student.parent_contact, ''), '\D+', '', 'g'
      ) <> v_parent_phone_key
      or (
        nullif(pg_catalog.btrim(v_detail.school_name), '') is not null
        and v_student.school is distinct from v_detail.school_name
      )
      or (
        nullif(pg_catalog.btrim(v_detail.student_phone), '') is not null
        and pg_catalog.regexp_replace(coalesce(v_student.contact, ''), '\D+', '', 'g')
          <> pg_catalog.regexp_replace(v_detail.student_phone, '\D+', '', 'g')
      )
    then
      raise exception 'registration_student_identity_mismatch' using errcode = '23514';
    end if;

    -- enrollment_cancel_live_claim_release
    perform dashboard_private.apply_student_class_roster_mode(
      v_enrollment.student_id,
      v_enrollment.class_id,
      'removed',
      'enrolled',
      v_enrollment.id,
      'registration_enrollment_canceled: ' || v_reason,
      v_actor_id
    );
    update public.ops_registration_enrollments enrollment
    set
      status = 'canceled',
      roster_active = false,
      roster_released_at = null,
      roster_release_reason = null,
      roster_release_source_task_id = null,
      roster_release_kind = null,
      updated_at = pg_catalog.now()
    where enrollment.id = p_enrollment_id
      and enrollment.status = 'enrolled'
      and enrollment.roster_active;
    if not found then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;

    select pg_catalog.count(*)
    into v_remaining_live_count
    from public.ops_registration_enrollments enrollment
    where enrollment.track_id = v_track_id
      and enrollment.status = 'enrolled'
      and enrollment.roster_active;

    if v_remaining_live_count > 0 then
      if v_destination is not null or v_waiting_kind is not null or p_class_id is not null then
        raise exception 'registration_enrollment_destination_not_allowed' using errcode = '22023';
      end if;
      v_next_status := 'registered';
    elsif v_remaining_live_count = 0 then
      if v_destination is null
        or v_destination not in ('enrollment_decided', 'waiting', 'not_registered')
      then
        raise exception 'registration_enrollment_destination_required' using errcode = '22023';
      end if;
      if v_destination = 'waiting' then
        if v_waiting_kind not in (
          'current_class', 'current_term_opening', 'next_term_opening'
        ) or (v_waiting_kind = 'current_class') is distinct from (p_class_id is not null)
        then
          raise exception 'registration_enrollment_cancellation_arguments_invalid' using errcode = '22023';
        end if;
        if v_waiting_kind = 'current_class' and not exists (
          select 1
          from public.classes class
          where class.id = p_class_id
            and pg_catalog.btrim(class.subject) = v_track.subject
        ) then
          raise exception 'registration_class_subject_mismatch' using errcode = '23514';
        end if;
      elsif v_waiting_kind is not null or p_class_id is not null then
        raise exception 'registration_enrollment_cancellation_arguments_invalid' using errcode = '22023';
      end if;

      if v_destination in ('waiting', 'not_registered') then
        -- enrollment_cancel_remaining_drafts
        update public.ops_registration_enrollments enrollment
        set
          status = 'canceled',
          roster_active = false,
          roster_released_at = null,
          roster_release_reason = null,
          roster_release_source_task_id = null,
          roster_release_kind = null,
          updated_at = pg_catalog.now()
        where enrollment.track_id = v_track_id
          and enrollment.status = 'planned'
          and enrollment.admission_batch_id is null
          and enrollment.student_id is null
          and not enrollment.roster_active;
      end if;
      if v_destination = 'waiting' and v_waiting_kind = 'current_class' then
        perform dashboard_private.apply_registration_current_class_wait(
          v_task_id, v_track_id, p_class_id, v_actor_id
        );
      end if;
      perform dashboard_private.transition_registration_track_status(
        v_track_id,
        v_destination,
        case when v_destination = 'waiting' then v_waiting_kind else null end,
        null,
        false
      );
      v_next_status := v_destination;
    end if;
  else
    raise exception 'registration_enrollment_not_cancelable' using errcode = '40001';
  end if;

  perform dashboard_private.write_registration_track_event(
    v_task_id,
    v_track_id,
    'registration_enrollment_canceled',
    v_track.pipeline_status,
    v_next_status,
    v_reason,
    pg_catalog.jsonb_build_object(
      'enrollmentId', p_enrollment_id,
      'remainingLiveEnrollmentCount', v_remaining_live_count,
      'waitingKind', case when v_next_status = 'waiting' then v_waiting_kind else null end,
      'classId', case
        when v_next_status = 'waiting' and v_waiting_kind = 'current_class' then p_class_id
        else null
      end,
      'enrollmentSnapshot', pg_catalog.jsonb_build_object(
        'id', v_enrollment.id,
        'classId', v_enrollment.class_id,
        'textbookId', v_enrollment.textbook_id,
        'admissionBatchId', v_enrollment.admission_batch_id,
        'classStartDate', v_enrollment.class_start_date,
        'classStartSessionKey', v_enrollment.class_start_session_key,
        'classStartSession', v_enrollment.class_start_session,
        'status', v_enrollment.status,
        'sortOrder', v_enrollment.sort_order
      )
    )
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);

  select enrollment.*
  into v_enrollment
  from public.ops_registration_enrollments enrollment
  where enrollment.id = p_enrollment_id;
  v_response := pg_catalog.jsonb_build_object(
    'enrollment', pg_catalog.jsonb_build_object(
      'id', v_enrollment.id,
      'trackId', v_enrollment.track_id,
      'studentId', v_enrollment.student_id,
      'admissionBatchId', v_enrollment.admission_batch_id,
      'classId', v_enrollment.class_id,
      'textbookId', v_enrollment.textbook_id,
      'classStartDate', v_enrollment.class_start_date,
      'classStartSessionKey', v_enrollment.class_start_session_key,
      'classStartSession', v_enrollment.class_start_session,
      'status', v_enrollment.status,
      'makeeduRegistered', v_enrollment.makeedu_registered,
      'rosterActive', v_enrollment.roster_active,
      'rosterReleasedAt', v_enrollment.roster_released_at,
      'rosterReleaseReason', v_enrollment.roster_release_reason,
      'rosterReleaseSourceTaskId', v_enrollment.roster_release_source_task_id,
      'rosterReleaseKind', v_enrollment.roster_release_kind,
      'sortOrder', v_enrollment.sort_order
    ),
    'trackId', v_track_id,
    'trackStatus', v_next_status,
    'remainingLiveEnrollmentCount', v_remaining_live_count
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'cancel_enrollment',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.cancel_registration_enrollment_impl(uuid, text, text, uuid, text, text)
  owner to postgres;
revoke execute on function dashboard_private.cancel_registration_enrollment_impl(uuid, text, text, uuid, text, text) from public, anon;
grant execute on function dashboard_private.cancel_registration_enrollment_impl(uuid, text, text, uuid, text, text) to authenticated;

create function public.cancel_registration_enrollment(
  p_enrollment_id uuid,
  p_destination text,
  p_waiting_kind text,
  p_class_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.cancel_registration_enrollment_impl(
    p_enrollment_id, p_destination, p_waiting_kind, p_class_id,
    p_reason, p_request_key
  );
$$;

revoke execute on function public.cancel_registration_enrollment(uuid, text, text, uuid, text, text) from public, anon;
grant execute on function public.cancel_registration_enrollment(uuid, text, text, uuid, text, text) to authenticated;

create function dashboard_private.complete_ops_withdrawal_roster_transition_impl(
  p_task_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_withdrawal_details%rowtype;
  v_pre_student public.students%rowtype;
  v_student public.students%rowtype;
  v_class public.classes%rowtype;
  v_claim public.ops_registration_enrollments%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_student_id uuid;
  v_source_class_id uuid;
  v_pre_parent_ids uuid[] := array[]::uuid[];
  v_current_parent_ids uuid[] := array[]::uuid[];
  v_enrolled_class_ids uuid[] := array[]::uuid[];
  v_waitlist_class_ids uuid[] := array[]::uuid[];
  v_affected_class_ids uuid[] := array[]::uuid[];
  v_released_enrollment_ids uuid[] := array[]::uuid[];
  v_canceled_waitlist_ids uuid[] := array[]::uuid[];
  v_recomputed_parent_ids uuid[] := array[]::uuid[];
  v_name_key text;
  v_parent_phone_key text;
  v_class_id uuid;
  v_claim_id uuid;
  v_claim_count integer;
  v_mode text;
  v_parent_id uuid;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null or p_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;

  -- withdrawal_preliminary_source
  select task.student_id, task.class_id
  into v_student_id, v_source_class_id
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'withdrawal';
  if v_student_id is null or v_source_class_id is null then
    raise exception 'ops_withdrawal_management_link_required' using errcode = '22023';
  end if;
  select student.*
  into v_pre_student
  from public.students student
  where student.id = v_student_id;
  if not found then
    raise exception 'registration_student_not_found' using errcode = 'P0002';
  end if;
  select coalesce(
    pg_catalog.array_agg(distinct track.task_id order by track.task_id),
    array[]::uuid[]
  )
  into v_pre_parent_ids
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where enrollment.student_id = v_student_id
    and enrollment.roster_active;

  -- verification_checkpoint_withdrawal_after_parent_snapshot
  perform dashboard_private.await_registration_verification_checkpoint(
    'withdrawal_after_parent_snapshot', p_task_id, v_student_id
  );

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'studentId', v_student_id,
    'sourceClassId', v_source_class_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- withdrawal_parent_task_locks
  perform 1
  from public.ops_tasks task
  where task.id = p_task_id
    or task.id = any(v_pre_parent_ids)
  order by task.id
  for update;
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'withdrawal';
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select detail.*
  into v_detail
  from public.ops_withdrawal_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'ops_withdrawal_detail_required' using errcode = '23514';
  end if;

  -- withdrawal_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = any(v_pre_parent_ids)
  order by track.id
  for update;

  -- withdrawal_identity_lock
  v_name_key := pg_catalog.lower(
    pg_catalog.regexp_replace(coalesce(v_pre_student.name, ''), '\s+', '', 'g')
  );
  v_parent_phone_key := pg_catalog.regexp_replace(
    coalesce(v_pre_student.parent_contact, ''), '\D+', '', 'g'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-student:' || v_name_key || ':' || v_parent_phone_key,
      0
    )
  );

  -- withdrawal_student_lock
  select student.*
  into v_student
  from public.students student
  where student.id = v_student_id
  for update;
  if not found
    or v_task.student_id is distinct from v_student_id
    or v_task.class_id is distinct from v_source_class_id
    or pg_catalog.lower(
      pg_catalog.regexp_replace(coalesce(v_student.name, ''), '\s+', '', 'g')
    ) is distinct from v_name_key
    or pg_catalog.regexp_replace(
      coalesce(v_student.parent_contact, ''), '\D+', '', 'g'
    ) is distinct from v_parent_phone_key
  then
    raise exception 'registration_workflow_retry_required' using errcode = '40001';
  end if;

  -- withdrawal_parent_rescan
  select coalesce(
    pg_catalog.array_agg(distinct track.task_id order by track.task_id),
    array[]::uuid[]
  )
  into v_current_parent_ids
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where enrollment.student_id = v_student_id
    and enrollment.roster_active;
  if v_current_parent_ids is distinct from v_pre_parent_ids then
    raise exception 'registration_workflow_retry_required' using errcode = '40001';
  end if;

  -- withdrawal_batch_locks
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = any(v_current_parent_ids)
  order by batch.id
  for update;

  -- withdrawal_claim_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  where enrollment.student_id = v_student_id
    and enrollment.roster_active
  order by enrollment.id
  for update;

  if pg_catalog.jsonb_typeof(coalesce(v_student.class_ids, '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) <> 'array'
    or exists (
      select 1
      from (
        select element.value
        from pg_catalog.jsonb_array_elements(coalesce(v_student.class_ids, '[]'::jsonb)) element(value)
        union all
        select element.value
        from pg_catalog.jsonb_array_elements(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) element(value)
      ) roster(value)
      where pg_catalog.jsonb_typeof(roster.value) <> 'string'
        or roster.value #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  then
    raise exception 'registration_roster_projection_invalid' using errcode = '23514';
  end if;
  select coalesce(
    pg_catalog.array_agg(distinct (element.value #>> '{}')::uuid order by (element.value #>> '{}')::uuid),
    array[]::uuid[]
  )
  into v_enrolled_class_ids
  from pg_catalog.jsonb_array_elements(coalesce(v_student.class_ids, '[]'::jsonb)) element(value);
  select coalesce(
    pg_catalog.array_agg(distinct (element.value #>> '{}')::uuid order by (element.value #>> '{}')::uuid),
    array[]::uuid[]
  )
  into v_waitlist_class_ids
  from pg_catalog.jsonb_array_elements(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) element(value);
  if pg_catalog.cardinality(v_enrolled_class_ids) <> pg_catalog.jsonb_array_length(coalesce(v_student.class_ids, '[]'::jsonb))
    or pg_catalog.cardinality(v_waitlist_class_ids) <> pg_catalog.jsonb_array_length(coalesce(v_student.waitlist_class_ids, '[]'::jsonb))
    or v_enrolled_class_ids && v_waitlist_class_ids
  then
    raise exception 'registration_roster_projection_invalid' using errcode = '23514';
  end if;
  select coalesce(
    pg_catalog.array_agg(class_id order by class_id),
    array[]::uuid[]
  )
  into v_affected_class_ids
  from (
    select pg_catalog.unnest(v_enrolled_class_ids) as class_id
    union
    select pg_catalog.unnest(v_waitlist_class_ids) as class_id
  ) affected;

  -- withdrawal_class_locks
  perform 1
  from public.classes class
  where class.id = any(v_affected_class_ids)
  order by class.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'complete_withdrawal_roster_transition'
  );

  -- withdrawal_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'complete_withdrawal_roster_transition'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- withdrawal_mutable_state_check
  if v_task.status in ('done', 'canceled')
    or v_detail.timetable_roster_updated
  then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '40001';
  end if;
  if not v_detail.makeedu_withdrawal_done
    or not v_detail.fee_processed
    or not v_detail.textbook_fee_processed
  then
    raise exception 'ops_withdrawal_checklist_incomplete' using errcode = '40001';
  end if;
  if v_student.status = '퇴원' then
    raise exception 'registration_student_reactivation_required' using errcode = '40001';
  end if;
  if v_source_class_id <> all(v_enrolled_class_ids) then
    raise exception 'ops_withdrawal_source_roster_required' using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    left join public.ops_registration_admission_batches batch
      on batch.id = enrollment.admission_batch_id
    where enrollment.student_id = v_student_id
      and enrollment.roster_active
      and (
        enrollment.status = 'planned'
        or batch.status not in ('completed', 'canceled')
      )
  ) then
    raise exception 'registration_open_admission_batch' using errcode = '40001';
  end if;

  -- verification_checkpoint_withdrawal_before_status_flip
  perform dashboard_private.await_registration_verification_checkpoint(
    'withdrawal_before_status_flip', p_task_id, v_student_id
  );

  foreach v_class_id in array v_affected_class_ids
  loop
    select class.*
    into v_class
    from public.classes class
    where class.id = v_class_id;
    if not found
      or pg_catalog.jsonb_typeof(coalesce(pg_catalog.to_jsonb(v_class.student_ids), '[]'::jsonb)) <> 'array'
      or pg_catalog.jsonb_typeof(coalesce(pg_catalog.to_jsonb(v_class.waitlist_ids), '[]'::jsonb)) <> 'array'
    then
      raise exception 'registration_roster_projection_invalid' using errcode = '23514';
    end if;
    v_mode := case when v_class_id = any(v_enrolled_class_ids) then 'enrolled' else 'waitlist' end;
    if (
      v_mode = 'enrolled'
      and (
        not (coalesce(pg_catalog.to_jsonb(v_class.student_ids), '[]'::jsonb) ? v_student_id::text)
        or coalesce(pg_catalog.to_jsonb(v_class.waitlist_ids), '[]'::jsonb) ? v_student_id::text
      )
    ) or (
      v_mode = 'waitlist'
      and (
        not (coalesce(pg_catalog.to_jsonb(v_class.waitlist_ids), '[]'::jsonb) ? v_student_id::text)
        or coalesce(pg_catalog.to_jsonb(v_class.student_ids), '[]'::jsonb) ? v_student_id::text
      )
    ) then
      raise exception 'registration_roster_projection_invalid' using errcode = '23514';
    end if;

    select
      pg_catalog.count(*),
      (pg_catalog.array_agg(enrollment.id order by enrollment.id))[1]
    into v_claim_count, v_claim_id
    from public.ops_registration_enrollments enrollment
    where enrollment.student_id = v_student_id
      and enrollment.class_id = v_class_id
      and enrollment.roster_active;
    if v_claim_count > 1 then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
    if v_claim_count = 1 then
      select enrollment.*
      into v_claim
      from public.ops_registration_enrollments enrollment
      where enrollment.id = v_claim_id;
      if (v_mode = 'enrolled' and v_claim.status <> 'enrolled')
        or (v_mode = 'waitlist' and v_claim.status <> 'waitlisted')
      then
        raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
      end if;
    else
      v_claim_id := null;
    end if;

    perform dashboard_private.apply_student_class_roster_mode(
      v_student_id,
      v_class_id,
      'removed',
      v_mode,
      v_claim_id,
      'withdrawal_completed',
      v_actor_id
    );

    if v_claim_id is not null and v_mode = 'enrolled' then
      update public.ops_registration_enrollments enrollment
      set
        status = 'enrolled',
        roster_active = false,
        roster_released_at = pg_catalog.now(),
        roster_release_reason = 'withdrawal_completed',
        roster_release_source_task_id = p_task_id,
        roster_release_kind = 'withdrawal',
        updated_at = pg_catalog.now()
      where enrollment.id = v_claim_id
        and enrollment.status = 'enrolled'
        and enrollment.roster_active;
      if not found then
        raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
      end if;
      v_released_enrollment_ids := pg_catalog.array_append(v_released_enrollment_ids, v_claim_id);
      select track.*
      into v_track
      from public.ops_registration_subject_tracks track
      where track.id = v_claim.track_id;
      perform dashboard_private.write_registration_track_event(
        v_track.task_id,
        v_track.id,
        'registration_enrollment_roster_released',
        v_track.pipeline_status,
        v_track.pipeline_status,
        'withdrawal_completed',
        pg_catalog.jsonb_build_object(
          'enrollmentId', v_claim_id,
          'sourceTaskId', p_task_id,
          'releaseKind', 'withdrawal',
          'enrollmentSnapshot', pg_catalog.jsonb_build_object(
            'id', v_claim.id,
            'classId', v_claim.class_id,
            'textbookId', v_claim.textbook_id,
            'admissionBatchId', v_claim.admission_batch_id,
            'classStartDate', v_claim.class_start_date,
            'classStartSessionKey', v_claim.class_start_session_key,
            'classStartSession', v_claim.class_start_session,
            'status', v_claim.status,
            'sortOrder', v_claim.sort_order
          )
        )
      );
      v_recomputed_parent_ids := pg_catalog.array_append(v_recomputed_parent_ids, v_track.task_id);
    elsif v_claim_id is not null and v_mode = 'waitlist' then
      update public.ops_registration_enrollments enrollment
      set
        status = 'canceled',
        roster_active = false,
        roster_released_at = null,
        roster_release_reason = null,
        roster_release_source_task_id = null,
        roster_release_kind = null,
        updated_at = pg_catalog.now()
      where enrollment.id = v_claim_id
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active;
      if not found then
        raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
      end if;
      v_canceled_waitlist_ids := pg_catalog.array_append(v_canceled_waitlist_ids, v_claim_id);
      select track.*
      into v_track
      from public.ops_registration_subject_tracks track
      where track.id = v_claim.track_id;
      if v_track.pipeline_status <> 'waiting'
        or v_track.waiting_kind <> 'current_class'
      then
        raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
      end if;
      perform dashboard_private.transition_registration_track_status(
        v_track.id, 'not_registered', null, null, false
      );
      perform dashboard_private.write_registration_track_event(
        v_track.task_id,
        v_track.id,
        'registration_waitlist_canceled_by_withdrawal',
        'waiting',
        'not_registered',
        'withdrawal_completed',
        pg_catalog.jsonb_build_object(
          'enrollmentId', v_claim_id,
          'sourceTaskId', p_task_id
        )
      );
      v_recomputed_parent_ids := pg_catalog.array_append(v_recomputed_parent_ids, v_track.task_id);
    end if;
  end loop;

  select student.*
  into v_student
  from public.students student
  where student.id = v_student_id;
  if pg_catalog.jsonb_array_length(coalesce(v_student.class_ids, '[]'::jsonb)) <> 0
    or pg_catalog.jsonb_array_length(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) <> 0
    or exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.student_id = v_student_id
        and enrollment.roster_active
    )
  then
    raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
  end if;
  update public.students
  set status = '퇴원'
  where id = v_student_id
    and status <> '퇴원';
  if not found then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '40001';
  end if;

  update public.ops_withdrawal_details
  set
    timetable_roster_updated = true,
    updated_at = pg_catalog.now()
  where task_id = p_task_id
    and not timetable_roster_updated;
  if not found then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '40001';
  end if;
  update public.ops_tasks
  set
    status = 'done',
    completed_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where id = p_task_id
    and type = 'withdrawal'
    and status not in ('done', 'canceled');
  if not found then
    raise exception 'ops_withdrawal_completion_state_conflict' using errcode = '40001';
  end if;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value
  ) values
    (p_task_id, v_actor_id, 'auto_checked', '시간표 명단 변경', '', '완료'),
    (p_task_id, v_actor_id, 'auto_synced', '수업명단', '', '전체 수업 및 대기 명단 제거 · withdrawal_completed'),
    (p_task_id, v_actor_id, 'auto_synced', '학생 상태', '재원', '퇴원');

  select coalesce(
    pg_catalog.array_agg(distinct parent_id order by parent_id),
    array[]::uuid[]
  )
  into v_recomputed_parent_ids
  from pg_catalog.unnest(v_recomputed_parent_ids) parent_id;
  foreach v_parent_id in array v_recomputed_parent_ids
  loop
    perform dashboard_private.recompute_registration_parent(v_parent_id);
  end loop;

  v_response := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'studentId', v_student_id,
    'sourceClassId', v_source_class_id,
    'affectedClassIds', pg_catalog.to_jsonb(v_affected_class_ids),
    'releasedEnrollmentIds', pg_catalog.to_jsonb(v_released_enrollment_ids),
    'canceledWaitlistEnrollmentIds', pg_catalog.to_jsonb(v_canceled_waitlist_ids),
    'studentStatus', '퇴원',
    'taskStatus', 'done',
    'timetableRosterUpdated', true
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, p_task_id,
    'complete_withdrawal_roster_transition', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid, text)
  owner to postgres;
revoke execute on function dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid, text) from public, anon;
grant execute on function dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid, text) to authenticated;

create function public.complete_ops_withdrawal_roster_transition(
  p_task_id uuid,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.complete_ops_withdrawal_roster_transition_impl(
    p_task_id, p_request_key
  );
$$;

revoke execute on function public.complete_ops_withdrawal_roster_transition(uuid, text) from public, anon;
grant execute on function public.complete_ops_withdrawal_roster_transition(uuid, text) to authenticated;

create function dashboard_private.complete_ops_transfer_roster_transition_impl(
  p_task_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_transfer_details%rowtype;
  v_pre_student public.students%rowtype;
  v_student public.students%rowtype;
  v_from_class public.classes%rowtype;
  v_to_class public.classes%rowtype;
  v_claim public.ops_registration_enrollments%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_student_id uuid;
  v_from_class_id uuid;
  v_to_class_id uuid;
  v_pre_claim_id uuid;
  v_pre_claim_count integer;
  v_pre_track_id uuid;
  v_pre_parent_id uuid;
  v_current_claim_id uuid;
  v_current_claim_count integer;
  v_current_track_id uuid;
  v_current_parent_id uuid;
  v_parent_ids uuid[] := array[]::uuid[];
  v_class_ids uuid[] := array[]::uuid[];
  v_name_key text;
  v_parent_phone_key text;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null or p_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;

  -- transfer_preliminary_source
  select task.student_id, detail.from_class_id, detail.to_class_id
  into v_student_id, v_from_class_id, v_to_class_id
  from public.ops_tasks task
  join public.ops_transfer_details detail on detail.task_id = task.id
  where task.id = p_task_id
    and task.type = 'transfer';
  if v_student_id is null or v_from_class_id is null or v_to_class_id is null then
    raise exception 'ops_transfer_management_link_required' using errcode = '22023';
  end if;
  if v_from_class_id = v_to_class_id then
    raise exception 'ops_transfer_classes_must_differ' using errcode = '22023';
  end if;
  select student.*
  into v_pre_student
  from public.students student
  where student.id = v_student_id;
  if not found then
    raise exception 'registration_student_not_found' using errcode = 'P0002';
  end if;
  select
    pg_catalog.count(*),
    (pg_catalog.array_agg(enrollment.id order by enrollment.id))[1]
  into v_pre_claim_count, v_pre_claim_id
  from public.ops_registration_enrollments enrollment
  where enrollment.student_id = v_student_id
    and enrollment.class_id = v_from_class_id
    and enrollment.roster_active;
  if v_pre_claim_count > 1 then
    raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
  end if;
  if v_pre_claim_count = 1 then
    select enrollment.track_id, track.task_id
    into v_pre_track_id, v_pre_parent_id
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
    where enrollment.id = v_pre_claim_id;
    v_parent_ids := array[v_pre_parent_id]::uuid[];
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'studentId', v_student_id,
    'fromClassId', v_from_class_id,
    'toClassId', v_to_class_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- transfer_parent_task_locks
  perform 1
  from public.ops_tasks task
  where task.id = p_task_id
    or task.id = any(v_parent_ids)
  order by task.id
  for update;
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'transfer';
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select detail.*
  into v_detail
  from public.ops_transfer_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'ops_transfer_detail_required' using errcode = '23514';
  end if;

  -- transfer_track_lock
  perform 1
  from public.ops_registration_subject_tracks track
  where track.id = v_pre_track_id
    and track.task_id = v_pre_parent_id
  order by track.id
  for update;

  -- transfer_identity_lock
  v_name_key := pg_catalog.lower(
    pg_catalog.regexp_replace(coalesce(v_pre_student.name, ''), '\s+', '', 'g')
  );
  v_parent_phone_key := pg_catalog.regexp_replace(
    coalesce(v_pre_student.parent_contact, ''), '\D+', '', 'g'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-student:' || v_name_key || ':' || v_parent_phone_key,
      0
    )
  );

  -- transfer_student_lock
  select student.*
  into v_student
  from public.students student
  where student.id = v_student_id
  for update;
  if not found
    or v_task.student_id is distinct from v_student_id
    or v_detail.from_class_id is distinct from v_from_class_id
    or v_detail.to_class_id is distinct from v_to_class_id
    or pg_catalog.lower(
      pg_catalog.regexp_replace(coalesce(v_student.name, ''), '\s+', '', 'g')
    ) is distinct from v_name_key
    or pg_catalog.regexp_replace(
      coalesce(v_student.parent_contact, ''), '\D+', '', 'g'
    ) is distinct from v_parent_phone_key
  then
    raise exception 'registration_workflow_retry_required' using errcode = '40001';
  end if;

  -- transfer_claim_rescan
  select
    pg_catalog.count(*),
    (pg_catalog.array_agg(enrollment.id order by enrollment.id))[1]
  into v_current_claim_count, v_current_claim_id
  from public.ops_registration_enrollments enrollment
  where enrollment.student_id = v_student_id
    and enrollment.class_id = v_from_class_id
    and enrollment.roster_active;
  if v_current_claim_count > 1 then
    raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
  end if;
  if v_current_claim_count = 1 then
    select enrollment.track_id, track.task_id
    into v_current_track_id, v_current_parent_id
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
    where enrollment.id = v_current_claim_id;
  else
    v_current_claim_id := null;
    v_current_track_id := null;
    v_current_parent_id := null;
  end if;
  if v_current_claim_count is distinct from v_pre_claim_count
    or v_current_claim_id is distinct from v_pre_claim_id
    or v_current_track_id is distinct from v_pre_track_id
    or v_current_parent_id is distinct from v_pre_parent_id
  then
    raise exception 'registration_workflow_retry_required' using errcode = '40001';
  end if;

  -- transfer_batch_locks
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = any(v_parent_ids)
  order by batch.id
  for update;

  -- transfer_claim_locks
  perform 1
  from public.ops_registration_enrollments enrollment
  where enrollment.student_id = v_student_id
    and enrollment.roster_active
    and enrollment.class_id in (v_from_class_id, v_to_class_id)
  order by enrollment.id
  for update;

  -- transfer_claim_locked_rescan
  select
    pg_catalog.count(*),
    (pg_catalog.array_agg(enrollment.id order by enrollment.id))[1]
  into v_current_claim_count, v_current_claim_id
  from public.ops_registration_enrollments enrollment
  where enrollment.student_id = v_student_id
    and enrollment.class_id = v_from_class_id
    and enrollment.roster_active;
  if v_current_claim_count > 1 then
    raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
  end if;
  if v_current_claim_count = 1 then
    select enrollment.track_id, track.task_id
    into v_current_track_id, v_current_parent_id
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
    where enrollment.id = v_current_claim_id;
  else
    v_current_claim_id := null;
    v_current_track_id := null;
    v_current_parent_id := null;
  end if;
  if v_current_claim_count is distinct from v_pre_claim_count
    or v_current_claim_id is distinct from v_pre_claim_id
    or v_current_track_id is distinct from v_pre_track_id
    or v_current_parent_id is distinct from v_pre_parent_id
  then
    raise exception 'registration_workflow_retry_required' using errcode = '40001';
  end if;

  select pg_catalog.array_agg(class_id order by class_id)
  into v_class_ids
  from (
    select v_from_class_id as class_id
    union
    select v_to_class_id as class_id
  ) affected;
  -- transfer_class_locks
  perform 1
  from public.classes class
  where class.id = any(v_class_ids)
  order by class.id
  for update;
  select class.* into v_from_class from public.classes class where class.id = v_from_class_id;
  select class.* into v_to_class from public.classes class where class.id = v_to_class_id;

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'complete_transfer_roster_transition'
  );

  -- transfer_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'complete_transfer_roster_transition'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- transfer_mutable_state_check
  if v_task.status in ('done', 'canceled')
    or v_detail.timetable_roster_updated
  then
    raise exception 'ops_transfer_completion_state_conflict' using errcode = '40001';
  end if;
  if not v_detail.makeedu_transfer_done
    or not v_detail.fee_processed
    or not v_detail.textbook_fee_processed
  then
    raise exception 'ops_transfer_checklist_incomplete' using errcode = '40001';
  end if;
  if v_student.status = '퇴원' then
    raise exception 'registration_student_reactivation_required' using errcode = '40001';
  end if;
  if v_from_class.id is null or v_to_class.id is null then
    raise exception 'ops_transfer_class_not_found' using errcode = 'P0002';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(v_student.class_ids, '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(v_student.waitlist_class_ids, '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(pg_catalog.to_jsonb(v_from_class.student_ids), '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(pg_catalog.to_jsonb(v_from_class.waitlist_ids), '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(pg_catalog.to_jsonb(v_to_class.student_ids), '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(pg_catalog.to_jsonb(v_to_class.waitlist_ids), '[]'::jsonb)) <> 'array'
  then
    raise exception 'registration_roster_projection_invalid' using errcode = '23514';
  end if;
  if not (coalesce(v_student.class_ids, '[]'::jsonb) ? v_from_class_id::text)
    or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_from_class_id::text
    or not (coalesce(pg_catalog.to_jsonb(v_from_class.student_ids), '[]'::jsonb) ? v_student_id::text)
    or coalesce(pg_catalog.to_jsonb(v_from_class.waitlist_ids), '[]'::jsonb) ? v_student_id::text
  then
    raise exception 'registration_roster_mode_conflict' using errcode = '40001';
  end if;
  if coalesce(v_student.class_ids, '[]'::jsonb) ? v_to_class_id::text
    or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_to_class_id::text
    or coalesce(pg_catalog.to_jsonb(v_to_class.student_ids), '[]'::jsonb) ? v_student_id::text
    or coalesce(pg_catalog.to_jsonb(v_to_class.waitlist_ids), '[]'::jsonb) ? v_student_id::text
  then
    raise exception 'registration_roster_mode_conflict' using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    where enrollment.student_id = v_student_id
      and enrollment.class_id = v_to_class_id
      and enrollment.roster_active
  ) then
    raise exception 'registration_student_class_already_active' using errcode = '40001';
  end if;
  if v_current_claim_id is not null then
    select enrollment.*
    into v_claim
    from public.ops_registration_enrollments enrollment
    where enrollment.id = v_current_claim_id;
    if v_claim.status <> 'enrolled' then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
    select track.*
    into v_track
    from public.ops_registration_subject_tracks track
    where track.id = v_claim.track_id;
    if exists (
      select 1
      from public.ops_registration_admission_batches batch
      join public.ops_registration_enrollments enrollment
        on enrollment.admission_batch_id = batch.id
      where enrollment.track_id = v_claim.track_id
        and batch.status not in ('completed', 'canceled')
    ) then
      raise exception 'registration_open_admission_batch' using errcode = '40001';
    end if;
  end if;

  perform dashboard_private.apply_student_class_roster_mode(
    v_student_id,
    v_from_class_id,
    'removed',
    'enrolled',
    v_current_claim_id,
    'transfer_from_class',
    v_actor_id
  );
  if v_current_claim_id is not null then
    update public.ops_registration_enrollments enrollment
    set
      status = 'enrolled',
      roster_active = false,
      roster_released_at = pg_catalog.now(),
      roster_release_reason = 'transfer_from_class',
      roster_release_source_task_id = p_task_id,
      roster_release_kind = 'transfer',
      updated_at = pg_catalog.now()
    where enrollment.id = v_current_claim_id
      and enrollment.status = 'enrolled'
      and enrollment.roster_active;
    if not found then
      raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
    end if;
  end if;
  perform dashboard_private.apply_student_class_roster_mode(
    v_student_id,
    v_to_class_id,
    'enrolled',
    'removed',
    null,
    'transfer_to_class',
    v_actor_id
  );

  if v_current_claim_id is not null then
    perform dashboard_private.write_registration_track_event(
      v_track.task_id,
      v_track.id,
      'registration_enrollment_roster_released',
      v_track.pipeline_status,
      v_track.pipeline_status,
      'transfer_from_class',
      pg_catalog.jsonb_build_object(
        'enrollmentId', v_current_claim_id,
        'sourceTaskId', p_task_id,
        'releaseKind', 'transfer',
        'destinationClassId', v_to_class_id,
        'enrollmentSnapshot', pg_catalog.jsonb_build_object(
          'id', v_claim.id,
          'classId', v_claim.class_id,
          'textbookId', v_claim.textbook_id,
          'admissionBatchId', v_claim.admission_batch_id,
          'classStartDate', v_claim.class_start_date,
          'classStartSessionKey', v_claim.class_start_session_key,
          'classStartSession', v_claim.class_start_session,
          'status', v_claim.status,
          'sortOrder', v_claim.sort_order
        )
      )
    );
    perform dashboard_private.recompute_registration_parent(v_track.task_id);
  end if;

  update public.ops_transfer_details
  set
    timetable_roster_updated = true,
    updated_at = pg_catalog.now()
  where task_id = p_task_id
    and not timetable_roster_updated;
  if not found then
    raise exception 'ops_transfer_completion_state_conflict' using errcode = '40001';
  end if;
  update public.ops_tasks
  set
    status = 'done',
    completed_at = pg_catalog.now(),
    class_id = v_to_class_id,
    class_name = v_to_class.name,
    subject = v_to_class.subject,
    updated_at = pg_catalog.now()
  where id = p_task_id
    and type = 'transfer'
    and status not in ('done', 'canceled');
  if not found then
    raise exception 'ops_transfer_completion_state_conflict' using errcode = '40001';
  end if;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value
  ) values
    (p_task_id, v_actor_id, 'auto_checked', '시간표 명단 변경', '', '완료'),
    (
      p_task_id,
      v_actor_id,
      'auto_synced',
      '수업명단',
      coalesce(v_from_class.name, ''),
      coalesce(v_to_class.name, '') || ' 등록 · transfer_to_class'
    ),
    (p_task_id, v_actor_id, 'auto_synced', '학생 상태', '재원', '재원');

  v_response := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'studentId', v_student_id,
    'fromClassId', v_from_class_id,
    'toClassId', v_to_class_id,
    'releasedEnrollmentId', v_current_claim_id,
    'studentStatus', '재원',
    'taskStatus', 'done',
    'timetableRosterUpdated', true
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, p_task_id,
    'complete_transfer_roster_transition', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.complete_ops_transfer_roster_transition_impl(uuid, text)
  owner to postgres;
revoke execute on function dashboard_private.complete_ops_transfer_roster_transition_impl(uuid, text) from public, anon;
grant execute on function dashboard_private.complete_ops_transfer_roster_transition_impl(uuid, text) to authenticated;

create function public.complete_ops_transfer_roster_transition(
  p_task_id uuid,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.complete_ops_transfer_roster_transition_impl(
    p_task_id, p_request_key
  );
$$;

revoke execute on function public.complete_ops_transfer_roster_transition(uuid, text) from public, anon;
grant execute on function public.complete_ops_transfer_roster_transition(uuid, text) to authenticated;

create function dashboard_private.resolve_registration_migration_review_impl(
  p_task_id uuid,
  p_assignments jsonb,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_payload jsonb := coalesce(p_assignments, '{}'::jsonb);
  v_normalized_assignments jsonb;
  v_normalized_track_states jsonb;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_legacy_before jsonb;
  v_legacy_after jsonb;
  v_legacy_booleans jsonb;
  v_legacy_pipeline_status text;
  v_legacy_student_id uuid;
  v_legacy_class_id uuid;
  v_legacy_textbook_id uuid;
  v_legacy_updated_at timestamptz;
  v_level_test_at timestamptz;
  v_level_test_completed_at timestamptz;
  v_visit_consultation_at timestamptz;
  v_consultation_completed_at timestamptz;
  v_class_start_date date;
  v_class_start_session text;
  v_level_group_present boolean;
  v_consultation_group_present boolean;
  v_placement_group_present boolean;
  v_level_track_id uuid;
  v_consultation_track_id uuid;
  v_placement_track_id uuid;
  v_level_preserve boolean := false;
  v_consultation_preserve boolean := false;
  v_placement_preserve boolean := false;
  v_review_count integer;
  v_single_review_track_id uuid;
  v_state jsonb;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_target_status text;
  v_waiting_kind text;
  v_state_class_id uuid;
  v_class public.classes%rowtype;
  v_student public.students%rowtype;
  v_session_key text;
  v_session_validation jsonb;
  v_appointment_id uuid;
  v_consultation_id uuid;
  v_enrollment_id uuid;
  v_batch_id uuid;
  v_batch_status text;
  v_revision integer;
  v_admission_notice_sent boolean;
  v_makeedu_registered boolean;
  v_invoice_sent boolean;
  v_payment_checked boolean;
begin
  if v_actor_id is null or p_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;

  -- migration_review_payload_validation
  if pg_catalog.jsonb_typeof(v_payload) <> 'object' then
    raise exception 'registration_migration_payload_invalid' using errcode = '22023';
  end if;
  if exists (
      select 1
      from pg_catalog.jsonb_object_keys(coalesce(p_assignments, '{}'::jsonb)) payload_key
      where payload_key not in ('assignments', 'trackStates')
    )
    or pg_catalog.jsonb_typeof(coalesce(v_payload -> 'assignments', '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(v_payload -> 'trackStates', '[]'::jsonb)) <> 'array'
  then
    raise exception 'registration_migration_payload_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'assignments', '[]'::jsonb)) assignment_item
    where pg_catalog.jsonb_typeof(assignment_item) <> 'object'
  ) then
    raise exception 'registration_migration_assignment_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'assignments', '[]'::jsonb)) assignment_item
    where exists (
        select 1 from pg_catalog.jsonb_object_keys(assignment_item) assignment_key
        where assignment_key not in ('group', 'trackId', 'preserveAsCommonHistory')
      )
      or nullif(pg_catalog.btrim(assignment_item ->> 'group'), '') not in ('level_test', 'consultation', 'placement')
      or not (assignment_item ? 'preserveAsCommonHistory')
      or pg_catalog.jsonb_typeof(assignment_item -> 'preserveAsCommonHistory') <> 'boolean'
      or (
        nullif(pg_catalog.btrim(assignment_item ->> 'trackId'), '') is not null
        and nullif(pg_catalog.btrim(assignment_item ->> 'trackId'), '')
          !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
      or (
        coalesce(assignment_item -> 'preserveAsCommonHistory' = 'true'::jsonb, false)
        = (nullif(pg_catalog.btrim(assignment_item ->> 'trackId'), '') is not null)
      )
  ) then
    raise exception 'registration_migration_assignment_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'assignments', '[]'::jsonb)) assignment_item
    group by nullif(pg_catalog.btrim(assignment_item ->> 'group'), '')
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'registration_migration_assignment_group_duplicate' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'trackStates', '[]'::jsonb)) state_item
    where pg_catalog.jsonb_typeof(state_item) <> 'object'
  ) then
    raise exception 'registration_migration_track_state_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'trackStates', '[]'::jsonb)) state_item
    where exists (
        select 1 from pg_catalog.jsonb_object_keys(state_item) state_key
        where state_key not in ('trackId', 'targetStatus', 'waitingKind', 'classId')
      )
      or nullif(pg_catalog.btrim(state_item ->> 'trackId'), '') is null
      or nullif(pg_catalog.btrim(state_item ->> 'trackId'), '')
        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.lower(nullif(pg_catalog.btrim(state_item ->> 'targetStatus'), '')) not in (
        'inquiry', 'level_test_scheduled', 'consultation_waiting',
        'visit_consultation_scheduled', 'waiting', 'enrollment_decided',
        'enrollment_processing', 'registered', 'not_registered', 'inquiry_closed'
      )
      or (
        nullif(pg_catalog.btrim(state_item ->> 'classId'), '') is not null
        and nullif(pg_catalog.btrim(state_item ->> 'classId'), '')
          !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
  ) then
    raise exception 'registration_migration_track_state_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'trackStates', '[]'::jsonb)) state_item
    group by nullif(pg_catalog.btrim(state_item ->> 'trackId'), '')
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'registration_migration_track_state_duplicate' using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'group', nullif(pg_catalog.btrim(assignment_item ->> 'group'), ''),
        'trackId', nullif(pg_catalog.btrim(assignment_item ->> 'trackId'), '')::uuid,
        'preserveAsCommonHistory', (assignment_item ->> 'preserveAsCommonHistory')::boolean
      ) order by assignment_item ->> 'group'
    ),
    '[]'::jsonb
  )
  into v_normalized_assignments
  from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'assignments', '[]'::jsonb)) assignment_item;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'trackId', nullif(pg_catalog.btrim(state_item ->> 'trackId'), '')::uuid,
        'targetStatus', pg_catalog.lower(nullif(pg_catalog.btrim(state_item ->> 'targetStatus'), '')),
        'waitingKind', pg_catalog.lower(nullif(pg_catalog.btrim(state_item ->> 'waitingKind'), '')),
        'classId', nullif(pg_catalog.btrim(state_item ->> 'classId'), '')::uuid
      ) order by state_item ->> 'trackId'
    ),
    '[]'::jsonb
  )
  into v_normalized_track_states
  from pg_catalog.jsonb_array_elements(coalesce(v_payload -> 'trackStates', '[]'::jsonb)) state_item;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'assignments', v_normalized_assignments,
    'trackStates', v_normalized_track_states
  );

  -- migration_review_actor_request_lock
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- migration_review_task_detail_lock
  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- migration_review_track_lock
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by track.id
  for update;
  select pg_catalog.count(*)
  into v_review_count
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
    and track.pipeline_status = 'migration_review'
    and track.migration_review_required;
  select track.id
  into v_single_review_track_id
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
    and track.pipeline_status = 'migration_review'
    and track.migration_review_required
  order by track.id
  limit 1;
  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'resolve_migration_review'
  );

  -- migration_review_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'resolve_migration_review'
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

  -- migration_review_evidence_validation
  if v_review_count = 0
    or pg_catalog.jsonb_array_length(v_normalized_track_states) <> v_review_count
    or exists (
      select 1
      from public.ops_registration_subject_tracks track
      where track.task_id = p_task_id
        and track.pipeline_status = 'migration_review'
        and track.migration_review_required
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements(v_normalized_track_states) state_item
          where nullif(state_item ->> 'trackId', '')::uuid = track.id
        )
    )
  then
    raise exception 'registration_migration_track_states_incomplete' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_normalized_track_states) state_item
    left join public.ops_registration_subject_tracks track
      on track.id = nullif(state_item ->> 'trackId', '')::uuid
      and track.task_id = p_task_id
      and track.pipeline_status = 'migration_review'
      and track.migration_review_required
    where track.id is null
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_normalized_assignments) assignment_item
    left join public.ops_registration_subject_tracks track
      on track.id = nullif(assignment_item ->> 'trackId', '')::uuid
      and track.task_id = p_task_id
      and track.pipeline_status = 'migration_review'
      and track.migration_review_required
    where assignment_item ->> 'trackId' is not null
      and track.id is null
  ) then
    raise exception 'registration_migration_assignment_track_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and track.pipeline_status = 'migration_review'
      and track.migration_review_required
      and not exists (
        select 1
        from public.ops_task_events event
        where event.task_id = p_task_id
          and event.event_type = 'legacy_registration_imported'
          and (event.after_value::jsonb ->> 'version') = '1'
          and nullif(event.after_value::jsonb ->> 'trackId', '')::uuid = track.id
      )
  ) then
    raise exception 'registration_migration_legacy_snapshot_missing' using errcode = '23514';
  end if;
  if (
    select pg_catalog.count(distinct pg_catalog.jsonb_build_object(
      'pipelineStatus', event.before_value::jsonb ->> 'pipelineStatus',
      'studentId', event.before_value::jsonb ->> 'studentId',
      'classId', event.before_value::jsonb ->> 'classId',
      'textbookId', event.before_value::jsonb ->> 'textbookId',
      'timestamps', event.after_value::jsonb -> 'timestamps',
      'legacyBooleans', event.after_value::jsonb -> 'legacyBooleans'
    ))
    from public.ops_task_events event
    where event.task_id = p_task_id
      and event.event_type = 'legacy_registration_imported'
      and (event.after_value::jsonb ->> 'version') = '1'
  ) <> 1 then
    raise exception 'registration_migration_legacy_snapshot_conflict' using errcode = '23514';
  end if;

  select event.before_value::jsonb, event.after_value::jsonb
  into v_legacy_before, v_legacy_after
  from public.ops_task_events event
  where event.task_id = p_task_id
    and event.event_type = 'legacy_registration_imported'
    and (event.after_value::jsonb ->> 'version') = '1'
  order by event.created_at, event.id
  limit 1;
  v_legacy_pipeline_status := nullif(v_legacy_before ->> 'pipelineStatus', '');
  v_legacy_student_id := nullif(v_legacy_before ->> 'studentId', '')::uuid;
  v_legacy_class_id := nullif(v_legacy_before ->> 'classId', '')::uuid;
  v_legacy_textbook_id := nullif(v_legacy_before ->> 'textbookId', '')::uuid;
  v_legacy_booleans := coalesce(v_legacy_after -> 'legacyBooleans', '{}'::jsonb);
  v_legacy_updated_at := nullif(v_legacy_after #>> '{timestamps,taskUpdatedAt}', '')::timestamptz;
  v_level_test_at := nullif(v_legacy_after #>> '{timestamps,levelTestAt}', '')::timestamptz;
  v_level_test_completed_at := nullif(v_legacy_after #>> '{timestamps,levelTestCompletedAt}', '')::timestamptz;
  v_visit_consultation_at := nullif(v_legacy_after #>> '{timestamps,visitConsultationAt}', '')::timestamptz;
  v_consultation_completed_at := nullif(v_legacy_after #>> '{timestamps,consultationAt}', '')::timestamptz;
  v_class_start_date := nullif(v_legacy_after #>> '{timestamps,classStartDate}', '')::date;
  v_class_start_session := nullif(pg_catalog.btrim(v_legacy_after #>> '{timestamps,classStartSession}'), '');
  v_admission_notice_sent := coalesce((v_legacy_booleans ->> 'admissionNoticeSent')::boolean, false);
  v_makeedu_registered := coalesce((v_legacy_booleans ->> 'makeeduRegistered')::boolean, false);
  v_invoice_sent := coalesce((v_legacy_booleans ->> 'makeeduInvoiceSent')::boolean, false);
  v_payment_checked := coalesce((v_legacy_booleans ->> 'paymentChecked')::boolean, false);

  v_level_group_present := v_level_test_at is not null
    or v_level_test_completed_at is not null
    or nullif(pg_catalog.btrim(v_detail.level_test_place), '') is not null
    or nullif(pg_catalog.btrim(v_detail.level_test_material_link), '') is not null
    or nullif(pg_catalog.btrim(v_detail.level_test_result), '') is not null;
  v_consultation_group_present := v_visit_consultation_at is not null
    or v_consultation_completed_at is not null
    or nullif(pg_catalog.btrim(v_detail.visit_consultation_place), '') is not null
    or nullif(v_legacy_after #>> '{timestamps,phoneConsultationAt}', '') is not null;
  v_placement_group_present := v_legacy_student_id is not null
    or v_legacy_class_id is not null
    or v_legacy_textbook_id is not null
    or v_class_start_date is not null
    or v_class_start_session is not null
    or v_admission_notice_sent
    or v_makeedu_registered
    or v_invoice_sent
    or v_payment_checked;

  select nullif(assignment_item ->> 'trackId', '')::uuid,
    coalesce((assignment_item ->> 'preserveAsCommonHistory')::boolean, false)
  into v_level_track_id, v_level_preserve
  from pg_catalog.jsonb_array_elements(v_normalized_assignments) assignment_item
  where assignment_item ->> 'group' = 'level_test';
  select nullif(assignment_item ->> 'trackId', '')::uuid,
    coalesce((assignment_item ->> 'preserveAsCommonHistory')::boolean, false)
  into v_consultation_track_id, v_consultation_preserve
  from pg_catalog.jsonb_array_elements(v_normalized_assignments) assignment_item
  where assignment_item ->> 'group' = 'consultation';
  select nullif(assignment_item ->> 'trackId', '')::uuid,
    coalesce((assignment_item ->> 'preserveAsCommonHistory')::boolean, false)
  into v_placement_track_id, v_placement_preserve
  from pg_catalog.jsonb_array_elements(v_normalized_assignments) assignment_item
  where assignment_item ->> 'group' = 'placement';

  if v_review_count = 1 then
    if v_level_group_present and v_level_track_id is null and not v_level_preserve then
      v_level_track_id := v_single_review_track_id;
    end if;
    if v_consultation_group_present and v_consultation_track_id is null and not v_consultation_preserve then
      v_consultation_track_id := v_single_review_track_id;
    end if;
    if v_placement_group_present and v_placement_track_id is null and not v_placement_preserve then
      v_placement_track_id := v_single_review_track_id;
    end if;
  end if;
  if (v_level_group_present and v_level_track_id is null and not v_level_preserve)
    or (v_consultation_group_present and v_consultation_track_id is null and not v_consultation_preserve)
    or (v_placement_group_present and v_placement_track_id is null and not v_placement_preserve)
  then
    raise exception 'registration_migration_group_assignment_required' using errcode = '22023';
  end if;
  if (not v_level_group_present and (v_level_track_id is not null or v_level_preserve))
    or (not v_consultation_group_present and (v_consultation_track_id is not null or v_consultation_preserve))
    or (not v_placement_group_present and (v_placement_track_id is not null or v_placement_preserve))
  then
    raise exception 'registration_migration_assignment_group_empty' using errcode = '22023';
  end if;

  perform 1
  from public.ops_registration_appointments appointment
  where appointment.task_id = p_task_id
  order by appointment.id
  for update;
  perform 1
  from public.ops_registration_level_tests level_test
  join public.ops_registration_subject_tracks track on track.id = level_test.track_id
  where track.task_id = p_task_id
  order by level_test.id
  for update of level_test;
  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = p_task_id
  order by consultation.id
  for update of consultation;
  if exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and track.pipeline_status = 'migration_review'
      and (
        exists (select 1 from public.ops_registration_level_tests level_test where level_test.track_id = track.id)
        or exists (select 1 from public.ops_registration_consultations consultation where consultation.track_id = track.id)
        or exists (select 1 from public.ops_registration_enrollments enrollment where enrollment.track_id = track.id)
      )
  ) then
    raise exception 'registration_migration_review_child_invariant' using errcode = '23514';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_normalized_track_states) state_item
    where state_item ->> 'targetStatus' = 'waiting'
      and state_item ->> 'waitingKind' = 'current_class'
  ) then
    if pg_catalog.regexp_replace(
        coalesce(v_task.student_name, ''), '\s+', '', 'g'
      ) = ''
      or pg_catalog.regexp_replace(
        coalesce(v_detail.parent_phone, ''), '\D+', '', 'g'
      ) = ''
    then
      raise exception 'registration_student_identity_required' using errcode = '22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'registration-student:'
          || pg_catalog.lower(pg_catalog.regexp_replace(
            v_task.student_name, '\s+', '', 'g'
          ))
          || ':'
          || pg_catalog.regexp_replace(v_detail.parent_phone, '\D+', '', 'g'),
        0
      )
    );
  end if;

  if v_legacy_student_id is not null then
    select student.*
    into v_student
    from public.students student
    where student.id = v_legacy_student_id
    for update;
  end if;
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = p_task_id
  order by batch.id
  for update;
  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = p_task_id
  order by enrollment.id
  for update of enrollment;
  if v_legacy_student_id is not null and v_legacy_class_id is not null then
    perform 1
    from public.ops_registration_enrollments enrollment
    where enrollment.student_id = v_legacy_student_id
      and enrollment.class_id = v_legacy_class_id
    order by enrollment.id
    for update;
  end if;
  if v_legacy_class_id is not null then
    select class.*
    into v_class
    from public.classes class
    where class.id = v_legacy_class_id
    for update;
  end if;
  if v_legacy_textbook_id is not null then
    perform 1
    from public.textbooks textbook
    where textbook.id = v_legacy_textbook_id
    order by textbook.id
    for update;
    if not found then
      raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
    end if;
  end if;

  for v_state in
    select state_item
    from pg_catalog.jsonb_array_elements(v_normalized_track_states) state_item
    order by state_item ->> 'trackId'
  loop
    select track.*
    into v_track
    from public.ops_registration_subject_tracks track
    where track.id = nullif(v_state ->> 'trackId', '')::uuid
      and track.task_id = p_task_id;
    v_target_status := v_state ->> 'targetStatus';
    v_waiting_kind := nullif(v_state ->> 'waitingKind', '');
    v_state_class_id := nullif(v_state ->> 'classId', '')::uuid;

    if v_target_status = 'waiting' then
      if v_waiting_kind not in ('current_class', 'current_term_opening', 'next_term_opening')
        or (v_waiting_kind = 'current_class') is distinct from (v_state_class_id is not null)
      then
        raise exception 'registration_migration_track_state_invalid' using errcode = '22023';
      end if;
    elsif v_waiting_kind is not null then
      raise exception 'registration_migration_track_state_invalid' using errcode = '22023';
    elsif v_target_status in ('enrollment_decided', 'enrollment_processing', 'registered') then
      if v_state_class_id is null or v_state_class_id is distinct from v_legacy_class_id then
        raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
      end if;
    elsif v_state_class_id is not null then
      raise exception 'registration_migration_track_state_invalid' using errcode = '22023';
    end if;

    if v_target_status = 'level_test_scheduled'
      and (
        v_level_track_id is distinct from v_track.id
        or v_level_test_at is null
        or nullif(pg_catalog.btrim(v_detail.level_test_place), '') is null
      )
    then
      raise exception 'registration_migration_level_test_evidence_invalid' using errcode = '23514';
    end if;
    if v_target_status = 'visit_consultation_scheduled'
      and (
        v_consultation_track_id is distinct from v_track.id
        or v_visit_consultation_at is null
        or nullif(pg_catalog.btrim(v_detail.visit_consultation_place), '') is null
      )
    then
      raise exception 'registration_migration_visit_evidence_invalid' using errcode = '23514';
    end if;
    if v_target_status in ('consultation_waiting', 'visit_consultation_scheduled') then
      perform dashboard_private.assert_registration_track_director_ready(v_track.id);
    end if;
    if v_target_status = 'waiting' and v_waiting_kind = 'current_class' then
      perform 1
      from public.classes class
      where class.id = v_state_class_id
        and pg_catalog.btrim(class.subject) = v_track.subject;
      if not found then
        raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
      end if;
    end if;
    if v_target_status in ('enrollment_decided', 'enrollment_processing', 'registered') then
      if v_target_status in ('enrollment_processing', 'registered')
        and (
          v_task.student_id is distinct from v_legacy_student_id
          or v_student.id is null
          or pg_catalog.lower(
            pg_catalog.regexp_replace(coalesce(v_student.name, ''), '\s+', '', 'g')
          ) is distinct from pg_catalog.lower(
            pg_catalog.regexp_replace(coalesce(v_task.student_name, ''), '\s+', '', 'g')
          )
          or pg_catalog.regexp_replace(
            coalesce(v_student.parent_contact, ''), '\D+', '', 'g'
          ) is distinct from pg_catalog.regexp_replace(
            coalesce(v_detail.parent_phone, ''), '\D+', '', 'g'
          )
          or (
            nullif(pg_catalog.btrim(v_detail.school_name), '') is not null
            and v_student.school is distinct from v_detail.school_name
          )
          or (
            nullif(pg_catalog.btrim(v_detail.student_phone), '') is not null
            and pg_catalog.regexp_replace(
              coalesce(v_student.contact, ''), '\D+', '', 'g'
            ) is distinct from pg_catalog.regexp_replace(
              v_detail.student_phone, '\D+', '', 'g'
            )
          )
        )
      then
        raise exception 'registration_student_identity_mismatch' using errcode = '23514';
      end if;
      if v_target_status in ('enrollment_processing', 'registered')
        and exists (
          select 1
          from public.ops_registration_enrollments enrollment
          where enrollment.student_id = v_legacy_student_id
            and enrollment.class_id = v_legacy_class_id
            and enrollment.roster_active
        )
      then
        raise exception 'registration_student_class_already_active' using errcode = '23514';
      end if;
      if v_placement_track_id is distinct from v_track.id
        or v_class.id is null
        or pg_catalog.btrim(v_class.subject) is distinct from v_track.subject
        or (
          v_legacy_textbook_id is not null
          and not (coalesce(pg_catalog.to_jsonb(v_class.textbook_ids), '[]'::jsonb) ? v_legacy_textbook_id::text)
        )
        or (v_class_start_date is null) is distinct from (v_class_start_session is null)
      then
        raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
      end if;
      if v_class_start_date is not null then
        if v_class_start_session !~ '^[1-9][0-9]*회차$' then
          raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
        end if;
        v_session_key := v_class_start_date::text || ':'
          || substring(v_class_start_session from '^([1-9][0-9]*)회차$');
        v_session_validation := dashboard_private.validate_registration_class_session(
          v_class.id, v_class_start_date, v_session_key
        );
        if not coalesce((v_session_validation ->> 'valid')::boolean, false)
          or v_session_validation ->> 'sessionLabel' is distinct from v_class_start_session
        then
          raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
        end if;
      elsif v_target_status in ('enrollment_processing', 'registered') then
        raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
      end if;
    end if;
    if v_target_status = 'enrollment_processing' then
      if not (
        v_legacy_pipeline_status like '5-1.%'
        or v_legacy_pipeline_status like '6.%'
      )
        or v_student.id is null
        or v_student.status = '퇴원'
        or not v_admission_notice_sent
        or (v_legacy_pipeline_status like '6.%' and not v_makeedu_registered)
        or (v_invoice_sent and not v_makeedu_registered)
        or (v_payment_checked and not v_invoice_sent)
        or ((v_invoice_sent or v_payment_checked) and v_legacy_updated_at is null)
        or coalesce(v_student.class_ids, '[]'::jsonb) ? v_class.id::text
        or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_class.id::text
        or coalesce(v_class.student_ids, '[]'::jsonb) ? v_student.id::text
        or coalesce(v_class.waitlist_ids, '[]'::jsonb) ? v_student.id::text
      then
        raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
      end if;
    end if;
    if v_target_status = 'registered' then
      if not (v_legacy_pipeline_status like '7.%')
        or v_student.id is null
        or v_student.status <> '재원'
        or not coalesce((v_legacy_booleans ->> 'admissionNoticeSent')::boolean, false)
        or not coalesce((v_legacy_booleans ->> 'makeeduRegistered')::boolean, false)
        or not coalesce((v_legacy_booleans ->> 'makeeduInvoiceSent')::boolean, false)
        or not coalesce((v_legacy_booleans ->> 'paymentChecked')::boolean, false)
        or v_legacy_updated_at is null
        or not (coalesce(v_student.class_ids, '[]'::jsonb) ? v_class.id::text)
        or coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_class.id::text
        or not (coalesce(v_class.student_ids, '[]'::jsonb) ? v_student.id::text)
        or coalesce(v_class.waitlist_ids, '[]'::jsonb) ? v_student.id::text
      then
        raise exception 'registration_migration_placement_evidence_invalid' using errcode = '23514';
      end if;
    end if;
  end loop;

  -- migration_review_activity_creation
  for v_state in
    select state_item
    from pg_catalog.jsonb_array_elements(v_normalized_track_states) state_item
    order by state_item ->> 'trackId'
  loop
    select track.*
    into v_track
    from public.ops_registration_subject_tracks track
    where track.id = nullif(v_state ->> 'trackId', '')::uuid
      and track.task_id = p_task_id;
    v_target_status := v_state ->> 'targetStatus';
    v_waiting_kind := nullif(v_state ->> 'waitingKind', '');
    v_state_class_id := nullif(v_state ->> 'classId', '')::uuid;
    v_appointment_id := null;
    v_consultation_id := null;
    v_enrollment_id := null;
    v_batch_id := null;

    if v_target_status = 'level_test_scheduled' then
      insert into public.ops_registration_appointments(
        task_id, kind, scheduled_at, place, status, created_by
      ) values (
        p_task_id, 'level_test', v_level_test_at,
        pg_catalog.btrim(v_detail.level_test_place), 'scheduled', v_actor_id
      ) returning id into v_appointment_id;
      insert into public.ops_registration_level_tests(
        track_id, appointment_id, attempt_number, status
      ) values (
        v_track.id, v_appointment_id, 1, 'scheduled'
      );
    elsif v_target_status = 'consultation_waiting' then
      insert into public.ops_registration_consultations(
        track_id, appointment_id, mode, status, director_profile_id
      ) values (
        v_track.id, null, 'phone', 'waiting', v_track.director_profile_id
      ) returning id into v_consultation_id;
    elsif v_target_status = 'visit_consultation_scheduled' then
      insert into public.ops_registration_appointments(
        task_id, kind, scheduled_at, place, status, created_by
      ) values (
        p_task_id, 'visit_consultation', v_visit_consultation_at,
        pg_catalog.btrim(v_detail.visit_consultation_place), 'scheduled', v_actor_id
      ) returning id into v_appointment_id;
      insert into public.ops_registration_consultations(
        track_id, appointment_id, mode, status, director_profile_id
      ) values (
        v_track.id, v_appointment_id, 'visit', 'scheduled', v_track.director_profile_id
      ) returning id into v_consultation_id;
    elsif v_target_status = 'waiting' and v_waiting_kind = 'current_class' then
      perform dashboard_private.apply_registration_current_class_wait(
        p_task_id, v_track.id, v_state_class_id, v_actor_id
      );
      select enrollment.id
      into v_enrollment_id
      from public.ops_registration_enrollments enrollment
      where enrollment.track_id = v_track.id
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active;
    elsif v_target_status = 'enrollment_decided' then
      insert into public.ops_registration_enrollments(
        track_id, class_id, textbook_id, class_start_date,
        class_start_session_key, class_start_session, status,
        makeedu_registered, roster_active, sort_order
      ) values (
        v_track.id, v_legacy_class_id, v_legacy_textbook_id, v_class_start_date,
        v_session_key, v_class_start_session, 'planned', false, false, 0
      ) returning id into v_enrollment_id;
    elsif v_target_status in ('enrollment_processing', 'registered') then
      select coalesce(pg_catalog.max(batch.revision_number), 0) + 1
      into v_revision
      from public.ops_registration_admission_batches batch
      where batch.task_id = p_task_id;
      if v_target_status = 'registered' then
        v_batch_status := 'completed';
      elsif v_payment_checked then
        v_batch_status := 'paid';
      elsif v_invoice_sent then
        v_batch_status := 'invoiced';
      else
        v_batch_status := 'draft';
      end if;
      insert into public.ops_registration_admission_batches(
        task_id, revision_number, status, invoice_sent_at, payment_confirmed_at
      ) values (
        p_task_id,
        v_revision,
        v_batch_status,
        case when v_batch_status in ('invoiced', 'paid', 'completed') then v_legacy_updated_at end,
        case when v_batch_status in ('paid', 'completed') then v_legacy_updated_at end
      ) returning id into v_batch_id;
      insert into public.ops_registration_enrollments(
        track_id, student_id, admission_batch_id, class_id, textbook_id,
        class_start_date, class_start_session_key, class_start_session,
        status, makeedu_registered, roster_active, sort_order
      ) values (
        v_track.id, v_legacy_student_id, v_batch_id, v_legacy_class_id, v_legacy_textbook_id,
        v_class_start_date, v_session_key, v_class_start_session,
        case when v_target_status = 'registered' then 'enrolled' else 'planned' end,
        v_makeedu_registered,
        true,
        0
      ) returning id into v_enrollment_id;
    end if;

    -- migration_review_transition
    perform dashboard_private.transition_registration_track_status(
      v_track.id,
      v_target_status,
      case when v_target_status = 'waiting' then v_waiting_kind else null end,
      null,
      false
    );
    perform dashboard_private.write_registration_track_event(
      p_task_id,
      v_track.id,
      'migration_review_resolved',
      'migration_review',
      v_target_status,
      null,
      pg_catalog.jsonb_build_object(
        'assignments', v_normalized_assignments,
        'targetState', v_state,
        'levelTestTrackId', v_level_track_id,
        'consultationTrackId', v_consultation_track_id,
        'placementTrackId', v_placement_track_id,
        'appointmentId', v_appointment_id,
        'consultationId', v_consultation_id,
        'enrollmentId', v_enrollment_id,
        'batchId', v_batch_id,
        'legacyPipelineStatus', v_legacy_pipeline_status
      )
    );
  end loop;

  -- migration_review_parent_recompute
  perform dashboard_private.recompute_registration_parent(p_task_id);
  select pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'tracks', coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', track.id,
        'taskId', track.task_id,
        'subject', track.subject,
        'status', track.pipeline_status,
        'directorProfileId', track.director_profile_id,
        'waitingKind', track.waiting_kind,
        'migrationReviewRequired', track.migration_review_required,
        'stageEnteredAt', track.stage_entered_at
      ) order by case track.subject when '영어' then 0 when '수학' then 1 else 9 end, track.id
    ), '[]'::jsonb)
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id;

  -- migration_review_receipt_insert
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, p_task_id,
    'resolve_migration_review', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.resolve_registration_migration_review_impl(uuid, jsonb, text)
  owner to postgres;
revoke execute on function dashboard_private.resolve_registration_migration_review_impl(uuid, jsonb, text) from public, anon;
grant execute on function dashboard_private.resolve_registration_migration_review_impl(uuid, jsonb, text) to authenticated;

create function public.resolve_registration_migration_review(
  p_task_id uuid,
  p_assignments jsonb,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.resolve_registration_migration_review_impl(
    p_task_id, p_assignments, p_request_key
  );
$$;

revoke execute on function public.resolve_registration_migration_review(uuid, jsonb, text) from public, anon;
grant execute on function public.resolve_registration_migration_review(uuid, jsonb, text) to authenticated;

create function dashboard_private.reopen_registration_track_impl(
  p_track_id uuid,
  p_destination text,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_destination text := pg_catalog.lower(nullif(pg_catalog.btrim(p_destination), ''));
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_task_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_consultation_id uuid;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null or p_track_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'registration_reopen_reason_required' using errcode = '22023';
  end if;
  if v_destination is null or v_destination not in ('inquiry', 'consultation_waiting') then
    raise exception 'registration_reopen_destination_invalid' using errcode = '22023';
  end if;

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', p_track_id,
    'destination', v_destination,
    'reason', v_reason
  );

  -- reopen_track_actor_request_lock
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- reopen_track_task_detail_lock
  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- reopen_track_track_lock
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, p_track_id, 'reopen_track'
  );
  perform 1
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
  order by consultation.id
  for update;

  -- reopen_track_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'reopen_track'
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

  -- reopen_track_mutable_state_check
  if v_track.pipeline_status not in ('not_registered', 'inquiry_closed')
    or v_track.migration_review_required
  then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.ops_registration_admission_batches batch
    join public.ops_registration_enrollments enrollment
      on enrollment.admission_batch_id = batch.id
    where enrollment.track_id = p_track_id
      and batch.status not in ('completed', 'canceled')
  ) then
    raise exception 'registration_open_admission_batch' using errcode = '40001';
  end if;

  -- reopen_track_activity_creation
  if v_destination = 'consultation_waiting' then
    perform dashboard_private.assert_registration_track_director_ready(p_track_id);
    insert into public.ops_registration_consultations(
      track_id, appointment_id, mode, status, director_profile_id
    )
    select track.id, null, 'phone', 'waiting', track.director_profile_id
    from public.ops_registration_subject_tracks track
    where track.id = p_track_id
      and not exists (
        select 1
        from public.ops_registration_consultations consultation
        where consultation.track_id = track.id
          and consultation.status in ('waiting', 'scheduled')
      )
    returning id into v_consultation_id;
    if v_consultation_id is null then
      raise exception 'registration_active_consultation_conflict' using errcode = '40001';
    end if;
  end if;

  -- reopen_track_transition
  perform dashboard_private.transition_registration_track_status(
    p_track_id,
    v_destination,
    null,
    null,
    false
  );
  perform dashboard_private.write_registration_track_event(
    v_task_id,
    p_track_id,
    'track_reopened',
    v_track.pipeline_status,
    v_destination,
    v_reason,
    pg_catalog.jsonb_build_object('consultationId', v_consultation_id)
  );

  -- reopen_track_parent_recompute
  perform dashboard_private.recompute_registration_parent(v_task_id);
  select pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', track.id,
    'subject', track.subject,
    'status', track.pipeline_status,
    'directorProfileId', track.director_profile_id,
    'consultationId', v_consultation_id,
    'stageEnteredAt', track.stage_entered_at
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;

  -- reopen_track_receipt_insert
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id,
    'reopen_track', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.reopen_registration_track_impl(uuid, text, text, text)
  owner to postgres;
revoke execute on function dashboard_private.reopen_registration_track_impl(uuid, text, text, text) from public, anon;
grant execute on function dashboard_private.reopen_registration_track_impl(uuid, text, text, text) to authenticated;

create function public.reopen_registration_track(
  p_track_id uuid,
  p_destination text,
  p_reason text,
  p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.reopen_registration_track_impl(
    p_track_id, p_destination, p_reason, p_request_key
  );
$$;

revoke execute on function public.reopen_registration_track(uuid, text, text, text) from public, anon;
grant execute on function public.reopen_registration_track(uuid, text, text, text) to authenticated;

-- global_roster_gateway_lock
set local lock_timeout = '5s';
lock table public.students in share row exclusive mode;
lock table public.classes in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.students student
    cross join lateral (
      values (student.class_ids), (student.waitlist_class_ids)
    ) projection(value)
    where projection.value is not null
      and pg_catalog.jsonb_typeof(projection.value) is distinct from 'array'
  ) or exists (
    select 1
    from public.classes class
    cross join lateral (
      values (class.student_ids), (class.waitlist_ids)
    ) projection(value)
    where projection.value is not null
      and pg_catalog.jsonb_typeof(projection.value) is distinct from 'array'
  ) then
    raise exception 'registration_roster_projection_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.students student
    cross join lateral (
      values (coalesce(student.class_ids, '[]'::jsonb)),
             (coalesce(student.waitlist_class_ids, '[]'::jsonb))
    ) projection(value)
    cross join lateral pg_catalog.jsonb_array_elements(projection.value) element(value)
    where pg_catalog.jsonb_typeof(element.value) <> 'string'
      or (element.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) or exists (
    select 1
    from public.classes class
    cross join lateral (
      values (coalesce(class.student_ids, '[]'::jsonb)),
             (coalesce(class.waitlist_ids, '[]'::jsonb))
    ) projection(value)
    cross join lateral pg_catalog.jsonb_array_elements(projection.value) element(value)
    where pg_catalog.jsonb_typeof(element.value) <> 'string'
      or (element.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'registration_roster_projection_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.students student
    cross join lateral (
      values (coalesce(student.class_ids, '[]'::jsonb)),
             (coalesce(student.waitlist_class_ids, '[]'::jsonb))
    ) projection(value)
    cross join lateral pg_catalog.jsonb_array_elements(projection.value) element(value)
    where element.value #>> '{}' is distinct from ((element.value #>> '{}')::uuid)::text
  ) or exists (
    select 1
    from public.classes class
    cross join lateral (
      values (coalesce(class.student_ids, '[]'::jsonb)),
             (coalesce(class.waitlist_ids, '[]'::jsonb))
    ) projection(value)
    cross join lateral pg_catalog.jsonb_array_elements(projection.value) element(value)
    where element.value #>> '{}' is distinct from ((element.value #>> '{}')::uuid)::text
  ) then
    raise exception 'registration_roster_projection_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.students student
    cross join lateral (
      values (coalesce(student.class_ids, '[]'::jsonb)),
             (coalesce(student.waitlist_class_ids, '[]'::jsonb))
    ) projection(value)
    where pg_catalog.jsonb_array_length(projection.value) <> (
      select pg_catalog.count(distinct ((element.value #>> '{}')::uuid)::text)
      from pg_catalog.jsonb_array_elements(projection.value) element(value)
    )
  ) or exists (
    select 1
    from public.classes class
    cross join lateral (
      values (coalesce(class.student_ids, '[]'::jsonb)),
             (coalesce(class.waitlist_ids, '[]'::jsonb))
    ) projection(value)
    where pg_catalog.jsonb_array_length(projection.value) <> (
      select pg_catalog.count(distinct ((element.value #>> '{}')::uuid)::text)
      from pg_catalog.jsonb_array_elements(projection.value) element(value)
    )
  ) then
    raise exception 'registration_roster_projection_invalid' using errcode = '22023';
  end if;

  -- global_roster_canonical_order_preflight
  if exists (
    select 1
    from public.students student
    cross join lateral (
      values (coalesce(student.class_ids, '[]'::jsonb)),
             (coalesce(student.waitlist_class_ids, '[]'::jsonb))
    ) projection(value)
    where projection.value is distinct from (
      select coalesce(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(canonical.value) order by canonical.value),
        '[]'::jsonb
      )
      from (
        select ((element.value #>> '{}')::uuid)::text as value
        from pg_catalog.jsonb_array_elements(projection.value) element(value)
      ) canonical
    )
  ) or exists (
    select 1
    from public.classes class
    cross join lateral (
      values (coalesce(class.student_ids, '[]'::jsonb)),
             (coalesce(class.waitlist_ids, '[]'::jsonb))
    ) projection(value)
    where projection.value is distinct from (
      select coalesce(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(canonical.value) order by canonical.value),
        '[]'::jsonb
      )
      from (
        select ((element.value #>> '{}')::uuid)::text as value
        from pg_catalog.jsonb_array_elements(projection.value) element(value)
      ) canonical
    )
  ) then
    raise exception 'registration_roster_projection_invalid' using errcode = '22023';
  end if;

  -- global_roster_symmetry_preflight
  if exists (
    select 1
    from public.students student
    cross join lateral pg_catalog.jsonb_array_elements(coalesce(student.class_ids, '[]'::jsonb)) element(value)
    left join public.classes class on class.id = (element.value #>> '{}')::uuid
    where class.id is null
      or not (coalesce(class.student_ids, '[]'::jsonb) ? student.id::text)
      or coalesce(student.waitlist_class_ids, '[]'::jsonb) ? class.id::text
      or coalesce(class.waitlist_ids, '[]'::jsonb) ? student.id::text
  ) or exists (
    select 1
    from public.students student
    cross join lateral pg_catalog.jsonb_array_elements(coalesce(student.waitlist_class_ids, '[]'::jsonb)) element(value)
    left join public.classes class on class.id = (element.value #>> '{}')::uuid
    where class.id is null
      or not (coalesce(class.waitlist_ids, '[]'::jsonb) ? student.id::text)
      or coalesce(student.class_ids, '[]'::jsonb) ? class.id::text
      or coalesce(class.student_ids, '[]'::jsonb) ? student.id::text
  ) or exists (
    select 1
    from public.classes class
    cross join lateral pg_catalog.jsonb_array_elements(coalesce(class.student_ids, '[]'::jsonb)) element(value)
    left join public.students student on student.id = (element.value #>> '{}')::uuid
    where student.id is null
      or not (coalesce(student.class_ids, '[]'::jsonb) ? class.id::text)
  ) or exists (
    select 1
    from public.classes class
    cross join lateral pg_catalog.jsonb_array_elements(coalesce(class.waitlist_ids, '[]'::jsonb)) element(value)
    left join public.students student on student.id = (element.value #>> '{}')::uuid
    where student.id is null
      or not (coalesce(student.waitlist_class_ids, '[]'::jsonb) ? class.id::text)
  ) then
    raise exception 'registration_global_roster_repair_required' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.students student
    where student.status = '퇴원'
      and (
        pg_catalog.jsonb_array_length(coalesce(student.class_ids, '[]'::jsonb)) > 0
        or pg_catalog.jsonb_array_length(coalesce(student.waitlist_class_ids, '[]'::jsonb)) > 0
        or exists (
          select 1 from public.classes class
          where coalesce(class.student_ids, '[]'::jsonb) ? student.id::text
            or coalesce(class.waitlist_ids, '[]'::jsonb) ? student.id::text
        )
        or exists (
          select 1 from public.ops_registration_enrollments enrollment
          where enrollment.student_id = student.id
            and enrollment.roster_active
        )
      )
  ) then
    raise exception 'registration_withdrawn_roster_review_required' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.ops_tasks task
    where task.type = 'registration'
      and (
        (select pg_catalog.count(*) from public.ops_registration_details detail where detail.task_id = task.id) <> 1
        or (select pg_catalog.count(*) from public.ops_registration_subject_tracks track where track.task_id = task.id) not in (1, 2)
        or task.subject is distinct from (
          select pg_catalog.string_agg(track.subject, ', ' order by
            case track.subject when '영어' then 0 when '수학' then 1 else 9 end,
            track.id
          )
          from public.ops_registration_subject_tracks track
          where track.task_id = task.id
        )
        or exists (
          select 1
          from public.ops_registration_subject_tracks track
          where track.task_id = task.id
            and track.subject not in ('영어', '수학')
        )
      )
  ) or exists (
    select 1
    from public.ops_registration_details detail
    join public.ops_tasks task on task.id = detail.task_id
    where task.type <> 'registration'
  ) or exists (
    select 1
    from public.ops_registration_subject_tracks track
    join public.ops_tasks task on task.id = track.task_id
    where task.type <> 'registration'
  ) then
    raise exception 'registration_subject_track_coverage_mismatch' using errcode = '23514';
  end if;
end;
$$;

drop trigger if exists prevent_ops_roster_completion_bypass on public.ops_tasks;
create trigger prevent_ops_roster_completion_bypass
before insert or update of type, status on public.ops_tasks
for each row execute function dashboard_private.prevent_ops_roster_completion_bypass();

drop trigger if exists prevent_ops_roster_completion_bypass on public.ops_withdrawal_details;
create trigger prevent_ops_roster_completion_bypass
before insert or update of timetable_roster_updated on public.ops_withdrawal_details
for each row execute function dashboard_private.prevent_ops_roster_completion_bypass();

drop trigger if exists prevent_ops_roster_completion_bypass on public.ops_transfer_details;
create trigger prevent_ops_roster_completion_bypass
before insert or update of timetable_roster_updated on public.ops_transfer_details
for each row execute function dashboard_private.prevent_ops_roster_completion_bypass();

drop trigger if exists prevent_direct_student_roster_insert on public.students;
create trigger prevent_direct_student_roster_insert
before insert on public.students
for each row execute function dashboard_private.prevent_direct_roster_array_write();

drop trigger if exists prevent_direct_class_roster_insert on public.classes;
create trigger prevent_direct_class_roster_insert
before insert on public.classes
for each row execute function dashboard_private.prevent_direct_roster_array_write();

drop trigger if exists prevent_direct_student_roster_array_write on public.students;
create trigger prevent_direct_student_roster_array_write
before update of class_ids, waitlist_class_ids on public.students
for each row execute function dashboard_private.prevent_direct_roster_array_write();

drop trigger if exists prevent_direct_class_roster_array_write on public.classes;
create trigger prevent_direct_class_roster_array_write
before update of student_ids, waitlist_ids on public.classes
for each row execute function dashboard_private.prevent_direct_roster_array_write();

drop trigger if exists prevent_direct_student_status_write on public.students;
create trigger prevent_direct_student_status_write
before update of status on public.students
for each row execute function dashboard_private.prevent_direct_student_status_write();

drop trigger if exists prevent_linked_student_delete on public.students;
create trigger prevent_linked_student_delete
before delete on public.students
for each row execute function dashboard_private.prevent_linked_roster_entity_delete();

drop trigger if exists prevent_linked_class_delete on public.classes;
create trigger prevent_linked_class_delete
before delete on public.classes
for each row execute function dashboard_private.prevent_linked_roster_entity_delete();

drop policy if exists student_class_enrollment_history_staff_write
  on public.student_class_enrollment_history;
revoke all on table public.student_class_enrollment_history from anon, authenticated;
grant select on table public.student_class_enrollment_history to authenticated;

create function public.registration_subject_tracks_runtime_version()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select 1;
$$;

alter function public.registration_subject_tracks_runtime_version() owner to postgres;
revoke execute on function public.registration_subject_tracks_runtime_version() from public, anon;
grant execute on function public.registration_subject_tracks_runtime_version() to authenticated;

commit;
