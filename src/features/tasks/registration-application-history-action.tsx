"use client"

import { useRef } from "react"
import { Clock3 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

import {
  RegistrationHistoryTimeline,
  type RegistrationHistoryTimelineProps,
} from "./registration-history-timeline"

export function RegistrationApplicationHistoryAction({
  detail,
  profiles,
}: RegistrationHistoryTimelineProps) {
  const historyTriggerRef = useRef<HTMLButtonElement>(null)
  const restoreHistoryTriggerFocusRef = useRef(false)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button ref={historyTriggerRef} type="button" variant="ghost" size="icon" aria-label="자동 이력 보기">
          <Clock3 aria-hidden="true" className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[calc(100dvh-6rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain p-0"
        onEscapeKeyDown={() => {
          restoreHistoryTriggerFocusRef.current = true
        }}
        onInteractOutside={() => {
          restoreHistoryTriggerFocusRef.current = false
        }}
        onCloseAutoFocus={(event) => {
          if (!restoreHistoryTriggerFocusRef.current) return
          restoreHistoryTriggerFocusRef.current = false
          event.preventDefault()
          historyTriggerRef.current?.focus({ preventScroll: true })
        }}
      >
        <RegistrationHistoryTimeline detail={detail} profiles={profiles} embedded />
      </PopoverContent>
    </Popover>
  )
}
