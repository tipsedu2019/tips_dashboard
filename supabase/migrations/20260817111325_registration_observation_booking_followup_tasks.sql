begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function dashboard_private.sync_registration_observation_feedback_task_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_parent public.ops_tasks%rowtype;
  v_task_id uuid;
  v_feedback_was_missing boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_feedback_was_missing := old.feedback_submitted_at is null;
  end if;

  select task.*
  into strict v_parent
  from public.ops_tasks task
  where task.id = new.task_id;

  if new.status = 'scheduled' and not exists (
    select 1
    from dashboard_private.registration_observation_feedback_tasks link
    where link.observation_id = new.id
  ) then
    insert into public.ops_tasks(
      title, type, status, priority, requested_by, assignee_id, student_id,
      class_id, student_name, class_name, subject, start_at, due_at, memo
    ) values (
      '청강 피드백 작성 · ' || coalesce(v_parent.student_name, '학생') || ' · ' || new.subject,
      'general', 'requested', 'normal',
      coalesce(
        (select auth.uid()),
        new.attendance_recorded_by,
        v_parent.requested_by,
        v_parent.assignee_id,
        new.teacher_profile_id
      ),
      new.teacher_profile_id, v_parent.student_id, new.class_id, v_parent.student_name,
      new.class_name_snapshot, new.subject, new.ends_at, new.ends_at + interval '24 hours',
      '청강 수업 적합도와 피드백 사유를 등록 화면에서 작성해 주세요. registration_observation_feedback:' || new.id::text
    )
    returning id into v_task_id;

    insert into dashboard_private.registration_observation_feedback_tasks(
      observation_id, task_id, teacher_profile_id, observation_revision
    ) values (
      new.id, v_task_id, new.teacher_profile_id, new.revision
    );
  elsif new.status = 'scheduled' then
    update public.ops_tasks task
    set assignee_id = new.teacher_profile_id,
        class_id = new.class_id,
        class_name = new.class_name_snapshot,
        start_at = new.ends_at,
        due_at = new.ends_at + interval '24 hours',
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.registration_observation_feedback_tasks link
    where link.observation_id = new.id
      and link.task_id = task.id
      and task.status not in ('done', 'canceled');

    update dashboard_private.registration_observation_feedback_tasks link
    set teacher_profile_id = new.teacher_profile_id,
        observation_revision = new.revision
    where link.observation_id = new.id;
  end if;

  if new.status = 'canceled' then
    update public.ops_tasks task
    set status = 'canceled',
        completed_at = null,
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.registration_observation_feedback_tasks link
    where link.observation_id = new.id
      and link.task_id = task.id
      and task.status not in ('done', 'canceled');
  elsif new.feedback_submitted_at is not null
    and v_feedback_was_missing
  then
    update public.ops_tasks task
    set status = 'done',
        completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.registration_observation_feedback_tasks link
    where link.observation_id = new.id
      and link.task_id = task.id
      and task.status not in ('done', 'canceled');
  end if;

  return new;
end;
$$;

drop trigger if exists sync_registration_observation_feedback_task_v1
  on public.ops_registration_observations;
create trigger sync_registration_observation_feedback_task_v1
after insert or update of status, ends_at, teacher_profile_id, class_id,
  class_name_snapshot, feedback_submitted_at
on public.ops_registration_observations
for each row execute function dashboard_private.sync_registration_observation_feedback_task_v1();

-- Bring already-booked, still-active observations under the same contract.
update public.ops_registration_observations observation
set teacher_profile_id = observation.teacher_profile_id
where observation.status = 'scheduled'
  and not exists (
    select 1
    from dashboard_private.registration_observation_feedback_tasks link
    where link.observation_id = observation.id
  );

alter function dashboard_private.sync_registration_observation_feedback_task_v1()
  owner to postgres;
revoke all on function dashboard_private.sync_registration_observation_feedback_task_v1()
  from public, anon, authenticated, service_role;

commit;
