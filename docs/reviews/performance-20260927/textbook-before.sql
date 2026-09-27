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


set local role authenticated;
select set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000901',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(901),'role','authenticated')::text,true);
\timing on
select count(*) from dashboard_private.textbook_read_keys_v1();
explain (analyze,buffers) select public.list_textbook_master_page_v1(pg_temp.tf(),'quality-title',1,10);
explain (analyze,buffers) select public.get_textbook_master_summary_v1(pg_temp.tf());
set local jit = off;
explain (analyze,buffers) select public.list_textbook_master_page_v1(pg_temp.tf(),'quality-title',1,10);
explain (analyze,buffers) select public.get_textbook_master_summary_v1(pg_temp.tf());
rollback;
