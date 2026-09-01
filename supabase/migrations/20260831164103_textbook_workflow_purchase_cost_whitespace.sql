-- Pricing labels follow textbook-ledger.js normalizeBusinessLabel, not alias NFKC.
-- ECMAScript WhiteSpace + LineTerminator code points, including U+FEFF.
create function dashboard_private.textbook_workflow_business_label_v1(p_value text) returns text
language sql immutable security invoker set search_path='' as $$
  select lower(translate(coalesce(p_value,''),U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF',''))
$$;
revoke all on function dashboard_private.textbook_workflow_business_label_v1(text) from public, anon;
grant execute on function dashboard_private.textbook_workflow_business_label_v1(text) to authenticated;

-- Preserve the existing projection and its ACL/owner; change only both labels.
create or replace function dashboard_private.textbook_workflow_purchase_project_v1(k jsonb,p_mode text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare members jsonb; primary_line jsonb; book jsonb; class_ref jsonb; location_ref jsonb; publisher_ref jsonb; supplier_ref jsonb; supplier_id uuid; book_id uuid; cost numeric; sale_price numeric; publisher_id uuid; begin
  perform dashboard_private.textbook_workflow_guard_v1(p_mode);
  select jsonb_agg(to_jsonb(l)||jsonb_build_object('order',to_jsonb(o),'status',coalesce(o.status,'requested')) order by a.ord) into members
    from jsonb_array_elements_text(k->'member_ids')with ordinality a(id,ord) join public.textbook_purchase_order_lines l on l.id=a.id::uuid
    left join public.textbook_purchase_orders o on o.id=l.purchase_order_id
    where p_mode='order' or coalesce(o.status,'requested')='requested';
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
