begin;
set local lock_timeout='5s';
set local statement_timeout='10s';

-- Same five enrollment sources and caller RLS as the single-student helper.
-- Lists need all summaries, so materialize visible rows once instead of running
-- the complete relationship/RLS plan once for every student (and sort/filter).
create function dashboard_private.management_student_enrollment_summaries_v1()
returns table(student_id uuid,value jsonb)
language sql stable security invoker set search_path='' as $$
 with students as materialized (
   select id,id::text id_text,class_ids,waitlist_class_ids from public.students
 ), classes as materialized (
   select id,id::text id_text,student_ids,waitlist_ids from public.classes
 ), candidates as (
   select s.id student_id,c.id class_id,e.status='enrolled' and e.roster_active enrolled
   from public.ops_registration_enrollments e join students s on s.id=e.student_id join classes c on c.id=e.class_id
   where (e.status='enrolled' and e.roster_active) or e.status in('waitlist','waitlisted')
   union all
   select s.id,c.id,true from students s cross join lateral jsonb_array_elements_text(coalesce(s.class_ids,'[]')) d(id)
   join classes c on c.id_text=d.id
   union all
   select s.id,c.id,false from students s cross join lateral jsonb_array_elements_text(coalesce(s.waitlist_class_ids,'[]')) d(id)
   join classes c on c.id_text=d.id
   union all
   select s.id,c.id,true from classes c join students s on coalesce(c.student_ids,'[]') ? s.id_text
   union all
   select s.id,c.id,false from classes c join students s on coalesce(c.waitlist_ids,'[]') ? s.id_text
 ), canonical as (
   select student_id,class_id,bool_or(enrolled) enrolled from candidates group by student_id,class_id
 ), counts as (
   select student_id,count(*) filter(where enrolled) registered,count(*) filter(where not enrolled) waiting
   from canonical group by student_id
 ) select s.id,jsonb_build_object('status',case when coalesce(c.registered,0)>0 then '재원'
   when coalesce(c.waiting,0)>0 then '대기' else '퇴원' end,
   'registeredCount',coalesce(c.registered,0),'waitlistCount',coalesce(c.waiting,0))
 from students s left join counts c on c.student_id=s.id;
$$;
revoke all on function dashboard_private.management_student_enrollment_summaries_v1() from public,anon;
grant execute on function dashboard_private.management_student_enrollment_summaries_v1() to authenticated;

-- Fail on schema drift. Keep each final definition's validation, other domains,
-- ordering, projection, permissions and ownership intact.
do $patch$
declare target regprocedure; definition text; old_text text; new_text text; owner_id oid; acl aclitem[]; item record;
begin
 for item in select * from (values
 ('public.list_management_numbered_page_v1(text,jsonb,integer,integer,jsonb)',
  'cross join lateral dashboard_private.management_student_enrollment_summary_v1(record.id) enrollment(value)',
  'join dashboard_private.management_student_enrollment_summaries_v1() enrollment on enrollment.student_id=record.id'),
 ('public.get_management_stats_v1(text,jsonb)',
  'cross join lateral dashboard_private.management_student_enrollment_summary_v1(student.id) enrollment(value)',
  'join dashboard_private.management_student_enrollment_summaries_v1() enrollment on enrollment.student_id=student.id'),
 ('public.list_management_filter_options_v1(text,jsonb)',
  'dashboard_private.management_student_enrollment_summary_v1(student.id) ->> ''status''',
  'enrollment.value ->> ''status'''),
 ('public.list_management_page_v1(text,jsonb,text,uuid,integer)',
  'dashboard_private.management_student_enrollment_summary_v1(student.id) as raw',
  'enrollment.value as raw')
 ) changes(signature,old_value,new_value) loop
   target:=item.signature::regprocedure;
   select proowner,proacl into owner_id,acl from pg_proc where oid=target;
   definition:=pg_get_functiondef(target);old_text:=item.old_value;new_text:=item.new_value;
   if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then
     raise exception using errcode='55000',message='student_enrollment_batch_patch_target_missing';
   end if;
   definition:=replace(definition,old_text,new_text);
   if item.signature in('public.list_management_filter_options_v1(text,jsonb)','public.list_management_page_v1(text,jsonb,text,uuid,integer)') then
     old_text:=E'from public.students student\n      left join public.academic_schools';
     new_text:=E'from public.students student join dashboard_private.management_student_enrollment_summaries_v1() enrollment on enrollment.student_id=student.id\n      left join public.academic_schools';
     if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then
       raise exception using errcode='55000',message='student_enrollment_batch_source_missing';
     end if;
     definition:=replace(definition,old_text,new_text);
   end if;
   execute definition;
   if exists(select 1 from pg_proc where oid=target and (proowner is distinct from owner_id or proacl is distinct from acl)) then
     raise exception using errcode='55000',message='student_enrollment_batch_acl_changed';
   end if;
 end loop;
end $patch$;
commit;
