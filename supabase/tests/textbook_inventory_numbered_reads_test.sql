begin;
select no_plan();
set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

create function pg_temp.tf(overrides jsonb default '{}'::jsonb) returns jsonb language sql as $$
select '{"search":"__tbqa__","subject":"english","schoolLevel":"all","gradeLevel":"all","subSubject":"all","quality":"all","inventory":"all"}'::jsonb || overrides
$$;
create function pg_temp.ti(overrides jsonb default '{}'::jsonb) returns jsonb language sql as $$
select pg_temp.tf() || '{"locationId":"a2000000-0000-4000-8000-000000000900","audit":"all"}'::jsonb || overrides
$$;
create function pg_temp.tid(n integer) returns uuid language sql immutable as $$ select ('a2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create temp table send_before as select
 (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_event_fanout_jobs) jobs,
 (select count(*) from dashboard_private.notification_deliveries) deliveries;

-- Pure fixture transaction. No jobs, lifecycle mutations, providers or remote data.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.tid(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'tb2-'||n||'@example.invalid',crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now()
from generate_series(901,903) n;
insert into public.profiles(id,role,name,email) values
(pg_temp.tid(901),'admin','읽기 검증','tb2-901@example.invalid'),
(pg_temp.tid(902),'staff','직원 검증','tb2-902@example.invalid'),
(pg_temp.tid(903),'teacher','교사 검증','tb2-903@example.invalid') on conflict(id) do update set role=excluded.role;
insert into public.textbook_inventory_locations(id,code,name,sort_order) values
(pg_temp.tid(900),'__tb2_main__','본관',10),(pg_temp.tid(910),'__tb2_annex__','별관',20);
insert into public.textbooks(id,title,name,subject,publisher,category,isbn13,price,sale_price,school_level,grade_level,school_levels,grade_levels,sub_subject,status)
select pg_temp.tid(n),'__tbqa__ 교재 '||n,'__tbqa__ 교재 '||n,'english','출판사','독해','tb2-'||n,10000,10000,'middle','m2',array['middle'],array['m2'],'독해','active'
from generate_series(1,113) n;
update public.textbooks set status='inactive' where id=pg_temp.tid(112);
update public.textbooks set subject='math' where id=pg_temp.tid(113);
-- Page-independent quality, balance, zero and off-location fixtures.
insert into public.textbooks(id,title,name,subject,publisher,category,isbn13,price,sale_price,school_level,grade_level,school_levels,grade_levels,sub_subject,status)
select pg_temp.tid(n),case n when 208 then 'Parity 201' else 'Parity '||n end,'Parity '||n,'english','출판사','독해','tb2-'||n,10000,10000,'middle','m2',array['middle'],array['m2'],'독해','active'
from generate_series(201,208) n;
update public.textbooks set subject='math' where id=pg_temp.tid(208);
insert into public.textbook_stock_moves(id,textbook_id,location_id,move_type,quantity,unit_amount,amount,moved_at,copy_scope,created_by,memo) values
(pg_temp.tid(1001),pg_temp.tid(201),pg_temp.tid(900),'opening',10,100,0,'2025-01-01T00:00:00Z','student',pg_temp.tid(901),'old'),
(pg_temp.tid(1002),pg_temp.tid(201),pg_temp.tid(900),'purchase_receipt',5,100,0,'2026-08-01T00:00:00Z','student',pg_temp.tid(901),''),
(pg_temp.tid(1003),pg_temp.tid(201),pg_temp.tid(900),'sale_issue',-4,100,0,'2026-08-02T00:00:00Z','student',null,''),
(pg_temp.tid(1004),pg_temp.tid(201),pg_temp.tid(900),'return_in',1,100,77,'2026-08-03T00:00:00Z','teacher',null,''),
(pg_temp.tid(1005),pg_temp.tid(201),null,'stock_adjustment',-2,100,0,'2026-08-04T00:00:00Z','student',null,''),
(pg_temp.tid(1006),pg_temp.tid(202),pg_temp.tid(900),'stock_adjustment',-2,100,0,'2026-08-31T00:00:00Z','student',null,''),
(pg_temp.tid(1007),pg_temp.tid(204),pg_temp.tid(900),'opening',2,0,0,'2026-08-01T00:00:00Z','teacher',null,''),
(pg_temp.tid(1008),pg_temp.tid(205),pg_temp.tid(910),'opening',20,100,0,'2026-08-01T00:00:00Z','student',null,''),
(pg_temp.tid(1009),pg_temp.tid(206),pg_temp.tid(900),'opening',3,100,0,'2026-08-01T00:00:00Z','student',null,''),
(pg_temp.tid(1010),pg_temp.tid(207),pg_temp.tid(900),'opening',1,100,0,'2026-08-01T00:00:00Z','student',null,'');
insert into public.textbook_stock_counts(id,textbook_id,location_id,counted_at,expected_quantity,counted_quantity,adjustment_move_id,created_by)
values (pg_temp.tid(2001),pg_temp.tid(201),pg_temp.tid(900),(now() at time zone 'UTC')::date-1,12,10,pg_temp.tid(1005),pg_temp.tid(901)),
(pg_temp.tid(2002),pg_temp.tid(201),pg_temp.tid(900),(now() at time zone 'UTC')::date-1,12,11,null,null),
(pg_temp.tid(2003),pg_temp.tid(202),pg_temp.tid(900),'2026-08-31',0,-2,pg_temp.tid(1006),null);
insert into public.textbook_stock_moves(id,textbook_id,location_id,move_type,quantity,moved_at)
select pg_temp.tid(3000+n),pg_temp.tid(111),pg_temp.tid(900),'opening',1,'2025-01-01T00:00:00Z'::timestamptz + n*interval '1 second' from generate_series(1,111)n;

select has_function('public',name,args,name||' exists') from (values
('list_textbook_master_page_v1',array['jsonb','text','integer','integer']),
('list_textbook_inventory_page_v1',array['jsonb','text','integer','integer']),
('list_textbook_inventory_history_page_v1',array['jsonb','text','integer','integer']),
('get_textbook_master_summary_v1',array['jsonb']),('get_textbook_inventory_summary_v1',array['jsonb']),
('get_textbook_master_detail_v1',array['uuid']),('get_textbook_inventory_balance_v1',array['jsonb']),
('check_textbook_master_duplicate_v1',array['jsonb'])) f(name,args);
select ok(not p.prosecdef and p.provolatile='s' and p.proconfig in (array['search_path=']::text[],array['search_path=""']::text[])
  and has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('public',p.oid,'execute'),
  p.proname||' stable invoker, fixed search path, authenticated-only ACL')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
('list_textbook_master_page_v1','list_textbook_inventory_page_v1','list_textbook_inventory_history_page_v1','get_textbook_master_summary_v1','get_textbook_inventory_summary_v1','get_textbook_master_detail_v1','get_textbook_inventory_balance_v1','check_textbook_master_duplicate_v1');
select ok(relrowsecurity,relname||' retains RLS') from pg_class where oid in ('public.textbooks'::regclass,'public.textbook_stock_moves'::regclass,'public.textbook_stock_counts'::regclass,'public.textbook_inventory_locations'::regclass);

set local role authenticated;
select set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000901',true);
select lives_ok($$select public.list_textbook_master_page_v1(pg_temp.tf(),'quality-title',11,10)$$,'valid master filter object is accepted');
select is(public.list_textbook_master_page_v1(pg_temp.tf(),'quality-title',11,10)#>>'{rows,0,id}',pg_temp.tid(101)::text,'master direct page11 numeric global order');
select is(public.list_textbook_master_page_v1(pg_temp.tf(),'quality-title',11,10)->>'totalCount','111','full filtered master count excludes inactive and subject');
select is(public.list_textbook_master_page_v1(pg_temp.tf(),'quality-title',1,10)#>>'{rows,1,title}','__tbqa__ 교재 2','numeric title 2 precedes10');
select is(public.list_textbook_inventory_page_v1(pg_temp.ti(),'audit-priority',11,10)#>>'{rows,0,id}',pg_temp.tid(101)::text,'inventory priority/quantity/title order on direct page11');
select is(public.list_textbook_inventory_page_v1(pg_temp.ti(),'audit-priority',11,10)->>'totalCount','111','inventory count uses full eligible keys');
select is(public.list_textbook_inventory_history_page_v1(jsonb_build_object('textbookId',pg_temp.tid(111),'locationId',null),'event-desc',11,10)#>>'{rows,0,sourceId}',pg_temp.tid(3011)::text,'history direct page11 sorts newest first');
select is(public.list_textbook_inventory_history_page_v1(jsonb_build_object('textbookId',pg_temp.tid(111),'locationId',null),'event-desc',11,10)->>'totalCount','111','history full filtered count');
select is(jsonb_array_length(public.list_textbook_master_page_v1(pg_temp.tf(),'quality-title',1,size)->'rows'),size,'strict master size '||size) from (values(10),(15),(20))s(size);
select is(jsonb_array_length(public.list_textbook_inventory_page_v1(pg_temp.ti(),'audit-priority',1,size)->'rows'),size,'strict inventory size '||size) from (values(10),(15),(20))s(size);
select is(jsonb_array_length(public.list_textbook_inventory_history_page_v1(jsonb_build_object('textbookId',pg_temp.tid(111),'locationId',null),'event-desc',1,size)->'rows'),size,'strict history size '||size) from (values(10),(15),(20))s(size);
select is(public.list_textbook_master_page_v1(pg_temp.tf(),'quality-title',2147483647,20),'{"rows":[],"page":2147483647,"pageSize":20,"totalCount":111}'::jsonb,'off-end retains exact count/request without overflow');
select is(public.list_textbook_master_page_v1(pg_temp.tf('{"search":"absent-tbqa"}'),'quality-title',1,10),'{"rows":[],"page":1,"pageSize":10,"totalCount":0}'::jsonb,'empty authorized scope');
with pages as (select r->>'id' id from generate_series(1,12)p cross join lateral jsonb_array_elements(public.list_textbook_master_page_v1(pg_temp.tf(),'quality-title',p,10)->'rows')r)
select ok(count(*)=111 and count(distinct id)=111,'static master traversal has no omission/duplicate') from pages;

select is(public.get_textbook_master_detail_v1(pg_temp.tid(201))#>'{row,locationQuantities}',jsonb_build_object(pg_temp.tid(900),12,pg_temp.tid(910),0,'unassigned',-2) ||
  coalesce((select jsonb_object_agg(id::text,0) from public.textbook_inventory_locations where id not in(pg_temp.tid(900),pg_temp.tid(910))),'{}'::jsonb),'all configured locations initialized and null location is unassigned');
select is(public.get_textbook_master_detail_v1(pg_temp.tid(201))#>>'{row,totalQuantity}','10','all-time movement balance');
select is(public.get_textbook_master_detail_v1(pg_temp.tid(201))#>>'{row,studentQuantity}','9','student all-time balance');
select is(public.get_textbook_master_detail_v1(pg_temp.tid(201))#>>'{row,teacherQuantity}','1','teacher all-time balance');
select is(public.get_textbook_master_detail_v1(pg_temp.tid(201))#>>'{row,stockValue}','977','explicit nonzero amount else unit_amount times signed quantity');
select is(public.get_textbook_master_detail_v1(pg_temp.tid(201))#>>'{row,qualityIssues,duplicate}','true','off-filter active duplicate title counts globally');
select is(public.list_textbook_master_page_v1(pg_temp.tf('{"search":"Parity","inventory":"shortage"}'),'quality-title',1,10)->>'totalCount','4','shortage negative or1..3 excludes zero');
select is(public.list_textbook_master_page_v1(pg_temp.tf('{"search":"Parity","inventory":"unused"}'),'quality-title',1,10)->>'totalCount','1','zero inventory means unused');
select is(public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity","inventory":"surplus"}'),'audit-priority',1,10)#>>'{rows,0,currentQuantity}','0','global surplus filter still shows selected-location zero quantity');
select is(public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity","inventory":"surplus"}'),'audit-priority',1,10)#>>'{rows,0,reason}','재고 부족','zero location quantity recommendation retained');
select is(public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity 203"}'),'audit-priority',1,10)#>'{rows,0,daysSinceLatestCount}','null'::jsonb,'missing elapsed days wire null not0/99999/stringInfinity');
select is(public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity 201"}'),'audit-priority',1,10)#>>'{rows,0,daysSinceLatestCount}','1','rolling24hour UTC count date elapsed days');
select is(public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity 201"}'),'audit-priority',1,10)#>>'{rows,0,status}','done','recent count and sufficient selected balance');
select is(public.get_textbook_master_summary_v1(pg_temp.tf('{"search":"absent-tbqa"}'))#>>'{qualityCounts,all}','118','quality facets use taxonomy but exclude search');
select is(public.get_textbook_master_summary_v1(pg_temp.tf('{"search":"Parity","inventory":"unused"}'))#>>'{inventoryCounts,all}','7','inventory facets precede only their own filter');
select is(public.get_textbook_master_summary_v1(pg_temp.tf('{"search":"Parity","inventory":"unused"}'))->>'totalCount','1','summary totals retain all list filters');
select is(public.get_textbook_inventory_summary_v1(pg_temp.ti('{"search":"Parity","audit":"done"}'))#>>'{auditCounts,all}','7','audit facets precede only audit filter');
select is(public.get_textbook_inventory_summary_v1(pg_temp.ti('{"search":"Parity","audit":"done"}'))->>'totalCount','1','inventory summary total retains audit filter');
select is(public.get_textbook_master_summary_v1(pg_temp.tf())->>'salePriceTotal','1110000','master price total sums all111 matching books, not a page or quantity times price');
select is(public.get_textbook_master_summary_v1(pg_temp.tf('{"search":"Parity","subject":"all"}'))->>'salePriceTotal','80000','price total includes zero/negative stock books from both normalized subjects');
select is(public.get_textbook_master_summary_v1(pg_temp.tf('{"search":"Parity","subject":"all"}'))#>'{subjectTotals}',
 '[{"subject":"english","totalCount":7,"totalQuantity":34,"salePriceTotal":70000,"stockValue":3177},{"subject":"math","totalCount":1,"totalQuantity":0,"salePriceTotal":10000,"stockValue":0}]'::jsonb,'subject totals reconcile to same full-filter scope in configured subject order');
select is(public.get_textbook_master_summary_v1(pg_temp.tf('{"search":"Parity","subject":"all"}'))#>>'{locationQuantities,unassigned}','-2','summary retains null-location legacy quantity');
select is(public.get_textbook_master_summary_v1(pg_temp.tf('{"search":"Parity","subject":"all"}'))->'locationQuantities'->>pg_temp.tid(900)::text,'16','summary totals selected configured location across all matching books');
select is(public.get_textbook_inventory_summary_v1(pg_temp.ti('{"search":"Parity","audit":"done"}'))->>'salePriceTotal','10000','inventory summary price total includes final audit filter');
select is(public.get_textbook_master_summary_v1(pg_temp.tf('{"search":"absent-tbqa"}'))->'subjectTotals','[]'::jsonb,'empty summary has no fabricated subject groups');
select is(public.get_textbook_master_summary_v1(pg_temp.tf('{"search":"absent-tbqa"}'))->'locationQuantities',(select jsonb_object_agg(id::text,0)from public.textbook_inventory_locations),'empty summary still initializes all configured location maps');
select is(public.get_textbook_master_detail_v1(pg_temp.tid(99999)),'{"row":null}'::jsonb,'missing selected detail explicit null');
select is(public.check_textbook_master_duplicate_v1(jsonb_build_object('excludeId',null,'title','Parity 201','subject','english','publisher','','category',''))->>'totalCount','1','duplicate preview preserves exact title and subject matching, not quality compact-key rule');
select is(public.check_textbook_master_duplicate_v1(jsonb_build_object('excludeId',pg_temp.tid(201),'title','Parity 201','subject','english','publisher','','category',''))->>'totalCount','0','duplicate excludes editor ID');
select is(public.get_textbook_inventory_balance_v1(jsonb_build_object('textbookIds',jsonb_build_array(pg_temp.tid(201),pg_temp.tid(204)),'locationId',pg_temp.tid(900)))#>>'{rows,0,currentQuantity}','12','explicit balance context preserves selected quantity');
select is(public.get_textbook_inventory_balance_v1(jsonb_build_object('textbookIds',jsonb_build_array(upper(pg_temp.tid(201)::text)),'locationId',upper(pg_temp.tid(900)::text)))#>>'{rows,0,currentQuantity}','12','UUID case spelling cannot turn an authoritative balance into zero');
select throws_ok($$select public.get_textbook_inventory_balance_v1(jsonb_build_object('textbookIds',jsonb_build_array(pg_temp.tid(201),pg_temp.tid(99999)),'locationId',null))$$,'22023','textbook_balance_ids_unavailable','partial balance context fails explicitly');

select is(public.list_textbook_inventory_history_page_v1(jsonb_build_object('textbookId',pg_temp.tid(202),'locationId',null),'event-desc',1,10)->>'totalCount','2','count and its adjustment movement are separate parents');
select is(public.list_textbook_inventory_history_page_v1(jsonb_build_object('textbookId',pg_temp.tid(202),'locationId',null),'event-desc',1,10)#>>'{rows,0,kind}','count','equal UTC event time resolves by kind then id');
select is(public.list_textbook_inventory_history_page_v1(jsonb_build_object('textbookId',pg_temp.tid(202),'locationId',null),'event-desc',1,10)#>>'{rows,0,at}','2026-08-31','count displayed date is not session-local timestamptz');
select is(public.list_textbook_inventory_history_page_v1(jsonb_build_object('textbookId',pg_temp.tid(202),'locationId',null),'event-desc',1,10)#>>'{rows,0,linkedMoveId}',pg_temp.tid(1006)::text,'linked adjustment ID preserved');
select is(public.list_textbook_inventory_history_page_v1(jsonb_build_object('textbookId',pg_temp.tid(202),'locationId',null),'event-desc',1,10)#>>'{rows,0,change}','-2권','count delta counted minus expected');
set local timezone='America/New_York';
select is(public.list_textbook_inventory_history_page_v1(jsonb_build_object('textbookId',pg_temp.tid(202),'locationId',null),'event-desc',1,10)#>>'{rows,0,kind}','count','date UTC ordering independent of session timezone');
-- Fixture audit hashes serialize timestamptz; restore the seed timezone before
-- further DML. The existing audit trigger is not changed or disabled.
set local timezone='Asia/Seoul';

-- Bounded authenticated DTO captures: each is the exact RPC response and
-- request, never a cropped or reconstructed page. All lines stay below8000B.
select diag('TB2_WIRE_CONTEXT '||jsonb_build_object('actorId',auth.uid(),'dbRole',current_user)::text);
select diag('TB2_WIRE '||jsonb_build_object('method',method,'input',input,'data',data)::text)from(values
('listTextbookMasterPage',jsonb_build_object('filters',pg_temp.tf('{"search":"Parity 203"}'),'sort','quality-title','page',1,'pageSize',10),public.list_textbook_master_page_v1(pg_temp.tf('{"search":"Parity 203"}'),'quality-title',1,10)),
('listTextbookInventoryPage',jsonb_build_object('filters',pg_temp.ti('{"search":"Parity 203"}'),'sort','audit-priority','page',1,'pageSize',10),public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity 203"}'),'audit-priority',1,10)),
('listTextbookInventoryPage',jsonb_build_object('filters',pg_temp.ti('{"search":"Parity 201"}'),'sort','audit-priority','page',1,'pageSize',10),public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity 201"}'),'audit-priority',1,10)),
('listTextbookInventoryHistoryPage',jsonb_build_object('filters',jsonb_build_object('textbookId',pg_temp.tid(202),'locationId',null),'sort','event-desc','page',1,'pageSize',10),public.list_textbook_inventory_history_page_v1(jsonb_build_object('textbookId',pg_temp.tid(202),'locationId',null),'event-desc',1,10)),
('getTextbookMasterSummary',pg_temp.tf('{"search":"Parity 203"}'),public.get_textbook_master_summary_v1(pg_temp.tf('{"search":"Parity 203"}'))),
('getTextbookInventorySummary',pg_temp.ti('{"search":"Parity 203"}'),public.get_textbook_inventory_summary_v1(pg_temp.ti('{"search":"Parity 203"}'))),
('getTextbookMasterDetail',to_jsonb(pg_temp.tid(201)),public.get_textbook_master_detail_v1(pg_temp.tid(201))),
('getTextbookInventoryBalance',jsonb_build_object('textbookIds',jsonb_build_array(pg_temp.tid(201),pg_temp.tid(204)),'locationId',pg_temp.tid(900)),public.get_textbook_inventory_balance_v1(jsonb_build_object('textbookIds',jsonb_build_array(pg_temp.tid(201),pg_temp.tid(204)),'locationId',pg_temp.tid(900)))),
('checkTextbookMasterDuplicate',jsonb_build_object('excludeId',null,'title','Parity 201','subject','english','publisher','','category',''),public.check_textbook_master_duplicate_v1(jsonb_build_object('excludeId',null,'title','Parity 201','subject','english','publisher','','category','')))
)w(method,input,data);

select throws_ok($$select public.list_textbook_master_page_v1(pg_temp.tf(),'quality-title',0,10)$$,'22023','textbook_page_invalid','page0 invalid exact SQLSTATE');
select throws_ok($$select public.list_textbook_master_page_v1(pg_temp.tf(),'quality-title',1,25)$$,'22023','textbook_page_size_invalid','size25 invalid exact SQLSTATE');
select throws_ok($$select public.list_textbook_master_page_v1(pg_temp.tf(),'wrong',1,10)$$,'22023','textbook_sort_invalid','unknown sort rejected');
select throws_ok($$select public.list_textbook_master_page_v1(pg_temp.tf('{"extra":true}'),'quality-title',1,10)$$,'22023','textbook_filters_invalid','unknown filter rejected');
select throws_ok($$select public.list_textbook_master_page_v1(pg_temp.tf('{"quality":"wrong"}'),'quality-title',1,10)$$,'22023','textbook_filters_invalid','unknown quality rejected');

-- Test every public list's strict contract, not merely the shared validator.
select throws_ok(format('select public.%I(%s,%L,%s,%s)',rpc,filters,sort,page,size), '22023',message,rpc||': '||label)
from (values
('list_textbook_master_page_v1','pg_temp.tf()','quality-title'),
('list_textbook_inventory_page_v1','pg_temp.ti()','audit-priority'),
('list_textbook_inventory_history_page_v1',$x$'{"textbookId":null,"locationId":null}'::jsonb$x$,'event-desc'))r(rpc,filters,sort)
cross join(values('NULL','10','textbook_page_invalid','null page'),('0','10','textbook_page_invalid','zero page'),('-1','10','textbook_page_invalid','negative page'),
('1','NULL','textbook_page_size_invalid','null size'),('1','5','textbook_page_size_invalid','size5'),('1','25','textbook_page_size_invalid','size25'))v(page,size,message,label);
select throws_ok(format('select public.%I(%s,%s,1,10)',rpc,filters,sort),'22023','textbook_sort_invalid',rpc||' rejects '||sort)
from(values('list_textbook_master_page_v1','pg_temp.tf()'),('list_textbook_inventory_page_v1','pg_temp.ti()'),('list_textbook_inventory_history_page_v1',$x$'{"textbookId":null,"locationId":null}'::jsonb$x$))r(rpc,filters)
cross join(values('NULL'),($x$'wrong'$x$))s(sort);
select throws_ok(format('select public.%I(%s,%L,1,10)',rpc,filters,sort),'22023','textbook_filters_invalid',rpc||' rejects malformed filters '||filters)
from(values('list_textbook_master_page_v1','quality-title'),('list_textbook_inventory_page_v1','audit-priority'),('list_textbook_inventory_history_page_v1','event-desc'))r(rpc,sort)
cross join(values('NULL'),($x$'{}'::jsonb$x$),($x$'[]'::jsonb$x$))f(filters);
select is(public.list_textbook_inventory_page_v1(pg_temp.ti(),'audit-priority',2147483647,20)->>'totalCount','111','inventory off-end retains full count');
select is(public.list_textbook_inventory_history_page_v1(jsonb_build_object('textbookId',pg_temp.tid(111),'locationId',null),'event-desc',2147483647,20),'{"rows":[],"page":2147483647,"pageSize":20,"totalCount":111}'::jsonb,'history off-end retains full count and requested page');

-- Explicit nonfinite count dates preserve legacy invalid-date behavior.
update public.textbook_stock_counts set counted_at='infinity' where id=pg_temp.tid(2002);
select is(public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity 201"}'),'audit-priority',1,10)#>>'{rows,0,latestCountAt}','infinity','nonfinite SQL date remains explicit, not erased');
select is(public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity 201"}'),'audit-priority',1,10)#>>'{rows,0,reason}','실사일 확인 필요','invalid-date reason differs from missing date');
select is(public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity 201"}'),'audit-priority',1,10)#>>'{rows,0,status}','recommended','invalid-date Infinity>=30 recommends active sufficient balance');
select is(public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity 201"}'),'audit-priority',1,10)#>'{rows,0,daysSinceLatestCount}','null'::jsonb,'nonfinite elapsed date explicit null sentinel');
select diag('TB2_WIRE '||jsonb_build_object('method','listTextbookInventoryPage','input',jsonb_build_object('filters',pg_temp.ti('{"search":"Parity 201"}'),'sort','audit-priority','page',1,'pageSize',10),'data',public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity 201"}'),'audit-priority',1,10))::text);
select throws_ok($$select public.get_textbook_inventory_balance_v1(jsonb_build_object('textbookIds',jsonb_build_array(pg_temp.tid(201)),'locationId',pg_temp.tid(99999)))$$,'22023','textbook_balance_location_unavailable','unknown selected location is not a real zero balance');
select throws_ok($$select public.get_textbook_inventory_balance_v1(jsonb_build_object('textbookIds','[]'::jsonb,'locationId',pg_temp.tid(99999)))$$,'22023','textbook_balance_location_unavailable','empty IDs still validate selected location context');

-- Literal parity fixtures backed by actual Task1 model reproduction.
update public.textbooks set publisher=E'\t \n',isbn13=E'\t \n' where id=pg_temp.tid(206);
select is(public.get_textbook_master_detail_v1(pg_temp.tid(206))#>>'{row,qualityIssues,missingPublisher}','true','JS trim removes tabs/newlines for missing publisher');
select is(public.get_textbook_master_detail_v1(pg_temp.tid(206))#>>'{row,qualityIssues,missingCode}','true','JS trim removes tabs/newlines for missing code');
update public.textbooks set title='수Ⅰ' where id=pg_temp.tid(206);
select is(public.get_textbook_master_detail_v1(pg_temp.tid(206))#>>'{row,qualityIssues,subjectMismatch}','true','case-insensitive Roman numeral math hint survives lowercasing');
update public.textbooks set title=E'\tＰａｒｉｔｙ 201\u00a0' where id=pg_temp.tid(207);
select is(public.get_textbook_master_detail_v1(pg_temp.tid(207))#>>'{row,title}','Ｐａｒｉｔｙ 201','title JS trim removes tab and NBSP');
select is(public.get_textbook_master_detail_v1(pg_temp.tid(207))#>>'{row,qualityIssues,duplicate}','true','NFKC compact duplicate key crosses width and outer whitespace');

-- Existing JS uses nonnumeric Korean localeCompare for labels, but numeric Korean sorting for titles.
-- Focused Intl reproduction: ['시험10','시험2'].sort((a,b)=>a.localeCompare(b,'ko')) => 시험10,시험2.
update public.textbook_inventory_locations set sort_order=30,
  name=case id when pg_temp.tid(900) then '시험10' else '시험2' end
where id in(pg_temp.tid(900),pg_temp.tid(910));
insert into public.textbook_sub_subject_settings(id,subject,name,sort_order,is_visible) values
(pg_temp.tid(920),'english','독해10',900,true),(pg_temp.tid(921),'english','독해2',900,true);
insert into public.textbook_stock_moves(id,textbook_id,location_id,move_type,quantity,moved_at) values
(pg_temp.tid(4001),pg_temp.tid(201),pg_temp.tid(910),'opening',1,'2025-01-01T00:00:00Z');
select is(public.get_textbook_master_detail_v1(pg_temp.tid(201))#>>'{row,locationSummary,0,name}','시험10',
  'master detail location summary follows actual ledger nonnumeric label order');
select is((select ord::integer from jsonb_array_elements(public.get_textbook_master_summary_v1(pg_temp.tf())->'locations')with ordinality e(value,ord)where value->>'id'=pg_temp.tid(900)::text),
  (select ord::integer-1 from jsonb_array_elements(public.get_textbook_master_summary_v1(pg_temp.tf())->'locations')with ordinality e(value,ord)where value->>'id'=pg_temp.tid(910)::text),
  'same-rank location labels use existing nonnumeric Korean locale order');
select is((select ord::integer from jsonb_array_elements_text(public.get_textbook_master_summary_v1(pg_temp.tf())->'subSubjectOptions')with ordinality e(value,ord)where value='독해10'),
  (select ord::integer-1 from jsonb_array_elements_text(public.get_textbook_master_summary_v1(pg_temp.tf())->'subSubjectOptions')with ordinality e(value,ord)where value='독해2'),
  'subsubject labels use existing nonnumeric Korean locale order');

-- UUID inputs are case-insensitive in the actual service contract and PostgreSQL uuid value semantics.
update public.textbook_stock_counts set counted_at=(now() at time zone 'UTC')::date-1 where id=pg_temp.tid(2002);
select is(public.list_textbook_inventory_page_v1(pg_temp.ti(jsonb_build_object('search','Parity 201','locationId',upper(pg_temp.tid(900)::text))),'audit-priority',1,10)#>>'{rows,0,currentQuantity}',
  public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity 201"}'),'audit-priority',1,10)#>>'{rows,0,currentQuantity}',
  'inventory list canonicalizes uppercase selected location UUID');
select is(public.get_textbook_inventory_summary_v1(pg_temp.ti(jsonb_build_object('search','Parity 201','locationId',upper(pg_temp.tid(900)::text)))),
  public.get_textbook_inventory_summary_v1(pg_temp.ti('{"search":"Parity 201"}')),
  'inventory summary canonicalizes uppercase selected location UUID');
select is(public.list_textbook_inventory_page_v1(pg_temp.ti(jsonb_build_object('search','Parity 201','locationId',upper(pg_temp.tid(900)::text))),'audit-priority',1,10)#>>'{rows,0,locationName}',
  '시험10','uppercase inventory UUID retains selected location label');
select is((select jsonb_build_object('provider',c.collprovider,'deterministic',c.collisdeterministic,'locale',coalesce(to_jsonb(c)->>'colliculocale',to_jsonb(c)->>'colllocale'))
  from pg_catalog.pg_collation c join pg_catalog.pg_namespace n on n.oid=c.collnamespace where n.nspname='dashboard_private' and c.collname='textbook_ko_label'),
  '{"provider":"i","deterministic":true,"locale":"ko"}'::jsonb,'task-local label collation is deterministic nonnumeric Korean ICU');

-- Adjacent actual-model parity, deliberately added before changing SQL whitespace projections.
update public.textbooks set title=E'수\u00a0Ⅰ' where id=pg_temp.tid(206);
select is(public.get_textbook_master_detail_v1(pg_temp.tid(206))#>>'{row,qualityIssues,subjectMismatch}','true','internal JS whitespace preserves NBSP Roman numeral hint');
update public.textbook_inventory_locations set name=E'\t 시험10\u00a0',code=E'\t __tb2_main__\u00a0' where id=pg_temp.tid(900);
select is(public.get_textbook_master_detail_v1(pg_temp.tid(201))#>>'{row,locationSummary,0,name}','시험10','detail location label uses JS trim');
select is(public.get_textbook_master_detail_v1(pg_temp.tid(201))#>>'{row,locationSummary,0,code}','__tb2_main__','detail location code uses JS trim');
select is((select value->>'name' from jsonb_array_elements(public.get_textbook_master_summary_v1(pg_temp.tf())->'locations')value where value->>'id'=pg_temp.tid(900)::text),'시험10','summary location label uses JS trim');
select is((select value->>'code' from jsonb_array_elements(public.get_textbook_master_summary_v1(pg_temp.tf())->'locations')value where value->>'id'=pg_temp.tid(900)::text),'__tb2_main__','summary location code uses JS trim');
select is(public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity 201"}'),'audit-priority',1,10)#>>'{rows,0,locationName}','시험10','inventory location label uses JS trim');
select is(public.list_textbook_inventory_history_page_v1(jsonb_build_object('textbookId',pg_temp.tid(201),'locationId',pg_temp.tid(900)),'event-desc',1,10)#>>'{rows,0,locationName}','시험10','history location label uses JS trim');
update public.textbook_inventory_locations set name=E' \t ' where id=pg_temp.tid(900);
select is(public.get_textbook_master_detail_v1(pg_temp.tid(201))#>>'{row,locationSummary,0,name}','','raw whitespace name stays selected before trim in ledger location summary');
select is((select value->>'name' from jsonb_array_elements(public.get_textbook_master_summary_v1(pg_temp.tf())->'locations')value where value->>'id'=pg_temp.tid(900)::text),'','summary preserves selected whitespace name before trim');
select is(public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity 201"}'),'audit-priority',1,10)#>>'{rows,0,locationName}','-','inventory empty trimmed name uses its own display dash');
select is(public.list_textbook_inventory_history_page_v1(jsonb_build_object('textbookId',pg_temp.tid(201),'locationId',pg_temp.tid(900)),'event-desc',1,10)#>>'{rows,0,locationName}',pg_temp.tid(900)::text,'history absent trimmed lookup label retains original ID fallback');
update public.textbook_inventory_locations set name='' where id=pg_temp.tid(900);
select is(public.get_textbook_master_detail_v1(pg_temp.tid(201))#>>'{row,locationSummary,0,name}','__tb2_main__','empty raw name chooses code before trim');
select is(public.list_textbook_inventory_page_v1(pg_temp.ti('{"search":"Parity 201"}'),'audit-priority',1,10)#>>'{rows,0,locationName}','__tb2_main__','inventory empty raw name chooses trimmed code');
select is(public.list_textbook_inventory_history_page_v1(jsonb_build_object('textbookId',pg_temp.tid(201),'locationId',pg_temp.tid(900)),'event-desc',1,10)#>>'{rows,0,locationName}','__tb2_main__','history empty raw name maps trimmed code');
-- Actual taxonomy oracle: category 중<NBSP>2<NBSP>독해 => middle/m2 and 독해.
-- Required canonical database arrays/subsubject stay valid; public reads test request normalization.
update public.textbooks set title='Taxonomy whitespace',category=E'중\u00a02\u00a0독해',school_level='middle',grade_level='m2',school_levels=array['middle'],grade_levels=array['m2'],sub_subject='독해' where id=pg_temp.tid(206);
select is(public.list_textbook_master_page_v1(pg_temp.tf('{"search":"Taxonomy whitespace","gradeLevel":"m2"}'),'quality-title',1,10)->>'totalCount','1','valid explicit taxonomy row matches canonical m2 public filter');
select is(public.list_textbook_master_page_v1(pg_temp.tf(jsonb_build_object('search','Taxonomy whitespace','gradeLevel',E'중\u00a02')),'quality-title',1,10)->>'totalCount','1','accepted NBSP grade filter normalizes to m2');
select is(public.list_textbook_master_page_v1(pg_temp.tf('{"search":"Taxonomy whitespace","subSubject":"독해"}'),'quality-title',1,10)->>'totalCount','1','valid explicit subsubject remains selected despite NBSP category text');
-- Legacy missing-array inference is a pure helper contract, not an invalid database fixture.
select is((select jsonb_build_object('schoolLevels',value->'schools','gradeLevels',value->'grades','subSubject',value->'subSubject')
  from(select dashboard_private.textbook_taxonomy_v1(jsonb_build_object('category',E'중\u00a02\u00a0독해'))value)s),
  '{"schoolLevels":["middle"],"gradeLevels":["m2"],"subSubject":"독해"}'::jsonb,'actual pure taxonomy helper preserves legacy NBSP category inference');
update public.textbooks set title='Duplicate Preview' where id in(select pg_temp.tid(n)from generate_series(1,11)n);
select is(public.list_textbook_master_page_v1(pg_temp.tf('{"search":"Duplicate Preview"}'),'quality-title',2,10)#>>'{rows,0,id}',pg_temp.tid(11)::text,'equal subject/score/title keys use stable ID across page boundary');
select is(public.check_textbook_master_duplicate_v1('{"excludeId":null,"title":"Duplicate Preview","subject":"english","publisher":"","category":""}')->>'totalCount','11','duplicate check counts outside its preview');
select is(jsonb_array_length(public.check_textbook_master_duplicate_v1('{"excludeId":null,"title":"Duplicate Preview","subject":"english","publisher":"","category":""}')->'previewRows'),10,'duplicate preview is independently bounded10');
update public.textbooks set title='__tbqa__ 교재 '||n from generate_series(1,11)n where id=pg_temp.tid(n);

create temp table endpoint_calls(name text,query text);
insert into endpoint_calls values
('master page',$q$select public.list_textbook_master_page_v1(pg_temp.tf(),'quality-title',1,10)$q$),
('inventory page',$q$select public.list_textbook_inventory_page_v1(pg_temp.ti(),'audit-priority',1,10)$q$),
('history page',$q$select public.list_textbook_inventory_history_page_v1('{"textbookId":null,"locationId":null}','event-desc',1,10)$q$),
('master summary',$q$select public.get_textbook_master_summary_v1(pg_temp.tf())$q$),
('inventory summary',$q$select public.get_textbook_inventory_summary_v1(pg_temp.ti())$q$),
('master detail',$q$select public.get_textbook_master_detail_v1(pg_temp.tid(201))$q$),
('inventory balance',$q$select public.get_textbook_inventory_balance_v1('{"textbookIds":[],"locationId":null}')$q$),
('duplicate',$q$select public.check_textbook_master_duplicate_v1('{"excludeId":null,"title":"Parity 201","subject":"english","publisher":"","category":""}')$q$);
grant select on endpoint_calls to anon;
select set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000902',true);
select is(public.list_textbook_master_page_v1(pg_temp.tf(),'quality-title',1,10)->>'totalCount','111','staff authorized same scope');
select lives_ok(query,'staff executes '||name) from endpoint_calls;
select set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000903',true);
select throws_ok(query,'42501','textbook_management_read_forbidden','teacher denied '||name)from endpoint_calls;
select throws_ok($$select public.get_textbook_inventory_balance_v1(jsonb_build_object('textbookIds','[]'::jsonb,'locationId',pg_temp.tid(99999)))$$,'42501','textbook_management_read_forbidden','balance rejects teacher before unavailable location context');
select throws_ok($$select public.list_textbook_master_page_v1(pg_temp.tf(),'quality-title',1,10)$$,'42501','textbook_management_read_forbidden','teacher denied management page despite master write policy');
select throws_ok($$select public.get_textbook_master_summary_v1(pg_temp.tf())$$,'42501','textbook_management_read_forbidden','teacher denied management summary');
select throws_ok($$select public.get_textbook_inventory_balance_v1('{"textbookIds":[],"locationId":null}')$$,'42501','textbook_management_read_forbidden','empty balance context still checks server authority');
select set_config('request.jwt.claim.sub','',true);
select throws_ok(query,'42501','textbook_management_read_forbidden','missing authenticated identity denied '||name)from endpoint_calls;
reset role;
set local role anon;
select throws_ok(query,'42501',null,'anon denied '||name)from endpoint_calls;
select throws_ok($$select public.list_textbook_master_page_v1(pg_temp.tf(),'quality-title',1,10)$$,'42501',null,'anon execute denied under actual anon role');
reset role;
select is((select count(*)from dashboard_private.notification_events),(select events from send_before),'fixture and reads created no notification event');
select is((select count(*)from dashboard_private.notification_event_fanout_jobs),(select jobs from send_before),'fixture and reads created no fanout job');
select is((select count(*)from dashboard_private.notification_deliveries),(select deliveries from send_before),'fixture and reads created no provider delivery');
select * from finish();
rollback;
