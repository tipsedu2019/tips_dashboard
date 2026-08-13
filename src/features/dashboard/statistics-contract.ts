export const DASHBOARD_STATISTICS_CONTRACT_VERSION = "dashboard-statistics-v1" as const

export const DASHBOARD_STATISTICS_TABS = [
  "overview",
  "students_classes",
  "schedule_conflicts",
  "textbooks",
] as const

export type DashboardStatisticsTab = typeof DASHBOARD_STATISTICS_TABS[number]
export type DashboardStatisticsCacheStatus = "hit" | "miss" | "refreshed"
export type DashboardStatisticsRangeTab = "schedule_conflicts" | "textbooks"

export const DASHBOARD_STATISTICS_RANGE_PRESETS = {
  schedule_conflicts: [90, 180, 400],
  textbooks: [30, 90, 180, 365],
} as const

const SUBJECTS = ["all", "english", "math", "science"] as const
const DIVISIONS = ["all", "middle", "high"] as const
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

export type DashboardStatisticsRequest = Readonly<{
  tab: DashboardStatisticsTab
  subject: string
  division: string
  dateFrom: string
  dateTo: string
}>

export type DashboardStatisticsSnapshot = Readonly<{
  ok: true
  contractVersion: typeof DASHBOARD_STATISTICS_CONTRACT_VERSION
  tab: DashboardStatisticsTab
  data: unknown
  generatedAt: string
  expiresAt: string
  cacheStatus: DashboardStatisticsCacheStatus
}>

function calendarDate(value: string) {
  if (!DATE_PATTERN.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? parsed
    : null
}

function calendarDifference(from: string, to: string) {
  const fromDate = calendarDate(from)
  const toDate = calendarDate(to)
  if (!fromDate || !toDate) return null
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000)
}

function isTab(value: string): value is DashboardStatisticsTab {
  return DASHBOARD_STATISTICS_TABS.includes(value as DashboardStatisticsTab)
}

function optional(params: URLSearchParams, key: string) {
  const values = params.getAll(key)
  return values.length <= 1 ? values[0] ?? "" : null
}

export function parseDashboardStatisticsRequest(params: URLSearchParams): {
  request: DashboardStatisticsRequest
  refresh: boolean
} | null {
  const allowed = new Set(["tab", "subject", "division", "dateFrom", "dateTo", "refresh"])
  if ([...params.keys()].some((key) => !allowed.has(key))) return null

  const tab = optional(params, "tab")
  const subjectInput = optional(params, "subject")
  const divisionInput = optional(params, "division")
  const dateFrom = optional(params, "dateFrom")
  const dateTo = optional(params, "dateTo")
  const refreshInput = optional(params, "refresh")
  if (
    tab === null || subjectInput === null || divisionInput === null ||
    dateFrom === null || dateTo === null || refreshInput === null || !isTab(tab) ||
    !["", "1"].includes(refreshInput)
  ) return null

  if (tab === "overview" || tab === "students_classes") {
    const subject = subjectInput || "all"
    const division = divisionInput || "all"
    if (
      !SUBJECTS.includes(subject as typeof SUBJECTS[number]) ||
      !DIVISIONS.includes(division as typeof DIVISIONS[number]) ||
      dateFrom || dateTo
    ) return null
    return {
      request: { tab, subject, division, dateFrom: "", dateTo: "" },
      refresh: refreshInput === "1",
    }
  }

  if (tab === "schedule_conflicts") {
    const difference = calendarDifference(dateFrom, dateTo)
    if (
      subjectInput || divisionInput || difference === null ||
      !DASHBOARD_STATISTICS_RANGE_PRESETS.schedule_conflicts.includes(
        difference as typeof DASHBOARD_STATISTICS_RANGE_PRESETS.schedule_conflicts[number],
      )
    ) return null
    return {
      request: { tab, subject: "", division: "", dateFrom, dateTo },
      refresh: refreshInput === "1",
    }
  }

  const subject = subjectInput || "all"
  const difference = calendarDifference(dateFrom, dateTo)
  const inclusiveDays = difference === null ? null : difference + 1
  if (
    !SUBJECTS.includes(subject as typeof SUBJECTS[number]) || divisionInput ||
    inclusiveDays === null ||
    !DASHBOARD_STATISTICS_RANGE_PRESETS.textbooks.includes(
      inclusiveDays as typeof DASHBOARD_STATISTICS_RANGE_PRESETS.textbooks[number],
    )
  ) return null
  return {
    request: { tab, subject, division: "", dateFrom, dateTo },
    refresh: refreshInput === "1",
  }
}

export function normalizeDashboardStatisticsRange(
  tab: DashboardStatisticsRangeTab,
  value: string | number | null | undefined,
) {
  const parsed = typeof value === "number" ? value : Number(value)
  const presets = DASHBOARD_STATISTICS_RANGE_PRESETS[tab] as readonly number[]
  return Number.isInteger(parsed) && presets.includes(parsed) ? parsed : 90
}

function localCalendarDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function addCalendarDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

export function buildDashboardStatisticsDateRange(
  tab: DashboardStatisticsRangeTab,
  range: number,
  now = new Date(),
) {
  const normalizedRange = normalizeDashboardStatisticsRange(tab, range)
  const today = localCalendarDate(now)
  return tab === "schedule_conflicts"
    ? { dateFrom: today, dateTo: addCalendarDays(today, normalizedRange) }
    : { dateFrom: addCalendarDays(today, -(normalizedRange - 1)), dateTo: today }
}

export function buildDashboardStatisticsRequest(input: Readonly<{
  tab: DashboardStatisticsTab
  subject?: string
  division?: string
  range?: number
  now?: Date
}>): DashboardStatisticsRequest {
  if (input.tab === "schedule_conflicts" || input.tab === "textbooks") {
    const dateRange = buildDashboardStatisticsDateRange(
      input.tab,
      normalizeDashboardStatisticsRange(input.tab, input.range),
      input.now,
    )
    return {
      tab: input.tab,
      subject: input.tab === "textbooks" ? input.subject || "all" : "",
      division: "",
      ...dateRange,
    }
  }
  return {
    tab: input.tab,
    subject: input.subject || "all",
    division: input.division || "all",
    dateFrom: "",
    dateTo: "",
  }
}

export function dashboardStatisticsQuery(request: DashboardStatisticsRequest, refresh = false) {
  const params = new URLSearchParams({ tab: request.tab })
  if (request.subject) params.set("subject", request.subject)
  if (request.division) params.set("division", request.division)
  if (request.dateFrom) params.set("dateFrom", request.dateFrom)
  if (request.dateTo) params.set("dateTo", request.dateTo)
  if (refresh) params.set("refresh", "1")
  return params.toString()
}

export function normalizeDashboardStatisticsSnapshot(value: unknown): DashboardStatisticsSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("dashboard_statistics_response_invalid")
  }
  const candidate = value as Record<string, unknown>
  if (
    candidate.ok !== true ||
    candidate.contractVersion !== DASHBOARD_STATISTICS_CONTRACT_VERSION ||
    typeof candidate.tab !== "string" || !isTab(candidate.tab) ||
    typeof candidate.generatedAt !== "string" || !Number.isFinite(Date.parse(candidate.generatedAt)) ||
    typeof candidate.expiresAt !== "string" || !Number.isFinite(Date.parse(candidate.expiresAt)) ||
    !["hit", "miss", "refreshed"].includes(String(candidate.cacheStatus))
  ) throw new Error("dashboard_statistics_response_invalid")
  return candidate as DashboardStatisticsSnapshot
}
