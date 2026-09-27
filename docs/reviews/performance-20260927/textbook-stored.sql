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


create function dashboard_private.textbook_stored_taxonomy_v1(
 p_title text,p_name text,p_subject text,p_category text,p_publisher text,p_isbn13 text,p_barcode text,
 p_school_level text,p_grade_level text,p_school_levels text[],p_grade_levels text[],p_sub_subject text
) returns jsonb language sql immutable security invoker set search_path='' as $f$
 select dashboard_private.textbook_taxonomy_v1(jsonb_build_object('title',p_title,'name',p_name,'subject',p_subject,'category',p_category,'publisher',p_publisher,
 'isbn13',p_isbn13,'barcode',p_barcode,'school_level',p_school_level,'grade_level',p_grade_level,'school_levels',p_school_levels,'grade_levels',p_grade_levels,'sub_subject',p_sub_subject))
$f$;
revoke all on function dashboard_private.textbook_stored_taxonomy_v1(text,text,text,text,text,text,text,text,text,text[],text[],text) from public,anon;
grant execute on function dashboard_private.textbook_stored_taxonomy_v1(text,text,text,text,text,text,text,text,text,text[],text[],text) to authenticated,service_role;
alter table public.textbooks add column read_taxonomy jsonb generated always as (
 dashboard_private.textbook_stored_taxonomy_v1(title,name,subject,category,publisher,isbn13,barcode,school_level,grade_level,school_levels,grade_levels,sub_subject)
) stored;
create or replace function dashboard_private.textbook_read_keys_v1(p_location text default '')
returns table(id uuid,title text,subject text,active boolean,taxonomy jsonb,quality jsonb,quality_score integer,
 total_quantity numeric,student_quantity numeric,teacher_quantity numeric,stock_value numeric,current_quantity numeric,
 latest_count_at text,days_since numeric,audit_status text)
language plpgsql stable security invoker set search_path='' as $$ begin
  perform dashboard_private.textbook_read_guard_v1();
  p_location:=lower(p_location);
  return query with books as materialized (
    select t.id,dashboard_private.textbook_trim_v1(coalesce(nullif(t.title,''),t.name,'')) title,dashboard_private.textbook_subject_v1(t.subject) subject,
      lower(dashboard_private.textbook_trim_v1(t.status)) not in ('inactive','미사용') active,
      t.read_taxonomy taxonomy,
      dashboard_private.textbook_compact_v1(coalesce(nullif(t.title,''),t.name,'')) title_key,
      dashboard_private.textbook_trim_v1(coalesce(nullif(t.isbn13,''),t.barcode,''))='' missing_code,dashboard_private.textbook_trim_v1(coalesce(t.publisher,'')) in ('','미분류') missing_publisher,
      coalesce(nullif(t.sale_price,0),nullif(t.price,0),t.list_price,0)<=0 missing_price,
      lower(regexp_replace(dashboard_private.textbook_trim_v1(coalesce(nullif(t.title,''),t.name,'')),'[[:space:]]+',' ','g')) hint_title
    from public.textbooks t
  ), duplicates as (select b.title_key from books b where b.active and b.title_key<>'' group by b.title_key having count(*)>1),
  balances as (select m.textbook_id,sum(m.quantity)::numeric total,sum(m.quantity) filter(where m.copy_scope='student')::numeric student,
    sum(m.quantity) filter(where m.copy_scope='teacher')::numeric teacher,sum(case when m.amount<>0 then m.amount else m.unit_amount*m.quantity end) value,
    sum(m.quantity) filter(where p_location='' or m.location_id::text=p_location)::numeric current
    from public.textbook_stock_moves m group by m.textbook_id),
  flags as (select b.*,jsonb_build_object('duplicate',d.title_key is not null,'missingCode',b.missing_code,'missingPublisher',b.missing_publisher,
    'missingCategory',b.taxonomy->>'schoolScalar'='' and b.taxonomy->>'gradeScalar'='' and b.taxonomy->>'subSubject'='' and b.taxonomy->>'categoryLabel'='미분류',
    'missingPrice',b.missing_price,'subjectMismatch',
      (b.subject='english' and (b.hint_title ~ '(수학|rpm|알피엠|개념원리|확률|통계|미적분|대수)' or b.hint_title ~* '(^|[^가-힣a-z0-9])수[[:space:]]?[12ⅠⅡ]($|[^가-힣a-z0-9])'))
      or (b.subject='math' and b.hint_title ~ '(영어|english|reading|writing|grammar|독해|구문|어법|영단어|리스닝)'), 'inactive',not b.active) quality
    from books b left join duplicates d on d.title_key=b.title_key),
  prepared as (select b.id,b.title,b.subject,b.active,b.taxonomy,b.quality,
    ((b.quality->>'subjectMismatch')::boolean::integer*16+(b.quality->>'duplicate')::boolean::integer*8+
    (b.quality->>'missingPublisher')::boolean::integer*4+(b.quality->>'missingCategory')::boolean::integer*4+
    (b.quality->>'missingPrice')::boolean::integer*4+(b.quality->>'missingCode')::boolean::integer*2+(b.quality->>'inactive')::boolean::integer) score,
    coalesce(m.total,0) total,coalesce(m.student,0) student,coalesce(m.teacher,0) teacher,coalesce(m.value,0) value,coalesce(m.current,0) current,
    coalesce(c.counted_at::text,'') latest,
    case when isfinite(c.counted_at) then floor(extract(epoch from(now()-(c.counted_at::timestamp at time zone 'UTC')))/86400) end days
    from flags b left join balances m on m.textbook_id=b.id
    -- Equal date is stabilized by descending UUID, not treated as chronological.
    left join lateral (select sc.counted_at from public.textbook_stock_counts sc where sc.textbook_id=b.id and sc.location_id::text=p_location order by sc.counted_at desc,sc.id desc limit 1)c on true)
  select p.id,p.title,p.subject,p.active,p.taxonomy,p.quality,p.score,p.total,p.student,p.teacher,p.value,p.current,p.latest,p.days,
    case when p.active and (p.current<=3 or p.latest='' or p.days is null or p.days>=30) then 'recommended'
      when p.latest<>'' and p.days<30 then 'done' else 'pending' end from prepared p;
end $$;
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
