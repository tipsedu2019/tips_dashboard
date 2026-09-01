begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $registration_archived_subject_delivery_dependencies$
begin
  if pg_catalog.to_regclass('public.ops_registration_subject_tracks') is null
    or not exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid =
        'public.ops_registration_subject_tracks'::pg_catalog.regclass
        and attribute.attname = 'archived_at'
        and not attribute.attisdropped
    )
    or pg_catalog.to_regprocedure(
      'dashboard_private.get_registration_observation_notification_source_impl_v1(uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.resolve_registration_customer_message_source_pre_observation_v1(text,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.resolve_registration_customer_message_source_pre_booking_eligib(text,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.sync_registration_customer_reminder_jobs_v1()'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.claim_registration_customer_reminder_job_v1()'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.prepare_registration_observation_notification_delivery_v1(uuid,uuid,uuid,uuid,bigint,text,text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.collect_registration_customer_message_bundle_items_v1(uuid,text,text,date,timestamp with time zone)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.materialize_registration_customer_message_bundle_v1(uuid,text,text,date,timestamp with time zone)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.resolve_registration_customer_message_bundle_source_v1(text,uuid,date)'
    ) is null
    or pg_catalog.to_regclass(
      'dashboard_private.registration_customer_message_bundles'
    ) is null
    or pg_catalog.to_regclass(
      'dashboard_private.registration_customer_message_bundle_items'
    ) is null
  then
    raise exception 'registration_archived_subject_delivery_dependency_missing'
      using errcode = '55000';
  end if;
end;
$registration_archived_subject_delivery_dependencies$;

-- Appointment notifications are shared across subject activities.  Their
-- eligibility is therefore the existence of at least one active participant,
-- never the mere survival of historical level-test/consultation rows.
create or replace function dashboard_private.registration_appointment_has_active_subject_v1(
  p_appointment_id uuid,
  p_task_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_appointment_id is not null
    and p_task_id is not null
    and exists (
      select 1
      from public.ops_registration_appointments appointment
      where appointment.id = p_appointment_id
        and appointment.task_id = p_task_id
    )
    and (
      exists (
        select 1
        from public.ops_registration_level_tests level_test
        join public.ops_registration_subject_tracks track
          on track.id = level_test.track_id
         and track.task_id = p_task_id
         and track.archived_at is null
        where level_test.appointment_id = p_appointment_id
      )
      or exists (
        select 1
        from public.ops_registration_consultations consultation
        join public.ops_registration_subject_tracks track
          on track.id = consultation.track_id
         and track.task_id = p_task_id
         and track.archived_at is null
        where consultation.appointment_id = p_appointment_id
      )
      or exists (
        select 1
        from public.ops_registration_observations observation
        join public.ops_registration_subject_tracks track
          on track.id = observation.track_id
         and track.task_id = p_task_id
         and track.archived_at is null
        where observation.appointment_id = p_appointment_id
          and observation.task_id = p_task_id
      )
    );
$$;

alter function dashboard_private.registration_appointment_has_active_subject_v1(uuid, uuid)
  owner to postgres;
revoke all on function dashboard_private.registration_appointment_has_active_subject_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Patch the final ordered definitions in-place.  Every replacement is guarded
-- by an exact precondition so a later migration-chain drift fails deployment
-- instead of silently reopening a provider path.
do $registration_archived_subject_source_guards$
declare
  v_definition text;
  v_original text;
  v_needle text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.get_registration_observation_notification_source_impl_v1(uuid)'::pg_catalog.regprocedure
  );
  v_original := v_definition;
  v_needle := '    and track.subject = v_observation.subject;';
  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception 'registration_observation_chat_archive_guard_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(
    v_definition,
    v_needle,
    '    and track.subject = v_observation.subject' || E'\n'
      || '    and track.archived_at is null;'
  );
  if v_definition = v_original then
    raise exception 'registration_observation_chat_archive_guard_failed'
      using errcode = '55000';
  end if;
  execute v_definition;

  -- Bundles are the task-scoped customer-message surface used by the current
  -- reservation UI.  Historical child rows must never make an archived
  -- subject reappear in a newly rendered bundle.
  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.collect_registration_customer_message_bundle_items_v1(uuid,text,text,date,timestamp with time zone)'::pg_catalog.regprocedure
  );
  v_original := v_definition;
  if pg_catalog.strpos(
      v_definition,
      'join public.ops_registration_subject_tracks track on track.id = level_test.track_id'
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      'join public.ops_registration_subject_tracks track on track.id = consultation.track_id'
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      'join public.ops_registration_appointments appointment on appointment.id = observation.appointment_id'
    ) = 0
  then
    raise exception 'registration_bundle_archive_guard_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(
    v_definition,
    'join public.ops_registration_subject_tracks track on track.id = level_test.track_id',
    'join public.ops_registration_subject_tracks track on track.id = level_test.track_id' || E'\n'
      || '     and track.task_id = p_task_id' || E'\n'
      || '     and track.archived_at is null'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'join public.ops_registration_subject_tracks track on track.id = consultation.track_id',
    'join public.ops_registration_subject_tracks track on track.id = consultation.track_id' || E'\n'
      || '     and track.task_id = p_task_id' || E'\n'
      || '     and track.archived_at is null'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'join public.ops_registration_appointments appointment on appointment.id = observation.appointment_id',
    'join public.ops_registration_appointments appointment on appointment.id = observation.appointment_id' || E'\n'
      || '    join public.ops_registration_subject_tracks track' || E'\n'
      || '      on track.id = observation.track_id' || E'\n'
      || '     and track.task_id = p_task_id' || E'\n'
      || '     and track.archived_at is null'
  );
  if v_definition = v_original
    or pg_catalog.regexp_count(v_definition, 'track\.archived_at is null') < 3
  then
    raise exception 'registration_bundle_archive_guard_failed'
      using errcode = '55000';
  end if;
  execute v_definition;

  -- Serialize bundle materialization with subject archive/restore.  Without
  -- this lock, a collector snapshot could read an active row, lose the race
  -- to an archive commit, and insert a stale bundle after the archive trigger
  -- had already scanned existing work.
  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.materialize_registration_customer_message_bundle_v1(uuid,text,text,date,timestamp with time zone)'::pg_catalog.regprocedure
  );
  v_original := v_definition;
  v_needle := '  select detail.customer_message_recipient_revision into strict v_recipient_revision';
  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception 'registration_bundle_materialize_lock_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(
    v_definition,
    v_needle,
    $replacement$  perform track.id
  from public.ops_registration_subject_tracks track
  where track.id = any (array(
    select (item.value ->> 'trackId')::uuid
    from pg_catalog.jsonb_array_elements(v_items) item(value)
  ))
  order by track.id
  for share;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_items) item(value)
    left join public.ops_registration_subject_tracks track
      on track.id = (item.value ->> 'trackId')::uuid
     and track.task_id = p_task_id
    where track.id is null
      or track.archived_at is not null
  ) then
    raise exception 'registration_customer_message_bundle_source_ineligible'
      using errcode = '22023';
  end if;
  select detail.customer_message_recipient_revision into strict v_recipient_revision$replacement$
  );
  if v_definition = v_original
    or v_definition not like '%order by track.id%for share%track.archived_at is not null%'
  then
    raise exception 'registration_bundle_materialize_lock_guard_failed'
      using errcode = '55000';
  end if;
  execute v_definition;

  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)'::pg_catalog.regprocedure
  );
  v_original := v_definition;
  v_needle := '    and track.subject = v_observation.subject';
  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception 'registration_observation_customer_archive_guard_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(
    v_definition,
    v_needle,
    v_needle || E'\n' || '    and track.archived_at is null'
  );
  if v_definition = v_original then
    raise exception 'registration_observation_customer_archive_guard_failed'
      using errcode = '55000';
  end if;
  execute v_definition;

  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.resolve_registration_customer_message_source_pre_observation_v1(text,uuid)'::pg_catalog.regprocedure
  );
  v_original := v_definition;
  if pg_catalog.strpos(v_definition, 'on track.id = level_test.track_id') = 0
    or pg_catalog.strpos(v_definition, 'on track.id = consultation.track_id') = 0
  then
    raise exception 'registration_appointment_customer_archive_guard_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(
    v_definition,
    'on track.id = level_test.track_id',
    'on track.id = level_test.track_id' || E'\n'
      || '     and track.archived_at is null'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'on track.id = consultation.track_id',
    'on track.id = consultation.track_id' || E'\n'
      || '     and track.archived_at is null'
  );
  if v_definition = v_original
    or v_definition not like '%level_test.track_id%track.archived_at is null%'
    or v_definition not like '%consultation.track_id%track.archived_at is null%'
  then
    raise exception 'registration_appointment_customer_archive_guard_failed'
      using errcode = '55000';
  end if;
  execute v_definition;

  -- This delegated legacy resolver owns waiting and admission previews.  It is
  -- still part of the final call chain, so both direct track and task-wide
  -- enrollment scans must ignore archived subjects.
  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.resolve_registration_customer_message_source_pre_booking_eligib(text,uuid)'::pg_catalog.regprocedure
  );
  v_original := v_definition;
  if pg_catalog.strpos(v_definition, 'and track.task_id = v_task_id') = 0
    or pg_catalog.strpos(v_definition, 'where track.task_id = v_task_id') = 0
  then
    raise exception 'registration_waiting_admission_archive_guard_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(
    v_definition,
    'and track.task_id = v_task_id',
    'and track.task_id = v_task_id' || E'\n'
      || '      and track.archived_at is null'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'where track.task_id = v_task_id',
    'where track.task_id = v_task_id' || E'\n'
      || '      and track.archived_at is null'
  );
  if v_definition = v_original
    or v_definition not like '%track.id = p_source_id%track.archived_at is null%'
    or pg_catalog.regexp_count(
      v_definition,
      'track\.archived_at is null'
    ) < 5
  then
    raise exception 'registration_waiting_admission_archive_guard_failed'
      using errcode = '55000';
  end if;
  execute v_definition;
end;
$registration_archived_subject_source_guards$;

do $registration_archived_subject_worker_guards$
declare
  v_definition text;
  v_original text;
  v_needle text;
  v_replacement text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'dashboard_private.sync_registration_customer_reminder_jobs_v1()'::pg_catalog.regprocedure
  );
  v_original := v_definition;
  v_needle := $needle$    and appointment.status = 'scheduled'
    and not exists ($needle$;
  v_replacement := $replacement$    and appointment.status = 'scheduled'
    and dashboard_private.registration_appointment_has_active_subject_v1(
      appointment.id, appointment.task_id
    )
    and not exists ($replacement$;
  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception 'registration_reminder_sync_archive_guard_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_needle, v_replacement);
  if v_definition = v_original then
    raise exception 'registration_reminder_sync_archive_guard_failed'
      using errcode = '55000';
  end if;

  -- Cleanup is deliberately worker-owned.  A subject fact write never locks
  -- delivery state; the next reminder synchronization lazily cancels only
  -- provider-zero work, or reopens that exact revision after a valid restore.
  v_needle := $needle$  update public.ops_registration_customer_messages message$needle$;
  v_replacement := $replacement$  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'canceled',
      available_at = null,
      claim_token = null,
      claim_expires_at = null,
      last_error_code = 'subject_archived',
      updated_at = v_now
  from public.ops_registration_appointments appointment
  where job.message_kind = 'appointment_reminder'
    and job.status in ('pending', 'claimed')
    and job.message_id is null
    and appointment.id = job.appointment_id
    and appointment.task_id = job.task_id
    and not dashboard_private.registration_appointment_has_active_subject_v1(
      appointment.id, appointment.task_id
    );

  update public.ops_registration_customer_messages message$replacement$;
  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception 'registration_reminder_sync_lazy_cancel_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_needle, v_replacement);

  v_needle := $needle$  insert into dashboard_private.registration_customer_reminder_jobs($needle$;
  v_replacement := $replacement$  update dashboard_private.registration_customer_reminder_jobs job
  set status = 'pending',
      available_at = v_now,
      claim_token = null,
      claim_expires_at = null,
      last_error_code = null,
      updated_at = v_now
  from public.ops_registration_appointments appointment
  where job.message_kind = 'appointment_reminder'
    and job.status = 'canceled'
    and job.last_error_code = 'subject_archived'
    and job.message_id is null
    and appointment.id = job.appointment_id
    and appointment.task_id = job.task_id
    and appointment.kind in ('level_test', 'visit_consultation')
    and appointment.status = 'scheduled'
    and appointment.scheduled_at > v_now
    and appointment.notification_revision = job.source_revision
    and dashboard_private.registration_appointment_has_active_subject_v1(
      appointment.id, appointment.task_id
    );

  insert into dashboard_private.registration_customer_reminder_jobs($replacement$;
  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception 'registration_reminder_sync_lazy_restore_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_needle, v_replacement);
  if v_definition not like '%last_error_code = ''subject_archived''%'
    or v_definition not like '%job.status = ''canceled''%'
  then
    raise exception 'registration_reminder_sync_lazy_reconcile_failed'
      using errcode = '55000';
  end if;
  execute v_definition;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.claim_registration_customer_reminder_job_v1()'::pg_catalog.regprocedure
  );
  v_original := v_definition;
  v_needle := $needle$        when 'appointment_reminder' then
          appointment.notification_revision = job.source_revision$needle$;
  v_replacement := $replacement$        when 'appointment_reminder' then
          dashboard_private.registration_appointment_has_active_subject_v1(
            job.appointment_id, job.task_id
          )
          and appointment.notification_revision = job.source_revision$replacement$;
  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception 'registration_reminder_claim_archive_filter_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_needle, v_replacement);

  v_needle := $needle$    if v_job.message_kind = 'appointment_reminder' then
      if v_activation.mode is distinct from 'live'$needle$;
  v_replacement := $replacement$    if v_job.message_kind = 'appointment_reminder' then
      begin
        v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl(
          'appointment_reminder', v_job.appointment_id
        );
      exception
        when sqlstate '22023' or sqlstate 'P0002' then
          update dashboard_private.registration_customer_reminder_jobs job
          set status = 'canceled', available_at = null,
              claim_token = null, claim_expires_at = null,
              last_error_code = case
                when not dashboard_private.registration_appointment_has_active_subject_v1(
                  v_job.appointment_id, v_job.task_id
                ) then 'subject_archived'
                else 'source_ineligible'
              end
          where job.job_id = v_job.job_id;
          continue;
      end;
      if v_activation.mode is distinct from 'live'$replacement$;
  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception 'registration_reminder_claim_archive_recheck_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_needle, v_replacement);
  if v_definition = v_original
    or v_definition not like '%resolve_registration_customer_message_source_v1_impl(%appointment_reminder%'
  then
    raise exception 'registration_reminder_claim_archive_guard_failed'
      using errcode = '55000';
  end if;
  execute v_definition;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)'::pg_catalog.regprocedure
  );
  v_original := v_definition;
  v_needle := $needle$  if v_kind = 'appointment_reminder' then
    return dashboard_private.begin_registration_customer_reminder_dispatch_legacy_v1($needle$;
  v_replacement := $replacement$  if v_kind = 'appointment_reminder' then
    begin
      v_source := dashboard_private.resolve_registration_customer_message_source_v1_impl(
        'appointment_reminder', (
          select job.appointment_id
          from dashboard_private.registration_customer_reminder_jobs job
          where job.job_id = p_job_id
            and job.status = 'claimed'
            and job.claim_token = p_claim_token
        )
      );
    exception
      when sqlstate '22023' or sqlstate 'P0002' then
        update dashboard_private.registration_customer_reminder_jobs job
        set status = 'canceled', available_at = null,
            claim_token = null, claim_expires_at = null,
            last_error_code = case
              when not dashboard_private.registration_appointment_has_active_subject_v1(
                job.appointment_id, job.task_id
              ) then 'subject_archived'
              else 'source_ineligible'
            end
        where job.job_id = p_job_id
          and job.status = 'claimed'
          and job.claim_token = p_claim_token;
        return pg_catalog.jsonb_build_object(
          'allowed', false, 'messageId', null,
          'dispatchToken', null, 'currentStatus', 'canceled'
        );
    end;
    return dashboard_private.begin_registration_customer_reminder_dispatch_legacy_v1($replacement$;
  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception 'registration_reminder_prepare_archive_guard_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_needle, v_replacement);
  if v_definition = v_original
    or v_definition not like '%resolve_registration_customer_message_source_v1_impl(%appointment_reminder%'
  then
    raise exception 'registration_reminder_prepare_archive_guard_failed'
      using errcode = '55000';
  end if;
  execute v_definition;

  -- The final Google Chat prepare already rebuilds the source after acquiring
  -- the complete lock prefix.  Require the discovered track itself to remain
  -- active before that lock can authorize the provider attempt marker.
  v_definition := pg_catalog.pg_get_functiondef(
    'public.prepare_registration_observation_notification_delivery_v1(uuid,uuid,uuid,uuid,bigint,text,text)'::pg_catalog.regprocedure
  );
  v_original := v_definition;
  v_needle := $needle$  where track.id = v_discovered_track_id
  for share;$needle$;
  v_replacement := $replacement$  where track.id = v_discovered_track_id
    and track.archived_at is null
  for share;$replacement$;
  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception 'registration_observation_prepare_archive_guard_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_needle, v_replacement);
  if v_definition = v_original
    or v_definition not like '%track.archived_at is null%get_registration_observation_notification_source_impl_v1%'
  then
    raise exception 'registration_observation_prepare_archive_guard_failed'
      using errcode = '55000';
  end if;
  execute v_definition;
end;
$registration_archived_subject_worker_guards$;

-- An archive can invalidate a manual preview after an outbox row was claimed
-- but before its provider marker.  Keep that row as an audit hold while
-- allowing a newly rendered active-subject payload to receive a fresh unique
-- identity.  Rows with a provider marker never receive this hold marker and
-- remain covered by the original lifetime uniqueness rules.
drop index dashboard_private.registration_customer_message_booking_bundle_revision_idx;
create unique index registration_customer_message_booking_bundle_revision_idx
  on dashboard_private.registration_customer_message_bundles(
    task_id,
    reservation_kind,
    delivery_kind,
    source_fingerprint,
    bundle_revision
  )
  where delivery_kind = 'booking'
    and status <> 'canceled';

drop index dashboard_private.registration_customer_message_reminder_bundle_revision_idx;
create unique index registration_customer_message_reminder_bundle_revision_idx
  on dashboard_private.registration_customer_message_bundles(
    task_id,
    reservation_kind,
    delivery_kind,
    service_date,
    bundle_revision
  )
  where delivery_kind = 'reminder'
    and status <> 'canceled';

alter table public.ops_registration_customer_messages
  drop constraint ops_registration_customer_messages_dedupe_key_key;

create unique index ops_registration_customer_messages_dedupe_key_active_uidx
  on public.ops_registration_customer_messages(dedupe_key)
  where error_code is distinct from 'subject_archived';

drop index public.ops_reg_customer_msg_appointment_revision_once_idx;
create unique index ops_reg_customer_msg_appointment_revision_once_idx
  on public.ops_registration_customer_messages(
    appointment_id,
    message_kind,
    source_revision
  )
  where message_kind in ('level_test_booking', 'visit_consultation_booking')
    and error_code is distinct from 'subject_archived';

drop index public.ops_reg_customer_msg_reminder_lifetime_once_idx;
create unique index ops_reg_customer_msg_reminder_lifetime_once_idx
  on public.ops_registration_customer_messages(appointment_id, message_kind)
  where message_kind = 'appointment_reminder'
    and error_code is distinct from 'subject_archived';

drop index public.ops_reg_customer_msg_waiting_once_idx;
create unique index ops_reg_customer_msg_waiting_once_idx
  on public.ops_registration_customer_messages(track_id, message_kind)
  where message_kind = 'waiting_notice'
    and error_code is distinct from 'subject_archived';

drop index public.ops_reg_customer_msg_admission_once_idx;
create unique index ops_reg_customer_msg_admission_once_idx
  on public.ops_registration_customer_messages(task_id, message_kind)
  where message_kind = 'admission_application'
    and error_code is distinct from 'subject_archived';

drop index public.ops_reg_customer_msg_observation_revision_once_idx;
create unique index ops_reg_customer_msg_observation_revision_once_idx
  on public.ops_registration_customer_messages(
    observation_id,
    message_kind,
    source_revision
  )
  where message_kind in ('observation_booking', 'observation_reminder')
    and error_code is distinct from 'subject_archived';

drop index public.ops_reg_customer_msg_booking_bundle_once_idx;
create unique index ops_reg_customer_msg_booking_bundle_once_idx
  on public.ops_registration_customer_messages(
    bundle_id,
    message_kind,
    source_fingerprint
  )
  where message_kind in (
      'level_test_booking_bundle',
      'visit_consultation_booking_bundle',
      'observation_booking_bundle'
    )
    and error_code is distinct from 'subject_archived';

do $registration_archived_manual_message_claim_guard$
declare
  v_identity pg_catalog.regprocedure;
  v_definition text;
  v_original text;
  v_needle text;
  v_replacement text;
begin
  v_identity :=
    'dashboard_private.claim_registration_customer_message_pre_observation_v1(uuid,uuid,text,jsonb)'::pg_catalog.regprocedure;
  v_definition := pg_catalog.pg_get_functiondef(v_identity);
  v_original := v_definition;
  v_needle := $needle$  if found then
    perform dashboard_private.registration_customer_message_assert_actor_v1($needle$;
  v_replacement := $replacement$  if found then
    if v_message.error_code = 'subject_archived' then
      return dashboard_private.registration_customer_message_result_v1(
        v_message.id, false, true, false
      );
    end if;
    perform dashboard_private.registration_customer_message_assert_actor_v1($replacement$;
  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception 'registration_manual_legacy_claim_hold_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_needle, v_replacement);
  v_needle := $needle$  where message.dedupe_key = v_dedupe_key
  for update;$needle$;
  v_replacement := $replacement$  where message.dedupe_key = v_dedupe_key
    and message.error_code is distinct from 'subject_archived'
  for update;$replacement$;
  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception 'registration_manual_legacy_claim_dedupe_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_needle, v_replacement);
  if v_definition = v_original
    or v_definition not like '%error_code = ''subject_archived''%'
    or v_definition not like '%error_code is distinct from ''subject_archived''%'
  then
    raise exception 'registration_manual_legacy_claim_hold_guard_failed'
      using errcode = '55000';
  end if;
  execute v_definition;

  v_identity :=
    'public.claim_registration_customer_message_v1(uuid,uuid,text,jsonb)'::pg_catalog.regprocedure;
  v_definition := pg_catalog.pg_get_functiondef(v_identity);
  v_original := v_definition;
  v_needle := $needle$  if found then
    perform dashboard_private.registration_customer_message_assert_actor_v1($needle$;
  v_replacement := $replacement$  if found then
    if v_message.error_code = 'subject_archived' then
      return dashboard_private.registration_customer_message_result_v1(
        v_message.id, false, true, false
      );
    end if;
    perform dashboard_private.registration_customer_message_assert_actor_v1($replacement$;
  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception 'registration_manual_observation_claim_hold_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_needle, v_replacement);
  v_needle := $needle$  where message.dedupe_key = v_dedupe_key
     or (
       message.observation_id = v_preview.observation_id
       and message.message_kind = v_preview.message_kind
       and message.source_revision = v_preview.source_revision
     )
  order by message.created_at$needle$;
  v_replacement := $replacement$  where (
      message.dedupe_key = v_dedupe_key
      or (
        message.observation_id = v_preview.observation_id
        and message.message_kind = v_preview.message_kind
        and message.source_revision = v_preview.source_revision
      )
    )
    and message.error_code is distinct from 'subject_archived'
  order by message.created_at$replacement$;
  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception 'registration_manual_observation_claim_dedupe_anchor_missing'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_needle, v_replacement);
  if v_definition = v_original
    or v_definition not like '%error_code = ''subject_archived''%'
    or v_definition not like '%error_code is distinct from ''subject_archived''%'
  then
    raise exception 'registration_manual_observation_claim_hold_guard_failed'
      using errcode = '55000';
  end if;
  execute v_definition;
end;
$registration_archived_manual_message_claim_guard$;

-- Subject facts never mutate or lock notification state.  Stale work is
-- rejected by the worker/provider source-current fences above, and reminder
-- cleanup or restore reconciliation runs only from the reminder worker.
drop trigger if exists cancel_registration_archived_subject_delivery
  on public.ops_registration_subject_tracks;
drop function if exists
  dashboard_private.cancel_registration_archived_subject_delivery_v1();

notify pgrst, 'reload schema';

commit;
