import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260716194000_notification_registration_handoffs.sql",
  import.meta.url,
)
const contentMigrationUrl = new URL(
  "../supabase/migrations/20260803143000_notification_registration_content_payload.sql",
  import.meta.url,
)
const koreanRendererMigrationUrl = new URL(
  "../supabase/migrations/20260807030434_registration_korean_template_renderer.sql",
  import.meta.url,
)
const managementDispatchMigrationUrl = new URL(
  "../supabase/migrations/20260807111442_registration_management_google_chat_dispatch.sql",
  import.meta.url,
)
const serviceUrl = new URL("../src/features/tasks/registration-track-service.ts", import.meta.url)
const workspaceUrl = new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url)
const opsRouteUrl = new URL("../src/app/api/notifications/legacy/ops-task/route.ts", import.meta.url)
const visitRouteUrl = new URL("../src/app/api/registration/consultation-notification/route.ts", import.meta.url)
const solapiRouteUrl = new URL("../src/app/api/solapi/registration/route.ts", import.meta.url)
const solapiCoreUrl = new URL("../src/app/api/solapi/registration/core.js", import.meta.url)
const customerMessageSolapiUrl = new URL(
  "../src/features/tasks/server/registration-customer-message-solapi.ts",
  import.meta.url,
)
const customerMessageRouteUrl = new URL(
  "../src/features/tasks/server/registration-customer-message-route.ts",
  import.meta.url,
)
const workerMigrationUrl = new URL(
  "../supabase/pending-migrations/notification-cutover/20260716195500_notification_worker_schedule.sql",
  import.meta.url,
)
const controlPlaneWorkerMigrationUrl = new URL(
  "../supabase/migrations/20260716112000_notification_control_plane_worker_rpc.sql",
  import.meta.url,
)
const providerClaimMigrationUrl = new URL(
  "../supabase/pending-migrations/notification-cutover/20260716195800_notification_registration_provider_claim.sql",
  import.meta.url,
)

async function source(url) {
  return readFile(url, "utf8")
}

function functionBlock(sql, name) {
  const start = sql.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `missing function ${name}`)
  const end = sql.indexOf("\n$$;", start)
  assert.ok(end > start, `unterminated function ${name}`)
  return sql.slice(start, end + 4)
}

test("version-2 writer keeps one raw row and maps the director row once", async () => {
  const sql = await source(migrationUrl)
  const writer = functionBlock(sql, "dashboard_private.write_registration_track_event_v2")
  assert.equal((writer.match(/insert into public\.ops_task_events/g) || []).length, 1)
  assert.equal((writer.match(/record_notification_event_v1/g) || []).length, 1)
  assert.match(writer, /p_actor_kind not in \('user', 'system', 'migration'\)/)
  const eventKeyResolver = functionBlock(sql, "dashboard_private.registration_track_event_key_v1")
  assert.match(eventKeyResolver, /director_default_resolved[\s\S]*director_manual_override[\s\S]*director_default_cleared/)
  assert.match(eventKeyResolver, /registration\.director_assigned/)
  assert.match(eventKeyResolver, /appointment_replaced[\s\S]*level_test[\s\S]*registration\.level_test_rescheduled/)
  assert.match(eventKeyResolver, /appointment_replaced[\s\S]*visit_consultation[\s\S]*registration\.visit_replaced/)
  assert.doesNotMatch(writer, /insert into public\.ops_task_events[\s\S]*registration\.director_assigned/)

  const wrapper = functionBlock(sql, "dashboard_private.write_registration_track_event")
  assert.equal((wrapper.match(/write_registration_track_event_v2/g) || []).length, 1)
  assert.doesNotMatch(wrapper, /insert into public\.ops_task_events|record_notification_event_v1/)
})

test("registration writer loads joined rowtypes through one record target", async () => {
  const sql = await source(migrationUrl)
  const writer = functionBlock(sql, "dashboard_private.write_registration_track_event_v2")
  assert.match(writer, /v_registration_source record;/)
  assert.match(writer, /into v_registration_source/)
  assert.doesNotMatch(writer, /into v_task,\s*v_track,\s*v_detail/)
  assert.match(
    writer,
    /if not found then\s+raise exception 'registration_track_not_found'[^;]+;\s+end if;\s+v_task := v_registration_source\.task;\s+v_track := v_registration_source\.track;\s+v_detail := v_registration_source\.detail;/,
  )
})

test("phone projection loads its rule and template through one record target", async () => {
  const sql = await source(migrationUrl)
  const projection = functionBlock(
    sql,
    "dashboard_private.materialize_registration_phone_legacy_v1",
  )
  assert.match(projection, /v_rule_selection record;/)
  assert.match(projection, /into v_rule_selection/)
  assert.doesNotMatch(projection, /into v_rule_id,\s*v_rule_revision,\s*v_template/)
  assert.match(
    projection,
    /if not found then\s+raise exception 'registration_phone_rule_not_found'[^;]+;\s+end if;\s+v_rule_id := v_rule_selection\.rule_id;\s+v_rule_revision := v_rule_selection\.rule_revision;\s+v_template := v_rule_selection\.template;/,
  )
})

test("admission delivery loads its rule and template through one record target", async () => {
  const sql = await source(migrationUrl)
  const delivery = functionBlock(sql, "public.begin_registration_admission_delivery_v1")
  assert.match(delivery, /v_rule_selection record;/)
  assert.match(delivery, /into v_rule_selection/)
  assert.doesNotMatch(delivery, /into v_rule_id,\s*v_rule_revision,\s*v_template/)
  assert.match(
    delivery,
    /if not found then\s+raise exception 'registration_admission_notification_rule_not_found'\s+using errcode = 'P0002';\s+end if;\s+v_rule_id := v_rule_selection\.rule_id;\s+v_rule_revision := v_rule_selection\.rule_revision;\s+v_template := v_rule_selection\.template;/,
  )
})

test("registration event catalog is explicit and excludes coarse processing and reminders", async () => {
  const sql = await source(migrationUrl)
  for (const eventKey of [
    "registration.case_created",
    "registration.inquiry_routed",
    "registration.director_assigned",
    "registration.phone_consultation_ready",
    "registration.level_test_scheduled",
    "registration.visit_scheduled",
    "registration.visit_rescheduled",
    "registration.visit_replaced",
    "registration.visit_subject_deselected",
    "registration.visit_canceled",
    "registration.consultation_completed",
    "registration.waiting_transitioned",
    "registration.enrollment_decided",
    "registration.registration_completed",
    "registration.case_closed",
    "registration.track_reopened",
    "registration.admission_message_requested",
    "registration.admission_message_unknown",
    "registration.admission_message_reconciled",
    "registration.admission_message_retry_released",
  ]) assert.match(sql, new RegExp(eventKey.replaceAll(".", "\\.")))
  assert.doesNotMatch(sql, /registration\.processing/)
  assert.doesNotMatch(sql, /record_notification_event_v1\([\s\S]{0,500}registration\.appointment_reminder_due/)
})

test("core, phone, visit, and SOLAPI use four independent false flags", async () => {
  const sql = await source(migrationUrl)
  for (const flag of [
    "notification_control_plane_dispatch_registration_enabled",
    "notification_control_plane_registration_phone_adapter_enabled",
    "notification_control_plane_registration_visit_adapter_enabled",
    "notification_control_plane_registration_solapi_adapter_enabled",
  ]) assert.match(sql, new RegExp(flag))
  assert.doesNotMatch(sql, /update dashboard_private\.notification_runtime_flags[\s\S]{0,300}enabled\s*=\s*true/i)
  assert.match(sql, /notification_dispatch_ownership_claims|begin_legacy_notification_dispatch_v1/)
})

test("phone handoff preserves create, reassignment, unread withdrawal, and completion", async () => {
  const sql = await source(migrationUrl)
  assert.match(sql, /ops_registration_consultations[\s\S]*recipient_revision bigint not null default 1/)
  assert.match(sql, /mode = 'phone'[\s\S]*director_profile_id is distinct from/)
  assert.match(sql, /recipient_revision = old\.recipient_revision \+ 1/i)
  assert.match(sql, /phone_queue_created|phone_queue_reassigned|phone_queue_completed/)
  assert.match(sql, /phone_queue_reassigned'[\s\S]*cancel_registration_phone_projection_v1[\s\S]*'recipient_revoked'/)
  assert.match(sql, /read_at is null/)
  assert.match(sql, /revoked_at|delete from public\.dashboard_notifications/)
  assert.match(sql, /commit_legacy_notification_in_app_projection_v1/)
})

test("visit handoff uses appointment identity, persisted revisions, aggregated directors, and shared ownership", async () => {
  const sql = await source(migrationUrl)
  const writer = functionBlock(sql, "dashboard_private.write_registration_track_event_v2")
  const finalizeVisit = functionBlock(sql, "public.finalize_registration_visit_legacy_google_chat_v1")
  assert.match(sql, /registration:registration_appointment:[\s\S]*:source_revision:[\s\S]*:immediate/)
  assert.match(sql, /notification_revision/)
  assert.match(sql, /recipient_revision/)
  assert.match(writer, /oldAppointmentId[\s\S]*oldNotificationRevision[\s\S]*newAppointmentId[\s\S]*notificationRevision/)
  assert.match(writer, /v_base_payload - array\[[\s\S]*'source_event_id'[\s\S]*'occurred_at'/)
  assert.match(writer, /'occurred_at', v_occurred_at/)
  assert.match(sql, /registration_appointment_track_ids_v1/)
  assert.match(sql, /registration_appointment_director_targets_v1/)
  assert.match(sql, /jsonb_agg\(distinct|array_agg\(distinct/)
  assert.match(sql, /materialize_registration_visit_legacy_in_app_v1/)
  assert.match(sql, /materialize_registration_visit_legacy_google_chat_v1/)
  assert.match(sql, /finalize_legacy_notification_dispatch_v1/)
  assert.match(finalizeVisit, /finalize_legacy_notification_dispatch_v1/)
  assert.match(finalizeVisit, /canonicalDeliveryStatus'[\s\S]*v_delivery\.status/)
  assert.doesNotMatch(finalizeVisit, /update dashboard_private\.notification_deliveries/)
})

test("SOLAPI reuses the business request key and preserves every terminal and recovery state", async () => {
  const sql = await source(migrationUrl)
  assert.match(sql, /ops_registration_messages/)
  assert.match(sql, /message_request_key|request_key/)
  assert.match(sql, /registration\.admission_message_requested/)
  assert.match(sql, /registration\.admission_message_accepted/)
  assert.match(sql, /registration\.admission_message_failed/)
  assert.match(sql, /registration\.admission_message_unknown/)
  assert.match(sql, /registration\.admission_message_reconciled/)
  assert.match(sql, /registration\.admission_message_retry_released/)
  assert.match(sql, /begin_registration_admission_delivery_v1/)
  assert.match(sql, /finalize_registration_admission_delivery_v1/)
  assert.doesNotMatch(sql, /parent_phone[\s\S]{0,180}(?:notification_events|record_notification_event_v1)/i)
})

test("browser registration core sends only stable source event IDs", async () => {
  const [sql, service, workspace, route] = await Promise.all([
    source(migrationUrl),
    source(serviceUrl),
    source(workspaceUrl),
    source(opsRouteUrl),
  ])
  assert.match(service, /list_registration_legacy_source_ids_v1/)
  assert.match(service, /sourceEventIds/)
  assert.match(workspace, /dispatchLegacyOpsTaskSources/)
  assert.doesNotMatch(workspace, /async function notifyRegistrationWorkflow/)
  assert.match(route, /sourceEventId/)
  assert.match(route, /registration/)
  assert.doesNotMatch(route, /body\.(?:title|message|target|href|channel)/)
  const plan = functionBlock(sql, "public.get_registration_core_legacy_dispatch_plan_v1")
  assert.match(plan, /jsonb_array_elements\(v_canonical\.rule_snapshot\)/)
  assert.match(plan, /template\.id = \(snapshot\.item ->> 'template_id'\)::uuid/)
  assert.doesNotMatch(plan, /notification_rules|active_template_id/)
})

test("registration management Chat bridge is producer-scoped, deduplicated, and worker-independent", async () => {
  const sql = await source(managementDispatchMigrationUrl)
  const recorder = functionBlock(
    sql,
    "dashboard_private.record_registration_management_notification_v1",
  )
  const caseProducer = functionBlock(
    sql,
    "public.ensure_registration_case_created_notification_v1",
  )
  const workflowProducer = functionBlock(
    sql,
    "public.ensure_registration_workflow_notification_v1",
  )
  const list = functionBlock(sql, "public.list_registration_legacy_source_ids_v1")
  const plan = functionBlock(sql, "public.get_registration_core_legacy_dispatch_plan_v1")

  assert.match(recorder, /record_notification_event_v1/)
  assert.match(recorder, /source_type[\s\S]*ops_task_event/i)
  assert.match(caseProducer, /registration_case_created/)
  assert.match(caseProducer, /pg_advisory_xact_lock/)
  assert.match(workflowProducer, /registration_workflow_status_changed/)
  assert.match(workflowProducer, /p_workflow_revision/)
  assert.match(workflowProducer, /consultation_completed[\s\S]*registration\.consultation_completed/)
  assert.match(workflowProducer, /waiting_current_class[\s\S]*registration\.waiting_transitioned/)
  assert.match(workflowProducer, /enrollment_requested[\s\S]*registration\.admission_started/)

  for (const eventKey of [
    "registration.case_created",
    "registration.consultation_completed",
    "registration.waiting_transitioned",
    "registration.admission_started",
  ]) {
    assert.match(list, new RegExp(eventKey.replace(".", "\\.")))
    assert.match(plan, new RegExp(eventKey.replace(".", "\\.")))
  }
  assert.match(plan, /registration_render_fixed_template_v2/)
  assert.match(plan, /template\.allowed_variables/)
  assert.match(plan, /&trackId=/)
  assert.match(plan, /google_chat\.management/)
  assert.doesNotMatch(sql, /notification_control_plane_dispatch_registration_enabled[\s\S]*true/)
  assert.doesNotMatch(sql, /assert_notification_worker_run_allowed|process_notification|notification_event_fanout_jobs[\s\S]*(?:delete|update)/i)
})

test("visit route accepts only appointmentId and delegates rendering and ownership to server RPCs", async () => {
  const route = await source(visitRouteUrl)
  assert.match(route, /Object\.keys\(body\)/)
  assert.match(route, /appointmentId/)
  assert.doesNotMatch(route, /body\.(?:title|message|target|href|recipient)/)
  assert.match(route, /get_registration_visit_legacy_dispatch_plan_v1/)
  assert.match(route, /commit_registration_visit_legacy_in_app_v1/)
  assert.match(route, /materialize_registration_visit_legacy_google_chat_v1/)
  assert.match(route, /begin_registration_visit_legacy_google_chat_v1/)
  assert.doesNotMatch(route, /materialize_registration_visit_legacy_in_app_v1/)
  assert.doesNotMatch(route, /commit_legacy_notification_in_app_projection_v1/)
  assert.match(route, /finalize_registration_visit_legacy_google_chat_v1/)
})

test("legacy SOLAPI route is compatibility-only and cannot acquire or finalize delivery ownership", async () => {
  const [route, core] = await Promise.all([source(solapiRouteUrl), source(solapiCoreUrl)])
  assert.match(route, /createProductionRegistrationCustomerMessageRouteHandlers/)
  assert.match(core, /handleLegacyRegistrationGet/)
  assert.match(core, /handleLegacyRegistrationPost/)
  assert.doesNotMatch(`${route}\n${core}`, /begin_registration_admission_delivery_v1|complete_registration_admission_delivery_v1|deps\.beginDelivery|deps\.completeDelivery|SOLAPI_SEND_URL/)
})

test("registration customer message adapter is the only reachable SOLAPI provider owner", async () => {
  const [rootRoute, rootCore, customerMessageSolapi] = await Promise.all([
    source(solapiRouteUrl),
    source(solapiCoreUrl),
    source(customerMessageSolapiUrl),
  ])

  assert.doesNotMatch(`${rootRoute}\n${rootCore}`, /send-many\/detail|await deps\.fetch|register_notification_external_attempt_v1/)
  assert.match(customerMessageSolapi, /SOLAPI_SEND_MANY_URL = "https:\/\/api\.solapi\.com\/messages\/v4\/send-many\/detail"/)
  assert.match(customerMessageSolapi, /disableSms: true/)
})

test("registration customer message send reads preview ownership through the hardened RPC", async () => {
  const route = await source(customerMessageRouteUrl)
  assert.match(route, /read_registration_customer_message_preview_target_v1/)
  assert.doesNotMatch(
    route,
    /\.from\(["']ops_registration_customer_message_previews["']\)/,
  )
})

test("등록 외부 발송은 소유권 확보 뒤 시도 등록기를 통과해야만 provider를 호출한다", async () => {
  const [opsRoute, visitRoute, solapiRoute, solapiCore] = await Promise.all([
    source(opsRouteUrl),
    source(visitRouteUrl),
    source(solapiRouteUrl),
    source(solapiCoreUrl),
  ])

  const opsBegin = opsRoute.indexOf("await beginLegacyDispatch")
  const opsRegister = opsRoute.indexOf("register_notification_external_attempt_v1")
  const opsProvider = opsRoute.indexOf("await provider.send")
  assert.ok(opsBegin >= 0 && opsRegister > opsBegin && opsProvider > opsRegister)
  assert.match(opsRoute, /normalizedNotificationRenderedHash/)
  assert.match(opsRoute, /TEMPLATE_CHECKSUM\.test\(item\.templateChecksum\)/)
  assert.match(opsRoute, /p_legacy_template_checksum:\s*item\.templateChecksum/)
  assert.doesNotMatch(opsRoute, /function normalizedRenderedHash/)

  const visitBegin = visitRoute.indexOf("begin_registration_visit_legacy_google_chat_v1")
  const visitIntent = visitRoute.indexOf("record_legacy_notification_delivery_intent_v1")
  const visitRegister = visitRoute.indexOf("register_notification_external_attempt_v1")
  const visitProvider = visitRoute.indexOf("await provider.send")
  assert.ok(
    visitBegin >= 0
      && visitIntent > visitBegin
      && visitRegister > visitIntent
      && visitProvider > visitRegister,
  )

  assert.match(visitRoute, /legacyTemplateChecksum:\s*item\.templateChecksum/)
  assert.match(visitRoute, /TEMPLATE_CHECKSUM\.test\(item\.templateChecksum\)/)
  assert.match(visitRoute, /p_legacy_template_checksum:\s*intent\.legacyTemplateChecksum/)
  assert.doesNotMatch(`${solapiRoute}\n${solapiCore}`, /record_legacy_notification_delivery_intent_v1|register_notification_external_attempt_v1|await deps\.fetch|SOLAPI_SEND_URL/)
})

test("등록 방문·SOLAPI legacy plan은 provider 직전에 불변 template checksum을 반환한다", async () => {
  const sql = await source(migrationUrl)
  const visitPlan = functionBlock(sql, "public.get_registration_visit_legacy_dispatch_plan_v1")
  const solapiBegin = functionBlock(sql, "public.begin_registration_admission_delivery_v1")
  assert.match(visitPlan, /template\.checksum|template_checksum/)
  assert.match(visitPlan, /'templateChecksum'/)
  assert.match(solapiBegin, /'templateChecksum',\s*v_template\.checksum/)
})

test("registration immediate 권위 재검증은 raw track, appointment, message source를 각각 다시 읽는다", async () => {
  const sql = await source(workerMigrationUrl)
  const revalidator = functionBlock(sql, "public.revalidate_immediate_notification_delivery_v1")
  assert.match(revalidator, /when 'ops_task_event'[\s\S]*source\.event_type = 'registration_track_event'/)
  assert.match(revalidator, /registration_track_event_key_v1/)
  assert.match(revalidator, /when 'registration_appointment'/)
  assert.match(revalidator, /notification_revision[\s\S]*recipient_revision/)
  assert.match(revalidator, /appointment\.recipient_revision = p_target_generation/)
  assert.match(revalidator, /p_event_key = 'registration\.visit_replaced'[\s\S]*appointment\.status in \('scheduled', 'canceled'\)/)
  assert.match(revalidator, /when 'ops_registration_message'/)
  assert.match(revalidator, /message\.request_key[\s\S]*request_key_hash/)
  assert.match(revalidator, /notification_profile_is_active_v1/)
})

test("visit inbox는 materialize와 commit을 한 RPC transaction으로 닫고 Chat begin key는 안정적이다", async () => {
  const [sql, route] = await Promise.all([source(migrationUrl), source(visitRouteUrl)])
  const commit = functionBlock(sql, "public.commit_registration_visit_legacy_in_app_v1")
  const beginChat = functionBlock(sql, "public.begin_registration_visit_legacy_google_chat_v1")
  assert.match(commit, /materialize_registration_visit_legacy_in_app_v1/)
  assert.match(commit, /commit_legacy_notification_in_app_projection_v1/)
  assert.match(beginChat, /notification_deterministic_uuid_v1\([\s\S]*p_request_id::text[\s\S]*v_expected_owner_generation::text/)
  assert.match(beginChat, /begin_legacy_notification_dispatch_v1\([\s\S]*v_attempt_request_id/)
  assert.match(beginChat, /update dashboard_private\.notification_dispatch_ownership_claims ownership[\s\S]*owner_generation = v_expected_owner_generation,[\s\S]*state = 'reserved'/)
  assert.match(beginChat, /legacy_failed_target_retry_rearmed/)
  assert.doesNotMatch(beginChat, /update dashboard_private\.notification_deliveries/)
  assert.match(route, /commit_registration_visit_legacy_in_app_v1/)
  assert.doesNotMatch(route, /randomUUID/)
  assert.match(route, /deterministicRequestId\([\s\S]*registration-visit-google-chat-v1/)
})

test("방문 Chat begin 재실행은 요청 identity를 검증하고 미확정 전달로 원자 종결한다", async () => {
  const [sql, route] = await Promise.all([source(migrationUrl), source(visitRouteUrl)])
  const beginChat = functionBlock(sql, "public.begin_registration_visit_legacy_google_chat_v1")
  assert.match(beginChat, /'request_id',\s*p_request_id/)
  assert.match(route, /const requestId = deterministicRequestId\(/)
  assert.match(route, /function isInterruptedDispatchReplay\([\s\S]*dispatch_already_started[\s\S]*idempotent_dispatch_replay/)
  assert.match(route, /text\(value\.request_id\) === expectedRequestId/)
  assert.match(route, /UUID\.test\(text\(value\.claim_id\)\)[\s\S]*\^\\d\+\$[\s\S]*UUID\.test\(text\(value\.dispatch_token\)\)/)
  assert.match(
    route,
    /if \(isInterruptedDispatchReplay\(begun, requestId\)\)[\s\S]*finalizeGoogleChat\([\s\S]*"delivery_unknown"[\s\S]*"legacy_dispatch_recovered_after_interruption"[\s\S]*return "delivery_unknown"/,
  )
  assert.doesNotMatch(route, /if \(!begun\.acquired\) return "deduped"/)
  assert.ok(
    route.indexOf("isInterruptedDispatchReplay(begun, requestId)")
      < route.indexOf("await provider.send"),
    "중단 재실행은 provider 호출 전에 종결해야 합니다.",
  )
})

test("compatibility plan은 immutable event rule/template snapshot만 사용한다", async () => {
  const sql = await source(migrationUrl)
  for (const name of [
    "dashboard_private.materialize_registration_phone_legacy_v1",
    "public.get_registration_visit_legacy_dispatch_plan_v1",
    "public.begin_registration_admission_delivery_v1",
  ]) {
    const block = functionBlock(sql, name)
    assert.match(block, /rule_snapshot/)
    assert.match(block, /template\.id = \(snapshot\.item ->> 'template_id'\)::uuid/)
    assert.doesNotMatch(block, /rule_row\.active_template_id/)
  }
})

test("SOLAPI는 일반 worker가 아닌 canonical specialized claim과 원자 완료 RPC로 실행된다", async () => {
  const [sql, workerSql, providerClaimSql, route, core] = await Promise.all([
    source(migrationUrl),
    source(controlPlaneWorkerMigrationUrl),
    source(providerClaimMigrationUrl),
    source(solapiRouteUrl),
    source(solapiCoreUrl),
  ])
  const begin = functionBlock(sql, "public.begin_registration_admission_delivery_v1")
  const legacyFinalize = functionBlock(sql, "public.finalize_registration_admission_delivery_v1")
  const complete = functionBlock(sql, "public.complete_registration_admission_delivery_v1")
  assert.match(begin, /owner_kind[\s\S]*canonical/)
  assert.match(begin, /pg_advisory_xact_lock[\s\S]*registration-admission-message:/)
  assert.ok(
    begin.indexOf("pg_advisory_xact_lock") < begin.indexOf("select message.* into v_message"),
    "SOLAPI begin은 업무 단위 advisory lock을 먼저 잡아 reaper·완료와 직렬화해야 합니다.",
  )
  assert.match(begin, /begin_notification_delivery_send_v1/)
  assert.match(begin, /claim_token/)
  assert.match(legacyFinalize, /finalize_legacy_notification_dispatch_v1/)
  assert.match(legacyFinalize, /canonicalDeliveryStatus'[\s\S]*v_delivery\.status/)
  assert.doesNotMatch(legacyFinalize, /update dashboard_private\.notification_deliveries/)
  assert.match(complete, /finalize_registration_admission_message_impl/)
  assert.match(complete, /currentStatus'[\s\S]*p_result[\s\S]*registration_admission_delivery_business_conflict/)
  assert.match(complete, /finalize_notification_delivery_v1|finalize_legacy_notification_dispatch_v1/)
  assert.doesNotMatch(workerSql, /delivery\.channel_key <> 'customer_message'/)
  assert.match(providerClaimSql, /create or replace function public\.claim_notification_deliveries_v1/)
  assert.match(providerClaimSql, /delivery\.channel_key <> 'customer_message'/)
  assert.match(route, /createProductionRegistrationCustomerMessageRouteHandlers/)
  assert.doesNotMatch(route, /complete_registration_admission_delivery_v1|finalize_registration_admission_delivery_v1/)
  assert.doesNotMatch(core, /deps\.completeDelivery|await deps\.finalize|await deps\.finalizeDelivery/)
})

test("SOLAPI business claim replay can reach begin before any provider dispatch", async () => {
  const sql = await source(migrationUrl)
  const claim = functionBlock(sql, "public.claim_registration_admission_message")
  assert.match(claim, /security definer/)
  assert.match(claim, /auth\.uid\(\)[\s\S]*current_dashboard_role\(\)[\s\S]*\('admin', 'staff'\)/)
  assert.match(claim, /claimStatus'[\s\S]*pending/)
  assert.match(claim, /messageRequestKey'[\s\S]*p_message_request_key/)
  assert.match(claim, /shouldSend'[\s\S]*true/)
  assert.match(claim, /dispatch_started|notification_dispatch_ownership_claims/)
})

test("SOLAPI provider evidence recovery는 canonical delivery와 legacy ownership을 소유자별로 닫는다", async () => {
  const sql = await source(migrationUrl)
  const helper = functionBlock(
    sql,
    "dashboard_private.reconcile_registration_admission_delivery_state_v1",
  )
  assert.match(helper, /source_type = 'ops_registration_message'/)
  assert.match(helper, /source_id = p_message_id::text/)
  assert.match(helper, /delivery\.channel_key = 'customer_message'/)
  assert.match(helper, /v_message\.status is distinct from \(case p_outcome[\s\S]*when 'sent' then 'accepted'[\s\S]*when 'failed' then 'failed'[\s\S]*else 'unknown'/)
  assert.match(helper, /for update of delivery/)
  assert.match(helper, /notification_dispatch_ownership_claims/)
  assert.match(helper, /set status = v_target_status[\s\S]*claimed_by = null[\s\S]*lease_expires_at = null/)
  assert.match(helper, /set state = 'closed'[\s\S]*terminal_outcome = p_outcome/)
  assert.match(helper, /p_allow_failed_to_sent[\s\S]*v_delivery\.status = 'failed'[\s\S]*p_outcome = 'sent'/)
  assert.match(helper, /v_unknown_resolution[\s\S]*v_delivery\.status = 'delivery_unknown'[\s\S]*p_outcome in \('sent', 'failed'\)/)
  assert.match(helper, /terminal_outcome in \('delivery_unknown', p_outcome\)/)
  assert.match(helper, /v_expected_attempt_count[\s\S]*dispatch_token is not null[\s\S]*owner_generation \+ 1/)
  assert.match(helper, /attempt_count = greatest\(delivery\.attempt_count, v_expected_attempt_count\)[\s\S]*max_attempts = greatest\(delivery\.max_attempts, v_expected_attempt_count\)/)
  assert.match(helper, /if v_delivery\.status = v_target_status[\s\S]*terminal_outcome = p_outcome[\s\S]*continue;/)

  const legacyOwnerGuard = helper.indexOf("if v_ownership.owner_kind = 'legacy' then")
  const legacyOwnerContinue = helper.indexOf("continue;", legacyOwnerGuard)
  const canonicalDeliveryUpdate = helper.indexOf("update dashboard_private.notification_deliveries delivery")
  assert.ok(legacyOwnerGuard >= 0, "legacy owner reconciliation must have an explicit immutable-delivery branch")
  assert.ok(
    legacyOwnerGuard < legacyOwnerContinue && legacyOwnerContinue < canonicalDeliveryUpdate,
    "legacy owner reconciliation must close ownership and continue before canonical delivery mutation",
  )
  const legacyOwnerBranch = helper.slice(legacyOwnerGuard, canonicalDeliveryUpdate)
  assert.match(legacyOwnerBranch, /update dashboard_private\.notification_dispatch_ownership_claims ownership/)
  assert.match(legacyOwnerBranch, /'notification_dispatch_ownership'/)
  assert.doesNotMatch(legacyOwnerBranch, /update dashboard_private\.notification_deliveries delivery/)
  assert.match(helper, /v_ownership\.owner_kind = 'legacy'[\s\S]*v_ownership\.terminal_outcome = 'failed'/)
  assert.match(helper, /v_ownership\.owner_kind = 'legacy'[\s\S]*v_ownership\.terminal_outcome in \('delivery_unknown', p_outcome\)/)

  for (const name of [
    "public.finalize_registration_admission_message",
    "public.reconcile_registration_admission_message",
    "public.release_registration_admission_message_retry",
  ]) {
    const wrapper = functionBlock(sql, name)
    assert.match(wrapper, /reconcile_registration_admission_delivery_state_v1/)
    assert.match(wrapper, /registration-admission-message:/)
  }
  const complete = functionBlock(sql, "public.complete_registration_admission_delivery_v1")
  assert.match(complete, /registration-admission-message:/)
  assert.doesNotMatch(complete, /reconcile_registration_admission_delivery_state_v1/)
})

test("admission delivery reconciliation parenthesizes the outcome-to-business-status CASE", async () => {
  const sql = await source(migrationUrl)
  const helper = functionBlock(
    sql,
    "dashboard_private.reconcile_registration_admission_delivery_state_v1",
  )
  assert.match(
    helper,
    /if v_message\.status is distinct from \(\s*case p_outcome\s*when 'sent' then 'accepted'\s*when 'failed' then 'failed'\s*else 'unknown'\s*end\s*\) then/,
  )
})

test("customer_message delivery는 일반 수동 reconciliation으로 우회할 수 없다", async () => {
  const sql = await source(providerClaimMigrationUrl)
  const reconcile = functionBlock(sql, "public.reconcile_notification_delivery_v1")
  assert.match(reconcile, /v_delivery\.channel_key = 'customer_message'/)
  assert.match(reconcile, /notification_customer_message_specialized_executor_required/)
  assert.match(reconcile, /for update of delivery/)
})

test("등록 알림 KST 형식 함수는 PostgreSQL extract 문법을 사용한다", async () => {
  const sql = await source(contentMigrationUrl)
  const formatter = functionBlock(
    sql,
    "dashboard_private.registration_notification_kst_datetime_v1",
  )

  assert.match(formatter, /\bextract\(year from p_value at time zone 'Asia\/Seoul'\)/i)
  assert.match(formatter, /\bextract\(dow from p_value at time zone 'Asia\/Seoul'\)/i)
  assert.doesNotMatch(formatter, /pg_catalog\.extract\s*\(/i)
})

test("전화상담 담당 배정은 active template canonical projection 하나만 남기고 직접 문구를 만들지 않는다", async () => {
  const sql = await source(contentMigrationUrl)
  const assign = functionBlock(sql, "dashboard_private.assign_registration_track_director_impl")
  const phoneProjection = functionBlock(
    sql,
    "dashboard_private.materialize_registration_phone_legacy_v1",
  )

  assert.doesNotMatch(assign, /\[.*전화상담 대기|학생 상담을 확인하세요/)
  assert.doesNotMatch(assign, /insert into public\.dashboard_notifications/)
  assert.match(assign, /write_registration_track_event/)
  assert.match(assign, /source_delivery_id is not null/)
  assert.match(assign, /notification\.metadata ->> 'consultationId'/)
  assert.match(assign, /notification_deliveries delivery/)
  assert.match(assign, /v_notification_id is null and not v_canonical_projection_exists/)

  assert.match(phoneProjection, /notification_rules rule/)
  assert.match(phoneProjection, /rule\.active_template_id/)
  assert.match(phoneProjection, /notification_templates template/)
  assert.match(phoneProjection, /template\.allowed_variables/)
  assert.match(phoneProjection, /registration_render_fixed_template_v2/)
  assert.match(phoneProjection, /commit_legacy_notification_in_app_projection_v1/)
  assert.doesNotMatch(phoneProjection, /\[.*전화상담 대기|학생 상담을 확인하세요/)
})

test("등록 전용 renderer는 한국어 token을 영문 payload key로 매핑하고 legacy key도 유지한다", async () => {
  const sql = await source(koreanRendererMigrationUrl)
  const renderer = functionBlock(
    sql,
    "dashboard_private.registration_render_fixed_template_v2",
  )

  assert.match(renderer, /variable\.item ->> 'key' as key/)
  assert.match(renderer, /variable\.item ->> 'token' as token/)
  assert.match(renderer, /p_payload -> v_variable\.key/)
  assert.match(renderer, /p_payload ->> v_variable\.key/)
  assert.match(renderer, /'\{' \|\| v_variable\.key \|\| '\}'/)
  assert.match(renderer, /'\{' \|\| v_variable\.token \|\| '\}'/)
  assert.match(renderer, /registration_notification_template_token_not_allowed/)
  assert.doesNotMatch(sql, /notification_runtime_flags|send_google_chat|solapi|http_post|net\.http/i)
})

test("등록 event writer는 전후 일정·장소와 제외·잔여 과목을 명시적 null·빈 배열로 snapshot한다", async () => {
  const sql = await source(contentMigrationUrl)
  const writerEntry = functionBlock(sql, "dashboard_private.write_registration_track_event_v2")
  const writer = functionBlock(sql, "dashboard_private.write_registration_track_event_payload_v3")
  assert.match(writerEntry, /write_registration_track_event_payload_v3/)
  for (const key of [
    "before_scheduled_at", "after_scheduled_at", "before_place", "after_place",
    "subjects", "deselected_subjects", "remaining_subjects", "actor_name", "actor_team",
    "registered_subjects", "registered_classes", "progress_actor",
  ]) assert.match(writer, new RegExp(`'${key}'`), `등록 표시 snapshot key 누락: ${key}`)

  assert.match(writer, /v_metadata -> 'activeTrackIds'/)
  assert.match(writer, /v_metadata -> 'canceledTrackIds'/)
  assert.match(writer, /from dashboard_private\.notification_events previous_event/)
  assert.match(writer, /jsonb_strip_nulls[\s\S]*\|\| pg_catalog\.jsonb_build_object\([\s\S]*'before_scheduled_at'/)
  assert.match(writer, /record_notification_event_v1\([\s\S]*case when v_event_key in \([\s\S]*then 1 else 2 end/)
})
