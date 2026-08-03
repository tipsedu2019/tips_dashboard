begin;

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure(
    'public.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid)'
  ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.notification_makeup_payload_v1(uuid,uuid,text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.notification_makeup_setting_checksum_v1(text,text,boolean,text,text)'
    ) is null
    or pg_catalog.to_regclass('public.makeup_notification_settings') is null
    or pg_catalog.to_regclass('public.makeup_requests') is null
    or pg_catalog.to_regclass('public.makeup_request_events') is null
    or pg_catalog.to_regclass('dashboard_private.notification_settings_import_metadata') is null
    or pg_catalog.to_regclass('dashboard_private.notification_rules') is null
    or pg_catalog.to_regclass('dashboard_private.notification_templates') is null
  then
    raise exception 'notification_makeup_content_runtime_not_ready' using errcode = '55000';
  end if;
end;
$$;

-- The legacy sender keeps SELECT access while every application writer is routed
-- through the common v2 command. The old legacy-to-canonical trigger is removed;
-- compatibility now flows in one direction after the canonical pointer moves.
revoke insert, update, delete
  on table public.makeup_notification_settings
  from authenticated;
drop policy if exists makeup_notification_settings_staff_write
  on public.makeup_notification_settings;
drop trigger if exists reconcile_makeup_notification_settings_after_write_v1
  on public.makeup_notification_settings;
revoke all on function public.reconcile_makeup_notification_settings_after_write_v1()
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.mirror_makeup_notification_template_v1(
  p_rule_id uuid,
  p_template_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rule dashboard_private.notification_rules%rowtype;
  v_template dashboard_private.notification_templates%rowtype;
  v_mapped_count bigint;
  v_changed_count bigint := 0;
  v_metadata_count bigint := 0;
begin
  if p_rule_id is null or p_template_id is null or p_actor_id is null then
    raise exception 'notification_makeup_mirror_input_invalid' using errcode = '22023';
  end if;

  select rule_row.* into strict v_rule
  from dashboard_private.notification_rules rule_row
  where rule_row.id = p_rule_id
    and rule_row.workflow_key = 'makeup_requests'
    and rule_row.active_template_id = p_template_id
  for update;

  select template_row.* into strict v_template
  from dashboard_private.notification_templates template_row
  where template_row.id = p_template_id
    and template_row.rule_id = p_rule_id;

  select pg_catalog.count(*) into v_mapped_count
  from dashboard_private.notification_settings_import_metadata metadata
  where metadata.source_table = 'public.makeup_notification_settings'
    and metadata.workflow_key = 'makeup_requests'
    and metadata.mapped_rule_ids @> pg_catalog.jsonb_build_array(p_rule_id);
  if v_mapped_count = 0 then
    raise exception 'notification_makeup_legacy_mapping_missing' using errcode = '55000';
  end if;

  update public.makeup_notification_settings legacy_setting
  set enabled = v_rule.enabled,
      title_template = v_template.title_template,
      body_template = v_template.body_template,
      updated_by = p_actor_id,
      updated_at = pg_catalog.clock_timestamp()
  from dashboard_private.notification_settings_import_metadata metadata
  where metadata.source_table = 'public.makeup_notification_settings'
    and metadata.workflow_key = 'makeup_requests'
    and metadata.mapped_rule_ids @> pg_catalog.jsonb_build_array(p_rule_id)
    and metadata.source_key = 'makeup_notification_settings:'
      || legacy_setting.trigger_kind || ':' || legacy_setting.channel
    and row(
      legacy_setting.enabled,
      legacy_setting.title_template,
      legacy_setting.body_template
    ) is distinct from row(
      v_rule.enabled,
      v_template.title_template,
      v_template.body_template
    );
  get diagnostics v_changed_count = row_count;

  update dashboard_private.notification_settings_import_metadata metadata
  set source_revision = pg_catalog.to_char(
        legacy_setting.updated_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      source_checksum = dashboard_private.notification_makeup_setting_checksum_v1(
        legacy_setting.trigger_kind,
        legacy_setting.channel,
        legacy_setting.enabled,
        legacy_setting.title_template,
        legacy_setting.body_template
      ),
      source_snapshot = pg_catalog.jsonb_build_object(
        'trigger_kind', legacy_setting.trigger_kind,
        'channel', legacy_setting.channel,
        'enabled', legacy_setting.enabled,
        'title_template', legacy_setting.title_template,
        'body_template', legacy_setting.body_template
      ),
      imported_at = pg_catalog.clock_timestamp()
  from public.makeup_notification_settings legacy_setting
  where metadata.source_table = 'public.makeup_notification_settings'
    and metadata.workflow_key = 'makeup_requests'
    and metadata.mapped_rule_ids @> pg_catalog.jsonb_build_array(p_rule_id)
    and metadata.source_key = 'makeup_notification_settings:'
      || legacy_setting.trigger_kind || ':' || legacy_setting.channel
    and row(
      metadata.source_revision,
      metadata.source_checksum,
      metadata.source_snapshot
    ) is distinct from row(
      pg_catalog.to_char(
        legacy_setting.updated_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      dashboard_private.notification_makeup_setting_checksum_v1(
        legacy_setting.trigger_kind,
        legacy_setting.channel,
        legacy_setting.enabled,
        legacy_setting.title_template,
        legacy_setting.body_template
      ),
      pg_catalog.jsonb_build_object(
        'trigger_kind', legacy_setting.trigger_kind,
        'channel', legacy_setting.channel,
        'enabled', legacy_setting.enabled,
        'title_template', legacy_setting.title_template,
        'body_template', legacy_setting.body_template
      )
    );
  get diagnostics v_metadata_count = row_count;

  return pg_catalog.jsonb_build_object(
    'mapped_legacy_count', v_mapped_count::text,
    'changed_legacy_count', v_changed_count::text,
    'updated_metadata_count', v_metadata_count::text
  );
exception
  when no_data_found then
    raise exception 'notification_makeup_mirror_target_missing' using errcode = 'P0002';
end;
$$;

create or replace function dashboard_private.notification_makeup_payload_v1(
  p_request_id uuid,
  p_source_event_id uuid,
  p_event_key text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'makeup_request_id', request.id,
    'process', case p_event_key
      when 'makeup.submitted' then '신청 제출'
      when 'makeup.refund_requested' then '환불 신청'
      when 'makeup.approved' then '결재 승인'
      when 'makeup.refund_completed' then '환불 완료'
      when 'makeup.approval_canceled' then '승인 취소'
      when 'makeup.revision_requested' then '보완 요청'
      when 'makeup.rejected' then '반려'
      when 'makeup.deleted' then '삭제'
      else p_event_key
    end,
    'status', case request.status
      when 'approval_pending' then '결재자 승인 대기'
      when 'revision_requested' then '보완 요청'
      when 'rejected' then '반려'
      when 'manager_pending' then '이전 관리팀 전달'
      when 'makeup_pending' then '보강대기'
      when 'refund_pending' then '환불대기'
      when 'completed' then '완료'
      when 'canceled' then '승인 취소'
      else request.status
    end,
    'workflow_status', request.status,
    'request_kind', request.request_kind,
    'class_name', request.class_name,
    'subject', request.subject,
    'approval_group', request.approval_group,
    'subject_team_key', request.approval_group,
    'teacher_name', teacher.name,
    'reason', request.reason,
    'memo', request.final_note,
    'event_note', source_event.note,
    'cancel_date', request.cancel_date,
    'makeup_schedule', coalesce(
      nullif(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
              'start_at', coalesce(slot.value ->> 'startAt', slot.value ->> 'start_at'),
              'end_at', coalesce(slot.value ->> 'endAt', slot.value ->> 'end_at'),
              'place', coalesce(
                nullif(pg_catalog.btrim(coalesce(
                  slot.value ->> 'classroom', slot.value ->> 'place', slot.value ->> 'room'
                )), ''),
                nullif(pg_catalog.btrim(request.makeup_classroom), '')
              )
            ))
            order by slot.ordinality
          )
          from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(request.makeup_slots) = 'array'
              then request.makeup_slots else '[]'::jsonb end
          ) with ordinality slot(value, ordinality)
        ),
        '[]'::jsonb
      ),
      case when request.makeup_start_at is not null
        then pg_catalog.jsonb_build_array(pg_catalog.jsonb_strip_nulls(
          pg_catalog.jsonb_build_object(
            'start_at', request.makeup_start_at,
            'end_at', request.makeup_end_at,
            'place', nullif(pg_catalog.btrim(request.makeup_classroom), '')
          )
        ))
        else '[]'::jsonb
      end
    ),
    'makeup_places', coalesce(
      (
        select pg_catalog.jsonb_agg(place_row.place order by place_row.place)
        from (
          select distinct coalesce(
            nullif(pg_catalog.btrim(coalesce(
              slot.value ->> 'classroom', slot.value ->> 'place', slot.value ->> 'room'
            )), ''),
            nullif(pg_catalog.btrim(request.makeup_classroom), '')
          ) as place
          from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(request.makeup_slots) = 'array'
              then request.makeup_slots else '[]'::jsonb end
          ) slot(value)
        ) place_row
        where place_row.place is not null
      ),
      case when nullif(pg_catalog.btrim(request.makeup_classroom), '') is null
        then '[]'::jsonb
        else pg_catalog.jsonb_build_array(pg_catalog.btrim(request.makeup_classroom))
      end
    ),
    'makeup_at', coalesce(
      (
        select pg_catalog.string_agg(
          coalesce(slot.value ->> 'startAt', slot.value ->> 'start_at', '')
            || case when coalesce(slot.value ->> 'endAt', slot.value ->> 'end_at', '') = ''
              then '' else ' - ' || coalesce(slot.value ->> 'endAt', slot.value ->> 'end_at') end,
          ', ' order by slot.ordinality
        )
        from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(request.makeup_slots) = 'array'
            then request.makeup_slots else '[]'::jsonb end
        ) with ordinality slot(value, ordinality)
      ),
      request.makeup_start_at::text
    ),
    'makeup_room_spaced', request.makeup_classroom,
    'makeup_room', request.makeup_classroom,
    'requester_name', requester.name,
    'approver_name', approver.name,
    'actor_name', actor.name,
    'requester_profile_id', case
      when dashboard_private.notification_profile_is_active_v1(request.requester_id)
        then request.requester_id
      else null
    end,
    'approver_profile_id', case
      when dashboard_private.notification_profile_is_active_v1(request.approver_profile_id)
        then request.approver_profile_id
      else null
    end,
    'management_profile_ids', (
      select coalesce(pg_catalog.jsonb_agg(profile.id order by profile.id), '[]'::jsonb)
      from public.profiles profile
      where profile.role in ('admin', 'staff')
        and dashboard_private.notification_profile_is_active_v1(profile.id)
    ),
    'submitted_at', coalesce(
      (
        select pg_catalog.max(history.created_at)
        from public.makeup_request_events history
        where history.request_id = request.id
          and history.event_type in ('submitted', 'resubmitted')
      ),
      request.created_at
    ),
    'revision_requested_at', (
      select pg_catalog.max(history.created_at)
      from public.makeup_request_events history
      where history.request_id = request.id
        and history.event_type = 'revision_requested'
    ),
    'revision_reason', (
      select history.note
      from public.makeup_request_events history
      where history.request_id = request.id
        and history.event_type = 'revision_requested'
      order by history.created_at desc, history.id desc
      limit 1
    ),
    'approved_at', request.approved_at,
    'approval_note', coalesce(
      (
        select history.note
        from public.makeup_request_events history
        where history.request_id = request.id
          and history.event_type = 'approved'
        order by history.created_at desc, history.id desc
        limit 1
      ),
      request.final_note
    ),
    'rejected_at', (
      select pg_catalog.max(history.created_at)
      from public.makeup_request_events history
      where history.request_id = request.id
        and history.event_type = 'rejected'
    ),
    'rejected_reason', coalesce(
      (
        select history.note
        from public.makeup_request_events history
        where history.request_id = request.id
          and history.event_type = 'rejected'
        order by history.created_at desc, history.id desc
        limit 1
      ),
      request.rejected_reason
    ),
    'canceled_at', request.canceled_at,
    'canceled_note', (
      select history.note
      from public.makeup_request_events history
      where history.request_id = request.id
        and history.event_type in ('approval_canceled', 'completed_canceled')
      order by history.created_at desc, history.id desc
      limit 1
    ),
    'status_changed_at', source_event.created_at,
    'attachment_count', 0,
    'attachment_types', '[]'::jsonb,
    'fallback_title', '휴보강 알림',
    'fallback_body', request.class_name || ' · ' || request.status,
    'occurred_at', source_event.created_at
  ))
  from public.makeup_requests request
  join public.makeup_request_events source_event
    on source_event.id = p_source_event_id
   and source_event.request_id = request.id
  left join public.profiles requester on requester.id = request.requester_id
  left join public.profiles actor on actor.id = source_event.actor_id
  left join public.teacher_catalogs teacher on teacher.id = request.teacher_catalog_id
  left join public.teacher_catalogs approver on approver.id = request.approver_teacher_catalog_id
  where request.id = p_request_id;
$$;

do $$
begin
  if pg_catalog.to_regprocedure(
    'dashboard_private.save_notification_control_plane_unmirrored_v2(text,jsonb,jsonb,jsonb,uuid)'
  ) is null then
    execute 'alter function public.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid) set schema dashboard_private';
    execute 'alter function dashboard_private.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid) rename to save_notification_control_plane_unmirrored_v2';
  end if;
end;
$$;

revoke all on function dashboard_private.save_notification_control_plane_unmirrored_v2(
  text, jsonb, jsonb, jsonb, uuid
) from public, anon, authenticated, service_role;

create or replace function public.save_notification_control_plane_v2(
  p_workflow_key text,
  p_expected_rule_revisions jsonb,
  p_expected_contract_versions jsonb,
  p_patch jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_response jsonb;
  v_rule_id_text text;
  v_rule_id uuid;
  v_template_id uuid;
begin
  v_response := dashboard_private.save_notification_control_plane_unmirrored_v2(
    p_workflow_key,
    p_expected_rule_revisions,
    p_expected_contract_versions,
    p_patch,
    p_request_id
  );

  if p_workflow_key = 'makeup_requests' then
    for v_rule_id_text in
      select patch_key.value
      from pg_catalog.jsonb_object_keys(p_patch -> 'rules') patch_key(value)
      order by patch_key.value
    loop
      v_rule_id := v_rule_id_text::uuid;
      select rule_row.active_template_id into strict v_template_id
      from dashboard_private.notification_rules rule_row
      where rule_row.id = v_rule_id
        and rule_row.workflow_key = 'makeup_requests';
      perform dashboard_private.mirror_makeup_notification_template_v1(
        v_rule_id,
        v_template_id,
        v_actor
      );
    end loop;
  end if;

  return v_response;
end;
$$;

revoke all on function dashboard_private.mirror_makeup_notification_template_v1(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.notification_makeup_payload_v1(
  uuid, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.save_notification_control_plane_v2(
  text, jsonb, jsonb, jsonb, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.save_notification_control_plane_v2(
  text, jsonb, jsonb, jsonb, uuid
) to authenticated;

alter function dashboard_private.mirror_makeup_notification_template_v1(
  uuid, uuid, uuid
) owner to postgres;
alter function dashboard_private.notification_makeup_payload_v1(
  uuid, uuid, text
) owner to postgres;
alter function dashboard_private.save_notification_control_plane_unmirrored_v2(
  text, jsonb, jsonb, jsonb, uuid
) owner to postgres;
alter function public.save_notification_control_plane_v2(
  text, jsonb, jsonb, jsonb, uuid
) owner to postgres;

notify pgrst, 'reload schema';

commit;
