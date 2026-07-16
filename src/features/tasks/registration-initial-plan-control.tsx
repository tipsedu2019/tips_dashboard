"use client"

import { Badge } from "@/components/ui/badge"
import { DateTimePickerControl } from "@/components/ui/date-time-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  getRegistrationInitialWorkflowParticipants,
  setRegistrationInitialSubjectAction,
  type RegistrationInitialAction,
  type RegistrationInitialWorkflowDraft,
} from "./registration-intake-workflow"
import type { RegistrationSubject } from "./registration-track-service"
import { REGISTRATION_TIME_OPTIONS } from "./registration-workflow"

export type RegistrationInitialPlanControlProps = {
  subjects: RegistrationSubject[]
  draft: RegistrationInitialWorkflowDraft
  resolvedDirectorIds: Partial<Record<RegistrationSubject, string>>
  directorOptionsBySubject: Record<
    RegistrationSubject,
    Array<{ value: string; label: string }>
  >
  disabled: boolean
  onChange: (draft: RegistrationInitialWorkflowDraft) => void
}

const SUBJECT_ORDER: RegistrationSubject[] = ["영어", "수학"]
const PLAN_OPTIONS: Array<{ value: RegistrationInitialAction; label: string }> = [
  { value: "inquiry", label: "문의 유지" },
  { value: "direct_phone", label: "바로 전화상담" },
  { value: "level_test", label: "레벨테스트" },
  { value: "visit", label: "방문상담" },
]

function selectedSubjects(subjects: RegistrationSubject[]) {
  const selected = new Set(subjects)
  return SUBJECT_ORDER.filter((subject) => selected.has(subject))
}

export function RegistrationInitialPlanControl({
  subjects,
  draft,
  resolvedDirectorIds,
  directorOptionsBySubject,
  disabled,
  onChange,
}: RegistrationInitialPlanControlProps) {
  const orderedSubjects = selectedSubjects(subjects)
  const consultationSubjects = orderedSubjects.filter((subject) => (
    draft.subjectPlans[subject] === "direct_phone" || draft.subjectPlans[subject] === "visit"
  ))
  const levelTestSubjects = getRegistrationInitialWorkflowParticipants(draft, "level_test")
  const visitSubjects = getRegistrationInitialWorkflowParticipants(draft, "visit")

  return (
    <section className="grid gap-4 border-t pt-4" aria-label="과목별 다음 업무">
      <div className="grid gap-3">
        <h3 className="text-sm font-semibold">과목별 다음 업무</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {orderedSubjects.map((subject) => (
            <Label key={subject} className="grid gap-1.5">
              <span>{subject}</span>
              <select
                value={draft.subjectPlans[subject] || "inquiry"}
                disabled={disabled}
                onChange={(event) => onChange(setRegistrationInitialSubjectAction(
                  draft,
                  subject,
                  event.target.value as RegistrationInitialAction,
                ))}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                aria-label={`${subject} 다음 업무`}
              >
                {PLAN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Label>
          ))}
        </div>
      </div>

      {consultationSubjects.length > 0 && (
        <div className="grid gap-3">
          <h3 className="text-sm font-semibold">과목별 상담 책임자</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {consultationSubjects.map((subject) => {
              const resolvedDirectorId = resolvedDirectorIds[subject] || ""
              const value = draft.directorOverrides[subject] || resolvedDirectorId
              const options = directorOptionsBySubject[subject] || []
              return (
                <Label key={subject} className="grid gap-1.5">
                  <span>{subject} 상담 책임자</span>
                  <select
                    value={value}
                    disabled={disabled}
                    onChange={(event) => onChange({
                      ...draft,
                      directorOverrides: {
                        ...draft.directorOverrides,
                        [subject]: event.target.value,
                      },
                    })}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    aria-label={`${subject} 상담 책임자`}
                  >
                    <option value="">책임자 선택</option>
                    {options.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </Label>
              )
            })}
          </div>
        </div>
      )}

      {visitSubjects.length > 0 && (
        <div className="grid gap-3">
          <Label className="grid gap-1.5">
            <span>방문상담 예약일시</span>
            <DateTimePickerControl
              value={draft.visitScheduledAt}
              onChange={(value) => onChange({ ...draft, visitScheduledAt: value })}
              dateAriaLabel="방문상담 예약일 날짜"
              timeAriaLabel="방문상담 예약일 시각"
              timeOptions={REGISTRATION_TIME_OPTIONS}
              disablePortal
              disabled={disabled}
            />
          </Label>
          <Label className="grid gap-1.5">
            <span>방문상담실</span>
            <Input
              value={draft.visitPlace}
              disabled={disabled}
              onChange={(event) => onChange({ ...draft, visitPlace: event.target.value })}
            />
          </Label>
          <ParticipantBadges subjects={visitSubjects} />
        </div>
      )}

      {levelTestSubjects.length > 0 && (
        <div className="grid gap-3">
          <Label className="grid gap-1.5">
            <span>레벨테스트 예약일시</span>
            <DateTimePickerControl
              value={draft.levelTestScheduledAt}
              onChange={(value) => onChange({ ...draft, levelTestScheduledAt: value })}
              dateAriaLabel="레벨테스트 예약일 날짜"
              timeAriaLabel="레벨테스트 예약일 시각"
              timeOptions={REGISTRATION_TIME_OPTIONS}
              disablePortal
              disabled={disabled}
            />
          </Label>
          <Label className="grid gap-1.5">
            <span>레벨테스트 장소</span>
            <Input
              value={draft.levelTestPlace}
              disabled={disabled}
              onChange={(event) => onChange({ ...draft, levelTestPlace: event.target.value })}
            />
          </Label>
          <ParticipantBadges subjects={levelTestSubjects} />
        </div>
      )}
    </section>
  )
}

function ParticipantBadges({ subjects }: { subjects: RegistrationSubject[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="참여 과목">
      <span className="text-xs font-medium text-muted-foreground">참여 과목</span>
      {subjects.map((subject) => <Badge key={subject} variant="secondary">{subject}</Badge>)}
    </div>
  )
}
