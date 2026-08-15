begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table dashboard_private.registration_observation_feedback_tasks (
  observation_id uuid not null unique references public.ops_registration_observations(id) on delete cascade,
  task_id uuid not null unique references public.ops_tasks(id) on delete cascade,
  teacher_profile_id uuid not null references public.profiles(id) on delete restrict,
  observation_revision bigint not null check (observation_revision > 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (observation_id, task_id)
);

create table dashboard_private.registration_first_consultation_task_links (
  enrollment_id uuid not null unique references public.ops_registration_enrollments(id) on delete cascade,
  task_id uuid not null unique references public.ops_tasks(id) on delete cascade,
  class_lesson_session_id uuid not null references public.class_lesson_sessions(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (enrollment_id, task_id)
);

alter table dashboard_private.registration_observation_feedback_tasks enable row level security;
alter table dashboard_private.registration_first_consultation_task_links enable row level security;
revoke all on table dashboard_private.registration_observation_feedback_tasks from public, anon, authenticated, service_role;
revoke all on table dashboard_private.registration_first_consultation_task_links from public, anon, authenticated, service_role;

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
begin
  select task.* into strict v_parent from public.ops_tasks task where task.id = new.task_id;
  if new.attendance_recorded_at is not null and old.attendance_recorded_at is null then
    insert into public.ops_tasks(
      title, type, status, priority, requested_by, assignee_id, student_id,
      class_id, student_name, class_name, subject, start_at, due_at, memo
    ) values (
      '청강 피드백 작성 · ' || coalesce(v_parent.student_name, '학생') || ' · ' || new.subject,
      'general', 'requested', 'normal', coalesce(auth.uid(), new.attendance_recorded_by),
      new.teacher_profile_id, v_parent.student_id, new.class_id, v_parent.student_name,
      new.class_name_snapshot, new.subject, new.ends_at, new.ends_at + interval '24 hours',
      '청강 수업 적합도와 피드백 사유를 등록 화면에서 작성해 주세요. registration_observation_feedback:' || new.id::text
    ) returning id into v_task_id;
    insert into dashboard_private.registration_observation_feedback_tasks(
      observation_id, task_id, teacher_profile_id, observation_revision
    ) values (new.id, v_task_id, new.teacher_profile_id, new.revision)
    on conflict (observation_id) do nothing;
  elsif new.teacher_profile_id is distinct from old.teacher_profile_id then
    update public.ops_tasks task set assignee_id = new.teacher_profile_id
    from dashboard_private.registration_observation_feedback_tasks link
    where link.observation_id = new.id and link.task_id = task.id
      and task.status not in ('done', 'canceled');
    update dashboard_private.registration_observation_feedback_tasks link
    set teacher_profile_id = new.teacher_profile_id, observation_revision = new.revision
    where link.observation_id = new.id;
  end if;
  if new.feedback_submitted_at is not null and old.feedback_submitted_at is null then
    update public.ops_tasks task
    set status = 'done', completed_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.registration_observation_feedback_tasks link
    where link.observation_id = new.id and link.task_id = task.id and task.status not in ('done', 'canceled');
  end if;
  return new;
end;
$$;

create trigger sync_registration_observation_feedback_task_v1
after update of attendance_recorded_at, feedback_submitted_at, teacher_profile_id
on public.ops_registration_observations
for each row execute function dashboard_private.sync_registration_observation_feedback_task_v1();

create or replace function dashboard_private.guard_registration_feedback_task_completion_v1()
returns trigger
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' and exists (
    select 1 from dashboard_private.registration_observation_feedback_tasks link
    join public.ops_registration_observations observation on observation.id = link.observation_id
    where link.task_id = new.id and observation.feedback_submitted_at is null
  ) then
    raise exception 'registration_observation_feedback_required' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger guard_registration_feedback_task_completion_v1
before update of status on public.ops_tasks
for each row execute function dashboard_private.guard_registration_feedback_task_completion_v1();

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
  v_teacher_profile_id uuid;
  v_teacher_count integer;
  v_first_lesson_end timestamptz;
  v_task_id uuid;
begin
  if not (new.status = 'enrolled' and old.status is distinct from 'enrolled') then return new; end if;
  if new.class_start_lesson_session_id is null then
    raise exception 'registration_first_consultation_assignee_required' using errcode = '55000';
  end if;
  select track.* into strict v_track from public.ops_registration_subject_tracks track where track.id = new.track_id;
  select task.* into strict v_parent from public.ops_tasks task where task.id = v_track.task_id;
  select class.* into strict v_class from public.classes class where class.id = new.class_id;
  select session.* into strict lesson from public.class_lesson_sessions session
  where session.id = new.class_start_lesson_session_id and session.class_id = new.class_id;
  select (pg_catalog.array_agg(profiles.id order by profiles.id))[1], pg_catalog.count(*)::integer
  into v_teacher_profile_id, v_teacher_count
  from public.profiles profiles where profiles.teacher_catalog_id = lesson.teacher_catalog_id and profiles.role = 'teacher';
  if v_teacher_count <> 1 or lesson.end_time is null then
    raise exception 'registration_first_consultation_assignee_required' using errcode = '55000';
  end if;
  v_first_lesson_end := (lesson.session_date + lesson.end_time) at time zone 'Asia/Seoul';
  insert into public.ops_tasks(
    title, type, status, priority, requested_by, assignee_id, student_id, class_id,
    student_name, class_name, subject, start_at, due_at, memo
  ) values (
    '신규 등록 학부모 첫 상담 · ' || coalesce(v_parent.student_name, '학생') || ' · ' || v_track.subject,
    'general', 'requested', 'normal', coalesce(auth.uid(), v_track.director_profile_id),
    v_teacher_profile_id, new.student_id, new.class_id, v_parent.student_name, v_class.name,
    v_track.subject, v_first_lesson_end, v_first_lesson_end + interval '24 hours',
    '첫 수업 후 학부모님께 문자 또는 전화로 수업 상황을 안내하고, 앞으로 잘 부탁드린다는 인사를 전해주세요.'
  ) returning id into v_task_id;
  insert into dashboard_private.registration_first_consultation_task_links(
    enrollment_id, task_id, class_lesson_session_id
  ) values (new.id, v_task_id, lesson.id) on conflict (enrollment_id) do nothing;
  return new;
end;
$$;

create trigger create_registration_first_consultation_task_v1
after update of status on public.ops_registration_enrollments
for each row execute function dashboard_private.create_registration_first_consultation_task_v1();

create or replace function dashboard_private.sync_registration_first_consultation_task_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_assignee_id uuid;
  v_assignee_count integer;
  v_lesson_end timestamptz;
begin
  if not exists (
    select 1
    from dashboard_private.registration_first_consultation_task_links link
    join public.ops_tasks task on task.id = link.task_id
    where link.class_lesson_session_id = new.id
      and task.status in ('requested', 'confirmed', 'in_progress', 'on_hold')
  ) then
    return new;
  end if;

  select (pg_catalog.array_agg(profiles.id order by profiles.id))[1], pg_catalog.count(*)::integer
  into v_assignee_id, v_assignee_count
  from public.profiles profiles
  where profiles.teacher_catalog_id = new.teacher_catalog_id
    and profiles.role = 'teacher';

  if v_assignee_count <> 1 or new.end_time is null then
    raise exception 'registration_first_consultation_assignee_required' using errcode = '55000';
  end if;

  v_lesson_end := (new.session_date + new.end_time) at time zone 'Asia/Seoul';
  update public.ops_tasks task
  set assignee_id = v_assignee_id,
      start_at = v_lesson_end,
      due_at = v_lesson_end + interval '24 hours',
      updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.registration_first_consultation_task_links link
  where link.class_lesson_session_id = new.id
    and link.task_id = task.id
    and task.status in ('requested', 'confirmed', 'in_progress', 'on_hold');

  return new;
end;
$$;

create trigger sync_registration_first_consultation_task_v1
after update of session_date, end_time, teacher_catalog_id on public.class_lesson_sessions
for each row execute function dashboard_private.sync_registration_first_consultation_task_v1();

create or replace function dashboard_private.cancel_registration_followup_task_v1()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  if new.status = 'canceled' and old.status is distinct from 'canceled' then
    update public.ops_tasks task set status = 'canceled', completed_at = null, updated_at = pg_catalog.clock_timestamp()
    from dashboard_private.registration_first_consultation_task_links link
    where link.enrollment_id = new.id and link.task_id = task.id and task.status not in ('done', 'canceled');
  end if;
  return new;
end;
$$;
create trigger cancel_registration_followup_task_v1
after update of status on public.ops_registration_enrollments
for each row execute function dashboard_private.cancel_registration_followup_task_v1();

update dashboard_private.notification_rules rule
set enabled = false, updated_at = pg_catalog.clock_timestamp()
where rule.workflow_key = 'registration'
  and rule.event_key in ('registration.observation_reminder_due', 'registration.observation_feedback_due')
  and rule.enabled;
update dashboard_private.notification_event_fanout_jobs job
set status = 'failed', next_attempt_at = null, claimed_by = null, claim_token = null,
    lease_expires_at = null, last_error_code = 'scheduled_google_chat_replaced_by_task',
    completed_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
from dashboard_private.notification_events event_row
where event_row.id = job.event_id
  and event_row.event_key in ('registration.observation_reminder_due', 'registration.observation_feedback_due')
  and job.status in ('pending', 'claimed');
update dashboard_private.notification_deliveries delivery
set status = 'canceled', status_reason = 'source_status_changed', cancel_reason = 'scheduled_google_chat_replaced_by_task',
    next_attempt_at = null, claimed_by = null, claim_token = null, lease_expires_at = null,
    resolved_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
from dashboard_private.notification_events event_row
where event_row.id = delivery.event_id and delivery.channel_key = 'google_chat'
  and event_row.event_key in ('registration.observation_reminder_due', 'registration.observation_feedback_due')
  and delivery.status in ('pending', 'claimed', 'retry_wait');

alter function dashboard_private.sync_registration_observation_feedback_task_v1() owner to postgres;
alter function dashboard_private.guard_registration_feedback_task_completion_v1() owner to postgres;
alter function dashboard_private.create_registration_first_consultation_task_v1() owner to postgres;
alter function dashboard_private.sync_registration_first_consultation_task_v1() owner to postgres;
alter function dashboard_private.cancel_registration_followup_task_v1() owner to postgres;
revoke all on function dashboard_private.sync_registration_observation_feedback_task_v1() from public, anon, authenticated, service_role;
revoke all on function dashboard_private.guard_registration_feedback_task_completion_v1() from public, anon, authenticated, service_role;
revoke all on function dashboard_private.create_registration_first_consultation_task_v1() from public, anon, authenticated, service_role;
revoke all on function dashboard_private.sync_registration_first_consultation_task_v1() from public, anon, authenticated, service_role;
revoke all on function dashboard_private.cancel_registration_followup_task_v1() from public, anon, authenticated, service_role;

commit;
