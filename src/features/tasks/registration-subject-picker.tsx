import type { ReactNode } from "react"
import { Check } from "lucide-react"

import { Button } from "@/components/ui/button"

import type { RegistrationSubject } from "./registration-track-service"

export type RegistrationSubjectPickerProps = {
  value: readonly RegistrationSubject[]
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
      <div className="grid grid-cols-2 gap-2">
        {(["영어", "수학"] as RegistrationSubject[]).map((subject) => {
          const selected = props.value.includes(subject)
          return (
            <Button
              key={subject}
              type="button"
              variant={selected ? "default" : "outline"}
              aria-pressed={selected}
              aria-label={`${subject} 문의 과목 ${selected ? "선택됨" : "선택 안 됨"}`}
              disabled={props.disabled || props.disabledSubjects?.has(subject)}
              onClick={() => props.onToggle(subject, !selected)}
            >
              {selected ? <Check aria-hidden="true" className="size-4" /> : null}
              {subject}
            </Button>
          )
        })}
      </div>
    </section>
  )
}
