begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create index registration_customer_reminder_jobs_task_idx
  on dashboard_private.registration_customer_reminder_jobs(task_id);

create index registration_customer_reminder_jobs_message_idx
  on dashboard_private.registration_customer_reminder_jobs(message_id)
  where message_id is not null;

create index registration_customer_reminder_settings_updated_by_idx
  on dashboard_private.registration_customer_reminder_settings(updated_by)
  where updated_by is not null;

create index ops_registration_customer_messages_scheduled_job_idx
  on public.ops_registration_customer_messages(scheduled_job_id)
  where scheduled_job_id is not null;

commit;
