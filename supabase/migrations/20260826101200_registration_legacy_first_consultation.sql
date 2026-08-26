begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $registration_legacy_first_consultation_dependencies$
declare
  v_definition text;
  v_trigger_count bigint;
begin
  if pg_catalog.to_regprocedure(
    'dashboard_private.create_registration_first_consultation_task_v1()'
  ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.registration_observation_effective_legacy_slots_v1(uuid)'
    ) is null
    or pg_catalog.to_regclass(
      'dashboard_private.registration_first_consultation_task_links'
    ) is null
  then
    raise exception 'registration_legacy_first_consultation_dependency_missing'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(
    'dashboard_private.create_registration_first_consultation_task_v1()'::regprocedure
  )
  into v_definition;
  if pg_catalog.strpos(
      v_definition,
      'if new.class_start_lesson_session_id is null then'
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      'profiles.teacher_catalog_id = lesson.teacher_catalog_id'
    ) = 0
  then
    raise exception 'registration_legacy_first_consultation_dependency_drift'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*)
  into v_trigger_count
  from pg_catalog.pg_trigger trigger
  join pg_catalog.pg_attribute status_attribute
    on status_attribute.attrelid = trigger.tgrelid
    and status_attribute.attname = 'status'
    and not status_attribute.attisdropped
  where trigger.tgrelid = 'public.ops_registration_enrollments'::pg_catalog.regclass
    and trigger.tgname = 'create_registration_first_consultation_task_v1'
    and not trigger.tgisinternal
    and trigger.tgenabled = 'O'
    and trigger.tgtype = 17
    and pg_catalog.cardinality(trigger.tgattr::smallint[]) = 1
    and status_attribute.attnum = any(trigger.tgattr::smallint[])
    and trigger.tgqual is null
    and trigger.tgnargs = 0
    and trigger.tgfoid =
      'dashboard_private.create_registration_first_consultation_task_v1()'::pg_catalog.regprocedure;
  if v_trigger_count <> 1 then
    raise exception 'registration_legacy_first_consultation_trigger_drift'
      using errcode = '55000';
  end if;
end;
$registration_legacy_first_consultation_dependencies$;

alter table dashboard_private.registration_first_consultation_task_links
  alter column class_lesson_session_id drop not null;

comment on column dashboard_private.registration_first_consultation_task_links.class_lesson_session_id
  is 'Normalized first-session authority; null for a legacy or shadow schedule resolved from its single effective weekday slot.';

create or replace function dashboard_private.create_registration_first_consultation_task_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_track public.ops_registration_subject_tracks%rowtype;
  v_parent public.ops_tasks%rowtype;
  v_class public.classes%rowtype;
  lesson public.class_lesson_sessions%rowtype;
  v_teacher_catalog_id uuid;
  v_teacher_profile_id uuid;
  v_teacher_count integer;
  v_legacy_slot_count integer;
  v_first_lesson_end_time time;
  v_first_lesson_end timestamptz;
  v_task_id uuid;
begin
  if not (new.status = 'enrolled' and old.status is distinct from 'enrolled') then
    return new;
  end if;

  select track.*
  into strict v_track
  from public.ops_registration_subject_tracks track
  where track.id = new.track_id;
  select task.*
  into strict v_parent
  from public.ops_tasks task
  where task.id = v_track.task_id;
  select class.*
  into strict v_class
  from public.classes class
  where class.id = new.class_id;

  if new.class_start_lesson_session_id is not null then
    select session.*
    into strict lesson
    from public.class_lesson_sessions session
    where session.id = new.class_start_lesson_session_id
      and session.class_id = new.class_id;
    v_teacher_catalog_id := lesson.teacher_catalog_id;
    v_first_lesson_end_time := lesson.end_time;
  elsif v_class.schedule_storage_mode in ('legacy', 'shadow')
    and new.class_start_date is not null
  then
    begin
      select
        pg_catalog.count(*)::integer,
        (pg_catalog.array_agg(
          slot.teacher_catalog_id
          order by slot.sort_order, slot.start_time, slot.id
        ))[1],
        (pg_catalog.array_agg(
          slot.end_time
          order by slot.sort_order, slot.start_time, slot.id
        ))[1]
      into
        v_legacy_slot_count,
        v_teacher_catalog_id,
        v_first_lesson_end_time
      from dashboard_private.registration_observation_effective_legacy_slots_v1(
        new.class_id
      ) slot
      where slot.weekday = extract(dow from new.class_start_date)::smallint;
    exception
      when sqlstate '22023' then
        raise exception 'registration_first_consultation_assignee_required'
          using errcode = '55000';
    end;

    if v_legacy_slot_count <> 1 then
      raise exception 'registration_first_consultation_assignee_required'
        using errcode = '55000';
    end if;
  else
    raise exception 'registration_first_consultation_assignee_required'
      using errcode = '55000';
  end if;

  select
    (pg_catalog.array_agg(profiles.id order by profiles.id))[1],
    pg_catalog.count(*)::integer
  into v_teacher_profile_id, v_teacher_count
  from public.profiles profiles
  where profiles.teacher_catalog_id = v_teacher_catalog_id
    and profiles.role = 'teacher';
  if v_teacher_count <> 1 or v_first_lesson_end_time is null then
    raise exception 'registration_first_consultation_assignee_required'
      using errcode = '55000';
  end if;

  v_first_lesson_end := (
    new.class_start_date + v_first_lesson_end_time
  ) at time zone 'Asia/Seoul';

  select link.task_id
  into v_task_id
  from dashboard_private.registration_first_consultation_task_links link
  where link.enrollment_id = new.id
  for update;
  if found then
    update dashboard_private.registration_first_consultation_task_links link
    set class_lesson_session_id = new.class_start_lesson_session_id
    where link.enrollment_id = new.id;

    update public.ops_tasks task
    set
      title = '신규 등록 학부모 첫 상담 · '
        || coalesce(v_parent.student_name, '학생')
        || ' · '
        || v_track.subject,
      status = case
        when task.status = 'canceled' then 'requested'
        else task.status
      end,
      assignee_id = v_teacher_profile_id,
      student_id = new.student_id,
      class_id = new.class_id,
      student_name = v_parent.student_name,
      class_name = v_class.name,
      subject = v_track.subject,
      start_at = v_first_lesson_end,
      due_at = v_first_lesson_end + interval '24 hours',
      completed_at = case
        when task.status = 'canceled' then null
        else task.completed_at
      end,
      updated_at = pg_catalog.clock_timestamp()
    where task.id = v_task_id
      and task.status <> 'done';
    return new;
  end if;

  insert into public.ops_tasks(
    title,
    type,
    status,
    priority,
    requested_by,
    assignee_id,
    student_id,
    class_id,
    student_name,
    class_name,
    subject,
    start_at,
    due_at,
    memo
  ) values (
    '신규 등록 학부모 첫 상담 · '
      || coalesce(v_parent.student_name, '학생')
      || ' · '
      || v_track.subject,
    'general',
    'requested',
    'normal',
    coalesce(auth.uid(), v_track.director_profile_id),
    v_teacher_profile_id,
    new.student_id,
    new.class_id,
    v_parent.student_name,
    v_class.name,
    v_track.subject,
    v_first_lesson_end,
    v_first_lesson_end + interval '24 hours',
    '첫 수업 후 학부모님께 문자 또는 전화로 수업 상황을 안내하고, 앞으로 잘 부탁드린다는 인사를 전해주세요.'
  ) returning id into v_task_id;

  insert into dashboard_private.registration_first_consultation_task_links(
    enrollment_id,
    task_id,
    class_lesson_session_id
  ) values (
    new.id,
    v_task_id,
    new.class_start_lesson_session_id
  );
  return new;
end;
$$;

alter function dashboard_private.create_registration_first_consultation_task_v1()
  owner to postgres;
revoke all on function dashboard_private.create_registration_first_consultation_task_v1()
  from public, anon, authenticated, service_role;

commit;
