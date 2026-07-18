import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260716194000_notification_registration_handoffs.sql",
  import.meta.url,
)
const serviceUrl = new URL("../src/features/tasks/registration-track-service.ts", import.meta.url)
const workspaceUrl = new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url)
const opsRouteUrl = new URL("../src/app/api/notifications/legacy/ops-task/route.ts", import.meta.url)
const visitRouteUrl = new URL("../src/app/api/registration/consultation-notification/route.ts", import.meta.url)
const solapiRouteUrl = new URL("../src/app/api/solapi/registration/route.ts", import.meta.url)
const solapiCoreUrl = new URL("../src/app/api/solapi/registration/core.js", import.meta.url)
const workerMigrationUrl = new URL(
  "../supabase/migrations/20260716195500_notification_worker_schedule.sql",
  import.meta.url,
)
const controlPlaneWorkerMigrationUrl = new URL(
  "../supabase/migrations/20260716112000_notification_control_plane_worker_rpc.sql",
  import.meta.url,
)
const providerClaimMigrationUrl = new URL(
  "../supabase/migrations/20260716195800_notification_registration_provider_claim.sql",
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

test("SOLAPI route acquires shared ownership before provider work and finalizes unknown", async () => {
  const [route, core] = await Promise.all([source(solapiRouteUrl), source(solapiCoreUrl)])
  assert.match(route, /begin_registration_admission_delivery_v1/)
  assert.match(route, /complete_registration_admission_delivery_v1/)
  assert.match(core, /deps\.beginDelivery/)
  assert.match(core, /deps\.completeDelivery/)
  const begin = core.indexOf("await deps.beginDelivery")
  const send = core.indexOf("await deps.fetch(SOLAPI_SEND_URL")
  assert.ok(begin >= 0 && send > begin)
  assert.match(core, /result:\s*"unknown"/)
  assert.match(core, /outcome:\s*"delivery_unknown"/)
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

  assert.match(solapiRoute, /record_legacy_notification_delivery_intent_v1/)
  assert.match(visitRoute, /legacyTemplateChecksum:\s*item\.templateChecksum/)
  assert.match(visitRoute, /TEMPLATE_CHECKSUM\.test\(item\.templateChecksum\)/)
  assert.match(visitRoute, /p_legacy_template_checksum:\s*intent\.legacyTemplateChecksum/)
  assert.match(solapiCore, /const legacyTemplateChecksum = text\(delivery\.templateChecksum\)/)
  assert.match(solapiCore, /TEMPLATE_CHECKSUM\.test\(legacyTemplateChecksum\)/)
  assert.match(solapiCore, /legacyTemplateChecksum,\s*\n\s*title:/)
  assert.match(solapiRoute, /p_legacy_template_checksum:\s*input\.legacyTemplateChecksum/)
  assert.match(solapiRoute, /register_notification_external_attempt_v1/)
  assert.match(solapiRoute, /p_delivery_id:\s*input\.claimToken\s*\?\s*input\.deliveryId\s*:\s*null/)
  assert.match(solapiRoute, /p_request_id:\s*input\.dispatchToken/)
  const solapiBegin = solapiCore.indexOf("await deps.beginDelivery")
  const solapiIntent = solapiCore.indexOf("recordLegacyNotificationDeliveryIntent", solapiBegin)
  const solapiRegister = solapiCore.indexOf("deps.registerExternalAttempt")
  const solapiProvider = solapiCore.indexOf("await deps.fetch(SOLAPI_SEND_URL")
  assert.ok(
    solapiBegin >= 0
      && solapiIntent > solapiBegin
      && solapiRegister > solapiIntent
      && solapiProvider > solapiRegister,
  )
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
  assert.match(route, /complete_registration_admission_delivery_v1/)
  assert.doesNotMatch(route, /finalize_registration_admission_delivery_v1/)
  assert.match(core, /deps\.completeDelivery/)
  assert.doesNotMatch(core, /await deps\.finalize\([\s\S]{0,500}await deps\.finalizeDelivery/)
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
