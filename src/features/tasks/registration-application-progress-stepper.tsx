import { ArrowRight, Check, Circle, CircleDot, X } from "lucide-react"

import type {
  RegistrationApplicationProgressState,
  RegistrationApplicationProgressStep,
} from "./registration-application-model"

const PROGRESS_STATE_PRESENTATION = {
  reached: {
    label: "지남",
    Icon: ArrowRight,
    className: "border-muted-foreground/30 text-muted-foreground",
  },
  current: {
    label: "현재",
    Icon: CircleDot,
    className: "border-primary bg-primary/5 text-primary",
  },
  upcoming: {
    label: "예정",
    Icon: Circle,
    className: "border-border text-muted-foreground",
  },
  complete: {
    label: "완료",
    Icon: Check,
    className: "border-primary/40 bg-primary/5 text-primary",
  },
  terminal: {
    label: "종료",
    Icon: X,
    className: "border-destructive/40 bg-destructive/5 text-destructive",
  },
} as const satisfies Record<
  RegistrationApplicationProgressState,
  { label: string; Icon: typeof Circle; className: string }
>

export function RegistrationApplicationProgressStepper({
  steps,
}: {
  steps: readonly RegistrationApplicationProgressStep[]
}) {
  return (
    <ol aria-label="과목별 등록 진행 상황" className="grid gap-2 sm:grid-cols-5">
      {steps.map((step) => {
        const presentation = PROGRESS_STATE_PRESENTATION[step.state]
        const Icon = presentation.Icon
        const isActive = step.state === "current" || step.state === "terminal"

        return (
          <li
            key={step.key}
            data-registration-progress-state={step.state}
            aria-current={isActive ? "step" : undefined}
            className={`flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 ${presentation.className}`}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{step.label}</span>
              <span className="block text-xs">{presentation.label}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
