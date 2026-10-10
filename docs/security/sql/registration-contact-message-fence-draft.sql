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

-- Every successful bundle constituent is current, scoped and purpose eligible.
-- Bundles do not enable visit/admission/waiting purposes. The existing
-- task-scoped admission_application is guarded separately below.
create function dashboard_private.assert_registration_contact_bundle_candidate_v1(p_task_id uuid,p_reservation_kind text,p_delivery_kind text,p_service_date date,p_now timestamptz,p_items jsonb)
returns void language plpgsql volatile security definer set search_path='' as $$
declare item jsonb; appointment_ids uuid[]; activity_ids uuid[]; observation_ids uuid[]; state jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
  if p_reservation_kind not in ('level_test','observation') or p_reservation_kind is null
    or p_delivery_kind not in ('booking','reminder') or p_delivery_kind is null or p_now is null then
    raise exception 'registration_contact_use_not_allowed' using errcode='23514'; end if;
  state:=dashboard_private.registration_case_contact_snapshot_v1(p_task_id,false);
  perform dashboard_private.assert_registration_contact_open_v1(p_task_id,state->>'generation');
  perform dashboard_private.registration_contact_assert_bounded_json_v1(p_items);
  if pg_catalog.jsonb_typeof(p_items) is distinct from 'array' then raise exception 'registration_customer_message_bundle_source_ineligible' using errcode='23514'; end if;
  if pg_catalog.jsonb_array_length(p_items)<1 or pg_catalog.jsonb_array_length(p_items)>3 then
    raise exception 'registration_customer_message_bundle_source_ineligible' using errcode='23514'; end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_items) loop
    if pg_catalog.jsonb_typeof(item) is distinct from 'object' or item-array['sourceKind','sourceId','sourceRevision','trackId','activityId','subject','scheduledAt','serviceDate','place','className','teacherName','sourceFactHash']::text[]<>'{}'::jsonb
      or not item ?& array['sourceKind','sourceId','sourceRevision','trackId','activityId','subject','scheduledAt','serviceDate','place','className','teacherName','sourceFactHash']::text[]
      or item->>'sourceKind' is distinct from p_reservation_kind
      or pg_catalog.jsonb_typeof(item->'sourceId') is distinct from 'string' or item->>'sourceId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or pg_catalog.jsonb_typeof(item->'trackId') is distinct from 'string' or item->>'trackId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or pg_catalog.jsonb_typeof(item->'sourceFactHash') is distinct from 'string' or item->>'sourceFactHash' !~ '^[a-f0-9]{64}$'
      or pg_catalog.jsonb_typeof(item->'subject') is distinct from 'string' or item->>'subject' not in ('영어','수학','과학')
      or pg_catalog.jsonb_typeof(item->'scheduledAt') is distinct from 'string' or pg_catalog.length(item->>'scheduledAt')>64
      or pg_catalog.jsonb_typeof(item->'serviceDate') is distinct from 'string' or item->>'serviceDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or item->>'place' not in ('본관','별관') or pg_catalog.jsonb_typeof(item->'place') is distinct from 'string'
      or pg_catalog.jsonb_typeof(item->'sourceRevision') is distinct from 'object' then
      raise exception 'registration_customer_message_bundle_source_ineligible' using errcode='23514'; end if;
    if p_reservation_kind='level_test' then
      if pg_catalog.jsonb_typeof(item->'activityId') is distinct from 'string' or item->>'activityId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        or item->'className' is distinct from 'null'::jsonb or item->'teacherName' is distinct from 'null'::jsonb then
        raise exception 'registration_customer_message_bundle_source_ineligible' using errcode='23514'; end if;
    elsif item->'activityId' is distinct from 'null'::jsonb or pg_catalog.jsonb_typeof(item->'className') is distinct from 'string'
      or pg_catalog.jsonb_typeof(item->'teacherName') is distinct from 'string' then
      raise exception 'registration_customer_message_bundle_source_ineligible' using errcode='23514'; end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_items))<>(select pg_catalog.count(distinct value->>'subject') from pg_catalog.jsonb_array_elements(p_items))
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_items))<>(select pg_catalog.count(distinct (value->>'trackId')::uuid) from pg_catalog.jsonb_array_elements(p_items))
    -- One appointment may serve multiple subject tracks. Identity is the
    -- source kind/source UUID/track UUID tuple, not source UUID alone.
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_items))<>(select pg_catalog.count(distinct (value->>'sourceKind',(value->>'sourceId')::uuid,(value->>'trackId')::uuid)) from pg_catalog.jsonb_array_elements(p_items)) then
    raise exception 'registration_customer_message_bundle_source_ambiguous' using errcode='23514'; end if;
  -- Case/ordered tracks/detail are already locked above. Lock actual source rows
  -- before rechecking facts; never introduce a queue/message/bundle-first lock.
  select pg_catalog.array_agg(distinct (value->>'sourceId')::uuid order by (value->>'sourceId')::uuid)
    into observation_ids from pg_catalog.jsonb_array_elements(p_items) where p_reservation_kind='observation';
  select pg_catalog.array_agg(distinct source.id order by source.id) into appointment_ids from public.ops_registration_appointments source
    where source.task_id=p_task_id and (p_reservation_kind='level_test' and source.id in(select (value->>'sourceId')::uuid from pg_catalog.jsonb_array_elements(p_items))
      or p_reservation_kind='observation' and source.id in(select observation.appointment_id from public.ops_registration_observations observation where observation.id=any(observation_ids) and observation.task_id=p_task_id));
  perform 1 from public.ops_registration_appointments source where source.id=any(appointment_ids) and source.task_id=p_task_id order by source.id for share;
  select pg_catalog.array_agg(distinct (value->>'activityId')::uuid order by (value->>'activityId')::uuid)
    into activity_ids from pg_catalog.jsonb_array_elements(p_items) where p_reservation_kind='level_test';
  perform 1 from public.ops_registration_level_tests source where source.id=any(activity_ids) order by source.id for share;
  perform 1 from public.ops_registration_observations source where source.id=any(observation_ids) and source.task_id=p_task_id order by source.id for share;
  for item in select value from pg_catalog.jsonb_array_elements(p_items) loop
    if not exists(select 1 from public.ops_registration_subject_tracks track
      where track.id=(item->>'trackId')::uuid and track.task_id=p_task_id and track.archived_at is null and track.subject=item->>'subject'
        and (p_reservation_kind='level_test' and track.workflow_status not in ('registered','not_registered','inquiry_only')
          or p_reservation_kind='observation' and track.workflow_status='observation_requested')) then
      raise exception 'registration_customer_message_bundle_source_ineligible' using errcode='23514'; end if;
    if p_reservation_kind='level_test' and not exists(select 1 from public.ops_registration_appointments appointment
      join public.ops_registration_level_tests level_test on level_test.appointment_id=appointment.id and level_test.track_id=(item->>'trackId')::uuid
      where appointment.id=(item->>'sourceId')::uuid and appointment.task_id=p_task_id and appointment.kind='level_test' and appointment.status='scheduled'
        and level_test.id=(item->>'activityId')::uuid and level_test.status='scheduled' and appointment.scheduled_at>p_now
        and appointment.scheduled_at=(item->>'scheduledAt')::timestamptz and appointment.place=item->>'place'
        and (appointment.scheduled_at at time zone 'Asia/Seoul')::date=(item->>'serviceDate')::date
        and item->'sourceRevision'=pg_catalog.jsonb_build_object('appointmentNotificationRevision',appointment.notification_revision)) then
      raise exception 'registration_customer_message_bundle_source_ineligible' using errcode='23514'; end if;
    if p_reservation_kind='observation' and not exists(select 1 from public.ops_registration_observations observation
      join public.ops_registration_appointments appointment on appointment.id=observation.appointment_id and appointment.task_id=observation.task_id
      where observation.id=(item->>'sourceId')::uuid and observation.task_id=p_task_id and observation.track_id=(item->>'trackId')::uuid
        and observation.appointment_id=any(appointment_ids)
        and observation.status='scheduled' and appointment.kind='observation_class' and appointment.status='scheduled'
        and observation.subject=item->>'subject' and observation.starts_at>p_now and observation.starts_at=(item->>'scheduledAt')::timestamptz
        and observation.session_date=(item->>'serviceDate')::date and observation.campus=item->>'place'
        and observation.class_name_snapshot=item->>'className' and observation.teacher_name_snapshot=item->>'teacherName'
        and item->'sourceRevision'=pg_catalog.jsonb_build_object('appointmentNotificationRevision',appointment.notification_revision,
          'observationRevision',observation.revision,'bookingFactHash',observation.booking_fact_hash)) then
      raise exception 'registration_customer_message_bundle_source_ineligible' using errcode='23514'; end if;
    if p_delivery_kind='reminder' and (p_service_date is null or (item->>'serviceDate')::date<>p_service_date) then
      raise exception 'registration_customer_message_bundle_source_ineligible' using errcode='23514'; end if;
  end loop;
end $$;
revoke all on function dashboard_private.assert_registration_contact_bundle_candidate_v1(uuid,text,text,date,timestamptz,jsonb) from public,anon,authenticated,service_role;

create function dashboard_private.assert_registration_contact_stored_bundle_v1(p_bundle_id uuid,p_task_id uuid,p_reservation_kind text,p_delivery_kind text,p_service_date date,p_now timestamptz)
returns void language plpgsql volatile security definer set search_path='' as $$
declare bundle dashboard_private.registration_customer_message_bundles%rowtype; items jsonb; current_items jsonb; state jsonb; recipient_revision bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
  state:=dashboard_private.registration_case_contact_snapshot_v1(p_task_id,false);
  perform dashboard_private.assert_registration_contact_open_v1(p_task_id,state->>'generation');
  select source.* into bundle from dashboard_private.registration_customer_message_bundles source where source.id=p_bundle_id;
  if not found then raise exception 'registration_customer_message_bundle_not_found' using errcode='P0002'; end if;
  if bundle.task_id is distinct from p_task_id or bundle.reservation_kind is distinct from p_reservation_kind or bundle.delivery_kind is distinct from p_delivery_kind
    or bundle.service_date is distinct from p_service_date or bundle.contact_generation::text is distinct from state->>'generation' then
    raise exception 'registration_customer_message_bundle_scope_changed' using errcode='23514'; end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('sourceKind',item.source_kind,'sourceId',item.source_id,'sourceRevision',item.source_revision,
    'trackId',item.track_id,'activityId',item.activity_id,'subject',item.subject,'scheduledAt',item.scheduled_at,'serviceDate',item.service_date,'place',item.place,
    'className',item.class_name,'teacherName',item.teacher_name,'sourceFactHash',item.source_fact_hash) order by item.sort_order)
    into items from (select source.* from dashboard_private.registration_customer_message_bundle_items source where source.bundle_id=p_bundle_id order by source.sort_order limit 4) item;
  perform dashboard_private.assert_registration_contact_bundle_candidate_v1(p_task_id,p_reservation_kind,p_delivery_kind,p_service_date,p_now,items);
  current_items:=dashboard_private.collect_registration_customer_message_bundle_items_v1(p_task_id,p_reservation_kind,p_delivery_kind,p_service_date,p_now);
  select detail.customer_message_recipient_revision into strict recipient_revision from public.ops_registration_details detail where detail.task_id=p_task_id;
  if current_items is distinct from items or bundle.recipient_revision is distinct from recipient_revision
    or bundle.source_fingerprint is distinct from pg_catalog.encode(extensions.digest(pg_catalog.jsonb_build_object('items',items,'recipientRevision',recipient_revision)::text,'sha256'),'hex') then
    raise exception 'registration_customer_message_bundle_candidate_changed' using errcode='23514'; end if;
end $$;
revoke all on function dashboard_private.assert_registration_contact_stored_bundle_v1(uuid,uuid,text,text,date,timestamptz) from public,anon,authenticated,service_role;

-- Exact FINAL ordered Aug19 + coalesce correction + Sep01 archive source only.
-- LIMIT 4 detects over-budget input; it never truncates a successful four-item bundle.
do $bounded_bundle_sources$
declare spec record; target regprocedure; prior pg_catalog.pg_proc%rowtype; after_proc pg_catalog.pg_proc%rowtype; definition text; i integer;
begin
  for spec in select * from (values
    ('dashboard_private.collect_registration_customer_message_bundle_items_v1(uuid,text,text,date,timestamptz)','fad5fd10d5cbab8bf7e0314dadd3fb8b2c9b8f9d0fce1536ea62ef7bf72667e0',
      array[$bundle_anchor_1$select * from filtered order by scheduled_at, array_position(array['영어', '수학', '과학'], subject), source_id$bundle_anchor_1$,
        $bundle_anchor_2$and level_test.status = 'scheduled' and appointment.scheduled_at > p_now$bundle_anchor_2$,
        $bundle_anchor_3$where p_reservation_kind = 'observation' and observation.task_id = p_task_id$bundle_anchor_3$,
        $bundle_anchor_4$  return v_items;$bundle_anchor_4$],
      array[$bundle_replace_1$select * from filtered order by scheduled_at, array_position(array['영어', '수학', '과학'], subject), source_id limit 4$bundle_replace_1$,
        $bundle_replace_2$and level_test.status = 'scheduled' and appointment.scheduled_at > p_now
      and track.workflow_status not in ('registered','not_registered','inquiry_only')$bundle_replace_2$,
        $bundle_replace_3$where p_reservation_kind = 'observation' and observation.task_id = p_task_id
      and appointment.task_id=p_task_id and appointment.kind='observation_class' and appointment.status='scheduled'
      and track.workflow_status='observation_requested' and observation.subject=track.subject$bundle_replace_3$,
        $bundle_replace_4$  perform dashboard_private.assert_registration_contact_bundle_candidate_v1(p_task_id,p_reservation_kind,p_delivery_kind,p_service_date,p_now,v_items);
  return v_items;$bundle_replace_4$]),
    ('dashboard_private.materialize_registration_customer_message_bundle_v1(uuid,text,text,date,timestamptz)','9a97a489b8c9552d130b80de0c18c2fc12878dee54881f838a9b86c773704705',
      array[$bundle_anchor_14$  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($bundle_anchor_14$,
        $bundle_anchor_5$  v_bundle_id uuid;$bundle_anchor_5$,
        $bundle_anchor_6$  select detail.customer_message_recipient_revision into strict v_recipient_revision$bundle_anchor_6$,
        $bundle_anchor_7$  if v_bundle_id is not null then return v_bundle_id; end if;$bundle_anchor_7$,
        $bundle_anchor_8$    source_fingerprint, scheduled_for$bundle_anchor_8$,
        $bundle_anchor_9$    v_fingerprint,
    case when p_delivery_kind$bundle_anchor_9$,
        $bundle_anchor_10$  from pg_catalog.jsonb_array_elements(v_items) with ordinality as item(value, ordinality);
  return v_bundle_id;$bundle_anchor_10$],
      array[$bundle_replace_14$  if (select auth.role()) is distinct from 'service_role' then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
  perform dashboard_private.assert_registration_contact_open_v1(p_task_id,dashboard_private.registration_case_contact_snapshot_v1(p_task_id,false)->>'generation');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($bundle_replace_14$,
        $bundle_replace_5$  v_bundle_id uuid;
  v_rechecked_items jsonb;$bundle_replace_5$,
        $bundle_replace_6$  v_rechecked_items:=dashboard_private.collect_registration_customer_message_bundle_items_v1(p_task_id,p_reservation_kind,p_delivery_kind,p_service_date,p_now);
  if v_rechecked_items is distinct from v_items then raise exception 'registration_customer_message_bundle_candidate_changed' using errcode='23514'; end if;
  select detail.customer_message_recipient_revision into strict v_recipient_revision$bundle_replace_6$,
        $bundle_replace_7$  if v_bundle_id is not null then
    perform dashboard_private.assert_registration_contact_stored_bundle_v1(v_bundle_id,p_task_id,p_reservation_kind,p_delivery_kind,p_service_date,p_now);
    return v_bundle_id;
  end if;$bundle_replace_7$,
        $bundle_replace_8$    source_fingerprint, contact_generation, scheduled_for$bundle_replace_8$,
        $bundle_replace_9$    v_fingerprint,
    (dashboard_private.registration_case_contact_snapshot_v1(p_task_id,false)->>'generation')::bigint,
    case when p_delivery_kind$bundle_replace_9$,
        $bundle_replace_10$  from pg_catalog.jsonb_array_elements(v_items) with ordinality as item(value, ordinality);
  perform dashboard_private.assert_registration_contact_stored_bundle_v1(v_bundle_id,p_task_id,p_reservation_kind,p_delivery_kind,p_service_date,p_now);
  return v_bundle_id;$bundle_replace_10$]),
    ('public.resolve_registration_customer_message_bundle_source_v1(text,uuid,date)','ca7efd48fcf71726f141c1505c8e21b2e5ded84edf28cac0a5895b4682a459c4',
      array[$bundle_anchor_11$  v_detail public.ops_registration_details%rowtype;$bundle_anchor_11$,
        $bundle_anchor_12$p_task_id, v_reservation_kind, v_delivery_kind, p_service_date, pg_catalog.clock_timestamp()$bundle_anchor_12$,
        $bundle_anchor_13$  return pg_catalog.jsonb_build_object($bundle_anchor_13$],
      array[$bundle_replace_11$  v_detail public.ops_registration_details%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();$bundle_replace_11$,
        $bundle_replace_12$p_task_id, v_reservation_kind, v_delivery_kind, p_service_date, v_now$bundle_replace_12$,
        $bundle_replace_13$  perform dashboard_private.assert_registration_contact_stored_bundle_v1(v_bundle_id,p_task_id,v_reservation_kind,v_delivery_kind,p_service_date,v_now);
  return pg_catalog.jsonb_build_object($bundle_replace_13$])
  ) patches(signature,before_sha256,anchors,replacements) loop
    target:=pg_catalog.to_regprocedure(spec.signature);
    if target is null then raise exception 'registration_contact_bundle_target_missing' using errcode='55000'; end if;
    select * into strict prior from pg_catalog.pg_proc where oid=target;
    if pg_catalog.encode(extensions.digest(prior.prosrc,'sha256'),'hex') is distinct from spec.before_sha256
      or prior.proowner is distinct from (select oid from pg_catalog.pg_roles where rolname='postgres')
      or prior.prosecdef is distinct from true or coalesce('search_path=""'=any(prior.proconfig),false) is distinct from true then
      raise exception 'registration_contact_bundle_source_drift' using errcode='55000'; end if;
    definition:=pg_catalog.pg_get_functiondef(target);
    for i in 1..pg_catalog.cardinality(spec.anchors) loop
      if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,spec.anchors[i],'')))<>pg_catalog.length(spec.anchors[i]) then
        raise exception 'registration_contact_bundle_anchor_drift' using errcode='55000'; end if;
      definition:=pg_catalog.replace(definition,spec.anchors[i],spec.replacements[i]);
    end loop;
    execute definition;
    select * into strict after_proc from pg_catalog.pg_proc where oid=target;
    if after_proc.oid is distinct from prior.oid or after_proc.proowner is distinct from prior.proowner or after_proc.proacl is distinct from prior.proacl
      or after_proc.proconfig is distinct from prior.proconfig or after_proc.prosecdef is distinct from prior.prosecdef or after_proc.provolatile is distinct from prior.provolatile
      or after_proc.proisstrict is distinct from prior.proisstrict or after_proc.proleakproof is distinct from prior.proleakproof or after_proc.prorettype is distinct from prior.prorettype
      or after_proc.prolang is distinct from prior.prolang or after_proc.proretset is distinct from prior.proretset or after_proc.proparallel is distinct from prior.proparallel
      or after_proc.procost is distinct from prior.procost or after_proc.prorows is distinct from prior.prorows or after_proc.prosupport is distinct from prior.prosupport then
      raise exception 'registration_contact_bundle_security_drift' using errcode='55000'; end if;
  end loop;
end $bounded_bundle_sources$;

create function dashboard_private.registration_contact_message_fence_v1(p_kind text,p_source uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_task_id uuid; snapshot jsonb; canonical_kind text; source_open boolean := false;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
  if p_kind in ('level_test_booking_bundle','level_test_reminder_bundle',
    'visit_consultation_booking_bundle','visit_consultation_reminder_bundle',
    'observation_booking_bundle','observation_reminder_bundle') then
    v_task_id := p_source;
    canonical_kind := case when p_kind like 'level_test_%' then 'level_test'
      when p_kind like 'visit_consultation_%' then 'visit_consultation' else 'observation_class' end;
    -- Use the same bounded canonical collector as materialization. This is a
    -- no-DML source probe, not an activated bundle dispatch grant. The metadata
    -- signature has no reminder date; dated preparation rechecks its exact set.
    if canonical_kind in ('level_test','observation_class') then
      begin
        perform dashboard_private.collect_registration_customer_message_bundle_items_v1(v_task_id,
          case when canonical_kind='level_test' then 'level_test' else 'observation' end,'booking',null,pg_catalog.clock_timestamp());
        source_open:=true;
      exception when sqlstate '22023' or sqlstate '23514' then source_open:=false;
      end;
    end if;
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
    elsif p_kind='admission_application' then
      -- The existing guide selects saved planned/unbatched enrollments, not a
      -- manual workflow label or legacy pipeline stage. Match that canonical
      -- track set without changing its business arrays. Every selected subject
      -- must still be current and open; a mixed terminal set fails as a whole.
      -- The original resolver still validates schedules/plans and duplicate
      -- admission messages before any provider attempt can be granted.
      select pg_catalog.count(*)>0 and coalesce(pg_catalog.bool_and(
        t.workflow_status not in ('registered','not_registered','inquiry_only')),false)
      into source_open from public.ops_registration_subject_tracks t
      where t.task_id=v_task_id and t.archived_at is null and not t.migration_review_required
        and exists(select 1 from public.ops_registration_enrollments e
          where e.track_id=t.id and e.status='planned' and e.admission_batch_id is null);
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
        and fence->>'canonicalAppointmentKind'='observation_class'
      or p_kind='admission_application' and fence->>'canonicalAppointmentKind' is null) then
    -- Purpose is fixed by the server kind and canonical task source; caller
    -- flags, labels or a browser digest never authorize contact use.
    raise exception 'registration_contact_use_not_allowed' using errcode='23514';
  end if;
  return fence;
end $$;
revoke all on function dashboard_private.assert_registration_contact_message_source_v1(text,uuid,text) from public,anon,authenticated,service_role;

create function public.read_registration_contact_message_fence_v1(p_actor_profile_id uuid,p_message_kind text,p_source_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare fence jsonb; task_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
  task_id:=case when p_message_kind in ('level_test_booking_bundle','level_test_reminder_bundle','visit_consultation_booking_bundle',
    'visit_consultation_reminder_bundle','observation_booking_bundle','observation_reminder_bundle') then p_source_id
    else dashboard_private.registration_customer_message_source_task_v1(p_message_kind,p_source_id) end;
  perform dashboard_private.registration_customer_message_assert_actor_v1(p_actor_profile_id,task_id,'send');
  fence := dashboard_private.registration_contact_message_fence_v1(p_message_kind,p_source_id);
  if fence->>'taskId' is distinct from task_id::text then raise exception 'registration_contact_source_scope_invalid' using errcode='23514'; end if;
  perform dashboard_private.registration_contact_assert_bounded_json_v1(fence);
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
  if (select auth.role()) is distinct from 'service_role' then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
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
  if (select auth.role()) is distinct from 'service_role' then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
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
  if (select auth.role()) is distinct from 'service_role' then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
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
  if (select auth.role()) is distinct from 'service_role' then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
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
  if (select auth.role()) is distinct from 'service_role' then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
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
  if (select auth.role()) is distinct from 'service_role' then raise exception 'registration_customer_reminder_worker_unauthorized' using errcode='42501'; end if;
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
  if (select auth.role()) is distinct from 'service_role' then raise exception 'registration_customer_reminder_worker_unauthorized' using errcode='42501'; end if;
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
declare result jsonb; item jsonb;
begin
  perform dashboard_private.assert_registration_contact_message_source_v1(p_message_kind,p_task_id,null);
  result:=dashboard_private.contact_bundle_source_legacy_v1(p_message_kind,p_task_id,p_service_date);
  perform dashboard_private.registration_contact_assert_bounded_json_v1(result);
  if pg_catalog.jsonb_typeof(result) is distinct from 'object' or result-array['messageKind','sourceId','bundleId','bundleRevision','taskId',
    'reservationKind','deliveryKind','serviceDate','recipientRevision','sourceFingerprint','studentName','parentPhoneDigits','items']::text[]<>'{}'::jsonb
    or not result ?& array['messageKind','sourceId','bundleId','bundleRevision','taskId','reservationKind','deliveryKind','serviceDate',
      'recipientRevision','sourceFingerprint','studentName','parentPhoneDigits','items']::text[]
    or result->>'taskId' is distinct from p_task_id::text or result->>'sourceId' is distinct from p_task_id::text
    or result->>'messageKind' is distinct from p_message_kind
    or pg_catalog.jsonb_typeof(result->'studentName') is distinct from 'string'
    or pg_catalog.jsonb_typeof(result->'parentPhoneDigits') is distinct from 'string' or result->>'parentPhoneDigits' !~ '^01(0|1|[6-9])[0-9]{7,8}$'
    or pg_catalog.jsonb_typeof(result->'bundleId') is distinct from 'string' or result->>'bundleId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or pg_catalog.jsonb_typeof(result->'sourceFingerprint') is distinct from 'string' or result->>'sourceFingerprint' !~ '^[a-f0-9]{64}$' then
    raise exception 'registration_customer_message_bundle_source_invalid' using errcode='23514'; end if;
  if pg_catalog.jsonb_typeof(result->'bundleRevision') is distinct from 'number' or result->>'bundleRevision' !~ '^[1-9][0-9]{0,15}$' or pg_catalog.jsonb_typeof(result->'recipientRevision') is distinct from 'number' or result->>'recipientRevision' !~ '^[1-9][0-9]{0,15}$' then raise exception 'registration_customer_message_bundle_source_invalid' using errcode='23514'; end if;
  if (result->>'bundleRevision')::numeric>9007199254740991 or (result->>'recipientRevision')::numeric>9007199254740991 then raise exception 'registration_customer_message_bundle_source_invalid' using errcode='23514'; end if;
  perform dashboard_private.assert_registration_contact_stored_bundle_v1((result->>'bundleId')::uuid,p_task_id,result->>'reservationKind',
    result->>'deliveryKind',p_service_date,pg_catalog.clock_timestamp());
  return result;
end $$;

-- The active preview transports facts only. Legacy 13-key resolver remains a
-- service-only future transport capability, not a current preview contact need.
create function public.read_registration_contact_bundle_preview_v1(p_message_kind text,p_task_id uuid,p_service_date date default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'registration_customer_message_access_denied' using errcode='42501'; end if;
  result:=public.resolve_registration_customer_message_bundle_source_v1(p_message_kind,p_task_id,p_service_date)-'parentPhoneDigits';
  if result ? 'parentPhoneDigits' or result-array['messageKind','sourceId','bundleId','bundleRevision','taskId','reservationKind',
    'deliveryKind','serviceDate','recipientRevision','sourceFingerprint','studentName','items']::text[]<>'{}'::jsonb
    or not result ?& array['messageKind','sourceId','bundleId','bundleRevision','taskId','reservationKind',
      'deliveryKind','serviceDate','recipientRevision','sourceFingerprint','studentName','items']::text[] then
    raise exception 'registration_customer_message_bundle_preview_invalid' using errcode='23514'; end if;
  perform dashboard_private.registration_contact_assert_bounded_json_v1(result);
  return result;
end $$;
alter function public.read_registration_contact_bundle_preview_v1(text,uuid,date) owner to postgres;
revoke all on function public.read_registration_contact_bundle_preview_v1(text,uuid,date) from public,anon,authenticated,service_role;
-- WITHHELD: new service-role capability needs separate approved ACL/install review.

-- Final ordered baseline (20260901111200:2673) intentionally retires this
-- producer: service-role guarded NULL, not the August active claim loop. Keep
-- its public OID/owner/ACL and no-send result. Do not resurrect an earlier body.
do $retired_reminder_preflight$
declare source_body text; owner_name text;
begin
  select btrim(regexp_replace(p.prosrc,'\s+',' ','g')),pg_get_userbyid(p.proowner)
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
  if (select auth.role()) is distinct from 'service_role' then
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
