-- SYNTHETIC ONLY. After inherited actor/student fixtures, before privacy installation.
-- Existing guards, RLS and business functions remain enabled. No real records.
begin;
set local role postgres;
set local timezone='UTC';
select set_config('request.jwt.claim.sub','99720000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"99720000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.ops_tasks(id,title,type,status,priority,student_id,student_name,requested_by)
select ('98640000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '__synthetic_archived_regression__','registration','requested','normal',
 '78000000-0000-4000-8000-000000000201','__synthetic_release_student__','99720000-0000-4000-8000-000000000001'
from generate_series(1,10) n;
insert into public.ops_registration_details(task_id,inquiry_at,school_grade,school_name,parent_phone,student_phone,request_note,pipeline_status,common_revision)
select ('98640000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '2026-10-01T00:00:00Z','중2','__synthetic_school__','010-0000-9871','010-0000-9872','SYNTHETIC_ARCHIVE_NOTE','0. 등록 문의',1
from generate_series(1,10) n;
insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status,workflow_status,workflow_revision,migration_review_required,archived_at,archived_by)
select ('98640000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,('98640000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '영어','inquiry',case when n=6 then 'not_registered' else 'inquiry' end,1,false,'2026-10-01T00:00:00Z','99720000-0000-4000-8000-000000000001'
from generate_series(1,10) n where n<>8;
insert into public.ops_registration_subject_tracks(id,task_id,subject,pipeline_status,workflow_status,workflow_revision,migration_review_required)
values('98640000-0000-4000-8002-000000000007','98640000-0000-4000-8000-000000000007','수학','inquiry','inquiry',1,false);
set constraints all immediate;
commit;
