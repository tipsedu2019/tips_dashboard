import { createHash } from "node:crypto"

import type {
  RegistrationCustomerMessageBundleKind,
  RegistrationCustomerMessageBundleItem,
} from "../registration-customer-message-contract.ts"
import type { RegistrationCustomerMessageButton } from "./registration-customer-message-catalog.ts"

export const REGISTRATION_CUSTOMER_MESSAGE_BUNDLE_CATALOG_REVISION = 1 as const

export type RegistrationCustomerMessageBundleTemplateEnvKey =
  | "SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_BUNDLE_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_VISIT_BOOKING_BUNDLE_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_OBSERVATION_BOOKING_BUNDLE_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_LEVEL_TEST_REMINDER_BUNDLE_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_VISIT_REMINDER_BUNDLE_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_OBSERVATION_REMINDER_BUNDLE_TEMPLATE_ID"

export const REGISTRATION_CUSTOMER_MESSAGE_BUNDLE_TEMPLATE_ENV_KEYS: Readonly<
  Record<RegistrationCustomerMessageBundleKind, RegistrationCustomerMessageBundleTemplateEnvKey>
> = Object.freeze({
  level_test_booking_bundle: "SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_BUNDLE_TEMPLATE_ID",
  visit_consultation_booking_bundle: "SOLAPI_REGISTRATION_VISIT_BOOKING_BUNDLE_TEMPLATE_ID",
  observation_booking_bundle: "SOLAPI_REGISTRATION_OBSERVATION_BOOKING_BUNDLE_TEMPLATE_ID",
  level_test_reminder_bundle: "SOLAPI_REGISTRATION_LEVEL_TEST_REMINDER_BUNDLE_TEMPLATE_ID",
  visit_consultation_reminder_bundle: "SOLAPI_REGISTRATION_VISIT_REMINDER_BUNDLE_TEMPLATE_ID",
  observation_reminder_bundle: "SOLAPI_REGISTRATION_OBSERVATION_REMINDER_BUNDLE_TEMPLATE_ID",
})

export type RegistrationCustomerMessageBundleServerEnv = Readonly<{
  SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_BUNDLE_TEMPLATE_ID?: string
  SOLAPI_REGISTRATION_VISIT_BOOKING_BUNDLE_TEMPLATE_ID?: string
  SOLAPI_REGISTRATION_OBSERVATION_BOOKING_BUNDLE_TEMPLATE_ID?: string
  SOLAPI_REGISTRATION_LEVEL_TEST_REMINDER_BUNDLE_TEMPLATE_ID?: string
  SOLAPI_REGISTRATION_VISIT_REMINDER_BUNDLE_TEMPLATE_ID?: string
  SOLAPI_REGISTRATION_OBSERVATION_REMINDER_BUNDLE_TEMPLATE_ID?: string
}>

export type RegistrationCustomerMessageBundleCanonicalItem = Readonly<{
  subject: "영어" | "수학" | "과학"
  scheduledAt: string
  place: "본관" | "별관"
  className: string | null
  teacherName: string | null
}>

export type RegistrationCustomerMessageBundleTemplate = Readonly<{
  kind: RegistrationCustomerMessageBundleKind
  content: string
  variables: ReadonlyArray<"학생명" | "예약목록">
  buttons: ReadonlyArray<RegistrationCustomerMessageButton>
  disableSms: true
  envKey: RegistrationCustomerMessageBundleTemplateEnvKey
  templateId: string | null
  templateConfigured: boolean
  checksum: string
}>

export type RegistrationCustomerMessageBundleCatalog = Readonly<{
  revision: typeof REGISTRATION_CUSTOMER_MESSAGE_BUNDLE_CATALOG_REVISION
  templates: Readonly<Record<RegistrationCustomerMessageBundleKind, RegistrationCustomerMessageBundleTemplate>>
}>

export type RegistrationCustomerMessageBundleRendered = Readonly<{
  kind: RegistrationCustomerMessageBundleKind
  body: string
  variables: Readonly<{ 학생명: string; 예약목록: string }>
  buttons: ReadonlyArray<RegistrationCustomerMessageButton>
  facts: Readonly<{ reservations: ReadonlyArray<RegistrationCustomerMessageBundleItem> }>
}>

const SEOUL_TIME_ZONE = "Asia/Seoul"
const SUBJECT_ORDER = ["영어", "수학", "과학"] as const
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u
const WEEKDAY_LABELS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"] as const

const BUNDLE_BUTTONS = Object.freeze([
  Object.freeze({
    name: "본관 위치",
    type: "WL" as const,
    linkMobile: "https://map.naver.com/p/entry/place/1218797840",
    linkPc: "https://map.naver.com/p/entry/place/1218797840",
  }),
  Object.freeze({
    name: "별관 위치",
    type: "WL" as const,
    linkMobile: "https://map.naver.com/p/entry/place/1962638110",
    linkPc: "https://map.naver.com/p/entry/place/1962638110",
  }),
  Object.freeze({
    name: "문의하기",
    type: "WL" as const,
    linkMobile: "https://tipsedu.channel.io",
    linkPc: "https://tipsedu.channel.io",
  }),
] as const)

const BUNDLE_TEMPLATE_CONTENT: Readonly<Record<RegistrationCustomerMessageBundleKind, string>> = Object.freeze({
  level_test_booking_bundle: `[팁스영어수학학원] 레벨테스트 예약 안내

안녕하세요. #{학생명} 학생의 레벨테스트 예약을 안내드립니다.

#{예약목록}

일정 변경 및 문의는 아래 문의하기 버튼을 이용해 주세요.`,
  visit_consultation_booking_bundle: `[팁스영어수학학원] 방문상담 예약 안내

안녕하세요. #{학생명} 학생의 방문상담 예약을 안내드립니다.

#{예약목록}

일정 변경 및 문의는 아래 문의하기 버튼을 이용해 주세요.`,
  observation_booking_bundle: `[팁스영어수학학원] 청강 예약 안내

안녕하세요. #{학생명} 학생의 청강 예약을 안내드립니다.

#{예약목록}

일정 변경 및 문의는 아래 문의하기 버튼을 이용해 주세요.`,
  level_test_reminder_bundle: `[팁스영어수학학원] 레벨테스트 당일 리마인드

안녕하세요. #{학생명} 학생의 오늘 레벨테스트 일정을 안내드립니다.

#{예약목록}

예약 시간에 맞춰 방문해 주세요.`,
  visit_consultation_reminder_bundle: `[팁스영어수학학원] 방문상담 당일 리마인드

안녕하세요. #{학생명} 학생의 오늘 방문상담 일정을 안내드립니다.

#{예약목록}

예약 시간에 맞춰 방문해 주세요.`,
  observation_reminder_bundle: `[팁스영어수학학원] 청강 당일 리마인드

안녕하세요. #{학생명} 학생의 오늘 청강 일정을 안내드립니다.

#{예약목록}

예약 시간에 맞춰 방문해 주세요.`,
})

function requiredText(value: unknown, code: string) {
  const normalized = typeof value === "string" ? value.trim() : ""
  if (!normalized) throw new Error(code)
  return normalized
}

function normalizedStudentName(value: unknown) {
  return requiredText(value, "registration_customer_message_bundle_student_name_invalid")
    .replace(/\s+학생$/u, "")
    .trim()
}

function dateParts(value: string) {
  if (!RFC3339_UTC_PATTERN.test(value)) {
    throw new Error("registration_customer_message_bundle_scheduled_at_invalid")
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error("registration_customer_message_bundle_scheduled_at_invalid")
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  const year = Number(byType.get("year"))
  const month = Number(byType.get("month"))
  const day = Number(byType.get("day"))
  const hour = Number(byType.get("hour"))
  const minute = byType.get("minute")
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(hour) || !minute) {
    throw new Error("registration_customer_message_bundle_scheduled_at_invalid")
  }
  return { year, month, day, hour, minute, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() }
}

function scheduleLabel(scheduledAt: string) {
  const parts = dateParts(scheduledAt)
  const period = parts.hour < 12 ? "오전" : "오후"
  return `${parts.year}년 ${parts.month}월 ${parts.day}일 ${WEEKDAY_LABELS[parts.weekday]} ${period} ${parts.hour % 12 || 12}:${parts.minute}`
}

function validateItems(value: ReadonlyArray<RegistrationCustomerMessageBundleCanonicalItem>) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) {
    throw new Error("registration_customer_message_bundle_item_count_invalid")
  }
  const subjects = new Set<string>()
  const items = value.map((item) => {
    if (!item || !SUBJECT_ORDER.includes(item.subject) || subjects.has(item.subject)) {
      throw new Error("registration_customer_message_bundle_subject_invalid")
    }
    subjects.add(item.subject)
    if (item.place !== "본관" && item.place !== "별관") {
      throw new Error("registration_customer_message_bundle_place_invalid")
    }
    dateParts(item.scheduledAt)
    const className = item.className === null ? null : requiredText(item.className, "registration_customer_message_bundle_class_invalid")
    const teacherName = item.teacherName === null ? null : requiredText(item.teacherName, "registration_customer_message_bundle_teacher_invalid")
    if ((className === null) !== (teacherName === null)) {
      throw new Error("registration_customer_message_bundle_observation_facts_invalid")
    }
    return { ...item, className, teacherName }
  })
  return items.sort((left, right) => (
    left.scheduledAt.localeCompare(right.scheduledAt)
    || SUBJECT_ORDER.indexOf(left.subject) - SUBJECT_ORDER.indexOf(right.subject)
    || `${left.place}\u0000${left.className ?? ""}\u0000${left.teacherName ?? ""}`.localeCompare(
      `${right.place}\u0000${right.className ?? ""}\u0000${right.teacherName ?? ""}`,
    )
  ))
}

function checksum(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")
}

export function createRegistrationCustomerMessageBundleCatalog(
  env: RegistrationCustomerMessageBundleServerEnv,
): RegistrationCustomerMessageBundleCatalog {
  const templates = Object.fromEntries(
    Object.entries(REGISTRATION_CUSTOMER_MESSAGE_BUNDLE_TEMPLATE_ENV_KEYS).map(([kind, envKey]) => {
      const templateId = typeof env[envKey] === "string" && env[envKey]?.trim() ? env[envKey].trim() : null
      const entry = Object.freeze({
        kind: kind as RegistrationCustomerMessageBundleKind,
        content: BUNDLE_TEMPLATE_CONTENT[kind as RegistrationCustomerMessageBundleKind],
        variables: Object.freeze(["학생명", "예약목록"] as const),
        buttons: BUNDLE_BUTTONS,
        disableSms: true as const,
        envKey,
        templateId,
        templateConfigured: templateId !== null,
        checksum: checksum({
          kind,
          content: BUNDLE_TEMPLATE_CONTENT[kind as RegistrationCustomerMessageBundleKind],
          variables: ["학생명", "예약목록"],
          buttons: BUNDLE_BUTTONS,
        }),
      })
      return [kind, entry]
    }),
  ) as unknown as Record<RegistrationCustomerMessageBundleKind, RegistrationCustomerMessageBundleTemplate>
  return Object.freeze({
    revision: REGISTRATION_CUSTOMER_MESSAGE_BUNDLE_CATALOG_REVISION,
    templates: Object.freeze(templates),
  })
}

export function renderRegistrationCustomerMessageBundle(input: Readonly<{
  kind: RegistrationCustomerMessageBundleKind
  studentName: string
  items: ReadonlyArray<RegistrationCustomerMessageBundleCanonicalItem>
}>): RegistrationCustomerMessageBundleRendered {
  if (!(input.kind in BUNDLE_TEMPLATE_CONTENT)) {
    throw new Error("registration_customer_message_bundle_kind_invalid")
  }
  const studentName = normalizedStudentName(input.studentName)
  const items = validateItems(input.items)
  const reservations = Object.freeze(items.map((item) => Object.freeze({
    subjectLabel: item.subject,
    scheduleLabel: scheduleLabel(item.scheduledAt),
    placeLabel: item.place,
    className: item.className,
    teacherLabel: item.teacherName === null ? null : `${item.teacherName} 선생님`,
  } satisfies RegistrationCustomerMessageBundleItem)))
  const reservationList = reservations.map((item, index) => {
    const detail = item.className === null
      ? ""
      : `\n수업: ${item.className} · 담당: ${item.teacherLabel}`
    return `${index + 1}. ${item.subjectLabel} · ${item.scheduleLabel} · ${item.placeLabel}${detail}`
  }).join("\n")
  const variables = Object.freeze({ 학생명: studentName, 예약목록: reservationList })
  return Object.freeze({
    kind: input.kind,
    body: BUNDLE_TEMPLATE_CONTENT[input.kind]
      .replace(/#\{학생명\}/gu, variables.학생명)
      .replace(/#\{예약목록\}/gu, variables.예약목록),
    variables,
    buttons: BUNDLE_BUTTONS,
    facts: Object.freeze({ reservations }),
  })
}
