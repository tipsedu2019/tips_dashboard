begin;
select no_plan();
set local timezone='UTC';
set local statement_timeout='30s';
set local lock_timeout='5s';
create function pg_temp.wid(n integer) returns uuid language sql immutable as $$ select ('3b000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.pf(p jsonb default '{}') returns jsonb language sql immutable as $$ select '{"mode":"order","search":"__t3b__","boardScope":"all","requestFilter":"all","orderFilter":"all"}'::jsonb||p $$;
create function pg_temp.sf(p jsonb default '{}') returns jsonb language sql immutable as $$ select '{"search":"__t3b__","status":"all"}'::jsonb||p $$;
create function pg_temp.hf(p jsonb default '{}') returns jsonb language sql immutable as $$ select '{"search":"","year":"all","month":"all","classId":"all"}'::jsonb||p $$;
create function pg_temp.measure_one_read(method text,page integer) returns numeric language plpgsql as $$
declare started timestamptz; elapsed numeric; begin
  started:=clock_timestamp();
  case method
    when 'listTextbookPurchasePage' then perform public.list_textbook_purchase_page_v1(pg_temp.pf(),'status-event',page,10);
    when 'listTextbookSalePage' then perform public.list_textbook_sale_page_v1(pg_temp.sf(),'status-event',page,10);
    when 'listTextbookSaleHistoryPage' then perform public.list_textbook_sale_history_page_v1(pg_temp.hf(),'month-class-title',page,10);
    else raise exception 'unsupported measured method';
  end case;
  elapsed:=extract(epoch from clock_timestamp()-started)*1000;
  return elapsed;
end $$;
create temp table send_before as select
 (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_event_fanout_jobs) jobs,
 (select count(*) from dashboard_private.notification_deliveries) deliveries;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.wid(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','task3b-'||n||'@example.invalid',crypt('local-only',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now() from generate_series(901,904)n;
insert into public.profiles(id,role,name,email) values
(pg_temp.wid(901),'admin','합성 관리자','task3b-901@example.invalid'),(pg_temp.wid(902),'staff','합성 직원','task3b-902@example.invalid'),
(pg_temp.wid(903),'teacher','합성 교사','task3b-903@example.invalid'),(pg_temp.wid(904),'teacher','다른 교사','task3b-904@example.invalid') on conflict(id) do update set role=excluded.role;
insert into public.textbook_inventory_locations(id,code,name,sort_order) values(pg_temp.wid(900),'__t3b_main__','본관',10);
insert into public.classes(id,name,class_type,subject,status,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan)
values(pg_temp.wid(600),'중2반','정규','영어','수강','[]','[]','[]','[]','{}'),(pg_temp.wid(601),'중10반','정규','영어','수강','[]','[]','[]','[]','{}');
insert into public.textbooks(id,title,name,subject,publisher,category,isbn13,price,sale_price,school_level,grade_level,school_levels,grade_levels,sub_subject,status)
select pg_temp.wid(n),'__t3b__ 교재 '||n,'__t3b__ 교재 '||n,'english','출판사','독해','t3b-'||n,10000,10000,'middle','m2',array['middle'],array['m2'],'독해','active' from generate_series(1,112)n;
update public.textbooks set status='inactive' where id=pg_temp.wid(112);
insert into public.textbook_purchase_orders(id,requested_by,order_date,status,created_by,created_at,updated_at)
select pg_temp.wid(n),'합성 교사',date '2026-08-01','requested',pg_temp.wid(904),timestamptz '2026-08-01T00:00:00Z',null::timestamptz from generate_series(5001,5112)n
union all select pg_temp.wid(n),'합성 교사',date '2026-08-01','requested',pg_temp.wid(904),timestamptz '2026-08-01T00:00:00Z',null::timestamptz from generate_series(6001,6111)n;
insert into public.textbook_purchase_order_lines(id,purchase_order_id,textbook_id,class_id,location_id,requested_quantity,copy_scope,created_at,updated_at)
select pg_temp.wid(1000+n),pg_temp.wid(5000+n),pg_temp.wid(n),pg_temp.wid(600),pg_temp.wid(900),2,'student',timestamptz '2026-08-01T00:00:00.000002Z',null::timestamptz from generate_series(1,112)n
union all select pg_temp.wid(2000+n),pg_temp.wid(6000+n),pg_temp.wid(n),pg_temp.wid(600),pg_temp.wid(900),3,'teacher',timestamptz '2026-08-01T00:00:00.000001Z',null::timestamptz from generate_series(1,111)n;
insert into public.textbook_purchase_order_lines(id,purchase_order_id,textbook_id,class_id,location_id,requested_quantity,copy_scope,created_at,updated_at)
values(pg_temp.wid(3001),pg_temp.wid(5001),pg_temp.wid(1),pg_temp.wid(600),pg_temp.wid(900),7,'student','2026-08-01T00:00:00.000003Z',null),
(pg_temp.wid(3002),pg_temp.wid(6001),pg_temp.wid(1),pg_temp.wid(600),pg_temp.wid(900),11,'teacher','2026-08-01T00:00:00.000003Z',null);
insert into public.textbook_sales(id,class_id,charge_month,status,created_at,updated_at)
values(pg_temp.wid(7000),pg_temp.wid(600),'2026-08','charged','2026-08-01T00:00:00Z',null),
(pg_temp.wid(7001),pg_temp.wid(601),'2025-12','charged','2025-12-01T00:00:00Z',null);
insert into public.textbook_sale_lines(id,sale_id,textbook_id,class_id,location_id,charge_month,quantity,unit_price,copy_scope,teacher_name,status,created_at,updated_at)
select pg_temp.wid(8000+n),pg_temp.wid(7000),pg_temp.wid(n),pg_temp.wid(600),pg_temp.wid(900),'2026-08',2,10000,'student','','charged',timestamptz '2026-08-01T00:00:00Z',null::timestamptz from generate_series(1,112)n
union all select pg_temp.wid(9000+n),pg_temp.wid(7000),pg_temp.wid(n),pg_temp.wid(600),pg_temp.wid(900),'2026-08',3,10000,'teacher','합성 교사','issued',timestamptz '2026-08-01T00:00:00Z',timestamptz '2026-08-31T00:00:00Z' from generate_series(1,111)n;
insert into public.textbook_sale_lines(id,sale_id,textbook_id,class_id,location_id,charge_month,quantity,status)
values(pg_temp.wid(10001),pg_temp.wid(7001),pg_temp.wid(1),pg_temp.wid(601),pg_temp.wid(900),'2025-12',7,'paid'),
(pg_temp.wid(10002),pg_temp.wid(7000),pg_temp.wid(1),pg_temp.wid(600),pg_temp.wid(900),'2026-08',100,'excluded'),
(pg_temp.wid(10003),pg_temp.wid(7000),pg_temp.wid(1),pg_temp.wid(600),pg_temp.wid(900),'2026-08',100,'cancelled'),
(pg_temp.wid(10004),pg_temp.wid(7000),pg_temp.wid(1),pg_temp.wid(600),pg_temp.wid(900),'2026-08',100,'returned');
select has_function('public',name,args,name||' exists') from (values
('list_textbook_purchase_page_v1',array['jsonb','text','integer','integer']),
('list_textbook_sale_page_v1',array['jsonb','text','integer','integer']),
('list_textbook_sale_history_page_v1',array['jsonb','text','integer','integer']),
('get_textbook_purchase_summary_v1',array['jsonb']),
('get_textbook_sale_summary_v1',array['jsonb']),
('get_textbook_sale_history_summary_v1',array['jsonb']),
('get_textbook_operations_summary_v1',array[]::text[]),
('get_textbook_purchase_detail_v1',array['uuid','text']),
('get_textbook_sale_detail_v1',array['uuid'])) f(name,args);
set local role authenticated;
select set_config('request.jwt.claim.sub','3b000000-0000-4000-8000-000000000901',true);
select is(public.list_textbook_purchase_page_v1(pg_temp.pf(),'status-event',11,10)->>'totalCount','113','purchase counts111 first pairs plus2 repeated-scope singletons');
select is(public.list_textbook_purchase_page_v1(pg_temp.pf(),'status-event',11,10)#>>'{rows,0,anchorLineId}',pg_temp.wid(2101)::text,'direct page11 tie by real anchor after microsecond source pairing');
select is(public.list_textbook_purchase_page_v1(pg_temp.pf(),'status-event',1,10)#>'{rows,0,memberLineIds}',jsonb_build_array(pg_temp.wid(2001),pg_temp.wid(1001)),'first teacher and student cross-order pair complete');
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(1001),'order')#>>'{row,anchorLineId}',pg_temp.wid(2001)::text,'nonfirst student member resolves complete unfiltered case');
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(3001),'order')#>'{row,memberLineIds}',jsonb_build_array(pg_temp.wid(3001)),'later same-scope member stays singleton');
select is(public.get_textbook_purchase_summary_v1(pg_temp.pf())->>'rawLineCount','224','raw summary count distinct from113 parents');
select is(public.get_textbook_purchase_summary_v1(pg_temp.pf())#>>'{quantities,requested}','573','all224 members contribute quantities not loaded page');
select is(public.get_textbook_purchase_summary_v1(pg_temp.pf())#>>'{quantities,teacher,requested}','344','off-page teacher requested quantities preserved');
select is(public.get_textbook_purchase_summary_v1(pg_temp.pf())#>>'{requestCounts,orderable}','224','request raw facets not parent count');
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(1112),'order'),' {"row":null}'::jsonb,'inactive source purchase detail unavailable');
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(999999),'request'),'{"row":null}'::jsonb,'missing eligible source returns null');
with pages as(select r->>'id' id from generate_series(1,12)p cross join lateral jsonb_array_elements(public.list_textbook_purchase_page_v1(pg_temp.pf(),'status-event',p,10)->'rows')r)
select ok(count(*)=113 and count(distinct id)=113,'all purchase parents traverse without duplicate/omission') from pages;
select is(public.list_textbook_sale_page_v1(pg_temp.sf(),'status-event',11,10)->>'totalCount','226','sale page includes raw excluded/cancelled/returned process rows, excludes inactive book');
select is(public.get_textbook_sale_summary_v1(pg_temp.sf())->>'totalQuantity','862','sale complete filter quantity includes all visible statuses');
select is(public.get_textbook_sale_summary_v1(pg_temp.sf())->>'totalAmount','5620000','billable full amount excludes excluded/returned/cancelled but includes teacher');
select is(public.get_textbook_sale_summary_v1(pg_temp.sf())#>>'{statusCounts,waiting}','113','paid/excluded process group waiting facet');
select is(public.list_textbook_sale_history_page_v1(pg_temp.hf(),'month-class-title',11,10)->>'totalCount','112','history groups111 month/class/book parents plus off-year group');
select is(public.list_textbook_sale_history_page_v1(pg_temp.hf(),'month-class-title',1,10)#>>'{rows,1,textbookTitle}','__t3b__ 교재 2','history Korean numeric title order');
select is(public.get_textbook_sale_history_summary_v1(pg_temp.hf())->>'totalWaitingQuantity','229','raw paid waits plus111 charged*2; excluded/returned/cancelled omitted');
select is(public.get_textbook_sale_history_summary_v1(pg_temp.hf())->>'totalIssuedQuantity','333','teacher copies included in issued history');
select is(public.get_textbook_sale_history_summary_v1(pg_temp.hf())->'yearOptions','["2026","2025"]'::jsonb,'complete source off-page years');
select is(public.get_textbook_sale_history_summary_v1(pg_temp.hf())->'classOptions',jsonb_build_array(jsonb_build_array(pg_temp.wid(600),'중2반'),jsonb_build_array(pg_temp.wid(601),'중10반')),'full source class numeric order');
select is(public.get_textbook_sale_history_summary_v1(pg_temp.hf('{"year":"2026","month":"2025-12"}'))->>'effectiveMonth','all','stale year month resets to all');
select is(public.list_textbook_sale_history_page_v1(pg_temp.hf('{"year":"2026","month":"2025-12"}'),'month-class-title',1,10)->>'totalCount','111','page applies same stale month normalization');
select is(public.get_textbook_sale_history_summary_v1(pg_temp.hf('{"year":"unknown"}'))->>'totalCount','0','unknown year retains empty filter');
select is(public.get_textbook_sale_history_summary_v1(pg_temp.hf('{"classId":"unknown"}'))->>'sourceTotalCount','112','empty class result keeps complete source scope');
select is(public.get_textbook_operations_summary_v1()->>'requestCount','224','ops raw full requested count');
select is(public.get_textbook_operations_summary_v1()->>'issueWaitingCount','112','ops charged and paid only, not excluded');
select is(public.get_textbook_sale_detail_v1(pg_temp.wid(8112)),'{"row":null}'::jsonb,'inactive sale detail absent');
select is(public.list_textbook_sale_page_v1(pg_temp.sf('{"search":"absent"}'),'status-event',1,10),'{"rows":[],"page":1,"pageSize":10,"totalCount":0}'::jsonb,'empty sale authorized scope');
select is(public.list_textbook_purchase_page_v1(pg_temp.pf(),'status-event',2147483647,20),'{"rows":[],"page":2147483647,"pageSize":20,"totalCount":113}'::jsonb,'purchase off-end retains requested page and count');
select is(public.list_textbook_sale_page_v1(pg_temp.sf(),'status-event',2147483647,20),'{"rows":[],"page":2147483647,"pageSize":20,"totalCount":226}'::jsonb,'sale off-end retains requested page and count');
select is(public.list_textbook_sale_history_page_v1(pg_temp.hf(),'month-class-title',2147483647,20),'{"rows":[],"page":2147483647,"pageSize":20,"totalCount":112}'::jsonb,'history off-end retains requested page and count');
select is(jsonb_array_length(public.list_textbook_purchase_page_v1(pg_temp.pf(),'status-event',1,size)->'rows'),size,'purchase exact size '||size)from(values(10),(15),(20))v(size);
select is(jsonb_array_length(public.list_textbook_sale_page_v1(pg_temp.sf(),'status-event',1,size)->'rows'),size,'sale exact size '||size)from(values(10),(15),(20))v(size);
select is(jsonb_array_length(public.list_textbook_sale_history_page_v1(pg_temp.hf(),'month-class-title',1,size)->'rows'),size,'history exact size '||size)from(values(10),(15),(20))v(size);
with pages as(select r->>'id'id from generate_series(1,23)p cross join lateral jsonb_array_elements(public.list_textbook_sale_page_v1(pg_temp.sf(),'status-event',p,10)->'rows')r)
select ok(count(*)=226 and count(distinct id)=226,'sale all static pages no duplicate/omission')from pages;
with pages as(select r->>'id'id from generate_series(1,12)p cross join lateral jsonb_array_elements(public.list_textbook_sale_history_page_v1(pg_temp.hf(),'month-class-title',p,10)->'rows')r)
select ok(count(*)=112 and count(distinct id)=112,'history all static pages no duplicate/omission')from pages;
select throws_ok(format('select public.%I(%s,%L,%s,%s)',rpc,filters,sort,page,size),'22023',message,rpc||' rejects '||label)
from(values('list_textbook_purchase_page_v1','pg_temp.pf()','status-event'),('list_textbook_sale_page_v1','pg_temp.sf()','status-event'),('list_textbook_sale_history_page_v1','pg_temp.hf()','month-class-title'))r(rpc,filters,sort)
cross join(values('NULL','10','textbook_page_invalid','null page'),('0','10','textbook_page_invalid','zero page'),('-1','10','textbook_page_invalid','negative page'),('1','NULL','textbook_page_size_invalid','null size'),('1','5','textbook_page_size_invalid','size5'),('1','25','textbook_page_size_invalid','size25'))v(page,size,message,label);
select throws_ok(format('select public.%I(%s,%s,1,10)',rpc,filters,sort),'22023','textbook_sort_invalid',rpc||' rejects sort')from(values('list_textbook_purchase_page_v1','pg_temp.pf()'),('list_textbook_sale_page_v1','pg_temp.sf()'),('list_textbook_sale_history_page_v1','pg_temp.hf()'))r(rpc,filters)cross join(values('NULL'),($x$'bad'$x$))s(sort);
select throws_ok(format('select public.%I(%s)',rpc,filters),'22023','textbook_filters_invalid',rpc||' rejects malformed filters')from(values('get_textbook_purchase_summary_v1'),('get_textbook_sale_summary_v1'),('get_textbook_sale_history_summary_v1'))r(rpc)cross join(values('NULL'),($x$'{}'::jsonb$x$),($x$'[]'::jsonb$x$))f(filters);
select throws_ok($$select public.list_textbook_sale_history_page_v1(pg_temp.hf('{"search":"교재"}'),'month-class-title',1,10)$$,'22023','textbook_filters_invalid','history rejects invented search');
select throws_ok($$select public.get_textbook_sale_history_summary_v1(pg_temp.hf('{"search":"교재"}'))$$,'22023','textbook_filters_invalid','history summary rejects invented search');
select throws_ok($$select public.get_textbook_purchase_detail_v1(null,'order')$$,'22023','textbook_id_invalid','purchase null anchor invalid');
select throws_ok($$select public.get_textbook_purchase_detail_v1(pg_temp.wid(1001),'invalid')$$,'22023','textbook_mode_invalid','purchase invalid mode exact state');
select throws_ok($$select public.get_textbook_sale_detail_v1(null)$$,'22023','textbook_id_invalid','sale null identity invalid');

-- Exact, bounded synthetic RPC data for final replay; root owns capture/release.
with measurements as materialized(select method,page,pg_temp.measure_one_read(method,page)elapsed from(values
 ('listTextbookPurchasePage',1),('listTextbookPurchasePage',6),('listTextbookPurchasePage',12),
 ('listTextbookSalePage',1),('listTextbookSalePage',12),('listTextbookSalePage',23),
 ('listTextbookSaleHistoryPage',1),('listTextbookSaleHistoryPage',6),('listTextbookSaleHistoryPage',12))v(method,page))
select diag(format('TASK3B_TIMING method=%s page=%s pageSize=10 elapsedMs=%s',method,page,elapsed))||E'\n'||ok(elapsed<8000,method||' one synthetic page '||page||' under8s')from measurements;
select diag('TASK3B_WIRE '||jsonb_build_object('actorId',auth.uid(),'method',method,'input',input,'data',data)::text)from(values
('listTextbookPurchasePage',jsonb_build_object('page',1,'pageSize',10,'sort','status-event','filters',pg_temp.pf('{"search":"__t3b__ 교재 111"}')),public.list_textbook_purchase_page_v1(pg_temp.pf('{"search":"__t3b__ 교재 111"}'),'status-event',1,10)),
('getTextbookPurchaseSummary',pg_temp.pf('{"search":"__t3b__ 교재 111"}'),public.get_textbook_purchase_summary_v1(pg_temp.pf('{"search":"__t3b__ 교재 111"}'))),
('getTextbookPurchaseDetail',jsonb_build_object('anchorLineId',pg_temp.wid(1111),'mode','order'),public.get_textbook_purchase_detail_v1(pg_temp.wid(1111),'order')),
('listTextbookSalePage',jsonb_build_object('page',1,'pageSize',10,'sort','status-event','filters',pg_temp.sf('{"search":"__t3b__ 교재 111"}')),public.list_textbook_sale_page_v1(pg_temp.sf('{"search":"__t3b__ 교재 111"}'),'status-event',1,10)),
('getTextbookSaleSummary',pg_temp.sf('{"search":"__t3b__ 교재 111"}'),public.get_textbook_sale_summary_v1(pg_temp.sf('{"search":"__t3b__ 교재 111"}'))),
('getTextbookSaleDetail',to_jsonb(pg_temp.wid(9111)),public.get_textbook_sale_detail_v1(pg_temp.wid(9111))),
('listTextbookSaleHistoryPage',jsonb_build_object('page',1,'pageSize',10,'sort','month-class-title','filters',pg_temp.hf(jsonb_build_object('classId',pg_temp.wid(601)))),public.list_textbook_sale_history_page_v1(pg_temp.hf(jsonb_build_object('classId',pg_temp.wid(601))),'month-class-title',1,10)),
('getTextbookSaleHistorySummary',pg_temp.hf(),public.get_textbook_sale_history_summary_v1(pg_temp.hf())),
('getTextbookOperationsSummary','null'::jsonb,public.get_textbook_operations_summary_v1())
)w(method,input,data);

select set_config('request.jwt.claim.sub','3b000000-0000-4000-8000-000000000902',true);
select lives_ok($$select public.get_textbook_operations_summary_v1()$$,'staff management reads authorized');
select set_config('request.jwt.claim.sub','3b000000-0000-4000-8000-000000000903',true);
select is(public.list_textbook_purchase_page_v1(pg_temp.pf('{"mode":"request"}'),'status-event',11,10)->>'totalCount','113','teacher can read another actor RLS-visible requests');
select is(public.get_textbook_purchase_summary_v1(pg_temp.pf('{"mode":"request"}'))->>'rawLineCount','224','teacher request summary stays complete');
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(1111),'request')#>'{row,references,supplier}','null'::jsonb,'teacher selected request reference has no supplier catalog');
select diag('TASK3B_WIRE '||jsonb_build_object('actorId',auth.uid(),'method',method,'input',input,'data',data)::text)from(values
('listTextbookPurchasePage',jsonb_build_object('page',1,'pageSize',10,'sort','status-event','filters',pg_temp.pf('{"mode":"request","search":"__t3b__ 교재 111"}')),public.list_textbook_purchase_page_v1(pg_temp.pf('{"mode":"request","search":"__t3b__ 교재 111"}'),'status-event',1,10)),
('getTextbookPurchaseSummary',pg_temp.pf('{"mode":"request","search":"__t3b__ 교재 111"}'),public.get_textbook_purchase_summary_v1(pg_temp.pf('{"mode":"request","search":"__t3b__ 교재 111"}'))),
('getTextbookPurchaseDetail',jsonb_build_object('anchorLineId',pg_temp.wid(1111),'mode','request'),public.get_textbook_purchase_detail_v1(pg_temp.wid(1111),'request')),
('getTextbookPurchaseDetail',jsonb_build_object('anchorLineId',pg_temp.wid(999999),'mode','request'),public.get_textbook_purchase_detail_v1(pg_temp.wid(999999),'request'))
)w(method,input,data);
select throws_ok(sql,'42501','textbook_workflow_read_forbidden','teacher management denied: '||label)from(values
('select public.list_textbook_purchase_page_v1(pg_temp.pf(),''status-event'',1,10)','purchase page'),('select public.get_textbook_purchase_summary_v1(pg_temp.pf())','purchase summary'),('select public.get_textbook_purchase_detail_v1(pg_temp.wid(1111),''order'')','purchase detail'),
('select public.list_textbook_sale_page_v1(pg_temp.sf(),''status-event'',1,10)','sale page'),('select public.get_textbook_sale_summary_v1(pg_temp.sf())','sale summary'),('select public.get_textbook_sale_detail_v1(pg_temp.wid(9111))','sale detail'),
('select public.list_textbook_sale_history_page_v1(pg_temp.hf(),''month-class-title'',1,10)','history page'),('select public.get_textbook_sale_history_summary_v1(pg_temp.hf())','history summary'),('select public.get_textbook_operations_summary_v1()','operations'))v(sql,label);
reset role;
select ok(not p.prosecdef and p.provolatile='s' and p.proconfig in(array['search_path=']::text[],array['search_path=""']::text[])and has_function_privilege('authenticated',p.oid,'execute')and not has_function_privilege('anon',p.oid,'execute')and not has_function_privilege('public',p.oid,'execute'),p.proname||' stable invoker fixed path and authenticated-only ACL')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['list_textbook_purchase_page_v1','list_textbook_sale_page_v1','list_textbook_sale_history_page_v1','get_textbook_purchase_summary_v1','get_textbook_sale_summary_v1','get_textbook_sale_history_summary_v1','get_textbook_operations_summary_v1','get_textbook_purchase_detail_v1','get_textbook_sale_detail_v1']);
set local role anon;
select throws_ok($$select public.get_textbook_operations_summary_v1()$$,'42501',null,'anon denied exact SQLSTATE');
reset role;
-- Separate literal facet scope: line predicates and group predicates are NOT
-- interchangeable. These later fixtures do not alter earlier112-group evidence.
insert into public.textbooks(id,title,name,subject,price,sale_price,school_level,grade_level,school_levels,grade_levels,sub_subject,status)values(pg_temp.wid(201),'Facet','Facet','english',100,100,'middle','m2',array['middle'],array['m2'],'독해','active');
insert into public.textbooks(id,title,name,subject,price,sale_price,school_level,grade_level,school_levels,grade_levels,sub_subject,status,isbn13,barcode)
select pg_temp.wid(n),case n when 202 then 'Ａｌｉａｓ Reader' when 203 then 'Alias Reader' when 204 then 'AliasReader' when 205 then 'Alias Reader 2026' else pg_temp.wid(202)::text end,
 'Alias'||n,'english',100,100,'middle','m2',array['middle'],array['m2'],'독해',case when n=202 then 'inactive' else 'active' end,'ISBN-'||n,'A-'||n from generate_series(202,206)n;
insert into public.textbook_purchase_orders(id,requested_by,order_date,status,created_at,updated_at)
values(pg_temp.wid(12001),'다른 교사','2026-08-01','requested',null,null),
(pg_temp.wid(12002),'다른 교사','2026-08-01','ordered',null,null),
(pg_temp.wid(12003),'다른 교사','2026-08-01','partially_received',null,null),
(pg_temp.wid(12004),'다른 교사','2026-08-01','received',null,null),
(pg_temp.wid(12005),'다른 교사','2026-08-01','returned','2000-01-01',null);
insert into public.textbook_purchase_order_lines(id,purchase_order_id,textbook_id,requested_quantity,ordered_quantity,received_quantity,copy_scope,created_at,updated_at)
values(pg_temp.wid(13001),pg_temp.wid(12001),pg_temp.wid(201),2,0,0,'student',null,null),
(pg_temp.wid(13002),pg_temp.wid(12002),pg_temp.wid(201),3,3,1,'student',null,null),
(pg_temp.wid(13003),pg_temp.wid(12003),pg_temp.wid(201),4,4,2,'student',null,null),
(pg_temp.wid(13004),pg_temp.wid(12004),pg_temp.wid(201),5,5,5,'student',null,null),
(pg_temp.wid(13005),pg_temp.wid(12005),pg_temp.wid(201),6,6,6,'student',null,null);
set local role authenticated;
select set_config('request.jwt.claim.sub','3b000000-0000-4000-8000-000000000901',true);
select is(dashboard_private.textbook_workflow_book_id_v1(pg_temp.wid(202)::text),pg_temp.wid(202),'exact textual ID precedes another book title and retains inactive identity');
select is(dashboard_private.textbook_workflow_book_id_v1(upper(pg_temp.wid(202)::text)),pg_temp.wid(206),'nonexact uppercase ID uses normalized alias, not UUID coercion');
select is(dashboard_private.textbook_workflow_book_id_v1(' Alias   Reader '),pg_temp.wid(202),'NFKC/whitespace alias ties use ID without active preference');
select is(dashboard_private.textbook_workflow_book_id_v1('AliasReader'),pg_temp.wid(204),'normalized alias rank precedes compact rank');
select is(dashboard_private.textbook_workflow_book_id_v1('Alias-Reader'),pg_temp.wid(202),'compact alias ties use ID');
select is(dashboard_private.textbook_workflow_book_id_v1('Alias Reader 2026'),pg_temp.wid(205),'revised edition remains separate');
select is(dashboard_private.textbook_workflow_book_id_v1('ISBN202'),pg_temp.wid(202),'ISBN compact alias preserved');
select is(dashboard_private.textbook_workflow_book_id_v1('A202'),pg_temp.wid(202),'barcode compact alias preserved');
select is(dashboard_private.textbook_workflow_book_id_v1('--'),null::uuid,'empty compact cannot match');
select is(dashboard_private.textbook_workflow_book_id_v1(' '),null::uuid,'empty textual reference cannot match');
select is(public.get_textbook_purchase_summary_v1(pg_temp.pf('{"search":"Facet","orderFilter":"partial"}'))->>'totalCount','1','partial displayed group restricts parents');
select is(public.get_textbook_purchase_summary_v1(pg_temp.pf('{"search":"Facet","orderFilter":"partial"}'))#>>'{requestCounts,all}','5','request facet keeps broader mode groups');
select is(public.get_textbook_purchase_summary_v1(pg_temp.pf('{"search":"Facet","orderFilter":"partial"}'))#>>'{boardScopeCounts,all}','5','board facet keeps broader mode groups');
select is(public.get_textbook_purchase_summary_v1(pg_temp.pf('{"search":"Facet","orderFilter":"partial"}'))#>>'{orderCounts,partial}','1','order facet does apply candidate group restriction');
select is(public.get_textbook_purchase_summary_v1(pg_temp.pf('{"search":"Facet","orderFilter":"returnable"}'))->>'totalCount','2','returnable display admits partial/received only');
select is(public.get_textbook_purchase_summary_v1(pg_temp.pf('{"search":"Facet","orderFilter":"returnable"}'))#>>'{requestCounts,all}','3','broader facet also includes ordered positive receipt');
select is(public.get_textbook_purchase_summary_v1(pg_temp.pf('{"search":"Facet","boardScope":"recent"}'))->>'totalCount','4','missing terminal timestamp remains recent while old terminal excluded');
select is(public.get_textbook_purchase_summary_v1(pg_temp.pf('{"search":"Facet","boardScope":"active"}'))->>'totalCount','3','active excludes terminal statuses');
select is(public.get_textbook_purchase_summary_v1(pg_temp.pf('{"search":"Facet","requestFilter":"orderable"}'))->>'rawLineCount','1','order request filter only requested source even when other books registered');
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(13003),'request'),'{"row":null}'::jsonb,'request detail never exposes an order-mode-only member');
select throws_ok($$select public.list_textbook_purchase_page_v1(pg_temp.pf('{"extra":true}'),'status-event',1,10)$$,'22023','textbook_filters_invalid','unknown purchase filter rejected');
select throws_ok($$select public.list_textbook_sale_page_v1(pg_temp.sf('{"status":"fake"}'),'status-event',1,10)$$,'22023','textbook_filters_invalid','unknown sale status rejected');
select is(public.get_textbook_sale_history_summary_v1(pg_temp.hf('{"year":"2026"}'))->'monthOptions','["2026-08"]'::jsonb,'month options constrained only by selected year');
reset role;
-- Empty-source distinction and UTC fallback/lexicographic timestamp model.
update public.textbook_sale_lines set status='excluded' where id::text like '3b000000-%';
set local role authenticated;
select is(public.get_textbook_sale_history_summary_v1(pg_temp.hf()),'{"totalCount":0,"totalWaitingQuantity":0,"totalIssuedQuantity":0,"sourceTotalCount":0,"yearOptions":[],"monthOptions":[],"classOptions":[],"effectiveMonth":"all"}'::jsonb,'empty entire history differs from empty filtered112-group source');
reset role;
insert into public.textbook_sales(id,charge_month,status,created_at,updated_at)values(pg_temp.wid(14000),'','charged',null,null);
insert into public.textbook_sale_lines(id,sale_id,textbook_id,charge_month,quantity,status,created_at,updated_at)
values(pg_temp.wid(14001),pg_temp.wid(14000),pg_temp.wid(201),'',0,'charged',null,null),
(pg_temp.wid(14002),pg_temp.wid(14000),pg_temp.wid(201),'2026-09',-2,'issued',null,'2026-09-01T00:00:00.000001Z'),
(pg_temp.wid(14003),pg_temp.wid(14000),pg_temp.wid(201),'2026-09',1,'issued',null,'2026-09-01T00:00:00Z');
set local role authenticated;
select is(public.get_textbook_sale_history_summary_v1(pg_temp.hf())->>'totalWaitingQuantity','1','zero history quantity becomes1');
select is(public.get_textbook_sale_history_summary_v1(pg_temp.hf())->>'totalIssuedQuantity','2','negative history quantity becomes1 per line');
select is(public.list_textbook_sale_history_page_v1(pg_temp.hf('{"month":"2026-09"}'),'month-class-title',1,10)#>>'{rows,0,latestAt}','2026-09-01T00:00:00.000001+00:00','history latestAt is lexicographic serialized value, not timestamp max');
select ok(exists(select 1 from jsonb_array_elements(public.list_textbook_sale_history_page_v1(pg_temp.hf(),'month-class-title',1,10)->'rows')r where r->>'month'=to_char(now()at time zone 'UTC','YYYY-MM')),'history missing event fallback uses UTC current month');
select is(public.get_textbook_sale_summary_v1(pg_temp.sf('{"search":"Facet"}'))#>>'{groups,1,totalQuantity}','-1','sale group header retains negative raw quantity fallback independently of overall');
select is(public.get_textbook_sale_summary_v1(pg_temp.sf('{"search":"Facet"}'))->>'totalQuantity','3','overall sale quantity uses max1');
reset role;
update public.classes set name=E'\t 중2반 \n',student_ids=jsonb_build_array('student-a','','  ',null,0,false,'student-b') where id=pg_temp.wid(600);
update public.textbook_inventory_locations set name='' where id=pg_temp.wid(900);
set local role authenticated;
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(1111),'order')#>>'{row,references,class,studentCount}','2','class count uses listIds removing blank/null/zero/false IDs');
select is(public.list_textbook_purchase_page_v1(pg_temp.pf('{"search":"__t3b_main__"}'),'status-event',1,10)->>'totalCount','113','empty location name falls back to code for search');
select is(dashboard_private.textbook_workflow_normalize_v1(U&'A\FEFF B'),'a b','interior ECMAScript whitespace normalized');
reset role;
update public.classes set student_ids=to_jsonb(' a, , b '::text) where id=pg_temp.wid(600);
set local role authenticated;
select is(public.get_textbook_purchase_detail_v1(pg_temp.wid(1111),'order')#>>'{row,references,class,studentCount}','2','legacy comma-string roster count preserved');
reset role;
select is((select count(*) from dashboard_private.notification_events),(select events from send_before),'no notification events');
select is((select count(*) from dashboard_private.notification_event_fanout_jobs),(select jobs from send_before),'no fanout jobs');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from send_before),'no deliveries');
select * from finish();
rollback;
