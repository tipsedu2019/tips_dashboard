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
  reconcileRegistrationInitialWorkflowDraft,
  type RegistrationInitialPersistenceProbeResult,
  type RegistrationInitialWorkflowDraft,
} from "./registration-intake-workflow"
import type {
  OpsSchoolOption,
  OpsTaskInput,
  RegistrationSchoolCatalogStatus,
} from "./ops-task-service"
import { RegistrationSubjectPicker } from "./registration-subject-picker"
import type { RegistrationSubject } from "./registration-track-service"
import type { RegistrationSubjectCapability } from "./registration-subject-capability-probe"
import {
  ACADEMIC_SUBJECT_VALUES,
  sortAcademicSubjects,
} from "../../lib/academic-subject-registry.ts"
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
  if (mode === "canonical_inquiry" || mode === "legacy_inquiry") {
    return "등록 정보는 예약·알림과 별도로 저장됩니다."
  }
  if (mode === "blocked_maintenance") return "등록 데이터 전환 중입니다. 전환이 끝난 뒤 다시 저장하세요."
  if (mode === "blocked_mismatch") return "등록 런타임 버전이 일치하지 않아 저장할 수 없습니다."
  if (mode === "blocked_indeterminate") return "등록 저장 환경을 확인하고 있습니다. 잠시 후 다시 시도하세요."
  return ""
}

export function RegistrationApplicationCreate({
  form,
  draft,
  persistence,
  disabled,
  closeAction,
  onFormPatch,
  onRegistrationFieldChange,
  onDraftChange,
}: RegistrationApplicationCreateProps) {
  const registration = form.registration || {}
  const subjects = parseRegistrationSubjects(form.subject) as RegistrationSubject[]
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

  function handleInquiryFieldChange(field: RegistrationInquiryFieldName, value: string) {
    if (field === "studentName") {
      onFormPatch({ studentName: value })
      return
    }
    if (field === "schoolGrade") {
      onRegistrationFieldChange("schoolGrade", value)
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
              options={ACADEMIC_SUBJECT_VALUES}
              grade={registration.schoolGrade || ""}
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
                inquiryAt: registration.inquiryAt || "",
                requestNote: registration.requestNote || "",
              }}
              disabled={disabled || !writable}
              onChange={handleInquiryFieldChange}
            />
          )}
          exceptionContent={(
            <div className="grid gap-3">
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
