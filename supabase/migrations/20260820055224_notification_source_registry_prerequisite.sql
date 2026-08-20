begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create schema if not exists dashboard_private;

-- The active immediate-delivery revalidator has depended on this registry
-- since the science notification migration. Install the read-only prerequisite
-- without enabling any notification cutover flag or provider.
create table if not exists dashboard_private.notification_source_type_registry (
  workflow_key text not null,
  source_type text not null,
  source_id_kind text not null,
  compatibility_route text,
  contract_version integer not null default 2,
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  primary key (workflow_key, source_type),
  constraint notification_source_type_registry_workflow_check
    check (workflow_key in (
      'tasks', 'word_retests', 'registration', 'transfer', 'withdrawal',
      'makeup_requests', 'approvals'
    )),
  constraint notification_source_type_registry_source_check
    check (source_type in (
      'ops_task_event', 'ops_task_comment', 'registration_appointment',
      'ops_registration_message', 'makeup_request_event',
      'approval_event', 'approval_comment'
    )),
  constraint notification_source_type_registry_id_kind_check
    check (source_id_kind in ('uuid', 'stable_text')),
  constraint notification_source_type_registry_route_check
    check (
      compatibility_route is null
      or compatibility_route in (
        '/api/notifications/legacy/ops-task',
        '/api/notifications/legacy/makeup'
      )
    ),
  constraint notification_source_type_registry_contract_check
    check (contract_version = 2)
);

insert into dashboard_private.notification_source_type_registry(
  workflow_key, source_type, source_id_kind, compatibility_route, contract_version
)
values
  ('tasks', 'ops_task_event', 'uuid', '/api/notifications/legacy/ops-task', 2),
  ('tasks', 'ops_task_comment', 'uuid', null, 2),
  ('word_retests', 'ops_task_event', 'uuid', '/api/notifications/legacy/ops-task', 2),
  ('word_retests', 'ops_task_comment', 'uuid', null, 2),
  ('registration', 'ops_task_event', 'uuid', '/api/notifications/legacy/ops-task', 2),
  ('registration', 'registration_appointment', 'uuid', null, 2),
  ('registration', 'ops_registration_message', 'uuid', null, 2),
  ('transfer', 'ops_task_event', 'uuid', '/api/notifications/legacy/ops-task', 2),
  ('withdrawal', 'ops_task_event', 'uuid', '/api/notifications/legacy/ops-task', 2),
  ('makeup_requests', 'makeup_request_event', 'uuid', '/api/notifications/legacy/makeup', 2),
  ('approvals', 'approval_event', 'uuid', null, 2),
  ('approvals', 'approval_comment', 'uuid', null, 2)
on conflict (workflow_key, source_type) do update
set
  source_id_kind = excluded.source_id_kind,
  compatibility_route = excluded.compatibility_route,
  contract_version = excluded.contract_version;

alter table dashboard_private.notification_source_type_registry
  owner to postgres;
alter table dashboard_private.notification_source_type_registry
  enable row level security;
revoke all on table dashboard_private.notification_source_type_registry
  from public, anon, authenticated, service_role;
grant select on table dashboard_private.notification_source_type_registry
  to service_role;

commit;
