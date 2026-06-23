alter table public.textbook_purchase_order_lines
  add column if not exists copy_scope text not null default 'student';

alter table public.textbook_sale_lines
  add column if not exists copy_scope text not null default 'student',
  add column if not exists teacher_id uuid references public.teacher_catalogs(id) on delete set null,
  add column if not exists teacher_name text not null default '';

alter table public.textbook_stock_moves
  add column if not exists copy_scope text not null default 'student';

alter table public.textbook_stock_counts
  add column if not exists copy_scope text not null default 'student';

update public.textbook_purchase_order_lines
set copy_scope = 'student'
where copy_scope is null or copy_scope = '';

update public.textbook_sale_lines
set copy_scope = 'student'
where copy_scope is null or copy_scope = '';

update public.textbook_stock_moves
set copy_scope = 'student'
where copy_scope is null or copy_scope = '';

update public.textbook_stock_counts
set copy_scope = 'student'
where copy_scope is null or copy_scope = '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'textbook_purchase_order_lines_copy_scope_check'
  ) then
    alter table public.textbook_purchase_order_lines
      add constraint textbook_purchase_order_lines_copy_scope_check
      check (copy_scope in ('student', 'teacher'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'textbook_sale_lines_copy_scope_check'
  ) then
    alter table public.textbook_sale_lines
      add constraint textbook_sale_lines_copy_scope_check
      check (copy_scope in ('student', 'teacher'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'textbook_stock_moves_copy_scope_check'
  ) then
    alter table public.textbook_stock_moves
      add constraint textbook_stock_moves_copy_scope_check
      check (copy_scope in ('student', 'teacher'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'textbook_stock_counts_copy_scope_check'
  ) then
    alter table public.textbook_stock_counts
      add constraint textbook_stock_counts_copy_scope_check
      check (copy_scope in ('student', 'teacher'));
  end if;
end
$$;

create index if not exists textbook_purchase_order_lines_copy_scope_idx
  on public.textbook_purchase_order_lines (copy_scope);

create index if not exists textbook_sale_lines_copy_scope_idx
  on public.textbook_sale_lines (copy_scope);

create index if not exists textbook_stock_moves_textbook_scope_location_idx
  on public.textbook_stock_moves (textbook_id, copy_scope, location_id, moved_at);

notify pgrst, 'reload schema';
