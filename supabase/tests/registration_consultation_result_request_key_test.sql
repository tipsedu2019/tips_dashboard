begin;

select plan(3);

select has_function(
  'public',
  'save_registration_consultation_result_v2',
  array['uuid', 'text', 'text', 'text', 'uuid', 'integer', 'text'],
  '상담 결과 저장 RPC는 기존 등록 멱등성 키와 같은 text 요청 키를 받는다'
);

select hasnt_function(
  'public',
  'save_registration_consultation_result_v2',
  array['uuid', 'text', 'text', 'text', 'uuid', 'integer', 'uuid'],
  '문자열 멱등성 키를 거부하는 uuid 요청 키 오버로드는 남기지 않는다'
);

select function_privs_are(
  'public',
  'save_registration_consultation_result_v2',
  array['uuid', 'text', 'text', 'text', 'uuid', 'integer', 'text'],
  'authenticated',
  array['EXECUTE'],
  '인증 사용자는 교정된 상담 결과 저장 RPC만 실행할 수 있다'
);

select * from finish();

rollback;
