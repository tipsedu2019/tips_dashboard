begin;

create or replace function public.get_dashboard_summary_sources_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'classes', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data) order by row_data.id)
      from (
        select
          class.id,
          class.name,
          class.subject,
          class.grade,
          class.teacher,
          class.room,
          class.schedule,
          class.status,
          class.start_date,
          class.end_date,
          class.student_ids,
          class.waitlist_ids,
          class.schedule_storage_mode
        from public.classes class
      ) row_data
    ), '[]'::jsonb),
    'students', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data) order by row_data.id)
      from (
        select
          student.id,
          student.name,
          student.school,
          student.grade,
          student.status,
          student.class_ids,
          student.waitlist_class_ids
        from public.students student
      ) row_data
    ), '[]'::jsonb)
  );
$$;

create or replace function public.get_dashboard_conflict_sources_v1(
  p_date_from date,
  p_date_to date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_date_from is null
    or p_date_to is null
    or p_date_to < p_date_from
    or (p_date_to - p_date_from) > 400 then
    raise exception 'dashboard_conflict_source_date_range_invalid'
      using errcode = '22023';
  end if;

  select pg_catalog.jsonb_build_object(
    'sessionDates', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(row_data)
        order by row_data.class_id, row_data.session_date, row_data.schedule_state
      )
      from (
        select
          session.class_id,
          session.session_date,
          session.schedule_state,
          session.storage_mode
        from public.list_dashboard_class_session_dates_v1(p_date_from, p_date_to) session
      ) row_data
    ), '[]'::jsonb),
    'classTerms', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(row_data)
        order by row_data.sort_order, row_data.academic_year, row_data.id
      )
      from (
        select
          term.id,
          term.academic_year,
          term.name,
          term.status,
          term.start_date,
          term.end_date,
          term.sort_order
        from public.class_terms term
      ) row_data
    ), '[]'::jsonb),
    'classGroups', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(row_data)
        order by row_data.sort_order, row_data.id
      )
      from (
        select
          sync_group.id,
          sync_group.term_id,
          sync_group.name,
          sync_group.subject,
          sync_group.sort_order,
          sync_group.is_default
        from public.class_schedule_sync_groups sync_group
      ) row_data
    ), '[]'::jsonb),
    'classGroupMembers', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(row_data)
        order by row_data.group_id, row_data.sort_order, row_data.class_id
      )
      from (
        select
          member.group_id,
          member.class_id,
          member.sort_order
        from public.class_schedule_sync_group_members member
      ) row_data
    ), '[]'::jsonb),
    'teacherCatalogs', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(row_data)
        order by row_data.name, row_data.id
      )
      from (
        select
          teacher.id,
          teacher.name,
          teacher.profile_id,
          teacher.subjects,
          teacher.is_visible
        from public.teacher_catalogs teacher
      ) row_data
    ), '[]'::jsonb),
    'classroomCatalogs', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(row_data)
        order by row_data.name, row_data.id
      )
      from (
        select
          classroom.id,
          classroom.name,
          classroom.subjects,
          classroom.is_visible
        from public.classroom_catalogs classroom
      ) row_data
    ), '[]'::jsonb),
    'academicSchools', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(row_data)
        order by row_data.name, row_data.id
      )
      from (
        select
          school.id,
          school.name,
          school.category
        from public.academic_schools school
      ) row_data
    ), '[]'::jsonb),
    'academicExamDays', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(row_data)
        order by row_data.exam_date, row_data.school_id, row_data.grade, row_data.subject, row_data.id
      )
      from (
        select
          exam_day.id,
          exam_day.school_id,
          exam_day.grade,
          exam_day.subject,
          exam_day.exam_date
        from public.academic_exam_days exam_day
      ) row_data
    ), '[]'::jsonb),
    'academicEventExamDetails', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(row_data)
        order by row_data.exam_date, row_data.academic_event_id, row_data.id
      )
      from (
        select
          detail.id,
          detail.academic_event_id,
          detail.school_id,
          detail.grade,
          detail.subject,
          detail.exam_date
        from public.academic_event_exam_details detail
      ) row_data
    ), '[]'::jsonb),
    'academicEvents', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(row_data)
        order by row_data.date, row_data.id
      )
      from (
        select
          event.id,
          event.title,
          event.date,
          event.type,
          event.school_id,
          event.grade,
          event.note
        from public.academic_events event
      ) row_data
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

alter function public.get_dashboard_summary_sources_v1()
  owner to postgres;
alter function public.get_dashboard_conflict_sources_v1(date, date)
  owner to postgres;

revoke all on function public.get_dashboard_summary_sources_v1()
  from public, anon;
revoke all on function public.get_dashboard_conflict_sources_v1(date, date)
  from public, anon;

grant execute on function public.get_dashboard_summary_sources_v1()
  to authenticated;
grant execute on function public.get_dashboard_conflict_sources_v1(date, date)
  to authenticated;

comment on function public.get_dashboard_summary_sources_v1() is
  'Returns the RLS-visible class and student fields needed by the dashboard summary.';
comment on function public.get_dashboard_conflict_sources_v1(date, date) is
  'Returns the bounded RLS-visible source rows needed by dashboard conflict metrics.';

commit;
