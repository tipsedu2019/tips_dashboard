begin;
select no_plan();
set local statement_timeout='30s';
create function pg_temp.sid(n integer) returns uuid language sql immutable as $$
select ('a9500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create temp table send_before as select
 (select count(*) from dashboard_private.notification_events) events,
 (select count(*) from dashboard_private.notification_deliveries) deliveries;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
select pg_temp.sid(n),'authenticated','authenticated','purchase-atomic-'||n||'@example.invalid','{}','{}' from generate_series(901,903) n;
update public.profiles set role=case id when pg_temp.sid(901) then 'admin' when pg_temp.sid(902) then 'staff' else 'teacher' end
where id in (pg_temp.sid(901),pg_temp.sid(902),pg_temp.sid(903));
insert into public.textbooks(id,name,title,subject,school_level,grade_level,school_levels,grade_levels,sub_subject)
values(pg_temp.sid(800),'구매 검증','구매 검증','english','middle','m2',array['middle'],array['m2'],'독해');
insert into public.textbook_purchase_orders(id,status) select pg_temp.sid(n+100),'ordered' from generate_series(1,5) n;
insert into public.textbook_purchase_order_lines(id,purchase_order_id,textbook_id,ordered_quantity,received_quantity)
select pg_temp.sid(n),pg_temp.sid(n+100),pg_temp.sid(800),10,0 from generate_series(1,5) n;
create function pg_temp.receive(n integer) returns jsonb language sql as $$
 select public.update_textbook_purchase_lifecycle_v1(pg_temp.sid(n),pg_temp.sid(n+100),'receive',
 '{"statement_number":"fixture","requested_by":"검증"}',
 jsonb_build_object('textbook_id',pg_temp.sid(800),'requested_quantity',10,'ordered_quantity',10,'received_quantity',10,'unit_cost',1000.5,'copy_scope','student')) $$;
select ok(not prosecdef,'purchase RPC retains caller RLS') from pg_proc where oid='public.update_textbook_purchase_lifecycle_v1(uuid,uuid,text,jsonb,jsonb)'::regprocedure;
select ok(not has_function_privilege('anon',name,'EXECUTE'),'anonymous execution is revoked: '||name)
from unnest(array['public.update_textbook_purchase_lifecycle_v1(uuid,uuid,text,jsonb,jsonb)','public.return_textbook_purchase_line_v1(uuid,text)','public.delete_textbook_purchase_line_v1(uuid)','public.delete_textbook_sale_line_v1(uuid)']) name;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
select is(pg_temp.receive(1)->'order'->>'status','received','receipt commits authoritative status');
select is((select sum(quantity) from public.textbook_stock_moves where purchase_order_line_id=pg_temp.sid(1)),10::bigint,'receipt stock added once');
select is((select amount from public.textbook_stock_moves where purchase_order_line_id=pg_temp.sid(1)),10005::numeric,'decimal price is retained');
select lives_ok($$select pg_temp.receive(1)$$,'receipt replay succeeds');
select is((select count(*) from public.textbook_stock_moves where purchase_order_line_id=pg_temp.sid(1)),1::bigint,'receipt replay has one movement');
select set_config('request.jwt.claim.sub',pg_temp.sid(902)::text,true);
select lives_ok($$select public.return_textbook_purchase_line_v1(pg_temp.sid(1),'반품')$$,'staff can return receipt');
select lives_ok($$select public.return_textbook_purchase_line_v1(pg_temp.sid(1),'반품')$$,'return replay succeeds');
select is((select sum(quantity) from public.textbook_stock_moves where purchase_order_line_id=pg_temp.sid(1)),0::bigint,'return reverses receipt exactly once');
select is((select sum(amount) from public.textbook_stock_moves where purchase_order_line_id=pg_temp.sid(1)),0::numeric,'return reverses actual value');
select throws_ok($$select pg_temp.receive(1)$$,'23514','textbook_purchase_state_conflict','stale receive cannot revive returned purchase');
select throws_ok($$insert into public.textbook_stock_moves(textbook_id,purchase_order_line_id,move_type,quantity) values(pg_temp.sid(800),pg_temp.sid(1),'return_out',-10)$$,'23505',null,'legacy direct writers cannot insert a second return');

reset role;
create function pg_temp.fail_receipt() returns trigger language plpgsql as $$begin
 if new.purchase_order_line_id=pg_temp.sid(2) then raise exception using errcode='23514',message='fixture_receipt_failed'; end if;
 return new; end $$;
create trigger fixture_fail_receipt before insert on public.textbook_stock_moves for each row execute function pg_temp.fail_receipt();
set local role authenticated;
select throws_ok($$select pg_temp.receive(2)$$,'23514','fixture_receipt_failed','late stock failure rejects complete receipt');
select is((select status from public.textbook_purchase_orders where id=pg_temp.sid(102)),'ordered','order write rolled back');
select is((select received_quantity from public.textbook_purchase_order_lines where id=pg_temp.sid(2)),0,'line write rolled back');
select is((select count(*) from public.textbook_stock_moves where purchase_order_line_id=pg_temp.sid(2)),0::bigint,'no partial stock movement');
reset role;
drop trigger fixture_fail_receipt on public.textbook_stock_moves;
set local role authenticated;
select lives_ok($$select pg_temp.receive(2)$$,'same failed receipt can be retried');
select lives_ok($$select public.delete_textbook_purchase_line_v1(pg_temp.sid(2))$$,'delete purchase removes whole aggregate');
select lives_ok($$select public.delete_textbook_purchase_line_v1(pg_temp.sid(2))$$,'purchase delete replay is safe');
select is((select count(*) from public.textbook_stock_moves where purchase_order_line_id=pg_temp.sid(2)),0::bigint,'purchase deletion leaves no movements');

select lives_ok($$select pg_temp.receive(4)$$,'prepare return rollback case');
reset role;
create function pg_temp.fail_return_order() returns trigger language plpgsql as $$begin
 if new.id=pg_temp.sid(104) and new.status='returned' then raise exception using errcode='23514',message='fixture_return_failed'; end if;
 return new; end $$;
create trigger fixture_fail_return before update on public.textbook_purchase_orders for each row execute function pg_temp.fail_return_order();
set local role authenticated;
select throws_ok($$select public.return_textbook_purchase_line_v1(pg_temp.sid(4))$$,'23514','fixture_return_failed','late order failure rolls back return movement');
select is((select sum(quantity) from public.textbook_stock_moves where purchase_order_line_id=pg_temp.sid(4)),10::bigint,'failed return leaves receipt stock intact');
select is((select status from public.textbook_purchase_orders where id=pg_temp.sid(104)),'received','failed return leaves received status');
reset role;
drop trigger fixture_fail_return on public.textbook_purchase_orders;
set local role authenticated;
select lives_ok($$select public.return_textbook_purchase_line_v1(pg_temp.sid(4))$$,'failed return can be retried');

select is(public.update_textbook_purchase_lifecycle_v1(pg_temp.sid(5),pg_temp.sid(105),'receive',
 '{"statement_number":"teacher-copy"}',
 jsonb_build_object('textbook_id',pg_temp.sid(800),'requested_quantity',10,'ordered_quantity',10,'received_quantity',5,'unit_cost',1000.5,'copy_scope','teacher'))->'order'->>'status',
 'partially_received','partial teacher receipt keeps partial status');
select is((select amount from public.textbook_stock_moves where purchase_order_line_id=pg_temp.sid(5)),0::numeric,'teacher copy remains free');
select lives_ok($$select public.return_textbook_purchase_line_v1(pg_temp.sid(5))$$,'teacher copy return succeeds');
select is((select sum(quantity) from public.textbook_stock_moves where purchase_order_line_id=pg_temp.sid(5) and copy_scope='teacher'),0::bigint,'teacher copy return stays in its own inventory scope');

-- A partial group return must not block the still-active sibling.
reset role;
insert into public.textbook_purchase_orders(id,status) values(pg_temp.sid(110),'ordered');
insert into public.textbook_purchase_order_lines(id,purchase_order_id,textbook_id,ordered_quantity)
values(pg_temp.sid(10),pg_temp.sid(110),pg_temp.sid(800),10),
 (pg_temp.sid(11),pg_temp.sid(110),pg_temp.sid(800),10);
set local role authenticated;
select lives_ok($$select pg_temp.receive(10)$$,'receive first grouped line');
select lives_ok($$select public.return_textbook_purchase_line_v1(pg_temp.sid(10))$$,'return only first grouped line');
select is((select status from public.textbook_purchase_orders where id=pg_temp.sid(110)),'ordered','unreceived sibling keeps the order active');
select lives_ok($$select public.update_textbook_purchase_lifecycle_v1(pg_temp.sid(11),pg_temp.sid(110),'receive',
 '{"statement_number":"group-sibling"}',jsonb_build_object('textbook_id',pg_temp.sid(800),'requested_quantity',10,'ordered_quantity',10,'received_quantity',10,'unit_cost',1000.5,'copy_scope','student'))$$,
 'sibling can be received after first return commits');
select lives_ok($$select public.return_textbook_purchase_line_v1(pg_temp.sid(11))$$,'return final grouped line');
select is((select status from public.textbook_purchase_orders where id=pg_temp.sid(110)),'returned','all returned lines close the parent');
select is((select sum(quantity) from public.textbook_stock_moves where purchase_order_line_id in (pg_temp.sid(10),pg_temp.sid(11))),0::bigint,'all grouped receipts and returns balance');
reset role;
insert into public.textbook_purchase_orders(id,status) values(pg_temp.sid(112),'ordered');
insert into public.textbook_purchase_order_lines(id,purchase_order_id,textbook_id,ordered_quantity)
values(pg_temp.sid(12),pg_temp.sid(112),pg_temp.sid(800),10),
 (pg_temp.sid(13),pg_temp.sid(112),pg_temp.sid(800),10);
set local role authenticated;
select lives_ok($$select pg_temp.receive(12)$$,'receive grouped line before sibling deletion');
select lives_ok($$select public.return_textbook_purchase_line_v1(pg_temp.sid(12))$$,'return grouped line before sibling deletion');
select is((select status from public.textbook_purchase_orders where id=pg_temp.sid(112)),'ordered','remaining requested line is still active');
select lives_ok($$select public.delete_textbook_purchase_line_v1(pg_temp.sid(13))$$,'delete the final unreceived sibling');
select is((select status from public.textbook_purchase_orders where id=pg_temp.sid(112)),'returned','deleting the last active sibling closes the returned parent');

reset role;
insert into public.textbook_sales(id,charge_month) values(pg_temp.sid(700),'2099-09');
insert into public.textbook_sale_lines(id,sale_id,textbook_id,charge_month,status) values(pg_temp.sid(600),pg_temp.sid(700),pg_temp.sid(800),'2099-09','issued');
insert into public.textbook_stock_moves(textbook_id,sale_line_id,move_type,quantity) values(pg_temp.sid(800),pg_temp.sid(600),'sale_issue',-1);
create function pg_temp.fail_delete() returns trigger language plpgsql as $$begin raise exception using errcode='23514',message='fixture_delete_failed'; end $$;
create trigger fixture_fail_delete before delete on public.textbook_sale_lines for each row execute function pg_temp.fail_delete();
set local role authenticated;
select throws_ok($$select public.delete_textbook_sale_line_v1(pg_temp.sid(600))$$,'23514','fixture_delete_failed','late sale delete failure rolls back stock deletion');
select is((select sum(quantity) from public.textbook_stock_moves where sale_line_id=pg_temp.sid(600)),-1::bigint,'issue movement remains on failure');
select is((select status from public.textbook_sale_lines where id=pg_temp.sid(600)),'issued','issued line remains on failure');
reset role;
drop trigger fixture_fail_delete on public.textbook_sale_lines;
set local role authenticated;
select lives_ok($$select public.delete_textbook_sale_line_v1(pg_temp.sid(600))$$,'sale delete retry succeeds');
select lives_ok($$select public.delete_textbook_sale_line_v1(pg_temp.sid(600))$$,'sale deletion replay succeeds');
select is((select count(*) from public.textbook_stock_moves where sale_line_id=pg_temp.sid(600)),0::bigint,'sale delete removes movements');

select set_config('request.jwt.claim.sub',pg_temp.sid(903)::text,true);
select throws_ok($$select pg_temp.receive(3)$$,'42501','textbook_purchase_forbidden','teacher cannot receive');
select throws_ok($$select public.return_textbook_purchase_line_v1(pg_temp.sid(1))$$,'42501','textbook_purchase_forbidden','teacher cannot return');
select throws_ok($$select public.delete_textbook_purchase_line_v1(pg_temp.sid(1))$$,'42501','textbook_purchase_forbidden','teacher cannot delete purchase');
select throws_ok($$select public.delete_textbook_sale_line_v1(pg_temp.sid(600))$$,'42501','textbook_sale_forbidden','teacher cannot replay deletion');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select pg_temp.receive(3)$$,'42501','textbook_purchase_forbidden','missing actor rejected');
reset role;
create policy fixture_deny_stock on public.textbook_stock_moves as restrictive for insert to authenticated with check(false);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sid(901)::text,true);
select throws_ok($$select pg_temp.receive(3)$$,'42501',null,'RLS remains enforced inside receipt RPC');
select is((select status from public.textbook_purchase_orders where id=pg_temp.sid(103)),'ordered','RLS failure rolls back order');
reset role;
select is((select count(*) from dashboard_private.notification_events),(select events from send_before),'no notification events');
select is((select count(*) from dashboard_private.notification_deliveries),(select deliveries from send_before),'no notification deliveries');
select * from finish();
rollback;
