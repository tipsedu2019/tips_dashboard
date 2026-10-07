\set ON_ERROR_STOP on
begin;
truncate table public.textbook_stock_counts cascade;
set local timezone='Asia/Seoul';
set local statement_timeout='20s';
set local jit=off;
set local role authenticated;
select set_config('request.jwt.claim.sub','b7100000-0000-4000-8000-000000900001',true);
create temp table results(label text, iteration int, ms numeric, digest text);
do $bench$
declare master jsonb := '{"search":"","subject":"all","schoolLevel":"all","gradeLevel":"all","subSubject":"all","quality":"all","inventory":"all"}';
 inv jsonb; label text; query text; value jsonb; started timestamptz; n integer;
begin
 inv:=master||'{"locationId":"b7100000-0000-4000-8000-000000900002","audit":"all"}';
 for label,query in select * from (values
 ('keys_all',$q$select jsonb_agg(to_jsonb(k) order by id) from dashboard_private.textbook_read_keys_v1('') k$q$),
 ('keys_location',$q$select jsonb_agg(to_jsonb(k) order by id) from dashboard_private.textbook_read_keys_v1('b7100000-0000-4000-8000-000000900002') k$q$),
 ('master_list',format('select public.list_textbook_master_page_v1(%L::jsonb,''quality-title'',1,10)',master)),
 ('master_summary',format('select public.get_textbook_master_summary_v1(%L::jsonb)',master)),
 ('inventory_list',format('select public.list_textbook_inventory_page_v1(%L::jsonb,''audit-priority'',1,10)',inv)),
 ('inventory_summary',format('select public.get_textbook_inventory_summary_v1(%L::jsonb)',inv)))t(label,query)
 loop
  for n in 0..5 loop
   started:=clock_timestamp(); execute query into value;
   insert into results values(label,n,extract(epoch from clock_timestamp()-started)*1000,md5(value::text));
  end loop;
 end loop;
end $bench$;
select jsonb_build_object('label',label,'median_ms',percentile_cont(0.5) within group(order by ms),'min_ms',min(ms),'max_ms',max(ms),'md5',min(digest),'stable_digest',count(distinct digest)=1,'runs',count(*)) from results where iteration>0 group by label order by label;
rollback;
