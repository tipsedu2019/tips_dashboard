-- REVIEW CANDIDATE; SOURCE ONLY, NOT INSTALLABLE, NOT AN APPLIED MIGRATION.
-- Source: 90bcd6554e9d77675e4d88d40220ed7ef9284533 (privacy + PR96 + main 4a2cda49).
-- Ordered source reconstruction includes final enrollment/status/count/textbook,
-- soft-archive, parameter-sensitive custom plans and Sept28 narrow keys patches.
-- Runtime SQL/pgTAP/catalog/ACL/RLS/concurrency/rollback executions: 0 (blocked).
-- Existing seven INVOKER readers only: no new RPC, signatures, grants, policies,
-- roles, columns, historical DML/backfill, provider send or permanent purge.
-- Master native contact/parent_contact and metadata phone aliases are excluded;
-- NULL DTO tombstones preserve older consumers. Registration list phone search
-- is removed. Phone-consultation timestamps and all unrelated business data stay.
-- The separate current-open get_registration_case_contact_v1 temporary parent
-- read and server-private delivery destination are intentionally not changed.
-- Unstructured notes, historical payloads, existing direct Data API privileges
-- and arbitrary phone-like content in other fields are separate boundaries.
-- makeeduDetailId stays NULL: no unverified UID-to-external-ID inference.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

do $privacy_readers$
declare
  item record;
  target pg_catalog.regprocedure;
  old_row pg_catalog.pg_proc%rowtype;
  new_row pg_catalog.pg_proc%rowtype;
  definition text;
  candidate_body text;
  anchor_index integer;
begin
  for item in select * from (values
    ('public.list_management_numbered_page_v1(text,jsonb,integer,integer,jsonb)', '0605efd1c428b9b8a0768923784bf9740e6e7bf03d4845dd54e9613e376468c3', 'ac7c04fcfd99bf6b76f86ba74760b1d36aa264ecf3b4f5e0bacdad929d572d08',
      array[$reader_text_1$'grade', $e$nullif(pg_catalog.btrim(record.grade),'') collate dashboard_private.ko_numeric$e$,
      'contact', $e$nullif(pg_catalog.btrim(record.contact),'') collate dashboard_private.ko_numeric$e$,
      'parentContact', $e$nullif(pg_catalog.btrim(record.parent_contact),'') collate dashboard_private.ko_numeric$e$$reader_text_1$,
        $reader_text_2$'grade',record.grade,'school',record.school,'contact',record.contact,'parentContact',record.parent_contact,$reader_text_2$],
      array[$reader_text_3$'grade', $e$nullif(pg_catalog.btrim(record.grade),'') collate dashboard_private.ko_numeric$e$,
      'uid', $e$nullif(pg_catalog.btrim(record.uid),'') collate dashboard_private.ko_numeric$e$$reader_text_3$,
        $reader_text_4$'grade',record.grade,'school',record.school,'uid',record.uid,'makeeduDetailId',null,'contact',null,'parentContact',null,$reader_text_4$]),
    ('public.list_management_page_v1(text,jsonb,text,uuid,integer)', '42feb024386d7e25593b3babcd42d3719effe499d139382987052b43440b4d10', '904ebb11c0854f1fd02c3ceca595dddf3a20feb97a66578f6178785d514faed9',
      array[$reader_text_5$'contact',student.contact,'parent_contact',student.parent_contact,'status',student.status,$reader_text_5$,
        $reader_text_6$'contact',filtered.raw -> 'contact','parentContact',coalesce(filtered.raw -> 'parent_contact',filtered.raw -> 'parentContact'),$reader_text_6$],
      array[$reader_text_7$'uid',student.uid,'status',student.status,$reader_text_7$,
        $reader_text_8$'uid',filtered.raw -> 'uid','makeeduDetailId',null,'contact',null,'parentContact',null,$reader_text_8$]),
    ('public.get_management_detail_v1(text,uuid)', '171dc88467b822def4537ee226540c443fc6e2290505840d38927dd4ba7bdf12', '1cf6e558674899752a5d4e3f79c7b0f8de03cc8984225e28e76e614bbdde5d59',
      array[$reader_text_9$select pg_catalog.to_jsonb(student) into v_raw from public.students student where student.id = p_id;$reader_text_9$,
        $reader_text_10$'contact',v_raw -> 'contact','parentContact',coalesce(v_raw -> 'parent_contact',v_raw -> 'parentContact'),$reader_text_10$],
      array[$reader_text_11$select pg_catalog.to_jsonb(student) - array['contact','parent_contact']::text[] into v_raw from public.students student where student.id = p_id;$reader_text_11$,
        $reader_text_12$'makeeduDetailId',null,'contact',null,'parentContact',null,$reader_text_12$]),
    ('public.list_management_detail_relation_page_v1(text,uuid,text,text,uuid,integer)', '49dba092ed2877a29531e1fc1cb62dcf732958803bcd6452d21b33b0800ae1e6', '850036b3faebfdb39593fa03b1fedf2031a53b93c164f599a699c2148cd9b72e',
      array[$reader_text_13$'contact',student.contact,'parentContact',student.parent_contact,$reader_text_13$],
      array[$reader_text_14$'uid',student.uid,'makeeduDetailId',null,'contact',null,'parentContact',null,$reader_text_14$]),
    ('dashboard_private.ops_task_page_source_v1(text,jsonb)', '6a3e302285a19ba6716159c1683444f9d77093574c57c7337ad2c85d43bf0080', 'a7740e2259b114a528311007123b89e9e0a5eb809d9bacf26119635ec2e1d2f5',
      array[$reader_text_15$'parentPhone', coalesce(detail.parent_phone, ''),
          'studentPhone', coalesce(detail.student_phone, ''),$reader_text_15$,
        $reader_text_16$            detail.parent_phone,
            detail.student_phone,
$reader_text_16$,
        $reader_text_17$common.student_name, common.title, detail.parent_phone, detail.student_phone, detail.school_grade$reader_text_17$],
      array[$reader_text_18$'parentPhone', null,
          'studentPhone', null,$reader_text_18$,
        $reader_text_19$$reader_text_19$,
        $reader_text_20$common.student_name, common.title, detail.school_grade$reader_text_20$]),
    ('dashboard_private.ops_task_numbered_keys_v1(text,jsonb)', 'd4fea24630a28571bc4c53c2fe7785db50709a0e6d49fe84d7e430a736f0c672', 'a544834aa14f59ae98c26d36d1ac35d118e88e357d7175a4dcf615c06e80cfeb',
      array[$reader_text_21$            detail.parent_phone,
            detail.student_phone,
$reader_text_21$,
        $reader_text_22$common.student_name, common.title, detail.parent_phone, detail.student_phone, detail.school_grade$reader_text_22$],
      array[$reader_text_23$$reader_text_23$,
        $reader_text_24$common.student_name, common.title, detail.school_grade$reader_text_24$]),
    ('dashboard_private.ops_task_numbered_project_v1(text,uuid[],uuid[])', '387089c681626329347030723aab4a56e851f8377f40d01b212bc7d1ee6fe9f0', 'af5c77a5a76c98315b723758d40b6742d7c3381166b48fd22cc8820960d37c31',
      array[$reader_text_25$'parentPhone', coalesce(detail.parent_phone, ''),
          'studentPhone', coalesce(detail.student_phone, ''),$reader_text_25$],
      array[$reader_text_26$'parentPhone', null,
          'studentPhone', null,$reader_text_26$])
  ) changes(signature, before_sha256, after_sha256, old_values, new_values) loop
    target := pg_catalog.to_regprocedure(item.signature);
    if target is null then
      raise exception 'student_contact_reader_target_missing' using errcode = '55000';
    end if;
    select * into strict old_row from pg_catalog.pg_proc where oid = target;
    if old_row.prosecdef is distinct from false or old_row.provolatile is distinct from 's'
      or not coalesce('search_path=""' = any(old_row.proconfig) or 'search_path=' = any(old_row.proconfig),false)
      or pg_catalog.encode(extensions.digest(old_row.prosrc,'sha256'),'hex') is distinct from item.before_sha256 then
      raise exception 'student_contact_reader_preimage_drift' using errcode = '55000';
    end if;
    if pg_catalog.cardinality(item.old_values) <> pg_catalog.cardinality(item.new_values)
      or pg_catalog.cardinality(item.old_values) = 0 then
      raise exception 'student_contact_reader_patch_invalid' using errcode = '55000';
    end if;
    candidate_body := old_row.prosrc;
    for anchor_index in 1..pg_catalog.cardinality(item.old_values) loop
      if pg_catalog.length(item.old_values[anchor_index]) = 0 or
        pg_catalog.length(candidate_body) - pg_catalog.length(pg_catalog.replace(candidate_body,item.old_values[anchor_index],''))
          <> pg_catalog.length(item.old_values[anchor_index]) then
        raise exception 'student_contact_reader_anchor_drift' using errcode = '55000';
      end if;
      candidate_body := pg_catalog.replace(candidate_body,item.old_values[anchor_index],item.new_values[anchor_index]);
    end loop;
    if pg_catalog.encode(extensions.digest(candidate_body,'sha256'),'hex') is distinct from item.after_sha256 then
      raise exception 'student_contact_reader_projection_drift' using errcode = '55000';
    end if;
    definition := pg_catalog.pg_get_functiondef(target);
    if pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition,old_row.prosrc,''))
      <> pg_catalog.length(old_row.prosrc) then
      raise exception 'student_contact_reader_body_anchor_drift' using errcode = '55000';
    end if;
    execute pg_catalog.replace(definition,old_row.prosrc,candidate_body);
    select * into strict new_row from pg_catalog.pg_proc where oid = target;
    if pg_catalog.encode(extensions.digest(new_row.prosrc,'sha256'),'hex') is distinct from item.after_sha256
      or new_row.proowner is distinct from old_row.proowner
      or new_row.proacl is distinct from old_row.proacl
      or new_row.proconfig is distinct from old_row.proconfig
      or new_row.prosecdef is distinct from old_row.prosecdef
      or new_row.provolatile is distinct from old_row.provolatile
      or new_row.proparallel is distinct from old_row.proparallel
      or new_row.proisstrict is distinct from old_row.proisstrict
      or new_row.proleakproof is distinct from old_row.proleakproof
      or new_row.prolang is distinct from old_row.prolang
      or new_row.procost is distinct from old_row.procost
      or new_row.prorows is distinct from old_row.prorows
      or new_row.prosupport is distinct from old_row.prosupport
      or new_row.proretset is distinct from old_row.proretset
      or new_row.prorettype is distinct from old_row.prorettype then
      raise exception 'student_contact_reader_security_drift' using errcode = '55000';
    end if;
  end loop;
end $privacy_readers$;
commit;
