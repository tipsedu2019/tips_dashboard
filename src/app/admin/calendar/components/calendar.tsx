"use client"

import { eachDayOfInterval, format, isSameDay, isSameMonth } from "date-fns"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  getAcademicEventFilterTypeKey,
  isCurrentAcademicDetailRequest,
} from "@/features/operations/academic-event-utils.js"
import { CalendarMain } from "./calendar-main"
import { CalendarSidebar } from "./calendar-sidebar"
import { EventForm } from "./event-form"
import { type CalendarEvent, type CalendarNavigation } from "../types"
import { type CalendarGroup } from "./calendars"

interface SchoolOption {
  id: string
  name: string
  category?: string
}

interface CalendarProps {
  navigation?: CalendarNavigation
  readState?: "loading" | "error"
  recoveryRange?: { dateFrom: string; dateTo: string }
  onRecoveryExit?: () => void
  events: CalendarEvent[]
  eventDates: Array<{ date: Date; count: number }>
  readOnly?: boolean
  schoolOptions?: SchoolOption[]
  typeOptions?: string[]
  calendars?: CalendarGroup[]
  addButtonLabel?: string
  initialDate?: Date
  initialEventId?: string
  initialQuery?: string
  onSaveEvent?: (eventData: Partial<CalendarEvent>) => boolean | Promise<boolean>
  onDeleteEvent?: (eventId: number | string) => boolean | Promise<boolean>
  onMoveEvent?: (eventData: Partial<CalendarEvent>) => boolean | Promise<boolean>
  onVisibleRangeChange?: (range: { start: Date; end: Date }) => void
  onLoadEventDetail?: (eventId: string) => Promise<CalendarEvent | null>
}

type CalendarFormOpener = { element: HTMLElement; href: string }

function captureCalendarFormOpener(): CalendarFormOpener | null {
  const element = document.activeElement
  return element instanceof HTMLElement && element !== document.body && element !== document.documentElement
    ? { element, href: window.location.href }
    : null
}

function toCalendarDayKey(date?: Date | null) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return ""
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function resolveInitialCalendarDate(
  eventDates: Array<{ date: Date; count: number }>,
  initialDate?: Date,
) {
  if (initialDate instanceof Date && !Number.isNaN(initialDate.getTime())) {
    return initialDate
  }
  const today = new Date()
  const normalizedDates = eventDates
    .map((entry) => entry?.date)
    .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())

  if (normalizedDates.length === 0) {
    return today
  }

  const sameMonth = normalizedDates.find(
    (date) =>
      date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth(),
  )

  if (sameMonth) {
    return sameMonth
  }

  return normalizedDates.find((date) => date.getTime() >= today.getTime()) || normalizedDates[0]
}

function buildDefaultCalendarFilters(calendars?: CalendarGroup[]) {
  return Object.fromEntries(
    (calendars || []).flatMap((group) => group.items.map((item) => [item.id, item.visible])),
  )
}

export function Calendar({
  navigation,
  recoveryRange,
  readState,
  onRecoveryExit,
  events,
  eventDates,
  readOnly = false,
  schoolOptions = [],
  typeOptions = [],
  calendars,
  addButtonLabel = "새 일정 추가",
  initialDate,
  initialEventId,
  initialQuery,
  onSaveEvent,
  onDeleteEvent,
  onMoveEvent,
  onVisibleRangeChange,
  onLoadEventDetail,
}: CalendarProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(() => resolveInitialCalendarDate(eventDates, initialDate))
  const [selectedEndDate, setSelectedEndDate] = useState<Date | null>(null)
  const [showEventForm, setShowEventForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [showCalendarSheet, setShowCalendarSheet] = useState(false)
  const [filterOverrides, setFilterOverrides] = useState<Record<string, boolean>>({})
  const [appliedInitialDateKey, setAppliedInitialDateKey] = useState(() => toCalendarDayKey(initialDate))
  const [appliedInitialEventId, setAppliedInitialEventId] = useState("")
  const [pendingDetailEvent, setPendingDetailEvent] = useState<CalendarEvent | null>(null)
  const [detailLoadError, setDetailLoadError] = useState("")
  const [detailLoading, setDetailLoading] = useState(false)
  const pendingDetailOpenerRef = useRef<CalendarFormOpener | null>(null)
  const formOpenerRef = useRef<CalendarFormOpener | null>(null)
  const displayedDate = navigation?.displayedDate
  const visibleSelectedDate = displayedDate && !isSameMonth(selectedDate, displayedDate) ? displayedDate : selectedDate

  useEffect(() => {
    if (displayedDate) setSelectedDate((current) => isSameMonth(current, displayedDate) ? current : displayedDate)
  }, [displayedDate])

  const detailRequestRevisionRef = useRef(0)
  const detailRequestIdentityRef = useRef("")

  const invalidateDetailRequest = useCallback(() => {
    detailRequestRevisionRef.current += 1
    detailRequestIdentityRef.current = ""
    pendingDetailOpenerRef.current = null
    setPendingDetailEvent(null)
    setDetailLoadError("")
    setDetailLoading(false)
  }, [])

  const navigateToDate = navigation?.onDateChange
  const handleNavigationDateChange = useCallback((date: Date) => {
    invalidateDetailRequest()
    navigateToDate?.(date)
  }, [invalidateDetailRequest, navigateToDate])
  const controlledNavigation = navigation ? { ...navigation, onDateChange: handleNavigationDateChange } : undefined

  const defaultFilters = useMemo(() => buildDefaultCalendarFilters(calendars), [calendars])
  const activeFilters = useMemo(
    () => ({ ...defaultFilters, ...filterOverrides }),
    [defaultFilters, filterOverrides],
  )

  const visibleEvents = useMemo(
    () =>
      events.filter((event) => {
        const typeKey = getAcademicEventFilterTypeKey(event.typeLabel || "기타")
        const categoryKey = `category:${String(event.category || "all")}`
        const typeVisible = activeFilters[typeKey] ?? true
        const categoryVisible = activeFilters[categoryKey] ?? true
        return typeVisible && categoryVisible
      }),
    [activeFilters, events],
  )
  const visibleEventDates = useMemo(() => {
    const counts = new Map<string, { date: Date; count: number }>()
    visibleEvents.forEach((event) => {
      const start = new Date(event.date)
      const end = new Date(event.endDate || event.date)
      const cursor = new Date(start)
      while (cursor.getTime() <= end.getTime()) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`
        const existing = counts.get(key)
        if (existing) {
          existing.count += 1
        } else {
          counts.set(key, { date: new Date(cursor), count: 1 })
        }
        cursor.setDate(cursor.getDate() + 1)
      }
    })
    return [...counts.values()].sort((left, right) => left.date.getTime() - right.date.getTime())
  }, [visibleEvents])

  const nextInitialDateKey = toCalendarDayKey(initialDate)
  useEffect(() => {
    if (appliedInitialDateKey === nextInitialDateKey) return
    invalidateDetailRequest()
    setAppliedInitialDateKey(nextInitialDateKey)
    if (
      nextInitialDateKey &&
      initialDate instanceof Date &&
      !Number.isNaN(initialDate.getTime())
    ) {
      setSelectedDate((current) => isSameDay(current, initialDate) ? current : initialDate)
    }
  }, [appliedInitialDateKey, initialDate, invalidateDetailRequest, nextInitialDateKey])

  const matchedInitialEvent = useMemo(() => {
    if (!initialEventId || appliedInitialEventId === initialEventId) {
      return null
    }

    return events.find((event) => String(event.sourceId || event.id) === initialEventId) || null
  }, [appliedInitialEventId, events, initialEventId])

  const openExactEventDetail = useCallback(async (event: CalendarEvent) => {
    const eventId = String(event.sourceId || event.id)
    const expectedRevision = detailRequestRevisionRef.current + 1
    const expectedIdentity = eventId
    detailRequestRevisionRef.current = expectedRevision
    detailRequestIdentityRef.current = expectedIdentity
    const isCurrentDetailRequest = () => isCurrentAcademicDetailRequest({
      expectedRevision,
      currentRevision: detailRequestRevisionRef.current,
      expectedIdentity,
      currentIdentity: detailRequestIdentityRef.current,
    })
    setPendingDetailEvent(event)
    setDetailLoadError("")
    setDetailLoading(true)
    try {
      if (!onLoadEventDetail || !eventId) {
        throw new Error("operations_event_detail_unavailable")
      }
      const detail = await onLoadEventDetail(eventId)
      if (!isCurrentDetailRequest()) return false
      if (!detail) {
        throw new Error("operations_event_detail_invalid")
      }
      formOpenerRef.current = pendingDetailOpenerRef.current
      setEditingEvent(detail)
      setShowEventForm(true)
      setPendingDetailEvent(null)
      return true
    } catch {
      if (!isCurrentDetailRequest()) return false
      setEditingEvent(null)
      setShowEventForm(false)
      setDetailLoadError("학사 일정 상세 정보를 불러오지 못했습니다.")
      return false
    } finally {
      if (isCurrentDetailRequest()) {
        setDetailLoading(false)
      }
    }
  }, [onLoadEventDetail])

  useEffect(() => {
    invalidateDetailRequest()
    if (!initialEventId) {
      setAppliedInitialEventId("")
      return undefined
    }
    if (!matchedInitialEvent) return undefined
    let cancelled = false
    void openExactEventDetail(matchedInitialEvent).then((opened) => {
        if (cancelled || !opened) return
        setAppliedInitialEventId(initialEventId)
        setSelectedDate((current) => isSameDay(current, matchedInitialEvent.date) ? current : matchedInitialEvent.date)
      })
    return () => {
      cancelled = true
      invalidateDetailRequest()
    }
  }, [initialEventId, invalidateDetailRequest, matchedInitialEvent, openExactEventDetail])

  const retryPendingDetailLoad = async () => {
    if (!pendingDetailEvent) return
    const opened = await openExactEventDetail(pendingDetailEvent)
    if (opened && initialEventId === String(pendingDetailEvent.sourceId || pendingDetailEvent.id)) {
      setAppliedInitialEventId(initialEventId)
      setSelectedDate(pendingDetailEvent.date)
    }
  }

  const handleDateSelect = (date: Date) => {
    invalidateDetailRequest()
    if (navigation) navigation.onDateChange(date)
    if (!navigation || isSameMonth(date, navigation.displayedDate)) setSelectedDate(date)
    setShowCalendarSheet(false)
  }

  const handleNewEvent = (date?: Date) => {
    if (readOnly) {
      return
    }

    invalidateDetailRequest()
    formOpenerRef.current = captureCalendarFormOpener()
    setShowCalendarSheet(false)

    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      setSelectedDate(date)
      setSelectedEndDate(date)
    } else {
      setSelectedEndDate(null)
    }
    setEditingEvent(null)
    setShowEventForm(true)
  }

  const handleNewEventRange = (range: { start: Date; end: Date }) => {
    if (readOnly) {
      return
    }

    invalidateDetailRequest()
    formOpenerRef.current = captureCalendarFormOpener()
    setShowCalendarSheet(false)
    setSelectedDate(range.start)
    setSelectedEndDate(range.end)
    setEditingEvent(null)
    setShowEventForm(true)
  }

  const handleEditEvent = (event: CalendarEvent) => {
    pendingDetailOpenerRef.current = captureCalendarFormOpener()
    void openExactEventDetail(event)
  }

  const handleSaveEvent = async (eventData: Partial<CalendarEvent>) => {
    const saved = await onSaveEvent?.(eventData)
    if (saved === false) {
      return false
    }
    return true
  }

  const handleDeleteEvent = async (eventId: number | string) => {
    const deleted = await onDeleteEvent?.(eventId)
    if (deleted === false) {
      return false
    }
    return true
  }

  const handleCalendarToggle = (calendarId: string, visible: boolean) => {
    invalidateDetailRequest()
    setFilterOverrides((prev) => ({ ...prev, [calendarId]: visible }))
  }

  const handleVisibleRangeChange = useCallback((range: { start: Date; end: Date }) => {
    invalidateDetailRequest()
    onVisibleRangeChange?.(range)
  }, [invalidateDetailRequest, onVisibleRangeChange])

  const recoveryKey = `${recoveryRange?.dateFrom || ""}:${recoveryRange?.dateTo || ""}`
  const previousRecoveryKey = useRef(recoveryKey)
  useEffect(() => {
    if (previousRecoveryKey.current === recoveryKey) return
    previousRecoveryKey.current = recoveryKey
    invalidateDetailRequest()
  }, [recoveryKey, invalidateDetailRequest])

  return (
    <>
      {detailLoadError ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{detailLoadError}</span>
            <Button type="button" variant="outline" size="sm" disabled={detailLoading} onClick={retryPendingDetailLoad}>
              상세 다시 불러오기
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {recoveryRange ? (
        <section data-testid="operations-seven-day-agenda" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">한 주 일정 <span className="text-sm font-normal">{recoveryRange.dateFrom} ~ {recoveryRange.dateTo}</span></h2>
            <Button type="button" variant="outline" size="sm" onClick={onRecoveryExit}>월간 보기</Button>
          </div>
          <div className="grid gap-3 lg:grid-cols-7">
            {eachDayOfInterval({ start: new Date(`${recoveryRange.dateFrom}T12:00:00`), end: new Date(`${recoveryRange.dateTo}T12:00:00`) }).map((day) => {
              const dateKey = format(day, "yyyy-MM-dd")
              const dayEvents = visibleEvents.filter(event => toCalendarDayKey(event.date) <= dateKey && toCalendarDayKey(event.endDate || event.date) >= dateKey)
              return <article key={dateKey} className="min-h-32 rounded-[var(--radius-surface)] border bg-background p-3">
                <h3 className="text-sm font-medium">{dateKey}</h3>
                <div className="mt-3 space-y-2">
                  {dayEvents.length === 0 ? <p className="text-xs text-muted-foreground">일정 없음</p> : null}
                  {dayEvents.map(event => <Button key={event.id} type="button" variant="ghost" className="h-auto min-h-11 w-full flex-col items-start whitespace-normal px-2 py-2 text-left" onClick={() => void handleEditEvent(event)}>
                    <span className="break-words">{event.title}</span>
                    {event.schoolName ? <span className="text-xs font-normal text-muted-foreground">{event.schoolName}</span> : null}
                  </Button>)}
                </div>
              </article>
            })}
          </div>
        </section>
      ) : <div className="relative rounded-[var(--radius-surface)] border bg-background">
        <div className="flex min-h-[640px]">
          <div className="hidden w-64 shrink-0 border-r xl:block">
            <CalendarSidebar
              navigation={controlledNavigation}
              selectedDate={visibleSelectedDate}
              onDateSelect={handleDateSelect}
              onCalendarToggle={handleCalendarToggle}
              events={visibleEventDates}
              calendars={calendars}
              className="h-full"
            />
          </div>

          <div className="min-w-0 flex-1">
            <CalendarMain
              readState={readState}
              onNewEvent={() => handleNewEvent()}
              addButtonLabel={addButtonLabel}
              navigation={controlledNavigation}
              selectedDate={visibleSelectedDate}
              onDateSelect={handleDateSelect}
              onMenuClick={() => setShowCalendarSheet(true)}
              events={visibleEvents}
              initialQuery={initialQuery}
              readOnly={readOnly}
              onEventClick={handleEditEvent}
              onEmptySlotClick={handleNewEvent}
              onRangeSelect={handleNewEventRange}
              onVisibleRangeChange={handleVisibleRangeChange}
              onOverflowClick={(date) => {
                invalidateDetailRequest()
                setSelectedDate(date)
              }}
              onEventDrop={readOnly ? undefined : async (_, nextEvent) => {
                const moved = await onMoveEvent?.(nextEvent)
                if (moved !== false) {
                  invalidateDetailRequest()
                  setSelectedDate(nextEvent.date)
                  navigation?.onDateChange(nextEvent.date)
                }
                return moved
              }}
            />
          </div>
        </div>

        <Sheet open={showCalendarSheet} onOpenChange={setShowCalendarSheet}>
          <SheetContent side="left" className="w-80 p-0" style={{ position: "absolute" }}>
            <SheetHeader className="p-4 pb-2">
              <SheetTitle>학사일정 캘린더</SheetTitle>
            </SheetHeader>
            <CalendarSidebar
              navigation={controlledNavigation}
              selectedDate={visibleSelectedDate}
              onDateSelect={handleDateSelect}
              onCalendarToggle={handleCalendarToggle}
              events={visibleEventDates}
              calendars={calendars}
              className="h-full"
            />
          </SheetContent>
        </Sheet>
      </div>}

      <EventForm
        onCloseAutoFocus={(event) => {
          const opener = formOpenerRef.current
          formOpenerRef.current = null
          if (!opener || opener.href !== window.location.href) return
          const element = opener.element
          if (!element.isConnected || element.matches(":disabled") ||
            element.closest('[hidden], [inert], [aria-disabled="true"]') ||
            element.getClientRects().length === 0) return
          const style = window.getComputedStyle(element)
          if (style.visibility === "hidden" || style.visibility === "collapse" || style.display === "none") return
          event.preventDefault()
          element.focus()
        }}
        event={editingEvent}
        open={showEventForm}
        readOnly={readOnly}
        schoolOptions={schoolOptions}
        typeOptions={typeOptions}
        defaultDate={selectedDate}
        defaultEndDate={selectedEndDate || selectedDate}
        onOpenChange={(open) => {
          setShowEventForm(open)
          if (!open) setEditingEvent(null)
        }}
        onSave={handleSaveEvent}
        onDelete={readOnly ? undefined : handleDeleteEvent}
      />
    </>
  )
}
