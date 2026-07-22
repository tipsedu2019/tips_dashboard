begin;

set local lock_timeout = '5s';

lock table public.ops_registration_subject_tracks in share row exclusive mode;

alter table public.ops_registration_subject_tracks
  drop constraint if exists ops_registration_subject_tracks_subject_check;

alter table public.ops_registration_subject_tracks
  add constraint ops_registration_subject_tracks_subject_check
  check (subject in ('영어', '수학', '과학'));

create or replace function dashboard_private.registration_subject_sort_order(
  p_subject text
)
returns integer
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_sort_order integer;
begin
  v_sort_order := case nullif(pg_catalog.btrim(p_subject), '')
    when '영어' then 10
    when '수학' then 20
    when '과학' then 30
    else null
  end;
  if v_sort_order is null then
    raise exception 'registration_subject_unsupported' using errcode = '22023';
  end if;
  return v_sort_order;
end;
$$;

create or replace function dashboard_private.assert_registration_subject_enabled(
  p_subject text,
  p_school_grade text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subject text := nullif(pg_catalog.btrim(p_subject), '');
  v_grade text := pg_catalog.regexp_replace(coalesce(p_school_grade, ''), '\s+', '', 'g');
begin
  if v_subject is null or v_subject not in ('영어', '수학', '과학') then
    raise exception 'registration_subject_unsupported' using errcode = '22023';
  end if;

  if v_subject = '과학' and v_grade not in ('고1', '고2', '고3') then
    raise exception 'registration_science_grade_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.academic_subject_settings setting
    where setting.subject = v_subject
      and setting.is_active = true
      and setting.registration_create_enabled = true
      and v_grade = any(setting.grade_levels)
  ) then
    raise exception 'registration_subject_disabled' using errcode = '40001';
  end if;
end;
$$;

create or replace function dashboard_private.is_active_subject_director(
  p_profile_id uuid,
  p_subject text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case nullif(pg_catalog.btrim(p_subject), '')
    when '영어' then dashboard_private.is_active_registration_director(p_profile_id)
    when '수학' then dashboard_private.is_active_registration_director(p_profile_id)
    when '과학' then
      p_profile_id is not null
      and exists (
        select 1
        from public.academic_subject_settings setting
        where setting.subject = '과학'
          and setting.default_director_profile_id = p_profile_id
      )
      and dashboard_private.academic_subject_director_candidate_is_active_v1(
        p_profile_id,
        '과학'
      )
    else false
  end;
$$;

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
begin
  if (select auth.uid()) is null then
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
            (p_action = 'complete_withdrawal_roster_transition' and task.type = 'withdrawal')
            or (p_action = 'complete_transfer_roster_transition' and task.type = 'transfer')
          )
      )
      or coalesce(public.current_dashboard_role(), '') not in ('admin', 'staff')
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
  ) then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  if p_action = 'complete_consultation' then
    if exists (
      select 1
      from public.ops_registration_subject_tracks track
      where track.id = p_track_id
        and track.task_id = p_task_id
        and track.director_profile_id = (select auth.uid())
        and dashboard_private.is_active_subject_director(
          (select auth.uid()),
          track.subject
        )
    ) then
      return;
    end if;
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  if public.current_dashboard_role() in ('admin', 'staff') then
    return;
  end if;

  raise exception 'registration_access_denied' using errcode = '42501';
end;
$$;

create or replace function dashboard_private.resolve_registration_default_director(
  p_subject text,
  p_school_grade text,
  p_inquiry_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subject text := nullif(pg_catalog.btrim(p_subject), '');
  v_grade text := pg_catalog.regexp_replace(coalesce(p_school_grade, ''), '\s+', '', 'g');
  v_effective_year integer;
  v_phase integer;
  v_owner_index integer;
  v_director_name text;
  v_profile_id uuid;
  v_match_count integer;
  v_rule_key text;
begin
  if p_inquiry_at is null then
    return pg_catalog.jsonb_build_object(
      'status', 'unavailable', 'profileId', null, 'ruleKey', null,
      'directorName', null, 'effectiveYear', null
    );
  end if;

  v_effective_year := extract(
    year from p_inquiry_at at time zone 'Asia/Seoul'
  )::integer;

  if v_subject = '과학' then
    if v_grade not in ('고1', '고2', '고3') then
      return pg_catalog.jsonb_build_object(
        'status', 'unavailable', 'profileId', null, 'ruleKey', null,
        'directorName', null, 'effectiveYear', v_effective_year
      );
    end if;

    select setting.default_director_profile_id, profile.name
    into v_profile_id, v_director_name
    from public.academic_subject_settings setting
    left join public.profiles profile
      on profile.id = setting.default_director_profile_id
    where setting.subject = '과학';

    if v_profile_id is null
      or not dashboard_private.is_active_subject_director(v_profile_id, v_subject)
    then
      return pg_catalog.jsonb_build_object(
        'status', 'unavailable', 'profileId', null, 'ruleKey', null,
        'directorName', v_director_name, 'effectiveYear', v_effective_year
      );
    end if;

    v_rule_key := 'subject-director-v1:' || v_subject || ':' || v_profile_id::text;
    return pg_catalog.jsonb_build_object(
      'status', 'resolved',
      'profileId', v_profile_id,
      'ruleKey', v_rule_key,
      'directorName', v_director_name,
      'effectiveYear', v_effective_year
    );
  end if;

  if v_subject = '수학' then
    if v_grade ~ '^(초[1-6]|중[1-3])$' then
      v_director_name := '강정은';
    elsif v_grade ~ '^고[1-3]$' then
      v_director_name := '양소윤';
    end if;
  elsif v_subject = '영어' then
    v_phase := case v_grade
      when '초4' then 0 when '중1' then 0 when '고1' then 0
      when '초5' then 1 when '중2' then 1 when '고2' then 1
      when '초6' then 2 when '중3' then 2 when '고3' then 2
      else null
    end;
    if v_phase is not null then
      v_owner_index := (((v_phase - (v_effective_year - 2026)) % 3) + 3) % 3;
      v_director_name := case v_owner_index
        when 0 then '강부희'
        when 1 then '정보영'
        when 2 then '김민경'
      end;
    end if;
  end if;

  if v_director_name is null then
    return pg_catalog.jsonb_build_object(
      'status', 'unavailable', 'profileId', null, 'ruleKey', null,
      'directorName', null, 'effectiveYear', v_effective_year
    );
  end if;

  select pg_catalog.count(*), (pg_catalog.array_agg(candidate.profile_id order by candidate.profile_id))[1]
  into v_match_count, v_profile_id
  from (
    select distinct profile.id as profile_id
    from public.teacher_catalogs teacher
    join public.profiles profile on profile.id = teacher.profile_id
    where teacher.name = v_director_name
      and teacher.is_visible = true
      and profile.role = 'admin'
  ) candidate;

  if v_match_count <> 1 then
    return pg_catalog.jsonb_build_object(
      'status', 'unavailable', 'profileId', null, 'ruleKey', null,
      'directorName', v_director_name, 'effectiveYear', v_effective_year
    );
  end if;

  v_rule_key := 'academic-director-v1:' || v_effective_year::text || ':' || v_subject || ':' || v_grade;
  return pg_catalog.jsonb_build_object(
    'status', 'resolved',
    'profileId', v_profile_id,
    'ruleKey', v_rule_key,
    'directorName', v_director_name,
    'effectiveYear', v_effective_year
  );
end;
$$;

create or replace function dashboard_private.assert_registration_track_director_ready(
  p_track_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_source text;
  v_rule_key text;
  v_subject text;
  v_grade text;
  v_inquiry_at timestamptz;
  v_resolution jsonb;
begin
  select
    track.director_profile_id,
    track.director_assignment_source,
    track.director_assignment_rule_key,
    track.subject,
    detail.school_grade,
    detail.inquiry_at
  into
    v_profile_id,
    v_source,
    v_rule_key,
    v_subject,
    v_grade,
    v_inquiry_at
  from public.ops_registration_subject_tracks track
  join public.ops_registration_details detail on detail.task_id = track.task_id
  where track.id = p_track_id
  for update of track;

  if not found
    or not dashboard_private.is_active_subject_director(v_profile_id, v_subject)
  then
    raise exception 'registration_director_refresh_required' using errcode = '40001';
  end if;

  if v_source = 'default' then
    v_resolution := dashboard_private.resolve_registration_default_director(
      v_subject, v_grade, v_inquiry_at
    );
    if v_resolution ->> 'status' <> 'resolved'
      or (v_resolution ->> 'profileId')::uuid is distinct from v_profile_id
      or v_resolution ->> 'ruleKey' is distinct from v_rule_key
    then
      raise exception 'registration_director_refresh_required' using errcode = '40001';
    end if;
  elsif v_source not in ('manual', 'migration') then
    raise exception 'registration_director_refresh_required' using errcode = '40001';
  end if;
end;
$$;

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
  ) or not exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
  ) then
    raise exception 'registration_subject_track_coverage_mismatch' using errcode = '23514';
  end if;

  with tracks as (
    select track.*,
      dashboard_private.registration_subject_sort_order(track.subject) as subject_order,
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
      track.pipeline_status in ('registered', 'not_registered', 'inquiry_closed') as terminal
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
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
    order by batch.revision_number desc, batch.id desc
    limit 1
  ), values_to_project as (
    select
      case
        when stats.all_inquiry and not open_batch.present then 'requested'
        when stats.all_terminal and not open_batch.present and stats.any_registered then 'done'
        when stats.all_terminal and not open_batch.present then 'canceled'
        else 'in_progress'
      end as parent_status,
      (
        select pg_catalog.string_agg(track.subject, ', ' order by track.subject_order, track.id)
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
      enrollment_stats.enrollment_count > 0 and enrollment_stats.all_makeedu as makeedu_registered,
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

create or replace function dashboard_private.create_registration_case_impl(
  p_student_name text,
  p_school_grade text,
  p_school_name text,
  p_parent_phone text,
  p_student_phone text,
  p_campus text,
  p_inquiry_at timestamptz,
  p_subjects text[],
  p_request_note text,
  p_priority text,
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
  v_student_name text := nullif(pg_catalog.btrim(p_student_name), '');
  v_school_grade text := nullif(pg_catalog.btrim(p_school_grade), '');
  v_school_name text := nullif(pg_catalog.btrim(p_school_name), '');
  v_parent_phone text := nullif(pg_catalog.btrim(p_parent_phone), '');
  v_student_phone text := nullif(pg_catalog.btrim(p_student_phone), '');
  v_campus text := nullif(pg_catalog.btrim(p_campus), '');
  v_request_note text := nullif(pg_catalog.btrim(p_request_note), '');
  v_priority text := nullif(pg_catalog.btrim(p_priority), '');
  v_parent_phone_digits text;
  v_subjects text[];
  v_task_id uuid;
  v_target_fingerprint jsonb;
  v_legacy_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_subject text;
begin
  if v_actor_id is null
    or (public.current_dashboard_role() in ('admin', 'staff')) is not true
  then
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
    from pg_catalog.unnest(coalesce(p_subjects, array[]::text[])) input(value)
    where nullif(pg_catalog.btrim(input.value), '') is not null
  ) subject;
  if pg_catalog.cardinality(v_subjects) = 0 then
    raise exception 'registration_subjects_required' using errcode = '22023';
  end if;
  if pg_catalog.cardinality(v_subjects) not between 1 and 3 then
    raise exception 'registration_subject_invalid' using errcode = '22023';
  end if;
  if v_student_name is null then
    raise exception 'registration_student_name_required' using errcode = '22023';
  end if;
  if v_school_grade is null then
    raise exception 'registration_school_grade_required' using errcode = '22023';
  end if;
  v_parent_phone_digits := pg_catalog.regexp_replace(coalesce(v_parent_phone, ''), '\D+', '', 'g');
  if v_parent_phone_digits !~ '^01(0|1|[6-9])[0-9]{7,8}$' then
    raise exception 'registration_parent_phone_invalid' using errcode = '22023';
  end if;
  if p_inquiry_at is null then
    raise exception 'registration_inquiry_at_required' using errcode = '22023';
  end if;
  if v_campus is null or v_campus not in ('본관', '별관') then
    raise exception 'registration_campus_invalid' using errcode = '22023';
  end if;
  if v_priority is null or v_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'registration_priority_invalid' using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'studentName', v_student_name,
    'schoolGrade', v_school_grade,
    'schoolName', v_school_name,
    'parentPhone', v_parent_phone,
    'studentPhone', v_student_phone,
    'campus', v_campus,
    'inquiryAt', p_inquiry_at,
    'subjects', pg_catalog.to_jsonb(v_subjects),
    'requestNote', v_request_note,
    'priority', v_priority
  );
  if not ('과학' = any(v_subjects)) then
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
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select
    mutation.response_payload,
    mutation.mutation_type = 'create_case'
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
  if v_receipt_found then return v_response; end if;

  foreach v_subject in array v_subjects
  loop
    perform dashboard_private.assert_registration_subject_enabled(
      v_subject,
      v_school_grade
    );
  end loop;

  insert into public.ops_tasks(
    title, type, status, priority, requested_by, student_id,
    student_name, campus, subject, memo
  ) values (
    '등록: ' || v_student_name,
    'registration',
    'requested',
    v_priority,
    v_actor_id,
    null,
    v_student_name,
    v_campus,
    pg_catalog.array_to_string(v_subjects, ', '),
    null
  ) returning id into v_task_id;

  insert into public.ops_registration_details(
    task_id, inquiry_at, school_grade, school_name, parent_phone,
    student_phone, request_note, pipeline_status, common_revision
  ) values (
    v_task_id, p_inquiry_at, v_school_grade, v_school_name, v_parent_phone,
    v_student_phone, v_request_note, '0. 등록 문의', 1
  );

  insert into public.ops_registration_subject_tracks(
    task_id, subject, pipeline_status, migration_review_required
  )
  select v_task_id, subject.value, 'inquiry', false
  from pg_catalog.unnest(v_subjects) subject(value)
  order by dashboard_private.registration_subject_sort_order(subject.value);

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value
  ) values (
    v_task_id,
    v_actor_id,
    'registration_case_created',
    'registration_case',
    null,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'actorId', v_actor_id,
      'subjects', pg_catalog.to_jsonb(v_subjects),
      'occurredAt', pg_catalog.now()
    )::text
  );

  perform dashboard_private.recompute_registration_parent(v_task_id);

  select pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'commonRevision', 1,
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
        ) order by dashboard_private.registration_subject_sort_order(track.subject), track.id
      ),
      '[]'::jsonb
    )
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id;

  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'create_case', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.assign_registration_track_director_impl(
  p_track_id uuid,
  p_director_profile_id uuid,
  p_assignment_source text,
  p_rule_key text,
  p_expected_common_revision integer,
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
  v_assignment_source text := nullif(pg_catalog.btrim(p_assignment_source), '');
  v_rule_key text := nullif(pg_catalog.btrim(p_rule_key), '');
  v_task_id uuid;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_resolution jsonb;
  v_visit_appointment_id uuid;
  v_phone_consultation_id uuid;
  v_phone_director_id uuid;
  v_track_id uuid;
  v_notification_id uuid;
  v_notification_dedupe_key text;
  v_event_type text;
  v_next_source text;
  v_next_rule_key text;
  v_next_assigned_at timestamptz;
  v_assignment_changed boolean;
  v_phone_created boolean := false;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_assignment_source is null
    or v_assignment_source not in ('default', 'manual', 'clear_default')
  then
    raise exception 'registration_director_assignment_source_invalid' using errcode = '22023';
  end if;
  if p_expected_common_revision is null or p_expected_common_revision <= 0 then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', null,
    'trackId', p_track_id,
    'directorProfileId', p_director_profile_id,
    'assignmentSource', v_assignment_source,
    'ruleKey', v_rule_key,
    'expectedCommonRevision', p_expected_common_revision
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select track.task_id
  into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_target_fingerprint := pg_catalog.jsonb_set(
    v_target_fingerprint, '{taskId}', pg_catalog.to_jsonb(v_task_id), true
  );

  select task.*
  into v_task
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select detail.*
  into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  select consultation.appointment_id
  into v_visit_appointment_id
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
    and consultation.mode = 'visit'
    and consultation.status = 'scheduled'
  order by consultation.id
  limit 1;
  if v_visit_appointment_id is not null then
    perform 1
    from public.ops_registration_appointments appointment
    where appointment.id = v_visit_appointment_id
    for update;
  end if;
  perform 1
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
    and consultation.status in ('waiting', 'scheduled')
  order by consultation.id
  for update;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, p_track_id, 'assign_director'
  );
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'assign_director'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;
  if v_detail.common_revision <> p_expected_common_revision then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
  end if;
  if v_track.pipeline_status in ('registered', 'not_registered', 'inquiry_closed') then
    raise exception 'registration_director_assignment_terminal' using errcode = '40001';
  end if;
  if v_visit_appointment_id is not null then
    raise exception 'registration_visit_reassign_requires_reschedule' using errcode = '40001';
  end if;

  v_resolution := dashboard_private.resolve_registration_default_director(
    v_track.subject, v_detail.school_grade, v_detail.inquiry_at
  );
  if v_assignment_source = 'default' then
    if p_director_profile_id is null or v_rule_key is null
      or v_track.director_assignment_source is not null
        and v_track.director_assignment_source <> 'default'
      or v_resolution ->> 'status' <> 'resolved'
      or nullif(v_resolution ->> 'profileId', '')::uuid is distinct from p_director_profile_id
      or v_resolution ->> 'ruleKey' is distinct from v_rule_key
    then
      raise exception 'registration_director_default_stale' using errcode = '40001';
    end if;
    if not dashboard_private.is_active_subject_director(p_director_profile_id, v_track.subject) then
      raise exception 'registration_director_refresh_required' using errcode = '40001';
    end if;
    v_next_source := 'default';
    v_next_rule_key := v_rule_key;
    v_event_type := 'director_default_resolved';
  elsif v_assignment_source = 'manual' then
    if p_director_profile_id is null or v_rule_key is not null then
      raise exception 'registration_director_manual_invalid' using errcode = '22023';
    end if;
    if not dashboard_private.is_active_subject_director(p_director_profile_id, v_track.subject) then
      raise exception 'registration_director_refresh_required' using errcode = '40001';
    end if;
    v_next_source := 'manual';
    v_next_rule_key := null;
    v_event_type := 'director_manual_override';
  else
    if p_director_profile_id is not null or v_rule_key is not null
      or v_track.director_assignment_source is not null
        and v_track.director_assignment_source <> 'default'
    then
      raise exception 'registration_director_clear_denied' using errcode = '40001';
    end if;
    if v_resolution ->> 'status' = 'resolved' then
      raise exception 'registration_director_default_stale' using errcode = '40001';
    end if;
    v_next_source := null;
    v_next_rule_key := null;
    v_event_type := 'director_default_cleared';
  end if;

  v_assignment_changed :=
    v_track.director_profile_id is distinct from p_director_profile_id
    or v_track.director_assignment_source is distinct from v_next_source
    or v_track.director_assignment_rule_key is distinct from v_next_rule_key;
  v_next_assigned_at := case
    when p_director_profile_id is null then null
    when v_assignment_changed then pg_catalog.now()
    else v_track.director_assigned_at
  end;
  if v_assignment_changed then
    update public.ops_registration_subject_tracks
    set
      director_profile_id = p_director_profile_id,
      director_assignment_source = v_next_source,
      director_assignment_rule_key = v_next_rule_key,
      director_assigned_at = v_next_assigned_at,
      updated_at = pg_catalog.now()
    where id = p_track_id;
  end if;

  select consultation.id, consultation.director_profile_id
  into v_phone_consultation_id, v_phone_director_id
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
    and consultation.mode = 'phone'
    and consultation.status = 'waiting'
  order by consultation.id
  limit 1
  for update;

  if p_director_profile_id is not null then
    if v_phone_consultation_id is not null then
      delete from public.dashboard_notifications notification
      where notification.type = 'registration_consultation'
        and notification.read_at is null
        and notification.recipient_profile_id is distinct from p_director_profile_id
        and notification.dedupe_key =
          'registration:' || v_task_id::text || ':track:' || p_track_id::text
          || ':consultation:' || v_phone_consultation_id::text
          || ':director:' || v_phone_director_id::text;
      if v_phone_director_id is distinct from p_director_profile_id then
        update public.ops_registration_consultations
        set director_profile_id = p_director_profile_id,
            updated_at = pg_catalog.now()
        where id = v_phone_consultation_id;
      end if;
    elsif v_track.pipeline_status = 'consultation_waiting' then
      insert into public.ops_registration_consultations(
        track_id, appointment_id, mode, status, director_profile_id,
        ready_at, ready_source
      ) values (
        p_track_id, null, 'phone', 'waiting', p_director_profile_id,
        v_track.stage_entered_at, 'director_resolved'
      ) returning id into v_phone_consultation_id;
      v_phone_created := true;
    end if;

    if v_phone_consultation_id is not null then
      v_notification_dedupe_key :=
        'registration:' || v_task_id::text || ':track:' || p_track_id::text
        || ':consultation:' || v_phone_consultation_id::text
        || ':director:' || p_director_profile_id::text;
      insert into public.dashboard_notifications as existing(
        recipient_profile_id, recipient_team, actor_profile_id, type,
        title, body, href, metadata, dedupe_key
      ) values (
        p_director_profile_id,
        null,
        v_actor_id,
        'registration_consultation',
        '[' || v_track.subject || '] 전화상담 대기',
        v_task.student_name || ' 학생 상담을 확인하세요.',
        '/admin/registration?taskId=' || v_task_id::text || '&trackId=' || p_track_id::text,
        pg_catalog.jsonb_build_object(
          'taskId', v_task_id,
          'trackId', p_track_id,
          'consultationId', v_phone_consultation_id,
          'subject', v_track.subject,
          'directorProfileId', p_director_profile_id
        ),
        v_notification_dedupe_key
      )
      on conflict (dedupe_key) do update
      set
        recipient_profile_id = excluded.recipient_profile_id,
        recipient_team = excluded.recipient_team,
        actor_profile_id = excluded.actor_profile_id,
        type = excluded.type,
        title = excluded.title,
        body = excluded.body,
        href = excluded.href,
        metadata = excluded.metadata,
        read_at = null,
        created_at = pg_catalog.now()
      where v_track.director_profile_id is distinct from p_director_profile_id
      returning existing.id into v_notification_id;
      if v_notification_id is null then
        select notification.id
        into v_notification_id
        from public.dashboard_notifications notification
        where notification.dedupe_key = v_notification_dedupe_key;
      end if;
    end if;
  elsif v_phone_consultation_id is not null then
    delete from public.dashboard_notifications notification
    where notification.type = 'registration_consultation'
      and notification.read_at is null
      and notification.dedupe_key =
        'registration:' || v_task_id::text || ':track:' || p_track_id::text
        || ':consultation:' || v_phone_consultation_id::text
        || ':director:' || v_phone_director_id::text;
  end if;

  if v_assignment_changed then
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      p_track_id,
      v_event_type,
      coalesce(v_track.director_assignment_source, 'unassigned'),
      coalesce(v_next_source, 'unassigned'),
      null,
      pg_catalog.jsonb_build_object(
        'previousDirectorProfileId', v_track.director_profile_id,
        'directorProfileId', p_director_profile_id,
        'ruleKey', v_next_rule_key,
        'consultationId', v_phone_consultation_id,
        'notificationDedupeKey', v_notification_dedupe_key
      )
    );
  elsif v_phone_created then
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      p_track_id,
      'director_phone_queue_repaired',
      v_track.pipeline_status,
      v_track.pipeline_status,
      null,
      pg_catalog.jsonb_build_object(
        'directorProfileId', p_director_profile_id,
        'consultationId', v_phone_consultation_id,
        'notificationDedupeKey', v_notification_dedupe_key
      )
    );
  end if;

  perform dashboard_private.recompute_registration_parent(v_task_id);
  select pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'commonRevision', v_detail.common_revision,
    'trackId', track.id,
    'subject', track.subject,
    'status', track.pipeline_status,
    'directorProfileId', track.director_profile_id,
    'directorAssignmentSource', track.director_assignment_source,
    'directorAssignmentRuleKey', track.director_assignment_rule_key,
    'directorAssignedAt', track.director_assigned_at,
    'consultationId', v_phone_consultation_id,
    'notificationId', v_notification_id,
    'notificationDedupeKey', v_notification_dedupe_key,
    'requiresDirectorAssignment', track.director_profile_id is null
  )
  into v_response
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;

  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'assign_director', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;


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
  v_legacy_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_track record;
  v_remaining_count integer;
  v_school_grade text;
  v_subject text;
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
    from pg_catalog.unnest(coalesce(p_subjects, array[]::text[])) input(value)
    where nullif(pg_catalog.btrim(input.value), '') is not null
  ) subject;
  if pg_catalog.cardinality(v_subjects) = 0 then
    raise exception 'registration_last_subject_required' using errcode = '22023';
  end if;
  if pg_catalog.cardinality(v_subjects) not between 1 and 3 then
    raise exception 'registration_subject_invalid' using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'subjects', pg_catalog.to_jsonb(v_subjects)
  );
  if not ('과학' = any(v_subjects)) then
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
  select detail.school_grade
  into v_school_grade
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

  foreach v_subject in array v_subjects
  loop
    perform dashboard_private.assert_registration_subject_enabled(
      v_subject,
      v_school_grade
    );
  end loop;

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
  order by dashboard_private.registration_subject_sort_order(subject.value);

  select pg_catalog.count(*)
  into v_remaining_count
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id;
  if v_remaining_count not between 1 and 3
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
        ) order by dashboard_private.registration_subject_sort_order(track.subject), track.id
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

create or replace function dashboard_private.update_registration_case_common_impl(
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
  v_student_name text := nullif(pg_catalog.btrim(p_student_name), '');
  v_school_grade text := nullif(pg_catalog.btrim(p_school_grade), '');
  v_school_name text := nullif(pg_catalog.btrim(p_school_name), '');
  v_parent_phone text := nullif(pg_catalog.btrim(p_parent_phone), '');
  v_student_phone text := nullif(pg_catalog.btrim(p_student_phone), '');
  v_campus text := nullif(pg_catalog.btrim(p_campus), '');
  v_request_note text := nullif(pg_catalog.btrim(p_request_note), '');
  v_priority text := nullif(pg_catalog.btrim(p_priority), '');
  v_parent_phone_digits text;
  v_task public.ops_tasks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_student public.students%rowtype;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_identity_changed boolean;
  v_identity_frozen boolean;
  v_student_matches boolean := false;
  v_clear_student_link boolean := false;
  v_next_revision integer;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_student_name is null then
    raise exception 'registration_student_name_required' using errcode = '22023';
  end if;
  if v_school_grade is null then
    raise exception 'registration_school_grade_required' using errcode = '22023';
  end if;
  v_parent_phone_digits := pg_catalog.regexp_replace(coalesce(v_parent_phone, ''), '\D+', '', 'g');
  if v_parent_phone_digits !~ '^01(0|1|[6-9])[0-9]{7,8}$' then
    raise exception 'registration_parent_phone_invalid' using errcode = '22023';
  end if;
  if p_inquiry_at is null then
    raise exception 'registration_inquiry_at_required' using errcode = '22023';
  end if;
  if v_campus is null or v_campus not in ('본관', '별관') then
    raise exception 'registration_campus_invalid' using errcode = '22023';
  end if;
  if v_priority is null or v_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'registration_priority_invalid' using errcode = '22023';
  end if;
  if p_expected_common_revision is null or p_expected_common_revision <= 0 then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
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
    'expectedCommonRevision', p_expected_common_revision
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select task.*
  into v_task
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
  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'update_common'
  );

  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'update_common'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;
  if v_detail.common_revision <> p_expected_common_revision then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.ops_registration_subject_tracks track
    where track.task_id = p_task_id
      and track.subject = '과학'
  ) and pg_catalog.regexp_replace(v_school_grade, '\s+', '', 'g')
    not in ('고1', '고2', '고3')
  then
    raise exception 'registration_science_grade_invalid' using errcode = '22023';
  end if;

  v_identity_changed :=
    pg_catalog.lower(pg_catalog.regexp_replace(coalesce(v_task.student_name, ''), '\s+', '', 'g'))
      is distinct from pg_catalog.lower(pg_catalog.regexp_replace(v_student_name, '\s+', '', 'g'))
    or nullif(pg_catalog.btrim(v_detail.school_name), '') is distinct from v_school_name
    or pg_catalog.regexp_replace(coalesce(v_detail.parent_phone, ''), '\D+', '', 'g')
      is distinct from v_parent_phone_digits
    or nullif(pg_catalog.regexp_replace(coalesce(v_detail.student_phone, ''), '\D+', '', 'g'), '')
      is distinct from nullif(pg_catalog.regexp_replace(coalesce(v_student_phone, ''), '\D+', '', 'g'), '');

  if v_task.student_id is not null then
    select student.*
    into v_student
    from public.students student
    where student.id = v_task.student_id
    for update;
    if not found then
      raise exception 'registration_student_identity_mismatch' using errcode = '23514';
    end if;
    v_student_matches :=
      pg_catalog.lower(pg_catalog.regexp_replace(coalesce(v_student.name, ''), '\s+', '', 'g'))
        = pg_catalog.lower(pg_catalog.regexp_replace(v_student_name, '\s+', '', 'g'))
      and nullif(pg_catalog.btrim(v_student.school), '') is not distinct from v_school_name
      and pg_catalog.regexp_replace(coalesce(v_student.parent_contact, ''), '\D+', '', 'g')
        = v_parent_phone_digits
      and nullif(pg_catalog.regexp_replace(coalesce(v_student.contact, ''), '\D+', '', 'g'), '')
        is not distinct from nullif(pg_catalog.regexp_replace(coalesce(v_student_phone, ''), '\D+', '', 'g'), '');
  end if;

  perform 1
  from public.ops_registration_admission_batches batch
  where batch.task_id = p_task_id
  order by batch.id
  for update;
  perform 1
  from public.ops_registration_enrollments enrollment
  join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
  where track.task_id = p_task_id
  order by enrollment.id
  for update of enrollment;
  perform 1
  from public.ops_registration_messages message
  where message.task_id = p_task_id
    and message.template_key = 'admission_application'
  order by message.id
  for update;

  v_identity_frozen :=
    v_detail.admission_notice_sent
    or exists (
      select 1
      from public.ops_registration_admission_batches batch
      where batch.task_id = p_task_id
    )
    or exists (
      select 1
      from public.ops_registration_enrollments enrollment
      join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
      where track.task_id = p_task_id
        and not (
          enrollment.status = 'planned'
          and enrollment.admission_batch_id is null
        )
    )
    or exists (
      select 1
      from public.ops_registration_messages message
      where message.task_id = p_task_id
        and message.template_key = 'admission_application'
        and message.claim_active
    );
  if v_identity_changed and v_identity_frozen then
    raise exception 'registration_student_identity_correction_required' using errcode = '40001';
  end if;
  v_clear_student_link := v_identity_changed
    and v_task.student_id is not null
    and not v_student_matches;

  update public.ops_tasks
  set
    student_name = v_student_name,
    title = '등록: ' || v_student_name,
    campus = v_campus,
    priority = v_priority,
    student_id = case when v_clear_student_link then null else student_id end,
    updated_at = pg_catalog.now()
  where id = p_task_id;

  update public.ops_registration_details
  set
    inquiry_at = p_inquiry_at,
    school_grade = v_school_grade,
    school_name = v_school_name,
    parent_phone = v_parent_phone,
    student_phone = v_student_phone,
    request_note = v_request_note,
    common_revision = common_revision + 1,
    updated_at = pg_catalog.now()
  where task_id = p_task_id
  returning common_revision into v_next_revision;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value
  ) values (
    p_task_id,
    v_actor_id,
    'registration_common_info_updated',
    'registration_common',
    pg_catalog.jsonb_build_object(
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
    )::text,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'commonRevision', v_next_revision,
      'studentName', v_student_name,
      'schoolGrade', v_school_grade,
      'schoolName', v_school_name,
      'parentPhone', v_parent_phone,
      'studentPhone', v_student_phone,
      'campus', v_campus,
      'inquiryAt', p_inquiry_at,
      'requestNote', v_request_note,
      'priority', v_priority,
      'occurredAt', pg_catalog.now()
    )::text
  );
  if v_clear_student_link then
    insert into public.ops_task_events(
      task_id, actor_id, event_type, field_name, before_value, after_value
    ) values (
      p_task_id,
      v_actor_id,
      'student_link_recheck_required',
      'student_id',
      v_task.student_id::text,
      null
    );
  end if;

  perform dashboard_private.recompute_registration_parent(p_task_id);
  v_response := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'commonRevision', v_next_revision
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, p_task_id, 'update_common', v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;

create or replace function dashboard_private.complete_registration_consultation_impl(
  p_consultation_id uuid,
  p_outcome text,
  p_waiting_kind text,
  p_class_id uuid,
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
  v_outcome text := pg_catalog.lower(nullif(pg_catalog.btrim(p_outcome), ''));
  v_waiting_kind text := pg_catalog.lower(nullif(pg_catalog.btrim(p_waiting_kind), ''));
  v_task_id uuid;
  v_track_id uuid;
  v_appointment_id uuid;
  v_consultation public.ops_registration_consultations%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_appointment public.ops_registration_appointments%rowtype;
  v_next_track_status text;
  v_appointment_status text;
  v_active_track_ids uuid[] := array[]::uuid[];
  v_canceled_track_ids uuid[] := array[]::uuid[];
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_consultation_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_outcome is null
    or v_outcome not in ('enrollment', 'waiting', 'not_registered')
  then
    raise exception 'registration_consultation_outcome_invalid' using errcode = '22023';
  end if;
  if v_outcome = 'waiting' then
    if v_waiting_kind is null
      or v_waiting_kind not in ('current_class', 'current_term_opening', 'next_term_opening')
    then
      raise exception 'waiting_kind_required' using errcode = '22023';
    end if;
    if v_waiting_kind = 'current_class' and p_class_id is null then
      raise exception 'waiting_class_required' using errcode = '22023';
    end if;
    if v_waiting_kind <> 'current_class' and p_class_id is not null then
      raise exception 'waiting_class_not_allowed' using errcode = '22023';
    end if;
  elsif v_outcome <> 'waiting'
    and (v_waiting_kind is not null or p_class_id is not null)
  then
    raise exception 'registration_consultation_waiting_fields_not_allowed' using errcode = '22023';
  end if;

  select track.task_id, consultation.track_id, consultation.appointment_id
  into v_task_id, v_track_id, v_appointment_id
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where consultation.id = p_consultation_id;
  if v_task_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'consultationId', p_consultation_id,
    'outcome', v_outcome,
    'waitingKind', case when v_outcome = 'waiting' then v_waiting_kind else null end,
    'classId', case
      when v_outcome = 'waiting' and v_waiting_kind = 'current_class' then p_class_id
      else null
    end
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- consultation_task_lock
  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;

  -- consultation_detail_lock
  perform 1
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- consultation_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id
  order by track.id
  for update;

  -- consultation_appointment_locks
  perform 1
  from public.ops_registration_appointments appointment
  where appointment.task_id = v_task_id
    and appointment.kind = 'visit_consultation'
  order by appointment.id
  for update;

  -- consultation_activity_locks
  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = v_task_id
  order by consultation.id
  for update of consultation;

  select consultation.*
  into v_consultation
  from public.ops_registration_consultations consultation
  where consultation.id = p_consultation_id
    and consultation.track_id = v_track_id;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  v_appointment_id := v_consultation.appointment_id;
  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_track_id
    and track.task_id = v_task_id;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_appointment_id is not null then
    select appointment.*
    into v_appointment
    from public.ops_registration_appointments appointment
    where appointment.id = v_appointment_id
      and appointment.task_id = v_task_id
      and appointment.kind = 'visit_consultation';
    if not found then
      raise exception 'registration_appointment_task_mismatch' using errcode = '23514';
    end if;
  end if;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id, v_track_id, 'complete_consultation'
  );
  if not dashboard_private.is_active_subject_director(
      v_actor_id,
      v_track.subject
    )
    or v_track.director_profile_id is distinct from v_actor_id
    or v_consultation.director_profile_id is distinct from v_actor_id
  then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  perform dashboard_private.assert_registration_track_director_ready(v_track_id);

  -- consultation_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'complete_consultation'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- consultation_mutable_state_check
  if v_consultation.mode = 'phone' then
    if v_consultation.status <> 'waiting'
      or v_consultation.appointment_id is not null
      or v_track.pipeline_status <> 'consultation_waiting'
    then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;
  elsif v_consultation.mode = 'visit' then
    if v_consultation.status <> 'scheduled'
      or v_consultation.appointment_id is null
      or v_track.pipeline_status <> 'visit_consultation_scheduled'
      or v_appointment.task_id is distinct from v_task_id
      or v_appointment.kind <> 'visit_consultation'
      or v_appointment.status <> 'scheduled'
    then
      raise exception 'registration_invalid_source_state' using errcode = '40001';
    end if;
  else
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;

  if v_outcome = 'waiting' and v_waiting_kind = 'current_class' then
    perform dashboard_private.apply_registration_current_class_wait(
      v_task_id, v_track_id, p_class_id, v_actor_id
    );
  end if;

  update public.ops_registration_consultations consultation
  set
    status = 'completed',
    completed_at = pg_catalog.now(),
    outcome = v_outcome,
    updated_at = pg_catalog.now()
  where consultation.id = p_consultation_id
    and consultation.status = v_consultation.status
  returning consultation.* into v_consultation;
  if not found then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;

  if v_consultation.mode = 'phone' then
    delete from public.dashboard_notifications notification
    where notification.type = 'registration_consultation'
      and notification.read_at is null
      and notification.dedupe_key =
        'registration:' || v_task_id::text || ':track:' || v_track_id::text
        || ':consultation:' || v_consultation.id::text
        || ':director:' || v_consultation.director_profile_id::text;
  end if;

  v_next_track_status := case
    when v_outcome = 'enrollment' then 'enrollment_decided'
    when v_outcome = 'waiting' then 'waiting'
    else 'not_registered'
  end;
  perform dashboard_private.transition_registration_track_status(
    v_track_id,
    v_next_track_status,
    case when v_outcome = 'waiting' then v_waiting_kind else null end,
    null,
    false
  );

  if v_consultation.mode = 'visit' then
    if exists (
      select 1
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = v_appointment_id
        and consultation.mode = 'visit'
        and consultation.status = 'scheduled'
    ) then
      v_appointment_status := 'scheduled';
    elsif not exists (
      select 1
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = v_appointment_id
        and consultation.mode = 'visit'
        and consultation.status <> 'canceled'
    ) then
      v_appointment_status := 'canceled';
    else
      v_appointment_status := 'completed';
    end if;

    update public.ops_registration_appointments appointment
    set status = v_appointment_status, updated_at = pg_catalog.now()
    where appointment.id = v_appointment_id
      and appointment.status is distinct from v_appointment_status;

    select coalesce(
      pg_catalog.array_agg(
        participant.track_id
        order by dashboard_private.registration_subject_sort_order(participant.subject),
          participant.track_id
      ),
      array[]::uuid[]
    )
    into v_active_track_ids
    from (
      select distinct consultation.track_id, track.subject
      from public.ops_registration_consultations consultation
      join public.ops_registration_subject_tracks track
        on track.id = consultation.track_id
      where consultation.appointment_id = v_appointment_id
        and consultation.mode = 'visit'
        and consultation.status = 'scheduled'
    ) participant;
    select coalesce(
      pg_catalog.array_agg(
        participant.track_id
        order by dashboard_private.registration_subject_sort_order(participant.subject),
          participant.track_id
      ),
      array[]::uuid[]
    )
    into v_canceled_track_ids
    from (
      select distinct consultation.track_id, track.subject
      from public.ops_registration_consultations consultation
      join public.ops_registration_subject_tracks track
        on track.id = consultation.track_id
      where consultation.appointment_id = v_appointment_id
        and consultation.mode = 'visit'
        and consultation.status = 'canceled'
    ) participant;
  else
    v_appointment_status := null;
  end if;

  perform dashboard_private.write_registration_track_event(
    v_task_id,
    v_track_id,
    'consultation_completed',
    v_track.pipeline_status,
    v_next_track_status,
    null,
    pg_catalog.jsonb_build_object(
      'appointmentId', v_appointment_id,
      'notificationRevision', case
        when v_consultation.mode = 'visit' then v_appointment.notification_revision
        else null
      end,
      'consultationId', v_consultation.id,
      'mode', v_consultation.mode,
      'outcome', v_outcome,
      'waitingKind', case when v_outcome = 'waiting' then v_waiting_kind else null end,
      'classId', case
        when v_outcome = 'waiting' and v_waiting_kind = 'current_class' then p_class_id
        else null
      end,
      'appointmentStatus', v_appointment_status,
      'activeTrackIds', pg_catalog.to_jsonb(v_active_track_ids),
      'canceledTrackIds', pg_catalog.to_jsonb(v_canceled_track_ids),
      'changeKind', 'consultation_completed'
    )
  );
  perform dashboard_private.recompute_registration_parent(v_task_id);

  select track.*
  into v_track
  from public.ops_registration_subject_tracks track
  where track.id = v_track_id;
  v_response := pg_catalog.jsonb_build_object(
    'consultation', pg_catalog.jsonb_build_object(
      'id', v_consultation.id,
      'trackId', v_consultation.track_id,
      'appointmentId', v_consultation.appointment_id,
      'mode', v_consultation.mode,
      'status', v_consultation.status,
      'directorProfileId', v_consultation.director_profile_id,
      'completedAt', v_consultation.completed_at,
      'outcome', v_consultation.outcome,
      'createdAt', v_consultation.created_at,
      'updatedAt', v_consultation.updated_at
    ),
    'track', pg_catalog.jsonb_build_object(
      'id', v_track.id,
      'taskId', v_track.task_id,
      'subject', v_track.subject,
      'status', v_track.pipeline_status,
      'legacy', false,
      'directorProfileId', v_track.director_profile_id,
      'directorName', coalesce((
        select profile.name
        from public.profiles profile
        where profile.id = v_track.director_profile_id
      ), ''),
      'directorAssignmentSource', coalesce(v_track.director_assignment_source, ''),
      'directorAssignmentRuleKey', coalesce(v_track.director_assignment_rule_key, ''),
      'waitingKind', coalesce(v_track.waiting_kind, ''),
      'levelTestRetakeDecision', coalesce(v_track.level_test_retake_decision, ''),
      'migrationReviewRequired', v_track.migration_review_required,
      'stageEnteredAt', v_track.stage_entered_at
    )
  );
  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id, v_request_key, v_task_id, 'complete_consultation',
    v_target_fingerprint, v_response
  );
  return v_response;
end;
$$;


create or replace function dashboard_private.create_registration_case_with_initial_workflow_v1_impl(
  p_student_name text,
  p_school_grade text,
  p_school_name text,
  p_parent_phone text,
  p_student_phone text,
  p_campus text,
  p_inquiry_at timestamptz,
  p_subjects text[],
  p_request_note text,
  p_priority text,
  p_subject_plans jsonb,
  p_level_test_appointment jsonb,
  p_visit_appointment jsonb,
  p_director_overrides jsonb,
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
  v_student_name text := nullif(pg_catalog.btrim(p_student_name), '');
  v_school_grade text := nullif(pg_catalog.btrim(p_school_grade), '');
  v_school_name text := nullif(pg_catalog.btrim(p_school_name), '');
  v_parent_phone text := nullif(pg_catalog.btrim(p_parent_phone), '');
  v_student_phone text := nullif(pg_catalog.btrim(p_student_phone), '');
  v_campus text := nullif(pg_catalog.btrim(p_campus), '');
  v_request_note text := nullif(pg_catalog.btrim(p_request_note), '');
  v_priority text := nullif(pg_catalog.btrim(p_priority), '');
  v_parent_phone_digits text;
  v_subjects text[];
  v_subject text;
  v_plan text;
  v_subject_plans jsonb;
  v_level_test_appointment jsonb;
  v_visit_appointment jsonb;
  v_director_overrides jsonb;
  v_level_test_subjects text[] := array[]::text[];
  v_visit_subjects text[] := array[]::text[];
  v_appointment_subjects text[] := array[]::text[];
  v_level_test_scheduled_at timestamptz;
  v_visit_scheduled_at timestamptz;
  v_level_test_place text;
  v_visit_place text;
  v_directors jsonb := '{}'::jsonb;
  v_director_resolution jsonb;
  v_director_profile_id uuid;
  v_director_source text;
  v_director_rule_key text;
  v_override_text text;
  v_task_id uuid;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_level_test_appointment_id uuid;
  v_visit_appointment_id uuid;
  v_activity_id uuid;
  v_consultation_id uuid;
  v_level_test_track_ids uuid[] := array[]::uuid[];
  v_visit_track_ids uuid[] := array[]::uuid[];
  v_notification_targets jsonb := '[]'::jsonb;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_tracks jsonb := '[]'::jsonb;
  v_appointments jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if v_actor_id is null
    or (public.current_dashboard_role() in ('admin', 'staff')) is not true
  then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_campus is null or v_campus not in ('본관', '별관') then
    raise exception 'registration_campus_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(coalesce(p_subjects, array[]::text[])) subject(value)
    where subject.value is null
      or nullif(pg_catalog.btrim(subject.value), '') is null
      or pg_catalog.btrim(subject.value) not in ('영어', '수학', '과학')
  ) then
    raise exception 'registration_subject_unsupported' using errcode = '22023';
  end if;
  select coalesce(
    pg_catalog.array_agg(normalized.subject order by normalized.subject_order),
    array[]::text[]
  )
  into v_subjects
  from (
    select distinct
      pg_catalog.btrim(subject.value) as subject,
      dashboard_private.registration_subject_sort_order(pg_catalog.btrim(subject.value)) as subject_order
    from pg_catalog.unnest(coalesce(p_subjects, array[]::text[])) subject(value)
    where nullif(pg_catalog.btrim(subject.value), '') is not null
  ) normalized;
  if pg_catalog.cardinality(v_subjects) = 0 then
    raise exception 'registration_subjects_required' using errcode = '22023';
  end if;
  if pg_catalog.cardinality(v_subjects) not between 1 and 3 then
    raise exception 'registration_subject_invalid' using errcode = '22023';
  end if;

  -- Validate every JSON container before using object or array expansion.
  if p_subject_plans is null
    or pg_catalog.jsonb_typeof(p_subject_plans) <> 'object'
  then
    raise exception 'registration_initial_subject_plan_invalid' using errcode = '22023';
  end if;
  v_subject_plans := p_subject_plans;
  if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_subject_plans) plan_key
      where plan_key <> all(v_subjects)
    )
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(v_subject_plans)
    ) <> pg_catalog.cardinality(v_subjects)
    or exists (
      select 1
      from pg_catalog.jsonb_each(v_subject_plans) plan_entry
      where pg_catalog.jsonb_typeof(plan_entry.value) <> 'string'
        or pg_catalog.btrim(plan_entry.value #>> '{}') not in (
          'inquiry', 'level_test', 'direct_phone', 'visit'
        )
    )
  then
    raise exception 'registration_initial_subject_plan_invalid' using errcode = '22023';
  end if;
  select pg_catalog.jsonb_object_agg(
    subject.value,
    pg_catalog.btrim(v_subject_plans ->> subject.value)
    order by dashboard_private.registration_subject_sort_order(subject.value)
  )
  into v_subject_plans
  from pg_catalog.unnest(v_subjects) subject(value);

  select coalesce(
    pg_catalog.array_agg(subject.value order by dashboard_private.registration_subject_sort_order(subject.value)),
    array[]::text[]
  )
  into v_level_test_subjects
  from pg_catalog.unnest(v_subjects) subject(value)
  where v_subject_plans ->> subject.value = 'level_test';
  select coalesce(
    pg_catalog.array_agg(subject.value order by dashboard_private.registration_subject_sort_order(subject.value)),
    array[]::text[]
  )
  into v_visit_subjects
  from pg_catalog.unnest(v_subjects) subject(value)
  where v_subject_plans ->> subject.value = 'visit';

  v_level_test_appointment := case
    when p_level_test_appointment is null
      or pg_catalog.jsonb_typeof(p_level_test_appointment) = 'null'
      then null
    else p_level_test_appointment
  end;
  v_visit_appointment := case
    when p_visit_appointment is null
      or pg_catalog.jsonb_typeof(p_visit_appointment) = 'null'
      then null
    else p_visit_appointment
  end;

  -- Validate all appointment membership before any time or place details.
  if (pg_catalog.cardinality(v_level_test_subjects) = 0)
      is distinct from (v_level_test_appointment is null)
  then
    raise exception 'registration_initial_appointment_membership_invalid'
      using errcode = '22023';
  end if;
  if (pg_catalog.cardinality(v_visit_subjects) = 0)
      is distinct from (v_visit_appointment is null)
  then
    raise exception 'registration_initial_appointment_membership_invalid'
      using errcode = '22023';
  end if;
  if v_level_test_appointment is not null
    and pg_catalog.jsonb_typeof(v_level_test_appointment) = 'object'
  then
    if pg_catalog.jsonb_typeof(v_level_test_appointment -> 'subjects')
        is distinct from 'array'
    then
      raise exception 'registration_initial_appointment_membership_invalid'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        v_level_test_appointment -> 'subjects'
      ) subject_item
      where pg_catalog.jsonb_typeof(subject_item) <> 'string'
    ) then
      raise exception 'registration_initial_appointment_membership_invalid'
        using errcode = '22023';
    end if;
    select coalesce(
      pg_catalog.array_agg(normalized.subject order by normalized.subject_order),
      array[]::text[]
    )
    into v_appointment_subjects
    from (
      select distinct
        pg_catalog.btrim(subject_item #>> '{}') as subject,
        dashboard_private.registration_subject_sort_order(pg_catalog.btrim(subject_item #>> '{}'))
          as subject_order
      from pg_catalog.jsonb_array_elements(
        v_level_test_appointment -> 'subjects'
      ) subject_item
    ) normalized;
    if v_appointment_subjects is distinct from v_level_test_subjects
      or pg_catalog.cardinality(v_appointment_subjects)
        <> pg_catalog.jsonb_array_length(v_level_test_appointment -> 'subjects')
    then
      raise exception 'registration_initial_appointment_membership_invalid'
        using errcode = '22023';
    end if;
  end if;
  if v_visit_appointment is not null
    and pg_catalog.jsonb_typeof(v_visit_appointment) = 'object'
  then
    if pg_catalog.jsonb_typeof(v_visit_appointment -> 'subjects')
        is distinct from 'array'
    then
      raise exception 'registration_initial_appointment_membership_invalid'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_visit_appointment -> 'subjects') subject_item
      where pg_catalog.jsonb_typeof(subject_item) <> 'string'
    ) then
      raise exception 'registration_initial_appointment_membership_invalid'
        using errcode = '22023';
    end if;
    select coalesce(
      pg_catalog.array_agg(normalized.subject order by normalized.subject_order),
      array[]::text[]
    )
    into v_appointment_subjects
    from (
      select distinct
        pg_catalog.btrim(subject_item #>> '{}') as subject,
        dashboard_private.registration_subject_sort_order(pg_catalog.btrim(subject_item #>> '{}'))
          as subject_order
      from pg_catalog.jsonb_array_elements(
        v_visit_appointment -> 'subjects'
      ) subject_item
    ) normalized;
    if v_appointment_subjects is distinct from v_visit_subjects
      or pg_catalog.cardinality(v_appointment_subjects)
        <> pg_catalog.jsonb_array_length(v_visit_appointment -> 'subjects')
    then
      raise exception 'registration_initial_appointment_membership_invalid'
        using errcode = '22023';
    end if;
  end if;

  -- Validate and normalize appointment time/place details only after membership.
  if v_level_test_appointment is not null then
    if pg_catalog.jsonb_typeof(v_level_test_appointment) <> 'object' then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    if exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_level_test_appointment) appointment_key
        where appointment_key not in ('scheduledAt', 'place', 'subjects')
      )
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(v_level_test_appointment)
      ) <> 3
    then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(v_level_test_appointment -> 'scheduledAt') <> 'string'
      or pg_catalog.jsonb_typeof(v_level_test_appointment -> 'place') <> 'string'
    then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    v_level_test_place := nullif(
      pg_catalog.btrim(v_level_test_appointment ->> 'place'), ''
    );
    begin
      v_level_test_scheduled_at := nullif(
        pg_catalog.btrim(v_level_test_appointment ->> 'scheduledAt'), ''
      )::timestamptz;
    exception when others then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end;
    if v_level_test_scheduled_at is null or v_level_test_place is null then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    v_level_test_appointment := pg_catalog.jsonb_build_object(
      'scheduledAt', v_level_test_scheduled_at,
      'place', v_level_test_place,
      'subjects', pg_catalog.to_jsonb(v_level_test_subjects)
    );
  end if;

  if v_visit_appointment is not null then
    if pg_catalog.jsonb_typeof(v_visit_appointment) <> 'object' then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    if exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_visit_appointment) appointment_key
        where appointment_key not in ('scheduledAt', 'place', 'subjects')
      )
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(v_visit_appointment)
      ) <> 3
    then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(v_visit_appointment -> 'scheduledAt') <> 'string'
      or pg_catalog.jsonb_typeof(v_visit_appointment -> 'place') <> 'string'
    then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    v_visit_place := nullif(pg_catalog.btrim(v_visit_appointment ->> 'place'), '');
    begin
      v_visit_scheduled_at := nullif(
        pg_catalog.btrim(v_visit_appointment ->> 'scheduledAt'), ''
      )::timestamptz;
    exception when others then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end;
    if v_visit_scheduled_at is null or v_visit_place is null then
      raise exception 'registration_initial_appointment_invalid' using errcode = '22023';
    end if;
    v_visit_appointment := pg_catalog.jsonb_build_object(
      'scheduledAt', v_visit_scheduled_at,
      'place', v_visit_place,
      'subjects', pg_catalog.to_jsonb(v_visit_subjects)
    );
  end if;

  if p_director_overrides is null then
    v_director_overrides := '{}'::jsonb;
  elsif pg_catalog.jsonb_typeof(p_director_overrides) <> 'object' then
    raise exception 'registration_director_override_invalid' using errcode = '22023';
  else
    v_director_overrides := p_director_overrides;
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_each(v_director_overrides) override_entry
    where override_entry.key <> all(v_subjects)
      or pg_catalog.jsonb_typeof(override_entry.value) <> 'string'
      or nullif(pg_catalog.btrim(override_entry.value #>> '{}'), '') is null
      or pg_catalog.btrim(override_entry.value #>> '{}')
        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'registration_director_override_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_each(v_director_overrides) override_entry
    where not dashboard_private.is_active_subject_director(
      pg_catalog.btrim(override_entry.value #>> '{}')::uuid,
      override_entry.key
    )
  ) then
    raise exception 'registration_director_override_invalid' using errcode = '22023';
  end if;
  select coalesce(
    pg_catalog.jsonb_object_agg(
      override_entry.key,
      pg_catalog.btrim(override_entry.value #>> '{}')::uuid::text
      order by dashboard_private.registration_subject_sort_order(override_entry.key)
    ),
    '{}'::jsonb
  )
  into v_director_overrides
  from pg_catalog.jsonb_each(v_director_overrides) override_entry;

  if v_student_name is null then
    raise exception 'registration_student_name_required' using errcode = '22023';
  end if;
  if v_school_grade is null then
    raise exception 'registration_school_grade_required' using errcode = '22023';
  end if;
  v_parent_phone_digits := pg_catalog.regexp_replace(
    coalesce(v_parent_phone, ''), '\D+', '', 'g'
  );
  if v_parent_phone_digits !~ '^01(0|1|[6-9])[0-9]{7,8}$' then
    raise exception 'registration_parent_phone_invalid' using errcode = '22023';
  end if;
  if p_inquiry_at is null then
    raise exception 'registration_inquiry_at_required' using errcode = '22023';
  end if;
  if v_priority is null or v_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'registration_priority_invalid' using errcode = '22023';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'studentName', v_student_name,
    'schoolGrade', v_school_grade,
    'schoolName', v_school_name,
    'parentPhone', v_parent_phone,
    'studentPhone', v_student_phone,
    'campus', v_campus,
    'inquiryAt', p_inquiry_at,
    'subjects', pg_catalog.to_jsonb(v_subjects),
    'requestNote', v_request_note,
    'priority', v_priority,
    'subjectPlans', v_subject_plans,
    'levelTestAppointment', v_level_test_appointment,
    'visitAppointment', v_visit_appointment,
    'directorOverrides', v_director_overrides
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  -- registration_initial_receipt_lookup
  select
    mutation.response_payload,
    mutation.mutation_type = 'create_case_with_initial_workflow_v1'
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

  foreach v_subject in array v_subjects
  loop
    perform dashboard_private.assert_registration_subject_enabled(
      v_subject,
      v_school_grade
    );
  end loop;

  -- Resolve every selected subject before the parent insert so director
  -- failures have stable codes and no partially-created case can survive.
  foreach v_subject in array v_subjects
  loop
    v_plan := v_subject_plans ->> v_subject;
    v_override_text := nullif(v_director_overrides ->> v_subject, '');
    v_director_profile_id := null;
    v_director_source := null;
    v_director_rule_key := null;
    if v_override_text is not null then
      v_director_profile_id := v_override_text::uuid;
      v_director_source := 'manual';
    else
      v_director_resolution := dashboard_private.resolve_registration_default_director(
        v_subject, v_school_grade, p_inquiry_at
      );
      if v_director_resolution ->> 'status' = 'resolved' then
        v_director_profile_id := nullif(
          v_director_resolution ->> 'profileId', ''
        )::uuid;
        v_director_rule_key := nullif(v_director_resolution ->> 'ruleKey', '');
        if dashboard_private.is_active_subject_director(
          v_director_profile_id,
          v_subject
        ) then
          v_director_source := 'default';
        else
          v_director_profile_id := null;
          v_director_rule_key := null;
        end if;
      end if;
    end if;
    if v_plan in ('direct_phone', 'visit') and v_director_profile_id is null then
      raise exception 'registration_director_required' using errcode = '22023';
    end if;
    v_directors := pg_catalog.jsonb_set(
      v_directors,
      array[v_subject],
      pg_catalog.jsonb_build_object(
        'profileId', v_director_profile_id,
        'source', v_director_source,
        'ruleKey', v_director_rule_key
      ),
      true
    );
  end loop;

  insert into public.ops_tasks(
    title, type, status, priority, requested_by, student_id,
    student_name, campus, subject, memo
  ) values (
    '등록: ' || v_student_name,
    'registration',
    'requested',
    v_priority,
    v_actor_id,
    null,
    v_student_name,
    v_campus,
    pg_catalog.array_to_string(v_subjects, ', '),
    null
  ) returning id into v_task_id;

  insert into public.ops_registration_details(
    task_id, inquiry_at, school_grade, school_name, parent_phone,
    student_phone, request_note, pipeline_status, common_revision
  ) values (
    v_task_id, p_inquiry_at, v_school_grade, v_school_name, v_parent_phone,
    v_student_phone, v_request_note, '0. 등록 문의', 1
  );

  insert into public.ops_registration_subject_tracks(
    task_id,
    subject,
    pipeline_status,
    director_profile_id,
    director_assignment_source,
    director_assignment_rule_key,
    director_assigned_at,
    migration_review_required
  )
  select
    v_task_id,
    subject.value,
    'inquiry',
    nullif(v_directors #>> array[subject.value, 'profileId'], '')::uuid,
    nullif(v_directors #>> array[subject.value, 'source'], ''),
    nullif(v_directors #>> array[subject.value, 'ruleKey'], ''),
    case
      when nullif(v_directors #>> array[subject.value, 'profileId'], '') is not null
        then pg_catalog.now()
      else null
    end,
    false
  from pg_catalog.unnest(v_subjects) subject(value)
  order by dashboard_private.registration_subject_sort_order(subject.value);

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name, before_value, after_value
  ) values (
    v_task_id,
    v_actor_id,
    'registration_case_created',
    'registration_case',
    null,
    pg_catalog.jsonb_build_object(
      'version', 1,
      'actorId', v_actor_id,
      'subjects', pg_catalog.to_jsonb(v_subjects),
      'occurredAt', pg_catalog.now()
    )::text
  );

  if pg_catalog.cardinality(v_level_test_subjects) > 0 then
    insert into public.ops_registration_appointments(
      task_id, kind, scheduled_at, place, status, notification_revision, created_by
    ) values (
      v_task_id,
      'level_test',
      v_level_test_scheduled_at,
      v_level_test_place,
      'scheduled',
      1,
      v_actor_id
    ) returning id into v_level_test_appointment_id;

    select coalesce(
      pg_catalog.array_agg(
        track.id order by dashboard_private.registration_subject_sort_order(track.subject), track.id
      ),
      array[]::uuid[]
    )
    into v_level_test_track_ids
    from public.ops_registration_subject_tracks track
    where track.task_id = v_task_id
      and track.subject = any(v_level_test_subjects);

    for v_track in
      select track.*
      from public.ops_registration_subject_tracks track
      where track.task_id = v_task_id
        and track.subject = any(v_level_test_subjects)
      order by dashboard_private.registration_subject_sort_order(track.subject), track.id
    loop
      insert into public.ops_registration_level_tests(
        track_id, appointment_id, attempt_number, status
      ) values (
        v_track.id, v_level_test_appointment_id, 1, 'scheduled'
      ) returning id into v_activity_id;
      perform dashboard_private.transition_registration_track_status(
        v_track.id, 'level_test_scheduled', null, null, false
      );
      perform dashboard_private.write_registration_track_event(
        v_task_id,
        v_track.id,
        'level_test_scheduled',
        'inquiry',
        'level_test_scheduled',
        null,
        pg_catalog.jsonb_build_object(
          'appointmentId', v_level_test_appointment_id,
          'notificationRevision', 1,
          'kind', 'level_test',
          'scheduledAt', v_level_test_scheduled_at,
          'place', v_level_test_place,
          'activityId', v_activity_id,
          'attemptNumber', 1,
          'activeTrackIds', pg_catalog.to_jsonb(v_level_test_track_ids),
          'canceledTrackIds', '[]'::jsonb,
          'changeKind', 'created'
        )
      );
    end loop;
  end if;

  for v_track in
    select track.*
    from public.ops_registration_subject_tracks track
    where track.task_id = v_task_id
      and v_subject_plans ->> track.subject = 'direct_phone'
    order by dashboard_private.registration_subject_sort_order(track.subject), track.id
  loop
    insert into public.ops_registration_consultations(
      track_id, appointment_id, mode, status, director_profile_id,
      ready_at, ready_source
    ) values (
      v_track.id, null, 'phone', 'waiting', v_track.director_profile_id,
      p_inquiry_at, 'inquiry'
    ) returning id into v_consultation_id;
    perform dashboard_private.transition_registration_track_status(
      v_track.id, 'consultation_waiting', null, null, false
    );
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      v_track.id,
      'inquiry_routed',
      'inquiry',
      'consultation_waiting',
      null,
      pg_catalog.jsonb_build_object(
        'consultationId', v_consultation_id,
        'initialAction', 'direct_phone'
      )
    );
  end loop;

  if pg_catalog.cardinality(v_visit_subjects) > 0 then
    insert into public.ops_registration_appointments(
      task_id, kind, scheduled_at, place, status, notification_revision, created_by
    ) values (
      v_task_id,
      'visit_consultation',
      v_visit_scheduled_at,
      v_visit_place,
      'scheduled',
      1,
      v_actor_id
    ) returning id into v_visit_appointment_id;

    select coalesce(
      pg_catalog.array_agg(
        track.id order by dashboard_private.registration_subject_sort_order(track.subject), track.id
      ),
      array[]::uuid[]
    )
    into v_visit_track_ids
    from public.ops_registration_subject_tracks track
    where track.task_id = v_task_id
      and track.subject = any(v_visit_subjects);

    for v_track in
      select track.*
      from public.ops_registration_subject_tracks track
      where track.task_id = v_task_id
        and track.subject = any(v_visit_subjects)
      order by dashboard_private.registration_subject_sort_order(track.subject), track.id
    loop
      insert into public.ops_registration_consultations(
        track_id, appointment_id, mode, status, director_profile_id,
        ready_at, ready_source
      ) values (
        v_track.id,
        v_visit_appointment_id,
        'visit',
        'scheduled',
        v_track.director_profile_id,
        null,
        null
      ) returning id into v_activity_id;
      perform dashboard_private.transition_registration_track_status(
        v_track.id, 'visit_consultation_scheduled', null, null, false
      );
      perform dashboard_private.write_registration_track_event(
        v_task_id,
        v_track.id,
        'visit_scheduled',
        'inquiry',
        'visit_consultation_scheduled',
        null,
        pg_catalog.jsonb_build_object(
          'appointmentId', v_visit_appointment_id,
          'notificationRevision', 1,
          'kind', 'visit_consultation',
          'scheduledAt', v_visit_scheduled_at,
          'place', v_visit_place,
          'activityId', v_activity_id,
          'activeTrackIds', pg_catalog.to_jsonb(v_visit_track_ids),
          'canceledTrackIds', '[]'::jsonb,
          'changeKind', 'created'
        )
      );
    end loop;
    v_notification_targets := pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'appointmentId', v_visit_appointment_id,
        'notificationRevision', 1
      )
    );
  end if;

  for v_track in
    select track.*
    from public.ops_registration_subject_tracks track
    where track.task_id = v_task_id
      and v_subject_plans ->> track.subject = 'inquiry'
    order by dashboard_private.registration_subject_sort_order(track.subject), track.id
  loop
    perform dashboard_private.write_registration_track_event(
      v_task_id,
      v_track.id,
      'initial_inquiry_selected',
      'inquiry',
      'inquiry',
      null,
      pg_catalog.jsonb_build_object('initialAction', 'inquiry')
    );
  end loop;

  perform dashboard_private.recompute_registration_parent(v_task_id);

  select coalesce(
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
      ) order by dashboard_private.registration_subject_sort_order(track.subject), track.id
    ),
    '[]'::jsonb
  )
  into v_tracks
  from public.ops_registration_subject_tracks track
  where track.task_id = v_task_id;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', appointment.id,
        'taskId', appointment.task_id,
        'kind', appointment.kind,
        'scheduledAt', appointment.scheduled_at,
        'place', appointment.place,
        'status', appointment.status,
        'notificationRevision', appointment.notification_revision,
        'createdAt', appointment.created_at,
        'updatedAt', appointment.updated_at
      ) order by
        case appointment.kind when 'level_test' then 0 else 1 end,
        appointment.id
    ),
    '[]'::jsonb
  )
  into v_appointments
  from public.ops_registration_appointments appointment
  where appointment.task_id = v_task_id;

  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'commonRevision', 1,
    'subjects', pg_catalog.to_jsonb(v_subjects),
    'tracks', v_tracks,
    'appointments', v_appointments,
    'notificationTargets', v_notification_targets
  );

  insert into dashboard_private.ops_registration_mutations(
    actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
  ) values (
    v_actor_id,
    v_request_key,
    v_task_id,
    'create_case_with_initial_workflow_v1',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;


create or replace function dashboard_private.save_registration_shared_appointment_impl(
  p_appointment_id uuid,
  p_task_id uuid,
  p_kind text,
  p_scheduled_at timestamptz,
  p_place text,
  p_track_ids uuid[],
  p_replace_remaining boolean,
  p_expected_notification_revision integer,
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
  v_place text := nullif(pg_catalog.btrim(p_place), '');
  v_track_ids uuid[];
  v_ordered_track_ids uuid[] := array[]::uuid[];
  v_track_count integer;
  v_task_exists boolean := false;
  v_task_student_id uuid;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_response jsonb;
  v_appointment public.ops_registration_appointments%rowtype;
  v_appointment_id uuid;
  v_new_appointment_id uuid;
  v_activity_id uuid;
  v_activity_ids uuid[] := array[]::uuid[];
  v_existing_track_ids uuid[] := array[]::uuid[];
  v_scheduled_track_ids uuid[] := array[]::uuid[];
  v_added_track_ids uuid[] := array[]::uuid[];
  v_deselected_track_ids uuid[] := array[]::uuid[];
  v_active_track_ids uuid[] := array[]::uuid[];
  v_canceled_track_ids uuid[] := array[]::uuid[];
  v_requires_director_assignment_track_ids uuid[] := array[]::uuid[];
  v_attempt_number integer;
  v_latest_attempt_status text;
  v_active_activity_count integer;
  v_child_count integer := 0;
  v_terminal_child_count integer := 0;
  v_real_diff boolean := false;
  v_director_ready boolean;
  v_old_notification_revision integer;
  v_new_notification_revision integer := 1;
  v_old_appointment_status text;
  v_notification_targets jsonb := '[]'::jsonb;
  v_phone_consultation_id uuid;
  v_phone_director_id uuid;
  v_phone_consultation_count integer;
  v_wait_enrollment_id uuid;
  v_wait_student_id uuid;
  v_wait_class_id uuid;
  v_event_type text;
  v_track record;
begin
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('level_test', 'visit_consultation') then
    raise exception 'registration_appointment_kind_invalid' using errcode = '22023';
  end if;
  if p_scheduled_at is null then
    raise exception 'registration_appointment_scheduled_at_required' using errcode = '22023';
  end if;
  if v_place is null then
    raise exception 'registration_appointment_place_required' using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct track_id order by track_id),
    array[]::uuid[]
  )
  into v_track_ids
  from pg_catalog.unnest(coalesce(p_track_ids, array[]::uuid[])) selected(track_id)
  where track_id is not null;
  if pg_catalog.cardinality(v_track_ids) not between 1 and 3 then
    raise exception 'registration_appointment_tracks_required' using errcode = '22023';
  end if;
  if p_appointment_id is null
    and p_expected_notification_revision is not null
  then
    raise exception 'registration_appointment_revision_conflict' using errcode = '40001';
  end if;
  if p_appointment_id is null and coalesce(p_replace_remaining, false) then
    raise exception 'registration_appointment_replacement_requires_existing' using errcode = '22023';
  end if;
  if p_appointment_id is not null
    and p_expected_notification_revision is null
  then
    raise exception 'registration_appointment_revision_conflict' using errcode = '40001';
  end if;

  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'appointmentId', p_appointment_id,
    'taskId', p_task_id,
    'kind', p_kind,
    'scheduledAt', p_scheduled_at,
    'place', v_place,
    'trackIds', pg_catalog.to_jsonb(v_track_ids),
    'replaceRemaining', coalesce(p_replace_remaining, false),
    'expectedNotificationRevision', p_expected_notification_revision
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor_id::text || ':' || v_request_key, 0)
  );

  select task.student_id
  into v_task_student_id
  from public.ops_tasks task
  where task.id = p_task_id
    and task.type = 'registration'
  order by task.id
  for update;
  v_task_exists := found;
  if not v_task_exists then
    raise exception 'registration_appointment_task_mismatch' using errcode = '42501';
  end if;

  perform 1
  from public.ops_registration_details detail
  where detail.task_id = p_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;

  -- appointment_parent_track_locks
  perform 1
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by track.id
  for update;
  select pg_catalog.count(*)
  into v_track_count
  from public.ops_registration_subject_tracks track
  where track.id = any(v_track_ids)
    and track.task_id = p_task_id;
  if v_track_count <> pg_catalog.cardinality(v_track_ids) then
    raise exception 'registration_appointment_task_mismatch' using errcode = '22023';
  end if;
  select coalesce(
    pg_catalog.array_agg(
      track.id order by dashboard_private.registration_subject_sort_order(track.subject), track.id
    ),
    array[]::uuid[]
  )
  into v_ordered_track_ids
  from public.ops_registration_subject_tracks track
  where track.id = any(v_track_ids)
    and track.task_id = p_task_id;

  -- appointment_row_lock
  if p_appointment_id is not null then
    select appointment.*
    into v_appointment
    from public.ops_registration_appointments appointment
    where appointment.id = p_appointment_id
      and appointment.task_id = p_task_id
    order by appointment.id
    for update;
    if not found or v_appointment.task_id is distinct from p_task_id then
      raise exception 'registration_appointment_task_mismatch' using errcode = '23514';
    end if;
    if v_appointment.kind is distinct from p_kind then
      raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
    end if;
  end if;

  -- appointment_activity_locks
  perform 1
  from public.ops_registration_level_tests attempt
  join public.ops_registration_subject_tracks track on track.id = attempt.track_id
  where track.task_id = p_task_id
  order by attempt.id
  for update of attempt;

  perform 1
  from public.ops_registration_consultations consultation
  join public.ops_registration_subject_tracks track on track.id = consultation.track_id
  where track.task_id = p_task_id
  order by consultation.id
  for update of consultation;

  perform dashboard_private.assert_registration_mutation_access(
    p_task_id, null, 'save_appointment'
  );

  -- appointment_receipt_lookup
  select
    mutation.response_payload,
    mutation.task_id = p_task_id
      and mutation.mutation_type = 'save_appointment'
      and mutation.target_fingerprint = v_target_fingerprint
  into v_response, v_receipt_matches
  from dashboard_private.ops_registration_mutations mutation
  where mutation.actor_id = v_actor_id
    and mutation.request_key = v_request_key;
  v_receipt_found := found;
  if v_receipt_found and not v_receipt_matches then
    raise exception 'idempotency_key_reused' using errcode = '22023';
  end if;
  if v_receipt_found then return v_response; end if;

  -- appointment_stale_revision_check
  if p_appointment_id is not null
    and v_appointment.notification_revision is distinct from p_expected_notification_revision
  then
    raise exception 'registration_appointment_revision_conflict' using errcode = '40001';
  end if;

  if p_appointment_id is not null then
    if exists (
      select 1
      from public.ops_registration_level_tests attempt
      join public.ops_registration_subject_tracks track on track.id = attempt.track_id
      where attempt.appointment_id = p_appointment_id
        and track.task_id is distinct from p_task_id
    ) or exists (
      select 1
      from public.ops_registration_consultations consultation
      join public.ops_registration_subject_tracks track on track.id = consultation.track_id
      where consultation.appointment_id = p_appointment_id
        and track.task_id is distinct from p_task_id
    ) then
      raise exception 'registration_appointment_task_mismatch' using errcode = '23514';
    end if;

    if p_kind = 'level_test' then
      if exists (
        select 1
        from public.ops_registration_consultations consultation
        where consultation.appointment_id = p_appointment_id
      ) then
        raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
      end if;

      select
        pg_catalog.count(*),
        coalesce(
          pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id),
          array[]::uuid[]
        ),
        coalesce(
          pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id)
            filter (where attempt.status = 'scheduled'),
          array[]::uuid[]
        ),
        pg_catalog.count(*) filter (
          where attempt.status in ('in_progress', 'completed', 'absent', 'canceled')
        )
      into
        v_child_count,
        v_existing_track_ids,
        v_scheduled_track_ids,
        v_terminal_child_count
      from public.ops_registration_level_tests attempt
      where attempt.appointment_id = p_appointment_id;
    else
      if exists (
        select 1
        from public.ops_registration_level_tests attempt
        where attempt.appointment_id = p_appointment_id
      ) or exists (
        select 1
        from public.ops_registration_consultations consultation
        where consultation.appointment_id = p_appointment_id
          and consultation.mode <> 'visit'
      ) then
        raise exception 'registration_appointment_kind_mismatch' using errcode = '23514';
      end if;

      select
        pg_catalog.count(*),
        coalesce(
          pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id),
          array[]::uuid[]
        ),
        coalesce(
          pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id)
            filter (where consultation.status = 'scheduled'),
          array[]::uuid[]
        ),
        pg_catalog.count(*) filter (
          where consultation.status in ('completed', 'canceled')
        )
      into
        v_child_count,
        v_existing_track_ids,
        v_scheduled_track_ids,
        v_terminal_child_count
      from public.ops_registration_consultations consultation
      where consultation.appointment_id = p_appointment_id
        and consultation.mode = 'visit';
    end if;

    if v_child_count = 0 then
      raise exception 'registration_appointment_tracks_required' using errcode = '23514';
    end if;
    if v_appointment.status <> 'scheduled' then
      raise exception 'registration_appointment_immutable' using errcode = '40001';
    end if;

    select coalesce(
      pg_catalog.array_agg(
        candidate.track_id
        order by dashboard_private.registration_subject_sort_order(track.subject),
          candidate.track_id
      ),
      array[]::uuid[]
    )
    into v_added_track_ids
    from (
      select selected.track_id
      from pg_catalog.unnest(v_track_ids) selected(track_id)
      except
      select existing.track_id
      from pg_catalog.unnest(v_existing_track_ids) existing(track_id)
    ) candidate
    join public.ops_registration_subject_tracks track
      on track.id = candidate.track_id
      and track.task_id = p_task_id;

    select coalesce(
      pg_catalog.array_agg(
        candidate.track_id
        order by dashboard_private.registration_subject_sort_order(track.subject),
          candidate.track_id
      ),
      array[]::uuid[]
    )
    into v_deselected_track_ids
    from (
      select existing.track_id
      from pg_catalog.unnest(v_scheduled_track_ids) existing(track_id)
      except
      select selected.track_id
      from pg_catalog.unnest(v_track_ids) selected(track_id)
    ) candidate
    join public.ops_registration_subject_tracks track
      on track.id = candidate.track_id
      and track.task_id = p_task_id;

    if coalesce(p_replace_remaining, false) then
      -- replacement_appointment_edit
      if v_terminal_child_count = 0
        or pg_catalog.cardinality(v_scheduled_track_ids) = 0
      then
        raise exception 'registration_appointment_immutable' using errcode = '40001';
      end if;
      if v_track_ids is distinct from v_scheduled_track_ids then
        raise exception 'registration_appointment_replacement_track_set_mismatch' using errcode = '22023';
      end if;

      for v_track in
        select track.*
        from pg_catalog.unnest(v_scheduled_track_ids) selected(track_id)
        join public.ops_registration_subject_tracks track on track.id = selected.track_id
        where track.task_id = p_task_id
        order by dashboard_private.registration_subject_sort_order(track.subject), track.id
      loop
        if p_kind = 'level_test' then
          if v_track.pipeline_status <> 'level_test_scheduled' then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
        else
          if v_track.pipeline_status <> 'visit_consultation_scheduled' then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
          perform dashboard_private.assert_registration_track_director_ready(v_track.id);
        end if;
      end loop;

      update public.ops_registration_appointments appointment
      set
        notification_revision = notification_revision + 1,
        updated_at = pg_catalog.now()
      where appointment.id = p_appointment_id
      returning appointment.notification_revision into v_old_notification_revision;

      if p_kind = 'level_test' then
        update public.ops_registration_level_tests attempt
        set
          status = 'canceled',
          completed_at = pg_catalog.now(),
          updated_at = pg_catalog.now()
        where attempt.appointment_id = p_appointment_id
          and attempt.status = 'scheduled';
      else
        update public.ops_registration_consultations consultation
        set
          status = 'canceled',
          updated_at = pg_catalog.now()
        where consultation.appointment_id = p_appointment_id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled';
      end if;
      if not found then
        raise exception 'registration_appointment_immutable' using errcode = '40001';
      end if;
      v_canceled_track_ids := v_ordered_track_ids;

      insert into public.ops_registration_appointments(
        task_id,
        kind,
        scheduled_at,
        place,
        status,
        notification_revision,
        created_by
      ) values (
        p_task_id,
        p_kind,
        p_scheduled_at,
        v_place,
        'scheduled',
        1,
        v_actor_id
      ) returning id into v_new_appointment_id;

      v_activity_ids := array[]::uuid[];
      for v_track in
        select track.*
        from pg_catalog.unnest(v_scheduled_track_ids) selected(track_id)
        join public.ops_registration_subject_tracks track on track.id = selected.track_id
        where track.task_id = p_task_id
        order by dashboard_private.registration_subject_sort_order(track.subject), track.id
      loop
        if p_kind = 'level_test' then
          select coalesce(max(attempt.attempt_number), 0) + 1
          into v_attempt_number
          from public.ops_registration_level_tests attempt
          where attempt.track_id = v_track.id;

          insert into public.ops_registration_level_tests(
            track_id, appointment_id, attempt_number, status
          ) values (
            v_track.id, v_new_appointment_id, v_attempt_number, 'scheduled'
          ) returning id into v_activity_id;

          perform dashboard_private.transition_registration_track_status(
            v_track.id, 'level_test_scheduled', null, null, false
          );
        else
          insert into public.ops_registration_consultations(
            track_id, appointment_id, mode, status, director_profile_id,
            ready_at, ready_source
          ) values (
            v_track.id,
            v_new_appointment_id,
            'visit',
            'scheduled',
            v_track.director_profile_id,
            null,
            null
          ) returning id into v_activity_id;

          perform dashboard_private.transition_registration_track_status(
            v_track.id, 'visit_consultation_scheduled', null, null, false
          );
        end if;

        v_activity_ids := pg_catalog.array_append(v_activity_ids, v_activity_id);
        perform dashboard_private.write_registration_track_event(
          p_task_id,
          v_track.id,
          'appointment_replaced',
          v_track.pipeline_status,
          v_track.pipeline_status,
          null,
          pg_catalog.jsonb_build_object(
            'oldAppointmentId', p_appointment_id,
            'newAppointmentId', v_new_appointment_id,
            'oldNotificationRevision', v_old_notification_revision,
            'notificationRevision', v_new_notification_revision,
            'kind', p_kind,
            'oldScheduledAt', v_appointment.scheduled_at,
            'oldPlace', v_appointment.place,
            'scheduledAt', p_scheduled_at,
            'place', v_place,
            'activeTrackIds', pg_catalog.to_jsonb(v_ordered_track_ids),
            'canceledTrackIds', pg_catalog.to_jsonb(v_canceled_track_ids),
            'activityId', v_activity_id,
            'attemptNumber', case when p_kind = 'level_test' then v_attempt_number else null end,
            'changeKind', 'appointment_replaced'
          )
        );
      end loop;

      if p_kind = 'level_test' then
        if exists (
          select 1
          from public.ops_registration_level_tests attempt
          where attempt.appointment_id = p_appointment_id
            and attempt.status in ('scheduled', 'in_progress')
        ) then
          v_old_appointment_status := 'scheduled';
        elsif not exists (
          select 1
          from public.ops_registration_level_tests attempt
          where attempt.appointment_id = p_appointment_id
            and attempt.status in ('completed', 'absent', 'canceled')
            and attempt.status <> 'canceled'
        ) then
          v_old_appointment_status := 'canceled';
        else
          v_old_appointment_status := 'completed';
        end if;
      else
        if exists (
          select 1
          from public.ops_registration_consultations consultation
          where consultation.appointment_id = p_appointment_id
            and consultation.mode = 'visit'
            and consultation.status = 'scheduled'
        ) then
          v_old_appointment_status := 'scheduled';
        elsif not exists (
          select 1
          from public.ops_registration_consultations consultation
          where consultation.appointment_id = p_appointment_id
            and consultation.mode = 'visit'
            and consultation.status <> 'canceled'
        ) then
          v_old_appointment_status := 'canceled';
        else
          v_old_appointment_status := 'completed';
        end if;
      end if;

      update public.ops_registration_appointments appointment
      set status = v_old_appointment_status, updated_at = pg_catalog.now()
      where appointment.id = p_appointment_id;

      perform dashboard_private.recompute_registration_parent(p_task_id);

      v_notification_targets := case
        when p_kind = 'visit_consultation' then pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'appointmentId', p_appointment_id,
            'notificationRevision', v_old_notification_revision
          ),
          pg_catalog.jsonb_build_object(
            'appointmentId', v_new_appointment_id,
            'notificationRevision', v_new_notification_revision
          )
        )
        else '[]'::jsonb
      end;
      v_response := pg_catalog.jsonb_build_object(
        'taskId', p_task_id,
        'appointmentId', v_new_appointment_id,
        'notificationRevision', v_new_notification_revision,
        'oldAppointmentId', p_appointment_id,
        'newAppointmentId', v_new_appointment_id,
        'trackIds', pg_catalog.to_jsonb(v_ordered_track_ids),
        'activityIds', pg_catalog.to_jsonb(v_activity_ids),
        'requiresDirectorAssignmentTrackIds', '[]'::jsonb,
        'notificationTargets', v_notification_targets
      );

      insert into dashboard_private.ops_registration_mutations(
        actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
      ) values (
        v_actor_id, v_request_key, p_task_id, 'save_appointment',
        v_target_fingerprint, v_response
      );
      return v_response;
    end if;

    -- ordinary_appointment_edit
    if v_terminal_child_count > 0
      or v_child_count <> pg_catalog.cardinality(v_scheduled_track_ids)
    then
      raise exception 'registration_appointment_immutable' using errcode = '40001';
    end if;

    for v_track in
      select track.*
      from pg_catalog.unnest(v_track_ids) selected(track_id)
      join public.ops_registration_subject_tracks track on track.id = selected.track_id
      where track.task_id = p_task_id
      order by dashboard_private.registration_subject_sort_order(track.subject), track.id
    loop
      if p_kind = 'level_test' then
        select pg_catalog.count(*)
        into v_active_activity_count
        from public.ops_registration_level_tests attempt
        where attempt.track_id = v_track.id
          and attempt.status in ('scheduled', 'in_progress')
          and attempt.appointment_id is distinct from p_appointment_id;
        if v_active_activity_count > 0 then
          raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
        end if;

        if v_track.id = any(v_existing_track_ids) then
          if v_track.pipeline_status <> 'level_test_scheduled' then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
        else
          select attempt.status
          into v_latest_attempt_status
          from public.ops_registration_level_tests attempt
          where attempt.track_id = v_track.id
          order by attempt.attempt_number desc, attempt.id desc
          limit 1;
          if (
            v_track.pipeline_status = 'inquiry'
            or (
              v_track.pipeline_status = 'waiting'
              and v_track.level_test_retake_decision = 'required'
            )
            or (
              v_track.pipeline_status = 'level_test_scheduled'
              and v_latest_attempt_status in ('absent', 'canceled')
            )
          ) is not true then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
        end if;
      else
        perform dashboard_private.assert_registration_track_director_ready(v_track.id);
        select pg_catalog.count(*)
        into v_active_activity_count
        from public.ops_registration_consultations consultation
        where consultation.track_id = v_track.id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled'
          and consultation.appointment_id is distinct from p_appointment_id;
        if v_active_activity_count > 0 then
          raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
        end if;

        if v_track.id = any(v_existing_track_ids) then
          if v_track.pipeline_status <> 'visit_consultation_scheduled' then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
        else
          if v_track.pipeline_status <> 'consultation_waiting' then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
          select pg_catalog.count(*)
          into v_phone_consultation_count
          from public.ops_registration_consultations consultation
          where consultation.track_id = v_track.id
            and consultation.mode = 'phone'
            and consultation.status = 'waiting';
          if v_phone_consultation_count <> 1 then
            raise exception 'registration_invalid_source_state' using errcode = '40001';
          end if;
        end if;
      end if;
    end loop;

    v_real_diff := v_appointment.scheduled_at is distinct from p_scheduled_at
      or v_appointment.place is distinct from v_place
      or v_track_ids is distinct from v_existing_track_ids;
    if not v_real_diff then
      if p_kind = 'level_test' then
        select coalesce(
          pg_catalog.array_agg(
            attempt.id
            order by dashboard_private.registration_subject_sort_order(track.subject),
              attempt.track_id,
              attempt.id
          ),
          array[]::uuid[]
        )
        into v_activity_ids
        from public.ops_registration_level_tests attempt
        join public.ops_registration_subject_tracks track on track.id = attempt.track_id
        where attempt.appointment_id = p_appointment_id
          and attempt.status = 'scheduled';
      else
        select coalesce(
          pg_catalog.array_agg(
            consultation.id
            order by dashboard_private.registration_subject_sort_order(track.subject),
              consultation.track_id,
              consultation.id
          ),
          array[]::uuid[]
        )
        into v_activity_ids
        from public.ops_registration_consultations consultation
        join public.ops_registration_subject_tracks track on track.id = consultation.track_id
        where consultation.appointment_id = p_appointment_id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled';
      end if;

      v_response := pg_catalog.jsonb_build_object(
        'taskId', p_task_id,
        'appointmentId', p_appointment_id,
        'notificationRevision', v_appointment.notification_revision,
        'trackIds', pg_catalog.to_jsonb(v_ordered_track_ids),
        'activityIds', pg_catalog.to_jsonb(v_activity_ids),
        'requiresDirectorAssignmentTrackIds', '[]'::jsonb,
        'notificationTargets', '[]'::jsonb
      );
      insert into dashboard_private.ops_registration_mutations(
        actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
      ) values (
        v_actor_id, v_request_key, p_task_id, 'save_appointment',
        v_target_fingerprint, v_response
      );
      return v_response;
    end if;

    if p_kind = 'level_test' and pg_catalog.cardinality(v_added_track_ids) > 0 then
      perform 1
      from public.students student
      join (
        select distinct enrollment.student_id
        from public.ops_registration_enrollments enrollment
        join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
        where track.id = any(v_added_track_ids)
          and track.task_id = p_task_id
          and track.pipeline_status = 'waiting'
          and track.waiting_kind = 'current_class'
          and track.level_test_retake_decision = 'required'
          and enrollment.status = 'waitlisted'
          and enrollment.roster_active
          and enrollment.student_id is not null
      ) affected on affected.student_id = student.id
      order by student.id
      for update of student;

      perform 1
      from public.ops_registration_enrollments enrollment
      join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
      where track.id = any(v_added_track_ids)
        and track.task_id = p_task_id
        and track.pipeline_status = 'waiting'
        and track.waiting_kind = 'current_class'
        and track.level_test_retake_decision = 'required'
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active
      order by enrollment.id
      for update of enrollment;

      perform 1
      from public.classes class
      join (
        select distinct enrollment.class_id
        from public.ops_registration_enrollments enrollment
        join public.ops_registration_subject_tracks track on track.id = enrollment.track_id
        where track.id = any(v_added_track_ids)
          and track.task_id = p_task_id
          and track.pipeline_status = 'waiting'
          and track.waiting_kind = 'current_class'
          and track.level_test_retake_decision = 'required'
          and enrollment.status = 'waitlisted'
          and enrollment.roster_active
      ) affected on affected.class_id = class.id
      order by class.id
      for update of class;

      for v_track in
        select track.*
        from pg_catalog.unnest(v_added_track_ids) selected(track_id)
        join public.ops_registration_subject_tracks track on track.id = selected.track_id
        where track.task_id = p_task_id
          and track.pipeline_status = 'waiting'
          and track.waiting_kind = 'current_class'
          and track.level_test_retake_decision = 'required'
        order by dashboard_private.registration_subject_sort_order(track.subject), track.id
      loop
        select enrollment.id, enrollment.student_id, enrollment.class_id
        into v_wait_enrollment_id, v_wait_student_id, v_wait_class_id
        from public.ops_registration_enrollments enrollment
        join public.classes class on class.id = enrollment.class_id
        where enrollment.track_id = v_track.id
          and enrollment.status = 'waitlisted'
          and enrollment.roster_active
          and pg_catalog.btrim(class.subject) = v_track.subject
          and enrollment.student_id = v_task_student_id
        order by enrollment.id
        for update of enrollment, class;
        if not found or v_wait_student_id is null then
          raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
        end if;

        perform dashboard_private.apply_student_class_roster_mode(
          v_wait_student_id,
          v_wait_class_id,
          'removed',
          'waitlist',
          v_wait_enrollment_id,
          'level_test_retake_scheduled',
          v_actor_id
        );
        update public.ops_registration_enrollments enrollment
        set
          status = 'canceled',
          roster_active = false,
          roster_released_at = null,
          roster_release_reason = null,
          roster_release_source_task_id = null,
          roster_release_kind = null,
          updated_at = pg_catalog.now()
        where enrollment.id = v_wait_enrollment_id
          and enrollment.roster_active;
        if not found then
          raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
        end if;
      end loop;
    end if;

    update public.ops_registration_appointments appointment
    set
      scheduled_at = p_scheduled_at,
      place = v_place,
      notification_revision = notification_revision + 1,
      updated_at = pg_catalog.now()
    where appointment.id = p_appointment_id
    returning appointment.notification_revision into v_old_notification_revision;

    for v_track in
      select track.*
      from pg_catalog.unnest(v_deselected_track_ids) selected(track_id)
      join public.ops_registration_subject_tracks track on track.id = selected.track_id
      where track.task_id = p_task_id
      order by dashboard_private.registration_subject_sort_order(track.subject), track.id
    loop
      v_phone_consultation_id := null;
      if p_kind = 'level_test' then
        update public.ops_registration_level_tests attempt
        set
          status = 'canceled',
          completed_at = pg_catalog.now(),
          updated_at = pg_catalog.now()
        where attempt.appointment_id = p_appointment_id
          and attempt.track_id = v_track.id
          and attempt.status = 'scheduled';
        if not found then
          raise exception 'registration_appointment_immutable' using errcode = '40001';
        end if;

        select pg_catalog.count(*)
        into v_active_activity_count
        from public.ops_registration_level_tests attempt
        where attempt.track_id = v_track.id
          and attempt.status in ('scheduled', 'in_progress');
        if v_active_activity_count = 0 then
          perform dashboard_private.transition_registration_track_status(
            v_track.id, 'inquiry', null, null, false
          );
        end if;
      else
        update public.ops_registration_consultations consultation
        set status = 'canceled', updated_at = pg_catalog.now()
        where consultation.appointment_id = p_appointment_id
          and consultation.track_id = v_track.id
          and consultation.mode = 'visit'
          and consultation.status = 'scheduled';
        if not found then
          raise exception 'registration_appointment_immutable' using errcode = '40001';
        end if;

        perform dashboard_private.transition_registration_track_status(
          v_track.id, 'consultation_waiting', null, null, false
        );
        v_director_ready := true;
        begin
          perform dashboard_private.assert_registration_track_director_ready(v_track.id);
        exception
          when sqlstate '40001' then
            if sqlerrm is distinct from 'registration_director_refresh_required' then
              raise;
            end if;
            v_director_ready := false;
        end;

        if v_director_ready then
          if exists (
            select 1
            from public.ops_registration_consultations consultation
            where consultation.mode = 'phone'
              and consultation.status = 'waiting'
              and consultation.track_id = v_track.id
          ) then
            raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
          end if;
          insert into public.ops_registration_consultations(
            track_id, appointment_id, mode, status, director_profile_id,
            ready_at, ready_source
          ) values (
            v_track.id, null, 'phone', 'waiting', v_track.director_profile_id,
            pg_catalog.now(), 'visit_reopened'
          ) returning id into v_phone_consultation_id;
        else
          v_requires_director_assignment_track_ids := pg_catalog.array_append(
            v_requires_director_assignment_track_ids, v_track.id
          );
        end if;
      end if;

      v_canceled_track_ids := pg_catalog.array_append(v_canceled_track_ids, v_track.id);
      perform dashboard_private.write_registration_track_event(
        p_task_id,
        v_track.id,
        'appointment_subject_deselected',
        v_track.pipeline_status,
        case
          when p_kind = 'level_test' and v_active_activity_count = 0 then 'inquiry'
          when p_kind = 'visit_consultation' then 'consultation_waiting'
          else v_track.pipeline_status
        end,
        'appointment_subject_deselected',
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_old_notification_revision,
          'kind', p_kind,
          'scheduledAt', p_scheduled_at,
          'place', v_place,
          'activeTrackIds', pg_catalog.to_jsonb(v_ordered_track_ids),
          'canceledTrackIds', pg_catalog.to_jsonb(v_deselected_track_ids),
          'phoneConsultationId', v_phone_consultation_id,
          'changeKind', 'appointment_subject_deselected'
        )
      );
      if p_kind = 'visit_consultation' and not v_director_ready then
        perform dashboard_private.write_registration_track_event(
          p_task_id,
          v_track.id,
          'director_assignment_required',
          'consultation_waiting',
          'consultation_waiting',
          'appointment_subject_deselected',
          pg_catalog.jsonb_build_object(
            'appointmentId', p_appointment_id,
            'notificationRevision', v_old_notification_revision,
            'changeKind', 'director_assignment_required'
          )
        );
      end if;
    end loop;

    for v_track in
      select track.*
      from pg_catalog.unnest(v_added_track_ids) selected(track_id)
      join public.ops_registration_subject_tracks track on track.id = selected.track_id
      where track.task_id = p_task_id
      order by dashboard_private.registration_subject_sort_order(track.subject), track.id
    loop
      v_phone_consultation_id := null;
      if p_kind = 'level_test' then
        select coalesce(max(attempt.attempt_number), 0) + 1
        into v_attempt_number
        from public.ops_registration_level_tests attempt
        where attempt.track_id = v_track.id;
        insert into public.ops_registration_level_tests(
          track_id, appointment_id, attempt_number, status
        ) values (
          v_track.id, p_appointment_id, v_attempt_number, 'scheduled'
        ) returning id into v_activity_id;
        perform dashboard_private.transition_registration_track_status(
          v_track.id, 'level_test_scheduled', null, null, false
        );
      else
        update public.ops_registration_consultations consultation
        set status = 'canceled', updated_at = pg_catalog.now()
        where consultation.track_id = v_track.id
          and consultation.mode = 'phone'
          and consultation.status = 'waiting'
        returning consultation.id, consultation.director_profile_id
        into v_phone_consultation_id, v_phone_director_id;
        if not found then
          raise exception 'registration_invalid_source_state' using errcode = '40001';
        end if;

        delete from public.dashboard_notifications notification
        where notification.type = 'registration_consultation'
          and notification.read_at is null
          and notification.dedupe_key =
            'registration:' || p_task_id::text || ':track:' || v_track.id::text
            || ':consultation:' || v_phone_consultation_id::text
            || ':director:' || v_phone_director_id::text;

        insert into public.ops_registration_consultations(
          track_id, appointment_id, mode, status, director_profile_id,
          ready_at, ready_source
        ) values (
          v_track.id, p_appointment_id, 'visit', 'scheduled', v_track.director_profile_id,
          null, null
        ) returning id into v_activity_id;
        perform dashboard_private.transition_registration_track_status(
          v_track.id, 'visit_consultation_scheduled', null, null, false
        );
      end if;

      perform dashboard_private.write_registration_track_event(
        p_task_id,
        v_track.id,
        case
          when p_kind = 'level_test' and v_track.pipeline_status = 'inquiry'
            then 'level_test_scheduled'
          when p_kind = 'level_test' then 'level_test_retake_scheduled'
          else 'visit_scheduled'
        end,
        v_track.pipeline_status,
        case when p_kind = 'level_test' then 'level_test_scheduled' else 'visit_consultation_scheduled' end,
        null,
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_old_notification_revision,
          'kind', p_kind,
          'scheduledAt', p_scheduled_at,
          'place', v_place,
          'activityId', v_activity_id,
          'activeTrackIds', pg_catalog.to_jsonb(v_ordered_track_ids),
          'canceledTrackIds', pg_catalog.to_jsonb(v_deselected_track_ids),
          'changeKind', 'appointment_updated'
        )
      );
    end loop;

    for v_track in
      select track.*
      from public.ops_registration_subject_tracks track
      where track.task_id = p_task_id
        and track.id = any(v_track_ids)
        and track.id <> all(v_added_track_ids)
      order by dashboard_private.registration_subject_sort_order(track.subject), track.id
    loop
      perform dashboard_private.write_registration_track_event(
        p_task_id,
        v_track.id,
        'appointment_updated',
        v_track.pipeline_status,
        v_track.pipeline_status,
        null,
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_old_notification_revision,
          'kind', p_kind,
          'scheduledAt', p_scheduled_at,
          'place', v_place,
          'activeTrackIds', pg_catalog.to_jsonb(v_ordered_track_ids),
          'canceledTrackIds', pg_catalog.to_jsonb(v_deselected_track_ids),
          'changeKind', 'appointment_updated'
        )
      );
    end loop;

    if p_kind = 'level_test' then
      select
        coalesce(
          pg_catalog.array_agg(
            attempt.id
            order by dashboard_private.registration_subject_sort_order(track.subject),
              attempt.track_id,
              attempt.id
          ),
          array[]::uuid[]
        ),
        coalesce(
          pg_catalog.array_agg(distinct attempt.track_id order by attempt.track_id),
          array[]::uuid[]
        )
      into v_activity_ids, v_active_track_ids
      from public.ops_registration_level_tests attempt
      join public.ops_registration_subject_tracks track on track.id = attempt.track_id
      where attempt.appointment_id = p_appointment_id
        and attempt.status = 'scheduled';
    else
      select
        coalesce(
          pg_catalog.array_agg(
            consultation.id
            order by dashboard_private.registration_subject_sort_order(track.subject),
              consultation.track_id,
              consultation.id
          ),
          array[]::uuid[]
        ),
        coalesce(
          pg_catalog.array_agg(distinct consultation.track_id order by consultation.track_id),
          array[]::uuid[]
        )
      into v_activity_ids, v_active_track_ids
      from public.ops_registration_consultations consultation
      join public.ops_registration_subject_tracks track on track.id = consultation.track_id
      where consultation.appointment_id = p_appointment_id
        and consultation.mode = 'visit'
        and consultation.status = 'scheduled';
    end if;
    if v_active_track_ids is distinct from v_track_ids then
      raise exception 'registration_appointment_active_activity_exists' using errcode = '23514';
    end if;

    select coalesce(
      pg_catalog.array_agg(
        required.track_id
        order by dashboard_private.registration_subject_sort_order(track.subject),
          required.track_id
      ),
      array[]::uuid[]
    )
    into v_requires_director_assignment_track_ids
    from (
      select distinct requested.track_id
      from pg_catalog.unnest(v_requires_director_assignment_track_ids) requested(track_id)
    ) required
    join public.ops_registration_subject_tracks track
      on track.id = required.track_id
      and track.task_id = p_task_id;

    perform dashboard_private.recompute_registration_parent(p_task_id);
    v_notification_targets := case
      when p_kind = 'visit_consultation' then pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'appointmentId', p_appointment_id,
          'notificationRevision', v_old_notification_revision
        )
      )
      else '[]'::jsonb
    end;
    v_response := pg_catalog.jsonb_build_object(
      'taskId', p_task_id,
      'appointmentId', p_appointment_id,
      'notificationRevision', v_old_notification_revision,
      'trackIds', pg_catalog.to_jsonb(v_ordered_track_ids),
      'activityIds', pg_catalog.to_jsonb(v_activity_ids),
      'requiresDirectorAssignmentTrackIds',
        pg_catalog.to_jsonb(v_requires_director_assignment_track_ids),
      'notificationTargets', v_notification_targets
    );

    insert into dashboard_private.ops_registration_mutations(
      actor_id, request_key, task_id, mutation_type, target_fingerprint, response_payload
    ) values (
      v_actor_id, v_request_key, p_task_id, 'save_appointment',
      v_target_fingerprint, v_response
    );
    return v_response;
  end if;

  for v_track in
    select track.*
    from pg_catalog.unnest(v_track_ids) selected(track_id)
    join public.ops_registration_subject_tracks track
      on track.id = selected.track_id
    where track.task_id = p_task_id
    order by dashboard_private.registration_subject_sort_order(track.subject), track.id
  loop
    if p_kind = 'level_test' then
      select pg_catalog.count(*)
      into v_active_activity_count
      from public.ops_registration_level_tests attempt
      where attempt.track_id = v_track.id
        and attempt.status in ('scheduled', 'in_progress');
      if v_active_activity_count > 0 then
        raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
      end if;

      select attempt.status
      into v_latest_attempt_status
      from public.ops_registration_level_tests attempt
      where attempt.track_id = v_track.id
      order by attempt.attempt_number desc, attempt.id desc
      limit 1;

      if (
        v_track.pipeline_status = 'inquiry'
        or (
          v_track.pipeline_status = 'waiting'
          and v_track.level_test_retake_decision = 'required'
        )
        or (
          v_track.pipeline_status = 'level_test_scheduled'
          and v_latest_attempt_status in ('absent', 'canceled')
        )
      ) is not true then
        raise exception 'registration_invalid_source_state' using errcode = '40001';
      end if;
    else
      perform dashboard_private.assert_registration_track_director_ready(v_track.id);
      if v_track.pipeline_status <> 'consultation_waiting' then
        raise exception 'registration_invalid_source_state' using errcode = '40001';
      end if;

      select pg_catalog.count(*)
      into v_active_activity_count
      from public.ops_registration_consultations consultation
      where consultation.track_id = v_track.id
        and consultation.mode = 'visit'
        and consultation.status = 'scheduled';
      if v_active_activity_count > 0 then
        raise exception 'registration_appointment_active_activity_exists' using errcode = '40001';
      end if;

      select pg_catalog.count(*)
      into v_phone_consultation_count
      from public.ops_registration_consultations consultation
      where consultation.track_id = v_track.id
        and consultation.mode = 'phone'
        and consultation.status = 'waiting';
      if v_phone_consultation_count <> 1 then
        raise exception 'registration_invalid_source_state' using errcode = '40001';
      end if;
    end if;
  end loop;

  if p_kind = 'level_test' then
    -- current_class_retest_student_locks
    perform 1
    from public.students student
    join (
      select distinct enrollment.student_id
      from public.ops_registration_enrollments enrollment
      join public.ops_registration_subject_tracks track
        on track.id = enrollment.track_id
      where track.id = any(v_track_ids)
        and track.task_id = p_task_id
        and track.pipeline_status = 'waiting'
        and track.waiting_kind = 'current_class'
        and track.level_test_retake_decision = 'required'
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active
        and enrollment.student_id is not null
    ) affected on affected.student_id = student.id
    order by student.id
    for update of student;

    -- current_class_retest_claim_locks
    perform 1
    from public.ops_registration_enrollments enrollment
    join public.ops_registration_subject_tracks track
      on track.id = enrollment.track_id
    where track.id = any(v_track_ids)
      and track.task_id = p_task_id
      and track.pipeline_status = 'waiting'
      and track.waiting_kind = 'current_class'
      and track.level_test_retake_decision = 'required'
      and enrollment.status = 'waitlisted'
      and enrollment.roster_active
    order by enrollment.id
    for update of enrollment;

    -- current_class_retest_class_locks
    perform 1
    from public.classes class
    join (
      select distinct enrollment.class_id
      from public.ops_registration_enrollments enrollment
      join public.ops_registration_subject_tracks track
        on track.id = enrollment.track_id
      where track.id = any(v_track_ids)
        and track.task_id = p_task_id
        and track.pipeline_status = 'waiting'
        and track.waiting_kind = 'current_class'
        and track.level_test_retake_decision = 'required'
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active
    ) affected on affected.class_id = class.id
    order by class.id
    for update of class;

    for v_track in
      select track.*
      from pg_catalog.unnest(v_track_ids) selected(track_id)
      join public.ops_registration_subject_tracks track
        on track.id = selected.track_id
      where track.task_id = p_task_id
        and track.pipeline_status = 'waiting'
        and track.waiting_kind = 'current_class'
        and track.level_test_retake_decision = 'required'
      order by dashboard_private.registration_subject_sort_order(track.subject), track.id
    loop
      select enrollment.id, enrollment.student_id, enrollment.class_id
      into v_wait_enrollment_id, v_wait_student_id, v_wait_class_id
      from public.ops_registration_enrollments enrollment
      join public.classes class on class.id = enrollment.class_id
      where enrollment.track_id = v_track.id
        and enrollment.status = 'waitlisted'
        and enrollment.roster_active
        and pg_catalog.btrim(class.subject) = v_track.subject
        and enrollment.student_id = v_task_student_id
      order by enrollment.id
      for update of enrollment, class;
      if not found or v_wait_student_id is null then
        raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
      end if;

      perform dashboard_private.apply_student_class_roster_mode(
        v_wait_student_id,
        v_wait_class_id,
        'removed',
        'waitlist',
        v_wait_enrollment_id,
        'registration level-test retake scheduled',
        v_actor_id
      );

      -- current_class_retest_claim_deactivation
      update public.ops_registration_enrollments enrollment
      set
        status = 'canceled',
        roster_active = false,
        updated_at = pg_catalog.now()
      where enrollment.id = v_wait_enrollment_id
        and enrollment.roster_active;
      if not found then
        raise exception 'registration_student_class_claim_invariant' using errcode = '23514';
      end if;
    end loop;
  end if;

  insert into public.ops_registration_appointments(
    task_id,
    kind,
    scheduled_at,
    place,
    status,
    notification_revision,
    created_by
  ) values (
    p_task_id,
    p_kind,
    p_scheduled_at,
    v_place,
    'scheduled',
    1,
    v_actor_id
  )
  returning id into v_appointment_id;

  for v_track in
    select track.*
    from pg_catalog.unnest(v_track_ids) selected(track_id)
    join public.ops_registration_subject_tracks track
      on track.id = selected.track_id
    where track.task_id = p_task_id
    order by dashboard_private.registration_subject_sort_order(track.subject), track.id
  loop
    if p_kind = 'level_test' then
      select coalesce(max(attempt.attempt_number), 0) + 1
      into v_attempt_number
      from public.ops_registration_level_tests attempt
      where attempt.track_id = v_track.id;

      insert into public.ops_registration_level_tests(
        track_id,
        appointment_id,
        attempt_number,
        status
      ) values (
        v_track.id,
        v_appointment_id,
        v_attempt_number,
        'scheduled'
      )
      returning id into v_activity_id;

      v_event_type := case
        when v_track.pipeline_status = 'inquiry' then 'level_test_scheduled'
        else 'level_test_retake_scheduled'
      end;
      perform dashboard_private.transition_registration_track_status(
        v_track.id,
        'level_test_scheduled',
        null,
        null,
        false
      );
    else
      -- visit_phone_cancellation
      update public.ops_registration_consultations consultation
      set
        status = 'canceled',
        updated_at = pg_catalog.now()
      where consultation.track_id = v_track.id
        and consultation.mode = 'phone'
        and consultation.status = 'waiting'
      returning consultation.id, consultation.director_profile_id
      into v_phone_consultation_id, v_phone_director_id;
      if not found then
        raise exception 'registration_invalid_source_state' using errcode = '40001';
      end if;

      -- visit_phone_notification_cleanup
      delete from public.dashboard_notifications notification
      where notification.type = 'registration_consultation'
        and notification.read_at is null
        and notification.dedupe_key =
          'registration:' || p_task_id::text || ':track:' || v_track.id::text
          || ':consultation:' || v_phone_consultation_id::text
          || ':director:' || v_phone_director_id::text;

      insert into public.ops_registration_consultations(
        track_id,
        appointment_id,
        mode,
        status,
        director_profile_id,
        ready_at,
        ready_source
      ) values (
        v_track.id,
        v_appointment_id,
        'visit',
        'scheduled',
        v_track.director_profile_id,
        null,
        null
      )
      returning id into v_activity_id;

      v_event_type := 'visit_scheduled';
      perform dashboard_private.transition_registration_track_status(
        v_track.id,
        'visit_consultation_scheduled',
        null,
        null,
        false
      );
    end if;

    v_activity_ids := pg_catalog.array_append(v_activity_ids, v_activity_id);
    perform dashboard_private.write_registration_track_event(
      p_task_id,
      v_track.id,
      v_event_type,
      v_track.pipeline_status,
      case
        when p_kind = 'level_test' then 'level_test_scheduled'
        else 'visit_consultation_scheduled'
      end,
      null,
      pg_catalog.jsonb_build_object(
        'appointmentId', v_appointment_id,
        'notificationRevision', 1,
        'kind', p_kind,
        'scheduledAt', p_scheduled_at,
        'place', v_place,
        'activityId', v_activity_id,
        'attemptNumber', case when p_kind = 'level_test' then v_attempt_number else null end,
        'canceledPhoneConsultationId', case
          when p_kind = 'visit_consultation' then v_phone_consultation_id
          else null
        end,
        'activeTrackIds', pg_catalog.to_jsonb(v_ordered_track_ids),
        'canceledTrackIds', '[]'::jsonb,
        'changeKind', 'created'
      )
    );
  end loop;

  perform dashboard_private.recompute_registration_parent(p_task_id);

  v_response := pg_catalog.jsonb_build_object(
    'taskId', p_task_id,
    'appointmentId', v_appointment_id,
    'notificationRevision', 1,
    'kind', p_kind,
    'scheduledAt', p_scheduled_at,
    'place', v_place,
    'trackIds', pg_catalog.to_jsonb(v_ordered_track_ids),
    'activityIds', pg_catalog.to_jsonb(v_activity_ids),
    'requiresDirectorAssignmentTrackIds', '[]'::jsonb,
    'notificationTargets', case
      when p_kind = 'visit_consultation' then pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'appointmentId', v_appointment_id,
          'notificationRevision', 1
        )
      )
      else '[]'::jsonb
    end
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
    'save_appointment',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;

create or replace view public.ops_registration_appointment_calendar
with (security_invoker = true)
as
with canonical_participants as (
  select
    level_test.appointment_id,
    track.id as track_id,
    track.subject
  from public.ops_registration_level_tests level_test
  join public.ops_registration_appointments appointment
    on appointment.id = level_test.appointment_id
   and appointment.kind = 'level_test'
  join public.ops_registration_subject_tracks track
    on track.id = level_test.track_id

  union

  select
    consultation.appointment_id,
    track.id as track_id,
    track.subject
  from public.ops_registration_consultations consultation
  join public.ops_registration_appointments appointment
    on appointment.id = consultation.appointment_id
   and appointment.kind = 'visit_consultation'
  join public.ops_registration_subject_tracks track
    on track.id = consultation.track_id
  where consultation.mode = 'visit'
    and consultation.appointment_id is not null
),
appointment_participants as (
  select
    participant.appointment_id,
    array_agg(
      participant.track_id
      order by
        case participant.subject
          when '영어' then 10
          when '수학' then 20
          when '과학' then 30
          else 2147483647
        end,
        participant.track_id
    ) as track_ids,
    array_agg(
      participant.subject
      order by
        case participant.subject
          when '영어' then 10
          when '수학' then 20
          when '과학' then 30
          else 2147483647
        end,
        participant.track_id
    ) as subjects
  from canonical_participants participant
  group by participant.appointment_id
)
select
  appointment.id as appointment_id,
  appointment.task_id,
  task.student_name,
  appointment.kind,
  appointment.scheduled_at,
  appointment.place,
  appointment.status,
  appointment.notification_revision,
  participant.track_ids,
  participant.subjects
from public.ops_registration_appointments appointment
join public.ops_tasks task
  on task.id = appointment.task_id
join appointment_participants participant
  on participant.appointment_id = appointment.id;

create or replace function dashboard_private.registration_appointment_track_ids_v1(
  p_appointment_id uuid
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.array_agg(
      participant.track_id order by
        dashboard_private.registration_subject_sort_order(track.subject),
        participant.track_id
    ),
    array[]::uuid[]
  )
  from (
    select level_test.track_id
    from public.ops_registration_level_tests level_test
    where level_test.appointment_id = p_appointment_id
      and level_test.status in ('scheduled', 'in_progress')
    union
    select consultation.track_id
    from public.ops_registration_consultations consultation
    where consultation.appointment_id = p_appointment_id
      and consultation.mode = 'visit'
      and consultation.status = 'scheduled'
  ) participant
  join public.ops_registration_subject_tracks track on track.id = participant.track_id;
$$;

create or replace function dashboard_private.registration_appointment_director_targets_v1(
  p_appointment_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(target.item order by target.profile_id),
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'target_kind', 'audience',
        'target_key', 'audience:track_director',
        'target_profile_id', null,
        'connection_key', null,
        'target_snapshot', pg_catalog.jsonb_build_object(
          'audience_key', 'track_director'
        )
      )
    )
  )
  from (
    select distinct
      track.director_profile_id as profile_id,
      pg_catalog.jsonb_build_object(
        'target_kind', 'profile',
        'target_key', 'profile:' || track.director_profile_id::text,
        'target_profile_id', track.director_profile_id,
        'connection_key', null,
        'target_snapshot', pg_catalog.jsonb_build_object(
          'profile_id', track.director_profile_id
        )
      ) as item
    from pg_catalog.unnest(
      dashboard_private.registration_appointment_track_ids_v1(p_appointment_id)
    ) participant(track_id)
    join public.ops_registration_subject_tracks track on track.id = participant.track_id
    join public.profiles profile on profile.id = track.director_profile_id
    where track.director_profile_id is not null
      and dashboard_private.is_active_subject_director(
        track.director_profile_id,
        track.subject
      )
      and dashboard_private.notification_profile_is_active_v1(track.director_profile_id)
  ) target;
$$;

create or replace function dashboard_private.registration_appointment_director_target_hash_v1(
  p_appointment_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select dashboard_private.notification_target_set_hash_v1(
    dashboard_private.registration_appointment_director_targets_v1(p_appointment_id)
  );
$$;

create or replace function dashboard_private.registration_appointment_rule_snapshot_v1(
  p_kind text,
  p_enabled_only boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'rule_id', rule.id,
        'rule_revision', rule.revision::text,
        'template_id', rule.active_template_id,
        'audience_key', rule.audience_key,
        'channel_key', rule.channel_key,
        'connection_key', case
          when rule.channel_key = 'google_chat' then 'google_chat.management'
          else null
        end,
        'rule_variant_key', rule.rule_variant_key,
        'schedule_key', rule.schedule_key,
        'schedule_config', rule.schedule_config,
        'enabled', rule.enabled
      ) order by
        case rule.rule_variant_key
          when 'previous_day_at' then 1
          when 'same_day_at' then 2
          when 'offset_before' then 3
          else 4
        end,
        rule.audience_key,
        rule.channel_key,
        rule.id
    ),
    '[]'::jsonb
  )
  from dashboard_private.notification_rules rule
  where rule.scope_key = 'global'
    and rule.workflow_key = 'registration'
    and rule.event_key = 'registration.appointment_reminder_due'
    and (not p_enabled_only or rule.enabled)
    and (
      p_kind is null
      or dashboard_private.registration_appointment_reminder_applicable_v1(
        p_kind,
        rule.audience_key,
        rule.channel_key
      )
    );
$$;

create or replace function dashboard_private.registration_appointment_source_snapshot_v1(
  p_appointment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_appointment public.ops_registration_appointments%rowtype;
  v_track_ids uuid[];
  v_subjects text[];
  v_director_profile_ids uuid[];
  v_management_profile_ids uuid[];
  v_participants jsonb;
  v_student_name text;
begin
  select appointment.*
  into v_appointment
  from public.ops_registration_appointments appointment
  where appointment.id = p_appointment_id;
  if not found then
    return null;
  end if;

  v_track_ids := dashboard_private.registration_appointment_track_ids_v1(
    p_appointment_id
  );
  select coalesce(
    pg_catalog.array_agg(
      track.subject order by
        dashboard_private.registration_subject_sort_order(track.subject),
        track.id
    ),
    array[]::text[]
  )
  into v_subjects
  from public.ops_registration_subject_tracks track
  where track.id = any(v_track_ids);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'track_id', track.id,
        'subject', track.subject,
        'director_profile_id', track.director_profile_id
      ) order by
        dashboard_private.registration_subject_sort_order(track.subject),
        track.id
    ),
    '[]'::jsonb
  )
  into v_participants
  from public.ops_registration_subject_tracks track
  where track.id = any(v_track_ids);

  select coalesce(
    pg_catalog.array_agg(distinct track.director_profile_id order by track.director_profile_id)
      filter (where track.director_profile_id is not null),
    array[]::uuid[]
  )
  into v_director_profile_ids
  from public.ops_registration_subject_tracks track
  join public.profiles profile on profile.id = track.director_profile_id
  where track.id = any(v_track_ids)
    and dashboard_private.is_active_subject_director(
      track.director_profile_id,
      track.subject
    )
    and dashboard_private.notification_profile_is_active_v1(track.director_profile_id);

  select coalesce(
    pg_catalog.array_agg(profile.id order by profile.id),
    array[]::uuid[]
  )
  into v_management_profile_ids
  from public.profiles profile
  where profile.role in ('admin', 'staff')
    and dashboard_private.notification_profile_is_active_v1(profile.id);

  select task.student_name
  into v_student_name
  from public.ops_tasks task
  where task.id = v_appointment.task_id;

  return pg_catalog.jsonb_build_object(
    'appointment_id', v_appointment.id,
    'task_id', v_appointment.task_id,
    'student_name', coalesce(v_student_name, ''),
    'kind', v_appointment.kind,
    'scheduled_at', v_appointment.scheduled_at,
    'place', v_appointment.place,
    'status', v_appointment.status,
    'notification_revision', v_appointment.notification_revision,
    'recipient_revision', v_appointment.recipient_revision::text,
    'track_ids', pg_catalog.to_jsonb(v_track_ids),
    'subjects', pg_catalog.to_jsonb(v_subjects),
    'participants', v_participants,
    'director_profile_ids', pg_catalog.to_jsonb(v_director_profile_ids),
    'management_profile_ids', pg_catalog.to_jsonb(v_management_profile_ids),
    'current_rules', dashboard_private.registration_appointment_rule_snapshot_v1(
      v_appointment.kind,
      false
    )
  );
end;
$$;

create or replace function dashboard_private.preview_registration_appointment_reminders_v1(
  p_kind text,
  p_scheduled_at timestamptz,
  p_track_ids uuid[]
)
returns table (
  rule_id uuid,
  rule_revision text,
  variant_key text,
  scheduled_for timestamptz,
  audience_key text,
  channel_key text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
begin
  perform dashboard_private.assert_registration_reminder_runtime_v1();
  perform dashboard_private.assert_registration_reminder_access_v1();
  if p_kind not in ('level_test', 'visit_consultation')
    or p_scheduled_at is null
    or p_track_ids is null
    or pg_catalog.cardinality(p_track_ids) not between 1 and 3
    or exists (
      select 1
      from pg_catalog.unnest(p_track_ids) track_id(value)
      where track_id.value is null
    )
  then
    raise exception 'registration_reminder_preview_invalid' using errcode = '22023';
  end if;

  return query
  select
    rule.id,
    rule.revision::text,
    rule.rule_variant_key,
    calculated.scheduled_for,
    rule.audience_key,
    rule.channel_key
  from dashboard_private.notification_rules rule
  cross join lateral (
    select dashboard_private.calculate_registration_reminder_schedule_v1(
      rule.schedule_key,
      rule.schedule_config,
      p_scheduled_at
    ) as scheduled_for
  ) calculated
  where rule.scope_key = 'global'
    and rule.workflow_key = 'registration'
    and rule.event_key = 'registration.appointment_reminder_due'
    and rule.enabled
    and dashboard_private.registration_appointment_reminder_applicable_v1(
      p_kind,
      rule.audience_key,
      rule.channel_key
    )
    and v_now < calculated.scheduled_for
    and calculated.scheduled_for < p_scheduled_at
  order by calculated.scheduled_for, rule.id;
end;
$$;

create or replace function public.preview_registration_appointment_reminders_v1(
  p_kind text,
  p_scheduled_at timestamptz,
  p_track_ids uuid[]
)
returns table (
  rule_id uuid,
  rule_revision text,
  variant_key text,
  scheduled_for timestamptz,
  audience_key text,
  channel_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from dashboard_private.preview_registration_appointment_reminders_v1(
    p_kind,
    p_scheduled_at,
    p_track_ids
  );
$$;

create or replace function dashboard_private.assign_registration_track_director_with_reminders_v1_impl(
  p_track_id uuid,
  p_director_profile_id uuid,
  p_assignment_source text,
  p_rule_key text,
  p_expected_common_revision integer,
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
  v_assignment_source text := nullif(pg_catalog.btrim(p_assignment_source), '');
  v_rule_key text := nullif(pg_catalog.btrim(p_rule_key), '');
  v_task_id uuid;
  v_appointment_id uuid;
  v_consultation_id uuid;
  v_detail public.ops_registration_details%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_resolution jsonb;
  v_next_source text;
  v_next_rule_key text;
  v_event_type text;
  v_next_assigned_at timestamptz;
  v_assignment_changed boolean;
  v_target_fingerprint jsonb;
  v_receipt_matches boolean;
  v_receipt_found boolean := false;
  v_before_targets jsonb := '[]'::jsonb;
  v_after_targets jsonb := '[]'::jsonb;
  v_previous_target_set_hash text;
  v_current_target_set_hash text;
  v_response jsonb;
  v_source_event_id uuid;
  v_notification_revision integer;
  v_recipient_revision bigint;
  v_target_job_id uuid;
begin
  perform dashboard_private.assert_registration_reminder_runtime_v1();
  if v_actor_id is null then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  if v_request_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_assignment_source not in ('default', 'manual', 'clear_default') then
    raise exception 'registration_director_assignment_source_invalid' using errcode = '22023';
  end if;
  if p_expected_common_revision is null or p_expected_common_revision <= 0 then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'notification-control-plane-workflow:registration',
    0
  ));

  select track.task_id into v_task_id
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id;
  if v_task_id is null then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration:workflow:' || v_task_id::text, 0)
  );

  perform 1
  from public.ops_tasks task
  where task.id = v_task_id
    and task.type = 'registration'
  for update;
  if not found then
    raise exception 'registration_access_denied' using errcode = '42501';
  end if;
  select detail.* into v_detail
  from public.ops_registration_details detail
  where detail.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_detail_required' using errcode = '23514';
  end if;
  select track.* into v_track
  from public.ops_registration_subject_tracks track
  where track.id = p_track_id
    and track.task_id = v_task_id
  for update;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;

  select consultation.id, consultation.appointment_id
  into v_consultation_id, v_appointment_id
  from public.ops_registration_consultations consultation
  where consultation.track_id = p_track_id
    and consultation.mode = 'visit'
    and consultation.status = 'scheduled'
  order by consultation.id
  limit 1;

  perform dashboard_private.assert_registration_mutation_access(
    v_task_id,
    p_track_id,
    'assign_director'
  );
  v_target_fingerprint := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'trackId', p_track_id,
    'directorProfileId', p_director_profile_id,
    'assignmentSource', v_assignment_source,
    'ruleKey', v_rule_key,
    'expectedCommonRevision', p_expected_common_revision
  );
  select
    mutation.response_payload,
    mutation.task_id = v_task_id
      and mutation.mutation_type = 'assign_director'
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

  if v_appointment_id is null then
    return dashboard_private.assign_registration_track_director_impl(
      p_track_id,
      p_director_profile_id,
      p_assignment_source,
      p_rule_key,
      p_expected_common_revision,
      p_request_key
    );
  end if;
  if v_detail.common_revision <> p_expected_common_revision then
    raise exception 'registration_common_revision_conflict' using errcode = '40001';
  end if;
  if v_track.pipeline_status in ('registered', 'not_registered', 'inquiry_closed') then
    raise exception 'registration_director_assignment_terminal' using errcode = '40001';
  end if;
  if v_assignment_source = 'clear_default' or p_director_profile_id is null then
    raise exception 'registration_visit_director_required' using errcode = '22023';
  end if;

  v_resolution := dashboard_private.resolve_registration_default_director(
    v_track.subject,
    v_detail.school_grade,
    v_detail.inquiry_at
  );
  if v_assignment_source = 'default' then
    if v_rule_key is null
      or v_track.director_assignment_source is not null
        and v_track.director_assignment_source <> 'default'
      or v_resolution ->> 'status' <> 'resolved'
      or nullif(v_resolution ->> 'profileId', '')::uuid
        is distinct from p_director_profile_id
      or v_resolution ->> 'ruleKey' is distinct from v_rule_key
    then
      raise exception 'registration_director_default_stale' using errcode = '40001';
    end if;
    v_next_source := 'default';
    v_next_rule_key := v_rule_key;
    v_event_type := 'director_default_resolved';
  else
    if v_rule_key is not null then
      raise exception 'registration_director_manual_invalid' using errcode = '22023';
    end if;
    v_next_source := 'manual';
    v_next_rule_key := null;
    v_event_type := 'director_manual_override';
  end if;
  if not dashboard_private.is_active_subject_director(
    p_director_profile_id,
    v_track.subject
  ) then
    raise exception 'registration_director_refresh_required' using errcode = '40001';
  end if;

  perform 1
  from public.ops_registration_appointments appointment
  where appointment.id = v_appointment_id
    and appointment.status = 'scheduled'
  for update of appointment;
  if not found then
    raise exception 'registration_invalid_source_state' using errcode = '40001';
  end if;
  perform 1
  from public.ops_registration_consultations consultation
  where consultation.appointment_id = v_appointment_id
    and consultation.mode = 'visit'
    and consultation.status = 'scheduled'
  order by consultation.track_id, consultation.id
  for update of consultation;

  v_before_targets := dashboard_private.registration_appointment_director_targets_v1(
    v_appointment_id
  );
  v_previous_target_set_hash := dashboard_private.notification_target_set_hash_v1(
    v_before_targets
  );

  v_assignment_changed :=
    v_track.director_profile_id is distinct from p_director_profile_id
    or v_track.director_assignment_source is distinct from v_next_source
    or v_track.director_assignment_rule_key is distinct from v_next_rule_key;
  v_next_assigned_at := case
    when v_assignment_changed then pg_catalog.now()
    else v_track.director_assigned_at
  end;
  if v_assignment_changed then
    update public.ops_registration_subject_tracks track
    set
      director_profile_id = p_director_profile_id,
      director_assignment_source = v_next_source,
      director_assignment_rule_key = v_next_rule_key,
      director_assigned_at = v_next_assigned_at,
      updated_at = pg_catalog.now()
    where track.id = p_track_id;
    update public.ops_registration_consultations consultation
    set
      director_profile_id = p_director_profile_id,
      updated_at = pg_catalog.now()
    where consultation.id = v_consultation_id;
  end if;

  v_source_event_id := dashboard_private.write_registration_track_event_v2(
    v_task_id,
    p_track_id,
    v_event_type,
    coalesce(v_track.director_assignment_source, 'unassigned'),
    coalesce(v_next_source, 'unassigned'),
    null,
    pg_catalog.jsonb_build_object(
      'appointmentId', v_appointment_id,
      'previousDirectorProfileId', v_track.director_profile_id,
      'directorProfileId', p_director_profile_id,
      'ruleKey', v_next_rule_key,
      'recipientSetChanged', (
        v_before_targets
          <> dashboard_private.registration_appointment_director_targets_v1(
            v_appointment_id
          )
      )
    ),
    'user',
    null
  );

  v_after_targets := dashboard_private.registration_appointment_director_targets_v1(
    v_appointment_id
  );
  v_current_target_set_hash := dashboard_private.notification_target_set_hash_v1(
    v_after_targets
  );
  if v_before_targets <> v_after_targets then
    update public.ops_registration_appointments appointment
    set
      recipient_revision = recipient_revision + 1,
      updated_at = pg_catalog.now()
    where appointment.id = v_appointment_id
    returning appointment.notification_revision, appointment.recipient_revision
    into v_notification_revision, v_recipient_revision;
    v_target_job_id := dashboard_private.enqueue_notification_target_reconciliation_job_v1(
      'registration',
      'registration_appointment',
      v_appointment_id::text,
      v_notification_revision,
      v_source_event_id,
      'recipient_set_changed',
      v_recipient_revision,
      v_previous_target_set_hash,
      v_current_target_set_hash
    );
  else
    select appointment.notification_revision, appointment.recipient_revision
    into v_notification_revision, v_recipient_revision
    from public.ops_registration_appointments appointment
    where appointment.id = v_appointment_id;
  end if;

  perform dashboard_private.recompute_registration_parent(v_task_id);
  v_response := pg_catalog.jsonb_build_object(
    'taskId', v_task_id,
    'commonRevision', v_detail.common_revision,
    'trackId', p_track_id,
    'subject', v_track.subject,
    'status', v_track.pipeline_status,
    'directorProfileId', p_director_profile_id,
    'directorAssignmentSource', v_next_source,
    'directorAssignmentRuleKey', v_next_rule_key,
    'directorAssignedAt', v_next_assigned_at,
    'consultationId', v_consultation_id,
    'appointmentId', v_appointment_id,
    'notificationRevision', v_notification_revision,
    'recipientRevision', v_recipient_revision::text,
    'notificationId', null,
    'notificationDedupeKey', null,
    'requiresDirectorAssignment', false
  );
  if v_target_job_id is not null then
    v_response := dashboard_private.append_registration_notification_jobs_v1(
      v_response,
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'job_kind', 'target_reconciliation',
          'job_id', v_target_job_id
        )
      )
    );
  end if;
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
    v_task_id,
    'assign_director',
    v_target_fingerprint,
    v_response
  );
  return v_response;
end;
$$;


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
  v_task public.ops_tasks%rowtype;
  v_track public.ops_registration_subject_tracks%rowtype;
  v_detail public.ops_registration_details%rowtype;
  v_registration_source record;
  v_occurred_at timestamptz := pg_catalog.clock_timestamp();
  v_event_id uuid;
  v_event_key text;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_payload jsonb;
  v_base_payload jsonb;
  v_occurrences jsonb := '[]'::jsonb;
  v_occurrence jsonb;
  v_source_type text := 'ops_task_event';
  v_source_id text;
  v_source_revision bigint;
  v_occurrence_key text;
  v_appointment_id uuid;
  v_appointment public.ops_registration_appointments%rowtype;
  v_consultation public.ops_registration_consultations%rowtype;
  v_track_ids uuid[] := array[]::uuid[];
  v_subjects text[] := array[]::text[];
  v_director_profile_ids uuid[] := array[]::uuid[];
  v_message public.ops_registration_messages%rowtype;
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

  select task, track, detail
  into v_registration_source
  from public.ops_tasks task
  join public.ops_registration_subject_tracks track
    on track.task_id = task.id
  join public.ops_registration_details detail
    on detail.task_id = task.id
  where task.id = p_task_id
    and task.type = 'registration'
    and track.id = p_track_id;
  if not found then
    raise exception 'registration_track_not_found' using errcode = 'P0002';
  end if;
  v_task := v_registration_source.task;
  v_track := v_registration_source.track;
  v_detail := v_registration_source.detail;

  insert into public.ops_task_events(
    task_id, actor_id, event_type, field_name,
    before_value, after_value, created_at
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
      'subject', v_track.subject,
      'source', p_source,
      'destination', p_destination,
      'reason_code', nullif(pg_catalog.btrim(p_reason_code), ''),
      'metadata', v_metadata,
      'occurred_at', v_occurred_at
    )::text,
    v_occurred_at
  )
  returning id into v_event_id;

  v_event_key := dashboard_private.registration_track_event_key_v1(
    p_event_type,
    v_metadata
  );
  if v_event_key is null then
    return v_event_id;
  end if;

  v_source_id := v_event_id::text;
  v_occurrence_key := v_event_id::text;
  v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'task_id', v_task.id,
    'track_id', v_track.id,
    'subject', v_track.subject,
    'student_name', v_task.student_name,
    'grade', v_detail.school_grade,
    'inquiry_at', v_detail.inquiry_at,
    'status', v_track.pipeline_status,
    'class_name', v_task.class_name,
    'registration_checked', coalesce(v_detail.admission_notice_sent, false),
    'requester_profile_id', v_task.requested_by,
    'director_profile_id', v_track.director_profile_id,
    'source', p_source,
    'destination', p_destination,
    'reason_code', nullif(pg_catalog.btrim(p_reason_code), ''),
    'actor_kind', p_actor_kind,
    'system_source', nullif(pg_catalog.btrim(p_system_source), ''),
    'source_event_id', v_event_id,
    'occurred_at', v_occurred_at
  ));
  v_base_payload := v_payload;

  if v_event_key like 'registration.visit_%' then
    if p_event_type = 'appointment_replaced' then
      if nullif(v_metadata ->> 'oldAppointmentId', '') is null
        or nullif(v_metadata ->> 'newAppointmentId', '') is null
        or nullif(v_metadata ->> 'oldNotificationRevision', '') is null
        or nullif(v_metadata ->> 'notificationRevision', '') is null
      then
        raise exception 'registration_visit_replacement_pair_required'
          using errcode = '22023';
      end if;
      -- A replacement is one raw semantic source row and one canonical event
      -- key, but the immutable old/new appointment revisions are two distinct
      -- aggregate occurrences. Replays of the other participant track resolve
      -- to these same two occurrence identities.
      v_occurrences := pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'appointment_id', v_metadata ->> 'oldAppointmentId',
          'source_revision', v_metadata ->> 'oldNotificationRevision'
        ),
        pg_catalog.jsonb_build_object(
          'appointment_id', v_metadata ->> 'newAppointmentId',
          'source_revision', v_metadata ->> 'notificationRevision'
        )
      );
    else
      v_appointment_id := coalesce(
        nullif(v_metadata ->> 'appointmentId', '')::uuid,
        nullif(v_metadata ->> 'newAppointmentId', '')::uuid,
        nullif(v_metadata ->> 'oldAppointmentId', '')::uuid
      );
      if v_appointment_id is null then
        raise exception 'registration_visit_notification_appointment_required'
          using errcode = '22023';
      end if;
      v_occurrences := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'appointment_id', v_appointment_id,
        'source_revision', coalesce(
          nullif(v_metadata ->> 'notificationRevision', '')::bigint,
          nullif(v_metadata ->> 'newNotificationRevision', '')::bigint,
          nullif(v_metadata ->> 'oldNotificationRevision', '')::bigint
        )
      ));
    end if;
  elsif v_event_key = 'registration.phone_consultation_ready' then
    select consultation.* into v_consultation
    from public.ops_registration_consultations consultation
    where consultation.id = nullif(v_metadata ->> 'consultationId', '')::uuid
      and consultation.track_id = p_track_id
      and consultation.mode = 'phone';
    if not found then
      raise exception 'registration_phone_consultation_not_found' using errcode = 'P0002';
    end if;
    v_payload := pg_catalog.jsonb_strip_nulls(v_payload || pg_catalog.jsonb_build_object(
      'consultation_id', v_consultation.id,
      'director_profile_id', v_consultation.director_profile_id,
      'recipient_revision', v_consultation.recipient_revision::text,
      'phone_queue_state', p_event_type
    ));
  elsif v_event_key like 'registration.admission_message_%' then
    select message.* into v_message
    from public.ops_registration_messages message
    where message.id = nullif(v_metadata ->> 'messageId', '')::uuid
      and message.task_id = p_task_id
      and message.template_key = 'admission_application';
    if not found then
      raise exception 'registration_message_not_found' using errcode = 'P0002';
    end if;
    v_source_type := 'ops_registration_message';
    v_source_id := v_message.id::text;
    v_occurrence_key := v_message.request_key;
    v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'task_id', v_task.id,
      'track_id', v_track.id,
      'student_name', v_task.student_name,
      'message_id', v_message.id,
      'message_request_key', v_message.request_key,
      'message_status', v_message.status,
      'claim_active', v_message.claim_active,
      'actor_kind', p_actor_kind,
      'system_source', nullif(pg_catalog.btrim(p_system_source), ''),
      'source_event_id', v_event_id,
      'occurred_at', v_occurred_at
    ));
  end if;

  if pg_catalog.jsonb_array_length(v_occurrences) = 0 then
    v_occurrences := pg_catalog.jsonb_build_array('{}'::jsonb);
  end if;

  for v_occurrence in
    select entry.value
    from pg_catalog.jsonb_array_elements(v_occurrences) entry(value)
  loop
    if v_event_key like 'registration.visit_%' then
      v_appointment_id := nullif(v_occurrence ->> 'appointment_id', '')::uuid;
      select appointment.* into v_appointment
      from public.ops_registration_appointments appointment
      where appointment.id = v_appointment_id
        and appointment.task_id = p_task_id
        and appointment.kind = 'visit_consultation';
      if not found then
        raise exception 'registration_appointment_not_found' using errcode = 'P0002';
      end if;

      -- Reuse the prerequisite reminder resolver for the active participant set.
      -- A canceled/replaced visit can have no active participant row, so retain
      -- the persisted visit consultation snapshots as its cancellation fallback.
      if pg_catalog.jsonb_typeof(v_metadata -> 'activeTrackIds') = 'array'
        and pg_catalog.jsonb_array_length(v_metadata -> 'activeTrackIds') > 0
      then
        begin
          select coalesce(
            pg_catalog.array_agg(
              track.id
              order by dashboard_private.registration_subject_sort_order(track.subject),
                track.id
            ),
            array[]::uuid[]
          )
          into v_track_ids
          from (
            select distinct selected.value::uuid as track_id
            from pg_catalog.jsonb_array_elements_text(
              v_metadata -> 'activeTrackIds'
            ) selected(value)
          ) selected
          join public.ops_registration_subject_tracks track
            on track.id = selected.track_id
           and track.task_id = p_task_id;
        exception when invalid_text_representation then
          raise exception 'registration_visit_notification_tracks_invalid'
            using errcode = '22023';
        end;
        if pg_catalog.cardinality(v_track_ids)
          <> pg_catalog.jsonb_array_length(v_metadata -> 'activeTrackIds')
        then
          raise exception 'registration_visit_notification_tracks_invalid'
            using errcode = '22023';
        end if;
      else
        v_track_ids := dashboard_private.registration_appointment_track_ids_v1(
          v_appointment_id
        );
      end if;
      perform dashboard_private.registration_appointment_director_targets_v1(
        v_appointment_id
      );
      if pg_catalog.cardinality(v_track_ids) = 0 then
        select coalesce(
          pg_catalog.array_agg(
            participant.track_id
            order by dashboard_private.registration_subject_sort_order(participant.subject),
              participant.track_id
          ),
          array[]::uuid[]
        )
        into v_track_ids
        from (
          select distinct consultation.track_id, track.subject
          from public.ops_registration_consultations consultation
          join public.ops_registration_subject_tracks track
            on track.id = consultation.track_id
          where consultation.appointment_id = v_appointment_id
            and consultation.mode = 'visit'
        ) participant;
      end if;
      select coalesce(
        pg_catalog.array_agg(
          subject_row.subject
          order by dashboard_private.registration_subject_sort_order(subject_row.subject)
        ),
        array[]::text[]
      )
      into v_subjects
      from (
        select distinct track.subject
        from pg_catalog.unnest(v_track_ids) participant(track_id)
        join public.ops_registration_subject_tracks track
          on track.id = participant.track_id
      ) subject_row;

      select coalesce(
        pg_catalog.array_agg(
          distinct track.director_profile_id
          order by track.director_profile_id
        ) filter (where track.director_profile_id is not null),
        array[]::uuid[]
      )
      into v_director_profile_ids
      from pg_catalog.unnest(v_track_ids) participant(track_id)
      join public.ops_registration_subject_tracks track
        on track.id = participant.track_id;

      v_source_type := 'registration_appointment';
      v_source_id := v_appointment_id::text;
      v_source_revision := coalesce(
        nullif(v_occurrence ->> 'source_revision', '')::bigint,
        v_appointment.notification_revision::bigint
      );
      if v_source_revision is distinct from v_appointment.notification_revision::bigint then
        raise exception 'registration_visit_notification_revision_mismatch'
          using errcode = '40001';
      end if;
      v_occurrence_key := 'registration:registration_appointment:'
        || v_appointment_id::text
        || ':source_revision:' || v_source_revision::text
        || ':immediate';
      v_occurred_at := v_appointment.updated_at;
      v_payload := pg_catalog.jsonb_strip_nulls(
        (v_base_payload - array[
          'track_id', 'subject', 'director_profile_id', 'source_event_id', 'occurred_at'
        ])
        || pg_catalog.jsonb_build_object(
          'appointment_id', v_appointment.id,
          'notification_revision', v_source_revision::text,
          'recipient_revision', v_appointment.recipient_revision::text,
          'scheduled_at', v_appointment.scheduled_at,
          'place', v_appointment.place,
          'appointment_status', v_appointment.status,
          'track_ids', pg_catalog.to_jsonb(v_track_ids),
          'subjects', pg_catalog.array_to_string(v_subjects, ' · '),
          'director_profile_ids', pg_catalog.to_jsonb(v_director_profile_ids),
          'occurred_at', v_occurred_at
        )
      );
      perform dashboard_private.cancel_registration_visit_superseded_v1(
        v_appointment_id,
        v_source_revision,
        'source_revision_changed'
      );
    end if;

    perform dashboard_private.record_notification_event_v1(
      'global',
      'registration',
      v_event_key,
      v_source_type,
      v_source_id,
      v_source_revision,
      v_occurrence_key,
      case when p_actor_kind = 'user' then (select auth.uid()) else null end,
      v_occurred_at,
      case when v_event_key in (
        'registration.case_created',
        'registration.registration_completed',
        'registration.case_closed'
      ) then 1 else 2 end,
      v_payload,
      null,
      null
    );
  end loop;

  return v_event_id;
end;
$$;

create or replace function dashboard_private.registration_message_track_id_v1(
  p_task_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select track.id
  from public.ops_registration_subject_tracks track
  where track.task_id = p_task_id
  order by dashboard_private.registration_subject_sort_order(track.subject), track.id
  limit 1;
$$;

create or replace function public.create_registration_case_with_initial_workflow_v1(
  p_student_name text,
  p_school_grade text,
  p_school_name text,
  p_parent_phone text,
  p_student_phone text,
  p_campus text,
  p_inquiry_at timestamptz,
  p_subjects text[],
  p_request_note text,
  p_priority text,
  p_subject_plans jsonb,
  p_level_test_appointment jsonb,
  p_visit_appointment jsonb,
  p_director_overrides jsonb,
  p_request_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select dashboard_private.create_registration_case_with_reminders_v1_impl(
    p_student_name,
    p_school_grade,
    p_school_name,
    p_parent_phone,
    p_student_phone,
    p_campus,
    p_inquiry_at,
    p_subjects,
    p_request_note,
    p_priority,
    p_subject_plans,
    dashboard_private.normalize_registration_level_test_appointment_v1(
      p_level_test_appointment
    ),
    p_visit_appointment,
    p_director_overrides,
    p_request_key
  );
$$;

alter function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) owner to postgres;
revoke all on function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) from public, anon, service_role;
grant execute on function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) to authenticated;

create or replace function public.save_registration_shared_appointment(
  p_appointment_id uuid,
  p_task_id uuid,
  p_kind text,
  p_scheduled_at timestamptz,
  p_place text,
  p_track_ids uuid[],
  p_replace_remaining boolean,
  p_expected_notification_revision integer,
  p_request_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select dashboard_private.save_registration_shared_appointment_with_reminders_v1_impl(
    p_appointment_id,
    p_task_id,
    p_kind,
    p_scheduled_at,
    dashboard_private.normalize_registration_appointment_place_v1(
      p_kind,
      p_place
    ),
    p_track_ids,
    p_replace_remaining,
    p_expected_notification_revision,
    p_request_key
  );
$$;

create or replace function public.registration_subject_tracks_runtime_version()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select 1;
$$;

create or replace function public.registration_intake_workflow_runtime_version()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select 1;
$$;

create or replace function public.registration_appointment_reminders_runtime_version()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select 1;
$$;

create or replace function public.registration_notification_handoffs_runtime_version()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select 1;
$$;

alter function dashboard_private.registration_subject_sort_order(text) owner to postgres;
alter function dashboard_private.assert_registration_subject_enabled(text, text) owner to postgres;
alter function dashboard_private.is_active_subject_director(uuid, text) owner to postgres;
alter function dashboard_private.assert_registration_mutation_access(uuid, uuid, text) owner to postgres;
alter function dashboard_private.resolve_registration_default_director(text, text, timestamptz) owner to postgres;
alter function dashboard_private.assert_registration_track_director_ready(uuid) owner to postgres;
alter function dashboard_private.derive_registration_parent_projection(uuid) owner to postgres;
alter function dashboard_private.create_registration_case_impl(
  text, text, text, text, text, text, timestamptz, text[], text, text, text
) owner to postgres;
alter function dashboard_private.assign_registration_track_director_impl(
  uuid, uuid, text, text, integer, text
) owner to postgres;
alter function dashboard_private.sync_registration_case_subjects_impl(uuid, text[], text)
  owner to postgres;
alter function dashboard_private.update_registration_case_common_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
) owner to postgres;
alter function dashboard_private.complete_registration_consultation_impl(
  uuid, text, text, uuid, text
) owner to postgres;
alter function dashboard_private.create_registration_case_with_initial_workflow_v1_impl(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) owner to postgres;
alter function dashboard_private.save_registration_shared_appointment_impl(
  uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text
) owner to postgres;
alter function dashboard_private.registration_appointment_track_ids_v1(uuid) owner to postgres;
alter function dashboard_private.registration_appointment_director_targets_v1(uuid) owner to postgres;
alter function dashboard_private.registration_appointment_director_target_hash_v1(uuid) owner to postgres;
alter function dashboard_private.registration_appointment_rule_snapshot_v1(text, boolean) owner to postgres;
alter function dashboard_private.registration_appointment_source_snapshot_v1(uuid) owner to postgres;
alter function dashboard_private.preview_registration_appointment_reminders_v1(
  text, timestamptz, uuid[]
) owner to postgres;
alter function public.preview_registration_appointment_reminders_v1(
  text, timestamptz, uuid[]
) owner to postgres;
alter function dashboard_private.assign_registration_track_director_with_reminders_v1_impl(
  uuid, uuid, text, text, integer, text
) owner to postgres;
alter function dashboard_private.write_registration_track_event_v2(
  uuid, uuid, text, text, text, text, jsonb, text, text
) owner to postgres;
alter function dashboard_private.registration_message_track_id_v1(uuid) owner to postgres;
alter function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) owner to postgres;
alter function public.save_registration_shared_appointment(
  uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text
) owner to postgres;
alter function public.registration_subject_tracks_runtime_version() owner to postgres;
alter function public.registration_intake_workflow_runtime_version() owner to postgres;
alter function public.registration_appointment_reminders_runtime_version() owner to postgres;
alter function public.registration_notification_handoffs_runtime_version() owner to postgres;
alter view public.ops_registration_appointment_calendar owner to postgres;

revoke all on function dashboard_private.registration_subject_sort_order(text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_subject_enabled(text, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.is_active_subject_director(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_mutation_access(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.resolve_registration_default_director(text, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assert_registration_track_director_ready(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.derive_registration_parent_projection(uuid)
  from public, anon, authenticated, service_role;

revoke all on function dashboard_private.create_registration_case_impl(
  text, text, text, text, text, text, timestamptz, text[], text, text, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.create_registration_case_impl(
  text, text, text, text, text, text, timestamptz, text[], text, text, text
) to authenticated;
revoke all on function dashboard_private.sync_registration_case_subjects_impl(uuid, text[], text)
  from public, anon, authenticated, service_role;
grant execute on function dashboard_private.sync_registration_case_subjects_impl(uuid, text[], text)
  to authenticated;

revoke all on function dashboard_private.update_registration_case_common_impl(
  uuid, text, text, text, text, text, text, timestamptz, text, text, integer, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.assign_registration_track_director_impl(
  uuid, uuid, text, text, integer, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.complete_registration_consultation_impl(
  uuid, text, text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.create_registration_case_with_initial_workflow_v1_impl(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.save_registration_shared_appointment_impl(
  uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text
) from public, anon, authenticated, service_role;

revoke all on function dashboard_private.registration_appointment_track_ids_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_appointment_director_targets_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_appointment_director_target_hash_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_appointment_rule_snapshot_v1(text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_appointment_source_snapshot_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function dashboard_private.preview_registration_appointment_reminders_v1(
  text, timestamptz, uuid[]
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.write_registration_track_event_v2(
  uuid, uuid, text, text, text, text, jsonb, text, text
) from public, anon, authenticated, service_role;
revoke all on function dashboard_private.registration_message_track_id_v1(uuid)
  from public, anon, authenticated, service_role;

-- These SECURITY DEFINER reminder boundaries are the current call targets of
-- SECURITY INVOKER public RPCs. Keep only their established authenticated grant;
-- their lower-level mutation cores stay unavailable to external roles.
revoke all on function dashboard_private.assign_registration_track_director_with_reminders_v1_impl(
  uuid, uuid, text, text, integer, text
) from public, anon, authenticated, service_role;
grant execute on function dashboard_private.assign_registration_track_director_with_reminders_v1_impl(
  uuid, uuid, text, text, integer, text
) to authenticated;

revoke all on function public.preview_registration_appointment_reminders_v1(
  text, timestamptz, uuid[]
) from public, anon, authenticated, service_role;
grant execute on function public.preview_registration_appointment_reminders_v1(
  text, timestamptz, uuid[]
) to authenticated;
revoke all on function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_registration_case_with_initial_workflow_v1(
  text, text, text, text, text, text, timestamptz, text[], text, text,
  jsonb, jsonb, jsonb, jsonb, text
) to authenticated;
revoke all on function public.save_registration_shared_appointment(
  uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_registration_shared_appointment(
  uuid, uuid, text, timestamptz, text, uuid[], boolean, integer, text
) to authenticated;

revoke all on table public.ops_registration_appointment_calendar
  from public, anon, authenticated;
grant select on table public.ops_registration_appointment_calendar
  to authenticated;

revoke all on function public.registration_subject_tracks_runtime_version()
  from public, anon, authenticated, service_role;
grant execute on function public.registration_subject_tracks_runtime_version()
  to authenticated;
revoke all on function public.registration_intake_workflow_runtime_version()
  from public, anon, authenticated, service_role;
grant execute on function public.registration_intake_workflow_runtime_version()
  to authenticated;
revoke all on function public.registration_appointment_reminders_runtime_version()
  from public, anon, authenticated, service_role;
grant execute on function public.registration_appointment_reminders_runtime_version()
  to authenticated, service_role;
revoke all on function public.registration_notification_handoffs_runtime_version()
  from public, anon, authenticated, service_role;
grant execute on function public.registration_notification_handoffs_runtime_version()
  to authenticated, service_role;

commit;
