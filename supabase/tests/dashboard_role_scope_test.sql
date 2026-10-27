begin;
select no_plan();
set local statement_timeout='30s';
create function pg_temp.scope_id(n integer) returns uuid language sql immutable as $$select ('af230000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.scope_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.scope_id(n)::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.scope_id(n),'role','authenticated')::text,true);
end$$;
-- Pre-reserve the normal signup-linked catalog, as in the existing fixtures.
insert into public.teacher_catalogs(id,name,subjects,account_email) values(pg_temp.scope_id(103),'합성 영어 교사',array['영어'],'scope-3@synthetic.invalid');
insert into auth.users(id,instance_id,aud,role,email) select pg_temp.scope_id(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','scope-'||n||'@synthetic.invalid' from generate_series(1,5)n;
insert into public.profiles(id,role,name) select pg_temp.scope_id(n),case n when 1 then 'admin' when 2 then 'staff' when 3 then 'teacher' when 4 then 'assistant' else 'viewer' end,'합성 역할 '||n from generate_series(1,5)n on conflict(id) do update set role=excluded.role,name=excluded.name;
insert into public.students(id,name,contact,parent_contact) values(pg_temp.scope_id(101),'합성 학생','PRIVATE_CONTACT_CANARY','PRIVATE_PARENT_CANARY');
insert into public.classes(id,name,subject,teacher) values(pg_temp.scope_id(102),'합성 영어','영어','합성 교사');
insert into public.ops_tasks(id,type,title,status,priority,requested_by,assignee_id) values
(pg_temp.scope_id(201),'general','NOT_RETEST_CANARY','requested','normal',pg_temp.scope_id(4),pg_temp.scope_id(4)),
(pg_temp.scope_id(202),'word_retest','합성 재시험','requested','normal',pg_temp.scope_id(4),pg_temp.scope_id(4)),
(pg_temp.scope_id(203),'transfer','합성 전반','requested','normal',pg_temp.scope_id(3),pg_temp.scope_id(3));
update public.students set class_ids=jsonb_build_array(pg_temp.scope_id(102)) where id=pg_temp.scope_id(101);
update public.classes set student_ids=jsonb_build_array(pg_temp.scope_id(101)),textbook_ids=jsonb_build_array(pg_temp.scope_id(104)) where id=pg_temp.scope_id(102);
insert into public.textbooks(id,name,title,subject,school_level,grade_level,school_levels,grade_levels,sub_subject) values(pg_temp.scope_id(104),'내부 교재명','공개 교재 제목','english','middle','m3',array['middle'],array['m3'],'단어');
insert into public.students(id,name,contact,parent_contact) values(pg_temp.scope_id(105),'다른 과목 학생','EXCLUDED_CONTACT_CANARY','EXCLUDED_PARENT_CANARY');
insert into public.classes(id,name,subject,teacher,student_ids) values(pg_temp.scope_id(106),'다른 과목 수업','수학','다른 교사',jsonb_build_array(pg_temp.scope_id(105)));
create temp table effects_before as select (select count(*) from dashboard_private.notification_request_ledger) ledger,(select count(*) from dashboard_private.notification_events) events;
select pg_temp.scope_actor(4);
set local role authenticated;
select is((select count(*) from public.ops_tasks where id=pg_temp.scope_id(201)),0::bigint,'assistant cannot read its own non-retest parent');
select is((select count(*) from public.ops_tasks where id=pg_temp.scope_id(202)),1::bigint,'assistant retains its existing retest parent');
select is(dashboard_private.can_read_ops_task_v1(pg_temp.scope_id(201)),false,'child/event helper also denies non-retest ownership');
select is(dashboard_private.can_read_ops_task_v1(pg_temp.scope_id(202)),true,'child helper retains retest ownership');
select is((select count(*) from public.students where id=pg_temp.scope_id(101)),0::bigint,'assistant raw students do not disclose contact fields');
select is((select count(*) from public.classes where id=pg_temp.scope_id(102)),0::bigint,'assistant raw classes are not the minimal retest reference');
select throws_ok($q$select public.create_ops_task_v2('{"type":"general","title":"금지 생성","status":"requested"}',pg_temp.scope_id(301))$q$,'42501','ops_task_access_denied','assistant non-retest create denied before mutation/replay');
select throws_ok($q$select public.ai_agent_user_api_v1('list','{}')$q$,'42501','ai_agent_forbidden','assistant AI read is denied by actual SQL role');
select throws_ok($q$select public.ai_agent_user_api_v1('create',jsonb_build_object('title','금지','body','금지','idempotencyKey',pg_temp.scope_id(302)))$q$,'42501','ai_agent_forbidden','assistant AI write is denied before receipt');
select throws_ok($q$update public.profiles set role='admin' where id=pg_temp.scope_id(4)$q$,'42501',null,'assistant cannot update its own authorization role');
reset role;
update public.profiles set role='assistant' where id=pg_temp.scope_id(4);
select pg_temp.scope_actor(3);
set local role authenticated;
select throws_ok($q$select public.create_ops_task_v2('{"type":"transfer","title":"금지 교사 전반","status":"requested"}',pg_temp.scope_id(303))$q$,'42501','ops_task_access_denied','teacher operational create is denied before type detail validation');
select throws_ok($q$select public.add_ops_task_comment_v2(pg_temp.scope_id(203),'금지 댓글',pg_temp.scope_id(304))$q$,'42501','ops_task_access_denied','teacher own operation comment is a write and denied');
select lives_ok($q$select public.create_textbook_request_v1(null,'신규 요청 교재',null,null,1,0,'')$q$,'teacher may submit a new request without enabling other operational writes');
reset role;
select is((select count(*) from dashboard_private.notification_request_ledger),(select ledger from effects_before),'denied operations create zero mutation receipts');
select is((select count(*) from dashboard_private.notification_events),(select events from effects_before),'denied operations create zero notification events');
select pg_temp.scope_actor(2);
set local role authenticated;
select lives_ok($q$select public.create_ops_task_v2('{"type":"general","title":"관리팀 정상","status":"requested"}',pg_temp.scope_id(305))$q$,'staff ordinary workflow remains available');
reset role;
select pg_temp.scope_actor(5);
set local role authenticated;
select is((select role from public.profiles where id=pg_temp.scope_id(5)),'viewer','viewer own authentication profile remains visible');
reset role;
-- Exact previous receipts must not bypass a newly restricted role/type.
insert into dashboard_private.notification_request_ledger(request_id,request_kind,request_fingerprint,response_payload) values
(pg_temp.scope_id(401),'add_ops_task_comment_v2',md5(jsonb_build_object('actor',pg_temp.scope_id(4),'task_id',pg_temp.scope_id(201),'body','old-body')::text),'{"private":"RECEIPT_CANARY"}'),
(pg_temp.scope_id(402),'transition_ops_task_status_v2',md5(jsonb_build_object('actor',pg_temp.scope_id(4),'task_id',pg_temp.scope_id(201),'status','confirmed','expected_updated_at','2026-10-23T00:00:00Z'::timestamptz)::text),'{"private":"RECEIPT_CANARY"}'),
(pg_temp.scope_id(403),'update_ops_task_v2',md5(jsonb_build_object('actor',pg_temp.scope_id(4),'task_id',pg_temp.scope_id(201),'input','{"task":{"title":"old"}}'::jsonb,'expected_updated_at','2026-10-23T00:00:00Z'::timestamptz)::text),'{"private":"RECEIPT_CANARY"}');
select pg_temp.scope_actor(4);
set local role authenticated;
select throws_ok($q$select public.add_ops_task_comment_v2(pg_temp.scope_id(201),'old-body',pg_temp.scope_id(401))$q$,'42501','ops_task_access_denied','old comment receipt cannot disclose non-retest response');
select throws_ok($q$select public.transition_ops_task_status_v2(pg_temp.scope_id(201),'confirmed','2026-10-23T00:00:00Z',pg_temp.scope_id(402))$q$,'42501','ops_task_access_denied','old transition receipt cannot disclose non-retest response');
select throws_ok($q$select public.update_ops_task_v2(pg_temp.scope_id(201),'{"task":{"title":"old"}}','2026-10-23T00:00:00Z',pg_temp.scope_id(403))$q$,'42501','ops_task_access_denied','old update receipt cannot disclose non-retest response');
select throws_ok($q$select public.create_ops_task_v2('{"type":"word_retest","task":{"type":"textbook","title":"nested bypass","status":"requested"}}',pg_temp.scope_id(404))$q$,'42501','ops_task_access_denied','outer word type cannot conceal a nested textbook mutation');
select lives_ok($q$select public.create_ops_task_v2(jsonb_build_object('task',jsonb_build_object('type',' word_retest ','title','중첩 정상 재시험','status','requested','student_id',pg_temp.scope_id(101),'class_id',pg_temp.scope_id(102),'student_name','합성 학생','class_name','합성 영어'),'word_retest',jsonb_build_object('teacher_catalog_id',pg_temp.scope_id(103),'teacher_name','합성 영어 교사','test_at','2026-10-23T09:00:00+09:00','branch','본관','unit','1')),pg_temp.scope_id(405))$q$,'real nested producer shape keeps its normal retest creation');
select is(jsonb_array_length(public.get_word_retest_reference_data_v1()->'students'),1,'minimum reference omits the unrelated student');
select is(jsonb_array_length(public.get_word_retest_reference_data_v1()->'classes'),1,'minimum reference omits the unrelated class');
select ok(public.get_word_retest_reference_data_v1()::text not like '%CANARY%','minimal reference contains neither contact canaries nor non-retest data');
select ok(not exists(select 1 from jsonb_array_elements(public.get_word_retest_reference_data_v1()->'profiles')p where p ?| array['email','login_id','password']),'profile references never include account fields');
select is(public.get_word_retest_reference_data_v1()#>>'{students,0,class_ids,0}',pg_temp.scope_id(102)::text,'student selection retains its permitted roster relation');
select is(public.get_word_retest_reference_data_v1()#>>'{classes,0,textbook_ids,0}',pg_temp.scope_id(104)::text,'class selection retains its permitted textbook relation');
select is(public.get_word_retest_reference_data_v1()#>>'{textbooks,0,title}','공개 교재 제목','safe reference preserves the existing title-before-name label');
select is(public.validate_word_retest_references_v1(pg_temp.scope_id(101),pg_temp.scope_id(102),pg_temp.scope_id(104),pg_temp.scope_id(103)),true,'completion preflight retains valid references without raw access');
select is(public.validate_word_retest_references_v1(pg_temp.scope_id(105),pg_temp.scope_id(102),pg_temp.scope_id(104),pg_temp.scope_id(103)),false,'completion preflight rejects an unrelated roster');
select is(public.validate_word_retest_references_v1(pg_temp.scope_id(105),pg_temp.scope_id(106),pg_temp.scope_id(104),pg_temp.scope_id(103)),false,'completion preflight does not expand assistant to another subject');
select throws_ok($q$select dashboard_private.assert_ops_task_write_scope_v1(pg_temp.scope_id(202))$q$,'42501',null,'new private scope guard cannot be called directly');
reset role;
update public.students set class_ids='[]',waitlist_class_ids=jsonb_build_array(pg_temp.scope_id(102)) where id=pg_temp.scope_id(101);
select pg_temp.scope_actor(2);
set local role authenticated;
select is(public.validate_word_retest_references_v1(pg_temp.scope_id(101),pg_temp.scope_id(102),pg_temp.scope_id(104),pg_temp.scope_id(103)),false,'staff completion preserves enrolled-on-both-sides contract, not waitlist or one-sided roster');
reset role;
update public.students set class_ids=jsonb_build_array(pg_temp.scope_id(102)),waitlist_class_ids='[]' where id=pg_temp.scope_id(101);
select pg_temp.scope_actor(3);
set local role authenticated;
select ok(public.get_word_retest_reference_data_v1()::text not like '%CANARY%','teacher retest options use the same minimal reference projection after raw management reads close');
select throws_ok($q$update public.profiles set role='staff' where id=pg_temp.scope_id(3)$q$,'42501',null,'teacher cannot change its own authorization role');
select is((select role from public.profiles where id=pg_temp.scope_id(3)),'teacher','teacher can still read its authentication profile');
reset role;
select is((select role from public.profiles where id=pg_temp.scope_id(4)),'assistant','denied role update preserves original assistant identity');
select pg_temp.scope_actor(2);
set local role authenticated;
select is((select count(*) from public.students where id=pg_temp.scope_id(101)),1::bigint,'staff keeps its existing reference reads');
reset role;

-- Alert fixtures use the existing canonical event/delivery relation, never a
-- forged metadata tag as authorization. No worker or external provider runs.
insert into dashboard_private.notification_events(id,workflow_key,event_key,source_type,source_id,occurrence_key,actor_profile_id,occurred_at,payload_schema_version,payload,rule_snapshot)
select pg_temp.scope_id(500+n),case when n<3 then 'word_retests' else 'tasks' end,'scope.fixture.'||n,'ops_task_event','scope-source-'||n,'scope-occurrence-'||n,pg_temp.scope_id(2),now(),1,'{}','[]' from generate_series(1,3)n;
insert into dashboard_private.notification_deliveries(id,event_id,rule_id,rule_revision,template_id,channel_key,audience_key,target_set_hash,target_kind,target_key,target_profile_id,target_snapshot,status,dedupe_key,rendered_title,rendered_body,href,scheduled_for,max_attempts)
select pg_temp.scope_id(510+n),pg_temp.scope_id(500+n),r.id,r.revision,r.active_template_id,'in_app','assigned_assistant','scope-target-'||n,'profile',pg_temp.scope_id(4)::text,pg_temp.scope_id(4),'{}','sent','scope-dedupe-'||n,'scope-title-'||n,'scope-body-'||n,'/admin/word-retests',now(),1
from generate_series(1,3)n cross join lateral (select * from dashboard_private.notification_rules where active_template_id is not null order by id limit 1)r;
insert into public.dashboard_notifications(id,recipient_profile_id,actor_profile_id,type,title,body,href,metadata,source_delivery_id)
select pg_temp.scope_id(520+n),pg_temp.scope_id(4),e.actor_profile_id,'notification_control_plane',d.rendered_title,d.rendered_body,d.href,
jsonb_build_object('workflow_key',e.workflow_key,'event_key',e.event_key,'source_type',e.source_type,'source_id',e.source_id,'delivery_id',d.id)||case when n=2 then '{"legacy_projection":true}'::jsonb else '{}'::jsonb end,d.id
from generate_series(1,3)n join dashboard_private.notification_deliveries d on d.id=pg_temp.scope_id(510+n) join dashboard_private.notification_events e on e.id=d.event_id;
insert into public.dashboard_notifications(id,recipient_profile_id,type,title,body,href,metadata)
values(pg_temp.scope_id(524),pg_temp.scope_id(4),'notification_control_plane','fake','PRIVATE_NOTIFICATION_CANARY','/admin/word-retests','{"workflow_key":"word_retests"}');
select pg_temp.scope_actor(4);
set local role authenticated;
select is((select count(*) from public.dashboard_notifications where id in (pg_temp.scope_id(521),pg_temp.scope_id(522))),2::bigint,'assistant reads canonical and legacy retest alerts without requiring taskId in root href');
select is((select count(*) from public.dashboard_notifications where id in (pg_temp.scope_id(523),pg_temp.scope_id(524))),0::bigint,'assistant cannot read other workflow or forged retest metadata');
select is(dashboard_private.can_read_word_retest_notification_v1(pg_temp.scope_id(521),pg_temp.scope_id(2)),false,'notification predicate cannot impersonate another recipient');
select throws_ok($q$insert into public.dashboard_notifications(recipient_profile_id,type,title,body,metadata) values(pg_temp.scope_id(4),'notification_control_plane','forged','PRIVATE','{"workflow_key":"word_retests"}')$q$,'42501',null,'assistant cannot raw-create a retest-looking alert');
with changed as(update public.dashboard_notifications set body='FORGED' where id=pg_temp.scope_id(521) returning id) select is(count(*),0::bigint,'assistant cannot raw-edit a canonical alert') from changed;
with changed as(delete from public.dashboard_notifications where id=pg_temp.scope_id(521) returning id) select is(count(*),0::bigint,'assistant cannot raw-delete a canonical alert') from changed;
reset role;
select is((select body from public.dashboard_notifications where id=pg_temp.scope_id(521)),'scope-body-1','denied alert writes preserve canonical content');
-- Processing remains management-only even for a former teacher approver and
-- for the server approval path resolving its actual actor from p_patch.
select pg_temp.scope_actor(3);
set local role authenticated;
select throws_ok($q$select public.create_makeup_request_v2('{}',pg_temp.scope_id(530))$q$,'42501','makeup_request_transition_forbidden','teacher cannot create makeup request');
select throws_ok($q$select public.transition_makeup_request_v2(pg_temp.scope_id(531),'resubmit','{}','revision_requested',pg_temp.scope_id(532))$q$,'42501','makeup_request_transition_forbidden','teacher cannot resubmit even before data lookup');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
set local role service_role;

reset role;
insert into public.makeup_requests(id,status,subject,approval_group,requester_id,approver_profile_id,class_name,request_kind,reason)
values(pg_temp.scope_id(531),'approval_pending','영어','english',pg_temp.scope_id(3),pg_temp.scope_id(1),'합성 수업','cancel_only','합성 사유');
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select throws_ok($q$select public.transition_makeup_request_v2(pg_temp.scope_id(531),'approve',jsonb_build_object('actor_profile_id',pg_temp.scope_id(3)),'approval_pending',pg_temp.scope_id(533))$q$,'42501','makeup_request_transition_forbidden','server approval rejects actual teacher actor');
reset role;
select pg_temp.scope_actor(2);
set local role authenticated;
select throws_ok($q$select public.transition_makeup_request_v2(pg_temp.scope_id(531),'revision_requested','{"note":"관리팀 보완"}','approval_pending',pg_temp.scope_id(534))$q$,'42501','makeup_request_transition_forbidden','non-director staff cannot decide revision');
reset role;
select is((select requester_id from public.makeup_requests where id=pg_temp.scope_id(531)),pg_temp.scope_id(3),'manager processing preserves original requester');
select is((select approver_profile_id from public.makeup_requests where id=pg_temp.scope_id(531)),pg_temp.scope_id(1),'manager processing preserves original approver');


-- Hidden management/settings menus also have a direct server boundary.
select pg_temp.scope_actor(4);
set local role authenticated;
select throws_ok($q$select public.list_management_page_v1(null,null,null,null,null)$q$,'42501','management_read_forbidden','assistant direct public.list_management_page_v1 is denied before query');
select throws_ok($q$select public.list_management_numbered_page_v1(null,null,null,null,null)$q$,'42501','management_read_forbidden','assistant direct public.list_management_numbered_page_v1 is denied before query');
select throws_ok($q$select public.get_management_stats_v1(null,null)$q$,'42501','management_read_forbidden','assistant direct public.get_management_stats_v1 is denied before query');
select throws_ok($q$select public.list_management_filter_options_v1(null,null)$q$,'42501','management_read_forbidden','assistant direct public.list_management_filter_options_v1 is denied before query');
select throws_ok($q$select public.get_management_detail_v1('students',pg_temp.scope_id(101))$q$,'42501','management_read_forbidden','assistant direct public.get_management_detail_v1 is denied before query');
select throws_ok($q$select public.list_management_detail_relation_page_v1(null,null,null)$q$,'42501','management_read_forbidden','assistant direct public.list_management_detail_relation_page_v1 is denied before query');
select throws_ok($q$select public.list_management_class_textbook_candidates_v1(null,null,null,null,null,null)$q$,'42501','management_read_forbidden','assistant direct public.list_management_class_textbook_candidates_v1 is denied before query');
select throws_ok($q$select textbook_settings_private.guard_read_v1()$q$,'42501','management_read_forbidden','assistant direct textbook_settings_private.guard_read_v1 is denied before query');
reset role;
select pg_temp.scope_actor(3);
set local role authenticated;
select throws_ok($q$select public.list_management_page_v1(null,null,null,null,null)$q$,'42501','management_read_forbidden','teacher direct public.list_management_page_v1 is denied before query');
select throws_ok($q$select public.list_management_numbered_page_v1(null,null,null,null,null)$q$,'42501','management_read_forbidden','teacher direct public.list_management_numbered_page_v1 is denied before query');
select throws_ok($q$select public.get_management_stats_v1(null,null)$q$,'42501','management_read_forbidden','teacher direct public.get_management_stats_v1 is denied before query');
select throws_ok($q$select public.list_management_filter_options_v1(null,null)$q$,'42501','management_read_forbidden','teacher direct public.list_management_filter_options_v1 is denied before query');
select throws_ok($q$select public.get_management_detail_v1('students',pg_temp.scope_id(101))$q$,'42501','management_read_forbidden','teacher direct public.get_management_detail_v1 is denied before query');
select throws_ok($q$select public.list_management_detail_relation_page_v1(null,null,null)$q$,'42501','management_read_forbidden','teacher direct public.list_management_detail_relation_page_v1 is denied before query');
select throws_ok($q$select public.list_management_class_textbook_candidates_v1(null,null,null,null,null,null)$q$,'42501','management_read_forbidden','teacher direct public.list_management_class_textbook_candidates_v1 is denied before query');
select throws_ok($q$select textbook_settings_private.guard_read_v1()$q$,'42501','management_read_forbidden','teacher direct textbook_settings_private.guard_read_v1 is denied before query');
reset role;

select * from finish();
rollback;
