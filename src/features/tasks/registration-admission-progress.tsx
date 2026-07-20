import type { ReactNode } from "react"
import { Check, Circle, CircleDot } from "lucide-react"

export type RegistrationAdmissionProgressStep = {
  key: "admissionNotice" | "makeedu" | "invoice" | "payment" | "complete"
  label: string
  complete: boolean
  locked?: boolean
  content?: ReactNode
}

export type RegistrationAdmissionProgressSteps = readonly [
  RegistrationAdmissionProgressStep,
  RegistrationAdmissionProgressStep,
  RegistrationAdmissionProgressStep,
  RegistrationAdmissionProgressStep,
  RegistrationAdmissionProgressStep,
]

export function RegistrationAdmissionProgress({
  steps,
}: {
  steps: readonly [RegistrationAdmissionProgressStep, RegistrationAdmissionProgressStep, RegistrationAdmissionProgressStep, RegistrationAdmissionProgressStep, RegistrationAdmissionProgressStep]
}) {
  const currentIndex = steps.findIndex((step) => !step.complete)

  return (
    <ol aria-label="입학 처리 진행" className="grid gap-2">
      {steps.map((step, index) => {
        const current = index === currentIndex
        const state = step.complete ? "complete" : current ? "current" : step.locked ? "locked" : "upcoming"

        return (
          <li
            key={step.key}
            aria-current={index === currentIndex ? "step" : undefined}
            data-registration-admission-locked={step.locked ? "true" : undefined}
            data-registration-admission-state={state}
            className="grid gap-2 rounded-md border bg-background px-3 py-3"
          >
            <div className="flex items-center gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border" aria-hidden="true">
                {step.complete ? <Check className="size-4" /> : current ? <CircleDot className="size-4" /> : <Circle className="size-4" />}
              </span>
              <span className="min-w-0 flex-1 text-sm font-medium">
                {index + 1}. {step.label}
              </span>
              <span className="text-xs text-muted-foreground">
                {step.complete ? "완료" : current ? step.locked ? "현재 · 잠김" : "현재" : step.locked ? "잠김" : "대기"}
              </span>
            </div>
            {step.content ? <div className="grid gap-2 pl-9">{step.content}</div> : null}
          </li>
        )
      })}
    </ol>
  )
}
