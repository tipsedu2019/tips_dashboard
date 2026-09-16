"use client"

import { useEffect, useRef, type ReactNode } from "react"

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
  progress?: ReactNode
  sectionStates: Record<
    RegistrationApplicationSectionKey,
    RegistrationApplicationSectionState
  >
  sectionActions?: Partial<Record<RegistrationApplicationUiSectionKey, ReactNode>>
  sectionNotices?: Partial<Record<RegistrationApplicationSectionKey, ReactNode>>
  inquiry: ReactNode
  levelTest?: ReactNode
  consultation?: ReactNode
  waiting?: ReactNode
  observation?: ReactNode
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
  observation: "observation",
  registration: "registration",
  admission: "admission",
} as const

const SECTION_ORDER = [
  "inquiry", "levelTest", "consultation", "waiting", "observation", "registration", "admission",
] as const
const APPLICATION_UI_SECTION_ORDER = SECTION_ORDER.map((section) => (
  section === "levelTest" ? "level_test" : section
)) as readonly (keyof typeof SECTION_CONTENT_KEY)[]
const CREATE_UI_SECTION_ORDER = ["inquiry"] as const
type RegistrationApplicationUiSectionKey = typeof APPLICATION_UI_SECTION_ORDER[number]

const SECTION_TITLES: Record<RegistrationApplicationUiSectionKey, string> = {
  inquiry: "문의",
  level_test: "레벨테스트",
  consultation: "상담",
  waiting: "대기",
  observation: "청강 신청",
  registration: "등록",
  admission: "입학",
}

function RegistrationApplicationSection({
  mode,
  section,
  state,
  notice,
  actions,
  children,
}: {
  mode: "create" | "detail"
  section: RegistrationApplicationUiSectionKey
  state: RegistrationApplicationSectionState
  notice?: ReactNode
  actions?: ReactNode
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
      className="scroll-mt-[var(--registration-section-scroll-margin,13rem)] border-t py-4 lg:grid lg:grid-cols-[7rem_minmax(0,1fr)] lg:gap-6 lg:py-5"
    >
      <header className="mb-3 lg:mb-0 lg:pt-0.5">
        <h3 data-registration-section-heading tabIndex={-1} className="rounded-sm text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
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
        {actions ? <div className="flex flex-wrap items-start justify-end gap-2">{actions}</div> : null}
      </div>
    </section>
  )
}

export function RegistrationApplicationShell(props: RegistrationApplicationShellProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const header = headerRef.current
    const shell = shellRef.current
    if (!header || !shell) return
    const updateMargin = () => {
      // A mobile keyboard can leave less room than the sticky header needs.
      const compactViewport = (window.visualViewport?.height ?? window.innerHeight) < 600
      shell.dataset.registrationCompactViewport = String(compactViewport)
      shell.style.setProperty("--registration-section-scroll-margin", `${compactViewport ? 16 : header.getBoundingClientRect().height + 16}px`)
    }
    updateMargin()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateMargin)
    observer?.observe(header)
    window.visualViewport?.addEventListener("resize", updateMargin)
    window.addEventListener("resize", updateMargin)
    return () => {
      observer?.disconnect()
      window.visualViewport?.removeEventListener("resize", updateMargin)
      window.removeEventListener("resize", updateMargin)
    }
  }, [])
  const sections = props.mode === "create"
    ? CREATE_UI_SECTION_ORDER
    : APPLICATION_UI_SECTION_ORDER.filter((section) => section !== "observation" || props.observation !== undefined)

  return (
    <div ref={shellRef} data-registration-application-mode={props.mode} className="group/registration-shell min-w-0 [&_select:disabled]:border-muted-foreground/20 [&_select:disabled]:bg-muted [&_select:disabled]:text-muted-foreground [&_select:disabled]:opacity-100">
      <header ref={headerRef} className="sticky -top-6 z-20 group-data-[registration-compact-viewport=true]/registration-shell:static -mx-6 -mt-6 border-b bg-background px-6 pb-3 pt-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="min-w-0 break-words text-lg font-semibold [overflow-wrap:anywhere]">{props.studentName}</h2>
          <div className="flex items-center justify-end gap-2">
            {props.historyAction}
            {props.closeAction}
          </div>
        </div>
        {props.subjectNavigation ? <div className="mt-3">{props.subjectNavigation}</div> : null}
        {props.mode === "detail" && props.progress ? <div className="mt-3">{props.progress}</div> : null}
      </header>

      <div className="pb-4">
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
              actions={props.sectionActions?.[section]}
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
