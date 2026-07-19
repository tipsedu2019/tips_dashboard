import type { ReactNode } from "react"

import type { RegistrationSubject } from "./registration-track-service"
import {
  REGISTRATION_APPLICATION_SECTION_ORDER,
  type RegistrationApplicationSectionKey,
  type RegistrationApplicationSectionState,
} from "./registration-application-model"

export type RegistrationApplicationShellProps = {
  mode: "create" | "detail"
  studentName: string
  tracks: Array<{
    key: string
    subject: RegistrationSubject
    statusLabel: string
  }>
  sectionStates: Record<
    RegistrationApplicationSectionKey,
    RegistrationApplicationSectionState
  >
  inquiry: ReactNode
  levelTest: ReactNode
  consultation: ReactNode
  placement: ReactNode
  admission: ReactNode
  history: ReactNode
}

const SECTION_CONTENT_KEY = {
  inquiry: "inquiry",
  level_test: "levelTest",
  consultation: "consultation",
  placement: "placement",
  admission: "admission",
  history: "history",
} as const

const SECTION_TITLES: Record<RegistrationApplicationSectionKey, string> = {
  inquiry: "문의 정보",
  level_test: "레벨테스트",
  consultation: "상담",
  placement: "등록·대기 정보",
  admission: "입력 처리",
  history: "담당자 및 일시 이력",
}

function RegistrationApplicationSection({
  section,
  state,
  children,
}: {
  section: RegistrationApplicationSectionKey
  state: RegistrationApplicationSectionState
  children: ReactNode
}) {
  const lockReasonId = `registration-application-${section}-lock-reason`

  return (
    <section
      data-registration-application-section={section}
      className="grid gap-3 border-t pt-5"
    >
      <div
        role="group"
        aria-disabled={!state.editable}
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
        {children}
      </div>
    </section>
  )
}

export function RegistrationApplicationShell(props: RegistrationApplicationShellProps) {
  return (
    <div data-registration-application-mode={props.mode} className="grid gap-5">
      <header className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-base font-semibold">{props.studentName}</h2>
        <div className="flex flex-wrap justify-end gap-1" aria-label="과목별 등록 상태">
          {props.tracks.map((track) => (
            <span key={track.key} className="rounded-full border px-2 py-0.5 text-xs">
              {track.subject} · {track.statusLabel}
            </span>
          ))}
        </div>
      </header>

      {REGISTRATION_APPLICATION_SECTION_ORDER.map((section) => {
        const contentKey = SECTION_CONTENT_KEY[section]
        return (
          <RegistrationApplicationSection key={section} section={section} state={props.sectionStates[section]}>
            {props[contentKey]}
          </RegistrationApplicationSection>
        )
      })}
    </div>
  )
}
