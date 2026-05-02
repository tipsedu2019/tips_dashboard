alter table public.textbook_publishers
  add column if not exists subjects text[] not null default '{}'::text[],
  add column if not exists source_notion_urls text[] not null default '{}'::text[];

create unique index if not exists textbooks_source_notion_url_key
  on public.textbooks (source_notion_url)
  where source_notion_url is not null and source_notion_url <> '';

create table if not exists public.textbook_publisher_supplier_links (
  id uuid primary key default gen_random_uuid(),
  publisher_id uuid not null references public.textbook_publishers(id) on delete cascade,
  supplier_id uuid not null references public.textbook_suppliers(id) on delete cascade,
  priority integer not null default 0,
  is_primary boolean not null default false,
  memo text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists textbook_publisher_supplier_links_publisher_supplier_key
  on public.textbook_publisher_supplier_links (publisher_id, supplier_id);

create index if not exists textbook_publisher_supplier_links_supplier_idx
  on public.textbook_publisher_supplier_links (supplier_id, priority);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'set_updated_at_textbook_publisher_supplier_links'
  ) then
    create trigger set_updated_at_textbook_publisher_supplier_links
      before update on public.textbook_publisher_supplier_links
      for each row
      execute function public.set_updated_at();
  end if;
end
$$;

alter table public.textbook_publisher_supplier_links enable row level security;

drop policy if exists textbook_publisher_supplier_links_authenticated_select
  on public.textbook_publisher_supplier_links;
create policy textbook_publisher_supplier_links_authenticated_select
  on public.textbook_publisher_supplier_links
  for select
  to authenticated
  using (true);

drop policy if exists textbook_publisher_supplier_links_staff_write
  on public.textbook_publisher_supplier_links;
create policy textbook_publisher_supplier_links_staff_write
  on public.textbook_publisher_supplier_links
  for all
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff'))
  with check (public.current_dashboard_role() in ('admin', 'staff'));
