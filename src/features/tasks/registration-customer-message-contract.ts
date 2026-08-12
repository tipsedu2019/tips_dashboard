export const REGISTRATION_CUSTOMER_MESSAGE_KINDS = Object.freeze([
  "level_test_booking",
  "visit_consultation_booking",
  "appointment_reminder",
  "waiting_notice",
  "admission_application",
  "observation_booking",
  "observation_reminder",
] as const)

export type RegistrationCustomerMessageKind =
  (typeof REGISTRATION_CUSTOMER_MESSAGE_KINDS)[number]

export const REGISTRATION_CUSTOMER_MESSAGE_STATUSES = Object.freeze([
  "pending",
  "accepted",
  "unknown",
  "failed_hold",
] as const)

export type RegistrationCustomerMessageStatus =
  (typeof REGISTRATION_CUSTOMER_MESSAGE_STATUSES)[number]

export const REGISTRATION_CUSTOMER_MESSAGE_ACTIVATION_MODES = Object.freeze([
  "off",
  "verification",
  "live",
] as const)

export type RegistrationCustomerMessageActivationMode =
  (typeof REGISTRATION_CUSTOMER_MESSAGE_ACTIVATION_MODES)[number]

export const REGISTRATION_CUSTOMER_MESSAGE_READINESS_CODES = Object.freeze([
  "runtime_not_ready",
  "activation_off",
  "verification_scope_mismatch",
  "credentials_missing",
  "pf_missing",
  "template_missing",
  "template_not_verified",
  "template_drift",
  "source_invalid",
  "source_dirty",
  "duplicate_locked",
  "role_not_authorized",
] as const)

export type RegistrationCustomerMessageReadinessCode =
  (typeof REGISTRATION_CUSTOMER_MESSAGE_READINESS_CODES)[number]

export type RegistrationCustomerMessageReadiness = Readonly<{
  runtimeReady: boolean
  activationMode: RegistrationCustomerMessageActivationMode
  activationEligible: boolean
  credentialsConfigured: boolean
  pfConfigured: boolean
  templateConfigured: boolean
  templateVerified: boolean
  verifiedAt: string | null
  sourceValid: boolean
  sendAllowed: boolean
  blockers: RegistrationCustomerMessageReadinessCode[]
}>

export type RegistrationCustomerMessageHistoryItem = Readonly<{
  messageId: string
  messageKind: RegistrationCustomerMessageKind
  currentStatus: RegistrationCustomerMessageStatus
  confirmedByName: string
  confirmedAt: string
  updatedAt: string
  recipientLast4?: string
  canCheck: boolean
}>

export type RegistrationCustomerMessageHistoryResponse = Readonly<{
  ok: true
  messageKind: RegistrationCustomerMessageKind
  readiness: RegistrationCustomerMessageReadiness
  history: ReadonlyArray<RegistrationCustomerMessageHistoryItem>
}>

export type RegistrationCustomerMessageAdmissionPreviewPlan = Readonly<{
  subjectLabel: string
  className: string
  textbookLabel: string
  scheduleLabel: string
  teacherLabel: string
  classroomLabel: string
  firstLessonLabel: string
}>

export type RegistrationCustomerMessagePreviewResponse = Readonly<{
  ok: true
  previewId: string | null
  expiresAt: string | null
  messageKind: RegistrationCustomerMessageKind
  studentName: string
  recipientLast4: string
  facts: Readonly<{
    subjectLabel: string
    scheduleLabel?: string
    placeLabel?: string
    waitingKindLabel?: string
    waitingDetailLabel?: string
    admissionPlans?: ReadonlyArray<RegistrationCustomerMessageAdmissionPreviewPlan>
  }>
  body: string
  buttons: ReadonlyArray<Readonly<{ name: string; type: "WL"; host: string }>>
  readiness: RegistrationCustomerMessageReadiness
  latestMessage: RegistrationCustomerMessageHistoryItem | null
}>

export type RegistrationCustomerMessageSendResult = Readonly<{
  ok: boolean
  messageId: string
  messageKind: RegistrationCustomerMessageKind
  currentStatus: RegistrationCustomerMessageStatus
  recipientLast4: string
  confirmedByName: string
  confirmedAt: string
  updatedAt: string
  canCheck: boolean
  idempotent: boolean
}>

export type RegistrationCustomerMessageTarget = Readonly<{
  messageKind: RegistrationCustomerMessageKind
  sourceId: string
}>

export type RegistrationCustomerMessageSendInput = Readonly<{
  previewId: string
  requestKey: string
}>

export type RegistrationCustomerMessageCheckInput = Readonly<{
  messageId: string
}>

export type RegistrationCustomerMessageProviderEvidenceInput = Readonly<{
  providerMessageId?: string
  providerGroupId?: string
  statusCode: string
  statusMessage: string
  observedAt: string
  requestKeyMatched: boolean
}>

export type RegistrationObservationSolapiScheduleReadiness = Readonly<{
  installed: boolean
  active: boolean
  contractReady: boolean
  vaultReady: boolean
  heartbeatCurrent: boolean
  lastSucceededAt: string | null
}>

export type RegistrationObservationSolapiReadiness = Readonly<{
  runtimeReady: boolean
  settingsEnabled: boolean
  leadHours: number
  schedule: RegistrationObservationSolapiScheduleReadiness
  bookingMode: RegistrationCustomerMessageActivationMode
  reminderMode: RegistrationCustomerMessageActivationMode
  bookingReceipt: boolean
  reminderReceipt: boolean
  reminderCutoffAt: string | null
  observationMessages: number
  providerAttemptMarkers: number
  pending: number
  sourceDirty: number
  deliveryUnknown: number
}>

export type RegistrationCustomerMessageAdminAction =
  | Readonly<{
      action: "inspect_observation_readiness"
    }>
  | Readonly<{
      action: "preflight_template"
      messageKind: RegistrationCustomerMessageKind
    }>
  | Readonly<{
      action: "set_activation"
      messageKind: RegistrationCustomerMessageKind
      mode: RegistrationCustomerMessageActivationMode
      verificationTaskId?: string
      requestKey: string
    }>
  | Readonly<{
      action: "record_live_test_receipt"
      messageKind: RegistrationCustomerMessageKind
      messageId: string
      receivedAt: string
      requestKey: string
    }>
  | Readonly<{
      action: "reconcile"
      messageId: string
      resolution: "accepted" | "failed_hold"
      evidence: RegistrationCustomerMessageProviderEvidenceInput
      reason: string
      requestKey: string
    }>
  | Readonly<{
      action: "release_pre_send"
      messageId: string
      reason: string
      requestKey: string
    }>

export type RegistrationCustomerMessageClient = Readonly<{
  preview: (
    target: RegistrationCustomerMessageTarget,
    signal?: AbortSignal,
  ) => Promise<RegistrationCustomerMessagePreviewResponse>
  send: (input: RegistrationCustomerMessageSendInput) => Promise<RegistrationCustomerMessageSendResult>
  list: (
    target: RegistrationCustomerMessageTarget,
    signal?: AbortSignal,
  ) => Promise<RegistrationCustomerMessageHistoryItem[]>
  check: (input: RegistrationCustomerMessageCheckInput) => Promise<RegistrationCustomerMessageSendResult>
  reconcile: (input: Readonly<{
    messageId: string
    resolution: "accepted" | "failed_hold"
    evidence: RegistrationCustomerMessageProviderEvidenceInput
    reason: string
    requestKey: string
  }>) => Promise<RegistrationCustomerMessageSendResult>
  releasePreSend: (input: Readonly<{
    messageId: string
    reason: string
    requestKey: string
  }>) => Promise<RegistrationCustomerMessageSendResult>
}>

export type RegistrationCustomerMessageAdminClient = Readonly<{
  inspectObservationReadiness: () => Promise<RegistrationObservationSolapiReadiness>
  preflightTemplate: (
    messageKind: RegistrationCustomerMessageKind,
  ) => Promise<RegistrationCustomerMessageReadiness>
  setActivation: (input: Readonly<{
    messageKind: RegistrationCustomerMessageKind
    mode: RegistrationCustomerMessageActivationMode
    verificationTaskId?: string
    requestKey: string
  }>) => Promise<RegistrationCustomerMessageReadiness>
  recordLiveTestReceipt: (input: Readonly<{
    messageKind: RegistrationCustomerMessageKind
    messageId: string
    receivedAt: string
    requestKey: string
  }>) => Promise<RegistrationCustomerMessageReadiness>
}>

type JsonRecord = Record<string, unknown>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RFC3339_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/i

const REGISTRATION_CUSTOMER_MESSAGE_PUBLIC_RESPONSE_KEYS = new Set([
  "activationEligible",
  "activationMode",
  "admissionPlans",
  "blockers",
  "body",
  "buttons",
  "canCheck",
  "className",
  "classroomLabel",
  "confirmedByName",
  "confirmedAt",
  "credentialsConfigured",
  "currentStatus",
  "expiresAt",
  "facts",
  "firstLessonLabel",
  "host",
  "history",
  "idempotent",
  "latestMessage",
  "messageId",
  "messageKind",
  "name",
  "ok",
  "pfConfigured",
  "placeLabel",
  "previewId",
  "readiness",
  "recipientLast4",
  "reminderCutoffAt",
  "reminderMode",
  "reminderReceipt",
  "runtimeReady",
  "schedule",
  "scheduleLabel",
  "sendAllowed",
  "settingsEnabled",
  "sourceValid",
  "sourceDirty",
  "studentName",
  "subjectLabel",
  "templateConfigured",
  "templateVerified",
  "teacherLabel",
  "textbookLabel",
  "type",
  "updatedAt",
  "verifiedAt",
  "active",
  "bookingMode",
  "bookingReceipt",
  "contractReady",
  "deliveryUnknown",
  "heartbeatCurrent",
  "installed",
  "lastSucceededAt",
  "leadHours",
  "observationMessages",
  "pending",
  "providerAttemptMarkers",
  "vaultReady",
  "waitingDetailLabel",
  "waitingKindLabel",
])

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: JsonRecord,
  required: ReadonlyArray<string>,
  optional: ReadonlyArray<string> = [],
) {
  const keys = Object.keys(value)
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => allowed.has(key))
}

function normalizedUuid(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  return UUID_PATTERN.test(normalized) ? normalized : null
}

function normalizedText(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized || null
}

function normalizedTimestamp(value: unknown) {
  const normalized = normalizedText(value)
  const match = normalized?.match(RFC3339_TIMESTAMP_PATTERN)
  if (!normalized || !match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const offset = match[8]
  const offsetHour = offset.toUpperCase() === "Z" ? 0 : Number(offset.slice(1, 3))
  const offsetMinute = offset.toUpperCase() === "Z" ? 0 : Number(offset.slice(4, 6))
  if (
    month < 1
    || month > 12
    || day < 1
    || day > daysInMonth[month - 1]
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 23
    || offsetMinute > 59
  ) return null

  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

export function isRegistrationCustomerMessageKind(
  value: unknown,
): value is RegistrationCustomerMessageKind {
  return typeof value === "string"
    && (REGISTRATION_CUSTOMER_MESSAGE_KINDS as readonly string[]).includes(value)
}

function isRegistrationCustomerMessageActivationMode(
  value: unknown,
): value is RegistrationCustomerMessageActivationMode {
  return typeof value === "string"
    && (REGISTRATION_CUSTOMER_MESSAGE_ACTIVATION_MODES as readonly string[]).includes(value)
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

export function parseRegistrationObservationSolapiReadiness(
  value: unknown,
): RegistrationObservationSolapiReadiness | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "runtimeReady",
    "settingsEnabled",
    "leadHours",
    "schedule",
    "bookingMode",
    "reminderMode",
    "bookingReceipt",
    "reminderReceipt",
    "reminderCutoffAt",
    "observationMessages",
    "providerAttemptMarkers",
    "pending",
    "sourceDirty",
    "deliveryUnknown",
  ]) || !isRecord(value.schedule) || !hasExactKeys(value.schedule, [
    "installed",
    "active",
    "contractReady",
    "vaultReady",
    "heartbeatCurrent",
    "lastSucceededAt",
  ])) return null

  const schedule = value.schedule
  const lastSucceededAt = schedule.lastSucceededAt === null
    ? null
    : normalizedTimestamp(schedule.lastSucceededAt)
  const reminderCutoffAt = value.reminderCutoffAt === null
    ? null
    : normalizedTimestamp(value.reminderCutoffAt)
  if (
    typeof value.runtimeReady !== "boolean"
    || typeof value.settingsEnabled !== "boolean"
    || !Number.isInteger(value.leadHours)
    || (value.leadHours as number) < 1
    || (value.leadHours as number) > 72
    || typeof schedule.installed !== "boolean"
    || typeof schedule.active !== "boolean"
    || typeof schedule.contractReady !== "boolean"
    || typeof schedule.vaultReady !== "boolean"
    || typeof schedule.heartbeatCurrent !== "boolean"
    || (schedule.lastSucceededAt !== null && !lastSucceededAt)
    || (schedule.heartbeatCurrent && !lastSucceededAt)
    || !isRegistrationCustomerMessageActivationMode(value.bookingMode)
    || !isRegistrationCustomerMessageActivationMode(value.reminderMode)
    || typeof value.bookingReceipt !== "boolean"
    || typeof value.reminderReceipt !== "boolean"
    || (value.reminderCutoffAt !== null && !reminderCutoffAt)
    || !nonNegativeInteger(value.observationMessages)
    || !nonNegativeInteger(value.providerAttemptMarkers)
    || !nonNegativeInteger(value.pending)
    || !nonNegativeInteger(value.sourceDirty)
    || !nonNegativeInteger(value.deliveryUnknown)
  ) return null

  return Object.freeze({
    runtimeReady: value.runtimeReady,
    settingsEnabled: value.settingsEnabled,
    leadHours: value.leadHours as number,
    schedule: Object.freeze({
      installed: schedule.installed,
      active: schedule.active,
      contractReady: schedule.contractReady,
      vaultReady: schedule.vaultReady,
      heartbeatCurrent: schedule.heartbeatCurrent,
      lastSucceededAt,
    }),
    bookingMode: value.bookingMode,
    reminderMode: value.reminderMode,
    bookingReceipt: value.bookingReceipt,
    reminderReceipt: value.reminderReceipt,
    reminderCutoffAt,
    observationMessages: value.observationMessages as number,
    providerAttemptMarkers: value.providerAttemptMarkers as number,
    pending: value.pending as number,
    sourceDirty: value.sourceDirty as number,
    deliveryUnknown: value.deliveryUnknown as number,
  })
}

export function parseRegistrationCustomerMessageTarget(
  value: unknown,
): RegistrationCustomerMessageTarget | null {
  if (!isRecord(value) || !hasExactKeys(value, ["messageKind", "sourceId"])) return null
  const sourceId = normalizedUuid(value.sourceId)
  if (!isRegistrationCustomerMessageKind(value.messageKind) || !sourceId) return null
  return { messageKind: value.messageKind, sourceId }
}

export function parseRegistrationCustomerMessageSendInput(
  value: unknown,
): RegistrationCustomerMessageSendInput | null {
  if (!isRecord(value) || !hasExactKeys(value, ["previewId", "requestKey"])) return null
  const previewId = normalizedUuid(value.previewId)
  const requestKey = normalizedUuid(value.requestKey)
  return previewId && requestKey ? { previewId, requestKey } : null
}

export function parseRegistrationCustomerMessageCheckInput(
  value: unknown,
): RegistrationCustomerMessageCheckInput | null {
  if (!isRecord(value) || !hasExactKeys(value, ["messageId"])) return null
  const messageId = normalizedUuid(value.messageId)
  return messageId ? { messageId } : null
}

function parseProviderEvidence(
  value: unknown,
): RegistrationCustomerMessageProviderEvidenceInput | null {
  if (
    !isRecord(value)
    || !hasExactKeys(
      value,
      ["statusCode", "statusMessage", "observedAt", "requestKeyMatched"],
      ["providerMessageId", "providerGroupId"],
    )
  ) return null

  const statusCode = normalizedText(value.statusCode)
  const statusMessage = normalizedText(value.statusMessage)
  const observedAt = normalizedTimestamp(value.observedAt)
  if (!statusCode || !statusMessage || !observedAt || typeof value.requestKeyMatched !== "boolean") {
    return null
  }

  const providerMessageId = value.providerMessageId === undefined
    ? null
    : normalizedText(value.providerMessageId)
  const providerGroupId = value.providerGroupId === undefined
    ? null
    : normalizedText(value.providerGroupId)
  if (
    (value.providerMessageId !== undefined && !providerMessageId)
    || (value.providerGroupId !== undefined && !providerGroupId)
  ) return null

  return {
    ...(providerMessageId ? { providerMessageId } : {}),
    ...(providerGroupId ? { providerGroupId } : {}),
    statusCode,
    statusMessage,
    observedAt,
    requestKeyMatched: value.requestKeyMatched,
  }
}

export function parseRegistrationCustomerMessageAdminAction(
  value: unknown,
): RegistrationCustomerMessageAdminAction | null {
  if (!isRecord(value) || typeof value.action !== "string") return null

  if (value.action === "inspect_observation_readiness") {
    return hasExactKeys(value, ["action"]) ? { action: value.action } : null
  }

  if (value.action === "preflight_template") {
    if (!hasExactKeys(value, ["action", "messageKind"])) return null
    return isRegistrationCustomerMessageKind(value.messageKind)
      ? { action: value.action, messageKind: value.messageKind }
      : null
  }

  if (value.action === "set_activation") {
    if (!hasExactKeys(
      value,
      ["action", "messageKind", "mode", "requestKey"],
      ["verificationTaskId"],
    )) return null
    const requestKey = normalizedUuid(value.requestKey)
    const verificationTaskId = value.verificationTaskId === undefined
      ? null
      : normalizedUuid(value.verificationTaskId)
    if (
      !isRegistrationCustomerMessageKind(value.messageKind)
      || !isRegistrationCustomerMessageActivationMode(value.mode)
      || !requestKey
      || (value.verificationTaskId !== undefined && !verificationTaskId)
    ) return null
    return {
      action: value.action,
      messageKind: value.messageKind,
      mode: value.mode,
      ...(verificationTaskId ? { verificationTaskId } : {}),
      requestKey,
    }
  }

  if (value.action === "record_live_test_receipt") {
    if (!hasExactKeys(
      value,
      ["action", "messageKind", "messageId", "receivedAt", "requestKey"],
    )) return null
    const messageId = normalizedUuid(value.messageId)
    const receivedAt = normalizedTimestamp(value.receivedAt)
    const requestKey = normalizedUuid(value.requestKey)
    if (!isRegistrationCustomerMessageKind(value.messageKind) || !messageId || !receivedAt || !requestKey) {
      return null
    }
    return { action: value.action, messageKind: value.messageKind, messageId, receivedAt, requestKey }
  }

  if (value.action === "reconcile") {
    if (!hasExactKeys(
      value,
      ["action", "messageId", "resolution", "evidence", "reason", "requestKey"],
    )) return null
    const messageId = normalizedUuid(value.messageId)
    const evidence = parseProviderEvidence(value.evidence)
    const reason = normalizedText(value.reason)
    const requestKey = normalizedUuid(value.requestKey)
    if (
      !messageId
      || (value.resolution !== "accepted" && value.resolution !== "failed_hold")
      || !evidence
      || !reason
      || !requestKey
    ) return null
    return {
      action: value.action,
      messageId,
      resolution: value.resolution,
      evidence,
      reason,
      requestKey,
    }
  }

  if (value.action === "release_pre_send") {
    if (!hasExactKeys(value, ["action", "messageId", "reason", "requestKey"])) return null
    const messageId = normalizedUuid(value.messageId)
    const reason = normalizedText(value.reason)
    const requestKey = normalizedUuid(value.requestKey)
    return messageId && reason && requestKey
      ? { action: value.action, messageId, reason, requestKey }
      : null
  }

  return null
}

export function assertRegistrationCustomerMessagePublicPayload<T>(payload: T): T {
  const visited = new WeakSet<object>()
  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return
    if (visited.has(value)) throw new Error("registration_customer_message_public_payload_cycle")
    visited.add(value)

    if (Array.isArray(value)) {
      value.forEach(visit)
      visited.delete(value)
      return
    }

    for (const [key, nested] of Object.entries(value)) {
      if (!REGISTRATION_CUSTOMER_MESSAGE_PUBLIC_RESPONSE_KEYS.has(key)) {
        throw new Error(`registration_customer_message_public_payload_forbidden_field:${key}`)
      }
      visit(nested)
    }
    visited.delete(value)
  }

  visit(payload)
  return payload
}
