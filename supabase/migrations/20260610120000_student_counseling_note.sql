alter table public.students
  add column if not exists counseling_note text not null default '';

create index if not exists students_counseling_note_idx
  on public.students (id)
  where btrim(counseling_note) <> '';
