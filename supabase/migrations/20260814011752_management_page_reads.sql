do $migration$
declare
  v_locale text;
  v_deterministic boolean;
begin
  select coll.collcollate, coll.collisdeterministic
  into v_locale, v_deterministic
  from pg_catalog.pg_collation coll
  join pg_catalog.pg_namespace namespace on namespace.oid = coll.collnamespace
  where namespace.nspname = 'dashboard_private'
    and coll.collname = 'ko_numeric';

  if v_locale is null
    or v_locale <> 'ko-u-kn-true'
    or v_deterministic is distinct from true
  then
    raise exception 'management_ko_numeric_collation_invalid' using errcode = '55000';
  end if;
end
$migration$;

create function public.get_management_default_class_period_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object('periodId',group_row.id,'label',group_row.name)
  from public.class_schedule_sync_groups group_row
  order by group_row.is_default desc,group_row.sort_order asc,group_row.name collate dashboard_private.ko_numeric asc,group_row.id asc
  limit 1
$function$;

create function public.list_management_page_v1(
  p_kind text,
  p_filters jsonb,
  p_cursor_sort_key text,
  p_cursor_id uuid,
  p_limit integer
)
returns table(row_data jsonb, sort_key text, id uuid)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_keys text[];
  v_expected text[];
  v_key text;
begin
  if p_kind = 'students' then
    v_expected := array['grade','kind','school','schoolCategory','search','status'];
  elsif p_kind = 'classes' then
    v_expected := array['classroom','grade','kind','periodId','search','status','subject','teacher'];
  elsif p_kind = 'textbooks' then
    v_expected := array['kind','publisher','search','status','subject'];
  else
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_filters) <> 'object' or p_filters ->> 'kind' is distinct from p_kind then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(object_key.key order by object_key.key) into v_keys
  from pg_catalog.jsonb_object_keys(p_filters) as object_key(key);
  if v_keys is distinct from v_expected or pg_catalog.jsonb_typeof(p_filters -> 'search') <> 'string' then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  foreach v_key in array v_expected loop
    if v_key not in ('kind','search') and pg_catalog.jsonb_typeof(p_filters -> v_key) not in ('string','null') then
      raise exception 'management_filters_invalid' using errcode = '22023';
    end if;
  end loop;
  if p_limit is null or p_limit < 1 or p_limit > 30 then
    raise exception 'management_page_limit_invalid' using errcode = '22023';
  end if;
  if (p_cursor_sort_key is null) <> (p_cursor_id is null) then
    raise exception 'management_cursor_invalid' using errcode = '22023';
  end if;

  if p_kind = 'students' then
    return query
    with source as (
      select student.id, pg_catalog.to_jsonb(student) as raw
      from public.students student
    ), filtered as (
      select source.*,
        pg_catalog.coalesce(
          pg_catalog.nullif(pg_catalog.regexp_replace(pg_catalog.btrim(source.raw ->> 'name'), '[[:space:]]+', ' ', 'g'), ''),
          U&'\FFFF'
        ) collate dashboard_private.ko_numeric as normalized_sort
      from source
      where (p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', source.raw ->> 'name', source.raw ->> 'school', source.raw ->> 'grade') ilike '%' || p_filters ->> 'search' || '%')
        and ((p_filters ->> 'status') is null or source.raw ->> 'status' = p_filters ->> 'status')
        and ((p_filters ->> 'schoolCategory') is null or pg_catalog.coalesce(source.raw ->> 'school_category', source.raw ->> 'schoolCategory') = p_filters ->> 'schoolCategory')
        and ((p_filters ->> 'school') is null or source.raw ->> 'school' = p_filters ->> 'school')
        and ((p_filters ->> 'grade') is null or source.raw ->> 'grade' = p_filters ->> 'grade')
    )
    select pg_catalog.jsonb_build_object(
        'kind','students','id',filtered.id,'name',pg_catalog.coalesce(filtered.raw ->> 'name',''),
        'grade',filtered.raw -> 'grade','school',filtered.raw -> 'school',
        'contact',filtered.raw -> 'contact','parentContact',pg_catalog.coalesce(filtered.raw -> 'parent_contact',filtered.raw -> 'parentContact'),
        'status',pg_catalog.coalesce(filtered.raw ->> 'status',''),
        'sortKey',filtered.normalized_sort::text,
        'updatedAt',pg_catalog.coalesce(filtered.raw ->> 'updated_at','')
      ), filtered.normalized_sort::text, filtered.id
    from filtered
    where p_cursor_sort_key is null
      or filtered.normalized_sort > p_cursor_sort_key collate dashboard_private.ko_numeric
      or (filtered.normalized_sort = p_cursor_sort_key collate dashboard_private.ko_numeric and filtered.id > p_cursor_id)
    order by filtered.normalized_sort asc, filtered.id asc
    limit p_limit + 1;
  elsif p_kind = 'classes' then
    return query
    with source as (
      select class.id, pg_catalog.to_jsonb(class) as raw
      from public.classes class
    ), filtered as (
      select source.*,
        pg_catalog.coalesce(
          pg_catalog.nullif(pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.coalesce(source.raw ->> 'name',source.raw ->> 'class_name')), '[[:space:]]+', ' ', 'g'), ''),
          U&'\FFFF'
        ) collate dashboard_private.ko_numeric as normalized_sort
      from source
      where (p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', source.raw ->> 'name', source.raw ->> 'subject', pg_catalog.coalesce(source.raw ->> 'teacher_name',source.raw ->> 'teacher'), pg_catalog.coalesce(source.raw ->> 'classroom',source.raw ->> 'room')) ilike '%' || p_filters ->> 'search' || '%')
        and ((p_filters ->> 'status') is null or source.raw ->> 'status' = p_filters ->> 'status')
        and ((p_filters ->> 'subject') is null or source.raw ->> 'subject' = p_filters ->> 'subject')
        and ((p_filters ->> 'grade') is null or source.raw ->> 'grade' = p_filters ->> 'grade')
        and ((p_filters ->> 'teacher') is null or pg_catalog.coalesce(source.raw ->> 'teacher',source.raw ->> 'teacher_name') = p_filters ->> 'teacher')
        and ((p_filters ->> 'classroom') is null or pg_catalog.coalesce(source.raw ->> 'classroom',source.raw ->> 'room') = p_filters ->> 'classroom')
        and ((p_filters ->> 'periodId') is null or exists (
          select 1 from public.class_schedule_sync_group_members member
          where member.class_id = source.id and member.group_id::text = p_filters ->> 'periodId'
        ))
    )
    select pg_catalog.jsonb_build_object(
        'kind','classes','id',filtered.id,'name',pg_catalog.coalesce(filtered.raw ->> 'name',filtered.raw ->> 'class_name',''),
        'subject',pg_catalog.coalesce(filtered.raw ->> 'subject',''),
        'grade',filtered.raw -> 'grade','schedule',filtered.raw -> 'schedule',
        'teacherName',pg_catalog.coalesce(filtered.raw ->> 'teacher_name',filtered.raw ->> 'teacher'),
        'classroom',pg_catalog.coalesce(filtered.raw -> 'classroom',filtered.raw -> 'room'),
        'capacity',filtered.raw -> 'capacity','weeklyMinutes',pg_catalog.coalesce(filtered.raw -> 'weekly_minutes',filtered.raw -> 'weeklyMinutes'),
        'fee',pg_catalog.coalesce(filtered.raw -> 'fee',filtered.raw -> 'tuition'),
        'status',pg_catalog.coalesce(filtered.raw ->> 'status',''),
        'studentCount',(select pg_catalog.count(distinct roster.student_id) from (
          select roster_id.student_id from pg_catalog.jsonb_array_elements_text(pg_catalog.coalesce(filtered.raw -> 'student_ids','[]'::jsonb)) as roster_id(student_id)
          union all select enrollment.student_id::text from public.ops_registration_enrollments enrollment
          where enrollment.class_id=filtered.id and pg_catalog.coalesce(pg_catalog.to_jsonb(enrollment) ->> 'roster_active','false')::boolean
          union all select student.id::text from public.students student where pg_catalog.coalesce(pg_catalog.to_jsonb(student) -> 'class_ids','[]'::jsonb) ? filtered.id::text
        ) roster),
        'sortKey',filtered.normalized_sort::text,
        'updatedAt',pg_catalog.coalesce(filtered.raw ->> 'updated_at','')
      ), filtered.normalized_sort::text, filtered.id
    from filtered
    where p_cursor_sort_key is null
      or filtered.normalized_sort > p_cursor_sort_key collate dashboard_private.ko_numeric
      or (filtered.normalized_sort = p_cursor_sort_key collate dashboard_private.ko_numeric and filtered.id > p_cursor_id)
    order by filtered.normalized_sort asc, filtered.id asc
    limit p_limit + 1;
  else
    return query
    with source as (
      select textbook.id, pg_catalog.to_jsonb(textbook) as raw
      from public.textbooks textbook
    ), filtered as (
      select source.*,
        pg_catalog.coalesce(
          pg_catalog.nullif(pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.coalesce(source.raw ->> 'title',source.raw ->> 'name')), '[[:space:]]+', ' ', 'g'), ''),
          U&'\FFFF'
        ) collate dashboard_private.ko_numeric as normalized_sort
      from source
      where (p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', source.raw ->> 'title', source.raw ->> 'name', source.raw ->> 'subject', source.raw ->> 'publisher') ilike '%' || p_filters ->> 'search' || '%')
        and ((p_filters ->> 'status') is null or source.raw ->> 'status' = p_filters ->> 'status')
        and ((p_filters ->> 'subject') is null or source.raw ->> 'subject' = p_filters ->> 'subject')
        and ((p_filters ->> 'publisher') is null or source.raw ->> 'publisher' = p_filters ->> 'publisher')
    )
    select pg_catalog.jsonb_build_object(
        'kind','textbooks','id',filtered.id,'title',pg_catalog.coalesce(filtered.raw ->> 'title',filtered.raw ->> 'name',''),
        'subject',pg_catalog.coalesce(filtered.raw ->> 'subject',''),'publisher',filtered.raw -> 'publisher',
        'status',pg_catalog.coalesce(filtered.raw ->> 'status',''),
        'price',pg_catalog.coalesce(filtered.raw -> 'price',filtered.raw -> 'sale_price',filtered.raw -> 'list_price'),
        'activeClassCount',(select pg_catalog.count(*) from public.classes class where pg_catalog.coalesce(pg_catalog.to_jsonb(class) -> 'textbook_ids','[]'::jsonb) ? filtered.id::text),
        'sortKey',filtered.normalized_sort::text,
        'updatedAt',pg_catalog.coalesce(filtered.raw ->> 'updated_at','')
      ), filtered.normalized_sort::text, filtered.id
    from filtered
    where p_cursor_sort_key is null
      or filtered.normalized_sort > p_cursor_sort_key collate dashboard_private.ko_numeric
      or (filtered.normalized_sort = p_cursor_sort_key collate dashboard_private.ko_numeric and filtered.id > p_cursor_id)
    order by filtered.normalized_sort asc, filtered.id asc
    limit p_limit + 1;
  end if;
end
$function$;

create function public.get_management_stats_v1(p_kind text, p_filters jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_keys text[];
  v_expected text[];
  v_key text;
begin
  if p_kind = 'students' then
    v_expected := array['grade','kind','school','schoolCategory','search','status'];
  elsif p_kind = 'classes' then
    v_expected := array['classroom','grade','kind','periodId','search','status','subject','teacher'];
  elsif p_kind = 'textbooks' then
    v_expected := array['kind','publisher','search','status','subject'];
  else
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_filters) <> 'object' or p_filters ->> 'kind' is distinct from p_kind then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(object_key.key order by object_key.key) into v_keys
  from pg_catalog.jsonb_object_keys(p_filters) as object_key(key);
  if v_keys is distinct from v_expected or pg_catalog.jsonb_typeof(p_filters -> 'search') <> 'string' then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  foreach v_key in array v_expected loop
    if v_key not in ('kind','search') and pg_catalog.jsonb_typeof(p_filters -> v_key) not in ('string','null') then
      raise exception 'management_filters_invalid' using errcode = '22023';
    end if;
  end loop;
  if p_kind = 'students' then
    with filtered as (
      select pg_catalog.to_jsonb(student) raw from public.students student
      where (p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', student.name, student.school, student.grade) ilike '%' || p_filters ->> 'search' || '%')
        and ((p_filters ->> 'status') is null or student.status = p_filters ->> 'status')
        and ((p_filters ->> 'schoolCategory') is null or pg_catalog.coalesce(pg_catalog.to_jsonb(student) ->> 'school_category',pg_catalog.to_jsonb(student) ->> 'schoolCategory') = p_filters ->> 'schoolCategory')
        and ((p_filters ->> 'school') is null or student.school = p_filters ->> 'school')
        and ((p_filters ->> 'grade') is null or student.grade = p_filters ->> 'grade')
    )
    select pg_catalog.jsonb_build_object('total',pg_catalog.coalesce(pg_catalog.sum(count_value),0),'byStatus',pg_catalog.coalesce(pg_catalog.jsonb_object_agg(status,count_value),'{}'::jsonb))
    into v_result from (select pg_catalog.coalesce(raw ->> 'status','') status, pg_catalog.count(*) count_value from filtered group by 1) grouped;
  elsif p_kind = 'classes' then
    with source as (select class.id, pg_catalog.to_jsonb(class) raw from public.classes class), filtered as (
      select source.raw from source
      where (p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', raw ->> 'name', raw ->> 'subject', raw ->> 'teacher', pg_catalog.coalesce(raw ->> 'classroom',raw ->> 'room')) ilike '%' || p_filters ->> 'search' || '%')
        and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status')
        and ((p_filters ->> 'subject') is null or raw ->> 'subject' = p_filters ->> 'subject')
        and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade')
        and ((p_filters ->> 'teacher') is null or raw ->> 'teacher' = p_filters ->> 'teacher')
        and ((p_filters ->> 'classroom') is null or pg_catalog.coalesce(raw ->> 'classroom',raw ->> 'room') = p_filters ->> 'classroom')
        and ((p_filters ->> 'periodId') is null or exists (select 1 from public.class_schedule_sync_group_members member where member.class_id = source.id and member.group_id::text = p_filters ->> 'periodId'))
    )
    select pg_catalog.jsonb_build_object('total',pg_catalog.coalesce(pg_catalog.sum(count_value),0),'byStatus',pg_catalog.coalesce(pg_catalog.jsonb_object_agg(status,count_value),'{}'::jsonb))
    into v_result from (select pg_catalog.coalesce(raw ->> 'status','') status, pg_catalog.count(*) count_value from filtered group by 1) grouped;
  else
    with source as (select pg_catalog.to_jsonb(textbook) raw from public.textbooks textbook), filtered as (
      select source.raw from source
      where (p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ', source.raw ->> 'title', source.raw ->> 'name', source.raw ->> 'subject', source.raw ->> 'publisher') ilike '%' || p_filters ->> 'search' || '%')
        and ((p_filters ->> 'status') is null or source.raw ->> 'status' = p_filters ->> 'status')
        and ((p_filters ->> 'subject') is null or source.raw ->> 'subject' = p_filters ->> 'subject')
        and ((p_filters ->> 'publisher') is null or source.raw ->> 'publisher' = p_filters ->> 'publisher')
    )
    select pg_catalog.jsonb_build_object('total',pg_catalog.coalesce(pg_catalog.sum(count_value),0),'byStatus',pg_catalog.coalesce(pg_catalog.jsonb_object_agg(status,count_value),'{}'::jsonb))
    into v_result from (select pg_catalog.coalesce(raw ->> 'status','') status, pg_catalog.count(*) count_value from filtered group by 1) grouped;
  end if;
  return pg_catalog.coalesce(v_result, pg_catalog.jsonb_build_object('total',0,'byStatus','{}'::jsonb));
end
$function$;

create function public.list_management_filter_options_v1(p_kind text, p_filters jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_keys text[];
  v_expected text[];
  v_key text;
begin
  if p_kind = 'students' then
    v_expected := array['grade','kind','school','schoolCategory','search','status'];
  elsif p_kind = 'classes' then
    v_expected := array['classroom','grade','kind','periodId','search','status','subject','teacher'];
  elsif p_kind = 'textbooks' then
    v_expected := array['kind','publisher','search','status','subject'];
  else
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_filters) <> 'object' or p_filters ->> 'kind' is distinct from p_kind then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(object_key.key order by object_key.key) into v_keys
  from pg_catalog.jsonb_object_keys(p_filters) as object_key(key);
  if v_keys is distinct from v_expected or pg_catalog.jsonb_typeof(p_filters -> 'search') <> 'string' then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  foreach v_key in array v_expected loop
    if v_key not in ('kind','search') and pg_catalog.jsonb_typeof(p_filters -> v_key) not in ('string','null') then
      raise exception 'management_filters_invalid' using errcode = '22023';
    end if;
  end loop;
  if p_kind = 'students' then
    with source as (
      select pg_catalog.to_jsonb(student) raw
      from public.students student
      where p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ',student.name,student.school,student.grade) ilike '%' || p_filters ->> 'search' || '%'
    )
    select pg_catalog.jsonb_build_object(
      'status',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct raw ->> 'status' value from source where nullif(raw ->> 'status','') is not null and ((p_filters ->> 'schoolCategory') is null or pg_catalog.coalesce(raw ->> 'school_category',raw ->> 'schoolCategory') = p_filters ->> 'schoolCategory') and ((p_filters ->> 'school') is null or raw ->> 'school' = p_filters ->> 'school') and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade') order by value collate dashboard_private.ko_numeric limit 500) option),
      'schoolCategory',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct pg_catalog.coalesce(raw ->> 'school_category',raw ->> 'schoolCategory') value from source where nullif(pg_catalog.coalesce(raw ->> 'school_category',raw ->> 'schoolCategory'),'') is not null and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status') and ((p_filters ->> 'school') is null or raw ->> 'school' = p_filters ->> 'school') and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade') order by value collate dashboard_private.ko_numeric limit 500) option),
      'school',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct raw ->> 'school' value from source where nullif(raw ->> 'school','') is not null and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status') and ((p_filters ->> 'schoolCategory') is null or pg_catalog.coalesce(raw ->> 'school_category',raw ->> 'schoolCategory') = p_filters ->> 'schoolCategory') and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade') order by value collate dashboard_private.ko_numeric limit 500) option),
      'grade',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct raw ->> 'grade' value from source where nullif(raw ->> 'grade','') is not null and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status') and ((p_filters ->> 'schoolCategory') is null or pg_catalog.coalesce(raw ->> 'school_category',raw ->> 'schoolCategory') = p_filters ->> 'schoolCategory') and ((p_filters ->> 'school') is null or raw ->> 'school' = p_filters ->> 'school') order by value collate dashboard_private.ko_numeric limit 500) option)
    ) into v_result;
  elsif p_kind = 'classes' then
    with source as (
      select class.id, pg_catalog.to_jsonb(class) raw
      from public.classes class
      where p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ',class.name,class.subject,class.teacher,pg_catalog.coalesce(pg_catalog.to_jsonb(class) ->> 'classroom',pg_catalog.to_jsonb(class) ->> 'room')) ilike '%' || p_filters ->> 'search' || '%'
    )
    select pg_catalog.jsonb_build_object(
      'status',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct raw ->> 'status' value from source where nullif(raw ->> 'status','') is not null and ((p_filters ->> 'subject') is null or raw ->> 'subject' = p_filters ->> 'subject') and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade') and ((p_filters ->> 'teacher') is null or pg_catalog.coalesce(raw ->> 'teacher_name',raw ->> 'teacher') = p_filters ->> 'teacher') and ((p_filters ->> 'classroom') is null or pg_catalog.coalesce(raw ->> 'classroom',raw ->> 'room') = p_filters ->> 'classroom') and ((p_filters ->> 'periodId') is null or exists (select 1 from public.class_schedule_sync_group_members member where member.class_id=source.id and member.group_id::text=p_filters ->> 'periodId')) order by value collate dashboard_private.ko_numeric limit 500) option),
      'subject',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct raw ->> 'subject' value from source where nullif(raw ->> 'subject','') is not null and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status') and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade') and ((p_filters ->> 'teacher') is null or pg_catalog.coalesce(raw ->> 'teacher_name',raw ->> 'teacher') = p_filters ->> 'teacher') and ((p_filters ->> 'classroom') is null or pg_catalog.coalesce(raw ->> 'classroom',raw ->> 'room') = p_filters ->> 'classroom') and ((p_filters ->> 'periodId') is null or exists (select 1 from public.class_schedule_sync_group_members member where member.class_id=source.id and member.group_id::text=p_filters ->> 'periodId')) order by value collate dashboard_private.ko_numeric limit 500) option),
      'grade',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct raw ->> 'grade' value from source where nullif(raw ->> 'grade','') is not null and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status') and ((p_filters ->> 'subject') is null or raw ->> 'subject' = p_filters ->> 'subject') and ((p_filters ->> 'teacher') is null or pg_catalog.coalesce(raw ->> 'teacher_name',raw ->> 'teacher') = p_filters ->> 'teacher') and ((p_filters ->> 'classroom') is null or pg_catalog.coalesce(raw ->> 'classroom',raw ->> 'room') = p_filters ->> 'classroom') and ((p_filters ->> 'periodId') is null or exists (select 1 from public.class_schedule_sync_group_members member where member.class_id=source.id and member.group_id::text=p_filters ->> 'periodId')) order by value collate dashboard_private.ko_numeric limit 500) option),
      'teacher',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct pg_catalog.coalesce(raw ->> 'teacher_name',raw ->> 'teacher') value from source where nullif(pg_catalog.coalesce(raw ->> 'teacher_name',raw ->> 'teacher'),'') is not null and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status') and ((p_filters ->> 'subject') is null or raw ->> 'subject' = p_filters ->> 'subject') and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade') and ((p_filters ->> 'classroom') is null or pg_catalog.coalesce(raw ->> 'classroom',raw ->> 'room') = p_filters ->> 'classroom') and ((p_filters ->> 'periodId') is null or exists (select 1 from public.class_schedule_sync_group_members member where member.class_id=source.id and member.group_id::text=p_filters ->> 'periodId')) order by value collate dashboard_private.ko_numeric limit 500) option),
      'classroom',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct pg_catalog.coalesce(raw ->> 'classroom',raw ->> 'room') value from source where nullif(pg_catalog.coalesce(raw ->> 'classroom',raw ->> 'room'),'') is not null and ((p_filters ->> 'status') is null or raw ->> 'status' = p_filters ->> 'status') and ((p_filters ->> 'subject') is null or raw ->> 'subject' = p_filters ->> 'subject') and ((p_filters ->> 'grade') is null or raw ->> 'grade' = p_filters ->> 'grade') and ((p_filters ->> 'teacher') is null or pg_catalog.coalesce(raw ->> 'teacher_name',raw ->> 'teacher') = p_filters ->> 'teacher') and ((p_filters ->> 'periodId') is null or exists (select 1 from public.class_schedule_sync_group_members member where member.class_id=source.id and member.group_id::text=p_filters ->> 'periodId')) order by value collate dashboard_private.ko_numeric limit 500) option),
      'periods',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(option order by option ->> 'label' collate dashboard_private.ko_numeric),'[]'::jsonb) from (select pg_catalog.jsonb_build_object('value',group_row.id,'label',group_row.name,'aliases',pg_catalog.jsonb_build_array(group_row.id::text,group_row.name),'isDefault',group_row.is_default) option from public.class_schedule_sync_groups group_row where exists (select 1 from public.class_schedule_sync_group_members member join source on source.id=member.class_id where member.group_id=group_row.id and ((p_filters ->> 'status') is null or source.raw ->> 'status'=p_filters ->> 'status') and ((p_filters ->> 'subject') is null or source.raw ->> 'subject'=p_filters ->> 'subject') and ((p_filters ->> 'grade') is null or source.raw ->> 'grade'=p_filters ->> 'grade') and ((p_filters ->> 'teacher') is null or pg_catalog.coalesce(source.raw ->> 'teacher_name',source.raw ->> 'teacher')=p_filters ->> 'teacher') and ((p_filters ->> 'classroom') is null or pg_catalog.coalesce(source.raw ->> 'classroom',source.raw ->> 'room')=p_filters ->> 'classroom')) order by group_row.name collate dashboard_private.ko_numeric,group_row.id limit 500) bounded)
    ) into v_result;
  else
    with source as (
      select pg_catalog.to_jsonb(textbook) raw
      from public.textbooks textbook
      where p_filters ->> 'search' = '' or pg_catalog.concat_ws(' ',textbook.title,textbook.subject,textbook.publisher) ilike '%' || p_filters ->> 'search' || '%'
    )
    select pg_catalog.jsonb_build_object(
      'status',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct raw ->> 'status' value from source where nullif(raw ->> 'status','') is not null and ((p_filters ->> 'subject') is null or raw ->> 'subject'=p_filters ->> 'subject') and ((p_filters ->> 'publisher') is null or raw ->> 'publisher'=p_filters ->> 'publisher') order by value collate dashboard_private.ko_numeric limit 500) option),
      'subject',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct raw ->> 'subject' value from source where nullif(raw ->> 'subject','') is not null and ((p_filters ->> 'status') is null or raw ->> 'status'=p_filters ->> 'status') and ((p_filters ->> 'publisher') is null or raw ->> 'publisher'=p_filters ->> 'publisher') order by value collate dashboard_private.ko_numeric limit 500) option),
      'publisher',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(value order by value collate dashboard_private.ko_numeric),'[]'::jsonb) from (select distinct raw ->> 'publisher' value from source where nullif(raw ->> 'publisher','') is not null and ((p_filters ->> 'status') is null or raw ->> 'status'=p_filters ->> 'status') and ((p_filters ->> 'subject') is null or raw ->> 'subject'=p_filters ->> 'subject') order by value collate dashboard_private.ko_numeric limit 500) option)
    ) into v_result;
  end if;
  return v_result;
end
$function$;

create function public.list_management_class_textbook_candidates_v1(
  p_class_id uuid,
  p_search text,
  p_filters jsonb,
  p_cursor_sort_key text,
  p_cursor_id uuid,
  p_limit integer
)
returns table(row_data jsonb, sort_key text, id uuid)
language sql
stable
security invoker
set search_path = ''
as $function$
  with valid_input as (
    select 1
    where pg_catalog.jsonb_typeof(p_filters) = 'object'
      and p_filters ?& array['subject','schoolLevel','gradeLevel','subSubject']
      and not exists (select 1 from pg_catalog.jsonb_object_keys(p_filters) key where key not in ('subject','schoolLevel','gradeLevel','subSubject'))
      and not exists (select 1 from pg_catalog.jsonb_each(p_filters) entry where pg_catalog.jsonb_typeof(entry.value) <> 'string')
  ), selected_class as (
    select class.id
    from public.classes class
    where class.id = p_class_id
  ), textbook_source as (
    select textbook.id,pg_catalog.to_jsonb(textbook) raw
    from public.textbooks textbook
  ), candidate as (
    select textbook.id,textbook.raw,
      pg_catalog.coalesce(
        pg_catalog.nullif(pg_catalog.regexp_replace(pg_catalog.btrim(pg_catalog.coalesce(textbook.raw ->> 'title',textbook.raw ->> 'name')), '[[:space:]]+', ' ', 'g'), ''),
        U&'\FFFF'
      ) collate dashboard_private.ko_numeric normalized_sort
    from textbook_source textbook
    cross join selected_class
    cross join valid_input
    where p_search is not null
      and (p_search = '' or pg_catalog.concat_ws(' ',textbook.raw ->> 'title',textbook.raw ->> 'name',textbook.raw ->> 'subject',textbook.raw ->> 'publisher',textbook.raw ->> 'school_levels',textbook.raw ->> 'grade_levels',textbook.raw ->> 'sub_subject') ilike '%' || p_search || '%')
      and (p_filters ->> 'subject' = '' or textbook.raw ->> 'subject' = p_filters ->> 'subject')
      and (p_filters ->> 'schoolLevel' = '' or textbook.raw ->> 'school_level' = p_filters ->> 'schoolLevel' or pg_catalog.coalesce(textbook.raw -> 'school_levels','[]'::jsonb) ? (p_filters ->> 'schoolLevel'))
      and (p_filters ->> 'gradeLevel' = '' or textbook.raw ->> 'grade_level' = p_filters ->> 'gradeLevel' or pg_catalog.coalesce(textbook.raw -> 'grade_levels','[]'::jsonb) ? (p_filters ->> 'gradeLevel'))
      and (p_filters ->> 'subSubject' = '' or textbook.raw ->> 'sub_subject' = p_filters ->> 'subSubject')
  )
  select pg_catalog.jsonb_build_object(
      'id',candidate.id,
      'title',pg_catalog.coalesce(candidate.raw ->> 'title',candidate.raw ->> 'name',''),
      'subject',candidate.raw ->> 'subject',
      'publisher',candidate.raw ->> 'publisher',
      'school_levels',pg_catalog.coalesce(candidate.raw -> 'school_levels','[]'::jsonb),
      'grade_levels',pg_catalog.coalesce(candidate.raw -> 'grade_levels','[]'::jsonb),
      'sub_subject',candidate.raw ->> 'sub_subject',
      'subject_area_key',candidate.raw ->> 'subject_area_key'
    ),candidate.normalized_sort::text,candidate.id
  from candidate
  where p_class_id is not null
    and p_limit between 1 and 30
    and ((p_cursor_sort_key is null and p_cursor_id is null)
      or candidate.normalized_sort > p_cursor_sort_key collate dashboard_private.ko_numeric
      or (candidate.normalized_sort = p_cursor_sort_key collate dashboard_private.ko_numeric and candidate.id > p_cursor_id))
  order by candidate.normalized_sort asc,candidate.id asc
  limit p_limit + 1
$function$;

create function public.list_management_detail_relation_page_v1(
  p_kind text,
  p_id uuid,
  p_relation_kind text,
  p_cursor_sort_key text default null,
  p_cursor_id uuid default null,
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_allowed boolean;
  v_rows jsonb;
  v_count integer;
  v_next_sort_key text;
  v_next_id uuid;
begin
  v_allowed := (p_kind = 'students' and p_relation_kind in ('enrollments','lifecycle_history','class_picker'))
    or (p_kind = 'classes' and p_relation_kind in ('registered_students','waitlisted_students'))
    or (p_kind = 'textbooks' and p_relation_kind in ('active_classes','purchase_history'));
  if not v_allowed or p_id is null then raise exception 'management_relation_invalid' using errcode = '22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 30 then raise exception 'management_page_limit_invalid' using errcode = '22023'; end if;
  if (p_cursor_sort_key is null) <> (p_cursor_id is null) then raise exception 'management_cursor_invalid' using errcode = '22023'; end if;

  if p_kind = 'students' and p_relation_kind = 'lifecycle_history' then
    with page as (
      select history.id, history.changed_at::text sort_value,
        pg_catalog.jsonb_build_object(
          'id',history.id,'classId',history.class_id,'className',class.name,'subject',class.subject,
          'teacher',pg_catalog.coalesce(pg_catalog.to_jsonb(class) ->> 'teacher_name',class.teacher),
          'eventType',history.action,'action',history.action,
          'label',case history.action when 'enrolled' then '수강 등록' when 'waitlist' then '대기 등록' when 'removed' then '수강 해제' else history.action end,
          'occurredAt',history.changed_at,'changedAt',history.changed_at,'safeSummary',pg_catalog.coalesce(history.memo,'')) row_data
      from public.student_class_enrollment_history history
      left join public.classes class on class.id=history.class_id
      where history.student_id = p_id and (p_cursor_sort_key is null or history.changed_at < p_cursor_sort_key::timestamptz or (history.changed_at = p_cursor_sort_key::timestamptz and history.id > p_cursor_id))
      order by history.changed_at desc, history.id asc limit p_limit + 1
    ) select pg_catalog.coalesce(pg_catalog.jsonb_agg(row_data order by sort_value desc,id asc) filter (where ordinal <= p_limit),'[]'::jsonb),pg_catalog.count(*),(pg_catalog.array_agg(sort_value) filter (where ordinal=p_limit))[1],(pg_catalog.array_agg(id) filter (where ordinal=p_limit))[1]
      into v_rows,v_count,v_next_sort_key,v_next_id from (select page.*,pg_catalog.row_number() over (order by sort_value desc,id asc) ordinal from page) bounded;
  elsif p_kind = 'students' and p_relation_kind = 'class_picker' then
    with page as (
      select class.id, pg_catalog.coalesce(nullif(pg_catalog.btrim(class.name),''),U&'\FFFF') collate dashboard_private.ko_numeric sort_value,
        pg_catalog.jsonb_build_object('id',class.id,'name',class.name,'subject',class.subject,'grade',class.grade,'status',class.status) row_data
      from public.classes class
      where p_cursor_sort_key is null or pg_catalog.coalesce(nullif(pg_catalog.btrim(class.name),''),U&'\FFFF') collate dashboard_private.ko_numeric > p_cursor_sort_key collate dashboard_private.ko_numeric
        or (pg_catalog.coalesce(nullif(pg_catalog.btrim(class.name),''),U&'\FFFF') collate dashboard_private.ko_numeric = p_cursor_sort_key collate dashboard_private.ko_numeric and class.id > p_cursor_id)
      order by sort_value asc,class.id asc limit p_limit + 1
    ) select pg_catalog.coalesce(pg_catalog.jsonb_agg(row_data order by sort_value,id) filter (where ordinal <= p_limit),'[]'::jsonb),pg_catalog.count(*),(pg_catalog.array_agg(sort_value) filter (where ordinal=p_limit))[1],(pg_catalog.array_agg(id) filter (where ordinal=p_limit))[1]
      into v_rows,v_count,v_next_sort_key,v_next_id from (select page.*,pg_catalog.row_number() over (order by sort_value,id) ordinal from page) bounded;
  elsif p_kind = 'students' then
    with selected_student as (
      select pg_catalog.to_jsonb(student) raw from public.students student where student.id=p_id
    ), candidates as (
      select enrollment.class_id,
        case when pg_catalog.coalesce(pg_catalog.to_jsonb(enrollment) ->> 'roster_active','false')::boolean then 'enrolled' else 'waitlisted' end status,
        enrollment.updated_at sort_at,enrollment.id event_id,1 priority
      from public.ops_registration_enrollments enrollment
      where enrollment.student_id=p_id and enrollment.class_id is not null
        and (pg_catalog.coalesce(pg_catalog.to_jsonb(enrollment) ->> 'roster_active','false')::boolean or enrollment.status in ('enrolled','waitlist','waitlisted'))
      union all
      select class.id,'enrolled',pg_catalog.coalesce(class.updated_at,'epoch'::timestamptz),class.id,2
      from selected_student cross join lateral pg_catalog.jsonb_array_elements_text(pg_catalog.coalesce(selected_student.raw -> 'class_ids','[]'::jsonb)) direct(class_id)
      join public.classes class on class.id::text=direct.class_id
      union all
      select class.id,'waitlisted',pg_catalog.coalesce(class.updated_at,'epoch'::timestamptz),class.id,3
      from selected_student cross join lateral pg_catalog.jsonb_array_elements_text(pg_catalog.coalesce(selected_student.raw -> 'waitlist_class_ids','[]'::jsonb)) direct(class_id)
      join public.classes class on class.id::text=direct.class_id
      union all
      select class.id,'enrolled',pg_catalog.coalesce(class.updated_at,'epoch'::timestamptz),class.id,4
      from public.classes class where pg_catalog.coalesce(pg_catalog.to_jsonb(class) -> 'student_ids','[]'::jsonb) ? p_id::text
      union all
      select class.id,'waitlisted',pg_catalog.coalesce(class.updated_at,'epoch'::timestamptz),class.id,5
      from public.classes class where pg_catalog.coalesce(pg_catalog.to_jsonb(class) -> 'waitlist_ids','[]'::jsonb) ? p_id::text
        or pg_catalog.coalesce(pg_catalog.to_jsonb(class) -> 'waitlist_student_ids','[]'::jsonb) ? p_id::text
    ), canonical as (
      select distinct on (class_id) class_id,status,sort_at,event_id
      from candidates
      order by class_id,case when status='enrolled' then 0 else 1 end,priority,sort_at desc,event_id
    ), page as (
      select canonical.event_id id,canonical.sort_at::text sort_value,
        pg_catalog.jsonb_build_object(
          'classId',class.id,'className',class.name,'name',class.name,'subject',class.subject,
          'teacher',pg_catalog.coalesce(pg_catalog.to_jsonb(class) ->> 'teacher_name',class.teacher),
          'classroom',pg_catalog.coalesce(pg_catalog.to_jsonb(class) ->> 'classroom',pg_catalog.to_jsonb(class) ->> 'room'),
          'schedule',class.schedule,'status',canonical.status,'startedOn',null,'endedOn',null) row_data
      from canonical join public.classes class on class.id=canonical.class_id
      where p_cursor_sort_key is null or canonical.sort_at < p_cursor_sort_key::timestamptz or (canonical.sort_at=p_cursor_sort_key::timestamptz and canonical.event_id > p_cursor_id)
      order by canonical.sort_at desc,canonical.event_id asc limit p_limit + 1
    ) select pg_catalog.coalesce(pg_catalog.jsonb_agg(row_data order by sort_value desc,id) filter (where ordinal <= p_limit),'[]'::jsonb),pg_catalog.count(*),(pg_catalog.array_agg(sort_value) filter (where ordinal=p_limit))[1],(pg_catalog.array_agg(id) filter (where ordinal=p_limit))[1]
      into v_rows,v_count,v_next_sort_key,v_next_id from (select page.*,pg_catalog.row_number() over (order by sort_value desc,id) ordinal from page) bounded;
  elsif p_kind = 'classes' then
    with selected_class as (select pg_catalog.to_jsonb(class) raw from public.classes class where class.id = p_id), page as (
      select student.id, pg_catalog.coalesce(nullif(pg_catalog.btrim(student.name),''),U&'\FFFF') collate dashboard_private.ko_numeric sort_value,
        pg_catalog.jsonb_build_object(
          'id',student.id,'name',student.name,'school',student.school,'grade',student.grade,'status',student.status,
          'contact',student.contact,'parentContact',student.parent_contact,
          'recentIssue',pg_catalog.to_jsonb(student) -> 'recent_issue') row_data
      from public.students student cross join selected_class
      where pg_catalog.coalesce(selected_class.raw -> (case when p_relation_kind='registered_students' then 'student_ids' else 'waitlist_ids' end),'[]'::jsonb) ? student.id::text
        and (p_cursor_sort_key is null or pg_catalog.coalesce(nullif(pg_catalog.btrim(student.name),''),U&'\FFFF') collate dashboard_private.ko_numeric > p_cursor_sort_key collate dashboard_private.ko_numeric
          or (pg_catalog.coalesce(nullif(pg_catalog.btrim(student.name),''),U&'\FFFF') collate dashboard_private.ko_numeric = p_cursor_sort_key collate dashboard_private.ko_numeric and student.id > p_cursor_id))
      order by sort_value asc,student.id asc limit p_limit + 1
    ) select pg_catalog.coalesce(pg_catalog.jsonb_agg(row_data order by sort_value,id) filter (where ordinal <= p_limit),'[]'::jsonb),pg_catalog.count(*),(pg_catalog.array_agg(sort_value) filter (where ordinal=p_limit))[1],(pg_catalog.array_agg(id) filter (where ordinal=p_limit))[1]
      into v_rows,v_count,v_next_sort_key,v_next_id from (select page.*,pg_catalog.row_number() over (order by sort_value,id) ordinal from page) bounded;
  elsif p_relation_kind = 'active_classes' then
    with page as (
      select class.id, pg_catalog.coalesce(nullif(pg_catalog.btrim(class.name),''),U&'\FFFF') collate dashboard_private.ko_numeric sort_value,
        pg_catalog.jsonb_build_object('id',class.id,'name',class.name,'subject',class.subject,'teacherName',class.teacher) row_data
      from public.classes class where pg_catalog.coalesce(pg_catalog.to_jsonb(class) -> 'textbook_ids','[]'::jsonb) ? p_id::text
        and (p_cursor_sort_key is null or pg_catalog.coalesce(nullif(pg_catalog.btrim(class.name),''),U&'\FFFF') collate dashboard_private.ko_numeric > p_cursor_sort_key collate dashboard_private.ko_numeric
          or (pg_catalog.coalesce(nullif(pg_catalog.btrim(class.name),''),U&'\FFFF') collate dashboard_private.ko_numeric = p_cursor_sort_key collate dashboard_private.ko_numeric and class.id > p_cursor_id))
      order by sort_value asc,class.id asc limit p_limit + 1
    ) select pg_catalog.coalesce(pg_catalog.jsonb_agg(row_data order by sort_value,id) filter (where ordinal <= p_limit),'[]'::jsonb),pg_catalog.count(*),(pg_catalog.array_agg(sort_value) filter (where ordinal=p_limit))[1],(pg_catalog.array_agg(id) filter (where ordinal=p_limit))[1]
      into v_rows,v_count,v_next_sort_key,v_next_id from (select page.*,pg_catalog.row_number() over (order by sort_value,id) ordinal from page) bounded;
  else
    with page as (
      select line.id, line.created_at::text sort_value,
        pg_catalog.jsonb_build_object('id',line.id,'status',line.status,'quantity',line.requested_quantity,'requestedAt',line.created_at) row_data
      from public.textbook_purchase_order_lines line where line.textbook_id = p_id
        and (p_cursor_sort_key is null or line.created_at < p_cursor_sort_key::timestamptz or (line.created_at = p_cursor_sort_key::timestamptz and line.id > p_cursor_id))
      order by line.created_at desc,line.id asc limit p_limit + 1
    ) select pg_catalog.coalesce(pg_catalog.jsonb_agg(row_data order by sort_value desc,id) filter (where ordinal <= p_limit),'[]'::jsonb),pg_catalog.count(*),(pg_catalog.array_agg(sort_value) filter (where ordinal=p_limit))[1],(pg_catalog.array_agg(id) filter (where ordinal=p_limit))[1]
      into v_rows,v_count,v_next_sort_key,v_next_id from (select page.*,pg_catalog.row_number() over (order by sort_value desc,id) ordinal from page) bounded;
  end if;
  return pg_catalog.jsonb_build_object('kind',p_kind,'relationKind',p_relation_kind,'page',pg_catalog.jsonb_build_object(
    'rows',v_rows,
    'hasMore',v_count > p_limit,
    'nextCursor',case when v_count > p_limit then pg_catalog.jsonb_build_object('sortValue',v_next_sort_key,'id',v_next_id) else null end
  ));
end
$function$;

create function public.get_management_detail_v1(p_kind text, p_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_raw jsonb;
  v_detail jsonb;
begin
  if p_kind not in ('students','classes','textbooks') or p_id is null then raise exception 'management_detail_invalid' using errcode = '22023'; end if;
  if p_kind = 'students' then
    select pg_catalog.to_jsonb(student) into v_raw from public.students student where student.id = p_id;
    if v_raw is null then return null; end if;
    v_detail := pg_catalog.jsonb_build_object('kind','students','record',pg_catalog.jsonb_build_object(
      'id',p_id,'name',v_raw ->> 'name','status',v_raw ->> 'status','uid',v_raw -> 'uid',
      'schoolCategory',pg_catalog.coalesce(v_raw -> 'school_category',v_raw -> 'schoolCategory'),'school',v_raw -> 'school','grade',v_raw -> 'grade',
      'contact',v_raw -> 'contact','parentContact',pg_catalog.coalesce(v_raw -> 'parent_contact',v_raw -> 'parentContact'),
      'enrollDate',pg_catalog.coalesce(v_raw -> 'enroll_date',v_raw -> 'enrollDate'),'counselingNote',pg_catalog.coalesce(v_raw -> 'counseling_note',v_raw -> 'counselingNote'),
      'recentIssue',pg_catalog.coalesce(v_raw -> 'recent_issue',v_raw -> 'recentIssue'),'updatedAt',v_raw -> 'updated_at'),
      'enrollments',public.list_management_detail_relation_page_v1('students',p_id,'enrollments') -> 'page',
      'lifecycleHistory',public.list_management_detail_relation_page_v1('students',p_id,'lifecycle_history') -> 'page',
      'classPicker',public.list_management_detail_relation_page_v1('students',p_id,'class_picker') -> 'page');
  elsif p_kind = 'classes' then
    select pg_catalog.to_jsonb(class) into v_raw from public.classes class where class.id = p_id;
    if v_raw is null then return null; end if;
    v_detail := pg_catalog.jsonb_build_object('kind','classes','record',pg_catalog.jsonb_build_object(
      'id',p_id,'name',v_raw ->> 'name','status',v_raw ->> 'status','classType',pg_catalog.coalesce(v_raw -> 'class_type',v_raw -> 'classType'),
      'subject',v_raw ->> 'subject','subjectAreaKey',pg_catalog.coalesce(v_raw -> 'subject_area_key',v_raw -> 'subjectAreaKey'),'grade',v_raw ->> 'grade',
      'teacher',v_raw ->> 'teacher','schedule',v_raw ->> 'schedule','classroom',pg_catalog.coalesce(v_raw ->> 'classroom',v_raw ->> 'room'),'capacity',v_raw -> 'capacity','fee',v_raw -> 'fee',
      'textbookIds',pg_catalog.coalesce(v_raw -> 'textbook_ids','[]'::jsonb),'updatedAt',v_raw -> 'updated_at'),
      'schedule',pg_catalog.jsonb_build_object(
        'plan',pg_catalog.coalesce(v_raw -> 'schedule_plan','{}'::jsonb),
        'slots',case
          when pg_catalog.jsonb_typeof(v_raw -> 'schedule_plan' -> 'sessions')='array' then v_raw -> 'schedule_plan' -> 'sessions'
          when pg_catalog.jsonb_typeof(v_raw -> 'schedule_plan' -> 'session_list')='array' then v_raw -> 'schedule_plan' -> 'session_list'
          else '[]'::jsonb
        end),
      'registeredStudents',public.list_management_detail_relation_page_v1('classes',p_id,'registered_students') -> 'page',
      'waitlistedStudents',public.list_management_detail_relation_page_v1('classes',p_id,'waitlisted_students') -> 'page',
      'textbooks',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',textbook.id,'title',textbook.title,'subject',textbook.subject,'publisher',textbook.publisher,
        'schoolLevels',pg_catalog.coalesce(pg_catalog.to_jsonb(textbook) -> 'school_levels','[]'::jsonb),
        'gradeLevels',pg_catalog.coalesce(pg_catalog.to_jsonb(textbook) -> 'grade_levels','[]'::jsonb),
        'subSubject',pg_catalog.to_jsonb(textbook) -> 'sub_subject','subjectAreaKey',pg_catalog.to_jsonb(textbook) -> 'subject_area_key'
      ) order by textbook.title collate dashboard_private.ko_numeric,textbook.id),'[]'::jsonb) from public.textbooks textbook where pg_catalog.coalesce(v_raw -> 'textbook_ids','[]'::jsonb) ? textbook.id::text),
      'groups',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',group_row.id,'name',group_row.name,'subject',group_row.subject,'isDefault',group_row.is_default
      ) order by group_row.sort_order,group_row.name collate dashboard_private.ko_numeric,group_row.id),'[]'::jsonb)
        from public.class_schedule_sync_group_members member join public.class_schedule_sync_groups group_row on group_row.id=member.group_id where member.class_id=p_id),
      'formReferences',pg_catalog.jsonb_build_object(
        'teacherCatalogs',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',catalog.id,'name',catalog.name,'subjects',catalog.subjects,'isVisible',catalog.is_visible,'sortOrder',catalog.sort_order) order by catalog.sort_order,catalog.name collate dashboard_private.ko_numeric,catalog.id),'[]'::jsonb) from public.teacher_catalogs catalog where catalog.is_visible),
        'classroomCatalogs',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',catalog.id,'name',catalog.name,'subjects',catalog.subjects,'isVisible',catalog.is_visible,'sortOrder',catalog.sort_order) order by catalog.sort_order,catalog.name collate dashboard_private.ko_numeric,catalog.id),'[]'::jsonb) from public.classroom_catalogs catalog where catalog.is_visible),
        'scienceSubjectAreas',(select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('subject',area.subject,'areaKey',area.area_key,'label',area.label,'sortOrder',area.sort_order) order by area.sort_order,area.area_key),'[]'::jsonb) from public.list_active_science_subject_areas_v1() area)
      ));
  else
    select pg_catalog.to_jsonb(textbook) into v_raw from public.textbooks textbook where textbook.id = p_id;
    if v_raw is null then return null; end if;
    v_detail := pg_catalog.jsonb_build_object('kind','textbooks','record',pg_catalog.jsonb_build_object(
      'id',p_id,'title',pg_catalog.coalesce(v_raw ->> 'title',v_raw ->> 'name'),'subject',v_raw ->> 'subject','publisher',v_raw -> 'publisher',
      'price',pg_catalog.coalesce(v_raw -> 'price',v_raw -> 'sale_price',v_raw -> 'list_price'),'tags',pg_catalog.coalesce(v_raw -> 'tags','[]'::jsonb),
      'status',pg_catalog.coalesce(v_raw ->> 'status',''),
      'updatedAt',v_raw -> 'updated_at'),
      'taxonomy',pg_catalog.jsonb_build_object('schoolLevels',pg_catalog.coalesce(v_raw -> 'school_levels','[]'::jsonb),'gradeLevels',pg_catalog.coalesce(v_raw -> 'grade_levels','[]'::jsonb),'subSubject',v_raw -> 'sub_subject'),
      'activeClasses',public.list_management_detail_relation_page_v1('textbooks',p_id,'active_classes') -> 'page',
      'progressSummary',pg_catalog.jsonb_build_object(
        'assignedClasses',(select pg_catalog.count(*) from public.classes class where pg_catalog.coalesce(pg_catalog.to_jsonb(class) -> 'textbook_ids','[]'::jsonb) ? p_id::text),
        'updatedSessions',(select pg_catalog.count(*) from public.progress_logs progress where progress.textbook_id=p_id),
        'lastUpdatedAt',(select pg_catalog.max(progress.updated_at) from public.progress_logs progress where progress.textbook_id=p_id)),
      'purchaseHistory',public.list_management_detail_relation_page_v1('textbooks',p_id,'purchase_history') -> 'page');
  end if;
  return v_detail;
end
$function$;

revoke all on function public.list_management_page_v1(text,jsonb,text,uuid,integer) from public, anon;
revoke all on function public.get_management_default_class_period_v1() from public, anon;
revoke all on function public.get_management_stats_v1(text,jsonb) from public, anon;
revoke all on function public.list_management_filter_options_v1(text,jsonb) from public, anon;
revoke all on function public.get_management_detail_v1(text,uuid) from public, anon;
revoke all on function public.list_management_detail_relation_page_v1(text,uuid,text,text,uuid,integer) from public, anon;
revoke all on function public.list_management_class_textbook_candidates_v1(uuid,text,jsonb,text,uuid,integer) from public, anon;
grant execute on function public.list_management_page_v1(text,jsonb,text,uuid,integer) to authenticated;
grant execute on function public.get_management_default_class_period_v1() to authenticated;
grant execute on function public.get_management_stats_v1(text,jsonb) to authenticated;
grant execute on function public.list_management_filter_options_v1(text,jsonb) to authenticated;
grant execute on function public.get_management_detail_v1(text,uuid) to authenticated;
grant execute on function public.list_management_detail_relation_page_v1(text,uuid,text,text,uuid,integer) to authenticated;
grant execute on function public.list_management_class_textbook_candidates_v1(uuid,text,jsonb,text,uuid,integer) to authenticated;
