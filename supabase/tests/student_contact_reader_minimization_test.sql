-- Synthetic only, after student-contact-reader-minimization-draft.sql.
begin;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('99480000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'privacy-reader-fixture@example.invalid',crypt('synthetic-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
insert into public.profiles(id,role,name,email,created_at,updated_at)
values ('99480000-0000-4000-8000-000000000001','admin','__privacy_reader_actor__','privacy-reader-fixture@example.invalid',now(),now())
on conflict (id) do update set role = 'admin';
insert into public.students(id,name,uid,school,grade,contact,parent_contact,status,class_ids,waitlist_class_ids)
values ('99480000-0000-4000-8000-000000000101','__privacy_reader_student__','SYNTHETIC-101','__privacy_school__','중2',
  '01000001001','01000001002','퇴원','["99480000-0000-4000-8000-000000000201"]','[]');
insert into public.classes(id,name,class_type,subject,grade,teacher,schedule,room,capacity,fee,status,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan)
values ('99480000-0000-4000-8000-000000000201','__privacy_reader_class__','정규','영어','중2','__privacy_teacher__',
  '월 18:00','1강',12,300000,'수강','["99480000-0000-4000-8000-000000000101"]','[]','[]','[]','{}');
create temporary table privacy_reader_before as select to_jsonb(s) value from public.students s where id = '99480000-0000-4000-8000-000000000101';
create temporary table privacy_reader_audit_before as select count(*) value from public.dashboard_audit_logs;

set local role authenticated;
select set_config('request.jwt.claim.sub','99480000-0000-4000-8000-000000000001',true);
create temporary table privacy_reader_results as
select
  public.list_management_numbered_page_v1('students','{"kind":"students","search":"__privacy_reader_student__","status":null,"schoolCategory":null,"school":null,"grade":null}',1,10,'[]') numbered,
  (select row_data from public.list_management_page_v1('students','{"kind":"students","search":"__privacy_reader_student__","status":null,"schoolCategory":null,"school":null,"grade":null}',null,null,30) limit 1) cursor_row,
  public.get_management_detail_v1('students','99480000-0000-4000-8000-000000000101') detail,
  public.list_management_detail_relation_page_v1('classes','99480000-0000-4000-8000-000000000201','registered_students',null,null,30) relation;

select is(numbered #>> '{rows,0,uid}','SYNTHETIC-101','numbered producer returns displayed student number') from privacy_reader_results;
select is(cursor_row ->> 'uid','SYNTHETIC-101','cursor producer returns displayed student number') from privacy_reader_results;
select is(detail #>> '{record,uid}','SYNTHETIC-101','detail producer preserves displayed student number') from privacy_reader_results;
select is(relation #>> '{page,rows,0,uid}','SYNTHETIC-101','class roster producer returns displayed student number') from privacy_reader_results;
select ok(numbered #> '{rows,0,contact}' = 'null'::jsonb and numbered #> '{rows,0,parentContact}' = 'null'::jsonb,'numbered contact tombstones remain compatible with old consumers') from privacy_reader_results;
select ok(cursor_row -> 'contact' = 'null'::jsonb and cursor_row -> 'parentContact' = 'null'::jsonb,'cursor contact tombstones contain no values') from privacy_reader_results;
select ok(detail #> '{record,contact}' = 'null'::jsonb and detail #> '{record,parentContact}' = 'null'::jsonb,'detail contact tombstones contain no values') from privacy_reader_results;
select ok(relation #> '{page,rows,0,contact}' = 'null'::jsonb and relation #> '{page,rows,0,parentContact}' = 'null'::jsonb,'class roster contact tombstones contain no values') from privacy_reader_results;
select ok(numbered #> '{rows,0,makeeduDetailId}' = 'null'::jsonb and detail #> '{record,makeeduDetailId}' = 'null'::jsonb,'unverified mapping remains null with no guessed link') from privacy_reader_results;
select ok(numbered #>> '{rows,0,status}'='재원' and numbered #>> '{rows,0,storedStatus}'='퇴원' and numbered #>> '{rows,0,registeredCount}'='1','derived enrollment status and stored status remain distinct') from privacy_reader_results;
select is(detail #>> '{enrollments,rows,0,classId}','99480000-0000-4000-8000-000000000201','operational class relationship survives contact exclusion') from privacy_reader_results;
select throws_ok($$select public.list_management_numbered_page_v1('students','{"kind":"students","search":"","status":null,"schoolCategory":null,"school":null,"grade":null}',1,10,'[{"id":"contact","desc":false}]')$$,'22023','management_sort_invalid','removed student phone sorting fails with exact domain SQLSTATE');
select throws_ok($$select public.list_management_numbered_page_v1('students','{"kind":"students","search":"","status":null,"schoolCategory":null,"school":null,"grade":null}',1,10,'[{"id":"parentContact","desc":false}]')$$,'22023','management_sort_invalid','removed parent phone sorting fails with exact domain SQLSTATE');
reset role;
select is((select to_jsonb(s) from public.students s where id = '99480000-0000-4000-8000-000000000101'),(select value from privacy_reader_before),'readers do not clear historical student data or alter internal UUID');
select is((select count(*) from public.dashboard_audit_logs),(select value from privacy_reader_audit_before),'reader execution leaves the audit history unchanged');
select ok(not exists(select 1 from pg_proc where oid in (
  'public.list_management_numbered_page_v1(text,jsonb,integer,integer,jsonb)'::regprocedure,
  'public.list_management_page_v1(text,jsonb,text,uuid,integer)'::regprocedure,
  'public.get_management_detail_v1(text,uuid)'::regprocedure,
  'public.list_management_detail_relation_page_v1(text,uuid,text,text,uuid,integer)'::regprocedure) and prosecdef),'all four readers retain INVOKER security');
select * from finish();
rollback;
