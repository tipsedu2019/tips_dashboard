"use client"

import dynamic from "next/dynamic"

import type { RegistrationApplicationProps } from "./registration-track-editor"

function RegistrationApplicationLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      data-registration-application-loading=""
      className="rounded-md border px-3 py-10 text-center text-sm text-muted-foreground"
    >
      등록 신청서를 준비하는 중입니다.
    </div>
  )
}

export const RegistrationApplication = dynamic<RegistrationApplicationProps>(
  () => import("./registration-track-editor").then((module) => module.RegistrationApplication),
  { loading: RegistrationApplicationLoading },
)
