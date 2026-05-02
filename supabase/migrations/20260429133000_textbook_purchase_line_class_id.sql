alter table public.textbook_purchase_order_lines
  add column if not exists class_id uuid references public.classes(id) on delete set null;

create index if not exists textbook_purchase_order_lines_class_idx
  on public.textbook_purchase_order_lines (class_id);
