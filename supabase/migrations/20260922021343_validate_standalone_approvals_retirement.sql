begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
alter table dashboard_private.notification_rules
  validate constraint notification_rules_approvals_retired_check;
alter table dashboard_private.notification_runtime_flags
  validate constraint notification_flags_approvals_retired_check;
commit;
