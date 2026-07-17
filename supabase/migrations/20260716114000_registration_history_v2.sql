begin;

-- 새 version-2 이력이 기록된 뒤에도 문의 과목 제거 판단은 기존 version-1
-- 이력과 같은 의미를 유지해야 한다. 나머지 동기화 계약과 공개 서명은 보존한다.
create or replace function dashboard_private.sync_registration_case_subjects_impl(
  p_task_id uuid,
  p_subjects text[],
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_subjects text[];
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_track record;
  v_remaining_count integer;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(coalesce(p_subjects, array[]::text[])) subject(value)
    where subject.value is null
      or nullif(pg_catalog.btrim(subject.value), '') is null
      or pg_catalog.btrim(subject.value) not in ('영어', '수학')
  ) then
    raise exception 'registration_subject_invalid' using errcode = '22023';
  end if;
  select coalesce(
    pg_catalog.array_agg(
      distinct pg_catalog.btrim(subject.value)
      order by pg_catalog.btrim(subject.value)
    ),
    array[]::text[]
  )
  into v_subjects
  from pg_catalog.unnest(coalesce(p_subjects, array[]::text[])) subject(value)
  where nullif(pg_catalog.btrim(subject.value), '') is not null;
  if pg_catalog.cardinality(v_subjects) = 0 then
    raise exception 'registration_last_subject_required' using errcode = '22023';
  end if;
  if pg_catalog.cardinality(v_subjects) not between 1 and 2 then
    raise exception 'registration_subject_invalid' using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'subjects', pg_catalog.to_jsonb(v_subjects)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  perform 1
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by track.id
  for update;
  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'sync_subjects'
  );

  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'sync_subjects'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then
    return v_response;
  end if;

  perform 1
  from public.ops_registration_level_tests level_test
  join public.ops_registration_subject_tracks track on track.id = level_test.track_id
  where track.task_id = p_task_id
  order by level_test.id
  for update of level_test;
  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = p_task_id
  order by consultation.id
  for update of consultation;
  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = p_task_id
  order by enrollment.id
  for update of enrollment;

  for v_track in
    select track.*
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and not (track.subject = any(v_subjects))
    order by track.id
  loop
    if v_track.pipeline_status <> 'inquiry'
      or v_track.director_assignment_source in ('manual', 'migration')
      or exists (
        select 1 from public.ops_registration_level_tests level_test
        where level_test.track_id = v_track.id
      )
      or exists (
        select 1 from public.ops_registration_consultations consultation
        where consultation.track_id = v_track.id
      )
      or exists (
        select 1 from public.ops_registration_enrollments enrollment
        where enrollment.track_id = v_track.id
      )
      or exists (
        select 1
        from public.ops_task_events event
        where event.task_id = p_task_id
          and event.field_name = 'registration_track:' || v_track.id::text
          and not (
            event.event_type = 'registration_track_event'
            and coalesce(
              event.after_value::jsonb ->> 'event_type',
              event.after_value::jsonb ->> 'eventType'
            ) = 'director_default_resolved'
          )
      )
    then
      raise exception 'registration_subject_removal_blocked' using errcode = '40001';
    end if;

    insert into public.ops_task_events(
      task_id, actor_id, event_type, field_name, before_value, after_value
    ) values (
      p_task_id,
      v_actor_id,
      'registration_subject_removed',
      'registration_subject',
      v_track.subject,
      pg_catalog.jsonb_build_object(
        'version', 1,
        'actorId', v_actor_id,
        'trackId', v_track.id,
        'subject', v_track.subject,
        'directorProfileId', v_track.director_profile_id,
        'directorAssignmentSource', v_track.director_assignment_source,
        'directorAssignmentRuleKey', v_track.director_assignment_rule_key,
        'occurredAt', pg_catalog.now()
      )::text
    );
    delete from public.ops_registration_subject_tracks where id = v_track.id;
  end loop;

  insert into public.ops_registration_subject_tracks(
    task_id, subject, pipeline_status, migration_review_required
  )
  select p_task_id, subject.value, 'inquiry', false
  from pg_catalog.unnest(v_subjects) subject(value)
  where not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and track.subject = subject.value
  )
  order by case subject.value when '영어' then 0 else 1 end;

  select pg_catalog.count(*)
  into v_remaining_count
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id;
  if v_remaining_count not between 1 and 2
    or v_remaining_count <> pg_catalog.cardinality(v_subjects)
    or exists (
      select 1
      from pg_catalog.unnest(v_subjects) subject(value)
      where not exists (
        select 1
        from public.ops_registration_subject_tracks track
        where track.task_id = p_task_id
          and track.subject = subject.value
      )
    )
  then
    raise exception 'registration_subject_track_coverage_mismatch' using errcode = '23514';
  end if;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value
  ) values (
    p_task_id,
    v_actor_id,
    'registration_subjects_synced',
    'registration_subjects',
    null,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'actorId', v_actor_id,
      'subjects', pg_catalog.to_jsonb(v_subjects),
      'occurredAt', pg_catalog.now()
    )::text
  );
  perform dashboard_private.recompute_registration_parent(p_task_id);

  select pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'subjects', pg_catalog.to_jsonb(v_subjects),
    'tracks', coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', track.id,
          'taskId', track.task_id,
          'subject', track.subject,
          'status', track.pipeline_status,
          'directorProfileId', track.director_profile_id,
          'directorAssignmentSource', track.director_assignment_source,
          'directorAssignmentRuleKey', track.director_assignment_rule_key,
          'waitingKind', track.waiting_kind,
          'levelTestRetakeDecision', track.level_test_retake_decision,
          'migrationReviewRequired', track.migration_review_required,
          'stageEnteredAt', track.stage_entered_at
        ) order by case track.subject when '영어' then 0 else 1 end, track.id
      ),
      '[]'::jsonb
    )
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id;

  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, p_task_id, 'sync_subjects', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.sync_registration_case_subjects_impl(uuid, text[], text)
  owner to postgres;
revoke execute on function dashboard_private.sync_registration_case_subjects_impl(uuid, text[], text)
  from public, anon;
grant execute on function dashboard_private.sync_registration_case_subjects_impl(uuid, text[], text)
  to authenticated;

create or replace function dashboard_private.write_registration_track_event_v2(
  p_task_id uuid,
  p_track_id uuid,
  p_event_type text,
  p_source text,
  p_destination text,
  p_reason_code text,
  p_metadata jsonb,
  p_actor_kind text,
  p_system_source text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject text;
  v_occurred_at timestamptz := pg_catalog.now();
  v_event_id uuid;
begin
  if p_actor_kind is null
    or p_actor_kind not in ('user', 'system', 'migration')
  then
    raise exception 'registration_event_actor_kind_invalid' using errcode = '22023';
  end if;
  if p_actor_kind = 'user' and (select auth.uid()) is null then
    raise exception 'registration_event_user_actor_required' using errcode = '42501';
  end if;
  if p_actor_kind = 'system'
    and nullif(pg_catalog.btrim(p_system_source), '') is null
  then
    raise exception 'registration_event_system_source_required' using errcode = '22023';
  end if;
  if p_actor_kind = 'system'
    and pg_catalog.btrim(p_system_source) !~ '^[a-z][a-z0-9_]{2,127}$'
  then
    raise exception 'registration_event_system_source_invalid' using errcode = '22023';
  end if;

  select track.subject
  into v_subject
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = p_task_id;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value, created_at
  ) values (
    p_task_id,
    case when p_actor_kind = 'user' then (select auth.uid()) else null end,
    'registration_track_event',
    'registration_track:' || p_track_id::text,
    null,
    pg_catalog.jsonb_build_object(
      'version', 2,
      'event_type', p_event_type,
      'actor_profile_id', case when p_actor_kind = 'user' then (select auth.uid()) else null end,
      'actor_kind', p_actor_kind,
      'system_source', nullif(pg_catalog.btrim(p_system_source), ''),
      'track_id', p_track_id,
      'subject', v_subject,
      'source', p_source,
      'destination', p_destination,
      'reason_code', nullif(pg_catalog.btrim(p_reason_code), ''),
      'metadata', coalesce(p_metadata, '{}'::jsonb),
      'occurred_at', v_occurred_at
    )::text,
    v_occurred_at
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

alter function dashboard_private.write_registration_track_event_v2(
  uuid, uuid, text, text, text, text, jsonb, text, text
)
  owner to postgres;
revoke execute on function dashboard_private.write_registration_track_event_v2(uuid, uuid, text, text, text, text, jsonb, text, text)
  from public, anon, authenticated;

create or replace function dashboard_private.write_registration_track_event(
  p_task_id uuid,
  p_track_id uuid,
  p_event_type text,
  p_source text,
  p_destination text,
  p_reason text,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform dashboard_private.write_registration_track_event_v2(
    p_task_id,
    p_track_id,
    p_event_type,
    p_source,
    p_destination,
    p_reason,
    p_metadata,
    'user',
    null
  );
end;
$$;

alter function dashboard_private.write_registration_track_event(
  uuid, uuid, text, text, text, text, jsonb
)
  owner to postgres;
revoke execute on function dashboard_private.write_registration_track_event(
  uuid, uuid, text, text, text, text, jsonb
)
  from public, anon, authenticated;

commit;
