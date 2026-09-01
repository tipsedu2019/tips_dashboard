begin;
set local lock_timeout = '7s';
select plan(29);

create function pg_temp.fix_id(n integer) returns uuid language sql immutable as $$
  select ('6d000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.fix_owner_draft(operations jsonb default '[]'::jsonb) returns jsonb
language sql stable as $$ select jsonb_build_object('version', 1,
  'baseRevision', textbook_settings_private.revision_v1(), 'operations', operations) $$;
create function pg_temp.fix_save_body(operations jsonb default '[]'::jsonb) returns jsonb
language sql stable as $$ select jsonb_build_object('version', 1,
  'owners', pg_temp.fix_owner_draft(operations), 'subSubjects', null) $$;
create function pg_temp.capture_owner_read(kind text, owner_id uuid, draft jsonb)
returns table(result_sqlstate text, message_text text, response jsonb)
language plpgsql as $$
begin
  begin
    if kind = 'publisher.page' then
      response := public.list_textbook_publisher_page_v1('{"search":""}'::jsonb, draft, 'name', 1, 10);
    elsif kind = 'supplier.page' then
      response := public.list_textbook_supplier_page_v1('{"search":""}'::jsonb, draft, 'name', 1, 10);
    elsif kind = 'publisher.detail' then
      response := public.get_textbook_publisher_setting_detail_v1(owner_id, draft);
    elsif kind = 'supplier.detail' then
      response := public.get_textbook_supplier_setting_detail_v1(owner_id, draft);
    else
      raise exception 'unknown fix read kind';
    end if;
    result_sqlstate := '00000'; message_text := null; return next;
  exception when others then
    get stacked diagnostics result_sqlstate = returned_sqlstate, message_text = message_text;
    response := null; return next;
  end;
end
$$;
create function pg_temp.capture_owner_save(request_id uuid, body jsonb)
returns table(result_sqlstate text, message_text text, response jsonb)
language plpgsql as $$
begin
  begin
    response := public.save_textbook_settings_draft_v1(request_id, body);
    result_sqlstate := '00000'; message_text := null; return next;
  exception when others then
    get stacked diagnostics result_sqlstate = returned_sqlstate, message_text = message_text;
    response := null; return next;
  end;
end
$$;
grant execute on all functions in schema pg_temp to authenticated;

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (pg_temp.fix_id(901), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'task6a-fix@example.invalid', crypt('local-only', gen_salt('bf')), now(), '{}', '{}', now(), now());
update public.profiles set role = 'admin', name = 'Task6a fix 관리자'
where id = pg_temp.fix_id(901);

insert into public.textbook_publishers(id, name, subjects) values
  (pg_temp.fix_id(1), '__t6a_fix__ exact publisher', array['english']),
  (pg_temp.fix_id(2), ' __t6a_fix__ spaced publisher ', array['english']),
  (pg_temp.fix_id(3), '__t6a_fix__ patch publisher', array['english']);
insert into public.textbook_suppliers(id, name, contact, memo) values
  (pg_temp.fix_id(101), '__t6a_fix__ exact supplier', '', ''),
  (pg_temp.fix_id(102), ' __t6a_fix__ spaced supplier ', '', ''),
  (pg_temp.fix_id(103), '__t6a_fix__ patch supplier', '', '');

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.fix_id(901)::text, true);

-- Blank/whitespace names are valid draft-preview states for add and patch.
select is((select result_sqlstate from pg_temp.capture_owner_read('publisher.page', null,
  pg_temp.fix_owner_draft(jsonb_build_array(jsonb_build_object('type','publisher.add',
    'id',pg_temp.fix_id(201),'name','','subjects','[]'::jsonb,'supplierIds','[]'::jsonb))))),
  '00000', 'blank publisher add is accepted by page projection');
select is((select response #>> '{rows,0,id}' from pg_temp.capture_owner_read('publisher.page', null,
  pg_temp.fix_owner_draft(jsonb_build_array(jsonb_build_object('type','publisher.add',
    'id',pg_temp.fix_id(201),'name','','subjects','[]'::jsonb,'supplierIds','[]'::jsonb))))),
  pg_temp.fix_id(201)::text, 'blank publisher add is prepended with retained id');
select is((select response #>> '{rows,0,name}' from pg_temp.capture_owner_read('publisher.page', null,
  pg_temp.fix_owner_draft(jsonb_build_array(jsonb_build_object('type','publisher.add',
    'id',pg_temp.fix_id(201),'name','','subjects','[]'::jsonb,'supplierIds','[]'::jsonb))))),
  '', 'blank publisher add remains blank in page response');
select is((select result_sqlstate from pg_temp.capture_owner_read('publisher.detail', pg_temp.fix_id(201),
  pg_temp.fix_owner_draft(jsonb_build_array(jsonb_build_object('type','publisher.add',
    'id',pg_temp.fix_id(201),'name','','subjects','[]'::jsonb,'supplierIds','[]'::jsonb))))),
  '00000', 'blank publisher add is accepted by selected detail');
select is((select response #>> '{row,name}' from pg_temp.capture_owner_read('publisher.detail', pg_temp.fix_id(201),
  pg_temp.fix_owner_draft(jsonb_build_array(jsonb_build_object('type','publisher.add',
    'id',pg_temp.fix_id(201),'name','','subjects','[]'::jsonb,'supplierIds','[]'::jsonb))))),
  '', 'blank publisher selected detail remains editable');
select is((select result_sqlstate from pg_temp.capture_owner_read('publisher.detail', pg_temp.fix_id(3),
  pg_temp.fix_owner_draft(jsonb_build_array(jsonb_build_object('type','publisher.patch',
    'id',pg_temp.fix_id(3),'patch',jsonb_build_object('name','   ')))))),
  '00000', 'blank publisher name patch is accepted by selected detail');
select is((select response #>> '{row,name}' from pg_temp.capture_owner_read('publisher.detail', pg_temp.fix_id(3),
  pg_temp.fix_owner_draft(jsonb_build_array(jsonb_build_object('type','publisher.patch',
    'id',pg_temp.fix_id(3),'patch',jsonb_build_object('name','   ')))))),
  '', 'blank publisher patch projects as blank');

select is((select result_sqlstate from pg_temp.capture_owner_read('supplier.page', null,
  pg_temp.fix_owner_draft(jsonb_build_array(jsonb_build_object('type','supplier.add',
    'id',pg_temp.fix_id(202),'name','   ','contact','','memo',''))))),
  '00000', 'blank supplier add is accepted by page projection');
select is((select response #>> '{rows,0,id}' from pg_temp.capture_owner_read('supplier.page', null,
  pg_temp.fix_owner_draft(jsonb_build_array(jsonb_build_object('type','supplier.add',
    'id',pg_temp.fix_id(202),'name','   ','contact','','memo',''))))),
  pg_temp.fix_id(202)::text, 'blank supplier add is prepended with retained id');
select is((select response #>> '{rows,0,name}' from pg_temp.capture_owner_read('supplier.page', null,
  pg_temp.fix_owner_draft(jsonb_build_array(jsonb_build_object('type','supplier.add',
    'id',pg_temp.fix_id(202),'name','   ','contact','','memo',''))))),
  '', 'blank supplier add remains blank in page response');
select is((select result_sqlstate from pg_temp.capture_owner_read('supplier.detail', pg_temp.fix_id(202),
  pg_temp.fix_owner_draft(jsonb_build_array(jsonb_build_object('type','supplier.add',
    'id',pg_temp.fix_id(202),'name','   ','contact','','memo',''))))),
  '00000', 'blank supplier add is accepted by selected detail');
select is((select response #>> '{row,name}' from pg_temp.capture_owner_read('supplier.detail', pg_temp.fix_id(202),
  pg_temp.fix_owner_draft(jsonb_build_array(jsonb_build_object('type','supplier.add',
    'id',pg_temp.fix_id(202),'name','   ','contact','','memo',''))))),
  '', 'blank supplier selected detail remains editable');
select is((select result_sqlstate from pg_temp.capture_owner_read('supplier.detail', pg_temp.fix_id(103),
  pg_temp.fix_owner_draft(jsonb_build_array(jsonb_build_object('type','supplier.patch',
    'id',pg_temp.fix_id(103),'patch',jsonb_build_object('name',E'\t ')))))),
  '00000', 'blank supplier name patch is accepted by selected detail');
select is((select response #>> '{row,name}' from pg_temp.capture_owner_read('supplier.detail', pg_temp.fix_id(103),
  pg_temp.fix_owner_draft(jsonb_build_array(jsonb_build_object('type','supplier.patch',
    'id',pg_temp.fix_id(103),'patch',jsonb_build_object('name',E'\t ')))))),
  '', 'blank supplier patch projects as blank');

-- Save-time final-state validation still rejects blank dirty names before DML.
select is((select result_sqlstate from pg_temp.capture_owner_save(pg_temp.fix_id(9001),
  pg_temp.fix_save_body(jsonb_build_array(jsonb_build_object('type','publisher.add',
    'id',pg_temp.fix_id(203),'name','','subjects','[]'::jsonb,'supplierIds','[]'::jsonb))))),
  '22023', 'blank dirty publisher final name fails at save boundary');
select is((select count(*) from public.textbook_publishers where id=pg_temp.fix_id(203)), 0::bigint,
  'blank publisher save performs no DML');
select is((select result_sqlstate from pg_temp.capture_owner_save(pg_temp.fix_id(9002),
  pg_temp.fix_save_body(jsonb_build_array(jsonb_build_object('type','supplier.add',
    'id',pg_temp.fix_id(204),'name','   ','contact','','memo',''))))),
  '22023', 'blank dirty supplier final name fails at save boundary');
select is((select count(*) from public.textbook_suppliers where id=pg_temp.fix_id(204)), 0::bigint,
  'blank supplier save performs no DML');

-- Exact raw duplicates rely on the real UNIQUE indexes and retain native 23505.
select is((select result_sqlstate from pg_temp.capture_owner_save(pg_temp.fix_id(9003),
  pg_temp.fix_save_body(jsonb_build_array(jsonb_build_object('type','publisher.add',
    'id',pg_temp.fix_id(205),'name','__t6a_fix__ exact publisher','subjects','[]'::jsonb,'supplierIds','[]'::jsonb))))),
  '23505', 'exact publisher duplicate preserves native UNIQUE SQLSTATE');
select is((select count(*) from public.textbook_publishers where id=pg_temp.fix_id(205)), 0::bigint,
  'native publisher UNIQUE failure rolls back the add');
select is((select result_sqlstate from pg_temp.capture_owner_save(pg_temp.fix_id(9004),
  pg_temp.fix_save_body(jsonb_build_array(jsonb_build_object('type','supplier.add',
    'id',pg_temp.fix_id(206),'name','__t6a_fix__ exact supplier','contact','','memo',''))))),
  '23505', 'exact supplier duplicate preserves native UNIQUE SQLSTATE');
select is((select count(*) from public.textbook_suppliers where id=pg_temp.fix_id(206)), 0::bigint,
  'native supplier UNIQUE failure rolls back the add');

-- A legacy raw name with surrounding spaces does not block a distinct raw value.
select is((select result_sqlstate from pg_temp.capture_owner_save(pg_temp.fix_id(9005),
  pg_temp.fix_save_body(jsonb_build_array(jsonb_build_object('type','publisher.add',
    'id',pg_temp.fix_id(207),'name','__t6a_fix__ spaced publisher','subjects','[]'::jsonb,'supplierIds','[]'::jsonb))))),
  '00000', 'legacy publisher trim collision does not invent a domain conflict');
select is((select name from public.textbook_publishers where id=pg_temp.fix_id(207)),
  '__t6a_fix__ spaced publisher', 'distinct raw publisher name persists');
select is((select name from public.textbook_publishers where id=pg_temp.fix_id(2)),
  ' __t6a_fix__ spaced publisher ', 'legacy publisher bytes remain untouched');
select is((select result_sqlstate from pg_temp.capture_owner_save(pg_temp.fix_id(9006),
  pg_temp.fix_save_body(jsonb_build_array(jsonb_build_object('type','supplier.add',
    'id',pg_temp.fix_id(208),'name','__t6a_fix__ spaced supplier','contact','','memo',''))))),
  '00000', 'legacy supplier trim collision does not invent a domain conflict');
select is((select name from public.textbook_suppliers where id=pg_temp.fix_id(208)),
  '__t6a_fix__ spaced supplier', 'distinct raw supplier name persists');
select is((select name from public.textbook_suppliers where id=pg_temp.fix_id(102)),
  ' __t6a_fix__ spaced supplier ', 'legacy supplier bytes remain untouched');
select is(current_setting('lock_timeout'), '7s', 'fix cases preserve caller lock timeout');

select * from finish();
rollback;
