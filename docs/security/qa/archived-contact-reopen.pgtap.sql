-- Run only on the owned synthetic DB after the exact six installers + ACL.
-- Requires archived-contact-preinstall-fixture.sql before installation.
-- Every RPC below uses the real service SQL role and original business guards.
begin;
set local role postgres;
set local search_path=public,extensions;
set local timezone='UTC';
set local statement_timeout='45s';
select no_plan();
create temporary table archive_checks(label text primary key, value jsonb);
create temporary table archive_replies(label text primary key, value jsonb);
grant select,insert on archive_replies to service_role;
create function pg_temp.archive_digest() returns jsonb language sql stable as $$
 select jsonb_build_object(
 'tasks',(select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.ops_tasks s),
 'details',(select md5(jsonb_agg(to_jsonb(s) order by task_id)::text) from public.ops_registration_details s),
 'tracks',(select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.ops_registration_subject_tracks s),
 'events',(select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.ops_task_events s),
 'audit',(select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.dashboard_audit_logs s),
 'receipts',(select md5(jsonb_agg(to_jsonb(s) order by actor_id,request_key)::text) from dashboard_private.registration_contact_receipts_v1 s),
 'legacy',(select md5(jsonb_agg(to_jsonb(s) order by actor_id,request_key)::text) from dashboard_private.ops_registration_mutations s),
 'claims',(select count(*) from dashboard_private.registration_contact_claims_v1));
$$;
create function pg_temp.archive_business_digest() returns jsonb language sql stable as $$
 select jsonb_build_object(
 'students',(select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.students s),
 'classes',(select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.classes s),
 'enrollments',(select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.ops_registration_enrollments s),
 'batches',(select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.ops_registration_admission_batches s),
 'customerMessages',(select count(*) from public.ops_registration_customer_messages),
 'notificationEvents',(select count(*) from dashboard_private.notification_events),
 'notificationDeliveries',(select count(*) from dashboard_private.notification_deliveries));
$$;
insert into archive_checks values('business',pg_temp.archive_business_digest());
select set_config('request.jwt.claim.sub','99720000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"sub":"99720000-0000-4000-8000-000000000001","role":"service_role"}',true);

select ok((select (v->>'phase'='closed' and v->>'closureReason'='last_current_track_excluded' and v->>'allPhasesClosed'='false' and v->>'parentPhone' is null) from (select dashboard_private.registration_case_contact_snapshot_v1('98640000-0000-4000-8000-000000000001',true) v) s),'legacy all-archived 1 is excluded, not vacuous terminal');
select ok((select (v->>'phase'='closed' and v->>'closureReason'='last_current_track_excluded' and v->>'allPhasesClosed'='false' and v->>'parentPhone' is null) from (select dashboard_private.registration_case_contact_snapshot_v1('98640000-0000-4000-8000-000000000002',true) v) s),'legacy all-archived 2 is excluded, not vacuous terminal');
select ok((select (v->>'phase'='closed' and v->>'closureReason'='last_current_track_excluded' and v->>'allPhasesClosed'='false' and v->>'parentPhone' is null) from (select dashboard_private.registration_case_contact_snapshot_v1('98640000-0000-4000-8000-000000000003',true) v) s),'legacy all-archived 3 is excluded, not vacuous terminal');
select ok((select (v->>'phase'='closed' and v->>'closureReason'='last_current_track_excluded' and v->>'allPhasesClosed'='false' and v->>'parentPhone' is null) from (select dashboard_private.registration_case_contact_snapshot_v1('98640000-0000-4000-8000-000000000004',true) v) s),'legacy all-archived 4 is excluded, not vacuous terminal');
select ok((select (v->>'phase'='closed' and v->>'closureReason'='last_current_track_excluded' and v->>'allPhasesClosed'='false' and v->>'parentPhone' is null) from (select dashboard_private.registration_case_contact_snapshot_v1('98640000-0000-4000-8000-000000000005',true) v) s),'legacy all-archived 5 is excluded, not vacuous terminal');
select ok((select (v->>'phase'='closed' and v->>'closureReason'='last_current_track_excluded' and v->>'allPhasesClosed'='false' and v->>'parentPhone' is null) from (select dashboard_private.registration_case_contact_snapshot_v1('98640000-0000-4000-8000-000000000006',true) v) s),'legacy all-archived 6 is excluded, not vacuous terminal');
select ok((select (v->>'phase'='closed' and v->>'closureReason'='last_current_track_excluded' and v->>'allPhasesClosed'='false' and v->>'parentPhone' is null) from (select dashboard_private.registration_case_contact_snapshot_v1('98640000-0000-4000-8000-000000000009',true) v) s),'legacy all-archived 9 is excluded, not vacuous terminal');
select ok((select (v->>'phase'='closed' and v->>'closureReason'='last_current_track_excluded' and v->>'allPhasesClosed'='false' and v->>'parentPhone' is null) from (select dashboard_private.registration_case_contact_snapshot_v1('98640000-0000-4000-8000-000000000010',true) v) s),'legacy all-archived 10 is excluded, not vacuous terminal');
select ok((dashboard_private.registration_case_contact_snapshot_v1('98640000-0000-4000-8000-000000000007',true)->>'phase'='open'),'case 7 with live scope or never-created scope stays open');
select ok((dashboard_private.registration_case_contact_snapshot_v1('98640000-0000-4000-8000-000000000008',true)->>'phase'='open'),'case 8 with live scope or never-created scope stays open');
select ok((dashboard_private.registration_case_contact_snapshot_v1('98640000-0000-4000-8000-000000000007',true)->>'parentPhone'='010-0000-9871'),'real open scope preserves guidance contact');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('1-unarchive',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','unarchive','98640000-0000-4000-8000-000000000001','98640000-0000-4000-9000-000000000001',1,1,'{"expectedSubjects": [], "subjects": ["영어"]}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000001'))$rpc$,'1-unarchive succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='open' and contact_generation=2 and student_phone is null and parent_phone is null from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000001'),'case 1: open, generation 2, expected temporary contact');
insert into archive_checks values('duplicate',pg_temp.archive_digest());
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('replay',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','unarchive','98640000-0000-4000-8000-000000000001','98640000-0000-4000-9000-000000000001',1,1,'{"expectedSubjects": [], "subjects": ["영어"]}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000001'))$rpc$,'replay succeeds with actual service role');
set local role postgres;
select is(pg_temp.archive_digest(),(select value from archive_checks where label='duplicate'),'duplicate preserves all business/audit/receipt/claim state');
select ok((select (a.value-'replayed')=(b.value-'replayed') and b.value->>'replayed'='true' from archive_replies a,archive_replies b where a.label='1-unarchive' and b.label='replay'),'identical retry returns original metadata');
insert into archive_checks values('reused-key',pg_temp.archive_digest());
set local role service_role;
select throws_ok($rpc$insert into archive_replies values('reused-hmac',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','unarchive','98640000-0000-4000-8000-000000000001','98640000-0000-4000-9000-000000000001',1,1,'{"expectedSubjects": [], "subjects": ["영어"]}'::jsonb,'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'))$rpc$,'22023',null,'reused-hmac fails atomically');
set local role postgres;
select is(pg_temp.archive_digest(),(select value from archive_checks where label='reused-key'),'reused-key preserves all business/audit/receipt/claim state');
insert into archive_checks values('stale',pg_temp.archive_digest());
set local role service_role;
select throws_ok($rpc$insert into archive_replies values('20-unarchive',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','unarchive','98640000-0000-4000-8000-000000000001','98640000-0000-4000-9000-000000000020',1,1,'{"expectedSubjects": ["영어"], "subjects": ["영어"]}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000020'))$rpc$,'23514',null,'20-unarchive fails atomically');
set local role postgres;
select is(pg_temp.archive_digest(),(select value from archive_checks where label='stale'),'stale preserves all business/audit/receipt/claim state');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('2-save_inquiry',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','save_inquiry','98640000-0000-4000-8000-000000000002','98640000-0000-4000-9000-000000000002',1,1,'{"studentName": "__synthetic_release_student__", "schoolGrade": "중2", "schoolName": "__synthetic_school__", "campus": "본관", "inquiryAt": "2026-10-01T00:00:00Z", "requestNote": "SYNTHETIC_ARCHIVE_NOTE", "priority": "normal", "expectedCommonRevision": 1, "parentPhone": "01000009879", "expectedSubjects": [], "subjects": ["영어"]}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000002'))$rpc$,'2-save_inquiry succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='open' and contact_generation=2 and student_phone is null and parent_phone ='01000009879' from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000002'),'case 2: open, generation 2, expected temporary contact');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('3-save_inquiry',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','save_inquiry','98640000-0000-4000-8000-000000000003','98640000-0000-4000-9000-000000000003',1,1,'{"studentName": "__synthetic_release_student__", "schoolGrade": "중2", "schoolName": "__synthetic_school__", "campus": "본관", "inquiryAt": "2026-10-01T00:00:00Z", "requestNote": "SYNTHETIC_ARCHIVE_NOTE", "priority": "normal", "expectedCommonRevision": 1, "expectedSubjects": [], "subjects": ["영어"]}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000003'))$rpc$,'3-save_inquiry succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='open' and contact_generation=2 and student_phone is null and parent_phone is null from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000003'),'case 3: open, generation 2, expected temporary contact');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('4-update_common',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','update_common','98640000-0000-4000-8000-000000000004','98640000-0000-4000-9000-000000000004',1,1,'{"studentName": "__synthetic_release_student__", "schoolGrade": "중2", "schoolName": "__synthetic_school__", "campus": "본관", "inquiryAt": "2026-10-01T00:00:00Z", "requestNote": "SYNTHETIC_ARCHIVE_NOTE", "priority": "normal", "expectedCommonRevision": 1}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000004'))$rpc$,'4-update_common succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='closed' and contact_generation=1 and student_phone is null and parent_phone is null and contact_closure_reason='last_current_track_excluded' from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000004'),'case 4: closed, generation 1, expected temporary contact');
insert into archive_checks values('failed-save-after-restore',pg_temp.archive_digest());
set local role service_role;
select throws_ok($rpc$insert into archive_replies values('5-save_inquiry',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','save_inquiry','98640000-0000-4000-8000-000000000005','98640000-0000-4000-9000-000000000005',1,1,'{"studentName": "__synthetic_release_student__", "schoolGrade": "중2", "schoolName": "__synthetic_school__", "campus": "본관", "inquiryAt": "2026-10-01T00:00:00Z", "requestNote": "SYNTHETIC_ARCHIVE_NOTE", "priority": "normal", "expectedCommonRevision": 999, "expectedSubjects": [], "subjects": ["영어"]}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000005'))$rpc$,'23514',null,'5-save_inquiry fails atomically');
set local role postgres;
select is(pg_temp.archive_digest(),(select value from archive_checks where label='failed-save-after-restore'),'failed-save-after-restore preserves all business/audit/receipt/claim state');
select ok((select contact_generation=1 and parent_phone='010-0000-9871' and student_phone is not null from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000005'),'failed save rolls back clearing and generation change without revealing old contact');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('25-unarchive',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','unarchive','98640000-0000-4000-8000-000000000005','98640000-0000-4000-9000-000000000025',1,1,'{"expectedSubjects": [], "subjects": ["영어"]}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000025'))$rpc$,'25-unarchive succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='open' and contact_generation=2 and student_phone is null and parent_phone is null from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000005'),'case 5: open, generation 2, expected temporary contact');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('6-unarchive',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','unarchive','98640000-0000-4000-8000-000000000006','98640000-0000-4000-9000-000000000006',1,1,'{"expectedSubjects": [], "subjects": ["영어"]}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000006'))$rpc$,'6-unarchive succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='closed' and contact_generation=1 and student_phone is null and parent_phone is null and contact_closure_reason='all_current_tracks_terminal' from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000006'),'case 6: closed, generation 1, expected temporary contact');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('26-reopen',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','reopen','98640000-0000-4000-8000-000000000006','98640000-0000-4000-9000-000000000026',1,2,'{"trackId": "98640000-0000-4000-8001-000000000006", "destination": "inquiry", "reason": "__synthetic_reopen__"}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000026'))$rpc$,'26-reopen succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='open' and contact_generation=2 and student_phone is null and parent_phone is null from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000006'),'case 6: open, generation 2, expected temporary contact');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('7-unarchive',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','unarchive','98640000-0000-4000-8000-000000000007','98640000-0000-4000-9000-000000000007',1,1,'{"expectedSubjects": ["수학"], "subjects": ["영어", "수학"]}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000007'))$rpc$,'7-unarchive succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='open' and contact_generation=1 and student_phone is null and parent_phone ='010-0000-9871' from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000007'),'case 7: open, generation 1, expected temporary contact');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('27-archive',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','archive','98640000-0000-4000-8000-000000000007','98640000-0000-4000-9000-000000000027',1,2,'{"expectedSubjects": ["영어", "수학"], "subjects": ["수학"]}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000027'))$rpc$,'27-archive succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='open' and contact_generation=1 and student_phone is null and parent_phone ='010-0000-9871' from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000007'),'case 7: open, generation 1, expected temporary contact');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('8-unarchive',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','unarchive','98640000-0000-4000-8000-000000000008','98640000-0000-4000-9000-000000000008',1,1,'{"expectedSubjects": [], "subjects": ["영어"]}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000008'))$rpc$,'8-unarchive succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='open' and contact_generation=1 and student_phone is null and parent_phone ='010-0000-9871' from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000008'),'case 8: open, generation 1, expected temporary contact');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('9-save_inquiry',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','save_inquiry','98640000-0000-4000-8000-000000000009','98640000-0000-4000-9000-000000000009',1,1,'{"studentName": "__synthetic_release_student__", "schoolGrade": "중2", "schoolName": "__synthetic_school__", "campus": "본관", "inquiryAt": "2026-10-01T00:00:00Z", "requestNote": "SYNTHETIC_ARCHIVE_NOTE", "priority": "normal", "expectedCommonRevision": 1, "expectedSubjects": [], "subjects": []}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000009'))$rpc$,'9-save_inquiry succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='closed' and contact_generation=1 and student_phone is null and parent_phone is null and contact_closure_reason='last_current_track_excluded' from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000009'),'case 9: closed, generation 1, expected temporary contact');
insert into archive_checks values('closed-empty-incoming',pg_temp.archive_digest());
set local role service_role;
select throws_ok($rpc$insert into archive_replies values('10-save_inquiry',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','save_inquiry','98640000-0000-4000-8000-000000000010','98640000-0000-4000-9000-000000000010',1,1,'{"studentName": "__synthetic_release_student__", "schoolGrade": "중2", "schoolName": "__synthetic_school__", "campus": "본관", "inquiryAt": "2026-10-01T00:00:00Z", "requestNote": "SYNTHETIC_ARCHIVE_NOTE", "priority": "normal", "expectedCommonRevision": 1, "parentPhone": "01000009879", "expectedSubjects": [], "subjects": []}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000010'))$rpc$,'23514',null,'10-save_inquiry fails atomically');
set local role postgres;
select is(pg_temp.archive_digest(),(select value from archive_checks where label='closed-empty-incoming'),'closed-empty-incoming preserves all business/audit/receipt/claim state');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('31-close',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','close','98640000-0000-4000-8000-000000000001','98640000-0000-4000-9000-000000000031',2,2,'{"reason": "whole_case_cancelled"}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000031'))$rpc$,'31-close succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='closed' and contact_generation=2 and student_phone is null and parent_phone is null and contact_closure_reason='whole_case_cancelled' from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000001'),'case 1: closed, generation 2, expected temporary contact');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('32-unarchive',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','unarchive','98640000-0000-4000-8000-000000000001','98640000-0000-4000-9000-000000000032',2,3,'{"expectedSubjects": ["영어"], "subjects": ["영어"]}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000032'))$rpc$,'32-unarchive succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='closed' and contact_generation=2 and student_phone is null and parent_phone is null and contact_closure_reason='whole_case_cancelled' from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000001'),'case 1: closed, generation 2, expected temporary contact');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('33-reopen',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','reopen','98640000-0000-4000-8000-000000000001','98640000-0000-4000-9000-000000000033',2,4,'{"trackId": "98640000-0000-4000-8001-000000000001", "destination": "inquiry", "reason": "__synthetic_explicit_cancel_reopen__"}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000033'))$rpc$,'33-reopen succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='open' and contact_generation=3 and student_phone is null and parent_phone is null from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000001'),'case 1: open, generation 3, expected temporary contact');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('34-update_common',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','update_common','98640000-0000-4000-8000-000000000001','98640000-0000-4000-9000-000000000034',3,5,'{"studentName": "__synthetic_release_student__", "schoolGrade": "중2", "schoolName": "__synthetic_school__", "campus": "본관", "inquiryAt": "2026-10-01T00:00:00Z", "requestNote": "SYNTHETIC_ARCHIVE_NOTE", "priority": "normal", "expectedCommonRevision": 1, "parentPhone": "01000009879"}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000034'))$rpc$,'34-update_common succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='open' and contact_generation=3 and student_phone is null and parent_phone ='01000009879' from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000001'),'case 1: open, generation 3, expected temporary contact');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('35-archive',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','archive','98640000-0000-4000-8000-000000000001','98640000-0000-4000-9000-000000000035',3,6,'{"expectedSubjects": ["영어"], "subjects": []}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000035'))$rpc$,'35-archive succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='closed' and contact_generation=3 and student_phone is null and parent_phone is null and contact_closure_reason='last_current_track_excluded' from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000001'),'case 1: closed, generation 3, expected temporary contact');
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('36-unarchive',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','unarchive','98640000-0000-4000-8000-000000000001','98640000-0000-4000-9000-000000000036',3,7,'{"expectedSubjects": [], "subjects": ["영어"]}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000036'))$rpc$,'36-unarchive succeeds with actual service role');
set local role postgres;
select ok((select contact_phase='open' and contact_generation=4 and student_phone is null and parent_phone is null from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000001'),'case 1: open, generation 4, expected temporary contact');
insert into archive_checks values('old-success-after-new-generation',pg_temp.archive_digest());
set local role service_role;
select lives_ok($rpc$insert into archive_replies values('old-replay',public.mutate_registration_contact_v1('99720000-0000-4000-8000-000000000001','unarchive','98640000-0000-4000-8000-000000000001','98640000-0000-4000-9000-000000000001',1,1,'{"expectedSubjects": [], "subjects": ["영어"]}'::jsonb,'0000000000000000000000000000000000000000000000000000000000000001'))$rpc$,'old-replay succeeds with actual service role');
set local role postgres;
select is(pg_temp.archive_digest(),(select value from archive_checks where label='old-success-after-new-generation'),'old-success-after-new-generation preserves all business/audit/receipt/claim state');
select ok((select contact_phase='open' and contact_generation=4 and student_phone is null and parent_phone is null from public.ops_registration_details where task_id='98640000-0000-4000-8000-000000000001'),'case 1: open, generation 4, expected temporary contact');
select ok((not exists(select 1 from archive_replies where value::text like '%0100000%' or value::text like '%010-0000%' or value::text like '%SYNTHETIC_ARCHIVE_NOTE%')),'all fresh/replayed responses remain contact-free metadata');
select is(pg_temp.archive_business_digest(),(select value from archive_checks where label='business'),'master IDs/facts/MakeEdu linkage, roster/accounting and provider work unchanged');
select ok((select count(*)=0 from dashboard_private.registration_contact_claims_v1),'no trusted claims leak after success or failure');
set constraints all immediate;
select * from finish();
rollback;
