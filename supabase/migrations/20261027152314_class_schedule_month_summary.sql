set lock_timeout = '1s';
set statement_timeout = '5s';

-- Read-only annual projection of the same class access as get_class_schedule_v1.
-- No class/session writes, backfill, role changes or new table access grants.
create or replace function public.get_class_schedule_month_summary_v1(p_class_id uuid, p_year integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.classes%rowtype;
  v_from date;
  v_to date;
  v_months jsonb;
begin
  -- Keep the final get_class_schedule_v1 actor boundary, before existence checks.
  if public.current_dashboard_role() = 'teacher' then
    if not exists (
      select 1 from public.profiles p join auth.users u on u.id = p.id
      where p.id = auth.uid() and p.role = 'teacher' and u.deleted_at is null
        and (u.banned_until is null or u.banned_until <= now())
    ) then
      raise exception 'operational_common_read_forbidden' using errcode = '42501';
    end if;
  else
    perform dashboard_private.assert_continuous_class_schedule_actor_v1(false);
  end if;
  if p_year is null or p_year < 1 or p_year > 9998 then
    raise exception 'class_schedule_validation' using errcode = '22023';
  end if;
  select * into v_class from public.classes where id = p_class_id;
  if not found then raise exception 'class_schedule_not_found' using errcode = 'P0002'; end if;
  if public.continuous_class_schedule_runtime_version() <> 1 or v_class.schedule_storage_mode <> 'normalized' then
    return pg_catalog.jsonb_build_object('classId', p_class_id, 'year', p_year, 'authoritativeSource', 'legacy', 'months', '[]'::jsonb);
  end if;
  v_from := pg_catalog.make_date(p_year, 1, 1);
  v_to := pg_catalog.make_date(p_year + 1, 1, 1);
  -- Use the existing class/date index. Count rows, not distinct dates: multiple
  -- lessons on one date are independent sessions. Excluded states do not count.
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('month', m.month, 'count', coalesce(c.total, 0)) order by m.month)
  into v_months
  from pg_catalog.generate_series(1, 12) as m(month)
  left join (
    select extract(month from s.session_date)::integer as month, pg_catalog.count(*) as total
    from public.class_lesson_sessions s
    where s.class_id = p_class_id and s.session_date >= v_from and s.session_date < v_to
      and s.schedule_state in ('active', 'makeup')
    group by extract(month from s.session_date)::integer
  ) c using (month);
  return pg_catalog.jsonb_build_object('classId', p_class_id, 'year', p_year, 'authoritativeSource', 'normalized', 'months', v_months);
end;
$$;
revoke all on function public.get_class_schedule_month_summary_v1(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.get_class_schedule_month_summary_v1(uuid, integer) to authenticated;
