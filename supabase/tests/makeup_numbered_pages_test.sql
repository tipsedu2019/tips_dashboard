begin;
select no_plan();
select has_function('public','list_makeup_numbered_page_v1',array['jsonb','integer','integer'],'makeup numbered API exists');
select has_function('public','get_makeup_detail_v1',array['uuid'],'independent makeup detail exists');
select has_function('public','get_makeup_reservation_context_v1',array['jsonb','uuid[]'],'independent complete reservation context exists');
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
select pg_temp.mid(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','makeup-numbered-'||n||'@test.invalid',crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now() from generate_series(801,805)n;
insert into public.profiles(id,role,name,email,created_at,updated_at)
select pg_temp.mid(n),case when n=804 then 'admin' when n=805 then 'assistant' else 'teacher' end,'교사 '||n,'makeup-numbered-'||n||'@test.invalid',now(),now() from generate_series(801,805)n
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
select is(pg_temp.page()->'viewCounts','{"mine":1,"approvalPending":112,"makeupPending":1,"refundPending":1,"closed":3}'::jsonb,'manager counts ignore all table filters; admin is approver on revision113 so mine1');
select is(pg_temp.page()#>>'{rows,0,id}',pg_temp.mid(106)::text,'default ordering preserves createdAtDESC before deterministic idDESC tie');
select is(pg_temp.page('{}',11)#>>'{rows,0,id}',pg_temp.mid(12)::text,'direct page11 unique descending ID order');
select is(jsonb_array_length(pg_temp.page('{}',12)->'rows'),2,'partial final page');
select is(jsonb_array_length(pg_temp.page('{}',13)->'rows'),0,'empty out-of-range preserves authoritative count');
select is((pg_temp.page('{}',13)->>'totalCount')::integer,112,'out-of-range total112');
select is((select count(distinct r->>'id')::integer from generate_series(1,12)p cross join lateral jsonb_array_elements(pg_temp.page('{}',p)->'rows')r),112,'all numbered pages no omissions/duplicates');
select is(jsonb_array_length(public.list_makeup_numbered_page_v1(pg_temp.filters(),1,15)->'rows'),15,'size15');
select is(jsonb_array_length(public.list_makeup_numbered_page_v1(pg_temp.filters(),1,20)->'rows'),20,'size20');
select is(pg_temp.page('{"sortColumn":"className","sortDirection":"asc"}')#>>'{rows,1,className}','수업 2','Korean numeric2 before10');
select is(pg_temp.page('{"sortColumn":"revisionRequestedAt","sortDirection":"desc"}')#>>'{rows,0,id}',pg_temp.mid(1)::text,'off-page event participates before page selection');
select is((pg_temp.page('{"filterColumn":"finalNote","search":"높은 ID"}')->>'totalCount')::integer,1,'equal timestamp greatest event ID note wins full-filter selection');
select is(public.get_makeup_detail_v1(pg_temp.mid(1))#>>'{events,0,id}',pg_temp.mid(503)::text,'full event history deterministic idDESC');
select is(jsonb_array_length(public.get_makeup_detail_v1(pg_temp.mid(1))->'events'),3,'off-page detail full history');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.page()->'rows')r cross join lateral jsonb_array_elements(r->'events')e),0,'only selected-page histories enriched');
select is(public.get_makeup_detail_v1(pg_temp.mid(7))#>>'{events,0,id}',pg_temp.mid(509)::text,'equal-time combined cancellation kinds use greatest ID');
select is((pg_temp.page('{"subject":"영어","teacher":"name:교사 801","period":"custom","dateFrom":"2026-09-02","dateTo":"2026-09-02","filterColumn":"makeupRoom","search":"B"}')->>'totalCount')::integer,1,'combined view subject teacher period end-slot date and selected-column text');
select is((pg_temp.page('{"period":"custom","dateFrom":"2026-08-01","dateTo":"2026-08-01"}')->>'totalCount')::integer,112,'period cancel date matching');
select is((pg_temp.page('{"period":"custom","dateFrom":"2026-09-03","dateTo":""}')->>'totalCount')::integer,1,'custom open boundary plus date/time fallback slot');
select is((pg_temp.page('{"filterColumn":"makeupAt","search":"2026-09-01 09:00 - 2026-09-02 10:00"}')->>'totalCount')::integer,1,'source offset timestamp display preserves full endpoints');
select is((pg_temp.page('{"filterColumn":"approvedAt","search":"2026-07-01 03:00"}')->>'totalCount')::integer,1,'stored approvedAt preferred over latest event');
select is((pg_temp.page('{"filterColumn":"canceledAt","search":"2026-07-02 04:00"}')->>'totalCount')::integer,1,'stored canceledAt preferred over latest cancellation');
select is((pg_temp.page('{"filterColumn":"finalNote","search":"시스템"}')->>'totalCount')::integer,0,'system approval notes suppressed');
select is((pg_temp.page('{"filterColumn":"finalNote","search":"같은 메모"}')->>'totalCount')::integer,0,'matching cancellation notes suppressed');
select diag('system-note whitespace mismatches='||(select jsonb_agg(codepoint)::text from unnest(array[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279])codepoint where public.makeup_numbered_values_v1(jsonb_build_object('final_note','보강'||chr(codepoint)||'2026-08-31'||chr(codepoint)||'09:00-10:00'),'{}','{}')->>'finalNote'<>'-'));
select ok((select bool_and(public.makeup_numbered_values_v1(jsonb_build_object('final_note','보강'||chr(codepoint)||'2026-08-31'||chr(codepoint)||'09:00-10:00'),'{}','{}')->>'finalNote'='-') from unnest(array[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279])codepoint),'system-note suppression matches all25 JavaScript whitespace characters');
select is(public.makeup_numbered_values_v1(jsonb_build_object('final_note','보강'||chr(133)||'2026-08-31'||chr(133)||'09:00-10:00'),'{}','{}')->>'finalNote','보강'||chr(133)||'2026-08-31'||chr(133)||'09:00-10:00','system-note suppression excludes U0085 just like JavaScript');
select is((pg_temp.page('{"filterColumn":"finalNote","search":"공백시스템"}')->>'totalCount')::integer,0,'full-filter finalNote search suppresses NBSP FEFF system note before paging');
select is((pg_temp.page('{"filterColumn":"finalNote","search":"공백일반"}')->>'totalCount')::integer,1,'full-filter finalNote search retains U0085 ordinary note');
select is(public.makeup_numbered_values_v1(jsonb_build_object('final_note',note),'{}','{}')->>'finalNote',note,'system-note pattern retains non-ASCII digits just like JavaScript') from (values ('보강 ٢٠٢٦-08-31 09:00-10:00 일반'),('보강 2026-08-31 ٠٩:00-10:00 일반')) samples(note);
select is(public.get_makeup_detail_v1(pg_temp.mid(4))->>'reason','검색'||chr(133)||'  내부','JS trim NBSP FEFF while U0085/internal spaces retained');
select is(public.makeup_numbered_slots_v1('{"makeup_slots":[{"date":"2026-09-01T16:00:00Z","startTime":"9:00","endTime":"10:00"},{"date":"2026-09-01 16:00:00","startTime":"9:00","endTime":"10:00"}]}')#>>'{0,startAt}','2026-09-02T09:00:00+09:00','date+time fallback converts canonical offset date into Seoul day');
select is(public.makeup_numbered_slots_v1('{"makeup_slots":[{"date":"2026-09-01 16:00:00","startTime":"9:00","endTime":"10:00"}]}')#>>'{0,startAt}','2026-09-01T09:00:00+09:00','date+time fallback interprets explicit zoneless day as Seoul');
select is(pg_temp.page('{"subject":"수학","search":"missing"}')->'viewCounts',pg_temp.page()->'viewCounts','view counts ignore table filters');
select is(pg_temp.page('{"subject":"수학","search":"missing"}')#>>'{subjectOptions,0,count}','111','subject facet current view ignoring subject/search');
select is((select item->>'count' from jsonb_array_elements(pg_temp.page('{"subject":"수학","search":"missing"}')->'teacherOptions')item where item->>'value'='name:교사 801'),'1','teacher request facet current view plus selected subject ignoring search');
select is((select jsonb_agg(o->>'label' order by ord) from jsonb_array_elements(pg_temp.page('{"subject":"영어","search":"missing"}')->'teacherOptions')with ordinality t(o,ord) where o->>'value' in('id:'||pg_temp.mid(701),'id:'||pg_temp.mid(702))),'["교사 2","교사 10"]'::jsonb,'visible catalog relative Korean numeric order preserves signup-created catalogs too');
select is((select o->>'count' from jsonb_array_elements(pg_temp.page('{"subject":"영어"}')->'teacherOptions')o where o->>'value'='id:'||pg_temp.mid(701)),'0','catalog-first option keeps zero despite matching request');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.page('{"subject":"영어"}')->'teacherOptions')o where o->>'label' in('U0085 제외','숨김 교사','수학 전용')),'teacher subject normalization excludes U0085 hidden and other subject');
select is((pg_temp.page(jsonb_build_object('teacher','id:'||pg_temp.mid(701)))->>'totalCount')::integer,1,'catalog ID teacher filter exact');
select is((pg_temp.page('{"filterColumn":"makeupAt","search":"invalid - also invalid"}')->>'totalCount')::integer,1,'malformed raw source remains display searchable');
-- Match the pinned UTC RPC wire representation while probing its pure helper.
set local timezone='UTC';
select is(public.makeup_numbered_values_v1(to_jsonb(r),'{}','{"teacher":"교사 801","requester":"교사 801","approver":"교사 804"}')-'dates',
 '{"status":"결재자 승인 대기","className":"수업 10","subject":"영어","teacher":"교사 801","requester":"교사 801","reason":"사유 10","cancelDate":"2026-08-01","makeupAt":"2026-08-31 00:00 - 2026-08-31 01:00","makeupRoom":"A","approver":"교사 804","submittedAt":"2026-08-01 00:00","revisionRequestedAt":"-","approvedAt":"-","rejectedAt":"-","canceledAt":"-","returnedReason":"-","rejectedReason":"-","finalNote":"-","canceledNote":"-"}'::jsonb,'all nineteen table display keys match raw UI strings and dash fallbacks') from public.makeup_requests r where r.id=pg_temp.mid(10);
select ok((pg_temp.page(jsonb_build_object('filterColumn',column_name,'search',search_text,'sortColumn',column_name,'sortDirection','asc'))->>'totalCount')::integer>0,'full-scope search and sort column '||column_name)
from (values ('status','결재자 승인 대기'),('className','수업 10'),('subject','수학'),('teacher','교사 2'),('requester','교사 805'),('reason','검색'),('cancelDate','2026-08-01'),('makeupAt','2026-09-01 09:00'),('makeupRoom','B'),('approver','교사 803'),('submittedAt','2026-08-01 00:00'),('revisionRequestedAt','2026-08-29 01:00'),('approvedAt','2026-07-01 03:00'),('rejectedAt','-'),('canceledAt','2026-07-02 04:00'),('returnedReason','-'),('rejectedReason','-'),('finalNote','높은 ID'),('canceledNote','취소 메모')) cases(column_name,search_text);
set local timezone='Asia/Seoul';
select is((pg_temp.page('{"view":"makeupPending"}')->>'totalCount')::integer,1,'makeupPending exact status');
select is((pg_temp.page('{"view":"refundPending"}')->>'totalCount')::integer,1,'refundPending exact status');
select is((pg_temp.page('{"view":"closed"}')->>'totalCount')::integer,3,'closed all3 terminal statuses');
select is(jsonb_array_length(public.get_makeup_reservation_context_v1('[{"startAt":"2026-08-31T00:00:00Z","endAt":"2026-08-31T01:00:00Z"}]',array[pg_temp.mid(119)])->'reservations'),112,'complete all-room context includes off-page active reservations');
select ok(exists(select 1 from jsonb_array_elements(public.get_makeup_reservation_context_v1('[{"startAt":"2026-08-31T00:00:00Z","endAt":"2026-08-31T01:00:00Z"}]',array[pg_temp.mid(119)])->'reservations')r where r->>'id'=pg_temp.mid(2)::text and r->>'makeupClassroom'='B'),'page1 target context includes page11 conflicting different-room evidence');
select is(public.get_makeup_reservation_context_v1('[]',array[pg_temp.mid(119),pg_temp.mid(118)])->'activeEventRequestIds',jsonb_build_array(pg_temp.mid(119)),'independent active tagged ID even with no overlapping reservation slots; orphan canceled excluded');
select is((select jsonb_agg(r->>'id' order by r->>'id') from jsonb_array_elements(public.get_makeup_reservation_context_v1('[{"startAt":"2026-08-31T01:00:00Z","endAt":"2026-08-31T02:00:00Z"}]','{}')->'reservations')r),jsonb_build_array(pg_temp.mid(106),pg_temp.mid(107),pg_temp.mid(108),pg_temp.mid(116)),'canonical adjacent rows excluded, every ambiguous source including unknown date-only fallback retained');
select is((select r#>>'{makeupSlots,0,startAt}' from jsonb_array_elements(public.get_makeup_reservation_context_v1('[{"startAt":"2026-08-31T01:00:00Z","endAt":"2026-08-31T02:00:00Z"}]','{}')->'reservations')r where r->>'id'=pg_temp.mid(106)::text),'2026-08-31T09:00:00','offsetless source preserved raw, not cast to instant');
select ok((select bool_and((select count(*) from jsonb_object_keys(r))=case when r->>'id'=pg_temp.mid(116)::text then 8 else 7 end and not(r ?| array['events','profiles','reason','finalNote'])) from jsonb_array_elements(public.get_makeup_reservation_context_v1('[{"startAt":"2026-08-31T00:00:00Z","endAt":"2026-08-31T01:00:00Z"}]','{}')->'reservations')r),'collision wire seven fields plus private raw slots only for ambiguous date fallback; no histories/profiles');
select is(public.get_makeup_detail_v1(pg_temp.mid(116))->'rawMakeupSlots',(select makeup_slots from public.makeup_requests where id=pg_temp.mid(116)),'direct detail preserves entire ordered raw legacy JSON-array string');
select ok((pg_temp.page('{"view":"closed","filterColumn":"className","search":"수업 116"}')#>'{rows,0}') ? 'rawMakeupSlots','unrelated list search remains available with private raw envelope');
select throws_ok($$select pg_temp.page('{"view":"closed","period":"custom","dateFrom":"2026-09-02"}')$$,'22023','makeup_legacy_slot_format_unsupported','ambiguous date fallback affected period has named compatibility SQLSTATE');
select throws_ok($$select pg_temp.page('{"view":"closed","filterColumn":"makeupAt","search":"2026"}')$$,'22023','makeup_legacy_slot_format_unsupported','ambiguous date fallback affected slot search has named compatibility SQLSTATE');
select throws_ok($$select pg_temp.page('{"view":"closed","sortColumn":"makeupRoom","sortDirection":"asc"}')$$,'22023','makeup_legacy_slot_format_unsupported','ambiguous date fallback affected room sort has named compatibility SQLSTATE');
select is((pg_temp.page('{"view":"closed","subject":"수학","period":"custom","dateFrom":"2026-09-02"}')->>'totalCount')::integer,0,'unrelated subject scope does not inherit compatibility failure');
select is((pg_temp.page(jsonb_build_object('view','closed','teacher','id:'||pg_temp.mid(701),'period','custom','dateFrom','2026-09-02'))->>'totalCount')::integer,0,'unrelated teacher scope does not inherit compatibility failure');
select throws_ok($$select public.list_makeup_numbered_page_v1(pg_temp.filters(),0,10)$$,'22023',null,'page0 SQLSTATE22023');
select throws_ok($$select public.list_makeup_numbered_page_v1(pg_temp.filters(),1,5)$$,'22023',null,'size5 SQLSTATE22023');
select throws_ok($$select public.list_makeup_numbered_page_v1(pg_temp.filters(),1,30)$$,'22023',null,'size30 SQLSTATE22023');
select throws_ok($$select pg_temp.page('{"filterColumn":"action"}')$$,'22023',null,'action not interactive filter');
select throws_ok($$select pg_temp.page('{"role":"admin"}')$$,'22023',null,'client authority override rejected');
select throws_ok($$select pg_temp.page('{"period":"today"}')$$,'22023',null,'preset bounds required');
select throws_ok($$select pg_temp.page('{"period":"custom","dateFrom":"2026-02-30"}')$$,'22023',null,'invalid actual date SQLSTATE22023');
select throws_ok($$select pg_temp.page('{"period":"custom","dateFrom":"2026-09-01","dateTo":"2026-08-01"}')$$,'22023',null,'reversed date SQLSTATE22023');
select throws_ok($$select public.get_makeup_detail_v1(null)$$,'22023',null,'null detail ID invalid');
select throws_ok($$select public.get_makeup_reservation_context_v1('[{"startAt":"bad","endAt":"also bad"}]','{}')$$,'22023',null,'invalid context timestamp SQLSTATE22023');
reset role;select pg_temp.actor(801);set local role authenticated;
select is((pg_temp.page()->>'totalCount')::integer,111,'teacher only involved rows');
select is((pg_temp.page('{"view":"mine"}')->>'totalCount')::integer,1,'mine only own involved revision');
select is(public.get_makeup_detail_v1(pg_temp.mid(112)),null::jsonb,'off-page unrelated detail cannot bypass RLS');
select is(public.get_makeup_reservation_context_v1('[]',array[pg_temp.mid(112),pg_temp.mid(119)])->'activeEventRequestIds',jsonb_build_array(pg_temp.mid(119)),'active IDs enforce teacher RLS independently');
reset role;select pg_temp.actor(802);set local role authenticated;
select is((pg_temp.page('{"view":"closed","period":"custom","dateFrom":"2026-09-02"}')->>'totalCount')::integer,0,'unrelated authenticated actor cannot observe private compatibility error');
select ok(not exists(select 1 from jsonb_array_elements(public.get_makeup_reservation_context_v1('[{"startAt":"2026-09-02T00:00:00Z","endAt":"2026-09-02T01:00:00Z"}]','{}')->'reservations')r where r->>'id'=pg_temp.mid(116)::text),'unknown-date conservative candidate remains RLS-authorized');
reset role;select pg_temp.actor(805);set local role authenticated;
select is((pg_temp.page()->>'totalCount')::integer,0,'real assistant restrictive deny');
select is(public.get_makeup_detail_v1(pg_temp.mid(1)),null::jsonb,'assistant detail denied');
select is(public.get_makeup_detail_v1(pg_temp.mid(112)),null::jsonb,'assistant participant detail still hard-denied');
select is(public.get_makeup_reservation_context_v1('[{"startAt":"2026-08-31T00:00:00Z","endAt":"2026-08-31T01:00:00Z"}]',array[pg_temp.mid(119)]),'{"reservations":[],"activeEventRequestIds":[]}'::jsonb,'assistant context both projections empty');
reset role;select pg_temp.actor(null);set local role authenticated;
select throws_ok($$select pg_temp.page()$$,'42501',null,'no resolved UID denied');
reset role;set local role anon;
select throws_ok($$select public.list_makeup_numbered_page_v1('{}',1,10)$$,'42501',null,'anonymous execution denied');
select throws_ok($$select public.get_makeup_detail_v1(null)$$,'42501',null,'anonymous detail denied');
select throws_ok($$select public.get_makeup_reservation_context_v1('[]','{}')$$,'42501',null,'anonymous context denied');
reset role;
select is((select count(*) from dashboard_private.notification_events),(select events from read_before),'reads no notification events');
select is((select count(*) from dashboard_private.notification_event_fanout_jobs),(select jobs from read_before),'reads no jobs');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from read_before),'reads no deliveries');
select is((select count(*) from public.makeup_request_events),(select request_events from read_before),'reads no request events');
select * from finish();
rollback;
