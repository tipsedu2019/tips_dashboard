alter table public.ops_registration_details
  drop constraint if exists ops_registration_details_pipeline_status_check;

update public.ops_registration_details
set pipeline_status = case pipeline_status
  when '1. 레벨테스트 신청' then '1. 레벨테스트 예약'
  when '2. 상담 신청' then '2. 상담 예약'
  when '3. 상담 완료 (7일 동안 기다리는 중)' then '3. 상담 완료'
  when '5. 등록 신청' then '5. 입학 등록 결정'
  when '6. 수납 진행 중' then '6. 수납 확인'
  else pipeline_status
end;

alter table public.ops_registration_details
  alter column pipeline_status set default '0. 등록 문의',
  add constraint registration_pipeline_status_check
  check (
    pipeline_status in (
      '0. 등록 문의',
      '1. 레벨테스트 예약',
      '1-1. 레벨테스트 완료',
      '2. 상담 예약',
      '3. 상담 완료',
      '4-1. 현재반 대기 신청',
      '4-2. 신규반 대기 신청',
      '4-3. 다음 개강 알림 요청',
      '5. 입학 등록 결정',
      '5-1. 입학신청서 발송 완료',
      '6. 수납 확인',
      '7. 등록 완료',
      '8. 미등록',
      '9. 문의만'
    )
  );

create table if not exists public.ops_registration_messages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  template_key text not null check (template_key in ('admission_application')),
  request_key text not null unique,
  status text not null check (status in ('pending', 'accepted', 'failed')),
  recipient_last4 text check (recipient_last4 is null or recipient_last4 ~ '^[0-9]{4}$'),
  provider_message_id text,
  provider_group_id text,
  provider_status_code text,
  provider_status_message text,
  error_message text,
  sent_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ops_registration_messages
  add column if not exists updated_at timestamptz not null default now();

alter table public.ops_registration_messages
  drop constraint if exists ops_registration_messages_status_check;

alter table public.ops_registration_messages
  add constraint ops_registration_messages_status_check
  check (status in ('pending', 'accepted', 'failed'));

create index if not exists ops_registration_messages_task_created_idx
  on public.ops_registration_messages(task_id, created_at desc);

alter table public.ops_registration_messages enable row level security;

grant select on public.ops_registration_messages to authenticated;

drop policy if exists ops_registration_messages_select on public.ops_registration_messages;
create policy ops_registration_messages_select
  on public.ops_registration_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.ops_tasks task
      where task.id = task_id
        and (
          public.current_dashboard_role() in ('admin', 'staff')
          or task.requested_by = auth.uid()
          or task.assignee_id = auth.uid()
          or task.secondary_assignee_id = auth.uid()
        )
    )
  );
