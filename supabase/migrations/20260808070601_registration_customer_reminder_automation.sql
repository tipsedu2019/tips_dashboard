begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

do $$
begin
  if pg_catalog.to_regclass('public.ops_registration_customer_messages') is null
    or pg_catalog.to_regclass('public.ops_registration_appointments') is null
    or pg_catalog.to_regclass('dashboard_private.registration_customer_solapi_activation') is null
    or pg_catalog.to_regclass('dashboard_private.registration_customer_solapi_template_receipts') is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)'
    ) is null then
    raise exception 'registration_customer_reminder_dependency_missing'
      using errcode = '55000';
  end if;
end
$$;

create table dashboard_private.registration_customer_reminder_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  lead_hours smallint not null default 3 check (lead_hours between 1 and 72),
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

insert into dashboard_private.registration_customer_reminder_settings(
  singleton, enabled, lead_hours, revision
) values (true, false, 3, 1)
on conflict (singleton) do nothing;

create table dashboard_private.registration_customer_reminder_jobs (
  appointment_id uuid primary key
    references public.ops_registration_appointments(id) on delete restrict,
  task_id uuid not null references public.ops_tasks(id) on delete restrict,
  source_revision bigint not null,
  scheduled_for timestamptz not null,
  due_at timestamptz not null,
  available_at timestamptz not null default pg_catalog.clock_timestamp(),
  request_key uuid not null unique default gen_random_uuid(),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'dispatching', 'completed', 'canceled')),
  claim_token uuid,
  claim_expires_at timestamptz,
  message_id uuid,
  last_error_code text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint registration_customer_reminder_jobs_due_check
    check (due_at <= scheduled_for),
  constraint registration_customer_reminder_jobs_claim_check check (
    (
      status = 'claimed'
      and claim_token is not null
      and claim_expires_at is not null
      and message_id is null
    )
    or (
      status <> 'claimed'
      and claim_token is null
      and claim_expires_at is null
    )
  ),
  constraint registration_customer_reminder_jobs_message_check check (
    (status in ('dispatching', 'completed') and message_id is not null)
    or (status not in ('dispatching', 'completed') and message_id is null)
  ),
  constraint registration_customer_reminder_jobs_error_check check (
    last_error_code is null
    or (
      nullif(pg_catalog.btrim(last_error_code), '') is not null
      and pg_catalog.octet_length(last_error_code) <= 120
    )
  )
);

create index registration_customer_reminder_jobs_due_idx
  on dashboard_private.registration_customer_reminder_jobs(due_at, appointment_id)
  where status = 'pending';

create index registration_customer_reminder_jobs_claim_expiry_idx
  on dashboard_private.registration_customer_reminder_jobs(claim_expires_at)
  where status = 'claimed';

create table dashboard_private.registration_customer_reminder_worker_heartbeats (
  singleton boolean primary key default true check (singleton),
  succeeded_at timestamptz not null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table dashboard_private.registration_customer_reminder_settings enable row level security;
alter table dashboard_private.registration_customer_reminder_jobs enable row level security;
alter table dashboard_private.registration_customer_reminder_worker_heartbeats enable row level security;

revoke all on table dashboard_private.registration_customer_reminder_settings from public, anon, authenticated, service_role;
revoke all on table dashboard_private.registration_customer_reminder_jobs from public, anon, authenticated, service_role;
revoke all on table dashboard_private.registration_customer_reminder_worker_heartbeats from public, anon, authenticated, service_role;

create trigger set_updated_at_registration_customer_reminder_settings
before update on dashboard_private.registration_customer_reminder_settings
for each row execute function public.set_updated_at();

create trigger set_updated_at_registration_customer_reminder_jobs
before update on dashboard_private.registration_customer_reminder_jobs
for each row execute function public.set_updated_at();

alter table public.ops_registration_customer_messages
  drop constraint ops_registration_customer_messages_claim_shape_check,
  drop constraint ops_registration_customer_messages_resolution_source_check;

alter table public.ops_registration_customer_messages
  alter column preview_id drop not null,
  alter column confirmed_by drop not null,
  add column delivery_origin text not null default 'manual'
    check (delivery_origin in ('manual', 'scheduled')),
  add column scheduled_job_id uuid
    references dashboard_private.registration_customer_reminder_jobs(appointment_id)
    on delete restrict,
  add column scheduled_for timestamptz,
  add constraint ops_registration_customer_messages_origin_shape_check check (
    (
      delivery_origin = 'manual'
      and preview_id is not null
      and confirmed_by is not null
      and scheduled_job_id is null
      and scheduled_for is null
    )
    or (
      delivery_origin = 'scheduled'
      and message_kind = 'appointment_reminder'
      and appointment_id is not null
      and preview_id is null
      and confirmed_by is null
      and scheduled_job_id = appointment_id
      and scheduled_for is not null
    )
  ),
  add constraint ops_registration_customer_messages_claim_shape_check check (
    (
      claim_active
      and delivery_origin = 'manual'
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
        or nullif(pg_catalog.btrim(claim_release_reason), '') is not null
      )
    )
  ),
  add constraint ops_registration_customer_messages_resolution_source_check check (
    resolution_source is null
    or resolution_source in (
      'provider_send',
      'provider_check',
      'admin_reconcile',
      'marker_recovery',
      'scheduled_provider_send',
      'scheduled_marker_recovery'
    )
  );

alter table dashboard_private.registration_customer_reminder_jobs
  add constraint registration_customer_reminder_jobs_message_fk
  foreign key (message_id) references public.ops_registration_customer_messages(id)
  on delete restrict;

do $$
begin
  if exists (
    select 1
    from public.ops_registration_customer_messages message
    where message.message_kind = 'appointment_reminder'
    group by message.appointment_id
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'registration_customer_reminder_lifetime_duplicate_preflight_failed'
      using errcode = '23505';
  end if;
end
$$;

drop index public.ops_reg_customer_msg_appointment_once_idx;

create unique index ops_reg_customer_msg_appointment_revision_once_idx
  on public.ops_registration_customer_messages(
    appointment_id,
    message_kind,
    source_revision
  )
  where message_kind in ('level_test_booking', 'visit_consultation_booking');

create unique index ops_reg_customer_msg_reminder_lifetime_once_idx
  on public.ops_registration_customer_messages(appointment_id, message_kind)
  where message_kind = 'appointment_reminder';

create or replace function dashboard_private.registration_customer_reminder_schedule_ready_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    pg_catalog.count(*) = 1
    and pg_catalog.bool_and(job.active)
    and pg_catalog.bool_and(job.schedule = '* * * * *')
    and pg_catalog.bool_and(
      pg_catalog.btrim(job.command) =
        'select dashboard_private.invoke_registration_customer_reminder_worker_v1();'
    )
    and exists (
      select 1
      from dashboard_private.registration_customer_reminder_worker_heartbeats heartbeat
      where heartbeat.singleton
        and heartbeat.succeeded_at >= pg_catalog.clock_timestamp() - interval '5 minutes'
    )
  from cron.job job
  where job.jobname = 'tips-registration-customer-reminder-v1';
$$;

alter function dashboard_private.registration_customer_reminder_schedule_ready_v1()
  owner to postgres;
revoke all on function dashboard_private.registration_customer_reminder_schedule_ready_v1()
  from public, anon, authenticated, service_role;

create function public.get_registration_customer_reminder_settings_v1(
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_settings dashboard_private.registration_customer_reminder_settings%rowtype;
  v_activation dashboard_private.registration_customer_solapi_activation%rowtype;
  v_receipt dashboard_private.registration_customer_solapi_template_receipts%rowtype;
begin
  perform dashboard_private.registration_customer_solapi_assert_operator_v1(
    p_actor_profile_id
  );
  select settings.* into strict v_settings
  from dashboard_private.registration_customer_reminder_settings settings
  where settings.singleton;
  select activation.* into strict v_activation
  from dashboard_private.registration_customer_solapi_activation activation
  where activation.message_kind = 'appointment_reminder';
  select receipt.* into v_receipt
  from dashboard_private.registration_customer_solapi_template_receipts receipt
  where receipt.message_kind = 'appointment_reminder';

  return pg_catalog.jsonb_build_object(
    'enabled', v_settings.enabled,
    'leadHours', v_settings.lead_hours,
    'revision', v_settings.revision::text,
    'updatedAt', v_settings.updated_at,
    'activationMode', v_activation.mode,
    'templateVerified', coalesce(
      v_receipt.provider_status = 'sendable'
      and v_receipt.catalog_checksum = v_receipt.provider_checksum,
      false
    ),
    'scheduleReady', dashboard_private.registration_customer_reminder_schedule_ready_v1(),
    'verifiedTemplateId', v_receipt.template_id,
    'verifiedPfId', v_receipt.pf_id,
    'verifiedCatalogChecksum', v_receipt.catalog_checksum
  );
end;
$$;

alter function public.get_registration_customer_reminder_settings_v1(uuid)
  owner to postgres;
revoke all on function public.get_registration_customer_reminder_settings_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_registration_customer_reminder_settings_v1(uuid)
  to service_role;

create function public.set_registration_customer_reminder_settings_v1(
  p_actor_profile_id uuid,
  p_enabled boolean,
  p_lead_hours smallint,
  p_expected_revision bigint,
  p_template_contract jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_settings dashboard_private.registration_customer_reminder_settings%rowtype;
  v_activation dashboard_private.registration_customer_solapi_activation%rowtype;
  v_receipt dashboard_private.registration_customer_solapi_template_receipts%rowtype;
begin
  perform dashboard_private.registration_customer_solapi_assert_admin_v1(
    p_actor_profile_id
  );
  if p_enabled is null or p_lead_hours not between 1 and 72
    or p_expected_revision is null then
    raise exception 'registration_customer_reminder_settings_invalid'
      using errcode = '22023';
  end if;

  select settings.* into strict v_settings
  from dashboard_private.registration_customer_reminder_settings settings
  where settings.singleton
  for update;
  if v_settings.revision <> p_expected_revision then
    raise exception 'registration_customer_reminder_settings_conflict'
      using errcode = '40001';
  end if;

  if p_enabled then
    if p_template_contract is null
      or pg_catalog.jsonb_typeof(p_template_contract) <> 'object'
      or p_template_contract - array['templateId', 'pfId', 'catalogChecksum']::text[] <> '{}'::jsonb
      or not p_template_contract ?& array['templateId', 'pfId', 'catalogChecksum']::text[]
      or (p_template_contract ->> 'catalogChecksum') !~ '^[a-f0-9]{64}$' then
      raise exception 'registration_customer_reminder_settings_invalid'
        using errcode = '22023';
    end if;
    select activation.* into strict v_activation
    from dashboard_private.registration_customer_solapi_activation activation
    where activation.message_kind = 'appointment_reminder';
    select receipt.* into v_receipt
    from dashboard_private.registration_customer_solapi_template_receipts receipt
    where receipt.message_kind = 'appointment_reminder';
    if v_activation.mode is distinct from 'live'
      or v_receipt.message_kind is null
      or v_receipt.provider_status is distinct from 'sendable'
      or v_receipt.catalog_checksum is distinct from v_receipt.provider_checksum
      or v_receipt.catalog_checksum is distinct from p_template_contract ->> 'catalogChecksum'
      or v_receipt.template_id is distinct from nullif(pg_catalog.btrim(p_template_contract ->> 'templateId'), '')
      or v_receipt.pf_id is distinct from nullif(pg_catalog.btrim(p_template_contract ->> 'pfId'), '')
      or not dashboard_private.registration_customer_reminder_schedule_ready_v1() then
      raise exception 'registration_customer_reminder_not_ready'
        using errcode = '55000';
    end if;
  end if;

  update dashboard_private.registration_customer_reminder_settings settings
  set enabled = p_enabled,
      lead_hours = p_lead_hours,
      revision = settings.revision + 1,
      updated_by = p_actor_profile_id,
      updated_at = pg_catalog.clock_timestamp()
  where settings.singleton
  returning * into v_settings;

  if not p_enabled then
    update dashboard_private.registration_customer_reminder_jobs job
    set status = 'pending',
        claim_token = null,
        claim_expires_at = null,
        available_at = pg_catalog.clock_timestamp(),
        last_error_code = 'automation_disabled'
    where job.status = 'claimed';
  end if;

  return public.get_registration_customer_reminder_settings_v1(
    p_actor_profile_id
  );
end;
$$;

alter function public.set_registration_customer_reminder_settings_v1(
  uuid, boolean, smallint, bigint, jsonb
) owner to postgres;
revoke all on function public.set_registration_customer_reminder_settings_v1(
  uuid, boolean, smallint, bigint, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.set_registration_customer_reminder_settings_v1(
  uuid, boolean, smallint, bigint, jsonb
) to service_role;

create function dashboard_private.sync_registration_customer_reminder_jobs_v1()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  update public.ops_registration_customer_messages message
  set status = 'unknown',
      error_code = 'scheduled_marker_recovery',
      resolution_source = 'scheduled_marker_recovery',
      resolved_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.registration_customer_reminder_jobs job
  where job.status = 'dispatching'
    and job.message_id = message.id
    and message.delivery_origin = 'scheduled'
    and message.status = 'pending'
    and message.provider_attempt_count = 1
    and message.provider_attempt_started_at
      <= pg_catalog.clock_timestamp() - interval '15 minutes';

  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'completed',
      claim_token = null,
      claim_expires_at = null,
      last_error_code = case
        when message.status = 'unknown' then 'scheduled_marker_recovery'
        else job.last_error_code
      end
  from public.ops_registration_customer_messages message
  where job.message_id = message.id
    and job.status = 'dispatching'
    and message.status in ('accepted', 'unknown', 'failed_hold');

  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'pending',
      claim_token = null,
      claim_expires_at = null,
      available_at = pg_catalog.clock_timestamp(),
      last_error_code = 'claim_lease_expired'
  where job.status = 'claimed'
    and job.claim_expires_at <= pg_catalog.clock_timestamp();

  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'canceled',
      claim_token = null,
      claim_expires_at = null,
      last_error_code = 'appointment_not_eligible'
  where job.status in ('pending', 'claimed')
    and not exists (
      select 1
      from public.ops_registration_appointments appointment
      where appointment.id = job.appointment_id
        and appointment.task_id = job.task_id
        and appointment.kind in ('level_test', 'visit_consultation')
        and appointment.status = 'scheduled'
        and appointment.scheduled_at > pg_catalog.clock_timestamp()
    );

  insert into dashboard_private.registration_customer_reminder_jobs(
    appointment_id,
    task_id,
    source_revision,
    scheduled_for,
    due_at,
    available_at,
    status,
    last_error_code
  )
  select
    appointment.id,
    appointment.task_id,
    appointment.notification_revision,
    appointment.scheduled_at,
    appointment.scheduled_at - pg_catalog.make_interval(hours => settings.lead_hours),
    pg_catalog.clock_timestamp(),
    'pending',
    null
  from public.ops_registration_appointments appointment
  cross join dashboard_private.registration_customer_reminder_settings settings
  where settings.singleton
    and appointment.kind in ('level_test', 'visit_consultation')
    and appointment.status = 'scheduled'
    and appointment.scheduled_at > pg_catalog.clock_timestamp()
    and not exists (
      select 1
      from public.ops_registration_customer_messages message
      where message.appointment_id = appointment.id
        and message.message_kind = 'appointment_reminder'
    )
  on conflict (appointment_id) do update
  set task_id = excluded.task_id,
      source_revision = excluded.source_revision,
      scheduled_for = excluded.scheduled_for,
      due_at = excluded.due_at,
      available_at = pg_catalog.least(
        registration_customer_reminder_jobs.available_at,
        excluded.available_at
      ),
      last_error_code = null
  where registration_customer_reminder_jobs.status = 'pending';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter function dashboard_private.sync_registration_customer_reminder_jobs_v1()
  owner to postgres;
revoke all on function dashboard_private.sync_registration_customer_reminder_jobs_v1()
  from public, anon, authenticated, service_role;

create function public.claim_registration_customer_reminder_job_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_settings dashboard_private.registration_customer_reminder_settings%rowtype;
  v_job dashboard_private.registration_customer_reminder_jobs%rowtype;
  v_claim_token uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized'
      using errcode = '42501';
  end if;

  insert into dashboard_private.registration_customer_reminder_worker_heartbeats(
    singleton, succeeded_at, updated_at
  ) values (
    true, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  )
  on conflict (singleton) do update
  set succeeded_at = excluded.succeeded_at,
      updated_at = excluded.updated_at;

  select settings.* into strict v_settings
  from dashboard_private.registration_customer_reminder_settings settings
  where settings.singleton;
  if not v_settings.enabled then
    return null;
  end if;

  perform dashboard_private.sync_registration_customer_reminder_jobs_v1();

  select job.* into v_job
  from dashboard_private.registration_customer_reminder_jobs job
  join public.ops_registration_appointments appointment
    on appointment.id = job.appointment_id
  where job.status = 'pending'
    and job.available_at <= pg_catalog.clock_timestamp()
    and job.due_at <= pg_catalog.clock_timestamp()
    and appointment.status = 'scheduled'
    and appointment.scheduled_at > pg_catalog.clock_timestamp()
    and appointment.notification_revision = job.source_revision
    and not exists (
      select 1
      from public.ops_registration_customer_messages message
      where message.appointment_id = job.appointment_id
        and message.message_kind = 'appointment_reminder'
    )
  order by job.due_at, job.appointment_id
  for update of job skip locked
  limit 1;

  if not found then return null; end if;
  v_claim_token := gen_random_uuid();
  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'claimed',
      claim_token = v_claim_token,
      claim_expires_at = pg_catalog.clock_timestamp() + interval '2 minutes',
      last_error_code = null
  where job.appointment_id = v_job.appointment_id
  returning * into v_job;

  return pg_catalog.jsonb_build_object(
    'jobId', v_job.appointment_id,
    'appointmentId', v_job.appointment_id,
    'claimToken', v_job.claim_token,
    'sourceRevision', v_job.source_revision,
    'scheduledFor', v_job.scheduled_for,
    'requestKey', v_job.request_key
  );
end;
$$;

alter function public.claim_registration_customer_reminder_job_v1()
  owner to postgres;
revoke all on function public.claim_registration_customer_reminder_job_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.claim_registration_customer_reminder_job_v1()
  to service_role;

create function public.read_registration_customer_reminder_source_v1(
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.registration_customer_reminder_jobs%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized'
      using errcode = '42501';
  end if;
  select job.* into v_job
  from dashboard_private.registration_customer_reminder_jobs job
  where job.appointment_id = p_job_id
    and job.status = 'claimed'
    and job.claim_token = p_claim_token
    and job.claim_expires_at > pg_catalog.clock_timestamp();
  if not found then
    raise exception 'registration_customer_reminder_claim_invalid'
      using errcode = '40001';
  end if;
  return dashboard_private.resolve_registration_customer_message_source_v1_impl(
    'appointment_reminder',
    v_job.appointment_id
  );
end;
$$;

alter function public.read_registration_customer_reminder_source_v1(uuid, uuid)
  owner to postgres;
revoke all on function public.read_registration_customer_reminder_source_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_registration_customer_reminder_source_v1(uuid, uuid)
  to service_role;

create function public.release_registration_customer_reminder_job_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_error_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_error_code text := nullif(pg_catalog.btrim(p_error_code), '');
begin
  if (select auth.role()) <> 'service_role'
    or v_error_code is null
    or pg_catalog.octet_length(v_error_code) > 120 then
    raise exception 'registration_customer_reminder_release_invalid'
      using errcode = '22023';
  end if;
  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'pending',
      claim_token = null,
      claim_expires_at = null,
      available_at = pg_catalog.clock_timestamp() + interval '5 minutes',
      last_error_code = v_error_code
  where job.appointment_id = p_job_id
    and job.status = 'claimed'
    and job.claim_token = p_claim_token
    and job.message_id is null;
  return pg_catalog.jsonb_build_object('released', found, 'jobId', p_job_id);
end;
$$;

alter function public.release_registration_customer_reminder_job_v1(uuid, uuid, text)
  owner to postgres;
revoke all on function public.release_registration_customer_reminder_job_v1(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.release_registration_customer_reminder_job_v1(uuid, uuid, text)
  to service_role;

create function public.begin_registration_customer_reminder_dispatch_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_contract jsonb,
  p_readiness_contract jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_job dashboard_private.registration_customer_reminder_jobs%rowtype;
  v_settings dashboard_private.registration_customer_reminder_settings%rowtype;
  v_activation dashboard_private.registration_customer_solapi_activation%rowtype;
  v_receipt dashboard_private.registration_customer_solapi_template_receipts%rowtype;
  v_live_message public.ops_registration_customer_messages%rowtype;
  v_existing public.ops_registration_customer_messages%rowtype;
  v_message public.ops_registration_customer_messages%rowtype;
  v_source jsonb;
  v_source_facts_checksum text;
  v_dispatch_token uuid;
  v_dedupe_key text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized'
      using errcode = '42501';
  end if;
  perform dashboard_private.registration_customer_message_assert_contract_v1(
    p_contract,
    'appointment_reminder'
  );
  if p_readiness_contract is null
    or pg_catalog.jsonb_typeof(p_readiness_contract) <> 'object'
    or p_readiness_contract - array[
      'credentialsConfigured',
      'pfId',
      'templateId',
      'catalogChecksum',
      'recipientHash',
      'sourceFingerprint',
      'sourceFactsChecksum'
    ]::text[] <> '{}'::jsonb
    or not p_readiness_contract ?& array[
      'credentialsConfigured',
      'pfId',
      'templateId',
      'catalogChecksum',
      'recipientHash',
      'sourceFingerprint',
      'sourceFactsChecksum'
    ]::text[]
    or coalesce((p_readiness_contract ->> 'credentialsConfigured')::boolean, false) is not true
    or (p_readiness_contract ->> 'catalogChecksum') !~ '^[a-f0-9]{64}$'
    or (p_readiness_contract ->> 'recipientHash') !~ '^[a-f0-9]{64}$'
    or (p_readiness_contract ->> 'sourceFingerprint') !~ '^[a-f0-9]{64}$'
    or (p_readiness_contract ->> 'sourceFactsChecksum') !~ '^[a-f0-9]{64}$' then
    raise exception 'registration_customer_reminder_contract_invalid'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-customer-reminder:' || p_job_id::text,
      0
    )
  );
  select job.* into v_job
  from dashboard_private.registration_customer_reminder_jobs job
  where job.appointment_id = p_job_id
  for update;
  if not found
    or v_job.status <> 'claimed'
    or v_job.claim_token is distinct from p_claim_token
    or v_job.claim_expires_at <= v_now then
    raise exception 'registration_customer_reminder_claim_invalid'
      using errcode = '40001';
  end if;

  select settings.* into strict v_settings
  from dashboard_private.registration_customer_reminder_settings settings
  where settings.singleton
  for share;
  if v_settings.enabled is not true
    or not dashboard_private.registration_customer_reminder_schedule_ready_v1() then
    raise exception 'registration_customer_reminder_not_ready'
      using errcode = '55000';
  end if;

  select message.* into v_existing
  from public.ops_registration_customer_messages message
  where message.appointment_id = v_job.appointment_id
    and message.message_kind = 'appointment_reminder'
  for update;
  if found then
    update dashboard_private.registration_customer_reminder_jobs job
    set status = 'completed',
        claim_token = null,
        claim_expires_at = null,
        message_id = v_existing.id,
        last_error_code = 'duplicate_locked'
    where job.appointment_id = v_job.appointment_id;
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'messageId', v_existing.id,
      'dispatchToken', v_existing.dispatch_token,
      'currentStatus', v_existing.status
    );
  end if;

  v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl(
    'appointment_reminder',
    v_job.appointment_id
  );
  v_source_facts_checksum := dashboard_private.registration_customer_message_source_facts_checksum_v1(
    v_source
  );
  if nullif(v_source ->> 'sourceRevision', '')::bigint is distinct from v_job.source_revision
    or v_source ->> 'parentPhoneDigits' is distinct from p_contract ->> 'parentPhoneDigits'
    or v_source_facts_checksum is distinct from p_readiness_contract ->> 'sourceFactsChecksum'
    or p_contract ->> 'recipientHash' is distinct from p_readiness_contract ->> 'recipientHash'
    or p_contract ->> 'sourceFingerprint' is distinct from p_readiness_contract ->> 'sourceFingerprint'
    or p_contract ->> 'templateChecksum' is distinct from p_readiness_contract ->> 'catalogChecksum' then
    raise exception 'registration_customer_reminder_source_stale'
      using errcode = '40001';
  end if;

  select activation.* into strict v_activation
  from dashboard_private.registration_customer_solapi_activation activation
  where activation.message_kind = 'appointment_reminder'
  for share;
  select receipt.* into v_receipt
  from dashboard_private.registration_customer_solapi_template_receipts receipt
  where receipt.message_kind = 'appointment_reminder'
  for share;
  if v_activation.mode is distinct from 'live'
    or v_receipt.message_kind is null
    or v_receipt.provider_status is distinct from 'sendable'
    or v_receipt.catalog_checksum is distinct from v_receipt.provider_checksum
    or v_receipt.catalog_checksum is distinct from p_readiness_contract ->> 'catalogChecksum'
    or v_receipt.template_id is distinct from nullif(pg_catalog.btrim(p_readiness_contract ->> 'templateId'), '')
    or v_receipt.pf_id is distinct from nullif(pg_catalog.btrim(p_readiness_contract ->> 'pfId'), '') then
    raise exception 'registration_customer_reminder_not_ready'
      using errcode = '55000';
  end if;
  select message.* into v_live_message
  from public.ops_registration_customer_messages message
  where message.id = v_activation.live_test_message_id
    and message.status = 'accepted'
    and message.message_kind = 'appointment_reminder'
    and message.task_id = v_activation.verification_task_id
    and message.recipient_hash = v_activation.verification_recipient_hash
    and message.template_checksum = v_receipt.catalog_checksum;
  if not found or v_activation.live_test_confirmed_at is null then
    raise exception 'registration_customer_reminder_not_ready'
      using errcode = '55000';
  end if;

  v_dispatch_token := gen_random_uuid();
  v_dedupe_key := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(
      pg_catalog.jsonb_build_object(
        'messageKind', 'appointment_reminder',
        'appointmentId', v_job.appointment_id,
        'deliveryOrigin', 'scheduled'
      )
    )
  );

  insert into public.ops_registration_customer_messages(
    preview_id,
    task_id,
    track_id,
    appointment_id,
    message_kind,
    source_fingerprint,
    source_facts_checksum,
    source_revision,
    recipient_hash,
    recipient_last4,
    template_key,
    template_revision,
    template_checksum,
    rendered_variables_checksum,
    rendered_body_checksum,
    rendered_buttons_checksum,
    dedupe_key,
    request_key,
    status,
    claim_active,
    dispatch_token,
    provider_attempt_started_at,
    provider_attempt_count,
    confirmed_by,
    confirmed_at,
    delivery_origin,
    scheduled_job_id,
    scheduled_for
  ) values (
    null,
    v_job.task_id,
    null,
    v_job.appointment_id,
    'appointment_reminder',
    p_contract ->> 'sourceFingerprint',
    v_source_facts_checksum,
    v_job.source_revision,
    p_contract ->> 'recipientHash',
    pg_catalog.right(p_contract ->> 'parentPhoneDigits', 4),
    'appointment_reminder',
    (p_contract ->> 'templateRevision')::integer,
    p_contract ->> 'templateChecksum',
    p_contract ->> 'renderedVariablesChecksum',
    p_contract ->> 'renderedBodyChecksum',
    p_contract ->> 'renderedButtonsChecksum',
    v_dedupe_key,
    v_job.request_key::text,
    'pending',
    false,
    v_dispatch_token,
    pg_catalog.clock_timestamp(),
    1,
    null,
    pg_catalog.clock_timestamp(),
    'scheduled',
    v_job.appointment_id,
    v_job.scheduled_for
  ) returning * into v_message;

  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'dispatching',
      claim_token = null,
      claim_expires_at = null,
      message_id = v_message.id,
      last_error_code = null
  where job.appointment_id = v_job.appointment_id;

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'messageId', v_message.id,
    'dispatchToken', v_message.dispatch_token,
    'currentStatus', v_message.status
  );
exception
  when unique_violation then
    select message.* into v_existing
    from public.ops_registration_customer_messages message
    where message.appointment_id = p_job_id
      and message.message_kind = 'appointment_reminder';
    if v_existing.id is null then raise; end if;
    update dashboard_private.registration_customer_reminder_jobs job
    set status = 'completed',
        claim_token = null,
        claim_expires_at = null,
        message_id = v_existing.id,
        last_error_code = 'duplicate_locked'
    where job.appointment_id = p_job_id;
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'messageId', v_existing.id,
      'dispatchToken', v_existing.dispatch_token,
      'currentStatus', v_existing.status
    );
end;
$$;

alter function public.begin_registration_customer_reminder_dispatch_v1(
  uuid, uuid, jsonb, jsonb
) owner to postgres;
revoke all on function public.begin_registration_customer_reminder_dispatch_v1(
  uuid, uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.begin_registration_customer_reminder_dispatch_v1(
  uuid, uuid, jsonb, jsonb
) to service_role;

create function public.finalize_registration_customer_reminder_dispatch_v1(
  p_message_id uuid,
  p_dispatch_token uuid,
  p_result text,
  p_provider_result jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_message public.ops_registration_customer_messages%rowtype;
  v_provider_result jsonb;
begin
  if (select auth.role()) <> 'service_role'
    or p_result not in ('accepted', 'failed_hold', 'unknown') then
    raise exception 'registration_customer_reminder_finalize_invalid'
      using errcode = '22023';
  end if;
  v_provider_result := dashboard_private.registration_customer_message_provider_evidence_v1(
    p_provider_result
  );
  select message.* into v_message
  from public.ops_registration_customer_messages message
  where message.id = p_message_id
  for update;
  if not found
    or v_message.delivery_origin <> 'scheduled'
    or v_message.message_kind <> 'appointment_reminder'
    or v_message.dispatch_token is distinct from p_dispatch_token
    or v_message.provider_attempt_count <> 1
    or v_message.provider_attempt_started_at is null then
    raise exception 'registration_customer_reminder_finalize_not_allowed'
      using errcode = '40001';
  end if;

  if v_message.status in ('accepted', 'unknown', 'failed_hold') then
    return pg_catalog.jsonb_build_object(
      'ok', v_message.status = 'accepted',
      'messageId', v_message.id,
      'currentStatus', v_message.status,
      'idempotent', true,
      'confirmedByName', '자동 발송',
      'confirmedAt', v_message.confirmed_at,
      'updatedAt', v_message.updated_at,
      'recipientLast4', v_message.recipient_last4,
      'canCheck', false
    );
  end if;

  update public.ops_registration_customer_messages message
  set status = p_result,
      provider_message_id = v_provider_result ->> 'providerMessageId',
      provider_group_id = v_provider_result ->> 'providerGroupId',
      provider_status_code = v_provider_result ->> 'statusCode',
      provider_status_message = v_provider_result ->> 'statusMessage',
      provider_evidence = v_provider_result,
      error_code = case when p_result = 'failed_hold' then 'provider_rejected' else null end,
      resolution_source = 'scheduled_provider_send',
      resolved_by = null,
      resolved_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where message.id = v_message.id
  returning * into v_message;

  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'completed',
      claim_token = null,
      claim_expires_at = null,
      last_error_code = case
        when p_result = 'accepted' then null
        when p_result = 'failed_hold' then 'provider_rejected'
        else 'provider_dispatch_uncertain'
      end
  where job.appointment_id = v_message.scheduled_job_id
    and job.message_id = v_message.id;

  return pg_catalog.jsonb_build_object(
    'ok', v_message.status = 'accepted',
    'messageId', v_message.id,
    'currentStatus', v_message.status,
    'idempotent', false,
    'confirmedByName', '자동 발송',
    'confirmedAt', v_message.confirmed_at,
    'updatedAt', v_message.updated_at,
    'recipientLast4', v_message.recipient_last4,
    'canCheck', false
  );
end;
$$;

alter function public.finalize_registration_customer_reminder_dispatch_v1(
  uuid, uuid, text, jsonb
) owner to postgres;
revoke all on function public.finalize_registration_customer_reminder_dispatch_v1(
  uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_registration_customer_reminder_dispatch_v1(
  uuid, uuid, text, jsonb
) to service_role;

alter function public.get_registration_customer_solapi_readiness_v1(
  uuid, text, uuid, jsonb
) rename to registration_customer_solapi_readiness_revision_v1;

alter function public.registration_customer_solapi_readiness_revision_v1(
  uuid, text, uuid, jsonb
) set schema dashboard_private;

revoke all on function dashboard_private.registration_customer_solapi_readiness_revision_v1(
  uuid, text, uuid, jsonb
) from public, anon, authenticated, service_role;

create function public.get_registration_customer_solapi_readiness_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_source_id uuid,
  p_template_contract jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_readiness jsonb;
  v_blockers jsonb;
  v_duplicate_locked boolean := false;
begin
  v_readiness := dashboard_private.registration_customer_solapi_readiness_revision_v1(
    p_actor_profile_id,
    p_message_kind,
    p_source_id,
    p_template_contract
  );
  if p_message_kind = 'appointment_reminder' then
    select exists (
      select 1
      from public.ops_registration_customer_messages message
      where message.appointment_id = p_source_id
        and message.message_kind = 'appointment_reminder'
    ) into v_duplicate_locked;
    v_blockers := coalesce(v_readiness -> 'blockers', '[]'::jsonb)
      - 'duplicate_locked';
    if v_duplicate_locked then
      v_blockers := v_blockers || pg_catalog.jsonb_build_array('duplicate_locked');
    end if;
    v_readiness := pg_catalog.jsonb_set(
      v_readiness,
      array['blockers']::text[],
      v_blockers,
      true
    );
    v_readiness := pg_catalog.jsonb_set(
      v_readiness,
      array['sendAllowed']::text[],
      pg_catalog.to_jsonb(pg_catalog.jsonb_array_length(v_blockers) = 0),
      true
    );
  end if;
  return v_readiness;
end;
$$;

alter function public.get_registration_customer_solapi_readiness_v1(
  uuid, text, uuid, jsonb
) owner to postgres;
revoke all on function public.get_registration_customer_solapi_readiness_v1(
  uuid, text, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.get_registration_customer_solapi_readiness_v1(
  uuid, text, uuid, jsonb
) to service_role;

create or replace function public.list_registration_customer_messages_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_source_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_task_id uuid;
  v_actor_role text;
  v_result jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'registration_customer_message_limit_invalid'
      using errcode = '22023';
  end if;
  v_task_id := dashboard_private.registration_customer_message_source_task_v1(
    p_message_kind,
    p_source_id
  );
  v_actor_role := dashboard_private.registration_customer_message_assert_actor_v1(
    p_actor_profile_id,
    v_task_id,
    'history'
  );

  if v_actor_role in ('admin', 'staff') then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'messageId', message.id,
          'messageKind', message.message_kind,
          'currentStatus', message.status,
          'confirmedByName', message.confirmed_by_name,
          'confirmedAt', message.confirmed_at,
          'updatedAt', message.updated_at,
          'recipientLast4', message.recipient_last4,
          'canCheck', (
            message.delivery_origin = 'manual'
            and message.provider_attempt_count = 1
            and message.provider_attempt_started_at
              <= pg_catalog.clock_timestamp() - interval '15 minutes'
            and message.status in ('pending', 'unknown')
          ),
          'deliveryOrigin', message.delivery_origin
        ) order by message.created_at desc, message.id desc
      ),
      '[]'::jsonb
    ) into v_result
    from (
      select outbox.*,
        case
          when outbox.delivery_origin = 'scheduled' then '자동 발송'
          else coalesce(
            nullif(pg_catalog.btrim(profile.name), ''),
            case profile.role
              when 'admin' then '관리자'
              when 'staff' then '운영팀'
              when 'teacher' then '담당 선생님'
              when 'assistant' then '보조 담당자'
              else '담당자'
            end
          )
        end as confirmed_by_name
      from public.ops_registration_customer_messages outbox
      left join public.profiles profile on profile.id = outbox.confirmed_by
      where outbox.task_id = v_task_id
        and outbox.message_kind = p_message_kind
        and (
          outbox.appointment_id = p_source_id
          or outbox.track_id = p_source_id
          or (
            p_message_kind = 'admission_application'
            and outbox.task_id = p_source_id
          )
        )
      order by outbox.created_at desc, outbox.id desc
      limit p_limit
    ) message;
  else
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'messageKind', message.message_kind,
          'currentStatus', message.status,
          'confirmedByName', message.confirmed_by_name,
          'confirmedAt', message.confirmed_at,
          'updatedAt', message.updated_at,
          'deliveryOrigin', message.delivery_origin
        ) order by message.created_at desc, message.id desc
      ),
      '[]'::jsonb
    ) into v_result
    from (
      select outbox.*,
        case
          when outbox.delivery_origin = 'scheduled' then '자동 발송'
          else coalesce(
            nullif(pg_catalog.btrim(profile.name), ''),
            case profile.role
              when 'admin' then '관리자'
              when 'staff' then '운영팀'
              when 'teacher' then '담당 선생님'
              when 'assistant' then '보조 담당자'
              else '담당자'
            end
          )
        end as confirmed_by_name
      from public.ops_registration_customer_messages outbox
      left join public.profiles profile on profile.id = outbox.confirmed_by
      where outbox.task_id = v_task_id
        and outbox.message_kind = p_message_kind
        and (
          outbox.appointment_id = p_source_id
          or outbox.track_id = p_source_id
          or (
            p_message_kind = 'admission_application'
            and outbox.task_id = p_source_id
          )
        )
      order by outbox.created_at desc, outbox.id desc
      limit p_limit
    ) message;
  end if;
  return v_result;
end;
$$;

alter function public.list_registration_customer_messages_v1(
  uuid, text, uuid, integer
) owner to postgres;
revoke all on function public.list_registration_customer_messages_v1(
  uuid, text, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_registration_customer_messages_v1(
  uuid, text, uuid, integer
) to service_role;

create function dashboard_private.registration_customer_reminder_worker_vault_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_url_count integer;
  v_secret_count integer;
begin
  if pg_catalog.to_regclass('vault.decrypted_secrets') is null then
    return pg_catalog.jsonb_build_object('ok', false, 'errorCode', 'vault_unavailable');
  end if;
  execute $query$
    select
      pg_catalog.min(decrypted_secret) filter (
        where name = 'registration_customer_reminder_worker_url'
      ),
      pg_catalog.min(decrypted_secret) filter (
        where name = 'registration_customer_reminder_worker_bearer_secret'
      ),
      pg_catalog.count(*) filter (
        where name = 'registration_customer_reminder_worker_url'
      )::integer,
      pg_catalog.count(*) filter (
        where name = 'registration_customer_reminder_worker_bearer_secret'
      )::integer
    from vault.decrypted_secrets
    where name in (
      'registration_customer_reminder_worker_url',
      'registration_customer_reminder_worker_bearer_secret'
    )
  $query$ into v_url, v_secret, v_url_count, v_secret_count;

  if v_url_count <> 1 or v_secret_count <> 1 then
    return pg_catalog.jsonb_build_object('ok', false, 'errorCode', 'vault_value_ambiguous');
  end if;
  if v_url is distinct from
      'https://tipsdashboard.vercel.app/api/solapi/registration/reminders/worker'
    or v_secret is null
    or pg_catalog.octet_length(v_secret) < 32
    or pg_catalog.octet_length(v_secret) > 256
    or v_secret ~ '[[:space:]]' then
    return pg_catalog.jsonb_build_object('ok', false, 'errorCode', 'vault_value_invalid');
  end if;
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'url', v_url,
    'secret', v_secret
  );
exception
  when others then
    return pg_catalog.jsonb_build_object('ok', false, 'errorCode', 'vault_read_failed');
end;
$$;

alter function dashboard_private.registration_customer_reminder_worker_vault_v1()
  owner to postgres;
revoke all on function dashboard_private.registration_customer_reminder_worker_vault_v1()
  from public, anon, authenticated, service_role;

create function dashboard_private.invoke_registration_customer_reminder_worker_v1()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_contract jsonb;
  v_request_id bigint;
begin
  v_contract := dashboard_private.registration_customer_reminder_worker_vault_v1();
  if coalesce((v_contract ->> 'ok')::boolean, false) is not true then
    raise exception 'registration_customer_reminder_worker_vault_invalid'
      using errcode = '55000';
  end if;
  select net.http_post(
    url := v_contract ->> 'url',
    headers := pg_catalog.jsonb_build_object(
      'Authorization', 'Bearer ' || (v_contract ->> 'secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  ) into v_request_id;
  return v_request_id;
end;
$$;

alter function dashboard_private.invoke_registration_customer_reminder_worker_v1()
  owner to postgres;
revoke all on function dashboard_private.invoke_registration_customer_reminder_worker_v1()
  from public, anon, authenticated, service_role;

create function dashboard_private.inspect_registration_customer_reminder_schedule_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'installed', pg_catalog.count(*) = 1,
    'active', coalesce(pg_catalog.bool_and(job.active), false),
    'contractReady', dashboard_private.registration_customer_reminder_schedule_ready_v1(),
    'vaultReady', coalesce(
      (
        dashboard_private.registration_customer_reminder_worker_vault_v1()
        ->> 'ok'
      )::boolean,
      false
    )
  )
  from cron.job job
  where job.jobname = 'tips-registration-customer-reminder-v1';
$$;

alter function dashboard_private.inspect_registration_customer_reminder_schedule_v1()
  owner to postgres;
revoke all on function dashboard_private.inspect_registration_customer_reminder_schedule_v1()
  from public, anon, authenticated, service_role;

create function public.manage_registration_customer_reminder_schedule_v1(
  p_action text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_vault jsonb;
begin
  if (select auth.role()) <> 'service_role'
    or p_action is null
    or p_action not in ('inspect', 'install', 'disable', 'remove') then
    raise exception 'registration_customer_reminder_schedule_action_invalid'
      using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-customer-reminder-schedule-v1', 0)
  );
  if p_action = 'inspect' then
    return dashboard_private.inspect_registration_customer_reminder_schedule_v1();
  end if;

  if p_action in ('install', 'remove') then
    for v_job in
      select job.jobid
      from cron.job job
      where job.jobname = 'tips-registration-customer-reminder-v1'
      order by job.jobid
    loop
      perform cron.unschedule(v_job.jobid);
    end loop;
  end if;

  if p_action = 'install' then
    v_vault := dashboard_private.registration_customer_reminder_worker_vault_v1();
    if coalesce((v_vault ->> 'ok')::boolean, false) is not true then
      raise exception 'registration_customer_reminder_worker_vault_invalid'
        using errcode = '55000';
    end if;
    perform cron.schedule(
      'tips-registration-customer-reminder-v1',
      '* * * * *',
      $command$select dashboard_private.invoke_registration_customer_reminder_worker_v1();$command$
    );
  elsif p_action = 'disable' then
    for v_job in
      select job.jobid
      from cron.job job
      where job.jobname = 'tips-registration-customer-reminder-v1'
      order by job.jobid
    loop
      perform cron.alter_job(v_job.jobid, active := false);
    end loop;
  end if;

  return dashboard_private.inspect_registration_customer_reminder_schedule_v1();
end;
$$;

alter function public.manage_registration_customer_reminder_schedule_v1(text)
  owner to postgres;
revoke all on function public.manage_registration_customer_reminder_schedule_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.manage_registration_customer_reminder_schedule_v1(text)
  to service_role;

commit;
