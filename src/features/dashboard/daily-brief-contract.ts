export const DASHBOARD_DAILY_BRIEF_SOURCE_KINDS = [
  "level_test",
  "visit_consultation",
  "observation_class",
] as const

export type DashboardDailyBriefSourceKind = typeof DASHBOARD_DAILY_BRIEF_SOURCE_KINDS[number]

export type DashboardDailyBriefUpcomingItem = Readonly<{
  sourceKind: DashboardDailyBriefSourceKind
  sourceId: string
  scheduledAt: string
  title: string
  subjectLabels: string[]
  placeLabel: string | null
  href: string
}>

export type DashboardDailyBrief = Readonly<{
  localDate: string
  generatedAt: string
  counts: Readonly<{
    levelTests: number
    visitConsultations: number
    observationClasses: number
    openTasks: number
  }>
  upcoming: DashboardDailyBriefUpcomingItem[]
}>

const DAILY_BRIEF_ERROR = "dashboard_daily_brief_contract_invalid"

function fail(): never {
  throw new Error(DAILY_BRIEF_ERROR)
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail()
  return value as Record<string, unknown>
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const valueKeys = Object.keys(value).sort()
  return valueKeys.length === keys.length && valueKeys.every((key, index) => key === keys[index])
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) fail()
  return value
}

function timestamp(value: unknown): string {
  const result = text(value)
  if (!Number.isFinite(Date.parse(result))) fail()
  return result
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail()
  return value
}

function normalizeUpcomingItem(value: unknown): DashboardDailyBriefUpcomingItem {
  const item = record(value)
  if (!hasExactKeys(item, ["href", "placeLabel", "scheduledAt", "sourceId", "sourceKind", "subjectLabels", "title"])) fail()
  if (!DASHBOARD_DAILY_BRIEF_SOURCE_KINDS.includes(item.sourceKind as DashboardDailyBriefSourceKind)) fail()
  if (!Array.isArray(item.subjectLabels) || item.subjectLabels.some((label) => typeof label !== "string")) fail()
  if (item.placeLabel !== null && typeof item.placeLabel !== "string") fail()

  const href = text(item.href)
  if (!href.startsWith("/admin/registration?")) fail()

  return {
    sourceKind: item.sourceKind as DashboardDailyBriefSourceKind,
    sourceId: text(item.sourceId),
    scheduledAt: timestamp(item.scheduledAt),
    title: text(item.title),
    subjectLabels: [...item.subjectLabels],
    placeLabel: item.placeLabel,
    href,
  }
}

export function normalizeDashboardDailyBrief(value: unknown): DashboardDailyBrief {
  const brief = record(value)
  if (!hasExactKeys(brief, ["counts", "generatedAt", "localDate", "upcoming"])) fail()
  const localDate = text(brief.localDate)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(localDate)) fail()

  const counts = record(brief.counts)
  if (!hasExactKeys(counts, ["levelTests", "observationClasses", "openTasks", "visitConsultations"])) fail()
  if (!Array.isArray(brief.upcoming) || brief.upcoming.length > 5) fail()

  return {
    localDate,
    generatedAt: timestamp(brief.generatedAt),
    counts: {
      levelTests: count(counts.levelTests),
      visitConsultations: count(counts.visitConsultations),
      observationClasses: count(counts.observationClasses),
      openTasks: count(counts.openTasks),
    },
    upcoming: brief.upcoming.map(normalizeUpcomingItem),
  }
}
