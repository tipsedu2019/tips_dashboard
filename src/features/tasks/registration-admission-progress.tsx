"use client"

import type { ReactNode } from "react"
import { Check } from "lucide-react"

export type RegistrationAdmissionProgressKey = "admissionNotice" | "makeedu" | "invoice" | "payment" | "complete"

export type RegistrationAdmissionProgressStep<TKey extends RegistrationAdmissionProgressKey = RegistrationAdmissionProgressKey> = {
  key: TKey
  label: string
  complete: boolean
  locked?: boolean
  content?: ReactNode
}

export type RegistrationAdmissionProgressSteps = readonly [
  RegistrationAdmissionProgressStep<"admissionNotice">,
  RegistrationAdmissionProgressStep<"makeedu">,
  RegistrationAdmissionProgressStep<"invoice">,
  RegistrationAdmissionProgressStep<"payment">,
  RegistrationAdmissionProgressStep<"complete">,
]

export function RegistrationAdmissionProgress({
  steps,
}: {
  steps: RegistrationAdmissionProgressSteps
}) {
  const activeStepIndex = steps.findIndex((step) => !step.complete && !step.locked)

  return (
    <ol aria-label="입학 처리 항목" className="divide-y rounded-md border bg-background">
      {steps.map((step, index) => {
        const state = step.complete ? "complete" : index === activeStepIndex ? "active" : "pending"
        const statusLabel = step.complete ? "완료" : state === "active" ? "진행" : "대기"
        return (
          <li
            key={step.key}
            aria-label={`${step.label}: ${statusLabel}`}
            aria-current={state === "active" ? "step" : undefined}
            data-registration-admission-locked={step.locked ? "true" : undefined}
            data-registration-admission-state={state}
            className={`grid min-w-0 gap-3 p-3 transition-colors sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-center ${
              state === "active" ? "bg-primary/[0.04]" : step.locked ? "bg-muted/20" : ""
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                step.complete
                  ? "border-primary bg-primary text-primary-foreground"
                  : state === "active"
                    ? "border-primary text-primary"
                    : "border-muted-foreground/30 bg-muted/40 text-muted-foreground"
              }`} aria-hidden="true">
                {step.complete ? <Check className="size-4" /> : index + 1}
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="text-sm font-medium">{step.label}</span>
                <span className={`text-xs font-medium ${state === "active" ? "text-primary" : "text-muted-foreground"}`}>{statusLabel}</span>
              </span>
            </div>
            <div id={`registration-admission-panel-${step.key}`} className="grid min-w-0 gap-2">
              {step.content}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
