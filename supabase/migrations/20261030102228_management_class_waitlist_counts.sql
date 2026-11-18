-- #233: match the existing class-detail waiting total without changing membership.
-- Add only numeric counts to the two existing class-list DTOs. The cursor DTO
-- remains identical to the numbered DTO; no student identity is returned here.
-- Patch final ordered definitions and fail closed if their projection drifts.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $patch$
declare
  target regprocedure;
  definition text;
  attributes_before jsonb;
  attributes_after jsonb;
  old_text text;
  new_text text;
begin
  foreach target in array array[
    'public.list_management_page_v1(text,jsonb,text,uuid,integer)'::regprocedure,
    'public.list_management_numbered_page_v1(text,jsonb,integer,integer,jsonb)'::regprocedure
  ] loop
    select pg_catalog.jsonb_build_array(proowner,proacl,prosecdef,provolatile,proconfig,prorettype,proargtypes,proretset)
      into attributes_before from pg_catalog.pg_proc where oid=target;
    definition := pg_catalog.pg_get_functiondef(target);

    if target = 'public.list_management_page_v1(text,jsonb,text,uuid,integer)'::regprocedure then
      old_text := $old$'status',class.status,'student_ids',class.student_ids,'updated_at',class.created_at$old$;
      new_text := $new$'status',class.status,'student_ids',class.student_ids,'waitlist_ids',class.waitlist_ids,'updated_at',class.created_at$new$;
      if pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,old_text,'')) <> pg_catalog.length(old_text) then
        raise exception 'management_class_waitlist_source_patch_mismatch' using errcode='55000';
      end if;
      definition := pg_catalog.replace(definition,old_text,new_text);
      old_text := $old$        ) roster),
        'sortKey',filtered.normalized_sort::text,$old$;
      new_text := $new$        ) roster),
        'waitlistCount',(select pg_catalog.count(*) from public.students student
          where coalesce(filtered.raw -> 'waitlist_ids','[]'::jsonb) ? student.id::text),
        'sortKey',filtered.normalized_sort::text,$new$;
    else
      old_text := $old$      ) roster),
      'sortKey',coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.btrim(record.name),'[[:space:]]+',' ','g'),''),U&'\FFFF'),$old$;
      new_text := $new$      ) roster),
      'waitlistCount',(select pg_catalog.count(*) from public.students student
        where coalesce(record.waitlist_ids,'[]'::jsonb) ? student.id::text),
      'sortKey',coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.btrim(record.name),'[[:space:]]+',' ','g'),''),U&'\FFFF'),$new$;
    end if;

    if pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,old_text,'')) <> pg_catalog.length(old_text) then
      raise exception 'management_class_waitlist_count_patch_mismatch' using errcode='55000';
    end if;
    execute pg_catalog.replace(definition,old_text,new_text);

    select pg_catalog.jsonb_build_array(proowner,proacl,prosecdef,provolatile,proconfig,prorettype,proargtypes,proretset)
      into attributes_after from pg_catalog.pg_proc where oid=target;
    if attributes_after is distinct from attributes_before then
      raise exception 'management_class_waitlist_function_attributes_changed' using errcode='55000';
    end if;
  end loop;
end;
$patch$;

commit;
