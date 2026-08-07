begin;
select no_plan();

select is(
  dashboard_private.registration_render_fixed_template_v2(
    '[학생] {학생} / [과목] {과목}',
    '{"student_name":"김민서 학생","subjects":["영어","수학"]}'::jsonb,
    '[{"key":"student_name","token":"학생"},{"key":"subjects","token":"과목"}]'::jsonb
  ),
  '[학생] 김민서 학생 / [과목] 영어 · 수학',
  '한국어 표시 토큰은 영문 payload key의 값을 렌더링한다'
);

select is(
  dashboard_private.registration_render_fixed_template_v2(
    '[학생] {student_name}',
    '{"student_name":"김민서 학생"}'::jsonb,
    '[{"key":"student_name","token":"학생"}]'::jsonb
  ),
  '[학생] 김민서 학생',
  '기존 영문 key 템플릿도 같은 payload 값을 유지한다'
);

select throws_ok(
  $$
    select dashboard_private.registration_render_fixed_template_v2(
      '{허용안됨}',
      '{"student_name":"김민서 학생"}'::jsonb,
      '[{"key":"student_name","token":"학생"}]'::jsonb
    )
  $$,
  '22023',
  'registration_notification_template_token_not_allowed:허용안됨',
  '계약에 없는 토큰은 fail closed 한다'
);

select throws_ok(
  $$
    select dashboard_private.registration_render_fixed_template_v2(
      '{학생}',
      '{"student_name":"김민서 학생"}'::jsonb,
      '[{"key":"student_name","token":"학생"},{"key":"학생","token":"다른표시"}]'::jsonb
    )
  $$,
  '22023',
  'registration_notification_template_allowlist_invalid',
  'key와 token이 충돌하는 모호한 계약은 차단한다'
);

select * from finish();
rollback;

