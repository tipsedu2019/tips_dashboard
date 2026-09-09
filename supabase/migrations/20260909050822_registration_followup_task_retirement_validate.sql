begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
alter table public.ops_task_automation_rules
  validate constraint ops_task_automation_retired_followup_disabled;
commit;
