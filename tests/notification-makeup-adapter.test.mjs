import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260716192000_notification_makeup_adapter.sql",
  import.meta.url,
)
const assistantPermissionsMigrationUrl = new URL(
  "../supabase/migrations/20260721093604_assistant_word_retest_makeup_permissions.sql",
  import.meta.url,
)
const pgTapUrl = new URL(
  "../supabase/tests/notification_makeup_adapter_test.sql",
  import.meta.url,
)
const routeUrl = new URL(
  "../src/app/api/notifications/legacy/makeup/route.ts",
  import.meta.url,
)
const approvalRouteUrl = new URL(
  "../src/app/api/makeup-requests/approve/route.ts",
  import.meta.url,
)
const approvalReplayUrl = new URL(
  "../src/features/makeup-requests/makeup-approval-replay.js",
  import.meta.url,
)
const serviceUrl = new URL(
  "../src/features/makeup-requests/makeup-request-service.ts",
  import.meta.url,
)

async function optionalSource(url) {
  return existsSync(url) ? readFile(url, "utf8") : ""
}

function functionBlock(source, name, nextName) {
  const start = source.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `함수 시작을 찾지 못했습니다: ${name}`)
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length
  assert.notEqual(end, -1, `함수 끝을 찾지 못했습니다: ${name}`)
  return source.slice(start, end)
}

function createFunctionBlock(source, name, nextName) {
  const start = source.indexOf(`create or replace function ${name}`)
  assert.notEqual(start, -1, `함수 시작을 찾지 못했습니다: ${name}`)
  const end = nextName
    ? source.indexOf(`create or replace function ${nextName}`, start + 1)
    : source.length
  assert.notEqual(end, -1, `함수 끝을 찾지 못했습니다: ${name}`)
  return source.slice(start, end)
}

function statementBlock(source, marker) {
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `SQL 문 시작을 찾지 못했습니다: ${marker}`)
  const end = source.indexOf(";", start)
  assert.notEqual(end, -1, `SQL 문 끝을 찾지 못했습니다: ${marker}`)
  return source.slice(start, end + 1)
}

test("Task 8 기준 설정은 원본 revision/checksum으로 비교하고 운영자 수정과 충돌하면 중단한다", async () => {
  const sql = await optionalSource(migrationUrl)

  assert.match(sql, /notification_settings_import_metadata/)
  assert.match(sql, /notification_makeup_reconcile_audits/)
  assert.match(sql, /source_revision/)
  assert.match(sql, /source_checksum/)
  assert.match(sql, /notification_reconcile_makeup_settings_v1/)
  assert.match(sql, /updated_actor_kind\s*=\s*'system'/)
  assert.match(sql, /updated_by\s+is\s+not\s+null/)
  assert.match(sql, /created_actor_kind\s*<>\s*'system'/)
  assert.match(sql, /notification_makeup_operator_edit_conflict/)
  assert.match(sql, /notification_template_content_valid_v1\(/)
  assert.match(sql, /notification_makeup_template_review_required/)
  assert.match(sql, /if not source_changed then\s+continue;/)
  assert.match(sql, /on conflict \(source_key\) do update/)
  assert.match(sql, /create trigger reconcile_makeup_notification_settings_after_write_v1/)
})

test("변경되지 않은 설정은 규칙 ID·revision·enabled·활성 템플릿 checksum을 그대로 둔다", async () => {
  const sql = await optionalSource(migrationUrl)

  assert.match(sql, /candidate\.enabled is distinct from desired_enabled/)
  assert.match(sql, /template_changed/)
  assert.match(sql, /revision\s*=\s*rule_row\.revision\s*\+\s*1/)
  assert.match(sql, /if enabled_changed or template_changed then/)
  assert.match(sql, /notification_seed_template_checksum_v1/)
  assert.doesNotMatch(sql, /delete\s+from\s+dashboard_private\.notification_(?:rules|templates)/i)
})

test("보관 delivery는 실제 원본 이벤트 occurrence와 안전 스냅샷 기준으로 정확히 한 번 가져온다", async () => {
  const sql = await optionalSource(migrationUrl)

  assert.match(sql, /create table if not exists dashboard_private\.notification_makeup_legacy_imports/)
  assert.match(sql, /legacy_delivery_id uuid primary key/)
  assert.match(sql, /source_event_id uuid not null/)
  assert.match(sql, /legacy_snapshot jsonb not null/)
  assert.match(sql, /notification_makeup_source_event_types_v1/)
  assert.match(sql, /candidate\.created_at <= legacy_delivery\.created_at/)
  assert.doesNotMatch(sql, /legacy_delivery\.created_at \+ interval '5 seconds'/)
  assert.match(sql, /order by candidate\.created_at desc, candidate\.id desc/)
  assert.match(sql, /notification_makeup_legacy_source_missing/)
  assert.match(sql, /'makeup_request_event',[\s\S]*source_event\.id::text,[\s\S]*source_event\.id::text/)
  assert.match(sql, /notification_makeup_legacy_snapshot_v1/)
  assert.match(sql, /pg_catalog\.convert_to\(legacy_snapshot::text, 'UTF8'\)/)
  assert.match(sql, /insert into dashboard_private\.notification_events/)
  assert.match(sql, /insert into dashboard_private\.notification_deliveries/)
  assert.match(sql, /insert into dashboard_private\.notification_dispatch_ownership_claims/)
  assert.match(sql, /on conflict \(legacy_delivery_id\) do nothing/)
  for (const status of ["sent", "failed", "skipped", "disabled", "deduped"]) {
    assert.ok(sql.includes(`'${status}'`), `레거시 상태 매핑 누락: ${status}`)
  }
  assert.match(sql, /legacy_deduped/)
  assert.match(sql, /legacy_skipped/)
  assert.match(sql, /rule_disabled/)
  assert.doesNotMatch(sql, /fetch\s*\(|http_post|net\.http/i)
})

test("보관 delivery import는 event_key 컬럼과 로컬 변수를 명확히 구분한다", async () => {
  const sql = await optionalSource(migrationUrl)
  const importer = functionBlock(
    sql,
    "dashboard_private.notification_import_makeup_retained_state_v1",
    "dashboard_private.notification_makeup_payload_v1",
  )

  assert.match(importer, /\bv_event_key text;/)
  assert.match(importer, /v_event_key := dashboard_private\.notification_makeup_event_key_v1\(/)
  assert.match(importer, /if v_event_key is null then/)
  assert.equal((importer.match(/rule\.event_key = v_event_key/g) ?? []).length, 2)
  assert.match(importer, /'makeup_requests',\s+v_event_key,\s+'makeup_request_event'/)
  assert.match(importer, /canonical_event\.event_key = v_event_key/)
  assert.doesNotMatch(importer, /\bevent_key text;/)
})

test("보관된 93건 import는 7개 trigger의 개인 대상 규칙과 동일 인물 우선순위를 보존한다", async () => {
  const sql = await optionalSource(migrationUrl)
  const importer = functionBlock(
    sql,
    "dashboard_private.notification_import_makeup_retained_state_v1",
    "dashboard_private.notification_makeup_payload_v1",
  )

  assert.match(
    importer,
    /legacy_delivery\.trigger_kind in \('submitted', 'refund_requested'\)[\s\S]*rule\.audience_key = 'approver_profile'[\s\S]*legacy_delivery\.recipient_profile_id = request_row\.approver_profile_id/,
  )
  assert.match(
    importer,
    /legacy_delivery\.trigger_kind in \('returned', 'rejected'\)[\s\S]*rule\.audience_key = 'requester_profile'[\s\S]*legacy_delivery\.recipient_profile_id = request_row\.requester_id/,
  )
  assert.match(
    importer,
    /legacy_delivery\.trigger_kind in \('approved', 'completed', 'canceled'\)[\s\S]*rule\.audience_key = 'approver_profile'[\s\S]*legacy_delivery\.recipient_profile_id = request_row\.approver_profile_id[\s\S]*rule\.audience_key = 'requester_profile'[\s\S]*legacy_delivery\.recipient_profile_id = request_row\.requester_id/,
  )
  assert.match(
    importer,
    /order by[\s\S]*legacy_delivery\.channel = 'dashboard_personal'[\s\S]*rule\.audience_key = 'approver_profile' then 0[\s\S]*rule\.audience_key = 'requester_profile' then 1[\s\S]*rule\.id/,
  )
})

test("500건 보관 경계는 삭제하지 않고 singleton과 append-only 관측을 함께 남긴다", async () => {
  const sql = await optionalSource(migrationUrl)
  const prune = functionBlock(sql, "public.prune_makeup_notification_deliveries")

  assert.match(sql, /notification_makeup_retention_snapshots/)
  assert.match(sql, /notification_makeup_retention_observations/)
  assert.match(prune, /notification_refresh_makeup_retention_snapshot_v1/)
  assert.match(sql, /insert into dashboard_private\.notification_makeup_retention_snapshots/)
  assert.match(sql, /on conflict \(singleton\) do update/)
  assert.match(sql, /insert into dashboard_private\.notification_makeup_retention_observations/)
  assert.match(sql, /notification_assert_makeup_retained_import_complete_v1/)
  assert.doesNotMatch(prune, /delete\s+from\s+public\.makeup_notification_deliveries/i)
})

test("휴보강 생성·전이·삭제 RPC는 요청 영수증과 원본/canonical 이벤트를 한 트랜잭션에 기록한다", async () => {
  const sql = await optionalSource(migrationUrl)
  for (const name of [
    "create_makeup_request_v2",
    "transition_makeup_request_v2",
    "delete_makeup_request_v2",
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}\\(`))
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*to authenticated`))
  }
  assert.match(sql, /notification_request_ledger/)
  assert.match(sql, /notification_apply_makeup_calendar_effects_v1/)
  assert.match(sql, /notification_revert_makeup_calendar_effects_v1/)
  assert.match(sql, /insert into public\.academic_events/)
  assert.match(sql, /update public\.classes/)
  assert.match(sql, /delete from public\.academic_events/)
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*notification-request:/)
  assert.match(sql, /idempotency_key_reused/)
  assert.match(sql, /makeup_request_events/)
  assert.match(sql, /record_notification_event_v1/)
  assert.match(sql, /notification_makeup_input_valid_v1/)
  assert.match(sql, /'process', case p_event_key[\s\S]*when 'makeup\.submitted' then '신청 제출'/)
  assert.match(sql, /'status', case request\.status[\s\S]*when 'approval_pending' then '결재자 승인 대기'/)
  assert.match(sql, /'workflow_status', request\.status/)
  assert.match(sql, /'approval_group', request\.approval_group/)
  assert.match(sql, /notification_profile_is_active_v1\(profile\.id\)/)
  assert.match(sql, /teacher\.profile_id::text\s*=\s*pg_catalog\.lower\([\s\S]*p_input ->> 'teacher_profile_id'/)
  assert.match(sql, /approver\.profile_id::text\s*=\s*pg_catalog\.lower\([\s\S]*p_input ->> 'approver_profile_id'/)
  assert.match(sql, /sourceEventId/)
  assert.match(sql, /'makeup\.submitted'/)
  assert.match(sql, /'makeup\.refund_completed'/)
  assert.match(sql, /'makeup\.approval_canceled'/)
  assert.match(sql, /'makeup\.deleted'/)
})

test("휴보강 생성 입력은 서버 수업·담당자·결재그룹·학부장 배정과 일치해야 한다", async () => {
  const sql = await optionalSource(migrationUrl)
  const validator = functionBlock(
    sql,
    "dashboard_private.notification_makeup_input_valid_v1",
    "public.create_makeup_request_v2",
  )

  assert.match(validator, /pg_catalog\.btrim\(class_row\.name\)\s*=\s*pg_catalog\.btrim\([\s\S]*?p_input ->> 'class_name'/)
  assert.match(validator, /pg_catalog\.btrim\(class_row\.subject\)\s*=\s*pg_catalog\.btrim\([\s\S]*?p_input ->> 'subject'/)
  assert.match(validator, /pg_catalog\.btrim\(teacher\.name\)\s*=\s*pg_catalog\.btrim\(class_row\.teacher\)/)
  assert.match(validator, /p_input ->> 'approval_group'\s*=\s*case/)
  assert.match(validator, /p_effective_at timestamptz default pg_catalog\.now\(\)/)
  assert.match(validator, /resolve_registration_default_director\([\s\S]*p_effective_at/)
  assert.match(validator, /public\.current_dashboard_role\(\) in \('admin', 'staff'\)/)
  assert.match(validator, /director\.resolution ->> 'profileId'\s*=\s*approver\.profile_id::text/)
  assert.match(sql, /notification_makeup_input_valid_v1\([\s\S]*p_patch \|\|[\s\S]*before_row\.created_at/)
})

test("고정 전이 명령만 허용하고 상태·행위자·삭제 권한을 서버에서 검증한다", async () => {
  const sql = await optionalSource(migrationUrl)
  const domainRpcSource = [
    functionBlock(sql, "public.create_makeup_request_v2", "public.transition_makeup_request_v2"),
    functionBlock(sql, "public.transition_makeup_request_v2", "public.delete_makeup_request_v2"),
    functionBlock(sql, "public.delete_makeup_request_v2", "dashboard_private.notification_makeup_render_template_v1"),
  ].join("\n")
  for (const command of [
    "approve",
    "revision_requested",
    "reject",
    "refund_requested",
    "refund_completed",
    "resubmit",
    "approval_canceled",
  ]) assert.ok(sql.includes(`'${command}'`), `명령 누락: ${command}`)
  assert.match(sql, /p_expected_status/)
  assert.match(sql, /makeup_request_stale_status/)
  assert.match(sql, /current_dashboard_role\(\)/)
  assert.match(sql, /makeup_request_transition_forbidden/)
  assert.match(sql, /makeup_request_delete_forbidden/)
  assert.doesNotMatch(domainRpcSource, /p_(?:title|body|href|recipient|target|webhook)/i)
})

test("조교 휴보강 권한은 restrictive RLS·DML trigger·공개 RPC 입구에서 모두 차단한다", async () => {
  const sql = await optionalSource(assistantPermissionsMigrationUrl)
  const prerequisite = sql.slice(
    0,
    sql.indexOf(
      "create or replace function dashboard_private.is_authenticated_assistant_request_v1",
    ),
  )
  const requestPolicy = statementBlock(
    sql,
    "create policy makeup_requests_assistant_hard_deny",
  )
  const eventPolicy = statementBlock(
    sql,
    "create policy makeup_request_events_assistant_hard_deny",
  )
  const settingsPolicy = statementBlock(
    sql,
    "create policy makeup_notification_settings_assistant_hard_deny",
  )
  const actionGuard = createFunctionBlock(
    sql,
    "dashboard_private.assert_assistant_makeup_action_v1",
    "dashboard_private.reject_assistant_makeup_request_dml_v1",
  )
  const dmlGuard = createFunctionBlock(
    sql,
    "dashboard_private.reject_assistant_makeup_request_dml_v1",
    "public.create_makeup_request_v2",
  )
  const createWrapper = createFunctionBlock(
    sql,
    "public.create_makeup_request_v2",
    "public.transition_makeup_request_v2",
  )
  const transitionWrapper = createFunctionBlock(
    sql,
    "public.transition_makeup_request_v2",
    "public.delete_makeup_request_v2",
  )
  const deleteWrapper = createFunctionBlock(
    sql,
    "public.delete_makeup_request_v2",
  )

  for (const [name, signature] of [
    ["create_makeup_request_v2", "jsonb,uuid"],
    ["transition_makeup_request_v2", "uuid,text,jsonb,text,uuid"],
    ["delete_makeup_request_v2", "uuid,uuid"],
  ]) {
    assert.match(
      prerequisite,
      new RegExp(`to_regprocedure\\(\\s*'public\\.${name}\\(${signature}\\)'\\s*\\)[\\s\\S]*?is null`),
    )
    assert.match(
      prerequisite,
      new RegExp(`to_regprocedure\\(\\s*'dashboard_private\\.${name}_unguarded\\(${signature}\\)'\\s*\\)[\\s\\S]*?is not null`),
    )
  }
  for (const table of [
    "makeup_requests",
    "makeup_request_events",
    "makeup_notification_settings",
  ]) {
    assert.match(
      prerequisite,
      new RegExp(`to_regclass\\('public\\.${table}'\\)[\\s\\S]*?is null`),
    )
  }
  assert.match(prerequisite, /assistant_permission_prerequisite_missing/)

  for (const [policy, command] of [
    [requestPolicy, "all"],
    [eventPolicy, "all"],
    [settingsPolicy, "select"],
  ]) {
    assert.match(policy, /as restrictive/)
    assert.match(policy, new RegExp(`for ${command}`))
    assert.match(policy, /to authenticated/)
    assert.match(policy, /auth\.jwt\(\)[\s\S]*'role'[\s\S]*'authenticated'/)
    assert.match(policy, /auth\.uid\(\)/)
    assert.match(policy, /current_dashboard_role\(\)[\s\S]*'assistant'/)
  }
  for (const policy of [requestPolicy, eventPolicy]) {
    assert.match(policy, /using \(/)
    assert.match(policy, /with check \(/)
  }

  assert.match(actionGuard, /is_authenticated_assistant_request_v1\(\)/)
  assert.match(actionGuard, /auth\.jwt\(\)[\s\S]*'role'[\s\S]*'service_role'/)
  assert.match(actionGuard, /from public\.profiles profile[\s\S]*p_patch ->> 'actor_profile_id'[\s\S]*profile\.role = 'assistant'/)
  assert.match(
    actionGuard,
    /profile\.id\s*=\s*nullif\(\s*pg_catalog\.btrim\(p_patch ->> 'actor_profile_id'\), ''\s*\)::uuid/,
  )
  assert.match(actionGuard, /makeup_request_assistant_forbidden[\s\S]*errcode = '42501'/)
  assert.match(dmlGuard, /is_authenticated_assistant_request_v1\(\)/)
  assert.match(dmlGuard, /makeup_request_assistant_forbidden[\s\S]*errcode = '42501'/)
  assert.doesNotMatch(actionGuard + dmlGuard, /\bcurrent_user\b/)
  assert.match(
    sql,
    /create trigger reject_assistant_makeup_request_dml_v1[\s\S]*before insert or update or delete[\s\S]*on public\.makeup_requests/,
  )

  for (const [name, signature] of [
    ["create_makeup_request_v2", "jsonb, uuid"],
    ["transition_makeup_request_v2", "uuid, text, jsonb, text, uuid"],
    ["delete_makeup_request_v2", "uuid, uuid"],
  ]) {
    assert.match(
      sql,
      new RegExp(`alter function public\\.${name}\\(\\s*${signature}\\s*\\)[\\s\\S]*set schema dashboard_private`),
    )
    assert.match(
      sql,
      new RegExp(`alter function dashboard_private\\.${name}\\(\\s*${signature}\\s*\\)[\\s\\S]*rename to ${name}_unguarded`),
    )
    assert.match(
      sql,
      new RegExp(`revoke all on function dashboard_private\\.${name}_unguarded\\([\\s\\S]*?from public, anon, authenticated, service_role`),
    )
  }

  for (const [wrapper, implementation] of [
    [createWrapper, "create_makeup_request_v2_unguarded"],
    [transitionWrapper, "transition_makeup_request_v2_unguarded"],
    [deleteWrapper, "delete_makeup_request_v2_unguarded"],
  ]) {
    assert.match(wrapper, /returns jsonb[\s\S]*volatile[\s\S]*security definer[\s\S]*set search_path = ''/)
    assert.ok(
      wrapper.indexOf("assert_assistant_makeup_action_v1") <
        wrapper.indexOf(implementation),
    )
  }
  assert.match(transitionWrapper, /assert_assistant_makeup_action_v1\(p_patch\)/)
  assert.match(sql, /grant execute on function public\.create_makeup_request_v2\(jsonb, uuid\)[^;]*to authenticated, service_role;/)
  assert.match(sql, /grant execute on function public\.transition_makeup_request_v2\([^;]*to authenticated, service_role;/)
  assert.match(sql, /grant execute on function public\.delete_makeup_request_v2\(uuid, uuid\)[^;]*to authenticated, service_role;/)
  assert.doesNotMatch(sql, /create or replace function public\.(?:get_makeup_legacy_dispatch_plan_v1|materialize_makeup_legacy|finalize_makeup_legacy|prepare_makeup_legacy)/)
  assert.doesNotMatch(sql, /notification_(?:runtime_flags|rules)|provider/i)
})

test("승인 취소와 삭제는 이전 미전송 건만 source_status_changed로 끝낸다", async () => {
  const sql = await optionalSource(migrationUrl)
  const cancelSource = functionBlock(
    sql,
    "dashboard_private.cancel_makeup_unsent_deliveries_v1",
    "dashboard_private.notification_makeup_input_valid_v1",
  )
  const transitionSource = functionBlock(
    sql,
    "public.transition_makeup_request_v2",
    "public.delete_makeup_request_v2",
  )
  const deleteSource = functionBlock(
    sql,
    "public.delete_makeup_request_v2",
    "dashboard_private.notification_makeup_render_template_v1",
  )

  assert.match(cancelSource, /delivery\.status in \('pending', 'retry_wait'\)/)
  assert.match(cancelSource, /delivery\.status = 'claimed'/)
  assert.match(cancelSource, /status_reason = 'source_status_changed'/)
  assert.match(cancelSource, /cancel_reason = 'source_status_changed'/)
  assert.match(transitionSource, /event_type = 'approval_canceled'[\s\S]*cancel_makeup_unsent_deliveries_v1/)
  assert.match(deleteSource, /'deleted'[\s\S]*cancel_makeup_unsent_deliveries_v1/)
  assert.doesNotMatch(cancelSource, /delivery\.status in \([^)]*(?:sent|delivery_unknown)/)
})

test("레거시 브리지는 sourceEventId만 받고 권위 원본·공유 소유권·서버 provider를 사용한다", async () => {
  const [route, sql] = await Promise.all([
    optionalSource(routeUrl),
    optionalSource(migrationUrl),
  ])
  const plan = functionBlock(
    sql,
    "public.get_makeup_legacy_dispatch_plan_v1",
    "public.materialize_makeup_legacy_in_app_v1",
  )
  const chatMaterialize = functionBlock(
    sql,
    "public.materialize_makeup_legacy_google_chat_v1",
    "public.finalize_makeup_legacy_google_chat_v1",
  )
  const chatFinalize = functionBlock(
    sql,
    "public.finalize_makeup_legacy_google_chat_v1",
    "public.prepare_makeup_legacy_web_push_v1",
  )

  assert.match(route, /sourceEventId/)
  assert.match(route, /Object\.keys\(body\)/)
  assert.match(route, /get_makeup_legacy_dispatch_plan_v1/)
  assert.match(route, /materialize_makeup_legacy_in_app_v1/)
  assert.match(route, /materialize_makeup_legacy_google_chat_v1/)
  assert.match(route, /deterministicRequestId\([\s\S]*makeup-legacy-in-app-materialize-v1/)
  assert.doesNotMatch(route, /commit_legacy_notification_in_app_projection_v1/)
  assert.match(route, /finalize_makeup_legacy_google_chat_v1/)
  assert.match(route, /createGoogleChatProvider/)
  assert.doesNotMatch(route, /body\.(?:title|body|href|recipient|channel|text|webhook)/)
  assert.doesNotMatch(route, /\/api\/(?:google-chat|web-push)/)
  assert.match(sql, /get_makeup_legacy_dispatch_plan_v1/)
  assert.match(sql, /from public\.makeup_request_events/)
  assert.match(sql, /from public\.makeup_requests/)
  assert.match(sql, /notification_templates/)
  assert.match(plan, /jsonb_array_elements\(canonical_event\.rule_snapshot\)/)
  assert.doesNotMatch(plan, /from dashboard_private\.notification_rules/)
  assert.doesNotMatch(plan, /template\.id = rule\.active_template_id/)
  assert.match(plan, /canonical_event\.payload ->> 'requester_profile_id'/)
  assert.match(plan, /canonical_event\.payload ->> 'approver_profile_id'/)
  assert.match(plan, /canonical_event\.payload -> 'management_profile_ids'/)
  assert.match(plan, /canonical_event\.payload ->> 'approval_group'/)
  assert.doesNotMatch(plan, /select request_row\.(?:requester_id|approver_profile_id) as profile_id/)
  assert.match(
    functionBlock(
      sql,
      "public.materialize_makeup_legacy_in_app_v1",
      "public.materialize_makeup_legacy_google_chat_v1",
    ),
    /begin_legacy_notification_dispatch_v1/,
  )
  assert.match(
    functionBlock(
      sql,
      "public.materialize_makeup_legacy_in_app_v1",
      "public.materialize_makeup_legacy_google_chat_v1",
    ),
    /commit_legacy_notification_in_app_projection_v1/,
  )
  assert.match(chatMaterialize, /begin_legacy_notification_dispatch_v1/)
  assert.doesNotMatch(chatMaterialize, /update dashboard_private\.notification_deliveries/)
  assert.match(chatFinalize, /finalize_legacy_notification_dispatch_v1/)
  assert.match(chatFinalize, /'canonicalDeliveryStatus', delivery_row\.status/)
  assert.match(chatFinalize, /'canonicalDeliveryReason', delivery_row\.status_reason/)
  assert.doesNotMatch(chatFinalize, /update dashboard_private\.notification_deliveries/)
  assert.match(sql, /perform public\.finalize_legacy_notification_dispatch_v1/)
  assert.match(sql, /canonical_event\.event_key <> 'makeup\.deleted'/)
  assert.match(sql, /canonical_event\.payload ->> 'makeup_request_id'/)
})

test("조교 휴보강 알림 후처리는 actor profile에서 service-role dispatch 전에 거절한다", async () => {
  const route = await optionalSource(routeUrl)
  const postSource = route.slice(route.indexOf("export async function POST"))
  const authIndex = postSource.indexOf("actorClient.auth.getUser(token)")
  const profileLookupIndex = postSource.indexOf('.from("profiles")')
  const lookupFailureIndex = postSource.indexOf("if (actorProfileError || !isRecord(actorProfile))")
  const assistantDenialIndex = postSource.indexOf('if (text(actorProfile.role) === "assistant")')
  const serviceClientIndex = postSource.indexOf("const serverClient = serviceClient()")
  const bodyIndex = postSource.indexOf("request.json()")
  const planIndex = postSource.indexOf("get_makeup_legacy_dispatch_plan_v1")

  assert.match(
    postSource,
    /actorClient\s*\.from\("profiles"\)\s*\.select\("role"\)\s*\.eq\("id", actor\.user\.id\)\s*\.single\(\)/,
  )
  assert.match(
    postSource,
    /if \(actorProfileError \|\| !isRecord\(actorProfile\)\) return response\(\{ ok: false, error: "휴보강 권한을 확인할 수 없습니다\." \}, 503\)/,
  )
  assert.match(
    postSource,
    /if \(text\(actorProfile\.role\) === "assistant"\) return response\(\{ ok: false, error: "휴보강 접근 권한이 없습니다\." \}, 403\)/,
  )
  assert.doesNotMatch(postSource, /serverClient\s*\.from\("profiles"\)/)
  assert.ok(authIndex >= 0 && authIndex < profileLookupIndex, "actor authentication must precede the profile role lookup")
  assert.ok(profileLookupIndex < lookupFailureIndex, "profile lookup errors must fail closed")
  assert.ok(lookupFailureIndex < assistantDenialIndex, "assistant role denial must follow the authoritative lookup")
  assert.ok(assistantDenialIndex < serviceClientIndex, "assistant denial must precede service-role client creation")
  assert.ok(assistantDenialIndex < bodyIndex, "assistant denial must precede request body parsing")
  assert.ok(assistantDenialIndex < planIndex, "assistant denial must precede service-role notification dispatch")
})

test("클라이언트는 원자적 RPC 성공 뒤 sourceEventId 후처리를 완료까지 기다리되 전달 실패로 저장을 실패시키지 않는다", async () => {
  const [service, approvalRoute] = await Promise.all([
    optionalSource(serviceUrl),
    optionalSource(approvalRouteUrl),
  ])
  const dispatch = functionBlock(service, "dispatchLegacyMakeupNotification", "runMakeupMutationRpc")

  assert.match(service, /create_makeup_request_v2/)
  assert.match(service, /transition_makeup_request_v2/)
  assert.match(service, /delete_makeup_request_v2/)
  assert.match(service, /crypto\.randomUUID\(\)/)
  assert.match(service, /delete createInput\.status/)
  assert.match(service, /delete transitionPatch\.status/)
  assert.doesNotMatch(service, /calendar_events: calendarEvents/)
  assert.match(service, /\/api\/makeup-requests\/approve/)
  assert.match(approvalRoute, /calendar_events: calendarEvents/)
  assert.match(approvalRoute, /applyMakeupRequestToSchedulePlan/)
  assert.match(approvalRoute, /buildMakeupCalendarDrafts/)
  assert.match(approvalRoute, /buildRoomAvailability/)
  assert.match(approvalRoute, /p_command: "approve"/)
  assert.match(dispatch, /\/api\/notifications\/legacy\/makeup/)
  assert.match(dispatch, /JSON\.stringify\(\{ sourceEventId \}\)/)
  assert.match(dispatch, /catch/)
  assert.match(dispatch, /console\.warn/)
  assert.doesNotMatch(dispatch, /throw/)
  assert.match(service, /await dispatchLegacyMakeupNotification\(sourceEventId\)/)
  assert.match(dispatch, /keepalive: true/)
  assert.doesNotMatch(service, /\.from\("makeup_request_events"\)\.insert/)
  assert.doesNotMatch(service, /\.from\("makeup_notification_deliveries"\)\.insert/)
  assert.doesNotMatch(service, /\.from\("classes"\)/)
  assert.doesNotMatch(service, /\.from\("academic_events"\)\.(?:upsert|delete)/)
  assert.doesNotMatch(service, /fetch\("\/api\/(?:google-chat|web-push)"/)
})

test("승인 일정 효과는 인증된 서버가 원본에서 계산하고 공개 RPC의 브라우저 approve를 닫는다", async () => {
  const [sql, service, approvalRoute] = await Promise.all([
    optionalSource(migrationUrl),
    optionalSource(serviceUrl),
    optionalSource(approvalRouteUrl),
  ])
  const transition = functionBlock(
    sql,
    "public.transition_makeup_request_v2",
    "public.delete_makeup_request_v2",
  )
  const clientApprove = functionBlock(
    service,
    "approveMakeupRequest",
    "requestMakeupRequestRevision",
  )

  assert.match(clientApprove, /JSON\.stringify\(\{[\s\S]*requestId,[\s\S]*note: text\(note\),[\s\S]*expectedStatus: request\.status,[\s\S]*mutationRequestId:/)
  assert.doesNotMatch(clientApprove, /schedule_plan_after|calendar_events/)
  assert.match(approvalRoute, /readOne\(serverClient, "makeup_requests", requestId\)/)
  assert.match(approvalRoute, /readOne\(serverClient, "classes", classId\)/)
  assert.match(approvalRoute, /assertCurrentSource\(requestRow, classRow\)/)
  assert.match(approvalRoute, /assertNoRoomCollision/)
  assert.match(approvalRoute, /\.order\("id", \{ ascending: true \}\)/)
  assert.match(approvalRoute, /\.range\(from, from \+ pageSize - 1\)/)
  assert.match(approvalRoute, /if \(page\.length < pageSize\) return rows/)
  assert.ok(
    approvalRoute.indexOf("const replay = await attemptMakeupApprovalReplay")
      < approvalRoute.indexOf('readOne(serverClient, "makeup_requests", requestId)'),
    "동일 mutation ID 재실행은 변경된 현재 원본을 읽기 전에 ledger 영수증을 회수해야 한다",
  )
  assert.match(transition, /auth\.role\(\)\) is distinct from 'service_role'/)
  assert.match(transition, /makeup_approval_server_required/)
  assert.match(transition, /makeup_refund_approval_patch_invalid/)
  assert.match(transition, /makeup_request_source_changed/)
  assert.match(transition, /then request\.schedule_plan_before/)
  assert.match(sql, /to authenticated, service_role/)
})

test("동시 휴보강 승인은 강의실별 트랜잭션 잠금 뒤 최신 승인 점유를 다시 검사한다", async () => {
  const sql = await optionalSource(migrationUrl)
  const roomGuard = functionBlock(
    sql,
    "dashboard_private.notification_assert_makeup_room_available_v1",
    "public.transition_makeup_request_v2",
  )
  const transition = functionBlock(
    sql,
    "public.transition_makeup_request_v2",
    "public.delete_makeup_request_v2",
  )

  assert.match(sql, /notification_makeup_room_slots_v1/)
  assert.match(roomGuard, /pg_advisory_xact_lock/)
  assert.match(roomGuard, /makeup-room:/)
  assert.match(roomGuard, /order by slot\.room_key/)
  assert.match(roomGuard, /other_request\.status in \('makeup_pending', 'completed'\)/)
  assert.match(roomGuard, /current_slot\.start_at < occupied_slot\.end_at/)
  assert.match(roomGuard, /occupied_slot\.start_at < current_slot\.end_at/)
  assert.match(roomGuard, /makeup_room_collision/)
  const requestLockIndex = transition.indexOf("for update of request")
  const roomGuardIndex = transition.indexOf("notification_assert_makeup_room_available_v1")
  const effectsIndex = transition.indexOf("notification_apply_makeup_calendar_effects_v1")
  assert.ok(requestLockIndex >= 0 && roomGuardIndex > requestLockIndex && effectsIndex > roomGuardIndex)
})

test("승인 HTTP 응답 유실 뒤 같은 mutation ID는 최소 fingerprint로 원래 영수증을 회수한다", async () => {
  const { attemptMakeupApprovalReplay } = await import(approvalReplayUrl)
  const calls = []
  const receipt = {
    request: { id: "92000000-0000-4000-8000-000000000401", status: "makeup_pending" },
    sourceEventId: "92000000-0000-4000-8000-000000000701",
  }
  const completed = await attemptMakeupApprovalReplay({
    client: {
      rpc: async (name, parameters) => {
        calls.push({ name, parameters })
        return { data: receipt, error: null }
      },
    },
    requestId: "92000000-0000-4000-8000-000000000401",
    actorProfileId: "92000000-0000-4000-8000-000000000002",
    finalNote: "승인 완료",
    expectedStatus: "approval_pending",
    mutationRequestId: "92000000-0000-4000-8000-000000000601",
  })

  assert.deepEqual(completed, { kind: "completed", data: receipt })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, "transition_makeup_request_v2")
  assert.deepEqual(calls[0].parameters.p_patch, {
    actor_profile_id: "92000000-0000-4000-8000-000000000002",
    final_note: "승인 완료",
  })

  const needsEffects = await attemptMakeupApprovalReplay({
    client: {
      rpc: async () => ({
        data: null,
        error: { code: "22023", message: "makeup_calendar_effects_invalid" },
      }),
    },
    requestId: "92000000-0000-4000-8000-000000000401",
    actorProfileId: "92000000-0000-4000-8000-000000000002",
    finalNote: "승인 완료",
    expectedStatus: "approval_pending",
    mutationRequestId: "92000000-0000-4000-8000-000000000601",
  })
  assert.deepEqual(needsEffects, { kind: "needs_effects" })

  const fatal = { code: "40001", message: "makeup_request_stale_status" }
  await assert.rejects(
    attemptMakeupApprovalReplay({
      client: { rpc: async () => ({ data: null, error: fatal }) },
      requestId: "92000000-0000-4000-8000-000000000401",
      actorProfileId: "92000000-0000-4000-8000-000000000002",
      finalNote: "승인 완료",
      expectedStatus: "approval_pending",
      mutationRequestId: "92000000-0000-4000-8000-000000000601",
    }),
    (error) => error === fatal,
  )
})

test("휴보강 전이와 레거시 공급자는 NULL·재실행·웹푸시를 fail-closed로 처리한다", async () => {
  const sql = await optionalSource(migrationUrl)
  const route = await optionalSource(routeUrl)
  const transition = functionBlock(sql, "public.transition_makeup_request_v2", "public.delete_makeup_request_v2")

  assert.match(transition, /p_command is null/)
  assert.match(transition, /elsif p_command = 'approval_canceled'/)
  assert.match(transition, /raise exception 'makeup_request_transition_invalid'/)
  assert.doesNotMatch(route, /begin_legacy_notification_dispatch_v1/)
  assert.match(route, /makeup-legacy-google-chat-materialize-v1/)
  assert.doesNotMatch(route, /randomUUID/)
  assert.match(route, /prepare_makeup_legacy_web_push_v1/)
  assert.match(route, /finalize_makeup_legacy_web_push_v1/)
  assert.match(route, /createWebPushProvider/)
  assert.match(sql, /create or replace function public\.prepare_makeup_legacy_web_push_v1/)
  assert.match(sql, /create or replace function public\.finalize_makeup_legacy_web_push_v1/)
  assert.match(sql, /projectionCommitted/)
  assert.match(sql, /recoveredUnknown/)
  assert.match(route, /idempotent_dispatch_replay/)
  assert.match(transition, /coalesce\(before_row\.requester_id = actor_id, false\)/)
  assert.match(transition, /coalesce\(before_row\.approver_profile_id = actor_id, false\)/)
  const dispatchPlan = functionBlock(
    sql,
    "public.get_makeup_legacy_dispatch_plan_v1",
    "public.materialize_makeup_legacy_in_app_v1",
  )
  assert.match(dispatchPlan, /if \([\s\S]*\) is not true then/)
})

test("휴보강 Google Chat·웹푸시는 준비 뒤 외부 시도 등록기를 통과해야만 provider를 호출한다", async () => {
  const [route, sql] = await Promise.all([
    optionalSource(routeUrl),
    optionalSource(migrationUrl),
  ])
  const inApp = functionBlock(route, "dispatchInApp", "dispatchGoogleChat")
  const googleChat = functionBlock(route, "dispatchGoogleChat", "POST")

  const pushPrepare = inApp.indexOf("prepare_makeup_legacy_web_push_v1")
  const pushIntent = inApp.indexOf("record_legacy_notification_delivery_intent_v1")
  const pushRegister = inApp.indexOf("register_notification_external_attempt_v1")
  const pushProvider = inApp.indexOf("await pushProvider.send")
  assert.ok(
    pushPrepare >= 0
      && pushIntent > pushPrepare
      && pushRegister > pushIntent
      && pushProvider > pushRegister,
  )

  const chatPrepare = googleChat.indexOf("materialize_makeup_legacy_google_chat_v1")
  const chatIntent = googleChat.indexOf("record_legacy_notification_delivery_intent_v1")
  const chatRegister = googleChat.indexOf("register_notification_external_attempt_v1")
  const chatProvider = googleChat.indexOf("await provider.send")
  assert.ok(
    chatPrepare >= 0
      && chatIntent > chatPrepare
      && chatRegister > chatIntent
      && chatProvider > chatRegister,
  )
  assert.match(route, /templateChecksum:\s*text\(raw\.templateChecksum\)/)
  assert.match(route, /const TEMPLATE_CHECKSUM = \/\^\(\?:\[a-f0-9\]\{32\}\|\[a-f0-9\]\{64\}\)\$\//)
  assert.match(route, /TEMPLATE_CHECKSUM\.test\(item\.templateChecksum\)/)
  assert.match(route, /legacyTemplateChecksum:\s*pushItem\.templateChecksum/)
  assert.match(route, /legacyTemplateChecksum:\s*item\.templateChecksum/)
  assert.match(route, /p_legacy_template_checksum:\s*intent\.legacyTemplateChecksum/g)
  assert.match(sql, /'templateChecksum',\s*target\.template_checksum/)
  assert.match(sql, /'templateChecksum',\s*child_template\.checksum/)
})

test("공통 과목팀 규칙으로 합쳐진 영어·수학 레거시 토글은 한 문장으로 함께 저장한다", async () => {
  const service = await optionalSource(serviceUrl)
  const toggle = functionBlock(
    service,
    "toggleMakeupNotificationSetting",
    "updateMakeupNotificationTriggerContent",
  )

  assert.match(toggle, /channel === "google_chat_english" \|\| channel === "google_chat_math"/)
  assert.match(toggle, /\["google_chat_english", "google_chat_math"\]/)
  assert.match(toggle, /channels\.map\(\(targetChannel\) =>/)
  assert.match(toggle, /\.upsert\(rows,/)
})

test("pgTAP 패킷은 재실행 무변경·원본 계보·스냅샷·최종 parity를 검증한다", async () => {
  const sql = await optionalSource(pgTapUrl)

  assert.match(sql, /notification_reconcile_makeup_settings_v1/)
  assert.match(sql, /notification_import_makeup_retained_state_v1/)
  assert.match(sql, /operator-edited|운영자 수정/)
  assert.match(sql, /rule_id/)
  assert.match(sql, /revision/)
  assert.match(sql, /enabled/)
  assert.match(sql, /checksum/)
  assert.match(sql, /legacy_delivery_id/)
  assert.match(sql, /source_event_id/)
  assert.match(sql, /legacy_snapshot/)
  assert.match(sql, /notification_makeup_retention_observations/)
  assert.match(sql, /notification_assert_makeup_retained_import_complete_v1/)
  assert.match(sql, /가장 최신 재제출 이벤트를 occurrence로 사용한다/)
  assert.match(sql, /NULL 전이 명령/)
  assert.match(sql, /task17-install-v1/)
  assert.match(sql, /transition_makeup_request_v2/)
  assert.match(sql, /makeup\.revision_requested/)
  assert.match(sql, /같은 요청 ID 재실행/)
  assert.match(sql, /forced_makeup_canonical_failure/)
  assert.match(sql, /makeup_set_service_actor/)
  assert.match(sql, /request\.jwt\.claim\.role', 'service_role'/)
  assert.match(sql, /makeup_set_actor\('92000000-0000-4000-8000-000000000002'\)/)
  assert.match(sql, /환불 재승인 뒤 상태·일정·캘린더 ID 스냅샷과 canonical 이벤트가 모두 보존된다/)
  assert.match(sql, /동일 강의실 승인 점유를 트랜잭션 안에서 다시 검사한다/)
  assert.match(sql, /먼저 승인된 일정과 겹치는 두 번째 승인을 거절한다/)
  assert.match(sql, /승인 취소 성공 뒤 일정·캘린더·업무·canonical 상태/)
  assert.match(sql, /select \* from finish\(\)/)
})
