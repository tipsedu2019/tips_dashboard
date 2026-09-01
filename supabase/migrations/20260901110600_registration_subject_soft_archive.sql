begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A subject selection is an editable table value. Removing it from the active
-- set must preserve the track id and every historical child row.
alter table public.ops_registration_subject_tracks
  add column archived_at timestamptz,
  add column archived_by uuid;

alter table public.ops_registration_subject_tracks
  add constraint ops_registration_subject_tracks_archived_by_fkey
    foreign key (archived_by)
    references public.profiles(id)
    on delete restrict
    not valid,
  add constraint ops_registration_subject_tracks_archive_pair_check
    check (
      (archived_at is null and archived_by is null)
      or (archived_at is not null and archived_by is not null)
    ) not valid;

alter table public.ops_registration_subject_tracks
  validate constraint ops_registration_subject_tracks_archived_by_fkey;
alter table public.ops_registration_subject_tracks
  validate constraint ops_registration_subject_tracks_archive_pair_check;

create index ops_registration_subject_tracks_active_task_subject_idx
  on public.ops_registration_subject_tracks(
    task_id,
    subject,
    id
  )
  where archived_at is null;

-- The management table reads the active selection. Historical children remain
-- available through their reviewed history/read RPCs.
drop policy if exists ops_registration_subject_tracks_authenticated_select
  on public.ops_registration_subject_tracks;
drop policy if exists ops_registration_subject_tracks_select_v2
  on public.ops_registration_subject_tracks;
create policy ops_registration_subject_tracks_select_v2
  on public.ops_registration_subject_tracks
  for select
  to authenticated
  using (
    archived_at is null
    and dashboard_private.can_read_ops_task_v1(task_id)
  );

create or replace function dashboard_private.assert_registration_mutation_access(
  p_task_id uuid,
  p_track_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text;
begin
  select actor.role
  into v_role
  from public.profiles actor
  join auth.users account
    on account.id = actor.id
   and account.deleted_at is null
   and (
     account.banned_until is null
     or account.banned_until <= pg_catalog.now()
   )
  where actor.id = v_actor
    and actor.role in ('admin', 'staff');

  if v_actor is null or v_role is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  if p_action in (
    'complete_withdrawal_roster_transition',
    'complete_transfer_roster_transition'
  ) then
    if p_track_id is not null
      or not exists (
        select 1
        from public.ops_tasks task
        where task.id = p_task_id
          and (
            (
              p_action = 'complete_withdrawal_roster_transition'
              and task.type = 'withdrawal'
            )
            or (
              p_action = 'complete_transfer_roster_transition'
              and task.type = 'transfer'
            )
          )
      )
    then
      raise exception 'registration_access_denied' using errcode = '42501';
    end if;
    return;
  end if;

  if not exists (
    select 1
    from public.ops_tasks task
    where task.id = p_task_id
      and task.type = 'registration'
  ) then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  if p_track_id is not null and not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.id = p_track_id
      and track.task_id = p_task_id
      and track.archived_at is null
  ) then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
end;
$$;

create or replace function dashboard_private.assert_registration_workflow_status_access(
  p_track_id uuid,
  p_workflow_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text;
begin
  select actor.role
  into v_role
  from public.profiles actor
  join auth.users account
    on account.id = actor.id
   and account.deleted_at is null
   and (
     account.banned_until is null
     or account.banned_until <= pg_catalog.now()
   )
  where actor.id = v_actor
    and actor.role in ('admin', 'staff');

  if v_actor is null
    or v_role is null
    or nullif(pg_catalog.btrim(p_workflow_status), '') is null
  then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.ops_registration_subject_tracks track
    join public.ops_tasks task
      on task.id = track.task_id
     and task.type = 'registration'
    where track.id = p_track_id
      and track.archived_at is null
  ) then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
end;
$$;

create or replace function dashboard_private.assert_registration_observation_manager_access_v1(
  p_track_id uuid
)
returns public.ops_registration_subject_tracks
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_track public.ops_registration_subject_tracks%rowtype;
begin
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  join public.ops_tasks task
    on task.id = track.task_id
   and task.type = 'registration'
  join public.profiles actor
    on actor.id = (select auth.uid())
   and actor.role in ('admin', 'staff')
  join auth.users account
    on account.id = actor.id
   and account.deleted_at is null
   and (
     account.banned_until is null
     or account.banned_until <= pg_catalog.now()
   )
  where track.id = p_track_id
    and track.archived_at is null;

  if not found then
    raise exception 'registration_observation_not_found'
      using errcode = 'P0002';
  end if;

  return v_track;
end;
$$;

alter function dashboard_private.assert_registration_mutation_access(uuid, uuid, text)
  owner to postgres;
alter function dashboard_private.assert_registration_workflow_status_access(uuid, text)
  owner to postgres;
alter function dashboard_private.assert_registration_observation_manager_access_v1(uuid)
  owner to postgres;
revoke all on function dashboard_private.assert_registration_mutation_access(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_workflow_status_access(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_observation_manager_access_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.assert_registration_observation_manager_access_v1(uuid)
  to authenticated;

create or replace function dashboard_private.derive_registration_parent_projection(
  p_task_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_projection jsonb;
begin
  if not exists (
    select 1
    from public.ops_tasks task
    where task.id = p_task_id
      and task.type = 'registration'
  ) then
    raise exception 'registration_subject_track_coverage_mismatch'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and track.archived_at is null
  ) then
    return pg_catalog.jsonb_build_object(
      'taskId', p_task_id,
      'parentStatus', 'requested',
      'subject', null,
      'classId', null,
      'textbookId', null,
      'secondaryAssigneeId', null,
      'counselor', null,
      'pipelineStatus', '0. 등록 문의',
      'makeeduRegistered', false,
      'makeeduInvoiceSent', false,
      'paymentChecked', false
    );
  end if;

  with tracks as (
    select
      track.*,
      dashboard_private.registration_subject_sort_order(track.subject)
        as subject_order,
      case track.pipeline_status
        when 'inquiry' then 0
        when 'migration_review' then 0
        when 'level_test_scheduled' then 1
        when 'level_test_in_progress' then 1
        when 'consultation_waiting' then 2
        when 'visit_consultation_scheduled' then 2
        when 'waiting' then 3
        when 'enrollment_decided' then 4
        when 'enrollment_processing' then 5
        else 9
      end as workflow_order,
      track.pipeline_status in (
        'registered', 'not_registered', 'inquiry_closed'
      ) as terminal
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and track.archived_at is null
  ), stats as (
    select
      pg_catalog.count(*) as track_count,
      pg_catalog.bool_and(pipeline_status = 'inquiry') as all_inquiry,
      pg_catalog.bool_and(terminal) as all_terminal,
      pg_catalog.bool_or(pipeline_status = 'registered') as any_registered
    from tracks
  ), open_batch as (
    select exists(
      select 1
      from public.ops_registration_admission_batches batch
      where batch.task_id = p_task_id
        and batch.status not in ('completed', 'canceled')
        and exists (
          select 1
          from public.ops_registration_enrollments enrollment
          join tracks track on track.id = enrollment.track_id
          where enrollment.admission_batch_id = batch.id
            and enrollment.status <> 'canceled'
        )
    ) as present
  ), selected_track as (
    select track.*
    from tracks track
    order by
      case when track.terminal then 1 else 0 end,
      track.workflow_order,
      track.subject_order,
      track.id
    limit 1
  ), selected_director as (
    select track.director_profile_id, profile.name as counselor
    from tracks track
    left join public.profiles profile on profile.id = track.director_profile_id
    where not track.terminal
    order by track.subject_order, track.id
    limit 1
  ), compatibility_enrollments as (
    select enrollment.*, track.subject_order
    from public.ops_registration_enrollments enrollment
    join tracks track on track.id = enrollment.track_id
    where enrollment.status <> 'canceled'
      and not (
        enrollment.status = 'planned'
        and enrollment.admission_batch_id is null
        and track.pipeline_status = 'registered'
      )
  ), representative_enrollment as (
    select enrollment.class_id, enrollment.textbook_id
    from compatibility_enrollments enrollment
    order by enrollment.subject_order, enrollment.sort_order, enrollment.id
    limit 1
  ), enrollment_stats as (
    select
      pg_catalog.count(*) as enrollment_count,
      coalesce(pg_catalog.bool_and(makeedu_registered), false) as all_makeedu
    from compatibility_enrollments
  ), latest_batch as (
    select batch.*
    from public.ops_registration_admission_batches batch
    where batch.task_id = p_task_id
      and batch.status <> 'canceled'
      and exists (
        select 1
        from public.ops_registration_enrollments enrollment
        join tracks track on track.id = enrollment.track_id
        where enrollment.admission_batch_id = batch.id
          and enrollment.status <> 'canceled'
      )
    order by batch.revision_number desc, batch.id desc
    limit 1
  ), values_to_project as (
    select
      case
        when stats.all_inquiry and not open_batch.present then 'requested'
        when stats.all_terminal
          and not open_batch.present
          and stats.any_registered then 'done'
        when stats.all_terminal and not open_batch.present then 'canceled'
        else 'in_progress'
      end as parent_status,
      (
        select pg_catalog.string_agg(
          track.subject,
          ', '
          order by track.subject_order, track.id
        )
        from tracks track
      ) as subject,
      representative_enrollment.class_id,
      representative_enrollment.textbook_id,
      selected_director.director_profile_id,
      selected_director.counselor,
      case selected_track.pipeline_status
        when 'inquiry' then '0. 등록 문의'
        when 'migration_review' then '0. 등록 문의'
        when 'level_test_scheduled' then '1. 레벨테스트 예약'
        when 'level_test_in_progress' then '1. 레벨테스트 예약'
        when 'consultation_waiting' then '2. 상담 예약'
        when 'visit_consultation_scheduled' then '2. 상담 예약'
        when 'waiting' then case selected_track.waiting_kind
          when 'current_class' then '4-1. 현재반 대기 신청'
          when 'current_term_opening' then '4-2. 신규반 대기 신청'
          when 'next_term_opening' then '4-3. 다음 개강 알림 요청'
        end
        when 'enrollment_decided' then '5. 입학 등록 결정'
        when 'enrollment_processing' then case
          when latest_batch.status = 'draft' then '5-1. 입학신청서 발송 완료'
          else '6. 수납 확인'
        end
        when 'registered' then '7. 등록 완료'
        when 'not_registered' then '8. 미등록'
        when 'inquiry_closed' then '9. 문의만'
      end as pipeline_status,
      enrollment_stats.enrollment_count > 0
        and enrollment_stats.all_makeedu as makeedu_registered,
      latest_batch.invoice_sent_at is not null as makeedu_invoice_sent,
      latest_batch.payment_confirmed_at is not null as payment_checked
    from stats
    cross join open_batch
    cross join selected_track
    left join selected_director on true
    left join representative_enrollment on true
    cross join enrollment_stats
    left join latest_batch on true
  )
  select pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'parentStatus', value.parent_status,
    'subject', value.subject,
    'classId', value.class_id,
    'textbookId', value.textbook_id,
    'secondaryAssigneeId', value.director_profile_id,
    'counselor', value.counselor,
    'pipelineStatus', value.pipeline_status,
    'makeeduRegistered', value.makeedu_registered,
    'makeeduInvoiceSent', value.makeedu_invoice_sent,
    'paymentChecked', value.payment_checked
  )
  into v_projection
  from values_to_project value;

  return v_projection;
end;
$$;

alter function dashboard_private.derive_registration_parent_projection(uuid)
  owner to postgres;
revoke all on function dashboard_private.derive_registration_parent_projection(uuid)
  from public, anon, authenticated, service_role;

-- Subject selection is a flat management fact. Keep the legacy compatibility
-- columns protected when a caller actually changes one of them, but do not
-- make a subject-only write repair (or agree with) unrelated stale projection
-- columns left by the retired coupled workflow.
create or replace function dashboard_private.prevent_registration_task_display_override_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_projection jsonb;
begin
  if tg_relid <> 'public.ops_tasks'::regclass then
    raise exception 'registration_compatibility_trigger_table_invalid'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = new.id
  ) then
    return new;
  end if;

  v_projection := dashboard_private.derive_registration_parent_projection(new.id);
  if (
    new.subject is distinct from old.subject
    and new.subject is distinct from v_projection ->> 'subject'
  ) or (
    new.class_id is distinct from old.class_id
    and new.class_id is distinct from
      nullif(v_projection ->> 'classId', '')::uuid
  ) or (
    new.textbook_id is distinct from old.textbook_id
    and new.textbook_id is distinct from
      nullif(v_projection ->> 'textbookId', '')::uuid
  ) or (
    new.secondary_assignee_id is distinct from old.secondary_assignee_id
    and new.secondary_assignee_id is distinct from
      nullif(v_projection ->> 'secondaryAssigneeId', '')::uuid
  ) then
    raise exception 'registration_compatibility_override_denied'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

alter function dashboard_private.prevent_registration_task_display_override_v1()
  owner to postgres;
revoke all on function dashboard_private.prevent_registration_task_display_override_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists prevent_registration_compatibility_override
  on public.ops_tasks;
create trigger prevent_registration_compatibility_override
before update of subject, class_id, textbook_id, secondary_assignee_id
on public.ops_tasks
for each row
execute function dashboard_private.prevent_registration_task_display_override_v1();

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
  v_current_subjects text[];
  v_target_fingerprint jsonb;
  v_legacy_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_subjects_changed boolean;
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
  if exists (
    select 1
    from pg_catalog.unnest(
      coalesce(p_subjects, array[]::text[])
    ) subject(value)
    where subject.value is null
      or nullif(pg_catalog.btrim(subject.value), '') is null
      or pg_catalog.btrim(subject.value) not in ('영어', '수학', '과학')
  ) then
    raise exception 'registration_subject_unsupported' using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.array_agg(
      subject.value
      order by dashboard_private.registration_subject_sort_order(subject.value)
    ),
    array[]::text[]
  )
  into v_subjects
  from (
    select distinct pg_catalog.btrim(input.value) as value
    from pg_catalog.unnest(
      coalesce(p_subjects, array[]::text[])
    ) input(value)
    where nullif(pg_catalog.btrim(input.value), '') is not null
  ) subject;

  if pg_catalog.cardinality(v_subjects) not between 0 and 3 then
    raise exception 'registration_subject_invalid' using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'subjects', pg_catalog.to_jsonb(v_subjects)
  );
  if pg_catalog.cardinality(v_subjects) > 0
    and not ('과학' = any(v_subjects))
  then
    select pg_catalog.jsonb_set(
      v_target_fingerprint,
      '{subjects}',
      pg_catalog.to_jsonb(
        pg_catalog.array_agg(
          legacy_subject.value
          order by pg_catalog.btrim(legacy_subject.value)
        )
      ),
      true
    )
    into v_legacy_target_fingerprint
    from pg_catalog.unnest(v_subjects) legacy_subject(value);
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id,
    null,
    'sync_subjects'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration:workflow:' || p_task_id::text,
      0
    )
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

  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'sync_subjects'
      and (
        mutation.target_fingerprint = v_target_fingerprint
        or (
          v_legacy_target_fingerprint is not null
          and mutation.target_fingerprint = v_legacy_target_fingerprint
        )
      )
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

  select coalesce(
    pg_catalog.array_agg(
      track.subject
      order by dashboard_private.registration_subject_sort_order(track.subject)
    ),
    array[]::text[]
  )
  into v_current_subjects
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
    and track.archived_at is null;

  v_subjects_changed := v_current_subjects is distinct from v_subjects;

  for v_track in
    update public.ops_registration_subject_tracks track
    set archived_at = pg_catalog.now(),
        archived_by = v_actor_id,
        updated_at = pg_catalog.now()
    where track.task_id = p_task_id
      and track.archived_at is null
      and not (track.subject = any(v_subjects))
    returning track.*
  loop
    insert into public.ops_task_events(
      task_id,
      actor_id,
      event_type,
      field_name,
      before_value,
      after_value
    ) values (
      p_task_id,
      v_actor_id,
      'registration_subject_archived',
      'registration_track:' || v_track.id::text,
      v_track.subject,
      pg_catalog.jsonb_build_object(
        'version', 1,
        'actorId', v_actor_id,
        'trackId', v_track.id,
        'subject', v_track.subject,
        'archivedAt', v_track.archived_at,
        'occurredAt', pg_catalog.now()
      )::text
    );
  end loop;

  for v_track in
    update public.ops_registration_subject_tracks track
    set archived_at = null,
        archived_by = null,
        updated_at = pg_catalog.now()
    where track.task_id = p_task_id
      and track.archived_at is not null
      and track.subject = any(v_subjects)
    returning track.*
  loop
    insert into public.ops_task_events(
      task_id,
      actor_id,
      event_type,
      field_name,
      before_value,
      after_value
    ) values (
      p_task_id,
      v_actor_id,
      'registration_subject_restored',
      'registration_track:' || v_track.id::text,
      v_track.subject,
      pg_catalog.jsonb_build_object(
        'version', 1,
        'actorId', v_actor_id,
        'trackId', v_track.id,
        'subject', v_track.subject,
        'occurredAt', pg_catalog.now()
      )::text
    );
  end loop;

  insert into public.ops_registration_subject_tracks(
    task_id,
    subject,
    pipeline_status,
    migration_review_required
  )
  select p_task_id, subject.value, 'inquiry', false
  from pg_catalog.unnest(v_subjects) subject(value)
  where not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and track.subject = subject.value
  )
  order by dashboard_private.registration_subject_sort_order(subject.value);

  if (
    select pg_catalog.count(*)
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and track.archived_at is null
  ) <> pg_catalog.cardinality(v_subjects)
    or exists (
      select 1
      from pg_catalog.unnest(v_subjects) subject(value)
      where not exists (
        select 1
        from public.ops_registration_subject_tracks track
        where track.task_id = p_task_id
          and track.subject = subject.value
          and track.archived_at is null
      )
    )
  then
    raise exception 'registration_subject_track_coverage_mismatch'
      using errcode = '23514';
  end if;

  if v_subjects_changed then
    insert into public.ops_task_events(
      task_id,
      actor_id,
      event_type,
      field_name,
      before_value,
      after_value
    ) values (
      p_task_id,
      v_actor_id,
      'registration_subjects_synced',
      'registration_subjects',
      pg_catalog.to_jsonb(v_current_subjects)::text,
      pg_catalog.jsonb_build_object(
        'version', 1,
        'actorId', v_actor_id,
        'subjects', pg_catalog.to_jsonb(v_subjects),
        'occurredAt', pg_catalog.now()
      )::text
    );
  end if;

  -- Keep the list-card display label in sync, without deriving or mutating any
  -- task status/completion or admission/process compatibility field.
  update public.ops_tasks task
  set subject = nullif(pg_catalog.array_to_string(v_subjects, ', '), '')
  where task.id = p_task_id
    and task.subject is distinct from
      nullif(pg_catalog.array_to_string(v_subjects, ', '), '');

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
        ) order by
          dashboard_private.registration_subject_sort_order(track.subject),
          track.id
      ),
      '[]'::jsonb
    )
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
    and track.archived_at is null;

  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    p_task_id,
    'sync_subjects',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.sync_registration_case_subjects_impl(uuid, text[], text)
  owner to postgres;
revoke all on function dashboard_private.sync_registration_case_subjects_impl(uuid, text[], text)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.sync_registration_case_subjects_impl(uuid, text[], text)
  to authenticated;

-- The legacy unified editor remains atomic, but delegates to the same flat
-- common-fact and soft-subject contracts as the split editor. Both optimistic
-- snapshots are domain conflicts, never synthetic serialization failures.
create or replace function dashboard_private.save_registration_case_inquiry_v1_impl(
  p_task_id uuid,
  p_student_name text,
  p_school_grade text,
  p_school_name text,
  p_parent_phone text,
  p_student_phone text,
  p_campus text,
  p_inquiry_at timestamptz,
  p_request_note text,
  p_priority text,
  p_expected_common_revision integer,
  p_expected_subjects text[],
  p_subjects text[],
  p_request_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_request_key text := nullif(pg_catalog.btrim(p_request_key), '');
  v_student_name text := nullif(pg_catalog.btrim(p_student_name), '');
  v_school_grade text := nullif(pg_catalog.btrim(p_school_grade), '');
  v_school_name text := nullif(pg_catalog.btrim(p_school_name), '');
  v_parent_phone text := nullif(pg_catalog.btrim(p_parent_phone), '');
  v_student_phone text := nullif(pg_catalog.btrim(p_student_phone), '');
  v_campus text := nullif(pg_catalog.btrim(p_campus), '');
  v_request_note text := nullif(pg_catalog.btrim(p_request_note), '');
  v_priority text := nullif(pg_catalog.btrim(p_priority), '');
  v_expected_subjects text[];
  v_subjects text[];
  v_current_subjects text[];
  v_detail public.ops_registration_details%rowtype;
  v_target_fingerprint jsonb;
  v_receipt_found boolean := false;
  v_receipt_matches boolean := false;
  v_common_request_key text;
  v_subject_request_key text;
  v_common_response jsonb;
  v_subject_response jsonb;
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
  if p_expected_common_revision is null or p_expected_common_revision <= 0 then
    raise exception 'registration_common_revision_conflict' using errcode = '23514';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(
      coalesce(p_expected_subjects, array[]::text[])
    ) expected(value)
    where expected.value is null
      or nullif(pg_catalog.btrim(expected.value), '') is null
      or pg_catalog.btrim(expected.value) not in ('영어', '수학', '과학')
  ) then
    raise exception 'registration_subjects_conflict' using errcode = '23514';
  end if;
  select coalesce(
    pg_catalog.array_agg(
      expected.value
      order by dashboard_private.registration_subject_sort_order(expected.value)
    ),
    array[]::text[]
  )
  into v_expected_subjects
  from (
    select distinct pg_catalog.btrim(input.value) as value
    from pg_catalog.unnest(
      coalesce(p_expected_subjects, array[]::text[])
    ) input(value)
    where nullif(pg_catalog.btrim(input.value), '') is not null
  ) expected;

  if exists (
    select 1
    from pg_catalog.unnest(
      coalesce(p_subjects, array[]::text[])
    ) subject(value)
    where subject.value is null
      or nullif(pg_catalog.btrim(subject.value), '') is null
      or pg_catalog.btrim(subject.value) not in ('영어', '수학', '과학')
  ) then
    raise exception 'registration_subject_unsupported' using errcode = '22023';
  end if;
  select coalesce(
    pg_catalog.array_agg(
      subject.value
      order by dashboard_private.registration_subject_sort_order(subject.value)
    ),
    array[]::text[]
  )
  into v_subjects
  from (
    select distinct pg_catalog.btrim(input.value) as value
    from pg_catalog.unnest(
      coalesce(p_subjects, array[]::text[])
    ) input(value)
    where nullif(pg_catalog.btrim(input.value), '') is not null
  ) subject;
  if pg_catalog.cardinality(v_subjects) not between 0 and 3 then
    raise exception 'registration_subject_invalid' using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'studentName', v_student_name,
    'schoolGrade', v_school_grade,
    'schoolName', v_school_name,
    'parentPhone', v_parent_phone,
    'studentPhone', v_student_phone,
    'campus', v_campus,
    'inquiryAt', p_inquiry_at,
    'requestNote', v_request_note,
    'priority', v_priority,
    'expectedCommonRevision', p_expected_common_revision,
    'expectedSubjects', pg_catalog.to_jsonb(v_expected_subjects),
    'subjects', pg_catalog.to_jsonb(v_subjects)
  );

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id,
    null,
    'update_common'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration:workflow:' || p_task_id::text,
      0
    )
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

  select detail.*
  into v_detail
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

  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'save_inquiry'
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

  select coalesce(
    pg_catalog.array_agg(
      track.subject
      order by dashboard_private.registration_subject_sort_order(track.subject)
    ),
    array[]::text[]
  )
  into v_current_subjects
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
    and track.archived_at is null;

  if v_detail.common_revision <> p_expected_common_revision then
    raise exception 'registration_common_revision_conflict' using errcode = '23514';
  end if;
  if v_current_subjects is distinct from v_expected_subjects then
    raise exception 'registration_subjects_conflict' using errcode = '23514';
  end if;

  v_common_request_key := 'save-inquiry-common:' || pg_catalog.md5(
    v_actor_id::text || ':' || v_request_key
  );
  v_subject_request_key := 'save-inquiry-subjects:' || pg_catalog.md5(
    v_actor_id::text || ':' || v_request_key
  );

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

  v_subject_response := dashboard_private.sync_registration_case_subjects_impl(
    p_task_id,
    v_subjects,
    v_subject_request_key
  );

  v_response := v_common_response || pg_catalog.jsonb_build_object(
    'subjects', v_subject_response -> 'subjects',
    'tracks', v_subject_response -> 'tracks'
  );

  insert into dashboard_private.ops_registration_mutations(
    actor_id,
    request_key,
    task_id,
    mutation_type,
    target_fingerprint,
    response_payload
  ) values (
    v_actor_id,
    v_request_key,
    p_task_id,
    'save_inquiry',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

alter function dashboard_private.save_registration_case_inquiry_v1_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text,
  integer, text[], text[], text
) owner to postgres;
revoke all on function dashboard_private.save_registration_case_inquiry_v1_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text,
  integer, text[], text[], text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.save_registration_case_inquiry_v1_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text,
  integer, text[], text[], text
) to authenticated;

comment on function dashboard_private.sync_registration_case_subjects_impl(
  uuid, text[], text
) is 'Synchronizes the active 0-3 subject selection by archiving or restoring stable track ids; history is never deleted.';
comment on function dashboard_private.save_registration_case_inquiry_v1_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text,
  integer, text[], text[], text
) is 'Atomically stores flat common facts and the active soft-archived subject selection without workflow or notification gates.';

create or replace view public.ops_registration_subject_track_summaries
with (security_invoker = true)
as
select
  track.id,
  track.task_id,
  track.subject,
  track.pipeline_status,
  track.director_profile_id,
  track.director_assignment_source,
  track.director_assignment_rule_key,
  track.waiting_kind,
  track.level_test_retake_decision,
  track.migration_review_required,
  track.stage_entered_at,
  track.updated_at,
  active_visit.scheduled_at as visit_scheduled_at,
  active_visit.place as visit_place,
  active_phone.ready_at as phone_ready_at,
  active_phone.ready_source as phone_ready_source,
  track.workflow_status,
  track.workflow_revision,
  track.workflow_status_entered_at,
  track.waiting_detail_kind,
  track.waiting_detail_class_id,
  track.waiting_detail_retake_decision,
  track.enrollment_detail_rows,
  active_level_test.scheduled_at as level_test_scheduled_at,
  active_level_test.place as level_test_place,
  case when observation_manager.allowed is true
    then track.observation_attempt_count else null
  end as observation_attempt_count,
  case when observation_manager.allowed is true
    then current_observation.id else null
  end as observation_current_id,
  case when observation_manager.allowed is true
    then current_observation.status else null
  end as observation_current_status,
  case when observation_manager.allowed is true
    then current_observation.appointment_id else null
  end as observation_current_appointment_id,
  case when observation_manager.allowed is true
    then current_observation.scheduled_at else null
  end as observation_nearest_scheduled_at,
  case when observation_manager.allowed is true
    then current_observation.place else null
  end as observation_nearest_place,
  case when observation_manager.allowed is true
    then current_observation.notification_revision else null
  end as observation_notification_revision,
  case when observation_manager.allowed is true
    then current_observation.revision else null
  end as observation_revision,
  case when observation_manager.allowed is true
    then current_observation.feedback_revision else null
  end as observation_feedback_revision,
  case when observation_manager.allowed is true
    then track.observation_return_workflow_status else null
  end as observation_return_workflow_status
from public.ops_registration_subject_tracks track
left join lateral (
  select true as allowed
  where dashboard_private.registration_observation_current_actor_is_active_manager_v1()
    or dashboard_private.registration_observation_track_director_profile_id_matches_v1(
      track.id
    )
  limit 1
) observation_manager on true
left join lateral (
  select appointment.scheduled_at, appointment.place
  from public.ops_registration_consultations consultation
  join public.ops_registration_appointments appointment
    on appointment.id = consultation.appointment_id
  where consultation.track_id = track.id
    and consultation.mode = 'visit'
    and consultation.status = 'scheduled'
    and appointment.kind = 'visit_consultation'
    and appointment.status = 'scheduled'
  order by consultation.created_at desc, consultation.id desc
  limit 1
) active_visit on true
left join lateral (
  select consultation.ready_at, consultation.ready_source
  from public.ops_registration_consultations consultation
  where consultation.track_id = track.id
    and consultation.mode = 'phone'
    and consultation.status = 'waiting'
  order by consultation.created_at desc, consultation.id desc
  limit 1
) active_phone on true
left join lateral (
  select appointment.scheduled_at, appointment.place
  from public.ops_registration_level_tests level_test
  join public.ops_registration_appointments appointment
    on appointment.id = level_test.appointment_id
  where level_test.track_id = track.id
    and level_test.status in ('scheduled', 'in_progress')
    and appointment.kind = 'level_test'
    and appointment.status = 'scheduled'
  order by
    level_test.attempt_number desc,
    level_test.created_at desc,
    level_test.id desc
  limit 1
) active_level_test on true
left join lateral (
  select
    observation.id,
    observation.status,
    observation.appointment_id,
    observation.revision,
    observation.feedback_revision,
    appointment.scheduled_at,
    appointment.place,
    appointment.notification_revision
  from public.ops_registration_observations observation
  join public.ops_registration_appointments appointment
    on appointment.id = observation.appointment_id
   and appointment.task_id = observation.task_id
  where observation.track_id = track.id
    and observation.decision_kind is null
    and observation.status in (
      'scheduled',
      'attended_feedback_pending',
      'completed',
      'no_show'
    )
  limit 1
) current_observation on true
where track.archived_at is null;

alter view public.ops_registration_subject_track_summaries owner to postgres;
revoke all on table public.ops_registration_subject_track_summaries
  from public, anon, service_role;
grant select on table public.ops_registration_subject_track_summaries
  to authenticated;

-- Both cursor and numbered registration lists select one representative track.
-- A left representative keeps an empty active subject row visible in inquiry.
do $registration_empty_subject_list_visibility$
declare
  v_identity pg_catalog.regprocedure;
  v_definition text;
  v_original text;
  v_join_needle text := E'\n    from common\n    left join public.ops_registration_details detail on detail.task_id = common.id\n    join lateral (';
  v_join_replacement text := E'\n    from common\n    left join public.ops_registration_details detail on detail.task_id = common.id\n    left join lateral (';
  v_where_needle text := E'    where p_type = ''registration''\n';
  v_where_replacement text := E'    where p_type = ''registration''\n'
    || E'      and (\n'
    || E'        matching_track.matching_track_id is not null\n'
    || E'        or (\n'
    || E'          p_filters ->> ''view'' = ''inquiry''\n'
    || E'          and not exists (\n'
    || E'            select 1\n'
    || E'            from public.ops_registration_subject_track_summaries active_track\n'
    || E'            where active_track.task_id = common.id\n'
    || E'          )\n'
    || E'          and (\n'
    || E'            nullif(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(p_filters ->> ''search'')), ''[[:space:]-]+'', '''', ''g''), '''') is null\n'
    || E'            or pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.concat_ws('' '', common.student_name, common.title, detail.parent_phone, detail.student_phone, detail.school_grade, detail.school_name, detail.request_note)), ''[[:space:]-]+'', '''', ''g'') like ''%'' || pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(p_filters ->> ''search'')), ''[[:space:]-]+'', '''', ''g'') || ''%''\n'
    || E'          )\n'
    || E'        )\n'
    || E'      )\n';
begin
  foreach v_identity in array array[
    'dashboard_private.ops_task_page_source_v1(text,jsonb)'::pg_catalog.regprocedure,
    'dashboard_private.ops_task_numbered_keys_v1(text,jsonb)'::pg_catalog.regprocedure
  ]
  loop
    v_definition := pg_catalog.pg_get_functiondef(v_identity);
    v_original := v_definition;
    v_definition := pg_catalog.replace(
      v_definition,
      v_join_needle,
      v_join_replacement
    );
    v_definition := pg_catalog.replace(
      v_definition,
      v_where_needle,
      v_where_replacement
    );
    if v_definition = v_original
      or v_definition not like '%left join lateral (%'
      or v_definition not like '%matching_track.matching_track_id is not null%'
      or v_definition not like '%active_track.task_id = common.id%'
    then
      raise exception 'registration_empty_subject_list_patch_failed'
        using errcode = '55000';
    end if;
    execute v_definition;
  end loop;
end;
$registration_empty_subject_list_visibility$;

create or replace function dashboard_private.record_registration_management_notification_v1(
  p_source_event_id uuid,
  p_event_key text,
  p_task_id uuid,
  p_track_id uuid,
  p_source_revision bigint,
  p_occurred_at timestamptz,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.ops_tasks%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_registration_source record;
  v_subjects text[] := array[]::text[];
  v_actor_name text;
  v_status_label text;
  v_payload jsonb;
begin
  if p_source_event_id is null
    or p_task_id is null
    or p_track_id is null
    or p_occurred_at is null
    or p_event_key not in (
      'registration.case_created',
      'registration.consultation_completed',
      'registration.waiting_transitioned',
      'registration.admission_started'
    )
  then
    raise exception 'registration_management_notification_invalid'
      using errcode = '22023';
  end if;

  select task, track, detail
  into v_registration_source
  from public.ops_tasks task
  join public.ops_registration_subject_tracks track
    on track.task_id = task.id
   and track.id = p_track_id
   and track.archived_at is null
  join public.ops_registration_details detail on detail.task_id = task.id
  where task.id = p_task_id
    and task.type = 'registration';
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  v_task := v_registration_source.task;
  v_track := v_registration_source.track;
  v_detail := v_registration_source.detail;

  select coalesce(
    pg_catalog.array_agg(
      track.subject
      order by
        dashboard_private.registration_subject_sort_order(track.subject),
        track.id
    ),
    array[]::text[]
  )
  into v_subjects
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
    and track.archived_at is null;

  select coalesce(nullif(profile.name, ''), nullif(profile.email, ''))
  into v_actor_name
  from public.profiles profile
  where profile.id = p_actor_profile_id;

  v_status_label := case p_event_key
    when 'registration.case_created' then '상담 신청'
    when 'registration.consultation_completed' then '상담 완료'
    when 'registration.waiting_transitioned' then '대기 신청'
    when 'registration.admission_started' then '등록 신청'
  end;

  v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'task_id', v_task.id,
    'track_id', v_track.id,
    'student_name', v_task.student_name,
    'grade', v_detail.school_grade,
    'subject', v_track.subject,
    'inquiry_at', v_detail.inquiry_at,
    'status', v_track.pipeline_status,
    'workflow_status', v_track.workflow_status,
    'current_status', v_status_label,
    'requester_profile_id', v_task.requested_by,
    'director_profile_id', v_track.director_profile_id,
    'memo', nullif(pg_catalog.btrim(coalesce(v_detail.request_note, '')), ''),
    'actor_name', v_actor_name,
    'actor_kind', case
      when p_actor_profile_id is null then 'system'
      else 'user'
    end,
    'source_event_id', p_source_event_id,
    'occurred_at', p_occurred_at
  )) || pg_catalog.jsonb_build_object(
    'subjects', pg_catalog.to_jsonb(v_subjects),
    'progress_line', case
      when nullif(v_actor_name, '') is null
        then '[진행] 관리팀 확인을 기다리고 있어요.'
      else '[진행] ' || v_actor_name || '님이 '
        || v_status_label || ' 상태로 변경했어요.'
    end,
    'memo_line', case
      when nullif(pg_catalog.btrim(coalesce(v_detail.request_note, '')), '') is null
        then ''
      else '[메모] ' || pg_catalog.btrim(v_detail.request_note)
    end
  );

  perform dashboard_private.record_notification_event_v1(
    'global',
    'registration',
    p_event_key,
    'ops_task_event',
    p_source_event_id::text,
    p_source_revision,
    p_source_event_id::text,
    p_actor_profile_id,
    p_occurred_at,
    case when p_event_key = 'registration.case_created' then 1 else 2 end,
    v_payload,
    null,
    null
  );

  return p_source_event_id;
end;
$$;

alter function dashboard_private.record_registration_management_notification_v1(
  uuid, text, uuid, uuid, bigint, timestamptz, uuid
) owner to postgres;
revoke all on function dashboard_private.record_registration_management_notification_v1(
  uuid, text, uuid, uuid, bigint, timestamptz, uuid
) from public, anon, authenticated, service_role;

create or replace function public.ensure_registration_workflow_notification_v1(
  p_track_id uuid,
  p_workflow_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task public.ops_tasks%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_registration_source record;
  v_source public.ops_task_events%rowtype;
  v_event_key text;
  v_missing_fields text[] := array[]::text[];
  v_source_event_id uuid;
begin
  if v_actor is null
    or p_track_id is null
    or p_workflow_revision is null
    or p_workflow_revision < 1
  then
    raise exception 'registration_management_notification_access_denied'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles actor
    join auth.users account
      on account.id = actor.id
     and account.deleted_at is null
     and (
       account.banned_until is null
       or account.banned_until <= pg_catalog.now()
     )
    where actor.id = v_actor
      and actor.role in ('admin', 'staff')
  ) then
    raise exception 'registration_management_notification_access_denied'
      using errcode = '42501';
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
  for update of task, track;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  v_task := v_registration_source.task;
  v_track := v_registration_source.track;
  v_detail := v_registration_source.detail;

  if v_track.workflow_revision <> p_workflow_revision then
    raise exception 'registration_management_notification_refresh_required'
      using errcode = '23514';
  end if;

  v_event_key := case
    when v_track.workflow_status = 'consultation_requested'
      then 'registration.case_created'
    when v_track.workflow_status = 'consultation_completed'
      then 'registration.consultation_completed'
    when v_track.workflow_status in (
      'waiting_current_class',
      'waiting_new_class',
      'waiting_next_opening'
    ) then 'registration.waiting_transitioned'
    when v_track.workflow_status = 'enrollment_requested'
      then 'registration.admission_started'
    else null
  end;
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'registration-workflow-chat:'
      || v_track.id::text
      || ':'
      || v_track.workflow_revision::text
      || ':'
      || v_event_key,
    0
  ));

  with parsed_source_events as materialized (
    select
      event_row as source_event,
      dashboard_private.try_registration_event_jsonb_object(
        event_row.after_value
      ) as payload
    from public.ops_task_events event_row
    where event_row.task_id = v_track.task_id
      and event_row.event_type = 'registration_track_event'
      and event_row.field_name =
        'registration_track:' || v_track.id::text
  )
  select (parsed.source_event).*
  into v_source
  from parsed_source_events parsed
  where (parsed.payload ->> 'event_type') in (
      'registration_management_notification_requested',
      'registration_workflow_status_changed'
    )
    and parsed.payload ->> 'destination' = v_track.workflow_status
    and case
      when parsed.payload -> 'metadata' ->> 'workflowRevision'
        ~ '^[1-9][0-9]*$'
      then (
        parsed.payload -> 'metadata' ->> 'workflowRevision'
      )::integer
      else null
    end = v_track.workflow_revision
    and coalesce(
      parsed.payload -> 'metadata' ->> 'eventKey',
      v_event_key
    ) = v_event_key
  order by
    case when parsed.payload ->> 'event_type'
      = 'registration_management_notification_requested'
      then 0
      else 1
    end,
    (parsed.source_event).created_at desc,
    (parsed.source_event).id desc
  limit 1;

  if not found then
    v_source_event_id := dashboard_private.write_registration_track_event_v2(
      v_track.task_id,
      v_track.id,
      'registration_management_notification_requested',
      v_track.workflow_status,
      v_track.workflow_status,
      'manual_notification',
      pg_catalog.jsonb_build_object(
        'workflowStatus', v_track.workflow_status,
        'workflowRevision', v_track.workflow_revision,
        'eventKey', v_event_key
      ),
      'user',
      null
    );
    select event_row.*
    into strict v_source
    from public.ops_task_events event_row
    where event_row.id = v_source_event_id;
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

  return pg_catalog.jsonb_build_object(
    'trackId', v_track.id,
    'workflowRevision', v_track.workflow_revision,
    'sourceEventIds', pg_catalog.jsonb_build_array(v_source.id),
    'ready', true,
    'missingFields', '[]'::jsonb
  );
end;
$$;

alter function public.ensure_registration_workflow_notification_v1(uuid, integer)
  owner to postgres;
revoke all on function public.ensure_registration_workflow_notification_v1(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.ensure_registration_workflow_notification_v1(uuid, integer)
  to authenticated;

-- The explicit Google Chat adapter reads this plan immediately before its
-- provider call. A canonical event queued while the track was active becomes
-- an empty no-send plan if the track has since been archived.
do $registration_archived_legacy_dispatch_guard$
declare
  v_definition text;
  v_original text;
  v_needle text := E'  if not found then\n    raise exception ''registration_core_canonical_event_not_found'' using errcode = ''P0002'';\n  end if;\n\n  v_current_status := case v_canonical.event_key';
  v_replacement text := E'  if not found then\n    raise exception ''registration_core_canonical_event_not_found'' using errcode = ''P0002'';\n  end if;\n\n  if nullif(v_canonical.payload ->> ''track_id'', '''') is not null\n    and not exists (\n      select 1\n      from public.ops_registration_subject_tracks active_track\n      where active_track.id = dashboard_private.try_registration_event_uuid(\n          v_canonical.payload ->> ''track_id''\n        )\n        and active_track.task_id = v_task.id\n        and active_track.archived_at is null\n    )\n  then\n    return pg_catalog.jsonb_build_object(\n      ''sourceEventId'', p_source_event_id,\n      ''taskId'', v_task.id,\n      ''items'', ''[]''::jsonb\n    );\n  end if;\n\n  v_current_status := case v_canonical.event_key';
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.get_registration_core_legacy_dispatch_plan_v1(uuid,uuid)'::pg_catalog.regprocedure
  );
  v_original := v_definition;
  v_definition := pg_catalog.replace(v_definition, v_needle, v_replacement);
  if v_definition = v_original
    or v_definition not like '%active_track.archived_at is null%'
    or v_definition not like '%''items'', ''[]''::jsonb%'
  then
    raise exception 'registration_archived_legacy_dispatch_guard_failed'
      using errcode = '55000';
  end if;
  execute v_definition;
end;
$registration_archived_legacy_dispatch_guard$;

notify pgrst, 'reload schema';

commit;
