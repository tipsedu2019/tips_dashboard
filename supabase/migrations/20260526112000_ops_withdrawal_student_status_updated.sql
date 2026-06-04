alter table public.ops_withdrawal_details
  add column if not exists student_status_updated boolean not null default false;
