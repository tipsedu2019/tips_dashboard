import type { ReactNode } from "react"

import type { RegistrationSubject } from "./registration-track-service"
import {
  REGISTRATION_APPLICATION_BODY_SECTION_ORDER,
  isRegistrationApplicationSectionContentDisabled,
  type RegistrationApplicationSectionKey,
  type RegistrationApplicationSectionState,
} from "./registration-application-model"

export type RegistrationApplicationShellProps = {
  mode: "create" | "detail"
  studentName: string
  closeAction: ReactNode
  historyAction?: ReactNode
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
  placement: ReactNode
  admission: ReactNode
}

const SECTION_CONTENT_KEY = {
  inquiry: "inquiry",
  level_test: "levelTest",
  consultation: "consultation",
  placement: "placement",
  admission: "admission",
} as const

const SECTION_TITLES: Record<(typeof REGISTRATION_APPLICATION_BODY_SECTION_ORDER)[number], string> = {
  inquiry: "문의 정보",
  level_test: "레벨테스트",
  consultation: "상담",
  placement: "등록·대기 정보",
  admission: "입학 처리",
}

function RegistrationApplicationSection({
  mode,
  section,
  state,
  notice,
  children,
}: {
  mode: "create" | "detail"
  section: (typeof REGISTRATION_APPLICATION_BODY_SECTION_ORDER)[number]
  state: RegistrationApplicationSectionState
  notice?: ReactNode
  children: ReactNode
}) {
  const lockReasonId = `registration-application-${section}-lock-reason`
  const contentDisabled = isRegistrationApplicationSectionContentDisabled({
    mode,
    section,
    editable: state.editable,
  })
  const stateLabel = contentDisabled
    ? `${SECTION_TITLES[section]}: ${state.lockReason || "입력 잠김"}`
    : state.current
      ? `${SECTION_TITLES[section]}: 현재 진행 단계`
      : `${SECTION_TITLES[section]}: 사용 가능`

  return (
    <section
      id={`registration-application-${section}`}
      data-registration-application-section={section}
      data-registration-state={contentDisabled ? "locked" : state.current ? "current" : "ready"}
      aria-label={stateLabel}
      className="grid gap-3 border-t pt-5"
    >
      {notice}
      <div
        role="group"
        aria-disabled={contentDisabled}
        aria-describedby={state.lockReason ? lockReasonId : undefined}
        className="grid gap-3"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{SECTION_TITLES[section]}</h3>
          {state.current ? <span className="text-xs text-muted-foreground">진행 중</span> : null}
        </div>
        {state.lockReason ? (
          <p id={lockReasonId} className="text-xs text-muted-foreground">{state.lockReason}</p>
        ) : null}
        <fieldset disabled={contentDisabled} className="m-0 min-w-0 border-0 p-0">
          {children}
        </fieldset>
      </div>
    </section>
  )
}

export function RegistrationApplicationShell(props: RegistrationApplicationShellProps) {
  return (
    <div data-registration-application-mode={props.mode} className="grid gap-5">
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

      {REGISTRATION_APPLICATION_BODY_SECTION_ORDER.map((section) => {
        const contentKey = SECTION_CONTENT_KEY[section]
        return (
          <RegistrationApplicationSection
            key={section}
            mode={props.mode}
            section={section}
            state={props.sectionStates[section]}
            notice={props.sectionNotices?.[section]}
          >
            {props[contentKey]}
          </RegistrationApplicationSection>
        )
      })}
    </div>
  )
}
