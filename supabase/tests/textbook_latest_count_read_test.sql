begin;
select no_plan();
set local timezone='Asia/Seoul';
set local statement_timeout='30s';

create function pg_temp.id(n integer) returns uuid language sql immutable as $$
 select ('b7200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
select pg_temp.id(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
 'latest-count-'||n||'@example.invalid',now(),now() from generate_series(901,903)n;
insert into public.profiles(id,role,name,email) select pg_temp.id(n),
 case n when 901 then 'admin' when 902 then 'staff' else 'teacher' end,
 'Synthetic reader','latest-count-'||n||'@example.invalid' from generate_series(901,903)n
 on conflict(id) do update set role=excluded.role;
insert into public.textbook_inventory_locations(id,code,name) values
 (pg_temp.id(800),'__latest_count_main__','Synthetic main'),
 (pg_temp.id(801),'__latest_count_annex__','Synthetic annex');
insert into public.textbooks(id,title,name,subject,school_levels,grade_levels,sub_subject,status)
select pg_temp.id(n),'__latest_count__ '||n,'__latest_count__ '||n,'english',array['middle'],array['m2'],'독해',
 case n when 6 then 'inactive' else 'active' end from generate_series(1,6)n;
insert into public.textbook_stock_moves(textbook_id,location_id,move_type,quantity)
select pg_temp.id(n),pg_temp.id(800),'opening',10 from generate_series(1,6)n;
insert into public.textbook_stock_counts(id,textbook_id,location_id,counted_at,copy_scope) values
 (pg_temp.id(101),pg_temp.id(1),pg_temp.id(800),current_date-40,'student'),
 (pg_temp.id(102),pg_temp.id(1),pg_temp.id(800),current_date-1,'student'),
 (pg_temp.id(103),pg_temp.id(1),pg_temp.id(800),current_date-1,'teacher'),
 (pg_temp.id(104),pg_temp.id(1),pg_temp.id(801),current_date+2,'student'),
 (pg_temp.id(105),pg_temp.id(1),null,current_date+3,'student'),
 (pg_temp.id(106),pg_temp.id(2),pg_temp.id(800),'infinity','student'),
 (pg_temp.id(107),pg_temp.id(3),pg_temp.id(800),'-infinity','teacher'),
 (pg_temp.id(108),pg_temp.id(4),pg_temp.id(800),current_date+1,'teacher'),
 (pg_temp.id(109),pg_temp.id(6),pg_temp.id(800),current_date-40,'student');

select ok(not prosecdef and provolatile='s' and proconfig in(array['search_path=']::text[],array['search_path=""']::text[]),
 'final helper retains stable invoker and fixed search path') from pg_proc
 where oid='dashboard_private.textbook_read_keys_v1(text)'::regprocedure;
select ok(has_function_privilege('authenticated','dashboard_private.textbook_read_keys_v1(text)','execute')
 and not has_function_privilege('anon','dashboard_private.textbook_read_keys_v1(text)','execute')
 and not has_function_privilege('public','dashboard_private.textbook_read_keys_v1(text)','execute'),
 'helper ACL remains authenticated only');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id(901)::text,true);
-- The prior lateral query is an independent oracle for the projected date.
-- Includes uppercase, unknown, malformed internal input, empty and NULL context.
select results_eq(
 format('select id,latest_count_at from dashboard_private.textbook_read_keys_v1(%L) where id between %L::uuid and %L::uuid order by id',location,pg_temp.id(1),pg_temp.id(6)),
 format($q$select t.id,coalesce(c.counted_at::text,'') from public.textbooks t
 left join lateral(select sc.counted_at from public.textbook_stock_counts sc
 where sc.textbook_id=t.id and sc.location_id::text=lower(%L)
 order by sc.counted_at desc,sc.id desc limit 1)c on true
 where t.id between %L::uuid and %L::uuid order by t.id$q$,location,pg_temp.id(1),pg_temp.id(6)),
 'same latest date as prior contract: '||coalesce(location,'NULL'))
from unnest(array[pg_temp.id(800)::text,upper(pg_temp.id(800)::text),pg_temp.id(801)::text,
 pg_temp.id(899)::text,'','invalid',null])location;
select results_eq($q$select audit_status from dashboard_private.textbook_read_keys_v1('b7200000-0000-4000-8000-000000000800')
 where id between 'b7200000-0000-4000-8000-000000000001'::uuid and 'b7200000-0000-4000-8000-000000000006'::uuid order by id$q$,
 $$select * from (values('done'::text),('recommended'),('recommended'),('done'),('recommended'),('pending'))expected(status)$$,
 'ties, both copy scopes, infinities, future dates, no count and inactive audit statuses remain unchanged');
select is((select latest_count_at from dashboard_private.textbook_read_keys_v1('') where id=pg_temp.id(1)),
 ''::text,'all-locations context never borrows a dated or unassigned count');
select set_config('request.jwt.claim.sub',pg_temp.id(902)::text,true);
select lives_ok($$select * from dashboard_private.textbook_read_keys_v1('')$$,'staff can read');
select set_config('request.jwt.claim.sub',pg_temp.id(903)::text,true);
select throws_ok($$select * from dashboard_private.textbook_read_keys_v1('')$$,
 '42501','textbook_management_read_forbidden','teacher remains denied');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select * from dashboard_private.textbook_read_keys_v1('')$$,
 '42501','textbook_management_read_forbidden','missing identity remains denied');
reset role;
set local role anon;
select throws_ok($$select * from dashboard_private.textbook_read_keys_v1('')$$,
 '42501',null,'anon execute remains denied');
reset role;
select * from finish();
rollback;
