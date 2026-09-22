-- Exact counts use the same RLS-visible student membership as the paged roster.
-- Patch the final ordered definition, preserving its owner, ACL and all branches.
do $$
declare
  target regprocedure := 'public.get_management_detail_v1(text,uuid)'::regprocedure;
  definition text;
  owner_before oid;
  acl_before aclitem[];
  old_text text := $old$'registeredStudents',public.list_management_detail_relation_page_v1('classes',p_id,'registered_students') -> 'page',$old$;
begin
  select proowner, proacl into owner_before, acl_before from pg_proc where oid=target;
  definition := pg_get_functiondef(target);
  if length(definition)-length(replace(definition,old_text,'')) <> length(old_text) then
    raise exception 'class_roster_counts_patch_target_missing' using errcode='55000';
  end if;
  execute replace(definition,old_text,$new$
      'registeredCount',(select count(*) from public.students student where coalesce(v_raw -> 'student_ids','[]'::jsonb) ? student.id::text),
      'waitlistCount',(select count(*) from public.students student where coalesce(v_raw -> 'waitlist_ids','[]'::jsonb) ? student.id::text),
      'registeredStudents',public.list_management_detail_relation_page_v1('classes',p_id,'registered_students') -> 'page',$new$);
  if exists(select 1 from pg_proc where oid=target and (proowner is distinct from owner_before or proacl is distinct from acl_before or prosecdef)) then
    raise exception 'class_roster_counts_acl_changed' using errcode='55000';
  end if;
end;
$$;
