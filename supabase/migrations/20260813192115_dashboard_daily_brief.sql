begin;

create or replace function public.get_dashboard_daily_brief_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with bounds as (
    select
      (pg_catalog.statement_timestamp() at time zone 'Asia/Seoul')::date as local_date,
      ((pg_catalog.statement_timestamp() at time zone 'Asia/Seoul')::date::timestamp
        at time zone 'Asia/Seoul') as starts_at,
      (((pg_catalog.statement_timestamp() at time zone 'Asia/Seoul')::date + 1)::timestamp
        at time zone 'Asia/Seoul') as ends_at,
      pg_catalog.statement_timestamp() as generated_at
  ),
  scheduled_appointments as (
    select
      appointment.appointment_id as source_id,
      appointment.task_id,
      appointment.kind as source_kind,
      appointment.scheduled_at,
      appointment.student_name,
      appointment.place,
      appointment.subjects,
      appointment.observation_id,
      appointment.observation_track_id,
      appointment.observation_class_name,
      appointment.observation_classroom_name
    from public.ops_registration_appointment_calendar appointment
    cross join bounds
    where appointment.status = 'scheduled'
      and appointment.scheduled_at >= bounds.starts_at
      and appointment.scheduled_at < bounds.ends_at
      and appointment.kind in (
        'level_test',
        'visit_consultation',
        'observation_class'
      )
  ),
  appointment_counts as (
    select
      pg_catalog.count(*) filter (
        where appointment.source_kind = 'level_test'
      ) as level_tests,
      pg_catalog.count(*) filter (
        where appointment.source_kind = 'visit_consultation'
      ) as visit_consultations,
      pg_catalog.count(*) filter (
        where appointment.source_kind = 'observation_class'
      ) as observation_classes
    from scheduled_appointments appointment
  ),
  open_task_count as (
    select pg_catalog.count(*) as open_tasks
    from public.ops_tasks task
    cross join bounds
    where task.status in ('requested', 'confirmed', 'in_progress', 'on_hold')
      and task.due_at >= bounds.starts_at
      and task.due_at < bounds.ends_at
  ),
  upcoming_appointments as (
    select
      scheduled.source_kind,
      scheduled.source_id,
      scheduled.scheduled_at,
      case scheduled.source_kind
        when 'level_test' then pg_catalog.concat(
          coalesce(scheduled.student_name, '학생'),
          ' · 레벨테스트'
        )
        when 'visit_consultation' then pg_catalog.concat(
          coalesce(scheduled.student_name, '학생'),
          ' · 방문상담'
        )
        else pg_catalog.concat(
          coalesce(
            scheduled.observation_class_name,
            scheduled.student_name,
            '수업'
          ),
          ' · 청강'
        )
      end as title,
      coalesce(scheduled.subjects, array[]::text[]) as subject_labels,
      case scheduled.source_kind
        when 'observation_class' then coalesce(
          scheduled.observation_classroom_name,
          scheduled.place
        )
        else scheduled.place
      end as place_label,
      case scheduled.source_kind
        when 'observation_class' then
          '/admin/registration?taskId=' || scheduled.task_id::text
          || '&trackId=' || scheduled.observation_track_id::text
          || '&appointmentId=' || scheduled.source_id::text
          || '&observationId=' || scheduled.observation_id::text
          || '&view=calendar'
        else
          '/admin/registration?taskId=' || scheduled.task_id::text
          || '&appointmentId=' || scheduled.source_id::text
          || '&view=calendar'
      end as href
    from scheduled_appointments scheduled
    order by scheduled.scheduled_at, scheduled.source_id
    limit 5
  )
  select pg_catalog.jsonb_build_object(
    'localDate', bounds.local_date::text,
    'generatedAt', bounds.generated_at,
    'counts', pg_catalog.jsonb_build_object(
      'levelTests', appointment_counts.level_tests,
      'visitConsultations', appointment_counts.visit_consultations,
      'observationClasses', appointment_counts.observation_classes,
      'openTasks', open_task_count.open_tasks
    ),
    'upcoming', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'sourceKind', upcoming.source_kind,
            'sourceId', upcoming.source_id,
            'scheduledAt', upcoming.scheduled_at,
            'title', upcoming.title,
            'subjectLabels', upcoming.subject_labels,
            'placeLabel', upcoming.place_label,
            'href', upcoming.href
          )
          order by upcoming.scheduled_at, upcoming.source_id
        )
        from upcoming_appointments upcoming
      ),
      '[]'::jsonb
    )
  )
  from bounds
  cross join appointment_counts
  cross join open_task_count;
$function$;

alter function public.get_dashboard_daily_brief_v1()
  owner to postgres;

revoke all on function public.get_dashboard_daily_brief_v1()
  from public, anon, authenticated;
grant execute on function public.get_dashboard_daily_brief_v1()
  to authenticated;

comment on function public.get_dashboard_daily_brief_v1() is
  'Returns one RLS-visible KST daily brief with four counts and at most five appointments.';

commit;
