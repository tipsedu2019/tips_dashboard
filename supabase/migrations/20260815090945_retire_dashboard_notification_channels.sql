begin;

set local lock_timeout = '5s';

update dashboard_private.notification_settings_ui_registry registry
set activation_locked = false
where registry.channel_key = 'in_app'
  and registry.activation_locked;

update dashboard_private.notification_rules rule
set enabled = false,
    revision = rule.revision + 1,
    updated_by = null,
    updated_actor_kind = 'system',
    updated_at = pg_catalog.now()
where rule.channel_key = 'in_app'
  and rule.enabled;

update dashboard_private.notification_deliveries delivery
set status = 'canceled',
    status_reason = 'cutover_rollback',
    claimed_by = null,
    claim_token = null,
    lease_expires_at = null,
    next_attempt_at = null,
    cancel_requested_at = pg_catalog.coalesce(delivery.cancel_requested_at, pg_catalog.now()),
    cancel_reason = pg_catalog.coalesce(delivery.cancel_reason, 'dashboard_notification_channels_retired'),
    resolved_at = pg_catalog.coalesce(delivery.resolved_at, pg_catalog.now()),
    updated_at = pg_catalog.now()
where delivery.channel_key in ('in_app', 'web_push')
  and delivery.status in ('pending', 'claimed', 'retry_wait');

create or replace function dashboard_private.prevent_internal_notification_channel_enable_v1()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
begin
  if new.channel_key = 'in_app' and new.enabled then
    raise exception 'notification_internal_channel_disabled'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger prevent_internal_notification_channel_enable
before insert or update of enabled, channel_key
on dashboard_private.notification_rules
for each row execute function
  dashboard_private.prevent_internal_notification_channel_enable_v1();

create or replace function public.notification_internal_channels_disabled_runtime_version()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from dashboard_private.notification_rules rule
      where rule.channel_key = 'in_app'
        and rule.enabled
    ) then 0
    when exists (
      select 1
      from dashboard_private.notification_deliveries delivery
      where delivery.channel_key in ('in_app', 'web_push')
        and delivery.status in ('pending', 'claimed', 'sending', 'retry_wait')
    ) then 0
    else 1
  end;
$$;

revoke all on function public.notification_internal_channels_disabled_runtime_version()
from public, anon, authenticated;
grant execute on function public.notification_internal_channels_disabled_runtime_version()
to service_role;

commit;
