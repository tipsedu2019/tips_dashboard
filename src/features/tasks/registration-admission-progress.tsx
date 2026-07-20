"use client"

import { useState, type ReactNode } from "react"
import { Check, Circle, CircleDot } from "lucide-react"

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
  const currentIndex = steps.findIndex((step) => !step.complete)
  const defaultIndex = currentIndex === -1 ? steps.length - 1 : currentIndex
  const [selectedKey, setSelectedKey] = useState<RegistrationAdmissionProgressKey>(steps[defaultIndex].key)
  const selectedStep = steps.find((step) => step.key === selectedKey && !step.locked) || steps[defaultIndex]

  return (
    <div className="grid gap-3">
      <ol aria-label="입학 처리 진행" className="grid grid-cols-5 gap-1 overflow-x-auto">
        {steps.map((step, index) => {
        const current = index === currentIndex
        const state = step.complete ? "complete" : current ? "current" : step.locked ? "locked" : "upcoming"

        return (
          <li
            key={step.key}
            aria-current={index === currentIndex ? "step" : undefined}
            data-registration-admission-locked={step.locked ? "true" : undefined}
            data-registration-admission-state={state}
            className="min-w-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedStep.key === step.key}
              aria-controls={`registration-admission-panel-${step.key}`}
              disabled={step.locked}
              onClick={() => setSelectedKey(step.key)}
              className="flex h-full w-full min-w-[7rem] flex-col items-start gap-1 rounded-md border bg-background px-2 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-0"
            >
              <span className="line-clamp-2 text-xs font-medium sm:text-sm">{index + 1}. {step.label}</span>
              <span className="flex w-full items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border" aria-hidden="true">
                {step.complete ? <Check className="size-4" /> : current ? <CircleDot className="size-4" /> : <Circle className="size-4" />}
              </span>
              <span className="text-xs text-muted-foreground">
                {step.complete ? "완료" : current ? step.locked ? "현재 · 잠김" : "현재" : step.locked ? "잠김" : "대기"}
              </span>
              </span>
            </button>
          </li>
        )
      })}
      </ol>
      {selectedStep.content ? (
        <div
          id={`registration-admission-panel-${selectedStep.key}`}
          role="tabpanel"
          className="grid gap-2 rounded-md border bg-background p-3"
        >
          {selectedStep.content}
        </div>
      ) : null}
    </div>
  )
}
