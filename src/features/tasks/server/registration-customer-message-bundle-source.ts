import type {
  RegistrationCustomerMessageBundleKind,
  RegistrationCustomerMessageSingleSourceKind,
} from "../registration-customer-message-contract.ts"
import {
  formatRegistrationCustomerMessageSchedule,
  renderRegistrationCustomerMessage,
  type RegistrationCustomerMessageCatalog,
} from "./registration-customer-message-catalog.ts"

type JsonRecord = Record<string, unknown>

export type RegistrationCustomerMessageBundleSourceItem = Readonly<{
  sourceKind: "level_test" | "visit_consultation" | "observation"
  sourceId: string
  sourceRevision: Readonly<Record<string, unknown>>
  trackId: string
  activityId: string | null
  subject: "영어" | "수학" | "과학"
  scheduledAt: string
  serviceDate: string
  place: "본관" | "별관"
  className: string | null
  teacherName: string | null
  sourceFactHash: string
}>

export type RegistrationCustomerMessageBundleSource = Readonly<{
  messageKind: RegistrationCustomerMessageBundleKind
  taskId: string
  bundleId: string
  bundleRevision: number
  reservationKind: "level_test" | "visit_consultation" | "observation"
  deliveryKind: "booking" | "reminder"
  serviceDate: string | null
  recipientRevision: number
  sourceFingerprint: string
  studentName: string
  parentPhoneDigits: string
  items: ReadonlyArray<RegistrationCustomerMessageBundleSourceItem>
}>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const HASH = /^[a-f0-9]{64}$/u
const PHONE = /^01(?:0|1|[6-9])[0-9]{7,8}$/u
const DATE = /^\d{4}-\d{2}-\d{2}$/u
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u
const kinds = new Set<RegistrationCustomerMessageBundleKind>([
  "level_test_booking_bundle", "visit_consultation_booking_bundle", "observation_booking_bundle",
  "level_test_reminder_bundle", "visit_consultation_reminder_bundle", "observation_reminder_bundle",
])
const SUBJECT_ORDER = ["영어", "수학", "과학"] as const

function invalid(): never { throw new Error("registration_customer_message_bundle_source_invalid") }
function record(value: unknown): value is JsonRecord { return typeof value === "object" && value !== null && !Array.isArray(value) }
function exact(value: JsonRecord, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every((key) => key in value) }
function uuid(value: unknown) { return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : invalid() }
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : invalid() }
function timestamp(value: unknown) {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) invalid()
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : invalid()
}

function templateKind(source: RegistrationCustomerMessageBundleSource): RegistrationCustomerMessageSingleSourceKind {
  if (source.reservationKind === "level_test") {
    return source.deliveryKind === "booking" ? "level_test_booking" : "appointment_reminder"
  }
  if (source.reservationKind === "visit_consultation") {
    return source.deliveryKind === "booking" ? "visit_consultation_booking" : "appointment_reminder"
  }
  return source.deliveryKind === "booking" ? "observation_booking" : "observation_reminder"
}

function orderedItems(items: ReadonlyArray<RegistrationCustomerMessageBundleSourceItem>) {
  return [...items].sort((left, right) => (
    left.scheduledAt.localeCompare(right.scheduledAt)
    || SUBJECT_ORDER.indexOf(left.subject) - SUBJECT_ORDER.indexOf(right.subject)
  ))
}

function sharedOrPerSubject(
  items: ReadonlyArray<RegistrationCustomerMessageBundleSourceItem>,
  value: (item: RegistrationCustomerMessageBundleSourceItem) => string,
) {
  const values = items.map(value)
  if (values.every((entry) => entry === values[0])) return values[0]
  return items.map((item) => `${value(item)}(${item.subject})`).join(", ")
}

export function parseRegistrationCustomerMessageBundleSource(value: unknown): RegistrationCustomerMessageBundleSource {
  if (!record(value) || !exact(value, ["messageKind", "sourceId", "bundleId", "bundleRevision", "taskId", "reservationKind", "deliveryKind", "serviceDate", "recipientRevision", "sourceFingerprint", "studentName", "parentPhoneDigits", "items"])) invalid()
  if (typeof value.messageKind !== "string" || !kinds.has(value.messageKind as RegistrationCustomerMessageBundleKind)) invalid()
  const messageKind = value.messageKind as RegistrationCustomerMessageBundleKind
  const taskId = uuid(value.taskId)
  if (uuid(value.sourceId) !== taskId) invalid()
  const reservationKind = value.reservationKind
  const deliveryKind = value.deliveryKind
  if ((reservationKind !== "level_test" && reservationKind !== "visit_consultation" && reservationKind !== "observation") || (deliveryKind !== "booking" && deliveryKind !== "reminder")) invalid()
  if (!messageKind.startsWith(`${reservationKind}_`) || messageKind.endsWith("reminder_bundle") !== (deliveryKind === "reminder")) invalid()
  if (!Number.isSafeInteger(value.bundleRevision) || (value.bundleRevision as number) < 1 || !Number.isSafeInteger(value.recipientRevision) || (value.recipientRevision as number) < 1) invalid()
  if (typeof value.sourceFingerprint !== "string" || !HASH.test(value.sourceFingerprint) || typeof value.parentPhoneDigits !== "string" || !PHONE.test(value.parentPhoneDigits)) invalid()
  if ((value.serviceDate !== null && (typeof value.serviceDate !== "string" || !DATE.test(value.serviceDate))) || (deliveryKind === "reminder" && value.serviceDate === null) || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 3) invalid()
  const subjects = new Set<string>()
  const items = value.items.map((item) => {
    if (!record(item) || !exact(item, ["sourceKind", "sourceId", "sourceRevision", "trackId", "activityId", "subject", "scheduledAt", "serviceDate", "place", "className", "teacherName", "sourceFactHash"]) || !record(item.sourceRevision)) invalid()
    if (item.sourceKind !== reservationKind || (item.subject !== "영어" && item.subject !== "수학" && item.subject !== "과학") || subjects.has(item.subject) || typeof item.serviceDate !== "string" || !DATE.test(item.serviceDate) || (item.place !== "본관" && item.place !== "별관") || typeof item.sourceFactHash !== "string" || !HASH.test(item.sourceFactHash) || (item.activityId !== null && typeof item.activityId !== "string") || (item.className === null) !== (item.teacherName === null)) invalid()
    subjects.add(item.subject)
    return Object.freeze({ sourceKind: item.sourceKind as RegistrationCustomerMessageBundleSourceItem["sourceKind"], sourceId: uuid(item.sourceId), sourceRevision: Object.freeze({ ...item.sourceRevision }), trackId: uuid(item.trackId), activityId: item.activityId === null ? null : uuid(item.activityId), subject: item.subject as RegistrationCustomerMessageBundleSourceItem["subject"], scheduledAt: timestamp(item.scheduledAt), serviceDate: item.serviceDate, place: item.place as RegistrationCustomerMessageBundleSourceItem["place"], className: item.className === null ? null : text(item.className), teacherName: item.teacherName === null ? null : text(item.teacherName), sourceFactHash: item.sourceFactHash })
  })
  return Object.freeze({ messageKind, taskId, bundleId: uuid(value.bundleId), bundleRevision: value.bundleRevision as number, reservationKind, deliveryKind, serviceDate: value.serviceDate as string | null, recipientRevision: value.recipientRevision as number, sourceFingerprint: value.sourceFingerprint, studentName: text(value.studentName), parentPhoneDigits: value.parentPhoneDigits, items: Object.freeze(items) })
}

export function createRegistrationCustomerMessageBundleSourceResolver(dependencies: Readonly<{
  catalog: RegistrationCustomerMessageCatalog
  resolveSource(input: Readonly<{ messageKind: RegistrationCustomerMessageBundleKind; sourceId: string }>): Promise<unknown>
}>) {
  return Object.freeze({
    async resolve(input: Readonly<{ messageKind: RegistrationCustomerMessageBundleKind; sourceId: string }>) {
      const source = parseRegistrationCustomerMessageBundleSource(await dependencies.resolveSource(input))
      if (source.messageKind !== input.messageKind || source.taskId !== input.sourceId) invalid()
      const items = orderedItems(source.items)
      const kind = templateKind(source)
      const rendered = renderRegistrationCustomerMessage({
        kind,
        facts: {
          studentName: source.studentName,
          subjects: items.map((item) => item.subject),
          subjectLabelOverride: [...items]
            .sort((left, right) => SUBJECT_ORDER.indexOf(left.subject) - SUBJECT_ORDER.indexOf(right.subject))
            .map((item) => item.subject).join(", "),
          scheduledAt: items[0].scheduledAt,
          scheduleLabelOverride: sharedOrPerSubject(items, (item) => formatRegistrationCustomerMessageSchedule(item.scheduledAt)),
          place: items[0].place,
          placeLabelOverride: sharedOrPerSubject(items, (item) => item.place),
          ...(source.reservationKind === "level_test" || source.reservationKind === "visit_consultation"
            ? { appointmentKind: source.reservationKind }
            : {
              campus: items[0].place,
              className: items[0].className || undefined,
              teacherName: items[0].teacherName || undefined,
              classNameOverride: sharedOrPerSubject(items, (item) => item.className || ""),
              teacherNameOverride: sharedOrPerSubject(items, (item) => item.teacherName || ""),
            }),
        },
      })
      return Object.freeze({
        messageKind: source.messageKind,
        templateKind: kind,
        sourceId: source.taskId,
        taskId: source.taskId,
        studentName: source.studentName,
        facts: Object.freeze({
          subjectLabel: rendered.facts.subjectLabel,
          scheduleLabel: rendered.facts.scheduleLabel,
          placeLabel: rendered.facts.placeLabel,
          reservations: items.map((item) => Object.freeze({
            subjectLabel: item.subject,
            scheduleLabel: formatRegistrationCustomerMessageSchedule(item.scheduledAt),
            placeLabel: item.place,
            className: item.className,
            teacherLabel: item.teacherName === null ? null : `${item.teacherName} 선생님`,
          })),
        }),
        body: rendered.body,
        buttons: rendered.buttons.map((button) => Object.freeze({
          name: button.name,
          type: button.type,
          host: new URL(button.linkMobile).host,
        })),
      })
    },
  })
}
