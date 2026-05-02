alter table public.textbook_purchase_order_lines
  add column if not exists requested_textbook_title text not null default '';

alter table public.textbook_purchase_order_lines
  alter column textbook_id drop not null;

create index if not exists textbook_purchase_order_lines_requested_title_idx
  on public.textbook_purchase_order_lines (requested_textbook_title)
  where requested_textbook_title <> '';

notify pgrst, 'reload schema';
