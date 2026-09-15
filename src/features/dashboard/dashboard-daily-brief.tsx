"use client"

import Link from "next/link"
import { ChevronRight, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useDashboardDailyBrief } from "./use-dashboard-daily-brief"

const countItems = [
  { key: "levelTests", label: "레벨테스트", kind: "level_test" },
  { key: "visitConsultations", label: "방문상담", kind: "visit_consultation" },
  { key: "observationClasses", label: "청강", kind: "observation" },
] as const

const shortcuts = [
  { href: "/admin/registration", label: "등록" },
  { href: "/admin/academic-calendar", label: "학사" },
  { href: "/admin/statistics", label: "통계" },
]

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  weekday: "long",
})
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

const registrationLinkClass = "inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function DashboardDailyBrief() {
  const { brief, localDate, loading, error, retry } = useDashboardDailyBrief()
  const date = brief?.localDate ?? localDate
  const initialLoading = loading && !brief
  const refreshing = loading && Boolean(brief)
  const total = brief ? countItems.reduce((sum, item) => sum + brief.counts[item.key], 0) : 0

  return (
    <section className="grid w-full min-w-0 max-w-[1120px] gap-6" aria-labelledby="daily-brief-heading">
      <div className="grid gap-4">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div>
            <h2 id="daily-brief-heading" className="text-2xl font-semibold leading-8 tracking-tight md:text-[28px] md:leading-9">오늘의 일정</h2>
            {date ? <time dateTime={date} className="mt-1 block text-sm text-muted-foreground">{dateFormatter.format(new Date(`${date}T00:00:00+09:00`))}</time> : null}
          </div>
          <div className="flex items-center gap-1">
            {brief ? <time dateTime={brief.generatedAt} className="text-xs tabular-nums text-muted-foreground">{formatTime(brief.generatedAt)} 기준</time> : null}
            <Button type="button" variant="ghost" size="icon" className="size-11" onClick={retry} disabled={loading} aria-label="일정 새로고침">
              <RefreshCw aria-hidden="true" className={refreshing ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} />
            </Button>
          </div>
        </header>

        <dl className="grid grid-cols-3 divide-x rounded-xl border bg-card py-4" aria-busy={initialLoading}>
          {countItems.map((item) => (
            <div key={item.key} className="min-w-0 px-3 sm:px-5">
              <dt className="text-xs font-medium text-muted-foreground sm:text-sm">{item.label}</dt>
              <dd className="mt-2 flex min-h-8 items-baseline gap-1 tabular-nums">
                {initialLoading ? <Skeleton className="h-8 w-16" /> : brief ? (
                  <Link href={`/admin/registration?view=calendar&kind=${item.kind}`} prefetch={false} aria-label={`${item.label} ${brief.counts[item.key]}건 · 등록 일정 보기`} className="group flex min-h-11 w-full items-baseline gap-1 rounded-md text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="text-2xl font-semibold group-hover:underline">{brief.counts[item.key]}</span><span className="text-sm">건</span><ChevronRight aria-hidden="true" className="ml-auto size-4 self-center" />
                  </Link>
                ) : <><span className="text-2xl font-semibold">—</span><span className="sr-only">미조회</span></>}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid gap-3">
        <h3 className="text-sm font-medium">오늘 일정 <span className="font-normal text-muted-foreground">· 시간순 최대 5개</span></h3>
        {initialLoading ? (
          <div role="status" aria-label="오늘 일정을 불러오는 중" className="divide-y rounded-xl border bg-card">
            <span className="sr-only">오늘 일정을 불러오는 중입니다.</span>
            {[0, 1, 2].map((row) => (
              <div key={row} aria-hidden="true" className="grid min-h-16 grid-cols-[48px_minmax(0,1fr)] items-start gap-3 px-4 py-3 md:grid-cols-[64px_minmax(0,1fr)]">
                <Skeleton className="mt-1 h-4 w-10" />
                <div className="grid gap-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
              </div>
            ))}
          </div>
        ) : null}

        <div role="status" aria-live="polite" aria-atomic="true" className="empty:hidden">
          {refreshing ? <p className="text-sm text-muted-foreground">일정을 새로고침하는 중입니다.</p> : null}
          {error ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-sm text-muted-foreground">{brief ? "새로고침하지 못했습니다. 이전 조회 일정을 표시합니다." : error}</p>
              <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={retry} disabled={loading}>다시 시도</Button>
            </div>
          ) : null}
        </div>

        {brief?.upcoming.length ? (
          <ul className="grid overflow-hidden rounded-xl border bg-card" aria-label="오늘 일정">
            {brief.upcoming.map((item) => (
              <li key={`${item.sourceKind}:${item.sourceId}`} className="border-b last:border-b-0">
                <Link href={item.href} className="grid min-h-16 grid-cols-[48px_minmax(0,1fr)] items-start gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[64px_minmax(0,1fr)]">
                  <time dateTime={item.scheduledAt} className="pt-0.5 text-sm font-medium tabular-nums">{formatTime(item.scheduledAt)}</time>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="block font-medium">{item.title}</span>
                    {item.subjectLabels.length || item.placeLabel ? <span className="mt-0.5 block text-sm text-muted-foreground">{[...item.subjectLabels, item.placeLabel].filter(Boolean).join(" · ")}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : brief ? (
          <div className="rounded-xl border bg-card px-4 py-5">
            <p className="text-sm text-muted-foreground">오늘 예정된 레벨테스트·방문상담·청강이 없습니다.</p>
            <Link href="/admin/registration?view=calendar" className={registrationLinkClass}>등록 일정 보기</Link>
          </div>
        ) : null}
        {brief && total > 5 && brief.upcoming.length > 0 ? <Link href="/admin/registration?view=calendar" className={`${registrationLinkClass} justify-self-start`}>등록 일정 보기</Link> : null}
      </div>

      <nav className="flex flex-wrap gap-x-6" aria-label="바로가기">
        {shortcuts.map((shortcut) => (
          <Link key={shortcut.href} href={shortcut.href} className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{shortcut.label}</Link>
        ))}
      </nav>
    </section>
  )
}
