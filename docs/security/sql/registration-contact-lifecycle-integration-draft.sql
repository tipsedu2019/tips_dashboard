-- SOURCE-ONLY REVIEW CANDIDATE. Never placed in automatic migrations.
-- Base f2d308a0e2999a80f37f77f53341286561b92d51 includes exact PR96 replacements.
-- Parent alone runs separately authorized owned synthetic DB verification.
-- Previous candidate installed but whole cancellation failed its original
-- parent projection guard. This revision preserves that guard and legacy facts.
-- No historical purge, no new secret/key provisioning. Server HMAC uses the
-- existing REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER through an authenticated
-- service-role-only HTTP controller; the browser is not a digest authority.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- Exact final prosrc pins are derived from source bytes, NOT a live catalog.
-- Do every preimage check before installing tables/columns/functions.
do $registration_contact_preflight$
declare item record; target regprocedure;
begin
  for item in select * from (values
    ('dashboard_private.create_registration_case_impl(text,text,text,text,text,text,timestamptz,text[],text,text,text)', 'd5ce049f39adef16428b1dc0964ff414','v','jsonb'),
    ('dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamptz,text,text,integer,text)', 'ba45098e855e187262e31102a87c0d46','v','jsonb'),
    ('dashboard_private.save_registration_case_inquiry_v1_impl(uuid,text,text,text,text,text,text,timestamptz,text,text,integer,text[],text[],text)', '5f96e3817673f97d8d803855ef7141d6','v','jsonb'),
    ('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)', 'de5e23e2f3662119c832b93ceb17e9e5','v','jsonb'),
    ('dashboard_private.save_registration_waiting_details_v2_impl(uuid,text,uuid,text,text)', 'fcb2a22ab233bf23456e1154a19a58bb','v','jsonb'),
    ('dashboard_private.sync_registration_case_subjects_impl(uuid,text[],text)', '75d1bb204e1597a5a0e0d12cfc2765bd','v','jsonb'),
    ('dashboard_private.update_registration_case_common_with_reminders_v1_impl(uuid,text,text,text,text,text,text,timestamptz,text,text,integer,text)', '0b52417da5059cd844ccad8d2f19de71','v','jsonb'),
    ('dashboard_private.derive_registration_parent_projection(uuid)','9a9f8076e1ef5c2b5c70dcb7e7e1e254','s','jsonb'),
    ('public.prevent_completed_operation_reopen()','fcdcaf1f93f4e69cb850e5c322b30d0f','v','trigger'),
    ('dashboard_private.reopen_registration_track_impl(uuid,text,text,text)','1d6f75da0c146dcfc1c71f45d66ae590','v','jsonb'),
    ('dashboard_private.bump_registration_customer_message_recipient_revision_v1()','b29b56dd0151a2eecc74fbe2409ebfeb','v','trigger')
  ) pins(signature, body_md5,volatility,return_type) loop
    target := pg_catalog.to_regprocedure(item.signature);
    if target is null or not exists (
      select 1 from pg_catalog.pg_proc proc
      join pg_catalog.pg_language language on language.oid=proc.prolang
      join pg_catalog.pg_roles owner_role on owner_role.oid=proc.proowner
      where proc.oid=target and pg_catalog.md5(proc.prosrc)=item.body_md5
        and language.lanname='plpgsql' and owner_role.rolname='postgres'
        and proc.prosecdef and not proc.proisstrict and not proc.proleakproof
        and proc.provolatile::text=item.volatility and proc.prokind='f' and proc.prorettype=pg_catalog.to_regtype(item.return_type)
        and proc.proconfig=array['search_path=""']::text[]
    ) then
      raise exception 'registration_contact_source_preimage_drift' using errcode='55000';
    end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_attribute where attrelid='public.ops_registration_details'::regclass
      and attname in ('contact_phase','contact_generation','contact_revision','contact_closed_at','contact_closure_reason','contact_whole_cancel_explicit') and not attisdropped)
    or pg_catalog.to_regclass('dashboard_private.registration_contact_claims_v1') is not null
    or pg_catalog.to_regclass('dashboard_private.registration_contact_receipts_v1') is not null then
    raise exception 'registration_contact_installation_already_present' using errcode='55000';
  end if;
end $registration_contact_preflight$;

-- Metadata defaults classify legacy rows without clearing any legacy value.
-- A later authorized case action performs that case's forward transition only.
alter table public.ops_registration_details
  add column contact_phase text not null default 'open',
  add column contact_generation bigint not null default 1,
  add column contact_revision bigint not null default 1,
  add column contact_closed_at timestamptz,
  add column contact_closure_reason text,
  add column contact_whole_cancel_explicit boolean not null default false,
  add constraint registration_contact_counters_v1 check(contact_generation>0 and contact_revision>0),
  add constraint registration_contact_phase_v1 check(
    (contact_phase='open' and contact_closed_at is null and contact_closure_reason is null)
    or (contact_phase='closed' and contact_closed_at is not null
      and contact_closure_reason is not null
      and contact_closure_reason in ('all_current_tracks_terminal','whole_case_cancelled','last_current_track_excluded')
      and parent_phone is null and student_phone is null)
  ),
  add constraint registration_contact_explicit_cancel_v1 check(not contact_whole_cancel_explicit
    or contact_phase='closed' and contact_closure_reason='whole_case_cancelled');

-- This is authorization metadata, never a raw request/contact/key store.
create table dashboard_private.registration_contact_claims_v1(
  transaction_id bigint not null,
  backend_pid integer not null,
  actor_id uuid not null,
  request_key text not null,
  task_id uuid,
  command text not null,
  expected_generation bigint not null check(expected_generation>0),
  expected_revision bigint not null check(expected_revision>0),
  request_hmac text not null check(request_hmac ~ '^[0-9a-f]{64}$'),
  before_phase text not null check(before_phase in ('open','closed')),
  before_current_track_count integer not null check(before_current_track_count>=0),
  close_reason text,
  legacy_replay boolean not null default false,
  lifecycle_applied boolean not null default false,
  parent_reopen_authorized boolean not null default false,
  primary key(transaction_id,backend_pid)
);
create table dashboard_private.registration_contact_receipts_v1(
  actor_id uuid not null,
  request_key text not null,
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  command text not null,
  request_hmac text not null check(request_hmac ~ '^[0-9a-f]{64}$'),
  response_payload jsonb not null check(pg_catalog.jsonb_typeof(response_payload)='object'),
  primary key(actor_id,request_key)
);
-- Narrow capability minted by the parent AFTER-status trigger or validated
-- actual business-reopen helper. This is
-- not a request, HMAC or receipt: it permits an exact contact-only projection
-- transition after all original task guards have accepted the business write.
create table dashboard_private.registration_contact_projection_claims_v1(
  transaction_id bigint not null,backend_pid integer not null,task_id uuid not null,
  actor_id uuid,expected_generation bigint not null check(expected_generation>0),
  expected_revision bigint not null check(expected_revision>0),
  direction text not null check(direction in ('close','seal','reopen')),
  primary key(transaction_id,backend_pid,task_id)
);
alter table dashboard_private.registration_contact_claims_v1 owner to postgres;
alter table dashboard_private.registration_contact_receipts_v1 owner to postgres;
alter table dashboard_private.registration_contact_projection_claims_v1 owner to postgres;
alter table dashboard_private.registration_contact_claims_v1 enable row level security;
alter table dashboard_private.registration_contact_receipts_v1 enable row level security;
alter table dashboard_private.registration_contact_projection_claims_v1 enable row level security;
revoke all on dashboard_private.registration_contact_claims_v1 from public,anon,authenticated,service_role;
revoke all on dashboard_private.registration_contact_receipts_v1 from public,anon,authenticated,service_role;
revoke all on dashboard_private.registration_contact_projection_claims_v1 from public,anon,authenticated,service_role;

create function dashboard_private.lock_registration_contact_case_v1(p_task_id uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
  perform 1 from public.ops_tasks task where task.id=p_task_id and task.type='registration' for update;
  if not found then raise exception 'registration_contact_case_not_found' using errcode='P0002'; end if;
  perform 1 from public.ops_registration_subject_tracks track where track.task_id=p_task_id order by track.id for update;
  perform 1 from public.ops_registration_details detail where detail.task_id=p_task_id for update;
  if not found then raise exception 'registration_detail_required' using errcode='23514'; end if;
end;
$$;

create function dashboard_private.registration_case_contact_snapshot_v1(p_task_id uuid,p_include_parent boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare detail public.ops_registration_details%rowtype; task public.ops_tasks%rowtype;
  current_ids uuid[]; all_closed boolean; archived_only boolean; effective_closed boolean;
  last_archived_at timestamptz;
begin
  select source.* into detail from public.ops_registration_details source where source.task_id=p_task_id;
  if not found then raise exception 'registration_detail_required' using errcode='23514'; end if;
  select source.* into task from public.ops_tasks source where source.id=p_task_id and source.type='registration';
  if not found then raise exception 'registration_contact_case_not_found' using errcode='P0002'; end if;
  select coalesce(pg_catalog.array_agg(track.id order by track.id),array[]::uuid[]),
    pg_catalog.count(*)>0 and coalesce(pg_catalog.bool_and(track.workflow_status in ('registered','not_registered','inquiry_only')),false)
    into current_ids,all_closed
    from public.ops_registration_subject_tracks track where track.task_id=p_task_id and track.archived_at is null;
  -- An untouched empty intake has no completed/excluded scope. A legacy case
  -- with only archived tracks has already excluded its last current track,
  -- even when installation added the default open contact metadata later.
  if pg_catalog.cardinality(current_ids)=0 then
    select pg_catalog.max(track.archived_at) into last_archived_at
      from public.ops_registration_subject_tracks track where track.task_id=p_task_id;
  end if;
  archived_only := last_archived_at is not null;
  effective_closed := detail.contact_phase='closed' or task.status='canceled' or all_closed or archived_only;
  return pg_catalog.jsonb_build_object(
    'version',1,'taskId',p_task_id,'revision',detail.contact_revision::text,'generation',detail.contact_generation::text,
    'phase',case when effective_closed then 'closed' else 'open' end,
    'closureReason',case when detail.contact_phase='closed' then detail.contact_closure_reason
      when task.status='canceled' then 'whole_case_cancelled'
      when all_closed then 'all_current_tracks_terminal'
      when archived_only then 'last_current_track_excluded' else null end,
    'closedAt',case when detail.contact_phase<>'closed' and task.status<>'canceled' and archived_only
      then last_archived_at else detail.contact_closed_at end,'commonRevision',detail.common_revision,
    'allPhasesClosed',all_closed,'currentTrackIds',pg_catalog.to_jsonb(current_ids),'studentId',task.student_id,
    'parentPhone',case when p_include_parent and not effective_closed and pg_catalog.cardinality(current_ids)>0 then detail.parent_phone else null end
  );
end;
$$;

-- Provider adapters call this BEFORE preview/message/job locks. It adds no
-- workflow/request advisory lock after a caller already acquired row locks.
create function dashboard_private.assert_registration_contact_open_v1(p_task_id uuid,p_expected_generation text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare snapshot jsonb;
begin
  if p_expected_generation is null or p_expected_generation !~ '^[1-9][0-9]{0,18}$'
    or pg_catalog.length(p_expected_generation)=19 and p_expected_generation>'9223372036854775807' then
    raise exception 'registration_contact_generation_invalid' using errcode='22023';
  end if;
  perform dashboard_private.lock_registration_contact_case_v1(p_task_id);
  snapshot := dashboard_private.registration_case_contact_snapshot_v1(p_task_id,false);
  if snapshot->>'generation' is distinct from p_expected_generation then
    raise exception 'registration_contact_generation_conflict' using errcode='23514';
  end if;
  if snapshot->>'phase'='closed' then raise exception 'registration_contact_case_closed' using errcode='23514'; end if;
  return snapshot;
end;
$$;

create function public.get_registration_case_contact_v1(p_task_id uuid,p_limit integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if p_limit is distinct from 1 then raise exception 'registration_contact_limit_invalid' using errcode='22023'; end if;
  if (select auth.uid()) is null or not dashboard_private.can_read_ops_task_v1(p_task_id) then
    raise exception 'registration_access_denied' using errcode='42501';
  end if;
  return dashboard_private.registration_case_contact_snapshot_v1(p_task_id,
    dashboard_private.registration_observation_current_actor_is_active_manager_v1());
end;
$$;

-- Resource limits are RPC response budgets, not roster/admission business quotas.
-- Oversized historical receipts fail closed unchanged; no truncation/backfill/purge.
create function dashboard_private.registration_contact_assert_bounded_json_v1(p_value jsonb)
returns void language plpgsql immutable security definer set search_path='' as $$
begin
  if p_value is null or pg_catalog.octet_length(pg_catalog.convert_to(p_value::text,'UTF8'))>128000 then
    raise exception 'registration_contact_response_budget_exceeded' using errcode='23514'; end if;
  if exists(with recursive nodes(value,depth) as (
    select p_value,1 union all
    select child.value,parent.depth+1 from nodes parent cross join lateral (
      select value from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(parent.value)='array' then parent.value else '[]'::jsonb end)
      union all
      select value from pg_catalog.jsonb_each(case when pg_catalog.jsonb_typeof(parent.value)='object' then parent.value else '{}'::jsonb end)
    ) child where parent.depth<=8
  ) select 1 from nodes where depth>8 or pg_catalog.jsonb_typeof(value)='string' and pg_catalog.length(value#>>'{}')>500) then
    raise exception 'registration_contact_response_budget_exceeded' using errcode='23514'; end if;
end $$;

create function dashboard_private.registration_contact_assert_uuid_array_v1(p_value jsonb,p_max integer)
returns void language plpgsql immutable security definer set search_path='' as $$
begin
  if pg_catalog.jsonb_typeof(p_value) is distinct from 'array' then
    raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  if pg_catalog.jsonb_array_length(p_value)>p_max then
    raise exception 'registration_contact_response_budget_exceeded' using errcode='23514'; end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_value) item(value)
    where pg_catalog.jsonb_typeof(value) is distinct from 'string' or value#>>'{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
    raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(p_value))<>
    (select pg_catalog.count(distinct value::uuid) from pg_catalog.jsonb_array_elements_text(p_value)) then
    raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
end $$;

create function dashboard_private.registration_contact_assert_receipt_v1(p_receipt jsonb,p_task_id uuid,p_request_key text,p_command text)
returns void language plpgsql stable security definer set search_path='' as $$
declare result jsonb; state jsonb; item jsonb; key text; finalization jsonb; required_keys text[];
begin
  perform dashboard_private.registration_contact_assert_bounded_json_v1(p_receipt);
  if pg_catalog.jsonb_typeof(p_receipt) is distinct from 'object' or p_receipt-array['version','taskId','requestKey','command','replayed','result']::text[]<>'{}'::jsonb
    or not p_receipt ?& array['version','taskId','requestKey','command','replayed','result']::text[]
    or p_receipt->'version' is distinct from '1'::jsonb or p_receipt->>'taskId' is distinct from p_task_id::text
    or p_receipt->>'requestKey' is distinct from p_request_key or p_receipt->>'command' is distinct from p_command
    or pg_catalog.jsonb_typeof(p_receipt->'replayed') is distinct from 'boolean' then
    raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  result:=p_receipt->'result';
  if pg_catalog.jsonb_typeof(result) is distinct from 'object' or result-array['taskId','trackId','classId','studentId',
    'commonRevision','workflowRevision','workflowStatus','workflowStatusEnteredAt','waitingKind','retakeDecision','changed',
    'sourceEventIds','enrollmentFinalization','subjects','tracks','contactState']::text[]<>'{}'::jsonb then
    raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  required_keys:=case p_command
    when 'create' then array['taskId','commonRevision','subjects','tracks']
    when 'update_common' then array['taskId','commonRevision']
    when 'save_inquiry' then array['taskId','commonRevision','subjects','tracks']
    when 'set_workflow_status' then array['trackId','workflowStatus','workflowRevision','workflowStatusEnteredAt','enrollmentFinalization']
    when 'reopen' then array['trackId','workflowStatus','workflowRevision','workflowStatusEnteredAt','enrollmentFinalization']
    when 'waiting_details' then array['trackId','waitingKind','classId','retakeDecision']
    when 'close' then array['taskId','changed']
    when 'archive' then array['taskId','subjects','tracks']
    when 'unarchive' then array['taskId','subjects','tracks']
    when 'bind_student' then array['taskId','studentId','changed']
    else null end;
  if required_keys is null or not result ?& required_keys then
    raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  if result ? 'taskId' and result->>'taskId' is distinct from p_task_id::text then
    raise exception 'registration_contact_result_scope_invalid' using errcode='23514'; end if;
  foreach key in array array['trackId','classId','studentId'] loop
    if result ? key and result->key<>'null'::jsonb then
      if pg_catalog.jsonb_typeof(result->key) is distinct from 'string' or result->>key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
    end if;
  end loop;
  if result ? 'trackId' and result->'trackId'<>'null'::jsonb and not exists(
    select 1 from public.ops_registration_subject_tracks track where track.id=(result->>'trackId')::uuid and track.task_id=p_task_id) then
    raise exception 'registration_contact_result_scope_invalid' using errcode='23514'; end if;
  foreach key in array array['commonRevision','workflowRevision'] loop
    if result ? key and (pg_catalog.jsonb_typeof(result->key) is distinct from 'number' or result->>key !~ '^[1-9][0-9]{0,9}$') then
      raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
    if result ? key and (result->>key)::numeric>2147483647 then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  end loop;
  if result ? 'workflowStatus' and (pg_catalog.jsonb_typeof(result->'workflowStatus') is distinct from 'string' or result->>'workflowStatus' not in ('inquiry','level_test_requested','consultation_requested','consultation_completed','waiting_current_class','waiting_new_class','waiting_next_opening','observation_requested','observation_feedback_pending','observation_completed','enrollment_requested','payment_in_progress','registered','not_registered','inquiry_only')) then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  foreach key in array array['waitingKind','retakeDecision'] loop
    if result ? key and result->key<>'null'::jsonb and (pg_catalog.jsonb_typeof(result->key) is distinct from 'string' or key='waitingKind' and result->>key not in ('current_class','current_term_opening','next_term_opening') or key='retakeDecision' and result->>key not in ('required','not_required')) then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  end loop;
  if result ? 'changed' and pg_catalog.jsonb_typeof(result->'changed') is distinct from 'boolean' then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  if result ? 'workflowStatusEnteredAt' and result->'workflowStatusEnteredAt'<>'null'::jsonb and (
    pg_catalog.jsonb_typeof(result->'workflowStatusEnteredAt') is distinct from 'string' or pg_catalog.length(result->>'workflowStatusEnteredAt')>64) then
    raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  if result ? 'sourceEventIds' then
    perform dashboard_private.registration_contact_assert_uuid_array_v1(result->'sourceEventIds',50);
    if exists(select 1 from pg_catalog.jsonb_array_elements_text(result->'sourceEventIds') item(value)
      where not exists(select 1 from public.ops_task_events event where event.id=item.value::uuid and event.task_id=p_task_id)) then
      raise exception 'registration_contact_result_scope_invalid' using errcode='23514'; end if;
  end if;
  finalization:=result->'enrollmentFinalization';
  if finalization is not null and finalization<>'null'::jsonb then
    if pg_catalog.jsonb_typeof(finalization) is distinct from 'object' or finalization-array['trackId','studentId','batchId','changed','enrollmentIds']::text[]<>'{}'::jsonb
      or not finalization ?& array['trackId','studentId','batchId','changed','enrollmentIds']::text[] or pg_catalog.jsonb_typeof(finalization->'changed') is distinct from 'boolean' then
      raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
    foreach key in array array['trackId','studentId','batchId'] loop
      if key='batchId' and finalization->key='null'::jsonb then continue; end if;
      if pg_catalog.jsonb_typeof(finalization->key) is distinct from 'string' or finalization->>key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
    end loop;
    perform dashboard_private.registration_contact_assert_uuid_array_v1(finalization->'enrollmentIds',50);
    if not exists(select 1 from public.ops_registration_subject_tracks track where track.id=(finalization->>'trackId')::uuid and track.task_id=p_task_id)
      or finalization->'batchId'<>'null'::jsonb and not exists(select 1 from public.ops_registration_admission_batches batch where batch.id=(finalization->>'batchId')::uuid and batch.task_id=p_task_id)
      or exists(select 1 from pg_catalog.jsonb_array_elements_text(finalization->'enrollmentIds') item(value)
        where not exists(select 1 from public.ops_registration_enrollments enrollment
          where enrollment.id=item.value::uuid and enrollment.track_id=(finalization->>'trackId')::uuid
            and enrollment.student_id=(finalization->>'studentId')::uuid)) then
      raise exception 'registration_contact_result_scope_invalid' using errcode='23514'; end if;
  end if;
  if result ? 'subjects' then
    if pg_catalog.jsonb_typeof(result->'subjects') is distinct from 'array' then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
    if pg_catalog.jsonb_array_length(result->'subjects')>3 or exists(select 1 from pg_catalog.jsonb_array_elements(result->'subjects') subject(value)
      where value not in ('"영어"'::jsonb,'"수학"'::jsonb,'"과학"'::jsonb))
      or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(result->'subjects'))<>(select pg_catalog.count(distinct value) from pg_catalog.jsonb_array_elements(result->'subjects')) then
      raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  end if;
  if result ? 'tracks' then
    if pg_catalog.jsonb_typeof(result->'tracks') is distinct from 'array' then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
    if pg_catalog.jsonb_array_length(result->'tracks')>50 then raise exception 'registration_contact_response_budget_exceeded' using errcode='23514'; end if;
    for item in select value from pg_catalog.jsonb_array_elements(result->'tracks') loop
      if pg_catalog.jsonb_typeof(item) is distinct from 'object' or item-array['id','taskId','subject','workflowStatus','workflowRevision','status','archivedAt',
        'directorProfileId','directorAssignmentSource','directorAssignmentRuleKey','waitingKind','levelTestRetakeDecision','migrationReviewRequired','stageEnteredAt']::text[]<>'{}'::jsonb
        or not item ?& array['id','taskId','subject','workflowStatus','workflowRevision','status','archivedAt']::text[]
        or item->>'taskId' is distinct from p_task_id::text or pg_catalog.jsonb_typeof(item->'id') is distinct from 'string'
        or item->>'id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        or item->>'subject' not in ('영어','수학','과학') then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      if not exists(select 1 from public.ops_registration_subject_tracks track where track.id=(item->>'id')::uuid and track.task_id=p_task_id and track.subject=item->>'subject') then
        raise exception 'registration_contact_result_scope_invalid' using errcode='23514'; end if;
      if pg_catalog.jsonb_typeof(item->'workflowStatus') is distinct from 'string' or item->>'workflowStatus' not in ('inquiry','level_test_requested','consultation_requested','consultation_completed','waiting_current_class','waiting_new_class','waiting_next_opening','observation_requested','observation_feedback_pending','observation_completed','enrollment_requested','payment_in_progress','registered','not_registered','inquiry_only') or pg_catalog.jsonb_typeof(item->'status') is distinct from 'string' or item->>'status' not in ('inquiry','migration_review','level_test_scheduled','level_test_in_progress','consultation_waiting','visit_consultation_scheduled','waiting','enrollment_decided','enrollment_processing','registered','not_registered','inquiry_closed') or pg_catalog.jsonb_typeof(item->'workflowRevision') is distinct from 'number' or item->>'workflowRevision' !~ '^[1-9][0-9]{0,9}$' then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      if (item->>'workflowRevision')::numeric>2147483647 then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      if item->'directorProfileId'<>'null'::jsonb and (pg_catalog.jsonb_typeof(item->'directorProfileId') is distinct from 'string' or item->>'directorProfileId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      foreach key in array array['archivedAt','stageEnteredAt'] loop
        if item ? key and item->key<>'null'::jsonb and (pg_catalog.jsonb_typeof(item->key) is distinct from 'string' or pg_catalog.length(item->>key)>64) then
          raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      end loop;
      if item->'directorAssignmentRuleKey'<>'null'::jsonb and (pg_catalog.jsonb_typeof(item->'directorAssignmentRuleKey') is distinct from 'string' or item->>'directorAssignmentRuleKey' !~ '^[a-zA-Z0-9_:.-]{0,200}$') then
        raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      if item ? 'directorAssignmentSource' and item->'directorAssignmentSource'<>'null'::jsonb and (pg_catalog.jsonb_typeof(item->'directorAssignmentSource') is distinct from 'string' or item->>'directorAssignmentSource' not in ('','default','manual','migration')) then
        raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      if item ? 'waitingKind' and item->'waitingKind'<>'null'::jsonb and (pg_catalog.jsonb_typeof(item->'waitingKind') is distinct from 'string' or item->>'waitingKind' not in ('current_class','current_term_opening','next_term_opening')) then
        raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      if item ? 'levelTestRetakeDecision' and item->'levelTestRetakeDecision'<>'null'::jsonb and (pg_catalog.jsonb_typeof(item->'levelTestRetakeDecision') is distinct from 'string' or item->>'levelTestRetakeDecision' not in ('required','not_required')) then
        raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      if item ? 'migrationReviewRequired' and pg_catalog.jsonb_typeof(item->'migrationReviewRequired') is distinct from 'boolean' then
        raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
    end loop;
    if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(result->'tracks'))<>(select pg_catalog.count(distinct (value->>'id')::uuid) from pg_catalog.jsonb_array_elements(result->'tracks'))
      or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(result->'tracks'))<>(select pg_catalog.count(distinct value->>'subject') from pg_catalog.jsonb_array_elements(result->'tracks')) then
      raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  end if;
  state:=result->'contactState';
  if pg_catalog.jsonb_typeof(state) is distinct from 'object' or state-array['version','taskId','revision','generation','phase','closureReason','closedAt','commonRevision','allPhasesClosed','currentTrackIds','studentId','parentPhone']::text[]<>'{}'::jsonb
    or not state ?& array['version','taskId','revision','generation','phase','closureReason','closedAt','commonRevision','allPhasesClosed','currentTrackIds','studentId','parentPhone']::text[]
    or state->'version' is distinct from '1'::jsonb or state->>'taskId' is distinct from p_task_id::text or state->'parentPhone' is distinct from 'null'::jsonb
    or pg_catalog.jsonb_typeof(state->'phase') is distinct from 'string' or state->>'phase' not in ('open','closed') or pg_catalog.jsonb_typeof(state->'allPhasesClosed') is distinct from 'boolean' then
    raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  foreach key in array array['revision','generation'] loop
    if pg_catalog.jsonb_typeof(state->key) is distinct from 'string' or state->>key !~ '^[1-9][0-9]{0,18}$' then
      raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
    if (state->>key)::numeric>9223372036854775807 then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  end loop;
  if state->>'phase'='open' and (state->'closureReason' is distinct from 'null'::jsonb or state->'closedAt' is distinct from 'null'::jsonb or state->'allPhasesClosed'='true'::jsonb) or state->>'phase'='closed' and (pg_catalog.jsonb_typeof(state->'closureReason') is distinct from 'string' or state->>'closureReason' not in ('all_current_tracks_terminal','whole_case_cancelled','last_current_track_excluded')) then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  if state->>'closureReason'='last_current_track_excluded' and state->'closedAt'='null'::jsonb then
    raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  if state->'studentId'<>'null'::jsonb and (pg_catalog.jsonb_typeof(state->'studentId') is distinct from 'string' or state->>'studentId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  if pg_catalog.jsonb_typeof(state->'commonRevision') is distinct from 'number' or state->>'commonRevision' !~ '^[1-9][0-9]{0,9}$' then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  if (state->>'commonRevision')::numeric>2147483647 then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  if state->'closedAt'<>'null'::jsonb and (pg_catalog.jsonb_typeof(state->'closedAt') is distinct from 'string' or pg_catalog.length(state->>'closedAt')>64) then
    raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
  perform dashboard_private.registration_contact_assert_uuid_array_v1(state->'currentTrackIds',3);
  if exists(select 1 from pg_catalog.jsonb_array_elements_text(state->'currentTrackIds') item(value)
    where not exists(select 1 from public.ops_registration_subject_tracks track where track.id=item.value::uuid and track.task_id=p_task_id)) then
    raise exception 'registration_contact_result_scope_invalid' using errcode='23514'; end if;
end $$;

-- Strict result projection: never spread a producer object or raw snapshot.
create function dashboard_private.registration_contact_result_v1(p_result jsonb,p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb := '{}'::jsonb; key text; row_item jsonb; finalization jsonb;
  tracks jsonb := '[]'::jsonb; source_track public.ops_registration_subject_tracks%rowtype;
begin
  if pg_catalog.jsonb_typeof(p_result) is distinct from 'object' then
    raise exception 'registration_contact_result_invalid' using errcode='23514';
  end if;
  foreach key in array array['taskId','trackId','classId','studentId'] loop
    if p_result ? key and p_result->key<>'null'::jsonb and (p_result->>key) !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
    if p_result ? key then result:=result||pg_catalog.jsonb_build_object(key,p_result->key); end if;
  end loop;
  foreach key in array array['commonRevision','workflowRevision'] loop
    if p_result ? key then
      if pg_catalog.jsonb_typeof(p_result->key)<>'number' or (p_result->>key) !~ '^[1-9][0-9]{0,9}$' then
        raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      result:=result||pg_catalog.jsonb_build_object(key,p_result->key);
    end if;
  end loop;
  if p_result ? 'workflowStatus' then
    if p_result->>'workflowStatus' not in ('inquiry','level_test_requested','consultation_requested','consultation_completed',
      'waiting_current_class','waiting_new_class','waiting_next_opening','observation_requested','observation_feedback_pending','observation_completed','enrollment_requested',
      'payment_in_progress','registered','not_registered','inquiry_only') then
      raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
    result:=result||pg_catalog.jsonb_build_object('workflowStatus',p_result->'workflowStatus');
  end if;
  if p_result ? 'workflowStatusEnteredAt' then
    result:=result||pg_catalog.jsonb_build_object('workflowStatusEnteredAt',(p_result->>'workflowStatusEnteredAt')::timestamptz);
  end if;
  foreach key in array array['waitingKind','retakeDecision'] loop
    if p_result ? key then
      if p_result->key<>'null'::jsonb and ((key='waitingKind' and p_result->>key not in ('current_class','current_term_opening','next_term_opening'))
        or (key='retakeDecision' and p_result->>key not in ('required','not_required'))) then
        raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      result:=result||pg_catalog.jsonb_build_object(key,p_result->key);
    end if;
  end loop;
  if p_result ? 'changed' then
    if pg_catalog.jsonb_typeof(p_result->'changed')<>'boolean' then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
    result:=result||pg_catalog.jsonb_build_object('changed',p_result->'changed');
  end if;
  if p_result ? 'sourceEventIds' then
    perform dashboard_private.registration_contact_assert_uuid_array_v1(p_result->'sourceEventIds',50);
    if pg_catalog.jsonb_typeof(p_result->'sourceEventIds')<>'array' or exists(select 1 from pg_catalog.jsonb_array_elements_text(p_result->'sourceEventIds') item(value)
      where item.value !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
      raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
    result:=result||pg_catalog.jsonb_build_object('sourceEventIds',p_result->'sourceEventIds');
  end if;
  if p_result ? 'enrollmentFinalization' then
    finalization:=p_result->'enrollmentFinalization';
    if finalization='null'::jsonb then result:=result||pg_catalog.jsonb_build_object('enrollmentFinalization',null);
    else
      if pg_catalog.jsonb_typeof(finalization)<>'object' or pg_catalog.jsonb_typeof(finalization->'changed')<>'boolean'
        or pg_catalog.jsonb_typeof(finalization->'enrollmentIds')<>'array' then
        raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      foreach key in array array['trackId','studentId','batchId'] loop
        if not (finalization ? key) or (key<>'batchId' and finalization->key='null'::jsonb)
          or finalization->key<>'null'::jsonb and finalization->>key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
          raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      end loop;
      perform dashboard_private.registration_contact_assert_uuid_array_v1(finalization->'enrollmentIds',50);
      if exists(select 1 from pg_catalog.jsonb_array_elements_text(finalization->'enrollmentIds') item(value)
        where item.value !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
        raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      result:=result||pg_catalog.jsonb_build_object('enrollmentFinalization',pg_catalog.jsonb_build_object(
        'trackId',finalization->'trackId','studentId',finalization->'studentId','batchId',finalization->'batchId',
        'changed',finalization->'changed','enrollmentIds',finalization->'enrollmentIds'));
    end if;
  end if;
  if p_result ? 'subjects' then
    if pg_catalog.jsonb_typeof(p_result->'subjects') is distinct from 'array' then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
    if pg_catalog.jsonb_array_length(p_result->'subjects')>3 then raise exception 'registration_contact_response_budget_exceeded' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(p_result->'subjects') subject(value) where value not in ('"영어"'::jsonb,'"수학"'::jsonb,'"과학"'::jsonb)) or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_result->'subjects'))<>(select pg_catalog.count(distinct value) from pg_catalog.jsonb_array_elements(p_result->'subjects')) then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
    select coalesce(pg_catalog.jsonb_agg(value),'[]'::jsonb) into row_item
      from pg_catalog.jsonb_array_elements(p_result->'subjects') subject(value)
      where value in ('"영어"'::jsonb,'"수학"'::jsonb,'"과학"'::jsonb);
    result:=result||pg_catalog.jsonb_build_object('subjects',row_item);
  end if;
  if pg_catalog.jsonb_typeof(p_result->'tracks')='array' then
    if pg_catalog.jsonb_array_length(p_result->'tracks')>50 then raise exception 'registration_contact_response_budget_exceeded' using errcode='23514'; end if;
    for row_item in select value from pg_catalog.jsonb_array_elements(p_result->'tracks') loop
      if pg_catalog.jsonb_typeof(row_item->'id') is distinct from 'string' or row_item->>'id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      select source.* into source_track from public.ops_registration_subject_tracks source
        where source.id=(row_item->>'id')::uuid and source.task_id=p_task_id;
      if not found then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      tracks:=tracks||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id',source_track.id,'taskId',source_track.task_id,'subject',source_track.subject,
        'workflowStatus',source_track.workflow_status,'workflowRevision',source_track.workflow_revision,
        'status',source_track.pipeline_status,'archivedAt',source_track.archived_at,
        'directorProfileId',source_track.director_profile_id,'directorAssignmentSource',source_track.director_assignment_source,
        'directorAssignmentRuleKey',source_track.director_assignment_rule_key,'waitingKind',source_track.waiting_kind,
        'levelTestRetakeDecision',source_track.level_test_retake_decision,'migrationReviewRequired',source_track.migration_review_required,
        'stageEnteredAt',source_track.stage_entered_at));
    end loop;
    result:=result||pg_catalog.jsonb_build_object('tracks',tracks);
  end if;
  return result||pg_catalog.jsonb_build_object('contactState',dashboard_private.registration_case_contact_snapshot_v1(p_task_id,false));
end;
$$;

-- Raw request JSON remains only an ephemeral argument for v1 compatibility.
-- The new persisted value comes from the verified server's full-command HMAC.
create function dashboard_private.registration_contact_fingerprint_v1(p_task_id uuid,p_scope text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare claim dashboard_private.registration_contact_claims_v1%rowtype;
begin
  select source.* into claim from dashboard_private.registration_contact_claims_v1 source
    where source.transaction_id=pg_catalog.txid_current() and source.backend_pid=pg_catalog.pg_backend_pid()
      and source.actor_id=(select auth.uid()) and (source.task_id=p_task_id or source.task_id is null and source.command='create');
  if not found or claim.legacy_replay then
    raise exception 'registration_contact_trusted_command_required' using errcode='42501';
  end if;
  if claim.task_id is null then
    update dashboard_private.registration_contact_claims_v1 source set task_id=p_task_id
      where source.transaction_id=claim.transaction_id and source.backend_pid=claim.backend_pid;
  end if;
  return pg_catalog.jsonb_build_object('contactFingerprintVersion',1,'algorithm','hmac-sha256',
    'requestHmac',claim.request_hmac,'scope',p_scope);
end;
$$;

create function dashboard_private.registration_contact_fingerprint_matches_v1(
  p_stored jsonb,p_legacy_candidate jsonb,p_actor_id uuid,p_task_id uuid,p_scope text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare claim dashboard_private.registration_contact_claims_v1%rowtype;
begin
  if not (p_stored ? 'contactFingerprintVersion') then return p_stored=p_legacy_candidate; end if;
  select source.* into claim from dashboard_private.registration_contact_claims_v1 source
    where source.transaction_id=pg_catalog.txid_current() and source.backend_pid=pg_catalog.pg_backend_pid()
      and source.actor_id=p_actor_id and (source.task_id=p_task_id or source.task_id is null and source.command='create');
  if not found then return false; end if;
  return p_stored=pg_catalog.jsonb_build_object('contactFingerprintVersion',1,'algorithm','hmac-sha256',
    'requestHmac',claim.request_hmac,'scope',p_scope);
end;
$$;

-- Direct authenticated detail writes cannot mint a capability, even on a
-- zero-subject case that has an UPDATE policy. This trigger never takes parent
-- locks after the row lock; the trusted driver must take them beforehand.
create function dashboard_private.guard_registration_contact_detail_write_v1()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare claim dashboard_private.registration_contact_claims_v1%rowtype; protected_change boolean;
  projection dashboard_private.registration_contact_projection_claims_v1%rowtype;
begin
  if tg_op='INSERT' then
    protected_change:=new.parent_phone is not null or new.student_phone is not null
      or new.contact_phase<>'open' or new.contact_generation<>1 or new.contact_revision<>1
      or new.contact_closed_at is not null or new.contact_closure_reason is not null or new.contact_whole_cancel_explicit;
  else
    protected_change:=row(new.task_id,new.parent_phone,new.student_phone,new.contact_phase,new.contact_generation,new.contact_revision,new.contact_closed_at,new.contact_closure_reason,new.contact_whole_cancel_explicit)
      is distinct from row(old.task_id,old.parent_phone,old.student_phone,old.contact_phase,old.contact_generation,old.contact_revision,old.contact_closed_at,old.contact_closure_reason,old.contact_whole_cancel_explicit);
  end if;
  if not protected_change then return new; end if;
  if tg_op='UPDATE' and new.task_id<>old.task_id then
    raise exception 'registration_contact_case_identity_immutable' using errcode='23514'; end if;
  select source.* into claim from dashboard_private.registration_contact_claims_v1 source
    where source.transaction_id=pg_catalog.txid_current() and source.backend_pid=pg_catalog.pg_backend_pid()
      and source.actor_id=(select auth.uid()) and not source.legacy_replay
      and (source.task_id=new.task_id or source.task_id is null and source.command='create');
  if not found then
    -- Parent AFTER-status projection can clear/restart contacts only. Every
    -- business column, case identity and raw value is preserved or set NULL.
    if tg_op='UPDATE' then
      select source.* into projection from dashboard_private.registration_contact_projection_claims_v1 source
        where source.transaction_id=pg_catalog.txid_current() and source.backend_pid=pg_catalog.pg_backend_pid()
          and source.actor_id is not distinct from (select auth.uid()) and source.task_id=old.task_id
          and source.expected_generation=old.contact_generation and source.expected_revision=old.contact_revision;
      if found and not old.contact_whole_cancel_explicit and not new.contact_whole_cancel_explicit
        and new.parent_phone is null and new.student_phone is null
        and new.contact_revision=old.contact_revision+1
        -- The existing alphabetically earlier recipient trigger derives this
        -- fence counter from the phone change. Preserve its exact rule; it is
        -- not an arbitrary allowed business-field edit.
        and new.customer_message_recipient_revision=old.customer_message_recipient_revision+
          (case when pg_catalog.regexp_replace(coalesce(new.parent_phone,''),'[^0-9]','','g')
            is distinct from pg_catalog.regexp_replace(coalesce(old.parent_phone,''),'[^0-9]','','g') then 1 else 0 end)
        and (pg_catalog.to_jsonb(new)-array['parent_phone','student_phone','contact_phase','contact_generation','contact_revision',
          'contact_closed_at','contact_closure_reason','contact_whole_cancel_explicit','customer_message_recipient_revision','updated_at']::text[])
          is not distinct from (pg_catalog.to_jsonb(old)-array['parent_phone','student_phone','contact_phase','contact_generation','contact_revision',
          'contact_closed_at','contact_closure_reason','contact_whole_cancel_explicit','customer_message_recipient_revision','updated_at']::text[])
        and ((projection.direction in ('close','seal') and new.contact_generation=old.contact_generation and new.contact_phase='closed'
          and new.contact_closed_at is not null and new.contact_closure_reason='whole_case_cancelled'
          and exists(select 1 from public.ops_tasks task where task.id=old.task_id and task.type='registration'
            and (projection.direction='close' and task.status='canceled' or projection.direction='seal' and task.status<>'canceled')))
        or (projection.direction='reopen'
          and exists(select 1 from public.ops_tasks task where task.id=old.task_id and task.type='registration' and task.status in ('requested','in_progress'))
          and ((new.contact_generation=old.contact_generation+1 and new.contact_phase='open'
            and new.contact_closed_at is null and new.contact_closure_reason is null)
          or (new.contact_generation=old.contact_generation and new.contact_phase='closed'
            and new.contact_closed_at is not null and new.contact_closure_reason='all_current_tracks_terminal'
            and exists(select 1 from public.ops_registration_subject_tracks track where track.task_id=old.task_id and track.archived_at is null)
            and not exists(select 1 from public.ops_registration_subject_tracks track where track.task_id=old.task_id and track.archived_at is null
              and track.workflow_status not in ('registered','not_registered','inquiry_only')))))) then
        return new;
      end if;
    end if;
    raise exception 'registration_contact_transition_required' using errcode='42501';
  end if;
  if new.student_phone is not null then raise exception 'registration_student_contact_collection_disabled' using errcode='23514'; end if;
  if tg_op='UPDATE' and (old.contact_generation<>claim.expected_generation or old.contact_revision<>claim.expected_revision)
    and not claim.lifecycle_applied then
    raise exception 'registration_contact_revision_conflict' using errcode='23514';
  end if;
  if new.contact_phase='closed' and (new.parent_phone is not null or new.student_phone is not null) then
    raise exception 'registration_contact_closed_write' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger registration_contact_detail_write_v1 before insert or update on public.ops_registration_details
  for each row execute function dashboard_private.guard_registration_contact_detail_write_v1();

-- Only the parentStatus compatibility field is overlaid. Every original
-- pipeline/roster/checklist/subject projection field remains source-derived.
-- Live intent is metadata minted by the authenticated driver, never a GUC.
create function dashboard_private.registration_contact_parent_projection_v1(p_task_id uuid,p_projection jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare detail public.ops_registration_details%rowtype;
  claim dashboard_private.registration_contact_claims_v1%rowtype;
begin
  select source.* into detail from public.ops_registration_details source where source.task_id=p_task_id;
  if not found then return p_projection; end if;
  select source.* into claim from dashboard_private.registration_contact_claims_v1 source
    where source.transaction_id=pg_catalog.txid_current() and source.backend_pid=pg_catalog.pg_backend_pid()
      and source.actor_id=(select auth.uid()) and source.task_id=p_task_id
      and not source.legacy_replay and not source.lifecycle_applied
      and source.expected_generation=detail.contact_generation and source.expected_revision=detail.contact_revision;
  if found and claim.parent_reopen_authorized and claim.command='reopen' then
    -- Reopening restores the existing computed business status, not requested
    -- unconditionally. A canceled raw business projection is rejected by the
    -- explicit reopen command; a manual selector is never a parent reopen.
    return p_projection;
  end if;
  if found and claim.command='close' and claim.close_reason='whole_case_cancelled'
    or detail.contact_whole_cancel_explicit and detail.contact_phase='closed'
      and detail.contact_closure_reason='whole_case_cancelled' then
    return p_projection||pg_catalog.jsonb_build_object('parentStatus','canceled');
  end if;
  return p_projection;
end;
$$;

-- Capture the exact current final legacy projection under a new owner-only
-- name, then wrap the existing two return sites. No historical full definition
-- is recreated and the original public guard/recompute bodies are untouched.
do $registration_contact_parent_projection_patch$
declare target regprocedure:='dashboard_private.derive_registration_parent_projection(uuid)'::regprocedure;
  prior pg_catalog.pg_proc%rowtype; after_proc pg_catalog.pg_proc%rowtype;
  definition text; legacy_definition text; anchor text; replacement text;
begin
  select source.* into prior from pg_catalog.pg_proc source where source.oid=target;
  if pg_catalog.md5(prior.prosrc)<>'9a9f8076e1ef5c2b5c70dcb7e7e1e254'
    or pg_catalog.to_regprocedure('dashboard_private.registration_contact_legacy_parent_projection_v1(uuid)') is not null then
    raise exception 'registration_contact_parent_source_drift' using errcode='55000'; end if;
  definition:=pg_catalog.pg_get_functiondef(target);
  anchor:='CREATE OR REPLACE FUNCTION dashboard_private.derive_registration_parent_projection(';
  if pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,anchor,''))<>pg_catalog.length(anchor) then
    raise exception 'registration_contact_parent_anchor_drift' using errcode='55000'; end if;
  legacy_definition:=pg_catalog.replace(definition,anchor,
    'CREATE OR REPLACE FUNCTION dashboard_private.registration_contact_legacy_parent_projection_v1(');
  execute legacy_definition;
  alter function dashboard_private.registration_contact_legacy_parent_projection_v1(uuid) owner to postgres;
  revoke all on function dashboard_private.registration_contact_legacy_parent_projection_v1(uuid) from public,anon,authenticated,service_role;
  if not exists(select 1 from pg_catalog.pg_proc proc
      where proc.oid='dashboard_private.registration_contact_legacy_parent_projection_v1(uuid)'::regprocedure
        and proc.prosrc=prior.prosrc and proc.proowner=prior.proowner and proc.prosecdef=prior.prosecdef
        and proc.proconfig is not distinct from prior.proconfig and proc.provolatile=prior.provolatile
        and proc.prolang=prior.prolang and proc.prorettype=prior.prorettype
        and not proc.proisstrict and not proc.proleakproof) then
    raise exception 'registration_contact_parent_legacy_copy_drift' using errcode='55000'; end if;
  for anchor,replacement in select * from (values
    ($parent_anchor_1$    return pg_catalog.jsonb_build_object(
      'taskId', p_task_id,$parent_anchor_1$,
     $parent_replace_1$    return dashboard_private.registration_contact_parent_projection_v1(p_task_id,pg_catalog.jsonb_build_object(
      'taskId', p_task_id,$parent_replace_1$),
    ($parent_anchor_2$      'paymentChecked', false
    );$parent_anchor_2$,
     $parent_replace_2$      'paymentChecked', false
    ));$parent_replace_2$),
    ($parent_anchor_3$  return v_projection;$parent_anchor_3$,
     $parent_replace_3$  return dashboard_private.registration_contact_parent_projection_v1(p_task_id,v_projection);$parent_replace_3$)
  ) patches(anchor,replacement) loop
    if pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,anchor,''))<>pg_catalog.length(anchor) then
      raise exception 'registration_contact_parent_anchor_drift' using errcode='55000'; end if;
    definition:=pg_catalog.replace(definition,anchor,replacement);
  end loop;
  execute definition;
  -- The adapter observes live claim writes within the outer command.
  alter function dashboard_private.derive_registration_parent_projection(uuid) volatile;
  select source.* into after_proc from pg_catalog.pg_proc source where source.oid=target;
  if after_proc.oid<>prior.oid or after_proc.proowner<>prior.proowner
    or after_proc.proacl is distinct from prior.proacl or after_proc.proconfig is distinct from prior.proconfig
    or after_proc.prosecdef<>prior.prosecdef or after_proc.prolang<>prior.prolang
    or after_proc.provolatile<>'v' or after_proc.proisstrict<>prior.proisstrict
    or after_proc.proleakproof<>prior.proleakproof or after_proc.prorettype<>prior.prorettype then
    raise exception 'registration_contact_parent_security_attribute_drift' using errcode='55000'; end if;
end $registration_contact_parent_projection_patch$;

-- One outer command advances metadata once. Inquiry's common call cannot close
-- the old subject set before the same atomic command restores/archives subjects.
create function dashboard_private.refresh_registration_contact_case_v1(p_task_id uuid,p_scope text)
returns void language plpgsql volatile security definer set search_path='' as $$
declare claim dashboard_private.registration_contact_claims_v1%rowtype; detail public.ops_registration_details%rowtype;
  snapshot jsonb; next_generation bigint; reason text; reopen_now boolean; close_now boolean; sealed_cancel boolean;
begin
  select source.* into claim from dashboard_private.registration_contact_claims_v1 source
    where source.transaction_id=pg_catalog.txid_current() and source.backend_pid=pg_catalog.pg_backend_pid()
      and source.actor_id=(select auth.uid()) and (source.task_id=p_task_id or source.task_id is null and source.command='create');
  if not found or claim.legacy_replay then raise exception 'registration_contact_trusted_command_required' using errcode='42501'; end if;
  if claim.lifecycle_applied or claim.command='save_inquiry' and p_scope in ('update_common','sync_subjects') then return; end if;
  perform dashboard_private.lock_registration_contact_case_v1(p_task_id);
  select source.* into detail from public.ops_registration_details source where source.task_id=p_task_id;
  snapshot:=dashboard_private.registration_case_contact_snapshot_v1(p_task_id,false);
  next_generation:=detail.contact_generation;
  -- A generic parent repair cannot authorize reuse or remove a cancellation
  -- seal. Only this typed reopen claim or the validated business-reopen hook
  -- can clear it; a terminal manual edit cannot relabel it for a later bypass.
  sealed_cancel:=detail.contact_closure_reason='whole_case_cancelled';
  reopen_now:=claim.before_phase='closed' and (claim.command in ('reopen','set_workflow_status','save_inquiry','unarchive'))
    and not exists(select 1 from public.ops_tasks task where task.id=p_task_id and task.status='canceled')
    and (not coalesce(sealed_cancel,false) or claim.command='reopen' and claim.parent_reopen_authorized)
    and (snapshot->>'allPhasesClosed')::boolean=false and pg_catalog.jsonb_array_length(snapshot->'currentTrackIds')>0;
  close_now:=not reopen_now and ((snapshot->>'allPhasesClosed')::boolean or claim.close_reason is not null
    or coalesce(snapshot->>'closureReason'='last_current_track_excluded',false)
    or coalesce(sealed_cancel,false)
    or exists(select 1 from public.ops_tasks task where task.id=p_task_id and task.status='canceled')
    or pg_catalog.jsonb_array_length(snapshot->'currentTrackIds')=0 and claim.before_current_track_count>0
      and claim.command in ('save_inquiry','archive'));
  -- A terminal subject may reopen while the whole case is already open; that
  -- business transition preserves the current generation and open parent contact.
  if claim.command='reopen' and claim.before_phase='closed' and not reopen_now then
    raise exception 'registration_contact_open_track_required' using errcode='23514'; end if;
  if claim.close_reason='all_current_tracks_terminal' and not (snapshot->>'allPhasesClosed')::boolean then
    raise exception 'registration_contact_case_not_closed' using errcode='23514'; end if;
  if claim.close_reason='last_current_track_excluded' and not (
    pg_catalog.jsonb_array_length(snapshot->'currentTrackIds')=0 and claim.before_current_track_count>0) then
    raise exception 'registration_contact_last_track_transition_required' using errcode='23514'; end if;
  if claim.command<>'create' and detail.contact_revision=9223372036854775807 then
    raise exception 'registration_contact_revision_overflow' using errcode='23514'; end if;
  if reopen_now then
    if next_generation=9223372036854775807 then raise exception 'registration_contact_generation_overflow' using errcode='23514'; end if;
    next_generation:=next_generation+1;
  end if;
  reason:=case when coalesce(sealed_cancel,false) or exists(select 1 from public.ops_tasks task where task.id=p_task_id and task.status='canceled') then 'whole_case_cancelled'
    when claim.close_reason is not null then claim.close_reason
    when (snapshot->>'allPhasesClosed')::boolean then 'all_current_tracks_terminal'
    when close_now then 'last_current_track_excluded' else detail.contact_closure_reason end;
  update public.ops_registration_details source set
    contact_generation=next_generation,
    contact_revision=case when claim.command='create' then source.contact_revision else source.contact_revision+1 end,
    contact_phase=case when reopen_now then 'open' when close_now then 'closed' else source.contact_phase end,
    contact_closed_at=case when reopen_now then null when close_now then coalesce(source.contact_closed_at,pg_catalog.clock_timestamp()) else source.contact_closed_at end,
    contact_closure_reason=case when reopen_now then null when close_now then reason else source.contact_closure_reason end,
    contact_whole_cancel_explicit=case when reopen_now then false
      when claim.command='close' and claim.close_reason='whole_case_cancelled' then true
      else source.contact_whole_cancel_explicit end,
    parent_phone=case when reopen_now or close_now or source.contact_phase='closed' then null else source.parent_phone end,
    student_phone=null
    where source.task_id=p_task_id;
  update dashboard_private.registration_contact_claims_v1 source set lifecycle_applied=true,task_id=p_task_id
    where source.transaction_id=claim.transaction_id and source.backend_pid=claim.backend_pid;
  if close_now or detail.contact_phase='closed' and not reopen_now then
    if pg_catalog.to_regprocedure('dashboard_private.retire_registration_contact_dispatch_v1(uuid,bigint)') is null then
      raise exception 'registration_contact_dispatch_retirement_not_installed' using errcode='55000'; end if;
    execute 'select dashboard_private.retire_registration_contact_dispatch_v1($1,$2)' using p_task_id,next_generation;
  end if;
end;
$$;

-- Direct Data API track edits cannot bypass the driver. No parent lock is
-- acquired from this row trigger; facts-only pipeline/business edits remain valid.
create function dashboard_private.guard_registration_contact_track_write_v1()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare claim dashboard_private.registration_contact_claims_v1%rowtype;
begin
  if tg_op='UPDATE' and row(new.workflow_status,new.archived_at,new.task_id)
    is not distinct from row(old.workflow_status,old.archived_at,old.task_id) then return new; end if;
  select source.* into claim from dashboard_private.registration_contact_claims_v1 source
    where source.transaction_id=pg_catalog.txid_current() and source.backend_pid=pg_catalog.pg_backend_pid()
      and source.actor_id=(select auth.uid()) and not source.legacy_replay
      and (source.task_id=new.task_id or source.task_id is null and source.command='create');
  if not found then raise exception 'registration_contact_transition_required' using errcode='42501'; end if;
  if tg_op='UPDATE' and new.task_id<>old.task_id then
    raise exception 'registration_contact_case_identity_immutable' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger registration_contact_track_write_v1 before insert or update on public.ops_registration_subject_tracks
  for each row execute function dashboard_private.guard_registration_contact_track_write_v1();

-- Whole-case cancellation is a contact transition. Other parent statuses remain
-- manual bookkeeping; this trigger never locks another row from a parent write.
create function dashboard_private.guard_registration_contact_task_cancel_v1()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare claim dashboard_private.registration_contact_claims_v1%rowtype;
  detail public.ops_registration_details%rowtype; projection jsonb;
begin
  if (old.type='registration' or new.type='registration') and new.type is distinct from old.type then
    raise exception 'registration_contact_case_type_immutable' using errcode='23514'; end if;
  if old.type<>'registration' and new.type<>'registration' or (old.status='canceled')=(new.status='canceled') then return new; end if;
  select source.* into claim from dashboard_private.registration_contact_claims_v1 source
    where source.transaction_id=pg_catalog.txid_current() and source.backend_pid=pg_catalog.pg_backend_pid()
      and source.actor_id=(select auth.uid()) and source.task_id=new.id and not source.legacy_replay;
  if found and ((new.status='canceled' and claim.command='close' and claim.close_reason='whole_case_cancelled')
    or (old.status='canceled' and claim.command='reopen' and claim.parent_reopen_authorized)) then return new; end if;
  -- Natural enrollment/admission/withdrawal projections retain their existing
  -- authorization and exact original guard. They are not explicit whole-cancel
  -- overrides and cannot unseal a stored explicit cancellation.
  select source.* into detail from public.ops_registration_details source where source.task_id=new.id;
  if not found or detail.contact_whole_cancel_explicit then
    raise exception 'registration_contact_transition_required' using errcode='42501'; end if;
  projection:=dashboard_private.registration_contact_legacy_parent_projection_v1(new.id);
  if new.status is distinct from projection->>'parentStatus' then
    raise exception 'registration_contact_transition_required' using errcode='42501'; end if;
  return new;
end;
$$;
create trigger registration_contact_task_cancel_v1 before update on public.ops_tasks
  for each row execute function dashboard_private.guard_registration_contact_task_cancel_v1();

-- After the unchanged parent business guard accepts a natural legacy status
-- transition, apply only the corresponding contact lifecycle. Parent is already
-- locked. No track, student, enrollment, settlement, or business field is edited.
create function dashboard_private.reconcile_registration_contact_parent_projection_v1()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare detail public.ops_registration_details%rowtype; projection_direction text; current_count bigint;
  all_closed boolean; typed_resume boolean; open_now boolean;
begin
  if tg_relid<>'public.ops_tasks'::regclass or tg_op<>'UPDATE' then
    raise exception 'registration_contact_projection_trigger_invalid' using errcode='23514'; end if;
  if old.type<>'registration' or new.type<>'registration' or new.status is not distinct from old.status then return null; end if;
  if exists(select 1 from dashboard_private.registration_contact_claims_v1 claim
    where claim.transaction_id=pg_catalog.txid_current() and claim.backend_pid=pg_catalog.pg_backend_pid()
      and claim.actor_id=(select auth.uid()) and claim.task_id=new.id and not claim.legacy_replay) then
    return null; -- The authenticated outer driver applies exactly once.
  end if;
  -- Every accepted cancellation boundary physically seals the current case,
  -- including a historical default-open row repaired out of canceled. A status
  -- correction alone must never reexpose its old raw contact values.
  if new.status<>'canceled' and old.status<>'canceled' then return null; end if;
  select source.* into detail from public.ops_registration_details source where source.task_id=new.id for update;
  if not found then raise exception 'registration_detail_required' using errcode='23514'; end if;
  if detail.contact_whole_cancel_explicit then
    raise exception 'registration_contact_transition_required' using errcode='42501'; end if;
  typed_resume:=new.status in ('requested','in_progress') and exists(
    select 1 from dashboard_private.registration_contact_projection_claims_v1 capability
      where capability.transaction_id=pg_catalog.txid_current() and capability.backend_pid=pg_catalog.pg_backend_pid()
        and capability.task_id=new.id and capability.actor_id is not distinct from (select auth.uid())
        and capability.direction='reopen' and capability.expected_generation=detail.contact_generation
        and capability.expected_revision=detail.contact_revision);
  projection_direction:=case when new.status='canceled' then 'close' when typed_resume then 'reopen' else 'seal' end;
  if projection_direction in ('close','seal') and detail.contact_phase='closed'
    and detail.contact_closure_reason='whole_case_cancelled' and detail.parent_phone is null and detail.student_phone is null then return null; end if;
  open_now:=false;
  if projection_direction='reopen' then
    select pg_catalog.count(*),coalesce(pg_catalog.bool_and(track.workflow_status in ('registered','not_registered','inquiry_only')),false)
      into current_count,all_closed from public.ops_registration_subject_tracks track
      where track.task_id=new.id and track.archived_at is null;
    if current_count=0 then
      projection_direction:='seal';
      update dashboard_private.registration_contact_projection_claims_v1 capability set direction='seal'
        where capability.transaction_id=pg_catalog.txid_current() and capability.backend_pid=pg_catalog.pg_backend_pid()
          and capability.task_id=new.id and capability.actor_id is not distinct from (select auth.uid())
          and capability.direction='reopen' and capability.expected_generation=detail.contact_generation
          and capability.expected_revision=detail.contact_revision;
    else
      open_now:=not all_closed;
    end if;
  end if;
  if open_now and detail.contact_generation=9223372036854775807 then
    raise exception 'registration_contact_generation_overflow' using errcode='23514'; end if;
  if detail.contact_revision=9223372036854775807 then
    raise exception 'registration_contact_revision_overflow' using errcode='23514'; end if;
  if not typed_resume then
    insert into dashboard_private.registration_contact_projection_claims_v1(
      transaction_id,backend_pid,task_id,actor_id,expected_generation,expected_revision,direction)
    values(pg_catalog.txid_current(),pg_catalog.pg_backend_pid(),new.id,(select auth.uid()),detail.contact_generation,detail.contact_revision,projection_direction);
  end if;
  update public.ops_registration_details source set
    contact_phase=case when open_now then 'open' else 'closed' end,
    contact_generation=case when open_now then source.contact_generation+1 else source.contact_generation end,
    contact_revision=source.contact_revision+1,
    contact_closed_at=case when open_now then null else coalesce(source.contact_closed_at,pg_catalog.clock_timestamp()) end,
    contact_closure_reason=case when open_now then null when projection_direction='reopen' then 'all_current_tracks_terminal' else 'whole_case_cancelled' end,
    contact_whole_cancel_explicit=false,parent_phone=null,student_phone=null,updated_at=pg_catalog.now()
    where source.task_id=new.id;
  if not open_now then
    if pg_catalog.to_regprocedure('dashboard_private.retire_registration_contact_dispatch_v1(uuid,bigint)') is null then
      raise exception 'registration_contact_dispatch_retirement_not_installed' using errcode='55000'; end if;
    execute 'select dashboard_private.retire_registration_contact_dispatch_v1($1,$2)' using new.id,detail.contact_generation;
  end if;
  delete from dashboard_private.registration_contact_projection_claims_v1 source
    where source.transaction_id=pg_catalog.txid_current() and source.backend_pid=pg_catalog.pg_backend_pid()
      and source.task_id=new.id and source.actor_id is not distinct from (select auth.uid());
  return null;
end;
$$;
create trigger registration_contact_parent_projection_v1 after update of status on public.ops_tasks
  for each row execute function dashboard_private.reconcile_registration_contact_parent_projection_v1();

-- Typed intent for the existing authenticated business-reopen RPC, after its
-- exact original input/access/replay/source-state validation. This never grants
-- contact access to a generic parent recompute or an unauthenticated actor.
create function dashboard_private.authorize_registration_contact_business_reopen_v1(p_task_id uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
declare detail public.ops_registration_details%rowtype; actor uuid:=(select auth.uid());
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(actor);
  perform dashboard_private.assert_registration_mutation_access(p_task_id,null,'reopen_track');
  select source.* into detail from public.ops_registration_details source where source.task_id=p_task_id for update;
  if not found then raise exception 'registration_detail_required' using errcode='23514'; end if;
  insert into dashboard_private.registration_contact_projection_claims_v1(
    transaction_id,backend_pid,task_id,actor_id,expected_generation,expected_revision,direction)
  values(pg_catalog.txid_current(),pg_catalog.pg_backend_pid(),p_task_id,actor,detail.contact_generation,detail.contact_revision,'reopen');
end;
$$;
create function dashboard_private.clear_registration_contact_business_reopen_v1(p_task_id uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
declare detail public.ops_registration_details%rowtype;
  capability dashboard_private.registration_contact_projection_claims_v1%rowtype;
  current_count bigint; all_closed boolean;
begin
  select source.* into capability from dashboard_private.registration_contact_projection_claims_v1 source
    where source.transaction_id=pg_catalog.txid_current() and source.backend_pid=pg_catalog.pg_backend_pid()
      and source.task_id=p_task_id and source.actor_id is not distinct from (select auth.uid()) and source.direction='reopen';
  if found then
    -- A prior generic repair may already have restored the parent status, so
    -- recompute need not change it. Only this validated actual-reopen callback,
    -- with its still-live exact intent, may finish that sealed contact transition.
    select source.* into detail from public.ops_registration_details source where source.task_id=p_task_id for update;
    if found and detail.contact_closure_reason='whole_case_cancelled' and not detail.contact_whole_cancel_explicit
      and exists(select 1 from public.ops_tasks task where task.id=p_task_id and task.type='registration' and task.status in ('requested','in_progress')) then
      if detail.contact_generation<>capability.expected_generation or detail.contact_revision<>capability.expected_revision then
        raise exception 'registration_contact_revision_conflict' using errcode='23514'; end if;
      select pg_catalog.count(*),coalesce(pg_catalog.bool_and(track.workflow_status in ('registered','not_registered','inquiry_only')),false)
        into current_count,all_closed from public.ops_registration_subject_tracks track
        where track.task_id=p_task_id and track.archived_at is null;
      if current_count>0 then
        if detail.contact_revision=9223372036854775807 then
          raise exception 'registration_contact_revision_overflow' using errcode='23514'; end if;
        if not all_closed and detail.contact_generation=9223372036854775807 then
          raise exception 'registration_contact_generation_overflow' using errcode='23514'; end if;
        update public.ops_registration_details source set
          contact_phase=case when all_closed then 'closed' else 'open' end,
          contact_generation=case when all_closed then source.contact_generation else source.contact_generation+1 end,
          contact_revision=source.contact_revision+1,
          contact_closed_at=case when all_closed then coalesce(source.contact_closed_at,pg_catalog.clock_timestamp()) else null end,
          contact_closure_reason=case when all_closed then 'all_current_tracks_terminal' else null end,
          parent_phone=null,student_phone=null,updated_at=pg_catalog.now()
          where source.task_id=p_task_id;
        if all_closed then
          if pg_catalog.to_regprocedure('dashboard_private.retire_registration_contact_dispatch_v1(uuid,bigint)') is null then
            raise exception 'registration_contact_dispatch_retirement_not_installed' using errcode='55000'; end if;
          execute 'select dashboard_private.retire_registration_contact_dispatch_v1($1,$2)' using p_task_id,detail.contact_generation;
        end if;
      end if;
    end if;
  end if;
  delete from dashboard_private.registration_contact_projection_claims_v1 source
    where source.transaction_id=pg_catalog.txid_current() and source.backend_pid=pg_catalog.pg_backend_pid()
      and source.task_id=p_task_id and source.actor_id is not distinct from (select auth.uid()) and source.direction='reopen';
end;
$$;

-- Existing writer prefixes call this before their original row locks. Taking
-- the full order here makes later detail-first legacy locks reentrant.
create function dashboard_private.prepare_registration_contact_write_v1(p_task_id uuid,p_track_id uuid,p_request_key text)
returns void language plpgsql volatile security definer set search_path='' as $$
declare case_id uuid := p_task_id; actor_id uuid := (select auth.uid());
begin
  if case_id is null and p_track_id is not null then
    select source.task_id into case_id from public.ops_registration_subject_tracks source where source.id=p_track_id;
  end if;
  if actor_id is null or nullif(pg_catalog.btrim(p_request_key),'') is null then
    raise exception 'registration_access_denied' using errcode='42501'; end if;
  if case_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('registration:workflow:'||case_id::text,0));
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||':'||pg_catalog.btrim(p_request_key),0));
  if case_id is not null then perform dashboard_private.lock_registration_contact_case_v1(case_id); end if;
end;
$$;

-- Proposed trusted server entry point. EXECUTE grants are withheld below until
-- the exact SQL/ACL/runtime cutover has separately been approved and verified.
create function public.mutate_registration_contact_v1(
  p_actor_id uuid,p_command text,p_task_id uuid,p_request_key text,
  p_expected_generation bigint,p_expected_revision bigint,p_payload jsonb,p_request_hmac text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  old_claims text := pg_catalog.current_setting('request.jwt.claims',true);
  old_sub text := pg_catalog.current_setting('request.jwt.claim.sub',true);
  old_role text := pg_catalog.current_setting('request.jwt.claim.role',true);
  saved dashboard_private.registration_contact_receipts_v1%rowtype;
  snapshot jsonb; response jsonb; result jsonb; task_id uuid := p_task_id;
  legacy boolean := false; allowed_keys text[]; required_keys text[]; field text;
  expected_generation bigint; expected_revision bigint; parent_phone text;
  expected_subjects text[]; desired_subjects text[]; current_subjects text[];
  source_track public.ops_registration_subject_tracks%rowtype; source_task public.ops_tasks%rowtype;
  planned_all_closed boolean := false; next_status text; changed boolean := false;
  legacy_projection jsonb; inherited_status text; inherited_completed_at timestamptz;
begin
  -- PostgREST ACL plus this server-JWT check, not user-editable metadata.
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'registration_contact_service_caller_required' using errcode='42501'; end if;
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(p_actor_id);
  if p_request_key is null or p_request_key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or p_request_hmac is null or p_request_hmac !~ '^[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object' or pg_catalog.octet_length(p_payload::text)>128000 then
    raise exception 'registration_contact_request_invalid' using errcode='22023'; end if;
  allowed_keys:=case p_command
    when 'create' then array['studentName','schoolGrade','schoolName','parentPhone','campus','inquiryAt','subjects','requestNote','priority']
    when 'update_common' then array['studentName','schoolGrade','schoolName','parentPhone','campus','inquiryAt','requestNote','priority','expectedCommonRevision']
    when 'save_inquiry' then array['studentName','schoolGrade','schoolName','parentPhone','campus','inquiryAt','requestNote','priority','expectedCommonRevision','expectedSubjects','subjects']
    when 'set_workflow_status' then array['trackId','workflowStatus','expectedWorkflowRevision']
    when 'waiting_details' then array['trackId','waitingKind','classId','retakeDecision']
    when 'reopen' then array['trackId','destination','reason']
    when 'close' then array['reason']
    when 'archive' then array['expectedSubjects','subjects']
    when 'unarchive' then array['expectedSubjects','subjects']
    when 'bind_student' then array['studentId'] else null end;
  if allowed_keys is null or p_payload-allowed_keys<>'{}'::jsonb then
    raise exception 'registration_contact_payload_invalid' using errcode='22023'; end if;
  required_keys:=pg_catalog.array_remove(allowed_keys,'parentPhone');
  if not p_payload ?& required_keys then raise exception 'registration_contact_payload_invalid' using errcode='22023'; end if;
  foreach field in array allowed_keys loop
    if not (p_payload ? field) then continue; end if;
    if field in ('subjects','expectedSubjects') then
      if pg_catalog.jsonb_typeof(p_payload->field)<>'array' or pg_catalog.jsonb_array_length(p_payload->field)>3
        or exists(select 1 from pg_catalog.jsonb_array_elements(p_payload->field) item(value)
          where item.value not in ('"영어"'::jsonb,'"수학"'::jsonb,'"과학"'::jsonb))
        or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_payload->field))
          <> (select pg_catalog.count(distinct value) from pg_catalog.jsonb_array_elements(p_payload->field)) then
        raise exception 'registration_contact_payload_invalid' using errcode='22023'; end if;
    elsif field in ('expectedCommonRevision','expectedWorkflowRevision') then
      if pg_catalog.jsonb_typeof(p_payload->field)<>'number' or p_payload->>field !~ '^[1-9][0-9]{0,9}$'
        or (p_payload->>field)::numeric>2147483647 then
        raise exception 'registration_contact_payload_invalid' using errcode='22023'; end if;
    elsif field in ('studentId','trackId','classId') then
      if field='classId' and p_payload->field in ('null'::jsonb,'""'::jsonb) then continue; end if;
      if pg_catalog.jsonb_typeof(p_payload->field)<>'string' or p_payload->>field !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        raise exception 'registration_contact_payload_invalid' using errcode='22023'; end if;
    else
      if field in ('parentPhone','waitingKind','retakeDecision','inquiryAt') and p_payload->field='null'::jsonb then continue; end if;
      if pg_catalog.jsonb_typeof(p_payload->field)<>'string'
        or pg_catalog.length(p_payload->>field)>(case when field='requestNote' then 20000 else 500 end) then
        raise exception 'registration_contact_payload_invalid' using errcode='22023'; end if;
      if field='parentPhone' and (pg_catalog.length(p_payload->>field)>40 or p_payload->>field ~ '[^0-9+() .-]') then
        raise exception 'registration_contact_payload_invalid' using errcode='22023'; end if;
    end if;
  end loop;
  if p_command='create' then
    if p_task_id is not null or p_expected_generation is not null or p_expected_revision is not null then
      raise exception 'registration_contact_create_scope_invalid' using errcode='22023'; end if;
    expected_generation:=1; expected_revision:=1;
  else
    if p_task_id is null or p_expected_generation is null or p_expected_generation<=0
      or p_expected_revision is null or p_expected_revision<=0 then
      raise exception 'registration_contact_scope_invalid' using errcode='22023'; end if;
    expected_generation:=p_expected_generation; expected_revision:=p_expected_revision;
  end if;
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor_id::text,true);
  perform pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
  begin
    perform dashboard_private.prepare_registration_contact_write_v1(p_task_id,null,p_request_key);
    if p_task_id is not null then
      perform dashboard_private.assert_registration_mutation_access(p_task_id,null,'update_common');
    end if;
    select source.* into saved from dashboard_private.registration_contact_receipts_v1 source
      where source.actor_id=p_actor_id and source.request_key=p_request_key;
    if found then
      if saved.command<>p_command or saved.request_hmac<>p_request_hmac or p_task_id is not null and saved.task_id<>p_task_id then
        raise exception 'idempotency_key_reused' using errcode='22023'; end if;
      response:=saved.response_payload||pg_catalog.jsonb_build_object('replayed',true);
      perform dashboard_private.registration_contact_assert_receipt_v1(response,saved.task_id,p_request_key,p_command);
    else
      select exists(select 1 from dashboard_private.ops_registration_mutations source
        where source.actor_id=p_actor_id and source.request_key=p_request_key) into legacy;
      if legacy and p_command not in ('create','update_common','save_inquiry','set_workflow_status','waiting_details') then
        raise exception 'registration_contact_legacy_replay_requires_original_api' using errcode='22023'; end if;
      if p_task_id is not null then
        snapshot:=dashboard_private.registration_case_contact_snapshot_v1(p_task_id,false);
        select source.* into source_task from public.ops_tasks source where source.id=p_task_id;
        if not legacy and (snapshot->>'generation'<>expected_generation::text or snapshot->>'revision'<>expected_revision::text) then
          raise exception 'registration_contact_revision_conflict' using errcode='23514'; end if;
      end if;
      insert into dashboard_private.registration_contact_claims_v1(
        transaction_id,backend_pid,actor_id,request_key,task_id,command,expected_generation,expected_revision,request_hmac,
        before_phase,before_current_track_count,close_reason,legacy_replay)
      values(pg_catalog.txid_current(),pg_catalog.pg_backend_pid(),p_actor_id,p_request_key,p_task_id,p_command,
        expected_generation,expected_revision,p_request_hmac,coalesce(snapshot->>'phase','open'),
        coalesce(pg_catalog.jsonb_array_length(snapshot->'currentTrackIds'),0),
        case when p_command='close' then p_payload->>'reason' else null end,legacy);
      if p_payload ? 'trackId' then
        select source.* into source_track from public.ops_registration_subject_tracks source
          where source.id=(p_payload->>'trackId')::uuid and source.task_id=p_task_id;
        if not found then raise exception 'registration_track_not_found' using errcode='P0002'; end if;
      end if;
      if p_payload ? 'subjects' then
        select coalesce(pg_catalog.array_agg(item.value order by dashboard_private.registration_subject_sort_order(item.value)),array[]::text[])
          into desired_subjects from pg_catalog.jsonb_array_elements_text(p_payload->'subjects') item(value);
      end if;
      if p_payload ? 'expectedSubjects' then
        select coalesce(pg_catalog.array_agg(item.value order by dashboard_private.registration_subject_sort_order(item.value)),array[]::text[])
          into expected_subjects from pg_catalog.jsonb_array_elements_text(p_payload->'expectedSubjects') item(value);
      end if;
      parent_phone:=p_payload->>'parentPhone';
      if not legacy and p_command='update_common' and not (p_payload ? 'parentPhone') and snapshot->>'phase'='open' then
        -- Missing means preserve for a non-contact facts edit. Explicit null
        -- means clear. A closed generation can never read this preservation path.
        select detail.parent_phone into parent_phone from public.ops_registration_details detail where detail.task_id=p_task_id;
      end if;
      if not legacy and p_command='save_inquiry' then
        -- A newly added subject starts in inquiry. Restoring only terminal tracks
        -- remains closed. Never transiently insert an incoming contact then erase it.
        select pg_catalog.cardinality(desired_subjects)>0 and coalesce(pg_catalog.bool_and(
          track.id is not null and track.workflow_status in ('registered','not_registered','inquiry_only')),false)
        into planned_all_closed from pg_catalog.unnest(desired_subjects) subject(value)
          left join public.ops_registration_subject_tracks track on track.task_id=p_task_id and track.subject=subject.value;
        if source_task.status='canceled' or snapshot->>'closureReason'='whole_case_cancelled' or planned_all_closed or pg_catalog.cardinality(desired_subjects)=0 and coalesce(pg_catalog.jsonb_array_length(snapshot->'currentTrackIds'),0)>0 then
          parent_phone:=null;
        end if;
      elsif not legacy and snapshot->>'phase'='closed' then parent_phone:=null;
      end if;
      case p_command
        when 'create' then result:=dashboard_private.create_registration_case_impl(
          p_payload->>'studentName',p_payload->>'schoolGrade',p_payload->>'schoolName',parent_phone,null,
          p_payload->>'campus',nullif(p_payload->>'inquiryAt','')::timestamptz,desired_subjects,p_payload->>'requestNote',p_payload->>'priority',p_request_key);
        when 'update_common' then result:=dashboard_private.update_registration_case_common_impl(
          p_task_id,p_payload->>'studentName',p_payload->>'schoolGrade',p_payload->>'schoolName',parent_phone,null,
          p_payload->>'campus',nullif(p_payload->>'inquiryAt','')::timestamptz,p_payload->>'requestNote',p_payload->>'priority',
          (p_payload->>'expectedCommonRevision')::integer,p_request_key);
        when 'save_inquiry' then result:=dashboard_private.save_registration_case_inquiry_v1_impl(
          p_task_id,p_payload->>'studentName',p_payload->>'schoolGrade',p_payload->>'schoolName',parent_phone,null,
          p_payload->>'campus',nullif(p_payload->>'inquiryAt','')::timestamptz,p_payload->>'requestNote',p_payload->>'priority',
          (p_payload->>'expectedCommonRevision')::integer,expected_subjects,desired_subjects,p_request_key);
        when 'set_workflow_status' then
          -- Owner policy B: manual recording remains independent. A canceled
          -- parent stays canceled/closed with the same generation and marker.
          result:=dashboard_private.set_registration_workflow_status_v1_impl(
            source_track.id,p_payload->>'workflowStatus',(p_payload->>'expectedWorkflowRevision')::integer,p_request_key);
        when 'waiting_details' then result:=dashboard_private.save_registration_waiting_details_v2_impl(
          source_track.id,nullif(p_payload->>'waitingKind',''),nullif(p_payload->>'classId','')::uuid,
          nullif(p_payload->>'retakeDecision',''),p_request_key);
        when 'reopen' then
          if source_track.archived_at is not null or source_task.status<>'canceled' and snapshot->>'closureReason' is distinct from 'whole_case_cancelled'
            and source_track.workflow_status not in ('registered','not_registered','inquiry_only')
            or nullif(pg_catalog.btrim(p_payload->>'reason'),'') is null or p_payload->>'destination' not in ('inquiry','consultation_waiting') then
            raise exception 'registration_contact_reopen_invalid' using errcode='23514'; end if;
          next_status:=case when p_payload->>'destination'='inquiry' then 'inquiry' else 'consultation_requested' end;
          if source_task.status='canceled' or snapshot->>'closureReason'='whole_case_cancelled' then
            legacy_projection:=dashboard_private.registration_contact_legacy_parent_projection_v1(p_task_id);
            inherited_status:=legacy_projection->>'parentStatus';
            if inherited_status not in ('requested','in_progress') then
              raise exception 'registration_contact_business_reopen_required' using errcode='23514'; end if;
            inherited_completed_at:=case when inherited_status='done'
              then coalesce(source_task.completed_at,pg_catalog.now()) else null end;
            update dashboard_private.registration_contact_claims_v1 source set parent_reopen_authorized=true
              where source.transaction_id=pg_catalog.txid_current() and source.backend_pid=pg_catalog.pg_backend_pid()
                and source.actor_id=(select auth.uid()) and source.task_id=p_task_id and not source.legacy_replay;
            update public.ops_tasks source set status=inherited_status,completed_at=inherited_completed_at,
              updated_at=pg_catalog.now() where source.id=p_task_id;
          end if;
          result:=dashboard_private.set_registration_workflow_status_v1_impl(source_track.id,next_status,source_track.workflow_revision,p_request_key);
        when 'close' then
          if p_payload->>'reason' not in ('all_current_tracks_terminal','whole_case_cancelled','last_current_track_excluded') then
            raise exception 'registration_contact_closure_reason_invalid' using errcode='22023'; end if;
          if p_payload->>'reason'='whole_case_cancelled' then
            update public.ops_tasks source set status='canceled',
              completed_at=case when source.status='canceled' and source.completed_at is not null
                then source.completed_at else pg_catalog.now() end,
              updated_at=pg_catalog.now() where source.id=p_task_id;
          end if;
          perform dashboard_private.refresh_registration_contact_case_v1(p_task_id,'close');
          result:=pg_catalog.jsonb_build_object('taskId',p_task_id,'changed',true);
        when 'archive','unarchive' then
          select coalesce(pg_catalog.array_agg(track.subject order by dashboard_private.registration_subject_sort_order(track.subject)),array[]::text[])
            into current_subjects from public.ops_registration_subject_tracks track where track.task_id=p_task_id and track.archived_at is null;
          if current_subjects is distinct from expected_subjects then raise exception 'registration_subjects_conflict' using errcode='23514'; end if;
          if p_command='archive' and not desired_subjects<@current_subjects
            or p_command='unarchive' and not current_subjects<@desired_subjects then
            raise exception 'registration_contact_subject_transition_invalid' using errcode='23514'; end if;
          result:=dashboard_private.sync_registration_case_subjects_impl(p_task_id,desired_subjects,p_request_key);
        when 'bind_student' then
          select source.* into source_task from public.ops_tasks source where source.id=p_task_id;
          if source_task.student_id is not null and source_task.student_id<>(p_payload->>'studentId')::uuid then
            raise exception 'registration_student_binding_immutable' using errcode='23514'; end if;
          perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('registration-student-id:'||(p_payload->>'studentId')::uuid::text,0));
          perform 1 from public.students student where student.id=(p_payload->>'studentId')::uuid for update;
          if not found then raise exception 'registration_student_not_found' using errcode='P0002'; end if;
          changed:=source_task.student_id is null;
          if changed then update public.ops_tasks source set student_id=(p_payload->>'studentId')::uuid,updated_at=pg_catalog.now() where source.id=p_task_id; end if;
          perform dashboard_private.refresh_registration_contact_case_v1(p_task_id,'bind_student');
          result:=pg_catalog.jsonb_build_object('taskId',p_task_id,'studentId',(p_payload->>'studentId')::uuid,'changed',changed);
      end case;
      task_id:=coalesce(p_task_id,(result->>'taskId')::uuid);
      if task_id is null then raise exception 'registration_contact_result_invalid' using errcode='23514'; end if;
      result:=dashboard_private.registration_contact_result_v1(result,task_id);
      response:=pg_catalog.jsonb_build_object('version',1,'taskId',task_id,'requestKey',p_request_key,'command',p_command,'replayed',legacy,'result',result);
      perform dashboard_private.registration_contact_assert_receipt_v1(response,task_id,p_request_key,p_command);
      if not legacy then
        insert into dashboard_private.registration_contact_receipts_v1(actor_id,request_key,task_id,command,request_hmac,response_payload)
          values(p_actor_id,p_request_key,task_id,p_command,p_request_hmac,response);
      end if;
      delete from dashboard_private.registration_contact_claims_v1 source
        where source.transaction_id=pg_catalog.txid_current() and source.backend_pid=pg_catalog.pg_backend_pid();
    end if;
  exception when others then
    perform pg_catalog.set_config('request.jwt.claims',coalesce(old_claims,''),true);
    perform pg_catalog.set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
    perform pg_catalog.set_config('request.jwt.claim.role',coalesce(old_role,''),true);
    raise;
  end;
  perform pg_catalog.set_config('request.jwt.claims',coalesce(old_claims,''),true);
  perform pg_catalog.set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
  perform pg_catalog.set_config('request.jwt.claim.role',coalesce(old_role,''),true);
  return response;
end;
$$;


-- Patch the FINAL source, never recreate an earlier complete implementation.
-- Each anchor appears exactly once; any drift aborts the entire transaction.
-- Preserve the final legacy business-reopen API and every original replay,
-- access, error and roster predicate; mint contact intent only after validation.
do $registration_contact_legacy_business_reopen_patch$
declare target regprocedure:='dashboard_private.reopen_registration_track_impl(uuid,text,text,text)'::regprocedure;
  prior pg_catalog.pg_proc%rowtype; after_proc pg_catalog.pg_proc%rowtype;
  definition text; anchor text; replacement text;
begin
  select source.* into prior from pg_catalog.pg_proc source where source.oid=target;
  if pg_catalog.md5(prior.prosrc)<>'1d6f75da0c146dcfc1c71f45d66ae590' then
    raise exception 'registration_contact_business_reopen_source_drift' using errcode='55000'; end if;
  definition:=pg_catalog.pg_get_functiondef(target);
  for anchor,replacement in select * from (values
    ($business_anchor_1$  -- reopen_track_actor_request_lock$business_anchor_1$,
     $business_replace_1$  perform dashboard_private.prepare_registration_contact_write_v1(null,p_track_id,p_request_key);
  -- reopen_track_actor_request_lock$business_replace_1$),
    ($business_anchor_2$  -- reopen_track_activity_creation$business_anchor_2$,
     $business_replace_2$  perform dashboard_private.authorize_registration_contact_business_reopen_v1(v_task_id);
  -- reopen_track_activity_creation$business_replace_2$),
    ($business_anchor_3$  return v_response;
end;$business_anchor_3$,
     $business_replace_3$  perform dashboard_private.clear_registration_contact_business_reopen_v1(v_task_id);
  return v_response;
end;$business_replace_3$)
  ) patches(anchor,replacement) loop
    if pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,anchor,''))<>pg_catalog.length(anchor) then
      raise exception 'registration_contact_business_reopen_anchor_drift' using errcode='55000'; end if;
    definition:=pg_catalog.replace(definition,anchor,replacement);
  end loop;
  execute definition;
  select source.* into after_proc from pg_catalog.pg_proc source where source.oid=target;
  if after_proc.oid<>prior.oid or after_proc.proowner<>prior.proowner
    or after_proc.proacl is distinct from prior.proacl or after_proc.proconfig is distinct from prior.proconfig
    or after_proc.prosecdef<>prior.prosecdef or after_proc.prolang<>prior.prolang
    or after_proc.provolatile<>prior.provolatile or after_proc.proisstrict<>prior.proisstrict
    or after_proc.proleakproof<>prior.proleakproof or after_proc.prorettype<>prior.prorettype then
    raise exception 'registration_contact_business_reopen_security_attribute_drift' using errcode='55000'; end if;
end $registration_contact_legacy_business_reopen_patch$;

do $registration_contact_patch_final_writers$
declare spec record; target regprocedure; prior pg_catalog.pg_proc%rowtype;
  after_proc pg_catalog.pg_proc%rowtype; definition text; i integer;
begin
  for spec in select * from (values
    -- source-transform create_registration_case_impl
    ('dashboard_private.create_registration_case_impl(text,text,text,text,text,text,timestamptz,text[],text,text,text)',
      array[$contact_anchor_1$begin
$contact_anchor_1$,
        $contact_anchor_2$mutation.target_fingerprint = v_target_fingerprint$contact_anchor_2$,
        $contact_anchor_3$mutation.target_fingerprint = v_legacy_target_fingerprint$contact_anchor_3$,
        $contact_anchor_4$  insert into public.ops_tasks($contact_anchor_4$,
        $contact_anchor_5$    pg_catalog.jsonb_build_object(
      'version', 1,
      'actorId', v_actor_id,
      'commonRevision', 1,
      'studentName', v_student_name,
      'schoolGrade', v_school_grade,
      'schoolName', v_school_name,
      'campus', v_campus,
      'inquiryAt', p_inquiry_at,
      'subjects', pg_catalog.to_jsonb(v_subjects),
      'priority', v_effective_priority,
      'occurredAt', pg_catalog.now()
    )::text$contact_anchor_5$,
        $contact_anchor_6$    'create_case',
    v_target_fingerprint,
    v_response$contact_anchor_6$,
        $contact_anchor_7$  insert into dashboard_private.ops_registration_mutations($contact_anchor_7$],
      array[$contact_replace_1$begin
  perform dashboard_private.prepare_registration_contact_write_v1(null,null,p_request_key);
$contact_replace_1$,
        $contact_replace_2$dashboard_private.registration_contact_fingerprint_matches_v1(mutation.target_fingerprint,v_target_fingerprint,mutation.actor_id,mutation.task_id,'create_case')$contact_replace_2$,
        $contact_replace_3$dashboard_private.registration_contact_fingerprint_matches_v1(mutation.target_fingerprint,v_legacy_target_fingerprint,mutation.actor_id,mutation.task_id,'create_case')$contact_replace_3$,
        $contact_replace_4$  perform dashboard_private.registration_contact_fingerprint_v1(null,'create_case');
  insert into public.ops_tasks($contact_replace_4$,
        $contact_replace_5$    pg_catalog.jsonb_build_object('version',2,'representation','contact_metadata_only','actorId',v_actor_id,
      'commonRevision',1,'parentContactPresent',v_parent_phone is not null,'studentContactPresent',false,
      'requestNotePresent',v_request_note is not null,'subjects',pg_catalog.to_jsonb(v_subjects),'occurredAt',pg_catalog.now())::text$contact_replace_5$,
        $contact_replace_6$    'create_case',
    dashboard_private.registration_contact_fingerprint_v1(v_task_id,'create_case'),
    v_response$contact_replace_6$,
        $contact_replace_7$  perform dashboard_private.refresh_registration_contact_case_v1(v_task_id,'create_case');
  v_response := dashboard_private.registration_contact_result_v1(v_response,v_task_id);
  insert into dashboard_private.ops_registration_mutations($contact_replace_7$]),
    -- source-transform update_registration_case_common_impl
    ('dashboard_private.update_registration_case_common_impl(uuid,text,text,text,text,text,text,timestamptz,text,text,integer,text)',
      array[$contact_anchor_8$begin
$contact_anchor_8$,
        $contact_anchor_9$mutation.target_fingerprint = v_target_fingerprint$contact_anchor_9$,
        $contact_anchor_10$  if v_detail.common_revision <> p_expected_common_revision then$contact_anchor_10$,
        $contact_anchor_11$    pg_catalog.jsonb_build_object(
      'commonRevision', v_detail.common_revision,
      'studentName', v_task.student_name,
      'schoolGrade', v_detail.school_grade,
      'schoolName', v_detail.school_name,
      'parentPhone', v_detail.parent_phone,
      'studentPhone', v_detail.student_phone,
      'campus', v_task.campus,
      'inquiryAt', v_detail.inquiry_at,
      'requestNote', v_detail.request_note,
      'priority', v_task.priority
    )::text$contact_anchor_11$,
        $contact_anchor_12$    pg_catalog.jsonb_build_object(
      'version', 1,
      'commonRevision', v_next_revision,
      'studentName', v_student_name,
      'schoolGrade', v_school_grade,
      'schoolName', v_school_name,
      'parentPhone', v_parent_phone,
      'studentPhone', v_student_phone,
      'campus', v_effective_campus,
      'inquiryAt', p_inquiry_at,
      'requestNote', v_request_note,
      'priority', v_effective_priority,
      'occurredAt', pg_catalog.now()
    )::text$contact_anchor_12$,
        $contact_anchor_13$    'update_common',
    v_target_fingerprint,
    v_response$contact_anchor_13$,
        $contact_anchor_14$  insert into dashboard_private.ops_registration_mutations($contact_anchor_14$],
      array[$contact_replace_8$begin
  perform dashboard_private.prepare_registration_contact_write_v1(p_task_id,null,p_request_key);
$contact_replace_8$,
        $contact_replace_9$dashboard_private.registration_contact_fingerprint_matches_v1(mutation.target_fingerprint,v_target_fingerprint,mutation.actor_id,mutation.task_id,'update_common')$contact_replace_9$,
        $contact_replace_10$  perform dashboard_private.registration_contact_fingerprint_v1(p_task_id,'update_common');
  if v_detail.common_revision <> p_expected_common_revision then$contact_replace_10$,
        $contact_replace_11$    pg_catalog.jsonb_build_object('version',2,'representation','contact_metadata_only',
      'commonRevision',v_detail.common_revision,'parentContactPresent',v_detail.parent_phone is not null,
      'studentContactPresent',v_detail.student_phone is not null,'requestNotePresent',v_detail.request_note is not null)::text$contact_replace_11$,
        $contact_replace_12$    pg_catalog.jsonb_build_object('version',2,'representation','contact_metadata_only',
      'commonRevision',v_next_revision,'parentContactPresent',v_parent_phone is not null,'studentContactPresent',false,
      'parentContactChanged',v_detail.parent_phone is distinct from v_parent_phone,
      'studentContactChanged',v_detail.student_phone is not null,'requestNotePresent',v_request_note is not null,
      'requestNoteChanged',v_detail.request_note is distinct from v_request_note,'occurredAt',pg_catalog.now())::text$contact_replace_12$,
        $contact_replace_13$    'update_common',
    dashboard_private.registration_contact_fingerprint_v1(p_task_id,'update_common'),
    v_response$contact_replace_13$,
        $contact_replace_14$  perform dashboard_private.refresh_registration_contact_case_v1(p_task_id,'update_common');
  v_response := dashboard_private.registration_contact_result_v1(v_response,p_task_id);
  insert into dashboard_private.ops_registration_mutations($contact_replace_14$]),
    -- source-transform save_registration_case_inquiry_v1_impl
    ('dashboard_private.save_registration_case_inquiry_v1_impl(uuid,text,text,text,text,text,text,timestamptz,text,text,integer,text[],text[],text)',
      array[$contact_anchor_15$begin
$contact_anchor_15$,
        $contact_anchor_16$mutation.target_fingerprint = v_target_fingerprint$contact_anchor_16$,
        $contact_anchor_17$  if v_receipt_found then
    v_response := v_response || pg_catalog.jsonb_build_object(
      'notificationJobs',
      '[]'::jsonb
    );
    update dashboard_private.ops_registration_mutations mutation
    set response_payload = v_response
    where mutation.actor_id = v_actor_id
      and mutation.request_key = v_request_key
      and mutation.task_id = p_task_id
      and mutation.mutation_type = 'save_inquiry';
    if not found then
      raise exception 'registration_inquiry_receipt_missing' using errcode = '23514';
    end if;
    return v_response;
  end if;
$contact_anchor_17$,
        $contact_anchor_18$  select coalesce(
    pg_catalog.array_agg(
      track.subject$contact_anchor_18$,
        $contact_anchor_19$  v_common_response :=
    dashboard_private.update_registration_case_common_with_reminders_v1_impl(
      p_task_id,
      p_student_name,
      p_school_grade,
      p_school_name,
      p_parent_phone,
      p_student_phone,
      p_campus,
      p_inquiry_at,
      p_request_note,
      p_priority,
      p_expected_common_revision,
      v_common_request_key
    );

  v_subject_response := dashboard_private.sync_registration_case_subjects_impl(
    p_task_id,
    v_subjects,
    v_subject_request_key
  );

$contact_anchor_19$,
        $contact_anchor_20$    'save_inquiry',
    v_target_fingerprint,
    v_response$contact_anchor_20$,
        $contact_anchor_21$  insert into dashboard_private.ops_registration_mutations($contact_anchor_21$],
      array[$contact_replace_15$begin
  perform dashboard_private.prepare_registration_contact_write_v1(p_task_id,null,p_request_key);
$contact_replace_15$,
        $contact_replace_16$dashboard_private.registration_contact_fingerprint_matches_v1(mutation.target_fingerprint,v_target_fingerprint,mutation.actor_id,mutation.task_id,'save_inquiry')$contact_replace_16$,
        $contact_replace_17$  if v_receipt_found then
    return dashboard_private.registration_contact_result_v1(v_response,p_task_id);
  end if;
$contact_replace_17$,
        $contact_replace_18$  perform dashboard_private.registration_contact_fingerprint_v1(p_task_id,'save_inquiry');
  select coalesce(
    pg_catalog.array_agg(
      track.subject$contact_replace_18$,
        $contact_replace_19$  v_subject_response := dashboard_private.sync_registration_case_subjects_impl(
    p_task_id,
    v_subjects,
    v_subject_request_key
  );

  -- Establish the new generation and clear old contact BEFORE accepting fresh common facts.
  perform dashboard_private.refresh_registration_contact_case_v1(p_task_id,'save_inquiry');

  v_common_response :=
    dashboard_private.update_registration_case_common_with_reminders_v1_impl(
      p_task_id,
      p_student_name,
      p_school_grade,
      p_school_name,
      p_parent_phone,
      p_student_phone,
      p_campus,
      p_inquiry_at,
      p_request_note,
      p_priority,
      p_expected_common_revision,
      v_common_request_key
    );

$contact_replace_19$,
        $contact_replace_20$    'save_inquiry',
    dashboard_private.registration_contact_fingerprint_v1(p_task_id,'save_inquiry'),
    v_response$contact_replace_20$,
        $contact_replace_21$  perform dashboard_private.refresh_registration_contact_case_v1(p_task_id,'save_inquiry');
  v_response := dashboard_private.registration_contact_result_v1(v_response,p_task_id);
  insert into dashboard_private.ops_registration_mutations($contact_replace_21$]),
    -- source-transform set_registration_workflow_status_v1_impl
    ('dashboard_private.set_registration_workflow_status_v1_impl(uuid,text,integer,text)',
      array[$contact_anchor_22$begin
$contact_anchor_22$,
        $contact_anchor_23$mutation.target_fingerprint = v_target_fingerprint$contact_anchor_23$,
        $contact_anchor_24$  if v_receipt_found then
    v_response := v_response || pg_catalog.jsonb_build_object(
      'enrollmentFinalization',
      null
    );
    update dashboard_private.ops_registration_mutations mutation
    set response_payload = v_response
    where mutation.actor_id = v_actor_id
      and mutation.request_key = v_request_key
      and mutation.task_id = v_track.task_id
      and mutation.mutation_type = 'set_workflow_status';
    if not found then
      raise exception 'registration_workflow_receipt_missing' using errcode = '23514';
    end if;
    return v_response;
  end if;
$contact_anchor_24$,
        $contact_anchor_25$  if v_track.workflow_revision <> p_expected_workflow_revision then$contact_anchor_25$,
        $contact_anchor_26$    'set_workflow_status',
    v_target_fingerprint,
    v_response$contact_anchor_26$,
        $contact_anchor_27$  insert into dashboard_private.ops_registration_mutations($contact_anchor_27$],
      array[$contact_replace_22$begin
  perform dashboard_private.prepare_registration_contact_write_v1(null,p_track_id,p_request_key);
$contact_replace_22$,
        $contact_replace_23$dashboard_private.registration_contact_fingerprint_matches_v1(mutation.target_fingerprint,v_target_fingerprint,mutation.actor_id,mutation.task_id,'set_workflow_status')$contact_replace_23$,
        $contact_replace_24$  if v_receipt_found then
    return dashboard_private.registration_contact_result_v1(v_response,v_track.task_id);
  end if;
$contact_replace_24$,
        $contact_replace_25$  perform dashboard_private.registration_contact_fingerprint_v1(v_track.task_id,'set_workflow_status');
  if v_track.workflow_revision <> p_expected_workflow_revision then$contact_replace_25$,
        $contact_replace_26$    'set_workflow_status',
    dashboard_private.registration_contact_fingerprint_v1(v_track.task_id,'set_workflow_status'),
    v_response$contact_replace_26$,
        $contact_replace_27$  perform dashboard_private.refresh_registration_contact_case_v1(v_track.task_id,'set_workflow_status');
  v_response := dashboard_private.registration_contact_result_v1(v_response,v_track.task_id);
  insert into dashboard_private.ops_registration_mutations($contact_replace_27$]),
    -- source-transform save_registration_waiting_details_v2_impl
    ('dashboard_private.save_registration_waiting_details_v2_impl(uuid,text,uuid,text,text)',
      array[$contact_anchor_28$begin
$contact_anchor_28$,
        $contact_anchor_29$v_saved_fingerprint is distinct from v_fingerprint$contact_anchor_29$,
        $contact_anchor_30$  update public.ops_registration_subject_tracks track$contact_anchor_30$,
        $contact_anchor_31$    'save_registration_waiting_details_v2',
    v_fingerprint,
    v_response$contact_anchor_31$,
        $contact_anchor_32$  insert into dashboard_private.ops_registration_mutations($contact_anchor_32$],
      array[$contact_replace_28$begin
  perform dashboard_private.prepare_registration_contact_write_v1(null,p_track_id,p_request_key);
$contact_replace_28$,
        $contact_replace_29$not dashboard_private.registration_contact_fingerprint_matches_v1(v_saved_fingerprint,v_fingerprint,v_actor_id,v_track.task_id,'save_registration_waiting_details_v2')$contact_replace_29$,
        $contact_replace_30$  perform dashboard_private.registration_contact_fingerprint_v1(v_track.task_id,'save_registration_waiting_details_v2');
  update public.ops_registration_subject_tracks track$contact_replace_30$,
        $contact_replace_31$    'save_registration_waiting_details_v2',
    dashboard_private.registration_contact_fingerprint_v1(v_track.task_id,'save_registration_waiting_details_v2'),
    v_response$contact_replace_31$,
        $contact_replace_32$  perform dashboard_private.refresh_registration_contact_case_v1(v_track.task_id,'save_registration_waiting_details_v2');
  v_response := dashboard_private.registration_contact_result_v1(v_response,v_track.task_id);
  insert into dashboard_private.ops_registration_mutations($contact_replace_32$]),
    -- source-transform sync_registration_case_subjects_impl
    ('dashboard_private.sync_registration_case_subjects_impl(uuid,text[],text)',
      array[$contact_anchor_33$begin
$contact_anchor_33$,
        $contact_anchor_34$mutation.target_fingerprint = v_target_fingerprint$contact_anchor_34$,
        $contact_anchor_35$mutation.target_fingerprint = v_legacy_target_fingerprint$contact_anchor_35$,
        $contact_anchor_36$  select coalesce(
    pg_catalog.array_agg(
      track.subject$contact_anchor_36$,
        $contact_anchor_37$    'sync_subjects',
    v_target_fingerprint,
    v_response$contact_anchor_37$,
        $contact_anchor_38$  insert into dashboard_private.ops_registration_mutations($contact_anchor_38$],
      array[$contact_replace_33$begin
  perform dashboard_private.prepare_registration_contact_write_v1(p_task_id,null,p_request_key);
$contact_replace_33$,
        $contact_replace_34$dashboard_private.registration_contact_fingerprint_matches_v1(mutation.target_fingerprint,v_target_fingerprint,mutation.actor_id,mutation.task_id,'sync_subjects')$contact_replace_34$,
        $contact_replace_35$dashboard_private.registration_contact_fingerprint_matches_v1(mutation.target_fingerprint,v_legacy_target_fingerprint,mutation.actor_id,mutation.task_id,'sync_subjects')$contact_replace_35$,
        $contact_replace_36$  perform dashboard_private.registration_contact_fingerprint_v1(p_task_id,'sync_subjects');
  select coalesce(
    pg_catalog.array_agg(
      track.subject$contact_replace_36$,
        $contact_replace_37$    'sync_subjects',
    dashboard_private.registration_contact_fingerprint_v1(p_task_id,'sync_subjects'),
    v_response$contact_replace_37$,
        $contact_replace_38$  perform dashboard_private.refresh_registration_contact_case_v1(p_task_id,'sync_subjects');
  v_response := dashboard_private.registration_contact_result_v1(v_response,p_task_id);
  insert into dashboard_private.ops_registration_mutations($contact_replace_38$]),
    -- source-transform update_registration_case_common_with_reminders_v1_impl
    ('dashboard_private.update_registration_case_common_with_reminders_v1_impl(uuid,text,text,text,text,text,text,timestamptz,text,text,integer,text)',
      array[$contact_anchor_39$  update dashboard_private.ops_registration_mutations mutation
  set response_payload = v_response
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key
    and mutation.task_id = p_task_id
    and mutation.mutation_type = 'update_common';
  if not found then
    raise exception 'registration_common_receipt_missing' using errcode = '23514';
  end if;
$contact_anchor_39$],
      array[$contact_replace_39$  -- Legacy/new receipts are never rewritten on replay.
$contact_replace_39$])
  ) patches(signature,anchors,replacements) loop
    target:=pg_catalog.to_regprocedure(spec.signature);
    select source.* into prior from pg_catalog.pg_proc source where source.oid=target;
    definition:=pg_catalog.pg_get_functiondef(target);
    for i in 1..pg_catalog.cardinality(spec.anchors) loop
      if pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,spec.anchors[i],''))
        <>pg_catalog.length(spec.anchors[i]) then
        raise exception 'registration_contact_writer_anchor_drift' using errcode='55000'; end if;
      definition:=pg_catalog.replace(definition,spec.anchors[i],spec.replacements[i]);
    end loop;
    execute definition;
    select source.* into after_proc from pg_catalog.pg_proc source where source.oid=target;
    if after_proc.oid<>prior.oid or after_proc.proowner<>prior.proowner
      or after_proc.proacl is distinct from prior.proacl or after_proc.proconfig is distinct from prior.proconfig
      or after_proc.prosecdef<>prior.prosecdef or after_proc.prolang<>prior.prolang
      or after_proc.provolatile<>prior.provolatile or after_proc.proisstrict<>prior.proisstrict
      or after_proc.proleakproof<>prior.proleakproof or after_proc.prorettype<>prior.prorettype then
      raise exception 'registration_contact_writer_security_attribute_drift' using errcode='55000'; end if;
  end loop;
end $registration_contact_patch_final_writers$;

-- Owner-only helper/driver implementation. Private schema membership alone
-- must never grant the ability to mint claims or invoke arbitrary fresh writes.
do $registration_contact_helper_acl$
declare item record;
begin
  for item in select proc.oid::regprocedure signature from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace namespace on namespace.oid=proc.pronamespace
    where namespace.nspname='dashboard_private' and proc.proname in (
      'lock_registration_contact_case_v1','prepare_registration_contact_write_v1','registration_case_contact_snapshot_v1',
      'assert_registration_contact_open_v1','registration_contact_assert_bounded_json_v1','registration_contact_assert_uuid_array_v1',
      'registration_contact_assert_receipt_v1','registration_contact_result_v1','registration_contact_fingerprint_v1',
      'registration_contact_fingerprint_matches_v1','guard_registration_contact_detail_write_v1',
      'guard_registration_contact_track_write_v1','guard_registration_contact_task_cancel_v1','refresh_registration_contact_case_v1',
      'registration_contact_parent_projection_v1','registration_contact_legacy_parent_projection_v1',
      'reconcile_registration_contact_parent_projection_v1','authorize_registration_contact_business_reopen_v1',
      'clear_registration_contact_business_reopen_v1') loop
    execute pg_catalog.format('alter function %s owner to postgres',item.signature);
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role',item.signature);
  end loop;
end $registration_contact_helper_acl$;
alter function public.get_registration_case_contact_v1(uuid,integer) owner to postgres;
alter function public.mutate_registration_contact_v1(uuid,text,uuid,text,bigint,bigint,jsonb,text) owner to postgres;
revoke all on function public.get_registration_case_contact_v1(uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.mutate_registration_contact_v1(uuid,text,uuid,text,bigint,bigint,jsonb,text) from public,anon,authenticated,service_role;
-- WITHHELD: separately reviewed cutover ACL after exact source/runtime verification:
-- grant execute on function public.get_registration_case_contact_v1(uuid,integer) to authenticated;
-- grant execute on function public.mutate_registration_contact_v1(uuid,text,uuid,text,bigint,bigint,jsonb,text) to service_role;
-- Never grant the mutation RPC to authenticated/anon/PUBLIC. Browser HMAC is not authority.
commit;
