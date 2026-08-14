import type { RegistrationCustomerMessageKind } from "../../tasks/registration-customer-message-contract.ts"
import {
  createLightweightRegistrationAlertCoordinator,
  resolveLightweightRegistrationChatTarget,
  type LightweightRegistrationAlertCandidate,
  type LightweightRegistrationAlertIntent,
  type LightweightRegistrationMentionResolution,
  type LightweightRegistrationSourceKind,
} from "./lightweight-registration-alerts.ts"

type LightweightProviderResult = "accepted" | "unknown" | "failed_hold"

export type LightweightRegistrationProviderReceipt = Readonly<{
  result: LightweightProviderResult
  httpStatus: number | null
  providerReferenceHash: string | null
}>

export type LightweightRegistrationSourceSnapshot = Readonly<{
  sourceKind: LightweightRegistrationSourceKind
  sourceId: string
  sourceRevision: number
  status: "scheduled" | "completed" | "canceled"
  scheduledAt: string
  studentDisplayName: string
  subjectLabels: ReadonlyArray<string>
  placeLabel: string
  className: string | null
  teacherName: string | null
  directorNames: ReadonlyArray<string>
  directorProfileIds: ReadonlyArray<string>
  teacherProfileId: string | null
  subject: "영어" | "수학" | "과학" | null
  verifiedProfileIds: ReadonlyArray<string>
}>

type WiredCoordinatorDependencies = Readonly<{
  listReminderCandidates(input: Readonly<{ localDate: string; cutoffAt: string }> ):
    Promise<ReadonlyArray<LightweightRegistrationAlertCandidate>>
  reserveIntent(intent: LightweightRegistrationAlertIntent): Promise<boolean>
  readSource(intent: LightweightRegistrationAlertIntent): Promise<LightweightRegistrationSourceSnapshot>
  finalizeReceipt(
    intent: LightweightRegistrationAlertIntent,
    receipt: LightweightRegistrationProviderReceipt & Readonly<{
      mentionResolution: LightweightRegistrationMentionResolution
    }>,
  ): Promise<void>
  pruneReceiptsBefore(exclusiveCutoff: string): Promise<void>
  customerProvider: Readonly<{
    send(input: Readonly<{
      intent: LightweightRegistrationAlertIntent
      messageKind: RegistrationCustomerMessageKind
    }>): Promise<LightweightRegistrationProviderReceipt>
  }>
  googleChatProvider: Readonly<{
    send(input: Readonly<{
      intent: LightweightRegistrationAlertIntent
      connectionKey: "google_chat.management" | "google_chat.english" | "google_chat.math" | "google_chat.science"
      mentionProfileIds: ReadonlyArray<string>
      text: string
    }>): Promise<LightweightRegistrationProviderReceipt>
  }>
}>

const HASH_PATTERN = /^[a-f0-9]{64}$/u
const UNSAFE_TEXT_PATTERN = /(?:https?:\/\/|www\.|@(all|everyone|here|channel)\b)/iu

function dispatcherError(code: string): never {
  throw new Error(code)
}

function structuredText(value: string) {
  if (typeof value !== "string") dispatcherError("lightweight_registration_source_invalid")
  const normalized = value.replace(/\s+/gu, " ").trim()
  if (!normalized || UNSAFE_TEXT_PATTERN.test(normalized)) {
    dispatcherError("lightweight_registration_source_invalid")
  }
  return normalized
}

function validateSnapshot(
  intent: LightweightRegistrationAlertIntent,
  source: LightweightRegistrationSourceSnapshot,
) {
  if (
    source.sourceKind !== intent.sourceKind
    || source.sourceId !== intent.sourceId
    || source.sourceRevision !== intent.sourceRevision
    || source.status !== "scheduled"
    || new Date(source.scheduledAt).toISOString() !== intent.scheduledAt
  ) dispatcherError("lightweight_registration_source_changed")
  return source
}

function customerMessageKind(intent: LightweightRegistrationAlertIntent): RegistrationCustomerMessageKind {
  if (intent.eventKind === "booking_confirmed") {
    if (intent.sourceKind === "level_test") return "level_test_booking"
    if (intent.sourceKind === "visit_consultation") return "visit_consultation_booking"
    return "observation_booking"
  }
  return intent.sourceKind === "observation_class"
    ? "observation_reminder"
    : "appointment_reminder"
}

function formatKstDateTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) dispatcherError("lightweight_registration_source_invalid")
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

function renderChatMessage(
  intent: LightweightRegistrationAlertIntent,
  source: LightweightRegistrationSourceSnapshot,
) {
  const student = structuredText(source.studentDisplayName)
  const subjects = source.subjectLabels.map(structuredText).join(" · ")
  const schedule = formatKstDateTime(source.scheduledAt)
  const place = structuredText(source.placeLabel)
  if (!subjects) dispatcherError("lightweight_registration_source_invalid")

  if (source.sourceKind === "visit_consultation") {
    const directors = source.directorNames.map(structuredText).join(" · ")
    if (!directors) dispatcherError("lightweight_registration_source_invalid")
    const title = intent.eventKind === "booking_confirmed" ? "방문상담 예약 완료" : "오늘 방문상담 준비"
    const action = intent.eventKind === "booking_confirmed"
      ? "방문상담 예약 내용을 확인해 주세요."
      : "상담 준비를 완료해 주세요."
    return `[${title}]\n학생: ${student}\n과목: ${subjects}\n일정: ${schedule}\n장소: ${place}\n담당: ${directors}\n할 일: ${action}`
  }

  if (source.sourceKind !== "observation_class") {
    dispatcherError("lightweight_registration_chat_not_allowed")
  }
  const className = structuredText(source.className ?? "")
  const teacher = structuredText(source.teacherName ?? "")
  const title = intent.eventKind === "booking_confirmed" ? "청강 예약 완료" : "오늘 청강 준비"
  const action = intent.eventKind === "booking_confirmed"
    ? "청강 예약 내용을 확인해 주세요."
    : "청강 준비를 완료해 주세요."
  return `[${title}]\n학생: ${student}\n과목: ${subjects}\n수업: ${className}\n일정: ${schedule}\n장소: ${place}\n담당 선생님: ${teacher}\n할 일: ${action}`
}

function normalizeReceipt(receipt: LightweightRegistrationProviderReceipt) {
  if (
    !["accepted", "unknown", "failed_hold"].includes(receipt.result)
    || (receipt.httpStatus !== null && (
      !Number.isInteger(receipt.httpStatus) || receipt.httpStatus < 100 || receipt.httpStatus > 599
    ))
    || (receipt.providerReferenceHash !== null && !HASH_PATTERN.test(receipt.providerReferenceHash))
  ) dispatcherError("lightweight_registration_provider_receipt_invalid")
  return receipt
}

export function createWiredLightweightRegistrationAlertCoordinator(
  dependencies: WiredCoordinatorDependencies,
) {
  const dispatchIntent = async (intent: LightweightRegistrationAlertIntent) => {
    let mentionResolution: LightweightRegistrationMentionResolution = "not_applicable"
    let receipt: LightweightRegistrationProviderReceipt
    try {
      const source = validateSnapshot(intent, await dependencies.readSource(intent))
      if (intent.channel === "customer_alimtalk") {
        receipt = normalizeReceipt(await dependencies.customerProvider.send({
          intent,
          messageKind: customerMessageKind(intent),
        }))
      } else {
        const target = resolveLightweightRegistrationChatTarget({
          sourceKind: source.sourceKind,
          subject: source.subject,
          directorProfileIds: source.directorProfileIds,
          teacherProfileId: source.teacherProfileId,
          verifiedProfileIds: source.verifiedProfileIds,
        })
        mentionResolution = target.mentionResolution
        receipt = normalizeReceipt(await dependencies.googleChatProvider.send({
          intent,
          connectionKey: target.connectionKey,
          mentionProfileIds: target.mentionProfileIds,
          text: renderChatMessage(intent, source),
        }))
      }
    } catch {
      receipt = Object.freeze({
        result: "unknown" as const,
        httpStatus: null,
        providerReferenceHash: null,
      })
    }
    await dependencies.finalizeReceipt(intent, Object.freeze({ ...receipt, mentionResolution }))
  }

  return createLightweightRegistrationAlertCoordinator({
    listReminderCandidates: dependencies.listReminderCandidates,
    reserveIntent: dependencies.reserveIntent,
    dispatchIntent,
    pruneReceiptsBefore: dependencies.pruneReceiptsBefore,
  })
}
