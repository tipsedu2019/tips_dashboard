"use client"

import { useEffect, useState } from "react"
import { Check, ChevronRight } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

export interface CalendarItem {
  id: string
  name: string
  color: string
  visible: boolean
  type: "personal" | "work" | "shared"
}

export interface CalendarGroup {
  name: string
  items: CalendarItem[]
}

interface CalendarsProps {
  calendars?: CalendarGroup[]
  onCalendarToggle?: (calendarId: string, visible: boolean) => void
}

export function Calendars({ calendars = [], onCalendarToggle }: CalendarsProps) {
  const [calendarData, setCalendarData] = useState(calendars)

  useEffect(() => {
    setCalendarData(calendars)
  }, [calendars])

  const handleToggleVisibility = (calendarId: string) => {
    setCalendarData((prev) =>
      prev.map((group) => ({
        ...group,
        items: group.items.map((item) =>
          item.id === calendarId ? { ...item, visible: !item.visible } : item,
        ),
      })),
    )

    const calendar = calendarData.flatMap((group) => group.items).find((item) => item.id === calendarId)
    if (calendar) {
      onCalendarToggle?.(calendarId, !calendar.visible)
    }
  }

  return (
    <div className="space-y-4">
      {calendarData.map((calendar) => (
        <div key={calendar.name}>
          <Collapsible defaultOpen className="group/collapsible">
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md p-2 hover:bg-accent hover:text-accent-foreground">
              <span className="text-sm font-medium">{calendar.name}</span>
              <ChevronRight className="size-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="mt-2 space-y-1">
                {calendar.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-accent/50"
                    onClick={() => handleToggleVisibility(item.id)}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-sm border transition-all",
                        item.visible
                          ? cn("border-transparent text-white", item.color)
                          : "border-border bg-transparent",
                      )}
                    >
                      {item.visible ? <Check className="size-3" /> : null}
                    </span>
                    <span className={cn("truncate text-sm", !item.visible && "text-muted-foreground")}>
                      {item.name}
                    </span>
                  </button>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ))}
    </div>
  )
}
