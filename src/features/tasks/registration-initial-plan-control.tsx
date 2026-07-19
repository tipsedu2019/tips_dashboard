"use client"

import type { JSX } from "react"

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

export type RegistrationInitialRouteFieldsProps =
  RegistrationInitialPlanControlProps & {
    allowedInitialActions: readonly RegistrationInitialAction[]
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

export function RegistrationInitialRouteFields({
  subjects,
  draft,
  allowedInitialActions,
  disabled,
  onChange,
}: RegistrationInitialRouteFieldsProps): JSX.Element {
  const orderedSubjects = selectedSubjects(subjects)
  const allowedOptions = PLAN_OPTIONS.filter((option) => allowedInitialActions.includes(option.value))

  return (
    <div className="grid gap-3">
      <h4 className="text-sm font-semibold">과목별 다음 업무</h4>
      <div className="grid gap-3 md:grid-cols-2">
        {orderedSubjects.map((subject) => (
          <Label key={subject} className="grid gap-1.5">
            <span>{subject} 다음 업무</span>
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
              {allowedOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </Label>
        ))}
      </div>
    </div>
  )
}

export function RegistrationInitialLevelTestFields({
  draft,
  disabled,
  onChange,
}: RegistrationInitialPlanControlProps): JSX.Element {
  const levelTestSubjects = getRegistrationInitialWorkflowParticipants(draft, "level_test")
  const fieldsDisabled = disabled || levelTestSubjects.length === 0

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Label className="grid gap-1.5">
        <span>레벨테스트 예약일시</span>
        <DateTimePickerControl
          value={draft.levelTestScheduledAt}
          onChange={(value) => onChange({ ...draft, levelTestScheduledAt: value })}
          dateAriaLabel="레벨테스트 예약일 날짜"
          timeAriaLabel="레벨테스트 예약일 시각"
          timeOptions={REGISTRATION_TIME_OPTIONS}
          disablePortal
          disabled={fieldsDisabled}
        />
      </Label>
      <Label className="grid gap-1.5">
        <span>레벨테스트 장소</span>
        <Input
          value={draft.levelTestPlace}
          disabled={fieldsDisabled}
          onChange={(event) => onChange({ ...draft, levelTestPlace: event.target.value })}
        />
      </Label>
      <ParticipantBadges subjects={levelTestSubjects} />
    </div>
  )
}

export function RegistrationInitialConsultationFields({
  subjects,
  draft,
  resolvedDirectorIds,
  directorOptionsBySubject,
  disabled,
  onChange,
}: RegistrationInitialPlanControlProps): JSX.Element {
  const orderedSubjects = selectedSubjects(subjects)
  const consultationSubjects = orderedSubjects.filter((subject) => (
    draft.subjectPlans[subject] === "direct_phone" || draft.subjectPlans[subject] === "visit"
  ))
  const visitSubjects = getRegistrationInitialWorkflowParticipants(draft, "visit")
  const visitFieldsDisabled = disabled || visitSubjects.length === 0

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        {orderedSubjects.map((subject) => {
          const resolvedDirectorId = resolvedDirectorIds[subject] || ""
          const value = draft.directorOverrides[subject] || resolvedDirectorId
          const options = directorOptionsBySubject[subject] || []
          const subjectDisabled = disabled || !consultationSubjects.includes(subject)
          return (
            <Label key={subject} className="grid gap-1.5">
              <span>{subject} 상담 책임자</span>
              <select
                value={value}
                disabled={subjectDisabled}
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
      <div className="grid gap-1 text-sm">
        <span className="text-muted-foreground">전화상담 대기 기준일시</span>
        <output>저장 시 자동 기록</output>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Label className="grid gap-1.5">
          <span>방문상담일시</span>
          <DateTimePickerControl
            value={draft.visitScheduledAt}
            onChange={(value) => onChange({ ...draft, visitScheduledAt: value })}
            dateAriaLabel="방문상담일 날짜"
            timeAriaLabel="방문상담일 시각"
            timeOptions={REGISTRATION_TIME_OPTIONS}
            disablePortal
            disabled={visitFieldsDisabled}
          />
        </Label>
        <Label className="grid gap-1.5">
          <span>방문상담실</span>
          <Input
            value={draft.visitPlace}
            disabled={visitFieldsDisabled}
            onChange={(event) => onChange({ ...draft, visitPlace: event.target.value })}
          />
        </Label>
      </div>
      <div className="grid gap-1 text-sm">
        <span className="text-muted-foreground">상담 결과</span>
        <output>첫 저장 후 입력할 수 있습니다</output>
      </div>
      <ParticipantBadges subjects={consultationSubjects} />
    </div>
  )
}

export function RegistrationInitialPlanControl(
  props: RegistrationInitialPlanControlProps,
): JSX.Element {
  return (
    <section className="grid gap-4 border-t pt-4" aria-label="과목별 다음 업무">
      <RegistrationInitialRouteFields
        {...props}
        allowedInitialActions={["inquiry", "direct_phone", "level_test", "visit"]}
      />
      <RegistrationInitialLevelTestFields {...props} />
      <RegistrationInitialConsultationFields {...props} />
    </section>
  )
}

function ParticipantBadges({ subjects }: { subjects: RegistrationSubject[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 md:col-span-2" aria-label="참여 과목">
      <span className="text-xs font-medium text-muted-foreground">참여 과목</span>
      {subjects.length > 0
        ? subjects.map((subject) => <Badge key={subject} variant="secondary">{subject}</Badge>)
        : <span className="text-xs text-muted-foreground">없음</span>}
    </div>
  )
}
