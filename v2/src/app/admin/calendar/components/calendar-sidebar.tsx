"use client"

import { Calendars, type CalendarGroup } from "./calendars"
import { DatePicker } from "./date-picker"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

interface CalendarSidebarProps {
  selectedDate?: Date
  onDateSelect?: (date: Date) => void
  onNewEvent?: () => void
  onCalendarToggle?: (calendarId: string, visible: boolean) => void
  events?: Array<{ date: Date; count: number }>
  calendars?: CalendarGroup[]
  addButtonLabel?: string
  readOnly?: boolean
  className?: string
}

export function CalendarSidebar({ 
  selectedDate,
  onDateSelect,
  onNewEvent,
  onCalendarToggle,
  events = [],
  calendars,
  addButtonLabel = "새 일정 추가",
  readOnly = false,
  className 
}: CalendarSidebarProps) {
  return (
    <div className={`flex flex-col h-full bg-background rounded-lg ${className}`}>
      {!readOnly ? (
        <div className="border-b p-6">
          <Button className="w-full cursor-pointer" onClick={onNewEvent}>
            {addButtonLabel}
          </Button>
        </div>
      ) : null}

      <DatePicker
        selectedDate={selectedDate}
        onDateSelect={onDateSelect}
        events={events}
      />

      <Separator />


      {/* Calendars */}
      <div className="flex-1 p-4">
        <Calendars 
          calendars={calendars}
          onCalendarToggle={onCalendarToggle}
        />
      </div>
    </div>
  )
}
