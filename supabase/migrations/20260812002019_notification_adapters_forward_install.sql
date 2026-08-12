begin;

do $$
begin
  if pg_catalog.to_regclass('dashboard_private.notification_cutover_owners') is not null
    or pg_catalog.to_regprocedure(
      'dashboard_private.notification_dispatch_scope_for_event_v1(text,text)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'public.notification_workflow_adapters_runtime_version()'
    ) is not null
    or pg_catalog.to_regclass('dashboard_private.notification_worker_heartbeats') is null
    or pg_catalog.to_regprocedure(
      'public.registration_appointment_reminders_runtime_version()'
    ) is null
    or (
      select pg_catalog.count(*)
      from dashboard_private.notification_runtime_flags flag_row
      where flag_row.flag_key in (
        'notification_control_plane_dispatch_tasks_enabled',
        'notification_control_plane_dispatch_word_retests_enabled',
        'notification_control_plane_dispatch_registration_enabled',
        'notification_control_plane_registration_phone_adapter_enabled',
        'notification_control_plane_registration_visit_adapter_enabled',
        'notification_control_plane_registration_solapi_adapter_enabled',
        'notification_control_plane_dispatch_transfer_enabled',
        'notification_control_plane_dispatch_withdrawal_enabled',
        'notification_control_plane_dispatch_makeup_requests_enabled',
        'notification_control_plane_dispatch_approvals_enabled'
      )
    ) <> 10
    or exists (
      select 1
      from dashboard_private.notification_runtime_flags flag_row
      where flag_row.flag_key in (
        'notification_control_plane_dispatch_tasks_enabled',
        'notification_control_plane_dispatch_word_retests_enabled',
        'notification_control_plane_dispatch_registration_enabled',
        'notification_control_plane_registration_phone_adapter_enabled',
        'notification_control_plane_registration_visit_adapter_enabled',
        'notification_control_plane_registration_solapi_adapter_enabled',
        'notification_control_plane_dispatch_transfer_enabled',
        'notification_control_plane_dispatch_withdrawal_enabled',
        'notification_control_plane_dispatch_makeup_requests_enabled',
        'notification_control_plane_dispatch_approvals_enabled'
      )
        and flag_row.enabled
    )
  then
    raise exception 'notification_adapters_forward_install_preflight_failed'
      using errcode = '55000';
  end if;
end;
$$;

create table dashboard_private.notification_cutover_owners (
  scope_key text primary key,
  workflow_key text not null,
  dispatch_flag_key text not null unique
    references dashboard_private.notification_runtime_flags(flag_key),
  owner_kind text not null,
  constraint notification_cutover_owners_scope_key_check check (
    scope_key in (
      'tasks',
      'word_retests',
      'approvals',
      'transfer',
      'withdrawal',
      'makeup_requests',
      'registration',
      'registration_phone',
      'registration_visit',
      'registration_solapi'
    )
  ),
  constraint notification_cutover_owners_owner_kind_check check (
    owner_kind in ('legacy', 'canonical')
  ),
  constraint notification_cutover_owners_identity_check check (
    (scope_key = 'tasks'
      and workflow_key = 'tasks'
      and dispatch_flag_key = 'notification_control_plane_dispatch_tasks_enabled')
    or (scope_key = 'word_retests'
      and workflow_key = 'word_retests'
      and dispatch_flag_key = 'notification_control_plane_dispatch_word_retests_enabled')
    or (scope_key = 'approvals'
      and workflow_key = 'approvals'
      and dispatch_flag_key = 'notification_control_plane_dispatch_approvals_enabled')
    or (scope_key = 'transfer'
      and workflow_key = 'transfer'
      and dispatch_flag_key = 'notification_control_plane_dispatch_transfer_enabled')
    or (scope_key = 'withdrawal'
      and workflow_key = 'withdrawal'
      and dispatch_flag_key = 'notification_control_plane_dispatch_withdrawal_enabled')
    or (scope_key = 'makeup_requests'
      and workflow_key = 'makeup_requests'
      and dispatch_flag_key = 'notification_control_plane_dispatch_makeup_requests_enabled')
    or (scope_key = 'registration'
      and workflow_key = 'registration'
      and dispatch_flag_key = 'notification_control_plane_dispatch_registration_enabled')
    or (scope_key = 'registration_phone'
      and workflow_key = 'registration'
      and dispatch_flag_key = 'notification_control_plane_registration_phone_adapter_enabled')
    or (scope_key = 'registration_visit'
      and workflow_key = 'registration'
      and dispatch_flag_key = 'notification_control_plane_registration_visit_adapter_enabled')
    or (scope_key = 'registration_solapi'
      and workflow_key = 'registration'
      and dispatch_flag_key = 'notification_control_plane_registration_solapi_adapter_enabled')
  )
);

alter table dashboard_private.notification_cutover_owners owner to postgres;
alter table dashboard_private.notification_cutover_owners enable row level security;
revoke all on table dashboard_private.notification_cutover_owners
  from public, anon, authenticated, service_role;

insert into dashboard_private.notification_cutover_owners(
  scope_key,
  workflow_key,
  dispatch_flag_key,
  owner_kind
)
values
  ('tasks', 'tasks', 'notification_control_plane_dispatch_tasks_enabled', 'legacy'),
  ('word_retests', 'word_retests', 'notification_control_plane_dispatch_word_retests_enabled', 'legacy'),
  ('approvals', 'approvals', 'notification_control_plane_dispatch_approvals_enabled', 'legacy'),
  ('transfer', 'transfer', 'notification_control_plane_dispatch_transfer_enabled', 'legacy'),
  ('withdrawal', 'withdrawal', 'notification_control_plane_dispatch_withdrawal_enabled', 'legacy'),
  ('makeup_requests', 'makeup_requests', 'notification_control_plane_dispatch_makeup_requests_enabled', 'legacy'),
  ('registration', 'registration', 'notification_control_plane_dispatch_registration_enabled', 'legacy'),
  ('registration_phone', 'registration', 'notification_control_plane_registration_phone_adapter_enabled', 'legacy'),
  ('registration_visit', 'registration', 'notification_control_plane_registration_visit_adapter_enabled', 'legacy'),
  ('registration_solapi', 'registration', 'notification_control_plane_registration_solapi_adapter_enabled', 'legacy');

create or replace function dashboard_private.notification_dispatch_scope_for_event_v1(
  p_workflow_key text,
  p_event_key text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_workflow_key is null or p_event_key is null then null
    when p_workflow_key = 'registration'
      and p_event_key = 'registration.phone_consultation_ready'
      then 'registration_phone'
    when p_workflow_key = 'registration'
      and p_event_key like 'registration.visit\_%' escape '\'
      and p_event_key <> 'registration.visit_'
      then 'registration_visit'
    when p_workflow_key = 'registration'
      and p_event_key like 'registration.admission_message\_%' escape '\'
      and p_event_key <> 'registration.admission_message_'
      then 'registration_solapi'
    when p_workflow_key = 'registration'
      and p_event_key in (
        'registration.admission_advanced',
        'registration.admission_canceled',
        'registration.admission_started',
        'registration.appointment_reminder_due',
        'registration.case_closed',
        'registration.case_created',
        'registration.consultation_completed',
        'registration.director_assigned',
        'registration.enrollment_decided',
        'registration.inquiry_routed',
        'registration.level_test_absent',
        'registration.level_test_canceled',
        'registration.level_test_completed',
        'registration.level_test_rescheduled',
        'registration.level_test_scheduled',
        'registration.level_test_started',
        'registration.observation_canceled',
        'registration.observation_director_reassigned',
        'registration.observation_feedback_due',
        'registration.observation_feedback_submitted',
        'registration.observation_reminder_due',
        'registration.observation_rescheduled',
        'registration.observation_scheduled',
        'registration.registration_completed',
        'registration.track_reopened',
        'registration.waiting_transitioned'
      ) then 'registration'
    when p_workflow_key in (
      'tasks',
      'word_retests',
      'approvals',
      'transfer',
      'withdrawal',
      'makeup_requests'
    ) then p_workflow_key
    else null
  end;
$$;

alter function dashboard_private.notification_dispatch_scope_for_event_v1(text, text)
  owner to postgres;
revoke all on function dashboard_private.notification_dispatch_scope_for_event_v1(text, text)
  from public, anon, authenticated, service_role;

do $$
begin
  if (
    select pg_catalog.count(*)
    from dashboard_private.notification_cutover_owners owner_row
  ) <> 10
    or exists (
      select 1
      from dashboard_private.notification_cutover_owners owner_row
      where owner_row.owner_kind <> 'legacy'
    )
    or dashboard_private.notification_dispatch_scope_for_event_v1(
      'registration', 'registration.phone_consultation_ready'
    ) is distinct from 'registration_phone'
    or dashboard_private.notification_dispatch_scope_for_event_v1(
      'registration', 'registration.visit_scheduled'
    ) is distinct from 'registration_visit'
    or dashboard_private.notification_dispatch_scope_for_event_v1(
      'registration', 'registration.admission_message_requested'
    ) is distinct from 'registration_solapi'
    or dashboard_private.notification_dispatch_scope_for_event_v1(
      'registration', 'registration.observation_scheduled'
    ) is distinct from 'registration'
    or dashboard_private.notification_dispatch_scope_for_event_v1(
      'tasks', 'task.created'
    ) is distinct from 'tasks'
    or dashboard_private.notification_dispatch_scope_for_event_v1(
      'unknown', 'unknown.event'
    ) is not null
  then
    raise exception 'notification_adapters_forward_install_contract_invalid'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function public.notification_workflow_adapters_runtime_version()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select 1;
$$;

alter function public.notification_workflow_adapters_runtime_version() owner to postgres;
revoke all on function public.notification_workflow_adapters_runtime_version()
  from public, anon, authenticated, service_role;
grant execute on function public.notification_workflow_adapters_runtime_version()
  to authenticated, service_role;

do $$
begin
  if public.notification_workflow_adapters_runtime_version() <> 1
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure_row
      where procedure_row.oid = 'dashboard_private.notification_dispatch_scope_for_event_v1(text,text)'::regprocedure
        and procedure_row.prosecdef
        and pg_catalog.pg_get_userbyid(procedure_row.proowner) = 'postgres'
        and procedure_row.proconfig && array['search_path=', 'search_path=""']::text[]
    )
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure_row
      where procedure_row.oid = 'public.notification_workflow_adapters_runtime_version()'::regprocedure
        and procedure_row.prosecdef is false
        and pg_catalog.pg_get_userbyid(procedure_row.proowner) = 'postgres'
        and procedure_row.proconfig && array['search_path=', 'search_path=""']::text[]
    )
    or has_table_privilege('anon', 'dashboard_private.notification_cutover_owners', 'select')
    or has_table_privilege('authenticated', 'dashboard_private.notification_cutover_owners', 'select')
    or has_table_privilege('service_role', 'dashboard_private.notification_cutover_owners', 'select')
    or has_function_privilege(
      'anon',
      'dashboard_private.notification_dispatch_scope_for_event_v1(text,text)',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'dashboard_private.notification_dispatch_scope_for_event_v1(text,text)',
      'execute'
    )
    or has_function_privilege(
      'service_role',
      'dashboard_private.notification_dispatch_scope_for_event_v1(text,text)',
      'execute'
    )
    or not has_function_privilege(
      'authenticated',
      'public.notification_workflow_adapters_runtime_version()',
      'execute'
    )
    or not has_function_privilege(
      'service_role',
      'public.notification_workflow_adapters_runtime_version()',
      'execute'
    )
    or has_function_privilege(
      'anon',
      'public.notification_workflow_adapters_runtime_version()',
      'execute'
    )
  then
    raise exception 'notification_adapters_forward_install_acl_invalid'
      using errcode = '55000';
  end if;
end;
$$;

commit;
