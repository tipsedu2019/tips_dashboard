begin;

create or replace function public.list_dashboard_class_session_dates_v1(
  p_date_from date,
  p_date_to date
)
returns table (
  class_id uuid,
  session_date date,
  schedule_state text,
  storage_mode text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_date_from is null
    or p_date_to is null
    or p_date_to < p_date_from
    or (p_date_to - p_date_from) > 400 then
    raise exception 'dashboard_class_session_date_range_invalid'
      using errcode = '22023';
  end if;

  return query
  with legacy_session_values as (
    select
      class.id as class_id,
      case
        when pg_catalog.pg_input_is_valid(session.item ->> 'date', 'date')
          then (session.item ->> 'date')::date
        else null
      end as session_date,
      coalesce(
        nullif(pg_catalog.btrim(session.item ->> 'scheduleState'), ''),
        nullif(pg_catalog.btrim(session.item ->> 'state'), ''),
        'active'
      ) as schedule_state
    from public.classes class
    cross join lateral pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(class.schedule_plan -> 'sessions') = 'array'
          then class.schedule_plan -> 'sessions'
        else '[]'::jsonb
      end
    ) session(item)
    where coalesce(class.schedule_storage_mode, 'legacy') <> 'normalized'
  ),
  session_rows as (
    select
      legacy.class_id,
      legacy.session_date,
      legacy.schedule_state,
      'legacy'::text as storage_mode
    from legacy_session_values legacy
    where legacy.session_date between p_date_from and p_date_to
      and legacy.schedule_state in ('active', 'makeup')

    union all

    select
      class.id,
      lesson.session_date,
      lesson.schedule_state,
      'normalized'::text
    from public.classes class
    join public.class_lesson_sessions lesson
      on lesson.class_id = class.id
    where class.schedule_storage_mode = 'normalized'
      and lesson.session_date between p_date_from and p_date_to
      and lesson.schedule_state in ('active', 'makeup')
  )
  select distinct
    row.class_id,
    row.session_date,
    row.schedule_state,
    row.storage_mode
  from session_rows row
  order by row.class_id, row.session_date, row.schedule_state;
end;
$$;

alter function public.list_dashboard_class_session_dates_v1(date, date)
  owner to postgres;
revoke all on function public.list_dashboard_class_session_dates_v1(date, date)
  from public, anon;
grant execute on function public.list_dashboard_class_session_dates_v1(date, date)
  to authenticated;

comment on function public.list_dashboard_class_session_dates_v1(date, date) is
  'Returns only class session dates and states needed by dashboard conflict metrics.';

commit;
