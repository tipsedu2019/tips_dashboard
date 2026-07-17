begin;

select plan(32);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set constraints all deferred;

select has_column(
  'public', 'ops_registration_consultations', 'recipient_revision',
  '전화상담 수신자 세대 리비전을 보관한다'
);
select has_function(
  'dashboard_private', 'registration_track_event_key_v1', array['text', 'jsonb'],
  '등록 원본 이벤트를 명시적 canonical 키로 바꾸는 함수가 있다'
);
select has_function(
  'dashboard_private', 'write_registration_track_event_v2',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'jsonb', 'text', 'text'],
  'version-2 등록 원본 작성기가 있다'
);
select has_function(
  'dashboard_private', 'write_registration_track_event',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'jsonb'],
  '7인자 등록 작성기 호환 위임 함수가 있다'
);
select has_function(
  'public', 'list_registration_legacy_source_ids_v1', array['uuid'],
  '브라우저에는 안정 원본 ID만 돌려주는 함수가 있다'
);
select has_function(
  'public', 'get_registration_core_legacy_dispatch_plan_v1', array['uuid', 'uuid'],
  '등록 core 레거시 계획을 서버에서 다시 읽는다'
);
select has_function(
  'public', 'get_registration_visit_legacy_dispatch_plan_v1', array['uuid', 'uuid'],
  '방문상담 계획을 예약 ID로 다시 읽는다'
);
select has_function(
  'public', 'materialize_registration_visit_legacy_in_app_v1',
  array['uuid', 'uuid', 'uuid', 'bigint', 'uuid', 'uuid'],
  '방문상담 개인 알림은 canonical delivery를 물질화한다'
);
select has_function(
  'public', 'commit_registration_visit_legacy_in_app_v1',
  array['uuid', 'uuid', 'uuid', 'bigint', 'uuid', 'uuid'],
  '방문상담 개인 알림 물질화와 inbox 반영을 한 트랜잭션으로 확정한다'
);
select has_function(
  'public', 'materialize_registration_visit_legacy_google_chat_v1',
  array['uuid', 'uuid', 'bigint', 'uuid'],
  '방문상담 관리팀 알림은 canonical delivery를 물질화한다'
);
select has_function(
  'public', 'begin_registration_visit_legacy_google_chat_v1',
  array['uuid', 'uuid', 'bigint', 'uuid', 'uuid'],
  '방문상담 Google Chat은 공통 소유권 시작 경계를 사용한다'
);
select has_function(
  'public', 'finalize_registration_visit_legacy_google_chat_v1',
  array['uuid', 'uuid', 'bigint', 'uuid', 'text', 'text'],
  '방문상담 Google Chat은 sent failed unknown을 함께 확정한다'
);
select has_function(
  'public', 'begin_registration_admission_delivery_v1', array['uuid', 'uuid'],
  'SOLAPI provider 전에 공유 delivery 소유권을 획득한다'
);
select has_function(
  'public', 'complete_registration_admission_delivery_v1',
  array['uuid', 'uuid', 'uuid', 'bigint', 'uuid', 'uuid', 'text', 'jsonb', 'text', 'text'],
  'SOLAPI 업무 상태와 공유 delivery 결과를 한 트랜잭션으로 확정한다'
);
select has_function(
  'public', 'finalize_registration_admission_delivery_v1',
  array['uuid', 'uuid', 'bigint', 'uuid', 'text', 'text'],
  'SOLAPI 결과를 공유 delivery와 소유권에 확정한다'
);
select has_function(
  'dashboard_private', 'reconcile_registration_admission_delivery_state_v1',
  array['uuid', 'text', 'text', 'boolean'],
  'SOLAPI provider 증거 복구는 업무 메시지와 delivery 원장을 함께 맞춘다'
);
select has_trigger(
  'public', 'ops_registration_consultations',
  'bump_registration_phone_recipient_revision_v1',
  '전화상담 책임자 변경은 수신자 리비전을 올린다'
);
select has_trigger(
  'public', 'ops_registration_consultations',
  'write_registration_phone_queue_event_v1',
  '전화상담 생성 변경 완료는 전용 이벤트 경계를 지난다'
);
select has_trigger(
  'public', 'dashboard_notifications',
  'remove_registration_phone_direct_projection_v1',
  '이전 direct 전화상담 inbox 중복을 제거한다'
);
select is(
  public.registration_notification_handoffs_runtime_version(),
  1,
  '등록 인수인계 런타임 마커는 1이다'
);
select is_empty($$
  select flag_key
  from dashboard_private.notification_runtime_flags
  where flag_key in (
    'notification_control_plane_dispatch_registration_enabled',
    'notification_control_plane_registration_phone_adapter_enabled',
    'notification_control_plane_registration_visit_adapter_enabled',
    'notification_control_plane_registration_solapi_adapter_enabled'
  )
    and enabled
$$, '등록 core phone visit SOLAPI 네 플래그는 모두 꺼져 있다');
select is(
  (
    select count(*)::bigint
    from dashboard_private.notification_rules rule_row
    where rule_row.workflow_key = 'registration'
      and rule_row.event_key = 'registration.phone_consultation_ready'
      and rule_row.audience_key = 'track_director'
      and rule_row.channel_key = 'in_app'
      and rule_row.enabled
  ),
  1::bigint,
  '전화상담 호환 규칙은 책임자 inbox 한 셀만 켜져 있다'
);
select is(
  (
    select count(*)::bigint
    from dashboard_private.notification_rules rule_row
    where rule_row.workflow_key = 'registration'
      and rule_row.event_key in (
        'registration.visit_scheduled',
        'registration.visit_rescheduled',
        'registration.visit_replaced',
        'registration.visit_subject_deselected',
        'registration.visit_canceled'
      )
      and (
        (rule_row.audience_key = 'track_director' and rule_row.channel_key = 'in_app')
        or (rule_row.audience_key = 'management_team' and rule_row.channel_key = 'google_chat')
      )
      and rule_row.enabled
  ),
  10::bigint,
  '방문상담 다섯 이벤트는 개인 inbox와 관리팀 Chat 열 셀만 켜져 있다'
);
select is(
  (
    select count(*)::bigint
    from dashboard_private.notification_rules rule_row
    where rule_row.workflow_key = 'registration'
      and rule_row.event_key = 'registration.admission_message_requested'
      and rule_row.audience_key = 'applicant_guardian'
      and rule_row.channel_key = 'customer_message'
      and rule_row.enabled
  ),
  1::bigint,
  '입학신청 메시지는 명시적 guardian customer_message 한 셀만 있다'
);
select is_empty($$
  select rule_row.id
  from dashboard_private.notification_rules rule_row
  where rule_row.workflow_key = 'registration'
    and (
      rule_row.audience_key in ('applicant', 'operations')
      or rule_row.channel_key in ('applicant', 'operations')
    )
$$, 'applicant operations 유령 채널이나 대상은 없다');
select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.list_registration_legacy_source_ids_v1(uuid)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'public.list_registration_legacy_source_ids_v1(uuid)', 'EXECUTE'
  ),
  '안정 원본 ID 조회만 인증 사용자에게 열려 있다'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.get_registration_visit_legacy_dispatch_plan_v1(uuid,uuid)', 'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.begin_registration_admission_delivery_v1(uuid,uuid)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.begin_registration_admission_delivery_v1(uuid,uuid)', 'EXECUTE'
  ),
  '방문상담 계획과 SOLAPI 소유권 RPC는 service role 경계다'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.commit_registration_visit_legacy_in_app_v1(uuid,uuid,uuid,bigint,uuid,uuid)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'service_role',
    'public.complete_registration_admission_delivery_v1(uuid,uuid,uuid,bigint,uuid,uuid,text,jsonb,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.commit_registration_visit_legacy_in_app_v1(uuid,uuid,uuid,bigint,uuid,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.complete_registration_admission_delivery_v1(uuid,uuid,uuid,bigint,uuid,uuid,text,jsonb,text,text)',
    'EXECUTE'
  ),
  '원자 방문 inbox와 SOLAPI 완료 RPC는 service role에만 열린다'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'dashboard_private.write_registration_track_event_v2(uuid,uuid,text,text,text,text,jsonb,text,text)',
    'EXECUTE'
  ),
  '인증 브라우저는 version-2 원본 작성기를 직접 호출할 수 없다'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.claim_registration_admission_message(uuid,text)', 'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.finalize_registration_admission_message(uuid,text,jsonb)', 'EXECUTE'
  ),
  'SOLAPI 업무 claim은 인증 사용자이고 provider finalize는 service role이다'
);
select ok(
  (
    select procedure.prosecdef
    from pg_catalog.pg_proc procedure
    where procedure.oid = 'public.claim_registration_admission_message(uuid,text)'::regprocedure
  ),
  'SOLAPI claim wrapper는 닫힌 내부 writer를 호출하는 security definer 경계다'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'dashboard_private.reconcile_registration_admission_delivery_state_v1(uuid,text,text,boolean)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'dashboard_private.reconcile_registration_admission_delivery_state_v1(uuid,text,text,boolean)',
    'EXECUTE'
  ),
  'SOLAPI delivery 복구 helper는 service role에만 직접 열려 있다'
);

select * from finish();

rollback;
