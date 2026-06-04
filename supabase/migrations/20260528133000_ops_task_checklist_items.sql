alter table public.ops_tasks
  add column if not exists checklist_items jsonb not null default '[]'::jsonb;

do $$
begin
  alter table public.ops_tasks
    add constraint ops_tasks_checklist_items_array_check
      check (jsonb_typeof(checklist_items) = 'array');
exception
  when duplicate_object then null;
end $$;
