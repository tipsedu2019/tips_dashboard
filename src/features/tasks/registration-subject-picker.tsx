import type { ReactNode } from "react"
import { Check } from "lucide-react"

import { Button } from "@/components/ui/button"

import type { RegistrationSubject } from "./registration-track-service"

export type RegistrationSubjectPickerProps = {
  value: readonly RegistrationSubject[]
  options: readonly RegistrationSubject[]
  grade: string
  disabledReasonBySubject?: Partial<Record<RegistrationSubject, string>>
  disabled?: boolean
  disabledSubjects?: ReadonlySet<RegistrationSubject>
  onToggle: (subject: RegistrationSubject, selected: boolean) => void
  action?: ReactNode
}

export function RegistrationSubjectPicker(props: RegistrationSubjectPickerProps) {
  return (
    <section className="grid gap-2" aria-label="과목" data-registration-focus="subject">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">과목</h3>
        {props.action}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {props.options.map((subject) => {
          const selected = props.value.includes(subject)
          const disabledReason = props.disabledReasonBySubject?.[subject] || ""
          return (
            <Button
              key={subject}
              type="button"
              variant={selected ? "default" : "outline"}
              aria-pressed={selected}
              aria-label={`${subject} 문의 과목 ${selected ? "선택됨" : "선택 안 됨"}`}
              disabled={props.disabled || props.disabledSubjects?.has(subject) || Boolean(disabledReason)}
              title={disabledReason || undefined}
              data-registration-grade={props.grade}
              onClick={() => props.onToggle(subject, !selected)}
            >
              {selected ? <Check aria-hidden="true" className="size-4" /> : null}
              {subject}
            </Button>
          )
        })}
      </div>
      {[...new Set(props.options.map((subject) => props.disabledReasonBySubject?.[subject]).filter(Boolean))].map((reason) => (
        <p key={reason} className="text-xs text-muted-foreground" data-registration-subject-reason>{reason}</p>
      ))}
    </section>
  )
}
