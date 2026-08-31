begin;
select no_plan();
set local timezone='UTC';
set local statement_timeout='30s';
set local lock_timeout='5s';
create function pg_temp.wid(n integer) returns uuid language sql immutable as $$ select ('3b000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.cost_filters(n integer,p_mode text default 'order') returns jsonb language sql immutable as $$
  select jsonb_build_object('mode',p_mode,'search','__t3b_cost__ '||n,'boardScope','all','requestFilter','all','orderFilter','all')
$$;
create temp table send_before as select
 (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_event_fanout_jobs) jobs,
 (select count(*) from dashboard_private.notification_deliveries) deliveries;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.wid(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','task3b-cost-'||n||'@example.invalid',crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now() from generate_series(901,903)n;
insert into public.profiles(id,role,name,email) values
(pg_temp.wid(901),'admin','합성 관리자','task3b-cost-901@example.invalid'),
(pg_temp.wid(902),'staff','합성 직원','task3b-cost-902@example.invalid'),
(pg_temp.wid(903),'teacher','합성 교사','task3b-cost-903@example.invalid') on conflict(id) do update set role=excluded.role;
insert into public.textbook_suppliers(id,name) values
(pg_temp.wid(352),U&'팁스\FEFF서점'),
(pg_temp.wid(353),U&'팁스\200B서점'),
(pg_temp.wid(354),'팁스서점'),
(pg_temp.wid(356),U&'팁스\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF서점');
insert into public.textbooks(id,title,name,subject,publisher,price,sale_price,school_level,grade_level,school_levels,grade_levels,sub_subject,status,default_supplier_id)
select pg_temp.wid(300+n),'__t3b_cost__ '||n,'__t3b_cost__ '||n,'english',
case n when 1 then U&'팁스\FEFF서점' when 3 then U&'팁스\200B서점' when 4 then '팁스서점'
when 5 then U&'팁스\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF서점'
when 7 then U&'팁스\FEFF서점' else '출판사' end,
case when n=7 then 0 else 10000 end,case when n=7 then 0 else 10000 end,
'middle','m2',array['middle'],array['m2'],'독해','active',
case when n in(2,3,4,6) then pg_temp.wid(350+n) else null::uuid end from generate_series(1,8)n;
insert into public.textbook_purchase_orders(id,requested_by,order_date,status,created_by,created_at,updated_at)
select pg_temp.wid(5300+n),'합성 교사',date '2026-09-01','requested',pg_temp.wid(901),timestamptz '2026-09-01T00:00:00Z',null::timestamptz from generate_series(1,8)n;
insert into public.textbook_purchase_order_lines(id,purchase_order_id,textbook_id,requested_quantity,copy_scope,unit_cost,created_at,updated_at)
select pg_temp.wid(10300+n),pg_temp.wid(5300+n),pg_temp.wid(300+n),2,case when n=8 then 'teacher' else 'student' end,123,timestamptz '2026-09-01T00:00:00Z',null::timestamptz from generate_series(1,8)n;

-- This checks the currently ordered definition even while the candidate is empty.
select ok(not p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres','projection owner/invoker/stability/empty search_path preserved') from pg_proc p where p.oid='dashboard_private.textbook_workflow_purchase_project_v1(jsonb,text)'::regprocedure;
select ok(has_function_privilege('authenticated','dashboard_private.textbook_workflow_purchase_project_v1(jsonb,text)','execute') and not has_function_privilege('anon','dashboard_private.textbook_workflow_purchase_project_v1(jsonb,text)','execute'),'projection authenticated-only execution preserved');
select ok(not p.prosecdef and p.provolatile='i' and p.proconfig=array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres','business-label helper owner/invoker/immutable/empty search_path') from pg_proc p where p.oid='dashboard_private.textbook_workflow_business_label_v1(text)'::regprocedure;
select ok(has_function_privilege('authenticated','dashboard_private.textbook_workflow_business_label_v1(text)','execute') and not has_function_privilege('anon','dashboard_private.textbook_workflow_business_label_v1(text)','execute'),'business-label helper authenticated-only execution');
select is(dashboard_private.textbook_workflow_business_label_v1(null),'','null business label stays empty');
select is(dashboard_private.textbook_workflow_business_label_v1(U&' A\FEFFB C '),'abc','business label still lowercases after removing whitespace');
select is(dashboard_private.textbook_workflow_business_label_v1(label),label,'business-label helper retains non-whitespace/no-NFKC fence '||n) from(values
(1,U&'팁스\0085서점'),(2,U&'팁스\180E서점'),(3,U&'팁스\200B서점'),(4,'팁스서점'))v(n,label);
set local role authenticated;
select set_config('request.jwt.claim.sub','3b000000-0000-4000-8000-000000000901',true);
select is(auth.uid(),pg_temp.wid(901),'actual admin fixture actor');
select is(public.list_textbook_purchase_page_v1(pg_temp.cost_filters(1),'status-event',1,10)#>>'{rows,0,references,unitCost}','0','publisher FEFF page zero cost');
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(10301),'order')#>>'{row,references,unitCost}','0','publisher FEFF detail zero cost');
select is(public.list_textbook_purchase_page_v1(pg_temp.cost_filters(2),'status-event',1,10)#>>'{rows,0,references,unitCost}','0','supplier FEFF page zero cost');
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(10302),'order')#>>'{row,references,unitCost}','0','supplier FEFF detail zero cost');
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(10300+n),'order')#>>'{row,references,unitCost}',expected,label) from(values
(3,'9000','U+200B is not business whitespace'),(4,'9000','decomposed Hangul is not NFKC normalized'),
(5,'0','all ECMAScript whitespace removed from publisher'),(6,'0','all ECMAScript whitespace removed from supplier'),
(7,'123','no positive sale price retains line unit cost before source exemption'),(8,'0','teacher scope retains zero cost'))v(n,expected,label);
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(10301),'order')#>>'{row,references,textbook,publisher}',U&'팁스\FEFF서점','publisher display remains byte-exact');
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(10302),'order')#>>'{row,references,supplier,name}',U&'팁스\FEFF서점','supplier display remains byte-exact');
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(10302),'order')#>'{row,memberLineIds}',jsonb_build_array(pg_temp.wid(10302)),'real mutation member ID preserved');
select diag('TASK3B_WIRE '||jsonb_build_object('actorId',auth.uid(),'method',method,'input',input,'data',data)::text)from(values
('listTextbookPurchasePage',jsonb_build_object('page',1,'pageSize',10,'sort','status-event','filters',pg_temp.cost_filters(1)),public.list_textbook_purchase_page_v1(pg_temp.cost_filters(1),'status-event',1,10)),
('getTextbookPurchaseDetail',jsonb_build_object('anchorLineId',pg_temp.wid(10302),'mode','order'),public.get_textbook_purchase_detail_v1(pg_temp.wid(10302),'order'))
)w(method,input,data);
select set_config('request.jwt.claim.sub','3b000000-0000-4000-8000-000000000902',true);
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(10302),'order')#>>'{row,references,unitCost}','0','staff supplier FEFF zero cost');
select set_config('request.jwt.claim.sub','3b000000-0000-4000-8000-000000000903',true);
select is(auth.uid(),pg_temp.wid(903),'actual teacher fixture actor');
select is(public.list_textbook_purchase_page_v1(pg_temp.cost_filters(1,'request'),'status-event',1,10)#>>'{rows,0,references,unitCost}','0','teacher publisher FEFF request zero cost');
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(10302),'request')#>>'{row,references,unitCost}','9000','request never hydrates supplier for cost');
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(10302),'request')#>'{row,references,supplier}','null'::jsonb,'request supplier catalog stays absent');
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(10302),'request')#>>'{row,references,configuredSupplierId}',pg_temp.wid(352)::text,'request retains raw configured supplier ID');
select throws_ok($$select public.get_textbook_purchase_detail_v1(pg_temp.wid(10302),'order')$$,'42501','textbook_workflow_read_forbidden','teacher order detail still forbidden');
select throws_ok($$select public.list_textbook_purchase_page_v1(pg_temp.cost_filters(1),'status-event',1,10)$$,'42501','textbook_workflow_read_forbidden','teacher order page still forbidden');
select diag('TASK3B_WIRE '||jsonb_build_object('actorId',auth.uid(),'method',method,'input',input,'data',data)::text)from(values
('listTextbookPurchasePage',jsonb_build_object('page',1,'pageSize',10,'sort','status-event','filters',pg_temp.cost_filters(1,'request')),public.list_textbook_purchase_page_v1(pg_temp.cost_filters(1,'request'),'status-event',1,10)),
('getTextbookPurchaseDetail',jsonb_build_object('anchorLineId',pg_temp.wid(10302),'mode','request'),public.get_textbook_purchase_detail_v1(pg_temp.wid(10302),'request'))
)w(method,input,data);
reset role;
select is((select count(*) from dashboard_private.notification_events),(select events from send_before),'no notification events');
select is((select count(*) from dashboard_private.notification_event_fanout_jobs),(select jobs from send_before),'no fanout jobs');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from send_before),'no deliveries');
select * from finish();
rollback;
