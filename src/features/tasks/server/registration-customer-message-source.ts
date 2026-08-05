import { createHash, createHmac } from "node:crypto"

import type {
  RegistrationCustomerMessageKind,
} from "../registration-customer-message-contract.ts"
import {
  renderRegistrationCustomerMessage,
  type RegistrationCustomerMessageButton,
  type RegistrationCustomerMessageCanonicalFacts,
  type RegistrationCustomerMessageCatalog,
  type RegistrationCustomerMessageRendered,
  type RegistrationCustomerMessageSubject,
  type RegistrationCustomerMessageWaitingKind,
} from "./registration-customer-message-catalog.ts"

type JsonRecord = Record<string, unknown>

export type RegistrationCustomerMessageSourceRequest = Readonly<{
  actorProfileId: string
  messageKind: RegistrationCustomerMessageKind
  sourceId: string
}>

export type RegistrationCustomerMessagePublicSource = Readonly<{
  messageKind: RegistrationCustomerMessageKind
  sourceId: string
  taskId: string
  sourceRevision: number
  studentName: string
  recipientLast4: string
  facts: RegistrationCustomerMessageRendered["facts"]
  body: string
  buttons: ReadonlyArray<Readonly<{ name: string; type: "WL"; host: string }>>
}>

export type RegistrationCustomerMessagePreviewContract = Readonly<{
  parentPhoneDigits: string
  sourceFingerprint: string
  recipientHash: string
  templateKey: RegistrationCustomerMessageKind
  templateRevision: number
  templateChecksum: string
  renderedVariablesChecksum: string
  renderedBodyChecksum: string
  renderedButtonsChecksum: string
}>

export type RegistrationCustomerMessageReadinessContract = Readonly<{
  credentialsConfigured: boolean
  pfId: string | null
  templateId: string | null
  catalogChecksum: string
  recipientHash: string
  sourceFingerprint: string
  sourceFactsChecksum: string
}>

export type RegistrationCustomerMessagePrivateSource = Readonly<{
  source: Readonly<JsonRecord>
  parentPhoneDigits: string
  recipientHash: string
  sourceFingerprint: string
  sourceFactsChecksum: string
  rendered: RegistrationCustomerMessageRendered
  previewContract: RegistrationCustomerMessagePreviewContract
  readinessContract: RegistrationCustomerMessageReadinessContract
}>

export type RegistrationCustomerMessageSourceResolver = Readonly<{
  resolve(input: RegistrationCustomerMessageSourceRequest): Promise<RegistrationCustomerMessagePublicSource>
}>

type SourceResolverDependencies = Readonly<{
  catalog: RegistrationCustomerMessageCatalog
  recipientHashPepper: string
  now?: () => Date
  resolveSource(input: RegistrationCustomerMessageSourceRequest): Promise<unknown>
}>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const PHONE_PATTERN = /^01(?:0|1|[6-9])[0-9]{7,8}$/u
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/iu
const SUBJECT_ORDER: ReadonlyArray<RegistrationCustomerMessageSubject> = ["영어", "수학", "과학"]
const WAITING_WORKFLOW_KIND: Readonly<Record<string, RegistrationCustomerMessageWaitingKind>> = {
  waiting_current_class: "current_class",
  waiting_new_class: "current_term_opening",
  waiting_next_opening: "next_term_opening",
}
const PRIVATE_SOURCES = new WeakMap<object, RegistrationCustomerMessagePrivateSource>()

class CanonicalNumber {
  readonly value: string

  constructor(value: string) {
    this.value = value
  }
}

function sourceError(code: string): never {
  throw new Error(code)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function canonicalJson(value: unknown): string {
  if (value instanceof CanonicalNumber) return value.value
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (!isRecord(value)) sourceError("registration_customer_message_checksum_value_invalid")
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function requiredText(value: unknown, code: string) {
  if (typeof value !== "string") sourceError(code)
  const normalized = value.trim()
  return normalized || sourceError(code)
}

function requiredUuid(value: unknown, code = "registration_customer_message_source_mismatch") {
  const normalized = requiredText(value, code).toLowerCase()
  return UUID_PATTERN.test(normalized) ? normalized : sourceError(code)
}

function nullableUuid(value: unknown, code: string) {
  if (value === null) return null
  return requiredUuid(value, code)
}

function sourceRevision(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : sourceError("registration_customer_message_source_revision_invalid")
}

function subjects(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    sourceError("registration_customer_message_subject_invalid")
  }
  const normalized = value.map((subject) => {
    if (!SUBJECT_ORDER.includes(subject as RegistrationCustomerMessageSubject)) {
      sourceError("registration_customer_message_subject_invalid")
    }
    return subject as RegistrationCustomerMessageSubject
  })
  return [...new Set(normalized)].sort(
    (left, right) => SUBJECT_ORDER.indexOf(left) - SUBJECT_ORDER.indexOf(right),
  )
}

function cloneJson<T>(value: T): T {
  return structuredClone(value)
}

function parsedTimestamp(value: unknown) {
  const text = requiredText(value, "registration_customer_message_schedule_invalid")
  const match = text.match(RFC3339_PATTERN)
  if (!match) sourceError("registration_customer_message_schedule_invalid")
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
  ) sourceError("registration_customer_message_schedule_invalid")
  const fraction = match[7] ?? ""
  if (fraction.length > 6) sourceError("registration_customer_message_schedule_invalid")
  const wholeSecond = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${offset}`
  const wholeSecondMillis = Date.parse(wholeSecond)
  if (!Number.isFinite(wholeSecondMillis) || wholeSecondMillis % 1_000 !== 0) {
    sourceError("registration_customer_message_schedule_invalid")
  }
  const microseconds = Number((fraction + "000000").slice(0, 6))
  const epochMicroseconds = wholeSecondMillis * 1_000 + microseconds
  if (!Number.isSafeInteger(epochMicroseconds)) {
    sourceError("registration_customer_message_schedule_invalid")
  }
  const absolute = Math.abs(epochMicroseconds)
  const epoch = `${epochMicroseconds < 0 ? "-" : ""}${Math.trunc(absolute / 1_000_000)}.${String(absolute % 1_000_000).padStart(6, "0")}`
  return {
    date: new Date(text),
    epoch,
    epochMicroseconds,
  }
}

function appointmentFacts(
  kind: RegistrationCustomerMessageKind,
  raw: JsonRecord,
  inputSourceId: string,
  now: Date,
) {
  if (requiredUuid(raw.appointmentId) !== inputSourceId || raw.trackId !== null) {
    sourceError("registration_customer_message_source_mismatch")
  }
  const appointmentKind = raw.appointmentKind
  if (appointmentKind !== "level_test" && appointmentKind !== "visit_consultation") {
    sourceError("registration_customer_message_appointment_kind_invalid")
  }
  if (
    (kind === "level_test_booking" && appointmentKind !== "level_test")
    || (kind === "visit_consultation_booking" && appointmentKind !== "visit_consultation")
  ) sourceError("registration_customer_message_appointment_kind_mismatch")
  const scheduledAt = parsedTimestamp(raw.scheduledAt)
  if (scheduledAt.epochMicroseconds <= now.getTime() * 1_000) {
    sourceError("registration_customer_message_schedule_not_future")
  }
  return {
    facts: {
      scheduledAt: scheduledAt.date,
      appointmentKind,
      place: requiredText(raw.place, "registration_customer_message_place_invalid"),
    },
    source: {
      appointmentId: inputSourceId,
      trackId: null,
      appointmentKind,
      scheduledAtEpoch: scheduledAt.epoch,
      place: requiredText(raw.place, "registration_customer_message_place_invalid"),
    },
  } as const
}

function waitingFacts(raw: JsonRecord, inputSourceId: string) {
  if (requiredUuid(raw.trackId) !== inputSourceId || raw.appointmentId !== null) {
    sourceError("registration_customer_message_source_mismatch")
  }
  const workflowStatus = requiredText(
    raw.workflowStatus,
    "registration_customer_message_waiting_workflow_invalid",
  )
  const expectedKind = WAITING_WORKFLOW_KIND[workflowStatus]
  if (!expectedKind || raw.waitingKind !== expectedKind) {
    sourceError("registration_customer_message_waiting_kind_mismatch")
  }
  const waitingClassId = nullableUuid(
    raw.waitingClassId,
    "registration_customer_message_waiting_class_invalid",
  )
  let waitingClassName: string | undefined
  if (expectedKind === "current_class") {
    if (!waitingClassId) sourceError("registration_customer_message_waiting_class_invalid")
    waitingClassName = requiredText(
      raw.waitingClassName,
      "registration_customer_message_waiting_class_invalid",
    )
  } else if (waitingClassId !== null || raw.waitingClassName !== null) {
    sourceError("registration_customer_message_waiting_class_invalid")
  }
  return {
    facts: { waitingKind: expectedKind, ...(waitingClassName ? { waitingClassName } : {}) },
    source: {
      trackId: inputSourceId,
      appointmentId: null,
      workflowStatus,
      waitingKind: expectedKind,
      waitingClassId,
      waitingClassName: waitingClassName ?? null,
    },
  } as const
}

function admissionFacts(raw: JsonRecord, inputSourceId: string) {
  if (requiredUuid(raw.taskId) !== inputSourceId || raw.trackId !== null || raw.appointmentId !== null) {
    sourceError("registration_customer_message_source_mismatch")
  }
  if (!Array.isArray(raw.tracks) || raw.tracks.length === 0) {
    sourceError("registration_customer_message_admission_tracks_invalid")
  }
  const tracks = raw.tracks.map((value) => {
    if (!isRecord(value)) sourceError("registration_customer_message_admission_tracks_invalid")
    const subject = value.subject
    if (!SUBJECT_ORDER.includes(subject as RegistrationCustomerMessageSubject)) {
      sourceError("registration_customer_message_admission_tracks_invalid")
    }
    const workflowRevision = value.workflowRevision
    if (typeof workflowRevision !== "number" || !Number.isSafeInteger(workflowRevision) || workflowRevision < 0) {
      sourceError("registration_customer_message_admission_tracks_invalid")
    }
    return {
      trackId: requiredUuid(value.trackId, "registration_customer_message_admission_tracks_invalid"),
      subject: subject as RegistrationCustomerMessageSubject,
      workflowStatus: requiredText(
        value.workflowStatus,
        "registration_customer_message_admission_tracks_invalid",
      ),
      workflowRevision,
      pipelineStatus: requiredText(
        value.pipelineStatus,
        "registration_customer_message_admission_tracks_invalid",
      ),
    }
  }).sort((left, right) => (
    SUBJECT_ORDER.indexOf(left.subject) - SUBJECT_ORDER.indexOf(right.subject)
    || left.trackId.localeCompare(right.trackId)
  ))
  return { facts: {}, source: { trackId: null, appointmentId: null, tracks } } as const
}

function normalizedSource(
  kind: RegistrationCustomerMessageKind,
  sourceId: string,
  raw: JsonRecord,
  now: Date,
) {
  if (raw.messageKind !== kind || requiredUuid(raw.sourceId) !== sourceId) {
    sourceError("registration_customer_message_source_mismatch")
  }
  const taskId = requiredUuid(raw.taskId)
  const studentName = requiredText(
    raw.studentName,
    "registration_customer_message_student_name_invalid",
  )
  const parentPhoneDigits = requiredText(
    raw.parentPhoneDigits,
    "registration_customer_message_phone_invalid",
  )
  if (!PHONE_PATTERN.test(parentPhoneDigits)) {
    sourceError("registration_customer_message_phone_invalid")
  }
  const normalizedSubjects = subjects(raw.subjects)
  const revision = sourceRevision(raw.sourceRevision)
  const variant = kind === "waiting_notice"
    ? waitingFacts(raw, sourceId)
    : kind === "admission_application"
      ? admissionFacts(raw, sourceId)
      : appointmentFacts(kind, raw, sourceId, now)
  return {
    taskId,
    studentName,
    parentPhoneDigits,
    subjects: normalizedSubjects,
    sourceRevision: revision,
    canonicalFacts: {
      studentName,
      subjects: normalizedSubjects,
      ...variant.facts,
    } satisfies RegistrationCustomerMessageCanonicalFacts,
    canonicalSource: {
      messageKind: kind,
      sourceId,
      taskId,
      sourceRevision: revision,
      studentName,
      subjects: normalizedSubjects,
      ...variant.source,
    },
  }
}

function recipientHash(parentPhoneDigits: string, pepper: string) {
  const normalizedPepper = pepper.trim()
  if (!normalizedPepper) sourceError("registration_customer_message_recipient_hash_pepper_missing")
  return createHmac("sha256", normalizedPepper)
    .update(`registration-customer-message-recipient-v1\u001f${parentPhoneDigits}`, "utf8")
    .digest("hex")
}

function sourceFactsChecksum(raw: JsonRecord) {
  const checksumSource = cloneJson(raw)
  delete checksumSource.parentPhoneDigits
  if (Object.prototype.hasOwnProperty.call(raw, "scheduledAt")) {
    checksumSource.scheduledAt = new CanonicalNumber(parsedTimestamp(raw.scheduledAt).epoch)
  }
  return sha256(canonicalJson({
    domain: "registration-customer-message-source-facts-v1",
    source: checksumSource,
  }))
}

function publicButtons(buttons: ReadonlyArray<RegistrationCustomerMessageButton>) {
  return Object.freeze(buttons.map((button) => Object.freeze({
    name: button.name,
    type: button.type,
    host: new URL(button.linkMobile).host,
  })))
}

export function createRegistrationCustomerMessageSourceResolver(
  dependencies: SourceResolverDependencies,
): RegistrationCustomerMessageSourceResolver {
  const now = dependencies.now ?? (() => new Date())

  return Object.freeze({
    async resolve(input) {
      const rawValue = await dependencies.resolveSource(input)
      if (!isRecord(rawValue)) sourceError("registration_customer_message_source_invalid")
      const raw = cloneJson(rawValue)
      const currentTime = now()
      if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
        sourceError("registration_customer_message_clock_invalid")
      }
      const normalized = normalizedSource(input.messageKind, input.sourceId, raw, currentTime)
      const template = dependencies.catalog.templates[input.messageKind]
      if (!template) sourceError("registration_customer_message_template_missing")
      const rendered = renderRegistrationCustomerMessage({
        kind: input.messageKind,
        facts: normalized.canonicalFacts,
      })
      const hash = recipientHash(
        normalized.parentPhoneDigits,
        dependencies.recipientHashPepper,
      )
      const fingerprint = sha256(canonicalJson({
        domain: "registration-customer-message-source-fingerprint-v1",
        recipientHash: hash,
        source: normalized.canonicalSource,
        template: {
          key: input.messageKind,
          revision: template.revision,
          checksum: template.checksums.template,
        },
      }))
      const factsChecksum = sourceFactsChecksum(raw)
      const publicSource = Object.freeze({
        messageKind: input.messageKind,
        sourceId: input.sourceId,
        taskId: normalized.taskId,
        sourceRevision: normalized.sourceRevision,
        studentName: normalized.studentName,
        recipientLast4: normalized.parentPhoneDigits.slice(-4),
        facts: rendered.facts,
        body: rendered.body,
        buttons: publicButtons(rendered.buttons),
      })
      const previewContract = Object.freeze({
        parentPhoneDigits: normalized.parentPhoneDigits,
        sourceFingerprint: fingerprint,
        recipientHash: hash,
        templateKey: input.messageKind,
        templateRevision: template.revision,
        templateChecksum: template.checksums.template,
        renderedVariablesChecksum: rendered.checksums.variables,
        renderedBodyChecksum: rendered.checksums.body,
        renderedButtonsChecksum: rendered.checksums.buttons,
      })
      PRIVATE_SOURCES.set(publicSource, Object.freeze({
        source: Object.freeze(normalized.canonicalSource),
        parentPhoneDigits: normalized.parentPhoneDigits,
        recipientHash: hash,
        sourceFingerprint: fingerprint,
        sourceFactsChecksum: factsChecksum,
        rendered,
        previewContract,
        readinessContract: Object.freeze({
          credentialsConfigured: dependencies.catalog.credentialsConfigured,
          pfId: dependencies.catalog.pfId,
          templateId: template.templateId,
          catalogChecksum: template.checksums.template,
          recipientHash: hash,
          sourceFingerprint: fingerprint,
          sourceFactsChecksum: factsChecksum,
        }),
      }))
      return publicSource
    },
  })
}

export function readRegistrationCustomerMessagePrivateSource(
  source: RegistrationCustomerMessagePublicSource,
) {
  const privateSource = PRIVATE_SOURCES.get(source)
  if (!privateSource) sourceError("registration_customer_message_private_source_unavailable")
  return privateSource
}
