-- Additive numbered reads. Cursor endpoints, policies and existing grants are unchanged.
-- OFFSET visits narrow authorized keys; relation enrichment is bounded to the page.
create function public.list_management_numbered_page_v1(
  p_kind text,
  p_filters jsonb,
  p_page integer,
  p_page_size integer,
  p_sort jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_expected text[];
  v_keys text[];
  v_key text;
  v_sort jsonb;
  v_item jsonb;
  v_seen text[] := array[]::text[];
  v_sort_map jsonb;
  v_sort_fields text := '';
  v_order text := '';
  v_index integer := 0;
  v_expression text;
  v_direction text;
  v_source text;
  v_table text;
  v_row text;
  v_result jsonb;
  v_offset bigint;
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
  if pg_catalog.jsonb_typeof(p_filters) is distinct from 'object' or p_filters ->> 'kind' is distinct from p_kind then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  select pg_catalog.array_agg(key order by key) into v_keys from pg_catalog.jsonb_object_keys(p_filters) keys(key);
  if v_keys is distinct from v_expected or pg_catalog.jsonb_typeof(p_filters -> 'search') is distinct from 'string' then
    raise exception 'management_filters_invalid' using errcode = '22023';
  end if;
  foreach v_key in array v_expected loop
    if v_key not in ('kind','search') and pg_catalog.jsonb_typeof(p_filters -> v_key) not in ('string','null') then
      raise exception 'management_filters_invalid' using errcode = '22023';
    end if;
  end loop;
  if p_page is null or p_page < 1 then
    raise exception 'management_page_invalid' using errcode = '22023';
  end if;
  if p_page_size is null or p_page_size not in (10,15,20) then
    raise exception 'management_page_size_invalid' using errcode = '22023';
  end if;
  -- Cast before multiplication: max int page * 20 must not overflow integer.
  v_offset := (p_page::bigint - 1) * p_page_size::bigint;
  if pg_catalog.jsonb_typeof(p_sort) is distinct from 'array' then
    raise exception 'management_sort_invalid' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_sort) > 2 then
    raise exception 'management_sort_invalid' using errcode = '22023';
  end if;
  v_sort := p_sort;
  if v_sort = '[]'::jsonb then
    v_sort := case p_kind
      when 'students' then '[{"id":"status","desc":false},{"id":"title","desc":false}]'::jsonb
      when 'classes' then '[{"id":"title","desc":false}]'::jsonb
      else '[{"id":"subject","desc":false},{"id":"title","desc":false}]'::jsonb end;
  end if;

  -- Only expressions in these maps enter SQL. All user values stay bound parameters.
  if p_kind = 'students' then
    v_table := 'public.students';
    v_sort_map := pg_catalog.jsonb_build_object(
      'title', $e$coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.btrim(record.name),'[[:space:]]+',' ','g'),''),U&'\FFFF') collate dashboard_private.ko_numeric$e$,
      'status', $e$case when pg_catalog.btrim(record.status) like '%퇴원%' or pg_catalog.lower(pg_catalog.btrim(record.status)) in ('withdrawn','inactive','left') then 1 else 0 end$e$,
      'school', $e$nullif(pg_catalog.btrim(record.school),'') collate dashboard_private.ko_numeric$e$,
      'grade', $e$nullif(pg_catalog.btrim(record.grade),'') collate dashboard_private.ko_numeric$e$,
      'contact', $e$nullif(pg_catalog.btrim(record.contact),'') collate dashboard_private.ko_numeric$e$,
      'parentContact', $e$nullif(pg_catalog.btrim(record.parent_contact),'') collate dashboard_private.ko_numeric$e$
    );
    v_source := $sql$
      from public.students record
      where ($1 ->> 'search' = '' or pg_catalog.concat_ws(' ',record.name,record.school,record.grade) ilike '%' || ($1 ->> 'search') || '%')
        and (($1 ->> 'status') is null or record.status = $1 ->> 'status')
        and (($1 ->> 'schoolCategory') is null or exists (
          select 1 from public.academic_schools school where school.name=record.school and school.category=$1 ->> 'schoolCategory'
        ))
        and (($1 ->> 'school') is null or record.school = $1 ->> 'school')
        and (($1 ->> 'grade') is null or record.grade = $1 ->> 'grade')
    $sql$;
    v_row := $sql$pg_catalog.jsonb_build_object(
      'kind','students','id',record.id,'name',coalesce(record.name,''),
      'grade',record.grade,'school',record.school,'contact',record.contact,'parentContact',record.parent_contact,
      'status',coalesce(record.status,''),
      'sortKey',coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.btrim(record.name),'[[:space:]]+',' ','g'),''),U&'\FFFF'),
      'updatedAt',coalesce(pg_catalog.to_jsonb(record.created_at) #>> '{}','')
    )$sql$;
  elsif p_kind = 'classes' then
    v_table := 'public.classes';
    v_sort_map := pg_catalog.jsonb_build_object(
      'title', $e$coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.btrim(record.name),'[[:space:]]+',' ','g'),''),U&'\FFFF') collate dashboard_private.ko_numeric$e$,
      'status', $e$nullif(pg_catalog.btrim(record.status),'') collate dashboard_private.ko_numeric$e$,
      'subject', $e$nullif(pg_catalog.btrim(record.subject),'') collate dashboard_private.ko_numeric$e$,
      'grade', $e$nullif(pg_catalog.btrim(record.grade),'') collate dashboard_private.ko_numeric$e$,
      'schedule', $e$nullif(pg_catalog.btrim(record.schedule),'') collate dashboard_private.ko_numeric$e$,
      'teacher', $e$nullif(pg_catalog.btrim(record.teacher),'') collate dashboard_private.ko_numeric$e$,
      'classroom', $e$nullif(pg_catalog.btrim(record.room),'') collate dashboard_private.ko_numeric$e$,
      'capacity', 'record.capacity', 'tuition', 'record.fee'
    );
    v_source := $sql$
      from public.classes record
      where ($1 ->> 'search' = '' or pg_catalog.concat_ws(' ',record.name,record.subject,record.teacher,record.room) ilike '%' || ($1 ->> 'search') || '%')
        and (($1 ->> 'status') is null or record.status = $1 ->> 'status')
        and (($1 ->> 'subject') is null or record.subject = $1 ->> 'subject')
        and (($1 ->> 'grade') is null or record.grade = $1 ->> 'grade')
        and (($1 ->> 'teacher') is null or record.teacher = $1 ->> 'teacher')
        and (($1 ->> 'classroom') is null or record.room = $1 ->> 'classroom')
        and (($1 ->> 'periodId') is null or exists (
          select 1 from public.class_schedule_sync_group_members member where member.class_id=record.id and member.group_id::text=$1 ->> 'periodId'
        ))
    $sql$;
    -- Matches the FINAL 20260825152044 roster patch, including enrolled + roster_active.
    v_row := $sql$pg_catalog.jsonb_build_object(
      'kind','classes','id',record.id,'name',coalesce(record.name,''),'subject',coalesce(record.subject,''),
      'grade',record.grade,'schedule',record.schedule,'teacherName',record.teacher,'classroom',record.room,
      'capacity',record.capacity,'weeklyMinutes',null,'fee',record.fee,'status',coalesce(record.status,''),
      'studentCount',(select pg_catalog.count(distinct roster.student_id) from (
        select direct.student_id from pg_catalog.jsonb_array_elements_text(coalesce(record.student_ids,'[]'::jsonb)) direct(student_id)
        union all select enrollment.student_id::text from public.ops_registration_enrollments enrollment
          where enrollment.class_id=record.id and enrollment.status='enrolled' and enrollment.roster_active
        union all select student.id::text from public.students student where coalesce(student.class_ids,'[]'::jsonb) ? record.id::text
      ) roster),
      'sortKey',coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.btrim(record.name),'[[:space:]]+',' ','g'),''),U&'\FFFF'),
      'updatedAt',coalesce(pg_catalog.to_jsonb(record.created_at) #>> '{}','')
    )$sql$;
  else
    v_table := 'public.textbooks';
    v_sort_map := pg_catalog.jsonb_build_object(
      'title', $e$coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(record.title,record.name)),'[[:space:]]+',' ','g'),''),U&'\FFFF') collate dashboard_private.ko_numeric$e$,
      'status', $e$nullif(pg_catalog.btrim(record.status),'') collate dashboard_private.ko_numeric$e$,
      'subject', $e$nullif(pg_catalog.btrim(record.subject),'') collate dashboard_private.ko_numeric$e$,
      'publisher', $e$nullif(pg_catalog.btrim(record.publisher),'') collate dashboard_private.ko_numeric$e$,
      'price','record.price','updatedAt','record.updated_at'
    );
    v_source := $sql$
      from public.textbooks record
      where ($1 ->> 'search' = '' or pg_catalog.concat_ws(' ',record.title,record.name,record.subject,record.publisher) ilike '%' || ($1 ->> 'search') || '%')
        and (($1 ->> 'status') is null or record.status = $1 ->> 'status')
        and (($1 ->> 'subject') is null or record.subject = $1 ->> 'subject')
        and (($1 ->> 'publisher') is null or record.publisher = $1 ->> 'publisher')
    $sql$;
    v_row := $sql$pg_catalog.jsonb_build_object(
      'kind','textbooks','id',record.id,'title',coalesce(record.title,record.name,''),'subject',coalesce(record.subject,''),
      'publisher',record.publisher,'status',coalesce(record.status,''),'price',record.price,
      'activeClassCount',(select pg_catalog.count(*) from public.classes class where coalesce(class.textbook_ids,'[]'::jsonb) ? record.id::text),
      'sortKey',coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(record.title,record.name)),'[[:space:]]+',' ','g'),''),U&'\FFFF'),
      'updatedAt',coalesce(pg_catalog.to_jsonb(record.updated_at) #>> '{}','')
    )$sql$;
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(v_sort) items(value) loop
    if pg_catalog.jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'management_sort_invalid' using errcode = '22023';
    end if;
    select pg_catalog.array_agg(key order by key) into v_keys from pg_catalog.jsonb_object_keys(v_item) keys(key);
    v_key := v_item ->> 'id';
    if v_keys is distinct from array['desc','id'] or pg_catalog.jsonb_typeof(v_item -> 'id') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_item -> 'desc') is distinct from 'boolean'
      or not (v_sort_map ? v_key) or v_key = any(v_seen) then
      raise exception 'management_sort_invalid' using errcode = '22023';
    end if;
    v_seen := pg_catalog.array_append(v_seen,v_key);
    v_expression := v_sort_map ->> v_key;
    v_direction := case when (v_item ->> 'desc')::boolean then 'desc' else 'asc' end;
    v_sort_fields := v_sort_fields || pg_catalog.format(', %s as s%s',v_expression,v_index);
    v_order := v_order || pg_catalog.format('page.s%s %s nulls last, ',v_index,v_direction);
    v_index := v_index + 1;
  end loop;
  v_order := v_order || 'page.id asc';

  -- One MATERIALIZED predicate source is shared by count and page selection, under
  -- the invoker snapshot/RLS. It holds only parent ID plus at most two sort keys.
  -- The page fence prevents roster/class enrichment from running for skipped keys.
  execute pg_catalog.format($sql$
    with filtered as materialized (
      select record.id %s %s
    ), page as materialized (
      select page.* from filtered page order by %s offset $2 limit $3
    )
    select pg_catalog.jsonb_build_object(
      'rows',(select coalesce(pg_catalog.jsonb_agg(%s order by %s),'[]'::jsonb)
        from page join %s record on record.id=page.id),
      'page',$4,'pageSize',$3,'totalCount',(select pg_catalog.count(*) from filtered)
    )
  $sql$,v_sort_fields,v_source,v_order,v_row,v_order,v_table)
  into v_result using p_filters,v_offset,p_page_size,p_page;
  return v_result;
end
$function$;

revoke all on function public.list_management_numbered_page_v1(text,jsonb,integer,integer,jsonb) from public, anon;
grant execute on function public.list_management_numbered_page_v1(text,jsonb,integer,integer,jsonb) to authenticated;
