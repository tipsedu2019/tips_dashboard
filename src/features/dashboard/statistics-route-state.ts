import { DASHBOARD_STATISTICS_TABS, normalizeDashboardStatisticsRange, type DashboardStatisticsTab } from "./statistics-contract.ts"

export type StatisticsSubject = "all" | "english" | "math" | "science"
export type StatisticsDivision = "all" | "middle" | "high"
export type StatisticsRouteState = { tab: DashboardStatisticsTab; subject: StatisticsSubject; division: StatisticsDivision; range: number }

/** UI route state is separate from the stricter authenticated API query contract. */
export function parseStatisticsRouteState(search: string): StatisticsRouteState {
  const params = new URLSearchParams(search)
  const single = (key: string) => params.getAll(key).length === 1 ? params.get(key) : null
  const tabInput = single("tab")
  const tab = DASHBOARD_STATISTICS_TABS.includes(tabInput as DashboardStatisticsTab) ? tabInput as DashboardStatisticsTab : "overview"
  const studentFilters = tab === "students_classes"
  const subject = single("subject")
  const division = single("division")
  return {
    tab,
    subject: studentFilters && ["english", "math", "science"].includes(subject ?? "") ? subject as StatisticsSubject : "all",
    division: studentFilters && ["middle", "high"].includes(division ?? "") ? division as StatisticsDivision : "all",
    range: tab === "schedule_conflicts" || tab === "textbooks" ? normalizeDashboardStatisticsRange(tab, single("range")) : 90,
  }
}

export function serializeStatisticsRouteState(state: StatisticsRouteState): string {
  const params = new URLSearchParams({ tab: state.tab, subject: state.subject, division: state.division, range: String(state.range) })
  const normalized = parseStatisticsRouteState(params.toString())
  const result = new URLSearchParams()
  if (normalized.tab !== "overview") result.set("tab", normalized.tab)
  if (normalized.subject !== "all") result.set("subject", normalized.subject)
  if (normalized.division !== "all") result.set("division", normalized.division)
  if (normalized.range !== 90) result.set("range", String(normalized.range))
  return result.toString()
}
