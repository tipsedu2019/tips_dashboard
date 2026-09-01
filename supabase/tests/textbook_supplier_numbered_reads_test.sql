begin;
set local lock_timeout = '7s';
create extension if not exists dblink;
select plan(122);

select has_function('public', 'list_textbook_publisher_page_v1',
  array['jsonb', 'jsonb', 'text', 'integer', 'integer']::text[], 'publisher page RPC exists');
select has_function('public', 'list_textbook_supplier_page_v1',
  array['jsonb', 'jsonb', 'text', 'integer', 'integer']::text[], 'supplier page RPC exists');
select has_function('public', 'list_textbook_supplier_setting_picker_page_v1',
  array['jsonb', 'jsonb', 'text', 'integer', 'integer']::text[], 'supplier picker RPC exists');
select has_function('public', 'get_textbook_publisher_setting_detail_v1',
  array['uuid', 'jsonb']::text[], 'publisher detail RPC exists');
select has_function('public', 'get_textbook_supplier_setting_detail_v1',
  array['uuid', 'jsonb']::text[], 'supplier detail RPC exists');
select has_function('public', 'save_textbook_settings_draft_v1',
  array['uuid', 'jsonb']::text[], 'atomic save RPC exists');

select ok((select bool_and(has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
    and not has_function_privilege('public', procedure.oid, 'EXECUTE'))
  from pg_proc procedure join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public' and procedure.proname in (
    'list_textbook_publisher_page_v1', 'list_textbook_supplier_page_v1',
    'list_textbook_supplier_setting_picker_page_v1', 'get_textbook_publisher_setting_detail_v1',
    'get_textbook_supplier_setting_detail_v1', 'save_textbook_settings_draft_v1')),
  'all six RPCs grant only authenticated execution among caller roles');
select ok((select bool_and(not procedure.prosecdef and procedure.proconfig = array['search_path=""']::text[])
  from pg_proc procedure join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public' and procedure.proname in (
    'list_textbook_publisher_page_v1', 'list_textbook_supplier_page_v1',
    'list_textbook_supplier_setting_picker_page_v1', 'get_textbook_publisher_setting_detail_v1',
    'get_textbook_supplier_setting_detail_v1', 'save_textbook_settings_draft_v1')),
  'all public RPCs remain invoker functions with an empty search path');
select ok(to_regprocedure('textbook_settings_private.apply_links_v1(uuid,jsonb)') is null,
  'no direct mutation helper can bypass guarded save');
select ok(not has_schema_privilege('anon', 'textbook_settings_private', 'USAGE')
    and has_schema_privilege('authenticated', 'textbook_settings_private', 'USAGE')
    and not has_schema_privilege('authenticated', 'textbook_settings_private', 'CREATE'),
  'private schema ACL is usage-only for authenticated');
select ok(has_table_privilege('authenticated', 'textbook_settings_private.owner_draft_receipts', 'SELECT')
    and has_table_privilege('authenticated', 'textbook_settings_private.owner_draft_receipts', 'INSERT')
    and not has_table_privilege('authenticated', 'textbook_settings_private.owner_draft_receipts', 'UPDATE')
    and not has_table_privilege('authenticated', 'textbook_settings_private.owner_draft_receipts', 'DELETE')
    and not has_table_privilege('anon', 'textbook_settings_private.owner_draft_receipts', 'SELECT'),
  'receipt ACL is narrow SELECT and INSERT only');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid = 'textbook_settings_private.owner_draft_receipts'::regclass),
  'receipt table enables and forces RLS');
select is((select count(*) from pg_policy where polrelid =
  'textbook_settings_private.owner_draft_receipts'::regclass), 2::bigint,
  'receipt table has only own-actor SELECT and INSERT policies');
select ok((select bool_and(position('actor_id = auth.uid()' in pg_get_expr(policy.polqual, policy.polrelid)) > 0
      or position('actor_id = auth.uid()' in pg_get_expr(policy.polwithcheck, policy.polrelid)) > 0)
    from pg_policy policy where policy.polrelid =
      'textbook_settings_private.owner_draft_receipts'::regclass),
  'both receipt policies bind rows to auth uid');

create function pg_temp.sid(n integer) returns uuid language sql immutable as $$
  select ('6a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.filters(search_text text default '__t6a__') returns jsonb
language sql immutable as $$ select jsonb_build_object('search', search_text) $$;
create function pg_temp.owner_draft(operations jsonb default '[]'::jsonb) returns jsonb
language sql stable as $$ select jsonb_build_object('version', 1,
  'baseRevision', textbook_settings_private.revision_v1(), 'operations', operations) $$;
create function pg_temp.save_body(operations jsonb default '[]'::jsonb) returns jsonb
language sql stable as $$ select jsonb_build_object('version', 1,
  'owners', pg_temp.owner_draft(operations), 'subSubjects', null) $$;
create function pg_temp.capture_save(request_id uuid, body jsonb)
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

create temp table task6a_values(key text primary key, value jsonb);
create temp table task6a_errors(key text primary key, result_sqlstate text, message_text text, response jsonb);
create temp table task6a_hidden_before(
  kind text, id uuid, value jsonb, primary key(kind, id)
);
grant select, insert, update, delete on task6a_values, task6a_errors, task6a_hidden_before to authenticated;
create temp table task6a_no_send_before as select
  (select count(*) from dashboard_private.notification_events) events,
  (select count(*) from dashboard_private.notification_event_fanout_jobs) jobs,
  (select count(*) from dashboard_private.notification_deliveries) deliveries;

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.sid(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'task6a-' || n || '@example.invalid', crypt('local-only', gen_salt('bf')), now(), '{}', '{}', now(), now()
from generate_series(901, 905) n;
update public.profiles set role = roles.role_name, name = roles.display_name
from (values
  (pg_temp.sid(901), 'admin', 'Task6a 관리자'), (pg_temp.sid(902), 'staff', 'Task6a 직원'),
  (pg_temp.sid(903), 'teacher', 'Task6a 교사'), (pg_temp.sid(904), 'assistant', 'Task6a 보조'),
  (pg_temp.sid(905), 'viewer', 'Task6a 보기')) roles(id, role_name, display_name)
where profiles.id = roles.id;

insert into public.textbook_publishers(id, name, subjects)
select pg_temp.sid(n), case when n = 50 then '__t6a__ Alpha  내부  공백'
  when n = 51 then '__t6a__ 한글10' when n = 52 then '__t6a__ 한글2'
  else '__t6a__ 출판사 ' || n end, array['english']::text[]
from generate_series(1, 112) n;
insert into public.textbook_suppliers(id, name, contact, memo)
select pg_temp.sid(200 + n), '__t6a__ 공급처 ' || n,
  case when n = 1 then '__t6a_contact_only' else '' end, '' from generate_series(1, 112) n;
insert into public.textbook_suppliers(id, name, contact, memo)
values (pg_temp.sid(400), '__t6a__ 공용 총판 LatinX', '', '');
insert into public.textbook_publisher_supplier_links(id, publisher_id, supplier_id, is_primary, priority)
select pg_temp.sid(1000 + n), pg_temp.sid(n), pg_temp.sid(400), true, 1 from generate_series(1, 112) n;
insert into public.textbook_publisher_supplier_links(id, publisher_id, supplier_id, is_primary, priority)
select pg_temp.sid(2000 + n), pg_temp.sid(n), pg_temp.sid(200 + n), false, 2 from generate_series(1, 112) n;

insert into public.textbook_publishers(id, name, subjects, memo, source_notion_url, source_notion_urls,
  created_at, updated_at) values
  (pg_temp.sid(500), 'zz odd link owner', array['english'], 'hidden odd', 'https://hidden.invalid/odd',
    array['https://hidden.invalid/odd-array'], '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z'),
  (pg_temp.sid(501), 'zz hidden owner', array['math'], 'hidden memo', 'https://hidden.invalid/owner',
    array['https://hidden.invalid/owner-array'], '2024-02-01T00:00:00Z', '2024-02-02T00:00:00Z'),
  (pg_temp.sid(502), 'zz affected 1', array['math'], '', null, '{}', now(), now()),
  (pg_temp.sid(503), 'zz affected 2', array['math'], '', null, '{}', now(), now()),
  (pg_temp.sid(504), 'zz unrelated links', array['math'], '', null, '{}', now(), now()),
  (pg_temp.sid(510), ' __t6a_count__', array['other'], '', null, '{}', now(), now()),
  (pg_temp.sid(511), '__t6a_count__', array['other'], '', null, '{}', now(), now()),
  (pg_temp.sid(520), '', array['other'], 'legacy blank untouched', null, '{}', now(), now());
insert into public.textbook_publishers(id,name,subjects) values
  (pg_temp.sid(530), 'zz percent % literal publisher', array['english']),
  (pg_temp.sid(531), 'zz percent literal publisher', array['english']),
  (pg_temp.sid(532), 'zz underscore wild_card publisher', array['english']),
  (pg_temp.sid(533), 'zz underscore wildXcard publisher', array['english']),
  (pg_temp.sid(540), 'zz trim collision', array['english']),
  (pg_temp.sid(541), ' zz trim collision ', array['english']);
insert into public.textbook_suppliers(id, name, contact, memo) values
  (pg_temp.sid(600), 'zz delete supplier', '', ''),
  (pg_temp.sid(601), 'zz remaining 1', '', ''),
  (pg_temp.sid(602), 'zz remaining 2', '', ''),
  (pg_temp.sid(630), 'zz percent % literal supplier', '', ''),
  (pg_temp.sid(631), 'zz percent literal supplier', '', ''),
  (pg_temp.sid(632), 'zz underscore wild_card supplier', '', ''),
  (pg_temp.sid(633), 'zz underscore wildXcard supplier', '', '');
insert into public.textbook_publisher_supplier_links(
  id, publisher_id, supplier_id, is_primary, priority, memo, created_at, updated_at) values
  (pg_temp.sid(3000), pg_temp.sid(500), pg_temp.sid(400), false, 77, 'odd metadata',
    '2024-03-01T00:00:00Z', '2024-03-02T00:00:00Z'),
  (pg_temp.sid(3001), pg_temp.sid(501), pg_temp.sid(400), true, 1, 'hidden link memo',
    '2024-04-01T00:00:00Z', '2024-04-02T00:00:00Z'),
  (pg_temp.sid(3002), pg_temp.sid(502), pg_temp.sid(600), true, 1, 'delete me', now(), now()),
  (pg_temp.sid(3003), pg_temp.sid(502), pg_temp.sid(601), false, 8, 'keep 1', now(), now()),
  (pg_temp.sid(3004), pg_temp.sid(502), pg_temp.sid(602), false, 9, 'keep 2', now(), now()),
  (pg_temp.sid(3005), pg_temp.sid(503), pg_temp.sid(600), true, 1, 'delete me too', now(), now()),
  (pg_temp.sid(3006), pg_temp.sid(503), pg_temp.sid(602), false, 5, 'keep 3', now(), now()),
  (pg_temp.sid(3007), pg_temp.sid(504), pg_temp.sid(601), false, 41, 'unrelated byte',
    '2024-05-01T00:00:00Z', '2024-05-02T00:00:00Z');
insert into public.textbooks(id, title, name, subject, publisher, publisher_id, category, price, sale_price,
  school_level, grade_level, school_levels, grade_levels, sub_subject, status) values
  (pg_temp.sid(8001), 'id wins active', 'id wins active', 'english', 'wrong label', pg_temp.sid(1), '', 0, 0,
    'middle', 'm1', array['middle'], array['m1'], '독해', 'active'),
  (pg_temp.sid(8002), 'id wins inactive', 'id wins inactive', 'english', 'wrong label', pg_temp.sid(1), '', 0, 0,
    'middle', 'm1', array['middle'], array['m1'], '독해', 'inactive'),
  (pg_temp.sid(8003), 'name fallback', 'name fallback', 'english', '__t6a_count__', null, '', 0, 0,
    'middle', 'm1', array['middle'], array['m1'], '독해', 'active');

insert into task6a_hidden_before(kind, id, value) values
  ('noop-publisher', pg_temp.sid(500), (select to_jsonb(p) from public.textbook_publishers p where id = pg_temp.sid(500))),
  ('publisher', pg_temp.sid(501), (select to_jsonb(p) from public.textbook_publishers p where id = pg_temp.sid(501))),
  ('scalar-link', pg_temp.sid(3001), (select to_jsonb(l) from public.textbook_publisher_supplier_links l where id = pg_temp.sid(3001))),
  ('odd-link', pg_temp.sid(3000), (select to_jsonb(l) from public.textbook_publisher_supplier_links l where id = pg_temp.sid(3000))),
  ('unrelated-link', pg_temp.sid(3007), (select to_jsonb(l) from public.textbook_publisher_supplier_links l where id = pg_temp.sid(3007)));

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.sid(901)::text, true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is((public.list_textbook_publisher_page_v1(pg_temp.filters(), null, 'name', 1, 10) ->> 'totalCount')::integer,
  114, 'publisher source has more than one hundred matching rows including linked-name matches');
select is(jsonb_array_length(public.list_textbook_publisher_page_v1(pg_temp.filters(), null, 'name', 10, 10) -> 'rows'),
  10, 'publisher page ten remains bounded');
select is(jsonb_array_length(public.list_textbook_publisher_page_v1(pg_temp.filters(), null, 'name', 11, 10) -> 'rows'),
  10, 'publisher direct page eleven is independently reachable');
select is(jsonb_array_length(public.list_textbook_publisher_page_v1(pg_temp.filters(), null, 'name', 12, 10) -> 'rows'),
  4, 'publisher page ten to eleven sequence reaches the final short page');
select is(jsonb_array_length(public.list_textbook_publisher_page_v1(pg_temp.filters(), null, 'name', 999, 20) -> 'rows'),
  0, 'publisher off-end request echoes an empty row set');
select is((public.list_textbook_publisher_page_v1(pg_temp.filters(), null, 'name', 999, 20) ->> 'totalCount')::integer,
  114, 'publisher off-end request retains exact total');
select is((public.list_textbook_supplier_setting_picker_page_v1(pg_temp.filters(), null, 'name', 11, 10) ->> 'totalCount')::integer,
  113, 'picker searches the full greater-than-one-hundred supplier source');
select is(jsonb_array_length(public.list_textbook_supplier_setting_picker_page_v1(pg_temp.filters(), null, 'name', 11, 10) -> 'rows'),
  10, 'picker direct page eleven remains bounded');
select is((public.list_textbook_supplier_page_v1(pg_temp.filters('latinx'), null, 'name', 1, 10)
    #>> '{rows,0,linkedPublisherCount}')::integer, 114,
  'supplier reverse count includes every off-page linked publisher');
select is(public.list_textbook_supplier_page_v1(pg_temp.filters('latinx'), null, 'name', 1, 10)
    #> '{rows,0,linkedPublisherNames}',
  '["__t6a__ 출판사 1","__t6a__ 출판사 2","__t6a__ 출판사 3"]'::jsonb,
  'supplier first three names use Korean numeric display order with a stable tie');
select is(jsonb_array_length(public.get_textbook_publisher_setting_detail_v1(pg_temp.sid(111), null)
    #> '{row,suppliers}'), 2, 'direct publisher detail carries complete ordered relationships');
select is(public.get_textbook_supplier_setting_detail_v1(pg_temp.sid(400), null) #>> '{row,id}',
  pg_temp.sid(400)::text, 'direct supplier detail resolves independently of pages');
select is(public.get_textbook_publisher_setting_detail_v1(pg_temp.sid(999999), null) -> 'row',
  'null'::jsonb, 'missing selected publisher is explicit null');
select is((public.get_textbook_publisher_setting_detail_v1(pg_temp.sid(1), null) #>> '{row,textbookCount}')::integer,
  2, 'publisher id wins and inactive books remain in count');
select is((public.get_textbook_publisher_setting_detail_v1(pg_temp.sid(511), null) #>> '{row,textbookCount}')::integer,
  1, 'absent id falls back to the last exact-trimmed canonical base publisher');
select is((public.get_textbook_publisher_setting_detail_v1(pg_temp.sid(510), null) #>> '{row,textbookCount}')::integer,
  0, 'an earlier equal-trimmed publisher does not steal fallback count');
select is((public.list_textbook_publisher_page_v1(pg_temp.filters('  ALPHA  내부  '), null, 'name', 1, 10)
    ->> 'totalCount')::integer, 1, 'old JS search trims ends and preserves matching inner whitespace');
select is((public.list_textbook_publisher_page_v1(pg_temp.filters('alpha 내부'), null, 'name', 1, 10)
    ->> 'totalCount')::integer, 0, 'old JS search does not collapse inner whitespace');
select is((public.list_textbook_publisher_page_v1(pg_temp.filters('LATINX'), null, 'name', 1, 10)
    ->> 'totalCount')::integer, 114, 'publisher search is Latin case-insensitive across every link');
select is((public.list_textbook_supplier_page_v1(pg_temp.filters('한글10'), null, 'name', 1, 10)
    ->> 'totalCount')::integer, 2, 'supplier search sees full linked publisher names beyond its page');
select is((public.list_textbook_supplier_page_v1(pg_temp.filters('__t6a_contact_only'), null, 'name', 1, 10)
    ->> 'totalCount')::integer, 0, 'supplier search does not include contact');
select is((public.list_textbook_supplier_setting_picker_page_v1(pg_temp.filters('__t6a_contact_only'), null,
    'name', 1, 10) ->> 'totalCount')::integer, 0, 'picker search is name-only');
select is((public.list_textbook_publisher_page_v1(pg_temp.filters('percent % literal'), null, 'name', 1, 10)
    ->> 'totalCount')::integer, 1, 'publisher percent sign uses literal includes semantics');
select is((public.list_textbook_publisher_page_v1(pg_temp.filters('wild_card'), null, 'name', 1, 10)
    ->> 'totalCount')::integer, 1, 'publisher underscore uses literal includes semantics');
select is((public.list_textbook_supplier_page_v1(pg_temp.filters('percent % literal'), null, 'name', 1, 10)
    ->> 'totalCount')::integer, 1, 'supplier percent sign uses literal includes semantics');
select is((public.list_textbook_supplier_page_v1(pg_temp.filters('wild_card'), null, 'name', 1, 10)
    ->> 'totalCount')::integer, 1, 'supplier underscore uses literal includes semantics');
select is((public.list_textbook_supplier_setting_picker_page_v1(pg_temp.filters('percent % literal'), null,
    'name', 1, 10) ->> 'totalCount')::integer, 1, 'picker percent sign uses literal includes semantics');
select is((public.list_textbook_supplier_setting_picker_page_v1(pg_temp.filters('wild_card'), null,
    'name', 1, 10) ->> 'totalCount')::integer, 1, 'picker underscore uses literal includes semantics');

with draft as (select pg_temp.owner_draft(jsonb_build_array(
  jsonb_build_object('type', 'supplier.add', 'id', pg_temp.sid(700), 'name', '__t6a__ newest supplier', 'contact', '', 'memo', ''),
  jsonb_build_object('type', 'publisher.patch', 'id', pg_temp.sid(1), 'patch', jsonb_build_object('name', '__t6a__ RENAMED 한글')),
  jsonb_build_object('type', 'publisher.delete', 'id', pg_temp.sid(2)),
  jsonb_build_object('type', 'publisher.add', 'id', pg_temp.sid(701), 'name', '__t6a__ newest publisher',
    'subjects', jsonb_build_array('math', ' math ', ''),
    'supplierIds', jsonb_build_array(pg_temp.sid(700)::text, pg_temp.sid(400)::text)))) value)
select is(public.list_textbook_publisher_page_v1(pg_temp.filters('__t6a__ newest publisher'), value,
  'name', 1, 10) #> '{rows,0}', jsonb_build_object(
    'id', pg_temp.sid(701)::text, 'name', '__t6a__ newest publisher', 'subjects', jsonb_build_array('math'),
    'suppliers', jsonb_build_array(
      jsonb_build_object('id', pg_temp.sid(700)::text, 'name', '__t6a__ newest supplier'),
      jsonb_build_object('id', pg_temp.sid(400)::text, 'name', '__t6a__ 공용 총판 LatinX')),
    'textbookCount', 0, 'isNew', true), 'draft add projects complete relationships before filtering') from draft;
with draft as (select pg_temp.owner_draft(jsonb_build_array(
  jsonb_build_object('type', 'publisher.patch', 'id', pg_temp.sid(1), 'patch', jsonb_build_object('name', '__t6a__ RENAMED 한글')),
  jsonb_build_object('type', 'publisher.delete', 'id', pg_temp.sid(2)))) value)
select ok((public.list_textbook_publisher_page_v1(pg_temp.filters('__t6a__ RENAMED 한글'), value,
    'name', 1, 10) #>> '{rows,0,id}') = pg_temp.sid(1)::text
  and public.get_textbook_publisher_setting_detail_v1(pg_temp.sid(2), value) -> 'row' = 'null'::jsonb,
  'draft rename preserves identity while delete removes membership') from draft;
with draft as (select pg_temp.owner_draft(jsonb_build_array(
  jsonb_build_object('type','publisher.add','id',pg_temp.sid(702),'name','new owner first',
    'subjects','[]'::jsonb,'supplierIds','[]'::jsonb),
  jsonb_build_object('type','publisher.add','id',pg_temp.sid(703),'name','new owner second',
    'subjects','[]'::jsonb,'supplierIds','[]'::jsonb))) value)
select is(public.list_textbook_publisher_page_v1(pg_temp.filters('new owner'), value, 'name', 1, 10)
    #>> '{rows,0,id}', pg_temp.sid(703)::text,
  'new draft owners prepend in reverse chronological add order') from draft;
with draft as (select pg_temp.owner_draft(jsonb_build_array(
  jsonb_build_object('type','supplier.add','id',pg_temp.sid(704),'name','owner count supplier','contact','','memo',''),
  jsonb_build_object('type','publisher.add','id',pg_temp.sid(705),'name','owner count publisher',
    'subjects','[]'::jsonb,'supplierIds','[]'::jsonb))) value),
base as (select public.list_textbook_publisher_page_v1(pg_temp.filters('owner count publisher'), null, 'name', 1, 10) value),
projected as (select public.list_textbook_publisher_page_v1(pg_temp.filters('owner count publisher'), draft.value, 'name', 1, 10) value from draft)
select ok((projected.value #>> '{ownerCounts,publishers}')::integer =
    (base.value #>> '{ownerCounts,publishers}')::integer + 1
  and (projected.value #>> '{ownerCounts,suppliers}')::integer =
    (base.value #>> '{ownerCounts,suppliers}')::integer + 1,
  'owner counts cover the full unfiltered projected source') from base, projected;

select throws_ok($$select public.list_textbook_publisher_page_v1('[]'::jsonb, null, 'name', 1, 10)$$,
  '22023', 'textbook_settings_page_invalid', 'nonobject page filter fails exactly');
select throws_ok($$select public.list_textbook_publisher_page_v1('{"search":""}'::jsonb, null, 'name', 1, 11)$$,
  '22023', 'textbook_settings_page_invalid', 'unsupported page size fails exactly');
select throws_ok($$select public.list_textbook_publisher_page_v1('{"search":"","extra":true}'::jsonb, null, 'name', 1, 10)$$,
  '22023', 'textbook_settings_page_invalid', 'unknown page key fails exactly');
select throws_ok($$select public.get_textbook_publisher_setting_detail_v1(null, null)$$,
  '22023', 'textbook_settings_detail_invalid', 'null detail identity fails exactly');
select throws_ok($$select textbook_settings_private.project_v1(jsonb_build_object(
  'version','1','baseRevision',repeat('a',64),'operations','[]'::jsonb))$$,
  '22023', 'textbook_settings_draft_invalid', 'string owner version is rejected');
select throws_ok($$select textbook_settings_private.project_v1(jsonb_build_object(
  'version',1,'baseRevision',textbook_settings_private.revision_v1(),'operations',jsonb_build_array(
    jsonb_build_object('type','publisher.patch','id',pg_temp.sid(9999),'patch',jsonb_build_object('name','missing')))))$$,
  '22023', 'textbook_settings_draft_invalid', 'patch of missing target is rejected');
select throws_ok($$select textbook_settings_private.project_v1(jsonb_build_object(
  'version',1,'baseRevision',textbook_settings_private.revision_v1(),'operations',jsonb_build_array(
    jsonb_build_object('type','supplier.delete','id',pg_temp.sid(201)),
    jsonb_build_object('type','supplier.add','id',pg_temp.sid(201),'name','reused','contact','','memo',''))))$$,
  '22023', 'textbook_settings_draft_invalid', 'delete then add id reuse is rejected');
select throws_ok($$select textbook_settings_private.project_v1(jsonb_build_object(
  'version',1,'baseRevision',textbook_settings_private.revision_v1(),'operations',jsonb_build_array(
    jsonb_build_object('type','supplier.delete','id',pg_temp.sid(201)),
    jsonb_build_object('type','supplier.delete','id',pg_temp.sid(201)))))$$,
  '22023', 'textbook_settings_draft_invalid', 'repeated delete is rejected');
select throws_ok($$select textbook_settings_private.project_v1(jsonb_build_object(
  'version',1,'baseRevision',textbook_settings_private.revision_v1(),'operations',jsonb_build_array(
    jsonb_build_object('type','publisher.patch','id',pg_temp.sid(1),'patch',jsonb_build_object(
      'supplierIds',jsonb_build_array(pg_temp.sid(400)::text,pg_temp.sid(400)::text))))))$$,
  '22023', 'textbook_settings_draft_invalid', 'duplicate supplier identities are rejected');
select throws_ok($$select textbook_settings_private.project_v1(jsonb_build_object(
  'version',1,'baseRevision',textbook_settings_private.revision_v1(),'operations',jsonb_build_array(
    jsonb_build_object('type','publisher.patch','id',pg_temp.sid(1),'patch',jsonb_build_object(
      'supplierIds',jsonb_build_array(pg_temp.sid(9999)::text))))))$$,
  '22023', 'textbook_settings_draft_invalid', 'missing supplier reference is rejected');
select throws_ok($$select public.list_textbook_publisher_page_v1('{"search":""}',jsonb_build_object(
  'version',1,'baseRevision',repeat('0',64),'operations','[]'::jsonb),'name',1,10)$$,
  '55000', 'textbook_settings_revision_conflict', 'read draft base revision mismatch is exact 55000');
select throws_ok($$select public.save_textbook_settings_draft_v1(pg_temp.sid(9000),jsonb_build_object(
  'version','1','owners',pg_temp.owner_draft(),'subSubjects',null))$$,
  '22023', 'textbook_settings_draft_invalid', 'string save version is rejected');
select throws_ok($$select public.save_textbook_settings_draft_v1(pg_temp.sid(9001),
  '{"version":1,"owners":null,"subSubjects":null}'::jsonb)$$,
  '22023', 'textbook_settings_draft_invalid', 'both save sections null is rejected');
select throws_ok($$select public.save_textbook_settings_draft_v1(pg_temp.sid(9002),jsonb_build_object(
  'version',1,'owners',pg_temp.owner_draft(),'subSubjects','{}'::jsonb))$$,
  '22023', 'textbook_settings_draft_invalid', 'nonnull taxonomy is rejected until Task6b');

select is((public.list_textbook_publisher_page_v1(pg_temp.filters(), null, 'name', 1, 10)
  ->> 'totalCount')::integer, 114, 'admin read authority succeeds');
select set_config('request.jwt.claim.sub', pg_temp.sid(902)::text, true);
select is((public.list_textbook_publisher_page_v1(pg_temp.filters(), null, 'name', 1, 10)
  ->> 'totalCount')::integer, 114, 'staff read authority succeeds');
select set_config('request.jwt.claim.sub', pg_temp.sid(903)::text, true);
select is((public.list_textbook_publisher_page_v1(pg_temp.filters(), null, 'name', 1, 10)
  ->> 'totalCount')::integer, 114, 'teacher read authority succeeds');
select throws_ok($$select public.save_textbook_settings_draft_v1(pg_temp.sid(9010), pg_temp.save_body())$$,
  '42501', 'textbook_settings_forbidden', 'teacher write is forbidden');
select set_config('request.jwt.claim.sub', pg_temp.sid(904)::text, true);
select is((public.list_textbook_publisher_page_v1(pg_temp.filters(), null, 'name', 1, 10)
  ->> 'totalCount')::integer, 114, 'assistant read authority succeeds');
select throws_ok($$select public.save_textbook_settings_draft_v1(pg_temp.sid(9011), pg_temp.save_body())$$,
  '42501', 'textbook_settings_forbidden', 'assistant write is forbidden');
select set_config('request.jwt.claim.sub', pg_temp.sid(905)::text, true);
select is((public.list_textbook_publisher_page_v1(pg_temp.filters(), null, 'name', 1, 10)
  ->> 'totalCount')::integer, 114, 'viewer read authority succeeds');
select throws_ok($$select public.save_textbook_settings_draft_v1(pg_temp.sid(9012), pg_temp.save_body())$$,
  '42501', 'textbook_settings_forbidden', 'viewer write is forbidden');
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select public.list_textbook_publisher_page_v1('{"search":""}',null,'name',1,10)$$,
  '42501', 'textbook_settings_forbidden', 'authenticated role without actor is denied by read guard');

select set_config('request.jwt.claim.sub', pg_temp.sid(901)::text, true);
insert into task6a_values values ('utc_revision', to_jsonb(textbook_settings_private.revision_v1()));
select set_config('timezone', 'Asia/Seoul', true);
select is(textbook_settings_private.revision_v1(),
  (select value #>> '{}' from task6a_values where key = 'utc_revision'),
  'revision bytes are stable after changing session timezone to Asia Seoul');
select set_config('timezone', 'America/New_York', true);
select is(textbook_settings_private.revision_v1(),
  (select value #>> '{}' from task6a_values where key = 'utc_revision'),
  'revision bytes are stable after changing session timezone to America New York');
select set_config('timezone', 'UTC', true);
select is(length(textbook_settings_private.revision_v1()), 64,
  'revision is an opaque lowercase sixty-four-character hash');
select ok(textbook_settings_private.revision_v1() ~ '^[0-9a-f]{64}$',
  'revision uses lowercase hexadecimal bytes');

-- An explicit relationship equal to canonical base order must not normalize odd raw link metadata.
insert into task6a_values values ('noop_payload', pg_temp.save_body(jsonb_build_array(
  jsonb_build_object('type', 'publisher.patch', 'id', pg_temp.sid(500), 'patch',
    jsonb_build_object('supplierIds', jsonb_build_array(pg_temp.sid(400)::text))),
  jsonb_build_object('type', 'publisher.patch', 'id', pg_temp.sid(500), 'patch',
    jsonb_build_object('name', 'temporary name')),
  jsonb_build_object('type', 'publisher.patch', 'id', pg_temp.sid(500), 'patch',
    jsonb_build_object('name', 'zz odd link owner')))));
insert into task6a_values
select 'noop_result', public.save_textbook_settings_draft_v1(pg_temp.sid(9100), value)
from task6a_values where key = 'noop_payload';
select is((select value #> '{owners,changedPublisherIds}' from task6a_values where key = 'noop_result'),
  '[]'::jsonb, 'A to B to A publisher final state reports no owner change');
select is((select value #> '{owners,changedLinkPublisherIds}' from task6a_values where key = 'noop_result'),
  '[]'::jsonb, 'equal canonical relationship reports no link change');
select is((select to_jsonb(publisher) from public.textbook_publishers publisher where id = pg_temp.sid(500)),
  (select value from task6a_hidden_before where kind = 'noop-publisher' and id = pg_temp.sid(500)),
  'A to B to A no-op preserves owner timestamps and hidden bytes');
select is((select to_jsonb(link) from public.textbook_publisher_supplier_links link where id = pg_temp.sid(3000)),
  (select value from task6a_hidden_before where kind = 'odd-link' and id = pg_temp.sid(3000)),
  'equal relationship preserves odd flags id memo and timestamps byte-for-byte');
select is(current_setting('lock_timeout'), '7s', 'successful save restores caller lock timeout');

insert into task6a_values values ('trim_collision_payload', pg_temp.save_body(jsonb_build_array(
  jsonb_build_object('type','publisher.patch','id',pg_temp.sid(540),'patch',
    jsonb_build_object('subjects',jsonb_build_array(' english ','english'))))));
select lives_ok($$select public.save_textbook_settings_draft_v1(pg_temp.sid(9102),
  (select value from task6a_values where key='trim_collision_payload'))$$,
  'non-name edit is not blocked by unrelated legacy trim-colliding names');
insert into task6a_values select 'trim_collision_result',
  public.save_textbook_settings_draft_v1(pg_temp.sid(9102), value)
from task6a_values where key='trim_collision_payload';
select is((select value #> '{owners,changedPublisherIds}' from task6a_values
    where key='trim_collision_result'), '[]'::jsonb,
  'normalized-equal subject edit beside legacy name collision remains a semantic no-op');

-- Change the base after receipt creation: exact replay must win before stale revision comparison.
reset role;
insert into task6a_values values ('before_hidden_revision', to_jsonb(textbook_settings_private.revision_v1()));
update public.textbook_publishers set memo = 'base changed after receipt' where id = pg_temp.sid(112);
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.sid(901)::text, true);
select isnt(textbook_settings_private.revision_v1(),
  (select value #>> '{}' from task6a_values where key='before_hidden_revision'),
  'canonical revision hashes hidden publisher fields and timestamps');
select is(public.save_textbook_settings_draft_v1(pg_temp.sid(9100),
    (select value from task6a_values where key = 'noop_payload')),
  (select value from task6a_values where key = 'noop_result'),
  'matching receipt replays exact stored result before stale revision');
select is(current_setting('lock_timeout'), '7s', 'receipt replay restores caller lock timeout');
select throws_ok($$select public.save_textbook_settings_draft_v1(pg_temp.sid(9100),
  jsonb_set((select value from task6a_values where key='noop_payload'),
    '{owners,operations}', jsonb_build_array(jsonb_build_object('type','publisher.patch',
      'id',pg_temp.sid(500),'patch',jsonb_build_object('name','different body')))))$$,
  '22023', 'textbook_settings_request_mismatch', 'request id reuse with a different body is rejected');
select is(current_setting('lock_timeout'), '7s', 'request mismatch restores caller lock timeout');

insert into task6a_errors
select 'stale', captured.* from pg_temp.capture_save(pg_temp.sid(9101), jsonb_build_object(
  'version', 1, 'owners', jsonb_build_object('version', 1, 'baseRevision', repeat('0', 64),
    'operations', '[]'::jsonb), 'subSubjects', null)) captured;
select is((select result_sqlstate from task6a_errors where key = 'stale'), '55000',
  'stale draft preserves exact 55000 SQLSTATE');
select is((select message_text from task6a_errors where key = 'stale'), 'textbook_settings_revision_conflict',
  'stale draft uses exact revision conflict message');
select is(current_setting('lock_timeout'), '7s', 'stale failure restores caller lock timeout');

-- Same request id belongs to a different actor receipt namespace.
select set_config('request.jwt.claim.sub', pg_temp.sid(902)::text, true);
insert into task6a_values values ('staff_same_request_payload', pg_temp.save_body());
insert into task6a_values select 'staff_same_request_result',
  public.save_textbook_settings_draft_v1(pg_temp.sid(9100), value)
from task6a_values where key = 'staff_same_request_payload';
select is((select count(*) from textbook_settings_private.owner_draft_receipts
    where request_id = pg_temp.sid(9100)), 1::bigint,
  'staff RLS sees only its own same-request receipt');
select set_config('request.jwt.claim.sub', pg_temp.sid(901)::text, true);
select is((select count(*) from textbook_settings_private.owner_draft_receipts
    where request_id = pg_temp.sid(9100)), 1::bigint,
  'admin RLS also sees only its own same-request receipt');
reset role;
select is((select count(*) from textbook_settings_private.owner_draft_receipts
    where request_id = pg_temp.sid(9100)), 2::bigint,
  'physical receipt key is isolated by actor and request id');

-- Admin scalar save touches only the edited field; hidden owner and link bytes stay intact.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.sid(901)::text, true);
insert into task6a_values values ('admin_scalar_payload', pg_temp.save_body(jsonb_build_array(
  jsonb_build_object('type', 'publisher.patch', 'id', pg_temp.sid(501), 'patch',
    jsonb_build_object('name', 'zz hidden owner renamed')))));
insert into task6a_values select 'admin_scalar_result',
  public.save_textbook_settings_draft_v1(pg_temp.sid(9200), value)
from task6a_values where key = 'admin_scalar_payload';
select is((select value #> '{owners,changedPublisherIds}' from task6a_values where key='admin_scalar_result'),
  jsonb_build_array(pg_temp.sid(501)::text), 'admin write reports the physically changed publisher');
select is((select jsonb_build_object('memo', p.memo, 'source_notion_url', p.source_notion_url,
      'source_notion_urls', p.source_notion_urls, 'created_at', p.created_at)
    from public.textbook_publishers p where p.id = pg_temp.sid(501)),
  (select jsonb_build_object('memo', value->'memo', 'source_notion_url', value->'source_notion_url',
      'source_notion_urls', value->'source_notion_urls', 'created_at', value->'created_at')
    from task6a_hidden_before where kind='publisher' and id=pg_temp.sid(501)),
  'scalar publisher edit preserves every hidden owner field and created timestamp');
select is((select to_jsonb(link) from public.textbook_publisher_supplier_links link where id=pg_temp.sid(3001)),
  (select value from task6a_hidden_before where kind='scalar-link' and id=pg_temp.sid(3001)),
  'scalar publisher edit never rebuilds or normalizes links');

-- Staff save proves write authorization and an add/link sequence in one atomic result.
select set_config('request.jwt.claim.sub', pg_temp.sid(902)::text, true);
insert into task6a_values values ('staff_add_payload', pg_temp.save_body(jsonb_build_array(
  jsonb_build_object('type','supplier.add','id',pg_temp.sid(710),'name','zz staff supplier','contact',' c ','memo',' m '),
  jsonb_build_object('type','publisher.add','id',pg_temp.sid(711),'name','zz staff publisher',
    'subjects',jsonb_build_array('math'),'supplierIds',jsonb_build_array(pg_temp.sid(710)::text)))));
insert into task6a_values select 'staff_add_result',
  public.save_textbook_settings_draft_v1(pg_temp.sid(9201), value)
from task6a_values where key='staff_add_payload';
select is((select value #> '{owners,changedSupplierIds}' from task6a_values where key='staff_add_result'),
  jsonb_build_array(pg_temp.sid(710)::text), 'staff write reports added supplier');
select is((select value #> '{owners,changedPublisherIds}' from task6a_values where key='staff_add_result'),
  jsonb_build_array(pg_temp.sid(711)::text), 'staff write reports added publisher');
select is(public.get_textbook_publisher_setting_detail_v1(pg_temp.sid(711), null) #>> '{row,suppliers,0,id}',
  pg_temp.sid(710)::text, 'saved relationship is visible through direct detail');
select is((select contact from public.textbook_suppliers where id=pg_temp.sid(710)), 'c',
  'staff save trims contact at persistence boundary');

-- Deleting one supplier normalizes only the publishers that actually referenced it.
select set_config('request.jwt.claim.sub', pg_temp.sid(901)::text, true);
insert into task6a_values values ('supplier_delete_payload', pg_temp.save_body(jsonb_build_array(
  jsonb_build_object('type','supplier.delete','id',pg_temp.sid(600)))));
insert into task6a_values select 'supplier_delete_result',
  public.save_textbook_settings_draft_v1(pg_temp.sid(9202), value)
from task6a_values where key='supplier_delete_payload';
select is((select value #> '{owners,deletedSupplierIds}' from task6a_values where key='supplier_delete_result'),
  jsonb_build_array(pg_temp.sid(600)::text), 'supplier delete reports only deleted supplier');
select is((select value #> '{owners,changedLinkPublisherIds}' from task6a_values where key='supplier_delete_result'),
  jsonb_build_array(pg_temp.sid(502)::text, pg_temp.sid(503)::text),
  'supplier delete reports only affected publishers in stable UUID order');
select is((select jsonb_agg(jsonb_build_object('supplier',supplier_id,'primary',is_primary,'priority',priority)
      order by priority) from public.textbook_publisher_supplier_links where publisher_id=pg_temp.sid(502)),
  jsonb_build_array(
    jsonb_build_object('supplier',pg_temp.sid(601),'primary',true,'priority',1),
    jsonb_build_object('supplier',pg_temp.sid(602),'primary',false,'priority',2)),
  'supplier delete normalizes remaining affected links to primary and one-based priority');
select is((select to_jsonb(link) from public.textbook_publisher_supplier_links link where id=pg_temp.sid(3007)),
  (select value from task6a_hidden_before where kind='unrelated-link' and id=pg_temp.sid(3007)),
  'supplier delete leaves unrelated link bytes untouched');
select is((select memo from public.textbook_publisher_supplier_links where id=pg_temp.sid(3003)),
  'keep 1', 'affected surviving link keeps hidden memo and identity');

-- An unrelated save remains possible while a legacy blank owner exists.
insert into task6a_values values ('legacy_scope_payload', pg_temp.save_body(jsonb_build_array(
  jsonb_build_object('type','supplier.patch','id',pg_temp.sid(201),'patch',jsonb_build_object('memo','scope ok')))));
select lives_ok($$select public.save_textbook_settings_draft_v1(pg_temp.sid(9203),
  (select value from task6a_values where key='legacy_scope_payload'))$$,
  'unrelated legacy-invalid blank owner does not block an independent dirty supplier');

-- Final-state validation happens before DML and rolls back the whole request.
insert into task6a_errors
select 'duplicate_final_name', captured.* from pg_temp.capture_save(pg_temp.sid(9300), pg_temp.save_body(jsonb_build_array(
  jsonb_build_object('type','supplier.add','id',pg_temp.sid(720),'name','zz rollback marker','contact','','memo',''),
  jsonb_build_object('type','publisher.add','id',pg_temp.sid(721),'name','zz hidden owner renamed',
    'subjects','[]'::jsonb,'supplierIds','[]'::jsonb)))) captured;
select is((select result_sqlstate from task6a_errors where key='duplicate_final_name'), '23505',
  'duplicate dirty final raw owner name preserves native UNIQUE SQLSTATE');
select is((select count(*) from public.textbook_suppliers where id=pg_temp.sid(720)), 0::bigint,
  'late journal validation rolls back an earlier valid add');

-- A native CHECK violation remains native and rolls back an earlier physical insert.
reset role;
alter table public.textbook_publishers add constraint task6a_native_check
  check (name <> 'zz native check blocked');
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.sid(901)::text, true);
insert into task6a_errors
select 'native_check', captured.* from pg_temp.capture_save(pg_temp.sid(9301), pg_temp.save_body(jsonb_build_array(
  jsonb_build_object('type','publisher.add','id',pg_temp.sid(722),'name','zz native check blocked',
    'subjects','[]'::jsonb,'supplierIds','[]'::jsonb),
  jsonb_build_object('type','supplier.add','id',pg_temp.sid(723),'name','zz native check rollback','contact','','memo','')))) captured;
select is((select result_sqlstate from task6a_errors where key='native_check'), '23514',
  'native CHECK SQLSTATE is preserved without domain remapping');
select is((select count(*) from public.textbook_suppliers where id=pg_temp.sid(723)), 0::bigint,
  'native CHECK failure rolls back the earlier supplier insert');
reset role;
alter table public.textbook_publishers drop constraint task6a_native_check;

-- A temporary case-insensitive unique oracle proves native 23505 and rollback.
insert into public.textbook_suppliers(id,name,contact,memo)
values(pg_temp.sid(724),'zz_task6a_unique_case','','');
create unique index task6a_native_unique on public.textbook_suppliers(lower(name))
  where lower(name) like 'zz_task6a_unique_%';
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.sid(901)::text, true);
insert into task6a_errors
select 'native_unique', captured.* from pg_temp.capture_save(pg_temp.sid(9302), pg_temp.save_body(jsonb_build_array(
  jsonb_build_object('type','supplier.add','id',pg_temp.sid(725),'name','ZZ_TASK6A_UNIQUE_CASE','contact','','memo',''),
  jsonb_build_object('type','supplier.add','id',pg_temp.sid(726),'name','zz unique rollback marker','contact','','memo','')))) captured;
select is((select result_sqlstate from task6a_errors where key='native_unique'), '23505',
  'native UNIQUE SQLSTATE is preserved without remapping');
select is((select count(*) from public.textbook_suppliers where id=pg_temp.sid(726)), 0::bigint,
  'native UNIQUE failure rolls back an earlier physical insert');
reset role;
drop index task6a_native_unique;

select ok(exists(select 1 from pg_constraint where contype='f'
    and conrelid='public.textbook_publisher_supplier_links'::regclass
    and confrelid='public.textbook_suppliers'::regclass),
  'existing supplier foreign key remains the native link constraint');
select ok(exists(select 1 from pg_constraint where contype='f'
    and conrelid='public.textbook_publisher_supplier_links'::regclass
    and confrelid='public.textbook_publishers'::regclass),
  'existing publisher foreign key remains the native link constraint');
select ok((select bool_and(not procedure.prosrc like '%40001%') from pg_proc procedure
  join pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname in ('public','textbook_settings_private')
    and procedure.proname in ('save_textbook_settings_draft_v1','project_v1')),
  'owner save never manufactures SQLSTATE 40001');
select ok((select position('lock table public.textbook_publishers' in lower(pg_get_functiondef(procedure.oid)))
      < position('lock table public.textbook_suppliers' in lower(pg_get_functiondef(procedure.oid)))
    and position('lock table public.textbook_suppliers' in lower(pg_get_functiondef(procedure.oid)))
      < position('lock table public.textbook_publisher_supplier_links' in lower(pg_get_functiondef(procedure.oid)))
  from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname='public' and procedure.proname='save_textbook_settings_draft_v1'),
  'save takes owner collection locks in the fixed publisher supplier link order');

-- The function-local one-second timeout also covers the namespaced request lock.
select dblink_connect('task6a_lock_blocker',
  'hostaddr=' || host(inet_server_addr()) || ' port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres application_name=task6a_lock_blocker');
select dblink_exec('task6a_lock_blocker', 'begin');
select dblink_exec('task6a_lock_blocker', $remote$
do $blocker$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    '6a000000-0000-4000-8000-000000000901:6a000000-0000-4000-8000-000000009400', 0));
end
$blocker$;
$remote$);
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.sid(901)::text, true);
insert into task6a_values values ('lock_payload', pg_temp.save_body());
insert into task6a_errors
select 'native_lock', captured.* from pg_temp.capture_save(pg_temp.sid(9400),
  (select value from task6a_values where key='lock_payload')) captured;
select is((select result_sqlstate from task6a_errors where key='native_lock'), '55P03',
  'request-lock timeout preserves native 55P03');
select ok((select message_text from task6a_errors where key='native_lock') like '%lock timeout%',
  'native lock timeout remains visible rather than remapped');
select is(current_setting('lock_timeout'), '7s', 'native lock failure restores caller lock timeout');
reset role;
select dblink_exec('task6a_lock_blocker', 'rollback');
select dblink_disconnect('task6a_lock_blocker');

-- Receipt RLS expression and physical actor key prevent cross-actor access.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.sid(901)::text, true);
select throws_ok($$insert into textbook_settings_private.owner_draft_receipts(
  actor_id,request_id,request_hash,result) values(
    pg_temp.sid(902),pg_temp.sid(9500),repeat('a',64),'{}'::jsonb)$$,
  '42501', 'new row violates row-level security policy for table "owner_draft_receipts"',
  'receipt INSERT RLS rejects a different actor id');

reset role;
select is((select count(*) from dashboard_private.notification_events),
  (select events from task6a_no_send_before), 'owner reads and saves create no notification events');
select is((select count(*) from dashboard_private.notification_event_fanout_jobs),
  (select jobs from task6a_no_send_before), 'owner reads and saves create no fanout jobs');
select is((select count(*) from dashboard_private.notification_deliveries),
  (select deliveries from task6a_no_send_before), 'owner reads and saves create no deliveries');
select is(current_setting('lock_timeout'), '7s', 'test caller timeout remains restored at final boundary');

select * from finish();
rollback;
