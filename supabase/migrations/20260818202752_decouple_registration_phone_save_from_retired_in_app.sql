begin;

set local lock_timeout = '5s';

create or replace function dashboard_private.materialize_registration_phone_legacy_v1(
  p_source_event_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event dashboard_private.notification_events%rowtype;
  v_rule_id uuid;
  v_rule_revision bigint;
  v_template dashboard_private.notification_templates%rowtype;
  v_rule_selection record;
  v_consultation public.ops_registration_consultations%rowtype;
  v_target_generation bigint;
  v_target_set_hash text;
  v_delivery_id uuid;
  v_ownership jsonb;
  v_result jsonb;
  v_render_payload jsonb;
begin
  if p_source_event_id is null or p_request_id is null then
    raise exception 'registration_phone_projection_invalid' using errcode = '22023';
  end if;
  select event_row.* into v_event
  from dashboard_private.notification_events event_row
  where event_row.workflow_key = 'registration'
    and event_row.event_key = 'registration.phone_consultation_ready'
    and event_row.source_type = 'ops_task_event'
    and event_row.source_id = p_source_event_id::text
    and event_row.occurrence_key = p_source_event_id::text;
  if not found then
    raise exception 'registration_phone_notification_event_not_found'
      using errcode = 'P0002';
  end if;
  select consultation.* into v_consultation
  from public.ops_registration_consultations consultation
  where consultation.id = nullif(v_event.payload ->> 'consultation_id', '')::uuid
    and consultation.mode = 'phone'
    and consultation.status = 'waiting';
  if not found then
    raise exception 'registration_phone_consultation_not_found' using errcode = 'P0002';
  end if;

  -- A retired channel is a valid no-delivery state. Keep requiring a complete
  -- rule/template snapshot so configuration drift still fails closed, but do
  -- not let an intentionally disabled notification roll back the consultation.
  select
    rule.id as rule_id,
    (snapshot.item ->> 'rule_revision')::bigint as rule_revision,
    (snapshot.item ->> 'enabled')::boolean as rule_enabled,
    template as template,
    template.allowed_variables as allowed_variables
  into v_rule_selection
  from pg_catalog.jsonb_array_elements(v_event.rule_snapshot) snapshot(item)
  join dashboard_private.notification_rules rule
    on rule.id = (snapshot.item ->> 'rule_id')::uuid
   and rule.active_template_id is not null
  join dashboard_private.notification_templates template
    on template.id = (snapshot.item ->> 'template_id')::uuid
   and template.rule_id = rule.id
  where snapshot.item ->> 'audience_key' = 'track_director'
    and snapshot.item ->> 'channel_key' = 'in_app'
    and rule.scope_key = 'global'
    and rule.workflow_key = 'registration'
    and rule.event_key = 'registration.phone_consultation_ready'
    and rule.audience_key = 'track_director'
    and rule.channel_key = 'in_app'
    and (
      rule.revision > (snapshot.item ->> 'rule_revision')::bigint
      or rule.active_template_id = template.id
    )
  limit 1;
  if not found then
    raise exception 'registration_phone_rule_not_found' using errcode = 'P0002';
  end if;
  if not v_rule_selection.rule_enabled then
    return pg_catalog.jsonb_build_object(
      'deliveryId', null,
      'acquired', false,
      'status', 'skipped',
      'statusReason', 'rule_disabled'
    );
  end if;

  v_rule_id := v_rule_selection.rule_id;
  v_rule_revision := v_rule_selection.rule_revision;
  v_template := v_rule_selection.template;
  v_render_payload := v_event.payload || pg_catalog.jsonb_build_object(
    'subjects', coalesce(v_event.payload -> 'subjects', pg_catalog.jsonb_build_array(v_event.payload ->> 'subject')),
    'progress_line', case
      when nullif(v_event.payload ->> 'progress_actor', '') is null then ''
      else '[진행] ' || (v_event.payload ->> 'progress_actor') || '님의 상담 확인을 기다리고 있어요.'
    end,
    'reason_line', case
      when nullif(v_event.payload ->> 'reason', '') is null then ''
      else '[사유] ' || (v_event.payload ->> 'reason')
    end,
    'memo_line', case
      when nullif(v_event.payload ->> 'memo', '') is null then ''
      else '[메모] ' || (v_event.payload ->> 'memo')
    end
  );

  v_target_generation := v_consultation.recipient_revision;
  v_target_set_hash := dashboard_private.notification_target_set_hash_v1(
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'target_kind', 'profile',
      'target_key', 'profile:' || v_consultation.director_profile_id::text,
      'target_profile_id', v_consultation.director_profile_id,
      'connection_key', null,
      'target_snapshot', pg_catalog.jsonb_build_object(
        'profile_id', v_consultation.director_profile_id
      )
    ))
  );
  v_delivery_id := dashboard_private.materialize_notification_delivery_v1(
    v_event.id,
    v_rule_id,
    v_rule_revision,
    v_template.id,
    v_target_generation,
    v_target_set_hash,
    'profile',
    'profile:' || v_consultation.director_profile_id::text,
    v_consultation.director_profile_id,
    null,
    pg_catalog.jsonb_build_object('profile_id', v_consultation.director_profile_id),
    dashboard_private.registration_render_fixed_template_v2(
      v_template.title_template,
      v_render_payload,
      v_template.allowed_variables
    ),
    dashboard_private.registration_render_fixed_template_v2(
      v_template.body_template,
      v_render_payload,
      v_template.allowed_variables
    ),
    '/admin/registration?taskId=' || (v_event.payload ->> 'task_id')
      || '&trackId=' || (v_event.payload ->> 'track_id'),
    v_event.occurred_at,
    null
  );

  if dashboard_private.notification_dispatch_enabled_v1(
    'registration', 'registration.phone_consultation_ready'
  ) then
    return pg_catalog.jsonb_build_object(
      'deliveryId', v_delivery_id,
      'acquired', false,
      'status', 'canonical_owned'
    );
  end if;

  v_ownership := public.begin_legacy_notification_dispatch_v1(
    'registration',
    v_event.occurrence_key,
    v_rule_id,
    'in_app',
    'profile:' || v_consultation.director_profile_id::text,
    v_target_generation,
    'registration_phone_legacy_bridge_v1',
    0,
    p_request_id
  );
  if not coalesce((v_ownership ->> 'acquired')::boolean, false) then
    return pg_catalog.jsonb_build_object(
      'deliveryId', v_delivery_id,
      'acquired', false,
      'status', coalesce(v_ownership ->> 'status', 'legacy_deduped')
    );
  end if;
  v_result := public.commit_legacy_notification_in_app_projection_v1(
    v_delivery_id,
    (v_ownership ->> 'claim_id')::uuid,
    (v_ownership ->> 'owner_generation')::bigint,
    (v_ownership ->> 'dispatch_token')::uuid
  );
  update public.dashboard_notifications notification
  set type = 'registration_consultation',
      metadata = notification.metadata || pg_catalog.jsonb_build_object(
        'taskId', v_event.payload ->> 'task_id',
        'trackId', v_event.payload ->> 'track_id',
        'consultationId', v_consultation.id,
        'subject', v_event.payload ->> 'subject',
        'directorProfileId', v_consultation.director_profile_id
      )
  where notification.source_delivery_id = v_delivery_id;
  return v_result || pg_catalog.jsonb_build_object(
    'deliveryId', v_delivery_id,
    'acquired', true
  );
end;
$$;

alter function dashboard_private.materialize_registration_phone_legacy_v1(uuid, uuid)
  owner to postgres;
revoke all on function dashboard_private.materialize_registration_phone_legacy_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

commit;
