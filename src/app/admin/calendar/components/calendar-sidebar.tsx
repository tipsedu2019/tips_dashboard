"use client"

import type { CalendarNavigation } from "../types"
import { Calendars, type CalendarGroup } from "./calendars"
import { DatePicker } from "./date-picker"
import { Separator } from "@/components/ui/separator"

interface CalendarSidebarProps {
  navigation?: CalendarNavigation
  selectedDate?: Date
  onDateSelect?: (date: Date) => void
  onCalendarToggle?: (calendarId: string, visible: boolean) => void
  events?: Array<{ date: Date; count: number }>
  calendars?: CalendarGroup[]
  className?: string
}

export function CalendarSidebar({
  navigation,
  selectedDate,
  onDateSelect,
  onCalendarToggle,
  events = [],
  calendars,
  className 
}: CalendarSidebarProps) {
  return (
    <div className={`flex flex-col h-full bg-background rounded-lg ${className}`}>
      <DatePicker
        navigation={navigation}
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
