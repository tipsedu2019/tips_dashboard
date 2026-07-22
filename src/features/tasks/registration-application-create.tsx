"use client"

import { useEffect, useMemo, type ReactNode } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

import { RegistrationApplicationAdmissionSection } from "./registration-application-admission-section"
import { RegistrationAdmissionProgress } from "./registration-admission-progress"
import { RegistrationApplicationConsultationSection } from "./registration-application-consultation-section"
import {
  RegistrationInquiryCommonFields,
  type RegistrationInquiryFieldName,
} from "./registration-application-inquiry-fields"
import { RegistrationApplicationInquirySection } from "./registration-application-inquiry-section"
import { RegistrationApplicationLevelTestSection } from "./registration-application-level-test-section"
import {
  getRegistrationCreateCatalogState,
  getRegistrationCreateSectionStates,
  getRegistrationApplicationProgress,
  type RegistrationCreateCatalogStatus,
} from "./registration-application-model"
import { RegistrationApplicationProgressStepper } from "./registration-application-progress-stepper"
import { RegistrationApplicationPlacementSection } from "./registration-application-placement-section"
import { RegistrationApplicationShell } from "./registration-application-shell"
import {
  reconcileRegistrationInitialWorkflowCapabilities,
  getRegistrationSubjectPickerAvailability,
  reconcileRegistrationInitialWorkflowDraft,
  reconcileRegistrationSubjectsForGrade,
  type RegistrationInitialAction,
  type RegistrationInitialPersistenceProbeResult,
  type RegistrationInitialWorkflowDraft,
} from "./registration-intake-workflow"
import {
  RegistrationInitialConsultationFields,
  RegistrationInitialLevelTestFields,
} from "./registration-initial-plan-control"
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

const READY_INITIAL_ACTIONS = ["inquiry", "direct_phone", "level_test", "visit"] as const
const INQUIRY_ONLY_INITIAL_ACTIONS = ["inquiry"] as const

const INITIAL_ACTION_LABEL: Record<RegistrationInitialAction, string> = {
  inquiry: "문의 유지",
  direct_phone: "바로 전화상담",
  level_test: "레벨테스트",
  visit: "방문상담",
}

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
  resolvedDirectorIds,
  directorOptionsBySubject,
  subjectCapabilities,
  subjectCapabilityError = "",
  disabled,
  catalogStatus = "ready",
  catalogError = "",
  onRetryCatalog,
  schools = [],
  schoolCatalogStatus = "loading",
  schoolCatalogError = "",
  onRetrySchools,
  closeAction,
  onFormPatch,
  onRegistrationFieldChange,
  onDraftChange,
}: RegistrationApplicationCreateProps) {
  const catalogState = getRegistrationCreateCatalogState({ status: catalogStatus, error: catalogError })
  const catalogFailed = catalogState.status === "error" || catalogState.status === "partial"
  const registration = form.registration || {}
  const subjects = parseRegistrationSubjects(form.subject) as RegistrationSubject[]
  const subjectAvailability = useMemo(() => getRegistrationSubjectPickerAvailability({
    capabilities: subjectCapabilities,
    grade: registration.schoolGrade || "",
    selectedSubjects: subjects,
  }), [registration.schoolGrade, subjectCapabilities, subjects])
  const stableAllowedInitialActions = persistence.mode === "ready_atomic"
    ? READY_INITIAL_ACTIONS
    : INQUIRY_ONLY_INITIAL_ACTIONS

  useEffect(() => {
    const reconciled = reconcileRegistrationInitialWorkflowCapabilities(draft, stableAllowedInitialActions)
    if (reconciled !== draft) onDraftChange(reconciled)
  }, [draft, onDraftChange, stableAllowedInitialActions])

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
    const canPlanInitialWorkflow = writable && persistence.mode === "ready_atomic"
    return {
      ...base,
      inquiry: { ...base.inquiry, lockReason: inquiryLockReason },
      level_test: canPlanInitialWorkflow
        ? { ...base.level_test, editable: true, lockReason: "" }
        : base.level_test,
      consultation: canPlanInitialWorkflow
        ? { ...base.consultation, editable: true, lockReason: "" }
        : base.consultation,
      history: { ...base.history, lockReason: "첫 저장 후 자동 기록됩니다" },
    }
  }, [draft, inquiryLockReason, persistence.mode, subjects, writable])
  const initialFieldsProps = {
    subjects,
    draft,
    resolvedDirectorIds,
    directorOptionsBySubject,
    disabled,
    catalogControlsDisabled: catalogState.catalogControlsDisabled,
    catalogLockReason: catalogState.lockReason,
    onChange: onDraftChange,
  }

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
      tracks={subjects.map((subject) => ({
        key: subject,
        subject,
        statusLabel: INITIAL_ACTION_LABEL[draft.subjectPlans[subject] || "inquiry"],
      }))}
      progress={<RegistrationApplicationProgressStepper steps={getRegistrationApplicationProgress("inquiry")} />}
      sectionStates={sectionStates}
      sectionNotices={catalogState.showLocalStatus ? {
        consultation: (
          <div
            data-registration-catalog-status={catalogState.status}
            data-registration-state={catalogFailed ? "failed" : "locked"}
            role={catalogFailed ? "alert" : "status"}
            aria-live="polite"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <span>{catalogState.lockReason}</span>
            {catalogState.showLocalRetry && onRetryCatalog ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetryCatalog}
              >
                다시 불러오기
              </Button>
            ) : null}
          </div>
        ),
      } : undefined}
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
              inquiryAtLabel="저장 시 자동 기록"
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
      levelTest={(
        <RegistrationApplicationLevelTestSection editable={sectionStates.level_test.editable}>
          <RegistrationInitialLevelTestFields {...initialFieldsProps} disabled={!sectionStates.level_test.editable} />
        </RegistrationApplicationLevelTestSection>
      )}
      consultation={(
        <RegistrationApplicationConsultationSection editable={sectionStates.consultation.editable}>
          <RegistrationInitialConsultationFields {...initialFieldsProps} disabled={!sectionStates.consultation.editable} />
        </RegistrationApplicationConsultationSection>
      )}
      waitingState={sectionStates.placement}
      registrationState={sectionStates.placement}
      waiting={(
        <RegistrationApplicationPlacementSection
          editable={sectionStates.placement.editable}
          fields={(
            <div className="grid gap-3 md:grid-cols-2">
              <Label className="grid gap-1.5">
                <span>대기 종류</span>
                <select defaultValue="" disabled className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">첫 저장 후 선택</option>
                </select>
              </Label>
              <ReadonlyCreateField label="대기 수업" />
            </div>
          )}
        />
      )}
      registration={(
        <RegistrationApplicationPlacementSection
          editable={sectionStates.placement.editable}
          fields={(
            <div className="grid gap-3 md:grid-cols-2">
              <ReadonlyCreateField label="등록 단계" />
              <ReadonlyCreateField label="수강 수업" focusKey="classId" />
              <ReadonlyCreateField label="교재" focusKey="textbookId" />
              <ReadonlyCreateField label="수업 시작일·회차" focusKey="classStartDate" ariaLabel="수업 시작 일정" />
            </div>
          )}
        />
      )}
      admission={(
        <RegistrationApplicationAdmissionSection
          editable={sectionStates.admission.editable}
          fields={(
            <RegistrationAdmissionProgress steps={[
              { key: "admissionNotice", label: "입학신청서 발송", complete: false, locked: true },
              { key: "makeedu", label: "메이크에듀 등록(수업, 교재)", complete: false, locked: true },
              { key: "invoice", label: "청구서 발송", complete: false, locked: true },
              { key: "payment", label: "수납 완료 확인", complete: false, locked: true },
              { key: "complete", label: "등록 완료", complete: false, locked: true },
            ]} />
          )}
        />
      )}
    />
  )
}

function ReadonlyCreateField({
  label,
  value = "첫 저장 후 입력",
  focusKey,
  ariaLabel,
}: {
  label: string
  value?: string
  focusKey?: string
  ariaLabel?: string
}) {
  return (
    <Label className="grid gap-1.5" data-registration-focus={focusKey} aria-label={ariaLabel}>
      <span>{label}</span>
      <Input value={value} readOnly disabled />
    </Label>
  )
}
