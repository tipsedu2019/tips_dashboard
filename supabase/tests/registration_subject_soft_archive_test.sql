begin;

select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '120s';
set local lock_timeout = '5s';

select has_column(
  'public',
  'ops_registration_subject_tracks',
  'archived_at',
  'subject tracks expose an archive timestamp'
);

select has_column(
  'public',
  'ops_registration_subject_tracks',
  'archived_by',
  'subject tracks retain the manager who archived them'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
      'public.ops_registration_subject_tracks'::regclass
      and constraint_row.conname =
        'ops_registration_subject_tracks_archive_pair_check'
      and constraint_row.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid)
        like '%archived_at%archived_by%'
  )
  and exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
      'public.ops_registration_subject_tracks'::regclass
      and constraint_row.conname =
        'ops_registration_subject_tracks_archived_by_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.profiles'::regclass
  ),
  'archive timestamp and actor are an FK-backed pair'
);

select ok(
  (
    select
      pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.proconfig[1] = any (
        array['search_path=', 'search_path=""']::text[]
      )
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'dashboard_private.sync_registration_case_subjects_impl(uuid,text[],text)'::regprocedure
  ),
  'final subject sync retains the postgres-owned empty-search-path security boundary'
);

select ok(
  (
    select definition like '%archived_at = pg_catalog.now()%'
      and definition like '%archived_by = v_actor_id%'
      and definition like '%archived_at = null%'
      and definition like '%archived_by = null%'
      and definition like '%update public.ops_tasks task%'
      and definition like '%array_to_string(v_subjects, '', '')%'
      and definition not like '%dashboard_private.recompute_registration_parent%'
      and definition not like '%registration_subject_removal_blocked%'
      and definition not like '%assert_registration_subject_enabled%'
      and definition not like '%public.ops_registration_level_tests%'
      and definition not like '%public.ops_registration_consultations%'
      and definition not like '%public.ops_registration_enrollments%'
      and definition not like '%delete from public.ops_registration_subject_tracks%'
      and definition not like '%errcode = ''40001''%'
    from (
      select pg_catalog.pg_get_functiondef(
        'dashboard_private.sync_registration_case_subjects_impl(uuid,text[],text)'::regprocedure
      ) as definition
    ) source
  ),
  'subject sync archives and restores without process, history, capability, delete, or fake-concurrency gates'
);

select ok(
  (
    select definition like '%new.subject is distinct from old.subject%'
      and definition like '%new.class_id is distinct from old.class_id%'
      and definition like '%new.textbook_id is distinct from old.textbook_id%'
      and definition like '%new.secondary_assignee_id is distinct from old.secondary_assignee_id%'
    from (
      select pg_catalog.pg_get_functiondef(
        'dashboard_private.prevent_registration_task_display_override_v1()'::regprocedure
      ) as definition
    ) source
  ),
  'subject display updates ignore unrelated stale compatibility projections while changed fields stay protected'
);

select ok(
  (
    select definition like '%registration_common_revision_conflict%23514%'
      and definition like '%registration_subjects_conflict%23514%'
      and definition like '%sync_registration_case_subjects_impl%'
      and definition not like '%registration_subject_removal_blocked%'
      and definition not like '%delete from public.ops_registration_subject_tracks%'
      and definition not like '%errcode = ''40001''%'
    from (
      select pg_catalog.pg_get_functiondef(
        'dashboard_private.save_registration_case_inquiry_v1_impl(uuid,text,text,text,text,text,text,timestamp with time zone,text,text,integer,text[],text[],text)'::regprocedure
      ) as definition
    ) source
  ),
  'legacy unified save composes flat common facts and soft subject sync with exact stale SQLSTATEs'
);

select ok(
  (
    select pg_catalog.pg_get_viewdef(
      'public.ops_registration_subject_track_summaries'::regclass,
      true
    ) like '%track.archived_at IS NULL%'
  ),
  'the final subject summary view returns active tracks only'
);

select ok(
  (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'dashboard_private.derive_registration_parent_projection(uuid)'::regprocedure
    )) like '%track.archived_at is null%'
  ),
  'the parent projection derives compatibility fields from active tracks only'
);

select ok(
  (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'dashboard_private.assert_registration_mutation_access(uuid,uuid,text)'::regprocedure
    )) like '%track.archived_at is null%'
  )
  and (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'dashboard_private.assert_registration_workflow_status_access(uuid,text)'::regprocedure
    )) like '%track.archived_at is null%'
  )
  and (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'dashboard_private.assert_registration_observation_manager_access_v1(uuid)'::regprocedure
    )) like '%track.archived_at is null%'
  ),
  'registration mutation, status, and observation access reject archived tracks'
);

select ok(
  (
    select definition like '%track.archived_at is null%'
      and definition like '%try_registration_event_jsonb_object%'
      and definition like '%registration_management_notification_source_current_v2%'
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.ensure_registration_workflow_notification_v2(uuid,integer,text,text)'::regprocedure
      )) as definition
    ) source
  ),
  'explicit v2 notification readiness rejects archived tracks and safely validates source events'
);

select ok(
  (
    select pg_catalog.pg_get_functiondef(
      'dashboard_private.registration_task_has_subject_tracks(uuid)'::regprocedure
    ) not like '%archived_at%'
  ),
  'task track existence intentionally includes archived history'
);

select ok(
  (
    select pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
      like '%archived_at IS NULL%'
    from pg_catalog.pg_policy policy
    where policy.polrelid = 'public.ops_registration_subject_tracks'::regclass
      and policy.polname = 'ops_registration_subject_tracks_select_v2'
  ),
  'direct authenticated track reads expose active rows only'
);

select ok(
  (
    select definition like '%left join lateral (%'
      and definition like '%matching_track.matching_track_id is not null%'
      and definition like '%active_track.task_id = common.id%'
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'dashboard_private.ops_task_page_source_v1(text,jsonb)'::regprocedure
      )) as definition
    ) source
  )
  and (
    select definition like '%left join lateral (%'
      and definition like '%matching_track.matching_track_id is not null%'
      and definition like '%active_track.task_id = common.id%'
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'dashboard_private.ops_task_numbered_keys_v1(text,jsonb)'::regprocedure
      )) as definition
    ) source
  ),
  'cursor and numbered inquiry lists retain zero-active-subject registration rows'
);

select ok(
  (
    select definition like '%registration_management_notification_source_current_v2%'
      and definition like '%''items'', ''[]''::jsonb%'
    from (
      select pg_catalog.lower(pg_catalog.pg_get_functiondef(
        'public.get_registration_core_legacy_dispatch_plan_v1(uuid,uuid)'::regprocedure
      )) as definition
    ) source
  ),
  'the explicit legacy provider plan fails closed after its source track is archived'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  banned_until, created_at, updated_at
)
values
  (
    '98600000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'subject-archive-admin@example.invalid',
    crypt('subject-archive-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, null, now(), now()
  ),
  (
    '98600000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'subject-archive-staff@example.invalid',
    crypt('subject-archive-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, null, now(), now()
  ),
  (
    '98600000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'subject-archive-teacher@example.invalid',
    crypt('subject-archive-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, null, now(), now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '98600000-0000-4000-8000-000000000001', 'admin',
    '과목보관 원장', 'subject-archive-admin@example.invalid', now(), now()
  ),
  (
    '98600000-0000-4000-8000-000000000002', 'staff',
    '과목보관 관리팀', 'subject-archive-staff@example.invalid', now(), now()
  ),
  (
    '98600000-0000-4000-8000-000000000003', 'teacher',
    '과목보관 강사', 'subject-archive-teacher@example.invalid', now(), now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

insert into public.ops_tasks(
  id, title, type, status, requested_by, student_name,
  subject, campus, priority, completed_at, secondary_assignee_id
)
values
  (
    '98600000-0000-4000-8000-000000000101',
    '등록: 보관이력학생', 'registration', 'done',
    '98600000-0000-4000-8000-000000000001', '보관이력학생',
    '영어, 수학', '본관', 'normal', '2026-08-31 20:00+09',
    '98600000-0000-4000-8000-000000000001'
  ),
  (
    '98600000-0000-4000-8000-000000000102',
    '등록: 통합저장학생', 'registration', 'in_progress',
    '98600000-0000-4000-8000-000000000001', '통합저장학생',
    '영어', '별관', 'normal', null,
    '98600000-0000-4000-8000-000000000001'
  );

insert into public.ops_registration_details(
  task_id, inquiry_at, school_grade, school_name, parent_phone,
  student_phone, request_note, common_revision, pipeline_status, counselor,
  makeedu_registered, makeedu_invoice_sent, payment_checked,
  admission_checklist
)
values
  (
    '98600000-0000-4000-8000-000000000101',
    '2026-09-01 18:49+09', '중2', '보관중', '01098601001',
    null, '기존 이력 유지', 1, '6. 수납 확인', '기존 원장',
    true, true, true,
    '{"applicationSent":true,"makeeduRegistered":true,"invoiceSent":true,"paymentConfirmed":true,"registrationCompleted":false}'::jsonb
  ),
  (
    '98600000-0000-4000-8000-000000000102',
    '2026-09-01 18:50+09', '중3', '통합중', '01098601002',
    null, '통합 저장 전', 1, '7. 등록 완료', '기존 원장',
    true, true, true,
    '{"applicationSent":true,"makeeduRegistered":true,"invoiceSent":true,"paymentConfirmed":true,"registrationCompleted":true}'::jsonb
  );

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status,
  director_profile_id, director_assignment_source, director_assigned_at,
  migration_review_required, workflow_status, workflow_revision
)
values
  (
    '98600000-0000-4000-8000-000000000201',
    '98600000-0000-4000-8000-000000000101',
    '영어', 'inquiry', null, null, null, false,
    'consultation_requested', 3
  ),
  (
    '98600000-0000-4000-8000-000000000202',
    '98600000-0000-4000-8000-000000000101',
    '수학', 'visit_consultation_scheduled',
    '98600000-0000-4000-8000-000000000001', 'manual', now(), false,
    'consultation_completed', 5
  ),
  (
    '98600000-0000-4000-8000-000000000203',
    '98600000-0000-4000-8000-000000000102',
    '영어', 'registered',
    '98600000-0000-4000-8000-000000000001', 'manual', now(), false,
    'registered', 4
  );

insert into public.ops_registration_appointments(
  id, task_id, kind, scheduled_at, place, status, notification_revision
)
values (
  '98600000-0000-4000-8000-000000000301',
  '98600000-0000-4000-8000-000000000101',
  'visit_consultation', '2026-09-08 19:00+09', '본관 상담실',
  'scheduled', 1
);

insert into public.ops_registration_consultations(
  id, track_id, appointment_id, mode, status, director_profile_id
)
values (
  '98600000-0000-4000-8000-000000000302',
  '98600000-0000-4000-8000-000000000202',
  '98600000-0000-4000-8000-000000000301',
  'visit', 'scheduled', '98600000-0000-4000-8000-000000000001'
);

insert into public.ops_task_events(
  task_id, actor_id, event_type, field_name, before_value, after_value
)
values
  (
    '98600000-0000-4000-8000-000000000101',
    '98600000-0000-4000-8000-000000000001',
    'registration_track_event',
    'registration_track:98600000-0000-4000-8000-000000000202',
    null, '{"event_type":"historical_consultation"}'
  ),
  (
    '98600000-0000-4000-8000-000000000102',
    '98600000-0000-4000-8000-000000000001',
    'registration_track_event',
    'registration_track:98600000-0000-4000-8000-000000000203',
    null, '{"event_type":"historical_registration"}'
  );

create temporary table registration_subject_parent_state_before(
  task_id uuid primary key,
  state jsonb not null
) on commit drop;

insert into registration_subject_parent_state_before(task_id, state)
select
  task.id,
  pg_catalog.jsonb_build_object(
    'status', task.status,
    'completedAt', task.completed_at,
    'classId', task.class_id,
    'textbookId', task.textbook_id,
    'secondaryAssigneeId', task.secondary_assignee_id,
    'pipelineStatus', detail.pipeline_status,
    'counselor', detail.counselor,
    'makeeduRegistered', detail.makeedu_registered,
    'makeeduInvoiceSent', detail.makeedu_invoice_sent,
    'paymentChecked', detail.payment_checked,
    'admissionChecklist', detail.admission_checklist
  )
from public.ops_tasks task
join public.ops_registration_details detail on detail.task_id = task.id
where task.id in (
  '98600000-0000-4000-8000-000000000101',
  '98600000-0000-4000-8000-000000000102'
);

create or replace function pg_temp.registration_subject_archive_set_actor(
  p_actor uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor::text,
      'role', 'authenticated',
      'email', (
        select profile.email
        from public.profiles profile
        where profile.id = p_actor
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create temporary table registration_subject_archive_results(
  result_key text primary key,
  response jsonb not null
) on commit drop;
grant select, insert on registration_subject_archive_results to authenticated;

create temporary table registration_subject_archive_no_send_snapshot
on commit drop
as
select
  (select pg_catalog.count(*) from dashboard_private.notification_events)
    as event_count,
  (select pg_catalog.count(*) from dashboard_private.notification_deliveries)
    as delivery_count,
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind = 'notification_external_attempt'
      and audit.action = 'external_attempt_registered'
  ) as external_attempt_count;

select pg_temp.registration_subject_archive_set_actor(
  '98600000-0000-4000-8000-000000000003'
);
set local role authenticated;
select throws_ok(
  $$select public.sync_registration_case_subjects(
    '98600000-0000-4000-8000-000000000101',
    array['영어']::text[],
    'subject-archive-teacher-denied'
  )$$,
  '42501',
  'registration_access_denied',
  'teachers cannot archive registration subjects'
);
reset role;

select pg_temp.registration_subject_archive_set_actor(
  '98600000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into registration_subject_archive_results(result_key, response)
values (
  'archive-math',
  public.sync_registration_case_subjects(
    '98600000-0000-4000-8000-000000000101',
    array['영어']::text[],
    'subject-archive-math'
  )
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'subjects', result.response -> 'subjects',
      'trackCount', pg_catalog.jsonb_array_length(result.response -> 'tracks')
    )
    from registration_subject_archive_results result
    where result.result_key = 'archive-math'
  ),
  '{"subjects":["영어"],"trackCount":1}'::jsonb,
  'archive response contains active subjects and tracks only'
);

select ok(
  (
    select track.archived_at is not null
      and track.archived_by = '98600000-0000-4000-8000-000000000001'
      and track.pipeline_status = 'visit_consultation_scheduled'
      and track.director_assignment_source = 'manual'
    from public.ops_registration_subject_tracks track
    where track.id = '98600000-0000-4000-8000-000000000202'
  )
  and exists (
    select 1
    from public.ops_registration_consultations consultation
    where consultation.id = '98600000-0000-4000-8000-000000000302'
      and consultation.track_id = '98600000-0000-4000-8000-000000000202'
  ),
  'a progressed subject archives in place while its history remains intact'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'status', task.status,
      'completedAt', task.completed_at,
      'classId', task.class_id,
      'textbookId', task.textbook_id,
      'secondaryAssigneeId', task.secondary_assignee_id,
      'pipelineStatus', detail.pipeline_status,
      'counselor', detail.counselor,
      'makeeduRegistered', detail.makeedu_registered,
      'makeeduInvoiceSent', detail.makeedu_invoice_sent,
      'paymentChecked', detail.payment_checked,
      'admissionChecklist', detail.admission_checklist
    )
    from public.ops_tasks task
    join public.ops_registration_details detail on detail.task_id = task.id
    where task.id = '98600000-0000-4000-8000-000000000101'
  ),
  (
    select snapshot.state
    from registration_subject_parent_state_before snapshot
    where snapshot.task_id = '98600000-0000-4000-8000-000000000101'
  ),
  'subject archive changes only the task subject label, not task completion or admission/process facts'
);

select is(
  (
    select task.subject
    from public.ops_tasks task
    where task.id = '98600000-0000-4000-8000-000000000101'
  ),
  '영어',
  'subject archive refreshes only the active-subject display label'
);

select ok(
  exists (
    select 1
    from public.ops_task_events event_row
    where event_row.task_id = '98600000-0000-4000-8000-000000000101'
      and event_row.event_type = 'registration_subject_archived'
      and event_row.field_name =
        'registration_track:98600000-0000-4000-8000-000000000202'
  )
  and exists (
    select 1
    from public.ops_task_events event_row
    where event_row.task_id = '98600000-0000-4000-8000-000000000101'
      and event_row.event_type = 'registration_subjects_synced'
  ),
  'subject archive writes per-track and active-set audit events'
);

set local role authenticated;
select is(
  public.sync_registration_case_subjects(
    '98600000-0000-4000-8000-000000000101',
    array['영어']::text[],
    'subject-archive-math'
  ),
  (
    select result.response
    from registration_subject_archive_results result
    where result.result_key = 'archive-math'
  ),
  'archive replay returns the original idempotent response'
);
reset role;

select is(
  (
    select pg_catalog.count(*)
    from public.ops_task_events event_row
    where event_row.task_id = '98600000-0000-4000-8000-000000000101'
      and event_row.event_type = 'registration_subject_archived'
  ),
  1::bigint,
  'archive replay does not duplicate its audit event'
);

select pg_temp.registration_subject_archive_set_actor(
  '98600000-0000-4000-8000-000000000002'
);
set local role authenticated;
insert into registration_subject_archive_results(result_key, response)
values (
  'restore-math',
  public.sync_registration_case_subjects(
    '98600000-0000-4000-8000-000000000101',
    array['영어', '수학']::text[],
    'subject-restore-math'
  )
);
reset role;

select ok(
  (
    select track.archived_at is null
      and track.archived_by is null
      and track.pipeline_status = 'visit_consultation_scheduled'
    from public.ops_registration_subject_tracks track
    where track.id = '98600000-0000-4000-8000-000000000202'
  )
  and exists (
    select 1
    from public.ops_registration_consultations consultation
    where consultation.track_id = '98600000-0000-4000-8000-000000000202'
  )
  and exists (
    select 1
    from public.ops_task_events event_row
    where event_row.task_id = '98600000-0000-4000-8000-000000000101'
      and event_row.event_type = 'registration_subject_restored'
  ),
  'staff restore the same track id with its history and process facts preserved'
);

select pg_temp.registration_subject_archive_set_actor(
  '98600000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into registration_subject_archive_results(result_key, response)
values (
  'archive-all',
  public.sync_registration_case_subjects(
    '98600000-0000-4000-8000-000000000101',
    array[]::text[],
    'subject-archive-all'
  )
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'subjects', result.response -> 'subjects',
      'tracks', result.response -> 'tracks'
    )
    from registration_subject_archive_results result
    where result.result_key = 'archive-all'
  ),
  '{"subjects":[],"tracks":[]}'::jsonb,
  'zero active subjects is a valid table state and returns an empty active set'
);

select ok(
  dashboard_private.registration_task_has_subject_tracks(
    '98600000-0000-4000-8000-000000000101'
  )
  and (
    select task.status = 'done'
      and task.completed_at = '2026-08-31 20:00+09'::timestamptz
      and task.subject is null
      and detail.pipeline_status = '6. 수납 확인'
      and detail.makeedu_registered
      and detail.makeedu_invoice_sent
      and detail.payment_checked
    from public.ops_tasks task
    join public.ops_registration_details detail on detail.task_id = task.id
    where task.id = '98600000-0000-4000-8000-000000000101'
  ),
  'all-archived tasks retain history and operational state while only the subject label becomes empty'
);

create temporary table registration_subject_archive_read_counts(
  raw_count bigint not null,
  summary_count bigint not null
) on commit drop;
grant insert, select on registration_subject_archive_read_counts to authenticated;
set local role authenticated;
insert into registration_subject_archive_read_counts(raw_count, summary_count)
select
  (
    select pg_catalog.count(*)
    from public.ops_registration_subject_tracks track
    where track.task_id = '98600000-0000-4000-8000-000000000101'
  ),
  (
    select pg_catalog.count(*)
    from public.ops_registration_subject_track_summaries summary
    where summary.task_id = '98600000-0000-4000-8000-000000000101'
  );
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'raw', read_result.raw_count,
      'summary', read_result.summary_count
    )
    from registration_subject_archive_read_counts read_result
  ),
  '{"raw":0,"summary":0}'::jsonb,
  'authenticated direct and summary reads hide archived tracks'
);

create temporary table registration_subject_archive_list_results(
  numbered_response jsonb not null,
  cursor_count bigint not null
) on commit drop;
grant select on public.profiles to authenticated;
grant insert, select on registration_subject_archive_list_results to authenticated;
set local role authenticated;
insert into registration_subject_archive_list_results(
  numbered_response,
  cursor_count
)
select
  public.list_ops_task_numbered_page_v1(
    'registration',
    pg_catalog.jsonb_build_object(
      'taskType', 'registration',
      'search', '보관이력학생',
      'statuses', '[]'::jsonb,
      'view', 'inquiry',
      'consultationOwnerId', null
    ),
    1,
    10
  ),
  (
    select pg_catalog.count(*)
    from public.list_ops_task_page_v1(
      'registration',
      pg_catalog.jsonb_build_object(
        'taskType', 'registration',
        'search', '보관이력학생',
        'statuses', '[]'::jsonb,
        'view', 'inquiry',
        'consultationOwnerId', null
      ),
      null,
      null,
      30
    ) page
    where page.id = '98600000-0000-4000-8000-000000000101'
  );
reset role;

select ok(
  (
    select list_result.numbered_response ->> 'totalCount' = '1'
      and list_result.numbered_response -> 'rows' -> 0 ->> 'id'
        = '98600000-0000-4000-8000-000000000101'
      and list_result.numbered_response -> 'rows' -> 0
        -> 'registrationTracks' = '[]'::jsonb
      and list_result.cursor_count = 1
    from registration_subject_archive_list_results list_result
  ),
  'empty active subjects remain visible as one inquiry row in both list APIs'
);

set local role authenticated;
select throws_ok(
  $$select public.set_registration_workflow_status_v1(
    '98600000-0000-4000-8000-000000000202',
    'registered', 5, 'subject-archived-status-denied'
  )$$,
  '42501',
  'registration_access_denied',
  'manual status editing rejects an archived track'
);

select throws_ok(
  $$select dashboard_private.assert_registration_observation_manager_access_v1(
    '98600000-0000-4000-8000-000000000202'
  )$$,
  'P0002',
  'registration_observation_not_found',
  'observation mutation access rejects an archived track'
);

select throws_ok(
  $$select public.ensure_registration_workflow_notification_v2(
    '98600000-0000-4000-8000-000000000202', 5,
    '98600000-0000-4000-8000-000000000901',
    'send_registration_management_notification'
  )$$,
  'P0002',
  'registration_track_not_found',
  'explicit v2 notification readiness rejects an archived track'
);
reset role;

select pg_temp.registration_subject_archive_set_actor(
  '98600000-0000-4000-8000-000000000001'
);
set local role authenticated;
select throws_ok(
  $$select public.save_registration_case_inquiry_v1(
    '98600000-0000-4000-8000-000000000102',
    '통합저장학생', '중3', '통합중', '01098601002', null,
    '별관', '2026-09-01 18:50+09', 'stale common', 'normal',
    2, array['영어']::text[], array[]::text[],
    'subject-unified-stale-common'
  )$$,
  '23514',
  'registration_common_revision_conflict',
  'unified save reports stale common facts with the exact non-retryable SQLSTATE'
);

select throws_ok(
  $$select public.save_registration_case_inquiry_v1(
    '98600000-0000-4000-8000-000000000102',
    '통합저장학생', '중3', '통합중', '01098601002', null,
    '별관', '2026-09-01 18:50+09', 'stale subjects', 'normal',
    1, array['수학']::text[], array[]::text[],
    'subject-unified-stale-subjects'
  )$$,
  '23514',
  'registration_subjects_conflict',
  'unified save reports stale active subjects with the exact non-retryable SQLSTATE'
);

select lives_ok(
  $$insert into registration_subject_archive_results(result_key, response)
    values (
      'unified-archive-all',
      public.save_registration_case_inquiry_v1(
        '98600000-0000-4000-8000-000000000102',
        '', '', '', '임시 연락처', null,
        '', null, '단순 입력 중', '',
        1, array['영어']::text[], array[]::text[],
        'subject-unified-archive-all'
      )
    )$$,
  'unified legacy save archives a progressed historical track without a workflow collision'
);
reset role;

select ok(
  (
    select detail.common_revision = 2
      and detail.school_grade is null
      and detail.request_note = '단순 입력 중'
    from public.ops_registration_details detail
    where detail.task_id = '98600000-0000-4000-8000-000000000102'
  )
  and (
    select track.archived_at is not null
      and track.id = '98600000-0000-4000-8000-000000000203'
    from public.ops_registration_subject_tracks track
    where track.task_id = '98600000-0000-4000-8000-000000000102'
  )
  and (
    select result.response -> 'notificationJobs' = '[]'::jsonb
      and result.response -> 'subjects' = '[]'::jsonb
      and result.response -> 'tracks' = '[]'::jsonb
    from registration_subject_archive_results result
    where result.result_key = 'unified-archive-all'
  ),
  'unified save commits flat common facts and an active-only empty subject response'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'status', task.status,
      'completedAt', task.completed_at,
      'classId', task.class_id,
      'textbookId', task.textbook_id,
      'secondaryAssigneeId', task.secondary_assignee_id,
      'pipelineStatus', detail.pipeline_status,
      'counselor', detail.counselor,
      'makeeduRegistered', detail.makeedu_registered,
      'makeeduInvoiceSent', detail.makeedu_invoice_sent,
      'paymentChecked', detail.payment_checked,
      'admissionChecklist', detail.admission_checklist
    )
    from public.ops_tasks task
    join public.ops_registration_details detail on detail.task_id = task.id
    where task.id = '98600000-0000-4000-8000-000000000102'
  ),
  (
    select snapshot.state
    from registration_subject_parent_state_before snapshot
    where snapshot.task_id = '98600000-0000-4000-8000-000000000102'
  ),
  'unified subject removal also preserves task completion and admission/process facts'
);

select ok(
  (
    select snapshot.event_count =
      (select pg_catalog.count(*) from dashboard_private.notification_events)
      and snapshot.delivery_count =
        (select pg_catalog.count(*) from dashboard_private.notification_deliveries)
      and snapshot.external_attempt_count = (
        select pg_catalog.count(*)
        from dashboard_private.notification_audit_logs audit
        where audit.entity_kind = 'notification_external_attempt'
          and audit.action = 'external_attempt_registered'
      )
    from registration_subject_archive_no_send_snapshot snapshot
  ),
  'archive, restore, and unified fact save create no notification, delivery, or provider-send evidence'
);

select * from finish();
rollback;
