"use client"

import type { ReactNode } from "react"

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

const SECTION_INDEX: Record<RegistrationApplicationUiSectionKey, string> = {
  inquiry: "01",
  level_test: "02",
  consultation: "03",
  waiting: "04",
  registration: "05",
  admission: "06",
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
    <section
      id={`registration-application-${section}`}
      data-registration-application-section={section}
      data-registration-state={contentDisabled ? "locked" : state.current ? "current" : "ready"}
      aria-label={stateLabel}
      className="scroll-mt-32 border-t py-6 lg:grid lg:grid-cols-[8rem_minmax(0,1fr)] lg:gap-8 lg:py-8"
    >
      <header className="mb-4 lg:mb-0">
        <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
          {SECTION_INDEX[section]}
        </span>
        <h3 className="mt-1 text-base font-semibold tracking-tight">
          {SECTION_TITLES[section]}
        </h3>
      </header>
      <div className="grid min-w-0 gap-3">
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
      </div>
    </section>
  )
}

export function RegistrationApplicationShell(props: RegistrationApplicationShellProps) {
  const sections = props.mode === "create"
    ? CREATE_UI_SECTION_ORDER
    : APPLICATION_UI_SECTION_ORDER

  return (
    <div data-registration-application-mode={props.mode} className="min-w-0 [&_select:disabled]:border-muted-foreground/20 [&_select:disabled]:bg-muted [&_select:disabled]:text-muted-foreground [&_select:disabled]:opacity-100">
      <header className="sticky top-0 z-20 -mx-6 -mt-6 border-b bg-background/95 px-6 pb-4 pt-5 backdrop-blur supports-[backdrop-filter]:bg-background/90">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-xl font-semibold tracking-tight">{props.studentName}</h2>
          <div className="flex items-center justify-end gap-2">
            {props.historyAction}
            {props.closeAction}
          </div>
        </div>
        {props.subjectNavigation ? <div className="mt-4">{props.subjectNavigation}</div> : null}
        {props.progress ? <div className="mt-4">{props.progress}</div> : null}
      </header>

      <div>
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
    </div>
  )
}
