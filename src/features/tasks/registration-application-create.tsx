"use client"

import { useMemo, type ReactNode } from "react"

import {
  RegistrationInquiryCommonFields,
  type RegistrationInquiryFieldName,
} from "./registration-application-inquiry-fields"
import { RegistrationApplicationInquirySection } from "./registration-application-inquiry-section"
import {
  getRegistrationCreateSectionStates,
  type RegistrationCreateCatalogStatus,
} from "./registration-application-model"
import { RegistrationApplicationShell } from "./registration-application-shell"
import {
  getRegistrationSubjectPickerAvailability,
  reconcileRegistrationInitialWorkflowDraft,
  reconcileRegistrationSubjectsForGrade,
  type RegistrationInitialPersistenceProbeResult,
  type RegistrationInitialWorkflowDraft,
} from "./registration-intake-workflow"
import {
  getRegistrationSchoolChoices,
} from "./registration-school-options"
import type {
  OpsSchoolOption,
  OpsTaskInput,
  RegistrationSchoolCatalogStatus,
} from "./ops-task-service"
import { RegistrationSubjectPicker } from "./registration-subject-picker"
import type { RegistrationSubject } from "./registration-track-service"
import type { RegistrationSubjectCapability } from "./registration-subject-capability-probe"
import { sortAcademicSubjects } from "../../lib/academic-subject-registry.ts"
import {
  normalizeRegistrationPhone,
  parseRegistrationSubjects,
  serializeRegistrationSubjects,
} from "./registration-workflow"

export type RegistrationApplicationCreateProps = {
  form: OpsTaskInput
  draft: RegistrationInitialWorkflowDraft
  persistence: RegistrationInitialPersistenceProbeResult
  resolvedDirectorIds: Partial<Record<RegistrationSubject, string>>
  directorOptionsBySubject: Record<
    RegistrationSubject,
    Array<{ value: string; label: string }>
  >
  subjectCapabilities: readonly RegistrationSubjectCapability[]
  subjectCapabilityError?: string
  disabled: boolean
  catalogStatus?: RegistrationCreateCatalogStatus
  catalogError?: string
  onRetryCatalog?: () => void
  schools?: OpsSchoolOption[]
  schoolCatalogStatus?: "loading" | RegistrationSchoolCatalogStatus
  schoolCatalogError?: string
  onRetrySchools?: () => void
  closeAction: ReactNode
  onFormPatch: (patch: Partial<OpsTaskInput>) => void
  onRegistrationFieldChange: (
    key: keyof NonNullable<OpsTaskInput["registration"]>,
    value: string | boolean,
  ) => void
  onDraftChange: (draft: RegistrationInitialWorkflowDraft) => void
}

function persistenceNote(mode: RegistrationInitialPersistenceProbeResult["mode"]) {
  if (mode === "canonical_inquiry") return "초기 일정 기능 준비 전에는 문의 정보만 저장합니다."
  if (mode === "legacy_inquiry") return "기존 등록 환경에서는 문의 정보만 저장합니다."
  if (mode === "blocked_maintenance") return "등록 데이터 전환 중입니다. 전환이 끝난 뒤 다시 저장하세요."
  if (mode === "blocked_mismatch") return "등록 런타임 버전이 일치하지 않아 저장할 수 없습니다."
  if (mode === "blocked_indeterminate") return "등록 저장 환경을 확인하고 있습니다. 잠시 후 다시 시도하세요."
  return ""
}

export function RegistrationApplicationCreate({
  form,
  draft,
  persistence,
  subjectCapabilities,
  subjectCapabilityError = "",
  disabled,
  schools = [],
  schoolCatalogStatus = "loading",
  schoolCatalogError = "",
  onRetrySchools,
  closeAction,
  onFormPatch,
  onRegistrationFieldChange,
  onDraftChange,
}: RegistrationApplicationCreateProps) {
  const registration = form.registration || {}
  const subjects = parseRegistrationSubjects(form.subject) as RegistrationSubject[]
  const subjectAvailability = useMemo(() => getRegistrationSubjectPickerAvailability({
    capabilities: subjectCapabilities,
    grade: registration.schoolGrade || "",
    selectedSubjects: subjects,
  }), [registration.schoolGrade, subjectCapabilities, subjects])
  const note = persistenceNote(persistence.mode)
  const inquiryLockReason = disabled
    ? "저장 중입니다"
    : persistence.mode.startsWith("blocked_")
      ? note
      : ""
  const showInquiryOnlyNote = persistence.mode === "canonical_inquiry"
    || persistence.mode === "legacy_inquiry"
  const writable = !disabled && ["ready_atomic", "canonical_inquiry", "legacy_inquiry"].includes(persistence.mode)
  const sectionStates = useMemo(() => {
    const base = getRegistrationCreateSectionStates({ subjects, draft, writable })
    return {
      ...base,
      inquiry: { ...base.inquiry, lockReason: inquiryLockReason },
      history: base.history,
    }
  }, [draft, inquiryLockReason, subjects, writable])

  function updateSubjects(subject: RegistrationSubject, checked: boolean) {
    const next = sortAcademicSubjects(checked
      ? [...subjects, subject]
      : subjects.filter((item) => item !== subject)) as RegistrationSubject[]
    onFormPatch({ subject: serializeRegistrationSubjects(next) })
    onDraftChange(reconcileRegistrationInitialWorkflowDraft(draft, next))
  }

  const schoolChoices = getRegistrationSchoolChoices({
    schools,
    grade: registration.schoolGrade || "",
    currentSchoolName: registration.schoolName || "",
  })

  function handleInquiryFieldChange(field: RegistrationInquiryFieldName, value: string) {
    if (field === "studentName") {
      onFormPatch({ studentName: value })
      return
    }
    if (field === "schoolGrade") {
      const catalogChoices = getRegistrationSchoolChoices({ schools, grade: value })
      onRegistrationFieldChange("schoolGrade", value)
      const reconciled = reconcileRegistrationSubjectsForGrade({
        capabilities: subjectCapabilities,
        grade: value,
        subjects,
        draft,
      })
      if (reconciled.removedSubjects.length > 0) {
        onFormPatch({ subject: serializeRegistrationSubjects(reconciled.subjects) })
        onDraftChange(reconciled.draft)
      }
      if (
        schoolCatalogStatus === "authoritative"
        && registration.schoolName
        && !catalogChoices.some((choice) => choice.value === registration.schoolName)
      ) {
        onRegistrationFieldChange("schoolName", "")
      }
      return
    }
    if (field === "parentPhone" || field === "studentPhone") {
      onRegistrationFieldChange(field, normalizeRegistrationPhone(value))
      return
    }
    onRegistrationFieldChange(field, value)
  }

  return (
    <RegistrationApplicationShell
      mode="create"
      studentName={form.studentName || "새 등록 신청"}
      closeAction={closeAction}
      sectionStates={sectionStates}
      inquiry={(
        <RegistrationApplicationInquirySection
          mode="create"
          editable={sectionStates.inquiry.editable}
          lockReason={sectionStates.inquiry.lockReason}
          subjectSyncContent={(
            <RegistrationSubjectPicker
              value={subjects}
              options={subjectAvailability.options}
              grade={registration.schoolGrade || ""}
              disabledReasonBySubject={subjectAvailability.disabledReasonBySubject}
              disabled={disabled || !writable}
              onToggle={updateSubjects}
            />
          )}
          commonInfoContent={(
            <RegistrationInquiryCommonFields
              values={{
                studentName: form.studentName || "",
                schoolGrade: registration.schoolGrade || "",
                schoolName: registration.schoolName || "",
                parentPhone: registration.parentPhone || "",
                studentPhone: registration.studentPhone || "",
                requestNote: registration.requestNote || "",
              }}
              inquiryAtLabel="저장 시각"
              schoolChoices={schoolChoices}
              schoolCatalogStatus={schoolCatalogStatus}
              schoolCatalogError={schoolCatalogError}
              disabled={disabled || !writable}
              onChange={handleInquiryFieldChange}
              onRetrySchools={onRetrySchools}
            />
          )}
          exceptionContent={(
            <div className="grid gap-3">
              {subjectCapabilityError ? <p role="status" className="text-sm text-muted-foreground">{subjectCapabilityError}</p> : null}
              {showInquiryOnlyNote ? (
                <p role="note" className="text-sm text-muted-foreground">
                  {note}
                </p>
              ) : null}
            </div>
          )}
        />
      )}
    />
  )
}
