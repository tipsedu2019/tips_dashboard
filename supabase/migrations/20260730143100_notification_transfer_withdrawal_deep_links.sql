begin;
set local lock_timeout = '5s';

create or replace function dashboard_private.notification_ops_task_deep_link_v1(
  p_task_type text,
  p_task_id uuid,
  p_status text
) returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_flow text;
begin
  if p_task_type is null or p_task_id is null then
    raise exception 'ops_task_notification_deep_link_invalid' using errcode = '22023';
  end if;
  if p_task_type = 'general' then
    return '/admin/tasks?taskId=' || p_task_id::text;
  elsif p_task_type = 'word_retest' then
    return '/admin/word-retests?taskId=' || p_task_id::text;
  elsif p_task_type not in ('transfer', 'withdrawal') then
    raise exception 'ops_task_notification_deep_link_invalid' using errcode = '22023';
  end if;
  v_flow := case p_status
    when 'requested' then 'applicant'
    when 'confirmed' then 'operations'
    when 'in_progress' then 'operations'
    when 'on_hold' then 'operations'
    when 'review_requested' then 'operations'
    when 'done' then 'closed'
    when 'canceled' then 'closed'
    else null
  end;
  if v_flow is null then
    raise exception 'ops_task_notification_deep_link_invalid' using errcode = '22023';
  end if;
  return '/admin/' || p_task_type || '?flow=' || v_flow || '&taskId=' || p_task_id::text;
end;
$$;

create or replace function public.get_ops_task_legacy_dispatch_plan_v1(
  p_source_event_id uuid,
  p_actor_profile_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_source public.ops_task_events%rowtype;
  v_task public.ops_tasks%rowtype;
  v_transfer public.ops_transfer_details%rowtype;
  v_withdrawal public.ops_withdrawal_details%rowtype;
  v_canonical dashboard_private.notification_events%rowtype;
  v_actor_role text;
  v_items jsonb;
  v_workflow_key text;
  v_deep_link text;
  v_canonical_source_type text;
  v_canonical_source_id uuid;
begin
  if p_source_event_id is null or p_actor_profile_id is null then
    raise exception 'ops_task_legacy_dispatch_invalid' using errcode = '22023';
  end if;
  select event_row.* into v_source
  from public.ops_task_events event_row
  where event_row.id = p_source_event_id
    and event_row.event_type in (
      'task.created', 'task.assignee_changed', 'task.due_changed',
      'task.status_changed', 'task.completed', 'task.canceled',
      'task.reopened', 'task.comment_added',
      'word_retest.created', 'word_retest.assigned',
      'word_retest.schedule_changed', 'word_retest.started',
      'word_retest.result_reported', 'word_retest.absent_reported',
      'word_retest.revision_requested', 'word_retest.retry_created',
      'word_retest.completed', 'word_retest.canceled',
      'transfer.submitted', 'transfer.processing_started',
      'transfer.details_changed', 'transfer.completed',
      'transfer.canceled', 'transfer.reopened',
      'withdrawal.submitted', 'withdrawal.processing_started',
      'withdrawal.details_changed', 'withdrawal.completed',
      'withdrawal.canceled', 'withdrawal.reopened'
    );
  if not found then
    raise exception 'ops_task_notification_source_not_found' using errcode = 'P0002';
  end if;
  select task.* into v_task
  from public.ops_tasks task
  where task.id = v_source.task_id
    and task.type in ('general', 'word_retest', 'transfer', 'withdrawal');
  if not found or pg_catalog.split_part(v_source.event_type, '.', 1) <>
    (case v_task.type when 'general' then 'task' else v_task.type end)
  then
    raise exception 'ops_task_notification_source_mismatch' using errcode = '22023';
  end if;
  if v_task.type = 'transfer' then
    select detail.* into v_transfer
    from public.ops_transfer_details detail
    where detail.task_id = v_task.id;
    if not found then raise exception 'ops_transfer_detail_required' using errcode = '23514'; end if;
  elsif v_task.type = 'withdrawal' then
    select detail.* into v_withdrawal
    from public.ops_withdrawal_details detail
    where detail.task_id = v_task.id;
    if not found then raise exception 'ops_withdrawal_detail_required' using errcode = '23514'; end if;
  end if;
  v_workflow_key := case v_task.type
    when 'general' then 'tasks'
    when 'word_retest' then 'word_retests'
    else v_task.type
  end;
  v_canonical_source_type := case
    when v_source.event_type = 'task.comment_added' then 'ops_task_comment'
    else 'ops_task_event'
  end;
  begin
    v_canonical_source_id := case
      when v_source.event_type = 'task.comment_added'
        then nullif(v_source.payload ->> 'comment_id', '')::uuid
      else p_source_event_id
    end;
  exception
    when invalid_text_representation then
      raise exception 'ops_task_notification_source_mismatch' using errcode = '22023';
  end;
  if v_canonical_source_id is null
    or (v_canonical_source_type = 'ops_task_comment' and not exists (
      select 1 from public.ops_task_comments comment_row
      where comment_row.id = v_canonical_source_id
        and comment_row.task_id = v_task.id
    ))
  then
    raise exception 'ops_task_notification_source_mismatch' using errcode = '22023';
  end if;
  select profile.role into v_actor_role
  from public.profiles profile
  where profile.id = p_actor_profile_id;
  if not (
    v_source.actor_id = p_actor_profile_id
    or v_task.requested_by = p_actor_profile_id
    or v_task.assignee_id = p_actor_profile_id
    or v_task.secondary_assignee_id = p_actor_profile_id
    or v_actor_role in ('admin', 'staff')
  ) then
    raise exception 'ops_task_legacy_dispatch_forbidden' using errcode = '42501';
  end if;
  select event_row.* into v_canonical
  from dashboard_private.notification_events event_row
  where event_row.workflow_key = v_workflow_key
    and event_row.event_key = v_source.event_type
    and event_row.source_type = v_canonical_source_type
    and event_row.source_id = v_canonical_source_id::text
    and event_row.occurrence_key = v_canonical_source_id::text;
  if not found then
    raise exception 'ops_task_notification_canonical_event_not_found' using errcode = 'P0002';
  end if;
  v_deep_link := dashboard_private.notification_ops_task_deep_link_v1(
    v_task.type,
    v_task.id,
    v_canonical.payload ->> 'status'
  );

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'eventId', v_canonical.id,
    'eventKey', v_canonical.event_key,
    'occurrenceKey', v_canonical.occurrence_key,
    'ruleId', (snapshot.item ->> 'rule_id')::uuid,
    'ruleRevision', snapshot.item ->> 'rule_revision',
    'templateId', template_row.id,
    'templateChecksum', template_row.checksum,
    'channelKey', snapshot.item ->> 'channel_key',
    'audienceKey', snapshot.item ->> 'audience_key',
    'targetGeneration', '0',
    'targetKind', 'connection',
    'targetKey', 'connection:google_chat.management',
    'targetProfileId', null,
    'connectionKey', 'google_chat.management',
    'targetSnapshot', pg_catalog.jsonb_build_object('connection_key', 'google_chat.management'),
    'renderedTitle', case when v_task.type in ('transfer', 'withdrawal')
      then dashboard_private.notification_ops_transition_render_template_v1(
        template_row.title_template, v_canonical.payload
      )
      else dashboard_private.notification_ops_task_render_template_v1(
        template_row.title_template,
        registry.workflow_label,
        registry.event_label,
        coalesce(v_canonical.payload ->> 'occurred_at', v_canonical.occurred_at::text),
        v_deep_link
      )
    end,
    'renderedBody', case when v_task.type in ('transfer', 'withdrawal')
      then dashboard_private.notification_ops_transition_render_template_v1(
        template_row.body_template, v_canonical.payload
      )
      else dashboard_private.notification_ops_task_render_template_v1(
        template_row.body_template,
        registry.workflow_label,
        registry.event_label,
        coalesce(v_canonical.payload ->> 'occurred_at', v_canonical.occurred_at::text),
        v_deep_link
      )
    end,
    'href', v_deep_link,
    'scheduledFor', v_canonical.occurred_at
  ) order by (snapshot.item ->> 'rule_id')::uuid), '[]'::jsonb)
  into v_items
  from pg_catalog.jsonb_array_elements(v_canonical.rule_snapshot) snapshot(item)
  join dashboard_private.notification_templates template_row
    on template_row.id = (snapshot.item ->> 'template_id')::uuid
   and template_row.rule_id = (snapshot.item ->> 'rule_id')::uuid
  join dashboard_private.notification_settings_ui_registry registry
    on registry.rule_id = (snapshot.item ->> 'rule_id')::uuid
  where snapshot.item ->> 'audience_key' = 'management_team'
    and snapshot.item ->> 'channel_key' = 'google_chat'
    and (snapshot.item ->> 'enabled')::boolean;

  return pg_catalog.jsonb_build_object(
    'sourceEventId', p_source_event_id,
    'taskId', v_task.id,
    'items', v_items
  );
end;
$$;

alter function dashboard_private.notification_ops_task_deep_link_v1(text, uuid, text)
  owner to postgres;
revoke all on function dashboard_private.notification_ops_task_deep_link_v1(text, uuid, text)
  from public, anon, authenticated, service_role;
alter function public.get_ops_task_legacy_dispatch_plan_v1(uuid, uuid)
  owner to postgres;
revoke all on function public.get_ops_task_legacy_dispatch_plan_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_ops_task_legacy_dispatch_plan_v1(uuid, uuid)
  to service_role;

commit;

