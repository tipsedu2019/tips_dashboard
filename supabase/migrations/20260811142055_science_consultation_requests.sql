create table public.science_consultation_requests (
  id uuid primary key default gen_random_uuid(),
  parent_name text not null,
  phone text not null,
  student_grade text not null,
  interest_area text not null,
  preferred_time text,
  message text,
  privacy_consent boolean not null,
  consent_version text not null default '2026-08-11',
  source_domain text not null default 'science.tipsedu.co.kr',
  status text not null default 'new',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '6 months'),

  constraint science_consultation_parent_name_check
    check (parent_name = btrim(parent_name) and char_length(parent_name) between 2 and 40),
  constraint science_consultation_phone_check
    check (phone ~ '^0[0-9]{8,10}$'),
  constraint science_consultation_grade_check
    check (student_grade = btrim(student_grade) and char_length(student_grade) between 1 and 30),
  constraint science_consultation_interest_check
    check (interest_area = btrim(interest_area) and char_length(interest_area) between 1 and 50),
  constraint science_consultation_preferred_time_check
    check (preferred_time is null or (preferred_time = btrim(preferred_time) and char_length(preferred_time) between 1 and 100)),
  constraint science_consultation_message_check
    check (message is null or char_length(message) <= 2000),
  constraint science_consultation_consent_check
    check (privacy_consent is true),
  constraint science_consultation_source_check
    check (source_domain = 'science.tipsedu.co.kr'),
  constraint science_consultation_status_check
    check (status in ('new', 'contacted', 'closed'))
);

comment on table public.science_consultation_requests is
  'Parent consultation requests submitted from science.tipsedu.co.kr. Retained for six months.';
comment on column public.science_consultation_requests.phone is
  'Normalized Korean contact number containing digits only.';
comment on column public.science_consultation_requests.expires_at is
  'Automatic deletion deadline: six calendar months after submission.';

create index science_consultation_requests_created_at_idx
  on public.science_consultation_requests (created_at desc);

create index science_consultation_requests_status_created_at_idx
  on public.science_consultation_requests (status, created_at desc);

create index science_consultation_requests_expires_at_idx
  on public.science_consultation_requests (expires_at);

alter table public.science_consultation_requests enable row level security;

revoke all on table public.science_consultation_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.science_consultation_requests to service_role;

select cron.schedule(
  'science-consultation-retention-6m',
  '17 3 * * *',
  $cron$
    delete from public.science_consultation_requests
    where expires_at <= now();
  $cron$
);