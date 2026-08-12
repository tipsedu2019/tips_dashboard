begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- The old primary key is also the old job identity.  Backfill before removing
-- either side of the scheduled-message relationship so existing jobs survive
-- this migration unchanged.
alter table dashboard_private.registration_customer_reminder_jobs
  add column job_id uuid,
  add column message_kind text,
  add column observation_id uuid references public.ops_registration_observations(id) on delete restrict,
  add column source_event_id uuid references dashboard_private.registration_observation_domain_events(event_id) on delete restrict,
  add column booking_fact_hash text,
  add column session_source_revision jsonb,
  add column source_refresh_count smallint not null default 0,
  add column activation_mode_snapshot text,
  add column verification_started_at timestamptz,
  add column verification_recipient_hash text;

update dashboard_private.registration_customer_reminder_jobs
set job_id = appointment_id,
    message_kind = 'appointment_reminder'
where job_id is null;

do $$
begin
  if exists (
    select 1 from dashboard_private.registration_customer_reminder_jobs
    where job_id is null or message_kind is null
  ) or exists (
    select job_id
    from dashboard_private.registration_customer_reminder_jobs
    group by job_id having count(*) > 1
  ) then
    raise exception 'registration_customer_reminder_job_backfill_invalid'
      using errcode = '23505';
  end if;
end;
$$;

alter table dashboard_private.registration_customer_reminder_jobs
  add column source_identity uuid generated always as (
    coalesce(observation_id, appointment_id)
  ) stored;

alter table public.ops_registration_customer_messages
  add column scheduled_source_identity uuid generated always as (
    case when delivery_origin = 'scheduled'
      then coalesce(observation_id, appointment_id)
    end
  ) stored;

alter table public.ops_registration_customer_messages
  drop constraint ops_registration_customer_messages_scheduled_job_id_fkey,
  drop constraint ops_registration_customer_messages_origin_shape_check;

alter table dashboard_private.registration_customer_reminder_jobs
  drop constraint registration_customer_reminder_jobs_pkey,
  drop constraint registration_customer_reminder_jobs_status_check,
  drop constraint registration_customer_reminder_jobs_claim_check,
  drop constraint registration_customer_reminder_jobs_message_check,
  drop constraint registration_customer_reminder_jobs_error_check;

-- Old releases allowed these audit outcomes on completed jobs.  Preserve their
-- meaning under the stricter terminal-state model before re-attaching checks.
update dashboard_private.registration_customer_reminder_jobs
set status = 'delivery_unknown',
    last_error_code = 'provider_dispatch_uncertain'
where status = 'completed'
  and last_error_code in ('provider_dispatch_uncertain', 'scheduled_marker_recovery');

alter table dashboard_private.registration_customer_reminder_jobs
  alter column job_id set not null,
  alter column message_kind set not null,
  add constraint registration_customer_reminder_jobs_pkey primary key (job_id),
  add constraint registration_customer_reminder_jobs_kind_check
    check (message_kind in ('appointment_reminder', 'observation_reminder')),
  add constraint registration_customer_reminder_jobs_source_shape_check
    check (
      (
        message_kind = 'appointment_reminder'
        and observation_id is null and source_event_id is null
        and booking_fact_hash is null and session_source_revision is null
        and source_refresh_count = 0 and activation_mode_snapshot is null
        and verification_started_at is null and verification_recipient_hash is null
      )
      or (
        message_kind = 'observation_reminder'
        and observation_id is not null and source_event_id is not null
        and nullif(pg_catalog.btrim(booking_fact_hash), '') is not null
        and session_source_revision is not null
        and source_refresh_count between 0 and 1
        and activation_mode_snapshot in ('verification', 'live')
        and (
          (activation_mode_snapshot = 'verification'
            and verification_started_at is not null
            and verification_recipient_hash ~ '^[a-f0-9]{64}$')
          or (activation_mode_snapshot = 'live'
            and verification_started_at is null
            and verification_recipient_hash is null)
        )
      )
    ),
  add constraint registration_customer_reminder_jobs_session_revision_check
    check (
      session_source_revision is null
      or (
        session_source_revision = pg_catalog.jsonb_build_object(
          'authority', 'normalized',
          'sessionId', session_source_revision ->> 'sessionId',
          'revision', (session_source_revision ->> 'revision')::bigint
        )
        and session_source_revision ->> 'authority' = 'normalized'
        and (session_source_revision ->> 'sessionId')::uuid is not null
        and pg_catalog.jsonb_typeof(session_source_revision -> 'revision') = 'number'
        and (session_source_revision ->> 'revision')::bigint >= 0
      )
      or (
        session_source_revision = pg_catalog.jsonb_build_object(
          'authority', 'legacy',
          'sessionKey', session_source_revision ->> 'sessionKey',
          'contentHash', session_source_revision ->> 'contentHash'
        )
        and session_source_revision ->> 'authority' = 'legacy'
        and nullif(pg_catalog.btrim(session_source_revision ->> 'sessionKey'), '') is not null
        and nullif(pg_catalog.btrim(session_source_revision ->> 'contentHash'), '') is not null
      )
    ),
  add constraint registration_customer_reminder_jobs_status_check
    check (status in (
      'pending', 'claimed', 'dispatching', 'completed', 'canceled',
      'source_dirty', 'delivery_unknown'
    )),
  add constraint registration_customer_reminder_jobs_claim_check check (
    (status = 'claimed' and claim_token is not null and claim_expires_at is not null and message_id is null)
    or (status <> 'claimed' and claim_token is null and claim_expires_at is null)
  ),
  add constraint registration_customer_reminder_jobs_message_check check (
    (status in ('dispatching', 'completed', 'delivery_unknown') and message_id is not null)
    or (status not in ('dispatching', 'completed', 'delivery_unknown') and message_id is null)
  ),
  add constraint registration_customer_reminder_jobs_error_check check (
    (status = 'pending' and (
      last_error_code is null or (
        nullif(pg_catalog.btrim(last_error_code), '') is not null
        and pg_catalog.octet_length(last_error_code) <= 120
      )
    ))
    or (status in ('claimed', 'dispatching') and last_error_code is null)
    or (status = 'completed' and (last_error_code is null or last_error_code in ('provider_rejected', 'duplicate_locked')))
    or (status = 'canceled' and nullif(pg_catalog.btrim(last_error_code), '') is not null)
    or (status = 'source_dirty' and last_error_code in ('booking_fact_changed', 'source_revision_unstable'))
    or (status = 'delivery_unknown' and last_error_code = 'provider_dispatch_uncertain')
  ),
  add constraint registration_customer_reminder_jobs_job_source_key
    unique (job_id, appointment_id, message_kind, source_revision, source_identity);

create unique index registration_customer_reminder_jobs_appointment_revision_once_idx
  on dashboard_private.registration_customer_reminder_jobs(appointment_id, source_revision, message_kind)
  where message_kind = 'appointment_reminder';
create unique index registration_customer_reminder_jobs_observation_revision_once_idx
  on dashboard_private.registration_customer_reminder_jobs(observation_id, source_revision, message_kind)
  where message_kind = 'observation_reminder';

alter table public.ops_registration_customer_messages
  add constraint ops_registration_customer_messages_origin_shape_check check (
    (
      delivery_origin = 'manual'
      and preview_id is not null and confirmed_by is not null
      and scheduled_job_id is null and scheduled_source_identity is null
      and scheduled_for is null and message_kind <> 'observation_reminder'
    )
    or (
      delivery_origin = 'scheduled'
      and message_kind in ('appointment_reminder', 'observation_reminder')
      and preview_id is null and confirmed_by is null
      and scheduled_job_id is not null and scheduled_source_identity is not null
      and scheduled_for is not null
    )
  ),
  add constraint ops_registration_customer_messages_scheduled_job_source_fkey
  foreign key (scheduled_job_id, appointment_id, message_kind, source_revision, scheduled_source_identity)
  references dashboard_private.registration_customer_reminder_jobs(job_id, appointment_id, message_kind, source_revision, source_identity)
  on delete restrict;

create table dashboard_private.registration_observation_solapi_event_consumptions(
  event_id uuid primary key references dashboard_private.registration_observation_domain_events(event_id) on delete restrict,
  action text not null check (action in ('created', 'replaced', 'canceled', 'skipped_off', 'skipped_scope', 'skipped_lead_time', 'already_terminal')),
  job_id uuid references dashboard_private.registration_customer_reminder_jobs(job_id) on delete restrict,
  consumed_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table dashboard_private.registration_observation_solapi_event_consumptions enable row level security;
revoke all on table dashboard_private.registration_observation_solapi_event_consumptions from public, anon, authenticated, service_role;

create or replace function dashboard_private.sync_registration_customer_reminder_jobs_v1()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_count integer := 0;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501';
  end if;
  update public.ops_registration_customer_messages message
  set status = 'unknown', error_code = 'scheduled_marker_recovery',
      resolution_source = 'scheduled_marker_recovery', resolved_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.registration_customer_reminder_jobs job
  where job.message_kind = 'appointment_reminder' and job.status = 'dispatching' and job.message_id = message.id
    and message.delivery_origin = 'scheduled' and message.status = 'pending' and message.provider_attempt_count = 1
    and message.provider_attempt_started_at <= pg_catalog.clock_timestamp() - interval '15 minutes';
  update dashboard_private.registration_customer_reminder_jobs job
  set status = case when message.status = 'unknown' then 'delivery_unknown' else 'completed' end,
      claim_token = null, claim_expires_at = null,
      last_error_code = case when message.status = 'unknown' then 'provider_dispatch_uncertain' when message.status = 'failed_hold' then 'provider_rejected' else null end
  from public.ops_registration_customer_messages message
  where job.message_kind = 'appointment_reminder' and job.message_id = message.id and job.status = 'dispatching'
    and message.status in ('accepted', 'unknown', 'failed_hold');
  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'pending', claim_token = null, claim_expires_at = null,
      available_at = pg_catalog.clock_timestamp(), last_error_code = 'claim_lease_expired'
  where job.message_kind = 'appointment_reminder' and job.status = 'claimed'
    and job.claim_expires_at <= pg_catalog.clock_timestamp();
  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'canceled', claim_token = null, claim_expires_at = null,
      last_error_code = 'appointment_revision_replaced'
  from public.ops_registration_appointments appointment
  where job.message_kind = 'appointment_reminder'
    and job.appointment_id = appointment.id
    and job.status in ('pending', 'claimed')
    and job.source_revision <> appointment.notification_revision;
  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'canceled', claim_token = null, claim_expires_at = null,
      last_error_code = 'appointment_not_eligible'
  where job.message_kind = 'appointment_reminder' and job.status in ('pending', 'claimed')
    and not exists (
      select 1 from public.ops_registration_appointments appointment
      where appointment.id = job.appointment_id and appointment.task_id = job.task_id
        and appointment.kind in ('level_test', 'visit_consultation') and appointment.status = 'scheduled'
        and appointment.scheduled_at > pg_catalog.clock_timestamp()
    );
  insert into dashboard_private.registration_customer_reminder_jobs(
    job_id, appointment_id, task_id, message_kind, source_revision, scheduled_for,
    due_at, available_at, request_key, status, last_error_code
  )
  select gen_random_uuid(), appointment.id, appointment.task_id, 'appointment_reminder',
    appointment.notification_revision, appointment.scheduled_at,
    appointment.scheduled_at - pg_catalog.make_interval(hours => settings.lead_hours),
    pg_catalog.clock_timestamp(), gen_random_uuid(), 'pending', null
  from public.ops_registration_appointments appointment
  cross join dashboard_private.registration_customer_reminder_settings settings
  where settings.singleton and appointment.kind in ('level_test', 'visit_consultation')
    and appointment.status = 'scheduled' and appointment.scheduled_at > pg_catalog.clock_timestamp()
    and not exists (
      select 1 from public.ops_registration_customer_messages message
      where message.appointment_id = appointment.id and message.message_kind = 'appointment_reminder'
    )
  on conflict (appointment_id, source_revision, message_kind)
    where message_kind = 'appointment_reminder'
  do update set task_id = excluded.task_id, scheduled_for = excluded.scheduled_for,
    due_at = excluded.due_at, available_at = pg_catalog.least(
      dashboard_private.registration_customer_reminder_jobs.available_at, excluded.available_at
    ), last_error_code = null
  where dashboard_private.registration_customer_reminder_jobs.status = 'pending';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
alter function dashboard_private.sync_registration_customer_reminder_jobs_v1() owner to postgres;
revoke all on function dashboard_private.sync_registration_customer_reminder_jobs_v1() from public, anon, authenticated, service_role;

create or replace function public.claim_registration_customer_reminder_job_v1()
returns jsonb language plpgsql volatile security definer set search_path = '' set timezone = 'UTC' as $$
declare v_job dashboard_private.registration_customer_reminder_jobs%rowtype;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501'; end if;
  insert into dashboard_private.registration_customer_reminder_worker_heartbeats(singleton, succeeded_at, updated_at)
  values (true, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())
  on conflict (singleton) do update set succeeded_at = excluded.succeeded_at, updated_at = excluded.updated_at;
  if not (select enabled from dashboard_private.registration_customer_reminder_settings where singleton) then return null; end if;
  perform dashboard_private.sync_registration_customer_reminder_jobs_v1();
  select job.* into v_job from dashboard_private.registration_customer_reminder_jobs job
  join public.ops_registration_appointments appointment on appointment.id = job.appointment_id
  where job.message_kind = 'appointment_reminder' and job.status = 'pending'
    and job.available_at <= pg_catalog.clock_timestamp() and job.due_at <= pg_catalog.clock_timestamp()
    and appointment.status = 'scheduled' and appointment.scheduled_at > pg_catalog.clock_timestamp()
    and appointment.notification_revision = job.source_revision
  order by job.due_at, job.job_id for update of job skip locked limit 1;
  if not found then return null; end if;
  update dashboard_private.registration_customer_reminder_jobs job set status = 'claimed',
    claim_token = gen_random_uuid(), claim_expires_at = pg_catalog.clock_timestamp() + interval '2 minutes', last_error_code = null
  where job.job_id = v_job.job_id returning * into v_job;
  return pg_catalog.jsonb_build_object('jobId', v_job.job_id, 'appointmentId', v_job.appointment_id,
    'claimToken', v_job.claim_token, 'sourceRevision', v_job.source_revision,
    'scheduledFor', v_job.scheduled_for, 'requestKey', v_job.request_key);
end;
$$;
alter function public.claim_registration_customer_reminder_job_v1() owner to postgres;
revoke all on function public.claim_registration_customer_reminder_job_v1() from public, anon, authenticated, service_role;
grant execute on function public.claim_registration_customer_reminder_job_v1() to service_role;

create or replace function public.read_registration_customer_reminder_source_v1(p_job_id uuid, p_claim_token uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_job dashboard_private.registration_customer_reminder_jobs%rowtype;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501'; end if;
  select job.* into v_job from dashboard_private.registration_customer_reminder_jobs job
  where job.job_id = p_job_id and job.message_kind = 'appointment_reminder' and job.status = 'claimed'
    and job.claim_token = p_claim_token and job.claim_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'registration_customer_reminder_claim_invalid' using errcode = '40001'; end if;
  return dashboard_private.resolve_registration_customer_message_source_v1_impl('appointment_reminder', v_job.appointment_id);
end;
$$;
alter function public.read_registration_customer_reminder_source_v1(uuid, uuid) owner to postgres;
revoke all on function public.read_registration_customer_reminder_source_v1(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_registration_customer_reminder_source_v1(uuid, uuid) to service_role;

create or replace function public.release_registration_customer_reminder_job_v1(p_job_id uuid, p_claim_token uuid, p_error_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_error_code text := nullif(pg_catalog.btrim(p_error_code), '');
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501';
  end if;
  if v_error_code is null or pg_catalog.octet_length(v_error_code) > 120 then
    raise exception 'registration_customer_reminder_release_invalid' using errcode = '22023';
  end if;
  update dashboard_private.registration_customer_reminder_jobs job
  set status = case when v_error_code = 'source_ineligible' then 'canceled' else 'pending' end,
    claim_token = null, claim_expires_at = null,
    available_at = case when v_error_code = 'source_ineligible' then null else pg_catalog.clock_timestamp() + interval '5 minutes' end,
    last_error_code = v_error_code
  where job.job_id = p_job_id and job.message_kind = 'appointment_reminder'
    and job.status = 'claimed' and job.claim_token = p_claim_token and job.message_id is null;
  return pg_catalog.jsonb_build_object('released', found, 'jobId', p_job_id);
end;
$$;
alter function public.release_registration_customer_reminder_job_v1(uuid, uuid, text) owner to postgres;
revoke all on function public.release_registration_customer_reminder_job_v1(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.release_registration_customer_reminder_job_v1(uuid, uuid, text) to service_role;

-- Task 2 intentionally leaves observation dispatch ineligible.  These two
-- compatibility entry points preserve the appointment worker contract while
-- pinning all lookups to the new UUID job identity.
create or replace function public.begin_registration_customer_reminder_dispatch_v1(p_job_id uuid, p_claim_token uuid, p_contract jsonb, p_readiness_contract jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_job dashboard_private.registration_customer_reminder_jobs%rowtype;
  v_settings dashboard_private.registration_customer_reminder_settings%rowtype;
  v_activation dashboard_private.registration_customer_solapi_activation%rowtype;
  v_receipt dashboard_private.registration_customer_solapi_template_receipts%rowtype;
  v_live_message public.ops_registration_customer_messages%rowtype;
  v_existing public.ops_registration_customer_messages%rowtype;
  v_source jsonb;
  v_source_facts_checksum text;
  v_message public.ops_registration_customer_messages%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if (select auth.role()) <> 'service_role' then raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501'; end if;
  perform dashboard_private.registration_customer_message_assert_contract_v1(p_contract, 'appointment_reminder');
  if p_readiness_contract is null or pg_catalog.jsonb_typeof(p_readiness_contract) <> 'object'
    or p_readiness_contract - array['credentialsConfigured','pfId','templateId','catalogChecksum','recipientHash','sourceFingerprint','sourceFactsChecksum']::text[] <> '{}'::jsonb
    or not p_readiness_contract ?& array['credentialsConfigured','pfId','templateId','catalogChecksum','recipientHash','sourceFingerprint','sourceFactsChecksum']::text[]
    or coalesce((p_readiness_contract ->> 'credentialsConfigured')::boolean, false) is not true
    or (p_readiness_contract ->> 'catalogChecksum') !~ '^[a-f0-9]{64}$'
    or (p_readiness_contract ->> 'recipientHash') !~ '^[a-f0-9]{64}$'
    or (p_readiness_contract ->> 'sourceFingerprint') !~ '^[a-f0-9]{64}$'
    or (p_readiness_contract ->> 'sourceFactsChecksum') !~ '^[a-f0-9]{64}$' then
    raise exception 'registration_customer_reminder_contract_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('registration-customer-reminder:' || p_job_id::text, 0));
  select job.* into v_job from dashboard_private.registration_customer_reminder_jobs job
  where job.job_id = p_job_id and job.message_kind = 'appointment_reminder' and job.status = 'claimed'
    and job.claim_token = p_claim_token and job.claim_expires_at > v_now for update;
  if not found then raise exception 'registration_customer_reminder_claim_invalid' using errcode = '40001'; end if;
  select settings.* into strict v_settings from dashboard_private.registration_customer_reminder_settings settings where settings.singleton for share;
  if v_settings.enabled is not true or not dashboard_private.registration_customer_reminder_schedule_ready_v1() then
    raise exception 'registration_customer_reminder_not_ready' using errcode = '55000';
  end if;
  select message.* into v_existing from public.ops_registration_customer_messages message
  where message.appointment_id = v_job.appointment_id and message.message_kind = 'appointment_reminder' for update;
  if found then
    update dashboard_private.registration_customer_reminder_jobs job set status = 'completed', claim_token = null, claim_expires_at = null, message_id = v_existing.id, last_error_code = 'duplicate_locked'
    where job.job_id = v_job.job_id;
    return pg_catalog.jsonb_build_object('allowed', false, 'messageId', v_existing.id, 'dispatchToken', v_existing.dispatch_token, 'currentStatus', v_existing.status);
  end if;
  select activation.* into strict v_activation from dashboard_private.registration_customer_solapi_activation activation
  where activation.message_kind = 'appointment_reminder';
  select receipt.* into v_receipt from dashboard_private.registration_customer_solapi_template_receipts receipt
  where receipt.message_kind = 'appointment_reminder';
  if v_activation.mode is distinct from 'live' or v_receipt.message_kind is null
    or v_receipt.provider_status is distinct from 'sendable'
    or v_receipt.catalog_checksum is distinct from v_receipt.provider_checksum
    or v_receipt.catalog_checksum is distinct from p_readiness_contract ->> 'catalogChecksum'
    or v_receipt.template_id is distinct from nullif(pg_catalog.btrim(p_readiness_contract ->> 'templateId'), '')
    or v_receipt.pf_id is distinct from nullif(pg_catalog.btrim(p_readiness_contract ->> 'pfId'), '') then
    raise exception 'registration_customer_reminder_not_ready' using errcode = '55000';
  end if;
  select message.* into v_live_message from public.ops_registration_customer_messages message
  where message.id = v_activation.live_test_message_id and message.status = 'accepted'
    and message.message_kind = 'appointment_reminder' and message.task_id = v_activation.verification_task_id
    and message.recipient_hash = v_activation.verification_recipient_hash and message.template_checksum = v_receipt.catalog_checksum;
  if not found or v_activation.live_test_confirmed_at is null then
    raise exception 'registration_customer_reminder_not_ready' using errcode = '55000';
  end if;
  v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl('appointment_reminder', v_job.appointment_id);
  v_source_facts_checksum := dashboard_private.registration_customer_message_source_facts_checksum_v1(v_source);
  if nullif(v_source ->> 'sourceRevision', '')::bigint is distinct from v_job.source_revision
    or v_source ->> 'parentPhoneDigits' is distinct from p_contract ->> 'parentPhoneDigits'
    or v_source_facts_checksum is distinct from p_readiness_contract ->> 'sourceFactsChecksum'
    or p_contract ->> 'recipientHash' is distinct from p_readiness_contract ->> 'recipientHash'
    or p_contract ->> 'sourceFingerprint' is distinct from p_readiness_contract ->> 'sourceFingerprint'
    or p_contract ->> 'templateChecksum' is distinct from p_readiness_contract ->> 'catalogChecksum' then
    raise exception 'registration_customer_reminder_source_stale' using errcode = '40001';
  end if;
  insert into public.ops_registration_customer_messages(
    preview_id, task_id, track_id, appointment_id, message_kind, source_fingerprint,
    source_facts_checksum, source_revision, recipient_hash, recipient_last4,
    template_key, template_revision, template_checksum, rendered_variables_checksum,
    rendered_body_checksum, rendered_buttons_checksum, dedupe_key, request_key,
    status, claim_active, dispatch_token, provider_attempt_started_at,
    provider_attempt_count, confirmed_by, confirmed_at, delivery_origin,
    scheduled_job_id, scheduled_for
  ) values (
    null, v_job.task_id, null, v_job.appointment_id, 'appointment_reminder',
    p_contract ->> 'sourceFingerprint', v_source_facts_checksum, v_job.source_revision,
    p_contract ->> 'recipientHash', pg_catalog.right(p_contract ->> 'parentPhoneDigits', 4),
    'appointment_reminder', (p_contract ->> 'templateRevision')::integer,
    p_contract ->> 'templateChecksum', p_contract ->> 'renderedVariablesChecksum',
    p_contract ->> 'renderedBodyChecksum', p_contract ->> 'renderedButtonsChecksum',
    dashboard_private.notification_sha256_hex_v1(dashboard_private.notification_canonical_json_v1(
      pg_catalog.jsonb_build_object('messageKind', 'appointment_reminder', 'jobId', v_job.job_id, 'deliveryOrigin', 'scheduled')
    )), v_job.request_key::text, 'pending', false, gen_random_uuid(),
    pg_catalog.clock_timestamp(), 1, null, pg_catalog.clock_timestamp(), 'scheduled',
    v_job.job_id, v_job.scheduled_for
  ) returning * into v_message;
  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'dispatching', claim_token = null, claim_expires_at = null,
      message_id = v_message.id, last_error_code = null
  where job.job_id = v_job.job_id;
  return pg_catalog.jsonb_build_object('allowed', true, 'messageId', v_message.id,
    'dispatchToken', v_message.dispatch_token, 'currentStatus', v_message.status);
exception when unique_violation then
  select message.* into v_existing from public.ops_registration_customer_messages message
  where message.appointment_id = v_job.appointment_id and message.message_kind = 'appointment_reminder';
  if v_existing.id is null then raise; end if;
  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'completed', claim_token = null, claim_expires_at = null,
      message_id = v_existing.id, last_error_code = 'duplicate_locked'
  where job.job_id = p_job_id;
  return pg_catalog.jsonb_build_object('allowed', false, 'messageId', v_existing.id,
    'dispatchToken', v_existing.dispatch_token, 'currentStatus', v_existing.status);
end;
$$;
alter function public.begin_registration_customer_reminder_dispatch_v1(uuid, uuid, jsonb, jsonb) owner to postgres;
revoke all on function public.begin_registration_customer_reminder_dispatch_v1(uuid, uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.begin_registration_customer_reminder_dispatch_v1(uuid, uuid, jsonb, jsonb) to service_role;

create or replace function public.finalize_registration_customer_reminder_dispatch_v1(p_message_id uuid, p_dispatch_token uuid, p_result text, p_provider_result jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_message public.ops_registration_customer_messages%rowtype;
  v_provider_result jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501';
  end if;
  if p_result not in ('accepted', 'failed_hold', 'unknown') then
    raise exception 'registration_customer_reminder_finalize_invalid' using errcode = '22023';
  end if;
  v_provider_result := dashboard_private.registration_customer_message_provider_evidence_v1(p_provider_result);
  select message.* into v_message from public.ops_registration_customer_messages message where message.id = p_message_id for update;
  if not found or v_message.delivery_origin <> 'scheduled' or v_message.message_kind <> 'appointment_reminder'
    or v_message.dispatch_token is distinct from p_dispatch_token or v_message.provider_attempt_count <> 1
    or v_message.provider_attempt_started_at is null then
    raise exception 'registration_customer_reminder_finalize_not_allowed' using errcode = '40001';
  end if;
  if v_message.status in ('accepted', 'unknown', 'failed_hold') then
    return pg_catalog.jsonb_build_object('ok', v_message.status = 'accepted', 'messageId', v_message.id,
      'currentStatus', v_message.status, 'idempotent', true, 'confirmedByName', '자동 발송',
      'confirmedAt', v_message.confirmed_at, 'updatedAt', v_message.updated_at,
      'recipientLast4', v_message.recipient_last4, 'canCheck', false);
  end if;
  update public.ops_registration_customer_messages message
  set status = p_result,
      provider_message_id = v_provider_result ->> 'providerMessageId',
      provider_group_id = v_provider_result ->> 'providerGroupId',
      provider_status_code = v_provider_result ->> 'statusCode',
      provider_status_message = v_provider_result ->> 'statusMessage',
      provider_evidence = v_provider_result,
      error_code = case when p_result = 'failed_hold' then 'provider_rejected' else null end,
      resolution_source = 'scheduled_provider_send', resolved_by = null,
      resolved_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
  where message.id = v_message.id returning * into v_message;
  update dashboard_private.registration_customer_reminder_jobs job set status = case when p_result = 'unknown' then 'delivery_unknown' else 'completed' end,
    claim_token = null, claim_expires_at = null,
    last_error_code = case when p_result = 'failed_hold' then 'provider_rejected' when p_result = 'unknown' then 'provider_dispatch_uncertain' else null end
  where job.job_id = v_message.scheduled_job_id and job.appointment_id = v_message.appointment_id
    and job.message_kind = v_message.message_kind and job.source_revision = v_message.source_revision
    and job.source_identity = v_message.scheduled_source_identity and job.message_id = v_message.id;
  return pg_catalog.jsonb_build_object('ok', v_message.status = 'accepted', 'messageId', v_message.id,
    'currentStatus', v_message.status, 'idempotent', false, 'confirmedByName', '자동 발송',
    'confirmedAt', v_message.confirmed_at, 'updatedAt', v_message.updated_at,
    'recipientLast4', v_message.recipient_last4, 'canCheck', false);
end;
$$;
alter function public.finalize_registration_customer_reminder_dispatch_v1(uuid, uuid, text, jsonb) owner to postgres;
revoke all on function public.finalize_registration_customer_reminder_dispatch_v1(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.finalize_registration_customer_reminder_dispatch_v1(uuid, uuid, text, jsonb) to service_role;

create or replace function dashboard_private.materialize_registration_observation_solapi_events_v1(p_limit integer)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event dashboard_private.registration_observation_domain_events%rowtype;
  v_settings dashboard_private.registration_customer_reminder_settings%rowtype;
  v_activation dashboard_private.registration_customer_solapi_activation%rowtype;
  v_observation public.ops_registration_observations%rowtype;
  v_action text;
  v_job_id uuid;
  v_starts_at timestamptz;
  v_count integer := 0;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_observation_solapi_worker_unauthorized' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'registration_observation_solapi_limit_invalid' using errcode = '22023';
  end if;
  select * into strict v_settings from dashboard_private.registration_customer_reminder_settings where singleton;
  select * into strict v_activation from dashboard_private.registration_customer_solapi_activation where message_kind = 'observation_reminder';
  for v_event in select event.* from dashboard_private.registration_observation_domain_events event
    where not exists (select 1 from dashboard_private.registration_observation_solapi_event_consumptions consumption where consumption.event_id = event.event_id)
    order by event.occurred_at, event.event_id for update of event skip locked limit p_limit
  loop
    v_action := 'already_terminal'; v_job_id := null;
    if v_event.event_kind in ('observation_canceled', 'observation_attendance_recorded', 'observation_no_show', 'observation_feedback_submitted') then
      update dashboard_private.registration_customer_reminder_jobs job set status = 'canceled', claim_token = null, claim_expires_at = null,
        last_error_code = 'observation_terminal'
      where job.observation_id = v_event.observation_id and job.message_kind = 'observation_reminder' and job.status in ('pending', 'claimed');
      v_action := case when found then 'canceled' else 'already_terminal' end;
    else
      select observation.* into v_observation from public.ops_registration_observations observation where observation.id = v_event.observation_id;
      v_starts_at := v_observation.starts_at;
      if v_event.event_kind = 'observation_rescheduled' then
        update dashboard_private.registration_customer_reminder_jobs job set status = 'canceled', claim_token = null, claim_expires_at = null,
          last_error_code = 'observation_rescheduled'
        where job.observation_id = v_event.observation_id and job.message_kind = 'observation_reminder'
          and job.status in ('pending', 'claimed') and job.source_revision is distinct from v_event.notification_revision;
      end if;
      if not v_settings.enabled or v_activation.mode = 'off' then v_action := 'skipped_off';
      elsif v_activation.mode = 'verification' and v_observation.task_id is distinct from v_activation.verification_task_id then v_action := 'skipped_scope';
      elsif (v_activation.mode = 'verification' and v_event.occurred_at < v_activation.updated_at)
        or (v_activation.mode = 'live' and v_event.occurred_at < v_activation.automatic_delivery_cutoff_at) then v_action := 'skipped_scope';
      elsif v_starts_at < pg_catalog.clock_timestamp() + pg_catalog.make_interval(hours => v_settings.lead_hours) then v_action := 'skipped_lead_time';
      else
        insert into dashboard_private.registration_customer_reminder_jobs(job_id, appointment_id, observation_id, source_event_id, task_id, message_kind,
          source_revision, session_source_revision, booking_fact_hash, activation_mode_snapshot, verification_started_at, verification_recipient_hash,
          scheduled_for, due_at, available_at, request_key, status)
        values (gen_random_uuid(), v_event.appointment_id, v_event.observation_id, v_event.event_id, v_observation.task_id,
          'observation_reminder', v_event.notification_revision, v_event.source_revision, v_event.booking_fact_hash, v_activation.mode,
          case when v_activation.mode = 'verification' then v_activation.updated_at end,
          case when v_activation.mode = 'verification' then v_activation.verification_recipient_hash end,
          v_starts_at, v_starts_at - pg_catalog.make_interval(hours => v_settings.lead_hours), pg_catalog.clock_timestamp(), gen_random_uuid(), 'pending')
        on conflict (observation_id, source_revision, message_kind) where message_kind = 'observation_reminder' do nothing
        returning job_id into v_job_id;
        v_action := case when v_job_id is null then 'already_terminal' when v_event.event_kind = 'observation_rescheduled' then 'replaced' else 'created' end;
      end if;
    end if;
    insert into dashboard_private.registration_observation_solapi_event_consumptions(event_id, action, job_id)
      values (v_event.event_id, v_action, v_job_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
alter function dashboard_private.materialize_registration_observation_solapi_events_v1(integer) owner to postgres;
revoke all on function dashboard_private.materialize_registration_observation_solapi_events_v1(integer) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.materialize_registration_observation_solapi_events_v1(integer) to service_role;

commit;
