-- Candidate only. Apply AFTER personal-connection-lifecycle.sql in an isolated DB.
-- Generated policy follows feature-registry.json; legacy backfill is deliberately frozen.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table dashboard_private.agent_personal_dashboard_credentials
 add column feature_ids text[] not null default '{}',
 add column feature_revision integer not null default 0 check(feature_revision>=0),
 add constraint personal_feature_ids_shape check(coalesce(array_ndims(feature_ids),1)=1 and array_position(feature_ids,null) is null and cardinality(feature_ids)<=100);
-- Preserve ONLY the three permissions already supported before this proposal.
-- This is a one-time existing-row backfill, never a default or registry-derived grant.
update dashboard_private.agent_personal_dashboard_credentials set feature_ids=
 (case when 'class-details:read'=any(scopes) then array['class.schedule.read'] else '{}'::text[] end)||
 (case when 'calendar:read'=any(scopes) then array['calendar.schools.read','calendar.events.read'] else '{}'::text[] end), feature_revision=1;
alter table dashboard_private.agent_personal_connection_operations drop constraint agent_personal_connection_operations_kind_check;
alter table dashboard_private.agent_personal_connection_operations add constraint agent_personal_connection_operations_kind_check check(kind in('issue','revoke','permissions'));
alter table dashboard_private.agent_personal_connection_operations
 add column before_features text[], add column after_features text[], add column applied_revision integer;

-- PRIVATE immutable mapping. New entries do not mutate any credential grants.
create function dashboard_private.agent_personal_feature_policy_v1() returns jsonb
language sql immutable set search_path='' as $policy$ select '@POLICY@'::jsonb $policy$;
alter function dashboard_private.agent_personal_feature_policy_v1() owner to postgres;
revoke all on function dashboard_private.agent_personal_feature_policy_v1() from public,anon,authenticated,service_role;

-- Keep the existing credential row lock and all issuer/owner/resource checks.
do $gate$
declare body text; anchor text:=$old$ if not scope=any(cred.scopes) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;$old$;
begin
 body:=pg_get_functiondef('public.agent_personal_dashboard_read_v1(text,text,jsonb)'::regprocedure);
 if (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 then raise exception 'personal_feature_gate_source_drift';end if;
 execute replace(body,anchor,anchor||$new$
 if not coalesce((dashboard_private.agent_personal_feature_policy_v1()->p_action->>'id')=any(cred.feature_ids),false) then raise exception using errcode='42501',message='agent_scope_forbidden';end if;
$new$);
end $gate$;

@METADATA@
@LIFECYCLE@
commit;
