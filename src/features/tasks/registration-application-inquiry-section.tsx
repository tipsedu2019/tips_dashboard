"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import {
  RegistrationInquiryCommonFields,
  type RegistrationInquiryFieldName,
} from "./registration-application-inquiry-fields"
import {
  beginRegistrationConflictComparison,
  reconcileRegistrationEditorDraft,
  settleRegistrationConflictComparison,
  type RegistrationConflictComparison,
} from "./registration-application-model"
import { getRegistrationSchoolChoices } from "./registration-school-options"
import { RegistrationSubjectPicker } from "./registration-subject-picker"
import type { RegistrationSubjectCapability } from "./registration-subject-capability-probe"
import { getRegistrationSubjectPickerAvailability } from "./registration-intake-workflow"
import type {
  OpsSchoolOption,
  RegistrationSchoolCatalogStatus,
} from "./ops-task-service"
import {
  createRegistrationMutationRequestKey,
  type OpsRegistrationCaseDetail,
  type RegistrationSubject,
} from "./registration-track-service"
import { isValidRegistrationMobilePhone } from "./registration-workflow"
import { sortAcademicSubjects } from "../../lib/academic-subject-registry.ts"

const COMMITTED_REFRESH_ERROR = "저장은 완료됐지만 최신 내용을 불러오지 못했습니다"

export type RegistrationInquiryDraft = {
  studentName: string
  schoolGrade: string
  schoolName: string
  parentPhone: string
  studentPhone: string
  campus: string
  inquiryAt: string
  requestNote: string
  priority: string
  subjects: RegistrationSubject[]
}

export type RegistrationInquirySaveOutcome = "saved" | "conflict"

const REGISTRATION_INQUIRY_FIELD_LABELS: Record<keyof RegistrationInquiryDraft, string> = {
  studentName: "학생명",
  schoolGrade: "학년",
  schoolName: "학교",
  parentPhone: "학부모 전화",
  studentPhone: "학생 전화",
  campus: "캠퍼스",
  inquiryAt: "문의 일시",
  requestNote: "요청 사항",
  priority: "우선순위",
  subjects: "과목",
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

function toLocalDateTime(value: string | undefined) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const local = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/)
  if (local && !/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return local[1]
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return local?.[1] || ""
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function formatRegistrationInquiryAt(value: string) {
  if (!value) return "기록된 문의 일시가 없습니다"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function useOwnedDirtyState(dirty: boolean, onDirtyChange?: (dirty: boolean) => void) {
  const reportedRef = useRef(false)
  const callbackRef = useRef(onDirtyChange)
  useEffect(() => {
    callbackRef.current = onDirtyChange
  }, [onDirtyChange])
  useEffect(() => {
    if (reportedRef.current === dirty) return
    reportedRef.current = dirty
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => {
    if (reportedRef.current) callbackRef.current?.(false)
  }, [])
}

function focusFirstInvalid(container: HTMLElement | null, selector: string) {
  window.requestAnimationFrame(() => {
    container?.querySelector<HTMLElement>(selector)?.focus()
  })
}

function comparableInquiryDraft(draft: RegistrationInquiryDraft) {
  return {
    ...draft,
    subjects: sortAcademicSubjects(draft.subjects).join(", "),
  }
}

function registrationInquiryConflictRows(
  attempted: RegistrationInquiryDraft,
  latest: RegistrationInquiryDraft,
) {
  const attemptedValues = comparableInquiryDraft(attempted)
  const latestValues = comparableInquiryDraft(latest)
  return (Object.keys(REGISTRATION_INQUIRY_FIELD_LABELS) as Array<keyof RegistrationInquiryDraft>)
    .filter((field) => attemptedValues[field] !== latestValues[field])
    .map((field) => ({
      field,
      label: REGISTRATION_INQUIRY_FIELD_LABELS[field],
      attempted: attemptedValues[field],
      latest: latestValues[field],
    }))
}

function registrationTrackCanBeRemoved(
  detail: OpsRegistrationCaseDetail,
  trackId: string,
) {
  const track = detail.tracks.find((candidate) => candidate.id === trackId)
  if (!track || track.status !== "inquiry" || track.migrationReviewRequired) return false
  if (["manual", "migration"].includes(track.directorAssignmentSource)) return false
  if (detail.levelTests.some((item) => item.trackId === trackId)) return false
  if (detail.consultations.some((item) => item.trackId === trackId)) return false
  if (detail.enrollments.some((item) => item.trackId === trackId)) return false
  return !detail.events.some((event) => (
    event.trackId === trackId && event.eventType !== "director_default_resolved"
  ))
}

function RegistrationRefreshRecovery({
  pending,
  retrying,
  onRetry,
}: {
  pending: boolean
  retrying: boolean
  onRetry: () => void
}) {
  if (!pending) return null
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-950">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-amber-950">
        <span>{COMMITTED_REFRESH_ERROR}</span>
        <Button type="button" size="sm" variant="outline" onClick={onRetry} disabled={retrying}>최신 내용 다시 불러오기</Button>
      </AlertDescription>
    </Alert>
  )
}

export function RegistrationInquiryEditor({
  detail,
  identityLocked,
  canEdit,
  subjectCapabilities,
  schools = [],
  schoolCatalogStatus = "loading",
  schoolCatalogError = "",
  onRetrySchools,
  onSave,
  onReload,
  onWarning,
  onDirtyChange,
}: {
  detail: OpsRegistrationCaseDetail
  identityLocked: boolean
  canEdit: boolean
  subjectCapabilities: readonly RegistrationSubjectCapability[]
  schools?: OpsSchoolOption[]
  schoolCatalogStatus?: "loading" | RegistrationSchoolCatalogStatus
  schoolCatalogError?: string
  onRetrySchools?: () => void
  onSave: (draft: RegistrationInquiryDraft, requestKey: string) => Promise<RegistrationInquirySaveOutcome>
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const registration = detail.task.registration || {}
  const canonicalSubjects = sortAcademicSubjects(detail.tracks.map((track) => track.subject)) as RegistrationSubject[]
  const canonicalDraft: RegistrationInquiryDraft = {
    studentName: detail.task.studentName || "",
    schoolGrade: registration.schoolGrade || "",
    schoolName: registration.schoolName || "",
    parentPhone: registration.parentPhone || "",
    studentPhone: registration.studentPhone || "",
    campus: detail.task.campus || "본관",
    inquiryAt: toLocalDateTime(registration.inquiryAt || detail.task.createdAt),
    requestNote: registration.requestNote || "",
    priority: detail.task.priority || "normal",
    subjects: canonicalSubjects,
  }
  const canonicalDraftKey = `${detail.task.id}:${detail.commonRevision}:${canonicalSubjects.join("|")}`
  const canonicalDraftValue = JSON.stringify(canonicalDraft)
  const canonicalDraftKeyRef = useRef(canonicalDraftKey)
  const requestKeysRef = useRef(new Map<string, string>())
  const sectionRef = useRef<HTMLElement | null>(null)
  const [draft, setDraft] = useState<RegistrationInquiryDraft>(() => canonicalDraft)
  const [saving, setSaving] = useState(false)
  const [refreshPending, setRefreshPending] = useState(false)
  const [validationError, setValidationError] = useState("")
  const [conflictAttempt, setConflictAttempt] = useState<RegistrationConflictComparison<RegistrationInquiryDraft> | null>(null)
  const dirty = JSON.stringify(draft) !== canonicalDraftValue || Boolean(conflictAttempt)
  useOwnedDirtyState(dirty && !refreshPending, onDirtyChange)

  useEffect(() => {
    setDraft((current) => {
      const reconciled = reconcileRegistrationEditorDraft({
        currentDraft: current,
        previousCanonicalKey: canonicalDraftKeyRef.current,
        nextCanonicalKey: canonicalDraftKey,
        nextCanonicalDraft: JSON.parse(canonicalDraftValue) as RegistrationInquiryDraft,
      })
      canonicalDraftKeyRef.current = reconciled.canonicalKey
      return reconciled.draft
    })
  }, [canonicalDraftKey, canonicalDraftValue])

  const availability = getRegistrationSubjectPickerAvailability({
    capabilities: subjectCapabilities,
    grade: draft.schoolGrade,
    selectedSubjects: draft.subjects,
  })
  const disabledReasonBySubject = Object.fromEntries(
    Object.entries(availability.disabledReasonBySubject)
      .filter(([subject]) => !draft.subjects.includes(subject as RegistrationSubject)),
  ) as Partial<Record<RegistrationSubject, string>>
  const removableSubjects = new Set(
    detail.tracks
      .filter((track) => registrationTrackCanBeRemoved(detail, track.id))
      .map((track) => track.subject),
  )
  const disabledSubjects = new Set(availability.options.filter((subject) => (
    draft.subjects.includes(subject)
    && (draft.subjects.length === 1 || (
      canonicalSubjects.includes(subject) && !removableSubjects.has(subject)
    ))
  )))
  const scienceGradeInvalid = draft.subjects.includes("과학")
    && !["고1", "고2", "고3"].includes(draft.schoolGrade.replace(/\s+/g, ""))
  const valid = Boolean(
    draft.subjects.length > 0
    && draft.studentName.trim()
    && draft.schoolGrade.trim()
    && isValidRegistrationMobilePhone(draft.parentPhone)
    && draft.campus.trim()
    && draft.inquiryAt
    && !scienceGradeInvalid,
  )
  const conflictRows = conflictAttempt?.latestReady
    ? registrationInquiryConflictRows(conflictAttempt.attempted, canonicalDraft)
    : []

  function update<K extends keyof RegistrationInquiryDraft>(field: K, value: RegistrationInquiryDraft[K]) {
    setValidationError("")
    setConflictAttempt(null)
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function updateSchoolGrade(nextGrade: string) {
    const catalogChoices = getRegistrationSchoolChoices({ schools, grade: nextGrade })
    setValidationError("")
    setConflictAttempt(null)
    setDraft((current) => ({
      ...current,
      schoolGrade: nextGrade,
      schoolName: identityLocked || schoolCatalogStatus !== "authoritative"
        ? current.schoolName
        : catalogChoices.some((choice) => choice.value === current.schoolName)
          ? current.schoolName
          : "",
    }))
  }

  function updateInquiryField(field: RegistrationInquiryFieldName, value: string) {
    if (field === "schoolGrade") {
      updateSchoolGrade(value)
      return
    }
    update(field, value)
  }

  function toggleSubject(subject: RegistrationSubject, selected: boolean) {
    update("subjects", selected
      ? sortAcademicSubjects([...draft.subjects, subject]) as RegistrationSubject[]
      : draft.subjects.filter((value) => value !== subject))
  }

  async function submit() {
    if (!canEdit || saving || refreshPending || conflictAttempt) return
    if (!valid) {
      const message = scienceGradeInvalid
        ? "과학은 고1~고3에서만 선택할 수 있습니다."
        : "필수 문의 정보와 과목을 확인하고 올바르게 입력하세요."
      setValidationError(message)
      const invalidSelector = draft.subjects.length === 0 || scienceGradeInvalid
        ? '[data-registration-focus="subject"] button'
        : !draft.studentName.trim()
          ? '[data-common-field="student-name"]'
          : !draft.schoolGrade.trim()
            ? '[data-common-field="school-grade"]'
            : !isValidRegistrationMobilePhone(draft.parentPhone)
              ? '[data-common-field="parent-phone"]'
              : '[data-common-field="student-name"]'
      focusFirstInvalid(sectionRef.current, invalidSelector)
      return
    }
    const attemptedDraft: RegistrationInquiryDraft = {
      ...draft,
      studentName: draft.studentName.trim(),
      schoolGrade: draft.schoolGrade.trim(),
      schoolName: draft.schoolName.trim(),
      parentPhone: draft.parentPhone.trim(),
      studentPhone: draft.studentPhone.trim(),
      campus: draft.campus.trim(),
      requestNote: draft.requestNote.trim(),
      subjects: sortAcademicSubjects(draft.subjects) as RegistrationSubject[],
    }
    const payloadKey = JSON.stringify({
      taskId: detail.task.id,
      expectedCommonRevision: detail.commonRevision,
      expectedSubjects: canonicalSubjects,
      ...attemptedDraft,
    })
    const kind = "registration-inquiry"
    const logicalKey = `${kind}:${payloadKey}`
    const requestKey = requestKeysRef.current.get(logicalKey)
      || createRegistrationMutationRequestKey(kind, payloadKey)
    requestKeysRef.current.set(logicalKey, requestKey)
    setSaving(true)
    setValidationError("")
    try {
      const outcome = await onSave(attemptedDraft, requestKey)
      requestKeysRef.current.delete(logicalKey)
      if (outcome === "conflict") {
        const comparison = beginRegistrationConflictComparison(attemptedDraft)
        setConflictAttempt(comparison)
        try {
          await onReload()
          setConflictAttempt(settleRegistrationConflictComparison(comparison, { succeeded: true }))
          onWarning("다른 사용자가 문의 정보나 과목을 변경했습니다. 내 입력과 최신 저장 값을 비교하세요.")
        } catch {
          const refreshMessage = "다른 사용자의 변경을 감지했지만 최신 정보를 다시 불러오지 못했습니다."
          setConflictAttempt(settleRegistrationConflictComparison(comparison, { succeeded: false, error: refreshMessage }))
          onWarning(refreshMessage)
        }
      } else {
        setConflictAttempt(null)
        onDirtyChange?.(false)
        setRefreshPending(true)
        try {
          await onReload()
          setRefreshPending(false)
        } catch {
          onWarning(COMMITTED_REFRESH_ERROR)
        }
      }
    } catch (error) {
      const rawMessage = errorMessage(error, "문의 정보를 저장하지 못했습니다.")
      const message = rawMessage.includes("registration_subject_removal_blocked")
        ? "이미 진행 이력이 있는 과목은 삭제할 수 없습니다. 해당 과목을 완료 처리하세요."
        : rawMessage
      setValidationError(message)
      onWarning(message)
    } finally {
      setSaving(false)
    }
  }

  async function retryConflictRefresh() {
    if (saving || !conflictAttempt) return
    setSaving(true)
    try {
      await onReload()
      setConflictAttempt((current) => current
        ? settleRegistrationConflictComparison(current, { succeeded: true })
        : current)
    } catch (error) {
      const refreshMessage = errorMessage(error, "최신 문의 정보를 다시 불러오지 못했습니다.")
      setConflictAttempt((current) => current
        ? settleRegistrationConflictComparison(current, { succeeded: false, error: refreshMessage })
        : current)
      onWarning(refreshMessage)
    } finally {
      setSaving(false)
    }
  }

  async function retryRefresh() {
    if (saving) return
    setSaving(true)
    try {
      await onReload()
      setRefreshPending(false)
    } catch {
      onWarning("최신 내용을 불러오지 못했습니다. 잠시 후 다시 시도하세요.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section ref={sectionRef} className="grid min-w-0 gap-3" aria-label="등록 문의 정보">
      <RegistrationRefreshRecovery pending={refreshPending} retrying={saving} onRetry={() => void retryRefresh()} />
      {conflictAttempt ? (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
          <AlertTitle>다른 사용자가 문의 정보를 먼저 저장했습니다.</AlertTitle>
          <AlertDescription className="grid justify-items-stretch gap-3 text-amber-950">
            <p className="text-xs">내가 입력한 값과 최신 저장 값을 확인한 뒤 사용할 내용을 선택하세요.</p>
            {!conflictAttempt.latestReady ? (
              <div className="grid gap-2">
                <p className="text-xs">내 입력은 보존했습니다. 최신 저장 값을 불러온 뒤 비교할 수 있습니다.</p>
                {conflictAttempt.refreshError ? <p className="text-xs">{conflictAttempt.refreshError}</p> : null}
                <div className="flex justify-end">
                  <Button type="button" size="sm" variant="outline" onClick={() => void retryConflictRefresh()} disabled={saving}>최신 정보 다시 불러오기</Button>
                </div>
              </div>
            ) : conflictRows.length > 0 ? (
              <div className="grid gap-2">
                {conflictRows.map((row) => (
                  <dl key={row.field} className="grid gap-1 rounded-md border bg-background p-2 sm:grid-cols-2">
                    <div><dt className="text-xs font-medium">{row.label} · 내가 입력한 값</dt><dd className="break-words">{row.attempted || "입력 없음"}</dd></div>
                    <div><dt className="text-xs font-medium">{row.label} · 최신 저장 값</dt><dd className="break-words">{row.latest || "입력 없음"}</dd></div>
                  </dl>
                ))}
              </div>
            ) : <p className="text-xs">표시할 값 차이가 없습니다. 최신 값을 사용하세요.</p>}
            {conflictAttempt.latestReady ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  setDraft({ ...canonicalDraft })
                  setConflictAttempt(null)
                }}>최신 값 사용</Button>
                <Button type="button" size="sm" onClick={() => {
                  setDraft({ ...conflictAttempt.attempted })
                  setConflictAttempt(null)
                  focusFirstInvalid(sectionRef.current, "[data-common-field]")
                }}>내 입력 다시 적용</Button>
              </div>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {identityLocked ? (
        <div className="flex justify-end"><Badge variant="secondary">학생 연결 보정 필요</Badge></div>
      ) : null}
      <RegistrationSubjectPicker
        value={draft.subjects}
        options={availability.options}
        grade={draft.schoolGrade}
        disabledReasonBySubject={disabledReasonBySubject}
        disabled={!canEdit || saving || refreshPending || Boolean(conflictAttempt)}
        disabledSubjects={disabledSubjects}
        onToggle={toggleSubject}
      />
      <RegistrationInquiryCommonFields
        values={draft}
        inquiryAtLabel={formatRegistrationInquiryAt(draft.inquiryAt)}
        schoolChoices={getRegistrationSchoolChoices({
          schools,
          grade: draft.schoolGrade,
          currentSchoolName: draft.schoolName,
        })}
        schoolCatalogStatus={schoolCatalogStatus}
        schoolCatalogError={schoolCatalogError}
        disabled={!canEdit || saving || refreshPending || Boolean(conflictAttempt)}
        disabledFields={{
          studentName: identityLocked,
          schoolName: identityLocked,
          parentPhone: identityLocked,
          studentPhone: identityLocked,
        }}
        onChange={updateInquiryField}
        onRetrySchools={onRetrySchools}
      />
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => void submit()} disabled={saving || refreshPending || Boolean(conflictAttempt)}>
            {saving ? "저장 중" : "저장"}
          </Button>
        </div>
      ) : null}
      {validationError ? <p role="alert" className="text-xs text-destructive">{validationError}</p> : null}
    </section>
  )
}

export type RegistrationApplicationInquirySectionProps = {
  mode: "create" | "detail"
  editable: boolean
  lockReason: string
  editorContent?: ReactNode
  commonInfoContent?: ReactNode
  subjectSyncContent?: ReactNode
  subjectNavigationContent?: ReactNode
  exceptionContent?: ReactNode
}

export function RegistrationApplicationInquirySection({
  editable,
  editorContent,
  commonInfoContent,
  subjectSyncContent,
  subjectNavigationContent,
  exceptionContent,
}: RegistrationApplicationInquirySectionProps) {
  return (
    <div className="grid gap-4" aria-disabled={!editable}>
      {editorContent ? <div className="grid gap-3">{editorContent}</div> : (
        <>
          <div className="grid gap-3">{subjectSyncContent}</div>
          <div className="grid gap-3">{commonInfoContent}</div>
        </>
      )}
      {subjectNavigationContent ? <div className="grid gap-2 border-t pt-4">{subjectNavigationContent}</div> : null}
      {exceptionContent ? <div className="grid gap-3">{exceptionContent}</div> : null}
    </div>
  )
}
