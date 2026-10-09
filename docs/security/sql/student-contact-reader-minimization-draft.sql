-- REVIEW CANDIDATE, not an installed migration. Based on main 6a6d7abe4f45e366beccc14efbbcce0534f0370f.
-- No historical data writes, new column, grant, RLS, provider or finalizer changes.
-- The four existing INVOKER readers retain their final enrollment/roster logic.
-- Null contact tombstones keep deployed older consumers compatible during rollout.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

do $privacy_readers$
declare
  item record;
  target regprocedure;
  definition text;
  old_owner oid;
  old_acl aclitem[];
  old_definer boolean;
  old_config text[];
begin
  for item in select * from (values
    ('public.list_management_numbered_page_v1(text,jsonb,integer,integer,jsonb)',
      $old$'grade', $e$nullif(pg_catalog.btrim(record.grade),'') collate dashboard_private.ko_numeric$e$,
      'contact', $e$nullif(pg_catalog.btrim(record.contact),'') collate dashboard_private.ko_numeric$e$,
      'parentContact', $e$nullif(pg_catalog.btrim(record.parent_contact),'') collate dashboard_private.ko_numeric$e$$old$,
      $new$'grade', $e$nullif(pg_catalog.btrim(record.grade),'') collate dashboard_private.ko_numeric$e$,
      'uid', $e$nullif(pg_catalog.btrim(record.uid),'') collate dashboard_private.ko_numeric$e$$new$),
    ('public.list_management_numbered_page_v1(text,jsonb,integer,integer,jsonb)',
      $old$'grade',record.grade,'school',record.school,'contact',record.contact,'parentContact',record.parent_contact,$old$,
      $new$'grade',record.grade,'school',record.school,'uid',record.uid,'makeeduDetailId',null,'contact',null,'parentContact',null,$new$),
    ('public.list_management_page_v1(text,jsonb,text,uuid,integer)',
      $old$'contact',student.contact,'parent_contact',student.parent_contact,'status',student.status,$old$,
      $new$'uid',student.uid,'status',student.status,$new$),
    ('public.list_management_page_v1(text,jsonb,text,uuid,integer)',
      $old$'contact',filtered.raw -> 'contact','parentContact',coalesce(filtered.raw -> 'parent_contact',filtered.raw -> 'parentContact'),$old$,
      $new$'uid',filtered.raw -> 'uid','makeeduDetailId',null,'contact',null,'parentContact',null,$new$),
    ('public.get_management_detail_v1(text,uuid)',
      $old$'contact',v_raw -> 'contact','parentContact',coalesce(v_raw -> 'parent_contact',v_raw -> 'parentContact'),$old$,
      $new$'makeeduDetailId',null,'contact',null,'parentContact',null,$new$),
    ('public.list_management_detail_relation_page_v1(text,uuid,text,text,uuid,integer)',
      $old$'contact',student.contact,'parentContact',student.parent_contact,$old$,
      $new$'uid',student.uid,'makeeduDetailId',null,'contact',null,'parentContact',null,$new$)
  ) changes(signature, old_value, new_value) loop
    target := pg_catalog.to_regprocedure(item.signature);
    if target is null then
      raise exception 'student_contact_reader_target_missing' using errcode = '55000';
    end if;
    select proowner, proacl, prosecdef, proconfig into old_owner, old_acl, old_definer, old_config
      from pg_catalog.pg_proc where oid = target;
    if old_definer then
      raise exception 'student_contact_reader_invoker_drift' using errcode = '55000';
    end if;
    definition := pg_catalog.pg_get_functiondef(target);
    if pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, item.old_value, ''))
      <> pg_catalog.length(item.old_value) then
      raise exception 'student_contact_reader_anchor_drift' using errcode = '55000';
    end if;
    execute pg_catalog.replace(definition, item.old_value, item.new_value);
    if exists (select 1 from pg_catalog.pg_proc where oid = target
      and (proowner is distinct from old_owner or proacl is distinct from old_acl
        or prosecdef is distinct from old_definer or proconfig is distinct from old_config)) then
      raise exception 'student_contact_reader_security_drift' using errcode = '55000';
    end if;
  end loop;
end $privacy_readers$;
commit;
