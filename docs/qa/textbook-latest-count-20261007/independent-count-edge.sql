\set ON_ERROR_STOP on
begin read only;
set local statement_timeout='3s';
set local timezone='Asia/Seoul';

-- Only pg_catalog metadata and VALUES fixtures. No existing fixture rows or DDL.
select jsonb_build_object(
  'check','active schema contract',
  'counted_at_not_null',(select attnotnull from pg_catalog.pg_attribute where attrelid='public.textbook_stock_counts'::regclass and attname='counted_at'),
  'counted_at_type',(select pg_catalog.format_type(atttypid,atttypmod) from pg_catalog.pg_attribute where attrelid='public.textbook_stock_counts'::regclass and attname='counted_at'),
  'invoker',(select not prosecdef from pg_catalog.pg_proc where oid='dashboard_private.textbook_read_keys_v1(text)'::regprocedure),
  'stable',(select provolatile='s' from pg_catalog.pg_proc where oid='dashboard_private.textbook_read_keys_v1(text)'::regprocedure),
  'authenticated_execute',pg_catalog.has_function_privilege('authenticated','dashboard_private.textbook_read_keys_v1(text)','EXECUTE'),
  'anon_execute',pg_catalog.has_function_privilege('anon','dashboard_private.textbook_read_keys_v1(text)','EXECUTE'),
  'public_execute',pg_catalog.has_function_privilege('public','dashboard_private.textbook_read_keys_v1(text)','EXECUTE'),
  'candidate_aggregation_present',pg_catalog.strpos(pg_catalog.pg_get_functiondef('dashboard_private.textbook_read_keys_v1(text)'::regprocedure),'latest_counts as')>0
);

with books(id,active,current_quantity) as (values (1,true,10),(2,true,10),(3,true,10),(4,true,10),(5,true,1),(6,false,10)),
counts(id,textbook_id,location_id,counted_at,copy_scope) as (
 values
 (1,1,'b7300000-0000-4000-8000-000000000001'::uuid,current_date-40,'student'),
 (2,1,'b7300000-0000-4000-8000-000000000001'::uuid,current_date-1,'student'),
 (3,1,'b7300000-0000-4000-8000-000000000001'::uuid,current_date-1,'teacher'),
 (4,1,'b7300000-0000-4000-8000-000000000002'::uuid,current_date+2,'student'),
 (5,1,null::uuid,current_date+3,'student'),
 (6,2,'b7300000-0000-4000-8000-000000000001'::uuid,'infinity'::date,'student'),
 (7,3,'b7300000-0000-4000-8000-000000000001'::uuid,'-infinity'::date,'teacher'),
 (8,4,'b7300000-0000-4000-8000-000000000001'::uuid,current_date+1,'teacher'),
 (9,6,'b7300000-0000-4000-8000-000000000001'::uuid,current_date-40,'student')
), contexts(label,location) as (
 values ('selected','b7300000-0000-4000-8000-000000000001'),
 ('upper','B7300000-0000-4000-8000-000000000001'),
 ('other','b7300000-0000-4000-8000-000000000002'),
 ('unknown','b7300000-0000-4000-8000-000000000099'),
 ('all',''),('null',null),('invalid','invalid'),('whitespace',' b7300000-0000-4000-8000-000000000001 ')
), normalized as (select label,lower(location) location from contexts),
latest_counts as (
 select ctx.label,sc.textbook_id,max(sc.counted_at) counted_at
 from normalized ctx join counts sc on ctx.location<>'' and sc.location_id::text=ctx.location
 group by ctx.label,sc.textbook_id
), compared as (
 select ctx.label,b.id,prior.counted_at old_date,next.counted_at new_date,b.active,b.current_quantity
 from normalized ctx cross join books b
 left join lateral(select sc.counted_at from counts sc where sc.textbook_id=b.id and sc.location_id::text=ctx.location order by sc.counted_at desc,sc.id desc limit 1)prior on true
 left join latest_counts next on next.label=ctx.label and next.textbook_id=b.id
), days as (
 select *,case when isfinite(old_date) then floor(extract(epoch from(now()-(old_date::timestamp at time zone 'UTC')))/86400) end old_days,
 case when isfinite(new_date) then floor(extract(epoch from(now()-(new_date::timestamp at time zone 'UTC')))/86400) end new_days
 from compared
), audited as (
 select *,case when active and(current_quantity<=3 or old_date is null or old_days is null or old_days>=30) then 'recommended' when old_date is not null and old_days<30 then 'done' else 'pending' end old_audit,
 case when active and(current_quantity<=3 or new_date is null or new_days is null or new_days>=30) then 'recommended' when new_date is not null and new_days<30 then 'done' else 'pending' end new_audit
 from days
)
select jsonb_build_object('check','VALUES old lateral versus grouped max','cases',count(*),
 'mismatches',count(*)filter(where old_date is distinct from new_date or old_days is distinct from new_days or old_audit is distinct from new_audit),
 'contexts',array_agg(distinct label)) from audited;
rollback;
