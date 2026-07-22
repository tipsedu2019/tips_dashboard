import {
  ACADEMIC_SUBJECT_VALUES,
  parseAcademicSubject,
} from "../../lib/academic-subject-registry.ts"
import type { RegistrationSubject } from "./registration-track-service"

export type RegistrationAppointmentCalendarKind = "level_test" | "visit_consultation"
export type RegistrationAppointmentCalendarStatus = "scheduled" | "completed" | "canceled"

export type RegistrationAppointmentCalendarRow = {
  appointment_id: string
  task_id: string
  student_name: string
  kind: RegistrationAppointmentCalendarKind
  scheduled_at: string
  place: string
  status: RegistrationAppointmentCalendarStatus
  notification_revision: number
  track_ids: string[]
  subjects: RegistrationSubject[]
}

export type RegistrationAppointmentCalendarItem = {
  id: `registration-appointment:${string}`
  appointmentId: string
  taskId: string
  studentName: string
  kind: RegistrationAppointmentCalendarKind
  scheduledAt: string
  place: string
  status: RegistrationAppointmentCalendarStatus
  notificationRevision: number
  trackIds: string[]
  subjects: RegistrationSubject[]
  href: string
}

export type RegistrationAppointmentCalendarBuildOptions = {
  statuses?: readonly RegistrationAppointmentCalendarStatus[]
}

export type RegistrationAppointmentCalendarLoadInput = {
  rangeStart: string
  rangeEnd: string
  statuses?: readonly RegistrationAppointmentCalendarStatus[]
}

export type RegistrationAppointmentCalendarView = "month" | "week"

export type RegistrationAppointmentCalendarRange = {
  startDateKey: string
  endDateKey: string
  rangeStart: string
  rangeEnd: string
}

const SEOUL_TIME_ZONE = "Asia/Seoul"
const CALENDAR_KINDS = new Set<RegistrationAppointmentCalendarKind>([
  "level_test",
  "visit_consultation",
])
const CALENDAR_STATUSES = new Set<RegistrationAppointmentCalendarStatus>([
  "scheduled",
  "completed",
  "canceled",
])
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const OFFSET_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|([+-])(\d{2}):(\d{2}))$/

function invalidCalendarRow(field: string): never {
  throw new Error(`registration_appointment_calendar_row_invalid:${field}`)
}

function requireNonEmptyString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) invalidCalendarRow(field)
  return value
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

export function buildRegistrationAppointmentHref(taskId: string, appointmentId: string) {
  const normalizedTaskId = requireNonEmptyString(taskId, "task_id")
  const normalizedAppointmentId = requireNonEmptyString(appointmentId, "appointment_id")
  const query = new URLSearchParams()
  query.set("taskId", normalizedTaskId)
  query.set("appointmentId", normalizedAppointmentId)
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
  options: RegistrationAppointmentCalendarBuildOptions = {},
): RegistrationAppointmentCalendarItem[] {
  if (!Array.isArray(rows)) invalidCalendarRow("rows")
  const statuses = normalizeStatuses(options.statuses)
  const appointmentIds = new Set<string>()

  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") invalidCalendarRow("row")
    const appointmentId = requireNonEmptyString(row.appointment_id, "appointment_id")
    if (appointmentIds.has(appointmentId)) invalidCalendarRow("duplicate_appointment_id")
    appointmentIds.add(appointmentId)

    const taskId = requireNonEmptyString(row.task_id, "task_id")
    const studentName = requireNonEmptyString(row.student_name, "student_name")
    const place = requireNonEmptyString(row.place, "place")
    if (!CALENDAR_KINDS.has(row.kind)) invalidCalendarRow("kind")
    if (!CALENDAR_STATUSES.has(row.status)) invalidCalendarRow("status")
    if (!Number.isInteger(row.notification_revision) || row.notification_revision <= 0) {
      invalidCalendarRow("notification_revision")
    }
    if (!isExactOffsetTimestamp(row.scheduled_at)) invalidCalendarRow("scheduled_at")
    const participants = normalizeParticipants(row)

    if (!statuses.has(row.status)) return []
    return [{
      id: `registration-appointment:${appointmentId}` as const,
      appointmentId,
      taskId,
      studentName,
      kind: row.kind,
      scheduledAt: row.scheduled_at,
      place,
      status: row.status,
      notificationRevision: row.notification_revision,
      trackIds: participants.map((participant) => participant.trackId),
      subjects: participants.map((participant) => participant.subject),
      href: buildRegistrationAppointmentHref(taskId, appointmentId),
    }]
  })
}
