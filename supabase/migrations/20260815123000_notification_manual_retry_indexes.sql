begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index notification_manual_retry_requests_event_idx
  on dashboard_private.notification_manual_retry_requests(event_id, created_at desc);

create index notification_manual_retry_requests_actor_idx
  on dashboard_private.notification_manual_retry_requests(actor_profile_id, created_at desc);

commit;
