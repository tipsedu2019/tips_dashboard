begin;

select plan(20);

set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set constraints all deferred;

select has_function(
  'dashboard_private',
  'mirror_makeup_notification_template_v1',
  array['uuid', 'uuid', 'uuid'],
  'canonical template을 legacy 호환 행에 mirror하는 private 함수가 있다'
);
select has_function(
  'public',
  'save_notification_control_plane_v2',
  array['text', 'jsonb', 'jsonb', 'jsonb', 'uuid'],
  '공통 v2 저장 command가 유지된다'
);
select has_function(
  'dashboard_private',
  'notification_makeup_payload_v1',
  array['uuid', 'uuid', 'text'],
  '휴보강 source payload snapshot 함수가 유지된다'
);
select ok(
  pg_catalog.has_table_privilege(
    'authenticated', 'public.makeup_notification_settings', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'public.makeup_notification_settings', 'INSERT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'public.makeup_notification_settings', 'UPDATE'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'public.makeup_notification_settings', 'DELETE'
  ),
  'legacy sender 읽기는 유지하고 authenticated direct writer 권한은 닫는다'
);
select hasnt_trigger(
  'public',
  'makeup_notification_settings',
  'reconcile_makeup_notification_settings_after_write_v1',
  'legacy 변경을 canonical로 올리는 trigger는 제거된다'
);

create or replace function pg_temp.makeup_single_writer_set_actor(p_actor uuid)
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
        select profile.email from public.profiles profile where profile.id = p_actor
      )
    )::text,
    true
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '31500000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'notification-makeup-writer@runtime.invalid',
  crypt('notification-makeup-writer-only', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"fixture":"notification-makeup-single-writer"}'::jsonb,
  now(),
  now()
)
on conflict (id) do update
set email = excluded.email,
    updated_at = excluded.updated_at;

insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  '31500000-0000-4000-8000-000000000001',
  'admin',
  '휴보강 알림 관리자',
  'notification-makeup-writer@runtime.invalid',
  now(),
  now()
)
on conflict (id) do update
set role = excluded.role,
    name = excluded.name,
    email = excluded.email,
    updated_at = excluded.updated_at;

create temporary table makeup_single_writer_fixture on commit drop as
select
  rule_row.id as rule_id,
  rule_row.revision as initial_revision,
  rule_row.enabled as initial_enabled,
  rule_row.active_template_id as initial_template_id,
  contract_row.contract_version,
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_templates template_count
    where template_count.rule_id = rule_row.id
  ) as initial_template_count,
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_dispatch_ownership_claims claim
    where claim.workflow_key = 'makeup_requests'
  ) as initial_ownership_count
from dashboard_private.notification_rules rule_row
join dashboard_private.notification_settings_ui_registry registry
  on registry.rule_id = rule_row.id
join dashboard_private.notification_rule_content_contracts contract_row
  on contract_row.rule_id = rule_row.id
where registry.workflow_key = 'makeup_requests'
  and registry.event_key = 'makeup.submitted'
  and registry.audience_key = 'subject_team'
  and registry.channel_key = 'google_chat'
limit 1;

create temporary table makeup_single_writer_original_template on commit drop as
select template_row.*
from dashboard_private.notification_templates template_row
join makeup_single_writer_fixture fixture
  on fixture.initial_template_id = template_row.id;

grant select on makeup_single_writer_fixture to authenticated;
grant execute on function pg_temp.makeup_single_writer_set_actor(uuid) to authenticated;

update dashboard_private.notification_runtime_flags
set enabled = true
where flag_key = 'notification_control_plane_settings_ui_enabled';

select pg_temp.makeup_single_writer_set_actor('31500000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$
    update public.makeup_notification_settings
    set title_template = '직접 수정'
    where trigger_kind = 'submitted'
      and channel = 'dashboard_personal'
  $$,
  '42501',
  'permission denied for table makeup_notification_settings',
  'authenticated direct UPDATE는 권한 경계에서 실패한다'
);
select throws_ok(
  $$
    insert into public.makeup_notification_settings(
      trigger_kind, channel, enabled, title_template, body_template
    ) values (
      'submitted', 'dashboard_personal', true, '직접 추가', '직접 추가'
    )
  $$,
  '42501',
  'permission denied for table makeup_notification_settings',
  'authenticated direct INSERT도 권한 경계에서 실패한다'
);

select lives_ok(
  format(
    $sql$
      select public.save_notification_control_plane_v2(
        'makeup_requests', %L::jsonb, %L::jsonb, %L::jsonb,
        '31500000-0000-4000-8000-000000000101'
      )
    $sql$,
    pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.initial_revision::text)::text,
    pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.contract_version)::text,
    pg_catalog.jsonb_build_object(
      'rules',
      pg_catalog.jsonb_build_object(
        fixture.rule_id::text,
        pg_catalog.jsonb_build_object(
          'title_template', '📥 [휴보강] {class_name} {subjects} 휴보강 신청이 들어왔어요',
          'body_template', '[수업] {teacher_name}' || chr(10)
            || '[일정] {cancellation_date} → {makeup_schedule}' || chr(10)
            || '[장소] {place}' || chr(10)
            || '[진행] {progress_actor}의 결재를 기다리고 있어요.'
        )
      )
    )::text
  ),
  '공통 v2 content 저장이 성공한다'
)
from makeup_single_writer_fixture fixture;
reset role;

select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_templates template_row,
         makeup_single_writer_fixture fixture
    where template_row.rule_id = fixture.rule_id
  ),
  (
    select initial_template_count + 1 from makeup_single_writer_fixture
  ),
  'content 변경은 canonical template version을 정확히 하나 추가한다'
);
select ok(
  (
    select rule_row.active_template_id <> fixture.initial_template_id
      and rule_row.revision = fixture.initial_revision + 1
    from dashboard_private.notification_rules rule_row
    join makeup_single_writer_fixture fixture on fixture.rule_id = rule_row.id
  ),
  'canonical active pointer와 revision이 함께 이동한다'
);
select is_empty($$
  select legacy_setting.trigger_kind, legacy_setting.channel
  from public.makeup_notification_settings legacy_setting
  join dashboard_private.notification_settings_import_metadata metadata
    on metadata.source_key = 'makeup_notification_settings:'
      || legacy_setting.trigger_kind || ':' || legacy_setting.channel
  join makeup_single_writer_fixture fixture
    on metadata.mapped_rule_ids @> pg_catalog.jsonb_build_array(fixture.rule_id)
  join dashboard_private.notification_rules rule_row on rule_row.id = fixture.rule_id
  join dashboard_private.notification_templates template_row
    on template_row.id = rule_row.active_template_id
  where legacy_setting.title_template is distinct from template_row.title_template
    or legacy_setting.body_template is distinct from template_row.body_template
$$, '새 active template은 해당 rule에 매핑된 모든 legacy 행에 mirror된다');
select is_empty($$
  select legacy_setting.trigger_kind, legacy_setting.channel
  from public.makeup_notification_settings legacy_setting
  join dashboard_private.notification_settings_import_metadata metadata
    on metadata.source_key = 'makeup_notification_settings:'
      || legacy_setting.trigger_kind || ':' || legacy_setting.channel
  join makeup_single_writer_fixture fixture
    on metadata.mapped_rule_ids @> pg_catalog.jsonb_build_array(fixture.rule_id)
  where legacy_setting.enabled is distinct from fixture.initial_enabled
$$, 'content-only 저장은 canonical과 legacy enabled 값을 바꾸지 않는다');
select is_empty($$
  select metadata.source_key
  from dashboard_private.notification_settings_import_metadata metadata
  join public.makeup_notification_settings legacy_setting
    on metadata.source_key = 'makeup_notification_settings:'
      || legacy_setting.trigger_kind || ':' || legacy_setting.channel
  join makeup_single_writer_fixture fixture
    on metadata.mapped_rule_ids @> pg_catalog.jsonb_build_array(fixture.rule_id)
  where metadata.source_checksum is distinct from
    dashboard_private.notification_makeup_setting_checksum_v1(
      legacy_setting.trigger_kind,
      legacy_setting.channel,
      legacy_setting.enabled,
      legacy_setting.title_template,
      legacy_setting.body_template
    )
$$, 'legacy mirror 뒤 metadata checksum도 같은 transaction에서 갱신된다');
select ok(
  exists (
    select 1
    from dashboard_private.notification_audit_logs audit
    join makeup_single_writer_fixture fixture on audit.entity_id = fixture.rule_id::text
    where audit.request_id = '31500000-0000-4000-8000-000000000101'
      and audit.action = 'settings_updated'
      and audit.reason_code = 'operator_settings_save_v2'
  ),
  'canonical v2 audit가 같은 request ID로 남는다'
);
select is_empty($$
  select original.id
  from makeup_single_writer_original_template original
  join dashboard_private.notification_templates current on current.id = original.id
  where pg_catalog.to_jsonb(current) is distinct from pg_catalog.to_jsonb(original)
$$, '기존 template version은 byte-for-byte 불변이다');
select is(
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_dispatch_ownership_claims claim
    where claim.workflow_key = 'makeup_requests'
  ),
  (
    select initial_ownership_count from makeup_single_writer_fixture
  ),
  'content 저장은 dispatch ownership을 바꾸지 않는다'
);

create or replace function pg_temp.makeup_single_writer_force_mirror_failure()
returns trigger
language plpgsql
as $$
begin
  if new.title_template like '%미러 실패%' then
    raise exception 'makeup_mirror_test_failure' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger zz_makeup_single_writer_force_mirror_failure
before update on public.makeup_notification_settings
for each row execute function pg_temp.makeup_single_writer_force_mirror_failure();

create temporary table makeup_single_writer_before_failure on commit drop as
select
  rule_row.active_template_id,
  rule_row.revision,
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_templates template_row
    where template_row.rule_id = rule_row.id
  ) as template_count,
  (
    select pg_catalog.count(*)
    from dashboard_private.notification_audit_logs audit
    where audit.entity_id = rule_row.id::text
  ) as audit_count
from dashboard_private.notification_rules rule_row
join makeup_single_writer_fixture fixture on fixture.rule_id = rule_row.id;
grant select on makeup_single_writer_before_failure to authenticated;

select pg_temp.makeup_single_writer_set_actor('31500000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format(
    $sql$
      select public.save_notification_control_plane_v2(
        'makeup_requests', %L::jsonb, %L::jsonb, %L::jsonb,
        '31500000-0000-4000-8000-000000000102'
      )
    $sql$,
    pg_catalog.jsonb_build_object(fixture.rule_id::text, rule_row.revision::text)::text,
    pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.contract_version)::text,
    pg_catalog.jsonb_build_object(
      'rules',
      pg_catalog.jsonb_build_object(
        fixture.rule_id::text,
        pg_catalog.jsonb_build_object(
          'title_template', '미러 실패 {class_name} {subjects}',
          'body_template', '[수업] {teacher_name}' || chr(10)
            || '[일정] {cancellation_date} → {makeup_schedule}' || chr(10)
            || '[장소] {place}' || chr(10)
            || '[진행] {progress_actor}의 결재를 기다리고 있어요.'
        )
      )
    )::text
  ),
  '55000',
  'makeup_mirror_test_failure',
  'legacy mirror 실패는 v2 저장 전체를 실패시킨다'
)
from makeup_single_writer_fixture fixture
join dashboard_private.notification_rules rule_row on rule_row.id = fixture.rule_id;
reset role;

select is_empty($$
  select rule_row.id
  from dashboard_private.notification_rules rule_row
  join makeup_single_writer_fixture fixture on fixture.rule_id = rule_row.id
  cross join makeup_single_writer_before_failure before_failure
  where row(
    rule_row.active_template_id,
    rule_row.revision,
    (select pg_catalog.count(*) from dashboard_private.notification_templates t where t.rule_id = rule_row.id),
    (select pg_catalog.count(*) from dashboard_private.notification_audit_logs a where a.entity_id = rule_row.id::text)
  ) is distinct from row(
    before_failure.active_template_id,
    before_failure.revision,
    before_failure.template_count,
    before_failure.audit_count
  )
$$, 'mirror 실패 시 canonical template/pointer/revision/audit가 모두 rollback된다');
select is_empty($$
  select metadata.source_key
  from dashboard_private.notification_settings_import_metadata metadata
  join public.makeup_notification_settings legacy_setting
    on metadata.source_key = 'makeup_notification_settings:'
      || legacy_setting.trigger_kind || ':' || legacy_setting.channel
  join makeup_single_writer_fixture fixture
    on metadata.mapped_rule_ids @> pg_catalog.jsonb_build_array(fixture.rule_id)
  where metadata.source_checksum is distinct from
    dashboard_private.notification_makeup_setting_checksum_v1(
      legacy_setting.trigger_kind,
      legacy_setting.channel,
      legacy_setting.enabled,
      legacy_setting.title_template,
      legacy_setting.body_template
    )
$$, 'rollback 뒤 legacy와 metadata checksum도 일치한다');

drop trigger zz_makeup_single_writer_force_mirror_failure
  on public.makeup_notification_settings;

select is(
  (
    select flag_row.enabled
    from dashboard_private.notification_runtime_flags flag_row
    where flag_row.flag_key = 'notification_control_plane_dispatch_makeup_requests_enabled'
  ),
  false,
  'content 저장은 makeup canonical dispatch를 활성화하지 않는다'
);

select * from finish();
rollback;
