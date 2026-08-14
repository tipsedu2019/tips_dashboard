import type { NotificationConnectionKey } from "../notification-google-chat-catalog.ts"

export const LIGHTWEIGHT_REGISTRATION_ALERT_CRON = "0 1 * * *" as const
export const LIGHTWEIGHT_REGISTRATION_ALERT_RETENTION_DAYS = 7 as const

export type LightweightRegistrationSourceKind =
  | "level_test"
  | "visit_consultation"
  | "observation_class"

export type LightweightRegistrationEventKind =
  | "booking_confirmed"
  | "same_day_reminder"

export type LightweightRegistrationAlertChannel =
  | "customer_alimtalk"
  | "google_chat"

export type LightweightRegistrationMentionResolution =
  | "not_applicable"
  | "resolved"
  | "mention_unresolved"

export type LightweightRegistrationAlertCandidate = Readonly<{
  sourceKind: LightweightRegistrationSourceKind
  sourceId: string
  sourceRevision: number
  eventKind: LightweightRegistrationEventKind
  scheduledAt: string
  bookingConfirmedAt: string
  status?: "scheduled" | "completed" | "canceled"
  reminderLocalDate?: string
  directorProfileIds: ReadonlyArray<string>
  teacherProfileId: string | null
  subject: "영어" | "수학" | "과학" | null
}>

export type LightweightRegistrationAlertIntent = Readonly<{
  sourceKind: LightweightRegistrationSourceKind
  sourceId: string
  sourceRevision: number
  eventKind: LightweightRegistrationEventKind
  channel: LightweightRegistrationAlertChannel
  eventKey: string
  dedupeKey: string
  scheduledAt: string
}>

export type LightweightRegistrationChatTarget = Readonly<{
  connectionKey: Exclude<NotificationConnectionKey, "google_chat.executive">
  mentionProfileIds: ReadonlyArray<string>
  mentionResolution: Exclude<LightweightRegistrationMentionResolution, "not_applicable">
}>

type LightweightRegistrationAlertCoordinatorDependencies = Readonly<{
  listReminderCandidates(input: Readonly<{
    localDate: string
    cutoffAt: string
  }>): Promise<ReadonlyArray<LightweightRegistrationAlertCandidate>>
  reserveIntent(intent: LightweightRegistrationAlertIntent): Promise<boolean>
  dispatchIntent(intent: LightweightRegistrationAlertIntent): Promise<void>
  pruneReceiptsBefore(exclusiveCutoff: string): Promise<void>
}>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000
const DAY_MS = 24 * 60 * 60 * 1_000

const CHANNELS = Object.freeze({
  level_test: ["customer_alimtalk"] as const,
  visit_consultation: ["customer_alimtalk", "google_chat"] as const,
  observation_class: ["customer_alimtalk", "google_chat"] as const,
}) satisfies Readonly<
  Record<LightweightRegistrationSourceKind, ReadonlyArray<LightweightRegistrationAlertChannel>>
>

const SUBJECT_CONNECTIONS = Object.freeze({
  영어: "google_chat.english",
  수학: "google_chat.math",
  과학: "google_chat.science",
} as const)

function alertError(code: string): never {
  throw new Error(code)
}

function requiredUuid(value: string) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (!UUID_PATTERN.test(normalized)) alertError("lightweight_registration_alert_invalid")
  return normalized
}

function requiredTimestamp(value: string) {
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) alertError("lightweight_registration_alert_invalid")
  return new Date(milliseconds).toISOString()
}

function uniqueUuids(values: ReadonlyArray<string>) {
  return [...new Set(values.map(requiredUuid))].sort()
}

function localDateAtKst(value: Date | string) {
  const instant = value instanceof Date ? value : new Date(requiredTimestamp(value))
  if (!Number.isFinite(instant.getTime())) alertError("lightweight_registration_alert_invalid")
  return new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

function cutoffForLocalDate(localDate: string) {
  if (!LOCAL_DATE_PATTERN.test(localDate)) alertError("lightweight_registration_alert_invalid")
  const cutoff = new Date(`${localDate}T01:00:00.000Z`)
  if (!Number.isFinite(cutoff.getTime()) || localDateAtKst(cutoff) !== localDate) {
    alertError("lightweight_registration_alert_invalid")
  }
  return cutoff
}

export function getLightweightReminderRunWindow(now: Date) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    alertError("lightweight_registration_alert_invalid")
  }
  const localDate = localDateAtKst(now)
  const cutoff = cutoffForLocalDate(localDate)
  if (now.getTime() < cutoff.getTime()) return null
  return Object.freeze({
    localDate,
    cutoffAt: cutoff.toISOString(),
    receiptRetentionBefore: new Date(
      now.getTime() - LIGHTWEIGHT_REGISTRATION_ALERT_RETENTION_DAYS * DAY_MS,
    ).toISOString(),
  })
}

export function buildLightweightRegistrationAlertIntents(
  candidate: LightweightRegistrationAlertCandidate,
) {
  const sourceId = requiredUuid(candidate.sourceId)
  const sourceRevision = Number(candidate.sourceRevision)
  if (!Number.isSafeInteger(sourceRevision) || sourceRevision < 1) {
    alertError("lightweight_registration_alert_invalid")
  }
  const scheduledAt = requiredTimestamp(candidate.scheduledAt)
  const eventKey = candidate.eventKind === "booking_confirmed"
    ? "booking"
    : candidate.reminderLocalDate
  if (!eventKey || (candidate.eventKind === "same_day_reminder" && !LOCAL_DATE_PATTERN.test(eventKey))) {
    alertError("lightweight_registration_alert_invalid")
  }
  const channels = CHANNELS[candidate.sourceKind]
  if (!channels) alertError("lightweight_registration_alert_invalid")

  return Object.freeze(channels.map((channel) => Object.freeze({
    sourceKind: candidate.sourceKind,
    sourceId,
    sourceRevision,
    eventKind: candidate.eventKind,
    channel,
    eventKey,
    dedupeKey: `${candidate.sourceKind}:${sourceId}:${candidate.eventKind}:${channel}:${eventKey}`,
    scheduledAt,
  })))
}

export function resolveLightweightRegistrationChatTarget(input: Readonly<{
  sourceKind: LightweightRegistrationSourceKind
  subject: LightweightRegistrationAlertCandidate["subject"]
  directorProfileIds: ReadonlyArray<string>
  teacherProfileId: string | null
  verifiedProfileIds: ReadonlyArray<string>
}>): LightweightRegistrationChatTarget {
  if (input.sourceKind === "level_test") {
    alertError("lightweight_registration_chat_not_allowed")
  }

  const requiredProfiles = input.sourceKind === "visit_consultation"
    ? uniqueUuids(input.directorProfileIds)
    : input.teacherProfileId
      ? [requiredUuid(input.teacherProfileId)]
      : []
  const verifiedProfiles = new Set(uniqueUuids(input.verifiedProfileIds))
  const allResolved = requiredProfiles.length > 0
    && requiredProfiles.every((profileId) => verifiedProfiles.has(profileId))

  if (input.sourceKind === "visit_consultation") {
    return Object.freeze({
      connectionKey: "google_chat.management",
      mentionProfileIds: Object.freeze(allResolved ? requiredProfiles : []),
      mentionResolution: allResolved ? "resolved" : "mention_unresolved",
    })
  }

  if (!input.subject || !SUBJECT_CONNECTIONS[input.subject]) {
    alertError("lightweight_registration_chat_route_invalid")
  }
  return Object.freeze({
    connectionKey: SUBJECT_CONNECTIONS[input.subject],
    mentionProfileIds: Object.freeze(allResolved ? requiredProfiles : []),
    mentionResolution: allResolved ? "resolved" : "mention_unresolved",
  })
}

function reminderEligible(
  candidate: LightweightRegistrationAlertCandidate,
  localDate: string,
  cutoffAt: string,
) {
  if ((candidate.status ?? "scheduled") !== "scheduled") return false
  if (localDateAtKst(candidate.scheduledAt) !== localDate) return false
  return Date.parse(requiredTimestamp(candidate.bookingConfirmedAt)) <= Date.parse(cutoffAt)
}

export function createLightweightRegistrationAlertCoordinator(
  dependencies: LightweightRegistrationAlertCoordinatorDependencies,
) {
  const dispatch = async (intents: ReadonlyArray<LightweightRegistrationAlertIntent>) => {
    let dispatched = 0
    let failed = 0
    for (const intent of intents) {
      if (!await dependencies.reserveIntent(intent)) continue
      try {
        await dependencies.dispatchIntent(intent)
        dispatched += 1
      } catch {
        failed += 1
      }
    }
    return Object.freeze({ dispatched, failed })
  }

  return Object.freeze({
    async dispatchBooking(candidate: LightweightRegistrationAlertCandidate) {
      if (candidate.eventKind !== "booking_confirmed") {
        alertError("lightweight_registration_booking_event_invalid")
      }
      return dispatch(buildLightweightRegistrationAlertIntents(candidate))
    },

    async runDaily(now: Date) {
      const window = getLightweightReminderRunWindow(now)
      if (!window) {
        return Object.freeze({ status: "before_cutoff" as const, candidates: 0, dispatched: 0, failed: 0 })
      }
      const rawCandidates = await dependencies.listReminderCandidates({
        localDate: window.localDate,
        cutoffAt: window.cutoffAt,
      })
      const candidates = rawCandidates.filter((candidate) => (
        reminderEligible(candidate, window.localDate, window.cutoffAt)
      ))
      let dispatched = 0
      let failed = 0
      for (const candidate of candidates) {
        const outcome = await dispatch(buildLightweightRegistrationAlertIntents({
          ...candidate,
          eventKind: "same_day_reminder",
          reminderLocalDate: window.localDate,
        }))
        dispatched += outcome.dispatched
        failed += outcome.failed
      }
      await dependencies.pruneReceiptsBefore(window.receiptRetentionBefore)
      return Object.freeze({
        status: "completed" as const,
        candidates: candidates.length,
        dispatched,
        failed,
      })
    },
  })
}
