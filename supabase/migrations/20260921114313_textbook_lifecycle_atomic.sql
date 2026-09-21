set lock_timeout = '5s';
set statement_timeout = '30s';

-- Fail on historic duplicates; never silently discard inventory history.
-- squawk-ignore require-concurrent-index-creation
create unique index if not exists textbook_stock_moves_purchase_lifecycle_key
  on public.textbook_stock_moves (purchase_order_line_id, move_type)
  where purchase_order_line_id is not null and move_type in ('purchase_receipt', 'return_out');

create or replace function public.update_textbook_purchase_lifecycle_v1(
  p_line_id uuid, p_order_id uuid, p_stage text, p_order jsonb, p_line jsonb
) returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '5s'
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.textbook_purchase_orders%rowtype;
  v_line public.textbook_purchase_order_lines%rowtype;
  v_input public.textbook_purchase_order_lines%rowtype;
  v_status text;
begin
  if v_actor is null or coalesce(public.current_dashboard_role(), '') not in ('admin', 'staff') then
    raise exception using errcode='42501', message='textbook_purchase_forbidden';
  end if;
  if p_stage is null or p_stage not in ('request','order','receive')
    or jsonb_typeof(p_order) is distinct from 'object' or jsonb_typeof(p_line) is distinct from 'object' then
    raise exception using errcode='22023', message='textbook_purchase_input_invalid';
  end if;
  -- All purchase operations lock parent before child, including grouped requests.
  select * into v_order from public.textbook_purchase_orders where id=p_order_id for no key update;
  if not found then raise exception using errcode='P0002', message='textbook_purchase_not_found'; end if;
  select * into v_line from public.textbook_purchase_order_lines where id=p_line_id and purchase_order_id=p_order_id for no key update;
  if not found then raise exception using errcode='P0002', message='textbook_purchase_not_found'; end if;
  if v_order.status in ('returned','cancelled') or exists (
    select 1 from public.textbook_stock_moves where purchase_order_line_id=p_line_id and move_type='return_out'
  ) then raise exception using errcode='23514', message='textbook_purchase_state_conflict'; end if;

  v_input := jsonb_populate_record(null::public.textbook_purchase_order_lines, p_line);
  if v_input.copy_scope is null or v_input.copy_scope not in ('student','teacher')
    or v_input.requested_quantity is null or v_input.requested_quantity < 0
    or v_input.ordered_quantity is null or v_input.ordered_quantity < 0
    or v_input.received_quantity is null or v_input.received_quantity < 0
    or v_input.unit_cost is null or v_input.unit_cost < 0
    or (p_stage='request' and v_input.textbook_id is null and nullif(btrim(v_input.requested_textbook_title),'') is null)
    or (p_stage<>'request' and v_input.textbook_id is null)
    or (p_stage='order' and v_input.ordered_quantity<=0)
    or (p_stage='receive' and (v_input.received_quantity<=0 or nullif(btrim(p_order->>'statement_number'),'') is null)) then
    raise exception using errcode='23514', message='textbook_purchase_input_invalid';
  end if;
  if p_stage='request' then v_input.ordered_quantity:=0; end if;
  if p_stage<>'receive' then v_input.received_quantity:=0; end if;
  if v_input.copy_scope='teacher' then v_input.unit_cost:=0; end if;
  v_status := case when p_stage='request' then 'requested' when p_stage='order' then 'ordered'
    when v_input.ordered_quantity>0 and v_input.received_quantity<v_input.ordered_quantity then 'partially_received' else 'received' end;

  update public.textbook_purchase_orders set
    supplier_id=nullif(p_order->>'supplier_id','')::uuid,
    requested_by=coalesce(p_order->>'requested_by',''),
    order_date=coalesce(nullif(p_order->>'order_date','')::date,current_date),
    ordered_at=case when p_stage in ('order','receive') then coalesce(ordered_at,now()) else null end,
    received_at=case when p_stage='receive' then coalesce(received_at,now()) else null end,
    status=v_status, statement_number=coalesce(p_order->>'statement_number',''), memo=coalesce(p_order->>'memo','')
    where id=p_order_id returning * into v_order;
  if not found then raise exception using errcode='42501', message='textbook_purchase_forbidden'; end if;
  update public.textbook_purchase_order_lines set
    textbook_id=v_input.textbook_id, requested_textbook_title=coalesce(v_input.requested_textbook_title,''),
    class_id=v_input.class_id, location_id=v_input.location_id,
    requested_quantity=v_input.requested_quantity, ordered_quantity=v_input.ordered_quantity,
    received_quantity=v_input.received_quantity, copy_scope=v_input.copy_scope,
    unit_cost=v_input.unit_cost, memo=coalesce(v_input.memo,'')
    where id=p_line_id returning * into v_line;
  if not found then raise exception using errcode='42501', message='textbook_purchase_forbidden'; end if;

  if p_stage='receive' then
    insert into public.textbook_stock_moves
      (textbook_id,location_id,purchase_order_line_id,move_type,quantity,unit_amount,amount,memo,copy_scope,created_by)
    values (v_line.textbook_id,v_line.location_id,v_line.id,'purchase_receipt',v_line.received_quantity,
      v_line.unit_cost,v_line.received_quantity*v_line.unit_cost,v_line.memo,v_line.copy_scope,v_actor)
    on conflict (purchase_order_line_id,move_type) where purchase_order_line_id is not null and move_type in ('purchase_receipt','return_out')
    do update set textbook_id=excluded.textbook_id,location_id=excluded.location_id,
      quantity=excluded.quantity,unit_amount=excluded.unit_amount,amount=excluded.amount,memo=excluded.memo,copy_scope=excluded.copy_scope;
  else
    delete from public.textbook_stock_moves where purchase_order_line_id=p_line_id and move_type='purchase_receipt';
    if exists(select 1 from public.textbook_stock_moves where purchase_order_line_id=p_line_id and move_type='purchase_receipt') then
      raise exception using errcode='42501', message='textbook_purchase_forbidden';
    end if;
  end if;
  return jsonb_build_object('order',to_jsonb(v_order),'line',to_jsonb(v_line));
end $$;

create or replace function public.delete_textbook_purchase_line_v1(p_line_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '5s'
as $$
declare v_order_id uuid; v_locked_order_id uuid; v_deleted uuid;
begin
  if auth.uid() is null or coalesce(public.current_dashboard_role(),'') not in ('admin','staff') then
    raise exception using errcode='42501', message='textbook_purchase_forbidden';
  end if;
  select purchase_order_id into v_order_id from public.textbook_purchase_order_lines where id=p_line_id;
  if v_order_id is null then return jsonb_build_object('purchaseOrderLineId',p_line_id,'purchaseOrderId',null); end if;
  perform 1 from public.textbook_purchase_orders where id=v_order_id for no key update;
  select purchase_order_id into v_locked_order_id from public.textbook_purchase_order_lines where id=p_line_id for update;
  if not found then return jsonb_build_object('purchaseOrderLineId',p_line_id,'purchaseOrderId',v_order_id); end if;
  if v_locked_order_id is distinct from v_order_id then
    raise exception using errcode='23514', message='textbook_purchase_state_conflict';
  end if;
  delete from public.textbook_stock_moves where purchase_order_line_id=p_line_id;
  if exists(select 1 from public.textbook_stock_moves where purchase_order_line_id=p_line_id) then
    raise exception using errcode='42501', message='textbook_purchase_forbidden';
  end if;
  delete from public.textbook_purchase_order_lines where id=p_line_id returning id into v_deleted;
  if v_deleted is null then raise exception using errcode='42501', message='textbook_purchase_forbidden'; end if;
  if not exists(select 1 from public.textbook_purchase_order_lines where purchase_order_id=v_order_id) then
    delete from public.textbook_purchase_orders where id=v_order_id;
    if exists(select 1 from public.textbook_purchase_orders where id=v_order_id) then
      raise exception using errcode='42501', message='textbook_purchase_forbidden';
    end if;
  end if;
  return jsonb_build_object('purchaseOrderLineId',p_line_id,'purchaseOrderId',v_order_id);
end $$;

create or replace function public.return_textbook_purchase_line_v1(p_line_id uuid, p_memo text default '')
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '5s'
as $$
declare
  v_order_id uuid; v_order public.textbook_purchase_orders%rowtype;
  v_line public.textbook_purchase_order_lines%rowtype;
  v_receipt public.textbook_stock_moves%rowtype; v_return public.textbook_stock_moves%rowtype;
begin
  if auth.uid() is null or coalesce(public.current_dashboard_role(),'') not in ('admin','staff') then
    raise exception using errcode='42501', message='textbook_purchase_forbidden';
  end if;
  select purchase_order_id into v_order_id from public.textbook_purchase_order_lines where id=p_line_id;
  if not found then raise exception using errcode='P0002', message='textbook_purchase_not_found'; end if;
  select * into v_order from public.textbook_purchase_orders where id=v_order_id for no key update;
  select * into v_line from public.textbook_purchase_order_lines where id=p_line_id and purchase_order_id=v_order_id for no key update;
  if not found then raise exception using errcode='P0002', message='textbook_purchase_not_found'; end if;
  if v_line.textbook_id is null or v_line.received_quantity<=0 then
    return public.delete_textbook_purchase_line_v1(p_line_id);
  end if;
  select * into v_receipt from public.textbook_stock_moves where purchase_order_line_id=p_line_id and move_type='purchase_receipt' for update;
  select * into v_return from public.textbook_stock_moves where purchase_order_line_id=p_line_id and move_type='return_out' for update;
  if v_receipt.id is null or v_receipt.quantity<=0 then
    raise exception using errcode='23514', message='textbook_purchase_stock_conflict';
  end if;
  if v_return.id is not null then
    if row(v_return.textbook_id,v_return.location_id,v_return.copy_scope,v_return.quantity,v_return.unit_amount,v_return.amount)
      is distinct from row(v_receipt.textbook_id,v_receipt.location_id,v_receipt.copy_scope,-v_receipt.quantity,v_receipt.unit_amount,-v_receipt.amount) then
      raise exception using errcode='23514', message='textbook_purchase_stock_conflict';
    end if;
  else
    insert into public.textbook_stock_moves
      (textbook_id,location_id,purchase_order_line_id,move_type,quantity,unit_amount,amount,memo,copy_scope,created_by)
    values(v_receipt.textbook_id,v_receipt.location_id,p_line_id,'return_out',-v_receipt.quantity,
      v_receipt.unit_amount,-v_receipt.amount,coalesce(nullif(p_memo,''),'공급처 반품'),v_receipt.copy_scope,auth.uid());
  end if;
  if v_order.status is distinct from 'returned' then
    update public.textbook_purchase_orders set status='returned',memo=coalesce(nullif(p_memo,''),'공급처 반품') where id=v_order_id;
    if not found then raise exception using errcode='42501', message='textbook_purchase_forbidden'; end if;
  end if;
  return jsonb_build_object('purchaseOrderLineId',p_line_id,'purchaseOrderId',v_order_id);
end $$;

create or replace function public.delete_textbook_sale_line_v1(p_line_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '5s'
as $$
declare v_sale_id uuid; v_locked_sale_id uuid; v_deleted uuid;
begin
  if auth.uid() is null or coalesce(public.current_dashboard_role(),'') not in ('admin','staff') then
    raise exception using errcode='42501', message='textbook_sale_forbidden';
  end if;
  select sale_id into v_sale_id from public.textbook_sale_lines where id=p_line_id;
  if v_sale_id is null then return jsonb_build_object('saleLineId',p_line_id,'saleId',null); end if;
  perform 1 from public.textbook_sales where id=v_sale_id for no key update;
  select sale_id into v_locked_sale_id from public.textbook_sale_lines where id=p_line_id for update;
  if not found then return jsonb_build_object('saleLineId',p_line_id,'saleId',v_sale_id); end if;
  if v_locked_sale_id is distinct from v_sale_id then
    raise exception using errcode='23514', message='textbook_sale_state_conflict';
  end if;
  delete from public.textbook_stock_moves where sale_line_id=p_line_id;
  if exists(select 1 from public.textbook_stock_moves where sale_line_id=p_line_id) then
    raise exception using errcode='42501', message='textbook_sale_forbidden';
  end if;
  delete from public.textbook_sale_lines where id=p_line_id returning id into v_deleted;
  if v_deleted is null then raise exception using errcode='42501', message='textbook_sale_forbidden'; end if;
  if not exists(select 1 from public.textbook_sale_lines where sale_id=v_sale_id) then
    delete from public.textbook_sales where id=v_sale_id;
    if exists(select 1 from public.textbook_sales where id=v_sale_id) then
      raise exception using errcode='42501', message='textbook_sale_forbidden';
    end if;
  end if;
  return jsonb_build_object('saleLineId',p_line_id,'saleId',v_sale_id);
end $$;

revoke all on function public.update_textbook_purchase_lifecycle_v1(uuid,uuid,text,jsonb,jsonb) from public,anon;
revoke all on function public.delete_textbook_purchase_line_v1(uuid) from public,anon;
revoke all on function public.return_textbook_purchase_line_v1(uuid,text) from public,anon;
revoke all on function public.delete_textbook_sale_line_v1(uuid) from public,anon;
grant execute on function public.update_textbook_purchase_lifecycle_v1(uuid,uuid,text,jsonb,jsonb) to authenticated;
grant execute on function public.delete_textbook_purchase_line_v1(uuid) to authenticated;
grant execute on function public.return_textbook_purchase_line_v1(uuid,text) to authenticated;
grant execute on function public.delete_textbook_sale_line_v1(uuid) to authenticated;
notify pgrst, 'reload schema';
