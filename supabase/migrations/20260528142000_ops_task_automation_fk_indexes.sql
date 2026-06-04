create index if not exists ops_task_notification_channels_created_by_idx
  on public.ops_task_notification_channels(created_by)
  where created_by is not null;

create index if not exists ops_task_notification_channels_updated_by_idx
  on public.ops_task_notification_channels(updated_by)
  where updated_by is not null;

create index if not exists ops_task_automation_rules_notification_channel_id_idx
  on public.ops_task_automation_rules(notification_channel_id)
  where notification_channel_id is not null;

create index if not exists ops_task_automation_rules_created_by_idx
  on public.ops_task_automation_rules(created_by)
  where created_by is not null;

create index if not exists ops_task_automation_rules_updated_by_idx
  on public.ops_task_automation_rules(updated_by)
  where updated_by is not null;

create index if not exists ops_task_automation_runs_rule_id_idx
  on public.ops_task_automation_runs(rule_id)
  where rule_id is not null;

create index if not exists ops_task_automation_runs_task_id_idx
  on public.ops_task_automation_runs(task_id)
  where task_id is not null;

create index if not exists ops_task_notification_deliveries_rule_id_idx
  on public.ops_task_notification_deliveries(rule_id)
  where rule_id is not null;

create index if not exists ops_task_notification_deliveries_channel_id_idx
  on public.ops_task_notification_deliveries(channel_id)
  where channel_id is not null;
