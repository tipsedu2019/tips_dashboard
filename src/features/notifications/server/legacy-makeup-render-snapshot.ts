import type { NotificationConnectionKey, NotificationDestinationTeam } from "../notification-control-plane-types.ts"
import { renderNotificationSnapshot } from "./notification-worker.ts"
import { buildMakeupNotificationPresentation } from "./presentation/makeup-notification-presentation.ts"

type RecordValue = Record<string, unknown>
type PlanIdentity = Readonly<{
  eventId: string
  eventKey: string
  occurrenceKey: string
  ruleId: string
  ruleRevision: string
  templateId: string
  templateChecksum: string
  channelKey: "in_app" | "google_chat"
  audienceKey: string
  connectionKey: string | null
  href: string
  scheduledFor: string
}>

function invalid(): never {
  throw new Error("makeup_legacy_render_snapshot_invalid")
}

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid()
  return value as RecordValue
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) invalid()
  return value
}

const DESTINATIONS: Readonly<Partial<Record<NotificationConnectionKey, NotificationDestinationTeam>>> = {
  "google_chat.management": "management",
  "google_chat.executive": "executive",
  "google_chat.math": "math",
  "google_chat.english": "english",
  "google_chat.science": "science",
}

// Exact pairs implemented by notification_makeup_render_template_v1. A shared
// key with a newer token (e.g. teacher_name/담당선생님) must not fall back to v1.
const LEGACY_TOKENS: Readonly<Record<string, string>> = {
  process: "프로세스", status: "상태", class_name: "수업", subject: "과목",
  teacher_name: "선생님", reason: "사유", cancel_date: "휴강일",
  makeup_at: "보강일시", makeup_room_spaced: "보강 강의실", makeup_room: "보강강의실",
  requester_name: "신청자", submitted_at: "상신일시", revision_requested_at: "보완요청일시",
  revision_reason: "보완 사유", approved_at: "승인일시", approval_note: "승인 메모",
  rejected_at: "반려일시", rejected_reason: "반려 사유", canceled_at: "승인취소일시",
  canceled_note: "승인취소 메모", approver_name: "결재자", fallback_title: "제목", fallback_body: "본문",
}

// Only the authenticated server route calls this with the immutable event/rule
// snapshot read by service_role. HTTP clients cannot supply this envelope.
// Old snapshots keep the v1 DB renderer, including its original date semantics.
export function renderLegacyMakeupSnapshot(
  item: PlanIdentity,
  sourceEventId: string,
  value: unknown,
) {
  if (item.channelKey !== "google_chat") invalid()
  const snapshot = record(value)
  const expected = {
    event_id: item.eventId,
    workflow_key: "makeup_requests",
    event_key: item.eventKey,
    occurrence_key: item.occurrenceKey,
    source_type: "makeup_request_event",
    source_id: sourceEventId,
    rule_id: item.ruleId,
    rule_revision: item.ruleRevision,
    template_id: item.templateId,
    channel_key: item.channelKey,
    audience_key: item.audienceKey,
    occurred_at: item.scheduledFor,
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (snapshot[key] !== expectedValue) invalid()
  }
  if (!Array.isArray(snapshot.allowed_variables)) invalid()
  const variables = snapshot.allowed_variables.map((entry) => {
    const variable = record(entry)
    return {
      key: text(variable.key), token: text(variable.token),
      piiClass: text(variable.piiClass ?? variable.pii_class),
    }
  })
  if (variables.some(({ key, token }) => !/^[a-z][a-z0-9_]{0,63}$/.test(key) || /[{}]/.test(token))
    || new Set(variables.map(({ key }) => key)).size !== variables.length
    || new Set(variables.map(({ token }) => token)).size !== variables.length) invalid()
  if (variables.every(({ key, token }) => LEGACY_TOKENS[key] === token)) return null

  const titleTemplate = text(snapshot.title_template)
  const bodyTemplate = text(snapshot.body_template)
  const byToken = new Map(variables.map(({ key, token }) => [token, key]))
  const keys = [...new Set([...`${titleTemplate}\n${bodyTemplate}`.matchAll(/\{([^{}]+)\}/g)]
    .map((match) => byToken.get(match[1]) ?? invalid()))]
  const payloadSchemaVersion = snapshot.payload_schema_version
  const templateVersion = snapshot.template_payload_schema_version
  if (!Number.isSafeInteger(payloadSchemaVersion) || typeof payloadSchemaVersion !== "number"
    || !Number.isSafeInteger(templateVersion) || typeof templateVersion !== "number") invalid()
  const connectionKey = item.connectionKey as NotificationConnectionKey | null
  const destinationTeam = connectionKey ? DESTINATIONS[connectionKey] ?? invalid() : null
  const ruleVariantKey = text(snapshot.rule_variant_key)
  const identity = {
    workflowKey: "makeup_requests" as const, eventKey: item.eventKey,
    channelKey: item.channelKey, audienceKey: item.audienceKey, ruleVariantKey,
  }
  const context = buildMakeupNotificationPresentation({
    ...identity, payloadSchemaVersion, payload: record(snapshot.payload),
    contractIdentity: identity, requestedContextKeys: keys,
    connectionKey, destinationTeam, scheduledFor: item.scheduledFor,
  })
  const rendered = renderNotificationSnapshot({
    workflowKey: "makeup_requests", payloadSchemaVersion,
    template: { titleTemplate, bodyTemplate, allowedVariables: variables, payloadSchemaVersion: templateVersion },
    renderContext: context, href: item.href,
  })
  return { renderedTitle: rendered.renderedTitle, renderedBody: rendered.renderedBody }
}
