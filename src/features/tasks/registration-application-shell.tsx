import type { ReactNode } from "react"

import type { RegistrationSubject } from "./registration-track-service"
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
  progress: ReactNode
  tracks: Array<{
    key: string
    subject: RegistrationSubject
    statusLabel: string
  }>
  sectionStates: Record<
    RegistrationApplicationSectionKey,
    RegistrationApplicationSectionState
  >
  sectionNotices?: Partial<Record<RegistrationApplicationSectionKey, ReactNode>>
  inquiry: ReactNode
  levelTest: ReactNode
  consultation: ReactNode
  waiting: ReactNode
  registration: ReactNode
  waitingState: RegistrationApplicationSectionState
  registrationState: RegistrationApplicationSectionState
  admission: ReactNode
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
type RegistrationApplicationUiSectionKey = typeof APPLICATION_UI_SECTION_ORDER[number]

const SECTION_TITLES: Record<RegistrationApplicationUiSectionKey, string> = {
  inquiry: "문의",
  level_test: "1. 레벨테스트",
  consultation: "2. 상담",
  waiting: "3. 대기",
  registration: "4. 등록",
  admission: "5. 입학",
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

  return (
    <details
      open={!state.upcoming}
      id={`registration-application-${section}`}
      data-registration-application-section={section}
      data-registration-state={contentDisabled ? "locked" : state.current ? "current" : "ready"}
      aria-label={stateLabel}
      className="group scroll-mt-4 border-t pt-5"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold marker:hidden">
        <span>{SECTION_TITLES[section]}</span>
        <span className="text-xs font-normal text-muted-foreground group-open:hidden">펼치기</span>
      </summary>
      <div className="mt-3 grid gap-3">
      {notice}
      <div
        role="group"
        aria-disabled={contentDisabled}
        aria-describedby={state.lockReason ? lockReasonId : undefined}
        className="grid gap-3"
      >
        {state.lockReason ? (
          <p id={lockReasonId} className="text-xs text-muted-foreground">{state.lockReason}</p>
        ) : null}
        <fieldset disabled={contentDisabled} className="m-0 min-w-0 border-0 p-0">
          {children}
        </fieldset>
      </div>
      </div>
    </details>
  )
}

export function RegistrationApplicationShell(props: RegistrationApplicationShellProps) {
  return (
    <div data-registration-application-mode={props.mode} className="grid gap-5 [&_select:disabled]:border-muted-foreground/20 [&_select:disabled]:bg-muted [&_select:disabled]:text-muted-foreground [&_select:disabled]:opacity-100">
      <header className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-base font-semibold">{props.studentName}</h2>
        <div className="flex items-center justify-end gap-2">
          <div className="flex flex-wrap justify-end gap-1" aria-label="과목별 등록 상태">
            {props.tracks.map((track) => (
              <span key={track.key} className="rounded-full border px-2 py-0.5 text-xs">
                {track.subject} · {track.statusLabel}
              </span>
            ))}
          </div>
          {props.historyAction}
          {props.closeAction}
        </div>
      </header>

      {props.progress}

      {APPLICATION_UI_SECTION_ORDER.map((section) => {
        const contentKey = SECTION_CONTENT_KEY[section]
        const sectionState = section === "waiting"
          ? props.waitingState
          : section === "registration"
            ? props.registrationState
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
