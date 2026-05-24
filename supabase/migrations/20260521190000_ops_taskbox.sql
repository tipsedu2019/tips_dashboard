create extension if not exists pgcrypto;

create table if not exists public.ops_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null check (type in ('registration', 'withdrawal', 'transfer', 'word_retest', 'textbook', 'general')),
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'in_progress', 'done', 'on_hold', 'canceled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  requested_by uuid references public.profiles(id) on delete set null default auth.uid(),
  assignee_id uuid references public.profiles(id) on delete set null,
  secondary_assignee_id uuid references public.profiles(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  class_id uuid references public.classes(id) on delete set null,
  textbook_id uuid references public.textbooks(id) on delete set null,
  student_name text,
  class_name text,
  textbook_title text,
  campus text check (campus is null or campus in ('본관', '별관')),
  subject text,
  due_at timestamptz,
  completed_at timestamptz,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ops_registration_details (
  task_id uuid primary key references public.ops_tasks(id) on delete cascade,
  inquiry_channel text,
  inquiry_at timestamptz,
  school_grade text,
  school_name text,
  parent_phone text,
  student_phone text,
  level_test_at timestamptz,
  level_test_place text,
  level_test_material_link text,
  counselor text,
  consultation_at timestamptz,
  class_start_date date,
  class_start_session text,
  textbook_ready boolean not null default false,
  admission_notice_sent boolean not null default false,
  payment_checked boolean not null default false,
  makeedu_registered boolean not null default false,
  request_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ops_withdrawal_details (
  task_id uuid primary key references public.ops_tasks(id) on delete cascade,
  school_grade text,
  teacher_name text,
  withdrawal_date date,
  withdrawal_session text,
  customer_reason text,
  teacher_opinion text,
  undistributed_textbooks text,
  completed_lesson_hours numeric(8,2),
  four_week_lesson_hours numeric(8,2),
  timetable_roster_updated boolean not null default false,
  makeedu_withdrawal_done boolean not null default false,
  fee_processed boolean not null default false,
  textbook_fee_processed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ops_transfer_details (
  task_id uuid primary key references public.ops_tasks(id) on delete cascade,
  transfer_reason text,
  from_teacher_name text,
  to_teacher_name text,
  from_class_name text,
  to_class_name text,
  from_class_end_date date,
  from_class_end_session text,
  to_class_start_date date,
  to_class_start_session text,
  from_undistributed_textbooks text,
  to_undistributed_textbooks text,
  timetable_roster_updated boolean not null default false,
  makeedu_transfer_done boolean not null default false,
  fee_processed boolean not null default false,
  textbook_fee_processed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ops_word_retests (
  task_id uuid primary key references public.ops_tasks(id) on delete cascade,
  branch text not null default '본관' check (branch in ('본관', '별관')),
  teacher_name text,
  class_name text,
  student_name text,
  test_at timestamptz,
  textbook_name text,
  unit text,
  request_note text,
  first_score numeric(8,2),
  second_score numeric(8,2),
  third_score numeric(8,2),
  retest_status text not null default 'not_started' check (retest_status in ('not_started', 'in_progress', 'absent', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ops_task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null default auth.uid(),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ops_task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null default auth.uid(),
  event_type text not null,
  field_name text,
  before_value text,
  after_value text,
  created_at timestamptz not null default now()
);

create table if not exists public.ops_task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  file_name text not null,
  file_kind text,
  drive_file_id text,
  drive_link text not null,
  uploaded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  uploaded_at timestamptz not null default now()
);

create index if not exists ops_tasks_type_status_idx on public.ops_tasks(type, status);
create index if not exists ops_tasks_due_at_idx on public.ops_tasks(due_at) where due_at is not null;
create index if not exists ops_tasks_assignee_id_idx on public.ops_tasks(assignee_id) where assignee_id is not null;
create index if not exists ops_tasks_secondary_assignee_id_idx on public.ops_tasks(secondary_assignee_id) where secondary_assignee_id is not null;
create index if not exists ops_tasks_requested_by_idx on public.ops_tasks(requested_by) where requested_by is not null;
create index if not exists ops_word_retests_test_at_idx on public.ops_word_retests(test_at) where test_at is not null;

drop trigger if exists set_updated_at_ops_tasks on public.ops_tasks;
create trigger set_updated_at_ops_tasks
  before update on public.ops_tasks
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_ops_registration_details on public.ops_registration_details;
create trigger set_updated_at_ops_registration_details
  before update on public.ops_registration_details
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_ops_withdrawal_details on public.ops_withdrawal_details;
create trigger set_updated_at_ops_withdrawal_details
  before update on public.ops_withdrawal_details
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_ops_transfer_details on public.ops_transfer_details;
create trigger set_updated_at_ops_transfer_details
  before update on public.ops_transfer_details
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_ops_word_retests on public.ops_word_retests;
create trigger set_updated_at_ops_word_retests
  before update on public.ops_word_retests
  for each row execute function public.set_updated_at();

alter table public.ops_tasks enable row level security;
alter table public.ops_task_comments enable row level security;
alter table public.ops_task_events enable row level security;
alter table public.ops_task_attachments enable row level security;
alter table public.ops_registration_details enable row level security;
alter table public.ops_withdrawal_details enable row level security;
alter table public.ops_transfer_details enable row level security;
alter table public.ops_word_retests enable row level security;

grant select, insert, update, delete on public.ops_tasks to authenticated;
grant select, insert, update, delete on public.ops_task_comments to authenticated;
grant select, insert, update, delete on public.ops_task_events to authenticated;
grant select, insert, update, delete on public.ops_task_attachments to authenticated;
grant select, insert, update, delete on public.ops_registration_details to authenticated;
grant select, insert, update, delete on public.ops_withdrawal_details to authenticated;
grant select, insert, update, delete on public.ops_transfer_details to authenticated;
grant select, insert, update, delete on public.ops_word_retests to authenticated;

drop policy if exists ops_tasks_select on public.ops_tasks;
create policy ops_tasks_select
  on public.ops_tasks
  for select
  to authenticated
  using (
    public.current_dashboard_role() in ('admin', 'staff')
    or requested_by = auth.uid()
    or assignee_id = auth.uid()
    or secondary_assignee_id = auth.uid()
  );

drop policy if exists ops_tasks_insert on public.ops_tasks;
create policy ops_tasks_insert
  on public.ops_tasks
  for insert
  to authenticated
  with check (requested_by is null or requested_by = auth.uid() or public.current_dashboard_role() in ('admin', 'staff'));

drop policy if exists ops_tasks_update on public.ops_tasks;
create policy ops_tasks_update
  on public.ops_tasks
  for update
  to authenticated
  using (
    public.current_dashboard_role() in ('admin', 'staff')
    or requested_by = auth.uid()
    or assignee_id = auth.uid()
    or secondary_assignee_id = auth.uid()
  )
  with check (
    public.current_dashboard_role() in ('admin', 'staff')
    or requested_by = auth.uid()
    or assignee_id = auth.uid()
    or secondary_assignee_id = auth.uid()
  );

drop policy if exists ops_tasks_delete on public.ops_tasks;
create policy ops_tasks_delete
  on public.ops_tasks
  for delete
  to authenticated
  using (public.current_dashboard_role() in ('admin', 'staff'));

drop policy if exists ops_task_comments_select on public.ops_task_comments;
create policy ops_task_comments_select
  on public.ops_task_comments
  for select
  to authenticated
  using (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id));

drop policy if exists ops_task_comments_write on public.ops_task_comments;
create policy ops_task_comments_write
  on public.ops_task_comments
  for insert
  to authenticated
  with check (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id));

drop policy if exists ops_task_attachments_select on public.ops_task_attachments;
create policy ops_task_attachments_select
  on public.ops_task_attachments
  for select
  to authenticated
  using (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id));

drop policy if exists ops_task_attachments_write on public.ops_task_attachments;
create policy ops_task_attachments_write
  on public.ops_task_attachments
  for insert
  to authenticated
  with check (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id));

drop policy if exists ops_task_events_select on public.ops_task_events;
create policy ops_task_events_select
  on public.ops_task_events
  for select
  to authenticated
  using (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id));

drop policy if exists ops_task_events_write on public.ops_task_events;
create policy ops_task_events_write
  on public.ops_task_events
  for insert
  to authenticated
  with check (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id));

do $$
declare
  detail_table regclass;
begin
  foreach detail_table in array array[
    'public.ops_registration_details'::regclass,
    'public.ops_withdrawal_details'::regclass,
    'public.ops_transfer_details'::regclass,
    'public.ops_word_retests'::regclass
  ]
  loop
    execute format('drop policy if exists %I on %s', replace(detail_table::text, '.', '_') || '_select', detail_table);
    execute format(
      'create policy %I on %s for select to authenticated using (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id))',
      replace(detail_table::text, '.', '_') || '_select',
      detail_table
    );

    execute format('drop policy if exists %I on %s', replace(detail_table::text, '.', '_') || '_write', detail_table);
    execute format(
      'create policy %I on %s for all to authenticated using (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id)) with check (exists (select 1 from public.ops_tasks where ops_tasks.id = task_id))',
      replace(detail_table::text, '.', '_') || '_write',
      detail_table
    );
  end loop;
end
$$;
