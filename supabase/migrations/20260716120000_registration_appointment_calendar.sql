begin;

create index if not exists ops_registration_appointments_status_scheduled_id_idx
  on public.ops_registration_appointments (status, scheduled_at, id);

create or replace view public.ops_registration_appointment_calendar
with (security_invoker = true)
as
with canonical_participants as (
  select
    level_test.appointment_id,
    track.id as track_id,
    track.subject
  from public.ops_registration_level_tests level_test
  join public.ops_registration_appointments appointment
    on appointment.id = level_test.appointment_id
   and appointment.kind = 'level_test'
  join public.ops_registration_subject_tracks track
    on track.id = level_test.track_id

  union

  select
    consultation.appointment_id,
    track.id as track_id,
    track.subject
  from public.ops_registration_consultations consultation
  join public.ops_registration_appointments appointment
    on appointment.id = consultation.appointment_id
   and appointment.kind = 'visit_consultation'
  join public.ops_registration_subject_tracks track
    on track.id = consultation.track_id
  where consultation.mode = 'visit'
    and consultation.appointment_id is not null
),
appointment_participants as (
  select
    participant.appointment_id,
    array_agg(
      participant.track_id
      order by
        case participant.subject
          when '영어' then 0
          when '수학' then 1
          else 2
        end,
        participant.track_id
    ) as track_ids,
    array_agg(
      participant.subject
      order by
        case participant.subject
          when '영어' then 0
          when '수학' then 1
          else 2
        end,
        participant.track_id
    ) as subjects
  from canonical_participants participant
  group by participant.appointment_id
)
select
  appointment.id as appointment_id,
  appointment.task_id,
  task.student_name,
  appointment.kind,
  appointment.scheduled_at,
  appointment.place,
  appointment.status,
  appointment.notification_revision,
  participant.track_ids,
  participant.subjects
from public.ops_registration_appointments appointment
join public.ops_tasks task
  on task.id = appointment.task_id
join appointment_participants participant
  on participant.appointment_id = appointment.id;

comment on view public.ops_registration_appointment_calendar is
  '등록 정규 예약을 예약별 한 행으로 제공하는 읽기 전용 달력 뷰';

revoke all on table public.ops_registration_appointment_calendar
  from public, anon, authenticated;
grant select on table public.ops_registration_appointment_calendar
  to authenticated;

commit;
