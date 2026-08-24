begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A class close is not a withdrawal. Canonical enrolled claims retain their
-- historical enrollment row, but release the live roster without a source
-- operations task. Waitlist claims become canceled historical rows.
do $migration$
declare
  v_kind_constraints text[];
  v_state_constraints text[];
  v_constraint_name text;
begin
  select coalesce(pg_catalog.array_agg(constraint_row.conname), '{}'::text[])
  into v_kind_constraints
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.ops_registration_enrollments'::pg_catalog.regclass
    and constraint_row.contype = 'c'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%roster_release_kind%'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) not ilike '%roster_active%';

  select coalesce(pg_catalog.array_agg(constraint_row.conname), '{}'::text[])
  into v_state_constraints
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.ops_registration_enrollments'::pg_catalog.regclass
    and constraint_row.contype = 'c'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%roster_release_kind%'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%roster_active%'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%admission_batch_id%';

  if pg_catalog.cardinality(v_kind_constraints) <> 1
    or pg_catalog.cardinality(v_state_constraints) <> 1
  then
    raise exception 'class_close_enrollment_constraint_contract_missing'
      using errcode = '55000';
  end if;

  foreach v_constraint_name in array v_state_constraints
  loop
    execute pg_catalog.format(
      'alter table public.ops_registration_enrollments drop constraint %I',
      v_constraint_name
    );
  end loop;
  foreach v_constraint_name in array v_kind_constraints
  loop
    execute pg_catalog.format(
      'alter table public.ops_registration_enrollments drop constraint %I',
      v_constraint_name
    );
  end loop;
end
$migration$;

alter table public.ops_registration_enrollments
  add constraint ops_registration_enrollments_roster_release_kind_check
  check (
    roster_release_kind is null
    or roster_release_kind in ('withdrawal', 'transfer', 'class_close')
  ) not valid;

alter table public.ops_registration_enrollments
  add constraint ops_registration_enrollments_roster_state_check_v2
  check (
    (
      status = 'planned'
      and admission_batch_id is null
      and student_id is null
      and not roster_active
      and roster_released_at is null
      and roster_release_reason is null
      and roster_release_source_task_id is null
      and roster_release_kind is null
    )
    or (
      status = 'planned'
      and admission_batch_id is not null
      and student_id is not null
      and roster_active
      and roster_released_at is null
      and roster_release_reason is null
      and roster_release_source_task_id is null
      and roster_release_kind is null
    )
    or (
      status = 'waitlisted'
      and admission_batch_id is null
      and student_id is not null
      and roster_active
      and roster_released_at is null
      and roster_release_reason is null
      and roster_release_source_task_id is null
      and roster_release_kind is null
    )
    or (
      status = 'enrolled'
      and admission_batch_id is not null
      and student_id is not null
      and (
        (
          roster_active
          and roster_released_at is null
          and roster_release_reason is null
          and roster_release_source_task_id is null
          and roster_release_kind is null
        )
        or (
          not roster_active
          and roster_released_at is not null
          and nullif(pg_catalog.btrim(roster_release_reason), '') is not null
          and (
            (
              roster_release_kind in ('withdrawal', 'transfer')
              and roster_release_source_task_id is not null
            )
            or (
              roster_release_kind = 'class_close'
              and roster_release_source_task_id is null
            )
          )
        )
      )
    )
    or (
      status = 'canceled'
      and not roster_active
      and roster_released_at is null
      and roster_release_reason is null
      and roster_release_source_task_id is null
      and roster_release_kind is null
    )
  ) not valid;

create or replace function dashboard_private.prevent_direct_class_close_write_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_atomic_close boolean := current_user = 'postgres'
    and coalesce(
      pg_catalog.current_setting('app.class_close_mutation', true),
      ''
    ) = 'v1';
begin
  if tg_op = 'INSERT' then
    if not v_atomic_close
      and (
        new.status = '종강'
        or new.closed_at is not null
        or new.closed_by is not null
      )
    then
      raise exception 'class_close_requires_rpc' using errcode = '42501';
    end if;
    return new;
  end if;

  if (
      new.student_ids is distinct from old.student_ids
      or new.waitlist_ids is distinct from old.waitlist_ids
    )
    and (
      old.closed_at is not null
      or (old.status = '종강' and not v_atomic_close)
    )
  then
    raise exception 'class_roster_closed' using errcode = '23514';
  end if;

  if not v_atomic_close
    and (
      (
        new.status is distinct from old.status
        and (new.status = '종강' or old.status = '종강')
      )
      or new.closed_at is distinct from old.closed_at
      or new.closed_by is distinct from old.closed_by
    )
  then
    raise exception 'class_close_requires_rpc' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists class_close_requires_atomic_rpc on public.classes;
create trigger class_close_requires_atomic_rpc
before insert or update on public.classes
for each row
execute function dashboard_private.prevent_direct_class_close_write_v1();

create or replace function public.close_class_atomic_v1(
  p_class_id uuid,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_operation constant text := 'close_class_atomic_v1';
  v_request_hash text;
  v_replay jsonb;
  v_response jsonb;
  v_class public.classes%rowtype;
  v_pre_status text;
  v_pre_class_students jsonb;
  v_pre_class_waitlists jsonb;
  v_pre_claims jsonb;
  v_current_claims jsonb;
  v_enrolled_student_ids uuid[] := '{}'::uuid[];
  v_waitlist_student_ids uuid[] := '{}'::uuid[];
  v_member_student_ids uuid[] := '{}'::uuid[];
  v_lock_student_ids uuid[] := '{}'::uuid[];
  v_parent_task_ids uuid[] := '{}'::uuid[];
  v_track_ids uuid[] := '{}'::uuid[];
  v_batch_ids uuid[] := '{}'::uuid[];
  v_recomputed_parent_ids uuid[] := '{}'::uuid[];
  v_released_enrollment_ids uuid[] := '{}'::uuid[];
  v_canceled_waitlist_ids uuid[] := '{}'::uuid[];
  v_student_id uuid;
  v_parent_id uuid;
  v_mode text;
  v_claim public.ops_registration_enrollments%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_claim_found boolean;
  v_student_count integer;
  v_closed_at timestamptz;
  v_previous_class_close_context text := coalesce(
    pg_catalog.current_setting('app.class_close_mutation', true),
    ''
  );
begin
  v_actor_id := dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  if p_class_id is null or p_request_key is null then
    raise exception 'class_close_input_invalid' using errcode = '22023';
  end if;

  v_request_hash := dashboard_private.continuous_class_schedule_hash_v1(
    pg_catalog.jsonb_build_object('classId', p_class_id)
  );
  v_replay := dashboard_private.continuous_class_schedule_request_replay_v1(
    v_operation,
    p_request_key,
    v_request_hash
  );
  if v_replay is not null then
    return v_replay;
  end if;

  select class_row.*
  into v_class
  from public.classes class_row
  where class_row.id = p_class_id;
  if not found then
    raise exception 'class_close_not_found' using errcode = 'P0002';
  end if;

  v_pre_status := v_class.status;
  v_pre_class_students := coalesce(v_class.student_ids, '[]'::jsonb);
  v_pre_class_waitlists := coalesce(v_class.waitlist_ids, '[]'::jsonb);
  if pg_catalog.jsonb_typeof(v_pre_class_students) <> 'array'
    or pg_catalog.jsonb_typeof(v_pre_class_waitlists) <> 'array'
  then
    raise exception 'class_close_roster_invalid' using errcode = '23514';
  end if;
  if exists (
    select 1
    from (
      select element.value
      from pg_catalog.jsonb_array_elements(v_pre_class_students) element(value)
      union all
      select element.value
      from pg_catalog.jsonb_array_elements(v_pre_class_waitlists) element(value)
    ) roster_element
    where pg_catalog.jsonb_typeof(roster_element.value) <> 'string'
      or (roster_element.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'class_close_roster_invalid' using errcode = '23514';
  end if;

  select coalesce(
    pg_catalog.array_agg(roster_id order by roster_id),
    '{}'::uuid[]
  )
  into v_enrolled_student_ids
  from (
    select (element.value #>> '{}')::uuid as roster_id
    from pg_catalog.jsonb_array_elements(v_pre_class_students) element(value)
  ) roster;
  select coalesce(
    pg_catalog.array_agg(roster_id order by roster_id),
    '{}'::uuid[]
  )
  into v_waitlist_student_ids
  from (
    select (element.value #>> '{}')::uuid as roster_id
    from pg_catalog.jsonb_array_elements(v_pre_class_waitlists) element(value)
  ) roster;

  if pg_catalog.cardinality(v_enrolled_student_ids)
      <> pg_catalog.cardinality(
        array(select distinct member_id from pg_catalog.unnest(v_enrolled_student_ids) member_id)
      )
    or pg_catalog.cardinality(v_waitlist_student_ids)
      <> pg_catalog.cardinality(
        array(select distinct member_id from pg_catalog.unnest(v_waitlist_student_ids) member_id)
      )
    or exists (
      select 1
      from pg_catalog.unnest(v_enrolled_student_ids) enrolled_id
      where enrolled_id = any(v_waitlist_student_ids)
    )
  then
    raise exception 'class_close_roster_invalid' using errcode = '23514';
  end if;

  select coalesce(
    pg_catalog.array_agg(member_id order by member_id),
    '{}'::uuid[]
  )
  into v_member_student_ids
  from (
    select member_id from pg_catalog.unnest(v_enrolled_student_ids) member_id
    union
    select member_id from pg_catalog.unnest(v_waitlist_student_ids) member_id
  ) members;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(enrollment) order by enrollment.id),
    '[]'::jsonb
  )
  into v_pre_claims
  from public.ops_registration_enrollments enrollment
  where enrollment.class_id = p_class_id;

  select coalesce(
    pg_catalog.array_agg(distinct track.task_id order by track.task_id),
    '{}'::uuid[]
  ), coalesce(
    pg_catalog.array_agg(distinct enrollment.track_id order by enrollment.track_id),
    '{}'::uuid[]
  ), coalesce(
    pg_catalog.array_agg(distinct enrollment.admission_batch_id order by enrollment.admission_batch_id)
      filter (where enrollment.admission_batch_id is not null),
    '{}'::uuid[]
  )
  into v_parent_task_ids, v_track_ids, v_batch_ids
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where enrollment.class_id = p_class_id;

  select coalesce(
    pg_catalog.array_agg(student_id order by student_id),
    '{}'::uuid[]
  )
  into v_lock_student_ids
  from (
    select member_id as student_id
    from pg_catalog.unnest(v_member_student_ids) member_id
    union
    select enrollment.student_id
    from public.ops_registration_enrollments enrollment
    where enrollment.class_id = p_class_id
      and enrollment.roster_active
      and enrollment.student_id is not null
    union
    select student.id
    from public.students student
    where coalesce(student.class_ids, '[]'::jsonb) ? p_class_id::text
      or coalesce(student.waitlist_class_ids, '[]'::jsonb) ? p_class_id::text
  ) students_to_lock;

  perform 1
  from public.ops_tasks task
  where task.id = any(v_parent_task_ids)
  order by task.id
  for update;
  perform 1
  from public.ops_registration_subject_tracks track
  where track.id = any(v_track_ids)
  order by track.id
  for update;
  perform 1
  from public.students student
  where student.id = any(v_lock_student_ids)
  order by student.id
  for update;
  perform 1
  from public.ops_registration_admission_batches batch
  where batch.id = any(v_batch_ids)
  order by batch.id
  for update;
  perform 1
  from public.ops_registration_enrollments enrollment
  where enrollment.class_id = p_class_id
  order by enrollment.id
  for update;

  select class_row.*
  into v_class
  from public.classes class_row
  where class_row.id = p_class_id
  for update;
  if not found then
    raise exception 'class_close_not_found' using errcode = 'P0002';
  end if;
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(enrollment) order by enrollment.id),
    '[]'::jsonb
  )
  into v_current_claims
  from public.ops_registration_enrollments enrollment
  where enrollment.class_id = p_class_id;

  if v_class.status is distinct from v_pre_status
    or coalesce(v_class.student_ids, '[]'::jsonb) is distinct from v_pre_class_students
    or coalesce(v_class.waitlist_ids, '[]'::jsonb) is distinct from v_pre_class_waitlists
    or v_current_claims is distinct from v_pre_claims
  then
    raise exception 'class_close_refresh_required' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.students student
    where (
      coalesce(student.class_ids, '[]'::jsonb) ? p_class_id::text
      or coalesce(student.waitlist_class_ids, '[]'::jsonb) ? p_class_id::text
    )
      and not (student.id = any(v_member_student_ids))
  ) then
    raise exception 'class_close_roster_invalid' using errcode = '23514';
  end if;
  if v_class.closed_at is not null or v_class.closed_by is not null then
    raise exception 'class_already_closed' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.ops_registration_enrollments enrollment
    left join public.ops_registration_admission_batches batch
      on batch.id = enrollment.admission_batch_id
    where enrollment.class_id = p_class_id
      and (
        enrollment.status = 'planned'
        or (
          enrollment.admission_batch_id is not null
          and batch.status not in ('completed', 'canceled')
        )
      )
  ) then
    raise exception 'class_close_open_admission_batch' using errcode = '23514';
  end if;

  select pg_catalog.count(*)::integer
  into v_student_count
  from public.students student
  where student.id = any(v_member_student_ids);
  if v_student_count <> pg_catalog.cardinality(v_member_student_ids)
    or exists (
      select 1
      from public.ops_registration_enrollments enrollment
      where enrollment.class_id = p_class_id
        and enrollment.roster_active
        and (
          enrollment.student_id is null
          or not (enrollment.student_id = any(v_member_student_ids))
        )
    )
  then
    raise exception 'class_close_roster_invalid' using errcode = '23514';
  end if;

  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    p_class_id,
    p_request_key,
    v_operation,
    'class_closed'
  );
  perform pg_catalog.set_config('app.class_close_mutation', 'v1', true);

  foreach v_student_id in array v_member_student_ids
  loop
    v_mode := case
      when v_student_id = any(v_enrolled_student_ids) then 'enrolled'
      else 'waitlist'
    end;

    if not exists (
      select 1
      from public.students student
      where student.id = v_student_id
        and pg_catalog.jsonb_typeof(coalesce(student.class_ids, '[]'::jsonb)) = 'array'
        and pg_catalog.jsonb_typeof(coalesce(student.waitlist_class_ids, '[]'::jsonb)) = 'array'
        and (
          (
            v_mode = 'enrolled'
            and coalesce(student.class_ids, '[]'::jsonb) ? p_class_id::text
            and not (coalesce(student.waitlist_class_ids, '[]'::jsonb) ? p_class_id::text)
          )
          or (
            v_mode = 'waitlist'
            and coalesce(student.waitlist_class_ids, '[]'::jsonb) ? p_class_id::text
            and not (coalesce(student.class_ids, '[]'::jsonb) ? p_class_id::text)
          )
        )
    ) then
      raise exception 'class_close_roster_invalid' using errcode = '23514';
    end if;

    select enrollment.*
    into v_claim
    from public.ops_registration_enrollments enrollment
    where enrollment.class_id = p_class_id
      and enrollment.student_id = v_student_id
      and enrollment.roster_active;
    v_claim_found := found;
    if v_claim_found
      and (
        (v_mode = 'enrolled' and v_claim.status <> 'enrolled')
        or (v_mode = 'waitlist' and v_claim.status <> 'waitlisted')
      )
    then
      raise exception 'class_close_roster_invalid' using errcode = '23514';
    end if;

    perform dashboard_private.apply_student_class_roster_mode(
      v_student_id,
      p_class_id,
      'removed',
      v_mode,
      case when v_claim_found then v_claim.id else null end,
      'class_closed',
      v_actor_id
    );

    if v_claim_found and v_mode = 'enrolled' then
      update public.ops_registration_enrollments enrollment
      set
        status = 'enrolled',
        roster_active = false,
        roster_released_at = pg_catalog.now(),
        roster_release_reason = 'class_closed',
        roster_release_source_task_id = null,
        roster_release_kind = 'class_close',
        updated_at = pg_catalog.now()
      where enrollment.id = v_claim.id
        and enrollment.status = 'enrolled'
        and enrollment.roster_active;
      if not found then
        raise exception 'class_close_roster_invalid' using errcode = '23514';
      end if;
      v_released_enrollment_ids := pg_catalog.array_append(
        v_released_enrollment_ids,
        v_claim.id
      );
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
        'class_closed',
        pg_catalog.jsonb_build_object(
          'enrollmentId', v_claim.id,
          'sourceTaskId', null,
          'releaseKind', 'class_close',
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
      v_recomputed_parent_ids := pg_catalog.array_append(
        v_recomputed_parent_ids,
        v_track.task_id
      );
    elsif v_claim_found and v_mode = 'waitlist' then
      update public.ops_registration_enrollments enrollment
      set
        status = 'canceled',
        roster_active = false,
        roster_released_at = null,
        roster_release_reason = null,
        roster_release_source_task_id = null,
        roster_release_kind = null,
        updated_at = pg_catalog.now()
      where enrollment.id = v_claim.id
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active;
      if not found then
        raise exception 'class_close_roster_invalid' using errcode = '23514';
      end if;
      v_canceled_waitlist_ids := pg_catalog.array_append(
        v_canceled_waitlist_ids,
        v_claim.id
      );
      select track.*
      into v_track
      from public.ops_registration_subject_tracks track
      where track.id = v_claim.track_id;
      if v_track.pipeline_status <> 'waiting'
        or v_track.waiting_kind <> 'current_class'
      then
        raise exception 'class_close_roster_invalid' using errcode = '23514';
      end if;
      perform dashboard_private.transition_registration_track_status(
        v_track.id,
        'not_registered',
        null,
        null,
        false
      );
      perform dashboard_private.write_registration_track_event(
        v_track.task_id,
        v_track.id,
        'registration_waitlist_canceled_by_class_close',
        'waiting',
        'not_registered',
        'class_closed',
        pg_catalog.jsonb_build_object(
          'enrollmentId', v_claim.id,
          'releaseKind', 'class_close'
        )
      );
      v_recomputed_parent_ids := pg_catalog.array_append(
        v_recomputed_parent_ids,
        v_track.task_id
      );
    end if;
  end loop;

  select class_row.*
  into v_class
  from public.classes class_row
  where class_row.id = p_class_id;
  if pg_catalog.jsonb_array_length(coalesce(v_class.student_ids, '[]'::jsonb)) <> 0
    or pg_catalog.jsonb_array_length(coalesce(v_class.waitlist_ids, '[]'::jsonb)) <> 0
  then
    raise exception 'class_close_roster_invalid' using errcode = '23514';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct parent_id order by parent_id),
    '{}'::uuid[]
  )
  into v_recomputed_parent_ids
  from pg_catalog.unnest(v_recomputed_parent_ids) parent_id;
  foreach v_parent_id in array v_recomputed_parent_ids
  loop
    perform dashboard_private.recompute_registration_parent(v_parent_id);
  end loop;

  v_closed_at := pg_catalog.now();
  update public.classes
  set
    status = '종강',
    closed_at = v_closed_at,
    closed_by = v_actor_id
  where id = p_class_id
    and closed_at is null
    and closed_by is null
  returning * into v_class;
  if not found then
    raise exception 'class_already_closed' using errcode = '23514';
  end if;
  perform pg_catalog.set_config(
    'app.class_close_mutation',
    v_previous_class_close_context,
    true
  );

  v_response := pg_catalog.jsonb_build_object(
    'id', p_class_id,
    'classId', p_class_id,
    'status', '종강',
    'closedAt', v_closed_at,
    'removedStudentCount', pg_catalog.cardinality(v_member_student_ids),
    'removedEnrolledCount', pg_catalog.cardinality(v_enrolled_student_ids),
    'removedWaitlistCount', pg_catalog.cardinality(v_waitlist_student_ids),
    'releasedEnrollmentIds', pg_catalog.to_jsonb(v_released_enrollment_ids),
    'canceledWaitlistEnrollmentIds', pg_catalog.to_jsonb(v_canceled_waitlist_ids)
  );
  return dashboard_private.record_continuous_class_schedule_receipt_v1(
    v_operation,
    p_request_key,
    v_request_hash,
    v_response
  );
end;
$$;

alter function dashboard_private.prevent_direct_class_close_write_v1()
  owner to postgres;
alter function public.close_class_atomic_v1(uuid, uuid)
  owner to postgres;

revoke all on function dashboard_private.prevent_direct_class_close_write_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.close_class_atomic_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.close_class_atomic_v1(uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
