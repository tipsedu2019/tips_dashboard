-- Additive, read-only workflow projections. Caller RLS stays authoritative.
create function dashboard_private.textbook_workflow_guard_v1(p_mode text) returns void
language plpgsql stable security invoker set search_path='' as $$ begin
  if auth.uid() is null or coalesce(public.current_dashboard_role(),'') not in ('admin','staff','teacher')
    or (public.current_dashboard_role()='teacher' and p_mode is distinct from 'request') then
    raise exception 'textbook_workflow_read_forbidden' using errcode='42501';
  end if;
  if p_mode is null or p_mode not in ('request','order') then raise exception 'textbook_mode_invalid' using errcode='22023'; end if;
end $$;
create function dashboard_private.textbook_workflow_sale_source_v1()
returns table(line_id uuid,book_id uuid,class_id uuid,location_id uuid,student_id uuid,raw_status text,status text,group_status text,quantity integer,raw_quantity integer,amount numeric,period text,event_at text,event_time timestamptz,class_name text,title text,search_values text[])
language plpgsql stable security invoker set search_path='' as $$ begin
  perform dashboard_private.textbook_workflow_guard_v1('order');
  return query with source as (
    select l.id,l.textbook_id book_id,coalesce(l.class_id,s.class_id) class_id,l.location_id,l.student_id,l.status raw_status,
      case l.status when 'paid' then 'charged' else coalesce(nullif(l.status,''),'charged') end status,
      greatest(1,coalesce(nullif(l.quantity,0),1)) quantity,coalesce(nullif(l.quantity,0),1)raw_quantity,
      coalesce(nullif(l.unit_price,0),nullif(b.sale_price,0),nullif(b.price,0),nullif(b.list_price,0),0)*greatest(1,coalesce(nullif(l.quantity,0),1)) amount,
      coalesce(nullif(l.charge_month,''),s.charge_month,'') charge_month,
      case when l.status='issued' then coalesce(to_jsonb(l.updated_at)#>>'{}','') else coalesce(to_jsonb(s.created_at)#>>'{}',to_jsonb(l.created_at)#>>'{}','') end event_at,
      dashboard_private.textbook_trim_v1(coalesce(nullif(c.name,''),c.id::text,'')) class_name,dashboard_private.textbook_trim_v1(coalesce(nullif(b.title,''),b.name,b.id::text,'-'))title,
      case when l.copy_scope='teacher' then '교사용' else '학생용' end copy_label,
      case when l.copy_scope='teacher' then coalesce(nullif(dashboard_private.textbook_trim_v1(l.teacher_name),''),'선생님 미지정') else coalesce(nullif(dashboard_private.textbook_trim_v1(coalesce(nullif(st.name,''),l.student_id::text)),''),'-') end recipient,
      dashboard_private.textbook_trim_v1(coalesce(nullif(loc.name,''),nullif(loc.code,''),l.location_id::text,''))location_name
    from public.textbook_sale_lines l left join public.textbook_sales s on s.id=l.sale_id
    join public.textbooks b on b.id=l.textbook_id and lower(dashboard_private.textbook_trim_v1(b.status)) not in ('inactive','미사용')
    left join public.classes c on c.id=coalesce(l.class_id,s.class_id) left join public.students st on st.id=l.student_id
    left join public.textbook_inventory_locations loc on loc.id=l.location_id
  ) select s.id,s.book_id,s.class_id,s.location_id,s.student_id,s.raw_status,s.status,
    case when s.status in ('charged','issued','cancelled','returned') then s.status else 'charged' end,
    s.quantity,s.raw_quantity,s.amount,
    case when dashboard_private.textbook_trim_v1(s.charge_month)~'^\d{4}-\d{2}' then left(dashboard_private.textbook_trim_v1(s.charge_month),7)
      when s.event_at~'^\d{4}-\d{2}' then left(s.event_at,7) else to_char(now()at time zone 'UTC','YYYY-MM')end,
    s.event_at,dashboard_private.textbook_workflow_event_time_v1(s.event_at),s.class_name,s.title,
    array[s.title,s.copy_label,s.class_name,s.recipient,s.location_name,
      case s.status when 'charged' then '출고 대기' when 'issued' then '출고 완료' when 'cancelled' then '취소' when 'returned' then '반품' else s.status end,s.charge_month]
  from source s;
end $$;
create function dashboard_private.textbook_workflow_sale_match_v1(r jsonb,f jsonb,include_status boolean default true) returns boolean
language sql immutable security invoker set search_path='' as $$ select
 (dashboard_private.textbook_trim_v1(f->>'search')='' or exists(select 1 from jsonb_array_elements_text(r->'search_values')v where strpos(lower(dashboard_private.textbook_trim_v1(v)),lower(dashboard_private.textbook_trim_v1(f->>'search')))>0))
 and (not include_status or f->>'status'='all' or r->>'group_status'=case when f->>'status'='waiting' then 'charged' else f->>'status' end)
$$;
create function dashboard_private.textbook_workflow_sale_project_v1(p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; begin
  perform dashboard_private.textbook_workflow_guard_v1('order');
  select jsonb_build_object('id',l.id,
    'line',jsonb_build_object('id',l.id,'sale_id',l.sale_id,'student_id',l.student_id,'class_id',l.class_id,'textbook_id',l.textbook_id,'charge_month',l.charge_month,'quantity',l.quantity,'unit_price',l.unit_price,
     'location_id',l.location_id,'status',l.status,'exclusion_reason',l.exclusion_reason,'memo',l.memo,'created_at',l.created_at,'updated_at',l.updated_at,'copy_scope',l.copy_scope,'teacher_id',l.teacher_id,'teacher_name',l.teacher_name),
    'sale',to_jsonb(s),'textbook',dashboard_private.textbook_workflow_book_v1(l.textbook_id),'class',dashboard_private.textbook_workflow_class_v1(coalesce(l.class_id,s.class_id)),
    'student',(select jsonb_build_object('id',st.id,'name',st.name)from public.students st where st.id=l.student_id),'location',dashboard_private.textbook_workflow_location_v1(l.location_id),
    'status',case l.status when 'paid' then 'charged' else coalesce(nullif(l.status,''),'charged')end,
    'groupStatus',case when l.status in ('issued','cancelled','returned') then l.status else 'charged'end,
    'eventAt',case when l.status='issued' then coalesce(to_jsonb(l.updated_at)#>>'{}','') else coalesce(to_jsonb(s.created_at)#>>'{}',to_jsonb(l.created_at)#>>'{}','')end,
    'quantity',greatest(1,coalesce(nullif(l.quantity,0),1)),
    'amount',coalesce(nullif(l.unit_price,0),nullif(b.sale_price,0),nullif(b.price,0),nullif(b.list_price,0),0)*greatest(1,coalesce(nullif(l.quantity,0),1)),
    'recipientName',case when l.copy_scope='teacher' then coalesce(nullif(dashboard_private.textbook_trim_v1(l.teacher_name),''),'선생님 미지정') else coalesce(nullif(dashboard_private.textbook_trim_v1(coalesce(nullif((select st.name from public.students st where st.id=l.student_id),''),l.student_id::text)),''),'-')end)
  into result from public.textbook_sale_lines l left join public.textbook_sales s on s.id=l.sale_id join public.textbooks b on b.id=l.textbook_id
  where l.id=p_id and lower(dashboard_private.textbook_trim_v1(b.status))not in ('inactive','미사용'); return result;
end $$;
create function public.list_textbook_sale_page_v1(p_filters jsonb,p_sort text,p_page integer,p_page_size integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_workflow_filters_v1(p_filters,'sale'); perform dashboard_private.textbook_read_page_v1(p_page,p_page_size,p_sort,'status-event');
  with keys as materialized(select s.line_id,s.group_status,s.event_time from dashboard_private.textbook_workflow_sale_source_v1()s where dashboard_private.textbook_workflow_sale_match_v1(to_jsonb(s),p_filters)),
  page as(select * from keys k order by array_position(array['charged','issued','cancelled','returned'],k.group_status),k.event_time desc nulls last,k.line_id offset(p_page::bigint-1)*p_page_size limit p_page_size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(dashboard_private.textbook_workflow_sale_project_v1(p.line_id)order by array_position(array['charged','issued','cancelled','returned'],p.group_status),p.event_time desc nulls last,p.line_id)from page p),'[]'),'page',p_page,'pageSize',p_page_size,'totalCount',(select count(*)from keys))into result; return result;
end $$;
create function public.get_textbook_sale_detail_v1(p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ begin
  perform dashboard_private.textbook_workflow_guard_v1('order');
  if p_id is null then raise exception 'textbook_id_invalid' using errcode='22023'; end if;
  return jsonb_build_object('row',dashboard_private.textbook_workflow_sale_project_v1(p_id));
end $$;
create function public.get_textbook_sale_summary_v1(p_filters jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_workflow_filters_v1(p_filters,'sale');
  with source as materialized(select s.* from dashboard_private.textbook_workflow_sale_source_v1()s where dashboard_private.textbook_workflow_sale_match_v1(to_jsonb(s),p_filters,false)),
  filtered as materialized(select s.* from source s where dashboard_private.textbook_workflow_sale_match_v1(to_jsonb(s),p_filters)),
  groups as(select f.group_status,count(*)count,sum(f.raw_quantity)quantity from filtered f group by f.group_status)
  select jsonb_build_object('totalCount',count(*),'totalQuantity',coalesce(sum(f.quantity),0),'studentCount',count(distinct f.student_id),'classCount',count(distinct f.class_id),
   'totalAmount',coalesce(sum(f.amount)filter(where f.status not in ('cancelled','returned','excluded')),0),
   'groups',coalesce((select jsonb_agg(jsonb_build_object('status',g.group_status,'totalCount',g.count,'totalQuantity',g.quantity)order by array_position(array['charged','issued','cancelled','returned'],g.group_status))from groups g),'[]'),
   'statusCounts',(select jsonb_object_agg(v,(select count(*)from source s where v='all' or s.group_status=case when v='waiting' then 'charged' else v end))from unnest(array['all','waiting','issued','returned','cancelled'])v))into result from filtered f;
  return result;
end $$;
create function dashboard_private.textbook_workflow_history_keys_v1()
returns table(id text,year text,month text,class_id text,class_name text,book_id text,title text,waiting bigint,issued bigint,total bigint,latest_at text)
language plpgsql stable security invoker set search_path='' as $$ begin
  perform dashboard_private.textbook_workflow_guard_v1('order');
  return query select s.period||':'||coalesce(s.class_id::text,'-')||':'||s.book_id::text,left(s.period,4),s.period,coalesce(s.class_id::text,''),coalesce(nullif(s.class_name,''),'-'),s.book_id::text,s.title,
    coalesce(sum(s.quantity)filter(where s.raw_status<>'issued'),0),coalesce(sum(s.quantity)filter(where s.raw_status='issued'),0),sum(s.quantity),coalesce(max(s.event_at collate "C"),'')
  from dashboard_private.textbook_workflow_sale_source_v1()s where s.raw_status not in ('cancelled','returned','excluded') group by s.period,s.class_id,s.book_id,s.class_name,s.title;
end $$;
create function public.list_textbook_sale_history_page_v1(p_filters jsonb,p_sort text,p_page integer,p_page_size integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_workflow_filters_v1(p_filters,'sale-history'); perform dashboard_private.textbook_read_page_v1(p_page,p_page_size,p_sort,'month-class-title');
  with source as materialized(select * from dashboard_private.textbook_workflow_history_keys_v1()),
  selected_year as materialized(select * from source s where p_filters->>'year'='all' or s.year=p_filters->>'year'),
  effective as(select case when exists(select 1 from selected_year s where s.month=p_filters->>'month') then p_filters->>'month' else 'all'end as effective_month),
  filtered as materialized(select s.* from selected_year s cross join effective e where (e.effective_month='all' or s.month=e.effective_month) and (p_filters->>'classId'='all' or s.class_id=p_filters->>'classId')),
  page as(select * from filtered f order by f.month desc,f.class_name collate dashboard_private.ko_numeric,f.title collate dashboard_private.ko_numeric,f.id collate "C" offset(p_page::bigint-1)*p_page_size limit p_page_size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'year',p.year,'month',p.month,'classId',p.class_id,'className',p.class_name,'textbookId',p.book_id,'textbookTitle',p.title,'waitingQuantity',p.waiting,'issuedQuantity',p.issued,'totalQuantity',p.total,'latestAt',p.latest_at)order by p.month desc,p.class_name collate dashboard_private.ko_numeric,p.title collate dashboard_private.ko_numeric,p.id collate "C")from page p),'[]'),'page',p_page,'pageSize',p_page_size,'totalCount',(select count(*)from filtered))into result;
  return result;
end $$;
create function public.get_textbook_sale_history_summary_v1(p_filters jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_workflow_filters_v1(p_filters,'sale-history');
  with source as materialized(select * from dashboard_private.textbook_workflow_history_keys_v1()),
  selected_year as materialized(select * from source s where p_filters->>'year'='all' or s.year=p_filters->>'year'),
  effective as(select case when exists(select 1 from selected_year s where s.month=p_filters->>'month') then p_filters->>'month' else 'all'end as effective_month),
  filtered as(select s.* from selected_year s cross join effective e where(e.effective_month='all' or s.month=e.effective_month)and(p_filters->>'classId'='all' or s.class_id=p_filters->>'classId'))
  select jsonb_build_object('totalCount',count(*),'totalWaitingQuantity',coalesce(sum(f.waiting),0),'totalIssuedQuantity',coalesce(sum(f.issued),0),'sourceTotalCount',(select count(*)from source),
   'yearOptions',coalesce((select jsonb_agg(v.year order by v.year desc)from(select distinct year from source)v),'[]'),
   'monthOptions',coalesce((select jsonb_agg(v.month order by v.month desc)from(select distinct month from selected_year)v),'[]'),
   'classOptions',coalesce((select jsonb_agg(jsonb_build_array(v.class_id,v.class_name)order by v.class_name collate dashboard_private.ko_numeric,v.class_id collate "C")from(select distinct class_id,class_name from source where class_id<>'')v),'[]'),
   'effectiveMonth',(select effective_month from effective)) into result from filtered f; return result;
end $$;
create function public.get_textbook_operations_summary_v1() returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_workflow_guard_v1('order');
  with purchases as materialized(select * from dashboard_private.textbook_workflow_purchase_source_v1('order')),
  balances as(select b.id,coalesce(sum(m.quantity),0) quantity from public.textbooks b left join public.textbook_stock_moves m on m.textbook_id=b.id where lower(dashboard_private.textbook_trim_v1(b.status))not in ('inactive','미사용')group by b.id)
  select jsonb_build_object('requestCount',count(*)filter(where p.status='requested'),'unregisteredRequestCount',count(*)filter(where p.status='requested' and p.book_id is null),
   'orderNeededCount',count(*)filter(where p.status='requested' and p.book_id is not null),'receivingBacklogCount',count(*)filter(where p.status in ('ordered','partially_received')and greatest(p.ordered,p.requested)>p.received),
   'partialReceiptCount',count(*)filter(where p.status='partially_received' or(p.ordered>0 and p.received>0 and p.received<p.ordered)),
   'issueWaitingCount',(select count(*)from dashboard_private.textbook_workflow_sale_source_v1()s where s.raw_status in ('charged','paid')),
   'stockRiskCount',(select count(*)from balances b where b.quantity<0 or b.quantity between 1 and 3))into result from purchases p; return result;
end $$;
create function dashboard_private.textbook_workflow_filters_v1(f jsonb,kind text) returns void
language plpgsql stable security invoker set search_path='' as $$
declare expected text[]; actual text[]; k text; begin
  perform dashboard_private.textbook_workflow_guard_v1(case when kind='purchase' and f->>'mode'='request' then 'request' else 'order' end);
  expected:=case kind when 'purchase' then array['boardScope','mode','orderFilter','requestFilter','search'] when 'sale' then array['search','status'] else array['classId','month','search','year'] end;
  if jsonb_typeof(f) is distinct from 'object' then raise exception 'textbook_filters_invalid' using errcode='22023'; end if;
  select array_agg(key order by key collate "C") into actual from jsonb_object_keys(f) key;
  if actual is distinct from expected then raise exception 'textbook_filters_invalid' using errcode='22023'; end if;
  foreach k in array expected loop if jsonb_typeof(f->k) is distinct from 'string' then raise exception 'textbook_filters_invalid' using errcode='22023'; end if; end loop;
  if (kind='purchase' and (f->>'mode' not in ('request','order') or f->>'boardScope' not in ('active','recent','all') or f->>'requestFilter' not in ('all','unregistered','orderable') or f->>'orderFilter' not in ('all','waiting','partial','returnable','returned')))
    or (kind='sale' and f->>'status' not in ('all','waiting','issued','returned','cancelled')) or (kind='sale-history' and f->>'search'<>'') then
    raise exception 'textbook_filters_invalid' using errcode='22023'; end if;
end $$;
create function dashboard_private.textbook_workflow_normalize_v1(value text) returns text
language sql immutable security invoker set search_path='' as $$
select regexp_replace(lower(normalize(dashboard_private.textbook_trim_v1(value),NFKC)), '['||U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'||']+', ' ', 'g')
$$;
create function dashboard_private.textbook_workflow_book_id_v1(reference text) returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare result uuid; normalized_reference text; compact_reference text; begin
  perform dashboard_private.textbook_workflow_guard_v1('request');
  reference:=dashboard_private.textbook_trim_v1(reference);
  if reference='' then return null; end if;
  -- Exact textual record identity outranks every alias. The lower-case canonical
  -- spelling is deliberate: do not turn case-insensitive UUID parsing into a
  -- different lookup contract. This PK lookup avoids a catalog alias scan for
  -- each ordinary purchase line, while preserving caller RLS and inactive IDs.
  if reference ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select t.id into result from public.textbooks t where t.id=reference::uuid;
    if result is not null then return result; end if;
  end if;
  normalized_reference:=dashboard_private.textbook_workflow_normalize_v1(reference);
  compact_reference:=dashboard_private.textbook_compact_v1(reference);
  select t.id into result from public.textbooks t cross join lateral (
    select min(case when dashboard_private.textbook_workflow_normalize_v1(alias)=normalized_reference then 1
      when compact_reference<>'' and dashboard_private.textbook_compact_v1(alias)=compact_reference then 2 end) rank
    from unnest(array[coalesce(nullif(t.title,''),t.name),t.name,t.isbn13,t.barcode])alias
  )m where m.rank is not null order by m.rank,t.id limit 1;
  return result;
end $$;
create function dashboard_private.textbook_workflow_event_time_v1(value text) returns timestamptz
language plpgsql immutable security invoker set search_path='' as $$ begin
  if value is null or value='' or value in ('infinity','-infinity') then return null; end if;
  if value ~ '^\d{4}-\d{2}-\d{2}$' then return (value||'T00:00:00+00:00')::timestamptz; end if;
  if value !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d\d:\d\d)$' then return null; end if;
  return value::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then return null; end $$;
create function dashboard_private.textbook_workflow_supplier_v1(book_id uuid,order_supplier uuid,p_mode text) returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare result uuid; publisher uuid; publisher_name text; begin
  perform dashboard_private.textbook_workflow_guard_v1(p_mode);
  select t.default_supplier_id,t.publisher_id,t.publisher into result,publisher,publisher_name from public.textbooks t where t.id=book_id;
  if result is not null then return result; end if;
  -- Request loader has neither supplier links nor supplier catalog.
  if p_mode='request' then return order_supplier; end if;
  if publisher is null then select p.id into publisher from public.textbook_publishers p where dashboard_private.textbook_workflow_normalize_v1(p.name)=dashboard_private.textbook_workflow_normalize_v1(publisher_name) and dashboard_private.textbook_trim_v1(publisher_name)<>'' order by p.id limit 1; end if;
  select l.supplier_id into result from public.textbook_publisher_supplier_links l where l.publisher_id=publisher order by l.is_primary desc,l.priority,l.id limit 1;
  return coalesce(result,order_supplier);
end $$;
create function dashboard_private.textbook_workflow_purchase_source_v1(p_mode text)
returns table(line_id uuid,book_id uuid,class_id uuid,location_id uuid,status text,scope text,base_key text,created_at timestamptz,event_at text,event_time timestamptz,recent_at timestamptz,requested integer,ordered integer,received integer,search_values text[])
language plpgsql stable security invoker set search_path='' as $$ begin
  perform dashboard_private.textbook_workflow_guard_v1(p_mode);
  return query with source as (
    select l.id,l.class_id,l.location_id,l.copy_scope,l.created_at,l.requested_quantity,l.ordered_quantity,l.received_quantity,
      coalesce(o.status,'requested') effective_status,b.id book_id,
      dashboard_private.textbook_trim_v1(coalesce(nullif(b.title,''),b.name,nullif(l.requested_textbook_title,''),l.textbook_id::text,'-')) title,
      l.requested_textbook_title,o.requested_by,o.supplier_id,o.order_date,o.statement_number,
      coalesce(nullif(l.memo,''),o.memo,'') memo,coalesce(o.received_at,o.updated_at,o.created_at) recent_at,
      case when o.status in ('received','partially_received') then coalesce(to_jsonb(o.received_at)#>>'{}',to_jsonb(o.updated_at)#>>'{}',to_jsonb(l.updated_at)#>>'{}','')
       when o.status='ordered' then coalesce(to_jsonb(o.ordered_at)#>>'{}',o.order_date::text,to_jsonb(o.updated_at)#>>'{}',to_jsonb(l.updated_at)#>>'{}','')
       else coalesce(to_jsonb(o.created_at)#>>'{}',to_jsonb(l.created_at)#>>'{}','') end event_at,
      dashboard_private.textbook_trim_v1(coalesce(nullif(c.name,''),c.id::text,'')) class_name,dashboard_private.textbook_trim_v1(coalesce(nullif(loc.name,''),nullif(loc.code,''),l.location_id::text,'')) location_name,
      dashboard_private.textbook_workflow_supplier_v1(b.id,o.supplier_id,p_mode) configured_supplier
    from public.textbook_purchase_order_lines l left join public.textbook_purchase_orders o on o.id=l.purchase_order_id
    left join public.textbooks b on b.id=dashboard_private.textbook_workflow_book_id_v1(coalesce(l.textbook_id::text,nullif(dashboard_private.textbook_trim_v1(l.requested_textbook_title),'')))
    left join public.classes c on c.id=l.class_id left join public.textbook_inventory_locations loc on loc.id=l.location_id
    where (p_mode<>'request' or coalesce(o.status,'requested')='requested') and (b.id is null or lower(dashboard_private.textbook_trim_v1(b.status)) not in ('inactive','미사용'))
  ) select s.id,s.book_id,s.class_id,s.location_id,s.effective_status,s.copy_scope,
    array_to_string(array[s.effective_status,coalesce(s.book_id::text,dashboard_private.textbook_workflow_normalize_v1(coalesce(nullif(s.requested_textbook_title,''),s.title))),coalesce(s.class_id::text,''),coalesce(s.location_id::text,''),dashboard_private.textbook_trim_v1(s.requested_by),coalesce(s.supplier_id::text,''),coalesce(s.order_date::text,''),dashboard_private.textbook_trim_v1(s.statement_number)],'||'),
    s.created_at,s.event_at,dashboard_private.textbook_workflow_event_time_v1(s.event_at),s.recent_at,s.requested_quantity,s.ordered_quantity,s.received_quantity,
    array[s.title,s.requested_textbook_title,s.requested_by,s.class_name,
      case when p_mode='order' then dashboard_private.textbook_trim_v1(coalesce(nullif((select p.name from public.textbook_suppliers p where p.id=s.configured_supplier),''),s.configured_supplier::text,'')) else coalesce(s.configured_supplier::text,'') end,
      s.location_name,case s.effective_status when 'requested' then '요청' when 'cancelled' then '취소' when 'returned' then '반품'
       else case when s.received_quantity<=0 then '주문' when s.received_quantity<s.ordered_quantity then '부분 입고' else '입고 완료' end end,s.statement_number,s.memo]
  from source s;
end $$;
create function dashboard_private.textbook_workflow_purchase_match_v1(r jsonb,f jsonb,check_groups boolean default true) returns boolean
language sql stable security invoker set search_path='' as $$
select
 (dashboard_private.textbook_trim_v1(f->>'search')='' or exists(select 1 from jsonb_array_elements_text(r->'search_values')v where strpos(lower(dashboard_private.textbook_trim_v1(v)),lower(dashboard_private.textbook_trim_v1(f->>'search')))>0))
 and (f->>'boardScope'='all' or r->>'status' not in ('received','returned','cancelled') or (f->>'boardScope'='recent' and (r->>'recent_at' is null or r->>'recent_at' in ('infinity','-infinity') or now()-(r->>'recent_at')::timestamptz<=interval '30 days')))
 and (f->>'requestFilter'='all' or ((f->>'mode'='request' or r->>'status'='requested') and case f->>'requestFilter' when 'unregistered' then r->>'book_id' is null else r->>'book_id' is not null end))
 and (f->>'mode'='request' or (
   (not check_groups or case f->>'orderFilter' when 'waiting' then r->>'status' in ('requested','ordered','partially_received') when 'partial' then r->>'status'='partially_received' when 'returnable' then r->>'status' in ('partially_received','received') when 'returned' then r->>'status'='returned' else true end)
   and case f->>'orderFilter' when 'returnable' then (r->>'received')::integer>0 and r->>'status' not in ('returned','cancelled') when 'returned' then r->>'status'='returned' else true end))
$$;
create function dashboard_private.textbook_workflow_quantities_v1(sr bigint,so bigint,sv bigint,tr bigint,tor bigint,tv bigint) returns jsonb
language sql immutable security invoker set search_path='' as $$ select jsonb_build_object('requested',sr+tr,'ordered',so+tor,'received',sv+tv,
 'student',jsonb_build_object('requested',sr,'ordered',so,'received',sv),'teacher',jsonb_build_object('requested',tr,'ordered',tor,'received',tv)) $$;
create function dashboard_private.textbook_workflow_purchase_keys_v1(f jsonb)
returns table(id text,anchor uuid,member_ids uuid[],primary_id uuid,status text,event_at text,event_time timestamptz,quantities jsonb)
language plpgsql stable security invoker set search_path='' as $$ begin
  perform dashboard_private.textbook_workflow_filters_v1(f,'purchase');
  return query with eligible as materialized (
    select s.* from dashboard_private.textbook_workflow_purchase_source_v1(f->>'mode')s where dashboard_private.textbook_workflow_purchase_match_v1(to_jsonb(s),f)
  ), ranked as(select e.*,row_number()over(partition by e.base_key,e.scope order by e.created_at asc nulls last,e.line_id) scope_rank from eligible e),
  keyed as(select r.*,case when scope_rank=1 then r.base_key else r.base_key||'||'||r.line_id::text end parent_key from ranked r),
  grouped as(select k.parent_key,array_agg(k.line_id order by k.created_at asc nulls last,k.line_id) members,
    (array_agg(k.line_id order by (k.scope='student')desc,k.created_at asc nulls last,k.line_id))[1] primary_id,
    dashboard_private.textbook_workflow_quantities_v1(coalesce(sum(k.requested)filter(where k.scope='student'),0),coalesce(sum(k.ordered)filter(where k.scope='student'),0),coalesce(sum(k.received)filter(where k.scope='student'),0),coalesce(sum(k.requested)filter(where k.scope='teacher'),0),coalesce(sum(k.ordered)filter(where k.scope='teacher'),0),coalesce(sum(k.received)filter(where k.scope='teacher'),0)) quantities
    from keyed k group by k.parent_key)
  select g.parent_key,g.members[1],g.members,g.primary_id,p.status,p.event_at,p.event_time,g.quantities from grouped g join eligible p on p.line_id=g.primary_id;
end $$;
create function dashboard_private.textbook_workflow_book_v1(p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_workflow_guard_v1('request');
  select jsonb_build_object('id',b.id,'title',b.title,'name',b.name,'status',b.status,'subject',b.subject,'publisher',b.publisher,'publisher_id',b.publisher_id,'default_supplier_id',b.default_supplier_id,
    'price',b.price,'sale_price',b.sale_price,'list_price',b.list_price,'isbn13',b.isbn13,'barcode',b.barcode,'is_returnable',b.is_returnable) into result from public.textbooks b where b.id=p_id; return result;
end $$;
-- listIds accepts JSON arrays, JSON-encoded arrays and comma-separated strings.
-- Its per-element String(value||'').trim() is preserved without returning rosters.
create function dashboard_private.textbook_workflow_json_text_v1(value jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$ declare result text; begin
  if value is null or value='null'::jsonb then return ''; end if;
  if jsonb_typeof(value)='object' then return '[object Object]'; end if;
  if jsonb_typeof(value)='array' then select coalesce(string_agg(dashboard_private.textbook_workflow_json_text_v1(v),',' order by ord),'')into result from jsonb_array_elements(value)with ordinality a(v,ord);return result;end if;
  return value#>>'{}';
end $$;
create function dashboard_private.textbook_workflow_roster_count_v1(value jsonb) returns integer
language plpgsql immutable security invoker set search_path='' as $$ declare raw text; parsed jsonb; result integer; begin
  if jsonb_typeof(value)='string' then
    raw:=dashboard_private.textbook_trim_v1(value#>>'{}');
    begin parsed:=raw::jsonb; exception when invalid_text_representation then parsed:=null; end;
    if jsonb_typeof(parsed)='array' then value:=parsed; else select count(*)into result from unnest(string_to_array(raw,','))v where dashboard_private.textbook_trim_v1(v)<>'';return result;end if;
  end if;
  if jsonb_typeof(value)is distinct from 'array' then return 0;end if;
  select count(*)into result from jsonb_array_elements(value)v where v not in ('null'::jsonb,'false'::jsonb,'0'::jsonb)and dashboard_private.textbook_trim_v1(dashboard_private.textbook_workflow_json_text_v1(v))<>'';return result;
end $$;
create function dashboard_private.textbook_workflow_class_v1(p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_workflow_guard_v1('request');
  select jsonb_build_object('id',c.id,'name',c.name,'studentCount',dashboard_private.textbook_workflow_roster_count_v1(c.student_ids)) into result from public.classes c where c.id=p_id; return result;
end $$;
create function dashboard_private.textbook_workflow_location_v1(p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_workflow_guard_v1('request');
  select jsonb_build_object('id',l.id,'code',l.code,'name',l.name) into result from public.textbook_inventory_locations l where l.id=p_id; return result;
end $$;
create function dashboard_private.textbook_workflow_purchase_project_v1(k jsonb,p_mode text) returns jsonb
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
    when regexp_replace(lower(coalesce(book->>'publisher','')),'[[:space:]]','','g')='팁스서점' or regexp_replace(lower(coalesce(supplier_ref->>'name',supplier_id::text,'')),'[[:space:]]','','g')='팁스서점' then 0 else floor(sale_price*0.9+0.5) end;
  return jsonb_build_object('id',k->>'id','anchorLineId',k->'anchor','memberLineIds',k->'member_ids','lines',members,'line',primary_line||jsonb_build_object('purchaseScopeLines',members),
    'mode',p_mode,'status',k->>'status','eventAt',k->>'event_at','quantities',k->'quantities','references',jsonb_build_object('textbook',book,'class',class_ref,'location',location_ref,'publisher',publisher_ref,'supplier',supplier_ref,'configuredSupplierId',coalesce(supplier_id::text,''),'unitCost',cost));
end $$;
create function public.list_textbook_purchase_page_v1(p_filters jsonb,p_sort text,p_page integer,p_page_size integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_workflow_filters_v1(p_filters,'purchase'); perform dashboard_private.textbook_read_page_v1(p_page,p_page_size,p_sort,'status-event');
  with keys as materialized(select * from dashboard_private.textbook_workflow_purchase_keys_v1(p_filters)),
  page as(select k.* from keys k order by array_position(array['requested','ordered','partially_received','received','returned','cancelled'],k.status),k.event_time desc nulls last,k.anchor offset (p_page::bigint-1)*p_page_size limit p_page_size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(dashboard_private.textbook_workflow_purchase_project_v1(to_jsonb(p),p_filters->>'mode') order by array_position(array['requested','ordered','partially_received','received','returned','cancelled'],p.status),p.event_time desc nulls last,p.anchor)from page p),'[]'),'page',p_page,'pageSize',p_page_size,'totalCount',(select count(*)from keys))into result; return result;
end $$;
create function public.get_textbook_purchase_detail_v1(p_anchor_line_id uuid,p_mode text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_workflow_guard_v1(p_mode);
  if p_anchor_line_id is null then raise exception 'textbook_id_invalid' using errcode='22023'; end if;
  select dashboard_private.textbook_workflow_purchase_project_v1(to_jsonb(k),p_mode) into result from dashboard_private.textbook_workflow_purchase_keys_v1(jsonb_build_object('mode',p_mode,'search','','boardScope','all','requestFilter','all','orderFilter','all'))k where p_anchor_line_id=any(k.member_ids);
  return jsonb_build_object('row',result);
end $$;
create function public.get_textbook_purchase_summary_v1(p_filters jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb; begin
  perform dashboard_private.textbook_workflow_filters_v1(p_filters,'purchase');
  with source as materialized(select to_jsonb(s) r from dashboard_private.textbook_workflow_purchase_source_v1(p_filters->>'mode')s),
  keys as materialized(select * from dashboard_private.textbook_workflow_purchase_keys_v1(p_filters)),
  groups as(select k.status,count(*) total_count,sum(cardinality(k.member_ids)) raw_count,
    dashboard_private.textbook_workflow_quantities_v1(coalesce(sum((k.quantities#>>'{student,requested}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{student,ordered}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{student,received}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{teacher,requested}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{teacher,ordered}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{teacher,received}')::bigint),0)::bigint) quantities from keys k group by k.status),
  totals as(select count(*)total_count,coalesce(sum(cardinality(k.member_ids)),0)raw_count,
    dashboard_private.textbook_workflow_quantities_v1(coalesce(sum((k.quantities#>>'{student,requested}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{student,ordered}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{student,received}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{teacher,requested}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{teacher,ordered}')::bigint),0)::bigint,coalesce(sum((k.quantities#>>'{teacher,received}')::bigint),0)::bigint)quantities from keys k)
  select jsonb_build_object('mode',p_filters->>'mode','totalCount',t.total_count,'rawLineCount',t.raw_count,'quantities',t.quantities,
    'groups',coalesce((select jsonb_agg(jsonb_build_object('status',g.status,'totalCount',g.total_count,'rawLineCount',g.raw_count,'quantities',g.quantities)order by array_position(array['requested','ordered','partially_received','received','returned','cancelled'],g.status))from groups g),'[]'),
    'requestCounts',(select jsonb_object_agg(v,(select count(*)from source s where dashboard_private.textbook_workflow_purchase_match_v1(s.r,p_filters||jsonb_build_object('requestFilter',v),false)))from unnest(array['all','unregistered','orderable'])v),
    'orderCounts',(select jsonb_object_agg(v,(select count(*)from source s where dashboard_private.textbook_workflow_purchase_match_v1(s.r,p_filters||jsonb_build_object('orderFilter',v),true)))from unnest(array['all','waiting','partial','returnable','returned'])v),
    'boardScopeCounts',(select jsonb_object_agg(v,(select count(*)from source s where dashboard_private.textbook_workflow_purchase_match_v1(s.r,p_filters||jsonb_build_object('boardScope',v),false)))from unnest(array['active','recent','all'])v)) into result from totals t;
  return result;
end $$;

-- Only this additive namespace and these nine public functions. No policy,
-- writer, raw-table privilege, authentication, lock or no-send change.
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
    (n.nspname='dashboard_private' and p.proname like 'textbook_workflow_%') or
    (n.nspname='public' and p.proname=any(array['list_textbook_purchase_page_v1','list_textbook_sale_page_v1','list_textbook_sale_history_page_v1','get_textbook_purchase_summary_v1','get_textbook_sale_summary_v1','get_textbook_sale_history_summary_v1','get_textbook_operations_summary_v1','get_textbook_purchase_detail_v1','get_textbook_sale_detail_v1'])) loop
    execute format('revoke all on function %s from public, anon',f);
    execute format('grant execute on function %s to authenticated',f);
  end loop;
end $$;
notify pgrst,'reload schema';
