begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create schema if not exists dashboard_private;

-- A preview is an expiring audit receipt. It intentionally stores no full
-- recipient number, rendered message body, or provider payload.
create table public.ops_registration_customer_message_previews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete restrict,
  track_id uuid references public.ops_registration_subject_tracks(id) on delete restrict,
  appointment_id uuid references public.ops_registration_appointments(id) on delete restrict,
  message_kind text not null
    constraint ops_registration_customer_message_previews_message_kind_check
    check (message_kind in ('level_test_booking', 'visit_consultation_booking', 'appointment_reminder', 'waiting_notice', 'admission_application')),
  source_fingerprint text not null check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  source_revision bigint,
  recipient_hash text not null check (recipient_hash ~ '^[a-f0-9]{64}$'),
  recipient_last4 text not null
    constraint ops_registration_customer_message_previews_last4_check
    check (recipient_last4 ~ '^[0-9]{4}$'),
  template_key text not null,
  template_revision integer not null check (template_revision > 0),
  template_checksum text not null check (template_checksum ~ '^[a-f0-9]{64}$'),
  rendered_variables_checksum text not null
    check (rendered_variables_checksum ~ '^[a-f0-9]{64}$'),
  rendered_body_checksum text not null check (rendered_body_checksum ~ '^[a-f0-9]{64}$'),
  rendered_buttons_checksum text not null
    check (rendered_buttons_checksum ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  consumed_at timestamptz,
  constraint ops_registration_customer_message_previews_hashes_check check (
    source_fingerprint ~ '^[a-f0-9]{64}$'
    and recipient_hash ~ '^[a-f0-9]{64}$'
    and template_checksum ~ '^[a-f0-9]{64}$'
    and rendered_variables_checksum ~ '^[a-f0-9]{64}$'
    and rendered_body_checksum ~ '^[a-f0-9]{64}$'
    and rendered_buttons_checksum ~ '^[a-f0-9]{64}$'
  ),
  constraint ops_registration_customer_message_previews_template_check check (
    template_key = message_kind
    and template_revision > 0
  ),
  constraint ops_registration_customer_message_previews_source_shape_check check (
    (
      message_kind in ('level_test_booking', 'visit_consultation_booking', 'appointment_reminder')
      and appointment_id is not null
      and track_id is null
    )
    or (
      message_kind = 'waiting_notice'
      and track_id is not null
      and appointment_id is null
    )
    or (
      message_kind = 'admission_application'
      and track_id is null
      and appointment_id is null
    )
  ),
  constraint ops_registration_customer_message_previews_expiry_check check (
    expires_at = (created_at + interval '15 minutes')
    and (consumed_at is null or consumed_at >= created_at)
  )
);

create index ops_registration_customer_message_previews_open_expiry_idx
  on public.ops_registration_customer_message_previews(expires_at)
  where consumed_at is null;

create index ops_registration_customer_message_previews_actor_expiry_idx
  on public.ops_registration_customer_message_previews(created_by, expires_at);

create index ops_registration_customer_message_previews_task_created_idx
  on public.ops_registration_customer_message_previews(task_id, created_at desc);

create index ops_registration_customer_message_previews_appointment_idx
  on public.ops_registration_customer_message_previews(
    appointment_id,
    message_kind,
    created_at desc
  )
  where appointment_id is not null;

create index ops_registration_customer_message_previews_track_idx
  on public.ops_registration_customer_message_previews(
    track_id,
    message_kind,
    created_at desc
  )
  where track_id is not null;

-- The outbox permanently owns the dedupe key. A provider attempt may cross the
-- network boundary only after its one-way attempt marker has been committed.
create table public.ops_registration_customer_messages (
  id uuid primary key default gen_random_uuid(),
  preview_id uuid not null unique
    references public.ops_registration_customer_message_previews(id) on delete restrict,
  task_id uuid not null references public.ops_tasks(id) on delete restrict,
  track_id uuid references public.ops_registration_subject_tracks(id) on delete restrict,
  appointment_id uuid references public.ops_registration_appointments(id) on delete restrict,
  message_kind text not null
    constraint ops_registration_customer_messages_message_kind_check
    check (message_kind in ('level_test_booking', 'visit_consultation_booking', 'appointment_reminder', 'waiting_notice', 'admission_application')),
  source_fingerprint text not null check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  source_revision bigint,
  recipient_hash text not null check (recipient_hash ~ '^[a-f0-9]{64}$'),
  recipient_last4 text not null,
  template_key text not null,
  template_revision integer not null check (template_revision > 0),
  template_checksum text not null check (template_checksum ~ '^[a-f0-9]{64}$'),
  rendered_variables_checksum text not null
    check (rendered_variables_checksum ~ '^[a-f0-9]{64}$'),
  rendered_body_checksum text not null check (rendered_body_checksum ~ '^[a-f0-9]{64}$'),
  rendered_buttons_checksum text not null
    check (rendered_buttons_checksum ~ '^[a-f0-9]{64}$'),
  dedupe_key text not null unique check (dedupe_key ~ '^[a-f0-9]{64}$'),
  request_key text not null unique check (nullif(btrim(request_key), '') is not null),
  status text not null default 'pending'
    constraint ops_registration_customer_messages_status_check
    check (status in ('pending', 'accepted', 'unknown', 'failed_hold')),
  claim_active boolean not null default false,
  claim_token uuid,
  claim_owner_id uuid references public.profiles(id) on delete restrict,
  claim_expires_at timestamptz,
  claim_release_reason text,
  dispatch_token uuid not null unique,
  provider_attempt_started_at timestamptz,
  provider_attempt_count integer not null default 0
    check (provider_attempt_count in (0, 1)),
  provider_message_id text,
  provider_group_id text,
  provider_status_code text,
  provider_status_message text,
  provider_evidence jsonb not null default '{}'::jsonb,
  error_code text,
  confirmed_by uuid not null references public.profiles(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  resolution_source text,
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_registration_customer_messages_hashes_check check (
    source_fingerprint ~ '^[a-f0-9]{64}$'
    and recipient_hash ~ '^[a-f0-9]{64}$'
    and template_checksum ~ '^[a-f0-9]{64}$'
    and rendered_variables_checksum ~ '^[a-f0-9]{64}$'
    and rendered_body_checksum ~ '^[a-f0-9]{64}$'
    and rendered_buttons_checksum ~ '^[a-f0-9]{64}$'
    and dedupe_key ~ '^[a-f0-9]{64}$'
  ),
  constraint ops_registration_customer_messages_recipient_last4_check check (
    recipient_last4 ~ '^[0-9]{4}$'
  ),
  constraint ops_registration_customer_messages_template_check check (
    template_key = message_kind
    and template_revision > 0
  ),
  constraint ops_registration_customer_messages_source_shape_check check (
    (
      message_kind in ('level_test_booking', 'visit_consultation_booking', 'appointment_reminder')
      and appointment_id is not null
      and track_id is null
    )
    or (
      message_kind = 'waiting_notice'
      and track_id is not null
      and appointment_id is null
    )
    or (
      message_kind = 'admission_application'
      and track_id is null
      and appointment_id is null
    )
  ),
  constraint ops_registration_customer_messages_attempt_marker_check check (
    (
      provider_attempt_count = 0
      and provider_attempt_started_at is null
    )
    or (
      provider_attempt_count = 1
      and provider_attempt_started_at is not null
    )
  ),
  constraint ops_registration_customer_messages_terminal_attempt_check check (
    (
      status in ('accepted', 'unknown', 'failed_hold')
      and provider_attempt_count = 1
    )
    or status = 'pending'
  ),
  constraint ops_registration_customer_messages_claim_shape_check check (
    (
      claim_active
      and status = 'pending'
      and claim_token is not null
      and claim_owner_id is not null
      and claim_expires_at is not null
      and claim_expires_at > confirmed_at
      and claim_release_reason is null
    )
    or (
      not claim_active
      and claim_token is null
      and claim_owner_id is null
      and claim_expires_at is null
      and (
        claim_release_reason is null
        or nullif(btrim(claim_release_reason), '') is not null
      )
    )
  ),
  constraint ops_registration_customer_messages_provider_evidence_check check (
    jsonb_typeof(provider_evidence) = 'object'
    and provider_evidence - array[
      'providerMessageId',
      'providerGroupId',
      'statusCode',
      'statusMessage',
      'errorCode',
      'observedAt',
      'requestKeyMatched'
    ]::text[] = '{}'::jsonb
  ),
  constraint ops_registration_customer_messages_resolution_source_check check (
    resolution_source is null
    or resolution_source in (
      'provider_send',
      'provider_check',
      'admin_reconcile',
      'marker_recovery'
    )
  ),
  constraint ops_registration_customer_messages_resolution_shape_check check (
    (
      status = 'pending'
      and resolution_source is null
      and resolved_by is null
      and resolved_at is null
    )
    or (
      status in ('accepted', 'unknown', 'failed_hold')
      and resolution_source is not null
      and resolved_at is not null
    )
  ),
  constraint ops_registration_customer_messages_timestamps_check check (
    updated_at >= created_at
    and confirmed_at >= created_at
    and (
      provider_attempt_started_at is null
      or provider_attempt_started_at >= created_at
    )
    and (resolved_at is null or resolved_at >= created_at)
  )
);

create index ops_registration_customer_messages_task_kind_created_idx
  on public.ops_registration_customer_messages(task_id, message_kind, created_at desc);

create index ops_registration_customer_messages_appointment_idx
  on public.ops_registration_customer_messages(
    appointment_id,
    message_kind,
    created_at desc
  )
  where appointment_id is not null;

create index ops_registration_customer_messages_track_idx
  on public.ops_registration_customer_messages(track_id, message_kind, created_at desc)
  where track_id is not null;

create index ops_registration_customer_messages_unresolved_attempt_idx
  on public.ops_registration_customer_messages(status, provider_attempt_started_at)
  where status in ('pending', 'unknown');

create index ops_registration_customer_messages_active_claim_expiry_idx
  on public.ops_registration_customer_messages(claim_expires_at)
  where claim_active;

create index ops_registration_customer_messages_provider_message_idx
  on public.ops_registration_customer_messages(provider_message_id)
  where provider_message_id is not null;

create table dashboard_private.registration_customer_solapi_template_receipts (
  message_kind text primary key check (message_kind in (
    'level_test_booking',
    'visit_consultation_booking',
    'appointment_reminder',
    'waiting_notice',
    'admission_application'
  )),
  template_id text not null check (nullif(btrim(template_id), '') is not null),
  pf_id text not null check (nullif(btrim(pf_id), '') is not null),
  catalog_checksum text not null check (catalog_checksum ~ '^[a-f0-9]{64}$'),
  provider_checksum text not null check (provider_checksum ~ '^[a-f0-9]{64}$'),
  provider_status text not null
    constraint registration_customer_solapi_template_receipts_sendable_check
    check (
      provider_status = 'sendable'
      and catalog_checksum = provider_checksum
    ),
  verified_by uuid not null references public.profiles(id) on delete restrict,
  verified_at timestamptz not null default now()
);

create table dashboard_private.registration_customer_solapi_activation (
  message_kind text primary key check (message_kind in (
    'level_test_booking',
    'visit_consultation_booking',
    'appointment_reminder',
    'waiting_notice',
    'admission_application'
  )),
  mode text not null default 'off'
    constraint registration_customer_solapi_activation_mode_check
    check (mode in ('off', 'verification', 'live')),
  verification_task_id uuid references public.ops_tasks(id) on delete restrict,
  verification_recipient_hash text
    check (
      verification_recipient_hash is null
      or verification_recipient_hash ~ '^[a-f0-9]{64}$'
    ),
  live_test_message_id uuid
    references public.ops_registration_customer_messages(id) on delete restrict,
  live_test_confirmed_at timestamptz,
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint registration_customer_solapi_activation_shape_check check (
    (
      mode = 'off'
      and verification_task_id is null
      and verification_recipient_hash is null
      and (
        (live_test_message_id is null and live_test_confirmed_at is null)
        or (live_test_message_id is not null and live_test_confirmed_at is not null)
      )
    )
    or (
      mode = 'verification'
      and verification_task_id is not null
      and verification_recipient_hash is not null
      and updated_by is not null
      and (
        (live_test_message_id is null and live_test_confirmed_at is null)
        or (live_test_message_id is not null and live_test_confirmed_at is not null)
      )
    )
    or (
      mode = 'live'
      and verification_task_id is not null
      and verification_recipient_hash is not null
      and live_test_message_id is not null
      and live_test_confirmed_at is not null
      and updated_by is not null
    )
  )
);

insert into dashboard_private.registration_customer_solapi_activation (message_kind, mode)
values
  ('level_test_booking', 'off'),
  ('visit_consultation_booking', 'off'),
  ('appointment_reminder', 'off'),
  ('waiting_notice', 'off'),
  ('admission_application', 'off')
on conflict (message_kind) do nothing;

create trigger set_updated_at_ops_registration_customer_messages
before update on public.ops_registration_customer_messages
for each row execute function public.set_updated_at();

create trigger set_updated_at_registration_customer_solapi_activation
before update on dashboard_private.registration_customer_solapi_activation
for each row execute function public.set_updated_at();

alter table public.ops_registration_customer_message_previews enable row level security;
alter table public.ops_registration_customer_messages enable row level security;
alter table dashboard_private.registration_customer_solapi_template_receipts enable row level security;
alter table dashboard_private.registration_customer_solapi_activation enable row level security;

revoke all on table public.ops_registration_customer_message_previews
  from public, anon, authenticated, service_role;
revoke all on table public.ops_registration_customer_messages
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.registration_customer_solapi_template_receipts
  from public, anon, authenticated, service_role;
revoke all on table dashboard_private.registration_customer_solapi_activation
  from public, anon, authenticated, service_role;

commit;
