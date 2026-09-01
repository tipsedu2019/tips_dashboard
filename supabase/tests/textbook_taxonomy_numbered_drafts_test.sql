begin;
set local lock_timeout = '7s';
create extension if not exists dblink;
select no_plan();

select has_function('public','list_textbook_sub_subject_numbered_page_v1',
  array['jsonb','jsonb','integer','integer']::text[], 'taxonomy numbered page exists');
select function_returns('public','list_textbook_sub_subject_numbered_page_v1',
  array['jsonb','jsonb','integer','integer']::text[], 'jsonb', 'taxonomy numbered page returns jsonb');
select ok(has_function_privilege('authenticated',
    'public.list_textbook_sub_subject_numbered_page_v1(jsonb,jsonb,integer,integer)', 'EXECUTE')
    and not has_function_privilege('anon',
      'public.list_textbook_sub_subject_numbered_page_v1(jsonb,jsonb,integer,integer)', 'EXECUTE')
    and not has_function_privilege('public',
      'public.list_textbook_sub_subject_numbered_page_v1(jsonb,jsonb,integer,integer)', 'EXECUTE'),
  'taxonomy page execution is authenticated only');
select ok(has_function_privilege('authenticated',
    'public.save_textbook_settings_draft_v1(uuid,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon',
      'public.save_textbook_settings_draft_v1(uuid,jsonb)', 'EXECUTE'),
  'shared save execution remains authenticated only');
select ok((select bool_and(not procedure.prosecdef and procedure.proconfig = array['search_path=""']::text[])
  from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname='public' and procedure.proname in (
    'list_textbook_sub_subject_numbered_page_v1','save_textbook_settings_draft_v1')),
  'taxonomy page and shared save remain invoker functions with empty search path');
select ok((select count(*) from pg_policy
    where polrelid='public.textbook_sub_subject_settings'::regclass) = 2,
  'existing taxonomy RLS policy count is unchanged');
select ok((select relrowsecurity from pg_class
    where oid='public.textbook_sub_subject_settings'::regclass),
  'taxonomy table keeps RLS enabled');
select ok(position('40001' in pg_get_functiondef(
    'public.save_textbook_settings_draft_v1(uuid,jsonb)'::regprocedure)) = 0,
  'shared save never manufactures SQLSTATE 40001');
select ok((select
    position('lock table public.textbook_publishers' in lower(pg_get_functiondef(procedure.oid)))
      < position('lock table public.textbook_suppliers' in lower(pg_get_functiondef(procedure.oid)))
    and position('lock table public.textbook_suppliers' in lower(pg_get_functiondef(procedure.oid)))
      < position('lock table public.textbook_publisher_supplier_links' in lower(pg_get_functiondef(procedure.oid)))
    and position('lock table public.textbook_publisher_supplier_links' in lower(pg_get_functiondef(procedure.oid)))
      < position('lock table public.textbook_sub_subject_settings' in lower(pg_get_functiondef(procedure.oid)))
  from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname='public' and procedure.proname='save_textbook_settings_draft_v1'),
  'mixed save source keeps the fixed owners then taxonomy lock order');
select ok(to_regprocedure('textbook_settings_private.apply_sub_subject_draft_v1(jsonb)') is null,
  'no callable private mutation shortcut bypasses the guarded save');

create function pg_temp.sid(n integer) returns uuid language sql immutable as $$
  select ('6e000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.filters(subject_name text default 'other', search_text text default '') returns jsonb
language sql immutable as $$ select jsonb_build_object('subject',subject_name,'search',search_text) $$;
create function pg_temp.tax_draft(operations jsonb default '[]'::jsonb) returns jsonb
language sql stable as $$ select jsonb_build_object('version',1,
  'baseRevision',textbook_settings_private.taxonomy_revision_v1(),'operations',operations) $$;
create function pg_temp.owner_draft(operations jsonb default '[]'::jsonb) returns jsonb
language sql stable as $$ select jsonb_build_object('version',1,
  'baseRevision',textbook_settings_private.revision_v1(),'operations',operations) $$;
create function pg_temp.tax_body(operations jsonb default '[]'::jsonb) returns jsonb
language sql stable as $$ select jsonb_build_object('version',1,'owners',null,
  'subSubjects',pg_temp.tax_draft(operations)) $$;
create function pg_temp.owner_body(operations jsonb default '[]'::jsonb) returns jsonb
language sql stable as $$ select jsonb_build_object('version',1,
  'owners',pg_temp.owner_draft(operations),'subSubjects',null) $$;
create function pg_temp.mixed_body(owner_operations jsonb, taxonomy_operations jsonb) returns jsonb
language sql stable as $$ select jsonb_build_object('version',1,
  'owners',pg_temp.owner_draft(owner_operations),
  'subSubjects',pg_temp.tax_draft(taxonomy_operations)) $$;
create function pg_temp.capture_save(request_id uuid, body jsonb)
returns table(result_sqlstate text, message_text text, response jsonb)
language plpgsql as $$
begin
  begin
    response := public.save_textbook_settings_draft_v1(request_id,body);
    result_sqlstate := '00000'; message_text := null; return next;
  exception when others then
    get stacked diagnostics result_sqlstate = returned_sqlstate, message_text = message_text;
    response := null; return next;
  end;
end
$$;
grant execute on all functions in schema pg_temp to authenticated;

create temp table task6b_values(key text primary key,value jsonb);
create temp table task6b_errors(key text primary key,result_sqlstate text,message_text text,response jsonb);
grant select,insert,update,delete on task6b_values,task6b_errors to authenticated;
create temp table task6b_no_send_before as select
  (select count(*) from dashboard_private.notification_events) events,
  (select count(*) from dashboard_private.notification_event_fanout_jobs) jobs,
  (select count(*) from dashboard_private.notification_deliveries) deliveries;

delete from public.textbook_sub_subject_settings;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.sid(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'task6b-'||n||'@example.invalid',crypt('local-only',gen_salt('bf')),now(),'{}','{}',now(),now()
from generate_series(901,905) n;
update public.profiles set role=roles.role_name,name=roles.display_name
from (values
  (pg_temp.sid(901),'admin','Task6b 관리자'),(pg_temp.sid(902),'staff','Task6b 직원'),
  (pg_temp.sid(903),'teacher','Task6b 교사'),(pg_temp.sid(904),'assistant','Task6b 보조'),
  (pg_temp.sid(905),'viewer','Task6b 보기')) roles(id,role_name,display_name)
where profiles.id=roles.id;

insert into public.textbook_sub_subject_settings(id,subject,name,sort_order,is_visible)
select pg_temp.sid(n),case when n=112 then 'legacy-unknown' else 'other' end,
  '__t6b__ 사용자 '||n,100+n*10,(n%4)<>0
from generate_series(1,112) n;
insert into public.textbook_sub_subject_settings(id,subject,name,sort_order,is_visible) values
  (pg_temp.sid(200),'english','단어',10,false),
  (pg_temp.sid(201),'영어','__t6b__ 레거시',15,true),
  (pg_temp.sid(202),'math','   ',999,true);

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
select set_config('request.jwt.claim.role','authenticated',true);

select is((public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.filters('other',''),null,1,10)#>>'{subjectCounts,other}')::integer,
  113,'other count includes 112 custom rows and one missing default');
select is((public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.filters('other','__t6b__'),null,1,10)->>'totalCount')::integer,
  112,'search count is computed after the complete overlay');
select is(jsonb_array_length(public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.filters('other','__t6b__'),null,11,10)->'rows'),10,
  'direct page eleven returns ten rows in one request');
select is(jsonb_array_length(public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.filters('other','__t6b__'),null,12,10)->'rows'),2,
  'page twelve returns the final two rows');
select is(jsonb_array_length(public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.filters('other','__t6b__'),null,999,20)->'rows'),0,
  'off-end taxonomy page echoes an empty row set');
select is((public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.filters('other','__t6b__'),null,999,20)->>'totalCount')::integer,112,
  'off-end taxonomy page retains the exact total');
select is(public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.filters('other',''),null,1,10)->'subjectCounts',
  '{"english":7,"math":9,"science":5,"other":113}'::jsonb,
  'subject counts include hidden editable rows and all missing defaults');
select is((public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.filters('other',''),null,1,10)->>'visibleCount')::integer,105,
  'visible badge is whole-taxonomy visibility independent of page and search');
select is((select row->>'kind' from jsonb_array_elements(
    public.list_textbook_sub_subject_numbered_page_v1(
      pg_temp.filters('english','단어'),null,1,10)->'rows') row
    where row->>'id'=pg_temp.sid(200)::text),'persisted',
  'hidden persisted default suppresses the virtual default and remains editable');
select is((select (row->>'isVisible')::boolean from jsonb_array_elements(
    public.list_textbook_sub_subject_numbered_page_v1(
      pg_temp.filters('english','단어'),null,1,10)->'rows') row
    where row->>'id'=pg_temp.sid(200)::text),false,
  'hidden persisted row retains its visibility flag');
select is((select row->>'id' from jsonb_array_elements(
    public.list_textbook_sub_subject_numbered_page_v1(
      pg_temp.filters('english','독해'),null,1,10)->'rows') row
    where row->>'kind'='default'),'english-독해',
  'missing built-in keeps its stable non-UUID identity');
select is((select count(*) from jsonb_array_elements(
    public.list_textbook_sub_subject_numbered_page_v1(
      pg_temp.filters('math',''),null,1,20)->'rows') row where row->>'name'=''),0::bigint,
  'persisted trimmed-empty names keep the legacy read omission');
select is((select row->>'subject' from jsonb_array_elements(
    public.list_textbook_sub_subject_numbered_page_v1(
      pg_temp.filters('other','사용자 112'),null,1,10)->'rows') row), 'other',
  'unknown persisted subjects normalize to other for presentation');
select is((select row->>'subject' from jsonb_array_elements(
    public.list_textbook_sub_subject_numbered_page_v1(
      pg_temp.filters('english','레거시'),null,1,10)->'rows') row), 'english',
  'Korean persisted subject aliases normalize to English');
select is((select count(*) from public.textbook_sub_subject_settings),115::bigint,
  'ordinary projected reads do not materialize defaults or write rows');

insert into task6b_values values ('utc_revision',to_jsonb(textbook_settings_private.taxonomy_revision_v1()));
reset role;
set local timezone='America/Los_Angeles';
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
select is(textbook_settings_private.taxonomy_revision_v1(),
  (select value#>>'{}' from task6b_values where key='utc_revision'),
  'taxonomy revision is independent of session timezone');
reset role;
set local timezone='UTC';
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);

select throws_ok($$select public.list_textbook_sub_subject_numbered_page_v1(
  '{}'::jsonb,null,1,10)$$,'22023','textbook_settings_page_invalid',
  'incomplete filters fail with domain input state');
select throws_ok($$select public.list_textbook_sub_subject_numbered_page_v1(
  '{"subject":"all","search":""}'::jsonb,null,1,10)$$,
  '22023','textbook_settings_page_invalid','noncanonical subject fails');
select throws_ok($$select public.list_textbook_sub_subject_numbered_page_v1(
  pg_temp.filters(),null,1,5)$$,'22023','textbook_settings_page_invalid',
  'taxonomy page size below ten fails');
select throws_ok($$select public.list_textbook_sub_subject_numbered_page_v1(
  pg_temp.filters(),'{"version":1,"baseRevision":"bad","operations":[]}'::jsonb,1,10)$$,
  '22023','textbook_settings_draft_invalid','malformed taxonomy draft fails');
select throws_ok($$select public.list_textbook_sub_subject_numbered_page_v1(
  pg_temp.filters(),jsonb_build_object('version',1,'baseRevision',repeat('0',64),'operations','[]'::jsonb),1,10)$$,
  '55000','textbook_settings_revision_conflict','stale taxonomy read fails with 55000');
select throws_ok($$select public.list_textbook_sub_subject_numbered_page_v1(
  pg_temp.filters(),pg_temp.tax_draft(jsonb_build_array(jsonb_build_object(
    'type','patch','id',pg_temp.sid(999),'patch',jsonb_build_object('name','없음')))),1,10)$$,
  '22023','textbook_settings_draft_invalid','unknown journal target fails');
select throws_ok($$select public.list_textbook_sub_subject_numbered_page_v1(
  pg_temp.filters(),pg_temp.tax_draft(jsonb_build_array(
    jsonb_build_object('type','add','id',pg_temp.sid(300),'subject','other','name','새 행','isVisible',true),
    jsonb_build_object('type','delete','id',pg_temp.sid(300)),
    jsonb_build_object('type','add','id',pg_temp.sid(300),'subject','other','name','재사용','isVisible',true))),1,10)$$,
  '22023','textbook_settings_draft_invalid','deleted add identity cannot be reused');
select throws_ok($$select public.list_textbook_sub_subject_numbered_page_v1(
  pg_temp.filters(),pg_temp.tax_draft(jsonb_build_array(jsonb_build_object(
    'type','patch','id',pg_temp.sid(1),'patch','{}'::jsonb))),1,10)$$,
  '22023','textbook_settings_draft_invalid','empty patch is rejected');

select is((public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.filters('other',''),pg_temp.tax_draft(jsonb_build_array(jsonb_build_object(
      'type','add','id',pg_temp.sid(300),'subject','other','name','','isVisible',true))),12,10)
    #>>'{rows,3,id}'),pg_temp.sid(300)::text,
  'blank new rows remain in projected preview at the global subject end');
select is((public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.filters('other',''),pg_temp.tax_draft(jsonb_build_array(jsonb_build_object(
      'type','add','id',pg_temp.sid(301),'subject','other','name','전역 끝','isVisible',true))),12,10)
    #>>'{rows,3,sortOrder}')::integer,1230,
  'add derives rank from the complete subject maximum plus ten');
select is((public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.filters('other',''),pg_temp.tax_draft(jsonb_build_array(jsonb_build_object(
      'type','move','id',pg_temp.sid(100),'direction','up'))),10,10)
    #>>'{rows,9,id}'),pg_temp.sid(100)::text,
  'move crosses the real page-ten/page-eleven boundary');
select is((public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.filters('other','사용자 50'),null,1,10)#>>'{rows,0,canMoveUp}')::boolean,true,
  'search-local first result keeps global move-up availability');
select is((public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.filters('other','사용자 50'),null,1,10)#>>'{rows,0,canMoveDown}')::boolean,true,
  'search-local last result keeps global move-down availability');
select is((public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.filters('other',''),null,1,10)#>>'{rows,0,canMoveUp}')::boolean,false,
  'global first subject row cannot move up');
select is((public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.filters('other',''),null,12,10)#>>'{rows,2,canMoveDown}')::boolean,false,
  'global final subject row cannot move down');
reset role;
update public.textbook_sub_subject_settings set sort_order=777 where id in (pg_temp.sid(50),pg_temp.sid(51));
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
select ok((select min(item.ordinality) filter (where item.value->>'id'=pg_temp.sid(51)::text)
      < min(item.ordinality) filter (where item.value->>'id'=pg_temp.sid(50)::text)
    from jsonb_array_elements(textbook_settings_private.project_sub_subject_v1(
      pg_temp.tax_draft(jsonb_build_array(jsonb_build_object(
        'type','move','id',pg_temp.sid(51),'direction','up'))))) with ordinality item(value,ordinality)),
  'legacy equal-rank neighbors still swap in the complete subject order');
reset role;
update public.textbook_sub_subject_settings set sort_order=case id when pg_temp.sid(50) then 600 else 610 end
where id in (pg_temp.sid(50),pg_temp.sid(51));
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
select is((select count(*) from jsonb_array_elements(
    public.list_textbook_sub_subject_numbered_page_v1(
      pg_temp.filters('science','화학'),pg_temp.tax_draft(jsonb_build_array(
        jsonb_build_object('type','delete','id','science-화학'))),1,10)->'rows')),0::bigint,
  'virtual default tombstone suppresses the row inside the active draft');
select is((select count(*) from jsonb_array_elements(
    public.list_textbook_sub_subject_numbered_page_v1(
      pg_temp.filters('science','화학'),null,1,10)->'rows')),1::bigint,
  'fresh canonical reload recreates a deleted virtual default');

insert into task6b_values values ('move_unrelated_before',(select to_jsonb(setting)
  from public.textbook_sub_subject_settings setting where id=pg_temp.sid(90)));
insert into task6b_values values ('move_custom_result',public.save_textbook_settings_draft_v1(
  pg_temp.sid(9001),pg_temp.tax_body(jsonb_build_array(jsonb_build_object(
    'type','move','id',pg_temp.sid(100),'direction','up')))));
select is((select value#>'{subSubjects,changedIds}' from task6b_values where key='move_custom_result'),
  to_jsonb(array[pg_temp.sid(99),pg_temp.sid(100)]),
  'persisted move changes exactly the target and its complete-order neighbor');
select is((select sort_order from public.textbook_sub_subject_settings where id=pg_temp.sid(100)),1090,
  'persisted move stores the neighbor rank on its target');
select is((select to_jsonb(setting) from public.textbook_sub_subject_settings setting where id=pg_temp.sid(90)),
  (select value from task6b_values where key='move_unrelated_before'),
  'persisted move leaves unrelated off-page bytes unchanged');

-- Every authenticated dashboard read role retains caller-RLS access.
select set_config('request.jwt.claim.sub',pg_temp.sid(902)::text,true);
select is((public.list_textbook_sub_subject_numbered_page_v1(
  pg_temp.filters('science',''),null,1,10)->>'totalCount')::integer,5,'staff can read taxonomy');
select set_config('request.jwt.claim.sub',pg_temp.sid(903)::text,true);
select is((public.list_textbook_sub_subject_numbered_page_v1(
  pg_temp.filters('science',''),null,1,10)->>'totalCount')::integer,5,'teacher can read taxonomy');
select set_config('request.jwt.claim.sub',pg_temp.sid(904)::text,true);
select is((public.list_textbook_sub_subject_numbered_page_v1(
  pg_temp.filters('science',''),null,1,10)->>'totalCount')::integer,5,'assistant can read taxonomy');
select set_config('request.jwt.claim.sub',pg_temp.sid(905)::text,true);
select is((public.list_textbook_sub_subject_numbered_page_v1(
  pg_temp.filters('science',''),null,1,10)->>'totalCount')::integer,5,'viewer can read taxonomy');
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);

-- Genuine no-op receipt and replay.
insert into task6b_values values
  ('taxonomy_before',(select jsonb_agg(to_jsonb(setting) order by setting.id)
    from public.textbook_sub_subject_settings setting)),
  ('owner_revision_before',to_jsonb(textbook_settings_private.revision_v1())),
  ('noop_payload',pg_temp.tax_body());
insert into task6b_values select 'noop_result',
  public.save_textbook_settings_draft_v1(pg_temp.sid(9100),value)
from task6b_values where key='noop_payload';
select is((select value#>'{subSubjects,changedIds}' from task6b_values where key='noop_result'),
  '[]'::jsonb,'taxonomy no-op changes no row IDs');
select is((select value#>>'{subSubjects,newRevision}' from task6b_values where key='noop_result'),
  (select value#>>'{subSubjects,baseRevision}' from task6b_values where key='noop_result'),
  'taxonomy no-op keeps the canonical revision');
select is((select jsonb_agg(to_jsonb(setting) order by setting.id)
    from public.textbook_sub_subject_settings setting),
  (select value from task6b_values where key='taxonomy_before'),
  'taxonomy no-op leaves every timestamp and raw field unchanged');
select is(textbook_settings_private.revision_v1(),
  (select value#>>'{}' from task6b_values where key='owner_revision_before'),
  'taxonomy-only save does not change owner revision');
select is(current_setting('lock_timeout'),'7s','successful taxonomy save restores caller lock timeout');
select is(public.save_textbook_settings_draft_v1(pg_temp.sid(9100),
    (select value from task6b_values where key='noop_payload')),
  (select value from task6b_values where key='noop_result'),
  'exact request replay returns the stored result');

reset role;
update public.textbook_sub_subject_settings set sort_order=sort_order+1 where id=pg_temp.sid(2);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
select isnt(textbook_settings_private.taxonomy_revision_v1(),
  (select value#>>'{subSubjects,newRevision}' from task6b_values where key='noop_result'),
  'raw taxonomy change updates the canonical revision');
select is(public.save_textbook_settings_draft_v1(pg_temp.sid(9100),
    (select value from task6b_values where key='noop_payload')),
  (select value from task6b_values where key='noop_result'),
  'exact replay wins before a now-stale revision');
select throws_ok($$select public.save_textbook_settings_draft_v1(pg_temp.sid(9100),
  jsonb_set((select value from task6b_values where key='noop_payload'),
    '{subSubjects,operations}',jsonb_build_array(jsonb_build_object(
      'type','delete','id','science-화학'))))$$,
  '22023','textbook_settings_request_mismatch','same request ID with changed body fails');

-- Blank add is omitted and blank persisted edit never becomes delete or update.
insert into task6b_values values ('blank_before',(select to_jsonb(setting)
  from public.textbook_sub_subject_settings setting where id=pg_temp.sid(1)));
insert into task6b_values values ('blank_result',public.save_textbook_settings_draft_v1(
  pg_temp.sid(9101),pg_temp.tax_body(jsonb_build_array(
    jsonb_build_object('type','add','id',pg_temp.sid(310),'subject','other','name','','isVisible',true),
    jsonb_build_object('type','patch','id',pg_temp.sid(1),'patch',jsonb_build_object('name','   '))))));
select is((select value#>'{subSubjects,changedIds}' from task6b_values where key='blank_result'),
  '[]'::jsonb,'blank new and blank persisted edits produce no physical changes');
select is((select count(*) from public.textbook_sub_subject_settings where id=pg_temp.sid(310)),0::bigint,
  'blank added row is omitted at save');
select is((select to_jsonb(setting) from public.textbook_sub_subject_settings setting where id=pg_temp.sid(1)),
  (select value from task6b_values where key='blank_before'),
  'blank persisted patch preserves the complete persisted row');

-- Editing a virtual default materializes one stable UUID and exact replay preserves it.
insert into task6b_values values ('materialize_payload',pg_temp.tax_body(jsonb_build_array(
  jsonb_build_object('type','patch','id','english-독해','patch',jsonb_build_object('isVisible',false)))));
insert into task6b_values select 'materialize_result',public.save_textbook_settings_draft_v1(
  pg_temp.sid(9102),value) from task6b_values where key='materialize_payload';
select ok((select value#>>'{subSubjects,materializedIds,english-독해}' from task6b_values
    where key='materialize_result') ~ '^[0-9a-f-]{36}$',
  'edited virtual default receives a real server UUID');
select ok((select value#>'{subSubjects,changedIds}' from task6b_values where key='materialize_result')
    ? (select value#>>'{subSubjects,materializedIds,english-독해}' from task6b_values where key='materialize_result'),
  'materialized UUID is included in changed IDs');
select is((select is_visible from public.textbook_sub_subject_settings where id=(
    select (value#>>'{subSubjects,materializedIds,english-독해}')::uuid
    from task6b_values where key='materialize_result')),false,
  'materialized default persists the edited visibility');
select is((select row->>'kind' from jsonb_array_elements(
    public.list_textbook_sub_subject_numbered_page_v1(
      pg_temp.filters('english','독해'),null,1,10)->'rows') row),'persisted',
  'canonical reload suppresses the virtual default with the hidden persisted row');
select is(public.save_textbook_settings_draft_v1(pg_temp.sid(9102),
    (select value from task6b_values where key='materialize_payload')),
  (select value from task6b_values where key='materialize_result'),
  'materialization replay returns the exact same mapping');

-- Renaming a virtual default materializes the rename and canonical reload restores the built-in.
insert into task6b_values values ('rename_default_result',public.save_textbook_settings_draft_v1(
  pg_temp.sid(9103),pg_temp.tax_body(jsonb_build_array(jsonb_build_object(
    'type','patch','id','math-기하','patch',jsonb_build_object('name','기하 심화'))))));
select is((select name from public.textbook_sub_subject_settings where id=(
    select (value#>>'{subSubjects,materializedIds,math-기하}')::uuid
    from task6b_values where key='rename_default_result')),'기하 심화',
  'renamed virtual default persists under its materialized UUID');
select is((select count(*) from jsonb_array_elements(
    public.list_textbook_sub_subject_numbered_page_v1(
      pg_temp.filters('math','기하 심화'),null,1,10)->'rows')),1::bigint,
  'renamed persisted row is visible after canonical reload');
select is((select count(*) from jsonb_array_elements(
    public.list_textbook_sub_subject_numbered_page_v1(
      pg_temp.filters('math','기하'),null,1,10)->'rows') row where row->>'id'='math-기하'),1::bigint,
  'missing original built-in reappears after renamed-default reload');

insert into task6b_values values ('move_defaults_result',public.save_textbook_settings_draft_v1(
  pg_temp.sid(91035),pg_temp.tax_body(jsonb_build_array(jsonb_build_object(
    'type','move','id','science-생명과학','direction','down')))));
select ok((select value#>'{subSubjects,materializedIds}' from task6b_values where key='move_defaults_result')
    ?& array['science-생명과학','science-지구과학'],
  'moving a virtual default materializes both swapped virtual neighbors');
select is(jsonb_array_length((select value#>'{subSubjects,changedIds}' from task6b_values
    where key='move_defaults_result')),2,
  'virtual-default move reports exactly two changed UUIDs');
select ok((select min(item.ordinality) filter (where item.value->>'name'='지구과학')
      < min(item.ordinality) filter (where item.value->>'name'='생명과학')
    from jsonb_array_elements(textbook_settings_private.project_sub_subject_v1(null))
      with ordinality item(value,ordinality)),
  'materialized virtual move persists the swapped canonical order');

-- Deleting a virtual default is a draft tombstone/no-op; deleting persisted rows is physical.
insert into task6b_values values ('delete_virtual_result',public.save_textbook_settings_draft_v1(
  pg_temp.sid(9104),pg_temp.tax_body(jsonb_build_array(jsonb_build_object(
    'type','delete','id','science-화학')))));
select is((select value#>'{subSubjects,changedIds}' from task6b_values where key='delete_virtual_result'),
  '[]'::jsonb,'virtual default delete materializes nothing');
select is((select count(*) from jsonb_array_elements(
    public.list_textbook_sub_subject_numbered_page_v1(
      pg_temp.filters('science','화학'),null,1,10)->'rows')),1::bigint,
  'deleted virtual default reappears on canonical reload');

insert into task6b_values values ('delete_materialized_result',public.save_textbook_settings_draft_v1(
  pg_temp.sid(9105),pg_temp.tax_body(jsonb_build_array(jsonb_build_object('type','delete','id',(
    select value#>>'{subSubjects,materializedIds,english-독해}' from task6b_values where key='materialize_result'))))));
select ok((select value#>'{subSubjects,deletedIds}' from task6b_values where key='delete_materialized_result')
    ? (select value#>>'{subSubjects,materializedIds,english-독해}' from task6b_values where key='materialize_result'),
  'persisted built-in deletion returns its deleted UUID');
select is((select count(*) from jsonb_array_elements(
    public.list_textbook_sub_subject_numbered_page_v1(
      pg_temp.filters('english','독해'),null,1,10)->'rows') row where row->>'id'='english-독해'),1::bigint,
  'deleted persisted built-in reappears as the canonical virtual default');

insert into task6b_values values ('delete_custom_result',public.save_textbook_settings_draft_v1(
  pg_temp.sid(9106),pg_temp.tax_body(jsonb_build_array(jsonb_build_object(
    'type','delete','id',pg_temp.sid(112))))));
select is((select count(*) from public.textbook_sub_subject_settings where id=pg_temp.sid(112)),0::bigint,
  'custom persisted deletion removes only its row');
select ok((select value#>'{subSubjects,deletedIds}' from task6b_values where key='delete_custom_result')
    ? pg_temp.sid(112)::text,'custom deletion returns its UUID');

-- Duplicate validation sees off-page rows and no mutation leaks through.
insert into task6b_values values ('duplicate_before',(select to_jsonb(setting)
  from public.textbook_sub_subject_settings setting where id=pg_temp.sid(110)));
insert into task6b_errors select 'off_page_duplicate',captured.* from pg_temp.capture_save(
  pg_temp.sid(9107),pg_temp.tax_body(jsonb_build_array(jsonb_build_object(
    'type','patch','id',pg_temp.sid(110),'patch',jsonb_build_object('name','__t6b__ 사용자 1'))))) captured;
select is((select result_sqlstate from task6b_errors where key='off_page_duplicate'),'22023',
  'off-page normalized duplicate fails with domain input state');
select is((select to_jsonb(setting) from public.textbook_sub_subject_settings setting where id=pg_temp.sid(110)),
  (select value from task6b_values where key='duplicate_before'),
  'duplicate failure preserves the off-page persisted row');

reset role;
insert into public.textbook_sub_subject_settings(id,subject,name,sort_order,is_visible)
values(pg_temp.sid(800),'other','__t6b_native_unique',9000,true);
do $$begin
  begin
    insert into public.textbook_sub_subject_settings(id,subject,name,sort_order,is_visible)
    values(pg_temp.sid(801),'other','__t6b_native_unique',9010,true);
  exception when others then
    insert into task6b_errors values('native_unique',sqlstate,sqlerrm,null);
  end;
end$$;
select is((select result_sqlstate from task6b_errors where key='native_unique'),'23505',
  'the real taxonomy UNIQUE constraint retains native 23505');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
insert into task6b_values values ('stale_payload',pg_temp.tax_body());
reset role;
update public.textbook_sub_subject_settings set is_visible=not is_visible where id=pg_temp.sid(3);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
insert into task6b_errors select 'stale_save',captured.* from pg_temp.capture_save(
  pg_temp.sid(9108),(select value from task6b_values where key='stale_payload')) captured;
select is((select result_sqlstate from task6b_errors where key='stale_save'),'55000',
  'stale taxonomy save preserves exact 55000');

select set_config('request.jwt.claim.sub',pg_temp.sid(903)::text,true);
insert into task6b_errors select 'teacher_save',captured.* from pg_temp.capture_save(
  pg_temp.sid(9109),pg_temp.tax_body()) captured;
select is((select result_sqlstate from task6b_errors where key='teacher_save'),'42501',
  'teacher taxonomy write remains forbidden');
select set_config('request.jwt.claim.sub',pg_temp.sid(902)::text,true);
select is((public.save_textbook_settings_draft_v1(pg_temp.sid(9110),pg_temp.tax_body())
    ->'subSubjects'->'changedIds'),'[]'::jsonb,'staff taxonomy no-op is allowed');
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);

-- Mixed prevalidation failure rolls back/avoids every owner and taxonomy change.
insert into task6b_errors select 'mixed_duplicate',captured.* from pg_temp.capture_save(
  pg_temp.sid(9111),pg_temp.mixed_body(
    jsonb_build_array(jsonb_build_object('type','publisher.add','id',pg_temp.sid(700),
      'name','__t6b__ mixed rollback owner','subjects','[]'::jsonb,'supplierIds','[]'::jsonb)),
    jsonb_build_array(jsonb_build_object('type','patch','id',pg_temp.sid(109),
      'patch',jsonb_build_object('name','__t6b__ 사용자 1'))))) captured;
select is((select result_sqlstate from task6b_errors where key='mixed_duplicate'),'22023',
  'mixed duplicate fails before any section DML');
select is((select count(*) from public.textbook_publishers where id=pg_temp.sid(700)),0::bigint,
  'mixed taxonomy validation failure leaves owner add absent');
select is((select name from public.textbook_sub_subject_settings where id=pg_temp.sid(109)),
  '__t6b__ 사용자 109','mixed validation failure leaves taxonomy unchanged');

insert into task6b_values values ('mixed_payload',pg_temp.mixed_body(
  jsonb_build_array(jsonb_build_object('type','publisher.add','id',pg_temp.sid(701),
    'name','__t6b__ mixed owner','subjects',jsonb_build_array('english'),'supplierIds','[]'::jsonb)),
  jsonb_build_array(jsonb_build_object('type','add','id',pg_temp.sid(702),
    'subject','other','name','__t6b__ mixed taxonomy','isVisible',true))));
insert into task6b_values select 'mixed_result',public.save_textbook_settings_draft_v1(
  pg_temp.sid(9112),value) from task6b_values where key='mixed_payload';
select ok((select value#>'{owners,changedPublisherIds}' from task6b_values where key='mixed_result')
    ? pg_temp.sid(701)::text,'mixed success returns changed owner ID');
select ok((select value#>'{subSubjects,changedIds}' from task6b_values where key='mixed_result')
    ? pg_temp.sid(702)::text,'mixed success returns changed taxonomy ID');
select is((select count(*) from public.textbook_publishers where id=pg_temp.sid(701)),1::bigint,
  'mixed success persists owner section');
select is((select count(*) from public.textbook_sub_subject_settings where id=pg_temp.sid(702)),1::bigint,
  'mixed success persists taxonomy section');
select is(public.save_textbook_settings_draft_v1(pg_temp.sid(9112),
    (select value from task6b_values where key='mixed_payload')),
  (select value from task6b_values where key='mixed_result'),
  'mixed exact replay returns both stored section results');

-- A temporary native check proves mixed all-or-none rollback and SQLSTATE preservation.
reset role;
create function pg_temp.reject_task6b_taxonomy() returns trigger language plpgsql as $$
begin
  if new.name='__t6b_native_check' then
    raise exception 'task6b_native_check' using errcode='23514';
  end if;
  return new;
end$$;
create trigger task6b_native_check before insert or update on public.textbook_sub_subject_settings
for each row execute function pg_temp.reject_task6b_taxonomy();
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
insert into task6b_errors select 'mixed_native',captured.* from pg_temp.capture_save(
  pg_temp.sid(9113),pg_temp.mixed_body(
    jsonb_build_array(jsonb_build_object('type','publisher.add','id',pg_temp.sid(703),
      'name','__t6b__ native rollback owner','subjects','[]'::jsonb,'supplierIds','[]'::jsonb)),
    jsonb_build_array(jsonb_build_object('type','add','id',pg_temp.sid(704),
      'subject','other','name','__t6b_native_check','isVisible',true)))) captured;
select is((select result_sqlstate from task6b_errors where key='mixed_native'),'23514',
  'native taxonomy check SQLSTATE is not remapped');
select is((select count(*) from public.textbook_publishers where id=pg_temp.sid(703)),0::bigint,
  'native taxonomy failure rolls back earlier owner DML');
select is((select count(*) from public.textbook_sub_subject_settings where id=pg_temp.sid(704)),0::bigint,
  'native taxonomy failure leaves its row absent');
reset role;
drop trigger task6b_native_check on public.textbook_sub_subject_settings;

-- Owner-only keeps taxonomy bytes unchanged; taxonomy-only keeps owner bytes unchanged.
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
insert into task6b_values values
  ('taxonomy_before_owner_only',(select jsonb_agg(to_jsonb(setting) order by setting.id)
    from public.textbook_sub_subject_settings setting)),
  ('owner_only_result',public.save_textbook_settings_draft_v1(pg_temp.sid(9114),pg_temp.owner_body()));
select is((select jsonb_agg(to_jsonb(setting) order by setting.id)
    from public.textbook_sub_subject_settings setting),
  (select value from task6b_values where key='taxonomy_before_owner_only'),
  'owner-only save leaves all taxonomy bytes unchanged');
select is((select value->'subSubjects' from task6b_values where key='owner_only_result'),'null'::jsonb,
  'owner-only receipt keeps taxonomy result null');
insert into task6b_values values ('owner_before_taxonomy_only',to_jsonb(textbook_settings_private.revision_v1()));
select public.save_textbook_settings_draft_v1(pg_temp.sid(9115),pg_temp.tax_body());
select is(textbook_settings_private.revision_v1(),
  (select value#>>'{}' from task6b_values where key='owner_before_taxonomy_only'),
  'taxonomy-only save leaves owner revision unchanged');

reset role;
select is((select count(*) from dashboard_private.notification_events),
  (select events from task6b_no_send_before),'taxonomy work creates no notification events');
select is((select count(*) from dashboard_private.notification_event_fanout_jobs),
  (select jobs from task6b_no_send_before),'taxonomy work creates no fanout jobs');
select is((select count(*) from dashboard_private.notification_deliveries),
  (select deliveries from task6b_no_send_before),'taxonomy work creates no deliveries');
select is(current_setting('lock_timeout'),'7s','all successful/error paths restore caller lock timeout');

select * from finish();
rollback;
