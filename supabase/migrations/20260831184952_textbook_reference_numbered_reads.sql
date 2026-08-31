-- Independent reference sources; no writers, policies, table grants or new definers.
-- The only inherited definer is the existing five-column science metadata RPC.
-- ORDER BY only: ICU locale ties must reach the explicit stable source/ID tie,
-- without PostgreSQL's deterministic bytewise tie-break. Equality is unchanged.
create collation dashboard_private.textbook_reference_ko_numeric (provider=icu,locale='ko-u-kn-true',deterministic=false);
create collation dashboard_private.textbook_reference_ko_label (provider=icu,locale='ko',deterministic=false);
create function dashboard_private.textbook_reference_utf16_v1(value text) returns integer[]
language plpgsql stable security invoker set search_path='' as $$
declare result integer[]:='{}'; c integer; i integer; begin
  for i in 1..length(value) loop c:=ascii(substr(value,i,1));
    if c>65535 then result:=result||array[55296+(c-65536)/1024,56320+(c-65536)%1024]; else result:=array_append(result,c); end if;
  end loop; return result;
end $$;

-- Port of cmdk 1.1.1 command-score. UTF-16 indices and original case comparisons
-- are intentional. Bottom-up memoization avoids recursive DB calls.
-- MIT License
-- Copyright (c) 2022 Paco Coursey
-- Permission is hereby granted, free of charge, to any person obtaining a copy
-- of this software and associated documentation files (the "Software"), to deal
-- in the Software without restriction, including without limitation the rights
-- to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
-- copies of the Software, and to permit persons to whom the Software is
-- furnished to do so, subject to the following conditions:
-- The above copyright notice and this permission notice shall be included in all
-- copies or substantial portions of the Software.
-- THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
-- IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
-- FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
-- AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
-- LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
-- OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
-- SOFTWARE.
create function dashboard_private.textbook_reference_score_v1(value text,search text) returns double precision
language plpgsql stable security invoker set search_path='' as $$
declare raw integer[]:=dashboard_private.textbook_reference_utf16_v1(value); query_raw integer[]:=dashboard_private.textbook_reference_utf16_v1(search);
  whitespace text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  normalized integer[]; query integer[]; n integer; m integer:=cardinality(query_raw); memo double precision[];
  a integer; f integer; c integer; j integer; count_sep integer; score double precision; best double precision; transposed double precision;
  separators integer[]:=array[92,47,95,43,46,35,34,64,91,40,123,38]; spaces integer[];
begin
  if value is null or search is null then raise exception 'textbook_reference_search_invalid'using errcode='22023';end if;
  normalized:=dashboard_private.textbook_reference_utf16_v1(regexp_replace(lower(value collate dashboard_private.textbook_ko_label),'['||whitespace||'-]',' ','g'));
  query:=dashboard_private.textbook_reference_utf16_v1(regexp_replace(lower(search collate dashboard_private.textbook_ko_label),'['||whitespace||'-]',' ','g'));
  n:=cardinality(normalized); spaces:=dashboard_private.textbook_reference_utf16_v1(whitespace||'-');
  memo:=array_fill(0::double precision,array[(n+1)*(m+2)]);
  for a in 0..n loop memo[m*(n+1)+a+1]:=case when a=cardinality(raw)then 1 else 0.99 end;end loop;
  if m=0 then return memo[1];end if;
  for f in reverse m-1..0 loop
    for a in 0..n loop
      -- Only states reachable from a preceding match (ordinary or transposed).
      if f>0 and (a=0 or (normalized[a] is distinct from query[f] and (f<2 or normalized[a] is distinct from query[f-1])))then continue;end if;
      if f=0 and a<>0 then continue;end if;
      best:=0;
      for c in a..n-1 loop
        if normalized[c+1] is distinct from query[f+1]then continue;end if;
        score:=memo[(f+1)*(n+1)+c+2];
        if score>best then
          if c=a then null;
          elsif raw[c]=any(separators)then
            score:=score*0.8;count_sep:=0;if a>0 then for j in a+1..c-1 loop if raw[j]=any(separators)then count_sep:=count_sep+1;end if;end loop;score:=score*power(0.999::double precision,count_sep);end if;
          elsif raw[c]=any(spaces)then
            score:=score*0.9;count_sep:=0;if a>0 then for j in a+1..c-1 loop if raw[j]=any(spaces)then count_sep:=count_sep+1;end if;end loop;score:=score*power(0.999::double precision,count_sep);end if;
          else score:=score*0.17;if a>0 then score:=score*power(0.999::double precision,c-a);end if;end if;
          if coalesce(raw[c+1],0)<>coalesce(query_raw[f+1],0)then score:=score*0.9999;end if;
        end if;
        if (score<0.1 and coalesce(normalized[c],0)=coalesce(query[f+2],0))or(coalesce(query[f+2],0)=coalesce(query[f+1],0)and coalesce(normalized[c],0)<>coalesce(query[f+1],0))then
          transposed:=memo[(f+2)*(n+1)+c+2]*0.1;if transposed>score then score:=transposed;end if;
        end if;
        if score>best then best:=score;end if;
      end loop; memo[f*(n+1)+a+1]:=best;
    end loop;
  end loop;return memo[1];
end $$;

create function dashboard_private.textbook_reference_filters_v1(filters jsonb,facet_keys text[])returns void
language plpgsql stable security invoker set search_path='' as $$declare actual text[];entry record;begin
  perform dashboard_private.textbook_workflow_guard_v1('request');
  if jsonb_typeof(filters)is distinct from 'object'or jsonb_typeof(filters->'search')is distinct from 'string'then raise exception 'textbook_reference_filters_invalid'using errcode='22023';end if;
  select array_agg(k order by k)into actual from jsonb_object_keys(filters)k;
  if actual is distinct from (case when cardinality(facet_keys)>0 then array['search','selectedFilters']else array['search']end) then raise exception 'textbook_reference_filters_invalid'using errcode='22023';end if;
  if cardinality(facet_keys)>0 then
    if jsonb_typeof(filters->'selectedFilters')is distinct from 'object'then raise exception 'textbook_reference_filters_invalid'using errcode='22023';end if;
    for entry in select * from jsonb_each(filters->'selectedFilters')loop
      if not entry.key=any(facet_keys)or jsonb_typeof(entry.value)is distinct from 'array'then raise exception 'textbook_reference_filters_invalid'using errcode='22023';end if;
      if exists(select 1 from jsonb_array_elements(entry.value)v where jsonb_typeof(v)<>'string')or jsonb_array_length(entry.value)<>(select count(distinct v)from jsonb_array_elements_text(entry.value)v)then raise exception 'textbook_reference_filters_invalid'using errcode='22023';end if;
    end loop;
  end if;
end $$;
create function dashboard_private.textbook_reference_values_v1(values_input text[])returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('value',value,'label',value)order by ord),'[]')from(
    select dashboard_private.textbook_trim_v1(value)value,min(ord)ord from unnest(values_input)with ordinality a(value,ord)
    where dashboard_private.textbook_trim_v1(value)<>''group by dashboard_private.textbook_trim_v1(value))a
$$;
create function dashboard_private.textbook_reference_book_option_v1(book jsonb)returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare taxonomy jsonb:=dashboard_private.textbook_taxonomy_v1(book);
  title text:=dashboard_private.textbook_trim_v1(coalesce(nullif(book->>'title',''),book->>'name',''));subject text;
  publisher text:=coalesce(nullif(dashboard_private.textbook_trim_v1(book->>'publisher'),''),'미분류');sub text:=taxonomy->>'subSubject';detail text;meta jsonb;grades jsonb;
begin
  subject:=case dashboard_private.textbook_subject_v1(book->>'subject')when'english'then'영어'when'math'then'수학'when'science'then'과학'else'기타'end;
  if sub=any(array['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3','초등','중등','고등'])then sub:='';end if;
  select string_agg(value,' · 'order by ord)into detail from(select value,min(ord)ord from unnest(array[taxonomy->>'schoolSummary',taxonomy->>'gradeSummary',sub])with ordinality a(value,ord)where value<>''and value<>'-'group by value)a;
  select coalesce(jsonb_agg(jsonb_build_object('label',label,'value',value)order by ord),'[]')into meta from(values
    (1,'출판사',publisher),(2,'구분',coalesce(nullif(detail,''),taxonomy->>'categoryLabel')),(3,'ISBN',dashboard_private.textbook_trim_v1(book->>'isbn13')),(4,'바코드',dashboard_private.textbook_trim_v1(book->>'barcode')))m(ord,label,value)where value<>'';
  select coalesce(jsonb_agg(jsonb_build_object('value',value,'label',case left(value,1)when'e'then'초'when'm' then'중'else'고'end||right(value,1))order by ord),'[]')into grades from jsonb_array_elements_text(taxonomy->'grades')with ordinality a(value,ord);
  return jsonb_build_object('value',book->>'id','label',title,'description',subject,'metaRows',meta,'filterValues',jsonb_build_object('subject',dashboard_private.textbook_reference_values_v1(array[subject]),'grade',grades,'subSubject',dashboard_private.textbook_reference_values_v1(array[sub])),
    'searchText',array_to_string(array[dashboard_private.textbook_compact_v1(title),dashboard_private.textbook_trim_v1(book->>'publisher'),dashboard_private.textbook_trim_v1(book->>'category'),taxonomy->>'categoryLabel',taxonomy->>'schoolSummary',taxonomy->>'gradeSummary',sub,dashboard_private.textbook_trim_v1(book->>'isbn13'),dashboard_private.textbook_trim_v1(book->>'barcode')],' '));
end $$;
create function dashboard_private.textbook_reference_class_option_v1(class_row jsonb)returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare
  name text:=dashboard_private.textbook_trim_v1(coalesce(nullif(class_row->>'name',''),class_row->>'class_name',class_row->>'id'));
  subject text:=dashboard_private.textbook_trim_v1(class_row->>'subject');grade text:=dashboard_private.textbook_trim_v1(class_row->>'grade');
  teachers text[];teacher text;room text:=dashboard_private.textbook_trim_v1(class_row->>'room');schedule text:=dashboard_private.textbook_trim_v1(class_row->>'schedule');status text:=dashboard_private.textbook_trim_v1(class_row->>'status');
  student_count integer:=jsonb_array_length(dashboard_private.textbook_context_roster_v1(class_row->'student_ids'));meta jsonb;description text;
begin
  if lower(subject)in('english','영어')then subject:='영어';elsif lower(subject)in('math','수학')then subject:='수학';elsif lower(subject)in('science','과학')then subject:='과학';elsif lower(subject)in('other','기타')then subject:='기타';end if;
  select coalesce(array_agg(dashboard_private.textbook_trim_v1(t)order by ord),'{}')into teachers from regexp_split_to_table(coalesce(class_row->>'teacher',''),'[,/·|]')with ordinality a(t,ord)where dashboard_private.textbook_trim_v1(t)<>'';
  teacher:=array_to_string(teachers,', ');
  select string_agg(value,' · 'order by ord)into description from(select (array_agg(value order by ord))[1]value,min(ord)ord from unnest(array[subject,grade])with ordinality a(value,ord)where value<>''and value<>'-'group by lower(value))a;
  status:=case lower(status)when'active'then'사용중'when'inactive'then'미사용'else status end;
  select coalesce(jsonb_agg(jsonb_build_object('label',label,'value',value)order by ord),'[]')into meta from(values(1,'선생님',teacher),(2,'강의실',room),(3,'학생',case when student_count>0 then dashboard_private.textbook_number_v1(student_count)||'명'else''end),(4,'시간',schedule))a(ord,label,value)where value<>'';
  return jsonb_build_object('value',class_row->>'id','label',name,'description',coalesce(description,''),'metaRows',meta,'filterValues',jsonb_build_object('subject',dashboard_private.textbook_reference_values_v1(array[subject]),'grade',dashboard_private.textbook_reference_values_v1(array[grade]),'teacher',dashboard_private.textbook_reference_values_v1(teachers)),
    'searchText',array_to_string(array[dashboard_private.textbook_trim_v1(class_row->>'teacher'),'','',subject,grade,status,schedule],' '));
end $$;
create function dashboard_private.textbook_reference_command_v1(option jsonb,facet_keys text[])returns text
language plpgsql stable security invoker set search_path='' as $$declare parts text[];entry jsonb;k text;begin
  parts:=array[dashboard_private.textbook_trim_v1(option->>'label'),dashboard_private.textbook_trim_v1(option->>'description'),dashboard_private.textbook_trim_v1(option->>'searchText'),dashboard_private.textbook_trim_v1(option->>'value')];
  for entry in select v from jsonb_array_elements(coalesce(option->'metaRows','[]'))v loop parts:=parts||array[dashboard_private.textbook_trim_v1(entry->>'label'),dashboard_private.textbook_trim_v1(entry->>'value')];end loop;
  foreach k in array facet_keys loop for entry in select v from jsonb_array_elements(coalesce(option->'filterValues'->k,'[]'))v loop parts:=parts||array[dashboard_private.textbook_trim_v1(entry->>'label'),dashboard_private.textbook_trim_v1(entry->>'value')];end loop;end loop;
  return dashboard_private.textbook_trim_v1(array_to_string(parts,' '));
end $$;
create function dashboard_private.textbook_reference_match_v1(option jsonb,base_groups jsonb,selected jsonb,except_key text default '')returns boolean
language sql stable security invoker set search_path='' as $$
select not exists(select 1 from jsonb_array_elements(base_groups)g where g->>'key'<>except_key and jsonb_array_length(coalesce(selected->(g->>'key'),'[]'))>0
 and not exists(select 1 from jsonb_array_elements(option->'filterValues'->(g->>'key'))v where selected->(g->>'key') ? (v->>'value')))
$$;
create function dashboard_private.textbook_reference_groups_v1(options jsonb,facet_keys text[],base_groups jsonb default null,selected jsonb default '{}')returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare k text;items jsonb;result jsonb:='[]';g jsonb;begin
  foreach k in array facet_keys loop
    with values_source as(select o.ord option_ord,v.value_ord,v.entry->>'value'value,v.entry->>'label'label from jsonb_array_elements(options)with ordinality o(option,ord)
      cross join lateral jsonb_array_elements(o.option->'filterValues'->k)with ordinality v(entry,value_ord)
      where base_groups is null or dashboard_private.textbook_reference_match_v1(o.option,base_groups,selected,k)),
    counts as(select value,(array_agg(label order by option_ord,value_ord))[1]label,count(distinct option_ord)count,min(option_ord)first,
      (array_agg(value_ord order by option_ord,value_ord))[1]first_value from values_source group by value)
    select coalesce(jsonb_agg(jsonb_build_object('value',value,'label',label,'count',count)order by case when k='subject'then coalesce(array_position(array['영어','수학','과학','기타'],label),5)else 0 end,label collate dashboard_private.textbook_reference_ko_numeric,first,first_value),'[]')into items from counts;
    if jsonb_array_length(items)>0 then g:=jsonb_build_object('key',k,'label',case k when'subject'then'과목'when'grade'then'학년'when'subSubject'then'세부과목'else'선생님'end,'options',items);
      if k='subject'then g:=g||jsonb_build_object('optionOrder',array['영어','수학','과학','기타']);end if;result:=result||jsonb_build_array(g);end if;
  end loop;return result;
end $$;

create function dashboard_private.textbook_reference_page_v1(options jsonb,filters jsonb,facet_keys text[],page integer,size integer)returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare base jsonb;visible jsonb;active integer;result jsonb;begin
  base:=dashboard_private.textbook_reference_groups_v1(options,facet_keys);visible:=dashboard_private.textbook_reference_groups_v1(options,facet_keys,base,coalesce(filters->'selectedFilters','{}'));
  select count(*)into active from jsonb_array_elements(base)g cross join lateral jsonb_array_elements(g->'options')v where coalesce(filters->'selectedFilters'->(g->>'key'),'[]') ? (v->>'value');
  with scored as materialized(select option,ord,case when filters->>'search'=''then 1 else dashboard_private.textbook_reference_score_v1(dashboard_private.textbook_reference_command_v1(option,facet_keys),filters->>'search')end score
    from jsonb_array_elements(options)with ordinality a(option,ord)where dashboard_private.textbook_reference_match_v1(option,base,coalesce(filters->'selectedFilters','{}'))),
  selected as(select option,ord,score from scored where score>0 order by score desc,ord offset (page::bigint-1)*size limit size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(option order by score desc,ord)from selected),'[]'),'page',page,'pageSize',size,'totalCount',(select count(*)from scored where score>0))into result;
  if cardinality(facet_keys)>0 then result:=result||jsonb_build_object('baseFilterGroups',base,'visibleFilterGroups',visible,'activeFilterCount',active);end if;return result;
end $$;
create function public.list_textbook_reference_page_v1(p_filters jsonb,p_sort text,p_page integer,p_page_size integer)returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare options jsonb;begin
  perform dashboard_private.textbook_reference_filters_v1(p_filters,array['subject','grade','subSubject']);perform dashboard_private.textbook_read_page_v1(p_page,p_page_size,p_sort,'match-title');
  with source as materialized(
    select b.id,b.title,b.name,b.subject,b.publisher,b.category,b.school_level,b.grade_level,b.school_levels,b.grade_levels,b.sub_subject,b.isbn13,b.barcode from public.textbooks b
    where lower(dashboard_private.textbook_trim_v1(b.status))not in('inactive','미사용'))
  select coalesce(jsonb_agg(dashboard_private.textbook_reference_book_option_v1(to_jsonb(source))order by dashboard_private.textbook_trim_v1(coalesce(nullif(title,''),name))collate dashboard_private.textbook_reference_ko_numeric,id),'[]')into options from source;
  return dashboard_private.textbook_reference_page_v1(options,p_filters,array['subject','grade','subSubject'],p_page,p_page_size);
end $$;
create function public.list_textbook_class_reference_page_v1(p_filters jsonb,p_sort text,p_page integer,p_page_size integer)returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare options jsonb;begin
  perform dashboard_private.textbook_reference_filters_v1(p_filters,array['subject','grade','teacher']);perform dashboard_private.textbook_read_page_v1(p_page,p_page_size,p_sort,'match-name');
  with source as materialized(
    select c.id,c.name,c.subject,c.grade,c.teacher,c.room,c.status,c.student_ids,c.schedule from public.classes c)
  select coalesce(jsonb_agg(dashboard_private.textbook_reference_class_option_v1(to_jsonb(source))order by dashboard_private.textbook_trim_v1(coalesce(nullif(name,''),id::text))collate dashboard_private.textbook_reference_ko_numeric,id),'[]')into options from source;
  return dashboard_private.textbook_reference_page_v1(options,p_filters,array['subject','grade','teacher'],p_page,p_page_size);
end $$;
create function public.list_textbook_teacher_reference_page_v1(p_filters jsonb,p_sort text,p_page integer,p_page_size integer)returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare options jsonb;begin
  perform dashboard_private.textbook_reference_filters_v1(p_filters,'{}');perform dashboard_private.textbook_read_page_v1(p_page,p_page_size,p_sort,'match-name');
  select coalesce(jsonb_agg(jsonb_build_object('value',name,'label',name)order by name collate dashboard_private.textbook_reference_ko_label,name collate"C"),'[]')into options from(select distinct dashboard_private.textbook_trim_v1(coalesce(nullif(t.name,''),t.id::text))name from public.teacher_catalogs t)a where name<>'';
  return dashboard_private.textbook_reference_page_v1(options,p_filters,'{}',p_page,p_page_size);
end $$;
create function public.list_textbook_location_reference_page_v1(p_filters jsonb,p_sort text,p_page integer,p_page_size integer)returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare options jsonb;default_location jsonb;begin
  perform dashboard_private.textbook_reference_filters_v1(p_filters,'{}');perform dashboard_private.textbook_read_page_v1(p_page,p_page_size,p_sort,'match-order');
  with locations as materialized(select l.* from public.textbook_inventory_locations l)
  select coalesce((select jsonb_agg(jsonb_build_object('value',id,'label',dashboard_private.textbook_trim_v1(coalesce(nullif(name,''),code)),'searchText',dashboard_private.textbook_trim_v1(code))order by sort_order nulls last,id)from locations),'[]'),
    (select jsonb_build_object('id',id,'code',code,'name',name)from locations order by (dashboard_private.textbook_trim_v1(code)='main')desc,sort_order nulls last,id limit 1)into options,default_location;
  return dashboard_private.textbook_reference_page_v1(options,p_filters,'{}',p_page,p_page_size)||jsonb_build_object('defaultLocation',default_location);
end $$;

create function public.resolve_textbook_reference_v1(p_reference text,p_active_only boolean,p_scope text,p_fallback_supplier text)returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare result uuid;reference text;normalized text;compact text;book jsonb;configured text;supplier jsonb;active boolean;begin
  if p_reference is null or p_active_only is null or p_scope is null or p_scope not in('request','management')or p_fallback_supplier is null then raise exception 'textbook_reference_input_invalid'using errcode='22023';end if;
  perform dashboard_private.textbook_workflow_guard_v1(case p_scope when'request'then'request'else'order'end);
  reference:=dashboard_private.textbook_trim_v1(p_reference);if reference=''then return jsonb_build_object('row',null);end if;
  normalized:=dashboard_private.textbook_workflow_normalize_v1(reference);compact:=dashboard_private.textbook_compact_v1(reference);
  with eligible as materialized(select b.id,b.title,b.name,b.isbn13,b.barcode from public.textbooks b where not p_active_only or lower(dashboard_private.textbook_trim_v1(b.status))not in('inactive','미사용')),
  matches as(select b.id,case when b.id::text=reference then 0 else m.rank end rank from eligible b cross join lateral(
    select min(case when dashboard_private.textbook_workflow_normalize_v1(alias)=normalized then 1 when compact<>''and dashboard_private.textbook_compact_v1(alias)=compact then 2 end)rank
      from unnest(array[coalesce(nullif(b.title,''),b.name),b.name,b.isbn13,b.barcode])alias)m)
  select id into result from matches where rank is not null order by rank,id limit 1;
  if result is null then return jsonb_build_object('row',null);end if;
  select dashboard_private.textbook_workflow_book_v1(b.id)||jsonb_build_object('category',b.category,'school_level',b.school_level,'grade_level',b.grade_level,'school_levels',b.school_levels,'grade_levels',b.grade_levels,'sub_subject',b.sub_subject,'subject_area_key',b.subject_area_key)into book from public.textbooks b where b.id=result;
  active:=lower(dashboard_private.textbook_trim_v1(book->>'status'))not in('inactive','미사용');
  configured:=coalesce(dashboard_private.textbook_workflow_supplier_v1(result,null,case p_scope when'request'then'request'else'order'end)::text,p_fallback_supplier);
  if p_scope='management'then select jsonb_build_object('id',s.id,'name',s.name)into supplier from public.textbook_suppliers s
    where s.id::text=configured or dashboard_private.textbook_trim_v1(s.name)=configured order by s.id limit 1;end if;
  return jsonb_build_object('row',jsonb_build_object('textbook',book,'option',case when active then dashboard_private.textbook_reference_book_option_v1(book)end,'configuredSupplierId',configured,'supplier',supplier));
end $$;
create function public.get_textbook_class_reference_v1(p_class_id uuid)returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare c jsonb;location jsonb;teacher text;inferred_code text;begin
  perform dashboard_private.textbook_workflow_guard_v1('request');if p_class_id is null then raise exception 'textbook_reference_input_invalid'using errcode='22023';end if;
  select to_jsonb(row_value)into c from public.classes row_value where id=p_class_id;if c is null then return jsonb_build_object('row',null);end if;
  -- The current physical class schema stores denormalized teacher names only.
  -- No teacher-ID aliases are fabricated; the pure adapter retains legacy aliases.
  select dashboard_private.textbook_trim_v1(value)into teacher from regexp_split_to_table(coalesce(c->>'teacher',''),'[,/·|]')with ordinality a(value,ord)where dashboard_private.textbook_trim_v1(value)<>''order by ord limit 1;
  inferred_code:=case when c->>'room'~'(별관|별\s*\d)'then'annex'when c->>'room'~'(본관|본\s*\d)'then'main'end;
  select jsonb_build_object('id',l.id,'code',l.code,'name',l.name)into location from public.textbook_inventory_locations l where lower(dashboard_private.textbook_trim_v1(l.code))=inferred_code order by l.sort_order nulls last,l.id limit 1;
  return jsonb_build_object('row',jsonb_build_object('id',p_class_id,'name',dashboard_private.textbook_trim_v1(coalesce(nullif(c->>'name',''),p_class_id::text)),'option',dashboard_private.textbook_reference_class_option_v1(c),'enrolledStudentCount',jsonb_array_length(dashboard_private.textbook_context_roster_v1(c->'student_ids')),'defaultTeacherName',coalesce(teacher,''),'inferredLocation',location));
end $$;
create function public.get_textbook_location_reference_v1(p_location_id uuid)returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare row_value jsonb;begin
  perform dashboard_private.textbook_workflow_guard_v1('request');if p_location_id is null then raise exception 'textbook_reference_input_invalid'using errcode='22023';end if;
  select jsonb_build_object('id',l.id,'code',l.code,'name',l.name,'option',jsonb_build_object('value',l.id,'label',dashboard_private.textbook_trim_v1(coalesce(nullif(l.name,''),l.code)),'searchText',dashboard_private.textbook_trim_v1(l.code)))into row_value from public.textbook_inventory_locations l where l.id=p_location_id;
  return jsonb_build_object('row',row_value);
end $$;
create function dashboard_private.textbook_reference_settings_v1()returns table(subject text,name text,ord bigint)
language sql stable security invoker set search_path='' as $$
with defaults(subject,names)as(values('english',array['단어','독해','듣기','문법','모고','내신']),('math',array['공통수학1','공통수학2','대수','미적분','확률과 통계','기하','수1','수2','내신']),('science',array['통합과학','물리학','화학','생명과학','지구과학']),('other',array['기타'])),
stored as materialized(select dashboard_private.textbook_subject_v1(s.subject)subject,dashboard_private.textbook_trim_v1(s.name)name,s.sort_order,s.is_visible,
  row_number()over(order by s.id)source_ord from public.textbook_sub_subject_settings s where dashboard_private.textbook_trim_v1(s.name)<>''),
merged as(select subject,name,sort_order,is_visible,0 origin,source_ord from stored
  union all select d.subject,n.name,(n.position*10)::integer,true,1,n.position from defaults d cross join lateral unnest(d.names)with ordinality n(name,position)
  where not exists(select 1 from stored s where s.subject=d.subject and s.name=n.name))
select subject,name,row_number()over(order by array_position(array['english','math','science','other'],subject),sort_order,
  name collate dashboard_private.textbook_reference_ko_numeric,origin,source_ord)ord from merged where is_visible
$$;
create function public.get_textbook_master_options_v1(p_filters jsonb)returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare publishers jsonb;subs jsonb;categories jsonb;bulk jsonb;science jsonb;begin
  perform dashboard_private.textbook_read_guard_v1();perform dashboard_private.textbook_context_strings_v1(p_filters,array['subject','listSubject','bulkSubject']);
  if p_filters->>'subject'not in('english','math','science','other')or p_filters->>'listSubject'not in('all','english','math','science','other')or p_filters->>'bulkSubject'not in('keep','english','math','science','other')then raise exception 'textbook_reference_filters_invalid'using errcode='22023';end if;
  -- Source ordinals reproduce stable JS sorts and configured-first deduplication.
  -- All label equality/normalization stays deterministic; new collations only sort.
  with configured as materialized(select id,dashboard_private.textbook_trim_v1(name)label from public.textbook_publishers),
  configured_unique as(select distinct on(lower(label))id,label from configured where label not in('','미분류')order by lower(label),id),
  labels as(select label,0 origin,row_number()over(order by label collate dashboard_private.textbook_reference_ko_numeric,id)source_ord from configured_unique
    union all select dashboard_private.textbook_trim_v1(b.publisher),1,row_number()over(order by dashboard_private.textbook_trim_v1(coalesce(nullif(b.title,''),b.name))collate dashboard_private.textbook_reference_ko_numeric,b.id)
    from public.textbooks b where lower(dashboard_private.textbook_trim_v1(b.status))not in('inactive','미사용')),
  dedup as(select distinct on(lower(label))label,origin,source_ord from labels where label not in('','미분류')order by lower(label),origin,source_ord)
  select coalesce(jsonb_agg(jsonb_build_object('value',label,'label',label,'description',case when origin=0 then'설정'else'기존'end)
    order by label collate dashboard_private.textbook_reference_ko_numeric,origin,source_ord),'[]')into publishers from dedup;
  with settings as materialized(select * from dashboard_private.textbook_reference_settings_v1()),
  sub_names as(select name,min(ord)first from settings where subject=p_filters->>'subject'group by name),
  list_settings as(select name,min(ord)first from settings where p_filters->>'listSubject'='all'or subject=p_filters->>'listSubject'group by name),
  list_sources as(select name,0 origin,row_number()over(order by name collate dashboard_private.textbook_reference_ko_numeric,first)source_ord from list_settings
    union all select dashboard_private.textbook_taxonomy_v1(to_jsonb(b))->>'subSubject',1,
      row_number()over(order by dashboard_private.textbook_trim_v1(coalesce(nullif(b.title,''),b.name))collate dashboard_private.textbook_reference_ko_numeric,b.id)
    from public.textbooks b where lower(dashboard_private.textbook_trim_v1(b.status))not in('inactive','미사용')and(p_filters->>'listSubject'='all'or dashboard_private.textbook_subject_v1(b.subject)=p_filters->>'listSubject')),
  list_unique as(select distinct on(name)name,origin,source_ord from list_sources where name<>''order by name,origin,source_ord),
  category_options as(select name,row_number()over(order by name collate dashboard_private.textbook_reference_ko_label,origin,source_ord)ord from list_unique),
  bulk_settings as(select name,min(ord)first from settings where p_filters->>'bulkSubject'<>'keep'and subject=p_filters->>'bulkSubject'group by name),
  bulk_sources as(select name,0 origin,row_number()over(order by name collate dashboard_private.textbook_reference_ko_numeric,first)source_ord from bulk_settings
    union all select name,1,ord from category_options),
  bulk_unique as(select distinct on(name)name,origin,source_ord from bulk_sources where name<>''order by name,origin,source_ord)
  select coalesce((select jsonb_agg(name order by name collate dashboard_private.textbook_reference_ko_numeric,first)from sub_names),'[]'),
    coalesce((select jsonb_agg(name order by ord)from category_options),'[]'),
    coalesce((select jsonb_agg(name order by name collate dashboard_private.textbook_reference_ko_numeric,origin,source_ord)from bulk_unique),'[]')into subs,categories,bulk;
  select coalesce(jsonb_agg(to_jsonb(a)order by sort_order,area_key),'[]')into science from public.list_active_science_subject_areas_v1()a;
  return jsonb_build_object('publisherOptions',publishers,'subSubjectOptions',subs,'categoryOptions',categories,'bulkCategoryOptions',bulk,'scienceSubjectAreas',science,'counts',jsonb_build_object('publisherOptions',jsonb_array_length(publishers),'subSubjectOptions',jsonb_array_length(subs),'categoryOptions',jsonb_array_length(categories),'bulkCategoryOptions',jsonb_array_length(bulk),'scienceSubjectAreas',jsonb_array_length(science)),'complete',true);
end $$;
create function public.get_textbook_inactive_cleanup_context_v1()returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare result jsonb;begin
  perform dashboard_private.textbook_read_guard_v1();
  with targets as materialized(select b.id,coalesce(nullif(dashboard_private.textbook_trim_v1(coalesce(nullif(b.title,''),b.name)),''),'교재명 없음')title,
    coalesce(nullif(dashboard_private.textbook_trim_v1(b.publisher),''),'미분류')||' · '||(dashboard_private.textbook_taxonomy_v1(to_jsonb(b))->>'categoryLabel')||' · 미사용'detail,
    row_number()over(order by dashboard_private.textbook_trim_v1(coalesce(nullif(b.title,''),b.name))collate dashboard_private.textbook_reference_ko_numeric,b.id)ord
    from public.textbooks b where lower(dashboard_private.textbook_trim_v1(b.status))in('inactive','미사용'))
  select jsonb_build_object('targetIds',coalesce(jsonb_agg(id order by ord),'[]'),'totalCount',count(*),'previewRows',coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'detail',detail)order by ord)filter(where ord<=5),'[]'),'complete',true)into result from targets;return result;
end $$;

-- Exact new-function ACLs only. Invoker dependencies keep existing RLS/ACL.
do $$declare f record;begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
    (n.nspname='dashboard_private'and p.proname=any(array['textbook_reference_utf16_v1','textbook_reference_score_v1','textbook_reference_filters_v1','textbook_reference_values_v1','textbook_reference_book_option_v1','textbook_reference_class_option_v1','textbook_reference_command_v1','textbook_reference_match_v1','textbook_reference_groups_v1','textbook_reference_page_v1','textbook_reference_settings_v1']))
    or(n.nspname='public'and p.proname=any(array['list_textbook_reference_page_v1','list_textbook_class_reference_page_v1','list_textbook_teacher_reference_page_v1','list_textbook_location_reference_page_v1','resolve_textbook_reference_v1','get_textbook_class_reference_v1','get_textbook_location_reference_v1','get_textbook_master_options_v1','get_textbook_inactive_cleanup_context_v1']))loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;
