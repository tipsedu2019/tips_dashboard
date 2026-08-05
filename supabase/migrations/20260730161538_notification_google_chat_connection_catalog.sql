begin;
set local lock_timeout = '5s';

create or replace function dashboard_private.notification_control_plane_snapshot_v1(
  p_workflow_key text,
  p_editable boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'scope_key', 'global',
    'workflow_key', p_workflow_key,
    'rules', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', rule_row.id,
            'workflow_key', rule_row.workflow_key,
            'event_key', rule_row.event_key,
            'event_label', registry_row.event_label,
            'group_label', registry_row.group_label,
            'trigger_description', registry_row.trigger_description,
            'sort_order', registry_row.event_sort * 100 + registry_row.cell_sort,
            'audience_key', rule_row.audience_key,
            'audience_label', registry_row.audience_label,
            'channel_key', rule_row.channel_key,
            'channel_label', registry_row.channel_label,
            'connection_key', case
              when rule_row.channel_key <> 'google_chat' then null
              when rule_row.audience_key = 'management_team'
                then 'google_chat.management'
              when rule_row.audience_key = 'executive_team'
                then 'google_chat.executive'
              else null
            end,
            'rule_variant_key', rule_row.rule_variant_key,
            'delivery_mode', rule_row.delivery_mode,
            'schedule_key', rule_row.schedule_key,
            'schedule_config', rule_row.schedule_config,
            'enabled', rule_row.enabled,
            'active_template_id', rule_row.active_template_id,
            'revision', rule_row.revision::text,
            'updated_at', rule_row.updated_at,
            'template', pg_catalog.jsonb_build_object(
              'id', template_row.id,
              'rule_id', template_row.rule_id,
              'version', template_row.version::text,
              'title_template', template_row.title_template,
              'body_template', template_row.body_template,
              'allowed_variables', template_row.allowed_variables,
              'payload_schema_version', template_row.payload_schema_version,
              'checksum', template_row.checksum
            )
          )
          order by
            registry_row.event_sort,
            registry_row.cell_sort,
            rule_row.id
        )
        from dashboard_private.notification_settings_ui_registry registry_row
        join dashboard_private.notification_rules rule_row
          on rule_row.id = registry_row.rule_id
         and rule_row.scope_key = 'global'
         and rule_row.workflow_key = registry_row.workflow_key
         and rule_row.event_key = registry_row.event_key
         and rule_row.audience_key = registry_row.audience_key
         and rule_row.channel_key = registry_row.channel_key
         and rule_row.rule_variant_key = registry_row.rule_variant_key
        join dashboard_private.notification_templates template_row
          on template_row.rule_id = rule_row.id
         and template_row.id = rule_row.active_template_id
        where registry_row.workflow_key = p_workflow_key
      ),
      '[]'::jsonb
    ),
    'connections', (
      with connection_catalog(sort_order, channel, connection_key) as (
        values
          (1, 'admin'::text, 'google_chat.management'::text),
          (2, 'executive'::text, 'google_chat.executive'::text),
          (3, 'english'::text, 'google_chat.english'::text),
          (4, 'math'::text, 'google_chat.math'::text),
          (5, 'science'::text, 'google_chat.science'::text)
      )
      select pg_catalog.jsonb_agg(
        case
          when connection_row.channel is not null then
            dashboard_private.notification_connection_safe_json_v1(
              connection_row,
              p_editable
            )
          else pg_catalog.jsonb_build_object(
            'connection_key', catalog_row.connection_key,
            'connection_state', 'disconnected',
            'revision', '0',
            'configured', false,
            'webhook_url_mask', null,
            'last_verified_at', null,
            'last_error_code', null,
            'editable', coalesce(p_editable, false)
          )
        end
        order by catalog_row.sort_order
      )
      from connection_catalog catalog_row
      left join public.google_chat_webhook_settings connection_row
        on connection_row.channel = catalog_row.channel
    ),
    'delivery_summary', (
      select pg_catalog.jsonb_build_object(
        'pending_count', pg_catalog.count(*) filter (
          where delivery_row.status in ('pending', 'claimed', 'sending', 'retry_wait')
        ),
        'sent_count', pg_catalog.count(*) filter (
          where delivery_row.status = 'sent'
        ),
        'failed_count', pg_catalog.count(*) filter (
          where delivery_row.status = 'failed'
        ),
        'unknown_count', pg_catalog.count(*) filter (
          where delivery_row.status = 'delivery_unknown'
        ),
        'latest_delivery_at', pg_catalog.max(delivery_row.updated_at)
      )
      from dashboard_private.notification_deliveries delivery_row
      join dashboard_private.notification_events event_row
        on event_row.id = delivery_row.event_id
      where event_row.scope_key = 'global'
        and event_row.workflow_key = p_workflow_key
    ),
    'loaded_at', pg_catalog.statement_timestamp()
  );
$$;

alter function dashboard_private.notification_control_plane_snapshot_v1(text, boolean)
  owner to postgres;
revoke all on function dashboard_private.notification_control_plane_snapshot_v1(text, boolean)
  from public, anon, authenticated, service_role;

commit;
