"use client"

import * as React from "react"
import { CalendarIcon, Clock } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const TIME_OPTION_START_MINUTES = 9 * 60
const TIME_OPTION_END_MINUTES = 23 * 60 + 30
const TIME_OPTION_STEP_MINUTES = 15
const TIME_OPTIONS = Array.from({
  length: Math.floor((TIME_OPTION_END_MINUTES - TIME_OPTION_START_MINUTES) / TIME_OPTION_STEP_MINUTES) + 1,
}, (_, index) => {
  const totalMinutes = TIME_OPTION_START_MINUTES + index * TIME_OPTION_STEP_MINUTES
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
})

function isTimeWithinOptionRange(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match) return false
  const totalMinutes = Number(match[1]) * 60 + Number(match[2])
  return totalMinutes >= TIME_OPTION_START_MINUTES && totalMinutes <= TIME_OPTION_END_MINUTES
}

function toDateKey(value: Date | string | undefined) {
  if (!value) return ""
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, "0")
    const day = String(value.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ""
}

function parseDateKey(value: string) {
  const match = toDateKey(value).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return undefined
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function formatDateLabel(value: string) {
  const match = toDateKey(value).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ""
  return `${match[1]}. ${match[2]}. ${match[3]}.`
}

function normalizeTimeInput(value: string) {
  const raw = value.trim()
  if (!raw) return ""

  const colonMatch = raw.match(/^(\d{1,2}):(\d{1,2})$/)
  if (colonMatch) {
    const hours = Number(colonMatch[1])
    const minutes = Number(colonMatch[2])
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      const normalized = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
      return isTimeWithinOptionRange(normalized) ? normalized : ""
    }
    return ""
  }

  const digits = raw.replace(/\D/g, "")
  if (digits.length === 3 || digits.length === 4) {
    const hourText = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2)
    const minuteText = digits.slice(-2)
    const hours = Number(hourText)
    const minutes = Number(minuteText)
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      const normalized = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
      return isTimeWithinOptionRange(normalized) ? normalized : ""
    }
  }

  return ""
}

function formatTimeLabel(value: string) {
  const normalized = normalizeTimeInput(value)
  if (!normalized) return ""
  const [hourText, minuteText] = normalized.split(":")
  const hour = Number(hourText)
  const meridiem = hour < 12 ? "오전" : "오후"
  const displayHour = hour % 12 || 12
  return `${meridiem} ${String(displayHour).padStart(2, "0")}:${minuteText}`
}

type DatePickerControlProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
}

export function DatePickerControl({
  id,
  value,
  onChange,
  placeholder = "날짜 선택",
  ariaLabel = "날짜 선택",
  className,
}: DatePickerControlProps) {
  const [open, setOpen] = React.useState(false)
  const selectedDate = parseDateKey(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          className={cn("h-9 w-full justify-between px-3 font-normal", !value && "text-muted-foreground", className)}
        >
          <span className="truncate">{formatDateLabel(value) || placeholder}</span>
          <CalendarIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(date) => {
            const nextDate = toDateKey(date)
            if (!nextDate) return
            onChange(nextDate)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

type TimePickerControlProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
}

export function TimePickerControl({
  value,
  onChange,
  placeholder = "시각 선택",
  ariaLabel = "시각 선택",
  className,
}: TimePickerControlProps) {
  const [open, setOpen] = React.useState(false)
  const normalizedValue = normalizeTimeInput(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          className={cn("h-9 w-full justify-between px-3 font-normal", !normalizedValue && "text-muted-foreground", className)}
        >
          <span className="truncate">{formatTimeLabel(normalizedValue) || placeholder}</span>
          <Clock aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[--radix-popover-trigger-width] min-w-44 p-0">
        <div
          className="max-h-52 overscroll-contain overflow-y-auto p-1"
          onWheelCapture={(event) => event.stopPropagation()}
          onTouchMoveCapture={(event) => event.stopPropagation()}
        >
          {TIME_OPTIONS.map((time) => {
            const selected = time === normalizedValue
            return (
              <button
                key={time}
                type="button"
                aria-pressed={selected}
                className={cn(
                  "flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40",
                  selected && "bg-primary text-primary-foreground hover:bg-primary",
                )}
                onClick={() => {
                  onChange(time)
                  setOpen(false)
                }}
              >
                {formatTimeLabel(time)}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
