begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- The stored registration dispatch flag can be ON while the installed scope
-- owner is still legacy. Read the owner independently; absence is not approval
-- to send through either path. This migration changes no operational settings.
create function dashboard_private.registration_management_notification_owner_v1()
returns text language sql stable security definer set search_path='' as $$
 select owner_kind from dashboard_private.notification_cutover_owners
 where scope_key='registration' and workflow_key='registration'
  and dispatch_flag_key='notification_control_plane_dispatch_registration_enabled';
$$;
alter function dashboard_private.registration_management_notification_owner_v1() owner to postgres;
revoke all on function dashboard_private.registration_management_notification_owner_v1() from public,anon,authenticated,service_role;

-- Only these four explicitly confirmed management events follow this owner.
-- Appointment, observation and customer-message adapter switches keep their
-- existing semantics. Canonical workers cannot compete with a legacy owner.
alter function dashboard_private.notification_dispatch_enabled_v1(text,text)
 rename to notification_dispatch_before_registration_owner_v1;
create function dashboard_private.notification_dispatch_enabled_v1(p_workflow_key text,p_event_key text)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if p_workflow_key='registration' and p_event_key in (
  'registration.case_created','registration.consultation_completed',
  'registration.waiting_transitioned','registration.admission_started'
 ) then
  return coalesce(dashboard_private.registration_management_notification_owner_v1()='canonical'
   and dashboard_private.notification_dispatch_before_registration_owner_v1(p_workflow_key,p_event_key),false);
 end if;
 return dashboard_private.notification_dispatch_before_registration_owner_v1(p_workflow_key,p_event_key);
end;
$$;
alter function dashboard_private.notification_dispatch_enabled_v1(text,text) owner to postgres;
revoke all on function dashboard_private.notification_dispatch_enabled_v1(text,text),
 dashboard_private.notification_dispatch_before_registration_owner_v1(text,text) from public,anon,authenticated,service_role;

-- Patch the final recovery-aware renderer, preserving its content, permission,
-- source and connection checks. Ownership participates in the approved hash,
-- so a later owner change is rejected by the existing final provider gate.
do $registration_management_owner_preview$
declare v_definition text; v_anchor text;
begin
 v_definition:=pg_get_functiondef('dashboard_private.registration_management_notification_preview_content_v2(uuid,uuid,uuid)'::regprocedure);
 v_anchor:=$anchor$elsif dashboard_private.notification_dispatch_enabled_v1('registration',v_event) then$anchor$;
 if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor)
  or strpos(v_definition,'p_excluded_source_id')=0 then
  raise exception 'registration_management_owner_preview_anchor_invalid' using errcode='55000';
 end if;
 v_definition:=replace(v_definition,v_anchor,$patch$elsif dashboard_private.registration_management_notification_owner_v1() is distinct from 'legacy' then$patch$);
 v_anchor:=$anchor$  'status',v_status,'reason',v_reason,'canSend',v_status='ready');$anchor$;
 if length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) then
  raise exception 'registration_management_owner_preview_anchor_invalid' using errcode='55000';
 end if;
 execute replace(v_definition,v_anchor,$patch$  'dispatchOwner',dashboard_private.registration_management_notification_owner_v1(),
  'status',v_status,'reason',v_reason,'canSend',v_status='ready');$patch$);
end;
$registration_management_owner_preview$;

notify pgrst,'reload schema';
commit;
