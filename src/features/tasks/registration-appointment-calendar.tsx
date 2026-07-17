"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CalendarDays, ChevronLeft, ChevronRight, List, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import type {
  RegistrationAppointmentCalendarItem,
  RegistrationAppointmentCalendarRange,
  RegistrationAppointmentCalendarStatus,
} from "./registration-appointment-calendar-model"
import {
  getRegistrationAppointmentCalendarRange,
  getSeoulRegistrationDateKey,
} from "./registration-appointment-calendar-model"
import { loadRegistrationAppointmentCalendar } from "./registration-track-service"

const SEOUL_TIME_ZONE = "Asia/Seoul"
const STATUS_ORDER: RegistrationAppointmentCalendarStatus[] = ["scheduled", "completed", "canceled"]
const STATUS_LABELS: Record<RegistrationAppointmentCalendarStatus, string> = {
  scheduled: "예약",
  completed: "완료",
  canceled: "취소",
}
const KIND_LABELS = {
  level_test: "레벨테스트",
  visit_consultation: "방문상담",
} as const
const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"]

type CalendarView = "month" | "week"

type RegistrationAppointmentCalendarProps = {
  onOpenAppointment: (item: RegistrationAppointmentCalendarItem) => void
  refreshToken?: string | number
}

function dateKeyFromUtcDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}

function utcDateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12))
}

function shiftDateKey(dateKey: string, days: number) {
  const date = utcDateFromKey(dateKey)
  date.setUTCDate(date.getUTCDate() + days)
  return dateKeyFromUtcDate(date)
}

function shiftMonthDateKey(dateKey: string, months: number) {
  const date = utcDateFromKey(dateKey)
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  return dateKeyFromUtcDate(date)
}

function startOfWeekDateKey(dateKey: string) {
  const date = utcDateFromKey(dateKey)
  const mondayOffset = (date.getUTCDay() + 6) % 7
  return shiftDateKey(dateKey, -mondayOffset)
}

function formatDateKey(dateKey: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("ko-KR", { ...options, timeZone: "UTC" }).format(utcDateFromKey(dateKey))
}

function formatSeoulTime(timestamp: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: SEOUL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(timestamp))
}

function calendarDays(range: RegistrationAppointmentCalendarRange, view: CalendarView) {
  if (view === "week") {
    return Array.from({ length: 7 }, (_, index) => shiftDateKey(range.startDateKey, index))
  }
  const gridStart = startOfWeekDateKey(range.startDateKey)
  const monthEndWeekStart = startOfWeekDateKey(shiftDateKey(range.endDateKey, -1))
  const gridEnd = shiftDateKey(monthEndWeekStart, 7)
  const days: string[] = []
  for (let dateKey = gridStart; dateKey < gridEnd; dateKey = shiftDateKey(dateKey, 1)) days.push(dateKey)
  return days
}

function appointmentCard(
  item: RegistrationAppointmentCalendarItem,
  onOpenAppointment: (item: RegistrationAppointmentCalendarItem) => void,
  compact = false,
) {
  return (
    <button
      key={item.id}
      type="button"
      onClick={() => onOpenAppointment(item)}
      aria-label={`${formatDateKey(getSeoulRegistrationDateKey(item.scheduledAt), { month: "long", day: "numeric", weekday: "short" })} ${item.studentName} ${KIND_LABELS[item.kind]} ${formatSeoulTime(item.scheduledAt)} ${STATUS_LABELS[item.status]} 상세`}
      className="grid w-full min-w-0 gap-1 rounded-md border bg-background px-2 py-2 text-left shadow-sm transition-colors hover:border-primary/45 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold">{formatSeoulTime(item.scheduledAt)} · {item.studentName}</span>
        <Badge variant="outline" className={`shrink-0 ${compact ? "px-1.5 text-[9px]" : "text-[10px]"}`}>
          {STATUS_LABELS[item.status]}
        </Badge>
      </span>
      <span className="truncate text-[11px] text-muted-foreground">{KIND_LABELS[item.kind]} · {item.place || "장소 미정"}</span>
      <span className="flex flex-wrap gap-1">
        {item.subjects.map((subject) => (
          <Badge key={`${item.id}:${subject}`} variant="secondary" className="px-1.5 py-0 text-[10px]">{subject}</Badge>
        ))}
      </span>
    </button>
  )
}

export function RegistrationAppointmentCalendar({
  onOpenAppointment,
  refreshToken = "",
}: RegistrationAppointmentCalendarProps) {
  const [view, setView] = useState<CalendarView>("month")
  const [anchorDateKey, setAnchorDateKey] = useState(() => getSeoulRegistrationDateKey())
  const [statuses, setStatuses] = useState<RegistrationAppointmentCalendarStatus[]>(["scheduled"])
  const [items, setItems] = useState<RegistrationAppointmentCalendarItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [retryToken, setRetryToken] = useState(0)
  const loadGenerationRef = useRef(0)
  const range = useMemo(() => getRegistrationAppointmentCalendarRange(view, anchorDateKey), [anchorDateKey, view])
  const days = useMemo(() => calendarDays(range, view), [range, view])
  const todayDateKey = getSeoulRegistrationDateKey()

  const itemsByDate = useMemo(() => {
    const grouped = new Map<string, RegistrationAppointmentCalendarItem[]>()
    for (const item of items) {
      const dateKey = getSeoulRegistrationDateKey(item.scheduledAt)
      const current = grouped.get(dateKey) || []
      current.push(item)
      grouped.set(dateKey, current)
    }
    for (const current of grouped.values()) {
      current.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt) || left.appointmentId.localeCompare(right.appointmentId))
    }
    return grouped
  }, [items])

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current
    if (statuses.length === 0) {
      setItems([])
      setLoading(false)
      setError("")
      return
    }
    setLoading(true)
    setError("")
    try {
      const nextItems = await loadRegistrationAppointmentCalendar({
        rangeStart: range.rangeStart,
        rangeEnd: range.rangeEnd,
        statuses,
      })
      if (loadGenerationRef.current !== generation) return
      setItems(nextItems)
    } catch {
      if (loadGenerationRef.current !== generation) return
      setItems([])
      setError("등록 예약을 불러오지 못했습니다. 다시 시도하세요.")
    } finally {
      if (loadGenerationRef.current === generation) setLoading(false)
    }
  }, [range.rangeEnd, range.rangeStart, statuses])

  useEffect(() => {
    void load()
  }, [load, refreshToken, retryToken])

  function toggleStatus(status: RegistrationAppointmentCalendarStatus) {
    setStatuses((current) => current.includes(status)
      ? current.filter((value) => value !== status)
      : STATUS_ORDER.filter((value) => value === status || current.includes(value)))
  }

  function move(direction: -1 | 1) {
    setAnchorDateKey((current) => view === "month"
      ? shiftMonthDateKey(current, direction)
      : shiftDateKey(current, direction * 7))
  }

  const title = view === "month"
    ? formatDateKey(range.startDateKey, { year: "numeric", month: "long" })
    : `${formatDateKey(range.startDateKey, { month: "short", day: "numeric" })} – ${formatDateKey(shiftDateKey(range.endDateKey, -1), { month: "short", day: "numeric" })}`

  return (
    <section className="grid min-w-0 gap-3" aria-label="등록 예약 달력">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-1">
          <Button type="button" variant="outline" size="icon" onClick={() => move(-1)} aria-label="이전 기간">
            <ChevronLeft className="size-4" />
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setAnchorDateKey(getSeoulRegistrationDateKey())}>오늘</Button>
          <Button type="button" variant="outline" size="icon" onClick={() => move(1)} aria-label="다음 기간">
            <ChevronRight className="size-4" />
          </Button>
          <h2 className="ml-2 truncate text-base font-semibold">{title}</h2>
        </div>
        <div role="group" className="inline-flex w-fit rounded-md border bg-background p-1" aria-label="등록 예약 달력 보기">
          <button
            type="button"
            aria-pressed={view === "month"}
            onClick={() => setView("month")}
            className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium ${view === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            <CalendarDays className="size-4" /> 월
          </button>
          <button
            type="button"
            aria-pressed={view === "week"}
            onClick={() => setView("week")}
            className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium ${view === "week" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            <List className="size-4" /> 주
          </button>
        </div>
      </div>

      <div role="group" className="flex flex-wrap items-center gap-2" aria-label="등록 예약 상태 필터">
        {STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={statuses.includes(status)}
            onClick={() => toggleStatus(status)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${statuses.includes(status) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"}`}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>

      {error ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/30 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setRetryToken((current) => current + 1)}>
            <RefreshCw className="size-4" /> 다시 시도
          </Button>
        </div>
      ) : null}

      <div className="hidden min-w-0 overflow-hidden rounded-md border md:block">
        {view === "month" ? (
          <div data-testid="registration-appointment-month" className="grid grid-cols-7">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="border-b bg-muted/35 px-2 py-2 text-center text-xs font-medium text-muted-foreground">{label}</div>
            ))}
            {days.map((dateKey, index) => {
              const dayItems = itemsByDate.get(dateKey) || []
              const inMonth = dateKey.slice(0, 7) === range.startDateKey.slice(0, 7)
              return (
                <div
                  key={dateKey}
                  role="group"
                  aria-label={`${formatDateKey(dateKey, { month: "long", day: "numeric", weekday: "short" })} ${dayItems.length}건`}
                  className={`min-h-28 min-w-0 border-b p-1.5 ${index % 7 === 6 ? "" : "border-r"} ${inMonth ? "bg-background" : "bg-muted/20"}`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs ${dateKey === todayDateKey ? "bg-primary font-semibold text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground"}`}>
                      {Number(dateKey.slice(-2))}
                    </span>
                    {dayItems.length > 0 ? <span className="text-[10px] text-muted-foreground">{dayItems.length}건</span> : null}
                  </div>
                  <div className="grid gap-1">{dayItems.map((item) => appointmentCard(item, onOpenAppointment, true))}</div>
                </div>
              )
            })}
          </div>
        ) : (
          <div data-testid="registration-appointment-week" className="grid grid-cols-7">
            {days.map((dateKey, index) => (
              <div
                key={dateKey}
                role="group"
                aria-label={`${formatDateKey(dateKey, { month: "long", day: "numeric", weekday: "short" })} ${(itemsByDate.get(dateKey) || []).length}건`}
                className={`min-h-80 min-w-0 p-2 ${index < 6 ? "border-r" : ""}`}
              >
                <div className="mb-2 border-b pb-2 text-center text-xs font-medium">
                  <span className="text-muted-foreground">{WEEKDAY_LABELS[index]}</span>
                  <span className={`ml-1 inline-flex size-6 items-center justify-center rounded-full ${dateKey === todayDateKey ? "bg-primary text-primary-foreground" : ""}`}>{Number(dateKey.slice(-2))}</span>
                </div>
                <div className="grid gap-1.5">{(itemsByDate.get(dateKey) || []).map((item) => appointmentCard(item, onOpenAppointment))}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div data-testid="registration-appointment-mobile-agenda" className="grid gap-3 md:hidden">
        {days.map((dateKey, index) => {
          const dayItems = itemsByDate.get(dateKey) || []
          if (dayItems.length === 0) return null
          return (
            <section key={dateKey} className="grid gap-2" aria-label={`${formatDateKey(dateKey, { month: "long", day: "numeric" })} 예약`}>
              <h3 className="text-sm font-semibold">{formatDateKey(dateKey, { month: "long", day: "numeric" })} {WEEKDAY_LABELS[(startOfWeekDateKey(dateKey) === range.startDateKey && view === "week") ? index : (utcDateFromKey(dateKey).getUTCDay() + 6) % 7]}요일</h3>
              <div className="grid gap-2">{dayItems.map((item) => appointmentCard(item, onOpenAppointment))}</div>
            </section>
          )
        })}
      </div>

      {!loading && !error && items.length === 0 ? (
        <div className="rounded-md border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
          선택한 기간과 상태에 해당하는 등록 예약이 없습니다.
        </div>
      ) : null}
      {loading ? (
        <div role="status" aria-live="polite" className="rounded-md border px-4 py-12 text-center text-sm text-muted-foreground">
          등록 예약을 불러오는 중입니다.
        </div>
      ) : null}
    </section>
  )
}
