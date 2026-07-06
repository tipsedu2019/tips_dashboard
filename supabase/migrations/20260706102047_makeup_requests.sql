create extension if not exists pgcrypto;

create table if not exists public.makeup_requests (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'approval_pending'
    check (status in ('approval_pending', 'revision_requested', 'rejected', 'manager_pending', 'completed', 'canceled')),
  subject text not null,
  approval_group text not null
    check (approval_group in ('math_middle', 'math_high', 'english', 'unknown')),
  requester_id uuid references public.profiles(id) on delete set null,
  teacher_catalog_id uuid references public.teacher_catalogs(id) on delete set null,
  teacher_profile_id uuid references public.profiles(id) on delete set null,
  class_id uuid references public.classes(id) on delete set null,
  class_name text not null default '',
  reason text not null default '',
  cancel_date date not null,
  makeup_start_at timestamptz not null,
  makeup_end_at timestamptz not null,
  makeup_classroom text not null,
  makeup_slots jsonb not null default '[]'::jsonb,
  approver_teacher_catalog_id uuid references public.teacher_catalogs(id) on delete set null,
  approver_profile_id uuid references public.profiles(id) on delete set null,
  returned_reason text,
  rejected_reason text,
  final_note text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  canceled_by uuid references public.profiles(id) on delete set null,
  canceled_at timestamptz,
  schedule_plan_before jsonb,
  schedule_plan_after jsonb,
  cancel_academic_event_id uuid,
  makeup_academic_event_id uuid,
  makeup_academic_event_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_requests_time_check check (makeup_end_at > makeup_start_at)
);

create table if not exists public.makeup_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.makeup_requests(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null default auth.uid(),
  event_type text not null,
  field_name text,
  before_value text,
  after_value text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.dashboard_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid references public.profiles(id) on delete cascade,
  recipient_team text,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  type text not null default 'makeup_request',
  title text not null,
  body text,
  href text,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dashboard_notifications_recipient_check check (
    recipient_profile_id is not null or recipient_team is not null
  )
);

create index if not exists makeup_requests_status_idx on public.makeup_requests(status);
create index if not exists makeup_requests_requester_idx on public.makeup_requests(requester_id);
create index if not exists makeup_requests_teacher_profile_idx on public.makeup_requests(teacher_profile_id);
create index if not exists makeup_requests_approver_idx on public.makeup_requests(approver_profile_id);
create index if not exists makeup_requests_class_idx on public.makeup_requests(class_id);
create index if not exists makeup_requests_makeup_time_idx on public.makeup_requests(makeup_start_at, makeup_end_at);
create index if not exists makeup_requests_room_idx on public.makeup_requests(makeup_classroom);
create index if not exists makeup_request_events_request_idx on public.makeup_request_events(request_id, created_at desc);
create index if not exists dashboard_notifications_recipient_idx
  on public.dashboard_notifications(recipient_profile_id, read_at, created_at desc);
create index if not exists dashboard_notifications_team_idx
  on public.dashboard_notifications(recipient_team, read_at, created_at desc);

create or replace function public.set_makeup_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_makeup_requests_updated_at on public.makeup_requests;
create trigger set_makeup_requests_updated_at
before update on public.makeup_requests
for each row execute function public.set_makeup_requests_updated_at();

alter table public.makeup_requests enable row level security;
alter table public.makeup_request_events enable row level security;
alter table public.dashboard_notifications enable row level security;

revoke all on public.makeup_requests from anon;
revoke all on public.makeup_request_events from anon;
revoke all on public.dashboard_notifications from anon;

grant select, insert, update on public.makeup_requests to authenticated;
grant select, insert on public.makeup_request_events to authenticated;
grant select, insert, update on public.dashboard_notifications to authenticated;

drop policy if exists makeup_requests_select_involved_or_manager on public.makeup_requests;
create policy makeup_requests_select_involved_or_manager
  on public.makeup_requests
  for select
  to authenticated
  using (
    public.current_dashboard_role() in ('admin', 'staff')
    or requester_id = auth.uid()
    or teacher_profile_id = auth.uid()
    or approver_profile_id = auth.uid()
  );

drop policy if exists makeup_requests_insert_requester_or_manager on public.makeup_requests;
create policy makeup_requests_insert_requester_or_manager
  on public.makeup_requests
  for insert
  to authenticated
  with check (
    requester_id = auth.uid()
    or public.current_dashboard_role() in ('admin', 'staff')
  );

drop policy if exists makeup_requests_update_involved_or_manager on public.makeup_requests;
create policy makeup_requests_update_involved_or_manager
  on public.makeup_requests
  for update
  to authenticated
  using (
    public.current_dashboard_role() in ('admin', 'staff')
    or requester_id = auth.uid()
    or teacher_profile_id = auth.uid()
    or approver_profile_id = auth.uid()
  )
  with check (
    public.current_dashboard_role() in ('admin', 'staff')
    or requester_id = auth.uid()
    or teacher_profile_id = auth.uid()
    or approver_profile_id = auth.uid()
  );

drop policy if exists makeup_request_events_select_parent on public.makeup_request_events;
create policy makeup_request_events_select_parent
  on public.makeup_request_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.makeup_requests request
      where request.id = request_id
    )
  );

drop policy if exists makeup_request_events_insert_parent on public.makeup_request_events;
create policy makeup_request_events_insert_parent
  on public.makeup_request_events
  for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1
      from public.makeup_requests request
      where request.id = request_id
    )
  );

drop policy if exists dashboard_notifications_select_recipient on public.dashboard_notifications;
create policy dashboard_notifications_select_recipient
  on public.dashboard_notifications
  for select
  to authenticated
  using (
    recipient_profile_id = auth.uid()
    or (recipient_team = '관리팀' and public.current_dashboard_role() in ('admin', 'staff'))
    or public.current_dashboard_role() in ('admin', 'staff')
  );

drop policy if exists dashboard_notifications_insert_authenticated on public.dashboard_notifications;
create policy dashboard_notifications_insert_authenticated
  on public.dashboard_notifications
  for insert
  to authenticated
  with check (true);

drop policy if exists dashboard_notifications_update_recipient on public.dashboard_notifications;
create policy dashboard_notifications_update_recipient
  on public.dashboard_notifications
  for update
  to authenticated
  using (
    recipient_profile_id = auth.uid()
    or (recipient_team = '관리팀' and public.current_dashboard_role() in ('admin', 'staff'))
    or public.current_dashboard_role() in ('admin', 'staff')
  )
  with check (
    recipient_profile_id = auth.uid()
    or (recipient_team = '관리팀' and public.current_dashboard_role() in ('admin', 'staff'))
    or public.current_dashboard_role() in ('admin', 'staff')
  );
