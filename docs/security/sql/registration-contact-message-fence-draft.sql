-- REVIEW CANDIDATE ONLY. Not a migration; never executed in this task.
-- Base: f2d308a0e2999a80f37f77f53341286561b92d51 (main 6a + reviewed privacy + PR96).
-- Install AFTER audit/link and registration_case_contact_snapshot_v1 / assert_registration_contact_open_v1.
-- DB/pgTAP/concurrency verification is BLOCKED by automatic approval review.
-- Lock order: registration parent -> ordered current tracks -> detail -> preview/message/job.
-- Existing public function OIDs/owners/ACLs are retained by CREATE OR REPLACE.
-- Private legacy capabilities are owner-only. New RPC ACLs require separate installation approval.
-- No historical contact purge, provider call, credentials, activation or enrollment mutation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
do $owner_preflight$
begin
  if current_user <> 'postgres' then
    raise exception 'contact_fence_owner_review_required' using errcode='55000';
  end if;
end $owner_preflight$;

alter table public.ops_registration_customer_message_previews
  add column contact_generation bigint check (contact_generation > 0);
alter table public.ops_registration_customer_messages
  add column contact_generation bigint check (contact_generation > 0),
  add column contact_request_digest jsonb check (contact_request_digest is null or (
    jsonb_typeof(contact_request_digest) = 'object'
    and contact_request_digest - array['version','digest']::text[] = '{}'::jsonb
    and contact_request_digest ?& array['version','digest']::text[]
    and contact_request_digest->'version' = '1'::jsonb
    and jsonb_typeof(contact_request_digest->'digest') = 'string'
    and contact_request_digest->>'digest' ~ '^[a-f0-9]{64}$'));
alter table dashboard_private.registration_customer_reminder_jobs
  add column contact_generation bigint check (contact_generation > 0);
alter table dashboard_private.registration_customer_message_bundles
  add column contact_generation bigint check (contact_generation > 0);
-- NULL means a legacy preparation has no verified generation. Never backfill it
-- to the current generation or turn a historical key into permission to send.

create function dashboard_private.retire_registration_contact_dispatch_v1(p_task_id uuid,p_generation bigint)
returns void language plpgsql volatile security definer set search_path='' as $$
declare snapshot jsonb; retired_at timestamptz := clock_timestamp();
begin
  -- Called by lifecycle after parent/current-tracks/detail locks and after its
  -- closed generation is written. This does not acquire job-first locks.
  snapshot := dashboard_private.registration_case_contact_snapshot_v1(p_task_id,false);
  if snapshot->>'phase' is distinct from 'closed' or snapshot->>'generation' is distinct from p_generation::text then
    raise exception 'registration_contact_closure_scope_invalid' using errcode='23514';
  end if;
  -- expires_at is constrained to created_at+15m: consume, do not alter expiry.
  update public.ops_registration_customer_message_previews p
    set consumed_at=greatest(retired_at,p.created_at)
    where p.task_id=p_task_id and p.consumed_at is null;
  -- Single-message status has no canceled value. Keep its factual pending
  -- result, retire its claim and bind its permanent no-send to generation.
  update public.ops_registration_customer_messages m
    set claim_active=false,claim_token=null,claim_owner_id=null,claim_expires_at=null,
      claim_release_reason='contact_closed',error_code='contact_closed'
    where m.task_id=p_task_id and m.status='pending' and m.provider_attempt_count=0
      and m.provider_attempt_started_at is null;
  update dashboard_private.registration_customer_reminder_jobs j
    set status='canceled',available_at=null,claim_token=null,claim_expires_at=null,last_error_code='contact_closed'
    where j.task_id=p_task_id and j.status in ('pending','claimed') and not exists(
      select 1 from public.ops_registration_customer_messages m where m.id=j.message_id
        and (m.provider_attempt_count>0 or m.provider_attempt_started_at is not null or m.status in ('accepted','unknown')));
  update dashboard_private.registration_customer_message_bundles b
    set status='canceled',claim_token=null,claim_expires_at=null,last_error_code='contact_closed'
    where b.task_id=p_task_id and b.status in ('pending','claimed') and not exists(
      select 1 from public.ops_registration_customer_messages m where m.id=b.message_id
        and (m.provider_attempt_count>0 or m.provider_attempt_started_at is not null or m.status in ('accepted','unknown')));
  -- Already-started/accepted/unknown records are untouched and remain available
  -- for result-only reconciliation. No provider request or body is issued.
end $$;
revoke all on function dashboard_private.retire_registration_contact_dispatch_v1(uuid,bigint) from public,anon,authenticated,service_role;

create function dashboard_private.registration_contact_message_fence_v1(p_kind text,p_source uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_task_id uuid; snapshot jsonb; canonical_kind text; source_open boolean := false;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
  if p_kind in ('level_test_booking_bundle','level_test_reminder_bundle',
    'visit_consultation_booking_bundle','visit_consultation_reminder_bundle',
    'observation_booking_bundle','observation_reminder_bundle') then
    v_task_id := p_source;
    canonical_kind := case when p_kind like 'level_test_%' then 'level_test'
      when p_kind like 'visit_consultation_%' then 'visit_consultation' else 'observation_class' end;
    -- The bundle collector still validates each constituent fact. This metadata
    -- gate does not establish runtime activation or a complete bundle dispatcher.
    source_open := exists(select 1 from public.ops_registration_subject_tracks t
      where t.task_id=v_task_id and t.archived_at is null
        and (canonical_kind='observation_class' and t.workflow_status='observation_requested'
          or canonical_kind='level_test' and t.workflow_status not in ('registered','not_registered','inquiry_only')));
  else
    v_task_id := dashboard_private.registration_customer_message_source_task_v1(p_kind,p_source);
    if p_kind in ('level_test_booking','appointment_reminder','visit_consultation_booking') then
      select a.kind, a.status='scheduled' and exists(
        select 1 from public.ops_registration_level_tests l
        join public.ops_registration_subject_tracks t on t.id=l.track_id
        where l.appointment_id=a.id and t.task_id=a.task_id and t.archived_at is null
          and t.workflow_status not in ('registered','not_registered','inquiry_only') and l.status in ('scheduled','in_progress'))
      into canonical_kind,source_open from public.ops_registration_appointments a where a.id=p_source and a.task_id=v_task_id;
    elsif p_kind in ('observation_booking','observation_reminder') then
      canonical_kind := 'observation_class';
      select o.status='scheduled' and a.status='scheduled' and a.kind='observation_class'
        and t.archived_at is null and t.workflow_status='observation_requested'
      into source_open from public.ops_registration_observations o
      join public.ops_registration_appointments a on a.id=o.appointment_id and a.task_id=o.task_id
      join public.ops_registration_subject_tracks t on t.id=o.track_id and t.task_id=o.task_id
      where o.id=p_source and o.task_id=v_task_id;
    end if;
  end if;
  snapshot := dashboard_private.registration_case_contact_snapshot_v1(v_task_id,false);
  return jsonb_build_object('version',1,'taskId',v_task_id,'sourceId',p_source,'messageKind',p_kind,
    'contactPhase',snapshot->>'phase','contactGeneration',snapshot->>'generation',
    'allPhasesClosed',(snapshot->>'allPhasesClosed')::boolean,'sourcePhaseOpen',coalesce(source_open,false),
    'canonicalAppointmentKind',canonical_kind);
end $$;
revoke all on function dashboard_private.registration_contact_message_fence_v1(text,uuid) from public,anon,authenticated,service_role;

create function dashboard_private.assert_registration_contact_message_source_v1(p_kind text,p_source uuid,p_generation text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare fence jsonb; task_id uuid; generation text;
begin
  fence := dashboard_private.registration_contact_message_fence_v1(p_kind,p_source);
  task_id := (fence->>'taskId')::uuid;
  generation := coalesce(p_generation,fence->>'contactGeneration');
  perform dashboard_private.assert_registration_contact_open_v1(task_id,generation);
  fence := dashboard_private.registration_contact_message_fence_v1(p_kind,p_source);
  if fence->>'contactGeneration' is distinct from generation
    or coalesce((fence->>'sourcePhaseOpen')::boolean,false) is not true
    or not (p_kind in ('level_test_booking','level_test_booking_bundle','level_test_reminder_bundle')
      and fence->>'canonicalAppointmentKind'='level_test'
      or p_kind='appointment_reminder' and fence->>'canonicalAppointmentKind'='level_test'
      or p_kind in ('observation_booking','observation_reminder','observation_booking_bundle','observation_reminder_bundle')
        and fence->>'canonicalAppointmentKind'='observation_class') then
    -- admission_application remains a reviewed candidate, never an HTTP approval.
    raise exception 'registration_contact_use_not_allowed' using errcode='23514';
  end if;
  return fence;
end $$;
revoke all on function dashboard_private.assert_registration_contact_message_source_v1(text,uuid,text) from public,anon,authenticated,service_role;

create function public.read_registration_contact_message_fence_v1(p_actor_profile_id uuid,p_message_kind text,p_source_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare fence jsonb;
begin
  fence := dashboard_private.registration_contact_message_fence_v1(p_message_kind,p_source_id);
  perform dashboard_private.registration_customer_message_assert_actor_v1(p_actor_profile_id,(fence->>'taskId')::uuid,'send');
  return fence;
end $$;
revoke all on function public.read_registration_contact_message_fence_v1(uuid,text,uuid) from public,anon,authenticated,service_role;
-- Installation ACL: same service_role-only capability as existing source RPC;
-- withheld here because the task does not authorize granting new capabilities.

create function dashboard_private.assert_registration_contact_message_contract_v1(p_contract jsonb)
returns void language plpgsql immutable security definer set search_path='' as $$
declare generation text; checksum_key text;
begin
  if jsonb_typeof(p_contract) is distinct from 'object' or p_contract-array[
    'version','contactGeneration','recipientLast4','requestDigest','sourceFingerprint','recipientHash','templateKey',
    'templateRevision','templateChecksum','renderedVariablesChecksum','renderedBodyChecksum','renderedButtonsChecksum']::text[] <> '{}'::jsonb
    or not p_contract ?& array['version','contactGeneration','recipientLast4','requestDigest','sourceFingerprint','recipientHash','templateKey',
    'templateRevision','templateChecksum','renderedVariablesChecksum','renderedBodyChecksum','renderedButtonsChecksum']::text[]
    or p_contract->'version' is distinct from '1'::jsonb
    or jsonb_typeof(p_contract->'contactGeneration') is distinct from 'string'
    or p_contract->>'contactGeneration' !~ '^[1-9][0-9]{0,18}$'
    or jsonb_typeof(p_contract->'requestDigest') is distinct from 'object'
    or p_contract->'requestDigest'-array['version','digest']::text[] <> '{}'::jsonb
    or not (p_contract->'requestDigest') ?& array['version','digest']::text[]
    or p_contract->'requestDigest'->'version' is distinct from '1'::jsonb
    or jsonb_typeof(p_contract->'requestDigest'->'digest') is distinct from 'string'
    or p_contract->'requestDigest'->>'digest' !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_contract->'recipientLast4') is distinct from 'string'
    or p_contract->>'recipientLast4' !~ '^[0-9]{4}$' then
    raise exception 'registration_customer_message_contract_invalid' using errcode='22023';
  end if;
  generation := p_contract->>'contactGeneration';
  if generation::numeric>9223372036854775807 then raise exception 'registration_customer_message_contract_invalid' using errcode='22023'; end if;
  foreach checksum_key in array array['sourceFingerprint','recipientHash','templateChecksum',
    'renderedVariablesChecksum','renderedBodyChecksum','renderedButtonsChecksum'] loop
    if jsonb_typeof(p_contract->checksum_key) is distinct from 'string'
      or p_contract->>checksum_key !~ '^[a-f0-9]{64}$' then
      raise exception 'registration_customer_message_contract_invalid' using errcode='22023';
    end if;
  end loop;
  if p_contract->>'templateKey' not in ('level_test_booking','visit_consultation_booking',
      'appointment_reminder','waiting_notice','admission_application','observation_booking','observation_reminder')
    or jsonb_typeof(p_contract->'templateKey') is distinct from 'string'
    or jsonb_typeof(p_contract->'templateRevision') is distinct from 'number'
    or p_contract->>'templateRevision' !~ '^[1-9][0-9]{0,9}$' then
    raise exception 'registration_customer_message_contract_invalid' using errcode='22023';
  end if;
  if (p_contract->>'templateRevision')::numeric>2147483647 then
    raise exception 'registration_customer_message_contract_invalid' using errcode='22023';
  end if;
end $$;
revoke all on function dashboard_private.assert_registration_contact_message_contract_v1(jsonb) from public,anon,authenticated,service_role;

create function dashboard_private.registration_contact_legacy_contract_v1(p_contract jsonb,p_task uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare digits text; generation text;
begin
  perform dashboard_private.assert_registration_contact_message_contract_v1(p_contract);
  generation := p_contract->>'contactGeneration';
  perform dashboard_private.assert_registration_contact_open_v1(p_task,generation);
  select regexp_replace(coalesce(d.parent_phone,''),'[^0-9]','','g') into digits
    from public.ops_registration_details d where d.task_id=p_task;
  if digits !~ '^01(0|1|[6-9])[0-9]{7,8}$' or right(digits,4) is distinct from p_contract->>'recipientLast4' then
    raise exception 'registration_customer_message_contract_invalid' using errcode='22023';
  end if;
  return (p_contract-array['version','contactGeneration','recipientLast4','requestDigest']::text[])
    || jsonb_build_object('parentPhoneDigits',digits);
end $$;
revoke all on function dashboard_private.registration_contact_legacy_contract_v1(jsonb,uuid) from public,anon,authenticated,service_role;

-- Preserve the final ordered baseline implementations as owner-only capabilities.
-- New wrappers keep the public OID/ACL and all prior activation, template,
-- ownership, lock, dedupe, attempt-count and provider-result checks.
do $clone$
declare item record; definition text; old_owner text;
begin
  for item in select * from (values
    ('public.create_registration_customer_message_preview_v1(uuid,text,uuid,jsonb)','contact_preview_legacy_v1'),
    ('public.claim_registration_customer_message_v1(uuid,uuid,text,jsonb)','contact_claim_legacy_v1'),
    ('public.mark_registration_customer_message_attempt_started_v1(uuid,uuid,uuid,jsonb)','contact_attempt_legacy_v1'),
    ('public.read_registration_customer_reminder_source_v1(uuid,uuid)','contact_reminder_source_legacy_v1'),
    ('public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)','contact_reminder_begin_legacy_v1'),
    ('dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)','contact_source_legacy_v1'),
    ('public.resolve_registration_customer_message_bundle_source_v1(text,uuid,date)','contact_bundle_source_legacy_v1')
  ) originals(signature,clone_name) loop
    select pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner) into strict definition,old_owner
      from pg_proc p where p.oid=item.signature::regprocedure;
    if old_owner<>'postgres' then raise exception 'contact_fence_owner_review_required' using errcode='55000'; end if;
    definition := regexp_replace(definition,'CREATE OR REPLACE FUNCTION [^(]+\(',
      'CREATE FUNCTION dashboard_private.'||item.clone_name||'(');
    execute definition;
    execute format('REVOKE ALL ON FUNCTION dashboard_private.%I(%s) FROM PUBLIC,anon,authenticated,service_role',
      item.clone_name,pg_get_function_identity_arguments(item.signature::regprocedure));
  end loop;
end $clone$;

create or replace function dashboard_private.resolve_registration_customer_message_source_v1_impl(p_message_kind text,p_source_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
  perform dashboard_private.assert_registration_contact_message_source_v1(p_message_kind,p_source_id,null);
  return dashboard_private.contact_source_legacy_v1(p_message_kind,p_source_id);
end $$;

create or replace function public.create_registration_customer_message_preview_v1(p_actor_profile_id uuid,p_message_kind text,p_source_id uuid,p_contract jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare fence jsonb; result jsonb; v_task_id uuid;
begin
  fence := dashboard_private.registration_contact_message_fence_v1(p_message_kind,p_source_id);
  v_task_id := (fence->>'taskId')::uuid;
  perform dashboard_private.registration_customer_message_assert_actor_v1(p_actor_profile_id,v_task_id,'send');
  fence := dashboard_private.assert_registration_contact_message_source_v1(p_message_kind,p_source_id,p_contract->>'contactGeneration');
  result := dashboard_private.contact_preview_legacy_v1(p_actor_profile_id,p_message_kind,p_source_id,
    dashboard_private.registration_contact_legacy_contract_v1(p_contract,v_task_id));
  update public.ops_registration_customer_message_previews set contact_generation=(fence->>'contactGeneration')::bigint
    where id=(result->>'previewId')::uuid and task_id=v_task_id;
  return result;
end $$;

create or replace function public.read_registration_customer_message_preview_target_v1(p_actor_profile_id uuid,p_preview_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare preview public.ops_registration_customer_message_previews%rowtype; source_id uuid;
begin
  if (select auth.role())<>'service_role' then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
  select * into preview from public.ops_registration_customer_message_previews where id=p_preview_id;
  if not found then raise exception 'registration_customer_message_preview_not_found' using errcode='P0002'; end if;
  if preview.created_by is distinct from p_actor_profile_id then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
  perform dashboard_private.registration_customer_message_assert_actor_v1(p_actor_profile_id,preview.task_id,'send');
  if preview.contact_generation is null then raise exception 'registration_contact_generation_unverified' using errcode='23514'; end if;
  source_id := dashboard_private.registration_customer_message_stored_source_id_v1(preview.observation_id,preview.appointment_id,preview.track_id,preview.task_id);
  return jsonb_build_object('taskId',preview.task_id,'sourceId',source_id,'messageKind',preview.message_kind,'contactGeneration',preview.contact_generation::text);
end $$;

create function public.read_registration_contact_message_request_replay_v1(p_actor_profile_id uuid,p_preview_id uuid,p_request_key text,p_request_digest jsonb,p_contact_generation text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare message public.ops_registration_customer_messages%rowtype; result jsonb;
begin
  if (select auth.role())<>'service_role' then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
  if jsonb_typeof(p_request_digest) is distinct from 'object'
    or p_request_digest-array['version','digest']::text[] <> '{}'::jsonb
    or not p_request_digest ?& array['version','digest']::text[]
    or p_request_digest->'version' is distinct from '1'::jsonb
    or jsonb_typeof(p_request_digest->'digest') is distinct from 'string'
    or p_request_digest->>'digest' !~ '^[a-f0-9]{64}$'
    or p_contact_generation is null or p_contact_generation !~ '^[1-9][0-9]{0,18}$' then
    raise exception 'registration_contact_request_replay_mismatch' using errcode='23514';
  end if;
  if p_contact_generation::numeric>9223372036854775807 then
    raise exception 'registration_contact_request_replay_mismatch' using errcode='23514';
  end if;
  select * into message from public.ops_registration_customer_messages
    where preview_id=p_preview_id and request_key=p_request_key and confirmed_by=p_actor_profile_id;
  if not found then return null; end if;
  perform dashboard_private.registration_customer_message_assert_actor_v1(p_actor_profile_id,message.task_id,'send');
  if message.contact_request_digest is distinct from p_request_digest
    or message.contact_generation::text is distinct from p_contact_generation then
    raise exception 'registration_contact_request_replay_mismatch' using errcode='23514';
  end if;
  result := dashboard_private.registration_customer_message_result_v1(message.id,false,true,false);
  return result || jsonb_build_object('owner',false,'idempotent',true);
end $$;
revoke all on function public.read_registration_contact_message_request_replay_v1(uuid,uuid,text,jsonb,text) from public,anon,authenticated,service_role;
-- New read-only RPC ACL withheld until separate installation approval.

create or replace function public.claim_registration_customer_message_v1(p_actor_profile_id uuid,p_preview_id uuid,p_request_key text,p_contract jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare preview public.ops_registration_customer_message_previews%rowtype; result jsonb; fence jsonb; source_id uuid;
begin
  -- Validate the immutable rawless input even when returning a closed-case
  -- saved result. Validation must not read current phone or reopening state.
  perform dashboard_private.assert_registration_contact_message_contract_v1(p_contract);
  select * into preview from public.ops_registration_customer_message_previews where id=p_preview_id;
  if not found then raise exception 'registration_customer_message_preview_not_found' using errcode='P0002'; end if;
  perform dashboard_private.registration_customer_message_assert_actor_v1(p_actor_profile_id,preview.task_id,'send');
  if preview.created_by is distinct from p_actor_profile_id or preview.contact_generation is null
    or preview.contact_generation::text is distinct from p_contract->>'contactGeneration' then
    raise exception 'registration_contact_generation_changed' using errcode='23514';
  end if;
  result := public.read_registration_contact_message_request_replay_v1(p_actor_profile_id,p_preview_id,p_request_key,p_contract->'requestDigest',p_contract->>'contactGeneration');
  if result is not null then return result; end if;
  source_id := dashboard_private.registration_customer_message_stored_source_id_v1(preview.observation_id,preview.appointment_id,preview.track_id,preview.task_id);
  fence := dashboard_private.assert_registration_contact_message_source_v1(preview.message_kind,source_id,p_contract->>'contactGeneration');
  result := dashboard_private.contact_claim_legacy_v1(p_actor_profile_id,p_preview_id,p_request_key,
    dashboard_private.registration_contact_legacy_contract_v1(p_contract,preview.task_id));
  if coalesce((result->>'owner')::boolean,false) then
    update public.ops_registration_customer_messages set contact_generation=preview.contact_generation,
      contact_request_digest=p_contract->'requestDigest' where id=(result->>'messageId')::uuid;
  end if;
  return result;
end $$;

create or replace function public.mark_registration_customer_message_attempt_started_v1(p_message_id uuid,p_claim_token uuid,p_dispatch_token uuid,p_contract jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare message public.ops_registration_customer_messages%rowtype; source_id uuid; fence jsonb; result jsonb;
begin
  if (select auth.role())<>'service_role' then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
  select * into message from public.ops_registration_customer_messages where id=p_message_id;
  if not found then raise exception 'registration_customer_message_not_found' using errcode='P0002'; end if;
  -- Read immutable scope first; the case fence obtains its locks before the legacy marker locks the message.
  source_id := dashboard_private.registration_customer_message_stored_source_id_v1(message.observation_id,message.appointment_id,message.track_id,message.task_id);
  if message.contact_generation is null or message.contact_generation::text is distinct from p_contract->>'contactGeneration'
    or message.contact_request_digest is distinct from p_contract->'requestDigest' then
    raise exception 'registration_contact_generation_changed' using errcode='23514';
  end if;
  fence := dashboard_private.assert_registration_contact_message_source_v1(message.message_kind,source_id,p_contract->>'contactGeneration');
  result := dashboard_private.contact_attempt_legacy_v1(p_message_id,p_claim_token,p_dispatch_token,
    dashboard_private.registration_contact_legacy_contract_v1(p_contract,message.task_id));
  if coalesce((result->>'allowed')::boolean,false) then
    result := result || jsonb_build_object('contactGrant',jsonb_build_object('version',1,'action','attempt',
      'linearization','registration_contact_case_lock_v1','messageId',p_message_id,'dispatchToken',p_dispatch_token,'contactFence',fence));
  end if;
  return result;
end $$;

create or replace function public.read_registration_customer_reminder_source_v1(p_job_id uuid,p_claim_token uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare job dashboard_private.registration_customer_reminder_jobs%rowtype; fence jsonb; source_id uuid;
begin
  if (select auth.role())<>'service_role' then raise exception 'registration_customer_reminder_worker_unauthorized' using errcode='42501'; end if;
  select * into job from dashboard_private.registration_customer_reminder_jobs where job_id=p_job_id;
  if not found or job.contact_generation is null then raise exception 'registration_contact_generation_unverified' using errcode='23514'; end if;
  source_id := case when job.message_kind='observation_reminder' then job.observation_id else job.appointment_id end;
  fence := dashboard_private.assert_registration_contact_message_source_v1(job.message_kind,source_id,job.contact_generation::text);
  return jsonb_build_object('source',dashboard_private.contact_reminder_source_legacy_v1(p_job_id,p_claim_token),'contactFence',fence);
end $$;

create or replace function public.begin_registration_customer_reminder_dispatch_v1(p_job_id uuid,p_claim_token uuid,p_contract jsonb,p_readiness_contract jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare job dashboard_private.registration_customer_reminder_jobs%rowtype; fence jsonb; source_id uuid; result jsonb;
begin
  if (select auth.role())<>'service_role' then raise exception 'registration_customer_reminder_worker_unauthorized' using errcode='42501'; end if;
  select * into job from dashboard_private.registration_customer_reminder_jobs where job_id=p_job_id;
  if not found or job.contact_generation is null or job.contact_generation::text is distinct from p_contract->>'contactGeneration' then
    raise exception 'registration_contact_generation_changed' using errcode='23514'; end if;
  source_id := case when job.message_kind='observation_reminder' then job.observation_id else job.appointment_id end;
  fence := dashboard_private.assert_registration_contact_message_source_v1(job.message_kind,source_id,p_contract->>'contactGeneration');
  result := dashboard_private.contact_reminder_begin_legacy_v1(p_job_id,p_claim_token,
    dashboard_private.registration_contact_legacy_contract_v1(p_contract,job.task_id),p_readiness_contract);
  if coalesce((result->>'allowed')::boolean,false) then
    update public.ops_registration_customer_messages set contact_generation=job.contact_generation,
      contact_request_digest=p_contract->'requestDigest' where id=(result->>'messageId')::uuid;
    result := result || jsonb_build_object('contactGrant',jsonb_build_object('version',1,'action','attempt',
      'linearization','registration_contact_case_lock_v1','messageId',result->'messageId','dispatchToken',result->'dispatchToken','contactFence',fence));
  end if;
  return result;
end $$;

create or replace function public.resolve_registration_customer_message_bundle_source_v1(p_message_kind text,p_task_id uuid,p_service_date date default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
  perform dashboard_private.assert_registration_contact_message_source_v1(p_message_kind,p_task_id,null);
  return dashboard_private.contact_bundle_source_legacy_v1(p_message_kind,p_task_id,p_service_date);
end $$;

-- Final ordered baseline (20260901111200:2673) intentionally retires this
-- producer: service-role guarded NULL, not the August active claim loop. Keep
-- its public OID/owner/ACL and no-send result. Do not resurrect an earlier body.
do $retired_reminder_preflight$
declare source_body text; owner_name text;
begin
  select regexp_replace(btrim(p.prosrc),'\s+',' ','g'),pg_get_userbyid(p.proowner)
    into strict source_body,owner_name from pg_proc p
    where p.oid='public.claim_registration_customer_reminder_job_v1()'::regprocedure;
  if owner_name<>'postgres' or source_body is distinct from
    'begin if (select auth.role()) <> ''service_role'' then raise exception ''registration_customer_reminder_worker_unauthorized'' using errcode = ''42501''; end if; return null; end;' then
    raise exception 'contact_retired_reminder_source_review_required' using errcode='55000';
  end if;
end $retired_reminder_preflight$;

-- Adapter contract remains explicit and no-send. This candidate neither
-- materializes work nor synchronizes/reopens legacy queue records. Its new ACL
-- is withheld, so runtime cutover stays blocked until separately reviewed.
create function public.reconcile_registration_customer_reminder_claims_v1()
returns void language plpgsql volatile security definer set search_path='' as $$
begin
  if (select auth.role())<>'service_role' then
    raise exception 'registration_customer_reminder_worker_unauthorized' using errcode='42501';
  end if;
  return;
end $$;
revoke all on function public.reconcile_registration_customer_reminder_claims_v1() from public,anon,authenticated,service_role;

-- read/begin wrappers above are future-safe for already existing scoped jobs,
-- but no producer is activated here. A future authorized producer must acquire
-- parent -> ordered current tracks -> detail BEFORE queue/message/preview locks,
-- save the locked contact generation and return the exact {claim,contactFence}
-- envelope. It needs final-definition SQLSTATE/pgTAP/concurrency verification.

-- Bundle runtime is currently preview-only, activation off; no installed
-- claim/begin dispatcher exists in this ordered baseline. Its generic worker
-- now requires the same strict contactGrant and fails closed without it. Do not
-- invent an enabled bundle sender or activate runtime here. A future adapter
-- must acquire this same case fence before bundle/message locks and return the
-- exact receipt from the transaction that commits its attempt marker.
commit;
