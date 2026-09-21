set lock_timeout = '5s';
set statement_timeout = '30s';

-- The unique lifecycle index keeps the return join at one row per purchase line.
-- Preserve the read contracts and caller RLS while separating terminal members.
create or replace function dashboard_private.textbook_workflow_purchase_source_v1(p_mode text)
returns table(line_id uuid,book_id uuid,class_id uuid,location_id uuid,status text,scope text,base_key text,created_at timestamptz,event_at text,event_time timestamptz,recent_at timestamptz,requested integer,ordered integer,received integer,search_values text[])
language plpgsql stable security invoker set search_path='' as $$ begin
  perform dashboard_private.textbook_workflow_guard_v1(p_mode);
  return query with source as (
    select l.id,l.class_id,l.location_id,l.copy_scope,l.created_at,l.requested_quantity,l.ordered_quantity,l.received_quantity,
      case when return_move.id is not null then 'returned' else coalesce(o.status,'requested') end effective_status,b.id book_id,
      dashboard_private.textbook_trim_v1(coalesce(nullif(b.title,''),b.name,nullif(l.requested_textbook_title,''),l.textbook_id::text,'-')) title,
      l.requested_textbook_title,o.requested_by,o.supplier_id,o.order_date,o.statement_number,
      coalesce(nullif(l.memo,''),o.memo,'') memo,coalesce(return_move.moved_at,o.received_at,o.updated_at,o.created_at) recent_at,
      case when return_move.id is not null then coalesce(to_jsonb(o.created_at)#>>'{}',to_jsonb(l.created_at)#>>'{}','')
       when o.status in ('received','partially_received') then coalesce(to_jsonb(o.received_at)#>>'{}',to_jsonb(o.updated_at)#>>'{}',to_jsonb(l.updated_at)#>>'{}','')
       when o.status='ordered' then coalesce(to_jsonb(o.ordered_at)#>>'{}',o.order_date::text,to_jsonb(o.updated_at)#>>'{}',to_jsonb(l.updated_at)#>>'{}','')
       else coalesce(to_jsonb(o.created_at)#>>'{}',to_jsonb(l.created_at)#>>'{}','') end event_at,
      dashboard_private.textbook_trim_v1(coalesce(nullif(c.name,''),c.id::text,'')) class_name,dashboard_private.textbook_trim_v1(coalesce(nullif(loc.name,''),nullif(loc.code,''),l.location_id::text,'')) location_name,
      dashboard_private.textbook_workflow_supplier_v1(b.id,o.supplier_id,p_mode) configured_supplier
    from public.textbook_purchase_order_lines l left join public.textbook_purchase_orders o on o.id=l.purchase_order_id
    left join public.textbook_stock_moves return_move on return_move.purchase_order_line_id=l.id and return_move.move_type='return_out'
    left join public.textbooks b on b.id=dashboard_private.textbook_workflow_book_id_v1(coalesce(l.textbook_id::text,nullif(dashboard_private.textbook_trim_v1(l.requested_textbook_title),'')))
    left join public.classes c on c.id=l.class_id left join public.textbook_inventory_locations loc on loc.id=l.location_id
    where (p_mode<>'request' or (coalesce(o.status,'requested')='requested' and return_move.id is null)) and (b.id is null or lower(dashboard_private.textbook_trim_v1(b.status)) not in ('inactive','미사용'))
  ) select s.id,s.book_id,s.class_id,s.location_id,s.effective_status,s.copy_scope,
    array_to_string(array[s.effective_status,coalesce(s.book_id::text,dashboard_private.textbook_workflow_normalize_v1(coalesce(nullif(s.requested_textbook_title,''),s.title))),coalesce(s.class_id::text,''),coalesce(s.location_id::text,''),dashboard_private.textbook_trim_v1(s.requested_by),coalesce(s.supplier_id::text,''),coalesce(s.order_date::text,''),dashboard_private.textbook_trim_v1(s.statement_number)],'||'),
    s.created_at,s.event_at,dashboard_private.textbook_workflow_event_time_v1(s.event_at),s.recent_at,s.requested_quantity,s.ordered_quantity,s.received_quantity,
    array[s.title,s.requested_textbook_title,s.requested_by,s.class_name,
      case when p_mode='order' then dashboard_private.textbook_trim_v1(coalesce(nullif((select p.name from public.textbook_suppliers p where p.id=s.configured_supplier),''),s.configured_supplier::text,'')) else coalesce(s.configured_supplier::text,'') end,
      s.location_name,case s.effective_status when 'requested' then '요청' when 'cancelled' then '취소' when 'returned' then '반품'
       else case when s.received_quantity<=0 then '주문' when s.received_quantity<s.ordered_quantity then '부분 입고' else '입고 완료' end end,s.statement_number,s.memo]
  from source s;
end $$;

create or replace function dashboard_private.textbook_workflow_purchase_project_v1(k jsonb,p_mode text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare members jsonb; primary_line jsonb; book jsonb; class_ref jsonb; location_ref jsonb; publisher_ref jsonb; supplier_ref jsonb; supplier_id uuid; book_id uuid; cost numeric; sale_price numeric; publisher_id uuid; begin
  perform dashboard_private.textbook_workflow_guard_v1(p_mode);
  select jsonb_agg(to_jsonb(l)||jsonb_build_object('order',to_jsonb(o),'status',case when return_move.id is not null then 'returned' else coalesce(o.status,'requested') end) order by a.ord) into members
    from jsonb_array_elements_text(k->'member_ids')with ordinality a(id,ord) join public.textbook_purchase_order_lines l on l.id=a.id::uuid
    left join public.textbook_purchase_orders o on o.id=l.purchase_order_id
    left join public.textbook_stock_moves return_move on return_move.purchase_order_line_id=l.id and return_move.move_type='return_out'
    where p_mode='order' or (coalesce(o.status,'requested')='requested' and return_move.id is null);
  if jsonb_array_length(members) is distinct from jsonb_array_length(k->'member_ids') then raise exception 'textbook_purchase_members_unavailable' using errcode='22023'; end if;
  select value into primary_line from jsonb_array_elements(members) where value->>'id'=k->>'primary_id';
  book_id:=dashboard_private.textbook_workflow_book_id_v1(coalesce(primary_line->>'textbook_id',nullif(primary_line->>'requested_textbook_title','')));
  book:=dashboard_private.textbook_workflow_book_v1(book_id);
  class_ref:=dashboard_private.textbook_workflow_class_v1((primary_line->>'class_id')::uuid); location_ref:=dashboard_private.textbook_workflow_location_v1((primary_line->>'location_id')::uuid);
  publisher_id:=(book->>'publisher_id')::uuid;
  if publisher_id is null and dashboard_private.textbook_trim_v1(book->>'publisher')<>'' then select p.id into publisher_id from public.textbook_publishers p where dashboard_private.textbook_workflow_normalize_v1(p.name)=dashboard_private.textbook_workflow_normalize_v1(book->>'publisher') order by p.id limit 1; end if;
  select jsonb_build_object('id',p.id,'name',p.name) into publisher_ref from public.textbook_publishers p where p.id=publisher_id;
  supplier_id:=dashboard_private.textbook_workflow_supplier_v1(book_id,(primary_line#>>'{order,supplier_id}')::uuid,p_mode);
  if p_mode='order' then select jsonb_build_object('id',s.id,'name',s.name) into supplier_ref from public.textbook_suppliers s where s.id=supplier_id; end if;
  sale_price:=coalesce(nullif((book->>'sale_price')::numeric,0),nullif((book->>'price')::numeric,0),nullif((book->>'list_price')::numeric,0),0);
  cost:=case when primary_line->>'copy_scope'='teacher' then 0 when sale_price<=0 then greatest(0,(primary_line->>'unit_cost')::numeric)
    when dashboard_private.textbook_workflow_business_label_v1(book->>'publisher')='팁스서점' or dashboard_private.textbook_workflow_business_label_v1(coalesce(supplier_ref->>'name',supplier_id::text,''))='팁스서점' then 0 else floor(sale_price*0.9+0.5) end;
  return jsonb_build_object('id',k->>'id','anchorLineId',k->'anchor','memberLineIds',k->'member_ids','lines',members,'line',primary_line||jsonb_build_object('purchaseScopeLines',members),
    'mode',p_mode,'status',k->>'status','eventAt',k->>'event_at','quantities',k->'quantities','references',jsonb_build_object('textbook',book,'class',class_ref,'location',location_ref,'publisher',publisher_ref,'supplier',supplier_ref,'configuredSupplierId',coalesce(supplier_id::text,''),'unitCost',cost));
end $$;

notify pgrst, 'reload schema';
