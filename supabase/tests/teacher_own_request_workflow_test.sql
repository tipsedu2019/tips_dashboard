begin;
select no_plan();
set local timezone='Asia/Seoul';
set local statement_timeout='30s';
set local lock_timeout='5s';

create function pg_temp.own_id(n integer) returns uuid language sql immutable as $$
 select ('e7270000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.own_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.own_id(n)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.own_id(n),'role','authenticated')::text,true);
end $$;
insert into auth.users(id,instance_id,aud,role,email)
select pg_temp.own_id(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','own-request-'||n||'@synthetic.invalid' from generate_series(1,6)n;
insert into public.profiles(id,role,name,email)
select pg_temp.own_id(n),case n when 1 then 'admin' when 2 then 'staff' when 3 then 'teacher' when 4 then 'teacher' when 5 then 'assistant' else 'viewer' end,
 '가상 신청 사용자 '||n,'PRIVATE_ACCOUNT_CANARY'||n||'@synthetic.invalid' from generate_series(1,6)n
on conflict(id) do update set role=excluded.role,name=excluded.name,email=excluded.email;
delete from public.teacher_catalogs where profile_id in(select pg_temp.own_id(n) from generate_series(1,6)n);
-- The resolver's configured name is used only as a synthetic lookup fixture.
insert into public.teacher_catalogs(id,name,subjects,profile_id,is_visible) values
(pg_temp.own_id(10),'강정은',array['수학'],pg_temp.own_id(1),true),
(pg_temp.own_id(11),'가상 담당 강사',array['수학'],pg_temp.own_id(4),true);
insert into public.classroom_catalogs(id,name,subjects) values(pg_temp.own_id(12),'가상 신청 강의실',array['수학']);
insert into public.classes(id,name,subject,grade,teacher,room,status,schedule_storage_mode,schedule_plan,student_ids)
values(pg_temp.own_id(20),'가상 출발반','수학','중3','가상 담당 강사','가상 신청 강의실','개강 준비','legacy','{}',jsonb_build_array(pg_temp.own_id(30))),
(pg_temp.own_id(21),'가상 목적반','수학','중3','가상 담당 강사','가상 신청 강의실','개강 준비','legacy','{}','[]'),
(pg_temp.own_id(22),'가상 정규 회차반','수학','중3','가상 담당 강사','가상 신청 강의실','개강 준비','normalized','{}','[]');
insert into public.students(id,name,grade,class_ids,contact,parent_contact)
values(pg_temp.own_id(30),'가상 신청 학생','중3',jsonb_build_array(pg_temp.own_id(20)),'PRIVATE_CONTACT_CANARY','PRIVATE_PARENT_CANARY');
-- Disposable postgres fixture only: exercise each canonical relationship
-- source independently, including tolerated one-sided legacy projections.
-- This is not an assertion that teachers may mutate rosters or registrations.
insert into public.students(id,name,grade,class_ids,waitlist_class_ids,contact,parent_contact) values
(pg_temp.own_id(40),'가상 직접 재원','중3',jsonb_build_array(pg_temp.own_id(20)),'[]','PRIVATE_40','PRIVATE_PARENT_40'),
(pg_temp.own_id(41),'가상 직접 대기','중3','[]',jsonb_build_array(pg_temp.own_id(20)),'PRIVATE_41','PRIVATE_PARENT_41'),
(pg_temp.own_id(42),'가상 수업 재원','중3','[]','[]','PRIVATE_42','PRIVATE_PARENT_42'),
(pg_temp.own_id(43),'가상 수업 대기','중3','[]','[]','PRIVATE_43','PRIVATE_PARENT_43'),
(pg_temp.own_id(44),'가상 등록 대기','중3','[]','[]','PRIVATE_44','PRIVATE_PARENT_44'),
(pg_temp.own_id(45),'OTHER_CLASS_CANARY','중3',jsonb_build_array(pg_temp.own_id(21)),'[]','PRIVATE_45','PRIVATE_PARENT_45'),
(pg_temp.own_id(46),'가상 중복 재원 우선','중3',jsonb_build_array(pg_temp.own_id(20)),jsonb_build_array(pg_temp.own_id(20)),'PRIVATE_46','PRIVATE_PARENT_46'),
(pg_temp.own_id(47),'UNRELATED_CANARY','중3','[]','[]','PRIVATE_47','PRIVATE_PARENT_47'),
(pg_temp.own_id(48),'PLANNED_CANARY','중3','[]','[]','PRIVATE_48','PRIVATE_PARENT_48'),
(pg_temp.own_id(49),'CANCELED_CANARY','중3','[]','[]','PRIVATE_49','PRIVATE_PARENT_49');
update public.classes set student_ids=student_ids||jsonb_build_array(pg_temp.own_id(42),pg_temp.own_id(46)),
 waitlist_ids=jsonb_build_array(pg_temp.own_id(43),pg_temp.own_id(46)) where id=pg_temp.own_id(20);
select pg_temp.own_actor(1);
insert into public.ops_tasks(id,title,type,requested_by)
select pg_temp.own_id(860+n),'가상 소속 참조 등록 '||n,'registration',pg_temp.own_id(1) from generate_series(1,4)n;
insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status)
select pg_temp.own_id(870+n),pg_temp.own_id(860+n),'수학','inquiry' from generate_series(1,4)n;
insert into public.ops_registration_enrollments(id,track_id,class_id,student_id,status,roster_active) values
(pg_temp.own_id(881),pg_temp.own_id(871),pg_temp.own_id(20),pg_temp.own_id(44),'waitlisted',true),
(pg_temp.own_id(882),pg_temp.own_id(872),pg_temp.own_id(20),null,'planned',false),
(pg_temp.own_id(883),pg_temp.own_id(873),pg_temp.own_id(20),pg_temp.own_id(49),'canceled',false);

select set_config('app.class_schedule_mutation','release2-rpc',true);
insert into public.class_lesson_sessions(id,class_id,session_key,session_date,schedule_state,start_time,end_time,teacher_catalog_id,classroom_catalog_id,origin)
values(pg_temp.own_id(31),pg_temp.own_id(22),'2026-11-02:1','2026-11-02','active','19:00','19:30',pg_temp.own_id(11),pg_temp.own_id(12),'manual'),
(pg_temp.own_id(32),pg_temp.own_id(22),'2026-11-02:2','2026-11-02','active','20:00','20:30',pg_temp.own_id(11),pg_temp.own_id(12),'manual');
select set_config('app.class_schedule_mutation','',true);
insert into public.students(id,name,grade,class_ids,waitlist_class_ids,contact,parent_contact)
values(pg_temp.own_id(50),'가상 등록원장 재원','중3','[]','[]','PRIVATE_50','PRIVATE_PARENT_50');
insert into public.ops_registration_admission_batches(id,task_id,revision_number,status)
values(pg_temp.own_id(884),pg_temp.own_id(864),1,'draft');
insert into public.ops_registration_enrollments(id,track_id,class_id,student_id,status,roster_active,admission_batch_id,class_start_date,class_start_session_key,class_start_session,class_start_lesson_session_id)
values(pg_temp.own_id(885),pg_temp.own_id(874),pg_temp.own_id(22),pg_temp.own_id(50),'enrolled',true,pg_temp.own_id(884),'2026-11-02','2026-11-02:1','수업',pg_temp.own_id(31));

create temp table own_results(name text primary key,domain text,input jsonb,payload jsonb,request_key uuid);
grant all on own_results to authenticated;
insert into own_results(name,domain,input,request_key) values
('transfer','transfer',jsonb_build_object('student_id',pg_temp.own_id(30),'memo','원문 메모','from_class_id',pg_temp.own_id(20),'to_class_id',pg_temp.own_id(21),
 'transfer_reason','가상 전반 사유','from_class_end_date','2026-11-02','from_class_end_session','1','to_class_start_date','2026-11-04','to_class_start_session','1','from_undistributed_textbooks','없음','to_undistributed_textbooks','가상 교재'),pg_temp.own_id(101)),
('withdrawal','withdrawal',jsonb_build_object('student_id',pg_temp.own_id(30),'memo','퇴원 원문','class_id',pg_temp.own_id(20),'withdrawal_date','2026-11-02','withdrawal_session','1',
 'customer_reason','가상 사유','teacher_opinion','가상 의견','undistributed_textbooks','없음'),pg_temp.own_id(102)),
('makeup','makeup',jsonb_build_object('request_kind','makeup_only','class_id',pg_temp.own_id(20),'reason','가상 보강 사유','cancel_date',null,'original_lesson_session_id',null,
 'makeup_slots',jsonb_build_array(jsonb_build_object('startAt','2026-11-05T19:00:00+09:00','endAt','2026-11-05T20:00:00+09:00','classroom','가상 신청 강의실'))),pg_temp.own_id(103)),
('textbook','textbook','{"title":"가상 요청 교재","textbookId":null,"classId":null,"locationId":null,"studentQuantity":2,"teacherQuantity":1,"memo":"교재 원문"}',pg_temp.own_id(104)),
('normalized','makeup',jsonb_build_object('request_kind','cancel_only','class_id',pg_temp.own_id(22),'reason','가상 휴강 사유','cancel_date','2026-11-02','original_lesson_session_id',pg_temp.own_id(31),'makeup_slots','[]'::jsonb),pg_temp.own_id(105));
create function pg_temp.own_create(n text) returns void language plpgsql as $$declare x record;begin
 select * into x from own_results where name=n;
 update own_results set payload=public.mutate_teacher_own_request_v1(x.domain,null,'create',x.input,null,x.request_key) where name=n;
end $$;
create function pg_temp.own_current(n text) returns jsonb language sql as $$
 select public.get_teacher_own_request_v1(domain,(payload->>'id')::uuid) from own_results where name=n $$;
create function pg_temp.own_mutate(n text,act text,patch jsonb,key_number integer) returns jsonb language plpgsql as $$declare x record;result jsonb;begin
 select * into x from own_results where name=n;
 result:=public.mutate_teacher_own_request_v1(x.domain,(x.payload->>'id')::uuid,act,patch,x.payload->>'revision',pg_temp.own_id(key_number));
 update own_results set payload=result where name=n;return result;
end $$;
create temp table own_effects_before as select
 (select count(*) from public.class_lesson_sessions) sessions,
 (select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.students s) students,
 (select count(*) from dashboard_private.notification_deliveries) deliveries,
 (select count(*) from public.textbook_stock_moves) stock;

select pg_temp.own_actor(3);set local role authenticated;
select lives_ok($q$select pg_temp.own_create('transfer')$q$,'teacher creates own transfer through dedicated boundary');
select lives_ok($q$select pg_temp.own_create('withdrawal')$q$,'teacher creates own withdrawal without processing it');
select lives_ok($q$select pg_temp.own_create('makeup')$q$,'requester differs from responsible teacher and uses existing designated approver');
select lives_ok($q$select pg_temp.own_create('textbook')$q$,'textbook create reuses exact existing seven-field submission');
select lives_ok($q$select pg_temp.own_create('normalized')$q$,'normalized selected session is part of the full request identity');
select is((pg_temp.own_current('transfer')->>'requesterId'),pg_temp.own_id(3)::text,'request owner is current UUID');
select is(pg_temp.own_current('makeup')#>>'{approver,profileId}',pg_temp.own_id(1)::text,'approver is existing server resolver UUID');
select is(pg_temp.own_current('transfer')#>>'{input,memo}','원문 메모','own detail returns full request memo');
select ok(pg_temp.own_current('textbook')->'allowedActions' ?& array['update','withdraw'],'new untouched request permits edit and withdrawal');
select is((public.get_teacher_own_requests_v1('transfer',1,10)->>'totalCount')::integer,1,'own list has exact domain count');
select ok(public.get_teacher_request_references_v1('transfer')::text not like '%PRIVATE_%','safe references exclude contact and account fields');
select is(jsonb_array_length(public.get_teacher_request_references_v1('makeup',pg_temp.own_id(22),'2026-11')->'students'),0,'makeup references do not collect students');
select is(jsonb_array_length(public.get_teacher_request_references_v1('makeup',pg_temp.own_id(22),'2026-11')->'sessions'),2,'reference sessions are the selected month');
select is(jsonb_array_length(public.get_teacher_request_references_v1('makeup',pg_temp.own_id(22),'2026-12')->'sessions'),0,'reference sessions never spill into another month');
select is(pg_temp.own_current('transfer')#>>'{referenceLabels,student}','가상 신청 학생','safe selected labels do not depend on a first option page');
select lives_ok($q$select pg_temp.own_create('transfer')$q$,'exact create replay succeeds without another effect');
select is(jsonb_array_length(pg_temp.own_current('transfer')->'history'),1,'exact create replay does not append history');
select throws_ok($q$select public.mutate_teacher_own_request_v1('makeup',null,'create',(select input||jsonb_build_object('original_lesson_session_id',pg_temp.own_id(32)) from own_results where name='normalized'),null,pg_temp.own_id(105))$q$,'22023','idempotency_key_reused','same request key cannot change normalized original session');
select throws_ok($q$select public.mutate_teacher_own_request_v1('transfer',null,'create',(select input||'{"requested_by":"e7270000-0000-4000-8000-000000000004"}' from own_results where name='transfer'),null,pg_temp.own_id(106))$q$,'22023','teacher_request_input_invalid','owner field injection rejected');
select throws_ok($q$select public.mutate_teacher_own_request_v1('withdrawal',null,'create',(select input||'{"fee_processed":true}' from own_results where name='withdrawal'),null,pg_temp.own_id(107))$q$,'22023','teacher_request_input_invalid','management checklist injection rejected');
select throws_ok($q$select public.mutate_teacher_own_request_v1('makeup',null,'create',(select input||jsonb_build_object('approver_profile_id',pg_temp.own_id(4)) from own_results where name='makeup'),null,pg_temp.own_id(108))$q$,'22023','teacher_request_input_invalid','teacher cannot select a new approver');
select throws_ok($q$select public.create_ops_task_v2('{"type":"transfer","title":"guard remains"}',pg_temp.own_id(109))$q$,'42501','ops_task_access_denied','general transfer create remains closed');
select throws_ok($q$select public.transition_makeup_request_v2((select(payload->>'id')::uuid from own_results where name='makeup'),'approve','{}','approval_pending',pg_temp.own_id(110))$q$,'42501','makeup_approval_server_required','teacher cannot bypass server approval RPC');
select throws_ok($q$select public.get_teacher_request_changes_v1('makeup')$q$,'42501','teacher_request_forbidden','teacher has no manager inbox');
select throws_ok($q$insert into dashboard_private.teacher_request_context_v1 values(txid_current(),pg_backend_pid(),pg_temp.own_id(3),'transfer',pg_temp.own_id(999),'update')$q$,'42501',null,'caller cannot manufacture the nested transaction marker');
select throws_ok($q$select dashboard_private.teacher_request_ops_input_v1('transfer','{}',null)$q$,'42501',null,'internal validation helper is not an authenticated API');
reset role;
select is((select original_lesson_session_id from public.makeup_requests where id=(select(payload->>'id')::uuid from own_results where name='normalized')),pg_temp.own_id(31),'reused normalized key left original identity unchanged');
select is((select count(*) from dashboard_private.teacher_request_context_v1),0::bigint,'all exact contexts are removed after successful requests');
select is((select count(*) from public.class_lesson_sessions),(select sessions from own_effects_before),'request creation never applies schedule effects');
select is((select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.students s),(select students from own_effects_before),'request creation never changes student rosters');
select is((select count(*) from public.textbook_stock_moves),(select stock from own_effects_before),'textbook request creates no stock movements');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from own_effects_before),'no provider delivery is materialized or sent by owner commands');

create function pg_temp.prior_makeup_input(p_input jsonb,p_existing_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.classes%rowtype;t public.teacher_catalogs%rowtype;ap public.teacher_catalogs%rowtype;
 old_request public.makeup_requests%rowtype;director jsonb;v jsonb;slot jsonb;mode text;session_id uuid;
begin
 if jsonb_typeof(p_input) is distinct from 'object'
  or not(p_input ?& dashboard_private.teacher_request_input_fields_v1('makeup'))
  or p_input-dashboard_private.teacher_request_input_fields_v1('makeup')<>'{}'
  or jsonb_typeof(p_input->'request_kind') is distinct from 'string'
  or jsonb_typeof(p_input->'class_id') is distinct from 'string'
  or jsonb_typeof(p_input->'reason') is distinct from 'string'
  or length(btrim(p_input->>'reason')) not between 1 and 4000
  or jsonb_typeof(p_input->'makeup_slots') is distinct from 'array'
  or jsonb_array_length(p_input->'makeup_slots')>30
  or jsonb_typeof(p_input->'cancel_date') not in('string','null')
  or jsonb_typeof(p_input->'original_lesson_session_id') not in('string','null') then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 select * into c from public.classes where id=(p_input->>'class_id')::uuid for share;
 if not found then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 if p_existing_id is not null then
  select * into old_request from public.makeup_requests where id=p_existing_id;
  if c.id is distinct from old_request.class_id then raise exception 'teacher_request_reference_change_forbidden' using errcode='22023';end if;
 end if;
 -- Resolve unique active catalog links, never a client-supplied profile/role.
 if (select count(*) from public.teacher_catalogs tc join public.profiles p on p.id=tc.profile_id
    join auth.users u on u.id=p.id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    where tc.is_visible and btrim(tc.name)=btrim(c.teacher))<>1 then
  raise exception 'teacher_request_teacher_unavailable' using errcode='22023';end if;
 select tc.* into t from public.teacher_catalogs tc join public.profiles p on p.id=tc.profile_id
    join auth.users u on u.id=p.id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
    where tc.is_visible and btrim(tc.name)=btrim(c.teacher);
 director:=dashboard_private.resolve_registration_default_director(c.subject,c.grade,coalesce(old_request.created_at,now()));
 if director->>'status' is distinct from 'resolved' then raise exception 'teacher_request_approver_unavailable' using errcode='22023';end if;
 if p_existing_id is not null and old_request.approver_profile_id::text is distinct from director->>'profileId' then
  raise exception 'teacher_request_approver_changed' using errcode='23514';end if;
 if (select count(*) from public.teacher_catalogs where is_visible and profile_id::text=director->>'profileId')<>1 then
  raise exception 'teacher_request_approver_unavailable' using errcode='22023';end if;
 select * into ap from public.teacher_catalogs where is_visible and profile_id::text=director->>'profileId';
 if p_existing_id is not null and old_request.approver_teacher_catalog_id is distinct from ap.id then
  raise exception 'teacher_request_approver_changed' using errcode='23514';end if;
 for slot in select value from jsonb_array_elements(p_input->'makeup_slots') loop
  if jsonb_typeof(slot) is distinct from 'object' or not(slot ?& array['startAt','endAt','classroom'])
    or slot-array['startAt','endAt','classroom']<>'{}' or exists(select 1 from jsonb_each(slot) where jsonb_typeof(value)<>'string')
    or not exists(select 1 from public.classroom_catalogs where is_visible and name=slot->>'classroom')
    or (slot->>'endAt')::timestamptz<=(slot->>'startAt')::timestamptz then
    raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 end loop;
 session_id:=nullif(p_input->>'original_lesson_session_id','')::uuid;
 if c.schedule_storage_mode='normalized' and p_input->>'request_kind'<>'makeup_only' then
  if session_id is null or not exists(select 1 from public.class_lesson_sessions where id=session_id and class_id=c.id
    and session_date=(p_input->>'cancel_date')::date and schedule_state in('active','makeup')) then
   raise exception 'makeup_lesson_session_invalid' using errcode='22023';end if;
 elsif session_id is not null then raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 v:=jsonb_build_object('request_kind',p_input->'request_kind','class_id',c.id,'class_name',c.name,'subject',c.subject,
  'approval_group',case when btrim(c.subject)='영어' then 'english' when btrim(c.subject)='수학' and coalesce(nullif(btrim(c.grade),''),nullif(btrim(c.name),''),'')~*'(고|high)' then 'math_high'
   when btrim(c.subject)='수학' and coalesce(nullif(btrim(c.grade),''),nullif(btrim(c.name),''),'')~*'(초|elementary|중|middle)' then 'math_middle' else 'unknown' end,
  'requester_id',auth.uid(),'teacher_catalog_id',t.id,'teacher_profile_id',t.profile_id,'approver_teacher_catalog_id',ap.id,'approver_profile_id',ap.profile_id,
  'reason',btrim(p_input->>'reason'),'cancel_date',p_input->'cancel_date','original_lesson_session_id',session_id,
  'makeup_slots',p_input->'makeup_slots','makeup_start_at',p_input#>'{makeup_slots,0,startAt}',
  'makeup_end_at',p_input#>'{makeup_slots,0,endAt}','makeup_classroom',p_input#>'{makeup_slots,0,classroom}');
 if not coalesce(dashboard_private.notification_makeup_input_valid_v1(v,coalesce(old_request.created_at,now())),false) then
  raise exception 'teacher_request_input_invalid' using errcode='22023';end if;
 return v;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 raise exception 'teacher_request_input_invalid' using errcode='22023';
end $$;
-- Current default differs from a historical routing label; authorization is
-- still owner + effect-free + exact current revision, not the displayed label.
savepoint historical_approver_edit;
update public.makeup_requests set approver_profile_id=pg_temp.own_id(4),approver_teacher_catalog_id=pg_temp.own_id(11)
 where id=(select(payload->>'id')::uuid from own_results where name='makeup');
-- Exact private helper boundary, only in this rolled-back postgres fixture.
select pg_temp.own_actor(3);
select is(dashboard_private.teacher_request_preserved_makeup_approver_v1((select to_jsonb(r) from public.makeup_requests r where id=(select(payload->>'id')::uuid from own_results where name='makeup'))),false,'no internal update context gives no historical routing exception');
insert into dashboard_private.teacher_request_context_v1 values(txid_current(),pg_backend_pid(),pg_temp.own_id(3),'makeup',(select(payload->>'id')::uuid from own_results where name='makeup'),'update');
select is(dashboard_private.teacher_request_preserved_makeup_approver_v1((select to_jsonb(r) from public.makeup_requests r where id=(select(payload->>'id')::uuid from own_results where name='makeup'))),true,'exact owner update context is a positive exception control');
update dashboard_private.teacher_request_context_v1 set action='create';
select is(dashboard_private.teacher_request_preserved_makeup_approver_v1((select to_jsonb(r) from public.makeup_requests r where id=(select(payload->>'id')::uuid from own_results where name='makeup'))),false,'create context never gains the preservation exception');
update dashboard_private.teacher_request_context_v1 set action='update',request_id=(select(payload->>'id')::uuid from own_results where name='normalized');
select is(dashboard_private.teacher_request_preserved_makeup_approver_v1((select to_jsonb(r) from public.makeup_requests r where id=(select(payload->>'id')::uuid from own_results where name='makeup'))),false,'different request context cannot preserve another request approver');
update dashboard_private.teacher_request_context_v1 set request_id=(select(payload->>'id')::uuid from own_results where name='makeup');
select pg_temp.own_actor(4);
select is(dashboard_private.teacher_request_preserved_makeup_approver_v1((select to_jsonb(r) from public.makeup_requests r where id=(select(payload->>'id')::uuid from own_results where name='makeup'))),false,'different actor cannot reuse owner context');
select pg_temp.own_actor(3);
select is(dashboard_private.teacher_request_preserved_makeup_approver_v1((select to_jsonb(r)||jsonb_build_object('class_id',pg_temp.own_id(21)) from public.makeup_requests r where id=(select(payload->>'id')::uuid from own_results where name='makeup'))),false,'different class cannot use the preservation exception');
select is(dashboard_private.teacher_request_preserved_makeup_approver_v1((select to_jsonb(r)||jsonb_build_object('approver_profile_id',pg_temp.own_id(1)) from public.makeup_requests r where id=(select(payload->>'id')::uuid from own_results where name='makeup'))),false,'different approver identity cannot use the preservation exception');
delete from dashboard_private.teacher_request_context_v1;
set local role authenticated;
select throws_ok($q$select dashboard_private.teacher_request_preserved_makeup_approver_v1('{}')$q$,'42501',null,'authenticated caller cannot execute the private preservation helper');
select throws_ok($q$select pg_temp.prior_makeup_input((select input from own_results where name='makeup'),(select(payload->>'id')::uuid from own_results where name='makeup'))$q$,'23514','teacher_request_approver_changed','exact prior helper rejects harmless owner edit after default change');
update own_results set payload=pg_temp.own_current('makeup') where name='makeup';
select lives_ok($q$select pg_temp.own_mutate('makeup','update',(select input||'{"reason":"과거 지정 기록 보존 수정"}' from own_results where name='makeup'),910)$q$,'owner edit preserves historical routing after default change');
select is(pg_temp.own_current('makeup')#>>'{approver,profileId}',pg_temp.own_id(4)::text,'historical approver UUID is not replaced');
select is(pg_temp.own_current('makeup')#>>'{input,reason}','과거 지정 기록 보존 수정','full new request reason persisted');
select is(public.get_makeup_director_capability_v1((select(payload->>'id')::uuid from own_results where name='makeup')),false,'historical routing never grants requester decision rights');
reset role;select pg_temp.own_actor(4);set local role authenticated;
select is(public.get_makeup_director_capability_v1((select(payload->>'id')::uuid from own_results where name='makeup')),false,'historically assigned teacher receives no director rights');
select throws_ok($q$select pg_temp.own_current('makeup')$q$,'42501','teacher_request_forbidden','historically assigned teacher is not the owner');
reset role;rollback to historical_approver_edit;

select pg_temp.own_actor(4);set local role authenticated;
select throws_ok($q$select pg_temp.own_current('makeup')$q$,'42501','teacher_request_forbidden','responsible teacher is not the requester');
select throws_ok($q$select pg_temp.own_mutate('transfer','withdraw','{"note":"other owner"}',111)$q$,'42501','teacher_request_forbidden','other teacher cannot withdraw');
select is((public.get_teacher_own_requests_v1('transfer')->>'totalCount')::integer,0,'another teacher own list omits the request');
reset role;
select pg_temp.own_actor(3);set local role authenticated;
select lives_ok($q$select pg_temp.own_mutate('transfer','update',(select input||'{"memo":"교사 수정"}' from own_results where name='transfer'),112)$q$,'teacher can update only own request fields');
select is(pg_temp.own_current('transfer')#>>'{input,memo}','교사 수정','updated memo survives actual consumer read');
reset role;
select pg_temp.own_actor(2);
update public.ops_tasks set assignee_id=pg_temp.own_id(2) where id=(select(payload->>'id')::uuid from own_results where name='transfer');
update public.ops_transfer_details set transfer_reason='관리팀 현재 사유' where task_id=(select(payload->>'id')::uuid from own_results where name='transfer');
select pg_temp.own_actor(3);set local role authenticated;
select throws_ok($q$select pg_temp.own_mutate('transfer','update',(select input from own_results where name='transfer'),113)$q$,'23514','teacher_request_stale','detail-only or assignment changes invalidate full CAS');
select is(pg_temp.own_current('transfer')#>>'{input,transfer_reason}','관리팀 현재 사유','fresh revision is paired with current request input, never old history');
select ok(pg_temp.own_current('transfer')->'allowedActions' ? 'update','assignment and effect-free correction do not permanently close editing');
update own_results set payload=pg_temp.own_current('transfer') where name='transfer';
select lives_ok($q$select pg_temp.own_mutate('transfer','update',pg_temp.own_current('transfer')->'input',114)$q$,'current corrected input may be preserved through own edit');
reset role;
select pg_temp.own_actor(2);
update public.makeup_requests set status='revision_requested',returned_reason='가상 보완 요청' where id=(select(payload->>'id')::uuid from own_results where name='makeup');
insert into public.makeup_request_events(request_id,actor_id,event_type,note) select(payload->>'id')::uuid,pg_temp.own_id(1),'revision_requested','가상 보완 요청' from own_results where name='makeup';
select pg_temp.own_actor(3);set local role authenticated;
select ok(pg_temp.own_current('makeup')->'allowedActions' ? 'update','first preapproval revision request still permits correction');
update own_results set payload=pg_temp.own_current('makeup') where name='makeup';
select lives_ok($q$select pg_temp.own_mutate('makeup','update',(select input||'{"reason":"보완한 가상 사유"}' from own_results where name='makeup'),115)$q$,'own revision resubmits without changing approver or applying schedule');
select is(pg_temp.own_current('makeup')->>'status','approval_pending','resubmit returns to designated approver pending');
select is(pg_temp.own_current('makeup')#>>'{approver,profileId}',pg_temp.own_id(1)::text,'resubmit preserves original designated UUID');
reset role;

-- Actual-effect fields are observed monotonically even if managers later reset
-- status/quantities. A mere assignment or revision request above is not one.
select pg_temp.own_actor(2);
update public.ops_transfer_details set fee_processed=true where task_id=(select(payload->>'id')::uuid from own_results where name='transfer');
update public.ops_transfer_details set fee_processed=false where task_id=(select(payload->>'id')::uuid from own_results where name='transfer');
update public.textbook_purchase_orders set status='ordered',ordered_at=now() where id=(select(payload->>'id')::uuid from own_results where name='textbook');
update public.textbook_purchase_orders set status='requested',ordered_at=null where id=(select(payload->>'id')::uuid from own_results where name='textbook');
update public.makeup_requests set status='makeup_pending',approved_at=now() where id=(select(payload->>'id')::uuid from own_results where name='makeup');
update public.makeup_requests set status='approval_pending',approved_at=null where id=(select(payload->>'id')::uuid from own_results where name='makeup');
select pg_temp.own_actor(3);set local role authenticated;
select is(pg_temp.own_current('transfer')->>'effectState','observed','reset management checkbox cannot erase effect history');
select is(pg_temp.own_current('textbook')->>'effectState','observed','reset ordered state cannot restore direct teacher editing');
select is(pg_temp.own_current('makeup')->>'effectState','observed','refund-style pending state cannot erase prior approval effect');
select ok(not(pg_temp.own_current('makeup')->'allowedActions' ? 'update'),'previously approved pending makeup does not permit direct edit');
update own_results set payload=pg_temp.own_current(name) where name in('transfer','textbook','makeup');
select throws_ok($q$select pg_temp.own_mutate('makeup','withdraw','{"note":"direct cancellation"}',116)$q$,'23514','teacher_request_state_conflict','post-effect withdrawal does not reverse schedule');
select lives_ok($q$select pg_temp.own_mutate('makeup','cancel_request','{"note":"가상 취소 요청"}',117)$q$,'post-effect cancellation is a request, not an effect reversal');
select is(jsonb_array_length(pg_temp.own_current('makeup')->'changes'),1,'change request is retained in own detail');
select is(jsonb_array_length(pg_temp.own_current('makeup')->'allowedActions'),0,'pending request disables duplicate changes');
reset role;
create temp table own_original_before_resolution as select to_jsonb(m) original from public.makeup_requests m where id=(select(payload->>'id')::uuid from own_results where name='makeup');
select pg_temp.own_actor(6);set local role authenticated;
select is((public.get_teacher_request_changes_v1('makeup')->>'totalCount')::integer,0,'unassigned viewer cannot receive principal inbox rows');
select throws_ok($q$select public.resolve_teacher_request_change_v1((select(payload#>>'{changes,0,id}')::uuid from own_results where name='makeup'),'confirmed','wrong principal',(select payload#>>'{changes,0,revision}' from own_results where name='makeup'),pg_temp.own_id(118))$q$,'42501','teacher_request_forbidden','unassigned viewer cannot record a result');
reset role;
select pg_temp.own_actor(2);set local role authenticated;
select is((public.get_teacher_request_changes_v1('makeup')->>'totalCount')::integer,1,'staff can view the management queue without director authority');
select lives_ok($q$select public.resolve_teacher_request_change_v1((select(payload#>>'{changes,0,id}')::uuid from own_results where name='makeup'),'noted','가상 관리팀 경과 기록',(select payload#>>'{changes,0,revision}' from own_results where name='makeup'),pg_temp.own_id(119))$q$,'management progress note does not close a director request');
reset role;
select is((select status from dashboard_private.teacher_request_changes_v1 where request_id=(select(payload->>'id')::uuid from own_results where name='makeup')),'pending','staff note keeps director decision pending');
select is((select to_jsonb(m) from public.makeup_requests m where id=(select(payload->>'id')::uuid from own_results where name='makeup')),(select original from own_original_before_resolution),'resolution leaves underlying makeup state/effects byte-equivalent');

select pg_temp.own_actor(3);set local role authenticated;
select lives_ok($q$select pg_temp.own_mutate('withdrawal','withdraw','{"note":"가상 신청 철회"}',120)$q$,'effect-free withdrawal preserves original and audit history');
select is(pg_temp.own_current('withdrawal')->>'status','canceled','withdrawal records terminal original state');
select is(jsonb_array_length(pg_temp.own_current('withdrawal')->'history'),2,'create and withdrawal history remain');
select throws_ok($q$select pg_temp.own_mutate('withdrawal','cancel_request','{"note":"again"}',121)$q$,'23514','teacher_request_state_conflict','canceled source cannot accept a new cancellation request');
select lives_ok($q$select pg_temp.own_create('transfer')$q$,'old create replay uses current state after management effects');
select ok(not((select payload->'allowedActions' from own_results where name='transfer') ? 'update'),'create replay does not return obsolete edit capabilities');
reset role;
update auth.users set banned_until=now()+interval '1 day' where id=pg_temp.own_id(3);
set local role authenticated;
select throws_ok($q$select pg_temp.own_create('transfer')$q$,'42501','teacher_request_forbidden','banned owner cannot retrieve an old successful receipt');
reset role;
update auth.users set banned_until=null where id=pg_temp.own_id(3);
update public.profiles set role='viewer' where id=pg_temp.own_id(3);
set local role authenticated;
select throws_ok($q$select pg_temp.own_current('textbook')$q$,'42501','teacher_request_forbidden','current role is checked before own detail access');
reset role;
update public.profiles set role='teacher' where id=pg_temp.own_id(3);
select pg_temp.own_actor(5);set local role authenticated;
select throws_ok($q$select public.get_teacher_own_requests_v1('makeup')$q$,'42501','teacher_request_forbidden','assistant scope is not expanded');
reset role;
select throws_ok($q$update dashboard_private.teacher_request_history_v1 set note='tampered'$q$,'42501','teacher_request_history_append_only','history cannot be overwritten even by table owner DML');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in('get_teacher_own_request_v1','get_teacher_own_requests_v1','mutate_teacher_own_request_v1','get_teacher_request_changes_v1','resolve_teacher_request_change_v1','get_teacher_request_references_v1') and p.prosecdef),'new public wrappers are invokers');
select ok(not has_table_privilege('authenticated','dashboard_private.teacher_request_history_v1','SELECT'),'history table is never a raw authenticated read');
select ok(not has_function_privilege('anon','public.mutate_teacher_own_request_v1(text,uuid,text,jsonb,text,uuid)','EXECUTE'),'anonymous callers cannot enter mutation');
select is((select count(*) from dashboard_private.teacher_request_context_v1),0::bigint,'no transaction marker escapes the request boundary');

-- The three remaining domain-specific withdrawal branches execute separately.
select pg_temp.own_actor(3);set local role authenticated;
insert into own_results(name,domain,input,request_key)
select 'withdraw-'||domain,domain,input,pg_temp.own_id(case domain when 'transfer' then 301 when 'makeup' then 302 else 303 end)
from own_results where name in('transfer','makeup','textbook');
select lives_ok($q$select pg_temp.own_create('withdraw-transfer')$q$,'new transfer fixture for history-preserving withdrawal');
select lives_ok($q$select pg_temp.own_create('withdraw-makeup')$q$,'new makeup fixture for history-preserving withdrawal');
select lives_ok($q$select pg_temp.own_create('withdraw-textbook')$q$,'new textbook fixture for history-preserving withdrawal');
reset role;
create temp table withdrawal_snapshots as select name,domain,payload,input from own_results where name like 'withdraw-%';
grant select on withdrawal_snapshots to authenticated;
create temp table withdrawal_effects as select
 (select count(*) from public.class_lesson_sessions) sessions,
 (select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.students s) students,
 (select count(*) from dashboard_private.notification_deliveries) deliveries,
 (select count(*) from public.textbook_stock_moves) stock,
 (select jsonb_agg(to_jsonb(l) order by id) from public.textbook_purchase_order_lines l where purchase_order_id=(select(payload->>'id')::uuid from withdrawal_snapshots where domain='textbook')) children;
select pg_temp.own_actor(3);set local role authenticated;
select lives_ok($q$select public.mutate_teacher_own_request_v1('transfer',(select(payload->>'id')::uuid from withdrawal_snapshots where domain='transfer'),'withdraw','{"note":"가상 이력 보존 철회"}',(select payload->>'revision' from withdrawal_snapshots where domain='transfer'),pg_temp.own_id(311))$q$,'transfer own withdrawal executes with its domain status');
select lives_ok($q$select public.mutate_teacher_own_request_v1('transfer',(select(payload->>'id')::uuid from withdrawal_snapshots where domain='transfer'),'withdraw','{"note":"가상 이력 보존 철회"}',(select payload->>'revision' from withdrawal_snapshots where domain='transfer'),pg_temp.own_id(311))$q$,'transfer identical withdrawal replay returns the existing result');
select is(pg_temp.own_current('withdraw-transfer')->>'status','canceled','transfer withdrawal uses existing terminal status');
select is(pg_temp.own_current('withdraw-transfer')->'input',(select input from withdrawal_snapshots where domain='transfer'),'transfer original input remains after withdrawal');
select is(jsonb_array_length(pg_temp.own_current('withdraw-transfer')->'history'),2,'transfer duplicate request adds no extra history');
select is(jsonb_array_length(pg_temp.own_current('withdraw-transfer')->'allowedActions'),0,'transfer withdrawn source exposes no direct or change actions');
select throws_ok($q$select public.mutate_teacher_own_request_v1('transfer',(select(payload->>'id')::uuid from withdrawal_snapshots where domain='transfer'),'withdraw','{"note":"again"}',pg_temp.own_current('withdraw-transfer')->>'revision',pg_temp.own_id(321))$q$,'23514','teacher_request_state_conflict','transfer a second withdrawal with a new key is rejected');
select lives_ok($q$select public.mutate_teacher_own_request_v1('makeup',(select(payload->>'id')::uuid from withdrawal_snapshots where domain='makeup'),'withdraw','{"note":"가상 이력 보존 철회"}',(select payload->>'revision' from withdrawal_snapshots where domain='makeup'),pg_temp.own_id(312))$q$,'makeup own withdrawal executes with its domain status');
select lives_ok($q$select public.mutate_teacher_own_request_v1('makeup',(select(payload->>'id')::uuid from withdrawal_snapshots where domain='makeup'),'withdraw','{"note":"가상 이력 보존 철회"}',(select payload->>'revision' from withdrawal_snapshots where domain='makeup'),pg_temp.own_id(312))$q$,'makeup identical withdrawal replay returns the existing result');
select is(pg_temp.own_current('withdraw-makeup')->>'status','canceled','makeup withdrawal uses existing terminal status');
select is(pg_temp.own_current('withdraw-makeup')->'input',(select input from withdrawal_snapshots where domain='makeup'),'makeup original input remains after withdrawal');
select is(jsonb_array_length(pg_temp.own_current('withdraw-makeup')->'history'),2,'makeup duplicate request adds no extra history');
select is(jsonb_array_length(pg_temp.own_current('withdraw-makeup')->'allowedActions'),0,'makeup withdrawn source exposes no direct or change actions');
select throws_ok($q$select public.mutate_teacher_own_request_v1('makeup',(select(payload->>'id')::uuid from withdrawal_snapshots where domain='makeup'),'withdraw','{"note":"again"}',pg_temp.own_current('withdraw-makeup')->>'revision',pg_temp.own_id(322))$q$,'23514','teacher_request_state_conflict','makeup a second withdrawal with a new key is rejected');
select lives_ok($q$select public.mutate_teacher_own_request_v1('textbook',(select(payload->>'id')::uuid from withdrawal_snapshots where domain='textbook'),'withdraw','{"note":"가상 이력 보존 철회"}',(select payload->>'revision' from withdrawal_snapshots where domain='textbook'),pg_temp.own_id(313))$q$,'textbook own withdrawal executes with its domain status');
select lives_ok($q$select public.mutate_teacher_own_request_v1('textbook',(select(payload->>'id')::uuid from withdrawal_snapshots where domain='textbook'),'withdraw','{"note":"가상 이력 보존 철회"}',(select payload->>'revision' from withdrawal_snapshots where domain='textbook'),pg_temp.own_id(313))$q$,'textbook identical withdrawal replay returns the existing result');
select is(pg_temp.own_current('withdraw-textbook')->>'status','cancelled','textbook withdrawal uses existing terminal status');
select is(pg_temp.own_current('withdraw-textbook')->'input',(select input from withdrawal_snapshots where domain='textbook'),'textbook original input remains after withdrawal');
select is(jsonb_array_length(pg_temp.own_current('withdraw-textbook')->'history'),2,'textbook duplicate request adds no extra history');
select is(jsonb_array_length(pg_temp.own_current('withdraw-textbook')->'allowedActions'),0,'textbook withdrawn source exposes no direct or change actions');
select throws_ok($q$select public.mutate_teacher_own_request_v1('textbook',(select(payload->>'id')::uuid from withdrawal_snapshots where domain='textbook'),'withdraw','{"note":"again"}',pg_temp.own_current('withdraw-textbook')->>'revision',pg_temp.own_id(323))$q$,'23514','teacher_request_state_conflict','textbook a second withdrawal with a new key is rejected');
reset role;
select is((select count(*) from public.class_lesson_sessions),(select sessions from withdrawal_effects),'all withdrawals leave schedule rows unchanged');
select is((select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.students s),(select students from withdrawal_effects),'all withdrawals leave student roster rows unchanged');
select is((select count(*) from public.textbook_stock_moves),(select stock from withdrawal_effects),'all withdrawals create no stock effect');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from withdrawal_effects),'all withdrawals materialize no provider delivery');
select is((select jsonb_agg(to_jsonb(l) order by id) from public.textbook_purchase_order_lines l where purchase_order_id=(select(payload->>'id')::uuid from withdrawal_snapshots where domain='textbook')),(select children from withdrawal_effects),'textbook withdrawal preserves every child row exactly');
select is((select count(*) from public.makeup_request_events where request_id=(select(payload->>'id')::uuid from withdrawal_snapshots where domain='makeup') and event_type='withdrawn'),1::bigint,'makeup withdrawal appends one auditable event without approval/cancellation effects');
select is((select count(*) from public.ops_tasks where id=(select(payload->>'id')::uuid from withdrawal_snapshots where domain='transfer')),1::bigint,'transfer original parent still exists');
select is((select count(*) from public.ops_transfer_details where task_id=(select(payload->>'id')::uuid from withdrawal_snapshots where domain='transfer')),1::bigint,'transfer original detail still exists');
select pg_temp.own_actor(2);set local role authenticated;
-- The existing request mode is requested-only. Cancellation is retained in the
-- management order/all history, not reintroduced as an active request.
select is(public.get_textbook_purchase_detail_v1((select id from public.textbook_purchase_order_lines where purchase_order_id=(select(payload->>'id')::uuid from withdrawal_snapshots where domain='textbook') order by id limit 1),'request')->'row','null'::jsonb,'withdrawn textbook is excluded from existing active request mode');
select is(public.get_textbook_purchase_detail_v1((select id from public.textbook_purchase_order_lines where purchase_order_id=(select(payload->>'id')::uuid from withdrawal_snapshots where domain='textbook') order by id limit 1),'order')#>>'{row,status}','cancelled','manager order/all detail retains withdrawn parent as canceled');
select ok(exists(select 1 from jsonb_array_elements(public.list_makeup_numbered_page_v1('{"view":"closed","subject":"all","teacher":"all","period":"all","dateFrom":"","dateTo":"","filterColumn":"className","search":"","sortColumn":null,"sortDirection":null}',1,20)->'rows') r where r->>'id'=(select payload->>'id' from withdrawal_snapshots where domain='makeup') and r->>'status'='canceled'),'manager closed view contains the withdrawn makeup request');
reset role;
-- The actual closed-list search and sort keys agree with the existing UI,
-- including the common teacher reader and historical approval cancellations.
create function pg_temp.withdrawn_page(col text,term text,direction text default null) returns jsonb language sql as $$
 select public.list_makeup_numbered_page_v1(jsonb_build_object('view','closed','subject','all','teacher','all','period','all','dateFrom','','dateTo','','filterColumn',col,'search',term,'sortColumn',case when direction is null then null else col end,'sortDirection',direction),1,20) $$;
select pg_temp.own_actor(2);set local role authenticated;
select is((pg_temp.withdrawn_page('canceledNote','가상 이력 보존 철회')->>'totalCount')::integer,1,'management search finds the actual withdrawal reason');
select is(pg_temp.withdrawn_page('status','취소·철회')#>>'{rows,0,id}',(select payload->>'id' from withdrawal_snapshots where domain='makeup'),'management status search matches the current neutral UI label');
select is(pg_temp.withdrawn_page('canceledNote','가상 이력 보존 철회','asc')#>>'{rows,0,id}',(select payload->>'id' from withdrawal_snapshots where domain='makeup'),'withdrawal reason remains searchable with ascending ordering');
select is(pg_temp.withdrawn_page('canceledNote','가상 이력 보존 철회','desc')#>>'{rows,0,id}',(select payload->>'id' from withdrawal_snapshots where domain='makeup'),'withdrawal reason remains searchable with descending ordering');
reset role;
select pg_temp.own_actor(3);set local role authenticated;
select throws_ok($q$select pg_temp.withdrawn_page('canceledNote','가상 이력 보존 철회')$q$,'42501','operational_common_filter_forbidden','teacher common reader still cannot search private cancellation notes');
select is(pg_temp.withdrawn_page('status','취소·철회')#>>'{rows,0,id}',(select payload->>'id' from withdrawal_snapshots where domain='makeup'),'teacher common reader uses the same cancellation status key');
reset role;
select is(public.makeup_numbered_values_v1('{"status":"canceled"}','{"canceled":{"note":"가상 기존 승인 취소 사유"}}','{}')->>'canceledNote','가상 기존 승인 취소 사유','historical approval cancellation note remains an unchanged search key');
select is(public.makeup_numbered_values_v1('{"status":"canceled"}','{}','{}')->>'status','취소·철회','closed status key matches the UI without implying prior approval');

-- Current references may disappear through the existing SET NULL FKs. A
-- partial input must remain readable without becoming an editable old draft.
select pg_temp.own_actor(3);set local role authenticated;
insert into own_results(name,domain,input,request_key)
select 'missing-'||domain,domain,input,pg_temp.own_id(case domain when 'transfer' then 501 when 'withdrawal' then 502 else 503 end)
from own_results where name in('transfer','withdrawal','makeup');
select lives_ok($q$select pg_temp.own_create('missing-transfer')$q$,'missing-reference transfer fixture is a proven own original');
select lives_ok($q$select pg_temp.own_create('missing-withdrawal')$q$,'missing-reference withdrawal fixture is a proven own original');
select lives_ok($q$select pg_temp.own_create('missing-makeup')$q$,'missing-reference makeup fixture is a proven own original');
reset role;
select ok(exists(select 1 from pg_constraint where conrelid='public.ops_tasks'::regclass and confrelid='public.students'::regclass and confdeltype='n'),'existing student FK can produce a null reference');
select ok(exists(select 1 from pg_constraint where conrelid='public.ops_transfer_details'::regclass and confrelid='public.classes'::regclass and confdeltype='n'),'existing transfer class FK can produce a null reference');
select ok(exists(select 1 from pg_constraint where conrelid='public.makeup_requests'::regclass and confrelid='public.classes'::regclass and confdeltype='n'),'existing makeup class FK can produce a null reference');
select pg_temp.own_actor(2);
update public.ops_tasks set student_id=null where id=(select(payload->>'id')::uuid from own_results where name='missing-transfer');
-- This FK is declared SET NULL, but the active notification trigger rejects
-- removal in the normal write path. Preserve that guard instead of bypassing it.
select throws_ok($q$update public.ops_tasks set class_id=null where id=(select(payload->>'id')::uuid from own_results where name='missing-withdrawal')$q$,'22023','ops_withdrawal_management_link_required','current withdrawal trigger rejects removal of its required management link');
update public.makeup_requests set class_id=null where id=(select(payload->>'id')::uuid from own_results where name='missing-makeup');
select pg_temp.own_actor(3);set local role authenticated;
select is(pg_temp.own_current('missing-transfer')->'input','null'::jsonb,'null student returns readable unavailable input, not a malformed UUID');
select is(pg_temp.own_current('missing-withdrawal')->'input',(select input from own_results where name='missing-withdrawal'),'rejected reference removal preserves the complete withdrawal input');
select is(pg_temp.own_current('missing-makeup')->'input','null'::jsonb,'null makeup class returns readable unavailable input');
select is(pg_temp.own_current('missing-transfer')->'allowedActions','["change_request","cancel_request"]'::jsonb,'missing transfer reference does not permit direct editing or withdrawal');
select is(pg_temp.own_current('missing-withdrawal')->'allowedActions','["update","withdraw"]'::jsonb,'rejected reference removal does not falsely disable a valid withdrawal request');
select is(pg_temp.own_current('missing-makeup')->'allowedActions','["change_request","cancel_request"]'::jsonb,'missing makeup reference does not permit direct editing or withdrawal');
update own_results set payload=pg_temp.own_current(name) where name like 'missing-%';
select throws_ok($q$select pg_temp.own_mutate('missing-transfer','update',(select input from own_results where name='missing-transfer'),511)$q$,'23514','teacher_request_state_conflict','fresh revision cannot authorize an old transfer input after reference loss');
select is(pg_temp.own_current('missing-withdrawal')#>>'{input,class_id}',pg_temp.own_id(20)::text,'withdrawal class identity remains unchanged after the rejected update');
select lives_ok($q$select pg_temp.own_mutate('missing-makeup','change_request','{"note":"가상 참조 확인 요청"}',513)$q$,'reference loss still permits the safe change-request workflow');
reset role;
select is((select h.input_snapshot from dashboard_private.teacher_request_history_v1 h where h.domain='transfer' and h.request_id=(select(payload->>'id')::uuid from own_results where name='missing-transfer') and action='create'),(select input from own_results where name='missing-transfer'),'immutable original snapshot remains intact after reference loss');
select pg_temp.own_actor(2);
update public.ops_tasks set student_id=pg_temp.own_id(30) where id=(select(payload->>'id')::uuid from own_results where name='missing-transfer');
update public.ops_transfer_details set to_class_id=null where task_id=(select(payload->>'id')::uuid from own_results where name='missing-transfer');
select pg_temp.own_actor(3);set local role authenticated;
select is(pg_temp.own_current('missing-transfer')->'input','null'::jsonb,'a missing transfer destination also hides unsafe editable input');
select is(pg_temp.own_current('missing-transfer')->'allowedActions','["change_request","cancel_request"]'::jsonb,'a missing destination never falls back to the historical destination');
reset role;
-- Current management stage alone is not a business effect. Exercise each
-- known active stage through the existing authenticated management RPC, then
-- prove teacher editing preserves that stage and withdrawal preserves history.
create temp table own_active_cases(name text,domain text,stage text,key_number integer);
grant all on own_active_cases to authenticated;
insert into own_active_cases select 'active-'||d||'-'||stage,d,stage,700+row_number() over(order by d,stage)::integer
from unnest(array['transfer','withdrawal'])d cross join unnest(array['requested','confirmed','in_progress','review_requested','on_hold'])stage;
select pg_temp.own_actor(3);set local role authenticated;
insert into own_results(name,domain,input,request_key) select c.name,c.domain,o.input,pg_temp.own_id(c.key_number) from own_active_cases c join own_results o on o.name=c.domain;
select lives_ok(format('select pg_temp.own_create(%L)',name),name||' own fixture created') from own_active_cases order by name;
reset role;
select pg_temp.own_actor(2);set local role authenticated;
select throws_ok($q$update public.ops_tasks set memo='direct table write denied' where id=(select(payload->>'id')::uuid from own_results where name='active-transfer-confirmed')$q$,'42501','permission denied for table ops_tasks','staff management still uses RPC instead of unrestricted table writes');
select lives_ok(format('select public.update_ops_task_v2(%L::uuid,%L::jsonb,%L::timestamptz,%L::uuid)',o.payload->>'id',jsonb_build_object('task',jsonb_build_object('status',c.stage))::text,o.payload->>'updatedAt',pg_temp.own_id(c.key_number+20)::text),c.name||' stage set by existing manager RPC')
from own_active_cases c join own_results o using(name) order by c.name;
reset role;
select pg_temp.own_actor(3);set local role authenticated;
update own_results o set payload=pg_temp.own_current(o.name) where name like 'active-%';
select is(o.payload->'allowedActions','["update","withdraw"]'::jsonb,c.name||' effect-free stage keeps own edit/withdraw') from own_active_cases c join own_results o using(name) order by c.name;
select lives_ok(format('select pg_temp.own_mutate(%L,%L,%L::jsonb,%s)',c.name,'update',(o.input||'{"memo":"가상 단계 보존 수정"}'::jsonb)::text,c.key_number+40),c.name||' owner edits before effects') from own_active_cases c join own_results o using(name) order by c.name;
select is(pg_temp.own_current(name)->>'status',stage,name||' teacher update preserves management stage') from own_active_cases order by name;
select lives_ok(format('select pg_temp.own_mutate(%L,%L,%L::jsonb,%s)',name,'withdraw','{"note":"가상 처리 전 철회"}',key_number+60),name||' owner withdraws before effects') from own_active_cases order by name;
select is(pg_temp.own_current(name)->>'status','canceled',name||' withdrawn history remains terminal') from own_active_cases order by name;
select is(jsonb_array_length(pg_temp.own_current(name)->'history'),3,name||' create update withdrawal history preserved') from own_active_cases order by name;
reset role;
select is((select count(*) from public.class_lesson_sessions),(select sessions from own_effects_before),'active-stage teacher changes apply no schedule effects');
select is((select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.students s),(select students from own_effects_before),'active-stage teacher changes apply no roster effects');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from own_effects_before),'active-stage teacher changes materialize no provider delivery');

-- A receipt made by the old supported submission API never proves that its
-- original was observed by this new owner workflow.
create temp table legacy_teacher_book(payload jsonb);
grant all on legacy_teacher_book to authenticated;
select pg_temp.own_actor(3);set local role authenticated;
insert into legacy_teacher_book select public.submit_teacher_textbook_request_v1(pg_temp.own_id(601),(select input from own_results where name='textbook'));
select throws_ok($q$select public.mutate_teacher_own_request_v1('textbook',null,'create',(select input from own_results where name='textbook'),null,pg_temp.own_id(601))$q$,'22023','idempotency_key_reused','legacy submission receipt cannot establish a new safe owner origin');
reset role;
select is((select count(*) from public.textbook_purchase_orders where id=(select(payload->>'orderId')::uuid from legacy_teacher_book)),1::bigint,'legacy conflict preserves exactly one original order');
select is((select count(*) from dashboard_private.teacher_request_origins_v1 where request_id=(select(payload->>'orderId')::uuid from legacy_teacher_book)),0::bigint,'legacy conflict creates no owner origin');
select is((select count(*) from dashboard_private.teacher_request_receipts_v1 where request_key=pg_temp.own_id(601)),0::bigint,'legacy conflict creates no new workflow receipt');
-- Selected-class references retain the existing common-read authority while
-- withholding unrelated students, classes, membership arrays and account IDs.
create temp table own_ref_expected as
 select s.id,s.name,e.status from public.students s
 cross join lateral dashboard_private.management_student_enrollments_v1(s.id)e
 where e.class_id=pg_temp.own_id(20);
grant select on own_ref_expected to authenticated;
-- Synthetic malformed legacy projection only. Do not feed this row to the
-- canonical array helper; object keys must not confer a new membership.
insert into public.students(id,name,grade,class_ids,waitlist_class_ids)
values(pg_temp.own_id(51),'MALFORMED_PROJECTION_CANARY','중3',jsonb_build_object(pg_temp.own_id(20)::text,true),jsonb_build_object(pg_temp.own_id(20)::text,true));

create temp table own_ref_results(domain text,payload jsonb);
grant all on own_ref_results to authenticated;
select pg_temp.own_actor(3);set local role authenticated;
insert into own_ref_results select d,public.get_teacher_request_references_v1(d,pg_temp.own_id(20),'2026-11')
 from unnest(array['transfer','withdrawal','makeup','textbook'])d;
select is(public.get_teacher_request_references_v1(d,null,'2026-11'),
 '{"classes":[],"students":[],"rooms":[],"sessions":[],"approver":null}'::jsonb,d||' no class has no global references')
 from unnest(array['transfer','withdrawal','makeup','textbook'])d;
select is(payload,'{"classes":[],"students":[],"rooms":[],"sessions":[],"approver":null}'::jsonb,
 'textbook direct reference call does not duplicate its existing paged picker') from own_ref_results where domain='textbook';
select is(payload->'classes',jsonb_build_array(jsonb_build_object('id',pg_temp.own_id(20),'name','가상 출발반','scheduleStorageMode','legacy')),
 domain||' returns only selected class and minimal metadata') from own_ref_results where domain<>'textbook';
select is(payload->'students',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status) order by name,id) from own_ref_expected),
 domain||' selected students equal final five-source canonical enrolled/waitlisted relation') from own_ref_results where domain in('transfer','withdrawal');
select is(jsonb_array_length(payload->'students'),7,domain||' has exactly the seven related students once') from own_ref_results where domain in('transfer','withdrawal');
select ok(not exists(select 1 from jsonb_array_elements(payload->'students')v where v-array['id','name','status']<>'{}'::jsonb),
 domain||' student DTO has no membership arrays or personal details') from own_ref_results;
select ok(payload::text not like '%PRIVATE_%' and payload::text not like '%OTHER_CLASS_CANARY%'
 and payload::text not like '%UNRELATED_CANARY%' and payload::text not like '%CANCELED_CANARY%' and payload::text not like '%PLANNED_CANARY%'
 and payload::text not like '%MALFORMED_PROJECTION_CANARY%',
 domain||' omits unrelated and private canaries') from own_ref_results;
select is(payload->'students','[]'::jsonb,'makeup never collects students') from own_ref_results where domain='makeup';
select is(payload->'rooms','[]'::jsonb,domain||' does not return makeup room references') from own_ref_results where domain in('transfer','withdrawal');
select is(payload->'sessions','[]'::jsonb,domain||' does not return makeup sessions') from own_ref_results where domain in('transfer','withdrawal');
select is(payload->'approver','null'::jsonb,domain||' does not return an approver') from own_ref_results where domain in('transfer','withdrawal');
select ok((payload->'approver') ?& array['label','status'] and (payload->'approver')-array['label','status']='{}'::jsonb,
 'makeup reference approver exposes no profile UUID') from own_ref_results where domain='makeup';
select lives_ok(format('select public.get_teacher_request_references_v1(%L,%L::uuid,%L)',d,pg_temp.own_id(20),''),
 d||' has no calendar-month dependency') from unnest(array['transfer','withdrawal'])d;
select throws_ok($q$select public.get_teacher_request_references_v1('makeup',pg_temp.own_id(20),'not-a-month')$q$,
 '22023','teacher_request_input_invalid','makeup validates its calendar month');
select is(public.get_teacher_request_references_v1('transfer',pg_temp.own_id(21),'2026-11')->'students',
 jsonb_build_array(jsonb_build_object('id',pg_temp.own_id(45),'name','OTHER_CLASS_CANARY','status','enrolled')),
 'changing selected class returns only its students');
select is(public.get_teacher_request_references_v1('withdrawal',pg_temp.own_id(22),'2026-11')->'students',
 jsonb_build_array(jsonb_build_object('id',pg_temp.own_id(50),'name','가상 등록원장 재원','status','enrolled')),
 'active enrolled registration claim alone remains selectable without roster mirrors');
-- New commands require a real selected-class relationship; existing own
-- records keep their immutable identity even when today's roster changes.
select throws_ok($q$select public.mutate_teacher_own_request_v1('transfer',null,'create',
 (select input||jsonb_build_object('student_id',pg_temp.own_id(45)) from own_results where name='transfer'),null,pg_temp.own_id(891))$q$,
 '22023','teacher_request_student_class_unrelated','new transfer rejects a student from another class');
select throws_ok($q$select public.mutate_teacher_own_request_v1('withdrawal',null,'create',
 (select input||jsonb_build_object('student_id',pg_temp.own_id(47)) from own_results where name='withdrawal'),null,pg_temp.own_id(892))$q$,
 '22023','teacher_request_student_class_unrelated','new withdrawal rejects an unrelated student');
insert into own_results(name,domain,input,request_key)
 select 'refs-waitlisted','withdrawal',input||jsonb_build_object('student_id',pg_temp.own_id(41)),pg_temp.own_id(893) from own_results where name='withdrawal';
select lives_ok($q$select pg_temp.own_create('refs-waitlisted')$q$,'canonical waitlisted student may make an own request');
reset role;
select is((select count(*) from dashboard_private.teacher_request_receipts_v1 where request_key in(pg_temp.own_id(891),pg_temp.own_id(892))),0::bigint,'rejected relationships create no receipts');
-- Local fixture postcondition only; no guard is disabled and no teacher roster
-- write is claimed. Keep the source record, remove only its current relation.
update public.students set waitlist_class_ids='[]' where id=pg_temp.own_id(41);
select pg_temp.own_actor(3);set local role authenticated;
select is(pg_temp.own_current('refs-waitlisted')->'input',(select input from own_results where name='refs-waitlisted'),
 'past own detail retains original fields after current relation disappears');
select lives_ok($q$select pg_temp.own_mutate('refs-waitlisted','update',(select input||'{"memo":"가상 원문 유지 수정"}'::jsonb from own_results where name='refs-waitlisted'),894)$q$,
 'existing own update does not require recreating the past relationship');
select is(pg_temp.own_current('refs-waitlisted')#>>'{input,student_id}',pg_temp.own_id(41)::text,'existing update preserves original student UUID');
reset role;
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from own_effects_before),'reference reads and relationship rejection send nothing');
select * from finish();
rollback;
