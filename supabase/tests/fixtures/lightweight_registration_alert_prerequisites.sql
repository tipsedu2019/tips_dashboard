create schema if not exists dashboard_private;

create table public.ops_registration_appointments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  kind text not null check (kind in ('level_test', 'visit_consultation', 'observation_class')),
  scheduled_at timestamptz not null,
  place text not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'canceled')),
  notification_revision integer not null default 1 check (notification_revision > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
