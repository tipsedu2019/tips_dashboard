import { createHash } from "node:crypto"

import {
  REGISTRATION_CUSTOMER_MESSAGE_KINDS,
  isRegistrationCustomerMessageKind,
  type RegistrationCustomerMessageKind,
} from "../registration-customer-message-contract.ts"

export const REGISTRATION_CUSTOMER_MESSAGE_CATALOG_REVISION = 3 as const

export type RegistrationCustomerMessageTemplateEnvKey =
  | "SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID"

export const REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_ENV_KEYS: Readonly<
  Record<RegistrationCustomerMessageKind, RegistrationCustomerMessageTemplateEnvKey>
> = Object.freeze({
  level_test_booking: "SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID",
  visit_consultation_booking: "SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID",
  appointment_reminder: "SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID",
  waiting_notice: "SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID",
  admission_application: "SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID",
})

export const REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_REVISIONS: Readonly<
  Record<RegistrationCustomerMessageKind, number>
> = Object.freeze({
  level_test_booking: 2,
  visit_consultation_booking: 2,
  appointment_reminder: 2,
  waiting_notice: 1,
  admission_application: 2,
})

export type RegistrationCustomerMessageServerEnv = Readonly<{
  SOLAPI_API_KEY?: string
  SOLAPI_API_SECRET?: string
  SOLAPI_KAKAO_PF_ID?: string
  SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID?: string
  SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID?: string
  SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID?: string
  SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID?: string
  SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID?: string
  REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER?: string
}>

export type RegistrationCustomerMessageSubject = "영어" | "수학" | "과학"
export type RegistrationCustomerMessageAppointmentKind = "level_test" | "visit_consultation"
export type RegistrationCustomerMessageWaitingKind =
  | "current_class"
  | "current_term_opening"
  | "next_term_opening"

export type RegistrationCustomerMessageCanonicalFacts = Readonly<{
  studentName: string
  subjects: ReadonlyArray<RegistrationCustomerMessageSubject>
  scheduledAt?: string | Date
  place?: string
  appointmentKind?: RegistrationCustomerMessageAppointmentKind
  waitingKind?: RegistrationCustomerMessageWaitingKind
  waitingClassName?: string
}>

export type RegistrationCustomerMessageVariableName =
  | "학생명"
  | "예약종류"
  | "예약일시"
  | "장소"
  | "장소ID"
  | "과목"
  | "대기종류"
  | "대기내용"

export type RegistrationCustomerMessageButton = Readonly<{
  name: string
  type: "WL"
  linkMobile: string
  linkPc: string
}>

export type RegistrationCustomerMessageSendDefinition = Readonly<{
  type: "ATA"
  disableSms: true
}>

export type RegistrationCustomerMessageTemplate = Readonly<{
  content: string
  variables: ReadonlyArray<RegistrationCustomerMessageVariableName>
  buttons: ReadonlyArray<RegistrationCustomerMessageButton>
}>

export type RegistrationCustomerMessageTemplateChecksums = Readonly<{
  template: string
  content: string
  variables: string
  buttons: string
}>

export type RegistrationCustomerMessageCatalogEntry = RegistrationCustomerMessageTemplate & Readonly<{
  kind: RegistrationCustomerMessageKind
  revision: number
  envKey: RegistrationCustomerMessageTemplateEnvKey
  send: RegistrationCustomerMessageSendDefinition
  templateId: string | null
  templateConfigured: boolean
  checksums: RegistrationCustomerMessageTemplateChecksums
}>

export type RegistrationCustomerMessageCatalog = Readonly<{
  revision: typeof REGISTRATION_CUSTOMER_MESSAGE_CATALOG_REVISION
  credentialsConfigured: boolean
  pfId: string | null
  pfConfigured: boolean
  recipientHashPepperConfigured: boolean
  templates: Readonly<Record<RegistrationCustomerMessageKind, RegistrationCustomerMessageCatalogEntry>>
}>

export type RegistrationCustomerMessageRendered = Readonly<{
  kind: RegistrationCustomerMessageKind
  body: string
  variables: Readonly<Record<string, string>>
  buttons: ReadonlyArray<RegistrationCustomerMessageButton>
  facts: Readonly<{
    subjectLabel: string
    scheduleLabel?: string
    placeLabel?: string
    waitingKindLabel?: string
    waitingDetailLabel?: string
  }>
  checksums: Readonly<{
    variables: string
    body: string
    buttons: string
  }>
}>

type JsonRecord = Record<string, unknown>
type TemplateDefinition = RegistrationCustomerMessageTemplate & Readonly<{
  kind: RegistrationCustomerMessageKind
}>

const SEOUL_TIME_ZONE = "Asia/Seoul"
const RFC3339_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/i
const WEEKDAY_LABELS = [
  "일요일",
  "월요일",
  "화요일",
  "수요일",
  "목요일",
  "금요일",
  "토요일",
] as const
const SUBJECT_ORDER: ReadonlyArray<RegistrationCustomerMessageSubject> = ["영어", "수학", "과학"]
const SEND_DEFINITION: RegistrationCustomerMessageSendDefinition = Object.freeze({
  type: "ATA",
  disableSms: true,
})
const ADMISSION_FORM_URL = "https://pay.makeedu.co.kr/join/4A214239B585F87D809C141B2712F9D8"
const PLACE_IDS = Object.freeze({
  본관: "1218797840",
  별관: "1962638110",
} as const)
const PLACE_BUTTONS = Object.freeze([
  Object.freeze({
    name: "학원 위치 보기",
    type: "WL" as const,
    linkMobile: "https://map.naver.com/p/entry/place/#{장소ID}",
    linkPc: "https://map.naver.com/p/entry/place/#{장소ID}",
  }),
] as const)

const TEMPLATE_DEFINITIONS: Readonly<
  Record<RegistrationCustomerMessageKind, TemplateDefinition>
> = Object.freeze({
  level_test_booking: Object.freeze({
    kind: "level_test_booking",
    content: `[팁스영어수학학원] 레벨테스트 예약 안내

안녕하세요. #{학생명} 학생의 레벨테스트 예약을 안내드립니다.

일시: #{예약일시}
장소: #{장소}
과목: #{과목}

일정 변경이 필요하시면 학원으로 연락해 주세요.`,
    variables: Object.freeze(["학생명", "예약일시", "장소", "과목", "장소ID"] as const),
    buttons: PLACE_BUTTONS,
  }),
  visit_consultation_booking: Object.freeze({
    kind: "visit_consultation_booking",
    content: `[팁스영어수학학원] 방문상담 예약 안내

안녕하세요. #{학생명} 학생의 방문상담 예약을 안내드립니다.

일시: #{예약일시}
장소: #{장소}
과목: #{과목}

일정 변경이 필요하시면 학원으로 연락해 주세요.`,
    variables: Object.freeze(["학생명", "예약일시", "장소", "과목", "장소ID"] as const),
    buttons: PLACE_BUTTONS,
  }),
  appointment_reminder: Object.freeze({
    kind: "appointment_reminder",
    content: `[팁스영어수학학원] 예약 리마인드

안녕하세요. #{학생명} 학생의 #{예약종류} 일정을 다시 안내드립니다.

일시: #{예약일시}
장소: #{장소}
과목: #{과목}

변경이 필요하시면 학원으로 연락해 주세요.`,
    variables: Object.freeze(["학생명", "예약종류", "예약일시", "장소", "과목", "장소ID"] as const),
    buttons: PLACE_BUTTONS,
  }),
  waiting_notice: Object.freeze({
    kind: "waiting_notice",
    content: `[팁스영어수학학원] 대기 신청 접수 안내

안녕하세요. #{학생명} 학생의 #{과목} #{대기종류} 요청이 접수되었습니다.

대기 내용: #{대기내용}

변동 사항이 확인되는 대로 다시 안내드리겠습니다.`,
    variables: Object.freeze(["학생명", "과목", "대기종류", "대기내용"] as const),
    buttons: Object.freeze([] as const),
  }),
  admission_application: Object.freeze({
    kind: "admission_application",
    content: `[팁스영어수학학원] 입학신청서 작성 안내

안녕하세요. #{학생명} 학생의 입학 절차를 안내드립니다.

최종 원생 등록 및 교육비 납부 안내를 위해 입학신청서를 제출해 주세요.

입학신청서에는 원내 수강 규정, 원생의 건강·정서 상태 고지 의무, CCTV 활용 등 학원 생활에 필요한 중요 약관이 포함되어 있습니다. 내용을 확인하신 후 서명을 완료해 주세요.

아래 버튼에서 입학신청서를 작성할 수 있습니다.`,
    variables: Object.freeze(["학생명"] as const),
    buttons: Object.freeze([
      Object.freeze({
        name: "입학신청서 작성",
        type: "WL",
        linkMobile: ADMISSION_FORM_URL,
        linkPc: ADMISSION_FORM_URL,
      }),
    ] as const),
  }),
})

function catalogError(code: string): never {
  throw new Error(code)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (!isRecord(value)) catalogError("registration_customer_message_checksum_value_invalid")
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function requiredText(value: unknown, code: string) {
  const normalized = text(value)
  return normalized || catalogError(code)
}

function studentNameVariable(value: unknown) {
  const normalized = requiredText(value, "registration_customer_message_student_name_invalid")
  const withoutDisplaySuffix = normalized.replace(/\s+학생$/u, "").trim()
  return withoutDisplaySuffix || catalogError("registration_customer_message_student_name_invalid")
}

function parsedDate(value: unknown) {
  if (value instanceof Date) {
    const date = new Date(value.getTime())
    if (!Number.isFinite(date.getTime())) catalogError("registration_customer_message_schedule_invalid")
    return date
  }
  if (typeof value !== "string") {
    catalogError("registration_customer_message_schedule_invalid")
  }

  const normalized = value.trim()
  const match = normalized.match(RFC3339_TIMESTAMP_PATTERN)
  if (!match) catalogError("registration_customer_message_schedule_invalid")
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
  ) catalogError("registration_customer_message_schedule_invalid")

  const date = new Date(normalized)
  if (!Number.isFinite(date.getTime())) catalogError("registration_customer_message_schedule_invalid")
  return date
}

function seoulParts(value: unknown) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsedDate(value))
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  const year = Number(byType.get("year"))
  const month = Number(byType.get("month"))
  const day = Number(byType.get("day"))
  const hour = Number(byType.get("hour"))
  const minute = byType.get("minute")
  const localDate = new Date(Date.UTC(year, month - 1, day))
  if (
    !Number.isInteger(year)
    || !Number.isInteger(month)
    || !Number.isInteger(day)
    || !Number.isInteger(hour)
    || typeof minute !== "string"
    || !Number.isFinite(localDate.getTime())
  ) catalogError("registration_customer_message_schedule_invalid")
  return { year, month, day, hour: hour === 24 ? 0 : hour, minute, weekday: localDate.getUTCDay() }
}

export function formatRegistrationCustomerMessageSchedule(value: string | Date) {
  const parts = seoulParts(value)
  const period = parts.hour < 12 ? "오전" : "오후"
  const hour = parts.hour % 12 || 12
  return `${parts.year}년 ${parts.month}월 ${parts.day}일 ${WEEKDAY_LABELS[parts.weekday]} ${period} ${hour}:${parts.minute}`
}

export function formatRegistrationCustomerMessageSubjects(values: ReadonlyArray<unknown>) {
  if (!Array.isArray(values) || values.length === 0) {
    catalogError("registration_customer_message_subject_invalid")
  }
  const subjects = values.map((value) => {
    if (!SUBJECT_ORDER.includes(value as RegistrationCustomerMessageSubject)) {
      catalogError("registration_customer_message_subject_invalid")
    }
    return value as RegistrationCustomerMessageSubject
  })
  const unique = subjects.filter((subject, index) => subjects.indexOf(subject) === index)
  return unique.sort((left, right) => SUBJECT_ORDER.indexOf(left) - SUBJECT_ORDER.indexOf(right)).join(" · ")
}

export function resolveRegistrationCustomerMessageWaitingLabels(
  kind: unknown,
  className?: unknown,
) {
  if (kind === "current_class") {
    return {
      waitingKindLabel: "현재반 대기",
      waitingDetailLabel: requiredText(
        className,
        "registration_customer_message_waiting_class_required",
      ),
    }
  }
  if (kind === "current_term_opening") {
    return {
      waitingKindLabel: "신규반 대기",
      waitingDetailLabel: "신규반 개설 대기",
    }
  }
  if (kind === "next_term_opening") {
    return {
      waitingKindLabel: "다음 개강 알림",
      waitingDetailLabel: "다음 개강 일정 알림 요청",
    }
  }
  return catalogError("registration_customer_message_waiting_kind_invalid")
}

function normalizedButtons(buttons: ReadonlyArray<RegistrationCustomerMessageButton>) {
  return buttons.map((button) => ({
    name: button.name,
    type: button.type,
    linkMobile: button.linkMobile,
    linkPc: button.linkPc,
  }))
}

export function checksumRegistrationCustomerMessageTemplate(
  template: RegistrationCustomerMessageTemplate,
) {
  return sha256(canonicalJson({
    content: template.content,
    variables: [...template.variables],
    buttons: normalizedButtons(template.buttons),
  }))
}

function templateChecksums(template: RegistrationCustomerMessageTemplate) {
  const buttons = normalizedButtons(template.buttons)
  return Object.freeze({
    template: checksumRegistrationCustomerMessageTemplate(template),
    content: sha256(template.content),
    variables: sha256(canonicalJson([...template.variables])),
    buttons: sha256(canonicalJson(buttons)),
  })
}

export function createRegistrationCustomerMessageCatalog(
  env: RegistrationCustomerMessageServerEnv,
): RegistrationCustomerMessageCatalog {
  const templates = {} as Record<RegistrationCustomerMessageKind, RegistrationCustomerMessageCatalogEntry>
  for (const kind of REGISTRATION_CUSTOMER_MESSAGE_KINDS) {
    const definition = TEMPLATE_DEFINITIONS[kind]
    const envKey = REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_ENV_KEYS[kind]
    const templateId = text(env[envKey]) || null
    templates[kind] = Object.freeze({
      ...definition,
      revision: REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_REVISIONS[kind],
      envKey,
      send: SEND_DEFINITION,
      templateId,
      templateConfigured: Boolean(templateId),
      checksums: templateChecksums(definition),
    })
  }

  const pfId = text(env.SOLAPI_KAKAO_PF_ID) || null
  return Object.freeze({
    revision: REGISTRATION_CUSTOMER_MESSAGE_CATALOG_REVISION,
    credentialsConfigured: Boolean(text(env.SOLAPI_API_KEY) && text(env.SOLAPI_API_SECRET)),
    pfId,
    pfConfigured: Boolean(pfId),
    recipientHashPepperConfigured: Boolean(text(env.REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER)),
    templates: Object.freeze(templates),
  })
}

function appointmentKindLabel(value: unknown) {
  if (value === "level_test") return "레벨테스트"
  if (value === "visit_consultation") return "방문상담"
  return catalogError("registration_customer_message_appointment_kind_invalid")
}

function appointmentVariables(
  kind: RegistrationCustomerMessageKind,
  facts: RegistrationCustomerMessageCanonicalFacts,
) {
  if (kind === "level_test_booking" && facts.appointmentKind !== "level_test") {
    catalogError("registration_customer_message_appointment_kind_invalid")
  }
  if (kind === "visit_consultation_booking" && facts.appointmentKind !== "visit_consultation") {
    catalogError("registration_customer_message_appointment_kind_invalid")
  }
  const schedule = formatRegistrationCustomerMessageSchedule(
    facts.scheduledAt as string | Date,
  )
  const place = requiredText(facts.place, "registration_customer_message_place_invalid")
  const placeId = place === "본관" || /^팁스학원(?:\s|$)/u.test(place)
    ? PLACE_IDS.본관
    : place === "별관" || /^제주수학학원(?:\s|$)/u.test(place)
      ? PLACE_IDS.별관
      : null
  if (!placeId) catalogError("registration_customer_message_place_invalid")
  return { schedule, place, placeId }
}

function renderVariables(
  kind: RegistrationCustomerMessageKind,
  facts: RegistrationCustomerMessageCanonicalFacts,
) {
  const definition = TEMPLATE_DEFINITIONS[kind]
  const studentName = studentNameVariable(facts.studentName)
  const subjectLabel = formatRegistrationCustomerMessageSubjects(facts.subjects)
  const values: Partial<Record<RegistrationCustomerMessageVariableName, string>> = {
    학생명: studentName,
    과목: subjectLabel,
  }
  const labels: {
    subjectLabel: string
    scheduleLabel?: string
    placeLabel?: string
    waitingKindLabel?: string
    waitingDetailLabel?: string
  } = { subjectLabel }

  if (
    kind === "level_test_booking"
    || kind === "visit_consultation_booking"
    || kind === "appointment_reminder"
  ) {
    const appointment = appointmentVariables(kind, facts)
    values.예약일시 = appointment.schedule
    values.장소 = appointment.place
    values.장소ID = appointment.placeId
    labels.scheduleLabel = appointment.schedule
    labels.placeLabel = appointment.place
    if (kind === "appointment_reminder") {
      values.예약종류 = appointmentKindLabel(facts.appointmentKind)
    }
  }

  if (kind === "waiting_notice") {
    const waiting = resolveRegistrationCustomerMessageWaitingLabels(
      facts.waitingKind,
      facts.waitingClassName,
    )
    values.대기종류 = waiting.waitingKindLabel
    values.대기내용 = waiting.waitingDetailLabel
    labels.waitingKindLabel = waiting.waitingKindLabel
    labels.waitingDetailLabel = waiting.waitingDetailLabel
  }

  const variables: Record<string, string> = {}
  for (const name of definition.variables) {
    const value = values[name]
    if (!value) catalogError("registration_customer_message_variable_missing")
    variables[`#{${name}}`] = value
  }
  return { variables: Object.freeze(variables), labels: Object.freeze(labels) }
}

export function renderRegistrationCustomerMessage(input: {
  kind: RegistrationCustomerMessageKind
  facts: RegistrationCustomerMessageCanonicalFacts
}): RegistrationCustomerMessageRendered {
  if (!isRegistrationCustomerMessageKind(input.kind)) {
    catalogError("registration_customer_message_kind_invalid")
  }
  const definition = TEMPLATE_DEFINITIONS[input.kind]
  const rendered = renderVariables(input.kind, input.facts)
  const body = definition.content.replace(/#\{[^}]+\}/gu, (token) => (
    rendered.variables[token]
    ?? catalogError("registration_customer_message_variable_missing")
  ))

  return Object.freeze({
    kind: input.kind,
    body,
    variables: rendered.variables,
    buttons: definition.buttons,
    facts: rendered.labels,
    checksums: Object.freeze({
      variables: sha256(canonicalJson(rendered.variables)),
      body: sha256(body),
      buttons: sha256(canonicalJson(normalizedButtons(definition.buttons))),
    }),
  })
}
