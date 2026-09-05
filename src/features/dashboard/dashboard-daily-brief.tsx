"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import { useDashboardDailyBrief } from "./use-dashboard-daily-brief"

const countItems = [
  { key: "levelTests", label: "레벨테스트" },
  { key: "visitConsultations", label: "방문상담" },
  { key: "observationClasses", label: "청강" },
  { key: "openTasks", label: "오늘 업무" },
] as const

const shortcuts = [
  { href: "/admin/registration", label: "등록" },
  { href: "/admin/tasks", label: "업무" },
  { href: "/admin/academic-calendar", label: "학사" },
  { href: "/admin/statistics", label: "통계" },
]

const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? timeFormatter.format(date) : ""
}

export function DashboardDailyBrief() {
  const { brief, error, retry } = useDashboardDailyBrief()

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {countItems.map((item) => (
          <div key={item.key} className="rounded-xl border bg-card px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {brief ? brief.counts[item.key] : "-"}
            </p>
          </div>
        ))}
      </div>

      {error ? (
        <div className="flex items-center gap-2" role="status">
          <span className="text-sm text-muted-foreground">{error}</span>
          <Button type="button" variant="ghost" size="sm" onClick={retry}>다시 시도</Button>
        </div>
      ) : null}

      {brief?.upcoming.length ? (
        <ul className="grid overflow-hidden rounded-xl border" aria-label="오늘 일정">
          {brief.upcoming.map((item) => (
            <li key={`${item.sourceKind}:${item.sourceId}`} className="border-b last:border-b-0">
              <Link href={item.href} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <time dateTime={item.scheduledAt} className="text-sm font-medium tabular-nums">{formatTime(item.scheduledAt)}</time>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{item.title}</span>
                  {item.subjectLabels.length || item.placeLabel ? (
                    <span className="block truncate text-sm text-muted-foreground">
                      {[...item.subjectLabels, item.placeLabel].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <nav className="flex flex-wrap gap-2" aria-label="바로가기">
        {shortcuts.map((shortcut) => (
          <Button key={shortcut.href} asChild variant="outline" size="sm">
            <Link href={shortcut.href}>{shortcut.label}</Link>
          </Button>
        ))}
      </nav>
    </div>
  )
}
