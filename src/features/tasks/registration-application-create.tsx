"use client"

import { useEffect, useMemo, type ReactNode } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { RegistrationApplicationAdmissionSection } from "./registration-application-admission-section"
import { RegistrationApplicationConsultationSection } from "./registration-application-consultation-section"
import { RegistrationApplicationInquirySection } from "./registration-application-inquiry-section"
import { RegistrationApplicationLevelTestSection } from "./registration-application-level-test-section"
import { getRegistrationCreateSectionStates } from "./registration-application-model"
import { RegistrationApplicationPlacementSection } from "./registration-application-placement-section"
import { RegistrationApplicationShell } from "./registration-application-shell"
import {
  getRegistrationInitialWorkflowParticipants,
  reconcileRegistrationInitialWorkflowCapabilities,
  type RegistrationInitialAction,
  type RegistrationInitialPersistenceProbeResult,
  type RegistrationInitialWorkflowDraft,
} from "./registration-intake-workflow"
import {
  RegistrationInitialConsultationFields,
  RegistrationInitialLevelTestFields,
  RegistrationInitialRouteFields,
} from "./registration-initial-plan-control"
import type { OpsTaskInput } from "./ops-task-service"
import type { RegistrationSubject } from "./registration-track-service"
import {
  getRegistrationGradeOptions,
  isValidRegistrationMobilePhone,
  normalizeRegistrationPhone,
  parseRegistrationSubjects,
  serializeRegistrationSubjects,
} from "./registration-workflow"

const READY_INITIAL_ACTIONS = ["inquiry", "direct_phone", "level_test", "visit"] as const
const INQUIRY_ONLY_INITIAL_ACTIONS = ["inquiry"] as const
const SUBJECTS: RegistrationSubject[] = ["영어", "수학"]

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
  disabled: boolean
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
  disabled,
  closeAction,
  onFormPatch,
  onRegistrationFieldChange,
  onDraftChange,
}: RegistrationApplicationCreateProps) {
  const registration = form.registration || {}
  const subjects = parseRegistrationSubjects(form.subject) as RegistrationSubject[]
  const stableAllowedInitialActions = persistence.mode === "ready_atomic"
    ? READY_INITIAL_ACTIONS
    : INQUIRY_ONLY_INITIAL_ACTIONS

  useEffect(() => {
    const reconciled = reconcileRegistrationInitialWorkflowCapabilities(draft, stableAllowedInitialActions)
    if (reconciled !== draft) onDraftChange(reconciled)
  }, [draft, onDraftChange, stableAllowedInitialActions])

  const levelTestSubjects = getRegistrationInitialWorkflowParticipants(draft, "level_test")
  const consultationSubjects = subjects.filter((subject) => (
    draft.subjectPlans[subject] === "direct_phone" || draft.subjectPlans[subject] === "visit"
  ))
  const writable = !disabled && ["ready_atomic", "canonical_inquiry", "legacy_inquiry"].includes(persistence.mode)
  const sectionStates = useMemo(() => {
    const base = getRegistrationCreateSectionStates({ subjects, draft, writable })
    const canPlanInitialWorkflow = writable && persistence.mode === "ready_atomic"
    return {
      ...base,
      level_test: levelTestSubjects.length > 0 && canPlanInitialWorkflow
        ? { ...base.level_test, editable: true, lockReason: "" }
        : base.level_test,
      consultation: consultationSubjects.length > 0 && canPlanInitialWorkflow
        ? { ...base.consultation, editable: true, lockReason: "" }
        : base.consultation,
      history: { ...base.history, lockReason: "첫 저장 후 자동 기록됩니다" },
    }
  }, [consultationSubjects.length, draft, levelTestSubjects.length, persistence.mode, subjects, writable])
  const initialFieldsProps = {
    subjects,
    draft,
    resolvedDirectorIds,
    directorOptionsBySubject,
    disabled,
    onChange: onDraftChange,
  }
  const note = persistenceNote(persistence.mode)

  function updateSubjects(subject: RegistrationSubject, checked: boolean) {
    const next = checked
      ? [...subjects, subject]
      : subjects.filter((item) => item !== subject)
    onFormPatch({ subject: serializeRegistrationSubjects(next) })
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
      sectionStates={sectionStates}
      inquiry={(
        <RegistrationApplicationInquirySection
          mode="create"
          inquiryAt={null}
          editable={sectionStates.inquiry.editable}
          lockReason={sectionStates.inquiry.lockReason}
          commonInfoContent={(
            <div className="grid gap-3 md:grid-cols-2">
              <fieldset className="grid gap-1.5" data-registration-focus="subject">
                <legend className="text-sm font-medium">과목</legend>
                <div className="flex min-h-10 flex-wrap items-center gap-3 rounded-md border px-3 py-2">
                  {SUBJECTS.map((subject) => (
                    <Label key={subject} className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={subjects.includes(subject)}
                        onChange={(event) => updateSubjects(subject, event.target.checked)}
                      />
                      <span>{subject}</span>
                    </Label>
                  ))}
                </div>
              </fieldset>
              <Label className="grid gap-1.5" data-registration-focus="studentName">
                <span>학생명</span>
                <Input
                  value={form.studentName || ""}
                  onChange={(event) => onFormPatch({ studentName: event.target.value })}
                />
              </Label>
              <Label className="grid gap-1.5" data-registration-focus="schoolGrade">
                <span>학년</span>
                <select
                  value={registration.schoolGrade || ""}
                  onChange={(event) => onRegistrationFieldChange("schoolGrade", event.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">미정</option>
                  {getRegistrationGradeOptions().map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                </select>
              </Label>
              <Label className="grid gap-1.5">
                <span>학교</span>
                <Input
                  value={registration.schoolName || ""}
                  onChange={(event) => onRegistrationFieldChange("schoolName", event.target.value)}
                />
              </Label>
              <Label className="grid gap-1.5" data-registration-focus="parentPhone">
                <span>학부모 전화</span>
                <Input
                  inputMode="tel"
                  value={registration.parentPhone || ""}
                  aria-invalid={Boolean(registration.parentPhone && !isValidRegistrationMobilePhone(registration.parentPhone))}
                  onChange={(event) => onRegistrationFieldChange("parentPhone", normalizeRegistrationPhone(event.target.value))}
                />
              </Label>
              <Label className="grid gap-1.5">
                <span>학생 전화</span>
                <Input
                  inputMode="tel"
                  value={registration.studentPhone || ""}
                  onChange={(event) => onRegistrationFieldChange("studentPhone", normalizeRegistrationPhone(event.target.value))}
                />
              </Label>
              <Label className="grid gap-1.5 md:col-span-2">
                <span>요청 사항</span>
                <Textarea
                  value={registration.requestNote || ""}
                  onChange={(event) => onRegistrationFieldChange("requestNote", event.target.value)}
                />
              </Label>
            </div>
          )}
          subjectSyncContent={(
            <RegistrationInitialRouteFields
              {...initialFieldsProps}
              allowedInitialActions={persistence.mode === "ready_atomic"
                ? ["inquiry", "direct_phone", "level_test", "visit"]
                : ["inquiry"]}
              disabled={disabled || !writable}
            />
          )}
          exceptionContent={note ? (
            <p role={persistence.mode.startsWith("blocked_") ? "alert" : "note"} className="text-sm text-muted-foreground">
              {note}
            </p>
          ) : undefined}
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
      placement={(
        <RegistrationApplicationPlacementSection
          editable={sectionStates.placement.editable}
          fields={(
            <div className="grid gap-3 md:grid-cols-2">
              <Label className="grid gap-1.5">
                <span>대기 종류</span>
                <select defaultValue="" className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">첫 저장 후 선택</option>
                </select>
              </Label>
              <Label className="grid gap-1.5">
                <span>수업 시작 일정</span>
                <Input value="" readOnly placeholder="첫 저장 후 입력" />
              </Label>
            </div>
          )}
        />
      )}
      admission={(
        <RegistrationApplicationAdmissionSection
          editable={sectionStates.admission.editable}
          fields={(
            <div className="grid gap-2 md:grid-cols-2">
              {["입학신청서 발송", "메이크에듀 등록(수업, 교재)", "청구서 발송", "수납 완료 확인", "등록 완료"].map((label) => (
                <Label key={label} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <input type="checkbox" checked={false} readOnly />
                  <span>{label}</span>
                </Label>
              ))}
            </div>
          )}
        />
      )}
      history={<div aria-label="자동 이력" />}
    />
  )
}
