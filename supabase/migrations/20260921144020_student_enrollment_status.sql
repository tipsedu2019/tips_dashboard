set lock_timeout = '5s';
set statement_timeout = '30s';

-- Reuse the final registered/roster_active contract and collapse reciprocal
-- arrays + registration claims once per class. Registered wins over waiting.
-- Invoker visibility of both the student and class is required.
create function dashboard_private.management_student_enrollments_v1(p_student_id uuid)
returns table(class_id uuid,status text,sort_at timestamptz,event_id uuid)
language sql stable security invoker set search_path = ''
as $enrollments$
    with selected_student as (
      select student.class_ids,student.waitlist_class_ids from public.students student where student.id=p_student_id
    ), candidates as (
      select enrollment.class_id,
        case when enrollment.status='enrolled' and enrollment.roster_active then 'enrolled' else 'waitlisted' end status,
        enrollment.updated_at sort_at,enrollment.id event_id,1 priority
      from public.ops_registration_enrollments enrollment
      where enrollment.student_id=p_student_id and enrollment.class_id is not null
        and ((enrollment.status='enrolled' and enrollment.roster_active) or enrollment.status in ('waitlist','waitlisted'))
      union all
      select class.id,'enrolled',coalesce(class.created_at,'epoch'::timestamptz),class.id,2
      from selected_student cross join lateral pg_catalog.jsonb_array_elements_text(coalesce(selected_student.class_ids,'[]'::jsonb)) direct(class_id)
      join public.classes class on class.id::text=direct.class_id
      union all
      select class.id,'waitlisted',coalesce(class.created_at,'epoch'::timestamptz),class.id,3
      from selected_student cross join lateral pg_catalog.jsonb_array_elements_text(coalesce(selected_student.waitlist_class_ids,'[]'::jsonb)) direct(class_id)
      join public.classes class on class.id::text=direct.class_id
      union all
      select class.id,'enrolled',coalesce(class.created_at,'epoch'::timestamptz),class.id,4
      from public.classes class where coalesce(class.student_ids,'[]'::jsonb) ? p_student_id::text
      union all
      select class.id,'waitlisted',coalesce(class.created_at,'epoch'::timestamptz),class.id,5
      from public.classes class where coalesce(class.waitlist_ids,'[]'::jsonb) ? p_student_id::text
    ), canonical as (
      select distinct on (class_id) class_id,status,sort_at,event_id
      from candidates
      order by class_id,case when status='enrolled' then 0 else 1 end,priority,sort_at desc,event_id
    )
    select canonical.class_id,canonical.status,canonical.sort_at,canonical.event_id
    from canonical join public.classes visible_class on visible_class.id=canonical.class_id
    where exists (select 1 from selected_student);
$enrollments$;

create function dashboard_private.management_student_enrollment_summary_v1(p_student_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $summary$
  select jsonb_build_object(
    'status',case when count(*) filter (where status='enrolled')>0 then '재원'
      when count(*) filter (where status='waitlisted')>0 then '대기' else '퇴원' end,
    'registeredCount',count(*) filter (where status='enrolled'),
    'waitlistCount',count(*) filter (where status='waitlisted'))
  from dashboard_private.management_student_enrollments_v1(p_student_id);
$summary$;

revoke all on function dashboard_private.management_student_enrollments_v1(uuid) from public, anon;
revoke all on function dashboard_private.management_student_enrollment_summary_v1(uuid) from public, anon;
grant execute on function dashboard_private.management_student_enrollments_v1(uuid) to authenticated;
grant execute on function dashboard_private.management_student_enrollment_summary_v1(uuid) to authenticated;

-- Patch only student read projections; preserve unrelated branches and ACLs.
do $patch$
declare
  v_target regprocedure;
  v_definition text;
  v_old text;
  v_new text;
  v_owner oid;
  v_acl aclitem[];
begin
  v_target := 'public.list_management_numbered_page_v1(text,jsonb,integer,integer,jsonb)'::regprocedure;
  select proowner,proacl into v_owner,v_acl from pg_proc where oid=v_target;
  v_definition := pg_get_functiondef(v_target);
  v_old := $old$case when pg_catalog.btrim(record.status) like '%퇴원%' or pg_catalog.lower(pg_catalog.btrim(record.status)) in ('withdrawn','inactive','left') then 1 else 0 end$old$;
  v_new := $new$case enrollment.value ->> 'status' when '재원' then 0 when '대기' then 1 else 2 end$new$;
  if length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) then
    raise exception 'student_enrollment_patch_target_missing: %',v_target using errcode='55000';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$from public.students record
      where$old$;
  v_new := $new$from public.students record
      cross join lateral dashboard_private.management_student_enrollment_summary_v1(record.id) enrollment(value)
      where$new$;
  if length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) then
    raise exception 'student_enrollment_patch_target_missing: %',v_target using errcode='55000';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$and (($1 ->> 'status') is null or record.status = $1 ->> 'status')
        and (($1 ->> 'schoolCategory')$old$;
  v_new := $new$and (($1 ->> 'status') is null or enrollment.value ->> 'status' = $1 ->> 'status')
        and (($1 ->> 'schoolCategory')$new$;
  if length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) then
    raise exception 'student_enrollment_patch_target_missing: %',v_target using errcode='55000';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$'status',coalesce(record.status,''),
      'sortKey'$old$;
  v_new := $new$'storedStatus',coalesce(record.status,''),
      'sortKey'$new$;
  if length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) then
    raise exception 'student_enrollment_patch_target_missing: %',v_target using errcode='55000';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$    )$sql$;
  elsif p_kind = 'classes'$old$;
  v_new := $new$    ) || dashboard_private.management_student_enrollment_summary_v1(record.id)$sql$;
  elsif p_kind = 'classes'$new$;
  if length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) then
    raise exception 'student_enrollment_patch_target_missing: %',v_target using errcode='55000';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  execute v_definition;
  if exists (select 1 from pg_proc where oid=v_target and (proowner is distinct from v_owner or proacl is distinct from v_acl)) then
    raise exception 'student_enrollment_patch_acl_changed' using errcode='55000';
  end if;

  v_target := 'public.get_management_stats_v1(text,jsonb)'::regprocedure;
  select proowner,proacl into v_owner,v_acl from pg_proc where oid=v_target;
  v_definition := pg_get_functiondef(v_target);
  v_old := $old$select pg_catalog.jsonb_build_object('status',student.status) raw from public.students student$old$;
  v_new := $new$select enrollment.value raw from public.students student
      cross join lateral dashboard_private.management_student_enrollment_summary_v1(student.id) enrollment(value)$new$;
  if length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) then
    raise exception 'student_enrollment_patch_target_missing: %',v_target using errcode='55000';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$and ((p_filters ->> 'status') is null or student.status = p_filters ->> 'status')$old$;
  v_new := $new$and ((p_filters ->> 'status') is null or enrollment.value ->> 'status' = p_filters ->> 'status')$new$;
  if length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) then
    raise exception 'student_enrollment_patch_target_missing: %',v_target using errcode='55000';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  execute v_definition;
  if exists (select 1 from pg_proc where oid=v_target and (proowner is distinct from v_owner or proacl is distinct from v_acl)) then
    raise exception 'student_enrollment_patch_acl_changed' using errcode='55000';
  end if;

  v_target := 'public.list_management_filter_options_v1(text,jsonb)'::regprocedure;
  select proowner,proacl into v_owner,v_acl from pg_proc where oid=v_target;
  v_definition := pg_get_functiondef(v_target);
  v_old := $old$'status',student.status,'school_category'$old$;
  v_new := $new$'status',dashboard_private.management_student_enrollment_summary_v1(student.id) ->> 'status','school_category'$new$;
  if length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) then
    raise exception 'student_enrollment_patch_target_missing: %',v_target using errcode='55000';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  execute v_definition;
  if exists (select 1 from pg_proc where oid=v_target and (proowner is distinct from v_owner or proacl is distinct from v_acl)) then
    raise exception 'student_enrollment_patch_acl_changed' using errcode='55000';
  end if;

  v_target := 'public.list_management_page_v1(text,jsonb,text,uuid,integer)'::regprocedure;
  select proowner,proacl into v_owner,v_acl from pg_proc where oid=v_target;
  v_definition := pg_get_functiondef(v_target);
  v_old := $old$'school_category',school.category,'updated_at',student.created_at
      ) as raw$old$;
  v_new := $new$'school_category',school.category,'updated_at',student.created_at,'storedStatus',student.status
      ) || dashboard_private.management_student_enrollment_summary_v1(student.id) as raw$new$;
  if length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) then
    raise exception 'student_enrollment_patch_target_missing: %',v_target using errcode='55000';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := $old$'status',coalesce(filtered.raw ->> 'status',''),
        'sortKey',filtered.normalized_sort::text,$old$;
  v_new := $new$'status',coalesce(filtered.raw ->> 'status',''),'storedStatus',coalesce(filtered.raw ->> 'storedStatus',''),
        'registeredCount',filtered.raw -> 'registeredCount','waitlistCount',filtered.raw -> 'waitlistCount',
        'sortKey',filtered.normalized_sort::text,$new$;
  if length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) then
    raise exception 'student_enrollment_patch_target_missing: %',v_target using errcode='55000';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  execute v_definition;
  if exists (select 1 from pg_proc where oid=v_target and (proowner is distinct from v_owner or proacl is distinct from v_acl)) then
    raise exception 'student_enrollment_patch_acl_changed' using errcode='55000';
  end if;

  v_target := 'public.get_management_detail_v1(text,uuid)'::regprocedure;
  select proowner,proacl into v_owner,v_acl from pg_proc where oid=v_target;
  v_definition := pg_get_functiondef(v_target);
  v_old := $old$'recentIssue',coalesce(v_raw -> 'recent_issue',v_raw -> 'recentIssue'),'updatedAt',v_raw -> 'updated_at'),$old$;
  v_new := $new$'recentIssue',coalesce(v_raw -> 'recent_issue',v_raw -> 'recentIssue'),'updatedAt',v_raw -> 'updated_at','storedStatus',v_raw ->> 'status') || dashboard_private.management_student_enrollment_summary_v1(p_id),$new$;
  if length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) then
    raise exception 'student_enrollment_patch_target_missing: %',v_target using errcode='55000';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  execute v_definition;
  if exists (select 1 from pg_proc where oid=v_target and (proowner is distinct from v_owner or proacl is distinct from v_acl)) then
    raise exception 'student_enrollment_patch_acl_changed' using errcode='55000';
  end if;

  v_target := 'public.list_management_detail_relation_page_v1(text,uuid,text,text,uuid,integer)'::regprocedure;
  select proowner,proacl into v_owner,v_acl from pg_proc where oid=v_target;
  v_definition := pg_get_functiondef(v_target);
  v_old := $old$    with selected_student as (
      select student.class_ids,student.waitlist_class_ids from public.students student where student.id=p_id
    ), candidates as (
      select enrollment.class_id,
        case when enrollment.status='enrolled' and enrollment.roster_active then 'enrolled' else 'waitlisted' end status,
        enrollment.updated_at sort_at,enrollment.id event_id,1 priority
      from public.ops_registration_enrollments enrollment
      where enrollment.student_id=p_id and enrollment.class_id is not null
        and ((enrollment.status='enrolled' and enrollment.roster_active) or enrollment.status in ('waitlist','waitlisted'))
      union all
      select class.id,'enrolled',coalesce(class.created_at,'epoch'::timestamptz),class.id,2
      from selected_student cross join lateral pg_catalog.jsonb_array_elements_text(coalesce(selected_student.class_ids,'[]'::jsonb)) direct(class_id)
      join public.classes class on class.id::text=direct.class_id
      union all
      select class.id,'waitlisted',coalesce(class.created_at,'epoch'::timestamptz),class.id,3
      from selected_student cross join lateral pg_catalog.jsonb_array_elements_text(coalesce(selected_student.waitlist_class_ids,'[]'::jsonb)) direct(class_id)
      join public.classes class on class.id::text=direct.class_id
      union all
      select class.id,'enrolled',coalesce(class.created_at,'epoch'::timestamptz),class.id,4
      from public.classes class where coalesce(class.student_ids,'[]'::jsonb) ? p_id::text
      union all
      select class.id,'waitlisted',coalesce(class.created_at,'epoch'::timestamptz),class.id,5
      from public.classes class where coalesce(class.waitlist_ids,'[]'::jsonb) ? p_id::text
    ), canonical as (
      select distinct on (class_id) class_id,status,sort_at,event_id
      from candidates
      order by class_id,case when status='enrolled' then 0 else 1 end,priority,sort_at desc,event_id
$old$;
  v_new := $new$    with canonical as (
      select class_id,status,sort_at,event_id from dashboard_private.management_student_enrollments_v1(p_id)
$new$;
  if length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) then
    raise exception 'student_enrollment_patch_target_missing: %',v_target using errcode='55000';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  execute v_definition;
  if exists (select 1 from pg_proc where oid=v_target and (proowner is distinct from v_owner or proacl is distinct from v_acl)) then
    raise exception 'student_enrollment_patch_acl_changed' using errcode='55000';
  end if;

end;
$patch$;
