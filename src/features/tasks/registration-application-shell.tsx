"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

import {
  isRegistrationApplicationSectionContentDisabled,
  type RegistrationApplicationSectionKey,
  type RegistrationApplicationSectionState,
} from "./registration-application-model"

export type RegistrationApplicationShellProps = {
  mode: "create" | "detail"
  studentName: string
  closeAction: ReactNode
  historyAction?: ReactNode
  subjectNavigation?: ReactNode
  progress: ReactNode
  sectionStates: Record<
    RegistrationApplicationSectionKey,
    RegistrationApplicationSectionState
  >
  sectionNotices?: Partial<Record<RegistrationApplicationSectionKey, ReactNode>>
  inquiry: ReactNode
  levelTest: ReactNode
  consultation: ReactNode
  waiting?: ReactNode
  registration?: ReactNode
  waitingState?: RegistrationApplicationSectionState
  registrationState?: RegistrationApplicationSectionState
  admission?: ReactNode
}

const SECTION_CONTENT_KEY = {
  inquiry: "inquiry",
  level_test: "levelTest",
  consultation: "consultation",
  waiting: "waiting",
  registration: "registration",
  admission: "admission",
} as const

const APPLICATION_UI_SECTION_ORDER = ["inquiry", "level_test", "consultation", "waiting", "registration", "admission"] as const
const CREATE_UI_SECTION_ORDER = ["inquiry", "level_test", "consultation"] as const
type RegistrationApplicationUiSectionKey = typeof APPLICATION_UI_SECTION_ORDER[number]

const SECTION_TITLES: Record<RegistrationApplicationUiSectionKey, string> = {
  inquiry: "문의",
  level_test: "레벨테스트",
  consultation: "상담",
  waiting: "대기",
  registration: "등록",
  admission: "입학",
}

function RegistrationApplicationSection({
  mode,
  section,
  state,
  notice,
  children,
}: {
  mode: "create" | "detail"
  section: RegistrationApplicationUiSectionKey
  state: RegistrationApplicationSectionState
  notice?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(!state.upcoming)
  useEffect(() => {
    if (state.upcoming) return
    const frame = window.requestAnimationFrame(() => setOpen(true))
    return () => window.cancelAnimationFrame(frame)
  }, [state.upcoming])
  const lockReasonId = `registration-application-${section}-lock-reason`
  const contentDisabled = isRegistrationApplicationSectionContentDisabled({
    mode,
    section: section === "waiting" || section === "registration" ? "placement" : section,
    editable: state.editable,
  })
  const stateLabel = contentDisabled
    ? `${SECTION_TITLES[section]}: ${state.lockReason || "입력 잠김"}`
    : state.current
      ? `${SECTION_TITLES[section]}: 현재 진행 단계`
      : `${SECTION_TITLES[section]}: 사용 가능`
  const visibleLockReason = state.lockReason === "현재 진행 단계가 아닙니다"
    ? ""
    : state.lockReason

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      id={`registration-application-${section}`}
      data-registration-application-section={section}
      data-registration-state={contentDisabled ? "locked" : state.current ? "current" : "ready"}
      aria-label={stateLabel}
      className="group scroll-mt-4 border-t pt-5"
    >
      <CollapsibleTrigger type="button" className="flex w-full cursor-pointer items-center justify-between gap-3 text-left text-sm font-semibold">
        <span>{SECTION_TITLES[section]}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent
        forceMount
        className="mt-3 grid gap-3 data-[state=closed]:hidden"
      >
        {notice}
        <div
          role="group"
          aria-disabled={contentDisabled}
          aria-describedby={visibleLockReason ? lockReasonId : undefined}
          className="grid gap-3"
        >
          {visibleLockReason ? (
            <p id={lockReasonId} className="text-xs text-muted-foreground">{visibleLockReason}</p>
          ) : null}
          <fieldset disabled={contentDisabled} className="m-0 min-w-0 border-0 p-0">
            {children}
          </fieldset>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function RegistrationApplicationShell(props: RegistrationApplicationShellProps) {
  const sections = props.mode === "create"
    ? CREATE_UI_SECTION_ORDER
    : APPLICATION_UI_SECTION_ORDER

  return (
    <div data-registration-application-mode={props.mode} className="grid gap-5 [&_select:disabled]:border-muted-foreground/20 [&_select:disabled]:bg-muted [&_select:disabled]:text-muted-foreground [&_select:disabled]:opacity-100">
      <header className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-base font-semibold">{props.studentName}</h2>
        <div className="flex items-center justify-end gap-2">
          {props.historyAction}
          {props.closeAction}
        </div>
      </header>

      {props.subjectNavigation}
      {props.progress}

      {sections.map((section) => {
        const contentKey = SECTION_CONTENT_KEY[section]
        const sectionState = section === "waiting"
          ? props.waitingState || props.sectionStates.placement
          : section === "registration"
            ? props.registrationState || props.sectionStates.placement
            : props.sectionStates[section]
        return (
          <RegistrationApplicationSection
            key={section}
            mode={props.mode}
            section={section}
            state={sectionState}
            notice={section === "waiting" || section === "registration" ? undefined : props.sectionNotices?.[section]}
          >
            {props[contentKey]}
          </RegistrationApplicationSection>
        )
      })}
    </div>
  )
}
