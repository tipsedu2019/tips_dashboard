alter table public.ops_transfer_details
  add column if not exists from_class_id uuid references public.classes(id) on delete set null,
  add column if not exists to_class_id uuid references public.classes(id) on delete set null;

alter table public.ops_word_retests
  add column if not exists teacher_catalog_id uuid references public.teacher_catalogs(id) on delete set null;

create index if not exists ops_transfer_details_from_class_id_idx
  on public.ops_transfer_details(from_class_id);

create index if not exists ops_transfer_details_to_class_id_idx
  on public.ops_transfer_details(to_class_id);

create index if not exists ops_word_retests_teacher_catalog_id_idx
  on public.ops_word_retests(teacher_catalog_id);
