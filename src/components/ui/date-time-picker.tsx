"use client"

import * as React from "react"
import { CalendarIcon, Clock, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const TIME_OPTION_START_MINUTES = 9 * 60
const TIME_OPTION_END_MINUTES = 23 * 60 + 30
const TIME_OPTION_STEP_MINUTES = 10
const FULL_DAY_TIME_OPTION_END_MINUTES = 24 * 60 - TIME_OPTION_STEP_MINUTES
const TIME_OPTIONS = Array.from({
  length: Math.floor((TIME_OPTION_END_MINUTES - TIME_OPTION_START_MINUTES) / TIME_OPTION_STEP_MINUTES) + 1,
}, (_, index) => {
  const totalMinutes = TIME_OPTION_START_MINUTES + index * TIME_OPTION_STEP_MINUTES
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
})
const FULL_DAY_TIME_OPTIONS = Array.from({
  length: Math.floor(FULL_DAY_TIME_OPTION_END_MINUTES / TIME_OPTION_STEP_MINUTES) + 1,
}, (_, index) => {
  const totalMinutes = index * TIME_OPTION_STEP_MINUTES
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
})

function normalizeTimeInput(value: string) {
  const raw = value.trim()
  if (!raw) return ""

  const colonMatch = raw.match(/^(\d{1,2}):(\d{1,2})$/)
  if (colonMatch) {
    const hours = Number(colonMatch[1])
    const minutes = Number(colonMatch[2])
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
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
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
    }
  }

  return ""
}

function getTimePickerOptions(options: string[], value: string) {
  const normalizedOptions = Array.from(new Set(options.map(normalizeTimeInput).filter(Boolean)))
  const normalizedValue = normalizeTimeInput(value)
  if (normalizedValue && !normalizedOptions.includes(normalizedValue)) normalizedOptions.push(normalizedValue)
  return normalizedOptions.sort()
}

function splitLocalDateTime(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/)
  if (!match) return { date: "", time: "" }
  const time = normalizeTimeInput(match[2])
  if (!time) return { date: "", time: "" }
  return { date: match[1], time }
}

function mergeLocalDateTime(dateValue: string, timeValue: string) {
  const date = toDateKey(dateValue)
  const time = normalizeTimeInput(timeValue)
  return date && time ? `${date}T${time}` : ""
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

function formatTimeLabel(value: string) {
  const normalized = normalizeTimeInput(value)
  if (!normalized) return ""
  const [hourText, minuteText] = normalized.split(":")
  const hour = Number(hourText)
  const meridiem = hour < 12 ? "오전" : "오후"
  const displayHour = hour % 12 || 12
  return `${meridiem} ${String(displayHour).padStart(2, "0")}:${minuteText}`
}

function getPickerAccessibleLabel(label: string, selectedLabel: string) {
  return selectedLabel ? `${label}: ${selectedLabel}` : label
}

function getNextTimeOptionIndex(key: string, currentIndex: number, optionCount: number) {
  if (optionCount <= 0) return -1
  if (key === "ArrowDown") return (currentIndex + 1) % optionCount
  if (key === "ArrowUp") return (currentIndex - 1 + optionCount) % optionCount
  if (key === "Home") return 0
  if (key === "End") return optionCount - 1
  return -1
}

type DatePickerControlProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  ariaDescribedBy?: string
  className?: string
  disabled?: boolean
  linkedDates?: Array<{ value: string; label?: string }>
  linkedDatesLabel?: string
  restrictToLinkedDates?: boolean
  disablePortal?: boolean
}

export function DatePickerControl({
  id,
  value,
  onChange,
  placeholder = "날짜 선택",
  ariaLabel = "날짜 선택",
  ariaDescribedBy,
  className,
  disabled = false,
  linkedDates = [],
  linkedDatesLabel = "선택 가능 날짜",
  restrictToLinkedDates = false,
  disablePortal = false,
}: DatePickerControlProps) {
  const [open, setOpen] = React.useState(false)
  const selectedDate = parseDateKey(value)
  const selectedDateLabel = formatDateLabel(value)
  const normalizedLinkedDates = React.useMemo(() => (
    linkedDates
      .map((item) => ({ value: toDateKey(item.value), label: item.label || toDateKey(item.value) }))
      .filter((item) => item.value)
  ), [linkedDates])
  const linkedDateSet = React.useMemo(() => new Set(normalizedLinkedDates.map((item) => item.value)), [normalizedLinkedDates])

  function handleDateSelect(nextDate: string) {
    if (!nextDate) return
    if (restrictToLinkedDates && linkedDateSet.size > 0 && !linkedDateSet.has(nextDate)) return
    onChange(nextDate)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={(nextOpen) => setOpen(disabled ? false : nextOpen)}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={getPickerAccessibleLabel(ariaLabel, selectedDateLabel)}
          aria-describedby={ariaDescribedBy}
          className={cn(
            "h-9 w-full justify-between px-3 font-normal",
            !value && "text-muted-foreground",
            disabled && "cursor-not-allowed bg-muted/30 opacity-75",
            className,
          )}
        >
          <span className="truncate">{selectedDateLabel || placeholder}</span>
          <CalendarIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} disablePortal={disablePortal} className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selectedDate}
          disabled={restrictToLinkedDates && linkedDateSet.size > 0 ? (date) => !linkedDateSet.has(toDateKey(date)) : undefined}
          onSelect={(date) => {
            const nextDate = toDateKey(date)
            handleDateSelect(nextDate)
          }}
        />
        {normalizedLinkedDates.length > 0 ? (
          <div className="grid gap-1.5 border-t bg-muted/30 px-2.5 py-2">
            <span className="text-xs font-semibold text-muted-foreground">{linkedDatesLabel}</span>
            <div className="flex max-w-72 flex-wrap gap-1">
              {normalizedLinkedDates.slice(0, 18).map((item) => (
                <button
                  key={`${item.value}-${item.label}`}
                  type="button"
                  onClick={() => handleDateSelect(item.value)}
                  className={cn(
                    "rounded border px-2 py-1 text-xs font-semibold transition",
                    item.value === toDateKey(value)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-primary/25 bg-background text-primary hover:bg-primary/10",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

type TimePickerControlProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  ariaDescribedBy?: string
  className?: string
  disabled?: boolean
  options?: string[]
  disablePortal?: boolean
  showIcon?: boolean
}

function scrollTimeOptionWithinList(
  list: HTMLDivElement | null,
  option: HTMLButtonElement | null,
  align: "center" | "nearest",
) {
  if (!list || !option) return

  const listRect = list.getBoundingClientRect()
  const optionRect = option.getBoundingClientRect()

  if (align === "center") {
    const optionTop = optionRect.top - listRect.top + list.scrollTop
    list.scrollTop = Math.max(0, optionTop - ((list.clientHeight - optionRect.height) / 2))
    return
  }

  if (optionRect.top < listRect.top) {
    list.scrollTop -= listRect.top - optionRect.top
  } else if (optionRect.bottom > listRect.bottom) {
    list.scrollTop += optionRect.bottom - listRect.bottom
  }
}

export function TimePickerControl({
  value,
  onChange,
  placeholder = "시각 선택",
  ariaLabel = "시각 선택",
  ariaDescribedBy,
  className,
  disabled = false,
  options = TIME_OPTIONS,
  disablePortal = false,
  showIcon = true,
}: TimePickerControlProps) {
  const normalizedValue = normalizeTimeInput(value)
  const selectedTimeLabel = formatTimeLabel(normalizedValue)
  const timeOptions = getTimePickerOptions(options, normalizedValue)
  const [open, setOpen] = React.useState(false)
  const [activeTime, setActiveTime] = React.useState(() => normalizedValue || timeOptions[0] || "")
  const selectedOptionRef = React.useRef<HTMLButtonElement>(null)
  const timeOptionRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const timeListRef = React.useRef<HTMLDivElement>(null)

  function handleOpenChange(nextOpen: boolean) {
    const resolvedOpen = disabled ? false : nextOpen
    if (resolvedOpen) setActiveTime(normalizedValue || timeOptions[0] || "")
    setOpen(resolvedOpen)
  }

  function handleTimeOptionKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextIndex = getNextTimeOptionIndex(event.key, index, timeOptions.length)
    if (nextIndex < 0) return
    event.preventDefault()
    const nextTime = timeOptions[nextIndex]
    setActiveTime(nextTime)
    const nextOption = timeOptionRefs.current[nextIndex]
    nextOption?.focus({ preventScroll: true })
    scrollTimeOptionWithinList(timeListRef.current, nextOption, "nearest")
  }

  React.useEffect(() => {
    if (!open) return
    const animationFrame = window.requestAnimationFrame(() => {
      selectedOptionRef.current?.focus({ preventScroll: true })
      scrollTimeOptionWithinList(timeListRef.current, selectedOptionRef.current, "center")
    })
    return () => window.cancelAnimationFrame(animationFrame)
  }, [open])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={getPickerAccessibleLabel(ariaLabel, selectedTimeLabel)}
          aria-describedby={ariaDescribedBy}
          className={cn(
            "h-9 w-full justify-between px-3 font-normal",
            !normalizedValue && "text-muted-foreground",
            disabled && "cursor-not-allowed bg-muted/30 opacity-75",
            className,
          )}
        >
          <span className="truncate">{selectedTimeLabel || placeholder}</span>
          {showIcon ? <Clock aria-hidden="true" /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} disablePortal={disablePortal} className="w-[--radix-popover-trigger-width] min-w-44 p-0">
        <div
          ref={timeListRef}
          role="listbox"
          aria-label={ariaLabel}
          className="max-h-52 overscroll-contain overflow-y-auto p-1"
          onWheelCapture={(event) => event.stopPropagation()}
          onTouchMoveCapture={(event) => event.stopPropagation()}
        >
          {timeOptions.map((time, index) => {
            const selected = time === normalizedValue
            return (
              <button
                key={time}
                ref={(node) => {
                  timeOptionRefs.current[index] = node
                  if (time === activeTime) selectedOptionRef.current = node
                }}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={time === activeTime ? 0 : -1}
                className={cn(
                  "flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40",
                  selected && "bg-primary text-primary-foreground hover:bg-primary",
                )}
                onClick={() => {
                  onChange(time)
                  setOpen(false)
                }}
                onFocus={() => setActiveTime(time)}
                onKeyDown={(event) => handleTimeOptionKeyDown(event, index)}
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

type DateTimePickerControlProps = {
  value: string
  onChange: (value: string) => void
  dateAriaLabel?: string
  timeAriaLabel?: string
  clearAriaLabel?: string
  datePlaceholder?: string
  timePlaceholder?: string
  disabled?: boolean
  required?: boolean
  className?: string
  disablePortal?: boolean
  timeOptions?: string[]
}

export function DateTimePickerControl({
  value,
  onChange,
  dateAriaLabel = "날짜 선택",
  timeAriaLabel = "시각 선택",
  clearAriaLabel = "날짜와 시각 지우기",
  datePlaceholder = "날짜 선택",
  timePlaceholder = "시각 선택",
  disabled = false,
  required = false,
  className,
  disablePortal = false,
  timeOptions = FULL_DAY_TIME_OPTIONS,
}: DateTimePickerControlProps) {
  const requiredDescriptionId = React.useId()
  const [dateDraft, setDateDraft] = React.useState(() => splitLocalDateTime(value).date)
  const [timeDraft, setTimeDraft] = React.useState(() => splitLocalDateTime(value).time)

  React.useEffect(() => {
    const nextDraft = splitLocalDateTime(value)
    setDateDraft(nextDraft.date)
    setTimeDraft(nextDraft.time)
  }, [value])

  function commitIfComplete(nextDate: string, nextTime: string) {
    const nextValue = mergeLocalDateTime(nextDate, nextTime)
    if (nextValue) onChange(nextValue)
  }

  function handleDateChange(nextDate: string) {
    setDateDraft(nextDate)
    commitIfComplete(nextDate, timeDraft)
  }

  function handleTimeChange(nextTime: string) {
    setTimeDraft(nextTime)
    commitIfComplete(dateDraft, nextTime)
  }

  function handleClear() {
    setDateDraft("")
    setTimeDraft("")
    onChange("")
  }

  const hasDraft = Boolean(dateDraft || timeDraft)

  return (
    <div className={cn("grid min-w-0 gap-2 sm:grid-cols-2", className)}>
      {required ? <span id={requiredDescriptionId} className="sr-only">필수 입력</span> : null}
      <DatePickerControl
        value={dateDraft}
        onChange={handleDateChange}
        ariaLabel={dateAriaLabel}
        ariaDescribedBy={required ? requiredDescriptionId : undefined}
        placeholder={datePlaceholder}
        disabled={disabled}
        disablePortal={disablePortal}
      />
      <div className="flex min-w-0 items-start gap-2">
        <TimePickerControl
          value={timeDraft}
          onChange={handleTimeChange}
          ariaLabel={timeAriaLabel}
          ariaDescribedBy={required ? requiredDescriptionId : undefined}
          placeholder={timePlaceholder}
          disabled={disabled}
          options={timeOptions}
          disablePortal={disablePortal}
          showIcon={!hasDraft}
          className="min-w-0 flex-1"
        />
        {hasDraft ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={clearAriaLabel}
            className="size-9 shrink-0"
            onClick={handleClear}
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
