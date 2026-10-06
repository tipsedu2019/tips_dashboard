begin;
set local lock_timeout='5s';
set local statement_timeout='8s';
-- Keep the existing invoker, ACL, validation, RLS, counts and detail projection.
create or replace function public.list_makeup_numbered_page_v1(p_filters jsonb,p_page integer,p_page_size integer) returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare actor uuid:=auth.uid(); manager boolean; f jsonb:=p_filters; k text; date_value text; result jsonb; needs_keys boolean;
 columns text[]:=array['status','className','subject','teacher','requester','reason','cancelDate','makeupAt','makeupRoom','approver','submittedAt','revisionRequestedAt','approvedAt','rejectedAt','canceledAt','returnedReason','rejectedReason','finalNote','canceledNote'];
begin
 if actor is null then raise exception 'makeup_auth_required' using errcode='42501'; end if;
 if p_page is null or p_page<1 or p_page_size is null or p_page_size not in(10,15,20) or jsonb_typeof(f) is distinct from 'object' then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(f))<>10 or not f ?& array['view','subject','teacher','period','dateFrom','dateTo','filterColumn','search','sortColumn','sortDirection'] then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if;
 foreach k in array array['view','subject','teacher','period','dateFrom','dateTo','filterColumn','search'] loop if jsonb_typeof(f->k) is distinct from 'string' then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if; end loop;
 if f->>'view' not in('mine','approvalPending','makeupPending','refundPending','closed') or f->>'subject' not in('all','영어','수학','과학') or f->>'period' not in('all','today','week','month','custom')
  or not(f->>'filterColumn'=any(columns)) or not(f->>'teacher'='all' or f->>'teacher' ~ '^id:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or f->>'teacher' ~ '^name:.+')
  or not coalesce((f->'sortColumn'='null'::jsonb and f->'sortDirection'='null'::jsonb) or (jsonb_typeof(f->'sortColumn')='string' and f->>'sortColumn'=any(columns) and f->>'sortDirection' in('asc','desc')),false) then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if;
 foreach k in array array['dateFrom','dateTo'] loop
  date_value:=f->>k;
  if date_value<>'' then
   if date_value !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if;
   begin if to_char(date_value::date,'YYYY-MM-DD')<>date_value then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if; exception when datetime_field_overflow or invalid_datetime_format then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end;
  end if;
 end loop;
 if (f->>'period'='all' and (f->>'dateFrom'<>'' or f->>'dateTo'<>'')) or (f->>'period' in('today','week','month') and (f->>'dateFrom'='' or f->>'dateTo'='')) or (f->>'dateFrom'<>'' and f->>'dateTo'<>'' and f->>'dateFrom'>f->>'dateTo') then raise exception 'makeup_numbered_request_invalid' using errcode='22023'; end if;
 select coalesce(role in('admin','staff'),false) into manager from public.profiles where id=actor;
 -- Branch before EXISTS: a nullable sortColumn otherwise causes an unused
 -- legacy-compatibility scan even during default browsing.
 if (f->>'period'<>'all' or f->>'sortColumn' in('makeupAt','makeupRoom') or (public.makeup_numbered_trim_v1(f->>'search')<>'' and f->>'filterColumn' in('makeupAt','makeupRoom'))) then
  if exists (
  select 1 from public.makeup_requests r where
   case f->>'view'
    when 'mine' then r.status='revision_requested' and actor in(r.requester_id,r.teacher_profile_id,r.approver_profile_id)
    when 'approvalPending' then r.status='approval_pending' and (manager or actor in(r.requester_id,r.teacher_profile_id,r.approver_profile_id))
    when 'makeupPending' then r.status='makeup_pending' and (manager or actor in(r.requester_id,r.teacher_profile_id,r.approver_profile_id))
    when 'refundPending' then r.status='refund_pending' and (manager or actor in(r.requester_id,r.teacher_profile_id,r.approver_profile_id))
    when 'closed' then r.status in('completed','rejected','canceled') else false end
   and (f->>'subject'='all' or public.makeup_numbered_trim_v1(r.subject)=f->>'subject')
   and (f->>'teacher'='all' or f->>'teacher'=case when r.teacher_catalog_id is not null then 'id:'||r.teacher_catalog_id else 'name:'||coalesce(public.makeup_numbered_profile_label_v1(r.teacher_profile_id),'선생님') end)
   and public.makeup_numbered_legacy_slots_v1(to_jsonb(r))
 ) then raise exception 'makeup_legacy_slot_format_unsupported' using errcode='22023'; end if;
 end if;
 -- Default browsing uses only membership/facets and created_at/id ordering.
 -- Derive display/search keys only when a filter or sort actually consumes them.
 needs_keys:=public.makeup_numbered_trim_v1(f->>'search')<>'' or f->>'period'<>'all' or f->>'sortColumn' is not null;
 with authorized as materialized (
  select r.id,r.status,r.subject,r.teacher_catalog_id,r.teacher_profile_id,r.requester_id,r.approver_profile_id,
   r.class_name,r.reason,r.cancel_date,r.makeup_start_at,r.makeup_end_at,r.makeup_classroom,r.makeup_slots,r.approver_teacher_catalog_id,r.returned_reason,r.rejected_reason,r.final_note,r.approved_at,r.canceled_at,r.created_at,
   (r.requester_id=actor or r.teacher_profile_id=actor or r.approver_profile_id=actor) is true involved
  from public.makeup_requests r
 ), membership as materialized (
  select a.*,array_remove(array[
   case when involved and status='revision_requested' then 'mine' end,
   case when (manager or involved) and status='approval_pending' then 'approvalPending' end,
   case when (manager or involved) and status='makeup_pending' then 'makeupPending' end,
   case when (manager or involved) and status='refund_pending' then 'refundPending' end,
   case when status in('completed','rejected','canceled') then 'closed' end],null) views
  from authorized a
 ), current_view as materialized (
  select a.*,coalesce((select nullif(public.makeup_numbered_trim_v1(name),'') from public.teacher_catalogs where id=a.teacher_catalog_id),public.makeup_numbered_profile_label_v1(a.teacher_profile_id),'선생님') teacher_label
  from membership a where f->>'view'=any(a.views)
 ), keyed as materialized (
  select a.id,a.created_at,case when needs_keys then public.makeup_numbered_values_v1(to_jsonb(a),coalesce(e.latest,'{}'),jsonb_build_object('teacher',a.teacher_label,'requester',coalesce(public.makeup_numbered_profile_label_v1(a.requester_id),'신청자'),'approver',coalesce((select nullif(public.makeup_numbered_trim_v1(name),'') from public.teacher_catalogs where id=a.approver_teacher_catalog_id),public.makeup_numbered_profile_label_v1(a.approver_profile_id),'결재자'))) else '{}'::jsonb end keys
  from current_view a
  left join lateral (
   select jsonb_object_agg(kind,jsonb_build_object('createdAt',to_jsonb(created_at)#>>'{}','note',public.makeup_numbered_trim_v1(note))) latest from (
    select distinct on(kind) case when public.makeup_numbered_trim_v1(event_type) in('approval_canceled','completed_canceled') then 'canceled' when public.makeup_numbered_trim_v1(event_type) in('submitted','resubmitted') then 'submitted' else public.makeup_numbered_trim_v1(event_type) end kind,created_at,id,note
    from public.makeup_request_events where needs_keys and request_id=a.id and public.makeup_numbered_trim_v1(event_type) in('approval_canceled','completed_canceled','submitted','resubmitted','revision_requested','approved','rejected') order by kind,created_at desc,id desc
   ) latest_events
  ) e on true
  where (f->>'subject'='all' or public.makeup_numbered_trim_v1(a.subject)=f->>'subject') and (f->>'teacher'='all' or f->>'teacher'=case when a.teacher_catalog_id is not null then 'id:'||a.teacher_catalog_id else 'name:'||a.teacher_label end)
 ), filtered as materialized (
  select * from keyed where (public.makeup_numbered_trim_v1(f->>'search')='' or strpos(lower(keys->>(f->>'filterColumn')),lower(public.makeup_numbered_trim_v1(f->>'search')))>0)
   and (f->>'period'='all' or exists(select 1 from jsonb_array_elements_text(keys->'dates')d where (f->>'dateFrom'='' or d>=f->>'dateFrom') and (f->>'dateTo'='' or d<=f->>'dateTo')))
 ), selected as materialized (
  select id,row_number() over(order by case when f->>'sortDirection'='asc' then keys->>(f->>'sortColumn') end collate public.makeup_ko_numeric asc,
   case when f->>'sortDirection'='desc' then keys->>(f->>'sortColumn') end collate public.makeup_ko_numeric desc,case when f->>'sortColumn' is null then created_at end desc,id desc) position
  from filtered order by case when f->>'sortDirection'='asc' then keys->>(f->>'sortColumn') end collate public.makeup_ko_numeric asc,
   case when f->>'sortDirection'='desc' then keys->>(f->>'sortColumn') end collate public.makeup_ko_numeric desc,case when f->>'sortColumn' is null then created_at end desc,id desc limit p_page_size offset (p_page::bigint-1)*p_page_size
 ), teacher_sources as (
  select 'id:'||t.id value,public.makeup_numbered_trim_v1(t.name) label,0::bigint count,0 source,t.sort_order sort_order
  from public.teacher_catalogs t where t.is_visible is distinct from false and (f->>'subject'='all' or exists(select 1 from regexp_split_to_table(case when jsonb_typeof(to_jsonb(t.subjects))='array' then (select string_agg(x,',') from jsonb_array_elements_text(to_jsonb(t.subjects))x) else t.subjects::text end,'[,，/]+')s where regexp_replace(translate(s,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF',''),'(과목|팀)$','')=f->>'subject'))
  union all
  select case when a.teacher_catalog_id is not null then 'id:'||a.teacher_catalog_id else 'name:'||a.teacher_label end,a.teacher_label,count(*),1,0 from current_view a where f->>'subject'='all' or public.makeup_numbered_trim_v1(a.subject)=f->>'subject' group by 1,2
 ), teacher_options as (
  select distinct on(value) * from teacher_sources where value<>'' and label<>'' order by value,source,sort_order,label collate public.makeup_ko_numeric
 )
 select jsonb_build_object('page',p_page,'pageSize',p_page_size,'totalCount',(select count(*) from filtered),
  'viewCounts',(select jsonb_object_agg(v,(select count(*) from membership where v=any(views))) from unnest(array['mine','approvalPending','makeupPending','refundPending','closed'])v),
  'subjectOptions',(select jsonb_agg(jsonb_build_object('value',s,'label',s,'count',(select count(*) from current_view where public.makeup_numbered_trim_v1(subject)=s)) order by ord) from unnest(array['영어','수학','과학'])with ordinality subjects(s,ord)),
  'teacherOptions',coalesce((select jsonb_agg(jsonb_build_object('value',value,'label',label,'count',count) order by source,sort_order,label collate public.makeup_ko_numeric) from teacher_options),'[]'),
  'rows',coalesce((select jsonb_agg(public.get_makeup_detail_v1(id) order by position) from selected),'[]')) into result;
 return result;
end $$;
commit;
