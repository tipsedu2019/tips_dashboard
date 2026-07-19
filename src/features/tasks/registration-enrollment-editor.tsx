"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, RefreshCw, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import {
  loadOpsRegistrationClassDetails,
  type OpsClassOption,
  type OpsRegistrationClassDetail,
  type OpsTextbookOption,
} from "./ops-task-service"
import {
  applyRegistrationEnrollmentClassSelection,
  createRegistrationEnrollmentDraft,
  getRegistrationAdmissionApplicationState,
  getRegistrationAdmissionBatchCancellationGroups,
  getRegistrationAdmissionBatchChecklist,
  getRegistrationAdmissionRecoveryDelayMs,
  getRegistrationEnrollmentBlockers,
  getRegistrationEnrollmentCancellationState,
  getRegistrationSelectedAdmissionEnrollmentIds,
  mergeSavedRegistrationEnrollmentRows,
  restoreRegistrationEnrollmentDraft,
  serializeRegistrationEnrollmentRows,
  type RegistrationEnrollmentDraft,
} from "./registration-track-model.js"
import { getSelectableRegistrationScheduleSessions } from "./registration-workflow"
import {
  advanceRegistrationAdmissionBatch,
  cancelRegistrationAdmissionBatch,
  cancelRegistrationEnrollment,
  completeRegistrationAdmissionBatch,
  createRegistrationMutationRequestKey,
  routeRegistrationEnrollmentDecision,
  saveRegistrationEnrollmentRows,
  setRegistrationEnrollmentMakeedu,
  startRegistrationAdmissionBatch,
  type OpsRegistrationAdmissionBatch,
  type OpsRegistrationEnrollment,
  type OpsRegistrationTrackSummary,
  type RegistrationAdmissionProviderEvidence,
  type RegistrationWaitingKind,
} from "./registration-track-service"

type RegistrationManagementPermissions = {
  canManage: boolean
  readOnly?: boolean
}

type SubmissionKeys = {
  getOrCreate: (kind: string, entityId: string) => string
  clear: (kind: string, entityId: string) => void
}

const WAITING_KIND_OPTIONS: Array<{ value: Exclude<RegistrationWaitingKind, "">; label: string }> = [
  { value: "current_class", label: "현재 학기 수강반 대기" },
  { value: "current_term_opening", label: "현재 학기 개강반 대기" },
  { value: "next_term_opening", label: "다음 학기 개강반 대기" },
]

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

function useSubmissionKeys(): SubmissionKeys {
  const keysRef = useRef(new Map<string, string>())
  return {
    getOrCreate(kind, entityId) {
      const logicalKey = `${kind}:${entityId}`
      const current = keysRef.current.get(logicalKey)
      if (current) return current
      const next = createRegistrationMutationRequestKey(kind, entityId)
      keysRef.current.set(logicalKey, next)
      return next
    },
    clear(kind, entityId) {
      keysRef.current.delete(`${kind}:${entityId}`)
    },
  }
}

function useAdmissionRecoveryAvailable(updatedAt: string | null) {
  const [recoveryClock, setRecoveryClock] = useState(() => Date.now())
  useEffect(() => {
    const delay = getRegistrationAdmissionRecoveryDelayMs(updatedAt, Date.now())
    if (delay === null || delay === 0) return
    const timer = setTimeout(() => setRecoveryClock(Date.now()), delay + 1)
    return () => clearTimeout(timer)
  }, [updatedAt])
  return getRegistrationAdmissionRecoveryDelayMs(updatedAt, recoveryClock) === 0
}

function toDraft(enrollment: OpsRegistrationEnrollment): RegistrationEnrollmentDraft {
  return restoreRegistrationEnrollmentDraft({
    ...enrollment,
  })
}

function isMutableDraft(enrollment: OpsRegistrationEnrollment) {
  return enrollment.status === "planned"
    && !enrollment.admissionBatchId
    && !enrollment.studentId
    && !enrollment.rosterActive
}

function enrollmentHistoryLabel(enrollment: OpsRegistrationEnrollment) {
  if (enrollment.status === "canceled") return "수강 취소"
  if (enrollment.status === "enrolled" && !enrollment.rosterActive) {
    const source = enrollment.rosterReleaseKind === "transfer" ? "전반" : enrollment.rosterReleaseKind === "withdrawal" ? "퇴원" : "소유권 해제"
    return `${source} 이력`
  }
  if (enrollment.status === "enrolled") return "수강 중"
  if (enrollment.status === "waitlisted") return "대기"
  return enrollment.admissionBatchId ? "입학 처리 중" : "저장됨"
}

export type RegistrationEnrollmentEditorProps = {
  taskId: string
  viewerId: string
  track: OpsRegistrationTrackSummary
  enrollments: OpsRegistrationEnrollment[]
  admissionBatches: OpsRegistrationAdmissionBatch[]
  classes: OpsClassOption[]
  textbooks: OpsTextbookOption[]
  permissions: RegistrationManagementPermissions
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
}

export function RegistrationEnrollmentEditor({
  taskId,
  viewerId,
  track,
  enrollments,
  admissionBatches,
  classes,
  textbooks,
  permissions,
  onReload,
  onWarning,
}: RegistrationEnrollmentEditorProps) {
  const trackEnrollments = useMemo(
    () => enrollments.filter((enrollment) => enrollment.trackId === track.id),
    [enrollments, track.id],
  )
  const initialMutableRows = trackEnrollments.filter(isMutableDraft)
  const [draftRows, setDraftRows] = useState<RegistrationEnrollmentDraft[]>(() => (
    initialMutableRows.length > 0
      ? initialMutableRows.map(toDraft)
      : track.status === "enrollment_decided"
        ? [createRegistrationEnrollmentDraft({ clientKey: createRegistrationMutationRequestKey("enrollment-row", `${taskId}:${track.id}`) })]
        : []
  ))
  const [classDetailById, setClassDetailById] = useState<Record<string, OpsRegistrationClassDetail | null>>({})
  const [loadingClassIds, setLoadingClassIds] = useState<Set<string>>(() => new Set())
  const [classDetailRetryToken, setClassDetailRetryToken] = useState(0)
  const [saving, setSaving] = useState(false)
  const [refreshPending, setRefreshPending] = useState(false)
  const [cancelEnrollmentId, setCancelEnrollmentId] = useState("")
  const [cancelReason, setCancelReason] = useState("")
  const [cancelDestination, setCancelDestination] = useState<"" | "enrollment_decided" | "waiting" | "not_registered">("")
  const [cancelWaitingKind, setCancelWaitingKind] = useState<RegistrationWaitingKind>("")
  const [cancelClassId, setCancelClassId] = useState("")
  const [decisionDestination, setDecisionDestination] = useState<"" | "waiting" | "not_registered">("")
  const [decisionWaitingKind, setDecisionWaitingKind] = useState<RegistrationWaitingKind>("")
  const [decisionClassId, setDecisionClassId] = useState("")
  const [decisionReason, setDecisionReason] = useState("")
  const submissionKeys = useSubmissionKeys()
  const subjectClasses = useMemo(
    () => classes.filter((classItem) => classItem.subject.trim() === track.subject),
    [classes, track.subject],
  )
  const textbookIds = useMemo(() => textbooks.map((textbook) => textbook.id), [textbooks])
  const selectedClassIds = useMemo(
    () => Array.from(new Set(draftRows.map((row) => row.classId).filter(Boolean))),
    [draftRows],
  )
  const selectedClassIdsKey = selectedClassIds.join("|")
  const openBatch = admissionBatches.find((batch) => !["completed", "canceled"].includes(batch.status)) || null
  const trackHasOpenBatch = Boolean(openBatch && trackEnrollments.some((enrollment) => enrollment.admissionBatchId === openBatch.id))
  const canEditRows = permissions.canManage
    && ["enrollment_decided", "registered"].includes(track.status)
    && !trackHasOpenBatch
    && !refreshPending
  const selectedCancelEnrollment = trackEnrollments.find((item) => item.id === cancelEnrollmentId) || null
  const selectedEnrollmentCancellation = getRegistrationEnrollmentCancellationState({
    enrollment: selectedCancelEnrollment,
    enrollments: trackEnrollments,
  })

  useEffect(() => {
    const missingClassIds = selectedClassIds.filter((classId) => !(classId in classDetailById))
    if (missingClassIds.length === 0 || !viewerId) return
    let disposed = false
    setLoadingClassIds((current) => new Set([...current, ...missingClassIds]))
    void loadOpsRegistrationClassDetails(missingClassIds, { viewerId }).then((results) => {
      if (disposed) return
      setClassDetailById((current) => {
        const next = { ...current }
        for (const [classId, detail] of Object.entries(results)) {
          next[classId] = detail?.id === classId ? detail : null
        }
        return next
      })
    }).catch((error) => {
      if (!disposed) {
        setClassDetailById((current) => ({
          ...current,
          ...Object.fromEntries(missingClassIds.map((classId) => [classId, null])),
        }))
        onWarning(errorMessage(error, "선택한 수업 일정을 불러오지 못했습니다."))
      }
    }).finally(() => {
      if (!disposed) {
        setLoadingClassIds((current) => {
          const next = new Set(current)
          missingClassIds.forEach((classId) => next.delete(classId))
          return next
        })
      }
    })
    return () => {
      disposed = true
    }
  // The key is the exact selected-ID set. Loaded details are intentionally not a dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classDetailRetryToken, selectedClassIdsKey, viewerId])

  useEffect(() => {
    setDraftRows((current) => {
      let changed = false
      const next = current.map((row) => {
        const detail = row.classId ? classDetailById[row.classId] : null
        if (!detail || row.textbookId || row.textbookExplicitlyCleared) return row
        const withDefault = applyRegistrationEnrollmentClassSelection(row, {
          classItem: detail,
          availableTextbookIds: textbookIds,
        })
        if (!withDefault.textbookId) return row
        changed = true
        return { ...row, textbookId: withDefault.textbookId }
      })
      return changed ? next : current
    })
  }, [classDetailById, textbookIds])

  const validScheduleSessionKeysByClassId = useMemo(() => Object.fromEntries(
    selectedClassIds.map((classId) => [
      classId,
      getSelectableRegistrationScheduleSessions(classDetailById[classId]?.schedulePlan).map((session) => session.value),
    ]),
  ), [classDetailById, selectedClassIds])
  const validTextbookIdsByClassId = useMemo(() => Object.fromEntries(
    selectedClassIds.map((classId) => [
      classId,
      (classDetailById[classId]
        || subjectClasses.find((classItem) => classItem.id === classId))?.textbookIds || [],
    ]),
  ), [classDetailById, selectedClassIds, subjectClasses])

  const activeEnrollmentRows = useMemo(
    () => trackEnrollments.filter((enrollment) => enrollment.status === "enrolled" && enrollment.rosterActive).map(toDraft),
    [trackEnrollments],
  )
  const blockers = useMemo(() => {
    const draftClientKeys = new Set(draftRows.map((row) => row.clientKey))
    return getRegistrationEnrollmentBlockers({
      subject: track.subject,
      rows: [...activeEnrollmentRows, ...draftRows],
      classes: subjectClasses,
      availableTextbookIds: textbookIds,
      validTextbookIdsByClassId,
      validScheduleSessionKeysByClassId,
      requireSchedule: false,
    }).filter((blocker) => draftClientKeys.has(blocker.rowId))
  }, [activeEnrollmentRows, draftRows, subjectClasses, textbookIds, track.subject, validScheduleSessionKeysByClassId, validTextbookIdsByClassId])

  function updateRow(clientKey: string, patch: Partial<RegistrationEnrollmentDraft>) {
    if (!canEditRows) return
    setDraftRows((current) => current.map((row) => row.clientKey === clientKey ? { ...row, ...patch } : row))
  }

  function selectClass(clientKey: string, classId: string) {
    const classItem = subjectClasses.find((item) => item.id === classId) || null
    setDraftRows((current) => current.map((row) => row.clientKey === clientKey
      ? applyRegistrationEnrollmentClassSelection(row, { classItem, availableTextbookIds: textbookIds })
      : row))
  }

  function addRow() {
    if (!canEditRows) return
    setDraftRows((current) => [...current, createRegistrationEnrollmentDraft({
      clientKey: createRegistrationMutationRequestKey("enrollment-row", `${taskId}:${track.id}:${current.length}`),
      sortOrder: current.length,
    })])
  }

  function retryClassDetail(classId: string) {
    setClassDetailById((current) => {
      const next = { ...current }
      delete next[classId]
      return next
    })
    setClassDetailRetryToken((current) => current + 1)
  }

  async function reloadCommitted(message: string) {
    try {
      await onReload()
      setRefreshPending(false)
    } catch {
      setRefreshPending(true)
      onWarning(message)
    }
  }

  async function retryEnrollmentReload() {
    try {
      await onReload()
      setRefreshPending(false)
    } catch {
      setRefreshPending(true)
      onWarning("최신 수업 정보를 다시 불러오지 못했습니다.")
    }
  }

  async function saveRows() {
    if (!canEditRows || saving) return
    if (blockers.length > 0) {
      onWarning(blockers[0]?.message || "수업 정보를 확인하세요.")
      return
    }
    const rows = serializeRegistrationEnrollmentRows(draftRows)
    const payloadFingerprint = JSON.stringify(rows)
    const logicalId = `${track.id}:${payloadFingerprint}`
    const requestKey = submissionKeys.getOrCreate("enrollment-rows", logicalId)
    setSaving(true)
    try {
      const saved = await saveRegistrationEnrollmentRows({ trackId: track.id, rows, requestKey })
      const merged = mergeSavedRegistrationEnrollmentRows(draftRows, saved.rows)
      setDraftRows(merged)
      submissionKeys.clear("enrollment-rows", logicalId)
      await reloadCommitted("수업 정보는 저장됐지만 최신 내용을 다시 불러오지 못했습니다.")
    } catch (error) {
      onWarning(errorMessage(error, "수업 정보를 저장하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  async function routeDecision() {
    if (!decisionDestination || !decisionReason.trim() || saving || refreshPending) return
    if (decisionDestination === "waiting" && !decisionWaitingKind) return
    if (decisionDestination === "waiting" && decisionWaitingKind === "current_class" && !decisionClassId) return
    const logicalId = `${track.id}:${decisionDestination}:${decisionWaitingKind}:${decisionClassId}:${decisionReason.trim()}`
    const requestKey = submissionKeys.getOrCreate("enrollment-decision", logicalId)
    setSaving(true)
    try {
      await routeRegistrationEnrollmentDecision({
        trackId: track.id,
        destination: decisionDestination,
        waitingKind: decisionDestination === "waiting" ? decisionWaitingKind : "",
        classId: decisionDestination === "waiting" && decisionWaitingKind === "current_class" ? decisionClassId : "",
        reason: decisionReason.trim(),
        requestKey,
      })
      submissionKeys.clear("enrollment-decision", logicalId)
      await reloadCommitted("단계 변경은 완료됐지만 최신 내용을 다시 불러오지 못했습니다.")
    } catch (error) {
      onWarning(errorMessage(error, "등록 결정을 변경하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  async function cancelPersistedEnrollment() {
    const enrollment = selectedCancelEnrollment
    if (!enrollment || !cancelReason.trim() || saving || refreshPending || trackHasOpenBatch) return
    if (selectedEnrollmentCancellation.requiresDestination && !cancelDestination) return
    const destination = selectedEnrollmentCancellation.requiresDestination ? cancelDestination : ""
    if (destination === "waiting" && !cancelWaitingKind) return
    if (destination === "waiting" && cancelWaitingKind === "current_class" && !cancelClassId) return
    const logicalId = `${enrollment.id}:${destination}:${cancelWaitingKind}:${cancelClassId}:${cancelReason.trim()}`
    const requestKey = submissionKeys.getOrCreate("cancel-enrollment", logicalId)
    setSaving(true)
    try {
      await cancelRegistrationEnrollment({
        enrollmentId: enrollment.id,
        destination,
        waitingKind: destination === "waiting" ? cancelWaitingKind : "",
        classId: destination === "waiting" && cancelWaitingKind === "current_class" ? cancelClassId : "",
        reason: cancelReason.trim(),
        requestKey,
      })
      submissionKeys.clear("cancel-enrollment", logicalId)
      await reloadCommitted("수강 취소는 완료됐지만 최신 내용을 다시 불러오지 못했습니다.")
    } catch (error) {
      onWarning(errorMessage(error, "수강을 취소하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const immutableHistory = trackEnrollments.filter((enrollment) => !isMutableDraft(enrollment))

  return (
    <section className="grid gap-3" aria-label={`${track.subject} 수강 수업`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{track.subject} 수강 수업</h3>
        <Badge variant="outline">{draftRows.length}개 수업</Badge>
      </div>

      {draftRows.map((row, index) => {
        const detail = row.classId ? classDetailById[row.classId] : null
        const sessions = getSelectableRegistrationScheduleSessions(detail?.schedulePlan)
        const linkedTextbookIds = detail?.textbookIds
          || subjectClasses.find((classItem) => classItem.id === row.classId)?.textbookIds
          || []
        const linkedTextbooks = linkedTextbookIds
          .map((id) => textbooks.find((textbook) => textbook.id === id))
          .filter((textbook): textbook is OpsTextbookOption => Boolean(textbook))
        const rowBlockers = blockers.filter((blocker) => blocker.rowId === row.clientKey)
        return (
          <article key={row.clientKey} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto] sm:items-end">
            <Label className="grid gap-1.5">
              <span>수업 {index + 1}</span>
              <select className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm" value={row.classId} onChange={(event) => selectClass(row.clientKey, event.target.value)} disabled={!canEditRows || saving}>
                <option value="">수업 선택</option>
                {subjectClasses.map((classItem) => <option key={classItem.id} value={classItem.id}>{classItem.label}</option>)}
              </select>
            </Label>
            <Label className="grid gap-1.5">
              <span>교재</span>
              <select
                className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm"
                value={row.textbookId}
                onChange={(event) => updateRow(row.clientKey, {
                  textbookId: event.target.value,
                  textbookExplicitlyCleared: event.target.value === "",
                })}
                disabled={!canEditRows || saving || !row.classId}
              >
                <option value="">선택 안 함 · 이미 보유</option>
                {linkedTextbooks.map((textbook) => <option key={textbook.id} value={textbook.id}>{textbook.label}</option>)}
              </select>
            </Label>
            <Label className="grid gap-1.5">
              <span>수업 시작 일정</span>
              <select
                className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm"
                value={row.classStartSessionKey}
                onChange={(event) => {
                  const session = sessions.find((item) => item.value === event.target.value)
                  updateRow(row.clientKey, {
                    classStartDate: session?.dateKey || "",
                    classStartSessionKey: session?.value || "",
                    classStartSession: session?.sessionLabel || "",
                  })
                }}
                disabled={!canEditRows || saving || !row.classId || loadingClassIds.has(row.classId)}
              >
                <option value="">{loadingClassIds.has(row.classId) ? "일정 불러오는 중" : "수업일·회차 선택"}</option>
                {sessions.map((session) => <option key={session.value} value={session.value}>{session.dateKey} · {session.sessionLabel}{session.state === "makeup" ? " · 보강" : ""}</option>)}
              </select>
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (row.id === null) {
                  setDraftRows((current) => current.filter((item) => item.clientKey !== row.clientKey).map((item, order) => ({ ...item, sortOrder: order })))
                  return
                }
                setCancelDestination("")
                setCancelWaitingKind("")
                setCancelClassId("")
                setCancelReason("")
                setCancelEnrollmentId(row.id)
              }}
              disabled={!canEditRows || saving || (row.id === null && draftRows.length === 1 && track.status === "enrollment_decided") || (row.id !== null && trackHasOpenBatch)}
              aria-label={`수업 ${index + 1} ${row.id === null ? "삭제" : "수강 취소"}`}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {row.id === null ? "삭제" : "수강 취소"}
            </Button>
            {rowBlockers.length > 0 ? <p className="text-xs text-destructive sm:col-span-4">{rowBlockers.map((blocker) => blocker.message).join(" · ")}</p> : null}
            {row.classId && classDetailById[row.classId] === null && !loadingClassIds.has(row.classId) ? (
              <Button type="button" variant="outline" size="sm" className="w-fit sm:col-span-4" onClick={() => retryClassDetail(row.classId)}>
                <RefreshCw className="size-4" aria-hidden="true" />
                수업 일정 다시 불러오기
              </Button>
            ) : null}
          </article>
        )
      })}

      {canEditRows ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" onClick={addRow} disabled={saving}>
            <Plus className="size-4" aria-hidden="true" />
            수업 추가
          </Button>
          <Button type="button" onClick={() => void saveRows()} disabled={saving || refreshPending || draftRows.length === 0 || blockers.length > 0}>
            {saving ? "저장 중" : "수업 정보 저장"}
          </Button>
        </div>
      ) : null}

      {refreshPending ? (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void retryEnrollmentReload()}>
          <RefreshCw className="size-4" aria-hidden="true" />
          최신 내용 다시 불러오기
        </Button>
      ) : null}

      {track.status === "enrollment_decided" && permissions.canManage && !trackHasOpenBatch && !refreshPending ? (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">등록 대신 다른 단계로 이동</summary>
          <div className="mt-3 grid gap-3">
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={decisionDestination === "waiting" ? "default" : "outline"} onClick={() => setDecisionDestination("waiting")}>대기로 전환</Button>
              <Button type="button" size="sm" variant={decisionDestination === "not_registered" ? "destructive" : "outline"} onClick={() => setDecisionDestination("not_registered")}>미등록 완료</Button>
            </div>
            {decisionDestination === "waiting" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <select aria-label={`${track.subject} 등록 결정 후 대기 종류`} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={decisionWaitingKind} onChange={(event) => setDecisionWaitingKind(event.target.value as RegistrationWaitingKind)}>
                  <option value="">대기 종류 선택</option>
                  {WAITING_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                {decisionWaitingKind === "current_class" ? (
                  <select aria-label={`${track.subject} 등록 결정 후 대기 수업`} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={decisionClassId} onChange={(event) => setDecisionClassId(event.target.value)}>
                    <option value="">대기 수업 선택</option>
                    {subjectClasses.map((classItem) => <option key={classItem.id} value={classItem.id}>{classItem.label}</option>)}
                  </select>
                ) : null}
              </div>
            ) : null}
            <Textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} placeholder="변경 사유" />
            <Button type="button" variant={decisionDestination === "not_registered" ? "destructive" : "default"} onClick={() => void routeDecision()} disabled={!decisionDestination || !decisionReason.trim() || saving || refreshPending}>단계 변경</Button>
          </div>
        </details>
      ) : null}

      {immutableHistory.length > 0 ? (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">수강 이력 {immutableHistory.length}건</summary>
          <div className="mt-3 grid gap-2">
            {immutableHistory.map((enrollment) => {
              const classLabel = classes.find((classItem) => classItem.id === enrollment.classId)?.label || enrollment.classId
              const canCancel = permissions.canManage
                && !trackHasOpenBatch
                && (enrollment.status === "planned" || (enrollment.status === "enrolled" && enrollment.rosterActive))
              return (
                <div key={enrollment.id} className="grid gap-2 rounded-md bg-muted/30 px-3 py-2 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <div className="font-medium">{classLabel}</div>
                    <div className="text-xs text-muted-foreground">{enrollmentHistoryLabel(enrollment)}{enrollment.classStartDate ? ` · ${enrollment.classStartDate} ${enrollment.classStartSession || ""}` : ""}</div>
                  </div>
                  {canCancel ? <Button type="button" variant="outline" size="sm" onClick={() => setCancelEnrollmentId(enrollment.id)}>수강 취소</Button> : null}
                </div>
              )
            })}
            {trackHasOpenBatch ? <p className="text-xs text-muted-foreground">진행 중인 입학 처리를 먼저 완료하거나 취소하세요.</p> : null}
          </div>
        </details>
      ) : null}

      {permissions.canManage && cancelEnrollmentId ? (
        <section className="grid gap-3 rounded-md border border-destructive/30 p-3">
          <h4 className="text-sm font-semibold">수강 취소</h4>
          <Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="취소 사유" />
          {selectedEnrollmentCancellation.requiresDestination ? (
            <select aria-label={`${track.subject} 수강 취소 후 단계`} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={cancelDestination} onChange={(event) => setCancelDestination(event.target.value as typeof cancelDestination)}>
              <option value="">취소 후 단계 선택</option>
              <option value="enrollment_decided">등록 결정으로 이동</option>
              <option value="waiting">대기로 이동</option>
              <option value="not_registered">미등록 완료</option>
            </select>
          ) : null}
          {selectedEnrollmentCancellation.requiresDestination && cancelDestination === "waiting" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <select aria-label={`${track.subject} 수강 취소 대기 종류`} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={cancelWaitingKind} onChange={(event) => setCancelWaitingKind(event.target.value as RegistrationWaitingKind)}>
                <option value="">대기 종류 선택</option>
                {WAITING_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {cancelWaitingKind === "current_class" ? (
                <select aria-label={`${track.subject} 수강 취소 대기 수업`} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={cancelClassId} onChange={(event) => setCancelClassId(event.target.value)}>
                  <option value="">대기 수업 선택</option>
                  {subjectClasses.map((classItem) => <option key={classItem.id} value={classItem.id}>{classItem.label}</option>)}
                </select>
              ) : null}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => {
              setCancelEnrollmentId("")
              setCancelDestination("")
              setCancelWaitingKind("")
              setCancelClassId("")
              setCancelReason("")
            }} disabled={saving}>닫기</Button>
            <Button type="button" variant="destructive" onClick={() => void cancelPersistedEnrollment()} disabled={!cancelReason.trim() || saving || refreshPending || (selectedEnrollmentCancellation.requiresDestination && !cancelDestination)}>수강 취소 확인</Button>
          </div>
        </section>
      ) : null}
    </section>
  )
}

export type RegistrationAdmissionPanelProps = {
  taskId: string
  tracks: OpsRegistrationTrackSummary[]
  enrollments: OpsRegistrationEnrollment[]
  batches: OpsRegistrationAdmissionBatch[]
  classes: OpsClassOption[]
  admissionNoticeSent: boolean
  admissionApplicationMessageId: string | null
  admissionApplicationMessageStatus: "" | "pending" | "accepted" | "unknown" | "failed_hold"
  admissionApplicationMessageClaimActive: boolean
  admissionApplicationMessageUpdatedAt: string | null
  permissions: RegistrationManagementPermissions
  onSendAdmissionMessage: (input: { taskId: string; requestKey: string }) => Promise<void>
  onCheckAdmissionMessage: (input: { messageId: string }) => Promise<void>
  onReconcileAdmissionMessage: (input: {
    messageId: string
    resolution: "accepted" | "failed"
    providerEvidence: RegistrationAdmissionProviderEvidence
    reason: string
    requestKey: string
  }) => Promise<void>
  onReleaseAdmissionMessageRetry: (input: {
    messageId: string
    providerEvidence: RegistrationAdmissionProviderEvidence
    reason: string
    requestKey: string
  }) => Promise<void>
  onReload: () => void | Promise<void>
  onWarning: (message: string) => void
}

export function RegistrationAdmissionPanel({
  taskId,
  tracks,
  enrollments,
  batches,
  classes,
  admissionNoticeSent,
  admissionApplicationMessageId,
  admissionApplicationMessageStatus,
  admissionApplicationMessageClaimActive,
  admissionApplicationMessageUpdatedAt,
  permissions,
  onSendAdmissionMessage,
  onCheckAdmissionMessage,
  onReconcileAdmissionMessage,
  onReleaseAdmissionMessageRetry,
  onReload,
  onWarning,
}: RegistrationAdmissionPanelProps) {
  const submissionKeys = useSubmissionKeys()
  const [selectedEnrollmentIds, setSelectedEnrollmentIds] = useState<Set<string>>(() => new Set())
  const [busyAction, setBusyAction] = useState("")
  const [refreshPending, setRefreshPending] = useState(false)
  const [evidenceText, setEvidenceText] = useState("{}")
  const [messageReason, setMessageReason] = useState("")
  const [cancelBatchOpen, setCancelBatchOpen] = useState(false)
  const [cancelBatchReason, setCancelBatchReason] = useState("")
  const [cancelDestinations, setCancelDestinations] = useState<Record<string, "" | "waiting" | "not_registered">>({})
  const [cancelWaitingKinds, setCancelWaitingKinds] = useState<Record<string, RegistrationWaitingKind>>({})
  const [cancelClassIds, setCancelClassIds] = useState<Record<string, string>>({})
  const trackById = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks])
  const classById = useMemo(() => new Map(classes.map((classItem) => [classItem.id, classItem])), [classes])
  const openBatch = batches.find((batch) => !["completed", "canceled"].includes(batch.status)) || null
  const currentBatchEnrollments = openBatch
    ? enrollments.filter((enrollment) => enrollment.admissionBatchId === openBatch.id && enrollment.status !== "canceled")
    : []
  const unbatchedPlannedEnrollments = enrollments.filter((enrollment) => (
    enrollment.status === "planned" && !enrollment.admissionBatchId && Boolean(enrollment.id)
  ))
  const activeSelectedEnrollmentIds = getRegistrationSelectedAdmissionEnrollmentIds({
    selectedEnrollmentIds,
    enrollments: unbatchedPlannedEnrollments,
  })
  const activeSelectedEnrollmentIdSet = new Set(activeSelectedEnrollmentIds)
  const selectedEnrollmentsHaveCompleteSchedules = unbatchedPlannedEnrollments
    .filter((enrollment) => activeSelectedEnrollmentIdSet.has(enrollment.id))
    .every((enrollment) => Boolean(
      enrollment.classStartDate
      && enrollment.classStartSessionKey
      && enrollment.classStartSession,
    ))
  const selectedTrackIds = Array.from(new Set(unbatchedPlannedEnrollments
    .filter((enrollment) => activeSelectedEnrollmentIdSet.has(enrollment.id))
    .map((enrollment) => enrollment.trackId)))
  const applicationState = getRegistrationAdmissionApplicationState({
    tracks,
    enrollments,
    admissionNoticeSent,
    admissionApplicationMessageStatus,
    admissionApplicationMessageClaimActive,
  })
  const checklist = getRegistrationAdmissionBatchChecklist({
    admissionNoticeSent,
    enrollments: currentBatchEnrollments,
    batch: openBatch,
  })
  const messageRecoveryAvailable = useAdmissionRecoveryAvailable(admissionApplicationMessageUpdatedAt)

  async function afterCommitted(message: string) {
    try {
      await onReload()
      setRefreshPending(false)
    } catch {
      setRefreshPending(true)
      onWarning(message)
    }
  }

  async function retryAdmissionReload() {
    try {
      await onReload()
      setRefreshPending(false)
    } catch {
      setRefreshPending(true)
      onWarning("최신 입학 처리 내용을 다시 불러오지 못했습니다.")
    }
  }

  async function runMessageAction(
    action: string,
    mutation: (requestKey: string) => Promise<void>,
    entityId: string,
  ) {
    if (busyAction || refreshPending) return
    const requestKey = submissionKeys.getOrCreate(action, entityId)
    setBusyAction(action)
    try {
      await mutation(requestKey)
      submissionKeys.clear(action, entityId)
      await afterCommitted("입학신청서 상태는 변경됐지만 최신 내용을 다시 불러오지 못했습니다.")
    } catch (error) {
      onWarning(errorMessage(error, "입학신청서 상태를 변경하지 못했습니다."))
    } finally {
      setBusyAction("")
    }
  }

  function parsedEvidence(): RegistrationAdmissionProviderEvidence | null {
    try {
      const value = JSON.parse(evidenceText) as RegistrationAdmissionProviderEvidence
      if (!value || typeof value !== "object" || !value.observedState) return null
      return value
    } catch {
      return null
    }
  }

  async function startBatch() {
    const enrollmentIds = activeSelectedEnrollmentIds
    if (busyAction || refreshPending || !permissions.canManage || !admissionNoticeSent || selectedTrackIds.length === 0 || enrollmentIds.length === 0) return
    if (!selectedEnrollmentsHaveCompleteSchedules) {
      onWarning("입학 처리 전에 선택한 모든 수업의 시작 일정을 지정하세요.")
      return
    }
    const entityId = `${taskId}:${[...enrollmentIds].sort().join(",")}`
    const requestKey = submissionKeys.getOrCreate("batch-start", entityId)
    setBusyAction("batch-start")
    try {
      await startRegistrationAdmissionBatch({ taskId, trackIds: selectedTrackIds, enrollmentIds, requestKey })
      submissionKeys.clear("batch-start", entityId)
      await afterCommitted("입학 처리는 시작됐지만 최신 내용을 다시 불러오지 못했습니다.")
    } catch (error) {
      onWarning(errorMessage(error, "입학 처리를 시작하지 못했습니다."))
    } finally {
      setBusyAction("")
    }
  }

  async function setMakeedu(enrollment: OpsRegistrationEnrollment) {
    if (busyAction || refreshPending) return
    const logicalId = `${enrollment.id}:${!enrollment.makeeduRegistered}`
    const requestKey = submissionKeys.getOrCreate("batch-makeedu", logicalId)
    setBusyAction(`makeedu:${enrollment.id}`)
    try {
      await setRegistrationEnrollmentMakeedu({ enrollmentId: enrollment.id, registered: !enrollment.makeeduRegistered, requestKey })
      submissionKeys.clear("batch-makeedu", logicalId)
      await afterCommitted("메이크에듀 상태는 저장됐지만 최신 내용을 다시 불러오지 못했습니다.")
    } catch (error) {
      onWarning(errorMessage(error, "메이크에듀 등록 상태를 변경하지 못했습니다."))
    } finally {
      setBusyAction("")
    }
  }

  async function advanceBatch(action: "invoice_sent" | "payment_confirmed") {
    if (!openBatch || busyAction || refreshPending) return
    const kind = action === "invoice_sent" ? "batch-invoice" : "batch-payment"
    const requestKey = submissionKeys.getOrCreate(kind, openBatch.id)
    setBusyAction(kind)
    try {
      await advanceRegistrationAdmissionBatch({ batchId: openBatch.id, action, requestKey })
      submissionKeys.clear(kind, openBatch.id)
      await afterCommitted("입학 처리 상태는 저장됐지만 최신 내용을 다시 불러오지 못했습니다.")
    } catch (error) {
      onWarning(errorMessage(error, "입학 처리 상태를 변경하지 못했습니다."))
    } finally {
      setBusyAction("")
    }
  }

  async function completeBatch() {
    if (!openBatch || busyAction || refreshPending) return
    const requestKey = submissionKeys.getOrCreate("batch-complete", openBatch.id)
    setBusyAction("batch-complete")
    try {
      await completeRegistrationAdmissionBatch({ batchId: openBatch.id, requestKey })
      submissionKeys.clear("batch-complete", openBatch.id)
      await afterCommitted("등록은 완료됐지만 최신 내용을 다시 불러오지 못했습니다.")
    } catch (error) {
      onWarning(errorMessage(error, "등록을 완료하지 못했습니다."))
    } finally {
      setBusyAction("")
    }
  }

  const currentBatchTrackIds = Array.from(new Set(currentBatchEnrollments.map((enrollment) => enrollment.trackId)))
  const { addClassTrackIds, firstAdmissionTrackIds } = getRegistrationAdmissionBatchCancellationGroups({
    batchId: openBatch?.id || "",
    currentBatchEnrollments,
    enrollments,
  })

  async function cancelBatch() {
    if (!openBatch || !cancelBatchReason.trim() || busyAction || refreshPending || openBatch.status === "paid") return
    const resolutions = firstAdmissionTrackIds.map((trackId) => ({
      trackId,
      destination: cancelDestinations[trackId] || "",
      waitingKind: cancelDestinations[trackId] === "waiting" ? cancelWaitingKinds[trackId] || null : null,
      classId: cancelDestinations[trackId] === "waiting" && cancelWaitingKinds[trackId] === "current_class"
        ? cancelClassIds[trackId] || null
        : null,
    }))
    if (resolutions.some((item) => !item.destination)) return
    if (resolutions.some((item) => item.destination === "waiting" && !item.waitingKind)) return
    if (resolutions.some((item) => item.waitingKind === "current_class" && !item.classId)) return
    const entityId = `${openBatch.id}:${cancelBatchReason.trim()}:${JSON.stringify(resolutions)}`
    const requestKey = submissionKeys.getOrCreate("batch-cancel", entityId)
    setBusyAction("batch-cancel")
    try {
      await cancelRegistrationAdmissionBatch({ batchId: openBatch.id, resolutions, reason: cancelBatchReason.trim(), requestKey })
      submissionKeys.clear("batch-cancel", entityId)
      await afterCommitted("입학 처리 취소는 완료됐지만 최신 내용을 다시 불러오지 못했습니다.")
    } catch (error) {
      onWarning(errorMessage(error, "입학 처리를 취소하지 못했습니다."))
    } finally {
      setBusyAction("")
    }
  }

  const messageStatusLabel = {
    pending: "발송 처리 중",
    accepted: admissionNoticeSent ? "입학신청서 발송 완료" : "발송 접수됨 · 상태 동기화 필요",
    unknown: "발송 결과 확인 필요",
    failed_hold: "미접수 확인 · 재발송 잠금",
    "": admissionNoticeSent ? "입학신청서 발송 완료" : "입학신청서 발송 전",
  }[admissionApplicationMessageStatus]

  return (
    <section className="grid gap-3 rounded-md border p-3" aria-label="입학 처리">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">입학 처리</h3>
        <Badge variant={openBatch ? "default" : "outline"}>{openBatch ? `${openBatch.revisionNumber}차 처리` : "대상 선택"}</Badge>
      </div>

      <div className="grid gap-2 rounded-md bg-muted/30 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">1. 입학신청서 발송</span>
          <span className="text-xs text-muted-foreground">{messageStatusLabel}</span>
        </div>
        {permissions.canManage && applicationState.canSend ? (
          <Button type="button" size="sm" className="w-fit" onClick={() => void runMessageAction("admission-send", (requestKey) => onSendAdmissionMessage({ taskId, requestKey }), taskId)} disabled={Boolean(busyAction)}>입학신청서 발송</Button>
        ) : null}
        {permissions.canManage && applicationState.syncNeeded ? (
          <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => void runMessageAction("admission-sync", (requestKey) => onSendAdmissionMessage({ taskId, requestKey }), admissionApplicationMessageId || taskId)} disabled={Boolean(busyAction)}>상태 동기화</Button>
        ) : null}
        {permissions.canManage && admissionApplicationMessageStatus === "pending" && admissionApplicationMessageId ? (
          <>
            <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => void runMessageAction("admission-check", () => onCheckAdmissionMessage({ messageId: admissionApplicationMessageId }), admissionApplicationMessageId)} disabled={Boolean(busyAction) || !messageRecoveryAvailable}>발송 상태 확인</Button>
            {!messageRecoveryAvailable ? <p className="text-xs text-muted-foreground">발송 후 15분이 지나면 확인할 수 있습니다.</p> : null}
          </>
        ) : null}
        {permissions.canManage && ["unknown", "failed_hold"].includes(admissionApplicationMessageStatus) && admissionApplicationMessageId ? (
          <div className="grid gap-2">
            <Textarea value={evidenceText} onChange={(event) => setEvidenceText(event.target.value)} placeholder="제공사 확인 증빙 JSON" className="font-mono text-xs" />
            <Input value={messageReason} onChange={(event) => setMessageReason(event.target.value)} placeholder="확인 사유" />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => {
                const providerEvidence = parsedEvidence()
                if (!providerEvidence || !messageReason.trim()) return onWarning("제공사 증빙과 확인 사유를 입력하세요.")
                void runMessageAction("admission-reconcile", (requestKey) => onReconcileAdmissionMessage({ messageId: admissionApplicationMessageId, resolution: "accepted", providerEvidence, reason: messageReason.trim(), requestKey }), `${admissionApplicationMessageId}:accepted:${evidenceText}:${messageReason.trim()}`)
              }}>접수 확인</Button>
              {admissionApplicationMessageStatus === "unknown" ? <Button type="button" size="sm" variant="destructive" onClick={() => {
                const providerEvidence = parsedEvidence()
                if (!providerEvidence || !messageReason.trim()) return onWarning("제공사 증빙과 확인 사유를 입력하세요.")
                void runMessageAction("admission-reconcile", (requestKey) => onReconcileAdmissionMessage({ messageId: admissionApplicationMessageId, resolution: "failed", providerEvidence, reason: messageReason.trim(), requestKey }), `${admissionApplicationMessageId}:failed:${evidenceText}:${messageReason.trim()}`)
              }}>미접수 기록</Button> : null}
              {admissionApplicationMessageStatus === "failed_hold" ? <Button type="button" size="sm" variant="outline" disabled={!messageRecoveryAvailable} onClick={() => {
                const providerEvidence = parsedEvidence()
                if (!providerEvidence || !messageReason.trim()) return onWarning("제공사 증빙과 재발송 사유를 입력하세요.")
                void runMessageAction("admission-release", (requestKey) => onReleaseAdmissionMessageRetry({ messageId: admissionApplicationMessageId, providerEvidence, reason: messageReason.trim(), requestKey }), `${admissionApplicationMessageId}:${evidenceText}:${messageReason.trim()}`)
              }}>재발송 허용</Button> : null}
            </div>
          </div>
        ) : null}
      </div>

      {!openBatch ? (
        <div className="grid gap-2">
          {unbatchedPlannedEnrollments.length > 0 ? unbatchedPlannedEnrollments.map((enrollment) => {
            const track = trackById.get(enrollment.trackId)
            const classItem = classById.get(enrollment.classId)
            return (
              <label key={enrollment.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                {permissions.canManage ? <input type="checkbox" checked={selectedEnrollmentIds.has(enrollment.id)} onChange={(event) => setSelectedEnrollmentIds((current) => {
                  const next = new Set(current)
                  if (event.target.checked) next.add(enrollment.id)
                  else next.delete(enrollment.id)
                  return next
                })} disabled={Boolean(busyAction)} /> : null}
                <Badge variant="outline">{track?.subject || "과목"}</Badge>
                <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{classItem?.label || enrollment.classId}</span>
              </label>
            )
          }) : <p className="text-sm text-muted-foreground">입학 처리할 저장된 수업이 없습니다.</p>}
          {permissions.canManage && unbatchedPlannedEnrollments.length > 0 ? (
            <Button type="button" onClick={() => void startBatch()} disabled={!admissionNoticeSent || activeSelectedEnrollmentIds.length === 0 || !selectedEnrollmentsHaveCompleteSchedules || Boolean(busyAction) || refreshPending}>입학 처리 시작</Button>
          ) : null}
          {!admissionNoticeSent && unbatchedPlannedEnrollments.length > 0 ? <p className="text-xs text-muted-foreground">입학신청서 발송을 먼저 완료하세요.</p> : null}
          {admissionNoticeSent && activeSelectedEnrollmentIds.length > 0 && !selectedEnrollmentsHaveCompleteSchedules ? <p className="text-xs text-muted-foreground">입학 처리 전에 선택한 모든 수업의 시작 일정을 지정하세요.</p> : null}
        </div>
      ) : (
        <div className="grid gap-2">
          <div className="text-sm font-medium">2. 메이크에듀 등록</div>
          {currentBatchEnrollments.map((enrollment) => {
            const track = trackById.get(enrollment.trackId)
            const classItem = classById.get(enrollment.classId)
            return (
              <div key={enrollment.id} className="grid gap-2 rounded-md border px-3 py-2 text-sm sm:grid-cols-[auto_1fr_auto] sm:items-center">
                <Badge variant="outline">{track?.subject || "과목"}</Badge>
                <span className="truncate">{classItem?.label || enrollment.classId}</span>
                {permissions.canManage ? <Button type="button" size="sm" variant={enrollment.makeeduRegistered ? "default" : "outline"} onClick={() => void setMakeedu(enrollment)} disabled={Boolean(busyAction) || openBatch.status !== "draft"}>{enrollment.makeeduRegistered ? "등록됨" : "메이크에듀 등록"}</Button> : <span>{enrollment.makeeduRegistered ? "등록됨" : "대기"}</span>}
              </div>
            )
          })}
          {permissions.canManage ? (
            <>
              <Button type="button" variant={checklist.invoice ? "outline" : "default"} onClick={() => void advanceBatch("invoice_sent")} disabled={!checklist.makeedu || checklist.invoice || Boolean(busyAction)}>3. 청구서 발송</Button>
              <Button type="button" variant={checklist.payment ? "outline" : "default"} onClick={() => void advanceBatch("payment_confirmed")} disabled={!checklist.invoice || checklist.payment || Boolean(busyAction)}>4. 수납 완료 확인</Button>
              <Button type="button" onClick={() => void completeBatch()} disabled={!checklist.payment || checklist.complete || Boolean(busyAction)}>5. 등록 완료</Button>
            </>
          ) : (
            <dl aria-label="읽기 전용 입학 처리 상태" className="grid gap-2 rounded-md bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-2"><dt>3. 청구서 발송</dt><dd>{checklist.invoice ? "완료" : "대기"}</dd></div>
              <div className="flex justify-between gap-2"><dt>4. 수납 완료 확인</dt><dd>{checklist.payment ? "완료" : "대기"}</dd></div>
              <div className="flex justify-between gap-2"><dt>5. 등록 완료</dt><dd>{checklist.complete ? "완료" : "대기"}</dd></div>
            </dl>
          )}

          {permissions.canManage && ["draft", "invoiced"].includes(openBatch.status) ? (
            <Button type="button" variant="destructive" onClick={() => {
              if (cancelBatchOpen) {
                setCancelBatchOpen(false)
                return
              }
              setCancelDestinations({})
              setCancelWaitingKinds({})
              setCancelClassIds({})
              setCancelBatchReason("")
              setCancelBatchOpen(true)
            }} disabled={Boolean(busyAction)}>입학 처리 취소</Button>
          ) : null}
          {permissions.canManage && cancelBatchOpen ? (
            <div className="grid gap-3 rounded-md border border-destructive/30 p-3">
              {currentBatchTrackIds.map((trackId) => {
                const track = trackById.get(trackId)
                const isFirstAdmission = firstAdmissionTrackIds.includes(trackId)
                const isAddClass = addClassTrackIds.includes(trackId)
                const subjectClasses = classes.filter((classItem) => classItem.subject === track?.subject)
                return (
                  <div key={trackId} className="grid gap-2 sm:grid-cols-3">
                    <span className="text-sm font-medium">{track?.subject || "과목"}</span>
                    {isFirstAdmission ? (
                      <>
                        <select aria-label={`${track?.subject || "과목"} 입학 처리 취소 후 단계`} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={cancelDestinations[trackId] || ""} onChange={(event) => setCancelDestinations((current) => ({ ...current, [trackId]: event.target.value as "" | "waiting" | "not_registered" }))}>
                          <option value="">취소 후 단계 선택</option>
                          <option value="not_registered">미등록 완료</option>
                          <option value="waiting">대기로 이동</option>
                        </select>
                        {cancelDestinations[trackId] === "waiting" ? (
                          <div className="grid gap-2">
                            <select aria-label={`${track?.subject || "과목"} 입학 처리 취소 대기 종류`} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={cancelWaitingKinds[trackId] || ""} onChange={(event) => setCancelWaitingKinds((current) => ({ ...current, [trackId]: event.target.value as RegistrationWaitingKind }))}>
                              <option value="">대기 종류 선택</option>
                              {WAITING_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                            {cancelWaitingKinds[trackId] === "current_class" ? <select aria-label={`${track?.subject || "과목"} 입학 처리 취소 대기 수업`} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={cancelClassIds[trackId] || ""} onChange={(event) => setCancelClassIds((current) => ({ ...current, [trackId]: event.target.value }))}><option value="">대기 수업 선택</option>{subjectClasses.map((classItem) => <option key={classItem.id} value={classItem.id}>{classItem.label}</option>)}</select> : null}
                          </div>
                        ) : <span />}
                      </>
                    ) : isAddClass ? <span className="text-sm text-muted-foreground sm:col-span-2">기존 등록 유지</span> : null}
                  </div>
                )
              })}
              <Textarea value={cancelBatchReason} onChange={(event) => setCancelBatchReason(event.target.value)} placeholder="입학 처리 취소 사유" />
              <Button type="button" variant="destructive" onClick={() => void cancelBatch()} disabled={!cancelBatchReason.trim() || Boolean(busyAction)}>입학 처리 취소 확인</Button>
            </div>
          ) : null}
        </div>
      )}

      {batches.some((batch) => ["completed", "canceled"].includes(batch.status)) ? (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">이전 입학 처리</summary>
          <div className="mt-2 grid gap-2">
            {batches.filter((batch) => ["completed", "canceled"].includes(batch.status)).map((batch) => (
              <div key={batch.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2 text-sm">
                <span>{batch.revisionNumber}차 처리</span>
                <Badge variant="outline">{batch.status === "completed" ? "등록 완료" : "취소"}</Badge>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {refreshPending ? <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void retryAdmissionReload()}><RefreshCw className="size-4" aria-hidden="true" />최신 내용 다시 불러오기</Button> : null}
    </section>
  )
}
