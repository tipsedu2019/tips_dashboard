"use client"

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
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="자동 이력 보기">
          <Clock3 aria-hidden="true" className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[calc(100dvh-6rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain p-0"
      >
        <RegistrationHistoryTimeline detail={detail} profiles={profiles} embedded />
      </PopoverContent>
    </Popover>
  )
}
