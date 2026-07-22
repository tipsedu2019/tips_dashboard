"use client"

import type { JSX } from "react"

import { DateTimePickerControl } from "@/components/ui/date-time-picker"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

import {
  getRegistrationInitialWorkflowParticipants,
  setRegistrationInitialSubjectAction,
  type RegistrationInitialWorkflowDraft,
} from "./registration-intake-workflow"
import {
  REGISTRATION_LEVEL_TEST_PLACES,
  normalizeRegistrationLevelTestPlace,
} from "./registration-level-test-place.ts"
import type { RegistrationSubject } from "./registration-track-service"
import { RegistrationSelect } from "./registration-select"
import { REGISTRATION_TIME_OPTIONS } from "./registration-workflow"
import { sortAcademicSubjects } from "../../lib/academic-subject-registry.ts"

// RegistrationSelect preserves the former controlled <Select value={value}>
// contract while centralizing SelectTrigger styling and empty-value handling.

export type RegistrationInitialPlanControlProps = {
  subjects: RegistrationSubject[]
  draft: RegistrationInitialWorkflowDraft
  resolvedDirectorIds: Partial<Record<RegistrationSubject, string>>
  directorOptionsBySubject: Record<
    RegistrationSubject,
    Array<{ value: string; label: string }>
  >
  disabled: boolean
  catalogControlsDisabled?: boolean
  catalogLockReason?: string
  onChange: (draft: RegistrationInitialWorkflowDraft) => void
}

function selectedSubjects(subjects: RegistrationSubject[]) {
  return sortAcademicSubjects(subjects) as RegistrationSubject[]
}

function ProcessSubjectPicker({ subjects, selected, disabled, label, onToggle }: {
  subjects: RegistrationSubject[]
  selected: RegistrationSubject[]
  disabled: boolean
  label: string
  onToggle: (subject: RegistrationSubject, checked: boolean) => void
}) {
  return (
    <div className="grid gap-2" role="group" aria-label={`${label} 과목 선택`}>
      <span className="text-sm font-medium">과목</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {selectedSubjects(subjects).map((subject) => {
          const active = selected.includes(subject)
          return <Button key={subject} type="button" variant={active ? "default" : "outline"} aria-pressed={active} disabled={disabled} onClick={() => onToggle(subject, !active)}>{subject}</Button>
        })}
      </div>
    </div>
  )
}

export function RegistrationInitialLevelTestFields({
  subjects,
  draft,
  disabled,
  onChange,
}: RegistrationInitialPlanControlProps): JSX.Element {
  const levelTestSubjects = getRegistrationInitialWorkflowParticipants(draft, "level_test")
  const fieldsDisabled = disabled || levelTestSubjects.length === 0

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="md:col-span-2">
        <ProcessSubjectPicker
          subjects={subjects}
          selected={levelTestSubjects}
          disabled={disabled}
          label="레벨테스트"
          onToggle={(subject, checked) => onChange(setRegistrationInitialSubjectAction(draft, subject, checked ? "level_test" : "inquiry"))}
        />
      </div>
      <Label className="grid gap-1.5" aria-label="레벨테스트 예약일시" data-registration-focus="levelTestAt">
        <span>예약일시</span>
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
      <Label className="grid gap-1.5" aria-label="레벨테스트 장소" data-registration-focus="levelTestPlace">
        <span>장소</span>
        <RegistrationSelect value={draft.levelTestPlace} placeholder="장소 선택" disabled={fieldsDisabled} options={REGISTRATION_LEVEL_TEST_PLACES.map((place) => ({ value: place, label: place }))} onValueChange={(value) => onChange({ ...draft, levelTestPlace: value })} />
      </Label>
    </div>
  )
}

export function RegistrationInitialConsultationFields({
  subjects,
  draft,
  resolvedDirectorIds,
  directorOptionsBySubject,
  disabled,
  catalogControlsDisabled = false,
  catalogLockReason = "",
  onChange,
}: RegistrationInitialPlanControlProps): JSX.Element {
  const orderedSubjects = selectedSubjects(subjects)
  const consultationSubjects = orderedSubjects.filter((subject) => (
    draft.subjectPlans[subject] === "direct_phone" || draft.subjectPlans[subject] === "visit"
  ))
  const visitSubjects = getRegistrationInitialWorkflowParticipants(draft, "visit")
  const consultationControlsDisabled = disabled || catalogControlsDisabled
  const visitFieldsDisabled = consultationControlsDisabled || visitSubjects.length === 0

  return (
    <div
      className="grid gap-4"
      data-registration-catalog-owned="consultation"
      role="group"
      aria-disabled={consultationControlsDisabled}
      aria-describedby={catalogLockReason ? "registration-create-catalog-lock-reason" : undefined}
    >
      {catalogLockReason ? (
        <p id="registration-create-catalog-lock-reason" data-registration-state="locked" className="sr-only">
          {catalogLockReason}
        </p>
      ) : null}
      <ProcessSubjectPicker
        subjects={subjects}
        selected={consultationSubjects}
        disabled={consultationControlsDisabled}
        label="상담"
        onToggle={(subject, checked) => onChange(setRegistrationInitialSubjectAction(draft, subject, checked ? "direct_phone" : "inquiry"))}
      />
      <div className="grid gap-3 md:grid-cols-3">
        {consultationSubjects.map((subject) => (
          <Label key={`${subject}-mode`} className="grid gap-1.5">
            <span>{subject} 상담 방식</span>
            <RegistrationSelect
              value={draft.subjectPlans[subject] || ""}
              disabled={consultationControlsDisabled}
              placeholder="상담 방식 선택"
              options={[{ value: "direct_phone", label: "전화상담" }, { value: "visit", label: "방문상담" }]}
              onValueChange={(value) => onChange(setRegistrationInitialSubjectAction(draft, subject, value as "direct_phone" | "visit"))}
              aria-label={`${subject} 상담 방식`}
            />
          </Label>
        ))}
        {consultationSubjects.map((subject) => {
          const resolvedDirectorId = resolvedDirectorIds[subject] || ""
          const value = draft.directorOverrides[subject] || resolvedDirectorId
          const options = directorOptionsBySubject[subject] || []
          return (
            <Label key={subject} className="grid gap-1.5" data-registration-focus={`counselor:${subject}`}>
              <span>{subject} 상담 책임자</span>
              <RegistrationSelect
                value={value}
                disabled={consultationControlsDisabled}
                placeholder="책임자 선택"
                options={options}
                onValueChange={(nextValue) => onChange({
                  ...draft,
                  directorOverrides: {
                    ...draft.directorOverrides,
                    [subject]: nextValue,
                  },
                })}
                aria-label={`${subject} 상담 책임자`}
              />
            </Label>
          )
        })}
      </div>
      {visitSubjects.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Label className="grid gap-1.5" data-registration-focus="visitConsultationAt">
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
          <Label className="grid gap-1.5" data-registration-focus="visitConsultationPlace">
            <span>방문상담실</span>
            <RegistrationSelect
              value={normalizeRegistrationLevelTestPlace(draft.visitPlace) ?? ""}
              disabled={visitFieldsDisabled}
              placeholder="장소 선택"
              options={REGISTRATION_LEVEL_TEST_PLACES.map((place) => ({ value: place, label: place }))}
              onValueChange={(value) => onChange({ ...draft, visitPlace: value })}
              aria-label="방문상담 장소"
            />
          </Label>
        </div>
      ) : null}
    </div>
  )
}

export function RegistrationInitialPlanControl(
  props: RegistrationInitialPlanControlProps,
): JSX.Element {
  return (
    <section className="grid gap-4 border-t pt-4" aria-label="초기 진행 계획">
      <RegistrationInitialLevelTestFields {...props} />
      <RegistrationInitialConsultationFields {...props} />
    </section>
  )
}
