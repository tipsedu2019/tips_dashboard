begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Serialize against the former approval writers. Keep documents and immutable
-- notification evidence, but remove all application access and executable APIs.
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'notification-control-plane-workflow:approvals', 0));

update dashboard_private.notification_rules
set enabled = false, revision = revision + 1, updated_by = null,
    updated_actor_kind = 'system', updated_at = pg_catalog.now()
where workflow_key = 'approvals' and enabled;
alter table dashboard_private.notification_rules
  add constraint notification_rules_approvals_retired_check
  check (workflow_key <> 'approvals' or not enabled) not valid;

update dashboard_private.notification_runtime_flags
set enabled = false, revision = revision + 1, updated_by = null, updated_at = pg_catalog.now()
where flag_key = 'notification_control_plane_dispatch_approvals_enabled' and enabled;
alter table dashboard_private.notification_runtime_flags
  add constraint notification_flags_approvals_retired_check
  check (flag_key <> 'notification_control_plane_dispatch_approvals_enabled' or not enabled) not valid;

update dashboard_private.notification_deliveries delivery
set status = 'canceled', status_reason = 'cutover_rollback',
    claimed_by = null, claim_token = null, lease_expires_at = null, next_attempt_at = null,
    cancel_requested_at = coalesce(delivery.cancel_requested_at, pg_catalog.now()),
    cancel_reason = 'approvals_retired',
    resolved_at = coalesce(delivery.resolved_at, pg_catalog.now()), updated_at = pg_catalog.now()
from dashboard_private.notification_events event_row
where event_row.id = delivery.event_id and event_row.workflow_key = 'approvals'
  and delivery.status in ('pending', 'claimed', 'retry_wait');

-- Preserve the final ordered worker guards, ownership, source locks and ACLs.
-- An old worker must not start a provider attempt after retirement either.
do $retire_dispatch$
declare v_definition text; v_anchor text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::pg_catalog.regprocedure);
  v_anchor := $anchor$if v_claim.workflow_key in ('tasks','word_retests') then$anchor$;
  if length(v_definition) - length(replace(v_definition, v_anchor, '')) <> length(v_anchor)
    or strpos(v_definition, 'ops_subject_completion_source_stale') = 0 then
    raise exception 'approvals_retirement_external_guard_drift' using errcode = '55000';
  end if;
  execute replace(v_definition, v_anchor, $patch$if v_claim.workflow_key in ('tasks','word_retests','approvals') then$patch$);
end;
$retire_dispatch$;

-- Historical tables remain owner-only. Removing policies as well as grants
-- prevents accidental API exposure if a broad table grant is added later.
do $retire_tables$
declare v_table text; v_policy record;
begin
  foreach v_table in array array['approval_requests','approval_templates','approval_comments','approval_events'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', v_table);
    for v_policy in select polname from pg_catalog.pg_policy
      where polrelid = format('public.%I', v_table)::regclass loop
      execute format('drop policy %I on public.%I', v_policy.polname, v_table);
    end loop;
    execute format('comment on table public.%I is %L', v_table,
      'Retired 2026-09-22: standalone approvals. Historical records only; no application access.');
  end loop;
end;
$retire_tables$;

drop trigger if exists write_approval_status_event on public.approval_requests;
drop trigger if exists write_approval_notification_event_v2 on public.approval_requests;
drop trigger if exists write_approval_comment_notification_v2 on public.approval_comments;
drop trigger if exists set_approval_requests_updated_at on public.approval_requests;
drop trigger if exists set_approval_templates_updated_at on public.approval_templates;

drop function public.create_approval_request_v2(jsonb,text,uuid);
drop function public.update_approval_request_v2(uuid,jsonb,text,timestamptz,uuid);
drop function public.transition_approval_request_v2(uuid,text,timestamptz,uuid);
drop function public.delete_approval_request_v2(uuid,uuid);
drop function public.add_approval_comment_v2(uuid,text,uuid);
drop function public.list_approval_numbered_page_v1(text,integer,integer);
drop function public.get_approval_detail_v1(uuid);
drop function public.set_approval_requests_updated_at();
drop function public.write_approval_status_event();

drop function dashboard_private.create_approval_request_v2_impl(jsonb,text,uuid);
drop function dashboard_private.update_approval_request_v2_impl(uuid,jsonb,text,timestamptz,uuid);
drop function dashboard_private.transition_approval_request_v2_impl(uuid,text,timestamptz,uuid);
drop function dashboard_private.delete_approval_request_v2_impl(uuid,uuid);
drop function dashboard_private.add_approval_comment_v2_impl(uuid,text,uuid);
drop function dashboard_private.write_approval_notification_event_v2();
drop function dashboard_private.write_approval_comment_notification_v2();
drop function dashboard_private.approval_request_result_v2(public.approval_requests,text,uuid);
drop function dashboard_private.approval_management_profile_ids_v2();
drop function dashboard_private.approval_lock_replay_v2(uuid,text,text);
drop function dashboard_private.approval_store_replay_v2(uuid,text,text,jsonb);
drop function dashboard_private.approval_set_context_v2(uuid,text);
drop function dashboard_private.approval_clear_context_v2();
drop function dashboard_private.approval_validate_input_v2(jsonb);
drop function if exists dashboard_private.approval_attachment_snapshot_v1(text);
drop function if exists dashboard_private.approval_profile_display_name_v1(uuid);
drop function if exists dashboard_private.approval_target_period_v1(text);

commit;
