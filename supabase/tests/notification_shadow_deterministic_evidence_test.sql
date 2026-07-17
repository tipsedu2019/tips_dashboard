begin;

select plan(29);

select ok(
  pg_catalog.to_regclass(
    'dashboard_private.notification_shadow_deterministic_evidence'
  ) is not null,
  '결정적 무발송 증거 표가 존재한다'
);
select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class relation
    where relation.oid =
      'dashboard_private.notification_shadow_deterministic_evidence'::regclass
  ),
  '결정적 증거 표는 RLS를 사용한다'
);
select has_column(
  'dashboard_private',
  'notification_shadow_deterministic_evidence',
  'batch_request_id',
  '규칙별 cycle 증거는 범위 묶음 요청 ID에 귀속된다'
);
select ok(
  not pg_catalog.has_table_privilege(
    'service_role',
    'dashboard_private.notification_shadow_deterministic_evidence',
    'INSERT,UPDATE,DELETE,TRUNCATE'
  ),
  'service role은 결정적 증거 표를 직접 변경할 수 없다'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'dashboard_private.notification_shadow_deterministic_evidence',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  '인증 브라우저는 결정적 증거 표를 읽거나 변경할 수 없다'
);

select ok(
  not pg_catalog.has_function_privilege(
    'service_role',
    'public.prepare_notification_shadow_deterministic_fixture_v1(text,uuid)',
    'EXECUTE'
  ),
  'service role도 운영에서 결정적 입력 준비 RPC를 실행할 수 없다'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.prepare_notification_shadow_deterministic_fixture_v1(text,uuid)',
    'EXECUTE'
  ),
  '인증 브라우저는 결정적 입력 준비 RPC를 실행할 수 없다'
);
select ok(
  not pg_catalog.has_function_privilege(
    'service_role',
    'public.record_notification_shadow_deterministic_evidence_v1(text,uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'service role도 운영에서 결정적 증거 기록 RPC를 실행할 수 없다'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.record_notification_shadow_deterministic_evidence_v1(text,uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  '인증 브라우저는 결정적 증거 기록 RPC를 실행할 수 없다'
);
select ok(
  not pg_catalog.has_function_privilege(
    'service_role',
    'public.replay_notification_shadow_evidence_v1(text,uuid)',
    'EXECUTE'
  ),
  'service role도 운영에서 별도 replay RPC를 실행할 수 없다'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.replay_notification_shadow_evidence_v1(text,uuid)',
    'EXECUTE'
  ),
  '인증 브라우저는 replay RPC를 실행할 수 없다'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.verify_notification_shadow_evidence_complete_v1()',
    'EXECUTE'
  ),
  'service role만 활성 rule별 최종 증거 gate를 실행한다'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.verify_notification_shadow_evidence_complete_v1()',
    'EXECUTE'
  ),
  '인증 브라우저는 최종 증거 gate를 실행할 수 없다'
);
select ok(
  not pg_catalog.has_function_privilege(
    'service_role',
    'dashboard_private.notification_shadow_deterministic_cycle_request_id_v1(uuid,text,uuid,bigint,text,text,text,bigint,integer,text)',
    'EXECUTE'
  ),
  '상태 결합 cycle ID 함수는 service role에 직접 공개하지 않는다'
);
select ok(
  not pg_catalog.has_function_privilege(
    'service_role',
    'dashboard_private.notification_template_checksum_sha256_v1()',
    'EXECUTE'
  ),
  '템플릿 체크섬 트리거 함수는 service role에 직접 공개하지 않는다'
);

select lives_ok($$
  insert into dashboard_private.notification_templates(
    id, rule_id, version, title_template, body_template, allowed_variables,
    payload_schema_version, checksum, created_by, created_actor_kind
  )
  select
    '01717171-1717-4171-8171-171717171717'::uuid,
    rule_row.id,
    pg_catalog.coalesce((
      select pg_catalog.max(template_row.version)
      from dashboard_private.notification_templates template_row
      where template_row.rule_id = rule_row.id
    ), 0) + 1,
    'pgTAP 체크섬 제목',
    'pgTAP 체크섬 본문',
    '[]'::jsonb,
    1,
    pg_catalog.repeat('a', 32),
    null,
    'system'
  from dashboard_private.notification_rules rule_row
  order by rule_row.id
  limit 1
$$, '신규 템플릿 저장은 호출자가 32자리 체크섬을 보내도 성공한다');
select ok(
  (
    select template_row.checksum =
      dashboard_private.notification_seed_template_checksum_v1(
        template_row.title_template,
        template_row.body_template,
        template_row.allowed_variables,
        template_row.payload_schema_version
      )
      and template_row.checksum ~ '^[a-f0-9]{64}$'
    from dashboard_private.notification_templates template_row
    where template_row.id = '01717171-1717-4171-8171-171717171717'::uuid
  ),
  '신규 템플릿 체크섬은 트리거가 서버 SHA-256 값으로 교정한다'
);

select ok(
  dashboard_private.notification_shadow_deterministic_intents_match_v1(
    '{
      "schemaVersion":1,
      "canonicalIntents":[{"targetKey":"profile:a","targetGeneration":"0"}],
      "legacyIntents":[{"targetGeneration":"0","targetKey":"profile:a"}]
    }'::jsonb
  ),
  'DB는 순서와 무관한 같은 상세 intent 집합을 일치로 판정한다'
);
select ok(
  not dashboard_private.notification_shadow_deterministic_intents_match_v1(
    '{
      "schemaVersion":1,
      "canonicalIntents":[{"targetKey":"profile:a","targetGeneration":"0"}],
      "legacyIntents":[{"targetKey":"profile:b","targetGeneration":"0"}]
    }'::jsonb
  ),
  'DB는 canonical과 legacy 상세 intent가 다르면 실패한다'
);
select is(
  dashboard_private.notification_shadow_deterministic_render_v1(
    '고정 문구',
    '[{"key":"unused","token":"unused"}]'::jsonb,
    '{}'::jsonb
  ),
  '고정 문구',
  '실제 문구에서 쓰지 않는 허용 변수는 context 값이 없어도 된다'
);
select throws_ok(
  $$select dashboard_private.notification_shadow_deterministic_render_v1(
    '필수 {used}',
    '[{"key":"used","token":"used"}]'::jsonb,
    '{}'::jsonb
  )$$,
  '22023',
  'notification_shadow_deterministic_render_invalid',
  '실제 문구에서 쓰는 변수 값이 없으면 실패한다'
);
select is(
  dashboard_private.registration_render_fixed_template_v1(
    '등록 {학생} · {grade}',
    '{"student_name":"검증학생","grade":"중2"}'::jsonb
  ),
  '등록 검증학생 · 중2',
  '등록 legacy renderer는 한글 core token과 기존 영문 token을 모두 치환한다'
);

select is_empty($$
  select function_row.oid
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'public'
    and function_row.proname in (
      'prepare_notification_shadow_deterministic_fixture_v1',
      'record_notification_shadow_deterministic_evidence_v1',
      'replay_notification_shadow_evidence_v1',
      'verify_notification_shadow_evidence_complete_v1'
    )
    and (
      not function_row.prosecdef
      or not exists (
        select 1
        from pg_catalog.unnest(
          pg_catalog.coalesce(function_row.proconfig, '{}'::text[])
        ) config(setting)
        where config.setting in ('search_path=', 'search_path=""')
      )
    )
$$, '공개 결정적 RPC는 모두 security definer와 빈 search_path를 사용한다');
select ok(
  not pg_catalog.has_function_privilege(
    'service_role',
    'dashboard_private.notification_shadow_rule_natural_evidence_current_v1(text,uuid,timestamptz)',
    'EXECUTE'
  ),
  '활성 rule별 자연 비교 판정 함수는 공개 실행 권한이 없다'
);
select ok(
  pg_catalog.position(
    'notification_shadow_deterministic_evidence' in
    pg_catalog.pg_get_functiondef(
      'dashboard_private.notification_shadow_scope_evidence_complete_v1(timestamptz)'::regprocedure
    )
  ) = 0,
  '결정적 DB 행만으로는 운영 완료 gate를 통과할 수 없다'
);
select ok(
  pg_catalog.position(
    'notification_shadow_rule_natural_evidence_current_v1' in
    pg_catalog.pg_get_functiondef(
      'dashboard_private.notification_shadow_scope_evidence_complete_v1(timestamptz)'::regprocedure
    )
  ) > 0,
  '활성 rule은 현재 자연 비교를 완료 조건으로 사용한다'
);
select ok(
  pg_catalog.position(
    'notification_no_active_rule_evidence_current_v1' in
    pg_catalog.pg_get_functiondef(
      'dashboard_private.notification_shadow_scope_evidence_complete_v1(timestamptz)'::regprocedure
    )
  ) > 0,
  '활성 rule이 0개인 범위만 무활성 증거를 완료 조건으로 사용한다'
);
select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid) like
      '%enabled_rule_count > 0%'
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname =
      'notification_shadow_deterministic_evidence_count_check'
  ),
  '결정적 증거는 활성 규칙이 있는 범위에만 저장된다'
);
select ok(
  dashboard_private.notification_shadow_active_rule_manifest_digest_v1(
    'registration_phone'
  ) ~ '^[a-f0-9]{64}$',
  '현재 활성 rule·revision·template manifest는 SHA-256으로 계산된다'
);

select * from finish();
rollback;
