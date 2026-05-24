create table if not exists public.approval_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null default 'general',
  body text,
  checklist_items jsonb not null default '[]'::jsonb,
  attachment_links text,
  is_shared boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_templates_subject_check check (subject in ('english', 'math', 'general'))
);

alter table public.approval_templates
  add column if not exists subject text not null default 'general',
  add column if not exists body text,
  add column if not exists checklist_items jsonb not null default '[]'::jsonb,
  add column if not exists attachment_links text,
  add column if not exists is_shared boolean not null default true,
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

create index if not exists approval_templates_subject_idx on public.approval_templates(subject);
create index if not exists approval_templates_created_by_idx on public.approval_templates(created_by);
create index if not exists approval_templates_shared_idx on public.approval_templates(is_shared);

drop trigger if exists set_approval_templates_updated_at on public.approval_templates;
create trigger set_approval_templates_updated_at
before update on public.approval_templates
for each row execute function public.set_approval_requests_updated_at();

alter table public.approval_templates enable row level security;

revoke all on public.approval_templates from anon;
grant select, insert, update, delete on public.approval_templates to authenticated;

drop policy if exists approval_templates_select_shared_or_own on public.approval_templates;
create policy approval_templates_select_shared_or_own
on public.approval_templates
for select
using (
  is_shared = true
  or created_by = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'staff', 'super_admin', 'manager')
  )
);

drop policy if exists approval_templates_insert_own on public.approval_templates;
create policy approval_templates_insert_own
on public.approval_templates
for insert
with check (
  created_by = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'staff', 'super_admin', 'manager')
  )
);

drop policy if exists approval_templates_update_own_or_admin on public.approval_templates;
create policy approval_templates_update_own_or_admin
on public.approval_templates
for update
using (
  created_by = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'staff', 'super_admin', 'manager')
  )
)
with check (
  created_by = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'staff', 'super_admin', 'manager')
  )
);

drop policy if exists approval_templates_delete_own_or_admin on public.approval_templates;
create policy approval_templates_delete_own_or_admin
on public.approval_templates
for delete
using (
  created_by = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'staff', 'super_admin', 'manager')
  )
);
