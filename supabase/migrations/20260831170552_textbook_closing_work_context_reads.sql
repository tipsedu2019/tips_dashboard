-- Purpose-scoped, stable invoker reads. No writes, policy changes or new authority.
create function dashboard_private.textbook_context_strings_v1(value jsonb,keys text[]) returns void
language plpgsql immutable security invoker set search_path='' as $$ declare actual text[]; begin
  if jsonb_typeof(value)is distinct from 'object' then raise exception 'textbook_context_input_invalid' using errcode='22023'; end if;
  select array_agg(k order by k)into actual from jsonb_object_keys(value)k;
  if actual is distinct from (select array_agg(k order by k)from unnest(keys)k)
    or exists(select 1 from unnest(keys)k where jsonb_typeof(value->k)is distinct from 'string') then raise exception 'textbook_context_input_invalid' using errcode='22023'; end if;
end $$;

create function dashboard_private.textbook_context_references_v1(book_ids uuid[],extra_supplier_ids uuid[],closing boolean) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_read_guard_v1();
  if (select count(distinct id)from unnest(book_ids)id)<>(select count(*)from public.textbooks b where b.id=any(book_ids)) then raise exception 'textbook_context_book_unavailable' using errcode='22023';end if;
  with books as materialized(select b.* from public.textbooks b where b.id=any(book_ids)),
  publisher_ids as materialized(select distinct coalesce(b.publisher_id,(select p.id from public.textbook_publishers p where
    case when closing then dashboard_private.textbook_workflow_business_label_v1(p.name)=dashboard_private.textbook_workflow_business_label_v1(b.publisher)
    else dashboard_private.textbook_workflow_normalize_v1(p.name)=dashboard_private.textbook_workflow_normalize_v1(b.publisher)end
    and dashboard_private.textbook_trim_v1(b.publisher)<>'' order by p.id limit 1)) id from books b),
  links as materialized(select l.* from public.textbook_publisher_supplier_links l where l.publisher_id in(select id from publisher_ids)),
  supplier_ids as(select b.default_supplier_id id from books b union select supplier_id from links union select unnest(extra_supplier_ids))
  select jsonb_build_object(
    'textbooks',coalesce((select jsonb_agg(dashboard_private.textbook_workflow_book_v1(b.id)order by b.id)from books b),'[]'),
    'publishers',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name)order by p.id)from public.textbook_publishers p where p.id in(select id from publisher_ids)),'[]'),
    'suppliers',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'contact',s.contact)order by s.id)from public.textbook_suppliers s where s.id in(select id from supplier_ids)),'[]'),
    'publisherSupplierLinks',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'publisher_id',l.publisher_id,'supplier_id',l.supplier_id,'priority',l.priority,'is_primary',l.is_primary)order by l.id)from links l),'[]'))into result;
  return result;
end $$;

create function dashboard_private.textbook_closing_keys_v1(month text,subject_filter text,selected_ids uuid[] default null)
returns table(id uuid,event_time timestamptz)
language plpgsql stable security invoker set search_path='' as $$ begin
  perform dashboard_private.textbook_read_guard_v1();
  if month is null or subject_filter is null then raise exception 'textbook_closing_scope_invalid' using errcode='22023'; end if;
  return query select m.id,m.moved_at from public.textbook_stock_moves m left join public.textbooks b on b.id=m.textbook_id
    where (selected_ids is null or m.id=any(selected_ids))
      and (dashboard_private.textbook_trim_v1(month)='' or starts_with(to_jsonb(m.moved_at)#>>'{}',dashboard_private.textbook_trim_v1(month)))
      and (dashboard_private.textbook_trim_v1(subject_filter)in('','all') or dashboard_private.textbook_trim_v1(b.subject)=dashboard_private.textbook_trim_v1(subject_filter));
end $$;
create function dashboard_private.textbook_closing_source_v1(month text,subject_filter text,selected_ids uuid[] default null)
returns table(id uuid,event_time timestamptz,book_id uuid,location_id uuid,source jsonb,subject text,publisher text,supplier text,sale_price numeric)
language plpgsql stable security invoker set search_path='' as $$ begin
  perform dashboard_private.textbook_read_guard_v1();
  if month is null or subject_filter is null then raise exception 'textbook_closing_scope_invalid' using errcode='22023'; end if;
  return query select m.id,m.moved_at,m.textbook_id,m.location_id,to_jsonb(m),dashboard_private.textbook_trim_v1(b.subject),
    coalesce(nullif(dashboard_private.textbook_trim_v1(b.publisher),''),dashboard_private.textbook_trim_v1(p.name),''),coalesce(s.name,''),coalesce(nullif(b.sale_price,0),nullif(b.price,0),b.list_price,0)
  from dashboard_private.textbook_closing_keys_v1(month,subject_filter,selected_ids) k join public.textbook_stock_moves m on m.id=k.id left join public.textbooks b on b.id=m.textbook_id
  left join public.textbook_publishers p on p.id=coalesce(b.publisher_id,(select p1.id from public.textbook_publishers p1 where dashboard_private.textbook_workflow_business_label_v1(p1.name)=dashboard_private.textbook_workflow_business_label_v1(b.publisher) and dashboard_private.textbook_trim_v1(b.publisher)<>'' order by p1.id limit 1))
  left join public.textbook_suppliers s on s.id=coalesce(b.default_supplier_id,(select l.supplier_id from public.textbook_publisher_supplier_links l where l.publisher_id=p.id order by l.is_primary desc,l.priority,l.id limit 1))
  ; -- The key helper preserves the legacy serialized prefix, not a substituted timezone range.
end $$;
create function dashboard_private.textbook_closing_cost_v1(price double precision,copy_scope text,publisher text,supplier text) returns double precision
language sql immutable security invoker set search_path='' as $$ select case
  when price<=0 or copy_scope='teacher' or dashboard_private.textbook_workflow_business_label_v1(publisher)='팁스서점' or dashboard_private.textbook_workflow_business_label_v1(supplier)='팁스서점' then 0
  -- Math.round does not add 0.5: that addition can round a just-below-half
  -- binary value upward before floor sees it. Prices here are nonnegative.
  else floor(product)+case when product-floor(product)>=0.5 then 1 else 0 end end from(select price*0.9 product)p $$;
create function dashboard_private.textbook_closing_movement_v1(r jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' set extra_float_digits=3 as $$ declare m jsonb:=r->'source'; typ text:=m->>'move_type'; qty double precision:=(m->>'quantity')::double precision; price double precision; margin double precision:=0; title text; location text; begin
  perform dashboard_private.textbook_read_guard_v1();
  price:=coalesce(nullif(abs((m->>'unit_amount')::double precision),0),(r->>'sale_price')::double precision,0);
  if typ='sale_issue' then margin:=greatest(0,(price-dashboard_private.textbook_closing_cost_v1(price,m->>'copy_scope',r->>'publisher',r->>'supplier'))*abs(qty));end if;
  select dashboard_private.textbook_trim_v1(coalesce(nullif(b.title,''),b.name,''))into title from public.textbooks b where b.id=(r->>'book_id')::uuid;
  select dashboard_private.textbook_trim_v1(coalesce(nullif(l.name,''),l.code,''))into location from public.textbook_inventory_locations l where l.id=(r->>'location_id')::uuid;
  return jsonb_build_object('id',r->'id','at',m->'moved_at','typeLabel',case typ when 'opening' then '기초' when 'purchase_receipt' then '입고' when 'sale_issue' then '출고' when 'return_in' then '반품 입고' when 'return_out' then '반품 출고' when 'transfer_in' then '이동 입고' when 'transfer_out' then '이동 출고' when 'stock_adjustment' then '실사 조정' else typ end,
    'textbookTitle',coalesce(nullif(title,''),'-'),'locationName',coalesce(nullif(location,''),r->>'location_id','-'),'quantity',qty,'amount',m->'amount','marginAmount',margin);
end $$;
-- String(Number) uses fixed decimal in [1e-6,1e21) and unpadded exponents outside.
-- Keep this spelling separate from JSON numeric serialization and money arithmetic.
create function dashboard_private.textbook_context_number_text_v1(value double precision)returns text
language plpgsql immutable security invoker set search_path='' set extra_float_digits=3 as $$ declare rendered text:=value::text;begin
  if value=0 then return '0';end if;
  if abs(value)>=1e-6 and abs(value)<1e21 then return trim_scale(rendered::numeric)::text;end if;
  return regexp_replace(rendered,'e([+-])0+([0-9]+)$','e\1\2');
end $$;
create function dashboard_private.textbook_closing_movement_match_v1(row_value jsonb,search text) returns boolean
language sql immutable security invoker set search_path='' as $$ select strpos(lower(concat_ws(' ',row_value->>'typeLabel',row_value->>'textbookTitle',row_value->>'locationName',
  dashboard_private.textbook_context_number_text_v1((row_value->>'quantity')::double precision),dashboard_private.textbook_context_number_text_v1((row_value->>'amount')::double precision),dashboard_private.textbook_context_number_text_v1((row_value->>'marginAmount')::double precision))),
  lower(regexp_replace(dashboard_private.textbook_trim_v1(search),U&'[\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g')))>0 $$;

create function public.list_textbook_closing_page_v1(p_filters jsonb,p_sort text,p_page integer,p_page_size integer)returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb;begin
  perform dashboard_private.textbook_read_guard_v1();perform dashboard_private.textbook_context_strings_v1(p_filters,array['month','subject','status']);
  perform dashboard_private.textbook_read_page_v1(p_page,p_page_size,p_sort,'month-desc');
  with keys as materialized(select c.id,c.closing_month from public.textbook_monthly_closings c where
    (p_filters->>'month'='all' or c.closing_month=p_filters->>'month') and(p_filters->>'subject'='all' or c.subject=p_filters->>'subject') and(p_filters->>'status'='all' or c.status=p_filters->>'status')),
  page as(select * from keys k order by k.closing_month collate "C" desc,k.id offset(p_page::bigint-1)*p_page_size limit p_page_size)
  select jsonb_build_object('page',p_page,'pageSize',p_page_size,'totalCount',(select count(*)from keys),'rows',coalesce((select jsonb_agg(to_jsonb(c)order by p.closing_month collate "C" desc,p.id)from page p join public.textbook_monthly_closings c on c.id=p.id),'[]'))into result;return result;
end $$;
create function public.list_textbook_closing_movement_page_v1(p_filters jsonb,p_sort text,p_page integer,p_page_size integer)returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb;begin
  perform dashboard_private.textbook_read_guard_v1();perform dashboard_private.textbook_context_strings_v1(p_filters,array['closingMonth','subject','search']);
  perform dashboard_private.textbook_read_page_v1(p_page,p_page_size,p_sort,'event-desc');
  with keys as materialized(select k.* from dashboard_private.textbook_closing_keys_v1(p_filters->>'closingMonth',p_filters->>'subject')k
    where dashboard_private.textbook_trim_v1(p_filters->>'search')='' or exists(select 1 from dashboard_private.textbook_closing_source_v1(p_filters->>'closingMonth',p_filters->>'subject',array[k.id])s
      where dashboard_private.textbook_closing_movement_match_v1(dashboard_private.textbook_closing_movement_v1(to_jsonb(s)),p_filters->>'search'))),
  page as(select * from keys k order by k.event_time desc,k.id offset(p_page::bigint-1)*p_page_size limit p_page_size)
  select jsonb_build_object('page',p_page,'pageSize',p_page_size,'totalCount',(select count(*)from keys),'rows',coalesce((select jsonb_agg(dashboard_private.textbook_closing_movement_v1(to_jsonb(s))order by s.event_time desc,s.id)
    from dashboard_private.textbook_closing_source_v1(p_filters->>'closingMonth',p_filters->>'subject',coalesce((select array_agg(id)from page),'{}'))s),'[]'))into result;return result;
end $$;
create function public.get_textbook_closing_preview_v1(p_input jsonb)returns jsonb
language plpgsql stable security invoker set search_path='' set extra_float_digits=3 as $$ declare result jsonb;keys text[];oq double precision;oa double precision;begin
  perform dashboard_private.textbook_read_guard_v1();
  if jsonb_typeof(p_input)is distinct from 'object' then raise exception 'textbook_closing_input_invalid' using errcode='22023';end if;
  select array_agg(k order by k)into keys from jsonb_object_keys(p_input)k;
  if keys is distinct from array['closingMonth','openingAmount','openingQuantity','subject'] or jsonb_typeof(p_input->'closingMonth')is distinct from 'string' or jsonb_typeof(p_input->'subject')is distinct from 'string'
    or jsonb_typeof(p_input->'openingQuantity')is distinct from 'number' or jsonb_typeof(p_input->'openingAmount')is distinct from 'number' then raise exception 'textbook_closing_input_invalid' using errcode='22023';end if;
  begin oq:=(p_input->>'openingQuantity')::double precision;oa:=(p_input->>'openingAmount')::double precision;
    exception when numeric_value_out_of_range then raise exception 'textbook_closing_input_invalid'using errcode='22023';end;
  if oq in('Infinity'::double precision,'-Infinity'::double precision,'NaN'::double precision)or oa in('Infinity'::double precision,'-Infinity'::double precision,'NaN'::double precision)then raise exception 'textbook_closing_input_invalid'using errcode='22023';end if;
  with source as materialized(select s.*,s.source->>'move_type' typ,(s.source->>'quantity')::double precision qty,
    coalesce(nullif((s.source->>'amount')::double precision,0),(s.source->>'unit_amount')::double precision*(s.source->>'quantity')::double precision) amount
    from dashboard_private.textbook_closing_source_v1(p_input->>'closingMonth',p_input->>'subject')s),
  totals as(select count(*)count,coalesce(sum(qty order by event_time desc,id)filter(where typ in('opening','purchase_receipt','return_in','transfer_in')),0)pq,
    coalesce(sum(amount order by event_time desc,id)filter(where typ in('opening','purchase_receipt','return_in','transfer_in')),0)pa,
    abs(coalesce(sum(qty order by event_time desc,id)filter(where typ in('sale_issue','return_out','transfer_out')),0))sq,abs(coalesce(sum(amount order by event_time desc,id)filter(where typ in('sale_issue','return_out','transfer_out')),0))sa,
    coalesce(sum(qty order by event_time desc,id)filter(where typ='stock_adjustment'),0)aq,coalesce(sum(amount order by event_time desc,id)filter(where typ='stock_adjustment'),0)aa from source),
  sale as(select s.*,coalesce(nullif(abs((s.source->>'unit_amount')::double precision),0),case when abs(s.qty)>0 then nullif(abs(s.amount),0)/abs(s.qty)end,s.sale_price::double precision)price from source s where s.typ='sale_issue' and s.qty<>0),
  margin as(select s.*,dashboard_private.textbook_closing_cost_v1(s.price,s.source->>'copy_scope',s.publisher,s.supplier)cost from sale s),
  teams as(select team,ord,coalesce(sum(abs(s.qty)order by s.event_time desc,s.id),0)qty,coalesce(sum(s.price*abs(s.qty)order by s.event_time desc,s.id),0)amount,coalesce(sum(s.cost*abs(s.qty)order by s.event_time desc,s.id),0)cost,
    coalesce(sum(greatest(0,s.price*abs(s.qty)-s.cost*abs(s.qty))order by s.event_time desc,s.id),0)margin from unnest(array['english','math','science','other'])with ordinality t(team,ord)
    left join margin s on case when s.subject in('english','math','science')then s.subject else 'other'end=t.team group by team,ord),
  team_result as(select sum(margin order by ord)margin,jsonb_agg(jsonb_build_object('team',team,'saleQuantity',qty,'saleAmount',amount,'purchaseCostAmount',cost,'marginAmount',margin)order by ord)rows from teams)
  select jsonb_build_object('closingMonth',dashboard_private.textbook_trim_v1(p_input->>'closingMonth'),'subject',dashboard_private.textbook_trim_v1(p_input->>'subject'),'sourceLineCount',t.count,
    'closing',jsonb_build_object('openingQuantity',oq,'openingAmount',oa,'purchaseQuantity',t.pq,'purchaseAmount',t.pa,'saleQuantity',t.sq,'saleAmount',t.sa,'adjustmentQuantity',t.aq,'adjustmentAmount',t.aa,
      'endingQuantity',oq+t.pq-t.sq+t.aq,'endingAmount',oa+t.pa-t.sa+t.aa,'receivedAmount',0,'supplierPaymentAmount',0,'paymentDifference',0,'textbookMarginAmount',g.margin,'teamMargins',g.rows,'settlementDifference',g.margin,'needsReview',oq+t.pq-t.sq+t.aq<0))into result from totals t cross join team_result g;return result;
end $$;
create function public.get_textbook_closing_detail_v1(p_id uuid)returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare r public.textbook_monthly_closings;begin
  perform dashboard_private.textbook_read_guard_v1();if p_id is null then raise exception 'textbook_closing_id_invalid' using errcode='22023';end if;
  select * into r from public.textbook_monthly_closings c where c.id=p_id;
  if not found then return jsonb_build_object('row',null,'preview',null);end if;
  return jsonb_build_object('row',to_jsonb(r),'preview',public.get_textbook_closing_preview_v1(jsonb_build_object('closingMonth',dashboard_private.textbook_trim_v1(r.closing_month),'subject',coalesce(nullif(dashboard_private.textbook_trim_v1(r.subject),''),'all'),'openingQuantity',r.opening_quantity,'openingAmount',r.opening_amount)));
end $$;
create function public.get_textbook_closing_save_context_v1(p_closing_month text,p_subject text)returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb;begin
  perform dashboard_private.textbook_read_guard_v1();
  with source as materialized(select * from dashboard_private.textbook_closing_source_v1(p_closing_month,p_subject)),
  refs as(select dashboard_private.textbook_context_references_v1(coalesce(array_agg(distinct book_id),'{}'),array[]::uuid[],true)r from source)
  select jsonb_build_object('closingMonth',dashboard_private.textbook_trim_v1(p_closing_month),'subject',dashboard_private.textbook_trim_v1(p_subject),'sourceLineCount',(select count(*)from source),
    'sourceLineIds',coalesce((select jsonb_agg(id order by event_time desc,id)from source),'[]'),'stockMoves',coalesce((select jsonb_agg(source order by event_time desc,id)from source),'[]'),'complete',true)||refs.r into result from refs;return result;
end $$;
create function public.get_textbook_closing_movement_export_v1(p_filters jsonb)returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb;begin
  perform dashboard_private.textbook_read_guard_v1();perform dashboard_private.textbook_context_strings_v1(p_filters,array['closingMonth','subject','search']);
  with source as materialized(select s.id,s.event_time,dashboard_private.textbook_closing_movement_v1(to_jsonb(s))row_value from dashboard_private.textbook_closing_source_v1(p_filters->>'closingMonth',p_filters->>'subject')s),
  eligible as(select * from source s where dashboard_private.textbook_closing_movement_match_v1(s.row_value,p_filters->>'search'))
  select jsonb_build_object('sourceLineCount',count(*),'sourceLineIds',coalesce(jsonb_agg(id order by event_time desc,id),'[]'),'rows',coalesce(jsonb_agg(row_value order by event_time desc,id),'[]'),'complete',true)into result from eligible;return result;
end $$;

create function public.get_textbook_purchase_handoff_context_v1(p_filters jsonb,p_kind text)returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb;begin
  perform dashboard_private.textbook_read_guard_v1();perform dashboard_private.textbook_workflow_filters_v1(p_filters,'purchase');
  if p_kind is null or p_kind not in('order','return')then raise exception 'textbook_handoff_kind_invalid'using errcode='22023';end if;
  with source as materialized(select s.* from dashboard_private.textbook_workflow_purchase_source_v1(p_filters->>'mode')s where dashboard_private.textbook_workflow_purchase_match_v1(to_jsonb(s),p_filters)
    and case p_kind when 'order' then s.status in('ordered','partially_received')and s.ordered>0 else s.status in('received','partially_received')and s.received>0 end),
  lines as materialized(select s.*,to_jsonb(l)||jsonb_build_object('status',s.status,'order',to_jsonb(o))line,o.supplier_id from source s join public.textbook_purchase_order_lines l on l.id=s.line_id left join public.textbook_purchase_orders o on o.id=l.purchase_order_id),
  refs as(select dashboard_private.textbook_context_references_v1(coalesce(array_agg(distinct book_id)filter(where book_id is not null),'{}'),coalesce(array_agg(distinct supplier_id)filter(where supplier_id is not null),'{}'),false)r from lines)
  select jsonb_build_object('kind',p_kind,'sourceLineCount',(select count(*)from lines),'sourceLineIds',coalesce((select jsonb_agg(line_id order by created_at asc nulls last,line_id)from lines),'[]'),
    'resolvedTextbookIds',coalesce((select jsonb_agg(book_id order by created_at asc nulls last,line_id)from lines),'[]'),
    'lines',coalesce((select jsonb_agg(line order by created_at asc nulls last,line_id)from lines),'[]'),
    'classes',coalesce((select jsonb_agg(dashboard_private.textbook_workflow_class_v1(c.id)order by c.id)from public.classes c where c.id in(select class_id from lines)),'[]'),
    'locations',coalesce((select jsonb_agg(dashboard_private.textbook_workflow_location_v1(l.id)order by l.id)from public.textbook_inventory_locations l where l.id in(select location_id from lines)),'[]'),'complete',true)||refs.r into result from refs;return result;
end $$;
create function public.get_textbook_billing_handoff_context_v1(p_filters jsonb)returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb;begin
  perform dashboard_private.textbook_read_guard_v1();perform dashboard_private.textbook_workflow_filters_v1(p_filters,'sale');
  with source as materialized(select s.* from dashboard_private.textbook_workflow_sale_source_v1()s join public.textbook_sale_lines l on l.id=s.line_id where dashboard_private.textbook_workflow_sale_match_v1(to_jsonb(s),p_filters)and l.copy_scope<>'teacher'and s.raw_status not in('cancelled','returned','excluded')),
  lines as materialized(select l.* from public.textbook_sale_lines l where l.id in(select line_id from source))
  select jsonb_build_object('sourceLineCount',(select count(*)from source),'sourceLineIds',coalesce((select jsonb_agg(line_id order by event_time desc nulls last,line_id)from source),'[]'),
    'lines',coalesce((select jsonb_agg(to_jsonb(l)order by s.event_time desc nulls last,s.line_id)from source s join lines l on l.id=s.line_id),'[]'),
    'sales',coalesce((select jsonb_agg(to_jsonb(s)order by s.id)from public.textbook_sales s where s.id in(select sale_id from lines)),'[]'),
    'textbooks',coalesce((select jsonb_agg(dashboard_private.textbook_workflow_book_v1(b.id)order by b.id)from public.textbooks b where b.id in(select book_id from source)),'[]'),
    'classes',coalesce((select jsonb_agg(dashboard_private.textbook_workflow_class_v1(c.id)order by c.id)from public.classes c where c.id in(select class_id from source)),'[]'),
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'grade',s.grade)order by s.id)from public.students s where s.id in(select student_id from source)),'[]'),'complete',true)into result;return result;
end $$;
-- Unlike the prior count-only helper, a complete roster must retain String(Number)
-- spelling recursively, including numeric values inside legacy nested arrays.
create function dashboard_private.textbook_context_json_text_v1(value jsonb)returns text
language plpgsql immutable security invoker set search_path='' as $$ declare result text;number_value double precision;begin
  if value is null or value='null'::jsonb then return '';end if;
  if jsonb_typeof(value)='number'then
    begin number_value:=(value#>>'{}')::double precision;
      exception when numeric_value_out_of_range then return case when abs((value#>>'{}')::numeric)<1 then '0'when (value#>>'{}')::numeric<0 then '-Infinity'else 'Infinity'end;end;
    return dashboard_private.textbook_context_number_text_v1(number_value);
  end if;
  if jsonb_typeof(value)='array'then select coalesce(string_agg(dashboard_private.textbook_context_json_text_v1(v),','order by ord),'')into result from jsonb_array_elements(value)with ordinality a(v,ord);return result;end if;
  return dashboard_private.textbook_workflow_json_text_v1(value);
end $$;
create function dashboard_private.textbook_context_roster_v1(value jsonb)returns jsonb
language plpgsql immutable security invoker set search_path='' as $$ declare raw text;parsed jsonb;result jsonb;begin
  if jsonb_typeof(value)='string' then
    raw:=dashboard_private.textbook_trim_v1(value#>>'{}');begin parsed:=raw::jsonb;exception when invalid_text_representation then parsed:=null;end;
    if jsonb_typeof(parsed)='array'then value:=parsed;else select coalesce(jsonb_agg(dashboard_private.textbook_trim_v1(v)order by ord),'[]')into result from unnest(string_to_array(raw,','))with ordinality a(v,ord)where dashboard_private.textbook_trim_v1(v)<>'';return result;end if;
  end if;
  if jsonb_typeof(value)is distinct from 'array'then return '[]';end if;
  select coalesce(jsonb_agg(dashboard_private.textbook_trim_v1(dashboard_private.textbook_context_json_text_v1(v))order by ord),'[]')into result from jsonb_array_elements(value)with ordinality a(v,ord)
    where v not in('null'::jsonb,'false'::jsonb,'0'::jsonb)and dashboard_private.textbook_trim_v1(dashboard_private.textbook_context_json_text_v1(v))<>'';return result;
end $$;
create function public.get_class_textbook_sale_context_v1(p_input jsonb)returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb;v_class_id uuid;v_book_id uuid;v_location_id uuid;month text;begin
  perform dashboard_private.textbook_read_guard_v1();perform dashboard_private.textbook_context_strings_v1(p_input,array['classId','textbookId','chargeMonth','locationId']);
  if exists(select 1 from unnest(array['classId','textbookId','locationId'])k where p_input->>k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')then raise exception 'textbook_class_context_input_invalid'using errcode='22023';end if;
  v_class_id:=(p_input->>'classId')::uuid;v_book_id:=(p_input->>'textbookId')::uuid;v_location_id:=(p_input->>'locationId')::uuid;
  month:=left(dashboard_private.textbook_trim_v1(p_input->>'chargeMonth'),7);if month !~ '^\d{4}-\d{2}$'then month:=to_char(now()at time zone 'UTC','YYYY-MM');end if;
  if not exists(select 1 from public.classes c where c.id=v_class_id)or not exists(select 1 from public.textbooks b where b.id=v_book_id)or not exists(select 1 from public.textbook_inventory_locations l where l.id=v_location_id)then raise exception 'textbook_class_context_unavailable'using errcode='22023';end if;
  with class_source as materialized(select c.id,c.name,c.student_ids,dashboard_private.textbook_context_roster_v1(c.student_ids)roster from public.classes c where c.id=v_class_id),
  roster as materialized(select v.id,v.ord from class_source c cross join lateral jsonb_array_elements_text(c.roster)with ordinality v(id,ord)),
  students as materialized(select s.id,s.name,s.grade from public.students s where s.id::text in(select id from roster)),
  duplicates as materialized(select l.* from public.textbook_sale_lines l left join public.textbook_sales s on s.id=l.sale_id join public.textbooks b on b.id=l.textbook_id where l.textbook_id=v_book_id and coalesce(l.class_id,s.class_id)=v_class_id
    and lower(dashboard_private.textbook_trim_v1(b.status))not in('inactive','미사용')and l.copy_scope<>'teacher'and l.status not in('cancelled','returned','excluded')
    and case when left(dashboard_private.textbook_trim_v1(coalesce(nullif(l.charge_month,''),s.charge_month,'')),7)~'^\d{4}-\d{2}$'then left(dashboard_private.textbook_trim_v1(coalesce(nullif(l.charge_month,''),s.charge_month,'')),7)else to_char(now()at time zone 'UTC','YYYY-MM')end=month),
  duplicate_students as(select distinct student_id from duplicates where student_id is not null)
  select jsonb_build_object('input',jsonb_build_object('classId',v_class_id,'textbookId',v_book_id,'locationId',v_location_id,'chargeMonth',month),'class',jsonb_build_object('id',c.id,'name',c.name,'student_ids',c.student_ids),
    'enrolledStudentIds',c.roster,'students',coalesce((select jsonb_agg(to_jsonb(s)order by s.id)from students s),'[]'),
    'missingStudentIds',coalesce((select jsonb_agg(r.id order by r.ord)from roster r where not exists(select 1 from students s where s.id::text=r.id)),'[]'),
    'textbook',dashboard_private.textbook_workflow_book_v1(v_book_id),'location',dashboard_private.textbook_workflow_location_v1(v_location_id),
    'inventory',public.get_textbook_inventory_balance_v1(jsonb_build_object('textbookIds',jsonb_build_array(v_book_id),'locationId',v_location_id))#>'{rows,0}',
    'duplicateLines',coalesce((select jsonb_agg(to_jsonb(d)order by d.id)from duplicates d),'[]'),'duplicateSales',coalesce((select jsonb_agg(to_jsonb(s)order by s.id)from public.textbook_sales s where s.id in(select sale_id from duplicates)),'[]'),
    'duplicateLineIds',coalesce((select jsonb_agg(id order by id)from duplicates),'[]'),'duplicateLineCount',(select count(*)from duplicates),
    'duplicateStudentIds',coalesce((select jsonb_agg(student_id order by student_id)from duplicate_students),'[]'),'duplicateCount',coalesce(nullif((select count(*)from duplicate_students),0),(select count(*)from duplicates)),'complete',true)into result from class_source c;return result;
end $$;

do $$ declare r record;begin
  for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
    (n.nspname='dashboard_private' and p.proname in('textbook_context_strings_v1','textbook_context_references_v1','textbook_closing_keys_v1','textbook_closing_source_v1','textbook_closing_cost_v1','textbook_closing_movement_v1','textbook_closing_movement_match_v1','textbook_context_roster_v1','textbook_context_number_text_v1','textbook_context_json_text_v1'))or
    (n.nspname='public'and p.proname in('list_textbook_closing_page_v1','list_textbook_closing_movement_page_v1','get_textbook_closing_detail_v1','get_textbook_closing_preview_v1','get_textbook_closing_save_context_v1','get_textbook_closing_movement_export_v1','get_textbook_purchase_handoff_context_v1','get_textbook_billing_handoff_context_v1','get_class_textbook_sale_context_v1'))loop
    execute format('revoke all on function %s from public, anon',r.signature);execute format('grant execute on function %s to authenticated',r.signature);
  end loop;
end $$;
