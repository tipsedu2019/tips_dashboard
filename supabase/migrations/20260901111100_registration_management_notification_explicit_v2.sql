begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $registration_management_notification_v2_dependencies$
begin
  if pg_catalog.to_regprocedure(
      'public.ensure_registration_workflow_notification_v1(uuid,integer)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.write_registration_track_event_v2(uuid,uuid,text,text,text,text,jsonb,text,text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.record_registration_management_notification_v1(uuid,text,uuid,uuid,bigint,timestamptz,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.get_registration_core_legacy_dispatch_plan_v1(uuid,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.begin_legacy_notification_dispatch_v1(text,text,uuid,text,text,bigint,text,bigint,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.notification_sha256_hex_v1(text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.try_registration_event_jsonb_object(text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.try_registration_event_uuid(text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'dashboard_private.registration_actor_is_active_manager_v1(uuid)'
    ) is null
    or pg_catalog.to_regclass(
      'dashboard_private.notification_target_reconciliation_jobs'
    ) is null
  then
    raise exception 'registration_management_notification_v2_dependency_missing'
      using errcode = '55000';
  end if;
end;
$registration_management_notification_v2_dependencies$;

create or replace function dashboard_private.registration_management_notification_event_key_v2(
  p_workflow_status text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_workflow_status
    when 'consultation_requested' then 'registration.case_created'
    when 'consultation_completed' then 'registration.consultation_completed'
    when 'waiting_current_class' then 'registration.waiting_transitioned'
    when 'waiting_new_class' then 'registration.waiting_transitioned'
    when 'waiting_next_opening' then 'registration.waiting_transitioned'
    when 'enrollment_requested' then 'registration.admission_started'
    else null
  end;
$$;

alter function dashboard_private.registration_management_notification_event_key_v2(text)
  owner to postgres;
revoke all on function dashboard_private.registration_management_notification_event_key_v2(text)
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.registration_management_notification_fact_snapshot_v2(
  p_track_id uuid,
  p_actor_profile_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'taskId', task.id,
    'trackId', track.id,
    'studentName', task.student_name,
    'taskStatus', task.status,
    'requestedBy', task.requested_by,
    'schoolGrade', detail.school_grade,
    'inquiryAt', detail.inquiry_at,
    'memo', nullif(pg_catalog.btrim(coalesce(detail.request_note, '')), ''),
    'subject', track.subject,
    'activeSubjects', coalesce((
      select pg_catalog.to_jsonb(pg_catalog.array_agg(
        active_track.subject
        order by
          dashboard_private.registration_subject_sort_order(
            active_track.subject
          ),
          active_track.id
      ))
      from public.ops_registration_subject_tracks active_track
      where active_track.task_id = task.id
        and active_track.archived_at is null
    ), '[]'::jsonb),
    'pipelineStatus', track.pipeline_status,
    'workflowStatus', track.workflow_status,
    'workflowRevision', track.workflow_revision,
    'currentStatus', case track.workflow_status
      when 'consultation_requested' then '상담 신청'
      when 'consultation_completed' then '상담 완료'
      when 'waiting_current_class' then '대기 신청'
      when 'waiting_new_class' then '대기 신청'
      when 'waiting_next_opening' then '대기 신청'
      when 'enrollment_requested' then '등록 신청'
      else null
    end,
    'directorProfileId', track.director_profile_id,
    'actorProfileId', p_actor_profile_id,
    'actorDisplayName', coalesce(
      nullif(actor.name, ''),
      nullif(actor.email, '')
    ),
    'actorKind', case
      when p_actor_profile_id is null then 'system'
      else 'user'
    end,
    'progressLine', case
      when nullif(coalesce(
        nullif(actor.name, ''),
        nullif(actor.email, '')
      ), '') is null
        then '[진행] 관리팀 확인을 기다리고 있어요.'
      else '[진행] ' || coalesce(
        nullif(actor.name, ''),
        nullif(actor.email, '')
      ) || '님이 ' || case track.workflow_status
        when 'consultation_requested' then '상담 신청'
        when 'consultation_completed' then '상담 완료'
        when 'waiting_current_class' then '대기 신청'
        when 'waiting_new_class' then '대기 신청'
        when 'waiting_next_opening' then '대기 신청'
        when 'enrollment_requested' then '등록 신청'
      end || ' 상태로 변경했어요.'
    end,
    'memoLine', case
      when nullif(pg_catalog.btrim(coalesce(detail.request_note, '')), '') is null
        then ''
      else '[메모] ' || pg_catalog.btrim(detail.request_note)
    end,
    'archivedAt', track.archived_at
  )
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task
    on task.id = track.task_id
   and task.type = 'registration'
  join public.ops_registration_details detail
    on detail.task_id = task.id
  left join public.profiles actor
    on actor.id = p_actor_profile_id
  where track.id = p_track_id;
$$;

alter function dashboard_private.registration_management_notification_fact_snapshot_v2(uuid, uuid)
  owner to postgres;
revoke all on function dashboard_private.registration_management_notification_fact_snapshot_v2(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.registration_management_notification_fact_checksum_v2(
  p_snapshot jsonb
)
returns text
language sql
stable
strict
security definer
set search_path = ''
as $$
  select dashboard_private.notification_sha256_hex_v1(p_snapshot::text);
$$;

alter function dashboard_private.registration_management_notification_fact_checksum_v2(jsonb)
  owner to postgres;
revoke all on function dashboard_private.registration_management_notification_fact_checksum_v2(jsonb)
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.registration_management_notification_source_current_v2(
  p_source_event_id uuid,
  p_expected_actor_profile_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_source public.ops_task_events%rowtype;
  v_payload jsonb;
  v_metadata jsonb;
  v_track_id uuid;
  v_request_id uuid;
  v_ledger dashboard_private.notification_request_ledger%rowtype;
  v_canonical dashboard_private.notification_events%rowtype;
  v_snapshot jsonb;
  v_event_key text;
  v_facts_checksum text;
begin
  if p_source_event_id is null then
    return false;
  end if;

  select source.*
  into v_source
  from public.ops_task_events source
  where source.id = p_source_event_id
    and source.event_type = 'registration_track_event';
  if not found then
    return false;
  end if;

  v_payload := dashboard_private.try_registration_event_jsonb_object(
    v_source.after_value
  );
  v_metadata := v_payload -> 'metadata';
  v_track_id := dashboard_private.try_registration_event_uuid(
    v_payload ->> 'track_id'
  );
  v_request_id := dashboard_private.try_registration_event_uuid(
    v_metadata ->> 'requestKey'
  );
  if v_track_id is null
    or v_request_id is null
    or pg_catalog.jsonb_typeof(v_metadata) <> 'object'
    or v_payload ->> 'event_type'
      <> 'registration_management_notification_requested'
    or v_payload ->> 'source' <> v_payload ->> 'destination'
    or v_metadata ->> 'contractVersion' <> '2'
    or v_metadata ->> 'intent'
      <> 'send_registration_management_notification'
    or v_metadata ->> 'factsChecksum' !~ '^[a-f0-9]{64}$'
    or v_source.task_id::text <> coalesce(v_payload ->> 'task_id', v_source.task_id::text)
    or v_source.field_name <> 'registration_track:' || v_track_id::text
    or (
      p_expected_actor_profile_id is not null
      and v_source.actor_id is distinct from p_expected_actor_profile_id
    )
    or not dashboard_private.registration_actor_is_active_manager_v1(
      v_source.actor_id
    )
  then
    return false;
  end if;

  v_snapshot := dashboard_private.registration_management_notification_fact_snapshot_v2(
    v_track_id,
    v_source.actor_id
  );
  if v_snapshot is null
    or v_snapshot ->> 'taskId' <> v_source.task_id::text
    or v_snapshot ->> 'archivedAt' is not null
    or v_payload ->> 'destination' <> v_snapshot ->> 'workflowStatus'
    or v_metadata ->> 'workflowStatus' <> v_snapshot ->> 'workflowStatus'
    or v_metadata ->> 'workflowRevision' !~ '^[1-9][0-9]*$'
    or (v_metadata ->> 'workflowRevision')::integer
      <> (v_snapshot ->> 'workflowRevision')::integer
  then
    return false;
  end if;

  v_event_key := dashboard_private.registration_management_notification_event_key_v2(
    v_snapshot ->> 'workflowStatus'
  );
  v_facts_checksum :=
    dashboard_private.registration_management_notification_fact_checksum_v2(
      v_snapshot
    );
  if v_event_key is null
    or v_metadata ->> 'eventKey' <> v_event_key
    or v_metadata ->> 'factsChecksum' <> v_facts_checksum
  then
    return false;
  end if;

  select canonical.*
  into v_canonical
  from dashboard_private.notification_events canonical
  where canonical.workflow_key = 'registration'
    and canonical.event_key = v_event_key
    and canonical.source_type = 'ops_task_event'
    and canonical.source_id = v_source.id::text
    and canonical.occurrence_key = v_source.id::text;
  if not found
    or v_canonical.source_revision
      is distinct from (v_snapshot ->> 'workflowRevision')::bigint
    or v_canonical.actor_profile_id is distinct from v_source.actor_id
    or v_canonical.payload ->> 'task_id'
      is distinct from v_snapshot ->> 'taskId'
    or v_canonical.payload ->> 'track_id'
      is distinct from v_snapshot ->> 'trackId'
    or v_canonical.payload ->> 'student_name'
      is distinct from v_snapshot ->> 'studentName'
    or v_canonical.payload ->> 'grade'
      is distinct from v_snapshot ->> 'schoolGrade'
    or v_canonical.payload ->> 'subject'
      is distinct from v_snapshot ->> 'subject'
    or v_canonical.payload -> 'subjects'
      is distinct from v_snapshot -> 'activeSubjects'
    or v_canonical.payload ->> 'inquiry_at'
      is distinct from v_snapshot ->> 'inquiryAt'
    or v_canonical.payload ->> 'status'
      is distinct from v_snapshot ->> 'pipelineStatus'
    or v_canonical.payload ->> 'workflow_status'
      is distinct from v_snapshot ->> 'workflowStatus'
    or v_canonical.payload ->> 'current_status'
      is distinct from v_snapshot ->> 'currentStatus'
    or v_canonical.payload ->> 'requester_profile_id'
      is distinct from v_snapshot ->> 'requestedBy'
    or v_canonical.payload ->> 'director_profile_id'
      is distinct from v_snapshot ->> 'directorProfileId'
    or v_canonical.payload ->> 'memo'
      is distinct from v_snapshot ->> 'memo'
    or v_canonical.payload ->> 'actor_name'
      is distinct from v_snapshot ->> 'actorDisplayName'
    or v_canonical.payload ->> 'actor_kind'
      is distinct from v_snapshot ->> 'actorKind'
    or v_canonical.payload ->> 'progress_line'
      is distinct from v_snapshot ->> 'progressLine'
    or v_canonical.payload ->> 'memo_line'
      is distinct from v_snapshot ->> 'memoLine'
    or v_canonical.payload ->> 'source_event_id'
      is distinct from v_source.id::text
  then
    return false;
  end if;

  select ledger.*
  into v_ledger
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = v_request_id;
  if not found then
    return false;
  end if;

  return v_ledger.request_kind = 'registration_management_notification_v2'
    and v_ledger.request_fingerprint = pg_catalog.md5(
      pg_catalog.jsonb_build_object(
        'actorProfileId', v_source.actor_id,
        'trackId', v_track_id,
        'workflowRevision', (v_snapshot ->> 'workflowRevision')::integer,
        'eventKey', v_event_key,
        'intent', 'send_registration_management_notification'
      )::text
    )
    and v_ledger.response_payload ->> 'sourceEventId' = v_source.id::text
    and v_ledger.response_payload ->> 'trackId' = v_track_id::text
    and v_ledger.response_payload ->> 'workflowRevision'
      = v_snapshot ->> 'workflowRevision'
    and v_ledger.response_payload ->> 'eventKey' = v_event_key
    and v_ledger.response_payload ->> 'intent'
      = 'send_registration_management_notification'
    and v_ledger.response_payload ->> 'factsChecksum' = v_facts_checksum;
end;
$$;

alter function dashboard_private.registration_management_notification_source_current_v2(uuid, uuid)
  owner to postgres;
revoke all on function dashboard_private.registration_management_notification_source_current_v2(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function dashboard_private.suppress_registration_management_notification_source_v2(
  p_source_event_id text,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reason text := coalesce(
    nullif(pg_catalog.btrim(p_reason), ''),
    'registration_management_notification_snapshot_stale'
  );
  v_fanout_count integer := 0;
  v_target_count integer := 0;
  v_delivery_count integer := 0;
  v_reserved_count integer := 0;
  v_uncertain_count integer := 0;
begin
  if nullif(pg_catalog.btrim(p_source_event_id), '') is null then
    return pg_catalog.jsonb_build_object('suppressed', false);
  end if;

  update dashboard_private.notification_event_fanout_jobs job
  set status = 'failed',
      next_attempt_at = null,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      last_error_code = v_reason,
      completed_at = v_now,
      updated_at = v_now
  from dashboard_private.notification_events canonical
  where job.event_id = canonical.id
    and job.status in ('pending', 'claimed')
    and canonical.workflow_key = 'registration'
    and canonical.event_key in (
      'registration.case_created',
      'registration.consultation_completed',
      'registration.waiting_transitioned',
      'registration.admission_started'
    )
    and canonical.source_type = 'ops_task_event'
    and canonical.source_id = p_source_event_id;
  get diagnostics v_fanout_count = row_count;

  update dashboard_private.notification_target_reconciliation_jobs job
  set status = 'failed',
      next_attempt_at = null,
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      last_error_code = v_reason,
      completed_at = v_now,
      updated_at = v_now
  from dashboard_private.notification_events canonical
  where job.source_event_id = canonical.id
    and job.status in ('pending', 'claimed')
    and canonical.workflow_key = 'registration'
    and canonical.event_key in (
      'registration.case_created',
      'registration.consultation_completed',
      'registration.waiting_transitioned',
      'registration.admission_started'
    )
    and canonical.source_type = 'ops_task_event'
    and canonical.source_id = p_source_event_id;
  get diagnostics v_target_count = row_count;

  update dashboard_private.notification_deliveries delivery
  set status = 'canceled',
      status_reason = 'source_revision_changed',
      claimed_by = null,
      claim_token = null,
      lease_expires_at = null,
      next_attempt_at = null,
      cancel_requested_at = coalesce(delivery.cancel_requested_at, v_now),
      cancel_reason = v_reason,
      resolved_at = coalesce(delivery.resolved_at, v_now),
      updated_at = v_now
  from dashboard_private.notification_events canonical
  where delivery.event_id = canonical.id
    and delivery.status in ('pending', 'claimed', 'retry_wait')
    and canonical.workflow_key = 'registration'
    and canonical.event_key in (
      'registration.case_created',
      'registration.consultation_completed',
      'registration.waiting_transitioned',
      'registration.admission_started'
    )
    and canonical.source_type = 'ops_task_event'
    and canonical.source_id = p_source_event_id;
  get diagnostics v_delivery_count = row_count;

  update dashboard_private.notification_deliveries delivery
  set cancel_requested_at = coalesce(delivery.cancel_requested_at, v_now),
      cancel_reason = coalesce(delivery.cancel_reason, v_reason),
      updated_at = v_now
  from dashboard_private.notification_events canonical
  where delivery.event_id = canonical.id
    and delivery.status = 'sending'
    and canonical.workflow_key = 'registration'
    and canonical.event_key in (
      'registration.case_created',
      'registration.consultation_completed',
      'registration.waiting_transitioned',
      'registration.admission_started'
    )
    and canonical.source_type = 'ops_task_event'
    and canonical.source_id = p_source_event_id;
  get diagnostics v_uncertain_count = row_count;

  update dashboard_private.notification_dispatch_ownership_claims ownership
  set state = 'closed',
      terminal_outcome = 'failed',
      provider_reference = v_reason,
      updated_at = v_now
  where ownership.workflow_key = 'registration'
    and ownership.occurrence_key = p_source_event_id
    and ownership.state = 'reserved'
    and exists (
      select 1
      from dashboard_private.notification_events canonical
      where canonical.workflow_key = 'registration'
        and canonical.event_key in (
          'registration.case_created',
          'registration.consultation_completed',
          'registration.waiting_transitioned',
          'registration.admission_started'
        )
        and canonical.source_type = 'ops_task_event'
        and canonical.source_id = p_source_event_id
        and canonical.occurrence_key = ownership.occurrence_key
    );
  get diagnostics v_reserved_count = row_count;

  select v_uncertain_count + pg_catalog.count(*)::integer
  into v_uncertain_count
  from dashboard_private.notification_dispatch_ownership_claims ownership
  where ownership.workflow_key = 'registration'
    and ownership.occurrence_key = p_source_event_id
    and ownership.state = 'dispatch_started';

  insert into dashboard_private.notification_audit_logs(
    entity_kind, entity_id, action, actor_profile_id, actor_kind,
    before_summary, after_summary, reason_code
  )
  select
    'registration_management_notification',
    p_source_event_id,
    'stale_notification_suppressed',
    null,
    'system',
    null,
    pg_catalog.jsonb_build_object(
      'fanoutJobs', v_fanout_count,
      'targetJobs', v_target_count,
      'deliveries', v_delivery_count,
      'reservedClaims', v_reserved_count,
      'uncertainPreserved', v_uncertain_count
    ),
    v_reason
  where not exists (
    select 1
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind = 'registration_management_notification'
      and audit.entity_id = p_source_event_id
      and audit.action = 'stale_notification_suppressed'
      and audit.reason_code = v_reason
  );

  if v_uncertain_count > 0 then
    insert into dashboard_private.notification_audit_logs(
      entity_kind, entity_id, action, actor_profile_id, actor_kind,
      after_summary, reason_code
    )
    select
      'registration_management_notification',
      p_source_event_id,
      'external_attempt_uncertainty_preserved',
      null,
      'system',
      pg_catalog.jsonb_build_object('uncertainCount', v_uncertain_count),
      v_reason
    where not exists (
      select 1
      from dashboard_private.notification_audit_logs audit
      where audit.entity_kind = 'registration_management_notification'
        and audit.entity_id = p_source_event_id
        and audit.action = 'external_attempt_uncertainty_preserved'
        and audit.reason_code = v_reason
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'suppressed', true,
    'fanoutJobs', v_fanout_count,
    'targetJobs', v_target_count,
    'deliveries', v_delivery_count,
    'reservedClaims', v_reserved_count,
    'uncertainPreserved', v_uncertain_count
  );
end;
$$;

alter function dashboard_private.suppress_registration_management_notification_source_v2(text, text)
  owner to postgres;
revoke all on function dashboard_private.suppress_registration_management_notification_source_v2(text, text)
  from public, anon, authenticated, service_role;

-- Mixed-version clients must not recreate a management notification from a
-- status audit row. Keep the signature for deterministic compatibility, but
-- remove every application grant and fail with a non-retryable retirement
-- SQLSTATE for privileged callers that still have a cached function schema.
create or replace function public.ensure_registration_workflow_notification_v1(
  p_track_id uuid,
  p_workflow_revision integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'registration_workflow_notification_v1_retired'
    using errcode = '55000';
end;
$$;

alter function public.ensure_registration_workflow_notification_v1(uuid, integer)
  owner to postgres;
revoke all on function public.ensure_registration_workflow_notification_v1(uuid, integer)
  from public, anon, authenticated, service_role;

create or replace function public.ensure_registration_workflow_notification_v2(
  p_track_id uuid,
  p_workflow_revision integer,
  p_request_key text,
  p_intent text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_request_id uuid;
  v_request_fingerprint text;
  v_ledger dashboard_private.notification_request_ledger%rowtype;
  v_task public.ops_tasks%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_registration_source record;
  v_snapshot jsonb;
  v_facts_checksum text;
  v_event_key text;
  v_missing_fields text[] := array[]::text[];
  v_source public.ops_task_events%rowtype;
  v_source_event_id uuid;
  v_already_requested boolean := false;
  v_reusable_source boolean := false;
begin
  if v_actor is null
    or p_track_id is null
    or p_workflow_revision is null
    or p_workflow_revision < 1
  then
    raise exception 'registration_management_notification_access_denied'
      using errcode = '42501';
  end if;
  if not dashboard_private.registration_actor_is_active_manager_v1(
    v_actor
  ) then
    raise exception 'registration_management_notification_access_denied'
      using errcode = '42501';
  end if;
  if v_request_key is null
    or pg_catalog.octet_length(v_request_key) > 192
    or dashboard_private.try_registration_event_uuid(v_request_key) is null
    or p_intent is distinct from 'send_registration_management_notification'
  then
    raise exception 'registration_management_notification_intent_invalid'
      using errcode = '22023';
  end if;

  select task, track, detail
  into v_registration_source
  from public.ops_tasks task
  join public.ops_registration_subject_tracks track
    on track.task_id = task.id
   and track.archived_at is null
  join public.ops_registration_details detail
    on detail.task_id = task.id
  where track.id = p_track_id
    and task.type = 'registration'
  for update of task, track, detail;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  v_task := v_registration_source.task;
  v_track := v_registration_source.track;
  v_detail := v_registration_source.detail;
  perform 1
  from public.profiles actor
  where actor.id = v_actor
  for key share of actor;
  if not found then
    raise exception 'registration_management_notification_access_denied'
      using errcode = '42501';
  end if;

  if v_track.workflow_revision <> p_workflow_revision then
    raise exception 'registration_management_notification_refresh_required'
      using errcode = '23514';
  end if;

  v_event_key := dashboard_private.registration_management_notification_event_key_v2(
    v_track.workflow_status
  );
  if v_event_key is null then
    return pg_catalog.jsonb_build_object(
      'trackId', v_track.id,
      'workflowRevision', v_track.workflow_revision,
      'sourceEventIds', '[]'::jsonb,
      'ready', false,
      'missingFields', pg_catalog.jsonb_build_array(
        '현재 진행상태에는 보낼 관리 알림이 없습니다'
      )
    );
  end if;

  if nullif(pg_catalog.btrim(coalesce(v_task.student_name, '')), '') is null then
    v_missing_fields := pg_catalog.array_append(v_missing_fields, '학생 이름');
  end if;
  if nullif(pg_catalog.btrim(coalesce(v_track.subject, '')), '') is null then
    v_missing_fields := pg_catalog.array_append(v_missing_fields, '과목');
  end if;
  if v_event_key = 'registration.case_created' then
    if nullif(pg_catalog.btrim(coalesce(v_detail.school_grade, '')), '') is null then
      v_missing_fields := pg_catalog.array_append(v_missing_fields, '학년');
    end if;
    if v_detail.inquiry_at is null then
      v_missing_fields := pg_catalog.array_append(v_missing_fields, '문의 시각');
    end if;
  end if;
  if pg_catalog.cardinality(v_missing_fields) > 0 then
    raise exception 'registration_management_notification_not_ready'
      using errcode = '23514',
        detail = pg_catalog.array_to_string(v_missing_fields, ', ');
  end if;

  v_snapshot := dashboard_private.registration_management_notification_fact_snapshot_v2(
    v_track.id,
    v_actor
  );
  if v_snapshot is null or v_snapshot ->> 'archivedAt' is not null then
    raise exception 'registration_management_notification_refresh_required'
      using errcode = '23514';
  end if;
  v_facts_checksum :=
    dashboard_private.registration_management_notification_fact_checksum_v2(
      v_snapshot
    );

  v_request_id := dashboard_private.try_registration_event_uuid(v_request_key);
  v_request_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'actorProfileId', v_actor,
    'trackId', v_track.id,
    'workflowRevision', v_track.workflow_revision,
    'eventKey', v_event_key,
    'intent', p_intent
  )::text);

  -- A browser retry creates a fresh request UUID. Serialize every caller for
  -- the same track/revision/event before checking the current fact checksum.
  -- The source actor is part of the frozen canonical payload, so the lock key
  -- intentionally stays actor-independent for cross-manager retries.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'registration-management-notification-v2:'
      || v_track.id::text
      || ':'
      || v_track.workflow_revision::text
      || ':'
      || v_event_key,
    0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-request:' || v_request_id::text,
    0
  ));

  select ledger.*
  into v_ledger
  from dashboard_private.notification_request_ledger ledger
  where ledger.request_id = v_request_id;

  if found then
    if v_ledger.request_kind <> 'registration_management_notification_v2'
      or v_ledger.request_fingerprint <> v_request_fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    v_source_event_id := dashboard_private.try_registration_event_uuid(
      v_ledger.response_payload ->> 'sourceEventId'
    );
    if v_source_event_id is null then
      raise exception 'registration_management_notification_ledger_invalid'
        using errcode = '23514';
    end if;
    v_already_requested := coalesce(
      case
        when v_ledger.response_payload ->> 'alreadyRequested'
          in ('true', 'false')
        then (v_ledger.response_payload ->> 'alreadyRequested')::boolean
        else false
      end,
      false
    );
    select source.*
    into v_source
    from public.ops_task_events source
    where source.id = v_source_event_id;
    if not found then
      raise exception 'registration_management_notification_ledger_invalid'
        using errcode = '23514';
    end if;
    perform 1
    from public.profiles source_actor
    where source_actor.id = v_source.actor_id
    for key share of source_actor;
    v_snapshot :=
      dashboard_private.registration_management_notification_fact_snapshot_v2(
        v_track.id,
        v_source.actor_id
      );
    v_facts_checksum :=
      dashboard_private.registration_management_notification_fact_checksum_v2(
        v_snapshot
      );
    if v_ledger.response_payload ->> 'factsChecksum'
        is distinct from v_facts_checksum
      or not dashboard_private.registration_management_notification_source_current_v2(
        v_source.id,
        null
      )
    then
      perform dashboard_private.suppress_registration_management_notification_source_v2(
        v_source.id::text,
        'registration_management_notification_snapshot_stale'
      );
      return pg_catalog.jsonb_build_object(
        'trackId', v_track.id,
        'workflowRevision', v_track.workflow_revision,
        'requestKey', v_request_id::text,
        'factsChecksum', v_facts_checksum,
        'sourceEventIds', '[]'::jsonb,
        'ready', false,
        'alreadyRequested', v_already_requested,
        'missingFields', pg_catalog.jsonb_build_array(
          '등록정보가 변경되어 알림을 다시 확인해 주세요'
        )
      );
    end if;
  else
    -- Filter by indexed/source columns before parsing JSON. The candidate set
    -- is limited to one task + field and does not grow with unrelated audit
    -- history.
    with candidate_sources as materialized (
      select
        source as source_row,
        dashboard_private.try_registration_event_jsonb_object(
          source.after_value
        ) as payload
      from public.ops_task_events source
      where source.task_id = v_track.task_id
        and source.event_type = 'registration_track_event'
        and source.field_name = 'registration_track:' || v_track.id::text
    )
    select (candidate.source_row).*
    into v_source
    from candidate_sources candidate
    where candidate.payload ->> 'event_type'
        = 'registration_management_notification_requested'
      and candidate.payload ->> 'destination' = v_track.workflow_status
      and candidate.payload -> 'metadata' ->> 'contractVersion' = '2'
      and candidate.payload -> 'metadata' ->> 'intent' = p_intent
      and candidate.payload -> 'metadata' ->> 'workflowStatus'
        = v_track.workflow_status
      and candidate.payload -> 'metadata' ->> 'workflowRevision'
        = v_track.workflow_revision::text
      and candidate.payload -> 'metadata' ->> 'eventKey' = v_event_key
      and dashboard_private.registration_management_notification_source_current_v2(
        (candidate.source_row).id,
        null
      )
    order by (candidate.source_row).created_at desc,
      (candidate.source_row).id desc
    limit 1;

    v_reusable_source := found;
    if v_reusable_source then
      perform 1
      from public.profiles source_actor
      where source_actor.id = v_source.actor_id
      for key share of source_actor;
      v_reusable_source := found
        and dashboard_private.registration_management_notification_source_current_v2(
          v_source.id,
          null
        );
    end if;

    if v_reusable_source then
      v_source_event_id := v_source.id;
      v_already_requested := true;
      v_snapshot :=
        dashboard_private.registration_management_notification_fact_snapshot_v2(
          v_track.id,
          v_source.actor_id
        );
      v_facts_checksum :=
        dashboard_private.registration_management_notification_fact_checksum_v2(
          v_snapshot
        );
    else
      v_source_event_id := dashboard_private.write_registration_track_event_v2(
        v_track.task_id,
        v_track.id,
        'registration_management_notification_requested',
        v_track.workflow_status,
        v_track.workflow_status,
        'manual_notification_v2',
        pg_catalog.jsonb_build_object(
          'contractVersion', 2,
          'intent', p_intent,
          'requestKey', v_request_key,
          'factsChecksum', v_facts_checksum,
          'workflowStatus', v_track.workflow_status,
          'workflowRevision', v_track.workflow_revision,
          'eventKey', v_event_key
        ),
        'user',
        null
      );
      select source.*
      into strict v_source
      from public.ops_task_events source
      where source.id = v_source_event_id;
    end if;
  end if;

  if not exists (
    select 1
    from dashboard_private.notification_events canonical
    where canonical.workflow_key = 'registration'
      and canonical.event_key = v_event_key
      and canonical.source_type = 'ops_task_event'
      and canonical.source_id = v_source.id::text
      and canonical.occurrence_key = v_source.id::text
  ) then
    perform dashboard_private.record_registration_management_notification_v1(
      v_source.id,
      v_event_key,
      v_track.task_id,
      v_track.id,
      v_track.workflow_revision,
      v_source.created_at,
      v_source.actor_id
    );
  end if;

  if v_ledger.request_id is null then
    insert into dashboard_private.notification_request_ledger(
      request_id,
      request_kind,
      request_fingerprint,
      response_payload
    ) values (
      v_request_id,
      'registration_management_notification_v2',
      v_request_fingerprint,
      pg_catalog.jsonb_build_object(
        'sourceEventId', v_source.id,
        'trackId', v_track.id,
        'workflowRevision', v_track.workflow_revision,
        'eventKey', v_event_key,
        'intent', p_intent,
        'factsChecksum', v_facts_checksum,
        'alreadyRequested', v_already_requested
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'trackId', v_track.id,
    'workflowRevision', v_track.workflow_revision,
    'requestKey', v_request_id::text,
    'factsChecksum', v_facts_checksum,
    'sourceEventIds', pg_catalog.jsonb_build_array(v_source.id),
    'ready', true,
    'alreadyRequested', v_already_requested,
    'missingFields', '[]'::jsonb
  );
end;
$$;

alter function public.ensure_registration_workflow_notification_v2(uuid, integer, text, text)
  owner to postgres;
revoke all on function public.ensure_registration_workflow_notification_v2(uuid, integer, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.ensure_registration_workflow_notification_v2(uuid, integer, text, text)
  to authenticated;

-- The legacy route is retained as the current provider adapter, so its plan
-- must accept only the exact v2 source row produced by the explicit button.
-- A historical workflow-status audit is never a notification intent.
create or replace function public.get_registration_core_legacy_dispatch_plan_v1(
  p_source_event_id uuid,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
begin
  perform dashboard_private.assert_registration_actor_is_active_manager_v1(
    p_actor_profile_id
  );

  if exists (
    select 1
    from dashboard_private.notification_events canonical
    where canonical.workflow_key = 'registration'
      and canonical.event_key in (
        'registration.case_created',
        'registration.consultation_completed',
        'registration.waiting_transitioned',
        'registration.admission_started'
      )
      and canonical.source_type = 'ops_task_event'
      and canonical.source_id = p_source_event_id::text
      and canonical.occurrence_key = p_source_event_id::text
  ) and not dashboard_private.registration_management_notification_source_current_v2(
    p_source_event_id,
    null
  ) then
    select source.task_id
    into v_task_id
    from public.ops_task_events source
    where source.id = p_source_event_id;
    return pg_catalog.jsonb_build_object(
      'sourceEventId', p_source_event_id,
      'taskId', v_task_id,
      'items', '[]'::jsonb
    );
  end if;

  return public.get_registration_core_legacy_dispatch_plan_v1_base(
    p_source_event_id,
    p_actor_profile_id
  );
end;
$$;

alter function public.get_registration_core_legacy_dispatch_plan_v1(uuid, uuid)
  owner to postgres;
revoke all on function public.get_registration_core_legacy_dispatch_plan_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_registration_core_legacy_dispatch_plan_v1(uuid, uuid)
  to service_role;

-- Recheck after the plan and immediately before a legacy dispatch claim is
-- acquired. This closes the plan/begin concurrency gap without coupling fact
-- or status writes to notification tables.
do $registration_management_notification_v2_begin_fence$
declare
  v_definition text;
  v_original text;
  v_needle text := $anchor$    raise exception 'notification_legacy_dispatch_invalid' using errcode = '22023';
  end if;

  v_fingerprint :=$anchor$;
  v_replacement text := $replacement$    raise exception 'notification_legacy_dispatch_invalid' using errcode = '22023';
  end if;

  if p_workflow_key = 'registration'
    and exists (
      select 1
      from dashboard_private.notification_events canonical
      where canonical.workflow_key = 'registration'
        and canonical.event_key in (
          'registration.case_created',
          'registration.consultation_completed',
          'registration.waiting_transitioned',
          'registration.admission_started'
        )
        and canonical.source_type = 'ops_task_event'
        and canonical.occurrence_key = p_occurrence_key
    )
    and not exists (
      select 1
      from dashboard_private.notification_events canonical
      where canonical.workflow_key = 'registration'
        and canonical.event_key in (
          'registration.case_created',
          'registration.consultation_completed',
          'registration.waiting_transitioned',
          'registration.admission_started'
        )
        and canonical.source_type = 'ops_task_event'
        and canonical.occurrence_key = p_occurrence_key
        and dashboard_private.registration_management_notification_source_current_v2(
          dashboard_private.try_registration_event_uuid(canonical.source_id),
          null
        )
    )
  then
    perform dashboard_private.suppress_registration_management_notification_source_v2(
      p_occurrence_key,
      'registration_management_notification_snapshot_stale'
    );
    return pg_catalog.jsonb_build_object(
      'acquired', false,
      'status', 'legacy_deduped',
      'reason', 'registration_management_notification_snapshot_stale'
    );
  end if;

  v_fingerprint :=$replacement$;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.begin_legacy_notification_dispatch_v1(text,text,uuid,text,text,bigint,text,bigint,uuid)'::pg_catalog.regprocedure
  );
  v_original := v_definition;
  if pg_catalog.strpos(v_definition, v_needle) = 0
    or pg_catalog.strpos(
      v_definition,
      'registration_management_notification_source_current_v2'
    ) > 0
  then
    raise exception 'registration_management_notification_v2_begin_fence_anchor_invalid'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_needle, v_replacement);
  if v_definition = v_original
    or v_definition not like '%registration_management_notification_snapshot_stale%'
  then
    raise exception 'registration_management_notification_v2_begin_fence_failed'
      using errcode = '55000';
  end if;
  execute v_definition;
end;
$registration_management_notification_v2_begin_fence$;

-- This RPC is the last durable boundary before any Google Chat/web-push/
-- customer-message provider call. It covers both canonical deliveries and the
-- legacy bridge. A stale source returns allowed=false and writes no
-- external_attempt_registered audit row.
do $registration_management_notification_v2_external_attempt_fence$
declare
  v_definition text;
  v_original text;
  v_needle text := $anchor$  if v_reason is not null then
    insert into dashboard_private.notification_audit_logs($anchor$;
  v_replacement text := $replacement$  if v_reason is null
    and v_claim.workflow_key = 'registration'
    and exists (
      select 1
      from dashboard_private.notification_events canonical
      where canonical.workflow_key = 'registration'
        and canonical.event_key in (
          'registration.case_created',
          'registration.consultation_completed',
          'registration.waiting_transitioned',
          'registration.admission_started'
        )
        and canonical.source_type = 'ops_task_event'
        and canonical.occurrence_key = v_claim.occurrence_key
    )
    and not exists (
      select 1
      from dashboard_private.notification_events canonical
      where canonical.workflow_key = 'registration'
        and canonical.event_key in (
          'registration.case_created',
          'registration.consultation_completed',
          'registration.waiting_transitioned',
          'registration.admission_started'
        )
        and canonical.source_type = 'ops_task_event'
        and canonical.occurrence_key = v_claim.occurrence_key
        and dashboard_private.registration_management_notification_source_current_v2(
          dashboard_private.try_registration_event_uuid(canonical.source_id),
          null
        )
    )
  then
    perform dashboard_private.suppress_registration_management_notification_source_v2(
      v_claim.occurrence_key,
      'registration_management_notification_snapshot_stale'
    );
    v_reason := 'registration_management_notification_snapshot_stale';
  end if;

  if v_reason is not null then
    insert into dashboard_private.notification_audit_logs($replacement$;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)'::pg_catalog.regprocedure
  );
  v_original := v_definition;
  if pg_catalog.strpos(v_definition, v_needle) = 0
    or pg_catalog.strpos(
      v_definition,
      'registration_management_notification_source_current_v2'
    ) > 0
  then
    raise exception 'registration_management_notification_v2_external_fence_anchor_invalid'
      using errcode = '55000';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_needle, v_replacement);
  if v_definition = v_original
    or v_definition not like '%registration_management_notification_snapshot_stale%'
  then
    raise exception 'registration_management_notification_v2_external_fence_failed'
      using errcode = '55000';
  end if;
  execute v_definition;
end;
$registration_management_notification_v2_external_attempt_fence$;

-- Cut over existing management backlog before the v2 RPC is exposed. Pending,
-- claimed, and retry-wait work is provider-zero canceled. Sending or already
-- dispatch-started work is not rewritten as unsent; it remains uncertainty
-- evidence and receives a dedicated audit marker.
do $registration_management_notification_v2_backlog_cutover$
declare
  v_source_event_id text;
begin
  for v_source_event_id in
    select distinct canonical.source_id
    from dashboard_private.notification_events canonical
    where canonical.workflow_key = 'registration'
      and canonical.event_key in (
        'registration.case_created',
        'registration.consultation_completed',
        'registration.waiting_transitioned',
        'registration.admission_started'
      )
      and canonical.source_type = 'ops_task_event'
      and not dashboard_private.registration_management_notification_source_current_v2(
        dashboard_private.try_registration_event_uuid(canonical.source_id),
        null
      )
  loop
    perform dashboard_private.suppress_registration_management_notification_source_v2(
      v_source_event_id,
      'registration_management_notification_v2_cutover'
    );
  end loop;
end;
$registration_management_notification_v2_backlog_cutover$;

notify pgrst, 'reload schema';

commit;
