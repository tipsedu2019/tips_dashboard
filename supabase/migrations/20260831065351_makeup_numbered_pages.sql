begin;
set local lock_timeout='5s';
-- ICU Korean numeric ordering matches the existing localeCompare('ko',{numeric:true}).
create collation if not exists public.makeup_ko_numeric (provider=icu, locale='ko-u-kn-true', deterministic=true);

-- ECMAScript String.trim set: U0085 deliberately excluded, internal whitespace retained.
create function public.makeup_numbered_trim_v1(value text) returns text
language sql immutable security invoker set search_path='' as $$
 select btrim(coalesce(value,''),U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
create function public.makeup_numbered_time_label_v1(value text) returns text
language sql immutable security invoker set search_path='' as $$
 select case when coalesce(value,'')='' then '-' when value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then left(value,10)||' '||substring(value from 12 for 5) else value end
$$;
create function public.makeup_numbered_slots_v1(r jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare raw jsonb:=r->'makeup_slots'; s jsonb; result jsonb:='[]'; i integer:=0; a text; b text; d text; t text; parsed_date timestamptz; room text:=public.makeup_numbered_trim_v1(r->>'makeup_classroom');
begin
 if jsonb_typeof(raw)='string' then begin raw:=(raw#>>'{}')::jsonb; exception when invalid_text_representation then raw:='[]'; end; end if;
 if jsonb_typeof(raw)='array' then
  for s in select value from jsonb_array_elements(raw) loop
   i:=i+1;
   a:=coalesce(nullif(public.makeup_numbered_trim_v1(s->>'startAt'),''),nullif(public.makeup_numbered_trim_v1(s->>'start_at'),''),'');
   b:=coalesce(nullif(public.makeup_numbered_trim_v1(s->>'endAt'),''),nullif(public.makeup_numbered_trim_v1(s->>'end_at'),''),'');
   d:=public.makeup_numbered_trim_v1(s->>'date');
   if d !~ '^\d{4}-\d{2}-\d{2}$' then
    -- The model's date+time fallback is Seoul-aware, unlike table date extraction.
    if d ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$' then d:=replace(d,' ','T')||'+09:00'; end if;
    parsed_date:=public.makeup_numbered_instant_v1(d);
    d:=case when parsed_date is not null then to_char(parsed_date at time zone 'Asia/Seoul','YYYY-MM-DD') end;
   end if;
   if a='' then t:=public.makeup_numbered_trim_v1(coalesce(nullif(s->>'startTime',''),s->>'start_time')); if d is not null and t ~ '^\d{1,2}:\d{2}$' then a:=d||'T'||lpad(t,5,'0')||':00+09:00'; end if; end if;
   if b='' then t:=public.makeup_numbered_trim_v1(coalesce(nullif(s->>'endTime',''),s->>'end_time')); if d is not null and t ~ '^\d{1,2}:\d{2}$' then b:=d||'T'||lpad(t,5,'0')||':00+09:00'; end if; end if;
   if a<>'' and b<>'' then result:=result||jsonb_build_array(jsonb_build_object('id',coalesce(nullif(public.makeup_numbered_trim_v1(s->>'id'),''),'slot-'||i),'startAt',a,'endAt',b,'classroom',coalesce(nullif(public.makeup_numbered_trim_v1(s->>'classroom'),''),room))); end if;
  end loop;
 end if;
 if jsonb_array_length(result)=0 and public.makeup_numbered_trim_v1(r->>'makeup_start_at')<>'' and public.makeup_numbered_trim_v1(r->>'makeup_end_at')<>'' then
  result:=jsonb_build_array(jsonb_build_object('id','slot-1','startAt',public.makeup_numbered_trim_v1(r->>'makeup_start_at'),'endAt',public.makeup_numbered_trim_v1(r->>'makeup_end_at'),'classroom',room));
 end if;
 return result;
end $$;
-- Unknown date-only fallback is kept raw for the existing browser model.
-- Do not approximate JavaScript's implementation-defined loose Date.parse here.
create function public.makeup_numbered_legacy_slots_v1(r jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare raw jsonb:=r->'makeup_slots'; s jsonb; a text; b text; d text; start_time text; end_time text;
begin
 if jsonb_typeof(raw)='string' then begin raw:=(raw#>>'{}')::jsonb; exception when invalid_text_representation then return false; end; end if;
 if jsonb_typeof(raw) is distinct from 'array' then return false; end if;
 for s in select value from jsonb_array_elements(raw) loop
  a:=coalesce(nullif(public.makeup_numbered_trim_v1(s->>'startAt'),''),public.makeup_numbered_trim_v1(s->>'start_at'));
  b:=coalesce(nullif(public.makeup_numbered_trim_v1(s->>'endAt'),''),public.makeup_numbered_trim_v1(s->>'end_at'));
  d:=public.makeup_numbered_trim_v1(s->>'date');
  start_time:=public.makeup_numbered_trim_v1(coalesce(nullif(s->>'startTime',''),s->>'start_time'));
  end_time:=public.makeup_numbered_trim_v1(coalesce(nullif(s->>'endTime',''),s->>'end_time'));
  if d<>'' and ((a='' and start_time ~ '^\d{1,2}:\d{2}$') or (b='' and end_time ~ '^\d{1,2}:\d{2}$')) then
   if d ~ '^\d{4}-\d{2}-\d{2}$' then continue; end if;
   if d ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$' then d:=replace(d,' ','T')||'+09:00'; end if;
   if public.makeup_numbered_instant_v1(d) is null then return true; end if;
  end if;
 end loop;
 return false;
end $$;
create function public.makeup_numbered_profile_label_v1(p_id uuid) returns text
language sql stable security invoker set search_path='' as $$
 select coalesce(nullif(public.makeup_numbered_trim_v1(p.name),''),nullif(public.makeup_numbered_trim_v1(p.email),''),nullif(public.makeup_numbered_trim_v1(p.login_id),''),p.id::text) from public.profiles p where p.id=p_id
$$;

create function public.get_makeup_detail_v1(p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare r public.makeup_requests; result jsonb; k text; source_key text; events jsonb;
begin
 if auth.uid() is null then raise exception 'makeup_auth_required' using errcode='42501'; end if;
 if p_id is null then raise exception 'makeup_detail_request_invalid' using errcode='22023'; end if;
 select * into r from public.makeup_requests where id=p_id;
 if not found then return null; end if;
 result:=jsonb_build_object('id',r.id,'status',r.status,'approvalGroup',r.approval_group,'requestKind',r.request_kind,
  'requesterLabel',coalesce(public.makeup_numbered_profile_label_v1(r.requester_id),'신청자'),
  'teacherLabel',coalesce((select nullif(public.makeup_numbered_trim_v1(name),'') from public.teacher_catalogs where id=r.teacher_catalog_id),public.makeup_numbered_profile_label_v1(r.teacher_profile_id),'선생님'),
  'approverLabel',coalesce((select nullif(public.makeup_numbered_trim_v1(name),'') from public.teacher_catalogs where id=r.approver_teacher_catalog_id),public.makeup_numbered_profile_label_v1(r.approver_profile_id),'결재자'),
  'approvedByLabel',coalesce(public.makeup_numbered_profile_label_v1(r.approved_by),''),'completedByLabel',coalesce(public.makeup_numbered_profile_label_v1(r.completed_by),''),'canceledByLabel',coalesce(public.makeup_numbered_profile_label_v1(r.canceled_by),''),
  'makeupSlots',public.makeup_numbered_slots_v1(to_jsonb(r)),
  'schedulePlanBefore',case when jsonb_typeof(r.schedule_plan_before)='object' then r.schedule_plan_before else '{}'::jsonb end,
  'schedulePlanAfter',case when jsonb_typeof(r.schedule_plan_after)='object' then r.schedule_plan_after else '{}'::jsonb end,
  'makeupAcademicEventIds',coalesce(r.makeup_academic_event_ids,'[]'));
 for k,source_key in select * from (values
  ('subject','subject'),('requesterId','requester_id'),('teacherCatalogId','teacher_catalog_id'),('teacherProfileId','teacher_profile_id'),('classId','class_id'),('className','class_name'),('reason','reason'),('cancelDate','cancel_date'),('makeupStartAt','makeup_start_at'),('makeupEndAt','makeup_end_at'),('makeupClassroom','makeup_classroom'),('approverTeacherCatalogId','approver_teacher_catalog_id'),('approverProfileId','approver_profile_id'),('returnedReason','returned_reason'),('rejectedReason','rejected_reason'),('finalNote','final_note'),('approvedBy','approved_by'),('approvedAt','approved_at'),('completedBy','completed_by'),('completedAt','completed_at'),('canceledBy','canceled_by'),('canceledAt','canceled_at'),('cancelAcademicEventId','cancel_academic_event_id'),('makeupAcademicEventId','makeup_academic_event_id'),('createdAt','created_at'),('updatedAt','updated_at'))m(k,s) loop
  result:=result||jsonb_build_object(k,public.makeup_numbered_trim_v1(to_jsonb(r)->>source_key));
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'requestId',e.request_id,'actorId',coalesce(e.actor_id::text,''),'actorLabel',coalesce(public.makeup_numbered_profile_label_v1(e.actor_id),'시스템'),
  'eventType',public.makeup_numbered_trim_v1(e.event_type),'fieldName',public.makeup_numbered_trim_v1(e.field_name),'beforeValue',public.makeup_numbered_trim_v1(e.before_value),'afterValue',public.makeup_numbered_trim_v1(e.after_value),'note',public.makeup_numbered_trim_v1(e.note),'createdAt',to_jsonb(e.created_at)#>>'{}') order by e.created_at desc,e.id desc),'[]') into events from public.makeup_request_events e where e.request_id=p_id;
 return result||jsonb_build_object('events',events)||case when public.makeup_numbered_legacy_slots_v1(to_jsonb(r)) then jsonb_build_object('rawMakeupSlots',r.makeup_slots) else '{}'::jsonb end;
end $$;

-- Only display keys and date candidates are derived for the complete filtered set.
-- This helper receives latest-event values, never a complete parent history.
create function public.makeup_numbered_values_v1(r jsonb, latest jsonb, labels jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare slots jsonb:=public.makeup_numbered_slots_v1(r); s jsonb; slot_times text[]:='{}'; rooms text[]:='{}'; dates text[]:='{}'; a text; b text; note text; cancel_note text; result jsonb; k text;
begin
 if jsonb_array_length(slots)=0 then slots:=jsonb_build_array(jsonb_build_object('startAt',r->>'makeup_start_at','endAt',r->>'makeup_end_at','classroom',r->>'makeup_classroom')); end if;
 dates:=array[substring(r->>'cancel_date' from '^\d{4}-\d{2}-\d{2}')];
 for s in select value from jsonb_array_elements(slots) loop
  a:=public.makeup_numbered_time_label_v1(coalesce(nullif(s->>'startAt',''),r->>'makeup_start_at'));
  b:=public.makeup_numbered_time_label_v1(coalesce(nullif(s->>'endAt',''),r->>'makeup_end_at'));
  if a<>'-' or b<>'-' then slot_times:=array_append(slot_times,case when b='-' then a else a||' - '||b end); end if;
  if coalesce(nullif(s->>'classroom',''),r->>'makeup_classroom','')<>'' then rooms:=array_append(rooms,coalesce(nullif(s->>'classroom',''),r->>'makeup_classroom')); end if;
  dates:=dates||array[substring(coalesce(nullif(s->>'startAt',''),r->>'makeup_start_at') from '^\d{4}-\d{2}-\d{2}'),substring(coalesce(nullif(s->>'endAt',''),r->>'makeup_end_at') from '^\d{4}-\d{2}-\d{2}')];
 end loop;
 cancel_note:=public.makeup_numbered_trim_v1(latest#>>'{canceled,note}');
 note:=coalesce(nullif(public.makeup_numbered_trim_v1(latest#>>'{approved,note}'),''),public.makeup_numbered_trim_v1(r->>'final_note'));
 if note='' or note ~ '^보강\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}-\d{2}:\d{2}' or (cancel_note<>'' and note=cancel_note) then note:='-'; end if;
 result:=labels||jsonb_build_object('status',case r->>'status' when 'approval_pending' then '결재자 승인 대기' when 'revision_requested' then '보완 요청' when 'rejected' then '반려' when 'manager_pending' then '이전 관리팀 전달' when 'makeup_pending' then '보강대기' when 'refund_pending' then '환불대기' when 'completed' then '완료' when 'canceled' then '승인 취소' else r->>'status' end,
  'className',public.makeup_numbered_trim_v1(r->>'class_name'),'subject',public.makeup_numbered_trim_v1(r->>'subject'),'reason',public.makeup_numbered_trim_v1(r->>'reason'),'cancelDate',coalesce(r->>'cancel_date',''),
  'makeupAt',coalesce(nullif(array_to_string(slot_times,' / '),''),'-'),'makeupRoom',coalesce(nullif(array_to_string(rooms,' / '),''),'-'),
  'submittedAt',public.makeup_numbered_time_label_v1(coalesce(nullif(r->>'created_at',''),latest#>>'{submitted,createdAt}')),
  'revisionRequestedAt',public.makeup_numbered_time_label_v1(latest#>>'{revision_requested,createdAt}'),
  'approvedAt',public.makeup_numbered_time_label_v1(coalesce(nullif(r->>'approved_at',''),latest#>>'{approved,createdAt}')),
  'rejectedAt',public.makeup_numbered_time_label_v1(latest#>>'{rejected,createdAt}'),
  'canceledAt',public.makeup_numbered_time_label_v1(coalesce(nullif(r->>'canceled_at',''),latest#>>'{canceled,createdAt}')),
  'returnedReason',public.makeup_numbered_trim_v1(r->>'returned_reason'),'rejectedReason',public.makeup_numbered_trim_v1(r->>'rejected_reason'),'finalNote',note,'canceledNote',cancel_note);
 for k in select jsonb_object_keys(result) loop if result->>k='' then result:=result||jsonb_build_object(k,'-'); end if; end loop;
 return result||jsonb_build_object('dates',to_jsonb(array_remove(dates,null)));
end $$;

create function public.list_makeup_numbered_page_v1(p_filters jsonb,p_page integer,p_page_size integer) returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare actor uuid:=auth.uid(); manager boolean; f jsonb:=p_filters; k text; date_value text; result jsonb;
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
 if (f->>'period'<>'all' or f->>'sortColumn' in('makeupAt','makeupRoom') or (public.makeup_numbered_trim_v1(f->>'search')<>'' and f->>'filterColumn' in('makeupAt','makeupRoom'))) and exists (
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
  select a.id,a.created_at,public.makeup_numbered_values_v1(to_jsonb(a),coalesce(e.latest,'{}'),jsonb_build_object('teacher',a.teacher_label,'requester',coalesce(public.makeup_numbered_profile_label_v1(a.requester_id),'신청자'),'approver',coalesce((select nullif(public.makeup_numbered_trim_v1(name),'') from public.teacher_catalogs where id=a.approver_teacher_catalog_id),public.makeup_numbered_profile_label_v1(a.approver_profile_id),'결재자'))) keys
  from current_view a
  left join lateral (
   select jsonb_object_agg(kind,jsonb_build_object('createdAt',to_jsonb(created_at)#>>'{}','note',public.makeup_numbered_trim_v1(note))) latest from (
    select distinct on(kind) case when public.makeup_numbered_trim_v1(event_type) in('approval_canceled','completed_canceled') then 'canceled' when public.makeup_numbered_trim_v1(event_type) in('submitted','resubmitted') then 'submitted' else public.makeup_numbered_trim_v1(event_type) end kind,created_at,id,note
    from public.makeup_request_events where request_id=a.id and public.makeup_numbered_trim_v1(event_type) in('approval_canceled','completed_canceled','submitted','resubmitted','revision_requested','approved','rejected') order by kind,created_at desc,id desc
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

create function public.makeup_numbered_instant_v1(value text) returns timestamptz
language plpgsql immutable security invoker set search_path='' set timezone='UTC' as $$
begin
 if value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$' then return null; end if;
 return value::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then return null;
end $$;
create function public.get_makeup_reservation_context_v1(p_slots jsonb,p_event_request_ids uuid[]) returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare s jsonb; result jsonb;
begin
 if auth.uid() is null then raise exception 'makeup_auth_required' using errcode='42501'; end if;
 if jsonb_typeof(p_slots) is distinct from 'array' or p_event_request_ids is null or array_position(p_event_request_ids,null) is not null then raise exception 'makeup_reservation_request_invalid' using errcode='22023'; end if;
 for s in select value from jsonb_array_elements(p_slots) loop
  if jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(s->'startAt') is distinct from 'string' or jsonb_typeof(s->'endAt') is distinct from 'string' or public.makeup_numbered_instant_v1(s->>'startAt') is null or public.makeup_numbered_instant_v1(s->>'endAt') is null or public.makeup_numbered_instant_v1(s->>'startAt')>=public.makeup_numbered_instant_v1(s->>'endAt') then raise exception 'makeup_reservation_request_invalid' using errcode='22023'; end if;
 end loop;
 with active as materialized (
  select id,status,class_name,makeup_start_at,makeup_end_at,makeup_classroom,makeup_slots from public.makeup_requests where status in('approval_pending','manager_pending','makeup_pending','completed')
 ), overlapping as (
  select a.* from active a where (jsonb_array_length(p_slots)>0 and public.makeup_numbered_legacy_slots_v1(to_jsonb(a))) or exists(select 1 from jsonb_array_elements(public.makeup_numbered_slots_v1(to_jsonb(a)))r cross join jsonb_array_elements(p_slots)t
   where public.makeup_numbered_instant_v1(r->>'startAt') is null or public.makeup_numbered_instant_v1(r->>'endAt') is null
    or (public.makeup_numbered_instant_v1(r->>'startAt')<public.makeup_numbered_instant_v1(t->>'endAt') and public.makeup_numbered_instant_v1(t->>'startAt')<public.makeup_numbered_instant_v1(r->>'endAt')))
 ) select jsonb_build_object('reservations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'className',public.makeup_numbered_trim_v1(class_name),'makeupStartAt',coalesce(to_jsonb(makeup_start_at)#>>'{}',''),'makeupEndAt',coalesce(to_jsonb(makeup_end_at)#>>'{}',''),'makeupClassroom',public.makeup_numbered_trim_v1(makeup_classroom),'makeupSlots',public.makeup_numbered_slots_v1(to_jsonb(o)))||case when public.makeup_numbered_legacy_slots_v1(to_jsonb(o)) then jsonb_build_object('rawMakeupSlots',makeup_slots) else '{}'::jsonb end order by id) from overlapping o),'[]'),
  'activeEventRequestIds',coalesce((select jsonb_agg(id order by id) from active where id=any(p_event_request_ids)),'[]')) into result;
 return result;
end $$;
revoke all on function public.makeup_numbered_trim_v1(text),public.makeup_numbered_time_label_v1(text),public.makeup_numbered_slots_v1(jsonb),public.makeup_numbered_profile_label_v1(uuid),public.makeup_numbered_values_v1(jsonb,jsonb,jsonb),public.makeup_numbered_instant_v1(text),public.get_makeup_detail_v1(uuid),public.list_makeup_numbered_page_v1(jsonb,integer,integer),public.get_makeup_reservation_context_v1(jsonb,uuid[]) from public,anon;
revoke all on function public.makeup_numbered_legacy_slots_v1(jsonb) from public,anon;
grant execute on function public.makeup_numbered_legacy_slots_v1(jsonb) to authenticated;
grant execute on function public.makeup_numbered_trim_v1(text),public.makeup_numbered_time_label_v1(text),public.makeup_numbered_slots_v1(jsonb),public.makeup_numbered_profile_label_v1(uuid),public.makeup_numbered_values_v1(jsonb,jsonb,jsonb),public.makeup_numbered_instant_v1(text),public.get_makeup_detail_v1(uuid),public.list_makeup_numbered_page_v1(jsonb,integer,integer),public.get_makeup_reservation_context_v1(jsonb,uuid[]) to authenticated;
commit;
