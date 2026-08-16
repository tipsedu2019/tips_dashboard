create or replace function dashboard_private.is_canonical_class_date_v1(p_value text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_date date;
begin
  if p_value is null or pg_catalog.btrim(p_value) = '' then
    return true;
  end if;

  if p_value <> pg_catalog.btrim(p_value)
     or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return false;
  end if;

  begin
    v_date := pg_catalog.make_date(
      pg_catalog.substr(p_value, 1, 4)::integer,
      pg_catalog.substr(p_value, 6, 2)::integer,
      pg_catalog.substr(p_value, 9, 2)::integer
    );
  exception
    when datetime_field_overflow or invalid_datetime_format then
      return false;
  end;

  return pg_catalog.to_char(v_date, 'YYYY-MM-DD') = p_value;
end
$function$;

alter function dashboard_private.is_canonical_class_date_v1(text) owner to postgres;
revoke all on function dashboard_private.is_canonical_class_date_v1(text) from public;
grant execute on function dashboard_private.is_canonical_class_date_v1(text) to authenticated, service_role;

do $normalize_class_dates$
declare
  v_localized_count integer;
  v_compact_20260101_count integer;
  v_compact_20260102_count integer;
  v_compact_20260301_count integer;
  v_target_count integer;
  v_updated_count integer;
begin
  select
    pg_catalog.count(*) filter (where start_date = '2024년 01월 31일')::integer,
    pg_catalog.count(*) filter (where start_date = '20260101')::integer,
    pg_catalog.count(*) filter (where start_date = '20260102')::integer,
    pg_catalog.count(*) filter (where start_date = '20260301')::integer
  into
    v_localized_count,
    v_compact_20260101_count,
    v_compact_20260102_count,
    v_compact_20260301_count
  from public.classes;

  v_target_count := v_localized_count
    + v_compact_20260101_count
    + v_compact_20260102_count
    + v_compact_20260301_count;

  if v_target_count > 0 and (
    v_localized_count <> 2
    or v_compact_20260101_count <> 47
    or v_compact_20260102_count <> 1
    or v_compact_20260301_count <> 2
    or v_target_count <> 52
  ) then
    raise exception using
      errcode = '22023',
      message = 'class_date_normalization_precondition_failed',
      detail = pg_catalog.format(
        'localized=%s compact_20260101=%s compact_20260102=%s compact_20260301=%s total=%s',
        v_localized_count,
        v_compact_20260101_count,
        v_compact_20260102_count,
        v_compact_20260301_count,
        v_target_count
      );
  end if;

  update public.classes
  set start_date = case start_date
    when '2024년 01월 31일' then '2024-01-31'
    when '20260101' then '2026-01-01'
    when '20260102' then '2026-01-02'
    when '20260301' then '2026-03-01'
    else start_date
  end
  where start_date in ('2024년 01월 31일', '20260101', '20260102', '20260301');

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> v_target_count then
    raise exception using
      errcode = '22023',
      message = 'class_date_normalization_update_count_mismatch',
      detail = pg_catalog.format('expected=%s updated=%s', v_target_count, v_updated_count);
  end if;

  if exists (
    select 1
    from public.classes class
    where not dashboard_private.is_canonical_class_date_v1(class.start_date)
       or not dashboard_private.is_canonical_class_date_v1(class.end_date)
  ) then
    raise exception using
      errcode = '22023',
      message = 'class_date_normalization_invalid_value_remaining';
  end if;
end
$normalize_class_dates$;

alter table public.classes
  add constraint classes_start_date_canonical_check
  check (dashboard_private.is_canonical_class_date_v1(start_date));

alter table public.classes
  add constraint classes_end_date_canonical_check
  check (dashboard_private.is_canonical_class_date_v1(end_date));
