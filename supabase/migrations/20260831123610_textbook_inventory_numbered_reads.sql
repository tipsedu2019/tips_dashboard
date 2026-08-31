-- Read-only management contracts. All data-bearing helpers and endpoints are
-- invokers with an explicit admin/staff guard; no policies/mutations are changed.
-- Labels use legacy nonnumeric Korean localeCompare; title sort stays ko_numeric.
create collation dashboard_private.textbook_ko_label(provider=icu,locale='ko',deterministic=true);
create function dashboard_private.textbook_read_guard_v1() returns void
language plpgsql stable security invoker set search_path='' as $$ begin
  if auth.uid() is null or coalesce(public.current_dashboard_role(),'') not in ('admin','staff') then
    raise exception 'textbook_management_read_forbidden' using errcode='42501';
  end if;
end $$;

-- ECMAScript String.trim whitespace, shared only by these additive reads.
create function dashboard_private.textbook_trim_v1(value text) returns text
language sql immutable security invoker set search_path='' as $$
select btrim(coalesce(value,''), U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;

create function dashboard_private.textbook_subject_v1(value text) returns text
language sql immutable security invoker set search_path='' as $$
  select case lower(dashboard_private.textbook_trim_v1(coalesce(value,''))) when '영어' then 'english' when 'english' then 'english'
    when '수학' then 'math' when 'math' then 'math' when '과학' then 'science' when 'science' then 'science' else 'other' end
$$;
create function dashboard_private.textbook_school_v1(value text) returns text
language sql immutable security invoker set search_path='' as $$
select case when lower(dashboard_private.textbook_trim_v1(value)) in ('elementary','초등','초') or strpos(value,'초등')>0 then 'elementary'
 when lower(dashboard_private.textbook_trim_v1(value)) in ('middle','중등','중') or strpos(value,'중등')>0 then 'middle'
 when lower(dashboard_private.textbook_trim_v1(value)) in ('high','고등','고') or strpos(value,'고등')>0 then 'high' else '' end
$$;
create function dashboard_private.textbook_grade_v1(value text) returns text
language sql immutable security invoker set search_path='' as $$
select case when dashboard_private.textbook_trim_v1(value)=any(array['e1','e2','e3','e4','e5','e6','m1','m2','m3','h1','h2','h3']) then dashboard_private.textbook_trim_v1(value)
 else coalesce((select case m[1] when '초' then 'e' when '중' then 'm' else 'h' end||m[2]
 from regexp_match(value,'(초|중|고)[[:space:]]*([1-6])') m),'') end
$$;
create function dashboard_private.textbook_compact_v1(value text) returns text
language sql immutable security invoker set search_path='' as $$
select regexp_replace(lower(normalize(dashboard_private.textbook_trim_v1(coalesce(value,'')),NFKC)),'[^[:alnum:]]','','g')
$$;
create function dashboard_private.textbook_number_v1(value numeric) returns text
language sql immutable security invoker set search_path='' as $$ select to_char(value,'FM999,999,999,999,999,990') $$;

-- Match the existing taxonomy's array -> scalar -> title/category inference,
-- grade completion, science defaults and display summaries. No table reads.
create function dashboard_private.textbook_taxonomy_v1(book jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare
  all_s text[]:=array['elementary','middle','high']; all_g text[]:=array['e1','e2','e3','e4','e5','e6','m1','m2','m3','h1','h2','h3'];
  schools text[]:='{}'; grades text[]:='{}'; gs text[]; value text; school text; grade text;
  title text:=dashboard_private.textbook_trim_v1(coalesce(nullif(book->>'title',''),book->>'name','')); category text:=dashboard_private.textbook_trim_v1(coalesce(book->>'category',''));
  scalar_s text; scalar_g text; sub text; subject text:=dashboard_private.textbook_subject_v1(book->>'subject');
  school_labels text[]; grade_labels text[]; school_summary text; grade_summary text; category_label text; search_text text;
begin
  scalar_s:=coalesce(nullif(dashboard_private.textbook_school_v1(book->>'school_level'),''),dashboard_private.textbook_school_v1(category||' '||title));
  scalar_g:=coalesce(nullif(dashboard_private.textbook_grade_v1(book->>'grade_level'),''),dashboard_private.textbook_grade_v1(category||' '||title));
  sub:=coalesce(nullif(dashboard_private.textbook_trim_v1(book->>'sub_subject'),''),dashboard_private.textbook_trim_v1(regexp_replace(regexp_replace(category,'^(초등|중등|고등)[[:space:]]*',''),'^(초|중|고)[[:space:]]*[1-6][[:space:]]*','')),'');
  if subject='science' then schools:=array['high']; grades:=array['h1','h2','h3'];
  elsif jsonb_array_length(coalesce(book->'school_levels','[]'))>0 or jsonb_array_length(coalesce(book->'grade_levels','[]'))>0 then
    select coalesce(array_agg(dashboard_private.textbook_school_v1(v)),'{}') into schools from jsonb_array_elements_text(book->'school_levels') v;
    select coalesce(array_agg(dashboard_private.textbook_grade_v1(v)),'{}') into grades from jsonb_array_elements_text(book->'grade_levels') v;
  elsif dashboard_private.textbook_grade_v1(book->>'grade_level')<>'' then grades:=array[dashboard_private.textbook_grade_v1(book->>'grade_level')];
  elsif dashboard_private.textbook_school_v1(book->>'school_level')<>'' then schools:=array[dashboard_private.textbook_school_v1(book->>'school_level')];
  elsif dashboard_private.textbook_grade_v1(category||' '||title)<>'' then grades:=array[dashboard_private.textbook_grade_v1(category||' '||title)];
  elsif dashboard_private.textbook_school_v1(category||' '||title)<>'' then schools:=array[dashboard_private.textbook_school_v1(category||' '||title)];
  else schools:=all_s; grades:=all_g; end if;
  foreach grade in array grades loop
    if grade=any(all_g) then schools:=array_append(schools,case left(grade,1) when 'e' then 'elementary' when 'm' then 'middle' else 'high' end); end if;
  end loop;
  foreach school in array all_s loop
    select array_agg(g order by ord) into gs from unnest(all_g) with ordinality a(g,ord)
      where left(g,1)=case school when 'elementary' then 'e' when 'middle' then 'm' else 'h' end;
    if school=any(schools) and not grades&&gs then grades:=grades||gs; end if;
  end loop;
  select coalesce(array_agg(v order by ord),'{}') into schools from unnest(all_s) with ordinality a(v,ord) where v=any(schools);
  select coalesce(array_agg(v order by ord),'{}') into grades from unnest(all_g) with ordinality a(v,ord) where v=any(grades);
  select coalesce(array_agg(case v when 'elementary' then '초등' when 'middle' then '중등' else '고등' end order by ord),'{}') into school_labels from unnest(schools) with ordinality a(v,ord);
  select coalesce(array_agg(case left(v,1) when 'e' then '초' when 'm' then '중' else '고' end||right(v,1) order by ord),'{}') into grade_labels from unnest(grades) with ordinality a(v,ord);
  school_summary:=case when cardinality(schools)=3 then '초·중·고' else array_to_string(school_labels,' · ') end;
  grade_summary:=array_to_string(grade_labels,' · ');
  if cardinality(grades)=12 then grade_summary:='전 학년';
  elsif cardinality(schools)=1 and cardinality(grades)=(case schools[1] when 'elementary' then 6 else 3 end) then
    grade_summary:=grade_labels[1]||'–'||grade_labels[cardinality(grade_labels)]; end if;
  category_label:=concat_ws(' · ',case scalar_s when 'elementary' then '초등' when 'middle' then '중등' when 'high' then '고등' end,
    case when scalar_g=any(all_g) then case left(scalar_g,1) when 'e' then '초' when 'm' then '중' else '고' end||right(scalar_g,1) end,nullif(sub,''));
  category_label:=coalesce(nullif(category_label,''),nullif(category,''),'미분류');
  search_text:=lower(array_to_string(array[title,dashboard_private.textbook_compact_v1(title),dashboard_private.textbook_trim_v1(coalesce(book->>'subject','')),
    case subject when 'english' then '영어' when 'math' then '수학' when 'science' then '과학' else '기타' end,
    category_label,school_summary,grade_summary]||grade_labels||array[sub,category,dashboard_private.textbook_trim_v1(coalesce(book->>'publisher','')),dashboard_private.textbook_trim_v1(coalesce(book->>'isbn13','')),dashboard_private.textbook_trim_v1(coalesce(book->>'barcode',''))],' '));
  return jsonb_build_object('schools',schools,'grades',grades,'subSubject',sub,'schoolScalar',scalar_s,'gradeScalar',scalar_g,
    'schoolSummary',school_summary,'gradeSummary',grade_summary,'categoryLabel',category_label,'searchText',search_text,
    'barcodeText',regexp_replace(coalesce(book->>'isbn13','')||' '||coalesce(book->>'barcode',''),'[^0-9]','','g'));
end $$;

create function dashboard_private.textbook_read_filters_v1(p_filters jsonb,p_kind text) returns void
language plpgsql stable security invoker set search_path='' as $$
declare expected text[]; actual text[]; k text; begin
  perform dashboard_private.textbook_read_guard_v1();
  expected:=case p_kind when 'history' then array['locationId','textbookId'] when 'inventory' then array['audit','gradeLevel','inventory','locationId','quality','schoolLevel','search','subSubject','subject'] else array['gradeLevel','inventory','quality','schoolLevel','search','subSubject','subject'] end;
  if jsonb_typeof(p_filters) is distinct from 'object' then raise exception 'textbook_filters_invalid' using errcode='22023'; end if;
  select array_agg(key order by key collate "C") into actual from jsonb_object_keys(p_filters) key;
  if actual is distinct from expected then raise exception 'textbook_filters_invalid' using errcode='22023'; end if;
  foreach k in array expected loop
    if p_kind='history' then
      if jsonb_typeof(p_filters->k) not in ('string','null') or (p_filters->>k is not null and p_filters->>k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'textbook_filters_invalid' using errcode='22023'; end if;
    elsif jsonb_typeof(p_filters->k) is distinct from 'string' then raise exception 'textbook_filters_invalid' using errcode='22023'; end if;
  end loop;
  if p_kind<>'history' and (p_filters->>'quality' not in ('all','attention','duplicate','missingCode','missingPublisher','missingCategory','missingPrice','subjectMismatch','inactive') or p_filters->>'inventory' not in ('all','shortage','surplus','unused','negative')) then raise exception 'textbook_filters_invalid' using errcode='22023'; end if;
  if p_kind='inventory' and (p_filters->>'audit' not in ('all','recommended','pending','done') or (p_filters->>'locationId'<>'' and p_filters->>'locationId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then raise exception 'textbook_filters_invalid' using errcode='22023'; end if;
end $$;
create function dashboard_private.textbook_read_page_v1(p_page integer,p_size integer,p_sort text,p_expected text) returns void
language plpgsql immutable security invoker set search_path='' as $$ begin
  if p_page is null or p_page<1 then raise exception 'textbook_page_invalid' using errcode='22023'; end if;
  if p_size is null or p_size not in (10,15,20) then raise exception 'textbook_page_size_invalid' using errcode='22023'; end if;
  if p_sort is distinct from p_expected then raise exception 'textbook_sort_invalid' using errcode='22023'; end if;
end $$;

-- All-time balance, global title quality and latest count are necessary for
-- filtering/order BEFORE paging. No historical movement rows are serialized.
create function dashboard_private.textbook_read_keys_v1(p_location text default '')
returns table(id uuid,title text,subject text,active boolean,taxonomy jsonb,quality jsonb,quality_score integer,
 total_quantity numeric,student_quantity numeric,teacher_quantity numeric,stock_value numeric,current_quantity numeric,
 latest_count_at text,days_since numeric,audit_status text)
language plpgsql stable security invoker set search_path='' as $$ begin
  perform dashboard_private.textbook_read_guard_v1();
  p_location:=lower(p_location);
  return query with books as materialized (
    select t.id,dashboard_private.textbook_trim_v1(coalesce(nullif(t.title,''),t.name,'')) title,dashboard_private.textbook_subject_v1(t.subject) subject,
      lower(dashboard_private.textbook_trim_v1(t.status)) not in ('inactive','미사용') active,
      dashboard_private.textbook_taxonomy_v1(jsonb_build_object('title',t.title,'name',t.name,'subject',t.subject,'category',t.category,'publisher',t.publisher,
        'isbn13',t.isbn13,'barcode',t.barcode,'school_level',t.school_level,'grade_level',t.grade_level,'school_levels',t.school_levels,'grade_levels',t.grade_levels,'sub_subject',t.sub_subject)) taxonomy,
      dashboard_private.textbook_compact_v1(coalesce(nullif(t.title,''),t.name,'')) title_key,
      dashboard_private.textbook_trim_v1(coalesce(nullif(t.isbn13,''),t.barcode,''))='' missing_code,dashboard_private.textbook_trim_v1(coalesce(t.publisher,'')) in ('','미분류') missing_publisher,
      coalesce(nullif(t.sale_price,0),nullif(t.price,0),t.list_price,0)<=0 missing_price,
      lower(regexp_replace(dashboard_private.textbook_trim_v1(coalesce(nullif(t.title,''),t.name,'')),'[[:space:]]+',' ','g')) hint_title
    from public.textbooks t
  ), duplicates as (select b.title_key from books b where b.active and b.title_key<>'' group by b.title_key having count(*)>1),
  balances as (select m.textbook_id,sum(m.quantity)::numeric total,sum(m.quantity) filter(where m.copy_scope='student')::numeric student,
    sum(m.quantity) filter(where m.copy_scope='teacher')::numeric teacher,sum(case when m.amount<>0 then m.amount else m.unit_amount*m.quantity end) value,
    sum(m.quantity) filter(where p_location='' or m.location_id::text=p_location)::numeric current
    from public.textbook_stock_moves m group by m.textbook_id),
  flags as (select b.*,jsonb_build_object('duplicate',d.title_key is not null,'missingCode',b.missing_code,'missingPublisher',b.missing_publisher,
    'missingCategory',b.taxonomy->>'schoolScalar'='' and b.taxonomy->>'gradeScalar'='' and b.taxonomy->>'subSubject'='' and b.taxonomy->>'categoryLabel'='미분류',
    'missingPrice',b.missing_price,'subjectMismatch',
      (b.subject='english' and (b.hint_title ~ '(수학|rpm|알피엠|개념원리|확률|통계|미적분|대수)' or b.hint_title ~* '(^|[^가-힣a-z0-9])수[[:space:]]?[12ⅠⅡ]($|[^가-힣a-z0-9])'))
      or (b.subject='math' and b.hint_title ~ '(영어|english|reading|writing|grammar|독해|구문|어법|영단어|리스닝)'), 'inactive',not b.active) quality
    from books b left join duplicates d on d.title_key=b.title_key),
  prepared as (select b.id,b.title,b.subject,b.active,b.taxonomy,b.quality,
    ((b.quality->>'subjectMismatch')::boolean::integer*16+(b.quality->>'duplicate')::boolean::integer*8+
    (b.quality->>'missingPublisher')::boolean::integer*4+(b.quality->>'missingCategory')::boolean::integer*4+
    (b.quality->>'missingPrice')::boolean::integer*4+(b.quality->>'missingCode')::boolean::integer*2+(b.quality->>'inactive')::boolean::integer) score,
    coalesce(m.total,0) total,coalesce(m.student,0) student,coalesce(m.teacher,0) teacher,coalesce(m.value,0) value,coalesce(m.current,0) current,
    coalesce(c.counted_at::text,'') latest,
    case when isfinite(c.counted_at) then floor(extract(epoch from(now()-(c.counted_at::timestamp at time zone 'UTC')))/86400) end days
    from flags b left join balances m on m.textbook_id=b.id
    -- Equal date is stabilized by descending UUID, not treated as chronological.
    left join lateral (select sc.counted_at from public.textbook_stock_counts sc where sc.textbook_id=b.id and sc.location_id::text=p_location order by sc.counted_at desc,sc.id desc limit 1)c on true)
  select p.id,p.title,p.subject,p.active,p.taxonomy,p.quality,p.score,p.total,p.student,p.teacher,p.value,p.current,p.latest,p.days,
    case when p.active and (p.current<=3 or p.latest='' or p.days is null or p.days>=30) then 'recommended'
      when p.latest<>'' and p.days<30 then 'done' else 'pending' end from prepared p;
end $$;

create function dashboard_private.textbook_matches_v1(k jsonb,f jsonb,scope text default 'all') returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare quality text:=f->>'quality'; qty numeric:=(k->>'total_quantity')::numeric; keyword text:=lower(dashboard_private.textbook_trim_v1(f->>'search')); barcode text:=regexp_replace(keyword,'[^0-9]','','g'); school text; grade text; begin
  school:=dashboard_private.textbook_school_v1(nullif(f->>'schoolLevel','all')); grade:=dashboard_private.textbook_grade_v1(nullif(f->>'gradeLevel','all'));
  if (f->>'subject' not in ('','all') and k->>'subject'<>dashboard_private.textbook_subject_v1(f->>'subject'))
    or (school<>'' and not (k#>'{taxonomy,schools}') ? school) or (grade<>'' and not (k#>'{taxonomy,grades}') ? grade)
    or (f->>'subSubject' not in ('','all') and k#>>'{taxonomy,subSubject}'<>dashboard_private.textbook_trim_v1(f->>'subSubject')) then return false; end if;
  if scope='taxonomy' then return true; end if;
  if keyword<>'' and strpos(k#>>'{taxonomy,searchText}',keyword)=0 and (barcode='' or strpos(k#>>'{taxonomy,barcodeText}',barcode)=0) then return false; end if;
  if quality='inactive' then if (k->>'active')::boolean then return false; end if;
  elsif not (k->>'active')::boolean then return false;
  elsif quality='attention' then if (k->>'quality_score')::integer=0 then return false; end if;
  elsif quality<>'all' and not (k->'quality'->>quality)::boolean then return false; end if;
  if scope='inventory' then return true; end if;
  return case f->>'inventory' when 'negative' then qty<0 when 'unused' then qty=0 when 'shortage' then qty<0 or qty between 1 and 3 when 'surplus' then qty>=20 else true end;
end $$;

-- Only selected parent IDs reach map/location projection. The global key
-- aggregate above remains intentionally separate from selected-row enrichment.
create function dashboard_private.textbook_master_project_v1(p_id uuid,p_quality jsonb,p_score integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_read_guard_v1();
  with moves as materialized(select coalesce(m.location_id::text,'unassigned') location,m.copy_scope,sum(m.quantity)::numeric quantity,
    sum(case when m.amount<>0 then m.amount else m.unit_amount*m.quantity end) value from public.textbook_stock_moves m where m.textbook_id=p_id group by m.location_id,m.copy_scope),
  maps as (select scope,coalesce(jsonb_object_agg(location,quantity),'{}') quantities from (
    select scope,location,sum(quantity) quantity from (
      select s.scope,l.id::text location,0::numeric quantity from public.textbook_inventory_locations l cross join (values('all'),('student'),('teacher'))s(scope)
      union all select 'all',m.location,m.quantity from moves m union all select m.copy_scope,m.location,m.quantity from moves m
    )a group by scope,location)b group by scope),
  totals as (select coalesce(sum(quantity),0) total,coalesce(sum(quantity) filter(where copy_scope='student'),0) student,
    coalesce(sum(quantity) filter(where copy_scope='teacher'),0) teacher,coalesce(sum(value),0) value from moves)
  select jsonb_build_object('id',t.id,'title',dashboard_private.textbook_trim_v1(coalesce(nullif(t.title,''),t.name,'')),'name',t.name,'subject',t.subject,'status',t.status,
    'publisher',t.publisher,'category',t.category,'isbn13',t.isbn13,'barcode',t.barcode,'price',t.price,'sale_price',t.sale_price,'list_price',t.list_price,
    'salePrice',coalesce(nullif(t.sale_price,0),nullif(t.price,0),t.list_price,0),'publisher_id',t.publisher_id,'default_supplier_id',t.default_supplier_id,
    'school_level',t.school_level,'grade_level',t.grade_level,'school_levels',t.school_levels,'grade_levels',t.grade_levels,'sub_subject',t.sub_subject,'subject_area_key',t.subject_area_key,'is_returnable',t.is_returnable,
    'locationQuantities',coalesce((select quantities from maps where scope='all'),'{}'),
    'studentLocationQuantities',coalesce((select quantities from maps where scope='student'),'{}'),
    'teacherLocationQuantities',coalesce((select quantities from maps where scope='teacher'),'{}'),
    'totalQuantity',totals.total,'studentQuantity',totals.student,'teacherQuantity',totals.teacher,'stockValue',totals.value,
    'locationSummary',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'code',dashboard_private.textbook_trim_v1(l.code),'name',dashboard_private.textbook_trim_v1(coalesce(nullif(l.name,''),l.code)),'sortOrder',l.sort_order,'quantity',(m.quantities->>l.id::text)::numeric)
      order by l.sort_order,dashboard_private.textbook_trim_v1(coalesce(nullif(l.name,''),l.code)) collate dashboard_private.textbook_ko_label,l.id) from public.textbook_inventory_locations l cross join maps m where m.scope='all' and (m.quantities->>l.id::text)::numeric<>0),'[]'),
    'qualityIssues',p_quality,'qualityScore',p_score) into result from public.textbooks t cross join totals where t.id=p_id;
  return result;
end $$;
create function dashboard_private.textbook_inventory_project_v1(k jsonb,p_location text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare source jsonb; latest text:=k->>'latest_count_at'; days numeric:=(k->>'days_since')::numeric; qty numeric:=(k->>'current_quantity')::numeric; due text; reason text; location_name text; begin
  perform dashboard_private.textbook_read_guard_v1();
  p_location:=lower(p_location);
  source:=dashboard_private.textbook_master_project_v1((k->>'id')::uuid,k->'quality',(k->>'quality_score')::integer);
  select dashboard_private.textbook_trim_v1(coalesce(nullif(l.name,''),l.code)) into location_name from public.textbook_inventory_locations l where l.id::text=p_location or dashboard_private.textbook_trim_v1(l.code)=p_location order by (l.id::text=p_location) desc,l.id limit 1;
  due:=case when latest='' then '실사 이력 없음' when days is null then '실사일 확인 필요' when days>=30 then dashboard_private.textbook_number_v1(days)||'일 경과' else dashboard_private.textbook_number_v1(30-days)||'일 남음' end;
  reason:=case when qty<0 then '마이너스 재고' when qty<=3 then '재고 부족' when latest='' then '실사 이력 없음' when days is null then '실사일 확인 필요' when days>=30 then dashboard_private.textbook_number_v1(days)||'일 경과' when not (k->>'active')::boolean then '미사용 확인' else due end;
  return jsonb_build_object('source',source,'id',k->>'id','title',k->>'title','publisher',coalesce(nullif(dashboard_private.textbook_trim_v1(source->>'publisher'),''),'미분류'),
    'locationId',p_location,'locationName',coalesce(nullif(coalesce(location_name,p_location),''),'-'),'currentQuantity',qty,'latestCountAt',latest,'daysSinceLatestCount',days,
    'isCountedThisCycle',coalesce(latest<>'' and days<30,false),'isRecommended',k->>'audit_status'='recommended','status',k->>'audit_status','reason',reason,'dueLabel',due);
end $$;

create function public.list_textbook_master_page_v1(p_filters jsonb,p_sort text,p_page integer,p_page_size integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_read_filters_v1(p_filters,'master'); perform dashboard_private.textbook_read_page_v1(p_page,p_page_size,p_sort,'quality-title');
  with eligible as materialized(select k.* from dashboard_private.textbook_read_keys_v1() k where dashboard_private.textbook_matches_v1(to_jsonb(k),p_filters)),
  page as materialized(select e.*,row_number() over(order by array_position(array['english','math','science','other'],e.subject),e.quality_score desc,e.title collate dashboard_private.ko_numeric,e.id) ord
    from eligible e order by array_position(array['english','math','science','other'],e.subject),e.quality_score desc,e.title collate dashboard_private.ko_numeric,e.id limit p_page_size offset (p_page::bigint-1)*p_page_size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(dashboard_private.textbook_master_project_v1(p.id,p.quality,p.quality_score) order by p.ord)from page p),'[]'),
    'page',p_page,'pageSize',p_page_size,'totalCount',(select count(*)from eligible)) into result;
  return result;
end $$;
create function public.list_textbook_inventory_page_v1(p_filters jsonb,p_sort text,p_page integer,p_page_size integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_read_filters_v1(p_filters,'inventory'); perform dashboard_private.textbook_read_page_v1(p_page,p_page_size,p_sort,'audit-priority');
  with eligible as materialized(select k.* from dashboard_private.textbook_read_keys_v1(p_filters->>'locationId') k where dashboard_private.textbook_matches_v1(to_jsonb(k),p_filters) and (p_filters->>'audit'='all' or k.audit_status=p_filters->>'audit')),
  page as materialized(select e.*,row_number() over(order by array_position(array['recommended','pending','done'],e.audit_status),coalesce(e.days_since,99999) desc,e.current_quantity,e.title collate dashboard_private.ko_numeric,e.id) ord
    from eligible e order by array_position(array['recommended','pending','done'],e.audit_status),coalesce(e.days_since,99999) desc,e.current_quantity,e.title collate dashboard_private.ko_numeric,e.id limit p_page_size offset(p_page::bigint-1)*p_page_size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(dashboard_private.textbook_inventory_project_v1(to_jsonb(p),p_filters->>'locationId') order by p.ord)from page p),'[]'),
    'page',p_page,'pageSize',p_page_size,'totalCount',(select count(*)from eligible)) into result;
  return result;
end $$;

create function public.list_textbook_inventory_history_page_v1(p_filters jsonb,p_sort text,p_page integer,p_page_size integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_read_filters_v1(p_filters,'history'); perform dashboard_private.textbook_read_page_v1(p_page,p_page_size,p_sort,'event-desc');
  -- Narrow UNION ALL preserves a count and its linked adjustment as two keys.
  with events as materialized(
    select m.id,'move'::text kind,m.moved_at event_at from public.textbook_stock_moves m where (p_filters->>'textbookId' is null or m.textbook_id=(p_filters->>'textbookId')::uuid) and (p_filters->>'locationId' is null or m.location_id=(p_filters->>'locationId')::uuid)
    union all select c.id,'count',c.counted_at::timestamp at time zone 'UTC' from public.textbook_stock_counts c where (p_filters->>'textbookId' is null or c.textbook_id=(p_filters->>'textbookId')::uuid) and (p_filters->>'locationId' is null or c.location_id=(p_filters->>'locationId')::uuid)),
  page as materialized(select e.* from events e order by e.event_at desc,e.kind,e.id limit p_page_size offset(p_page::bigint-1)*p_page_size),
  selected as(select p.*,case when p.kind='move' then to_jsonb(m) else to_jsonb(c) end record from page p
    left join public.textbook_stock_moves m on p.kind='move' and m.id=p.id left join public.textbook_stock_counts c on p.kind='count' and c.id=p.id),
  projected as(select s.*,coalesce(nullif(dashboard_private.textbook_trim_v1(coalesce(nullif(t.title,''),t.name,'')),''),'-') title,
    coalesce(nullif(dashboard_private.textbook_trim_v1(coalesce(nullif(l.name,''),l.code)),''),s.record->>'location_id','-') location,
    case when s.kind='move' then (s.record->>'quantity')::numeric else (s.record->>'counted_quantity')::numeric-(s.record->>'expected_quantity')::numeric end delta,
    coalesce(s.record->>'created_by','') actor_id,
    dashboard_private.textbook_trim_v1(coalesce(nullif(s.record->>'created_by_email',''),nullif(s.record->>'createdByEmail',''),nullif(s.record->>'created_by_name',''),nullif(s.record->>'createdByName',''),nullif(s.record->>'actor',''),nullif(s.record->>'actor_name',''),s.record->>'actorName','')) actor_label
    from selected s left join public.textbooks t on t.id=(s.record->>'textbook_id')::uuid left join public.textbook_inventory_locations l on l.id=(s.record->>'location_id')::uuid)
  select jsonb_build_object('page',p_page,'pageSize',p_page_size,'totalCount',(select count(*)from events),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.kind||'-'||p.id,'kind',p.kind,'sourceId',p.id,'linkedMoveId',case when p.kind='count' then coalesce(p.record->>'adjustment_move_id','') else '' end,
      'at',case when p.kind='count' then p.record->>'counted_at' else p.record->>'moved_at' end,'textbookTitle',p.title,'locationName',p.location,
      'change',case when p.delta>0 then '+' else '' end||dashboard_private.textbook_number_v1(p.delta)||'권',
      'action',case when p.kind='count' then '실사 '||dashboard_private.textbook_number_v1((p.record->>'expected_quantity')::numeric)||'→'||dashboard_private.textbook_number_v1((p.record->>'counted_quantity')::numeric)
      else case p.record->>'move_type' when 'opening' then '기초' when 'purchase_receipt' then '입고' when 'sale_issue' then '출고' when 'return_in' then '반품 입고' when 'return_out' then '반품 출고' when 'transfer_in' then '이동 입고' when 'transfer_out' then '이동 출고' else '실사 조정' end end,
      'actor',coalesce(nullif(p.actor_label,''),nullif(p.actor_id,''),'-'),'actorId',p.actor_id,'actorLabel',p.actor_label,'memo',dashboard_private.textbook_trim_v1(p.record->>'memo')) order by p.event_at desc,p.kind,p.id)from projected p),'[]')) into result;
  return result;
end $$;

create function dashboard_private.textbook_summary_v1(p_filters jsonb,p_inventory boolean) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_read_filters_v1(p_filters,case when p_inventory then 'inventory' else 'master' end);
  with keys as materialized(select k.* from dashboard_private.textbook_read_keys_v1(coalesce(p_filters->>'locationId',''))k),
  tax as materialized(select k.* from keys k where dashboard_private.textbook_matches_v1(to_jsonb(k),p_filters,'taxonomy')),
  inv as materialized(select k.* from tax k where dashboard_private.textbook_matches_v1(to_jsonb(k),p_filters,'inventory')),
  audit as materialized(select k.* from inv k where dashboard_private.textbook_matches_v1(to_jsonb(k),p_filters)),
  matched as materialized(select k.* from audit k where not p_inventory or p_filters->>'audit'='all' or k.audit_status=p_filters->>'audit'),
  prices as materialized(select k.id,k.subject,k.total_quantity,k.stock_value,coalesce(nullif(t.sale_price,0),nullif(t.price,0),t.list_price,0) sale_price
    from matched k join public.textbooks t on t.id=k.id),
  location_totals as (select location,sum(quantity) quantity from(
    select l.id::text location,0::numeric quantity from public.textbook_inventory_locations l
    union all select coalesce(m.location_id::text,'unassigned'),m.quantity::numeric from public.textbook_stock_moves m join matched k on k.id=m.textbook_id
  )s group by location),
  subject_totals as(select p.subject,count(*) total_count,sum(p.total_quantity) total_quantity,sum(p.sale_price) sale_price,sum(p.stock_value)stock_value from prices p group by p.subject),
  defaults(subject,name) as(values('english','단어'),('english','독해'),('english','듣기'),('english','문법'),('english','모고'),('english','내신'),
    ('math','공통수학1'),('math','공통수학2'),('math','대수'),('math','미적분'),('math','확률과 통계'),('math','기하'),('math','수1'),('math','수2'),('math','내신'),
    ('science','통합과학'),('science','물리학'),('science','화학'),('science','생명과학'),('science','지구과학'),('other','기타')),
  settings as(select dashboard_private.textbook_subject_v1(s.subject) subject,dashboard_private.textbook_trim_v1(s.name) name,s.is_visible visible from public.textbook_sub_subject_settings s where dashboard_private.textbook_trim_v1(s.name)<>''),
  options as(select k.subject,k.taxonomy->>'subSubject' name from keys k where k.active union select s.subject,s.name from settings s where s.visible
    union select d.subject,d.name from defaults d where not exists(select 1 from settings s where s.subject=d.subject and s.name=d.name))
  select jsonb_build_object('totalCount',(select count(*)from matched),'totalQuantity',coalesce((select sum(total_quantity)from matched),0),
    'studentQuantity',coalesce((select sum(student_quantity)from matched),0),'teacherQuantity',coalesce((select sum(teacher_quantity)from matched),0),'stockValue',coalesce((select sum(stock_value)from matched),0),
    'salePriceTotal',coalesce((select sum(sale_price)from prices),0),'locationQuantities',coalesce((select jsonb_object_agg(location,quantity)from location_totals),'{}'),
    'subjectTotals',coalesce((select jsonb_agg(jsonb_build_object('subject',s.subject,'totalCount',s.total_count,'totalQuantity',s.total_quantity,'salePriceTotal',s.sale_price,'stockValue',s.stock_value)
      order by array_position(array['english','math','science','other'],s.subject))from subject_totals s),'[]'),
    'qualityCounts',(select jsonb_object_agg(q,(select count(*)from tax t where case q when 'all' then t.active when 'inactive' then not t.active when 'attention' then t.active and t.quality_score>0 else t.active and (t.quality->>q)::boolean end))
      from unnest(array['all','attention','duplicate','missingCode','missingPublisher','missingCategory','missingPrice','subjectMismatch','inactive'])q),
    'inventoryCounts',jsonb_build_object('all',(select count(*)from inv),'negative',(select count(*)from inv where total_quantity<0),'shortage',(select count(*)from inv where total_quantity<0 or total_quantity between 1 and 3),'unused',(select count(*)from inv where total_quantity=0),'surplus',(select count(*)from inv where total_quantity>=20)),
    'subSubjectOptions',coalesce((select jsonb_agg(name order by name collate dashboard_private.textbook_ko_label)from(select distinct o.name from options o where o.name<>'' and(p_filters->>'subject' in('all','') or o.subject=dashboard_private.textbook_subject_v1(p_filters->>'subject')))s),'[]'),
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'code',dashboard_private.textbook_trim_v1(l.code),'name',dashboard_private.textbook_trim_v1(coalesce(nullif(l.name,''),l.code)),'sortOrder',l.sort_order)order by l.sort_order,dashboard_private.textbook_trim_v1(coalesce(nullif(l.name,''),l.code)) collate dashboard_private.textbook_ko_label,l.id)from public.textbook_inventory_locations l),'[]'))
    || case when p_inventory then jsonb_build_object('auditCounts',jsonb_build_object('all',(select count(*)from audit),'recommended',(select count(*)from audit where audit_status='recommended'),'pending',(select count(*)from audit where audit_status='pending'),'done',(select count(*)from audit where audit_status='done')))else '{}'::jsonb end into result;
  return result;
end $$;
create function public.get_textbook_master_summary_v1(p_filters jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$ select dashboard_private.textbook_summary_v1(p_filters,false) $$;
create function public.get_textbook_inventory_summary_v1(p_filters jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$ select dashboard_private.textbook_summary_v1(p_filters,true) $$;
create function public.get_textbook_master_detail_v1(p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_read_guard_v1();
  if p_id is null then raise exception 'textbook_id_invalid' using errcode='22023'; end if;
  select dashboard_private.textbook_master_project_v1(k.id,k.quality,k.quality_score) into result from dashboard_private.textbook_read_keys_v1()k where k.id=p_id;
  return jsonb_build_object('row',result);
end $$;
create function public.get_textbook_inventory_balance_v1(p_input jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare ids uuid[]; result jsonb; keys text[]; location_id uuid; begin
  perform dashboard_private.textbook_read_guard_v1();
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'textbook_balance_input_invalid' using errcode='22023'; end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(p_input)key;
  if keys is distinct from array['locationId','textbookIds'] or jsonb_typeof(p_input->'textbookIds') is distinct from 'array' or jsonb_typeof(p_input->'locationId') not in ('string','null')
    or (p_input->>'locationId' is not null and p_input->>'locationId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'textbook_balance_input_invalid' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_input->'textbookIds')v where jsonb_typeof(v)<>'string' or v#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'textbook_balance_input_invalid' using errcode='22023'; end if;
  location_id:=(p_input->>'locationId')::uuid;
  if location_id is not null and not exists(select 1 from public.textbook_inventory_locations l where l.id=location_id) then
    raise exception 'textbook_balance_location_unavailable' using errcode='22023'; end if;
  select coalesce(array_agg(v::uuid),'{}') into ids from jsonb_array_elements_text(p_input->'textbookIds')v;
  if cardinality(ids)<>(select count(distinct v)from unnest(ids)v) then raise exception 'textbook_balance_input_invalid' using errcode='22023'; end if;
  if cardinality(ids)<>(select count(*)from public.textbooks t where t.id=any(ids)) then raise exception 'textbook_balance_ids_unavailable' using errcode='22023'; end if;
  select jsonb_build_object('locationId',location_id,'rows',coalesce(jsonb_agg(jsonb_build_object('textbookId',v.id,'currentQuantity',case when location_id is null then s.row->'totalQuantity' else coalesce(s.row->'locationQuantities'->location_id::text,'0'::jsonb)end)
    ||(s.row-array['id','title','name','subject','status','publisher','category','isbn13','barcode','price','sale_price','list_price','salePrice','publisher_id','default_supplier_id','school_level','grade_level','school_levels','grade_levels','sub_subject','subject_area_key','is_returnable','qualityIssues','qualityScore','locationSummary']) order by v.ord),'[]')) into result
    from unnest(ids)with ordinality v(id,ord) cross join lateral(select dashboard_private.textbook_master_project_v1(v.id,'{}',0)row)s;
  return result;
end $$;
create function public.check_textbook_master_duplicate_v1(p_input jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare keys text[]; result jsonb; begin
  perform dashboard_private.textbook_read_guard_v1();
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'textbook_duplicate_input_invalid' using errcode='22023'; end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(p_input)key;
  if keys is distinct from array['category','excludeId','publisher','subject','title'] or exists(select 1 from unnest(array['category','publisher','subject','title'])k where jsonb_typeof(p_input->k) is distinct from 'string')
    or jsonb_typeof(p_input->'excludeId') not in('string','null') or(p_input->>'excludeId' is not null and p_input->>'excludeId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'textbook_duplicate_input_invalid' using errcode='22023'; end if;
  with matched as materialized(select k.* from dashboard_private.textbook_read_keys_v1()k join public.textbooks t on t.id=k.id where k.active
    and dashboard_private.textbook_trim_v1(p_input->>'title')<>'' and lower(k.title)=lower(dashboard_private.textbook_trim_v1(p_input->>'title')) and k.subject=p_input->>'subject'
    and (p_input->>'excludeId' is null or k.id<>(p_input->>'excludeId')::uuid)
    and (dashboard_private.textbook_trim_v1(p_input->>'publisher')='' or lower(coalesce(nullif(dashboard_private.textbook_trim_v1(t.publisher),''),'미분류'))=lower(dashboard_private.textbook_trim_v1(p_input->>'publisher')))
    and (dashboard_private.textbook_trim_v1(p_input->>'category')='' or lower(k.taxonomy->>'categoryLabel')=lower(dashboard_private.textbook_trim_v1(p_input->>'category')))),
  preview as materialized(select * from matched order by title collate dashboard_private.ko_numeric,id limit 10)
  select jsonb_build_object('totalCount',(select count(*)from matched),'previewRows',coalesce((select jsonb_agg(dashboard_private.textbook_master_project_v1(p.id,p.quality,p.quality_score) order by p.title collate dashboard_private.ko_numeric,p.id)from preview p),'[]'))into result;
  return result;
end $$;

-- Private schema is not exposed by PostgREST. Direct authenticated helper calls
-- still execute with caller RLS and their management guard, never definer power.
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
    (n.nspname='dashboard_private' and p.proname=any(array['textbook_read_guard_v1','textbook_trim_v1','textbook_subject_v1','textbook_school_v1','textbook_grade_v1','textbook_compact_v1','textbook_number_v1','textbook_taxonomy_v1','textbook_read_filters_v1','textbook_read_page_v1','textbook_read_keys_v1','textbook_matches_v1','textbook_master_project_v1','textbook_inventory_project_v1','textbook_summary_v1']))
    or(n.nspname='public' and p.proname=any(array['list_textbook_master_page_v1','list_textbook_inventory_page_v1','list_textbook_inventory_history_page_v1','get_textbook_master_summary_v1','get_textbook_inventory_summary_v1','get_textbook_master_detail_v1','get_textbook_inventory_balance_v1','check_textbook_master_duplicate_v1'])) loop
    execute format('revoke all on function %s from public, anon',f);
    execute format('grant execute on function %s to authenticated',f);
  end loop;
end $$;
notify pgrst,'reload schema';
