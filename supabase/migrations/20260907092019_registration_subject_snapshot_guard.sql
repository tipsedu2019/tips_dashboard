begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Keep subject editing independent of common facts, while rejecting a save
-- based on a subject list another manager has already changed.
create function dashboard_private.sync_registration_case_subjects_v2_impl(
  p_task_id uuid,
  p_subjects text[],
  p_expected_subjects text[],
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
  v_expected_subjects text[];
  v_current_subjects text[];
  v_fingerprint jsonb;
  v_receipt dashboard_private.ops_registration_mutations%rowtype;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if p_task_id is null then
    raise exception 'registration_task_required' using errcode = '22023';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_expected_subjects is null then
    raise exception 'registration_subject_snapshot_required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(p_expected_subjects || coalesce(p_subjects, array[]::text[])) input(value)
    where input.value is null or pg_catalog.btrim(input.value) not in ('영어', '수학', '과학')
  ) then
    raise exception 'registration_subject_unsupported' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.array_agg(subject.value order by
    dashboard_private.registration_subject_sort_order(subject.value)), array[]::text[])
  into v_subjects
  from (select distinct pg_catalog.btrim(input.value) as value
    from pg_catalog.unnest(coalesce(p_subjects, array[]::text[])) input(value)) subject;
  select coalesce(pg_catalog.array_agg(subject.value order by
    dashboard_private.registration_subject_sort_order(subject.value)), array[]::text[])
  into v_expected_subjects
  from (select distinct pg_catalog.btrim(input.value) as value
    from pg_catalog.unnest(p_expected_subjects) input(value)) subject;

  perform dashboard_private.assert_registration_mutation_access(p_task_id, null, 'sync_subjects');
  -- Match the existing subject/unified-save lock order. Keep these locks until
  -- the legacy writer and both receipts have committed in this transaction.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration:workflow:' || p_task_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0));
  perform 1 from public.ops_tasks task
    where task.id = p_task_id and task.type = 'registration' for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform 1 from public.ops_registration_details detail
    where detail.task_id = p_task_id for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;
  perform 1 from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id order by track.id for update;
  perform dashboard_private.assert_registration_mutation_access(p_task_id, null, 'sync_subjects');

  v_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id, 'subjects', v_subjects, 'expectedSubjects', v_expected_subjects);
  select mutation.* into v_receipt
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id and mutation.request_key = v_request_key;
  if found then
    if v_receipt.task_id <> p_task_id
      or v_receipt.mutation_type <> 'sync_subjects_v2'
      or v_receipt.target_fingerprint <> v_fingerprint
    then
      raise exception 'idempotency_key_reused' using errcode = '22023';
    end if;
    -- A lost response is replayed before checking a now-outdated snapshot.
    return v_receipt.response_payload;
  end if;

  select coalesce(pg_catalog.array_agg(track.subject order by
    dashboard_private.registration_subject_sort_order(track.subject)), array[]::text[])
  into v_current_subjects
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id and track.archived_at is null;
  if v_current_subjects is distinct from v_expected_subjects then
    raise exception 'registration_subjects_conflict' using errcode = '23514';
  end if;

  v_response := dashboard_private.sync_registration_case_subjects_impl(
    p_task_id, v_subjects,
    'sync-subjects-v2:' || pg_catalog.md5(v_actor_id::text || ':' || v_request_key));
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (v_actor_id, v_request_key, p_task_id, 'sync_subjects_v2', v_fingerprint, v_response);
  return v_response;
end;
$$;

alter function dashboard_private.sync_registration_case_subjects_v2_impl(uuid, text[], text[], text) owner to postgres;
revoke all on function dashboard_private.sync_registration_case_subjects_v2_impl(uuid, text[], text[], text)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.sync_registration_case_subjects_v2_impl(uuid, text[], text[], text) to authenticated;

create function public.sync_registration_case_subjects_v2(
  p_task_id uuid, p_subjects text[], p_expected_subjects text[], p_request_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select dashboard_private.sync_registration_case_subjects_v2_impl(
    p_task_id, p_subjects, p_expected_subjects, p_request_key);
$$;
alter function public.sync_registration_case_subjects_v2(uuid, text[], text[], text) owner to postgres;
revoke all on function public.sync_registration_case_subjects_v2(uuid, text[], text[], text)
  from public, anon, authenticated, service_role;
grant execute on function public.sync_registration_case_subjects_v2(uuid, text[], text[], text) to authenticated;

commit;
