begin;
select no_plan();
set local statement_timeout = '30s';
set local lock_timeout = '5s';
create function pg_temp.cid(n integer) returns uuid language sql immutable as $$
  select ('a9300000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.save_count(n integer, expected integer default 10, counted integer default 7,
  location uuid default pg_temp.cid(900), memo text default '실사') returns jsonb language plpgsql as $$
begin
  return public.create_textbook_stock_count_v1(pg_temp.cid(n),pg_temp.cid(800),location,expected,counted,'2026-09-08',12000.5,memo);
end $$;
create temp table sends_before as select
  (select count(*) from dashboard_private.notification_events) events,
  (select count(*) from dashboard_private.notification_deliveries) deliveries;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
select pg_temp.cid(n),'authenticated','authenticated','count-atomic-'||n||'@example.invalid','{}','{}'
from generate_series(901,904)n;
update public.profiles set role=case id when pg_temp.cid(901) then 'admin' when pg_temp.cid(902) then 'staff' when pg_temp.cid(903) then 'teacher' else 'assistant' end
where id in(pg_temp.cid(901),pg_temp.cid(902),pg_temp.cid(903),pg_temp.cid(904));
insert into public.textbook_inventory_locations(id,code,name) values(pg_temp.cid(900),'__count_atomic__','실사 검증');
insert into public.textbooks(id,name,title,subject,school_level,grade_level,school_levels,grade_levels,sub_subject)
values(pg_temp.cid(800),'__count_atomic__','__count_atomic__','english','middle','m2',array['middle'],array['m2'],'독해');
insert into public.textbook_stock_moves(id,textbook_id,location_id,move_type,quantity,copy_scope)
values(pg_temp.cid(100),pg_temp.cid(800),pg_temp.cid(900),'opening',8,'student'),
  (pg_temp.cid(101),pg_temp.cid(800),pg_temp.cid(900),'opening',2,'teacher');

select has_function('public','create_textbook_stock_count_v1',array['uuid','uuid','uuid','integer','integer','date','numeric','text'],'atomic count exists in final migration chain');
select has_function('public','delete_textbook_inventory_history_v1',array['text','uuid'],'atomic history deletion exists');
select ok(not p.prosecdef and 'search_path=""'=any(p.proconfig),'count uses caller RLS and an empty search path') from pg_proc p where p.oid='public.create_textbook_stock_count_v1(uuid,uuid,uuid,integer,integer,date,numeric,text)'::regprocedure;
select ok(not p.prosecdef,'history deletion uses caller RLS') from pg_proc p where p.oid='public.delete_textbook_inventory_history_v1(text,uuid)'::regprocedure;
select ok(not has_function_privilege('anon','public.create_textbook_stock_count_v1(uuid,uuid,uuid,integer,integer,date,numeric,text)','EXECUTE'),'count rejects anonymous callers');
select ok(not has_function_privilege('anon','public.delete_textbook_inventory_history_v1(text,uuid)','EXECUTE'),'delete rejects anonymous callers');
select ok(not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl)a where p.proname in('create_textbook_stock_count_v1','delete_textbook_inventory_history_v1') and a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC execute is revoked');
select ok((select relrowsecurity from pg_class where oid='public.textbook_stock_count_requests'::regclass),'request receipts have RLS');
select ok(not has_table_privilege('authenticated','public.textbook_stock_count_requests','DELETE'),'browser cannot erase request tombstones');
select ok(not has_table_privilege('authenticated','public.textbook_stock_count_requests','UPDATE'),'browser cannot rewrite request receipts');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.cid(901)::text,true);
select is(pg_temp.save_count(1)->>'id',pg_temp.cid(1)::text,'admin can count');
select is((select sum(quantity) from public.textbook_stock_moves where textbook_id=pg_temp.cid(800)),7::bigint,'count adjusts the same combined scope shown in inventory');
select is((select sum(quantity) from public.textbook_stock_moves where textbook_id=pg_temp.cid(800) and copy_scope='teacher'),2::bigint,'teacher copy movements are unchanged');
select is((select m.quantity from public.textbook_stock_counts c join public.textbook_stock_moves m on m.id=c.adjustment_move_id where c.id=pg_temp.cid(1)),-3,'count returns a linked adjustment');
select is((select m.amount from public.textbook_stock_counts c join public.textbook_stock_moves m on m.id=c.adjustment_move_id where c.id=pg_temp.cid(1)),-36001.5::numeric,'decimal inventory value is preserved');
select is((select created_by from public.textbook_stock_counts where id=pg_temp.cid(1)),pg_temp.cid(901),'count actor comes from authenticated uid');
select is((select m.created_by from public.textbook_stock_counts c join public.textbook_stock_moves m on m.id=c.adjustment_move_id where c.id=pg_temp.cid(1)),pg_temp.cid(901),'adjustment actor comes from authenticated uid');
create temp table first_count as select to_jsonb(c) row from public.textbook_stock_counts c where id=pg_temp.cid(1);
create temp table first_move as select to_jsonb(m) row from public.textbook_stock_moves m join public.textbook_stock_counts c on c.adjustment_move_id=m.id where c.id=pg_temp.cid(1);
select is(pg_temp.save_count(1,7),(select row from first_count),'response-loss retry accepts a refreshed expected balance and returns the original count');
select is((select to_jsonb(m) from public.textbook_stock_moves m join public.textbook_stock_counts c on c.adjustment_move_id=m.id where c.id=pg_temp.cid(1)),(select row from first_move),'retry preserves adjustment id time and amount');
select is((select count(*) from public.textbook_stock_counts where textbook_id=pg_temp.cid(800)),1::bigint,'retry creates one count');
select throws_ok($$select pg_temp.save_count(1,7,6)$$,'23514','textbook_count_request_conflict','same request with changed intent fails');
select throws_ok($$select pg_temp.save_count(1,7,7,pg_temp.cid(900),'변경')$$,'23514','textbook_count_request_conflict','same request cannot rewrite the memo');
select throws_ok($$select pg_temp.save_count(2,10,7)$$,'23514','textbook_count_balance_changed','stale separate count fails with domain SQLSTATE 23514');
select is((select count(*) from public.textbook_stock_count_requests where request_id=pg_temp.cid(2)),0::bigint,'failed attempt leaves no request receipt');
select is(pg_temp.save_count(2,7,7)->>'adjustment_move_id',null::text,'zero difference still saves an audit without a movement');
select is((select count(*) from public.textbook_stock_moves where textbook_id=pg_temp.cid(800)),3::bigint,'zero difference adds no adjustment');
select throws_ok($$select pg_temp.save_count(3,7,-1)$$,'22023','textbook_count_input_invalid','negative actual count fails');
select throws_ok($$select pg_temp.save_count(3,null,0)$$,'22023','textbook_count_input_invalid','null expected balance fails');

-- Both failures occur after the adjustment insert, so the earlier writes must roll back.
reset role;
create function pg_temp.reject_count_write() returns trigger language plpgsql as $$ begin
  if new.id=pg_temp.cid(3) then raise exception using errcode='23514',message='fixture_count_write_failed'; end if;
  return new;
end $$;
create trigger count_write_failure before insert on public.textbook_stock_counts for each row execute function pg_temp.reject_count_write();
set local role authenticated;
select throws_ok($$select pg_temp.save_count(3,7,4)$$,'23514','fixture_count_write_failed','count failure rolls back the adjustment');
select is((select sum(quantity) from public.textbook_stock_moves where textbook_id=pg_temp.cid(800)),7::bigint,'failed count leaves balance unchanged');
select is((select count(*) from public.textbook_stock_counts where id=pg_temp.cid(3)),0::bigint,'failed count leaves no count row');
select is((select count(*) from public.textbook_stock_count_requests where request_id=pg_temp.cid(3)),0::bigint,'failed count leaves no receipt');
reset role;
create policy count_fixture_deny_receipt on public.textbook_stock_count_requests as restrictive for insert to authenticated with check(false);
set local role authenticated;
select throws_ok($$select pg_temp.save_count(4,7,4)$$,'42501',null,'caller receipt RLS is enforced after count and movement writes');
select is((select count(*) from public.textbook_stock_counts where id=pg_temp.cid(4)),0::bigint,'receipt failure rolls back count');
select is((select sum(quantity) from public.textbook_stock_moves where textbook_id=pg_temp.cid(800)),7::bigint,'receipt failure rolls back movement');
reset role;
drop policy count_fixture_deny_receipt on public.textbook_stock_count_requests;
create function pg_temp.reject_count_move_delete() returns trigger language plpgsql as $$ begin
  if old.id=(select (row->>'id')::uuid from first_move) then raise exception using errcode='23514',message='fixture_move_delete_failed'; end if;
  return old;
end $$;
create trigger count_move_delete_failure before delete on public.textbook_stock_moves for each row execute function pg_temp.reject_count_move_delete();
set local role authenticated;
select throws_ok($$select public.delete_textbook_inventory_history_v1('count',pg_temp.cid(1))$$,'23514','fixture_move_delete_failed','delete failure rolls back both linked records');
select is((select to_jsonb(c) from public.textbook_stock_counts c where id=pg_temp.cid(1)),(select row from first_count),'failed delete preserves original count and link');
select is((select count_id from public.textbook_stock_count_requests where request_id=pg_temp.cid(1)),pg_temp.cid(1),'failed delete preserves receipt link');
reset role;
drop trigger count_move_delete_failure on public.textbook_stock_moves;
create policy count_fixture_deny_move_delete on public.textbook_stock_moves as restrictive for delete to authenticated using(false);
set local role authenticated;
select throws_ok($$select public.delete_textbook_inventory_history_v1('count',pg_temp.cid(1))$$,'42501','textbook_count_forbidden','a silent RLS delete denial fails the entire pair deletion');
select is((select to_jsonb(c) from public.textbook_stock_counts c where id=pg_temp.cid(1)),(select row from first_count),'RLS denial preserves the linked count');
reset role;
drop policy count_fixture_deny_move_delete on public.textbook_stock_moves;
set local role authenticated;
select is(public.delete_textbook_inventory_history_v1('count',pg_temp.cid(1))->>'deleted','true','count deletion succeeds');
select is((select count(*) from public.textbook_stock_counts where id=pg_temp.cid(1)),0::bigint,'count is removed');
select is((select sum(quantity) from public.textbook_stock_moves where textbook_id=pg_temp.cid(800)),10::bigint,'linked adjustment is removed in the same transaction');
select is(public.delete_textbook_inventory_history_v1('count',pg_temp.cid(1))->>'deleted','false','delete retry is harmless');
select throws_ok($$select pg_temp.save_count(1)$$,'23514','textbook_count_request_deleted','late creation replay cannot resurrect a deleted audit');
select is(pg_temp.save_count(5)->>'id',pg_temp.cid(5)::text,'new explicit intent can count again');
select is(public.delete_textbook_inventory_history_v1('move',(select adjustment_move_id from public.textbook_stock_counts where id=pg_temp.cid(5)))->>'deleted','true','selecting the adjustment also removes its linked audit');
select is((select count(*) from public.textbook_stock_counts where id=pg_temp.cid(5)),0::bigint,'deleting adjustment does not leave misleading count history');
select throws_ok($$select pg_temp.save_count(5)$$,'23514','textbook_count_request_deleted','adjustment deletion also tombstones the request');
select is(public.delete_textbook_inventory_history_v1('count',pg_temp.cid(2))->>'deleted','true','zero-difference count can be deleted');

insert into public.textbook_stock_counts(id,textbook_id,expected_quantity,counted_quantity) values(pg_temp.cid(6),pg_temp.cid(800),10,7);
select throws_ok($$select public.delete_textbook_inventory_history_v1('count',pg_temp.cid(6))$$,'23514','textbook_count_history_conflict','legacy unlinked difference requires reconciliation');
select throws_ok($$select public.delete_textbook_inventory_history_v1('unknown',pg_temp.cid(6))$$,'22023','textbook_count_input_invalid','unknown history kind is rejected');
select set_config('request.jwt.claim.sub',pg_temp.cid(902)::text,true);
select is(pg_temp.save_count(7,10,0)->>'counted_quantity','0','staff can count actual zero');
select set_config('request.jwt.claim.sub',pg_temp.cid(901)::text,true);
select throws_ok($$select pg_temp.save_count(7,0,0)$$,'42501','textbook_count_forbidden','a different actor cannot replay another request');
select is(pg_temp.save_count(8,0,2,null)->>'location_id',null::text,'null location retains combined-inventory semantics');
insert into public.textbook_stock_moves(textbook_id,move_type,quantity) values(pg_temp.cid(800),'opening',-4);
select is(pg_temp.save_count(10,-2,1,null)->>'expected_quantity','-2','negative ledger balance can be reconciled with a real physical count');
select is((select sum(quantity) from public.textbook_stock_moves where textbook_id=pg_temp.cid(800)),1::bigint,'negative expected balance adjusts by the correct positive difference');
insert into public.textbook_stock_counts(id,textbook_id,expected_quantity,counted_quantity,adjustment_move_id)
  values(pg_temp.cid(11),pg_temp.cid(800),-2,1,(select adjustment_move_id from public.textbook_stock_counts where id=pg_temp.cid(10)));
select throws_ok($$select public.delete_textbook_inventory_history_v1('count',pg_temp.cid(10))$$,'23514','textbook_count_history_conflict','legacy shared adjustment is never deleted out from under a second count');
select is((select sum(quantity) from public.textbook_stock_moves where textbook_id=pg_temp.cid(800)),1::bigint,'rejected legacy deletion leaves balance intact');

select set_config('request.jwt.claim.sub',pg_temp.cid(903)::text,true);
select throws_ok($$select pg_temp.save_count(9,2,2)$$,'42501','textbook_count_forbidden','teacher cannot count');
select throws_ok($$select public.delete_textbook_inventory_history_v1('count',pg_temp.cid(8))$$,'42501','textbook_count_forbidden','teacher cannot delete');
select set_config('request.jwt.claim.sub',pg_temp.cid(904)::text,true);
select throws_ok($$select pg_temp.save_count(9,2,2)$$,'42501','textbook_count_forbidden','assistant cannot count');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select pg_temp.save_count(9,2,2)$$,'42501','textbook_count_forbidden','missing actor cannot count');
reset role;
select is((select count(*) from dashboard_private.notification_events),(select events from sends_before),'no notification events');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from sends_before),'no notification deliveries');
select * from finish();
rollback;
