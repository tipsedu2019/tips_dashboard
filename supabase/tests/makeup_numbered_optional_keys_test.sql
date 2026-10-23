begin;
select no_plan();
-- Frozen pre-optimization list body from 20260831065351; prosrc MD5 14726f8103c6c00f3590411958c7a952.
create function pg_temp.original_makeup_list(p_filters jsonb,p_page integer,p_page_size integer) returns jsonb
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
set local timezone='Asia/Seoul';
create function pg_temp.mid(n integer) returns uuid language sql immutable as $$ select ('ad000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.actor(n integer) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub',coalesce(pg_temp.mid(n)::text,''),true);
 perform set_config('request.jwt.claims',case when n is null then '{}' else jsonb_build_object('sub',pg_temp.mid(n),'role','authenticated')::text end,true);
end $$;
create function pg_temp.filters(patch jsonb default '{}') returns jsonb language sql immutable as $$
 select '{"view":"approvalPending","subject":"all","teacher":"all","period":"all","dateFrom":"","dateTo":"","filterColumn":"className","search":"","sortColumn":null,"sortDirection":null}'::jsonb||patch
$$;
create function pg_temp.page(patch jsonb default '{}',p integer default 1) returns jsonb language sql stable as $$ select public.list_makeup_numbered_page_v1(pg_temp.filters(patch),p,10) $$;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.mid(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','makeup-numbered-'||n||'@test.invalid',crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now() from generate_series(801,806)n;
insert into public.profiles(id,role,name,email,created_at,updated_at)
select pg_temp.mid(n),case when n=804 then 'admin' when n=805 then 'assistant' when n=806 then 'staff' else 'teacher' end,'교사 '||n,'makeup-numbered-'||n||'@test.invalid',now(),now() from generate_series(801,806)n
on conflict(id) do update set role=excluded.role,name=excluded.name,email=excluded.email;
select pg_temp.actor(804);
create temp table seed_before as select (select count(*) from dashboard_private.notification_events) events,(select count(*) from dashboard_private.notification_event_fanout_jobs) jobs,(select count(*) from dashboard_private.notification_deliveries) deliveries;
-- Privileged fixture writes retain all production triggers and constraints.
insert into public.makeup_requests(id,status,subject,approval_group,requester_id,teacher_profile_id,approver_profile_id,class_name,request_kind,reason,cancel_date,makeup_start_at,makeup_end_at,makeup_classroom,created_at)
select pg_temp.mid(n),case when n<=112 then 'approval_pending' when n=113 then 'revision_requested' when n=114 then 'makeup_pending' when n=115 then 'refund_pending' when n=116 then 'completed' when n=117 then 'rejected' when n=118 then 'canceled' else 'manager_pending' end,
 case when n=110 then '수학' else '영어' end,'english',pg_temp.mid(case when n=112 then 802 else 801 end),pg_temp.mid(case when n=112 then 802 else 801 end),pg_temp.mid(case when n=112 then 803 else 804 end),'수업 '||n,'makeup_only',' 사유 '||n,'2026-08-01','2026-08-31T00:00:00Z','2026-08-31T01:00:00Z',case when n=2 then 'B' else 'A' end,'2026-08-01T00:00:00Z'
from generate_series(1,119)n;
-- Legacy JSON-array string, source offset and malformed partial-slot fallback.
update public.makeup_requests set makeup_slots=to_jsonb('[{"start_at":" 2026-09-01T09:00:00+09:00 ","end_at":"2026-09-02T10:00:00+09:00","classroom":" B "}]'::text) where id=pg_temp.mid(1);
update public.makeup_requests set makeup_start_at=null,makeup_end_at=null,makeup_slots='[]',request_kind='cancel_only',cancel_date=null where id=pg_temp.mid(119);
update public.makeup_requests set makeup_slots='[{"date":"2026-09-03","startTime":"9:00","end_time":"10:00","classroom":"C"}]' where id=pg_temp.mid(3);
update public.makeup_requests set reason=E'\t\n'||chr(160)||chr(65279)||'검색'||chr(133)||'  내부'||chr(65279),final_note='행 메모' where id=pg_temp.mid(4);
update public.makeup_requests set approved_at='2026-07-01T03:00:00Z',canceled_at='2026-07-02T04:00:00Z' where id=pg_temp.mid(5);
update public.makeup_requests set final_note='보강'||chr(160)||'2026-08-31'||chr(65279)||'09:00-10:00 공백시스템' where id=pg_temp.mid(8);
update public.makeup_requests set final_note='보강'||chr(133)||'2026-08-31'||chr(133)||'09:00-10:00 공백일반' where id=pg_temp.mid(9);
-- Visible catalog options precede request-derived options; exact JS whitespace, not POSIX space.
insert into public.teacher_catalogs(id,name,subjects,is_visible,sort_order) values
 (pg_temp.mid(701),'교사 2',array[chr(160)||'영'||chr(65279)||'어 팀'],true,2),
 (pg_temp.mid(702),'교사 10',array['영어'],true,2),
 (pg_temp.mid(703),'수학 전용',array['수학'],true,1),
 (pg_temp.mid(704),'U0085 제외',array['영'||chr(133)||'어'],true,0),
 (pg_temp.mid(705),'숨김 교사',array['영어'],false,0);
update public.makeup_requests set teacher_catalog_id=pg_temp.mid(701) where id=pg_temp.mid(109);
update public.makeup_requests set requester_id=pg_temp.mid(805) where id=pg_temp.mid(112);
update public.makeup_requests set makeup_slots='[{"startAt":"2026-08-31T09:00:00","endAt":"2026-08-31T10:00:00","classroom":"A"}]' where id=pg_temp.mid(106);
update public.makeup_requests set makeup_slots='[{"startAt":"August 31, 2026 09:00:00 GMT+0900","endAt":"August 31, 2026 10:00:00 GMT+0900","classroom":"B"}]' where id=pg_temp.mid(107);
update public.makeup_requests set makeup_slots='[{"startAt":"invalid","endAt":"also invalid","classroom":"C"}]' where id=pg_temp.mid(108);
update public.makeup_requests set created_at='2026-08-02T00:00:00Z' where id=pg_temp.mid(106);
update public.makeup_requests set makeup_slots=to_jsonb('[{"date":"September 1, 2026 16:00:00 GMT","startTime":"9:00","endTime":"10:00"},{"startAt":"2026-09-03T00:00:00Z","endAt":"2026-09-03T01:00:00Z","classroom":"B"}]'::text) where id=pg_temp.mid(116);
insert into public.makeup_request_events(id,request_id,actor_id,event_type,note,created_at) values
 (pg_temp.mid(501),pg_temp.mid(1),pg_temp.mid(804),'revision_requested','페이지 밖 보완','2026-08-29T01:00:00Z'),
 (pg_temp.mid(502),pg_temp.mid(1),pg_temp.mid(804),'approved','낮은 ID','2026-08-30T01:00:00Z'),
 (pg_temp.mid(503),pg_temp.mid(1),pg_temp.mid(804),'approved','높은 ID','2026-08-30T01:00:00Z'),
 (pg_temp.mid(504),pg_temp.mid(5),pg_temp.mid(804),'approved','승인 메모','2026-08-30T01:00:00Z'),
 (pg_temp.mid(505),pg_temp.mid(5),pg_temp.mid(804),'approval_canceled','취소 메모','2026-08-31T01:00:00Z'),
 (pg_temp.mid(506),pg_temp.mid(6),pg_temp.mid(804),'approved','보강 2026-08-31 09:00-10:00 시스템','2026-08-30T01:00:00Z'),
 (pg_temp.mid(507),pg_temp.mid(7),pg_temp.mid(804),'approved','같은 메모','2026-08-30T01:00:00Z'),
 (pg_temp.mid(508),pg_temp.mid(7),pg_temp.mid(804),'completed_canceled','같은 메모','2026-08-31T01:00:00Z'),
 (pg_temp.mid(509),pg_temp.mid(7),pg_temp.mid(804),'approval_canceled','같은 메모','2026-08-31T01:00:00Z');
set constraints all immediate;
select is((select count(*)::integer from public.makeup_requests where id between pg_temp.mid(1) and pg_temp.mid(119)),119,'valid complete fixture');
select diag('seed notification events='||((select count(*) from dashboard_private.notification_events)-(select events from seed_before))||', jobs='||((select count(*) from dashboard_private.notification_event_fanout_jobs)-(select jobs from seed_before)));
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from seed_before),'no seed provider delivery');
create temp table read_before as select (select count(*) from dashboard_private.notification_events) events,(select count(*) from dashboard_private.notification_event_fanout_jobs) jobs,(select count(*) from dashboard_private.notification_deliveries) deliveries,(select count(*) from public.makeup_request_events) request_events;
select ok(not p.prosecdef and 'search_path=""'=any(p.proconfig) and has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('public',p.oid,'execute'),'new reader invoker/ACL '||p.proname) from pg_proc p where p.oid in('public.list_makeup_numbered_page_v1(jsonb,integer,integer)'::regprocedure,'public.get_makeup_detail_v1(uuid)'::regprocedure,'public.get_makeup_reservation_context_v1(jsonb,uuid[])'::regprocedure);
select ok((select relrowsecurity from pg_class where oid='public.makeup_requests'::regclass),'request RLS retained');
select diag((select row_to_json(p)::text from pg_policies p where schemaname='public' and tablename='makeup_requests' and policyname='makeup_requests_assistant_hard_deny'));
select ok((select permissive='RESTRICTIVE' and qual like '%assistant%' from pg_policies where schemaname='public' and tablename='makeup_requests' and policyname='makeup_requests_assistant_hard_deny'),'final assistant restrictive policy retained');
set local role authenticated;

reset role;
-- Compare the whole JSON result, including ordered rows/history and unfiltered facets.
create function pg_temp.same_page(patch jsonb,p integer,size integer) returns boolean language sql stable as $$
 select public.list_makeup_numbered_page_v1(pg_temp.filters(patch),p,size)=pg_temp.original_makeup_list(pg_temp.filters(patch),p,size)
$$;
-- Freeze public DTO expectations from the synthetic source rows before role reads.
-- No candidate detail RPC/projector supplies the expected result. The unchanged
-- pure slot normalizer remains covered by the manager's frozen whole-body oracle.
set local timezone='UTC';
create temp table teacher_common_fixture_rows as
select r.id,r.status,r.requester_id,r.teacher_profile_id,r.approver_profile_id,r.created_at,r.subject,
 jsonb_build_object(
  'id',coalesce(to_jsonb(r)->>'id',''),
  'status',coalesce(to_jsonb(r)->>'status',''),
  'approvalGroup',coalesce(to_jsonb(r)->>'approval_group',''),
  'requestKind',coalesce(to_jsonb(r)->>'request_kind',''),
  'requesterId',coalesce(to_jsonb(r)->>'requester_id',''),
  'teacherCatalogId',coalesce(to_jsonb(r)->>'teacher_catalog_id',''),
  'teacherProfileId',coalesce(to_jsonb(r)->>'teacher_profile_id',''),
  'classId',coalesce(to_jsonb(r)->>'class_id',''),
  'className',coalesce(to_jsonb(r)->>'class_name',''),
  'subject',coalesce(to_jsonb(r)->>'subject',''),
  'cancelDate',coalesce(to_jsonb(r)->>'cancel_date',''),
  'makeupStartAt',coalesce(to_jsonb(r)->>'makeup_start_at',''),
  'makeupEndAt',coalesce(to_jsonb(r)->>'makeup_end_at',''),
  'makeupClassroom',coalesce(to_jsonb(r)->>'makeup_classroom',''),
  'approverTeacherCatalogId',coalesce(to_jsonb(r)->>'approver_teacher_catalog_id',''),
  'approverProfileId',coalesce(to_jsonb(r)->>'approver_profile_id',''),
  'approvedBy',coalesce(to_jsonb(r)->>'approved_by',''),
  'approvedAt',coalesce(to_jsonb(r)->>'approved_at',''),
  'completedBy',coalesce(to_jsonb(r)->>'completed_by',''),
  'completedAt',coalesce(to_jsonb(r)->>'completed_at',''),
  'canceledBy',coalesce(to_jsonb(r)->>'canceled_by',''),
  'canceledAt',coalesce(to_jsonb(r)->>'canceled_at',''),
  'cancelAcademicEventId',coalesce(to_jsonb(r)->>'cancel_academic_event_id',''),
  'makeupAcademicEventId',coalesce(to_jsonb(r)->>'makeup_academic_event_id',''),
  'createdAt',coalesce(to_jsonb(r)->>'created_at',''),
  'updatedAt',coalesce(to_jsonb(r)->>'updated_at',''),
  'requesterLabel',coalesce((select nullif(btrim(name),'') from public.profiles where id=r.requester_id),'신청자'),
  'teacherLabel',coalesce((select nullif(btrim(name),'') from public.teacher_catalogs where id=r.teacher_catalog_id),(select nullif(btrim(name),'') from public.profiles where id=r.teacher_profile_id),'선생님'),
  'approverLabel',coalesce((select nullif(btrim(name),'') from public.teacher_catalogs where id=r.approver_teacher_catalog_id),(select nullif(btrim(name),'') from public.profiles where id=r.approver_profile_id),'결재자'),
  'approvedByLabel',coalesce((select nullif(btrim(name),'') from public.profiles where id=r.approved_by),''),
  'completedByLabel',coalesce((select nullif(btrim(name),'') from public.profiles where id=r.completed_by),''),
  'canceledByLabel',coalesce((select nullif(btrim(name),'') from public.profiles where id=r.canceled_by),''),
  'reason','','returnedReason','','rejectedReason','','finalNote','',
  'events','[]'::jsonb,'schedulePlanBefore','{}'::jsonb,'schedulePlanAfter','{}'::jsonb,'makeupAcademicEventIds','[]'::jsonb,
  'makeupSlots',coalesce((select jsonb_agg(jsonb_build_object('startAt',s->'startAt','endAt',s->'endAt','classroom',s->'classroom') order by ord) from jsonb_array_elements(public.makeup_numbered_slots_v1(to_jsonb(r))) with ordinality a(s,ord)),'[]'::jsonb)
 ) dto
from public.makeup_requests r where r.id between pg_temp.mid(1) and pg_temp.mid(119);
grant select on teacher_common_fixture_rows to authenticated;
set local timezone='Asia/Seoul';
create function pg_temp.teacher_common_page_matches(actor_n integer,v text,p integer,size integer)
returns boolean language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare actual jsonb; expected_rows jsonb; expected_count bigint; expected_views jsonb; expected_subjects jsonb;
begin
 actual:=public.list_makeup_numbered_page_v1(pg_temp.filters(jsonb_build_object('view',v)),p,size);
 select count(*) into expected_count from pg_temp.teacher_common_fixture_rows where case v when 'mine' then status='revision_requested'
    when 'approvalPending' then status='approval_pending' when 'makeupPending' then status='makeup_pending'
    when 'refundPending' then status='refund_pending' when 'closed' then status in('completed','rejected','canceled') else false end;
 select coalesce(jsonb_agg(dto order by created_at desc,id desc),'[]'::jsonb) into expected_rows
 from (select dto,created_at,id from pg_temp.teacher_common_fixture_rows where case v when 'mine' then status='revision_requested'
    when 'approvalPending' then status='approval_pending' when 'makeupPending' then status='makeup_pending'
    when 'refundPending' then status='refund_pending' when 'closed' then status in('completed','rejected','canceled') else false end
       order by created_at desc,id desc limit size offset (p::bigint-1)*size) selected;
 select jsonb_build_object(
  'mine',count(*) filter(where status='revision_requested'),
  'approvalPending',count(*) filter(where status='approval_pending'),
  'makeupPending',count(*) filter(where status='makeup_pending'),
  'refundPending',count(*) filter(where status='refund_pending'),
  'closed',count(*) filter(where status in('completed','rejected','canceled')))
 into expected_views from pg_temp.teacher_common_fixture_rows;
 select jsonb_agg(jsonb_build_object('value',s,'label',s,'count',(
  select count(*) from pg_temp.teacher_common_fixture_rows where subject=s and (case v when 'mine' then status='revision_requested'
    when 'approvalPending' then status='approval_pending' when 'makeupPending' then status='makeup_pending'
    when 'refundPending' then status='refund_pending' when 'closed' then status in('completed','rejected','canceled') else false end))) order by ord)
 into expected_subjects from unnest(array['영어','수학','과학']) with ordinality subjects(s,ord);
 -- Every teacher reads the common revision queue, including non-participants.
 return auth.uid()=pg_temp.mid(actor_n) and public.current_dashboard_role()='teacher'
  and actual ?& array['page','pageSize','totalCount','viewCounts','subjectOptions','teacherOptions','rows']
  and actual-array['page','pageSize','totalCount','viewCounts','subjectOptions','teacherOptions','rows']='{}'::jsonb
  and actual->'page'=to_jsonb(p) and actual->'pageSize'=to_jsonb(size)
  and actual->'totalCount'=to_jsonb(expected_count) and actual->'viewCounts'=expected_views
  and actual->'subjectOptions'=expected_subjects and actual->'rows'=expected_rows
  and jsonb_typeof(actual->'teacherOptions')='array'
  and not exists(select 1 from jsonb_array_elements(actual->'teacherOptions') item
   where not item ?& array['value','label','count'] or item-array['value','label','count']<>'{}'::jsonb
    or jsonb_typeof(item->'value')<>'string' or jsonb_typeof(item->'label')<>'string'
    or jsonb_typeof(item->'count')<>'number' or item->>'label' like '%@%');
end $$;
reset role;select pg_temp.actor(801);set local role authenticated;
select ok(pg_temp.teacher_common_page_matches(801,v,p,size),'teacher common positive DTO and independent seed scope actor 801 view '||v||' page '||p||' size '||size) from unnest(array['mine','approvalPending','makeupPending','refundPending','closed'])v cross join unnest(array[1,2,12])p cross join unnest(array[10,15,20])size;
reset role;select pg_temp.actor(802);set local role authenticated;
select ok(pg_temp.teacher_common_page_matches(802,v,p,size),'teacher common positive DTO and independent seed scope actor 802 view '||v||' page '||p||' size '||size) from unnest(array['mine','approvalPending','makeupPending','refundPending','closed'])v cross join unnest(array[1,2,12])p cross join unnest(array[10,15,20])size;
reset role;select pg_temp.actor(804);set local role authenticated;
select ok(pg_temp.same_page(jsonb_build_object('view',v),p,size),'whole response parity actor 804 view '||v||' page '||p||' size '||size) from unnest(array['mine','approvalPending','makeupPending','refundPending','closed'])v cross join unnest(array[1,2,12])p cross join unnest(array[10,15,20])size;
reset role;select pg_temp.actor(805);set local role authenticated;
select ok(pg_temp.same_page(jsonb_build_object('view',v),p,size),'whole response parity actor 805 view '||v||' page '||p||' size '||size) from unnest(array['mine','approvalPending','makeupPending','refundPending','closed'])v cross join unnest(array[1,2,12])p cross join unnest(array[10,15,20])size;

reset role;select pg_temp.actor(806);set local role authenticated;
select ok(pg_temp.same_page(jsonb_build_object('view',v),p,size),'whole response parity actor 806 view '||v||' page '||p||' size '||size) from unnest(array['mine','approvalPending','makeupPending','refundPending','closed'])v cross join unnest(array[1,2,12])p cross join unnest(array[10,15,20])size;
reset role;select pg_temp.actor(804);set local role authenticated;
select ok(pg_temp.same_page(jsonb_build_object('sortColumn',c,'sortDirection',d),1,10),'display sort parity '||c||' '||d)
 from unnest(array['status','className','subject','teacher','requester','reason','cancelDate','makeupAt','makeupRoom','approver','submittedAt','revisionRequestedAt','approvedAt','rejectedAt','canceledAt','returnedReason','rejectedReason','finalNote','canceledNote'])c cross join unnest(array['asc','desc'])d;
select ok(pg_temp.same_page(jsonb_build_object('filterColumn',c,'search',q),1,10),'display search parity '||c||' '||q)
 from unnest(array['status','className','subject','teacher','requester','reason','cancelDate','makeupAt','makeupRoom','approver','submittedAt','revisionRequestedAt','approvedAt','rejectedAt','canceledAt','returnedReason','rejectedReason','finalNote','canceledNote'])c cross join unnest(array['1','-'])q;
select ok(pg_temp.same_page(patch,1,10),'filter parity '||patch::text) from (values
 ('{"subject":"수학"}'::jsonb),('{"teacher":"name:교사 801"}'::jsonb),
 (jsonb_build_object('teacher','id:'||pg_temp.mid(701))),
 ('{"period":"custom","dateFrom":"2026-09-01","dateTo":"2026-09-03"}'::jsonb),
 ('{"period":"today","dateFrom":"2026-08-31","dateTo":"2026-08-31"}'::jsonb),
 ('{"period":"week","dateFrom":"2026-08-31","dateTo":"2026-09-06"}'::jsonb),
 ('{"period":"month","dateFrom":"2026-08-01","dateTo":"2026-08-31"}'::jsonb),
 (jsonb_build_object('search',chr(9)||chr(160)||chr(65279)))) cases(patch);
select throws_ok($$select pg_temp.page('{"view":"closed","period":"custom","dateFrom":"2026-09-02"}')$$,'22023','makeup_legacy_slot_format_unsupported','legacy date compatibility error is retained');
select throws_ok($$select pg_temp.page('{"view":"closed","sortColumn":"makeupRoom","sortDirection":"asc"}')$$,'22023','makeup_legacy_slot_format_unsupported','legacy room sort compatibility error is retained');
select throws_ok($$select public.list_makeup_numbered_page_v1(pg_temp.filters(),0,10)$$,'22023','makeup_numbered_request_invalid','page validation is unchanged');
reset role;select pg_temp.actor(805);set local role authenticated;
select is((pg_temp.page()->>'totalCount')::integer,0,'assistant remains hard-denied including participant rows');
reset role;select pg_temp.actor(null);set local role authenticated;
select throws_ok($$select pg_temp.page()$$,'42501','makeup_auth_required','unresolved actor is rejected');
reset role;set local role anon;
select throws_ok($$select public.list_makeup_numbered_page_v1('{}',1,10)$$,'42501',null,'anonymous execution stays denied');
reset role;
select ok((select not p.prosecdef and p.provolatile='s' and 'search_path=""'=any(p.proconfig) and 'TimeZone=UTC'=any(p.proconfig) and has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('public',p.oid,'execute') from pg_proc p where p.oid='public.list_makeup_numbered_page_v1(jsonb,integer,integer)'::regprocedure),'reader remains stable invoker, pinned, authenticated-only');
-- A deterministic work regression: default browsing must not derive any display keys.
-- Searching/sorting/dates still require that work. No wall-clock threshold is asserted.
create temp table saved_makeup_key_function as select pg_get_functiondef('public.makeup_numbered_values_v1(jsonb,jsonb,jsonb)'::regprocedure) ddl;
create or replace function public.makeup_numbered_values_v1(r jsonb,latest jsonb,labels jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$begin raise exception 'display_keys_probe' using errcode='P0001';end$$;
select pg_temp.actor(804);set local role authenticated;
select lives_ok($$select pg_temp.page()$$,'default list does not derive unused keys');
select lives_ok($$select pg_temp.page('{"view":"closed"}')$$,'closed list does not derive unused keys');
select lives_ok($$select pg_temp.page('{"subject":"수학"}')$$,'subject-only filter does not derive keys');
select lives_ok($$select pg_temp.page(jsonb_build_object('teacher','id:'||pg_temp.mid(701)))$$,'teacher-only filter does not derive keys');
select lives_ok($$select pg_temp.page(jsonb_build_object('search',chr(9)||chr(160)||chr(65279)))$$,'ECMAScript-whitespace-only search does not derive keys');
select throws_ok($$select pg_temp.original_makeup_list(pg_temp.filters(),1,10)$$,'P0001','display_keys_probe','frozen original demonstrates the unnecessary work');
select throws_ok($$select pg_temp.page('{"search":"1"}')$$,'P0001','display_keys_probe','real search retains key derivation');
select throws_ok($$select pg_temp.page('{"sortColumn":"className","sortDirection":"asc"}')$$,'P0001','display_keys_probe','explicit sort retains key derivation');
select throws_ok($$select pg_temp.page('{"period":"custom","dateFrom":"2026-08-01"}')$$,'P0001','display_keys_probe','date filtering retains key derivation');
reset role;
do $$begin execute (select ddl from saved_makeup_key_function);end$$;
-- Only selected-row details need legacy-slot detection on the default path.
create temp table expected_makeup_page as select pg_temp.page() value;
create temp table saved_makeup_legacy_function as select pg_get_functiondef('public.makeup_numbered_legacy_slots_v1(jsonb)'::regprocedure) ddl;
do $$begin execute replace((select ddl from saved_makeup_legacy_function),'public.makeup_numbered_legacy_slots_v1','pg_temp.original_makeup_legacy_slots');end$$;
grant select on expected_makeup_page to authenticated;
create or replace function public.makeup_numbered_legacy_slots_v1(r jsonb) returns boolean language plpgsql stable security invoker set search_path='' as $$begin
 if not exists(select 1 from pg_temp.expected_makeup_page p cross join jsonb_array_elements(p.value->'rows') row_value where row_value->>'id'=r->>'id') then
  raise exception 'unselected_legacy_scan' using errcode='P0001';
 end if;
 return pg_temp.original_makeup_legacy_slots(r);
end$$;
set local role authenticated;
select lives_ok($$select pg_temp.page()$$,'default read performs no off-page legacy-format scan');
select is(pg_temp.page(),(select value from expected_makeup_page),'default result retains selected-row legacy metadata');
reset role;
do $$begin execute (select ddl from saved_makeup_legacy_function);end$$;
select is((select count(*) from dashboard_private.notification_events),(select events from read_before),'reads create no notification events');
select is((select count(*) from dashboard_private.notification_event_fanout_jobs),(select jobs from read_before),'reads create no fanout jobs');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from read_before),'reads create no provider deliveries');
select is((select count(*) from public.makeup_request_events),(select request_events from read_before),'reads create no request events');
select * from finish();
rollback;
