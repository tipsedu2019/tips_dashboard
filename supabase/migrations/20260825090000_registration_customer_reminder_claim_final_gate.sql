begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.claim_registration_customer_reminder_job_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_job dashboard_private.registration_customer_reminder_jobs%rowtype;
  v_activation dashboard_private.registration_customer_solapi_activation%rowtype;
  v_receipt dashboard_private.registration_customer_solapi_template_receipts%rowtype;
  v_source jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501';
  end if;
  if not (select enabled from dashboard_private.registration_customer_reminder_settings where singleton) then
    return null;
  end if;

  perform dashboard_private.materialize_registration_observation_solapi_events_v1(100);
  perform dashboard_private.sync_registration_customer_reminder_jobs_v1();

  update public.ops_registration_customer_messages message
  set status = 'unknown', error_code = 'scheduled_marker_recovery',
      resolution_source = 'scheduled_marker_recovery', resolved_at = v_now, updated_at = v_now
  from dashboard_private.registration_customer_reminder_jobs job
  where job.message_kind = 'observation_reminder' and job.status = 'dispatching' and job.message_id = message.id
    and message.delivery_origin = 'scheduled' and message.status = 'pending' and message.provider_attempt_count = 1
    and message.provider_attempt_started_at <= v_now - interval '15 minutes';
  update dashboard_private.registration_customer_reminder_jobs job
  set status = case when message.status = 'unknown' then 'delivery_unknown' else 'completed' end,
      claim_token = null, claim_expires_at = null,
      last_error_code = case when message.status = 'unknown' then 'provider_dispatch_uncertain'
        when message.status = 'failed_hold' then 'provider_rejected' else null end
  from public.ops_registration_customer_messages message
  where job.message_kind = 'observation_reminder' and job.message_id = message.id and job.status = 'dispatching'
    and message.status in ('accepted', 'unknown', 'failed_hold');
  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'pending', claim_token = null, claim_expires_at = null,
      available_at = v_now, last_error_code = 'claim_lease_expired'
  where job.message_kind = 'observation_reminder' and job.status = 'claimed' and job.message_id is null
    and job.claim_expires_at <= v_now;

  for v_job in
    select job.*
    from dashboard_private.registration_customer_reminder_jobs job
    join public.ops_registration_appointments appointment on appointment.id = job.appointment_id
    join dashboard_private.registration_customer_solapi_activation activation
      on activation.message_kind = job.message_kind
    join dashboard_private.registration_customer_solapi_template_receipts receipt
      on receipt.message_kind = job.message_kind
      and receipt.provider_status = 'sendable'
      and receipt.catalog_checksum = receipt.provider_checksum
    where job.status = 'pending' and job.available_at <= v_now and job.due_at <= v_now
      and appointment.scheduled_at > v_now
      and case job.message_kind
        when 'appointment_reminder' then
          appointment.notification_revision = job.source_revision
          and dashboard_private.registration_appointment_reminder_due_v1(
            appointment.kind, appointment.status, appointment.scheduled_at, appointment.created_at,
            appointment.schedule_confirmed_at, v_now
          )
          and activation.mode = 'live'
          and dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
            'appointment_reminder', receipt.template_id, receipt.pf_id, receipt.catalog_checksum
          )
        when 'observation_reminder' then
          appointment.status = 'scheduled'
          and public.registration_observation_runtime_version() = 1
          and activation.mode in ('verification', 'live')
        else false
      end
    order by job.due_at, job.job_id
    for update of job skip locked
    limit 100
  loop
    select activation.* into v_activation
    from dashboard_private.registration_customer_solapi_activation activation
    where activation.message_kind = v_job.message_kind;
    select receipt.* into v_receipt
    from dashboard_private.registration_customer_solapi_template_receipts receipt
      where receipt.message_kind = v_job.message_kind
        and receipt.provider_status = 'sendable'
        and receipt.catalog_checksum = receipt.provider_checksum;

    if v_job.message_kind = 'appointment_reminder' then
      if v_activation.mode is distinct from 'live'
        or v_receipt.message_kind is null
        or not dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
          'appointment_reminder', v_receipt.template_id, v_receipt.pf_id, v_receipt.catalog_checksum
        )
      then
        continue;
      end if;
    else
      if public.registration_observation_runtime_version() <> 1
        or v_receipt.message_kind is null
        or v_activation.mode not in ('verification', 'live')
      then
        continue;
      end if;
      if v_activation.mode = 'verification' and (
        v_job.task_id is distinct from v_activation.verification_task_id
        or v_job.activation_mode_snapshot is distinct from 'verification'
        or v_job.verification_started_at is distinct from v_activation.updated_at
        or v_job.verification_recipient_hash is distinct from v_activation.verification_recipient_hash
        or not exists (
          select 1
          from dashboard_private.registration_observation_domain_events source_event
          where source_event.event_id = v_job.source_event_id
            and source_event.occurred_at >= v_job.verification_started_at
        )
      ) then
        update dashboard_private.registration_customer_reminder_jobs job
        set status = 'canceled', available_at = null,
            claim_token = null, claim_expires_at = null,
            last_error_code = 'verification_scope_changed'
        where job.job_id = v_job.job_id;
        continue;
      end if;
      if v_activation.mode = 'live' and (
        not dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
          'observation_reminder', v_receipt.template_id, v_receipt.pf_id, v_receipt.catalog_checksum
        )
        or v_job.activation_mode_snapshot is distinct from 'live'
        or v_activation.automatic_delivery_cutoff_at is null
        or not exists (
          select 1
          from dashboard_private.registration_observation_domain_events source_event
          where source_event.event_id = v_job.source_event_id
            and source_event.occurred_at >= v_activation.automatic_delivery_cutoff_at
        )
      ) then
        update dashboard_private.registration_customer_reminder_jobs job
        set status = 'canceled', available_at = null,
            claim_token = null, claim_expires_at = null,
            last_error_code = 'pre_cutoff_backlog'
        where job.job_id = v_job.job_id;
        continue;
      end if;
      begin
        v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl(
          'observation_reminder', v_job.observation_id
        );
      exception
        when sqlstate '22023' or sqlstate 'P0002' then
          update dashboard_private.registration_customer_reminder_jobs job
          set status = 'canceled', available_at = null,
              claim_token = null, claim_expires_at = null,
              last_error_code = 'source_ineligible'
          where job.job_id = v_job.job_id;
          continue;
        when sqlstate 'P0001' then
          if sqlerrm <> 'registration_customer_reminder_booking_fact_changed' then
            raise;
          end if;
          update dashboard_private.registration_customer_reminder_jobs job
          set status = 'source_dirty', available_at = null,
              claim_token = null, claim_expires_at = null,
              last_error_code = 'booking_fact_changed'
          where job.job_id = v_job.job_id;
          continue;
      end;
      if (v_source ->> 'appointmentId')::uuid is distinct from v_job.appointment_id
        or (v_source ->> 'observationId')::uuid is distinct from v_job.observation_id
        or (v_source ->> 'sourceRevision')::bigint is distinct from v_job.source_revision
        or v_source ->> 'bookingFactHash' is distinct from v_job.booking_fact_hash
      then
        update dashboard_private.registration_customer_reminder_jobs job
        set status = 'source_dirty', available_at = null,
            claim_token = null, claim_expires_at = null,
            last_error_code = 'booking_fact_changed'
        where job.job_id = v_job.job_id;
        continue;
      end if;
    end if;

    update dashboard_private.registration_customer_reminder_jobs job
    set status = 'claimed', claim_token = gen_random_uuid(),
        claim_expires_at = v_now + interval '2 minutes', last_error_code = null
    where job.job_id = v_job.job_id
    returning * into v_job;

    if v_job.message_kind = 'appointment_reminder' then
      return pg_catalog.jsonb_build_object(
        'jobId', v_job.job_id, 'appointmentId', v_job.appointment_id,
        'claimToken', v_job.claim_token, 'sourceRevision', v_job.source_revision,
        'scheduledFor', v_job.scheduled_for, 'requestKey', v_job.request_key
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'jobId', v_job.job_id, 'messageKind', v_job.message_kind,
      'appointmentId', v_job.appointment_id, 'observationId', v_job.observation_id,
      'claimToken', v_job.claim_token, 'sourceRevision', v_job.source_revision,
      'scheduledFor', v_job.scheduled_for, 'requestKey', v_job.request_key
    );
  end loop;
  return null;
end;
$$;

alter function public.claim_registration_customer_reminder_job_v1()
  owner to postgres;
revoke all on function public.claim_registration_customer_reminder_job_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.claim_registration_customer_reminder_job_v1()
  to service_role;

create or replace function public.has_registration_customer_reminder_backlog_v1()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501';
  end if;
  if not (select enabled from dashboard_private.registration_customer_reminder_settings where singleton) then
    return false;
  end if;
  return exists (
    select 1
    from dashboard_private.registration_customer_reminder_jobs job
    join public.ops_registration_appointments appointment on appointment.id = job.appointment_id
    join dashboard_private.registration_customer_solapi_activation activation
      on activation.message_kind = job.message_kind
    join dashboard_private.registration_customer_solapi_template_receipts receipt
      on receipt.message_kind = job.message_kind
      and receipt.provider_status = 'sendable'
      and receipt.catalog_checksum = receipt.provider_checksum
    where job.status = 'pending'
      and job.available_at <= v_now
      and job.due_at <= v_now
      and appointment.scheduled_at > v_now
      and case job.message_kind
        when 'appointment_reminder' then
          appointment.notification_revision = job.source_revision
          and dashboard_private.registration_appointment_reminder_due_v1(
            appointment.kind, appointment.status, appointment.scheduled_at, appointment.created_at,
            appointment.schedule_confirmed_at, v_now
          )
          and activation.mode = 'live'
          and dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
            'appointment_reminder', receipt.template_id, receipt.pf_id, receipt.catalog_checksum
          )
        when 'observation_reminder' then
          appointment.status = 'scheduled'
          and public.registration_observation_runtime_version() = 1
          and (
            activation.mode = 'verification'
            and job.activation_mode_snapshot = 'verification'
            and job.task_id = activation.verification_task_id
            and job.verification_started_at = activation.updated_at
            and job.verification_recipient_hash = activation.verification_recipient_hash
            and exists (
              select 1
              from dashboard_private.registration_observation_domain_events source_event
              where source_event.event_id = job.source_event_id
                and source_event.occurred_at >= job.verification_started_at
            )
          or activation.mode = 'live'
            and job.activation_mode_snapshot = 'live'
            and activation.automatic_delivery_cutoff_at is not null
            and dashboard_private.registration_customer_solapi_live_evidence_valid_v1(
              'observation_reminder', receipt.template_id, receipt.pf_id, receipt.catalog_checksum
            )
            and exists (
              select 1
              from dashboard_private.registration_observation_domain_events source_event
              where source_event.event_id = job.source_event_id
                and source_event.occurred_at >= activation.automatic_delivery_cutoff_at
            )
          )
        else false
      end
  );
end;
$$;

alter function public.has_registration_customer_reminder_backlog_v1()
  owner to postgres;
revoke all on function public.has_registration_customer_reminder_backlog_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.has_registration_customer_reminder_backlog_v1()
  to service_role;

-- Booking-fact drift is a durable domain conflict, not a serialization failure.
-- Patch the three active functions transactionally while preserving their full
-- post-evidence definitions, ownership, ACL, and security settings.
do $registration_customer_reminder_sqlstate_patch$
declare
  v_definition text;
  v_original text;
  v_old text;
  v_new text;
  v_message text := 'registration_customer_reminder_booking_fact_changed';
  v_old_state text := '40' || '001';
  v_new_state text := 'P0001';
begin
  select pg_catalog.pg_get_functiondef(
    'dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)'::pg_catalog.regprocedure
  ) into v_definition;
  v_old := pg_catalog.format(
    'raise exception %L%s      using errcode = %L;',
    v_message,
    pg_catalog.chr(10),
    v_old_state
  );
  v_new := pg_catalog.format(
    'raise exception %L%s      using errcode = %L;',
    v_message,
    pg_catalog.chr(10),
    v_new_state
  );
  if pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
        <> pg_catalog.length(v_old)
    or pg_catalog.strpos(v_definition, v_new) <> 0
  then
    raise exception 'registration_customer_reminder_sqlstate_patch_failed'
      using errcode = '55000', detail = 'resolver_precondition';
  end if;
  v_original := v_definition;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  if v_definition = v_original then
    raise exception 'registration_customer_reminder_sqlstate_patch_failed'
      using errcode = '55000', detail = 'resolver_unchanged';
  end if;
  execute v_definition;
  select pg_catalog.pg_get_functiondef(
    'dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)'::pg_catalog.regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_old) <> 0
    or pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_new, ''))
        <> pg_catalog.length(v_new)
  then
    raise exception 'registration_customer_reminder_sqlstate_patch_failed'
      using errcode = '55000', detail = 'resolver_postcondition';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.read_registration_customer_reminder_source_v1(uuid,uuid)'::pg_catalog.regprocedure
  ) into v_definition;
  v_old := pg_catalog.format(
    'raise exception %L using errcode = %L;',
    v_message,
    v_old_state
  );
  v_new := pg_catalog.format(
    'raise exception %L using errcode = %L;',
    v_message,
    v_new_state
  );
  if pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
        <> pg_catalog.length(v_old)
    or pg_catalog.strpos(v_definition, v_new) <> 0
  then
    raise exception 'registration_customer_reminder_sqlstate_patch_failed'
      using errcode = '55000', detail = 'read_precondition';
  end if;
  v_original := v_definition;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  if v_definition = v_original then
    raise exception 'registration_customer_reminder_sqlstate_patch_failed'
      using errcode = '55000', detail = 'read_unchanged';
  end if;
  execute v_definition;
  select pg_catalog.pg_get_functiondef(
    'public.read_registration_customer_reminder_source_v1(uuid,uuid)'::pg_catalog.regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_old) <> 0
    or pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_new, ''))
        <> pg_catalog.length(v_new)
  then
    raise exception 'registration_customer_reminder_sqlstate_patch_failed'
      using errcode = '55000', detail = 'read_postcondition';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  v_old := pg_catalog.format(
    '  exception%s    when sqlstate %L then%s      update dashboard_private.registration_customer_reminder_jobs job',
    pg_catalog.chr(10),
    v_old_state,
    pg_catalog.chr(10)
  );
  v_new := pg_catalog.format(
    '  exception%s    when sqlstate %L then%s      if sqlerrm <> %L then%s        raise;%s      end if;%s      update dashboard_private.registration_customer_reminder_jobs job',
    pg_catalog.chr(10),
    v_new_state,
    pg_catalog.chr(10),
    v_message,
    pg_catalog.chr(10),
    pg_catalog.chr(10),
    pg_catalog.chr(10)
  );
  if pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
        <> pg_catalog.length(v_old)
    or pg_catalog.strpos(v_definition, v_new) <> 0
  then
    raise exception 'registration_customer_reminder_sqlstate_patch_failed'
      using errcode = '55000', detail = 'begin_precondition';
  end if;
  v_original := v_definition;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  if v_definition = v_original then
    raise exception 'registration_customer_reminder_sqlstate_patch_failed'
      using errcode = '55000', detail = 'begin_unchanged';
  end if;
  execute v_definition;
  select pg_catalog.pg_get_functiondef(
    'public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  if pg_catalog.strpos(v_definition, v_old) <> 0
    or pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_new, ''))
        <> pg_catalog.length(v_new)
  then
    raise exception 'registration_customer_reminder_sqlstate_patch_failed'
      using errcode = '55000', detail = 'begin_postcondition';
  end if;
end;
$registration_customer_reminder_sqlstate_patch$;

commit;
