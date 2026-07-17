begin;
select no_plan();

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set constraints all deferred;

-- Task 6 owns only the settings/runtime-flag boundary and the atomic
-- connection metadata mutations. Delivery and orchestration worker RPCs are
-- deliberately tested in the Task 7 packet.

select has_function(
  'public',
  'get_notification_control_plane_v1',
  array['text'],
  'settings snapshot RPC exists'
);
select has_function(
  'public',
  'save_notification_control_plane_v1',
  array['text', 'jsonb', 'jsonb', 'uuid'],
  'settings save RPC exists'
);
select has_function(
  'public',
  'get_notification_runtime_flags_v1',
  array[]::text[],
  'runtime flag read RPC exists'
);
select has_function(
  'public',
  'set_notification_runtime_flag_v1',
  array['text', 'boolean', 'bigint', 'uuid'],
  'runtime flag mutation RPC exists'
);
select has_function(
  'public',
  'backfill_google_chat_connection_encryption_v1',
  array['text', 'bigint', 'text', 'text', 'text'],
  'controlled service-role Google Chat encryption backfill RPC exists'
);
select has_function(
  'public',
  'replace_google_chat_connection_v1',
  array['uuid', 'text', 'text', 'text', 'text', 'bigint', 'uuid'],
  'service-only atomic Google Chat replace RPC requires an explicit actor'
);
select has_function(
  'public',
  'disconnect_google_chat_connection_v1',
  array['uuid', 'text', 'bigint', 'uuid'],
  'service-only atomic Google Chat disconnect RPC requires an explicit actor'
);
select has_function(
  'public',
  'begin_google_chat_connection_verification_v1',
  array['uuid', 'text', 'bigint', 'uuid'],
  'service-only provider-preflight Google Chat verification RPC requires an explicit actor'
);
select has_function(
  'public',
  'record_google_chat_connection_verification_v1',
  array['uuid', 'text', 'boolean', 'text', 'bigint', 'uuid'],
  'service-only atomic Google Chat verification-result RPC requires an explicit actor'
);
select has_function(
  'dashboard_private',
  'notification_schedule_config_valid_v1',
  array['text', 'text', 'text', 'jsonb'],
  'server schedule validator owns workflow, event, variant, and config validation'
);
select has_function(
  'dashboard_private',
  'notification_template_content_valid_v1',
  array['text', 'text', 'jsonb'],
  'server template validator owns token and unsafe-content validation'
);
select has_function(
  'dashboard_private',
  'notification_google_chat_audience_ready_v1',
  array['text'],
  'server Google Chat readiness validator owns audience-to-connection mapping'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_notification_control_plane_v1(text)',
    'EXECUTE'
  ),
  'authenticated can call the role-checked settings reader'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated can call the role-checked settings saver'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_notification_runtime_flags_v1()',
    'EXECUTE'
  ),
  'authenticated can call the role-checked flag reader'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.set_notification_runtime_flag_v1(text,boolean,bigint,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot mutate server-authoritative flags'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.set_notification_runtime_flag_v1(text,boolean,bigint,uuid)',
    'EXECUTE'
  ),
  'service role can mutate server-authoritative flags'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.backfill_google_chat_connection_encryption_v1(text,bigint,text,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.backfill_google_chat_connection_encryption_v1(text,bigint,text,text,text)',
    'EXECUTE'
  ),
  'only service role can execute the controlled connection-encryption backfill'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.get_notification_control_plane_v1(text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.get_notification_runtime_flags_v1()',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.set_notification_runtime_flag_v1(text,boolean,bigint,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.backfill_google_chat_connection_encryption_v1(text,bigint,text,text,text)',
    'EXECUTE'
  ),
  'anon inherits no notification control-plane function execution'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.replace_google_chat_connection_v1(uuid,text,text,text,text,bigint,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.disconnect_google_chat_connection_v1(uuid,text,bigint,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.begin_google_chat_connection_verification_v1(uuid,text,bigint,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.record_google_chat_connection_verification_v1(uuid,text,boolean,text,bigint,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot execute service-mediated connection mutation functions'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.replace_google_chat_connection_v1(uuid,text,text,text,text,bigint,uuid)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'service_role',
    'public.disconnect_google_chat_connection_v1(uuid,text,bigint,uuid)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'service_role',
    'public.begin_google_chat_connection_verification_v1(uuid,text,bigint,uuid)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'service_role',
    'public.record_google_chat_connection_verification_v1(uuid,text,boolean,text,bigint,uuid)',
    'EXECUTE'
  ),
  'service role alone can execute explicit-actor connection mutation functions'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.replace_google_chat_connection_v1(uuid,text,text,text,text,bigint,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.disconnect_google_chat_connection_v1(uuid,text,bigint,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.begin_google_chat_connection_verification_v1(uuid,text,bigint,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.record_google_chat_connection_verification_v1(uuid,text,boolean,text,bigint,uuid)',
    'EXECUTE'
  ),
  'anon cannot call public connection wrappers'
);

select ok(
  (
    select count(*) >= 4
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'dashboard_private'
      and function_row.proname ~ '^(replace|disconnect|begin|record)_google_chat_connection.*_impl$'
  ),
  'public connection wrappers delegate to private implementation routines'
);
select is_empty($$
  select function_row.proname
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'dashboard_private'
    and function_row.proname in (
      'notification_schedule_config_valid_v1',
      'notification_template_content_valid_v1',
      'notification_google_chat_audience_ready_v1',
      'notification_google_chat_webhook_mask_v1',
      'set_notification_runtime_flag_v1_impl',
      'replace_google_chat_connection_v1_impl',
      'disconnect_google_chat_connection_v1_impl',
      'begin_google_chat_connection_verification_v1_impl',
      'record_google_chat_connection_verification_v1_impl',
      'notification_connection_safe_json_v1',
      'notification_control_plane_snapshot_v1',
      'notification_runtime_dependency_ready_v1'
    )
    and (
      pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
      or exists (
        select 1
        from pg_catalog.aclexplode(
          coalesce(
            function_row.proacl,
            pg_catalog.acldefault('f', function_row.proowner)
          )
        ) acl_row
        where acl_row.grantee = 0
          and acl_row.privilege_type = 'EXECUTE'
      )
    )
$$, 'every private Task 6 helper denies PUBLIC, anon, and authenticated execution');

select is_empty($$
  select function_row.proname
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname in ('public', 'dashboard_private')
    and (
      function_row.proname in (
        'get_notification_control_plane_v1',
        'save_notification_control_plane_v1',
        'get_notification_runtime_flags_v1',
        'set_notification_runtime_flag_v1',
        'backfill_google_chat_connection_encryption_v1',
        'replace_google_chat_connection_v1',
        'disconnect_google_chat_connection_v1',
        'begin_google_chat_connection_verification_v1',
        'record_google_chat_connection_verification_v1'
      )
      or (
        namespace_row.nspname = 'dashboard_private'
        and function_row.proname in (
          'notification_schedule_config_valid_v1',
          'notification_template_content_valid_v1',
          'notification_google_chat_audience_ready_v1',
          'notification_google_chat_webhook_mask_v1',
          'set_notification_runtime_flag_v1_impl',
          'replace_google_chat_connection_v1_impl',
          'disconnect_google_chat_connection_v1_impl',
          'begin_google_chat_connection_verification_v1_impl',
          'record_google_chat_connection_verification_v1_impl',
          'notification_connection_safe_json_v1',
          'notification_control_plane_snapshot_v1',
          'notification_runtime_dependency_ready_v1'
        )
      )
    )
    and (
      not function_row.prosecdef
      or not exists (
        select 1
        from unnest(coalesce(function_row.proconfig, '{}'::text[])) config(setting)
        where config.setting in ('search_path=', 'search_path=""')
      )
    )
$$, 'every privileged Task 6 RPC is security-definer with an empty search_path');

select ok(
  dashboard_private.notification_schedule_config_valid_v1(
    'registration',
    'registration.appointment_reminder_due',
    'previous_day_at',
    '{"anchor_key":"appointment_scheduled_at","local_time":"14:00","timezone":"Asia/Seoul"}'::jsonb
  )
  and dashboard_private.notification_schedule_config_valid_v1(
    'registration',
    'registration.appointment_reminder_due',
    'offset_before',
    '{"anchor_key":"appointment_scheduled_at","lead_minutes":1,"timezone":"Asia/Seoul"}'::jsonb
  )
  and dashboard_private.notification_schedule_config_valid_v1(
    'registration',
    'registration.appointment_reminder_due',
    'offset_before',
    '{"anchor_key":"appointment_scheduled_at","lead_minutes":10080,"timezone":"Asia/Seoul"}'::jsonb
  ),
  'only the closed registration appointment reminder schedule accepts valid KST wall-clock or bounded positive lead values'
);
select ok(
  not dashboard_private.notification_schedule_config_valid_v1(
    'tasks',
    'task.created',
    'offset_before',
    '{"anchor_key":"appointment_scheduled_at","lead_minutes":60,"timezone":"Asia/Seoul"}'::jsonb
  )
  and not dashboard_private.notification_schedule_config_valid_v1(
    'registration',
    'registration.appointment_reminder_due',
    'offset_before',
    '{"anchor_key":"created_at","lead_minutes":60,"timezone":"Asia/Seoul"}'::jsonb
  )
  and not dashboard_private.notification_schedule_config_valid_v1(
    'registration',
    'registration.appointment_reminder_due',
    'offset_before',
    '{"anchor_key":"appointment_scheduled_at","lead_minutes":0,"timezone":"Asia/Seoul"}'::jsonb
  )
  and not dashboard_private.notification_schedule_config_valid_v1(
    'registration',
    'registration.appointment_reminder_due',
    'offset_before',
    '{"anchor_key":"appointment_scheduled_at","lead_minutes":10081,"timezone":"Asia/Seoul"}'::jsonb
  ),
  'schedule validation rejects other workflows, other anchors, zero lead, and over-seven-day lead'
);
select ok(
  dashboard_private.notification_template_content_valid_v1(
    '상담 안내',
    '{학생} 학생의 상담 일정입니다.',
    '[{"key":"student_name","token":"학생","pii_class":"student_name"}]'::jsonb
  ),
  'template validation accepts balanced allowlisted Korean compatibility tokens'
);
select ok(
  not dashboard_private.notification_template_content_valid_v1(
    '상담 안내',
    '{미등록} 학생의 상담 일정입니다.',
    '[{"key":"student_name","token":"학생","pii_class":"student_name"}]'::jsonb
  )
  and not dashboard_private.notification_template_content_valid_v1(
    '상담 {학생',
    '본문',
    '[{"key":"student_name","token":"학생","pii_class":"student_name"}]'::jsonb
  )
  and not dashboard_private.notification_template_content_valid_v1(
    '<b>상담</b>',
    '본문',
    '[]'::jsonb
  )
  and not dashboard_private.notification_template_content_valid_v1(
    '상담',
    '@all 확인',
    '[]'::jsonb
  )
  and not dashboard_private.notification_template_content_valid_v1(
    '상담',
    'https://outside.invalid 확인',
    '[]'::jsonb
  )
  and not dashboard_private.notification_template_content_valid_v1(
    '상담',
    '//outside.invalid 확인',
    '[]'::jsonb
  ),
  'template validation rejects unknown or unbalanced tokens, raw HTML, provider mentions, and external URLs'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
    ),
    'notification-control-plane-workflow:'
  ) > pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
    ),
    'notification-request:'
  )
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
    ),
    'notification_template_content_valid_v1'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
    ),
    'notification_google_chat_audience_ready_v1'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.lower(
      pg_catalog.pg_get_functiondef(
        'public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
      )
    ),
    'for share of connection_row'
  ) > 0,
  'settings save locks by shared workflow contract and locks connection rows before server-authoritative validation'
);

create or replace function pg_temp.notification_runtime_set_actor(p_actor uuid)
returns void
language plpgsql
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

create or replace function pg_temp.notification_runtime_set_service_role()
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"role":"service_role"}',
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
end;
$$;

create or replace function pg_temp.notification_runtime_throws(
  p_sql text,
  p_message_pattern text
)
returns boolean
language plpgsql
volatile
as $$
begin
  execute p_sql;
  return false;
exception
  when others then
    return sqlerrm ~ p_message_pattern;
end;
$$;

create temporary table notification_control_plane_runtime_results (
  result_key text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert, update on notification_control_plane_runtime_results
  to authenticated, service_role;

insert into auth.users(
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'notification-admin@runtime.invalid',
    crypt('notification-runtime-only', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"notification-control-plane-runtime"}'::jsonb,
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'notification-staff@runtime.invalid',
    crypt('notification-runtime-only', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"notification-control-plane-runtime"}'::jsonb,
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'notification-viewer@runtime.invalid',
    crypt('notification-runtime-only', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"notification-control-plane-runtime"}'::jsonb,
    now(),
    now()
  )
on conflict (id) do update
set email = excluded.email,
    updated_at = excluded.updated_at;

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '30000000-0000-4000-8000-000000000001',
    'admin',
    '알림 런타임 관리자',
    'notification-admin@runtime.invalid',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    'staff',
    '알림 런타임 스태프',
    'notification-staff@runtime.invalid',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    'viewer',
    '알림 런타임 뷰어',
    'notification-viewer@runtime.invalid',
    now(),
    now()
  )
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

insert into dashboard_private.notification_rules(
  id,
  scope_key,
  workflow_key,
  event_key,
  channel_key,
  audience_key,
  rule_variant_key,
  delivery_mode,
  schedule_key,
  schedule_config,
  enabled,
  active_template_id,
  revision,
  created_by,
  created_actor_kind,
  updated_by,
  updated_actor_kind,
  created_at,
  updated_at
)
values
  (
    '30000000-0000-4000-8000-000000000101',
    'global',
    'tasks',
    'task.created',
    'google_chat',
    'management_team',
    'immediate',
    'immediate',
    null,
    null,
    false,
    '30000000-0000-4000-8000-000000000201',
    1,
    null,
    'system',
    null,
    'system',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000102',
    'global',
    'tasks',
    'task.due_changed',
    'in_app',
    'primary_assignee',
    'immediate',
    'immediate',
    null,
    null,
    false,
    '30000000-0000-4000-8000-000000000202',
    1,
    null,
    'system',
    null,
    'system',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000103',
    'global',
    'registration',
    'registration.appointment_reminder_due',
    'google_chat',
    'management_team',
    'offset_before',
    'scheduled',
    'offset_before',
    '{"anchor_key":"appointment_scheduled_at","lead_minutes":60,"timezone":"Asia/Seoul"}'::jsonb,
    false,
    '30000000-0000-4000-8000-000000000203',
    1,
    null,
    'system',
    null,
    'system',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000104',
    'global',
    'makeup_requests',
    'makeup_request.created',
    'google_chat',
    'executive_team',
    'immediate',
    'immediate',
    null,
    null,
    false,
    '30000000-0000-4000-8000-000000000204',
    1,
    null,
    'system',
    null,
    'system',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000105',
    'global',
    'makeup_requests',
    'makeup_request.approved',
    'google_chat',
    'subject_team',
    'immediate',
    'immediate',
    null,
    null,
    false,
    '30000000-0000-4000-8000-000000000205',
    1,
    null,
    'system',
    null,
    'system',
    now(),
    now()
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa106',
    'global',
    'tasks',
    'task.completed',
    'in_app',
    'secondary_assignee',
    'immediate',
    'immediate',
    null,
    null,
    false,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa206',
    1,
    null,
    'system',
    null,
    'system',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000107',
    'global',
    'registration',
    'registration.phone_consultation_ready',
    'in_app',
    'track_director',
    'immediate',
    'immediate',
    null,
    null,
    false,
    '30000000-0000-4000-8000-000000000207',
    1,
    null,
    'system',
    null,
    'system',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000108',
    'global',
    'registration',
    'registration.visit_scheduled',
    'google_chat',
    'management_team',
    'immediate',
    'immediate',
    null,
    null,
    false,
    '30000000-0000-4000-8000-000000000208',
    1,
    null,
    'system',
    null,
    'system',
    now(),
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000109',
    'global',
    'registration',
    'registration.admission_message_requested',
    'customer_message',
    'applicant_guardian',
    'immediate',
    'immediate',
    null,
    null,
    false,
    '30000000-0000-4000-8000-000000000209',
    1,
    null,
    'system',
    null,
    'system',
    now(),
    now()
  );

insert into dashboard_private.notification_templates(
  id,
  rule_id,
  version,
  title_template,
  body_template,
  allowed_variables,
  payload_schema_version,
  checksum,
  created_by,
  created_actor_kind,
  created_at
)
values
  (
    '30000000-0000-4000-8000-000000000201',
    '30000000-0000-4000-8000-000000000101',
    1,
    '새 할 일',
    '새 할 일이 등록되었습니다.',
    '[]'::jsonb,
    1,
    'runtime-fixture-task-created-v1',
    null,
    'system',
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000202',
    '30000000-0000-4000-8000-000000000102',
    1,
    '할 일 기한 변경',
    '할 일 기한이 변경되었습니다.',
    '[]'::jsonb,
    1,
    'runtime-fixture-task-due-v1',
    null,
    'system',
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000203',
    '30000000-0000-4000-8000-000000000103',
    1,
    '상담 일정 안내',
    '{학생} 학생의 상담 일정입니다.',
    '[{"key":"student_name","token":"학생","pii_class":"student_name"}]'::jsonb,
    1,
    'runtime-fixture-registration-reminder-v1',
    null,
    'system',
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000204',
    '30000000-0000-4000-8000-000000000104',
    1,
    '휴보강 임원 알림',
    '휴보강 요청이 등록되었습니다.',
    '[]'::jsonb,
    1,
    'runtime-fixture-makeup-executive-v1',
    null,
    'system',
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000205',
    '30000000-0000-4000-8000-000000000105',
    1,
    '휴보강 과목팀 알림',
    '휴보강 요청이 승인되었습니다.',
    '[]'::jsonb,
    1,
    'runtime-fixture-makeup-subject-v1',
    null,
    'system',
    now()
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa206',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa106',
    1,
    '별칭 방지 테스트',
    'UUID 키는 소문자 정규형만 허용합니다.',
    '[]'::jsonb,
    1,
    'runtime-fixture-canonical-uuid-v1',
    null,
    'system',
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000207',
    '30000000-0000-4000-8000-000000000107',
    1,
    '전화상담 준비',
    '전화상담 준비가 완료되었습니다.',
    '[]'::jsonb,
    1,
    'runtime-fixture-registration-phone-v1',
    null,
    'system',
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000208',
    '30000000-0000-4000-8000-000000000108',
    1,
    '방문상담 예약',
    '방문상담이 예약되었습니다.',
    '[]'::jsonb,
    1,
    'runtime-fixture-registration-visit-v1',
    null,
    'system',
    now()
  ),
  (
    '30000000-0000-4000-8000-000000000209',
    '30000000-0000-4000-8000-000000000109',
    1,
    '입학 안내',
    '입학 안내 메시지입니다.',
    '[]'::jsonb,
    1,
    'runtime-fixture-registration-solapi-v1',
    null,
    'system',
    now()
  );

insert into public.google_chat_webhook_settings(
  channel,
  webhook_url,
  webhook_url_ciphertext,
  webhook_url_mask,
  connection_state,
  revision,
  updated_by,
  last_verified_at,
  last_error_code,
  created_at,
  updated_at
)
values
  (
    'admin',
    'https://chat.googleapis.com/v1/spaces/LEGACYADMIN/messages?key=legacy-key&token=legacy-token',
    null,
    null,
    'legacy_active',
    9007199254740997,
    '30000000-0000-4000-8000-000000000001',
    null,
    null,
    now(),
    now()
  ),
  (
    'executive',
    'https://chat.googleapis.com/v1/spaces/EXECUTIVE/messages?key=legacy-executive&token=legacy-executive-token',
    'v1:fixture-iv:fixture-tag:fixture-ciphertext',
    'chat.googleapis.com/v1/spaces/EXEC…TIVE/messages',
    'encrypted_active',
    9007199254740997,
    '30000000-0000-4000-8000-000000000001',
    null,
    null,
    now(),
    now()
  ),
  (
    'math',
    'https://chat.googleapis.com/v1/spaces/MATHROOM/messages?key=math-key&token=math-token',
    'v1:math-iv:math-tag:math-ciphertext',
    'chat.googleapis.com/v1/spaces/…/messages',
    'encrypted_active',
    7,
    '30000000-0000-4000-8000-000000000001',
    null,
    null,
    now(),
    now()
  ),
  (
    'english',
    'https://chat.googleapis.com/v1/spaces/ENGLISHROOM/messages?key=english-key&token=english-token',
    'v1:english-iv:english-tag:english-ciphertext',
    'chat.googleapis.com/v1/spaces/ENGL…ROOM/messages',
    'encrypted_active',
    8,
    '30000000-0000-4000-8000-000000000001',
    null,
    null,
    now(),
    now()
  )
on conflict (channel) do update
set webhook_url = excluded.webhook_url,
    webhook_url_ciphertext = excluded.webhook_url_ciphertext,
    webhook_url_mask = excluded.webhook_url_mask,
    connection_state = excluded.connection_state,
    revision = excluded.revision,
    updated_by = excluded.updated_by,
    last_verified_at = excluded.last_verified_at,
    last_error_code = excluded.last_error_code,
    updated_at = excluded.updated_at;

select ok(
  dashboard_private.notification_google_chat_audience_ready_v1('management_team')
  and dashboard_private.notification_google_chat_audience_ready_v1('executive_team')
  and dashboard_private.notification_google_chat_audience_ready_v1('subject_team'),
  'management, executive, and both subject connections begin healthy'
);
select ok(
  (
    select webhook_url_mask is null
    from public.google_chat_webhook_settings
    where channel = 'admin'
  )
  and (
    select dashboard_private.notification_connection_safe_json_v1(
      connection_row,
      false
    ) ->> 'webhook_url_mask' = 'chat.googleapis.com/v1/spaces/LEGA…DMIN/messages'
    from public.google_chat_webhook_settings connection_row
    where connection_row.channel = 'admin'
  ),
  'strict-valid legacy plaintext is masked on read even when the stored legacy mask is null'
);
update public.google_chat_webhook_settings
set webhook_url = 'invalid-legacy-webhook'
where channel = 'admin';
select ok(
  not dashboard_private.notification_google_chat_audience_ready_v1('management_team')
  and (
    select dashboard_private.notification_connection_safe_json_v1(
      connection_row,
      false
    ) ->> 'webhook_url_mask' = 'chat.googleapis.com/v1/spaces/…/messages'
      and dashboard_private.notification_connection_safe_json_v1(
        connection_row,
        false
      ) ->> 'last_error_code' = 'configuration_error'
      and dashboard_private.notification_connection_safe_json_v1(
        connection_row,
        false
      )::text !~ 'invalid-legacy-webhook'
    from public.google_chat_webhook_settings connection_row
    where connection_row.channel = 'admin'
  ),
  'invalid legacy plaintext becomes a secret-free configuration error instead of aborting the settings snapshot'
);
update public.google_chat_webhook_settings
set webhook_url = 'https://chat.googleapis.com/v1/spaces/LEGACYADMIN/messages?key=legacy-key&token=legacy-token'
where channel = 'admin';
update public.google_chat_webhook_settings
set last_error_code = 'transport_error'
where channel = 'english';
select ok(
  not dashboard_private.notification_google_chat_audience_ready_v1('subject_team')
  and dashboard_private.notification_google_chat_audience_ready_v1('management_team')
  and dashboard_private.notification_google_chat_audience_ready_v1('executive_team'),
  'subject readiness requires both math and English while other audience connections remain independent'
);
update public.google_chat_webhook_settings
set last_error_code = null
where channel = 'english';

select is(
  (
    select count(*)
    from dashboard_private.notification_runtime_flags
  ),
  12::bigint,
  'the runtime flag registry contains exactly twelve approved keys'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_runtime_flags
    where enabled
  ),
  0::bigint,
  'all twelve runtime flags remain false after installation'
);
select is(
  (
    select pg_catalog.string_agg(flag_key, ',' order by flag_key)
    from dashboard_private.notification_runtime_flags
  ),
  (
    select pg_catalog.string_agg(flag_key, ',' order by flag_key)
    from (
      values
        ('notification_control_plane_dispatch_approvals_enabled'),
        ('notification_control_plane_dispatch_makeup_requests_enabled'),
        ('notification_control_plane_dispatch_registration_enabled'),
        ('notification_control_plane_dispatch_tasks_enabled'),
        ('notification_control_plane_dispatch_transfer_enabled'),
        ('notification_control_plane_dispatch_withdrawal_enabled'),
        ('notification_control_plane_dispatch_word_retests_enabled'),
        ('notification_control_plane_registration_phone_adapter_enabled'),
        ('notification_control_plane_registration_solapi_adapter_enabled'),
        ('notification_control_plane_registration_visit_adapter_enabled'),
        ('notification_control_plane_settings_ui_enabled'),
        ('notification_control_plane_shadow_write_enabled')
    ) expected(flag_key)
  ),
  'runtime flag keys are a closed twelve-key registry'
);

-- Specialized registration rollback is rule/event scoped. Disabling one
-- adapter must never cancel generic registration work or another adapter.
insert into dashboard_private.notification_events(
  id,
  scope_key,
  workflow_key,
  event_key,
  source_type,
  source_id,
  source_revision,
  occurrence_key,
  actor_profile_id,
  occurred_at,
  payload_schema_version,
  payload,
  rule_snapshot,
  materialized_rule_id,
  materialized_rule_revision
)
values
  (
    '30000000-0000-4000-8000-000000000501',
    'global', 'registration', 'registration.appointment_reminder_due',
    'registration_appointment', 'generic-fixture', 1, 'generic-fixture:1',
    null, now(), 1, '{}'::jsonb, '[]'::jsonb, null, null
  ),
  (
    '30000000-0000-4000-8000-000000000502',
    'global', 'registration', 'registration.phone_consultation_ready',
    'registration_case', 'phone-fixture', 1, 'phone-fixture:1',
    null, now(), 1, '{}'::jsonb, '[]'::jsonb, null, null
  ),
  (
    '30000000-0000-4000-8000-000000000503',
    'global', 'registration', 'registration.visit_scheduled',
    'registration_appointment', 'visit-fixture', 1, 'visit-fixture:1',
    null, now(), 1, '{}'::jsonb, '[]'::jsonb, null, null
  ),
  (
    '30000000-0000-4000-8000-000000000504',
    'global', 'registration', 'registration.admission_message_requested',
    'registration_message', 'solapi-fixture', 1, 'solapi-fixture:1',
    null, now(), 1, '{}'::jsonb, '[]'::jsonb, null, null
  );

insert into dashboard_private.notification_deliveries(
  id,
  event_id,
  rule_id,
  rule_revision,
  template_id,
  channel_key,
  audience_key,
  target_generation,
  target_set_hash,
  target_kind,
  target_key,
  target_profile_id,
  connection_key,
  target_snapshot,
  parent_delivery_id,
  status,
  status_reason,
  dedupe_key,
  rendered_title,
  rendered_body,
  href,
  scheduled_for,
  attempt_count,
  max_attempts,
  claimed_by,
  claim_token,
  lease_expires_at,
  next_attempt_at
)
values
  (
    '30000000-0000-4000-8000-000000000601',
    '30000000-0000-4000-8000-000000000501',
    '30000000-0000-4000-8000-000000000103', 1,
    '30000000-0000-4000-8000-000000000203',
    'google_chat', 'management_team', 0, 'generic-targets',
    'connection', 'google_chat.management', null, 'google_chat.management',
    '{}'::jsonb, null, 'claimed', null, 'runtime-generic-delivery',
    'generic', 'generic', null, now(), 0, 3,
    'runtime-worker', '30000000-0000-4000-8000-000000000801',
    now() + interval '5 minutes', null
  ),
  (
    '30000000-0000-4000-8000-000000000602',
    '30000000-0000-4000-8000-000000000502',
    '30000000-0000-4000-8000-000000000107', 1,
    '30000000-0000-4000-8000-000000000207',
    'web_push', 'track_director', 0, 'phone-targets',
    'push_subscription', 'phone-subscription', null, null,
    '{}'::jsonb, null, 'pending', null, 'runtime-phone-delivery',
    'phone', 'phone', null, now(), 0, 3,
    null, null, null, null
  ),
  (
    '30000000-0000-4000-8000-000000000603',
    '30000000-0000-4000-8000-000000000503',
    '30000000-0000-4000-8000-000000000108', 1,
    '30000000-0000-4000-8000-000000000208',
    'google_chat', 'management_team', 0, 'visit-targets',
    'connection', 'google_chat.management', null, 'google_chat.management',
    '{}'::jsonb, null, 'pending', null, 'runtime-visit-delivery',
    'visit', 'visit', null, now(), 0, 3,
    null, null, null, null
  ),
  (
    '30000000-0000-4000-8000-000000000604',
    '30000000-0000-4000-8000-000000000504',
    '30000000-0000-4000-8000-000000000109', 1,
    '30000000-0000-4000-8000-000000000209',
    'customer_message', 'applicant_guardian', 0, 'solapi-targets',
    'customer_endpoint', 'guardian-endpoint', null, null,
    '{}'::jsonb, null, 'pending', null, 'runtime-solapi-delivery',
    'solapi', 'solapi', null, now(), 0, 3,
    null, null, null, null
  );

insert into dashboard_private.notification_dispatch_ownership_claims(
  id,
  workflow_key,
  occurrence_key,
  rule_id,
  channel_key,
  target_key,
  target_generation,
  owner_kind,
  owner_generation,
  state
)
values
  ('30000000-0000-4000-8000-000000000701', 'registration', 'generic-fixture:1', '30000000-0000-4000-8000-000000000103', 'google_chat', 'google_chat.management', 0, 'canonical', 1, 'reserved'),
  ('30000000-0000-4000-8000-000000000702', 'registration', 'phone-fixture:1', '30000000-0000-4000-8000-000000000107', 'in_app', 'profile:phone', 0, 'canonical', 1, 'reserved'),
  ('30000000-0000-4000-8000-000000000703', 'registration', 'visit-fixture:1', '30000000-0000-4000-8000-000000000108', 'google_chat', 'google_chat.management', 0, 'canonical', 1, 'reserved'),
  ('30000000-0000-4000-8000-000000000704', 'registration', 'solapi-fixture:1', '30000000-0000-4000-8000-000000000109', 'customer_message', 'guardian-endpoint', 0, 'canonical', 1, 'reserved');

update dashboard_private.notification_runtime_flags
set enabled = true
where flag_key in (
  'notification_control_plane_registration_phone_adapter_enabled',
  'notification_control_plane_registration_visit_adapter_enabled',
  'notification_control_plane_registration_solapi_adapter_enabled'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'specialized-phone-disable', public.set_notification_runtime_flag_v1(
  'notification_control_plane_registration_phone_adapter_enabled', false, 1,
  '30000000-0000-4000-8000-000000000711'
);
select ok(
  (
    select status = 'canceled'
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000602'
  )
  and (
    select status = 'pending'
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000603'
  )
  and (
    select status = 'pending'
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000604'
  )
  and (
    select status = 'claimed' and cancel_requested_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000601'
  )
  and (
    select payload -> 'reserved_ownership_claims'
      = '[{"claim_id":"30000000-0000-4000-8000-000000000702","owner_generation":"1"}]'::jsonb
    from notification_control_plane_runtime_results
    where result_key = 'specialized-phone-disable'
  ),
  'phone rollback cancels its in-app rule derivatives only and preserves generic, visit, and SOLAPI work'
);

insert into notification_control_plane_runtime_results(result_key, payload)
select 'specialized-visit-disable', public.set_notification_runtime_flag_v1(
  'notification_control_plane_registration_visit_adapter_enabled', false, 1,
  '30000000-0000-4000-8000-000000000712'
);
select ok(
  (
    select status = 'canceled'
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000603'
  )
  and (
    select status = 'pending'
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000604'
  )
  and (
    select status = 'claimed' and cancel_requested_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000601'
  )
  and (
    select payload -> 'reserved_ownership_claims'
      = '[{"claim_id":"30000000-0000-4000-8000-000000000703","owner_generation":"1"}]'::jsonb
    from notification_control_plane_runtime_results
    where result_key = 'specialized-visit-disable'
  ),
  'visit rollback cancels only the closed visit event catalog and preserves generic and SOLAPI work'
);

insert into notification_control_plane_runtime_results(result_key, payload)
select 'specialized-solapi-disable', public.set_notification_runtime_flag_v1(
  'notification_control_plane_registration_solapi_adapter_enabled', false, 1,
  '30000000-0000-4000-8000-000000000713'
);
select ok(
  (
    select status = 'canceled'
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000604'
  )
  and (
    select status = 'claimed' and cancel_requested_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000601'
  )
  and (
    select payload -> 'reserved_ownership_claims'
      = '[{"claim_id":"30000000-0000-4000-8000-000000000704","owner_generation":"1"}]'::jsonb
    from notification_control_plane_runtime_results
    where result_key = 'specialized-solapi-disable'
  ),
  'SOLAPI rollback cancels only customer-message admission commands and preserves generic registration work'
);
reset role;

-- Generic registration rollback owns core/reminder work only. Exercise a real
-- true-to-false transition across every delivery state while restoring fresh
-- specialized rows so the exclusion boundary is observable.
update dashboard_private.notification_deliveries
set status = 'pending',
    status_reason = null,
    next_attempt_at = null,
    claimed_by = null,
    claim_token = null,
    lease_expires_at = null,
    cancel_requested_at = null,
    cancel_reason = null
where id in (
  '30000000-0000-4000-8000-000000000602',
  '30000000-0000-4000-8000-000000000603',
  '30000000-0000-4000-8000-000000000604'
);

insert into dashboard_private.notification_deliveries(
  id,
  event_id,
  rule_id,
  rule_revision,
  template_id,
  channel_key,
  audience_key,
  target_generation,
  target_set_hash,
  target_kind,
  target_key,
  target_profile_id,
  connection_key,
  target_snapshot,
  parent_delivery_id,
  status,
  status_reason,
  dedupe_key,
  rendered_title,
  rendered_body,
  href,
  scheduled_for,
  attempt_count,
  max_attempts,
  claimed_by,
  claim_token,
  lease_expires_at,
  next_attempt_at
)
values
  (
    '30000000-0000-4000-8000-000000000605',
    '30000000-0000-4000-8000-000000000501',
    '30000000-0000-4000-8000-000000000103', 1,
    '30000000-0000-4000-8000-000000000203',
    'google_chat', 'management_team', 0, 'generic-pending-targets',
    'connection', 'google_chat.management.pending', null, 'google_chat.management',
    '{}'::jsonb, null, 'pending', null, 'runtime-generic-pending',
    'generic pending', 'generic pending', null, now(), 0, 3,
    null, null, null, null
  ),
  (
    '30000000-0000-4000-8000-000000000606',
    '30000000-0000-4000-8000-000000000501',
    '30000000-0000-4000-8000-000000000103', 1,
    '30000000-0000-4000-8000-000000000203',
    'google_chat', 'management_team', 0, 'generic-retry-targets',
    'connection', 'google_chat.management.retry', null, 'google_chat.management',
    '{}'::jsonb, null, 'retry_wait', 'transient_pre_dispatch_failure',
    'runtime-generic-retry', 'generic retry', 'generic retry', null, now(), 1, 3,
    null, null, null, now() + interval '5 minutes'
  ),
  (
    '30000000-0000-4000-8000-000000000607',
    '30000000-0000-4000-8000-000000000501',
    '30000000-0000-4000-8000-000000000103', 1,
    '30000000-0000-4000-8000-000000000203',
    'google_chat', 'management_team', 0, 'generic-sending-targets',
    'connection', 'google_chat.management.sending', null, 'google_chat.management',
    '{}'::jsonb, null, 'sending', null, 'runtime-generic-sending',
    'generic sending', 'generic sending', null, now(), 1, 3,
    'runtime-worker', '30000000-0000-4000-8000-000000000807',
    now() + interval '5 minutes', null
  ),
  (
    '30000000-0000-4000-8000-000000000608',
    '30000000-0000-4000-8000-000000000501',
    '30000000-0000-4000-8000-000000000103', 1,
    '30000000-0000-4000-8000-000000000203',
    'google_chat', 'management_team', 0, 'generic-sent-targets',
    'connection', 'google_chat.management.sent', null, 'google_chat.management',
    '{}'::jsonb, null, 'sent', null, 'runtime-generic-sent',
    'generic sent', 'generic sent', null, now(), 1, 3,
    null, null, null, null
  ),
  (
    '30000000-0000-4000-8000-000000000609',
    '30000000-0000-4000-8000-000000000501',
    '30000000-0000-4000-8000-000000000103', 1,
    '30000000-0000-4000-8000-000000000203',
    'google_chat', 'management_team', 0, 'generic-unknown-targets',
    'connection', 'google_chat.management.unknown', null, 'google_chat.management',
    '{}'::jsonb, null, 'delivery_unknown', 'provider_timeout_after_dispatch',
    'runtime-generic-unknown', 'generic unknown', 'generic unknown', null, now(), 1, 3,
    null, null, null, null
  );

update dashboard_private.notification_runtime_flags
set enabled = true
where flag_key = 'notification_control_plane_dispatch_registration_enabled';

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'generic-registration-disable', public.set_notification_runtime_flag_v1(
  'notification_control_plane_dispatch_registration_enabled', false, 1,
  '30000000-0000-4000-8000-000000000714'
);
select ok(
  (
    select status = 'canceled'
      and status_reason = 'cutover_rollback'
      and next_attempt_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000605'
  )
  and (
    select status = 'canceled'
      and status_reason = 'cutover_rollback'
      and next_attempt_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000606'
  )
  and (
    select status = 'claimed'
      and cancel_requested_at is not null
      and cancel_reason = 'cutover_rollback'
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000601'
  )
  and (
    select payload ->> 'canceled_count' = '2'
      and payload ->> 'claim_cancel_requested_count' = '1'
      and payload -> 'reserved_ownership_claims'
        = '[{"claim_id":"30000000-0000-4000-8000-000000000701","owner_generation":"1"}]'::jsonb
    from notification_control_plane_runtime_results
    where result_key = 'generic-registration-disable'
  ),
  'generic registration rollback cancels pending/retry core work and requests cancellation for claimed core work'
);
select ok(
  (
    select status = 'sending' and cancel_requested_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000607'
  )
  and (
    select status = 'sent' and cancel_requested_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000608'
  )
  and (
    select status = 'delivery_unknown'
      and status_reason = 'provider_timeout_after_dispatch'
      and cancel_requested_at is null
    from dashboard_private.notification_deliveries
    where id = '30000000-0000-4000-8000-000000000609'
  ),
  'generic rollback preserves sending, sent, and delivery-unknown core outcomes'
);
select ok(
  not exists (
    select 1
    from dashboard_private.notification_deliveries
    where id in (
      '30000000-0000-4000-8000-000000000602',
      '30000000-0000-4000-8000-000000000603',
      '30000000-0000-4000-8000-000000000604'
    )
      and (
        status <> 'pending'
        or cancel_requested_at is not null
        or cancel_reason is not null
      )
  )
  and (
    select count(*) = 3
    from dashboard_private.notification_dispatch_ownership_claims
    where id in (
      '30000000-0000-4000-8000-000000000702',
      '30000000-0000-4000-8000-000000000703',
      '30000000-0000-4000-8000-000000000704'
    )
      and state = 'reserved'
  ),
  'generic registration rollback preserves phone, visit, and SOLAPI deliveries and ownership claims'
);
reset role;

set local role authenticated;
select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000003'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$select public.get_notification_control_plane_v1('tasks')$sql$,
    'notification_access_denied'
  ),
  'viewer cannot read notification settings'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        '{"30000000-0000-4000-8000-000000000101":"1"}'::jsonb,
        '{"rules":{}}'::jsonb,
        '30000000-0000-4000-8000-000000000301'
      )
    $sql$,
    'notification_access_denied'
  ),
  'viewer cannot save notification settings'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$select public.get_notification_runtime_flags_v1()$sql$,
    'notification_access_denied'
  ),
  'viewer cannot read operational flags'
);

reset role;
select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000002'
);
set local role authenticated;
select lives_ok(
  $sql$select public.get_notification_control_plane_v1('tasks')$sql$,
  'staff can read notification settings'
);
select lives_ok(
  $sql$select public.get_notification_runtime_flags_v1()$sql$,
  'staff can read the safe flag capability map'
);
select ok(
  (
    public.get_notification_runtime_flags_v1()
      -> 'flags'
      -> 'notification_control_plane_settings_ui_enabled'
      ->> 'enabled'
  )::boolean = false
  and (
    public.get_notification_runtime_flags_v1()
      -> 'flags'
      -> 'notification_control_plane_settings_ui_enabled'
      ->> 'revision'
  ) = '1',
  'flag capability JSON contains booleans and decimal-string revisions only'
);

reset role;
select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        '{"30000000-0000-4000-8000-000000000101":"1"}'::jsonb,
        '{"rules":{}}'::jsonb,
        '30000000-0000-4000-8000-000000000302'
      )
    $sql$,
    'notification_settings_ui_disabled'
  ),
  'an already-open panel cannot save while the UI flag is false'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$select public.get_notification_control_plane_v1('arbitrary_workflow')$sql$,
    'notification_workflow_unknown'
  ),
  'unknown workflow reads fail closed'
);

reset role;
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.set_notification_runtime_flag_v1(
        'notification_control_plane_unknown_enabled',
        false,
        1,
        '30000000-0000-4000-8000-000000000311'
      )
    $sql$,
    'notification_flag_unknown'
  ),
  'arbitrary runtime flag keys fail closed'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.set_notification_runtime_flag_v1(
        'notification_control_plane_shadow_write_enabled',
        false,
        99,
        '30000000-0000-4000-8000-000000000312'
      )
    $sql$,
    'notification_revision_conflict'
  ),
  'runtime flag mutation uses optimistic revision checks'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'flag-disable-first',
  public.set_notification_runtime_flag_v1(
    'notification_control_plane_shadow_write_enabled',
    false,
    1,
    '30000000-0000-4000-8000-000000000313'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'flag-disable-replay',
  public.set_notification_runtime_flag_v1(
    'notification_control_plane_shadow_write_enabled',
    false,
    1,
    '30000000-0000-4000-8000-000000000313'
  );
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'flag-disable-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'flag-disable-first'
  ),
  'same runtime-flag request replays the committed response'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.set_notification_runtime_flag_v1(
        'notification_control_plane_shadow_write_enabled',
        true,
        1,
        '30000000-0000-4000-8000-000000000313'
      )
    $sql$,
    'idempotency_key_reused'
  ),
  'same flag request ID with a different fingerprint is rejected'
);
select ok(
  case
    when pg_catalog.to_regprocedure(
      'public.common_notification_control_plane_runtime_version()'
    ) is not null then true
    else pg_temp.notification_runtime_throws(
      $sql$
        select public.set_notification_runtime_flag_v1(
          'notification_control_plane_settings_ui_enabled',
          true,
          1,
          '30000000-0000-4000-8000-000000000314'
        )
      $sql$,
      'notification_runtime_not_ready'
    )
  end,
  'UI enablement fails closed while the common runtime marker is absent'
);
select ok(
  case
    when pg_catalog.to_regprocedure(
      'public.notification_workflow_adapters_runtime_version()'
    ) is not null
    and exists (
      select 1
      from dashboard_private.notification_worker_heartbeats heartbeat
      where heartbeat.phase = 'succeeded'
        and heartbeat.created_at >= now() - interval '3 minutes'
    ) then true
    else pg_temp.notification_runtime_throws(
      $sql$
        select public.set_notification_runtime_flag_v1(
          'notification_control_plane_dispatch_tasks_enabled',
          true,
          1,
          '30000000-0000-4000-8000-000000000315'
        )
      $sql$,
      'notification_runtime_not_ready'
    )
  end,
  'dispatch enablement fails closed without adapter runtime and a fresh successful heartbeat'
);
select ok(
  case
    when pg_catalog.to_regprocedure(
      'public.registration_appointment_reminders_runtime_version()'
    ) is not null then true
    else pg_temp.notification_runtime_throws(
      $sql$
        select public.set_notification_runtime_flag_v1(
          'notification_control_plane_registration_visit_adapter_enabled',
          true,
          2,
          '30000000-0000-4000-8000-000000000316'
        )
      $sql$,
      'notification_runtime_not_ready'
    )
  end,
  'registration adapter enablement fails closed without its appointment runtime marker'
);

-- Readiness must reject marker stubs that exist but advertise the wrong
-- contract version. This is an actual mutation attempt, not a CASE bypass.
reset role;
create or replace function public.common_notification_control_plane_runtime_version()
returns integer
language sql
immutable
security definer
set search_path = ''
as $$ select 0 $$;
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.set_notification_runtime_flag_v1(
        'notification_control_plane_settings_ui_enabled',
        true,
        1,
        '30000000-0000-4000-8000-000000000318'
      )
    $sql$,
    'notification_runtime_not_ready'
  ),
  'an existing common runtime marker with the wrong version is rejected'
);

reset role;
create or replace function public.common_notification_control_plane_runtime_version()
returns integer
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  raise exception 'fixture marker failure';
end;
$$;
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.set_notification_runtime_flag_v1(
        'notification_control_plane_settings_ui_enabled',
        true,
        1,
        '30000000-0000-4000-8000-000000000320'
      )
    $sql$,
    'notification_runtime_not_ready'
  ),
  'a runtime marker that raises is treated as unavailable'
);

-- Correct marker versions are still insufficient when the only successful
-- worker heartbeat is older than the three-minute readiness window.
reset role;
create or replace function public.common_notification_control_plane_runtime_version()
returns integer
language sql
immutable
security definer
set search_path = ''
as $$ select 1 $$;
create or replace function public.notification_workflow_adapters_runtime_version()
returns integer
language sql
immutable
security definer
set search_path = ''
as $$ select 1 $$;
update dashboard_private.notification_worker_heartbeats
set created_at = pg_catalog.clock_timestamp() - interval '10 minutes'
where phase = 'succeeded';
insert into dashboard_private.notification_worker_heartbeats(
  id,
  worker_id,
  run_id,
  phase,
  counts,
  error_code,
  created_at
) values (
  '30000000-0000-4000-8000-000000000811',
  'runtime-stale-worker',
  '30000000-0000-4000-8000-000000000812',
  'succeeded',
  '{"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
  null,
  pg_catalog.clock_timestamp() - interval '10 minutes'
);
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.set_notification_runtime_flag_v1(
        'notification_control_plane_dispatch_tasks_enabled',
        true,
        1,
        '30000000-0000-4000-8000-000000000319'
      )
    $sql$,
    'notification_runtime_not_ready'
  ),
  'dispatch readiness rejects correct markers paired with only a stale successful heartbeat'
);
reset role;
select ok(
  not exists (
    select 1
    from dashboard_private.notification_request_ledger
    where request_id in (
      '30000000-0000-4000-8000-000000000318',
      '30000000-0000-4000-8000-000000000319',
      '30000000-0000-4000-8000-000000000320'
    )
  )
  and (
    select not enabled and revision = 1
    from dashboard_private.notification_runtime_flags
    where flag_key = 'notification_control_plane_settings_ui_enabled'
  )
  and (
    select not enabled and revision = 1
    from dashboard_private.notification_runtime_flags
    where flag_key = 'notification_control_plane_dispatch_tasks_enabled'
  ),
  'failed version and heartbeat readiness checks commit no flag or request-ledger mutation'
);

reset role;
select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.set_notification_runtime_flag_v1(
        'notification_control_plane_settings_ui_enabled',
        false,
        1,
        '30000000-0000-4000-8000-000000000317'
      )
    $sql$,
    'permission denied|notification_access_denied'
  ),
  'even an authenticated admin cannot mutate service-role flags'
);

-- The operator save contract deliberately cannot turn its own gate on. A
-- postgres fixture enables it to exercise the authenticated save transaction.
reset role;
update dashboard_private.notification_runtime_flags
set enabled = true,
    updated_by = null,
    updated_at = now()
where flag_key = 'notification_control_plane_settings_ui_enabled';

select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  (
    public.get_notification_control_plane_v1('tasks') ->> 'scope_key'
  ) = 'global'
  and (
    public.get_notification_control_plane_v1('tasks') ->> 'workflow_key'
  ) = 'tasks'
  and jsonb_typeof(
    public.get_notification_control_plane_v1('tasks') -> 'rules'
  ) = 'array'
  and jsonb_typeof(
    public.get_notification_control_plane_v1('tasks') -> 'connections'
  ) = 'array'
  and jsonb_typeof(
    public.get_notification_control_plane_v1('tasks') -> 'delivery_summary'
  ) = 'object',
  'admin receives the closed safe settings snapshot shape'
);
select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_notification_control_plane_v1('tasks') -> 'rules'
    ) rule(value)
    where rule.value ->> 'id' = '30000000-0000-4000-8000-000000000101'
      and rule.value ->> 'revision' = '1'
      and rule.value -> 'template' ->> 'version' = '1'
  ),
  'settings snapshot serializes bigint revisions as decimal strings'
);
select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_notification_control_plane_v1('tasks') -> 'connections'
    ) connection(value)
    where connection.value ->> 'connection_key' = 'google_chat.management'
      and connection.value ->> 'webhook_url_mask'
        = 'chat.googleapis.com/v1/spaces/LEGA…DMIN/messages'
  )
  and exists (
    select 1
    from jsonb_array_elements(
      public.get_notification_control_plane_v1('tasks') -> 'connections'
    ) connection(value)
    where connection.value ->> 'connection_key' = 'google_chat.executive'
      and connection.value ->> 'webhook_url_mask'
        = 'chat.googleapis.com/v1/spaces/EXEC…TIVE/messages'
  ),
  'long Google Chat space IDs expose only the fixed first-four/last-four mask'
);
select ok(
  public.get_notification_control_plane_v1('tasks')::text
    !~ 'legacy-key|legacy-token|fixture-ciphertext|webhook_url_ciphertext',
  'settings snapshot exposes no plaintext or ciphertext secret'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        '{"30000000-0000-4000-8000-000000000101":"1"}'::jsonb,
        '{"rules":{"30000000-0000-4000-8000-000000000101":{"enabled":true,"channel_key":"web_push"}}}'::jsonb,
        '30000000-0000-4000-8000-000000000321'
      )
    $sql$,
    'notification_patch_invalid'
  ),
  'save rejects fields outside the closed editable rule patch'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        '{"30000000-0000-4000-8000-000000009999":"1"}'::jsonb,
        '{"rules":{"30000000-0000-4000-8000-000000009999":{"enabled":true}}}'::jsonb,
        '30000000-0000-4000-8000-000000000322'
      )
    $sql$,
    'notification_rule_unknown'
  ),
  'save rejects arbitrary rule identities'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        '{"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa106":"1","AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAA106":"1"}'::jsonb,
        '{"rules":{"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa106":{"enabled":true},"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAA106":{"enabled":true}}}'::jsonb,
        '30000000-0000-4000-8000-000000000329'
      )
    $sql$,
    'notification_patch_invalid'
  ),
  'lowercase and uppercase aliases of one UUID are rejected as one invalid atomic request'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        '{"30000000-0000-4000-8000-000000000101":"1"}'::jsonb,
        '{"rules":{"30000000-0000-4000-8000-000000000101":{"body_template":"{미등록} 알림"}}}'::jsonb,
        '30000000-0000-4000-8000-000000000330'
      )
    $sql$,
    'notification_patch_invalid'
  ),
  'settings save rejects a token outside the immutable template allowlist'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'registration',
        '{"30000000-0000-4000-8000-000000000103":"1"}'::jsonb,
        '{"rules":{"30000000-0000-4000-8000-000000000103":{"schedule_config":{"anchor_key":"appointment_scheduled_at","lead_minutes":0,"timezone":"Asia/Seoul"}}}}'::jsonb,
        '30000000-0000-4000-8000-000000000331'
      )
    $sql$,
    'notification_patch_invalid'
  ),
  'settings save rejects a non-positive appointment reminder lead'
);

reset role;
update public.google_chat_webhook_settings
set last_error_code = 'transport_error'
where channel = 'admin';
select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        '{"30000000-0000-4000-8000-000000000101":"1"}'::jsonb,
        '{"rules":{"30000000-0000-4000-8000-000000000101":{"enabled":true}}}'::jsonb,
        '30000000-0000-4000-8000-000000000332'
      )
    $sql$,
    'notification_google_chat_connection_required'
  ),
  'disabled management Chat cannot be enabled while its locked connection is unhealthy'
);
reset role;
update public.google_chat_webhook_settings
set last_error_code = null
where channel = 'admin';
select ok(
  not exists (
    select 1
    from dashboard_private.notification_request_ledger
    where request_id in (
      '30000000-0000-4000-8000-000000000329',
      '30000000-0000-4000-8000-000000000330',
      '30000000-0000-4000-8000-000000000331',
      '30000000-0000-4000-8000-000000000332'
    )
  )
  and (
    select revision = 1 and not enabled
    from dashboard_private.notification_rules
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa106'
  )
  and (
    select revision = 1 and not enabled
    from dashboard_private.notification_rules
    where id = '30000000-0000-4000-8000-000000000103'
  ),
  'canonical UUID, template, schedule, and connection validation failures roll back every receipt and rule mutation'
);

select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;

reset role;
select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000002'
);
set local role authenticated;
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'settings-noop',
  public.save_notification_control_plane_v1(
    'tasks',
    '{}'::jsonb,
    '{"rules":{}}'::jsonb,
    '30000000-0000-4000-8000-000000000323'
  );

reset role;
select is(
  (
    select revision
    from dashboard_private.notification_rules
    where id = '30000000-0000-4000-8000-000000000101'
  ),
  1::bigint,
  'no-op save does not increment a rule revision'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_templates
    where rule_id in (
      '30000000-0000-4000-8000-000000000101',
      '30000000-0000-4000-8000-000000000102'
    )
  ),
  2::bigint,
  'no-op save does not create an immutable template version'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_rule_reconciliation_jobs
    where workflow_key = 'tasks'
      and created_at >= transaction_timestamp()
  ),
  0::bigint,
  'no-op save does not enqueue reconciliation'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_audit_logs
    where request_id = '30000000-0000-4000-8000-000000000323'
  ),
  0::bigint,
  'no-op save does not append mutation audit rows'
);

select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'settings-change-first',
  public.save_notification_control_plane_v1(
    'tasks',
    '{"30000000-0000-4000-8000-000000000101":"1"}'::jsonb,
    '{"rules":{"30000000-0000-4000-8000-000000000101":{"title_template":"변경된 제목","body_template":"변경된 본문"}}}'::jsonb,
    '30000000-0000-4000-8000-000000000324'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'settings-change-replay',
  public.save_notification_control_plane_v1(
    'tasks',
    '{"30000000-0000-4000-8000-000000000101":"1"}'::jsonb,
    '{"rules":{"30000000-0000-4000-8000-000000000101":{"title_template":"변경된 제목","body_template":"변경된 본문"}}}'::jsonb,
    '30000000-0000-4000-8000-000000000324'
  );
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'settings-change-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'settings-change-first'
  ),
  'same settings request replays its exact committed result'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        '{"30000000-0000-4000-8000-000000000101":"1"}'::jsonb,
        '{"rules":{"30000000-0000-4000-8000-000000000101":{"title_template":"다른 제목"}}}'::jsonb,
        '30000000-0000-4000-8000-000000000324'
      )
    $sql$,
    'idempotency_key_reused'
  ),
  'same settings request ID with a changed patch is rejected'
);

reset role;
select is(
  (
    select revision
    from dashboard_private.notification_rules
    where id = '30000000-0000-4000-8000-000000000101'
  ),
  2::bigint,
  'changed save increments its rule revision exactly once across replay'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_templates
    where rule_id = '30000000-0000-4000-8000-000000000101'
  ),
  2::bigint,
  'changed template content creates exactly one immutable version'
);
select ok(
  exists (
    select 1
    from dashboard_private.notification_templates template
    where template.rule_id = '30000000-0000-4000-8000-000000000101'
      and template.version = 2
      and template.title_template = '변경된 제목'
      and template.body_template = '변경된 본문'
      and template.created_by = '30000000-0000-4000-8000-000000000001'
      and template.created_actor_kind = 'user'
  ),
  'new immutable template records the authenticated actor'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_rule_reconciliation_jobs
    where workflow_key = 'tasks'
      and rule_revision_map ->> '30000000-0000-4000-8000-000000000101' = '2'
  ),
  1::bigint,
  'changed save enqueues one captured rule-reconciliation job'
);
select ok(
  exists (
    select 1
    from dashboard_private.notification_audit_logs audit
    where audit.request_id = '30000000-0000-4000-8000-000000000324'
      and audit.actor_profile_id = '30000000-0000-4000-8000-000000000001'
      and audit.actor_kind = 'user'
  ),
  'changed save appends an actor-bound audit row'
);
select ok(
  not exists (
    select 1
    from dashboard_private.notification_audit_logs audit
    where audit.request_id = '30000000-0000-4000-8000-000000000324'
      and concat_ws(' ', audit.before_summary::text, audit.after_summary::text)
        ~* 'rendered_body|target_snapshot|webhook|ciphertext|legacy-key|legacy-token'
  ),
  'settings audit summaries contain no rendered payload, target, or connection secret'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_request_ledger ledger
    where ledger.request_id = '30000000-0000-4000-8000-000000000324'
  ),
  1::bigint,
  'changed settings request has exactly one durable ledger row'
);

select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        '{"30000000-0000-4000-8000-000000000101":"1"}'::jsonb,
        '{"rules":{"30000000-0000-4000-8000-000000000101":{"enabled":true}}}'::jsonb,
        '30000000-0000-4000-8000-000000000325'
      )
    $sql$,
    'notification_revision_conflict'
  ),
  'stale expected revision is rejected'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        '{"30000000-0000-4000-8000-000000000101":"2","30000000-0000-4000-8000-000000000102":"99"}'::jsonb,
        '{"rules":{"30000000-0000-4000-8000-000000000101":{"enabled":true},"30000000-0000-4000-8000-000000000102":{"enabled":true}}}'::jsonb,
        '30000000-0000-4000-8000-000000000326'
      )
    $sql$,
    'notification_revision_conflict'
  ),
  'one stale revision rejects the whole multi-rule save'
);

reset role;
select ok(
  not (
    select enabled
    from dashboard_private.notification_rules
    where id = '30000000-0000-4000-8000-000000000101'
  )
  and not (
    select enabled
    from dashboard_private.notification_rules
    where id = '30000000-0000-4000-8000-000000000102'
  )
  and (
    select revision
    from dashboard_private.notification_rules
    where id = '30000000-0000-4000-8000-000000000101'
  ) = 2
  and (
    select revision
    from dashboard_private.notification_rules
    where id = '30000000-0000-4000-8000-000000000102'
  ) = 1,
  'revision conflict rolls back every rule/template/audit/job mutation atomically'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_request_ledger
    where request_id in (
      '30000000-0000-4000-8000-000000000325',
      '30000000-0000-4000-8000-000000000326'
    )
  ),
  0::bigint,
  'failed revision conflicts leave no committed request receipt'
);

select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000002'
);
set local role authenticated;
select lives_ok(
  $sql$
    select public.save_notification_control_plane_v1(
      'tasks',
      '{"30000000-0000-4000-8000-000000000102":"1"}'::jsonb,
      '{"rules":{"30000000-0000-4000-8000-000000000102":{"enabled":true}}}'::jsonb,
      '30000000-0000-4000-8000-000000000327'
    )
  $sql$,
  'staff can commit a valid explicit settings patch'
);

reset role;
update dashboard_private.notification_runtime_flags
set enabled = false,
    updated_by = null,
    updated_at = now()
where flag_key = 'notification_control_plane_settings_ui_enabled';
select pg_temp.notification_runtime_set_actor(
  '30000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.save_notification_control_plane_v1(
        'tasks',
        '{"30000000-0000-4000-8000-000000000101":"2"}'::jsonb,
        '{"rules":{"30000000-0000-4000-8000-000000000101":{"enabled":true}}}'::jsonb,
        '30000000-0000-4000-8000-000000000328'
      )
    $sql$,
    'notification_settings_ui_disabled'
  ),
  'save transaction rechecks a disabled UI flag instead of trusting an open panel'
);

-- The controlled backfill is a service-role-only compare-and-swap. It keeps
-- legacy plaintext readable, but never trusts a caller-provided fingerprint or
-- mask without recomputing both from the locked row.
reset role;
insert into public.google_chat_webhook_settings(
  channel,
  webhook_url,
  webhook_url_ciphertext,
  webhook_url_mask,
  connection_state,
  revision,
  updated_by,
  last_verified_at,
  last_error_code,
  created_at,
  updated_at
) values (
  'math',
  'https://chat.googleapis.com/v1/spaces/MATHBACKFILL123/messages?key=math-legacy-key&token=math-legacy-token',
  null,
  null,
  'legacy_active',
  41,
  '30000000-0000-4000-8000-000000000001',
  null,
  null,
  now(),
  now()
)
on conflict (channel) do update
set webhook_url = excluded.webhook_url,
    webhook_url_ciphertext = excluded.webhook_url_ciphertext,
    webhook_url_mask = excluded.webhook_url_mask,
    connection_state = excluded.connection_state,
    revision = excluded.revision,
    updated_by = excluded.updated_by,
    last_verified_at = excluded.last_verified_at,
    last_error_code = excluded.last_error_code,
    updated_at = excluded.updated_at;

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.backfill_google_chat_connection_encryption_v1(
        'math',
        41,
        '0000000000000000000000000000000000000000000000000000000000000000',
        'v1:backfill-iv:backfill-tag:backfill-ciphertext',
        'chat.googleapis.com/v1/spaces/MATH…L123/messages'
      )
    $sql$,
    'notification_connection_backfill_fingerprint_mismatch'
  ),
  'backfill rejects a stale or forged plaintext fingerprint'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.backfill_google_chat_connection_encryption_v1(
        'executive',
        9007199254740997,
        pg_catalog.encode(
          pg_catalog.sha256(
            pg_catalog.convert_to(
              'https://chat.googleapis.com/v1/spaces/EXECUTIVE/messages?key=legacy-executive&token=legacy-executive-token',
              'UTF8'
            )
          ),
          'hex'
        ),
        'v1:other-iv:other-tag:other-ciphertext',
        'chat.googleapis.com/v1/spaces/EXEC…TIVE/messages'
      )
    $sql$,
    'notification_connection_backfill_not_candidate'
  ),
  'backfill refuses a row that already contains ciphertext'
);

reset role;
select ok(
  (
    select connection_state = 'legacy_active'
      and revision = 41
      and webhook_url_ciphertext is null
      and webhook_url_mask is null
    from public.google_chat_webhook_settings
    where channel = 'math'
  )
  and (
    select connection_state = 'encrypted_active'
      and revision = 9007199254740997
      and webhook_url_ciphertext = 'v1:fixture-iv:fixture-tag:fixture-ciphertext'
    from public.google_chat_webhook_settings
    where channel = 'executive'
  ),
  'failed backfill preconditions leave both candidate and encrypted rows unchanged'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-backfill-first',
  public.backfill_google_chat_connection_encryption_v1(
    'math',
    41,
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          'https://chat.googleapis.com/v1/spaces/MATHBACKFILL123/messages?key=math-legacy-key&token=math-legacy-token',
          'UTF8'
        )
      ),
      'hex'
    ),
    'v1:backfill-iv:backfill-tag:backfill-ciphertext',
    'chat.googleapis.com/v1/spaces/MATH…L123/messages'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-backfill-replay',
  public.backfill_google_chat_connection_encryption_v1(
    'math',
    41,
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          'https://chat.googleapis.com/v1/spaces/MATHBACKFILL123/messages?key=math-legacy-key&token=math-legacy-token',
          'UTF8'
        )
      ),
      'hex'
    ),
    'v1:backfill-iv:backfill-tag:backfill-ciphertext',
    'chat.googleapis.com/v1/spaces/MATH…L123/messages'
  );

reset role;
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-backfill-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-backfill-first'
  ),
  'successful backfill replay returns the same safe response without another write'
);
select ok(
  (
    select connection_state = 'encrypted_active'
      and revision = 42
      and webhook_url = 'https://chat.googleapis.com/v1/spaces/MATHBACKFILL123/messages?key=math-legacy-key&token=math-legacy-token'
      and webhook_url_ciphertext = 'v1:backfill-iv:backfill-tag:backfill-ciphertext'
      and webhook_url_mask = 'chat.googleapis.com/v1/spaces/MATH…L123/messages'
      and updated_by = '30000000-0000-4000-8000-000000000001'
    from public.google_chat_webhook_settings
    where channel = 'math'
  ),
  'backfill changes only encrypted metadata/state/revision and preserves the legacy reader'
);
select ok(
  (
    select payload ->> 'connection_key' = 'google_chat.math'
      and payload ->> 'connection_state' = 'encrypted_active'
      and payload ->> 'revision' = '42'
      and payload ->> 'webhook_url_mask' = 'chat.googleapis.com/v1/spaces/MATH…L123/messages'
      and payload::text
        !~* 'math-legacy-key|math-legacy-token|backfill-ciphertext|webhook_url_ciphertext|https://chat[.]googleapis[.]com'
    from notification_control_plane_runtime_results
    where result_key = 'connection-backfill-first'
  ),
  'backfill response exposes only safe masked metadata'
);
select ok(
  (
    select count(*) = 1
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind = 'google_chat_connection'
      and audit.entity_id = 'google_chat.math'
      and audit.action = 'connection_encryption_backfilled'
  )
  and not exists (
    select 1
    from dashboard_private.notification_audit_logs audit
    where audit.entity_kind = 'google_chat_connection'
      and audit.entity_id = 'google_chat.math'
      and concat_ws(' ', audit.before_summary::text, audit.after_summary::text)
        ~* 'math-legacy-key|math-legacy-token|backfill-ciphertext|webhook_url|ciphertext'
  ),
  'backfill replay creates one state-only audit row with no secret material'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.record_google_chat_connection_verification_v1(
        '30000000-0000-4000-8000-000000000001',
        'math',
        true,
        'configuration_error',
        42,
        '30000000-0000-4000-8000-000000000411'
      )
    $sql$,
    'notification_connection_result_invalid'
  ),
  'configuration_error is accepted only as a failed verification result'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-configuration-error-begin',
  public.begin_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'math',
    42,
    '30000000-0000-4000-8000-000000000410'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-configuration-error-record',
  public.record_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'math',
    false,
    'configuration_error',
    42,
    '30000000-0000-4000-8000-000000000410'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-configuration-error-record-replay',
  public.record_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'math',
    false,
    'configuration_error',
    42,
    '30000000-0000-4000-8000-000000000410'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-configuration-error-begin-completed-replay',
  public.begin_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'math',
    42,
    '30000000-0000-4000-8000-000000000410'
  );
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-configuration-error-record-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-configuration-error-record'
  ),
  'configuration-error verification completion is exactly idempotent'
);
select ok(
  (
    select (payload ->> 'should_send')::boolean
      and not (payload ->> 'pending')::boolean
      and payload -> 'connection' = 'null'::jsonb
    from notification_control_plane_runtime_results
    where result_key = 'connection-configuration-error-begin'
  )
  and (
    select not (payload ->> 'should_send')::boolean
      and not (payload ->> 'pending')::boolean
      and payload #>> '{connection,connection_state}' = 'encrypted_active'
      and payload #>> '{connection,revision}' = '43'
      and payload #>> '{connection,last_error_code}' = 'configuration_error'
      and payload::text
        !~* 'math-legacy-key|math-legacy-token|backfill-ciphertext|webhook_url_ciphertext|https://chat[.]googleapis[.]com'
    from notification_control_plane_runtime_results
    where result_key = 'connection-configuration-error-begin-completed-replay'
  ),
  'configuration error completes the reservation and later begin replay never resends or leaks secrets'
);

reset role;
select ok(
  (
    select connection_state = 'encrypted_active'
      and revision = 43
      and last_verified_at is not null
      and last_error_code = 'configuration_error'
    from public.google_chat_webhook_settings
    where channel = 'math'
  )
  and (
    select response_payload ->> 'state' = 'completed'
      and response_payload ->> 'succeeded' = 'false'
      and response_payload ->> 'result_code' = 'configuration_error'
    from dashboard_private.notification_request_ledger
    where request_id = '30000000-0000-4000-8000-000000000410'
  ),
  'configuration error persists only normalized failure metadata in one completed ledger row'
);

-- Atomic connection mutations. Staff may inspect masked metadata through the
-- settings snapshot but every replace/verify/disconnect mutation is admin-only.
reset role;
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.replace_google_chat_connection_v1(
        '30000000-0000-4000-8000-000000000002',
        'admin',
        'https://chat.googleapis.com/v1/spaces/REPLACED/messages?key=new-key&token=new-token',
        'v1:new-iv:new-tag:new-ciphertext',
        'chat.googleapis.com/v1/spaces/…/messages',
        9007199254740997,
        '30000000-0000-4000-8000-000000000401'
      )
    $sql$,
    'notification_access_denied'
  ),
  'staff cannot replace a Google Chat connection'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.disconnect_google_chat_connection_v1(
        '30000000-0000-4000-8000-000000000002',
        'admin',
        9007199254740997,
        '30000000-0000-4000-8000-000000000402'
      )
    $sql$,
    'notification_access_denied'
  ),
  'staff cannot disconnect a Google Chat connection'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.begin_google_chat_connection_verification_v1(
        '30000000-0000-4000-8000-000000000002',
        'executive',
        9007199254740997,
        '30000000-0000-4000-8000-000000000403'
      )
    $sql$,
    'notification_access_denied'
  ),
  'staff cannot reserve a Google Chat provider verification'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.record_google_chat_connection_verification_v1(
        '30000000-0000-4000-8000-000000000002',
        'executive',
        true,
        'accepted',
        9007199254740997,
        '30000000-0000-4000-8000-000000000409'
      )
    $sql$,
    'notification_access_denied'
  ),
  'staff cannot record a connection verification result'
);

reset role;
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.record_google_chat_connection_verification_v1(
        '30000000-0000-4000-8000-000000000001',
        'executive',
        true,
        'accepted',
        9007199254740997,
        '30000000-0000-4000-8000-000000000409'
      )
    $sql$,
    'notification_connection_verification_not_reserved'
  ),
  'verification result cannot be finalized without an atomic reservation'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-verify-begin-first',
  public.begin_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'executive',
    9007199254740997,
    '30000000-0000-4000-8000-000000000408'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-verify-begin-pending-replay',
  public.begin_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'executive',
    9007199254740997,
    '30000000-0000-4000-8000-000000000408'
  );
select ok(
  (
    select (payload ->> 'should_send')::boolean
      and not (payload ->> 'pending')::boolean
      and not (payload ?| array[
        'webhook_url',
        'webhook_url_ciphertext',
        'webhookUrl',
        'webhookUrlCiphertext',
        'row'
      ])
      and payload::text !~* 'https://chat\.googleapis\.com|key-secret|token-secret|legacy-key|legacy-token|fixture-ciphertext'
    from notification_control_plane_runtime_results
    where result_key = 'connection-verify-begin-first'
  ),
  'first verification reservation permits one provider send without returning connection secrets'
);
select ok(
  (
    select not (payload ->> 'should_send')::boolean
      and (payload ->> 'pending')::boolean
      and not (payload ?| array[
        'webhook_url',
        'webhook_url_ciphertext',
        'webhookUrl',
        'webhookUrlCiphertext',
        'row'
      ])
      and payload::text !~* 'https://chat\.googleapis\.com|key-secret|token-secret|legacy-key|legacy-token|fixture-ciphertext'
    from notification_control_plane_runtime_results
    where result_key = 'connection-verify-begin-pending-replay'
  ),
  'concurrent verification replay stays pending and cannot trigger a second provider send'
);
select ok(
  (
    select response_payload ->> 'state' = 'reserved'
      and response_payload ->> 'actor' = '30000000-0000-4000-8000-000000000001'
      and response_payload ->> 'channel' = 'executive'
      and response_payload ->> 'revision' = '9007199254740997'
      and (response_payload ->> 'reserved_at')::timestamp with time zone
        < (response_payload ->> 'expires_at')::timestamp with time zone
      and (response_payload ->> 'expires_at')::timestamp with time zone
        - (response_payload ->> 'reserved_at')::timestamp with time zone
        = interval '2 minutes'
      and response_payload::text
        !~* 'https://chat[.]googleapis[.]com|key-secret|token-secret|legacy-key|legacy-token|fixture-ciphertext|webhook_url'
    from dashboard_private.notification_request_ledger
    where request_id = '30000000-0000-4000-8000-000000000408'
  ),
  'verification reservation ledger records bounded actor, channel, revision, and two-minute expiry metadata without secrets'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-replace-first',
  public.replace_google_chat_connection_v1(
    '30000000-0000-4000-8000-000000000001',
    'admin',
    'https://chat.googleapis.com/v1/spaces/REPLACED/messages?key=new-key&token=new-token',
    'v1:new-iv:new-tag:new-ciphertext',
    'chat.googleapis.com/v1/spaces/…/messages',
    9007199254740997,
    '30000000-0000-4000-8000-000000000404'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-replace-replay',
  public.replace_google_chat_connection_v1(
    '30000000-0000-4000-8000-000000000001',
    'admin',
    'https://chat.googleapis.com/v1/spaces/REPLACED/messages?key=new-key&token=new-token',
    'v1:retry-iv:retry-tag:retry-ciphertext',
    'chat.googleapis.com/v1/spaces/…/messages',
    9007199254740997,
    '30000000-0000-4000-8000-000000000404'
  );
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-replace-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-replace-first'
  ),
  'connection replace replays the exact committed response despite a fresh randomized envelope'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.replace_google_chat_connection_v1(
        '30000000-0000-4000-8000-000000000001',
        'admin',
        'https://chat.googleapis.com/v1/spaces/REPLACED/messages?key=new-key&token=changed-token',
        'v1:different-iv:different-tag:different-ciphertext',
        'chat.googleapis.com/v1/spaces/…/messages',
        9007199254740997,
        '30000000-0000-4000-8000-000000000404'
      )
    $sql$,
    'idempotency_key_reused'
  ),
  'connection request ID cannot be reused for a different logical webhook URL'
);

reset role;
select ok(
  (
    select connection_state = 'encrypted_active'
      and webhook_url = 'https://chat.googleapis.com/v1/spaces/REPLACED/messages?key=new-key&token=new-token'
      and webhook_url_ciphertext = 'v1:new-iv:new-tag:new-ciphertext'
      and webhook_url_mask = 'chat.googleapis.com/v1/spaces/…/messages'
      and revision = 9007199254740998
      and updated_by = '30000000-0000-4000-8000-000000000001'
    from public.google_chat_webhook_settings
    where channel = 'admin'
  ),
  'replace atomically dual-writes current legacy plaintext and encrypted metadata'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_audit_logs
    where request_id = '30000000-0000-4000-8000-000000000404'
  ),
  1::bigint,
  'connection replace commits exactly one audit row across replay'
);
select ok(
  (
    select payload ->> 'revision' = '9007199254740998'
      and payload ->> 'connection_state' = 'encrypted_active'
      and payload ->> 'connection_key' = 'google_chat.management'
      and payload ->> 'webhook_url_mask' = 'chat.googleapis.com/v1/spaces/…/messages'
      and payload::text !~ 'new-key|new-token|new-ciphertext|webhook_url_ciphertext'
    from notification_control_plane_runtime_results
    where result_key = 'connection-replace-first'
  ),
  'connection replace returns masked metadata and decimal-string revision only'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.replace_google_chat_connection_v1(
        '30000000-0000-4000-8000-000000000001',
        'admin',
        'https://chat.googleapis.com/v1/spaces/STALE/messages?key=stale&token=stale',
        'v1:stale-iv:stale-tag:stale-ciphertext',
        'chat.googleapis.com/v1/spaces/…/messages',
        9007199254740997,
        '30000000-0000-4000-8000-000000000405'
      )
    $sql$,
    'notification_connection_revision_conflict'
  ),
  'connection replace rejects a stale expected revision'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.replace_google_chat_connection_v1(
        '30000000-0000-4000-8000-000000000001',
        'unknown',
        'https://chat.googleapis.com/v1/spaces/UNKNOWN/messages?key=x&token=y',
        'v1:x:y:z',
        'chat.googleapis.com/v1/spaces/…/messages',
        1,
        '30000000-0000-4000-8000-000000000406'
      )
    $sql$,
    'notification_connection_unknown'
  ),
  'connection mutation rejects arbitrary legacy channel keys'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-disconnect',
  public.disconnect_google_chat_connection_v1(
    '30000000-0000-4000-8000-000000000001',
    'admin',
    9007199254740998,
    '30000000-0000-4000-8000-000000000407'
  );

reset role;
select ok(
  (
    select connection_state = 'disconnected'
      and webhook_url = ''
      and webhook_url_ciphertext is null
      and webhook_url_mask is null
      and revision = 9007199254740999
    from public.google_chat_webhook_settings
    where channel = 'admin'
  ),
  'disconnect atomically clears ciphertext and blanks NOT NULL legacy plaintext'
);
select ok(
  (
    select payload ->> 'connection_state' = 'disconnected'
      and (payload ->> 'configured')::boolean = false
      and payload ->> 'revision' = '9007199254740999'
      and payload::text !~ 'new-key|new-token|new-ciphertext|webhook_url_ciphertext'
    from notification_control_plane_runtime_results
    where result_key = 'connection-disconnect'
  ),
  'disconnect response cannot reactivate or disclose residual plaintext'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-verify-first',
  public.record_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'executive',
    true,
    'accepted',
    9007199254740997,
    '30000000-0000-4000-8000-000000000408'
  );
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-verify-replay',
  public.record_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'executive',
    true,
    'accepted',
    9007199254740997,
    '30000000-0000-4000-8000-000000000408'
  );
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-verify-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-verify-first'
  ),
  'verification result write is request-ledger idempotent'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select
  'connection-verify-begin-completed-replay',
  public.begin_google_chat_connection_verification_v1(
    '30000000-0000-4000-8000-000000000001',
    'executive',
    9007199254740997,
    '30000000-0000-4000-8000-000000000408'
  );
select ok(
  (
    select not (payload ->> 'should_send')::boolean
      and not (payload ->> 'pending')::boolean
      and payload #>> '{connection,connection_state}' = 'encrypted_active'
      and payload #>> '{connection,revision}' = '9007199254740998'
      and not (payload ?| array[
        'webhook_url',
        'webhook_url_ciphertext',
        'webhookUrl',
        'webhookUrlCiphertext',
        'row'
      ])
      and not ((payload -> 'connection') ?| array[
        'webhook_url',
        'webhook_url_ciphertext',
        'webhookUrl',
        'webhookUrlCiphertext',
        'row'
      ])
      and payload::text !~* 'https://chat\.googleapis\.com|key-secret|token-secret|legacy-key|legacy-token|fixture-ciphertext'
    from notification_control_plane_runtime_results
    where result_key = 'connection-verify-begin-completed-replay'
  ),
  'completed verification replay returns only a safe connection DTO and never resends'
);
select ok(
  pg_temp.notification_runtime_throws(
    $sql$
      select public.begin_google_chat_connection_verification_v1(
        '30000000-0000-4000-8000-000000000001',
        'executive',
        9007199254740998,
        '30000000-0000-4000-8000-000000000408'
      )
    $sql$,
    'idempotency_key_reused'
  ),
  'verification request ID cannot be replayed with a changed expected revision'
);

reset role;
select ok(
  (
    select last_verified_at is not null
      and last_error_code is null
      and revision = 9007199254740998
    from public.google_chat_webhook_settings
    where channel = 'executive'
  ),
  'successful verification stores only normalized time/result metadata'
);
select ok(
  not exists (
    select 1
    from dashboard_private.notification_audit_logs audit
    where audit.request_id in (
      '30000000-0000-4000-8000-000000000404',
      '30000000-0000-4000-8000-000000000407',
      '30000000-0000-4000-8000-000000000408'
    )
      and concat_ws(' ', audit.before_summary::text, audit.after_summary::text)
        ~* 'new-key|new-token|new-ciphertext|legacy-key|legacy-token|fixture-ciphertext|webhook_url|ciphertext'
  ),
  'connection audit summaries contain state/revision only and no secret material'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_request_ledger
    where request_id in (
      '30000000-0000-4000-8000-000000000404',
      '30000000-0000-4000-8000-000000000407',
      '30000000-0000-4000-8000-000000000408'
    )
  ),
  3::bigint,
  'replace, disconnect, and verification each commit one durable request receipt'
);
select is(
  (
    select count(*)
    from dashboard_private.notification_request_ledger
    where request_id in (
      '30000000-0000-4000-8000-000000000405',
      '30000000-0000-4000-8000-000000000406',
      '30000000-0000-4000-8000-000000000409'
    )
  ),
  0::bigint,
  'failed connection mutations commit neither ledger nor audit side effects'
);

-- A crashed provider call cannot strand a reservation forever. The next begin
-- replay expires it, and late record replays return one stable terminal envelope
-- without touching the current connection.
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-expiry-begin', public.begin_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  8,
  '30000000-0000-4000-8000-000000000420'
);
reset role;
update dashboard_private.notification_request_ledger
set response_payload = pg_catalog.jsonb_set(
  response_payload,
  '{expires_at}',
  pg_catalog.to_jsonb(pg_catalog.clock_timestamp() - interval '1 second')
)
where request_id = '30000000-0000-4000-8000-000000000420';

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-expiry-begin-terminal', public.begin_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  8,
  '30000000-0000-4000-8000-000000000420'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-expiry-begin-replay', public.begin_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  8,
  '30000000-0000-4000-8000-000000000420'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-expiry-record-terminal', public.record_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  true,
  'accepted',
  8,
  '30000000-0000-4000-8000-000000000420'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-expiry-record-replay', public.record_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  true,
  'accepted',
  8,
  '30000000-0000-4000-8000-000000000420'
);
reset role;
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-expiry-begin-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-expiry-begin-terminal'
  ),
  'expired begin replay returns the same terminal envelope and never sends again'
);
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-expiry-record-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-expiry-record-terminal'
  ),
  'late verification record replay returns the same expired terminal envelope'
);
select ok(
  (
    select not (payload ->> 'should_send')::boolean
      and not (payload ->> 'pending')::boolean
      and payload ->> 'terminal_code' = 'verification_expired'
      and payload #>> '{connection,revision}' = '8'
    from notification_control_plane_runtime_results
    where result_key = 'connection-expiry-begin-terminal'
  )
  and (
    select payload ->> 'terminal_code' = 'verification_expired'
      and payload #>> '{connection,revision}' = '8'
      and payload::text !~* 'english-key|english-token|english-ciphertext|webhook_url'
    from notification_control_plane_runtime_results
    where result_key = 'connection-expiry-record-terminal'
  )
  and (
    select revision = 8 and last_verified_at is null and last_error_code is null
    from public.google_chat_webhook_settings
    where channel = 'english'
  )
  and (
    select response_payload ->> 'state' = 'expired'
      and response_payload ->> 'terminal_code' = 'verification_expired'
      and response_payload ->> 'attempted_result_code' = 'accepted'
    from dashboard_private.notification_request_ledger
    where request_id = '30000000-0000-4000-8000-000000000420'
  ),
  'crash expiry closes the ledger terminally while leaving the current connection unchanged and secret-free'
);

-- If the connection changes after the provider call, record owns only the
-- reservation ledger. It must not overwrite the newer connection row.
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-superseded-begin', public.begin_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  8,
  '30000000-0000-4000-8000-000000000421'
);
reset role;
update public.google_chat_webhook_settings
set revision = 9,
    updated_at = pg_catalog.clock_timestamp()
where channel = 'english';

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-superseded-record', public.record_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  true,
  'accepted',
  8,
  '30000000-0000-4000-8000-000000000421'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-superseded-record-replay', public.record_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  true,
  'accepted',
  8,
  '30000000-0000-4000-8000-000000000421'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-superseded-begin-replay', public.begin_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  8,
  '30000000-0000-4000-8000-000000000421'
);
reset role;
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-superseded-record-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-superseded-record'
  ),
  'superseded verification record replay returns the exact terminal envelope'
);
select ok(
  (
    select payload ->> 'terminal_code' = 'verification_superseded'
      and payload #>> '{connection,revision}' = '9'
    from notification_control_plane_runtime_results
    where result_key = 'connection-superseded-record'
  )
  and (
    select not (payload ->> 'should_send')::boolean
      and not (payload ->> 'pending')::boolean
      and payload ->> 'terminal_code' = 'verification_superseded'
      and payload #>> '{connection,revision}' = '9'
    from notification_control_plane_runtime_results
    where result_key = 'connection-superseded-begin-replay'
  )
  and (
    select revision = 9 and last_verified_at is null and last_error_code is null
    from public.google_chat_webhook_settings
    where channel = 'english'
  )
  and (
    select response_payload ->> 'state' = 'superseded'
      and response_payload ->> 'terminal_reason' = 'connection_revision_changed'
      and response_payload ->> 'current_revision' = '9'
    from dashboard_private.notification_request_ledger
    where request_id = '30000000-0000-4000-8000-000000000421'
  ),
  'superseded verification closes only its reservation and preserves the newer connection row'
);

-- A begin reservation is the capability to finish the provider call. Actor
-- demotion after begin cannot strand a reserved ledger entry.
select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-demotion-begin', public.begin_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  9,
  '30000000-0000-4000-8000-000000000422'
);
reset role;
update public.profiles
set role = 'staff'
where id = '30000000-0000-4000-8000-000000000001';

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-demotion-record', public.record_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  true,
  'accepted',
  9,
  '30000000-0000-4000-8000-000000000422'
);
insert into notification_control_plane_runtime_results(result_key, payload)
select 'connection-demotion-record-replay', public.record_google_chat_connection_verification_v1(
  '30000000-0000-4000-8000-000000000001',
  'english',
  true,
  'accepted',
  9,
  '30000000-0000-4000-8000-000000000422'
);
reset role;
select is(
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-demotion-record-replay'
  ),
  (
    select payload
    from notification_control_plane_runtime_results
    where result_key = 'connection-demotion-record'
  ),
  'matching reservation actor can replay completion after administrator demotion'
);
select ok(
  (
    select revision = 10
      and last_verified_at is not null
      and last_error_code is null
      and updated_by = '30000000-0000-4000-8000-000000000001'
    from public.google_chat_webhook_settings
    where channel = 'english'
  )
  and (
    select response_payload ->> 'state' = 'completed'
      and response_payload ->> 'actor' = '30000000-0000-4000-8000-000000000001'
      and response_payload ->> 'result_code' = 'accepted'
    from dashboard_private.notification_request_ledger
    where request_id = '30000000-0000-4000-8000-000000000422'
  )
  and (
    select payload ->> 'revision' = '10'
      and payload ->> 'last_error_code' is null
      and payload::text !~* 'english-key|english-token|english-ciphertext|webhook_url'
    from notification_control_plane_runtime_results
    where result_key = 'connection-demotion-record'
  ),
  'demotion race completes the reservation normally instead of leaving permanent pending state'
);
update public.profiles
set role = 'admin'
where id = '30000000-0000-4000-8000-000000000001';

select * from finish();
rollback;
