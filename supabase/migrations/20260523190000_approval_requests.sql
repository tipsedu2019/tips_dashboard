create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null default 'monthly_report',
  status text not null default 'draft',
  title text not null,
  requester_id uuid references public.profiles(id) on delete set null,
  approver_id uuid references public.profiles(id) on delete set null,
  subject text not null default 'general',
  template_key text not null default 'free',
  report_month text,
  class_summary text,
  student_issues text,
  next_month_plan text,
  body text,
  checklist_items jsonb not null default '[]'::jsonb,
  attachment_links text,
  memo text,
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_requests_type_check check (request_type in ('monthly_report', 'general')),
  constraint approval_requests_status_check check (status in ('draft', 'submitted', 'reviewing', 'approved', 'returned', 'canceled'))
);

alter table public.approval_requests
  add column if not exists subject text not null default 'general',
  add column if not exists template_key text not null default 'free',
  add column if not exists body text,
  add column if not exists checklist_items jsonb not null default '[]'::jsonb,
  add column if not exists attachment_links text;

create table if not exists public.approval_events (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.approval_requests(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  field_name text,
  before_value text,
  after_value text,
  created_at timestamptz not null default now()
);

create table if not exists public.approval_comments (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.approval_requests(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists approval_requests_status_idx on public.approval_requests(status);
create index if not exists approval_requests_requester_idx on public.approval_requests(requester_id);
create index if not exists approval_requests_approver_idx on public.approval_requests(approver_id);
create index if not exists approval_requests_report_month_idx on public.approval_requests(report_month);
create index if not exists approval_requests_subject_idx on public.approval_requests(subject);
create index if not exists approval_requests_template_key_idx on public.approval_requests(template_key);
create index if not exists approval_events_approval_idx on public.approval_events(approval_id, created_at desc);
create index if not exists approval_comments_approval_idx on public.approval_comments(approval_id, created_at desc);

create or replace function public.set_approval_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_approval_requests_updated_at on public.approval_requests;
create trigger set_approval_requests_updated_at
before update on public.approval_requests
for each row execute function public.set_approval_requests_updated_at();

create or replace function public.write_approval_status_event()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.approval_events(approval_id, actor_id, event_type, field_name, after_value)
    values (new.id, auth.uid(), 'created', 'status', new.status);
  elsif old.status is distinct from new.status then
    insert into public.approval_events(approval_id, actor_id, event_type, field_name, before_value, after_value)
    values (new.id, auth.uid(), 'status_changed', 'status', old.status, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists write_approval_status_event on public.approval_requests;
create trigger write_approval_status_event
after insert or update on public.approval_requests
for each row execute function public.write_approval_status_event();

alter table public.approval_requests enable row level security;
alter table public.approval_events enable row level security;
alter table public.approval_comments enable row level security;

revoke all on public.approval_requests from anon;
revoke all on public.approval_events from anon;
revoke all on public.approval_comments from anon;
grant select, insert, update on public.approval_requests to authenticated;
grant select, insert on public.approval_events to authenticated;
grant select, insert on public.approval_comments to authenticated;

drop policy if exists approval_requests_select_involved_or_admin on public.approval_requests;
create policy approval_requests_select_involved_or_admin
on public.approval_requests
for select
using (
  requester_id = auth.uid()
  or approver_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'staff', 'super_admin', 'manager')
  )
);

drop policy if exists approval_requests_insert_own on public.approval_requests;
create policy approval_requests_insert_own
on public.approval_requests
for insert
with check (
  requester_id = auth.uid()
  or requester_id is null
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'staff', 'super_admin', 'manager')
  )
);

drop policy if exists approval_requests_update_involved_or_admin on public.approval_requests;
create policy approval_requests_update_involved_or_admin
on public.approval_requests
for update
using (
  requester_id = auth.uid()
  or approver_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'staff', 'super_admin', 'manager')
  )
)
with check (
  requester_id = auth.uid()
  or approver_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'staff', 'super_admin', 'manager')
  )
);

drop policy if exists approval_events_select_involved on public.approval_events;
create policy approval_events_select_involved
on public.approval_events
for select
using (
  exists (
    select 1 from public.approval_requests a
    where a.id = approval_id
      and (
        a.requester_id = auth.uid()
        or a.approver_id = auth.uid()
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and p.role in ('admin', 'staff', 'super_admin', 'manager')
        )
      )
  )
);

drop policy if exists approval_events_insert_involved on public.approval_events;
create policy approval_events_insert_involved
on public.approval_events
for insert
with check (
  actor_id = auth.uid()
  and exists (
    select 1 from public.approval_requests a
    where a.id = approval_id
      and (
        a.requester_id = auth.uid()
        or a.approver_id = auth.uid()
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and p.role in ('admin', 'staff', 'super_admin', 'manager')
        )
      )
  )
);

drop policy if exists approval_comments_select_involved on public.approval_comments;
create policy approval_comments_select_involved
on public.approval_comments
for select
using (
  exists (
    select 1 from public.approval_requests a
    where a.id = approval_id
      and (
        a.requester_id = auth.uid()
        or a.approver_id = auth.uid()
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and p.role in ('admin', 'staff', 'super_admin', 'manager')
        )
      )
  )
);

drop policy if exists approval_comments_insert_involved on public.approval_comments;
create policy approval_comments_insert_involved
on public.approval_comments
for insert
with check (
  author_id = auth.uid()
  and exists (
    select 1 from public.approval_requests a
    where a.id = approval_id
      and (
        a.requester_id = auth.uid()
        or a.approver_id = auth.uid()
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and p.role in ('admin', 'staff', 'super_admin', 'manager')
        )
      )
  )
);

