set lock_timeout = '5s';
set statement_timeout = '30s';

-- Keep the parent active until every remaining line is returned.
create or replace function public.delete_textbook_purchase_line_v1(p_line_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '5s'
as $$
declare v_status text; v_order_id uuid; v_locked_order_id uuid; v_deleted uuid;
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
  else
  select case
    when count(*)=0 then 'returned'
    when bool_and(line.received_quantity>0 and line.received_quantity>=line.ordered_quantity) then 'received'
    when bool_or(line.received_quantity>0) then 'partially_received'
    when bool_or(line.ordered_quantity>0) then 'ordered'
    else 'requested' end into v_status
  from public.textbook_purchase_order_lines line
  where line.purchase_order_id=v_order_id and not exists (
    select 1 from public.textbook_stock_moves move
    where move.purchase_order_line_id=line.id and move.move_type='return_out'
  );
    update public.textbook_purchase_orders set status=v_status where id=v_order_id;
    if not found then raise exception using errcode='42501', message='textbook_purchase_forbidden'; end if;
  end if;
  return jsonb_build_object('purchaseOrderLineId',p_line_id,'purchaseOrderId',v_order_id);
end $$;

create or replace function public.return_textbook_purchase_line_v1(p_line_id uuid, p_memo text default '')
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '5s'
as $$
declare
  v_status text;
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
  select case
    when count(*)=0 then 'returned'
    when bool_and(line.received_quantity>0 and line.received_quantity>=line.ordered_quantity) then 'received'
    when bool_or(line.received_quantity>0) then 'partially_received'
    when bool_or(line.ordered_quantity>0) then 'ordered'
    else 'requested' end into v_status
  from public.textbook_purchase_order_lines line
  where line.purchase_order_id=v_order_id and not exists (
    select 1 from public.textbook_stock_moves move
    where move.purchase_order_line_id=line.id and move.move_type='return_out'
  );
  if v_order.status is distinct from v_status then
    update public.textbook_purchase_orders set status=v_status,
      memo=case when v_status='returned' then coalesce(nullif(p_memo,''),'공급처 반품') else memo end
    where id=v_order_id;
    if not found then raise exception using errcode='42501', message='textbook_purchase_forbidden'; end if;
  end if;
  return jsonb_build_object('purchaseOrderLineId',p_line_id,'purchaseOrderId',v_order_id);
end $$;

notify pgrst, 'reload schema';
