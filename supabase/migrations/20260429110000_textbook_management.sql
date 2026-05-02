create extension if not exists pgcrypto;

alter table public.textbooks
  add column if not exists isbn13 text,
  add column if not exists barcode text,
  add column if not exists subject text,
  add column if not exists category text,
  add column if not exists publisher_id uuid,
  add column if not exists default_supplier_id uuid,
  add column if not exists list_price numeric not null default 0,
  add column if not exists sale_price numeric not null default 0,
  add column if not exists status text not null default 'active',
  add column if not exists is_returnable boolean not null default false,
  add column if not exists source_notion_url text;

create unique index if not exists textbooks_isbn13_key
  on public.textbooks (isbn13)
  where isbn13 is not null and isbn13 <> '';

create unique index if not exists textbooks_barcode_key
  on public.textbooks (barcode)
  where barcode is not null and barcode <> '';

create table if not exists public.textbook_publishers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  memo text not null default '',
  source_notion_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists textbook_publishers_name_key
  on public.textbook_publishers (name);

create table if not exists public.textbook_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text not null default '',
  memo text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists textbook_suppliers_name_key
  on public.textbook_suppliers (name);

create table if not exists public.textbook_supplier_links (
  id uuid primary key default gen_random_uuid(),
  textbook_id uuid not null references public.textbooks(id) on delete cascade,
  supplier_id uuid not null references public.textbook_suppliers(id) on delete cascade,
  publisher_id uuid references public.textbook_publishers(id) on delete set null,
  priority integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists textbook_supplier_links_textbook_supplier_key
  on public.textbook_supplier_links (textbook_id, supplier_id);

create table if not exists public.textbook_inventory_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists textbook_inventory_locations_code_key
  on public.textbook_inventory_locations (code);

insert into public.textbook_inventory_locations (code, name, sort_order)
values
  ('main', '본관', 10),
  ('annex', '별관', 20)
on conflict (code) do update
set name = excluded.name,
    sort_order = excluded.sort_order;

create table if not exists public.textbook_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.textbook_suppliers(id) on delete set null,
  requested_by text not null default '',
  requested_date date not null default current_date,
  order_date date not null default current_date,
  expected_date date,
  ordered_at timestamptz,
  received_at timestamptz,
  status text not null default 'requested' check (status in ('requested', 'ordered', 'partially_received', 'received', 'cancelled', 'returned')),
  statement_number text not null default '',
  memo text not null default '',
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.textbook_purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.textbook_purchase_orders(id) on delete cascade,
  textbook_id uuid not null references public.textbooks(id) on delete restrict,
  class_id uuid references public.classes(id) on delete set null,
  location_id uuid references public.textbook_inventory_locations(id) on delete set null,
  requested_quantity integer not null default 0,
  ordered_quantity integer not null default 0,
  received_quantity integer not null default 0,
  teacher_ordered_quantity integer not null default 0,
  teacher_received_quantity integer not null default 0,
  unit_cost numeric not null default 0,
  memo text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists textbook_purchase_order_lines_order_idx
  on public.textbook_purchase_order_lines (purchase_order_id);

create index if not exists textbook_purchase_order_lines_class_idx
  on public.textbook_purchase_order_lines (class_id);

create table if not exists public.textbook_sales (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references public.classes(id) on delete set null,
  charge_month text not null,
  sale_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'charged', 'paid', 'issued', 'cancelled')),
  memo text not null default '',
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists textbook_sales_class_month_idx
  on public.textbook_sales (class_id, charge_month);

create table if not exists public.textbook_sale_lines (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.textbook_sales(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  class_id uuid references public.classes(id) on delete set null,
  textbook_id uuid not null references public.textbooks(id) on delete restrict,
  charge_month text not null,
  quantity integer not null default 1,
  unit_price numeric not null default 0,
  location_id uuid references public.textbook_inventory_locations(id) on delete set null,
  status text not null default 'charged' check (status in ('charged', 'paid', 'issued', 'excluded', 'cancelled', 'returned')),
  exclusion_reason text not null default '',
  memo text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists textbook_sale_lines_student_class_month_idx
  on public.textbook_sale_lines (student_id, class_id, charge_month);

create table if not exists public.textbook_stock_moves (
  id uuid primary key default gen_random_uuid(),
  textbook_id uuid not null references public.textbooks(id) on delete restrict,
  location_id uuid references public.textbook_inventory_locations(id) on delete set null,
  purchase_order_line_id uuid references public.textbook_purchase_order_lines(id) on delete set null,
  sale_line_id uuid references public.textbook_sale_lines(id) on delete set null,
  move_type text not null check (move_type in ('opening', 'purchase_receipt', 'sale_issue', 'return_in', 'return_out', 'transfer_in', 'transfer_out', 'stock_adjustment')),
  quantity integer not null,
  unit_amount numeric not null default 0,
  amount numeric not null default 0,
  moved_at timestamptz not null default now(),
  memo text not null default '',
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists textbook_stock_moves_textbook_location_idx
  on public.textbook_stock_moves (textbook_id, location_id, moved_at);

create table if not exists public.textbook_stock_counts (
  id uuid primary key default gen_random_uuid(),
  counted_at date not null default current_date,
  textbook_id uuid not null references public.textbooks(id) on delete restrict,
  location_id uuid references public.textbook_inventory_locations(id) on delete set null,
  expected_quantity integer not null default 0,
  counted_quantity integer not null default 0,
  adjustment_move_id uuid references public.textbook_stock_moves(id) on delete set null,
  memo text not null default '',
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.textbook_monthly_closings (
  id uuid primary key default gen_random_uuid(),
  closing_month text not null,
  subject text not null default 'all',
  opening_quantity integer not null default 0,
  opening_amount numeric not null default 0,
  purchase_quantity integer not null default 0,
  purchase_amount numeric not null default 0,
  sale_quantity integer not null default 0,
  sale_amount numeric not null default 0,
  adjustment_quantity integer not null default 0,
  adjustment_amount numeric not null default 0,
  ending_quantity integer not null default 0,
  ending_amount numeric not null default 0,
  received_amount numeric not null default 0,
  supplier_payment_amount numeric not null default 0,
  settlement_difference numeric not null default 0,
  status text not null default 'draft' check (status in ('draft', 'locked')),
  memo text not null default '',
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists textbook_monthly_closings_month_subject_key
  on public.textbook_monthly_closings (closing_month, subject);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'textbooks_publisher_id_fkey'
  ) then
    alter table public.textbooks
      add constraint textbooks_publisher_id_fkey
      foreign key (publisher_id) references public.textbook_publishers(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'textbooks_default_supplier_id_fkey'
  ) then
    alter table public.textbooks
      add constraint textbooks_default_supplier_id_fkey
      foreign key (default_supplier_id) references public.textbook_suppliers(id) on delete set null;
  end if;
end
$$;

do $$
declare
  managed_table text;
begin
  foreach managed_table in array array[
    'textbook_publishers',
    'textbook_suppliers',
    'textbook_supplier_links',
    'textbook_inventory_locations',
    'textbook_purchase_orders',
    'textbook_purchase_order_lines',
    'textbook_sales',
    'textbook_sale_lines',
    'textbook_stock_counts',
    'textbook_monthly_closings'
  ]
  loop
    if not exists (
      select 1 from pg_trigger where tgname = 'set_updated_at_' || managed_table
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
        'set_updated_at_' || managed_table,
        managed_table
      );
    end if;
  end loop;
end
$$;

alter table public.textbook_publishers enable row level security;
alter table public.textbook_suppliers enable row level security;
alter table public.textbook_supplier_links enable row level security;
alter table public.textbook_inventory_locations enable row level security;
alter table public.textbook_purchase_orders enable row level security;
alter table public.textbook_purchase_order_lines enable row level security;
alter table public.textbook_stock_moves enable row level security;
alter table public.textbook_sales enable row level security;
alter table public.textbook_sale_lines enable row level security;
alter table public.textbook_stock_counts enable row level security;
alter table public.textbook_monthly_closings enable row level security;

do $$
declare
  managed_table text;
begin
  foreach managed_table in array array[
    'textbook_publishers',
    'textbook_suppliers',
    'textbook_supplier_links',
    'textbook_inventory_locations',
    'textbook_purchase_orders',
    'textbook_purchase_order_lines',
    'textbook_stock_moves',
    'textbook_sales',
    'textbook_sale_lines',
    'textbook_stock_counts',
    'textbook_monthly_closings'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', managed_table || '_authenticated_select', managed_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      managed_table || '_authenticated_select',
      managed_table
    );

    execute format('drop policy if exists %I on public.%I', managed_table || '_staff_write', managed_table);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.current_dashboard_role() in (''admin'', ''staff'')) with check (public.current_dashboard_role() in (''admin'', ''staff''))',
      managed_table || '_staff_write',
      managed_table
    );
  end loop;
end
$$;
