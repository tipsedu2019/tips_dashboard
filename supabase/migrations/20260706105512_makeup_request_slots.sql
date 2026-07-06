alter table public.makeup_requests
  add column if not exists makeup_slots jsonb not null default '[]'::jsonb,
  add column if not exists makeup_academic_event_ids jsonb not null default '[]'::jsonb;
