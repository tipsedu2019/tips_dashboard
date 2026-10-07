\set ON_ERROR_STOP on
begin;
create function pg_temp.fixture_id(n integer) returns uuid language sql immutable as $$ select ('b7100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
(pg_temp.fixture_id(900001),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','query-local@example.invalid',now(),now());
insert into public.profiles(id,role,name,email) values(pg_temp.fixture_id(900001),'admin','Synthetic admin','query-local@example.invalid') on conflict(id) do update set role=excluded.role;
insert into public.textbook_inventory_locations(id,code,name,sort_order) values
(pg_temp.fixture_id(900002),'__query_main__','Synthetic main',101),(pg_temp.fixture_id(900003),'__query_annex__','Synthetic annex',102);
insert into public.textbooks(id,title,name,subject,publisher,category,isbn13,price,sale_price,school_level,grade_level,school_levels,grade_levels,sub_subject,status)
select pg_temp.fixture_id(n),case when n%11=0 then 'Synthetic duplicate' else 'Synthetic book '||n end,'Synthetic book '||n,
case when n%3=0 then 'math' else 'english' end,case when n%7=0 then '' else 'Synthetic publisher' end,'독해',case when n%5=0 then null else 'synthetic-'||n end,
case when n%13=0 then 0 else 10000 end,0,'middle','m2',array['middle'],array['m2'],'독해',case when n%17=0 then 'inactive' else 'active' end
from generate_series(1,400)n;
insert into public.textbook_stock_moves(id,textbook_id,location_id,move_type,quantity,unit_amount,amount,moved_at,copy_scope)
select pg_temp.fixture_id(1000+n),pg_temp.fixture_id(1+(n-1)%400),case when n%7=0 then null when n%3=0 then pg_temp.fixture_id(900003) else pg_temp.fixture_id(900002) end,
'opening',case when n%5=0 then -1 else 1 end,100,0,'2026-01-01T00:00:00Z'::timestamptz+n*interval '1 minute',case when n%11=0 then 'teacher' else 'student' end
from generate_series(1,10000)n;
insert into public.textbook_stock_counts(id,textbook_id,location_id,counted_at,expected_quantity,counted_quantity,copy_scope)
select pg_temp.fixture_id(100000+n),pg_temp.fixture_id(1+(n-1)%400),case when n%7=0 then null when n%3=0 then pg_temp.fixture_id(900003) else pg_temp.fixture_id(900002) end,
'2026-01-01'::date+((n-1)/400),1,1,case when n%11=0 then 'teacher' else 'student' end from generate_series(1,20000)n;
commit;
analyze public.textbooks;
analyze public.textbook_stock_moves;
analyze public.textbook_stock_counts;
