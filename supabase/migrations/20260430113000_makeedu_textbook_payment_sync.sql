alter table public.students
  add column if not exists makeedu_student_no text;

create index if not exists students_makeedu_student_no_idx
  on public.students (makeedu_student_no)
  where makeedu_student_no is not null and makeedu_student_no <> '';

alter table public.textbook_sale_lines
  add column if not exists makeedu_student_no text,
  add column if not exists makeedu_charge_month text,
  add column if not exists makeedu_item_name text,
  add column if not exists makeedu_payment_status text,
  add column if not exists makeedu_charge_amount numeric not null default 0,
  add column if not exists makeedu_discount_amount numeric not null default 0,
  add column if not exists makeedu_saved_point_amount numeric not null default 0,
  add column if not exists makeedu_paid_amount numeric not null default 0,
  add column if not exists makeedu_unpaid_amount numeric not null default 0,
  add column if not exists makeedu_payment_method text,
  add column if not exists makeedu_payment_method_detail text,
  add column if not exists makeedu_card_company text,
  add column if not exists makeedu_paid_at date,
  add column if not exists makeedu_memo text,
  add column if not exists makeedu_import_key text,
  add column if not exists makeedu_synced_at timestamptz;

create index if not exists textbook_sale_lines_makeedu_import_key_idx
  on public.textbook_sale_lines (makeedu_import_key)
  where makeedu_import_key is not null and makeedu_import_key <> '';

create index if not exists textbook_sale_lines_makeedu_payment_status_idx
  on public.textbook_sale_lines (makeedu_payment_status, makeedu_synced_at);

create table if not exists public.textbook_makeedu_payment_imports (
  id uuid primary key default gen_random_uuid(),
  makeedu_import_key text not null,
  student_external_id text not null default '',
  student_name text not null default '',
  category text not null default '',
  charge_month text not null default '',
  item_name text not null default '',
  payment_status text not null default 'unpaid',
  status_text text not null default '',
  charge_amount numeric not null default 0,
  discount_amount numeric not null default 0,
  saved_point_amount numeric not null default 0,
  paid_amount numeric not null default 0,
  unpaid_amount numeric not null default 0,
  payment_method text not null default '',
  payment_method_detail text not null default '',
  card_company text not null default '',
  paid_at date,
  memo text not null default '',
  matched_sale_line_id uuid references public.textbook_sale_lines(id) on delete set null,
  match_status text not null default 'unmatched',
  match_reason text not null default '',
  raw_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists textbook_makeedu_payment_imports_key
  on public.textbook_makeedu_payment_imports (makeedu_import_key);

create index if not exists textbook_makeedu_payment_imports_month_status_idx
  on public.textbook_makeedu_payment_imports (charge_month, payment_status, match_status);

create index if not exists textbook_makeedu_payment_imports_student_idx
  on public.textbook_makeedu_payment_imports (student_external_id, student_name);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'set_updated_at_textbook_makeedu_payment_imports'
  ) then
    create trigger set_updated_at_textbook_makeedu_payment_imports
    before update on public.textbook_makeedu_payment_imports
    for each row execute function public.set_updated_at();
  end if;
end
$$;

alter table public.textbook_makeedu_payment_imports enable row level security;

drop policy if exists textbook_makeedu_payment_imports_authenticated_select
  on public.textbook_makeedu_payment_imports;
create policy textbook_makeedu_payment_imports_authenticated_select
  on public.textbook_makeedu_payment_imports
  for select to authenticated using (true);

drop policy if exists textbook_makeedu_payment_imports_staff_write
  on public.textbook_makeedu_payment_imports;
create policy textbook_makeedu_payment_imports_staff_write
  on public.textbook_makeedu_payment_imports
  for all to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff'))
  with check (public.current_dashboard_role() in ('admin', 'staff'));
