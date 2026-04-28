"use client"

import { isSameDay } from "date-fns"
import { useEffect, useMemo, useRef, useState } from "react"

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
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
}: CalendarProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(() => resolveInitialCalendarDate(eventDates, initialDate))
  const [selectedEndDate, setSelectedEndDate] = useState<Date | null>(null)
  const [showEventForm, setShowEventForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [showCalendarSheet, setShowCalendarSheet] = useState(false)
  const [activeFilters, setActiveFilters] = useState<Record<string, boolean>>({})
  const appliedInitialDateRef = useRef<string>(toCalendarDayKey(initialDate))
  const appliedInitialEventIdRef = useRef<string>("")

  useEffect(() => {
    setActiveFilters((prev) => {
      const nextFilters = Object.fromEntries(
        (calendars || []).flatMap((group) => group.items.map((item) => [item.id, item.visible])),
      )

      if (Object.keys(prev).length === 0) {
        return nextFilters
      }

      return Object.fromEntries(
        Object.entries(nextFilters).map(([key, visible]) => [key, prev[key] ?? visible]),
      )
    })
  }, [calendars])

  const visibleEvents = useMemo(
    () =>
      events.filter((event) => {
        const typeKey = `type:${String(event.typeLabel || "기타")}`
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

  useEffect(() => {
    const nextInitialDayKey = toCalendarDayKey(initialDate)
    if (!nextInitialDayKey || !(initialDate instanceof Date) || Number.isNaN(initialDate.getTime())) {
      return
    }

    const alreadyAppliedSameDay = appliedInitialDateRef.current === nextInitialDayKey
    appliedInitialDateRef.current = nextInitialDayKey

    if (alreadyAppliedSameDay || isSameDay(selectedDate, initialDate)) {
      return
    }

    setSelectedDate(initialDate)
  }, [initialDate])

  useEffect(() => {
    if (!initialEventId || appliedInitialEventIdRef.current === initialEventId) {
      return
    }

    const matchedEvent = events.find(
      (event) => String(event.sourceId || event.id) === initialEventId,
    )
    if (!matchedEvent) {
      return
    }

    appliedInitialEventIdRef.current = initialEventId
    setSelectedDate(matchedEvent.date)
    setEditingEvent(matchedEvent)
    setShowEventForm(true)
  }, [events, initialEventId])

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date)
    setShowCalendarSheet(false)
  }

  const handleNewEvent = (date?: Date) => {
    if (readOnly) {
      return
    }

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

    setShowCalendarSheet(false)
    setSelectedDate(range.start)
    setSelectedEndDate(range.end)
    setEditingEvent(null)
    setShowEventForm(true)
  }

  const handleEditEvent = (event: CalendarEvent) => {
    setEditingEvent(event)
    setShowEventForm(true)
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
    setActiveFilters((prev) => ({ ...prev, [calendarId]: visible }))
  }

  return (
    <>
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
