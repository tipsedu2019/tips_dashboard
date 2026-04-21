"use client"

import Link from "next/link"
import { type MouseEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUpRight,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  List,
  Menu,
  Search,
  School,
  Sparkles,
} from "lucide-react"
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  subMonths,
} from "date-fns"
import { ko } from "date-fns/locale"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { buildAcademicAnnualBoardHref } from "@/features/operations/academic-calendar-links"
import { getAcademicEventTypeLabel } from "@/features/operations/academic-event-utils.js"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { type CalendarEvent } from "../types"
import {
  buildDateSelectionRange,
  buildDragPreviewRange,
  buildMonthEventSegments,
  getAllEventsForDay,
  getEventRange,
  getGradeBadgeLabels,
  getSingleDayEventsForDay,
  isMultiDayEvent,
  moveCalendarEventByAnchorDate,
  sortEventsForCalendarDay,
} from "../utils/calendar-grid.js"

interface CalendarMainProps {
  selectedDate?: Date
  initialQuery?: string
  onDateSelect?: (date: Date) => void
  onMenuClick?: () => void
  events?: CalendarEvent[]
  readOnly?: boolean
  onEventClick?: (event: CalendarEvent) => void
  onEmptySlotClick?: (date: Date) => void
  onRangeSelect?: (range: { start: Date; end: Date }) => void
  onOverflowClick?: (date: Date, events: CalendarEvent[]) => void
  onEventDrop?: (event: CalendarEvent, nextEvent: CalendarEvent) => boolean | void | Promise<boolean | void>
}

type MonthEventSegment = {
  event: CalendarEvent
  weekIndex: number
  lane: number
  startIndex: number
  endIndex: number
  span: number
  continuesBefore: boolean
  continuesAfter: boolean
}

function formatEventRange(event: CalendarEvent) {
  const { start, end } = getEventRange(event)
  if (isSameDay(start, end)) {
    return format(start, "M월 d일", { locale: ko })
  }
  return `${format(start, "M월 d일", { locale: ko })} - ${format(end, "M월 d일", { locale: ko })}`
}

function formatAgendaDay(day: Date) {
  return format(day, "M월 d일 EEEE", { locale: ko })
}

function hasExamScopeDetails(event: CalendarEvent) {
  return Boolean(
    event.examTerm ||
      event.scopeSummary ||
      (Array.isArray(event.textbookScopes) && event.textbookScopes.length > 0) ||
      (Array.isArray(event.subtextbookScopes) && event.subtextbookScopes.length > 0) ||
      event.textbookScope ||
      event.subtextbookScope,
  )
}

function renderExamScopeHover(event: CalendarEvent, badgeClassName = "") {
  if ((event.typeLabel !== "시험기간" && event.typeLabel !== "영어시험일" && event.typeLabel !== "수학시험일") || !event.examTerm) {
    return null
  }

  const badge = (
    <Badge variant="secondary" className={badgeClassName || "h-5 px-1.5 text-[10px]"}>
      {event.examTerm}
    </Badge>
  )

  if (!hasExamScopeDetails(event)) {
    return badge
  }

  return (
    <HoverCard>
      <HoverCardTrigger asChild>{badge}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-foreground">시험 범위 보기</p>
          <p className="text-xs text-muted-foreground">{getAcademicEventTypeLabel(event.typeLabel)} · {event.examTerm}</p>
        </div>
        {Array.isArray(event.textbookScopes) && event.textbookScopes.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">교재 시험범위</p>
            <div className="space-y-1">
              {event.textbookScopes.map((scope, index) => (
                <div key={`${event.id}-textbook-${index}`} className="rounded-md border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">{[scope.name, scope.publisher].filter(Boolean).join(" · ")}</p>
                  <p>{scope.scope || "범위 미입력"}</p>
                </div>
              ))}
            </div>
          </div>
        ) : event.textbookScope || event.scopeSummary ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">교재 시험범위</p>
            <div className="rounded-md border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
              <p>{event.textbookScope || event.scopeSummary}</p>
            </div>
          </div>
        ) : null}
        {Array.isArray(event.subtextbookScopes) && event.subtextbookScopes.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">부교재 시험범위</p>
            <div className="space-y-1">
              {event.subtextbookScopes.map((scope, index) => (
                <div key={`${event.id}-subtextbook-${index}`} className="rounded-md border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">{[scope.name, scope.publisher].filter(Boolean).join(" · ")}</p>
                  <p>{scope.scope || "범위 미입력"}</p>
                </div>
              ))}
            </div>
          </div>
        ) : event.subtextbookScope ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">부교재 시험범위</p>
            <div className="rounded-md border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
              <p>{event.subtextbookScope}</p>
            </div>
          </div>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  )
}

function renderEventContextBadges(event: CalendarEvent, size: "month" | "list" = "month") {
  const schoolBadgeLabel = event.schoolName || event.location
  const gradeBadgeLabels = getGradeBadgeLabels(event.grade)
    .filter((label) => label && label !== "전체")

  const badgeClassName =
    size === "month"
      ? "h-4 px-1 text-[9px] leading-none text-white/95 border-white/20 bg-white/10"
      : "h-5 px-1.5 text-[10px]"

  return (
    <>
      {schoolBadgeLabel ? (
        <Badge variant="outline" className={badgeClassName}>
          {schoolBadgeLabel}
        </Badge>
      ) : null}
      {gradeBadgeLabels.map((gradeLabel) => (
        <Badge key={`${event.id}-${size}-${gradeLabel}`} variant="outline" className={badgeClassName}>
          {gradeLabel}
        </Badge>
      ))}
    </>
  )
}

function buildAcademicAnnualBoardEventHref(event: CalendarEvent, dateOverride?: Date) {
  return buildAcademicAnnualBoardHref({
    eventId: event.sourceId || event.id,
    schoolName: event.schoolName,
    schoolId: event.schoolId,
    title: event.title,
    grade: event.grade,
    category: event.category,
    date: format(dateOverride || event.date, "yyyy-MM-dd"),
  })
}

function matchesCalendarQuery(event: CalendarEvent, query: string) {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  if (tokens.length === 0) {
    return true
  }

  const searchText = [event.title, event.schoolName, event.typeLabel, event.grade, event.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return tokens.every((token) => searchText.includes(token))
}

export function CalendarMain({
  selectedDate,
  initialQuery,
  onDateSelect,
  onMenuClick,
  events = [],
  readOnly = false,
  onEventClick,
  onEmptySlotClick,
  onRangeSelect,
  onOverflowClick,
  onEventDrop,
}: CalendarMainProps) {
  const [currentDate, setCurrentDate] = useState(selectedDate || new Date())
  const [viewMode, setViewMode] = useState<"month" | "list">("month")
  const [query, setQuery] = useState("")
  const [overflowDate, setOverflowDate] = useState<Date | null>(null)
  const [overflowEvents, setOverflowEvents] = useState<CalendarEvent[]>([])
  const [selectionAnchor, setSelectionAnchor] = useState<Date | null>(null)
  const [selectionTarget, setSelectionTarget] = useState<Date | null>(null)
  const [draggedEvent, setDraggedEvent] = useState<CalendarEvent | null>(null)
  const [dragAnchorDate, setDragAnchorDate] = useState<Date | null>(null)
  const [dragTargetDate, setDragTargetDate] = useState<Date | null>(null)
  const pendingDragAnchorDateRef = useRef<Date | null>(null)
  const didFinishRangeSelectionRef = useRef(false)
  const appliedInitialQueryRef = useRef("")

  useEffect(() => {
    if (selectedDate instanceof Date && !Number.isNaN(selectedDate.getTime())) {
      setCurrentDate(selectedDate)
    }
  }, [selectedDate])

  useEffect(() => {
    if (!initialQuery || appliedInitialQueryRef.current === initialQuery) {
      return
    }

    appliedInitialQueryRef.current = initialQuery
    setQuery(initialQuery)
  }, [initialQuery])

  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const calendarStart = new Date(monthStart)
  const calendarEnd = new Date(monthEnd)
  calendarStart.setDate(calendarStart.getDate() - monthStart.getDay())
  calendarEnd.setDate(calendarEnd.getDate() + (6 - monthEnd.getDay()))

  const calendarDays = useMemo(
    () => eachDayOfInterval({ start: calendarStart, end: calendarEnd }),
    [calendarEnd, calendarStart],
  )

  const calendarWeeks = useMemo(() => {
    const weeks = []
    for (let index = 0; index < calendarDays.length; index += 7) {
      weeks.push(calendarDays.slice(index, index + 7))
    }
    return weeks
  }, [calendarDays])

  const filteredEvents = useMemo(() => {
    if (!query.trim()) {
      return events
    }

    return events.filter((event) => matchesCalendarQuery(event, query))
  }, [events, query])

  const listEventGroups = useMemo(() => {
    const groupedEvents = new Map<string, { date: Date; events: CalendarEvent[] }>()

    filteredEvents.forEach((event) => {
      const { start, end } = getEventRange(event)
      eachDayOfInterval({ start, end }).forEach((day) => {
        const key = format(day, "yyyy-MM-dd")
        const existingGroup = groupedEvents.get(key)
        if (existingGroup) {
          existingGroup.events.push(event)
        } else {
          groupedEvents.set(key, { date: day, events: [event] })
        }
      })
    })

    return [...groupedEvents.values()]
      .sort((left, right) => left.date.getTime() - right.date.getTime())
      .map((group) => ({
        ...group,
        events: sortEventsForCalendarDay(group.events, group.date),
      }))
  }, [filteredEvents])

  const monthSegments = useMemo(
    () => buildMonthEventSegments(calendarDays, filteredEvents.filter((event) => isMultiDayEvent(event))) as MonthEventSegment[],
    [calendarDays, filteredEvents],
  )

  const selectionRange = useMemo(() => {
    if (!selectionAnchor || !selectionTarget) {
      return null
    }
    return buildDateSelectionRange(selectionAnchor, selectionTarget)
  }, [selectionAnchor, selectionTarget])

  useEffect(() => {
    if (!selectionAnchor) {
      return
    }

    const resetSelection = () => {
      setSelectionAnchor(null)
      setSelectionTarget(null)
    }

    window.addEventListener("pointerup", resetSelection)
    window.addEventListener("pointercancel", resetSelection)

    return () => {
      window.removeEventListener("pointerup", resetSelection)
      window.removeEventListener("pointercancel", resetSelection)
    }
  }, [selectionAnchor])

  const dragPreviewRange = useMemo(() => {
    if (!draggedEvent || !dragTargetDate) {
      return null
    }
    return buildDragPreviewRange(draggedEvent, dragTargetDate, dragAnchorDate || draggedEvent.date)
  }, [dragAnchorDate, dragTargetDate, draggedEvent])

  const navigateMonth = (direction: "prev" | "next") => {
    setCurrentDate(direction === "prev" ? subMonths(currentDate, 1) : addMonths(currentDate, 1))
  }

  const goToToday = () => {
    const today = new Date()
    setCurrentDate(today)
    onDateSelect?.(today)
  }

  const openOverflow = (day: Date, dayEvents: CalendarEvent[]) => {
    setOverflowDate(day)
    setOverflowEvents(dayEvents)
    onOverflowClick?.(day, dayEvents)
  }

  const handleSelectionFinish = (day: Date) => {
    if (!selectionAnchor) {
      return
    }

    if (selectionAnchor.getTime() !== day.getTime()) {
      didFinishRangeSelectionRef.current = true
      onRangeSelect?.(buildDateSelectionRange(selectionAnchor, day))
    }

    setSelectionAnchor(null)
    setSelectionTarget(null)
  }

  const handleDayNumberClick = (event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>, day: Date) => {
    event.stopPropagation()
    didFinishRangeSelectionRef.current = false
    onDateSelect?.(day)
  }

  const handleDayCellClick = (day: Date, hasEvents: boolean) => {
    if (didFinishRangeSelectionRef.current) {
      didFinishRangeSelectionRef.current = false
      return
    }

    if (!readOnly && !hasEvents) {
      onEmptySlotClick?.(day)
      return
    }

    onDateSelect?.(day)
  }

  const handleEventDrop = async (day: Date) => {
    if (!draggedEvent || readOnly) {
      return
    }

    const nextEvent = moveCalendarEventByAnchorDate(draggedEvent, dragAnchorDate || draggedEvent.date, day)
    const hasSameStartDate = nextEvent.date.getTime() === getEventRange(draggedEvent).start.getTime()

    if (hasSameStartDate) {
      setDraggedEvent(null)
      setDragAnchorDate(null)
      setDragTargetDate(null)
      return
    }

    try {
      const moveResult = await onEventDrop?.(draggedEvent, nextEvent)
      if (moveResult === false) {
        return
      }
    } finally {
      setDraggedEvent(null)
      setDragAnchorDate(null)
      setDragTargetDate(null)
    }
  }

  const renderCalendarGrid = () => {
    const weekDays = ["일", "월", "화", "수", "목", "금", "토"]

    return (
      <div className="flex-1 bg-background">
        <div className="grid grid-cols-7 border-b">
          {weekDays.map((day) => (
            <div
              key={day}
              className="border-r p-3 text-center text-sm font-medium text-muted-foreground last:border-r-0"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="flex flex-col">
          {calendarWeeks.map((week, weekIndex) => {
            const weekSegments = monthSegments.filter((segment) => segment.weekIndex === weekIndex)
            const laneCount = Math.max(weekSegments.reduce((max, segment) => Math.max(max, segment.lane + 1), 0), 0)
            const segmentOffset = laneCount > 0 ? 30 + laneCount * 26 : 30

            return (
              <div key={`week-${weekIndex}`} className="relative grid grid-cols-7 border-b last:border-b-0">
                {week.map((day) => {
                  const dayEvents = getAllEventsForDay(filteredEvents, day) as CalendarEvent[]
                  const singleDayEvents = getSingleDayEventsForDay(filteredEvents, day) as CalendarEvent[]
                  const visibleEvents: CalendarEvent[] = singleDayEvents.slice(0, 2)
                  const hiddenCount = Math.max(0, singleDayEvents.length - visibleEvents.length)
                  const isCurrentMonth = isSameMonth(day, currentDate)
                  const isDayToday = isToday(day)
                  const isSelected = selectedDate && isSameDay(day, selectedDate)

                  const isWithinSelection =
                    selectionRange &&
                    day.getTime() >= selectionRange.start.getTime() &&
                    day.getTime() <= selectionRange.end.getTime()
                  const isWithinDragPreview =
                    dragPreviewRange &&
                    day.getTime() >= dragPreviewRange.start.getTime() &&
                    day.getTime() <= dragPreviewRange.end.getTime()

                  return (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        "group relative border-r px-2 pb-2 last:border-r-0",
                        isCurrentMonth
                          ? "bg-background hover:bg-accent/40"
                          : "bg-muted/20 text-muted-foreground",
                        isSelected && "ring-2 ring-primary ring-inset",
                        isWithinSelection && "bg-primary/8",
                        isWithinDragPreview && "bg-blue-500/10 ring-1 ring-blue-400/60 ring-inset",
                      )}
                      style={{ minHeight: `${Math.max(136, segmentOffset + 70)}px`, paddingTop: `${segmentOffset}px` }}
                      onPointerDown={() => {
                        if (draggedEvent) {
                          return
                        }
                        setSelectionAnchor(day)
                        setSelectionTarget(day)
                      }}
                      onPointerEnter={() => {
                        if (selectionAnchor) {
                          setSelectionTarget(day)
                        }
                      }}
                      onPointerUp={() => handleSelectionFinish(day)}
                      onDragOver={(event) => {
                        if (!draggedEvent || readOnly) {
                          return
                        }
                        event.preventDefault()
                        setDragTargetDate(day)
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        void handleEventDrop(day)
                      }}
                      onClick={() => handleDayCellClick(day, dayEvents.length > 0)}
                    >
                      <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
                        <button
                          type="button"
                          className={cn(
                            "text-sm font-medium",
                            isDayToday &&
                              "flex size-6 items-center justify-center rounded-md bg-primary text-xs text-primary-foreground",
                          )}
                          aria-label={`${format(day, "M월 d일", { locale: ko })} 선택`}
                          onPointerDown={(pointerEvent) => {
                            pointerEvent.stopPropagation()
                          }}
                          onClick={(clickEvent) => handleDayNumberClick(clickEvent, day)}
                        >
                          {format(day, "d")}
                        </button>
                        {!readOnly ? (
                          <button
                            type="button"
                            className="opacity-0 transition-opacity group-hover:opacity-100 text-[11px] text-muted-foreground"
                            onPointerDown={(pointerEvent) => {
                              pointerEvent.stopPropagation()
                            }}
                            onClick={(event) => {
                              event.stopPropagation()
                              onEmptySlotClick?.(day)
                            }}
                          >
                            추가
                          </button>
                        ) : null}
                      </div>

                      <div className="space-y-1">
                        {visibleEvents.map((event) => {
                          const annualBoardHref = buildAcademicAnnualBoardEventHref(event)

                          return (
                            <div
                              key={event.id}
                              className={cn(
                                "flex items-stretch gap-1 rounded-md text-white shadow-sm transition-all hover:-translate-y-px hover:shadow-md",
                                event.color,
                              )}
                            >
                              <button
                                draggable={!readOnly}
                                className="min-w-0 flex-1 cursor-pointer rounded-md bg-transparent px-2 py-1.5 text-left text-[11px]"
                                onPointerDown={(pointerEvent) => {
                                  pointerEvent.stopPropagation()
                                }}
                                onDragStart={(dragEvent) => {
                                  if (readOnly) {
                                    dragEvent.preventDefault()
                                    return
                                  }
                                  dragEvent.stopPropagation()
                                  pendingDragAnchorDateRef.current = null
                                  setDraggedEvent(event)
                                  setDragAnchorDate(event.date)
                                  setDragTargetDate(event.date)
                                }}
                                onDragEnd={() => {
                                  pendingDragAnchorDateRef.current = null
                                  setDraggedEvent(null)
                                  setDragAnchorDate(null)
                                  setDragTargetDate(null)
                                }}
                                onClick={(clickEvent) => {
                                  clickEvent.stopPropagation()
                                  onEventClick?.(event)
                                }}
                              >
                                <div className="flex flex-wrap items-center gap-1">
                                  {renderExamScopeHover(event)}
                                  <span className="block truncate font-medium">{event.title}</span>
                                  {renderEventContextBadges(event, "month")}
                                </div>
                              </button>
                              <Link
                                href={annualBoardHref}
                                className="inline-flex w-6 shrink-0 items-center justify-center rounded-md bg-black/10 text-white/90 transition-colors hover:bg-black/20"
                                aria-label={`${event.title} 연간 일정표 바로가기`}
                                title="연간 일정표 바로가기"
                                onPointerDown={(pointerEvent) => {
                                  pointerEvent.stopPropagation()
                                }}
                                onClick={(clickEvent) => {
                                  clickEvent.stopPropagation()
                                }}
                              >
                                <ArrowUpRight className="size-3" />
                              </Link>
                            </div>
                          )
                        })}

                        {hiddenCount > 0 ? (
                          <button
                            type="button"
                            className="rounded px-1 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted"
                            onPointerDown={(pointerEvent) => {
                              pointerEvent.stopPropagation()
                            }}
                            onClick={(clickEvent) => {
                              clickEvent.stopPropagation()
                              openOverflow(day, dayEvents)
                            }}
                          >
                            +{hiddenCount}개
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}

                <div className="pointer-events-none absolute inset-x-0 top-8">
                  {weekSegments.map((segment) => {
                    const { event } = segment
                    const left = `calc((100% / 7) * ${segment.startIndex} + 4px)`
                    const width = `calc((100% / 7) * ${segment.span} - 8px)`
                    const top = `${segment.lane * 26}px`

                    const annualBoardHref = buildAcademicAnnualBoardEventHref(event)

                    return (
                      <div
                        key={`${segment.weekIndex}-${segment.lane}-${event.id}`}
                        className="pointer-events-auto absolute"
                        style={{ left, width, top }}
                      >
                        <button
                          type="button"
                          draggable={!readOnly}
                          className={cn(
                            "flex h-6 w-full items-center gap-1 overflow-hidden rounded-md px-2 pr-8 text-left text-[11px] font-medium text-white shadow-sm transition-all hover:-translate-y-px hover:shadow-md",
                            event.color,
                          )}
                          onPointerDown={(pointerEvent) => {
                            pointerEvent.stopPropagation()
                            const rect = pointerEvent.currentTarget.getBoundingClientRect()
                            const relativeX = Math.max(0, Math.min(pointerEvent.clientX - rect.left, rect.width - 1))
                            const dayOffset = Math.min(segment.span - 1, Math.floor((relativeX / Math.max(rect.width, 1)) * segment.span))
                            pendingDragAnchorDateRef.current = week[segment.startIndex + dayOffset] || week[segment.startIndex]
                          }}
                          onDragStart={(dragEvent) => {
                            if (readOnly) {
                              dragEvent.preventDefault()
                              return
                            }
                            dragEvent.stopPropagation()
                            const anchorDate = pendingDragAnchorDateRef.current || week[segment.startIndex]
                            setDraggedEvent(event)
                            setDragAnchorDate(anchorDate)
                            setDragTargetDate(anchorDate)
                          }}
                          onDragEnd={() => {
                            pendingDragAnchorDateRef.current = null
                            setDraggedEvent(null)
                            setDragAnchorDate(null)
                            setDragTargetDate(null)
                          }}
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation()
                            onEventClick?.(event)
                          }}
                        >
                          {segment.continuesBefore ? <span className="text-white/80">‹</span> : null}
                          {renderExamScopeHover(event, "h-4 px-1 text-[9px]")}
                          <span className="truncate">{event.title}</span>
                          {renderEventContextBadges(event, "month")}
                          {segment.continuesAfter ? <span className="text-white/80">›</span> : null}
                        </button>
                        <Link
                          href={annualBoardHref}
                          className="absolute right-1 top-1/2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded-sm bg-black/15 text-white/90 transition-colors hover:bg-black/25"
                          aria-label={`${event.title} 연간 일정표 바로가기`}
                          title="연간 일정표 바로가기"
                          onPointerDown={(pointerEvent) => {
                            pointerEvent.stopPropagation()
                          }}
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation()
                          }}
                        >
                          <ArrowUpRight className="size-3" />
                        </Link>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const renderListView = () => {
    return (
      <div className="flex-1 p-6">
        <div className="space-y-6">
          {listEventGroups.length === 0 ? (
            <Card>
              <CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 px-6 text-center">
                <Badge variant="outline">일정 없음</Badge>
                <p className="font-medium">현재 조건에 맞는 일정이 없습니다.</p>
              </CardContent>
            </Card>
          ) : (
            listEventGroups.map((group) => (
              <section key={group.date.toISOString()} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{formatAgendaDay(group.date)}</h2>
                    <p className="text-sm text-muted-foreground">{group.events.length}개 일정</p>
                  </div>
                  <Badge variant="outline">목록</Badge>
                </div>

                <div className="space-y-3">
                  {group.events.map((event) => {
                    const annualBoardHref = buildAcademicAnnualBoardEventHref(event, group.date)

                    return (
                    <Card
                      key={event.id}
                      className="cursor-pointer transition-shadow hover:shadow-md"
                      onClick={() => onEventClick?.(event)}
                    >
                      <CardContent className="px-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex flex-1 items-start gap-3">
                            <div className={cn("mt-1.5 size-3 rounded-full", event.color)} />
                            <div className="flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                {renderExamScopeHover(event)}
                                <h3 className="font-medium">{event.title}</h3>
                                {renderEventContextBadges(event, "list")}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <CalendarIcon className="size-4" />
                                  {formatEventRange(event)}
                                </div>
                                {event.schoolName ? (
                                  <div className="flex items-center gap-1">
                                    <School className="size-4" />
                                    {event.schoolName}
                                  </div>
                                ) : null}
                                {event.grade && event.grade !== "all" ? <span>{event.grade}</span> : null}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-start gap-2">
                            <Link
                              href={annualBoardHref}
                              className="inline-flex size-8 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted"
                              aria-label={`${event.title} 연간 일정표에서 보기`}
                              title="연간 일정표에서 보기"
                              onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
                              onClick={(clickEvent) => clickEvent.stopPropagation()}
                            >
                              <ArrowUpRight className="size-3.5" />
                            </Link>
                            <Badge variant="secondary">{getAcademicEventTypeLabel(event.typeLabel || event.type)}</Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    )
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="flex flex-col gap-4 border-b px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="icon" className="cursor-pointer xl:hidden" onClick={onMenuClick}>
              <Menu className="size-4" />
            </Button>

            <div className="flex items-center gap-1 rounded-lg border bg-muted/20 p-1">
              <Button variant="ghost" size="icon" onClick={() => navigateMonth("prev")} className="cursor-pointer rounded-md">
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => navigateMonth("next")} className="cursor-pointer rounded-md">
                <ChevronRight className="size-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={goToToday} className="cursor-pointer rounded-md bg-background">
                오늘
              </Button>
            </div>

            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{format(currentDate, "yyyy년 M월", { locale: ko })}</h1>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="학교명, 일정명, 유형 검색"
                className={cn("w-full pl-10", query ? "pr-16" : "")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query) {
                    event.preventDefault()
                    setQuery("")
                  }
                }}
              />
              {query ? (
                <button
                  type="button"
                  aria-label="학사일정 검색어 지우기"
                  className="absolute right-2 top-1/2 inline-flex h-7 -translate-y-1/2 items-center rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => setQuery("")}
                >
                  지우기
                </button>
              ) : null}
            </div>

            <div className="inline-flex w-fit items-center rounded-lg border bg-muted/20 p-1">
              <Button
                type="button"
                size="sm"
                variant={viewMode === "month" ? "secondary" : "ghost"}
                className="cursor-pointer rounded-md"
                aria-pressed={viewMode === "month"}
                onClick={() => setViewMode("month")}
              >
                <Grid3X3 className="mr-2 size-4" />
                월간
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === "list" ? "secondary" : "ghost"}
                className="cursor-pointer rounded-md"
                aria-pressed={viewMode === "list"}
                onClick={() => setViewMode("list")}
              >
                <List className="mr-2 size-4" />
                목록
              </Button>
            </div>

            <Button variant="outline" asChild className="cursor-pointer">
              <Link
                href={buildAcademicAnnualBoardHref({
                  date: format(currentDate, "yyyy-MM-dd"),
                })}
              >
                연간 일정표
                <ArrowUpRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </div>

        {viewMode === "month" ? renderCalendarGrid() : renderListView()}
      </div>

      <Dialog open={Boolean(overflowDate)} onOpenChange={(open) => !open && setOverflowDate(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <DialogTitle>
                  {overflowDate ? format(overflowDate, "M월 d일 일정", { locale: ko }) : "일정"}
                </DialogTitle>
                {overflowDate ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{format(overflowDate, "EEEE", { locale: ko })}</Badge>
                    <Badge variant="secondary">{overflowEvents.length}개 일정</Badge>
                  </div>
                ) : null}
              </div>
              {!readOnly && overflowDate ? (
                <Button
                  type="button"
                  size="sm"
                  className="cursor-pointer"
                  onClick={() => {
                    onEmptySlotClick?.(overflowDate)
                    setOverflowDate(null)
                  }}
                >
                  <Sparkles className="mr-2 size-4" />
                  이 날 일정 추가
                </Button>
              ) : null}
            </div>
          </DialogHeader>
          <div className="space-y-3">
            {overflowEvents.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                선택한 날짜에 표시할 일정이 없습니다.
              </div>
            ) : null}
            {overflowEvents.map((event) => {
              const annualBoardHref = buildAcademicAnnualBoardEventHref(event, overflowDate || event.date)

              return (
              <div
                key={event.id}
                className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  onClick={() => {
                    setOverflowDate(null)
                    onEventClick?.(event)
                  }}
                >
                  <div className={cn("mt-1 size-3 rounded-full", event.color)} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {renderExamScopeHover(event)}
                      <p className="truncate font-medium">{event.title}</p>
                      <Badge variant="outline">{getAcademicEventTypeLabel(event.typeLabel || event.type)}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{formatEventRange(event)}</span>
                      {event.schoolName ? <span>{event.schoolName}</span> : null}
                      {event.grade && event.grade !== "all" ? <span>{event.grade}</span> : null}
                    </div>
                  </div>
                </button>
                <Link
                  href={annualBoardHref}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted"
                  aria-label={`${event.title} 연간 일정표에서 보기`}
                  title="연간 일정표에서 보기"
                  onPointerDown={(pointerEvent) => {
                    pointerEvent.stopPropagation()
                  }}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation()
                    setOverflowDate(null)
                  }}
                >
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
