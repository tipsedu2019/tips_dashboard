"use client"

import { isSameDay } from "date-fns"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { getAcademicEventFilterTypeKey } from "@/features/operations/academic-event-utils.js"
import { CalendarMain } from "./calendar-main"
import { CalendarSidebar } from "./calendar-sidebar"
import { EventForm } from "./event-form"
import { type CalendarEvent } from "../types"
import { type CalendarGroup } from "./calendars"

interface SchoolOption {
  id: string
  name: string
  category?: string
}

interface CalendarProps {
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
  if (
    nextInitialDateKey &&
    initialDate instanceof Date &&
    !Number.isNaN(initialDate.getTime()) &&
    appliedInitialDateKey !== nextInitialDateKey
  ) {
    setAppliedInitialDateKey(nextInitialDateKey)
    if (!isSameDay(selectedDate, initialDate)) {
      setSelectedDate(initialDate)
    }
  }

  const matchedInitialEvent = useMemo(() => {
    if (!initialEventId || appliedInitialEventId === initialEventId) {
      return null
    }

    return events.find((event) => String(event.sourceId || event.id) === initialEventId) || null
  }, [appliedInitialEventId, events, initialEventId])

  const openExactEventDetail = useCallback(async (event: CalendarEvent) => {
    const eventId = String(event.sourceId || event.id)
    setPendingDetailEvent(event)
    setDetailLoadError("")
    setDetailLoading(true)
    try {
      if (!onLoadEventDetail || !eventId) {
        throw new Error("operations_event_detail_unavailable")
      }
      const detail = await onLoadEventDetail(eventId)
      if (!detail) {
        throw new Error("operations_event_detail_invalid")
      }
      setEditingEvent(detail)
      setShowEventForm(true)
      setPendingDetailEvent(null)
      return true
    } catch {
      setEditingEvent(null)
      setShowEventForm(false)
      setDetailLoadError("학사 일정 상세 정보를 불러오지 못했습니다.")
      return false
    } finally {
      setDetailLoading(false)
    }
  }, [onLoadEventDetail])

  useEffect(() => {
    if (!initialEventId || !matchedInitialEvent) return undefined
    let cancelled = false
    void openExactEventDetail(matchedInitialEvent).then((opened) => {
        if (cancelled || !opened) return
        setAppliedInitialEventId(initialEventId)
        if (!isSameDay(selectedDate, matchedInitialEvent.date)) {
          setSelectedDate(matchedInitialEvent.date)
        }
      })
    return () => {
      cancelled = true
    }
  }, [initialEventId, matchedInitialEvent, openExactEventDetail, selectedDate])

  const retryPendingDetailLoad = async () => {
    if (!pendingDetailEvent) return
    const opened = await openExactEventDetail(pendingDetailEvent)
    if (opened && initialEventId === String(pendingDetailEvent.sourceId || pendingDetailEvent.id)) {
      setAppliedInitialEventId(initialEventId)
      setSelectedDate(pendingDetailEvent.date)
    }
  }

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date)
    setShowCalendarSheet(false)
    setPendingDetailEvent(null)
    setDetailLoadError("")
  }

  const handleNewEvent = (date?: Date) => {
    if (readOnly) {
      return
    }

    setShowCalendarSheet(false)
    setPendingDetailEvent(null)
    setDetailLoadError("")

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

    setShowCalendarSheet(false)
    setSelectedDate(range.start)
    setSelectedEndDate(range.end)
    setEditingEvent(null)
    setShowEventForm(true)
  }

  const handleEditEvent = (event: CalendarEvent) => {
    void openExactEventDetail(event)
  }

  const handleSaveEvent = async (eventData: Partial<CalendarEvent>) => {
    const saved = await onSaveEvent?.(eventData)
    if (saved === false) {
      return false
    }
    setShowEventForm(false)
    setEditingEvent(null)
    return true
  }

  const handleDeleteEvent = async (eventId: number | string) => {
    const deleted = await onDeleteEvent?.(eventId)
    if (deleted === false) {
      return false
    }
    setShowEventForm(false)
    setEditingEvent(null)
    return true
  }

  const handleCalendarToggle = (calendarId: string, visible: boolean) => {
    setFilterOverrides((prev) => ({ ...prev, [calendarId]: visible }))
  }

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
      <div className="relative rounded-lg border bg-background">
        <div className="flex min-h-[800px]">
          <div className="hidden w-80 shrink-0 border-r xl:block">
            <CalendarSidebar
              selectedDate={selectedDate}
              onDateSelect={handleDateSelect}
              onNewEvent={handleNewEvent}
              onCalendarToggle={handleCalendarToggle}
              events={visibleEventDates}
              calendars={calendars}
              addButtonLabel={addButtonLabel}
              readOnly={readOnly}
              className="h-full"
            />
          </div>

          <div className="min-w-0 flex-1">
            <CalendarMain
              selectedDate={selectedDate}
              onDateSelect={handleDateSelect}
              onMenuClick={() => setShowCalendarSheet(true)}
              events={visibleEvents}
              initialQuery={initialQuery}
              readOnly={readOnly}
              onEventClick={handleEditEvent}
              onEmptySlotClick={handleNewEvent}
              onRangeSelect={handleNewEventRange}
              onVisibleRangeChange={onVisibleRangeChange}
              onOverflowClick={(date) => {
                setSelectedDate(date)
              }}
              onEventDrop={readOnly ? undefined : async (_, nextEvent) => {
                const moved = await onMoveEvent?.(nextEvent)
                if (moved !== false) {
                  setSelectedDate(nextEvent.date)
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
              selectedDate={selectedDate}
              onDateSelect={handleDateSelect}
              onNewEvent={handleNewEvent}
              onCalendarToggle={handleCalendarToggle}
              events={visibleEventDates}
              calendars={calendars}
              addButtonLabel={addButtonLabel}
              readOnly={readOnly}
              className="h-full"
            />
          </SheetContent>
        </Sheet>
      </div>

      <EventForm
        event={editingEvent}
        open={showEventForm}
        readOnly={readOnly}
        schoolOptions={schoolOptions}
        typeOptions={typeOptions}
        defaultDate={selectedDate}
        defaultEndDate={selectedEndDate || selectedDate}
        onOpenChange={setShowEventForm}
        onSave={handleSaveEvent}
        onDelete={readOnly ? undefined : handleDeleteEvent}
      />
    </>
  )
}
