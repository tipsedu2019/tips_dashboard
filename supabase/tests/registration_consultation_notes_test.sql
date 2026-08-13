begin;
select plan(13);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select has_column(
  'public', 'ops_registration_consultations', 'note',
  '상담 내용 열이 존재한다'
);
select col_type_is(
  'public', 'ops_registration_consultations', 'note', 'text',
  '상담 내용은 text다'
);
select col_is_null(
  'public', 'ops_registration_consultations', 'note',
  '상담 내용은 선택 사항이다'
);
select has_function(
  'public',
  'save_registration_consultation_details_v1',
  array['uuid', 'text', 'text', 'text', 'text'],
  '상담 내용 저장 RPC가 5개 인자를 받는다'
);
select function_privs_are(
  'public',
  'save_registration_consultation_details_v1',
  array['uuid', 'text', 'text', 'text', 'text'],
  'authenticated',
  array['EXECUTE'],
  '인증 사용자는 상담 내용 저장 RPC를 실행할 수 있다'
);
select is_empty($$
  select 1
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name = 'save_registration_consultation_details_v1'
    and grantee in ('PUBLIC', 'anon')
    and privilege_type = 'EXECUTE'
$$, 'PUBLIC과 anon에는 실행 권한이 없다');

select ok(
  (
    select procedure.prosecdef
    from pg_catalog.pg_proc procedure
    where procedure.oid = 'public.save_registration_consultation_details_v1(uuid,text,text,text,text)'::regprocedure
  ),
  '공개 RPC는 닫힌 private helper를 호출하는 security definer 경계다'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'dashboard_private.save_registration_consultation_details_impl(uuid,text,text,text,text)',
    'EXECUTE'
  ),
  '인증 사용자는 private 상담 저장 helper를 직접 호출할 수 없다'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '13000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'consultation-note-owner@runtime.invalid',
    crypt('consultation-note-runtime-only', gen_salt('bf')),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-consultation-notes"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '13000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'consultation-note-other@runtime.invalid',
    crypt('consultation-note-runtime-only', gen_salt('bf')),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"registration-consultation-notes"}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  );

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '13000000-0000-4000-8000-000000000001', 'admin',
    '상담 내용 책임자', 'consultation-note-owner@runtime.invalid',
    pg_catalog.now(), pg_catalog.now()
  ),
  (
    '13000000-0000-4000-8000-000000000002', 'admin',
    '다른 상담 책임자', 'consultation-note-other@runtime.invalid',
    pg_catalog.now(), pg_catalog.now()
  );

insert into public.ops_tasks(
  id, title, type, status, priority, requested_by, student_name, campus, subject
)
values (
  '13000000-0000-4000-8000-000000000101',
  '등록: 상담 내용 런타임', 'registration', 'in_progress', 'normal',
  '13000000-0000-4000-8000-000000000001', '상담내용학생', '본관', '영어'
);

insert into public.ops_registration_details(task_id)
values ('13000000-0000-4000-8000-000000000101');

insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status,
  director_profile_id, director_assignment_source, director_assigned_at
)
values (
  '13000000-0000-4000-8000-000000000201',
  '13000000-0000-4000-8000-000000000101',
  '영어', 'consultation_waiting',
  '13000000-0000-4000-8000-000000000001', 'manual', pg_catalog.now()
);

insert into public.ops_registration_consultations(
  id, track_id, mode, status, director_profile_id
)
values (
  '13000000-0000-4000-8000-000000000301',
  '13000000-0000-4000-8000-000000000201',
  'phone', 'waiting', '13000000-0000-4000-8000-000000000001'
);

create or replace function pg_temp.registration_consultation_note_set_actor(p_actor uuid)
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_actor::text,
      'role', 'authenticated',
      'email', 'consultation-note-runtime@runtime.invalid'
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

set local role authenticated;
select pg_temp.registration_consultation_note_set_actor(
  '13000000-0000-4000-8000-000000000001'
);

select is(
  public.save_registration_consultation_details_v1(
    '13000000-0000-4000-8000-000000000301',
    'completed', 'waiting',
    E'  현재 반 마감 안내\n다음 학기 우선 연락 요청  ',
    'consultation-note-save'
  ) ->> 'note',
  E'현재 반 마감 안내\n다음 학기 우선 연락 요청',
  '상담 책임자가 저장한 장문 내용은 가장자리 공백을 제거해 반환한다'
);

set local role postgres;
select is(
  (
    select consultation.note
    from public.ops_registration_consultations consultation
    where consultation.id = '13000000-0000-4000-8000-000000000301'
  ),
  E'현재 반 마감 안내\n다음 학기 우선 연락 요청',
  '상담 내용은 상담 결과와 같은 행에 저장된다'
);

set local role authenticated;
select pg_temp.registration_consultation_note_set_actor(
  '13000000-0000-4000-8000-000000000001'
);

select is(
  public.save_registration_consultation_details_v1(
    '13000000-0000-4000-8000-000000000301',
    'completed', 'waiting', '   ',
    'consultation-note-clear'
  ) ->> 'note',
  null,
  '공백뿐인 상담 내용은 NULL로 정규화된다'
);

select throws_ok(
  $$
    select public.save_registration_consultation_details_v1(
      '13000000-0000-4000-8000-000000000301',
      'waiting', null, '결과 없는 상담 내용',
      'consultation-note-without-result'
    )
  $$,
  '22023',
  'registration_consultation_details_invalid',
  '상담 결과 없이 내용만 저장할 수 없다'
);

select pg_temp.registration_consultation_note_set_actor(
  '13000000-0000-4000-8000-000000000002'
);

select throws_ok(
  $$
    select public.save_registration_consultation_details_v1(
      '13000000-0000-4000-8000-000000000301',
      'completed', 'waiting', '권한 없는 수정',
      'consultation-note-unauthorized'
    )
  $$,
  '42501',
  'registration_access_denied',
  '상담 책임자가 아닌 사용자는 상담 내용을 수정할 수 없다'
);

select * from finish();
rollback;
