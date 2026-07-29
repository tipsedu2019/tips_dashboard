begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A legacy-backfilled lesson session has no source_schedule_slot_id. Treat its
-- date as occupied so default generation cannot duplicate an existing lesson.
create or replace function dashboard_private.continuous_class_schedule_generation_candidates_v1(
  p_class_id uuid,
  p_date_from date,
  p_date_to date
)
returns table(
  session_key text,
  session_date date,
  source_schedule_slot_id uuid,
  start_time time,
  end_time time,
  teacher_catalog_id uuid,
  teacher_name_snapshot text,
  classroom_catalog_id uuid,
  classroom_name_snapshot text,
  existing boolean
)
language sql
security definer
set search_path = ''
as $$
  select
    'default:' || s.id::text || ':' || d.day::text,
    d.day,
    s.id,
    s.start_time,
    s.end_time,
    s.teacher_catalog_id,
    s.teacher_name,
    s.classroom_catalog_id,
    s.classroom_name,
    exists(
      select 1
      from public.class_lesson_sessions x
      where x.class_id = p_class_id
        and (
          x.session_key = 'default:' || s.id::text || ':' || d.day::text
          or (x.session_date = d.day and x.source_schedule_slot_id = s.id)
          or (
            x.session_date = d.day
            and x.origin = 'legacy'
            and x.source_schedule_slot_id is null
          )
        )
    )
  from public.class_schedule_slots s
  cross join lateral (
    select generated_day::date as day
    from generate_series(
      p_date_from::timestamp,
      p_date_to::timestamp,
      interval '1 day'
    ) generated_day
  ) d
  where s.class_id = p_class_id
    and extract(dow from d.day)::smallint = s.weekday;
$$;

revoke all on function dashboard_private.continuous_class_schedule_generation_candidates_v1(uuid, date, date)
  from public, anon, authenticated, service_role;

commit;
