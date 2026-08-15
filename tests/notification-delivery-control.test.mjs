import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL("../supabase/migrations/20260815120000_event_driven_notification_worker.sql", import.meta.url)
const retryIndexMigrationUrl = new URL("../supabase/migrations/20260815123000_notification_manual_retry_indexes.sql", import.meta.url)
const serviceUrl = new URL("../src/features/notifications/notification-delivery-service.ts", import.meta.url)
const controlUrl = new URL("../src/features/notifications/notification-delivery-control.tsx", import.meta.url)
const getRouteUrl = new URL("../src/app/api/notifications/events/[eventId]/route.ts", import.meta.url)
const retryRouteUrl = new URL("../src/app/api/notifications/events/[eventId]/retry/route.ts", import.meta.url)
const legacyRouteUrl = new URL("../src/app/api/notifications/legacy/ops-task/route.ts", import.meta.url)
const registrationNotificationUrl = new URL("../src/features/tasks/registration-consultation-notification.js", import.meta.url)
const registrationEditorUrl = new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url)
const workspaceUrl = new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url)

test("event status and manual retry keep sent targets immutable and unknown explicit", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  assert.match(sql, /get_google_chat_notification_event_status_v1\(p_event_id uuid\)/i)
  assert.match(sql, /when .*delivery_unknown.* then 'unknown'[\s\S]*when .*pending.*sending.* then 'processing'/i)
  assert.match(sql, /retry_google_chat_notification_event_v1\([\s\S]*p_confirmed_absent boolean/i)
  assert.match(sql, /status = 'sent'[\s\S]*notification_already_sent/i)
  assert.match(sql, /delivery_unknown[\s\S]*p_confirmed_absent[\s\S]*notification_retry_confirmation_required/i)
  assert.match(sql, /notification_event_fanout_jobs[\s\S]*interval '5 seconds'[\s\S]*'delayed'/i)
  assert.match(sql, /delivery\.status in \('failed', 'delivery_unknown'\)/i)
  assert.doesNotMatch(sql, /delivery\.status not in \('sent', 'disabled', 'canceled', 'skipped'\)/i)
  assert.match(sql, /notification_event_fanout_jobs job[\s\S]*set status = 'pending'[\s\S]*job\.status in \('failed', 'pending'\)/i)
  assert.match(sql, /request_notification_worker_wakeup_v1\('manual_retry'\)/i)
  assert.doesNotMatch(sql, /pg_catalog\.greatest/i)
})

test("manual retry audit foreign keys have bounded lookup indexes", async () => {
  const sql = await readFile(retryIndexMigrationUrl, "utf8")
  assert.match(sql, /create index notification_manual_retry_requests_event_idx[\s\S]*\(event_id, created_at desc\)/i)
  assert.match(sql, /create index notification_manual_retry_requests_actor_idx[\s\S]*\(actor_profile_id, created_at desc\)/i)
})

test("authenticated routes accept only the closed retry body", async () => {
  const [getRoute, retryRoute] = await Promise.all([readFile(getRouteUrl, "utf8"), readFile(retryRouteUrl, "utf8")])
  assert.match(getRoute, /get_google_chat_notification_event_status_v1/)
  assert.match(retryRoute, /\["requestId", "confirmedAbsent"\]/)
  assert.match(retryRoute, /retry_google_chat_notification_event_v1/)
  assert.match(`${getRoute}\n${retryRoute}`, /Cache-Control["']?:\s*["']no-store/)
  assert.doesNotMatch(`${getRoute}\n${retryRoute}`, /code:\s*error\.message/)
})

test("workflow-local control reads only immediately, after 2s, and after 5s", async () => {
  const [service, control] = await Promise.all([readFile(serviceUrl, "utf8"), readFile(controlUrl, "utf8")])
  assert.match(service, /readGoogleChatDeliveryStatus/)
  assert.match(service, /retryGoogleChatDelivery/)
  assert.match(control, /setTimeout[\s\S]*2000[\s\S]*setTimeout[\s\S]*5000/)
  assert.doesNotMatch(control, /setInterval/)
  assert.match(control, /Google Chat 재발송/)
  assert.match(control, /Google Chat 전송 지연/)
  assert.match(control, /Google Chat 방에 메시지가 없음을 확인했습니다/)
  assert.match(control, /setConfirmedAbsent\(false\)/)
})

test("registration workflow returns canonical event ids and shows delivery control beside status", async () => {
  const [route, dispatcher, editor] = await Promise.all([
    readFile(legacyRouteUrl, "utf8"),
    readFile(registrationNotificationUrl, "utf8"),
    readFile(registrationEditorUrl, "utf8"),
  ])
  assert.match(route, /eventIds:\s*items\.map\(\(item\) => item\.eventId\)/)
  assert.match(dispatcher, /googleChatEventIds/)
  assert.match(dispatcher, /payload\?\.eventIds/)
  assert.match(editor, /GoogleChatDeliveryControl/)
  assert.match(editor, /setLatestGoogleChatEventId/)
  assert.match(editor, /data-registration-workflow-status[\s\S]*GoogleChatDeliveryControl/)
})

test("task workflow tracks canonical event ids and shows delivery control beside actions", async () => {
  const workspace = await readFile(workspaceUrl, "utf8")
  assert.match(workspace, /dispatchLegacyOpsTaskSourcesRequest/)
  assert.match(workspace, /setLatestGoogleChatEventId/)
  assert.match(workspace, /eventIds/)
  assert.match(workspace, /detailPrimaryAction[\s\S]*GoogleChatDeliveryControl/)
})
