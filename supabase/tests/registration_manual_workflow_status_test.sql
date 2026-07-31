begin;
select plan(9);

select has_column(
  'public', 'ops_registration_subject_tracks', 'workflow_status',
  '과목별 등록 트랙에 수동 진행 상태가 있다'
);
select has_column(
  'public', 'ops_registration_subject_tracks', 'workflow_revision',
  '과목별 등록 트랙에 상태 충돌 방지 리비전이 있다'
);
select has_column(
  'public', 'ops_registration_subject_tracks', 'workflow_status_entered_at',
  '과목별 등록 트랙에 상태 진입 시각이 있다'
);
select has_function(
  'public',
  'set_registration_workflow_status_v1',
  array['uuid', 'text', 'integer', 'text']
);
select function_privs_are(
  'public',
  'set_registration_workflow_status_v1',
  array['uuid', 'text', 'integer', 'text'],
  'authenticated',
  array['EXECUTE']
);
select is_empty($$
  select 1
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name = 'set_registration_workflow_status_v1'
    and grantee in ('PUBLIC', 'anon')
    and privilege_type = 'EXECUTE'
$$);
select has_column(
  'public', 'ops_registration_subject_track_summaries', 'workflow_status',
  '등록 목록 뷰가 수동 진행 상태를 제공한다'
);
select has_column(
  'public', 'ops_registration_subject_track_summaries', 'workflow_revision',
  '등록 목록 뷰가 상태 리비전을 제공한다'
);
select has_column(
  'public', 'ops_registration_subject_track_summaries', 'workflow_status_entered_at',
  '등록 목록 뷰가 상태 진입 시각을 제공한다'
);

select * from finish();
rollback;
