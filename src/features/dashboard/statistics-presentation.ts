type DistributionRow = Record<string, unknown>
const korean = new Intl.Collator("ko-KR", { numeric: true })
const label = (row: DistributionRow) => typeof row.label === "string" ? row.label : ""
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0

function gradeRank(value: string): number {
  const match = value.match(/^(초|중|고)(?:등학교|등|학교)?\s*(\d+)/u)
  return match ? ({ 초: 0, 중: 10, 고: 20 }[match[1]] ?? 90) + Number(match[2]) : 100
}

/** Sort presentation copies only; retain the server's exact key for roster queries. */
export function sortStatisticsDistribution<T extends DistributionRow>(rows: T[], axis: string, metric = "studentCount"): T[] {
  return [...rows].sort((a, b) => {
    const order = axis === "grade" ? gradeRank(label(a)) - gradeRank(label(b)) : count(b[metric]) - count(a[metric])
    return order || korean.compare(label(a), label(b)) || korean.compare(String(a.key ?? ""), String(b.key ?? ""))
  })
}

export function statisticsBarPercent(value: unknown, maximum: number): number {
  return maximum > 0 && Number.isFinite(maximum) ? Math.min(100, count(value) / maximum * 100) : 0
}
