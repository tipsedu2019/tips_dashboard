"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import {
  RegistrationInquiryCommonFields,
  toRegistrationInquiryDateTimeLocal,
  type RegistrationInquiryFieldName,
} from "./registration-application-inquiry-fields"
import {
  beginRegistrationConflictComparison,
  reconcileRegistrationEditorDraft,
  settleRegistrationConflictComparison,
  type RegistrationConflictComparison,
} from "./registration-application-model"
import { RegistrationSubjectPicker } from "./registration-subject-picker"
import { RegistrationSaveButton } from "./registration-save-button"
import {
  createRegistrationMutationRequestKey,
  type OpsRegistrationCaseDetail,
  type RegistrationSubject,
} from "./registration-track-service"
import {
  ACADEMIC_SUBJECT_VALUES,
  sortAcademicSubjects,
} from "../../lib/academic-subject-registry.ts"

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

export type RegistrationInquirySaveOutcome = "saved" | "partial" | "conflict"

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
  canEdit,
  onSave,
  onReload,
  onWarning,
  onDirtyChange,
}: {
  detail: OpsRegistrationCaseDetail
  canEdit: boolean
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
    inquiryAt: toRegistrationInquiryDateTimeLocal(registration.inquiryAt),
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

  const conflictRows = conflictAttempt?.latestReady
    ? registrationInquiryConflictRows(conflictAttempt.attempted, canonicalDraft)
    : []

  function update<K extends keyof RegistrationInquiryDraft>(field: K, value: RegistrationInquiryDraft[K]) {
    setValidationError("")
    setConflictAttempt(null)
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function updateInquiryField(field: RegistrationInquiryFieldName, value: string) {
    update(field, value)
  }

  function toggleSubject(subject: RegistrationSubject, selected: boolean) {
    update("subjects", selected
      ? sortAcademicSubjects([...draft.subjects, subject]) as RegistrationSubject[]
      : draft.subjects.filter((value) => value !== subject))
  }

  async function submit() {
    if (!canEdit || saving || refreshPending || conflictAttempt) return
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
      } else if (outcome === "saved") {
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
      const message = errorMessage(error, "문의 정보를 저장하지 못했습니다.")
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
      <RegistrationSubjectPicker
        value={draft.subjects}
        options={ACADEMIC_SUBJECT_VALUES}
        grade={draft.schoolGrade}
        disabled={!canEdit || saving || refreshPending || Boolean(conflictAttempt)}
        onToggle={toggleSubject}
      />
      <RegistrationInquiryCommonFields
        values={draft}
        disabled={!canEdit || saving || refreshPending || Boolean(conflictAttempt)}
        onChange={updateInquiryField}
      />
      {canEdit ? (
        <div className="flex justify-end">
          <RegistrationSaveButton
            type="button"
            size="sm"
            dirty={dirty}
            saving={saving}
            blocked={refreshPending || Boolean(conflictAttempt)}
            actionLabel="변경사항 저장"
            cleanLabel="저장됨"
            aria-label="문의 정보 저장"
            onClick={() => void submit()}
          />
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
