import {
  ACADEMIC_SUBJECT_VALUES,
  parseAcademicSubject,
} from "../../lib/academic-subject-registry.ts"
import type { RegistrationSubject } from "./registration-track-service"

export type RegistrationAppointmentCalendarDatabaseKind =
  | "level_test"
  | "visit_consultation"
  | "observation_class"
export type RegistrationAppointmentCalendarKind =
  | "level_test"
  | "visit_consultation"
  | "observation"
export type RegistrationAppointmentCalendarKindFilter = "all" | RegistrationAppointmentCalendarKind
export type RegistrationAppointmentCalendarKindCounts = Record<RegistrationAppointmentCalendarKindFilter, number>
export type RegistrationAppointmentCalendarStatus = "scheduled" | "completed" | "canceled"

export type RegistrationAppointmentCalendarRow = Readonly<{
  appointment_id: string
  task_id: string
  student_name: string
  kind: RegistrationAppointmentCalendarDatabaseKind
  scheduled_at: string
  place: string
  status: RegistrationAppointmentCalendarStatus
  notification_revision: number
  track_ids: string[]
  subjects: RegistrationSubject[]
  observation_id: string | null
  observation_track_id: string | null
  observation_class_id: string | null
  observation_class_name: string | null
  observation_ends_at: string | null
  observation_teacher_name: string | null
  observation_classroom_name: string | null
}>

type RegistrationAppointmentCalendarItemBase = Readonly<{
  id: `registration-appointment:${string}`
  appointmentId: string
  taskId: string
  studentName: string
  scheduledAt: string
  place: string
  status: RegistrationAppointmentCalendarStatus
  notificationRevision: number
  trackIds: string[]
  subjects: RegistrationSubject[]
  href: string
}>

export type RegistrationAppointmentCalendarItem =
  | (RegistrationAppointmentCalendarItemBase & Readonly<{
      kind: "level_test" | "visit_consultation"
      observationId: null
      observationTrackId: null
      observationClassId: null
      observationClassName: null
      observationEndsAt: null
      observationTeacherName: null
      observationClassroomName: null
    }>)
  | (RegistrationAppointmentCalendarItemBase & Readonly<{
      kind: "observation"
      observationId: string
      observationTrackId: string
      observationClassId: string
      observationClassName: string
      observationEndsAt: string
      observationTeacherName: string
      observationClassroomName: string
    }>)

export type RegistrationAppointmentCalendarBuildOptions = Readonly<{
  statuses?: readonly RegistrationAppointmentCalendarStatus[]
  observationRuntimeVersion: 0 | 1
}>

export type RegistrationAppointmentCalendarLoadInput = Readonly<{
  rangeStart: string
  rangeEnd: string
  statuses?: readonly RegistrationAppointmentCalendarStatus[]
  observationRuntimeVersion: 0 | 1
}>

export type RegistrationAppointmentCalendarView = "month" | "week"

export type RegistrationAppointmentCalendarRange = {
  startDateKey: string
  endDateKey: string
  rangeStart: string
  rangeEnd: string
}

const SEOUL_TIME_ZONE = "Asia/Seoul"
const CALENDAR_DATABASE_KINDS = new Set<RegistrationAppointmentCalendarDatabaseKind>([
  "level_test",
  "visit_consultation",
  "observation_class",
])
const CALENDAR_STATUSES = new Set<RegistrationAppointmentCalendarStatus>([
  "scheduled",
  "completed",
  "canceled",
])
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const OFFSET_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|([+-])(\d{2}):(\d{2}))$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OBSERVATION_SNAPSHOT_KEYS = [
  "observation_id",
  "observation_track_id",
  "observation_class_id",
  "observation_class_name",
  "observation_ends_at",
  "observation_teacher_name",
  "observation_classroom_name",
] as const

function invalidCalendarRow(field: string): never {
  throw new Error(`registration_appointment_calendar_row_invalid:${field}`)
}

function requireNonEmptyString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) invalidCalendarRow(field)
  return value
}

function requireUuid(value: unknown, field: string) {
  const normalized = typeof value === "string" ? value.trim() : ""
  if (!UUID_PATTERN.test(normalized)) invalidCalendarRow(field)
  return normalized
}

function daysInCalendarMonth(year: number, month: number) {
  const date = new Date(0)
  date.setUTCHours(12, 0, 0, 0)
  date.setUTCFullYear(year, month, 0)
  return date.getUTCDate()
}

function dateKeyFromUtcDate(date: Date) {
  const year = date.getUTCFullYear()
  if (year < 1 || year > 9999) {
    throw new Error("registration_appointment_calendar_invalid_date_key")
  }
  return `${String(year).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}

function utcDateFromDateKey(dateKey: string) {
  const match = DATE_KEY_PATTERN.exec(dateKey)
  if (!match) throw new Error("registration_appointment_calendar_invalid_date_key")
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const daysInMonth = year >= 1 && month >= 1 && month <= 12
    ? daysInCalendarMonth(year, month)
    : 0
  if (day < 1 || day > daysInMonth) {
    throw new Error("registration_appointment_calendar_invalid_date_key")
  }

  const date = new Date(0)
  date.setUTCHours(12, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  return date
}

function shiftDateKey(dateKey: string, days: number) {
  const date = utcDateFromDateKey(dateKey)
  date.setUTCDate(date.getUTCDate() + days)
  return dateKeyFromUtcDate(date)
}

function shiftMonthStartDateKey(dateKey: string, months: number) {
  const date = utcDateFromDateKey(dateKey)
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  return dateKeyFromUtcDate(date)
}

function startOfWeekDateKey(dateKey: string) {
  const date = utcDateFromDateKey(dateKey)
  const mondayOffset = (date.getUTCDay() + 6) % 7
  return shiftDateKey(dateKey, -mondayOffset)
}

function isExactOffsetTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false
  const match = OFFSET_TIMESTAMP_PATTERN.exec(value)
  if (!match) return false

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const daysInMonth = year >= 1 && month >= 1 && month <= 12
    ? daysInCalendarMonth(year, month)
    : 0

  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth
    || hour > 23
    || minute > 59
    || second > 59
  ) return false

  if (offsetHourText !== undefined) {
    const offsetHour = Number(offsetHourText)
    const offsetMinute = Number(offsetMinuteText)
    if (offsetHour > 15 || offsetMinute > 59) return false
  }

  return Number.isFinite(Date.parse(value))
}

function normalizeParticipants(row: RegistrationAppointmentCalendarRow) {
  if (!Array.isArray(row.track_ids) || !Array.isArray(row.subjects)) {
    invalidCalendarRow("participants")
  }
  if (row.track_ids.length === 0 || row.track_ids.length !== row.subjects.length) {
    invalidCalendarRow("participants")
  }

  const participants = row.track_ids.map((trackId, index) => {
    const subject = parseAcademicSubject(row.subjects[index])
    if (!subject) invalidCalendarRow("subjects")
    return {
      trackId: requireNonEmptyString(trackId, "track_ids"),
      subject,
    }
  })
  if (
    new Set(participants.map((participant) => participant.trackId)).size !== participants.length
    || new Set(participants.map((participant) => participant.subject)).size !== participants.length
  ) invalidCalendarRow("participants")

  participants.sort((left, right) => (
    ACADEMIC_SUBJECT_VALUES.indexOf(left.subject) - ACADEMIC_SUBJECT_VALUES.indexOf(right.subject)
    || left.trackId.localeCompare(right.trackId)
  ))
  return participants
}

function normalizeStatuses(statuses: RegistrationAppointmentCalendarBuildOptions["statuses"]) {
  const requested: RegistrationAppointmentCalendarStatus[] = statuses === undefined
    ? ["scheduled"]
    : [...statuses]
  for (const status of requested) {
    if (!CALENDAR_STATUSES.has(status)) invalidCalendarRow("filter_status")
  }
  return new Set<RegistrationAppointmentCalendarStatus>(requested)
}

export function buildRegistrationAppointmentHref(
  taskId: string,
  appointmentId: string,
  observation: Readonly<{ trackId: string; observationId: string }> | null = null,
) {
  const normalizedTaskId = requireNonEmptyString(taskId, "task_id")
  const normalizedAppointmentId = requireNonEmptyString(appointmentId, "appointment_id")
  const query = new URLSearchParams()
  if (!observation) {
    query.set("taskId", normalizedTaskId)
    query.set("appointmentId", normalizedAppointmentId)
    query.set("view", "calendar")
    return `/admin/registration?${query.toString()}`
  }

  const normalizedObservationTaskId = requireUuid(normalizedTaskId, "task_id")
  const normalizedObservationTrackId = requireUuid(observation.trackId, "observation_track_id")
  const normalizedObservationAppointmentId = requireUuid(normalizedAppointmentId, "appointment_id")
  const normalizedObservationId = requireUuid(observation.observationId, "observation_id")
  query.set("taskId", normalizedObservationTaskId)
  query.set("trackId", normalizedObservationTrackId)
  query.set("appointmentId", normalizedObservationAppointmentId)
  query.set("observationId", normalizedObservationId)
  query.set("view", "calendar")
  return `/admin/registration?${query.toString()}`
}

export function getSeoulRegistrationDateKey(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error("registration_appointment_calendar_invalid_timestamp")
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function getRegistrationAppointmentCalendarRange(
  view: RegistrationAppointmentCalendarView,
  anchorDateKey: string,
): RegistrationAppointmentCalendarRange {
  if (view !== "month" && view !== "week") {
    throw new Error("registration_appointment_calendar_invalid_view")
  }
  const anchorDate = utcDateFromDateKey(anchorDateKey)
  const normalizedAnchorDateKey = dateKeyFromUtcDate(anchorDate)
  const startDateKey = view === "month"
    ? `${normalizedAnchorDateKey.slice(0, 7)}-01`
    : startOfWeekDateKey(normalizedAnchorDateKey)
  const endDateKey = view === "month"
    ? shiftMonthStartDateKey(startDateKey, 1)
    : shiftDateKey(startDateKey, 7)
  return {
    startDateKey,
    endDateKey,
    rangeStart: `${startDateKey}T00:00:00+09:00`,
    rangeEnd: `${endDateKey}T00:00:00+09:00`,
  }
}

export function buildRegistrationAppointmentCalendarItems(
  rows: readonly RegistrationAppointmentCalendarRow[],
  options: RegistrationAppointmentCalendarBuildOptions = { observationRuntimeVersion: 0 },
): RegistrationAppointmentCalendarItem[] {
  if (!Array.isArray(rows)) invalidCalendarRow("rows")
  if (options.observationRuntimeVersion !== 0 && options.observationRuntimeVersion !== 1) {
    invalidCalendarRow("observation_runtime_version")
  }
  const statuses = normalizeStatuses(options.statuses)
  const appointmentIds = new Set<string>()

  return rows.flatMap<RegistrationAppointmentCalendarItem>((row) => {
    if (!row || typeof row !== "object") invalidCalendarRow("row")
    if (!CALENDAR_DATABASE_KINDS.has(row.kind)) invalidCalendarRow("kind")
    if (row.kind === "observation_class" && options.observationRuntimeVersion === 0) return []

    const appointmentId = requireNonEmptyString(row.appointment_id, "appointment_id")
    if (appointmentIds.has(appointmentId)) invalidCalendarRow("duplicate_appointment_id")
    appointmentIds.add(appointmentId)

    const taskId = requireNonEmptyString(row.task_id, "task_id")
    const studentName = requireNonEmptyString(row.student_name, "student_name")
    const place = requireNonEmptyString(row.place, "place")
    if (!CALENDAR_STATUSES.has(row.status)) invalidCalendarRow("status")
    if (!Number.isInteger(row.notification_revision) || row.notification_revision <= 0) {
      invalidCalendarRow("notification_revision")
    }
    if (!isExactOffsetTimestamp(row.scheduled_at)) invalidCalendarRow("scheduled_at")
    const participants = normalizeParticipants(row)

    const base = {
      id: `registration-appointment:${appointmentId}` as const,
      appointmentId,
      taskId,
      studentName,
      scheduledAt: row.scheduled_at,
      place,
      status: row.status,
      notificationRevision: row.notification_revision,
      trackIds: participants.map((participant) => participant.trackId),
      subjects: participants.map((participant) => participant.subject),
    }

    if (row.kind !== "observation_class") {
      for (const key of OBSERVATION_SNAPSHOT_KEYS) {
        if (row[key] !== null) invalidCalendarRow(key)
      }
      if (!statuses.has(row.status)) return []
      return [{
        ...base,
        kind: row.kind,
        observationId: null,
        observationTrackId: null,
        observationClassId: null,
        observationClassName: null,
        observationEndsAt: null,
        observationTeacherName: null,
        observationClassroomName: null,
        href: buildRegistrationAppointmentHref(taskId, appointmentId),
      }]
    }

    const normalizedTaskId = requireUuid(taskId, "task_id")
    const normalizedAppointmentId = requireUuid(appointmentId, "appointment_id")
    const observationId = requireUuid(row.observation_id, "observation_id")
    const observationTrackId = requireUuid(row.observation_track_id, "observation_track_id")
    const observationClassId = requireUuid(row.observation_class_id, "observation_class_id")
    const observationClassName = requireNonEmptyString(row.observation_class_name, "observation_class_name")
    const observationTeacherName = requireNonEmptyString(row.observation_teacher_name, "observation_teacher_name")
    const observationClassroomName = requireNonEmptyString(row.observation_classroom_name, "observation_classroom_name")
    if (!isExactOffsetTimestamp(row.observation_ends_at)) invalidCalendarRow("observation_ends_at")
    if (Date.parse(row.scheduled_at) >= Date.parse(row.observation_ends_at)) {
      invalidCalendarRow("observation_ends_at")
    }
    if (
      participants.length !== 1
      || participants[0].trackId !== observationTrackId
    ) invalidCalendarRow("observation_participants")
    if (!statuses.has(row.status)) return []

    return [{
      ...base,
      id: `registration-appointment:${normalizedAppointmentId}` as const,
      appointmentId: normalizedAppointmentId,
      taskId: normalizedTaskId,
      kind: "observation" as const,
      observationId,
      observationTrackId,
      observationClassId,
      observationClassName,
      observationEndsAt: row.observation_ends_at,
      observationTeacherName,
      observationClassroomName,
      href: buildRegistrationAppointmentHref(normalizedTaskId, normalizedAppointmentId, {
        trackId: observationTrackId,
        observationId,
      }),
    }]
  })
}

export function filterRegistrationAppointmentCalendarItems(
  items: readonly RegistrationAppointmentCalendarItem[],
  kind: RegistrationAppointmentCalendarKindFilter,
): RegistrationAppointmentCalendarItem[] {
  return kind === "all" ? [...items] : items.filter((item) => item.kind === kind)
}

export function getRegistrationAppointmentCalendarKindCounts(
  items: readonly RegistrationAppointmentCalendarItem[],
): RegistrationAppointmentCalendarKindCounts {
  const levelTest = items.filter((item) => item.kind === "level_test").length
  const visitConsultation = items.filter((item) => item.kind === "visit_consultation").length
  const observation = items.filter((item) => item.kind === "observation").length
  return {
    all: items.length,
    level_test: levelTest,
    visit_consultation: visitConsultation,
    observation,
  }
}
