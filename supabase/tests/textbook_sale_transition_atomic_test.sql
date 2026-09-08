begin;
select no_plan();
set local statement_timeout = '30s';
set local lock_timeout = '5s';

create function pg_temp.sid(n integer) returns uuid language sql immutable as $$
  select ('a9100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create temp table send_before as select
  (select count(*) from dashboard_private.notification_events) events,
  (select count(*) from dashboard_private.notification_deliveries) deliveries;

insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
select pg_temp.sid(n), 'authenticated', 'authenticated', 'sale-atomic-' || n || '@example.invalid', '{}', '{}'
from generate_series(901,904) n;
update public.profiles set role = case id when pg_temp.sid(901) then 'admin' when pg_temp.sid(902) then 'staff' when pg_temp.sid(903) then 'teacher' else 'assistant' end
where id in (pg_temp.sid(901),pg_temp.sid(902),pg_temp.sid(903),pg_temp.sid(904));
insert into public.textbook_inventory_locations(id, code, name) values (pg_temp.sid(900), '__sale_atomic__', '출고 검증');
insert into public.textbooks(id, name, title, subject, school_level, grade_level, school_levels, grade_levels, sub_subject)
values (pg_temp.sid(800), '__sale_atomic__', '__sale_atomic__', 'english', 'middle', 'm2', array['middle'], array['m2'], '독해');
insert into public.textbook_sales(id, charge_month) values (pg_temp.sid(700), '2099-09');
insert into public.textbook_sale_lines(id, sale_id, textbook_id, charge_month, quantity, unit_price, location_id, status)
select pg_temp.sid(n), pg_temp.sid(700), pg_temp.sid(800), '2099-09', 2, 12000.5, pg_temp.sid(900),
  case n when 4 then 'cancelled' when 5 then 'issued' when 6 then 'excluded' else 'charged' end
from generate_series(1,10) n;
update public.textbook_sale_lines set copy_scope='teacher', teacher_name='검증 선생님', unit_price=0 where id=pg_temp.sid(2);
update public.textbook_sale_lines set quantity=0 where id=pg_temp.sid(9);

select has_function('public','transition_textbook_sale_line_v1',array['uuid','text'],'atomic sale transition exists');
select ok(not p.prosecdef, 'transition preserves caller RLS') from pg_proc p where p.oid='public.transition_textbook_sale_line_v1(uuid,text)'::regprocedure;
select ok(not has_function_privilege('anon','public.transition_textbook_sale_line_v1(uuid,text)','EXECUTE'),'anonymous execution revoked');
select ok(not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid='public.transition_textbook_sale_line_v1(uuid,text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC execution revoked');
select ok(has_function_privilege('authenticated','public.transition_textbook_sale_line_v1(uuid,text)','EXECUTE'),'authenticated role can call the guarded function');

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.sid(901)::text, true);
select is(public.transition_textbook_sale_line_v1(pg_temp.sid(1),'issued')->>'status','issued','admin can issue');
select is((select sum(quantity) from public.textbook_stock_moves where sale_line_id=pg_temp.sid(1)),-2::bigint,'short stock remains allowed and is deducted once');
select is((select amount from public.textbook_stock_moves where sale_line_id=pg_temp.sid(1)),-24001::numeric,'decimal sale amount preserved');
select is((select created_by from public.textbook_stock_moves where sale_line_id=pg_temp.sid(1)),pg_temp.sid(901),'actor comes from authenticated session');
create temp table first_issue as select to_jsonb(m) row from public.textbook_stock_moves m where sale_line_id=pg_temp.sid(1);
create temp table first_line as select to_jsonb(l) row from public.textbook_sale_lines l where id=pg_temp.sid(1);
select is(public.transition_textbook_sale_line_v1(pg_temp.sid(1),'issued'),(select row from first_line),'replay returns unchanged authoritative line');
select is((select to_jsonb(m) from public.textbook_stock_moves m where sale_line_id=pg_temp.sid(1)),(select row from first_issue),'replay preserves movement ID, time and actor');
select is((select count(*) from public.textbook_stock_moves where sale_line_id=pg_temp.sid(1)),1::bigint,'issue replay creates no extra movement');

select set_config('request.jwt.claim.sub', pg_temp.sid(902)::text, true);
select is(public.transition_textbook_sale_line_v1(pg_temp.sid(2),'issued')->>'copy_scope','teacher','staff can issue teacher copies');
select is((select copy_scope from public.textbook_stock_moves where sale_line_id=pg_temp.sid(2)),'teacher','teacher stock stays separate');
select is((select amount from public.textbook_stock_moves where sale_line_id=pg_temp.sid(2)),0::numeric,'teacher copy retains zero price');
select is((select memo from public.textbook_stock_moves where sale_line_id=pg_temp.sid(2)),'검증 선생님','teacher recipient retained');
select is(public.transition_textbook_sale_line_v1(pg_temp.sid(6),'issued')->>'status','issued','legacy excluded rows retain their existing issue action');

-- A later line edit must not return more inventory or a different value than was issued.
update public.textbook_sale_lines set quantity=7, unit_price=1, location_id=null where id=pg_temp.sid(1);
select is(public.transition_textbook_sale_line_v1(pg_temp.sid(1),'returned')->>'status','returned','issued line can be returned');
select is((select sum(quantity) from public.textbook_stock_moves where sale_line_id=pg_temp.sid(1)),0::bigint,'return reverses the original issued quantity');
select is((select sum(amount) from public.textbook_stock_moves where sale_line_id=pg_temp.sid(1)),0::numeric,'return reverses the original issued amount');
select is((select location_id from public.textbook_stock_moves where sale_line_id=pg_temp.sid(1) and move_type='return_in'),pg_temp.sid(900),'return goes to original stock location');
select is(public.transition_textbook_sale_line_v1(pg_temp.sid(1),'returned')->>'status','returned','return replay succeeds');
select is((select count(*) from public.textbook_stock_moves where sale_line_id=pg_temp.sid(1)),2::bigint,'return replay does not add inventory twice');
select throws_ok($$select public.transition_textbook_sale_line_v1(pg_temp.sid(1),'issued')$$,'23514','textbook_sale_state_conflict','stale issue cannot revive a returned line');
select throws_ok($$select public.transition_textbook_sale_line_v1(pg_temp.sid(3),'returned')$$,'23514','textbook_sale_state_conflict','pending line cannot create a return without an issue');
select throws_ok($$select public.transition_textbook_sale_line_v1(pg_temp.sid(4),'issued')$$,'23514','textbook_sale_state_conflict','cancelled line cannot be issued');
select throws_ok($$select public.transition_textbook_sale_line_v1(pg_temp.sid(5),'returned')$$,'23514','textbook_sale_stock_conflict','missing legacy issue requires reconciliation');
select throws_ok($$select public.transition_textbook_sale_line_v1(pg_temp.sid(9),'issued')$$,'23514','textbook_sale_quantity_invalid','invalid quantity is not silently converted to one');
select throws_ok($$select public.transition_textbook_sale_line_v1(pg_temp.sid(3),'paid')$$,'22023','textbook_sale_target_invalid','unsupported target uses exact non-retryable SQLSTATE');
select throws_ok($$select public.transition_textbook_sale_line_v1(pg_temp.sid(999),'issued')$$,'P0002','textbook_sale_not_found','deleted line reports missing');

-- A legacy partial write can be completed without replacing its historical movement.
insert into public.textbook_stock_moves(id,textbook_id,location_id,sale_line_id,move_type,quantity,unit_amount,amount,created_by,moved_at)
values(pg_temp.sid(101),pg_temp.sid(800),pg_temp.sid(900),pg_temp.sid(7),'sale_issue',-2,12000.5,-24001,pg_temp.sid(901),'2026-01-01T00:00:00Z');
select is(public.transition_textbook_sale_line_v1(pg_temp.sid(7),'issued')->>'status','issued','matching partial legacy issue is adopted');
select is((select moved_at from public.textbook_stock_moves where id=pg_temp.sid(101)),'2026-01-01T00:00:00Z'::timestamptz,'adoption preserves issue time');
select throws_ok($$insert into public.textbook_stock_moves(textbook_id,sale_line_id,move_type,quantity) values(pg_temp.sid(800),pg_temp.sid(7),'sale_issue',-2)$$,'23505',null,'unique guard also rejects duplicates from legacy direct writes');
insert into public.textbook_stock_moves(textbook_id,location_id,sale_line_id,move_type,quantity,unit_amount,amount)
values(pg_temp.sid(800),pg_temp.sid(900),pg_temp.sid(8),'sale_issue',-9,12000.5,-108004.5);
select throws_ok($$select public.transition_textbook_sale_line_v1(pg_temp.sid(8),'issued')$$,'23514','textbook_sale_stock_conflict','inconsistent legacy issue is not overwritten');

reset role;
create function pg_temp.reject_sale_update() returns trigger language plpgsql as $$
begin
  if new.id=pg_temp.sid(10) then raise exception using errcode='23514', message='fixture_line_write_failed'; end if;
  return new;
end $$;
create trigger sale_update_failure before update on public.textbook_sale_lines for each row execute function pg_temp.reject_sale_update();
set local role authenticated;
select throws_ok($$select public.transition_textbook_sale_line_v1(pg_temp.sid(10),'issued')$$,'23514','fixture_line_write_failed','failure after movement insert rolls back the transaction');
select is((select count(*) from public.textbook_stock_moves where sale_line_id=pg_temp.sid(10)),0::bigint,'failed status update leaves no stock movement');
select is((select status from public.textbook_sale_lines where id=pg_temp.sid(10)),'charged','failed status update leaves prior status');

reset role;
create policy sale_fixture_deny_insert on public.textbook_stock_moves as restrictive for insert to authenticated with check (false);
set local role authenticated;
select throws_ok($$select public.transition_textbook_sale_line_v1(pg_temp.sid(3),'issued')$$,'42501',null,'caller RLS is enforced inside the transaction');
select is((select status from public.textbook_sale_lines where id=pg_temp.sid(3)),'charged','RLS rejection cannot advance the sale state');
select is((select count(*) from public.textbook_stock_moves where sale_line_id=pg_temp.sid(3)),0::bigint,'RLS rejection leaves no stock movement');
reset role;
drop policy sale_fixture_deny_insert on public.textbook_stock_moves;
set local role authenticated;

select set_config('request.jwt.claim.sub', pg_temp.sid(903)::text, true);
select throws_ok($$select public.transition_textbook_sale_line_v1(pg_temp.sid(3),'issued')$$,'42501','textbook_sale_forbidden','teacher is denied');
select set_config('request.jwt.claim.sub', pg_temp.sid(904)::text, true);
select throws_ok($$select public.transition_textbook_sale_line_v1(pg_temp.sid(3),'issued')$$,'42501','textbook_sale_forbidden','assistant is denied');
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select public.transition_textbook_sale_line_v1(pg_temp.sid(3),'issued')$$,'42501','textbook_sale_forbidden','missing actor is denied');
reset role;
select is((select count(*) from dashboard_private.notification_events),(select events from send_before),'no notification events');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from send_before),'no notification deliveries');
select * from finish();
rollback;
