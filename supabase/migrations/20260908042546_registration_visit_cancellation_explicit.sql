begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A cancellation is an explicit correction of a message that was delivered.
-- Fact writers and the scheduled-appointment readiness contract remain intact.
create function dashboard_private.registration_visit_cancellation_preview_v1(p_appointment_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_appointment public.ops_registration_appointments%rowtype;
  v_previous record;
  v_rule dashboard_private.notification_rules%rowtype;
  v_template dashboard_private.notification_templates%rowtype;
  v_cancellation dashboard_private.notification_events%rowtype;
  v_outcome text;
  v_render jsonb;
  v_preview jsonb;
begin
  select * into v_appointment from public.ops_registration_appointments
  where id = p_appointment_id and kind = 'visit_consultation';
  if not found then
    raise exception 'registration_appointment_not_found' using errcode = 'P0002';
  end if;
  v_preview := pg_catalog.jsonb_build_object(
    'appointmentId', v_appointment.id, 'notificationRevision', v_appointment.notification_revision,
    'scheduledAt', v_appointment.scheduled_at, 'status', 'not_needed',
    'reason', '이전에 전달 완료된 방문상담 안내가 없습니다.', 'canSend', false
  );
  if v_appointment.status <> 'canceled' then
    return v_preview || '{"status":"not_canceled","reason":"취소된 방문상담이 아닙니다."}'::jsonb;
  end if;

  -- Never fall back to an older successful message when a newer dispatch may
  -- have reached the recipient. Definite failures do not supersede a receipt.
  select delivery.*, event_row.payload as source_payload,
    event_row.source_revision as previous_source_revision,
    coalesce(claim.terminal_outcome,
      case when claim.state = 'dispatch_started' then 'sending' end,
      delivery.status) as effective_status
  into v_previous
  from dashboard_private.notification_deliveries delivery
  join dashboard_private.notification_events event_row on event_row.id = delivery.event_id
  left join dashboard_private.notification_dispatch_ownership_claims claim
    on claim.workflow_key = event_row.workflow_key and claim.occurrence_key = event_row.occurrence_key
   and claim.rule_id = delivery.rule_id and claim.channel_key = delivery.channel_key
   and claim.target_key = delivery.target_key and claim.target_generation = delivery.target_generation
  where event_row.workflow_key = 'registration'
    and event_row.source_type = 'registration_appointment'
    and event_row.source_id = p_appointment_id::text
    and event_row.event_key in ('registration.visit_scheduled', 'registration.visit_rescheduled',
      'registration.visit_replaced', 'registration.visit_subject_deselected')
    and delivery.channel_key = 'google_chat' and delivery.audience_key = 'management_team'
    and delivery.connection_key = 'google_chat.management'
    and coalesce(claim.terminal_outcome,
      case when claim.state = 'dispatch_started' then 'sending' end, delivery.status)
      in ('sent', 'sending', 'delivery_unknown')
  order by event_row.source_revision desc, delivery.created_at desc, delivery.id desc limit 1;
  if not found then return v_preview; end if;
  if v_previous.effective_status <> 'sent' then
    return v_preview || '{"status":"unknown","reason":"기존 안내의 전달 결과를 먼저 확인해 주세요."}'::jsonb;
  end if;

  select * into v_cancellation from dashboard_private.notification_events
  where workflow_key = 'registration' and source_type = 'registration_visit_cancellation'
    and source_id = p_appointment_id::text and source_revision = v_appointment.notification_revision
    and event_key = 'registration.visit_canceled'
  order by created_at desc limit 1;
  if found then
    v_render := v_cancellation.payload -> 'cancellation_preview';
    if v_render ->> 'sourceDeliveryId' is distinct from v_previous.id::text then
      return v_preview || '{"status":"unknown","reason":"기존 안내의 전달 이력이 변경되었습니다. 관리팀 확인이 필요합니다."}'::jsonb;
    end if;
    select coalesce(claim.terminal_outcome,
      case when claim.state = 'dispatch_started' then 'sending' end, delivery.status)
    into v_outcome
    from dashboard_private.notification_deliveries delivery
    left join dashboard_private.notification_dispatch_ownership_claims claim
      on claim.workflow_key = 'registration' and claim.occurrence_key = v_cancellation.occurrence_key
     and claim.rule_id = delivery.rule_id and claim.channel_key = delivery.channel_key
     and claim.target_key = delivery.target_key and claim.target_generation = delivery.target_generation
    where delivery.event_id = v_cancellation.id and delivery.channel_key = 'google_chat'
    order by delivery.created_at desc limit 1;
    return v_render || pg_catalog.jsonb_build_object(
      'eventId', v_cancellation.id,
      'status', case when v_outcome = 'sent' then 'sent'
        when v_outcome in ('sending', 'delivery_unknown') then 'unknown'
        when v_outcome = 'failed' then 'failed' else 'ready' end,
      'reason', case when v_outcome = 'sent' then '취소 안내를 전달했습니다.'
        when v_outcome in ('sending', 'delivery_unknown') then '취소 안내의 전달 결과를 확인해 주세요. 다시 보내지 않습니다.'
        when v_outcome = 'failed' then '취소 안내가 전달되지 않았습니다. 내용을 확인한 뒤 다시 보낼 수 있습니다.'
        else '이전에 전달한 방문상담 안내의 취소를 관리팀에 알립니다.' end,
      'canSend', coalesce(v_outcome not in ('sent', 'sending', 'delivery_unknown'), true)
    );
  end if;
  select * into v_rule from dashboard_private.notification_rules
  where workflow_key = 'registration' and event_key = 'registration.visit_canceled'
    and channel_key = 'google_chat' and audience_key = 'management_team' and scope_key = 'global'
  limit 1;
  if not found or not v_rule.enabled
    or dashboard_private.notification_dispatch_enabled_v1('registration', 'registration.visit_canceled') then
    return v_preview || '{"status":"blocked","reason":"방문상담 취소의 직접 발송 설정을 확인해 주세요."}'::jsonb;
  end if;
  select * into strict v_template from dashboard_private.notification_templates where id = v_rule.active_template_id;
  v_render := v_previous.source_payload || pg_catalog.jsonb_build_object(
    'canceled_schedule', dashboard_private.registration_notification_kst_datetime_v1(
      nullif(v_previous.source_payload ->> 'scheduled_at', '')::timestamptz, v_previous.created_at),
    'canceled_place', v_previous.source_payload ->> 'place',
    'progress_line', '', 'reason_line', '[사유] 예약 취소'
  );
  v_preview := v_preview || pg_catalog.jsonb_build_object(
    'status', 'ready', 'canSend', true,
    'reason', '이전에 전달한 방문상담 안내의 취소를 관리팀에 알립니다.',
    'sourceDeliveryId', v_previous.id,
    'scheduledAt', v_previous.source_payload ->> 'scheduled_at',
    'sourceSentAt', v_previous.sent_at, 'sourceTitle', v_previous.rendered_title,
    'sourceBody', v_previous.rendered_body, 'targetLabel', '관리팀',
    'ruleId', v_rule.id, 'ruleRevision', v_rule.revision::text,
    'templateId', v_template.id, 'templateChecksum', v_template.checksum,
    'targetGeneration', v_previous.target_generation::text,
    'targetKey', v_previous.target_key, 'targetSnapshot', v_previous.target_snapshot,
    'renderedTitle', dashboard_private.registration_render_fixed_template_v2(
      v_template.title_template, v_render, v_template.allowed_variables),
    'renderedBody', dashboard_private.registration_render_fixed_template_v2(
      v_template.body_template, v_render, v_template.allowed_variables),
    'href', '/admin/registration?taskId=' || v_appointment.task_id::text,
    'sourcePayload', v_previous.source_payload
  );
  return v_preview || pg_catalog.jsonb_build_object('previewChecksum',
    dashboard_private.notification_sha256_hex_v1(v_preview::text));
end;
$$;

create function public.list_registration_visit_cancellations_v1(p_task_id uuid, p_page integer default 1, p_page_size integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_items jsonb; v_count bigint;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1((select auth.uid()));
  if p_page is null or p_page not between 1 and 100000
    or p_page_size is null or p_page_size not in (10,15,20) then
    raise exception 'registration_visit_cancellation_page_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ops_tasks where id = p_task_id and type = 'registration') then
    raise exception 'registration_task_not_found' using errcode = 'P0002';
  end if;
  select count(*) into v_count from public.ops_registration_appointments
  where task_id = p_task_id and kind = 'visit_consultation' and status = 'canceled';
  select coalesce(pg_catalog.jsonb_agg(candidate.preview - array[
    'sourcePayload', 'targetSnapshot', 'targetKey', 'targetGeneration', 'ruleId',
    'ruleRevision', 'templateId', 'templateChecksum', 'eventId', 'href'
  ] order by candidate.updated_at desc, candidate.id), '[]'::jsonb) into v_items
  from (
    select appointment.id, appointment.updated_at,
      dashboard_private.registration_visit_cancellation_preview_v1(appointment.id) as preview
    from public.ops_registration_appointments appointment
    where appointment.task_id = p_task_id and appointment.kind = 'visit_consultation'
      and appointment.status = 'canceled'
    order by appointment.updated_at desc, appointment.id limit p_page_size offset (p_page - 1) * p_page_size
  ) candidate;
  return pg_catalog.jsonb_build_object('items', v_items, 'page', p_page,
    'pageSize', p_page_size, 'totalCount', v_count);
end;
$$;

create function public.ensure_registration_visit_cancellation_v1(
  p_appointment_id uuid, p_expected_notification_revision integer,
  p_source_delivery_id uuid, p_preview_checksum text, p_request_key uuid
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_appointment public.ops_registration_appointments%rowtype;
  v_preview jsonb;
  v_existing dashboard_private.notification_events%rowtype;
  v_receipt dashboard_private.notification_request_ledger%rowtype;
  v_response jsonb;
  v_fingerprint text;
  v_record jsonb;
  v_occurrence text;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(v_actor);
  if p_appointment_id is null or p_request_key is null or p_source_delivery_id is null
    or p_expected_notification_revision is null or p_expected_notification_revision < 1
    or p_preview_checksum is null or p_preview_checksum !~ '^[a-f0-9]{64}$' then
    raise exception 'registration_visit_cancellation_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'registration-visit-notification-v1:' || p_appointment_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-request:' || p_request_key::text, 0));
  select * into v_appointment from public.ops_registration_appointments
  where id = p_appointment_id and kind = 'visit_consultation' for update;
  if not found then raise exception 'registration_appointment_not_found' using errcode = 'P0002'; end if;
  if v_appointment.status <> 'canceled' or v_appointment.notification_revision <> p_expected_notification_revision then
    raise exception 'registration_visit_cancellation_refresh_required' using errcode = '23514';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actor', v_actor, 'appointment', p_appointment_id, 'revision', p_expected_notification_revision,
    'source', p_source_delivery_id, 'checksum', p_preview_checksum)::text);
  select * into v_receipt from dashboard_private.notification_request_ledger where request_id = p_request_key;
  if found and (v_receipt.request_kind <> 'registration_visit_cancellation_v1'
    or v_receipt.request_fingerprint <> v_fingerprint) then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  v_preview := dashboard_private.registration_visit_cancellation_preview_v1(p_appointment_id);
  if v_preview ->> 'sourceDeliveryId' is distinct from p_source_delivery_id::text
    or v_preview ->> 'previewChecksum' is distinct from p_preview_checksum then
    raise exception 'registration_visit_cancellation_refresh_required' using errcode = '23514';
  end if;
  if v_preview ->> 'status' not in ('ready', 'failed', 'sent') then
    raise exception 'registration_visit_cancellation_not_ready' using errcode = '23514';
  end if;
  v_occurrence := 'registration:visit-cancellation:' || p_appointment_id::text || ':' || p_expected_notification_revision::text;
  select * into v_existing from dashboard_private.notification_events
  where workflow_key = 'registration' and source_type = 'registration_visit_cancellation'
    and source_id = p_appointment_id::text and occurrence_key = v_occurrence;
  if not found then
    v_record := dashboard_private.record_notification_event_v1(
      'global', 'registration', 'registration.visit_canceled', 'registration_visit_cancellation',
      p_appointment_id::text, p_expected_notification_revision, v_occurrence, v_actor,
      pg_catalog.clock_timestamp(), 2,
      (v_preview -> 'sourcePayload') || pg_catalog.jsonb_build_object(
        'appointment_status', 'canceled', 'notification_revision', p_expected_notification_revision,
        'cancellation_preview', v_preview),
      (v_preview ->> 'ruleId')::uuid, (v_preview ->> 'ruleRevision')::bigint
    );
    select * into strict v_existing from dashboard_private.notification_events where id = (v_record ->> 'event_id')::uuid;
    -- The explicit request owns dispatch. A generic worker must never race it.
    update dashboard_private.notification_event_fanout_jobs
    set status = 'succeeded', next_attempt_at = null, last_error_code = null,
      outcome_summary = '{"dispatchOwner":"explicit_visit_cancellation"}'::jsonb,
      completed_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
    where event_id = v_existing.id;
  end if;
  v_response := pg_catalog.jsonb_build_object(
    'appointmentId', p_appointment_id, 'notificationRevision', p_expected_notification_revision,
    'requestKey', p_request_key, 'sourceEventId', v_existing.id, 'ready', true,
    'intent', 'send_registration_visit_cancellation');
  if v_receipt.request_id is null then
    insert into dashboard_private.notification_request_ledger(request_id, request_kind, request_fingerprint, response_payload)
    values (p_request_key, 'registration_visit_cancellation_v1', v_fingerprint, v_response);
  end if;
  return v_response;
end;
$$;

create function dashboard_private.registration_visit_cancellation_source_current_v1(p_event_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_event dashboard_private.notification_events%rowtype; v_preview jsonb;
begin
  select * into v_event from dashboard_private.notification_events where id = p_event_id
    and source_type = 'registration_visit_cancellation' and event_key = 'registration.visit_canceled';
  if not found then return false; end if;
  v_preview := dashboard_private.registration_visit_cancellation_preview_v1(v_event.source_id::uuid);
  return coalesce(v_preview ->> 'notificationRevision' = v_event.source_revision::text
    and v_preview ->> 'sourceDeliveryId' = v_event.payload #>> '{cancellation_preview,sourceDeliveryId}'
    and v_preview ->> 'previewChecksum' = v_event.payload #>> '{cancellation_preview,previewChecksum}'
    and v_preview ->> 'status' in ('ready', 'failed', 'sent', 'unknown'), false);
end;
$$;

-- Preserve scheduled readiness exactly. The service-only materialize/begin
-- wrappers also call this function and recheck the verified manager identity.
create or replace function public.get_registration_visit_legacy_dispatch_plan_v1(
  p_appointment_id uuid, p_actor_profile_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_event dashboard_private.notification_events%rowtype; v_preview jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role'
    and ((select auth.uid()) is null or p_actor_profile_id is distinct from (select auth.uid())) then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(p_actor_profile_id);
  if exists (select 1 from public.ops_registration_appointments
    where id = p_appointment_id and kind = 'visit_consultation' and status = 'canceled') then
    select event_row.* into v_event from dashboard_private.notification_events event_row
    join public.ops_registration_appointments appointment on appointment.id = p_appointment_id
    where event_row.source_type = 'registration_visit_cancellation'
      and event_row.source_id = p_appointment_id::text
      and event_row.source_revision = appointment.notification_revision
      and event_row.event_key = 'registration.visit_canceled' order by event_row.created_at desc limit 1;
    if not found or not dashboard_private.registration_visit_cancellation_source_current_v1(v_event.id) then
      raise exception 'registration_visit_cancellation_refresh_required' using errcode = '23514';
    end if;
    v_preview := v_event.payload -> 'cancellation_preview';
    return pg_catalog.jsonb_build_object(
      'appointmentId', p_appointment_id, 'notificationRevision', v_event.source_revision,
      'recipientRevision', v_preview ->> 'targetGeneration', 'notifiedTrackIds', '[]'::jsonb,
      'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'eventId', v_event.id, 'eventKey', v_event.event_key, 'occurrenceKey', v_event.occurrence_key,
        'ruleId', v_preview ->> 'ruleId', 'ruleRevision', v_preview ->> 'ruleRevision',
        'templateId', v_preview ->> 'templateId', 'templateChecksum', v_preview ->> 'templateChecksum',
        'channelKey', 'google_chat', 'audienceKey', 'management_team',
        'targetGeneration', v_preview ->> 'targetGeneration', 'targetKind', 'connection',
        'targetKey', v_preview ->> 'targetKey', 'targetProfileId', null,
        'connectionKey', 'google_chat.management', 'targetSnapshot', v_preview -> 'targetSnapshot',
        'renderedTitle', v_preview ->> 'renderedTitle', 'renderedBody', v_preview ->> 'renderedBody',
        'href', v_preview ->> 'href', 'scheduledFor', v_event.occurred_at
      )));
  end if;
  if not dashboard_private.registration_visit_notification_source_current_v1(p_appointment_id) then
    raise exception 'registration_visit_notification_refresh_required' using errcode = '23514';
  end if;
  return public.get_registration_visit_legacy_dispatch_plan_v1_base(p_appointment_id, p_actor_profile_id);
end;
$$;

-- Add a last-moment source fence to the final ordered external-attempt gate,
-- keeping the existing ownership, retirement and registration-v2 checks.
do $cancellation_external_fence$
declare v_definition text; v_anchor text; v_replacement text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::pg_catalog.regprocedure);
  v_anchor := '  v_entity_id := v_claim.id::text || ';
  v_replacement := $patch$  if exists (
    select 1 from dashboard_private.notification_events visit
    where visit.workflow_key = v_claim.workflow_key
      and visit.occurrence_key = v_claim.occurrence_key
      and visit.source_type = 'registration_appointment'
      and visit.event_key in ('registration.visit_scheduled', 'registration.visit_rescheduled',
        'registration.visit_replaced', 'registration.visit_subject_deselected')
      and not dashboard_private.registration_visit_notification_source_current_v1(visit.source_id::uuid)
  ) then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'registration_visit_notification_source_stale');
  end if;
  if exists (
    select 1 from dashboard_private.notification_events cancellation
    where cancellation.workflow_key = v_claim.workflow_key
      and cancellation.occurrence_key = v_claim.occurrence_key
      and cancellation.source_type = 'registration_visit_cancellation'
      and not dashboard_private.registration_visit_cancellation_source_current_v1(cancellation.id)
  ) then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'registration_visit_cancellation_source_stale');
  end if;
  v_entity_id := v_claim.id::text || $patch$;
  if pg_catalog.strpos(v_definition, 'word_retest_google_chat_retired') = 0
    or (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, '')))
      <> pg_catalog.length(v_anchor) then
    raise exception 'registration_visit_cancellation_gate_anchor_invalid' using errcode = '55000';
  end if;
  execute pg_catalog.replace(v_definition, v_anchor, v_replacement);
end;
$cancellation_external_fence$;

alter function dashboard_private.registration_visit_cancellation_preview_v1(uuid) owner to postgres;
alter function dashboard_private.registration_visit_cancellation_source_current_v1(uuid) owner to postgres;
alter function public.list_registration_visit_cancellations_v1(uuid,integer,integer) owner to postgres;
alter function public.ensure_registration_visit_cancellation_v1(uuid,integer,uuid,text,uuid) owner to postgres;
alter function public.get_registration_visit_legacy_dispatch_plan_v1(uuid,uuid) owner to postgres;
revoke all on function dashboard_private.registration_visit_cancellation_preview_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_visit_cancellation_source_current_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_registration_visit_cancellations_v1(uuid,integer,integer) from public, anon, authenticated, service_role;
revoke all on function public.ensure_registration_visit_cancellation_v1(uuid,integer,uuid,text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_registration_visit_legacy_dispatch_plan_v1(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_registration_visit_cancellations_v1(uuid,integer,integer) to authenticated;
grant execute on function public.ensure_registration_visit_cancellation_v1(uuid,integer,uuid,text,uuid) to authenticated;
-- The route reads the plan with its user's JWT. Service dispatch reaches this
-- body only through postgres-owned SECURITY DEFINER materialize/begin RPCs.
grant execute on function public.get_registration_visit_legacy_dispatch_plan_v1(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
