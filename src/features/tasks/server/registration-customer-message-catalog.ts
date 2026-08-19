import { createHash } from "node:crypto"

import {
  isRegistrationCustomerMessageSingleSourceKind,
  type RegistrationCustomerMessageSingleSourceKind,
} from "../registration-customer-message-contract.ts"

export const REGISTRATION_CUSTOMER_MESSAGE_CATALOG_REVISION = 6 as const

export type RegistrationCustomerMessageTemplateEnvKey =
  | "SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID"

export const REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_ENV_KEYS: Readonly<
  Record<RegistrationCustomerMessageSingleSourceKind, RegistrationCustomerMessageTemplateEnvKey>
> = Object.freeze({
  level_test_booking: "SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID",
  visit_consultation_booking: "SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID",
  appointment_reminder: "SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID",
  waiting_notice: "SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID",
  admission_application: "SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID",
  observation_booking: "SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID",
  observation_reminder: "SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID",
})

export const REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_REVISIONS: Readonly<
  Record<RegistrationCustomerMessageSingleSourceKind, number>
> = Object.freeze({
  level_test_booking: 3,
  visit_consultation_booking: 3,
  appointment_reminder: 3,
  waiting_notice: 2,
  admission_application: 3,
  observation_booking: 2,
  observation_reminder: 2,
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
  SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID?: string
  SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID?: string
  REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER?: string
}>

export type RegistrationCustomerMessageSubject = "영어" | "수학" | "과학"
export type RegistrationCustomerMessageAppointmentKind = "level_test" | "visit_consultation"
export type RegistrationCustomerMessageWaitingKind =
  | "current_class"
  | "current_term_opening"
  | "next_term_opening"

export type RegistrationCustomerMessageAdmissionScheduleSlot = Readonly<{
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6
  startTime: string
  endTime: string
  teacherName: string
  classroomName: string
}>

export type RegistrationCustomerMessageFirstLesson = Readonly<{
  sessionDate: string
  startTime: string
  endTime: string
}>

export type RegistrationCustomerMessageAdmissionPlan = Readonly<{
  enrollmentId: string
  subject: RegistrationCustomerMessageSubject
  sortOrder: number
  className: string
  textbookName: string | null
  slots: ReadonlyArray<RegistrationCustomerMessageAdmissionScheduleSlot>
  firstLesson: RegistrationCustomerMessageFirstLesson
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

export type RegistrationCustomerMessageCanonicalFacts = Readonly<{
  studentName: string
  subjects: ReadonlyArray<RegistrationCustomerMessageSubject>
  scheduledAt?: string | Date
  place?: string
  subjectLabelOverride?: string
  scheduleLabelOverride?: string
  placeLabelOverride?: string
  appointmentKind?: RegistrationCustomerMessageAppointmentKind
  waitingKind?: RegistrationCustomerMessageWaitingKind
  waitingClassName?: string
  enrollmentPlans?: ReadonlyArray<RegistrationCustomerMessageAdmissionPlan>
  className?: string
  campus?: "본관" | "별관"
  teacherName?: string
  classNameOverride?: string
  teacherNameOverride?: string
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
  | "등록수업안내"
  | "수업명"
  | "담당선생님"

export type RegistrationCustomerMessageTransportVariableName = "학원위치URL"

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
  transportVariables?: ReadonlyArray<RegistrationCustomerMessageTransportVariableName>
  buttons: ReadonlyArray<RegistrationCustomerMessageButton>
}>

export type RegistrationCustomerMessageTemplateChecksums = Readonly<{
  template: string
  content: string
  variables: string
  buttons: string
}>

export type RegistrationCustomerMessageCatalogEntry = RegistrationCustomerMessageTemplate & Readonly<{
  kind: RegistrationCustomerMessageSingleSourceKind
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
  templates: Readonly<Record<RegistrationCustomerMessageSingleSourceKind, RegistrationCustomerMessageCatalogEntry>>
}>

export type RegistrationCustomerMessageRendered = Readonly<{
  kind: RegistrationCustomerMessageSingleSourceKind
  body: string
  variables: Readonly<Record<string, string>>
  buttons: ReadonlyArray<RegistrationCustomerMessageButton>
  facts: Readonly<{
    subjectLabel: string
    scheduleLabel?: string
    placeLabel?: string
    waitingKindLabel?: string
    waitingDetailLabel?: string
    admissionPlans?: ReadonlyArray<RegistrationCustomerMessageAdmissionPreviewPlan>
  }>
  checksums: Readonly<{
    variables: string
    body: string
    buttons: string
  }>
}>

type JsonRecord = Record<string, unknown>
type TemplateDefinition = RegistrationCustomerMessageTemplate & Readonly<{
  kind: RegistrationCustomerMessageSingleSourceKind
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
const SHORT_WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
const CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u
const SUBJECT_ORDER: ReadonlyArray<RegistrationCustomerMessageSubject> = ["영어", "수학", "과학"]
const SEND_DEFINITION: RegistrationCustomerMessageSendDefinition = Object.freeze({
  type: "ATA",
  disableSms: true,
})
const ADMISSION_FORM_URL = "https://pay.makeedu.co.kr/join/4A214239B585F87D809C141B2712F9D8"
const CONTACT_BUTTON = Object.freeze({
  name: "문의하기",
  type: "WL" as const,
  linkMobile: "https://tipsedu.channel.io",
  linkPc: "https://tipsedu.channel.io",
})
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
  CONTACT_BUTTON,
] as const)
export const OBSERVATION_LOCATION_URLS = Object.freeze({
  본관: "https://map.naver.com/p/entry/place/1218797840",
  별관: "https://map.naver.com/p/entry/place/1962638110",
} as const)
export const OBSERVATION_LOCATION_TRANSPORT_VALUES = Object.freeze({
  본관: OBSERVATION_LOCATION_URLS.본관.slice("https://".length),
  별관: OBSERVATION_LOCATION_URLS.별관.slice("https://".length),
} as const)
const OBSERVATION_BUTTONS = Object.freeze([
  Object.freeze({
    name: "학원 위치 보기",
    type: "WL" as const,
    linkMobile: "https://#{학원위치URL}",
    linkPc: "https://#{학원위치URL}",
  }),
  CONTACT_BUTTON,
] as const)

const TEMPLATE_DEFINITIONS: Readonly<
  Record<RegistrationCustomerMessageSingleSourceKind, TemplateDefinition>
> = Object.freeze({
  level_test_booking: Object.freeze({
    kind: "level_test_booking",
    content: `[팁스영어수학학원] 레벨테스트 예약 안내

안녕하세요. #{학생명} 학생의 레벨테스트 예약을 안내드립니다.

일시: #{예약일시}
장소: #{장소}
과목: #{과목}

일정 변경 및 문의는 아래 문의하기 버튼을 이용해 주세요.`,
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

일정 변경 및 문의는 아래 문의하기 버튼을 이용해 주세요.`,
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

일정 변경 및 문의는 아래 문의하기 버튼을 이용해 주세요.`,
    variables: Object.freeze(["학생명", "예약종류", "예약일시", "장소", "과목", "장소ID"] as const),
    buttons: PLACE_BUTTONS,
  }),
  waiting_notice: Object.freeze({
    kind: "waiting_notice",
    content: `[팁스영어수학학원] 대기 신청 접수 안내

안녕하세요. #{학생명} 학생의 #{과목} #{대기종류} 요청이 접수되었습니다.

대기 내용: #{대기내용}

변동 사항이 확인되는 대로 다시 안내드리겠습니다.

변동사항 및 문의는 아래 문의하기 버튼을 이용해 주세요.`,
    variables: Object.freeze(["학생명", "과목", "대기종류", "대기내용"] as const),
    buttons: Object.freeze([CONTACT_BUTTON] as const),
  }),
  admission_application: Object.freeze({
    kind: "admission_application",
    content: `[팁스영어수학학원] 입학신청서 작성 안내

안녕하세요. #{학생명} 학생의 입학 절차를 안내드립니다.

[등록 수업 정보]
#{등록수업안내}

자세한 수업 일정은 학원 홈페이지에서 확인해 주세요.

최종 원생 등록 및 교육비 납부 안내를 위해 입학신청서를 제출해 주세요.

입학신청서에는 원내 수강 규정, 원생의 건강·정서 상태 고지 의무, CCTV 활용 등 학원 생활에 필요한 중요 약관이 포함되어 있습니다. 내용을 확인하신 후 서명을 완료해 주세요.

아래 버튼에서 입학신청서를 작성할 수 있습니다.
변동사항 및 문의는 아래 문의하기 버튼을 이용해 주세요.`,
    variables: Object.freeze(["학생명", "등록수업안내"] as const),
    buttons: Object.freeze([
      Object.freeze({
        name: "입학신청서 작성",
        type: "WL",
        linkMobile: ADMISSION_FORM_URL,
        linkPc: ADMISSION_FORM_URL,
      }),
      CONTACT_BUTTON,
    ] as const),
  }),
  observation_booking: Object.freeze({
    kind: "observation_booking",
    content: `[팁스영어수학학원] 청강 예약 안내

안녕하세요. #{학생명} 학생의 #{과목} 청강 예약을 안내드립니다.

수업: #{수업명}
일시: #{예약일시}
장소: #{장소}
담당 선생님: #{담당선생님}

수업 준비를 위해 예약 시간에 맞춰 방문해 주세요.
일정 변경 및 문의는 아래 문의하기 버튼을 이용해 주세요.`,
    variables: Object.freeze(["학생명", "과목", "수업명", "예약일시", "장소", "담당선생님"] as const),
    transportVariables: Object.freeze(["학원위치URL"] as const),
    buttons: OBSERVATION_BUTTONS,
  }),
  observation_reminder: Object.freeze({
    kind: "observation_reminder",
    content: `[팁스영어수학학원] 청강 일정 안내

안녕하세요. #{학생명} 학생의 #{과목} 청강 일정을 다시 안내드립니다.

수업: #{수업명}
일시: #{예약일시}
장소: #{장소}
담당 선생님: #{담당선생님}

예약 시간에 맞춰 방문해 주세요.
변동사항 및 문의는 아래 문의하기 버튼을 이용해 주세요.`,
    variables: Object.freeze(["학생명", "과목", "수업명", "예약일시", "장소", "담당선생님"] as const),
    transportVariables: Object.freeze(["학원위치URL"] as const),
    buttons: OBSERVATION_BUTTONS,
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

type NormalizedAdmissionScheduleSlot = Readonly<{
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6
  startTime: string
  endTime: string
  startMinutes: number
  endMinutes: number
  teacherName: string
  classroomName: string
}>

type NormalizedAdmissionPlan = Readonly<{
  enrollmentId: string
  subject: RegistrationCustomerMessageSubject
  sortOrder: number
  className: string
  textbookLabel: string
  slots: ReadonlyArray<NormalizedAdmissionScheduleSlot>
  firstLessonLabel: string
}>

function compareCodePointText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function weekdayRank(weekday: number) {
  return WEEKDAY_ORDER.indexOf(weekday as (typeof WEEKDAY_ORDER)[number])
}

function clock(value: unknown) {
  if (typeof value !== "string" || !CLOCK_PATTERN.test(value)) {
    catalogError("registration_customer_message_admission_schedule_incomplete")
  }
  const [hour, minute] = value.split(":").map(Number)
  return { value, minutes: hour * 60 + minute }
}

function bareClock(minutes: number) {
  const hour = Math.floor(minutes / 60) % 12 || 12
  const minute = String(minutes % 60).padStart(2, "0")
  return `${hour}:${minute}`
}

function clockPeriod(minutes: number) {
  return minutes < 12 * 60 ? "오전" : "오후"
}

function formatTimeRange(startTime: unknown, endTime: unknown) {
  const start = clock(startTime)
  const end = clock(endTime)
  if (end.minutes <= start.minutes) {
    catalogError("registration_customer_message_admission_schedule_incomplete")
  }
  const startPeriod = clockPeriod(start.minutes)
  const endPeriod = clockPeriod(end.minutes)
  return `${startPeriod} ${bareClock(start.minutes)}–${
    startPeriod === endPeriod ? bareClock(end.minutes) : `${endPeriod} ${bareClock(end.minutes)}`
  }`
}

function normalizeAdmissionSlots(value: unknown): ReadonlyArray<NormalizedAdmissionScheduleSlot> {
  if (!Array.isArray(value) || value.length === 0) {
    catalogError("registration_customer_message_admission_schedule_incomplete")
  }
  const slots = value.map((candidate) => {
    if (!isRecord(candidate)) {
      catalogError("registration_customer_message_admission_schedule_incomplete")
    }
    const weekday = candidate.weekday
    if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      catalogError("registration_customer_message_admission_schedule_incomplete")
    }
    const start = clock(candidate.startTime)
    const end = clock(candidate.endTime)
    if (end.minutes <= start.minutes) {
      catalogError("registration_customer_message_admission_schedule_incomplete")
    }
    return Object.freeze({
      weekday: weekday as NormalizedAdmissionScheduleSlot["weekday"],
      startTime: start.value,
      endTime: end.value,
      startMinutes: start.minutes,
      endMinutes: end.minutes,
      teacherName: requiredText(
        candidate.teacherName,
        "registration_customer_message_admission_schedule_incomplete",
      ),
      classroomName: requiredText(
        candidate.classroomName,
        "registration_customer_message_admission_schedule_incomplete",
      ),
    })
  })
  return Object.freeze(slots)
}

function formatRecurringSchedule(slots: ReadonlyArray<NormalizedAdmissionScheduleSlot>) {
  const groups = new Map<string, {
    startTime: string
    endTime: string
    startMinutes: number
    endMinutes: number
    weekdays: Set<number>
  }>()
  for (const slot of slots) {
    const key = `${slot.startTime}-${slot.endTime}`
    const group = groups.get(key) ?? {
      startTime: slot.startTime,
      endTime: slot.endTime,
      startMinutes: slot.startMinutes,
      endMinutes: slot.endMinutes,
      weekdays: new Set<number>(),
    }
    group.weekdays.add(slot.weekday)
    groups.set(key, group)
  }
  return [...groups.values()]
    .sort((left, right) => (
      Math.min(...[...left.weekdays].map(weekdayRank))
      - Math.min(...[...right.weekdays].map(weekdayRank))
      || left.startMinutes - right.startMinutes
      || left.endMinutes - right.endMinutes
    ))
    .map((group) => {
      const weekdays = [...group.weekdays]
        .sort((left, right) => weekdayRank(left) - weekdayRank(right))
        .map((weekday) => SHORT_WEEKDAY_LABELS[weekday])
        .join("·")
      return `${weekdays} ${formatTimeRange(group.startTime, group.endTime)}`
    })
    .join(" · ")
}

function formatSlotAssignment(
  slots: ReadonlyArray<NormalizedAdmissionScheduleSlot>,
  key: "teacherName" | "classroomName",
) {
  const groups = new Map<string, Set<number>>()
  for (const slot of slots) {
    const weekdays = groups.get(slot[key]) ?? new Set<number>()
    weekdays.add(slot.weekday)
    groups.set(slot[key], weekdays)
  }
  if (groups.size === 1) return groups.keys().next().value as string
  return [...groups.entries()]
    .sort(([leftValue, leftDays], [rightValue, rightDays]) => (
      Math.min(...[...leftDays].map(weekdayRank))
      - Math.min(...[...rightDays].map(weekdayRank))
      || compareCodePointText(leftValue, rightValue)
    ))
    .map(([label, weekdays]) => {
      const dayLabel = [...weekdays]
        .sort((left, right) => weekdayRank(left) - weekdayRank(right))
        .map((weekday) => SHORT_WEEKDAY_LABELS[weekday])
        .join("·")
      return `${dayLabel} ${label}`
    })
    .join(" · ")
}

function formatFirstLesson(value: unknown) {
  if (!isRecord(value)) {
    catalogError("registration_customer_message_admission_schedule_incomplete")
  }
  const sessionDate = requiredText(
    value.sessionDate,
    "registration_customer_message_admission_schedule_incomplete",
  )
  const match = sessionDate.match(DATE_PATTERN)
  if (!match) catalogError("registration_customer_message_admission_schedule_incomplete")
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(`${sessionDate}T00:00:00.000Z`)
  if (
    year < 1
    || !Number.isFinite(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) catalogError("registration_customer_message_admission_schedule_incomplete")
  return `${month}월 ${day}일 ${WEEKDAY_LABELS[date.getUTCDay()]} ${formatTimeRange(
    value.startTime,
    value.endTime,
  )}`
}

function normalizeAdmissionPlan(value: unknown): NormalizedAdmissionPlan {
  if (!isRecord(value)) catalogError("registration_customer_message_admission_plan_invalid")
  const subject = value.subject
  if (!SUBJECT_ORDER.includes(subject as RegistrationCustomerMessageSubject)) {
    catalogError("registration_customer_message_subject_invalid")
  }
  if (!Number.isInteger(value.sortOrder) || Number(value.sortOrder) < 0) {
    catalogError("registration_customer_message_admission_plan_invalid")
  }
  if (value.textbookName !== null && typeof value.textbookName !== "string") {
    catalogError("registration_customer_message_textbook_invalid")
  }
  const slots = normalizeAdmissionSlots(value.slots)
  return Object.freeze({
    enrollmentId: requiredText(value.enrollmentId, "registration_customer_message_admission_plan_invalid"),
    subject: subject as RegistrationCustomerMessageSubject,
    sortOrder: Number(value.sortOrder),
    className: requiredText(value.className, "registration_customer_message_admission_plan_invalid"),
    textbookLabel: value.textbookName === null
      ? "선택 안 함(이미 보유)"
      : requiredText(value.textbookName, "registration_customer_message_textbook_invalid"),
    slots,
    firstLessonLabel: formatFirstLesson(value.firstLesson),
  })
}

export function formatRegistrationCustomerMessageAdmissionPlans(
  value: ReadonlyArray<RegistrationCustomerMessageAdmissionPlan> | undefined,
) {
  if (!Array.isArray(value) || value.length === 0) {
    catalogError("registration_customer_message_admission_schedule_incomplete")
  }
  const sorted = value.map(normalizeAdmissionPlan).sort((left, right) => (
    SUBJECT_ORDER.indexOf(left.subject) - SUBJECT_ORDER.indexOf(right.subject)
    || left.sortOrder - right.sortOrder
    || compareCodePointText(left.className, right.className)
    || compareCodePointText(left.enrollmentId, right.enrollmentId)
  ))
  const plans = sorted.map((plan) => Object.freeze({
    subjectLabel: plan.subject,
    className: plan.className,
    textbookLabel: plan.textbookLabel,
    scheduleLabel: formatRecurringSchedule(plan.slots),
    teacherLabel: formatSlotAssignment(plan.slots, "teacherName"),
    classroomLabel: formatSlotAssignment(plan.slots, "classroomName"),
    firstLessonLabel: plan.firstLessonLabel,
  }))
  const variable = plans.map((plan) => [
    `과목/수업: [${plan.subjectLabel}] ${plan.className}`,
    `교재: ${plan.textbookLabel}`,
    `요일/시간: ${plan.scheduleLabel}`,
    `선생님: ${plan.teacherLabel}`,
    `강의실: ${plan.classroomLabel}`,
    "",
    `첫 수업일: ${plan.firstLessonLabel}`,
  ].join("\n")).join("\n\n")
  return Object.freeze({
    variable,
    plans: Object.freeze(plans),
  })
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

function templateChecksumPayload(template: RegistrationCustomerMessageTemplate) {
  const legacy = {
    content: template.content,
    variables: [...template.variables],
    buttons: normalizedButtons(template.buttons),
  }
  return template.transportVariables
    ? { ...legacy, transportVariables: [...template.transportVariables] }
    : legacy
}

function variableChecksumPayload(template: RegistrationCustomerMessageTemplate) {
  return template.transportVariables
    ? { body: [...template.variables], transport: [...template.transportVariables] }
    : [...template.variables]
}

export function checksumRegistrationCustomerMessageTemplate(
  template: RegistrationCustomerMessageTemplate,
) {
  return sha256(canonicalJson(templateChecksumPayload(template)))
}

function templateChecksums(template: RegistrationCustomerMessageTemplate) {
  const buttons = normalizedButtons(template.buttons)
  return Object.freeze({
    template: checksumRegistrationCustomerMessageTemplate(template),
    content: sha256(template.content),
    variables: sha256(canonicalJson(variableChecksumPayload(template))),
    buttons: sha256(canonicalJson(buttons)),
  })
}

function catalogEntry(
  kind: RegistrationCustomerMessageSingleSourceKind,
  env: RegistrationCustomerMessageServerEnv,
): RegistrationCustomerMessageCatalogEntry {
  const definition = TEMPLATE_DEFINITIONS[kind]
  const envKey = REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_ENV_KEYS[kind]
  const templateId = text(env[envKey]) || null
  return Object.freeze({
    ...definition,
    revision: REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_REVISIONS[kind],
    envKey,
    send: SEND_DEFINITION,
    templateId,
    templateConfigured: Boolean(templateId),
    checksums: templateChecksums(definition),
  })
}

export function createRegistrationCustomerMessageCatalog(
  env: RegistrationCustomerMessageServerEnv,
): RegistrationCustomerMessageCatalog {
  const templates: Readonly<
    Record<RegistrationCustomerMessageSingleSourceKind, RegistrationCustomerMessageCatalogEntry>
  > = Object.freeze({
    level_test_booking: catalogEntry("level_test_booking", env),
    visit_consultation_booking: catalogEntry("visit_consultation_booking", env),
    appointment_reminder: catalogEntry("appointment_reminder", env),
    waiting_notice: catalogEntry("waiting_notice", env),
    admission_application: catalogEntry("admission_application", env),
    observation_booking: catalogEntry("observation_booking", env),
    observation_reminder: catalogEntry("observation_reminder", env),
  })

  const pfId = text(env.SOLAPI_KAKAO_PF_ID) || null
  return Object.freeze({
    revision: REGISTRATION_CUSTOMER_MESSAGE_CATALOG_REVISION,
    credentialsConfigured: Boolean(text(env.SOLAPI_API_KEY) && text(env.SOLAPI_API_SECRET)),
    pfId,
    pfConfigured: Boolean(pfId),
    recipientHashPepperConfigured: Boolean(text(env.REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER)),
    templates,
  })
}

function appointmentKindLabel(value: unknown) {
  if (value === "level_test") return "레벨테스트"
  if (value === "visit_consultation") return "방문상담"
  return catalogError("registration_customer_message_appointment_kind_invalid")
}

function appointmentVariables(
  kind: RegistrationCustomerMessageSingleSourceKind,
  facts: RegistrationCustomerMessageCanonicalFacts,
) {
  if (kind === "level_test_booking" && facts.appointmentKind !== "level_test") {
    catalogError("registration_customer_message_appointment_kind_invalid")
  }
  if (kind === "visit_consultation_booking" && facts.appointmentKind !== "visit_consultation") {
    catalogError("registration_customer_message_appointment_kind_invalid")
  }
  const schedule = facts.scheduleLabelOverride
    ? requiredText(facts.scheduleLabelOverride, "registration_customer_message_schedule_invalid")
    : formatRegistrationCustomerMessageSchedule(facts.scheduledAt as string | Date)
  const sourcePlace = requiredText(facts.place, "registration_customer_message_place_invalid")
  const place = facts.placeLabelOverride
    ? requiredText(facts.placeLabelOverride, "registration_customer_message_place_invalid")
    : sourcePlace
  const placeId = sourcePlace === "본관" || /^팁스학원(?:\s|$)/u.test(sourcePlace)
    ? PLACE_IDS.본관
    : place === "별관" || /^제주수학학원(?:\s|$)/u.test(place)
      ? PLACE_IDS.별관
      : null
  if (!placeId) catalogError("registration_customer_message_place_invalid")
  return { schedule, place, placeId }
}

function renderVariables(
  kind: RegistrationCustomerMessageSingleSourceKind,
  facts: RegistrationCustomerMessageCanonicalFacts,
) {
  const definition = TEMPLATE_DEFINITIONS[kind]
  const studentName = studentNameVariable(facts.studentName)
  const subjectLabel = facts.subjectLabelOverride
    ? requiredText(facts.subjectLabelOverride, "registration_customer_message_subject_invalid")
    : formatRegistrationCustomerMessageSubjects(facts.subjects)
  const values: Partial<Record<
    RegistrationCustomerMessageVariableName | RegistrationCustomerMessageTransportVariableName,
    string
  >> = {
    학생명: studentName,
    과목: subjectLabel,
  }
  const labels: {
    subjectLabel: string
    scheduleLabel?: string
    placeLabel?: string
    waitingKindLabel?: string
    waitingDetailLabel?: string
    admissionPlans?: ReadonlyArray<RegistrationCustomerMessageAdmissionPreviewPlan>
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

  if (kind === "admission_application") {
    const admission = formatRegistrationCustomerMessageAdmissionPlans(facts.enrollmentPlans)
    values.등록수업안내 = admission.variable
    labels.admissionPlans = admission.plans
  }

  if (kind === "observation_booking" || kind === "observation_reminder") {
    const campus = facts.campus
    if (campus !== "본관" && campus !== "별관") {
      catalogError("registration_customer_message_campus_invalid")
    }
    const schedule = facts.scheduleLabelOverride
      ? requiredText(facts.scheduleLabelOverride, "registration_customer_message_schedule_invalid")
      : formatRegistrationCustomerMessageSchedule(facts.scheduledAt as string | Date)
    const place = facts.placeLabelOverride
      ? requiredText(facts.placeLabelOverride, "registration_customer_message_place_invalid")
      : requiredText(facts.place, "registration_customer_message_place_invalid")
    values.수업명 = facts.classNameOverride
      ? requiredText(facts.classNameOverride, "registration_customer_message_class_name_invalid")
      : requiredText(facts.className, "registration_customer_message_class_name_invalid")
    values.예약일시 = schedule
    values.장소 = place
    values.담당선생님 = facts.teacherNameOverride
      ? requiredText(facts.teacherNameOverride, "registration_customer_message_teacher_name_invalid")
      : requiredText(facts.teacherName, "registration_customer_message_teacher_name_invalid")
    values.학원위치URL = OBSERVATION_LOCATION_TRANSPORT_VALUES[campus]
    labels.scheduleLabel = schedule
    labels.placeLabel = place
  }

  const variables: Record<string, string> = {}
  for (const name of definition.variables) {
    const value = values[name]
    if (!value) catalogError("registration_customer_message_variable_missing")
    variables[`#{${name}}`] = value
  }
  for (const name of definition.transportVariables ?? []) {
    const value = values[name]
    if (!value) catalogError("registration_customer_message_variable_missing")
    variables[`#{${name}}`] = value
  }
  return { variables: Object.freeze(variables), labels: Object.freeze(labels) }
}

function renderButtons(
  definition: TemplateDefinition,
  variables: Readonly<Record<string, string>>,
) {
  if (!definition.transportVariables) return definition.buttons
  const renderLink = (link: string) => link.replace(/#\{[^}]+\}/gu, (token) => (
    variables[token]
    ?? catalogError("registration_customer_message_variable_missing")
  ))
  return Object.freeze(definition.buttons.map((button) => Object.freeze({
    ...button,
    linkMobile: renderLink(button.linkMobile),
    linkPc: renderLink(button.linkPc),
  })))
}

export function renderRegistrationCustomerMessage(input: {
  kind: RegistrationCustomerMessageSingleSourceKind
  facts: RegistrationCustomerMessageCanonicalFacts
}): RegistrationCustomerMessageRendered {
  if (!isRegistrationCustomerMessageSingleSourceKind(input.kind)) {
    catalogError("registration_customer_message_kind_invalid")
  }
  const definition = TEMPLATE_DEFINITIONS[input.kind]
  const rendered = renderVariables(input.kind, input.facts)
  const body = definition.content.replace(/#\{[^}]+\}/gu, (token) => (
    rendered.variables[token]
    ?? catalogError("registration_customer_message_variable_missing")
  ))
  if (Array.from(body).length > 1_000) {
    catalogError("registration_customer_message_body_too_long")
  }
  const buttons = renderButtons(definition, rendered.variables)

  return Object.freeze({
    kind: input.kind,
    body,
    variables: rendered.variables,
    buttons,
    facts: rendered.labels,
    checksums: Object.freeze({
      variables: sha256(canonicalJson(rendered.variables)),
      body: sha256(body),
      buttons: sha256(canonicalJson(normalizedButtons(buttons))),
    }),
  })
}
