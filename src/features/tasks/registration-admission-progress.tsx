"use client"

import type { ReactNode } from "react"
import { Check, Circle } from "lucide-react"

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
  return (
    <ol aria-label="입학 처리 항목" className="divide-y rounded-md border bg-background">
      {steps.map((step) => (
          <li
            key={step.key}
            aria-label={`${step.label}: ${step.complete ? "완료" : "미완료"}`}
            data-registration-admission-locked={step.locked ? "true" : undefined}
            data-registration-admission-state={step.complete ? "complete" : "pending"}
            className="grid min-w-0 gap-3 p-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-center"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-muted-foreground" aria-hidden="true">
                {step.complete ? <Check className="size-4" /> : <Circle className="size-4" />}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="text-sm font-medium">{step.label}</span>
                {step.complete ? <span className="text-xs text-muted-foreground">완료</span> : null}
              </span>
            </div>
            <div id={`registration-admission-panel-${step.key}`} className="grid min-w-0 gap-2">
              {step.content}
            </div>
          </li>
      ))}
    </ol>
  )
}
