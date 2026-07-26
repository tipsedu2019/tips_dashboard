"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"

export type ClassScheduleCalendarDay = {
  key: string
  displayLabel: string
  inCurrentMonth: boolean
  isToday: boolean
  selected: boolean
  disabled: boolean
  tone:
    | "default"
    | "muted"
    | "today"
    | "billing-previous"
    | "billing-current"
    | "billing-next"
  badges: Array<{
    primary: string
    secondary: string
    tone: "default" | "class" | "holiday" | "makeup" | "completed"
  }>
  ariaLabel: string
}

export type ClassScheduleCalendarSurfaceProps = {
  monthLabel: string
  weekdayLabels: string[]
  days: ClassScheduleCalendarDay[]
  onPreviousMonth: () => void
  onNextMonth: () => void
  onSelectDay: (key: string) => void
  ariaLabel?: string
  labelledBy?: string
}

const DAY_TONE_CLASS: Record<ClassScheduleCalendarDay["tone"], string> = {
  default: "text-foreground hover:bg-muted",
  muted: "text-muted-foreground/40",
  today: "border border-primary/50 text-primary hover:bg-primary/5",
  "billing-previous": "border border-sky-200 bg-sky-50 text-sky-950 hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100",
  "billing-current": "border border-emerald-200 bg-emerald-50 text-emerald-950 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100",
  "billing-next": "border border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100",
}

const BADGE_TONE_CLASS: Record<ClassScheduleCalendarDay["badges"][number]["tone"], string> = {
  default: "text-current",
  class: "text-primary",
  holiday: "text-rose-700 dark:text-rose-300",
  makeup: "text-amber-700 dark:text-amber-300",
  completed: "text-emerald-700 dark:text-emerald-300",
}

export function ClassScheduleCalendarSurface({
  monthLabel,
  weekdayLabels,
  days,
  onPreviousMonth,
  onNextMonth,
  onSelectDay,
  ariaLabel = "수업일정 달력",
  labelledBy,
}: ClassScheduleCalendarSurfaceProps) {
  return (
    <div className="w-full overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center justify-between border-b px-2 py-1.5">
        <button
          type="button"
          aria-label="이전 달"
          onClick={onPreviousMonth}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <span className="text-sm font-semibold">{monthLabel}</span>
        <button
          type="button"
          aria-label="다음 달"
          onClick={onNextMonth}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div
        role="grid"
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-labelledby={labelledBy}
        className="grid grid-cols-7 gap-1 p-2"
      >
        {weekdayLabels.map((weekday) => (
          <div
            key={weekday}
            role="columnheader"
            className="grid h-6 place-items-center text-[11px] font-medium text-muted-foreground"
          >
            {weekday}
          </div>
        ))}
        {days.map((day) => (
          <button
            key={day.key}
            type="button"
            role="gridcell"
            aria-selected={day.selected}
            aria-label={day.ariaLabel}
            title={day.ariaLabel}
            disabled={day.disabled}
            onClick={() => onSelectDay(day.key)}
            className={[
              "grid min-h-16 min-w-0 place-items-center content-center gap-0.5 rounded-md px-1.5 py-1 text-center text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring/40",
              day.selected
                ? "bg-primary text-primary-foreground shadow-xs"
                : DAY_TONE_CLASS[day.tone],
              day.disabled ? "cursor-not-allowed opacity-55" : "",
              !day.inCurrentMonth && !day.selected ? "opacity-55" : "",
            ].join(" ")}
          >
            <span className="text-[11px] font-medium">{day.displayLabel}</span>
            {day.badges.map((badge, index) => (
              <span
                key={`${day.key}-${badge.primary}-${badge.secondary}-${index}`}
                className={[
                  "grid w-full min-w-0 leading-tight",
                  BADGE_TONE_CLASS[badge.tone],
                ].join(" ")}
              >
                <span className="w-full whitespace-normal break-keep font-semibold">{badge.primary}</span>
                {badge.secondary ? (
                  <span className="w-full whitespace-normal break-keep text-[10px] font-medium opacity-80">
                    {badge.secondary}
                  </span>
                ) : null}
              </span>
            ))}
          </button>
        ))}
      </div>
    </div>
  )
}
