"use client"

import { useEffect, useRef } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

const LOCATIONS = [
  { kind: "level_test_booking", section: "level_test", label: "레벨테스트 예약 안내" },
  { kind: "visit_consultation_booking", section: "consultation", label: "방문상담 예약 안내" },
  { kind: "waiting_notice", section: "waiting", label: "대기 안내" },
  { kind: "observation_booking", section: "observation", label: "청강 예약 안내" },
  { kind: "admission_application", section: "admission", label: "입학신청서 안내" },
] as const

export function RegistrationCustomerMessageNavigation({ includeObservation }: { includeObservation: boolean }) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const navigation = useRef<{ active: boolean; pending: typeof LOCATIONS[number] | null }>({ active: true, pending: null })
  useEffect(() => {
    const state = navigation.current
    state.active = true
    return () => { state.active = false; state.pending = null }
  }, [])

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) navigation.current.pending = null }}>
      <DropdownMenuTrigger asChild>
        <Button ref={triggerRef} type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9">
          알림톡 위치 <ChevronDown aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[100]" onCloseAutoFocus={(event) => {
        const location = navigation.current.pending
        navigation.current.pending = null
        if (!navigation.current.active || !location) return
        const scope = triggerRef.current?.closest('[data-registration-application-mode="detail"]')
        const section = scope?.querySelector<HTMLElement>(`[data-registration-application-section="${location.section}"]`)
        if (!section) return
        const button = [...section.querySelectorAll<HTMLButtonElement>(`button[data-registration-message-entry="${location.kind}"]`)]
          .find((item) => !item.closest("[hidden]"))
        const focusTarget = button && !button.disabled && !button.closest("fieldset[disabled]")
          ? button : section.querySelector<HTMLElement>("[data-registration-section-heading]")
        event.preventDefault()
        focusTarget?.focus({ preventScroll: true })
        section.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })
      }}>
        {LOCATIONS.filter((item) => includeObservation || item.kind !== "observation_booking").map((item) => (
          <DropdownMenuItem key={item.kind} className="min-h-11 sm:min-h-9" aria-controls={`registration-application-${item.section}`}
            onSelect={() => { navigation.current.pending = item }}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
