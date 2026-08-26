"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { CalendarDays, ChevronDown, Plus, RefreshCw, Trash2 } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"

import { RegistrationAdmissionChecklist } from "./registration-admission-progress"
import { RegistrationSelect } from "./registration-select"
import { RegistrationSaveButton } from "./registration-save-button"

import {
  loadOpsRegistrationClassDetails,
  type OpsClassOption,
  type OpsRegistrationClassDetail,
  type OpsTextbookOption,
} from "./ops-task-service"
import {
  applyRegistrationEnrollmentClassSelection,
  applyRegistrationEnrollmentStartDefault,
  applyRegistrationEnrollmentStartSelection,
  createRegistrationEnrollmentDraft,
  createRegistrationEnrollmentStartLoadOwner,
  getRegistrationEnrollmentBlockers,
  getRegistrationEnrollmentCancellationState,
  getRegistrationEnrollmentStartOptions,
  getRegistrationEnrollmentStartSaveErrorMessage,
  restoreRegistrationEnrollmentDraft,
  serializeRegistrationEnrollmentRows,
  type RegistrationEnrollmentDraft,
  type RegistrationEnrollmentStartOption,
  type RegistrationScheduleSession,
} from "./registration-track-model.js"
import { getSelectableRegistrationScheduleSessions } from "./registration-workflow"
import {
  reconcileRegistrationEnrollmentDraft,
  type RegistrationEnrollmentDirtyScope as RegistrationEnrollmentDirtyScopeModel,
} from "./registration-application-model"
import {
  cancelRegistrationEnrollment,
  createRegistrationMutationRequestKey,
  loadRegistrationEnrollmentStartObservation,
  saveRegistrationEnrollmentDetails,
  setRegistrationAdmissionChecklistItem,
  type OpsRegistrationAdmissionBatch,
  type OpsRegistrationEnrollment,
  type OpsRegistrationTrackSummary,
  type RegistrationAdmissionChecklistItem,
  type RegistrationAdmissionChecklistState,
  type RegistrationWaitingKind,
} from "./registration-track-service"
import type { RegistrationObservationFeedbackDetail } from "./registration-observation-model.ts"

type RegistrationManagementPermissions = {
  canManage: boolean
  readOnly?: boolean
}

export type RegistrationEnrollmentDirtyScope = RegistrationEnrollmentDirtyScopeModel

type PersistedRegistrationEnrollmentDraft = {
  rows: RegistrationEnrollmentDraft[]
  baseline: string
  canonicalKey: string
}

const persistedRegistrationEnrollmentDrafts = new Map<string, PersistedRegistrationEnrollmentDraft>()

export function clearRegistrationEnrollmentDrafts(taskId: string) {
  const prefix = `${taskId}:`
  for (const key of persistedRegistrationEnrollmentDrafts.keys()) {
    if (key.startsWith(prefix)) persistedRegistrationEnrollmentDrafts.delete(key)
  }
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

const REGISTRATION_REFRESH_TIMEOUT_MS = 10_000

async function withRegistrationRefreshTimeout(result: void | Promise<void>) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve(result),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("registration_refresh_timeout")),
          REGISTRATION_REFRESH_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function registrationDateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value.slice(0, 10) : ""
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function registrationCalendarDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  return new Date(year, month - 1, day)
}

function registrationKoreanMonthDay(dateKey: string) {
  const [, , month, day] = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/) || []
  if (!month || !day) return dateKey
  return `${Number(month)}월 ${Number(day)}일`
}

function RegistrationStartScheduleCalendar({
  subject,
  rowIndex,
  sessions,
  value,
  sourceObservationId,
  valueDate,
  valueLabel,
  disabled,
  onSelect,
}: {
  subject: string
  rowIndex: number
  sessions: readonly RegistrationEnrollmentStartOption[]
  value: string
  sourceObservationId: string
  valueDate: string
  valueLabel: string
  disabled: boolean
  onSelect: (session: RegistrationEnrollmentStartOption) => void
}) {
  const sessionsByDate = new Map<string, RegistrationEnrollmentStartOption>()
  for (const session of sessions) {
    if (!sessionsByDate.has(session.sessionDate)) sessionsByDate.set(session.sessionDate, session)
  }
  const selectedSession = sessions.find((session) => (
    session.classStartSessionKey === value
    && session.sourceObservationId === sourceObservationId
  ))
  const selectedDate = selectedSession?.sessionDate || valueDate
  const selectedLabel = selectedSession?.label || valueLabel
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-9 w-full min-w-0 justify-start font-normal" disabled={disabled} aria-label={`${subject} 수업 ${rowIndex} 시작 일정 선택`}>
          <CalendarDays className="size-4" aria-hidden="true" />
          {selectedDate && selectedLabel ? `${selectedDate} · ${selectedLabel}` : "수업 시작일 선택"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0" disablePortal>
        <Calendar
          mode="single"
          selected={selectedDate ? registrationCalendarDate(selectedDate) : undefined}
          defaultMonth={registrationCalendarDate(selectedDate || sessions[0]?.sessionDate || registrationDateKey(new Date()))}
          disabled={(date) => !sessionsByDate.has(registrationDateKey(date))}
          onSelect={(date) => {
            const session = date ? sessionsByDate.get(registrationDateKey(date)) : null
            if (session) onSelect(session)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

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

function RegistrationRefreshAlert({
  children,
}: {
  children: ReactNode
}) {
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-950">
      <AlertTitle>저장은 완료됐지만 최신 내용을 불러오지 못했습니다</AlertTitle>
      <AlertDescription className="items-start">
        {children}
      </AlertDescription>
    </Alert>
  )
}

function RegistrationCollapsibleTrigger({ children }: { children: ReactNode }) {
  return (
    <CollapsibleTrigger asChild>
      <div
        role="button"
        tabIndex={0}
        className="flex w-full cursor-pointer items-center justify-between gap-2 text-left text-sm font-medium"
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          event.currentTarget.click()
        }}
      >
        <span>{children}</span>
        <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </div>
    </CollapsibleTrigger>
  )
}

function useScopedDirtyState<TScope extends object>(
  scope: TScope,
  dirty: boolean,
  onDirtyChange?: (scope: TScope, dirty: boolean) => void,
) {
  const previousRef = useRef<{ scope: TScope; dirty: boolean }>({ scope, dirty: false })
  const callbackRef = useRef(onDirtyChange)
  useEffect(() => {
    callbackRef.current = onDirtyChange
  }, [onDirtyChange])
  useEffect(() => {
    const previous = previousRef.current
    if (JSON.stringify(previous.scope) !== JSON.stringify(scope) && previous.dirty) {
      onDirtyChange?.(previous.scope, false)
      previous.dirty = false
    }
    if (previous.dirty !== dirty || JSON.stringify(previous.scope) !== JSON.stringify(scope)) {
      if (dirty) onDirtyChange?.(scope, true)
      previousRef.current = { scope, dirty }
    }
  }, [dirty, onDirtyChange, scope])
  useEffect(() => () => {
    if (previousRef.current.dirty) callbackRef.current?.(previousRef.current.scope, false)
  }, [])
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
  onDirtyChange?: (scope: RegistrationEnrollmentDirtyScope, dirty: boolean) => void
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
  onDirtyChange,
}: RegistrationEnrollmentEditorProps) {
  const trackEnrollments = useMemo(
    () => enrollments.filter((enrollment) => enrollment.trackId === track.id),
    [enrollments, track.id],
  )
  const canonicalEnrollmentKey = useMemo(() => JSON.stringify({
    trackStatus: track.status,
    enrollments: [...trackEnrollments].sort((left, right) => left.id.localeCompare(right.id)),
  }), [track.status, trackEnrollments])
  const canonicalDraftRows = useMemo(() => {
    const mutableRows = trackEnrollments.filter(isMutableDraft)
    return mutableRows.length > 0
      ? mutableRows.map(toDraft)
      : (track.enrollmentDetailRows || []).length > 0
        ? (track.enrollmentDetailRows || []).map((row) => restoreRegistrationEnrollmentDraft(row))
      : track.status === "enrollment_decided"
        ? [createRegistrationEnrollmentDraft({ clientKey: `enrollment-row:${taskId}:${track.id}` })]
        : [createRegistrationEnrollmentDraft({ clientKey: `enrollment-row:${taskId}:${track.id}` })]
  }, [taskId, track.enrollmentDetailRows, track.id, track.status, trackEnrollments])
  const enrollmentDraftScopeKey = `${taskId}:${track.id}`
  const cachedEnrollmentDraft = persistedRegistrationEnrollmentDrafts.get(enrollmentDraftScopeKey)
  const [draftRows, setDraftRows] = useState<RegistrationEnrollmentDraft[]>(() => {
    if (cachedEnrollmentDraft) return cachedEnrollmentDraft.rows.map((row) => ({ ...row }))
    return canonicalDraftRows
  })
  const canonicalRowsHavePersistedOwnership = Boolean(
    cachedEnrollmentDraft
    || trackEnrollments.some(isMutableDraft)
    || (track.enrollmentDetailRows || []).length > 0,
  )
  const observationDefaultEligibleClientKeysRef = useRef(new Set(
    canonicalRowsHavePersistedOwnership ? [] : canonicalDraftRows.map((row) => row.clientKey),
  ))
  const [classDetailById, setClassDetailById] = useState<Record<string, OpsRegistrationClassDetail | null>>({})
  const [loadingClassIds, setLoadingClassIds] = useState<Set<string>>(() => new Set())
  const [classDetailRetryToken, setClassDetailRetryToken] = useState(0)
  const [saving, setSaving] = useState(false)
  const [rowsRefreshPending, setRowsRefreshPending] = useState(false)
  const [cancellationRefreshPending, setCancellationRefreshPending] = useState(false)
  const [cancelEnrollmentId, setCancelEnrollmentId] = useState("")
  const [cancelReason, setCancelReason] = useState("")
  const [cancelDestination, setCancelDestination] = useState<"" | "enrollment_decided" | "waiting" | "not_registered">("")
  const [cancelWaitingKind, setCancelWaitingKind] = useState<RegistrationWaitingKind>("")
  const [cancelClassId, setCancelClassId] = useState("")
  const [rowsValidationError, setRowsValidationError] = useState("")
  const [cancellationValidationError, setCancellationValidationError] = useState("")
  const [enrollmentHistoryOpen, setEnrollmentHistoryOpen] = useState(false)
  const [externalReconciliationRequired, setExternalReconciliationRequired] = useState(false)
  const [matchingObservation, setMatchingObservation] = useState<RegistrationObservationFeedbackDetail | null>(null)
  const currentMatchingObservation = permissions.canManage && matchingObservation?.trackId === track.id
    ? matchingObservation
    : null
  const sectionRef = useRef<HTMLElement | null>(null)
  const observationLoadOwnerRef = useRef(createRegistrationEnrollmentStartLoadOwner())
  const initialDraftRowsRef = useRef(cachedEnrollmentDraft?.baseline || JSON.stringify(draftRows))
  const canonicalKeyRef = useRef(cachedEnrollmentDraft?.canonicalKey || canonicalEnrollmentKey)
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
    && !rowsRefreshPending
  const selectedCancelEnrollment = trackEnrollments.find((item) => item.id === cancelEnrollmentId) || null
  const selectedEnrollmentCancellation = getRegistrationEnrollmentCancellationState({
    enrollment: selectedCancelEnrollment,
    enrollments: trackEnrollments,
  })
  const rowsDirty = JSON.stringify(draftRows) !== initialDraftRowsRef.current
  const cancellationScope: RegistrationEnrollmentDirtyScope = { kind: "cancellation", enrollmentId: cancelEnrollmentId || "new" }
  const cancellationDirty = Boolean(cancelEnrollmentId || cancelReason || cancelDestination || cancelWaitingKind || cancelClassId)
  useScopedDirtyState({ kind: "rows" }, !rowsRefreshPending && rowsDirty, onDirtyChange)
  useScopedDirtyState(cancellationScope, !cancellationRefreshPending && cancellationDirty, onDirtyChange)
  useEffect(() => {
    setDraftRows((current) => {
      const reconciled = reconcileRegistrationEnrollmentDraft({
        currentDraft: current,
        currentBaseline: initialDraftRowsRef.current,
        previousCanonicalKey: canonicalKeyRef.current,
        nextCanonicalKey: canonicalEnrollmentKey,
        nextCanonicalDraft: canonicalDraftRows,
      })
      initialDraftRowsRef.current = reconciled.baseline
      canonicalKeyRef.current = reconciled.canonicalKey
      return reconciled.draft
    })
  }, [canonicalDraftRows, canonicalEnrollmentKey, draftRows])
  useEffect(() => {
    if (!rowsDirty) {
      persistedRegistrationEnrollmentDrafts.delete(enrollmentDraftScopeKey)
      return
    }
    persistedRegistrationEnrollmentDrafts.set(enrollmentDraftScopeKey, {
      rows: draftRows.map((row) => ({ ...row })),
      baseline: initialDraftRowsRef.current,
      canonicalKey: canonicalKeyRef.current,
    })
  }, [draftRows, enrollmentDraftScopeKey, rowsDirty])

  useEffect(() => {
    observationDefaultEligibleClientKeysRef.current = new Set(
      canonicalRowsHavePersistedOwnership ? [] : canonicalDraftRows.map((row) => row.clientKey),
    )
  // The track scope is the only reset boundary. Canonical refreshes must not re-arm a used default.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollmentDraftScopeKey])

  useEffect(() => {
    for (const row of draftRows) {
      if ([
        row.classStartDate,
        row.classStartSessionKey,
        row.classStartLessonSessionId,
        row.classStartSession,
        row.classStartSourceObservationId,
      ].some(Boolean)) {
        observationDefaultEligibleClientKeysRef.current.delete(row.clientKey)
      }
    }
  }, [draftRows])

  const observationFeedbackRevision = track.observationFeedbackRevision ?? null
  useEffect(() => {
    const owner = observationLoadOwnerRef.current
    const token = owner.begin(track.id)
    setMatchingObservation(null)
    if (!permissions.canManage) {
      return () => owner.release(token)
    }

    void loadRegistrationEnrollmentStartObservation({ trackId: track.id }).then((detail) => {
      if (!owner.owns(token, track.id)) return
      setMatchingObservation(detail)
      if (!detail) return
      const observationOption = getRegistrationEnrollmentStartOptions({
        regularSessions: [],
        matchingObservation: detail,
        finalClassId: detail.classId,
      }).find((option) => option.source === "observation") || null
      if (!observationOption) return
      const eligibleClientKeys = [...observationDefaultEligibleClientKeysRef.current]
      setDraftRows((current) => applyRegistrationEnrollmentStartDefault(current, observationOption, {
        eligibleClientKeys,
      }))
    }).catch(() => {
      if (owner.owns(token, track.id)) setMatchingObservation(null)
    })

    return () => owner.release(token)
  }, [observationFeedbackRevision, permissions.canManage, track.id])

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
    selectedClassIds.map((classId) => {
      const detail = classDetailById[classId]
      const regularSessions = getSelectableRegistrationScheduleSessions(detail?.schedulePlan, {
        normalized: detail?.scheduleStorageMode !== "legacy",
      })
      const validKeys = getRegistrationEnrollmentStartOptions({
        regularSessions: regularSessions as RegistrationScheduleSession[],
        matchingObservation: currentMatchingObservation,
        finalClassId: classId,
      }).map((option) => option.classStartSessionKey)
      for (const row of draftRows) {
        if (
          row.classId === classId
          && row.classStartSourceObservationId
          && row.classStartSessionKey
        ) validKeys.push(row.classStartSessionKey)
      }
      return [classId, Array.from(new Set(validKeys))]
    }),
  ), [classDetailById, currentMatchingObservation, draftRows, selectedClassIds])
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
    const previous = draftRows.find((row) => row.clientKey === clientKey)
    if (previous?.classId && previous.classId !== classId) {
      observationDefaultEligibleClientKeysRef.current.delete(clientKey)
    }
    const eligibleClientKeys = [...observationDefaultEligibleClientKeysRef.current]
    setDraftRows((current) => {
      const selectedRows = current.map((row) => row.clientKey === clientKey
        ? applyRegistrationEnrollmentClassSelection(row, { classItem, availableTextbookIds: textbookIds })
        : row)
      const observationOption = getRegistrationEnrollmentStartOptions({
        regularSessions: [],
        matchingObservation: currentMatchingObservation,
        finalClassId: classId,
      }).find((option) => option.source === "observation") || null
      return applyRegistrationEnrollmentStartDefault(selectedRows, observationOption, {
        eligibleClientKeys,
        preferredClientKey: clientKey,
      })
    })
  }

  function selectStartSession(clientKey: string, option: RegistrationEnrollmentStartOption) {
    observationDefaultEligibleClientKeysRef.current.delete(clientKey)
    setDraftRows((current) => current.map((row) => (
      row.clientKey === clientKey
        ? {
            ...applyRegistrationEnrollmentStartSelection(row, option),
            classStartSourceObservationId: option.source === "regular"
              ? ""
              : option.sourceObservationId,
          }
        : row
    )))
  }

  function addRow() {
    if (!canEditRows) return
    const row = createRegistrationEnrollmentDraft({
      clientKey: createRegistrationMutationRequestKey("enrollment-row", `${taskId}:${track.id}:${draftRows.length}`),
      sortOrder: draftRows.length,
    })
    observationDefaultEligibleClientKeysRef.current.add(row.clientKey)
    setDraftRows((current) => [...current, { ...row, sortOrder: current.length }])
  }

  function retryClassDetail(classId: string) {
    setClassDetailById((current) => {
      const next = { ...current }
      delete next[classId]
      return next
    })
    setClassDetailRetryToken((current) => current + 1)
  }

  function setOwnerRefreshPending(owner: RegistrationEnrollmentDirtyScope, pending: boolean) {
    if (owner.kind === "rows") setRowsRefreshPending(pending)
    else setCancellationRefreshPending(pending)
  }

  async function reloadCommitted(owner: RegistrationEnrollmentDirtyScope) {
    onDirtyChange?.(owner, false)
    setOwnerRefreshPending(owner, true)
    try {
      await withRegistrationRefreshTimeout(onReload())
      setOwnerRefreshPending(owner, false)
      return true
    } catch {
      setOwnerRefreshPending(owner, true)
      onWarning("저장은 완료됐지만 최신 내용을 불러오지 못했습니다")
      return false
    }
  }

  async function retryEnrollmentReload(owner: RegistrationEnrollmentDirtyScope) {
    try {
      await withRegistrationRefreshTimeout(onReload())
      setOwnerRefreshPending(owner, false)
      if (owner.kind === "cancellation") setCancelEnrollmentId("")
    } catch {
      setOwnerRefreshPending(owner, true)
      onWarning("최신 수업 정보를 다시 불러오지 못했습니다.")
    }
  }

  async function saveRows() {
    if (!canEditRows || saving) return
    if (blockers.length > 0) {
      const message = blockers[0]?.message || "수업 정보를 확인하세요."
      setRowsValidationError(message)
      onWarning(message)
      const rowId = blockers[0]?.rowId
      window.requestAnimationFrame(() => sectionRef.current
        ?.querySelector<HTMLElement>(`[data-enrollment-row="${rowId}"] [data-slot="select-trigger"]`)
        ?.focus())
      return
    }
    const rows = serializeRegistrationEnrollmentRows(draftRows)
    const payloadFingerprint = JSON.stringify(rows)
    const logicalId = `${track.id}:${payloadFingerprint}`
    const requestKey = submissionKeys.getOrCreate("enrollment-rows", logicalId)
    setSaving(true)
    onWarning("")
    try {
      const saved = await saveRegistrationEnrollmentDetails({ trackId: track.id, rows, requestKey })
      setExternalReconciliationRequired(saved.externalReconciliationRequired)
      initialDraftRowsRef.current = JSON.stringify(draftRows)
      persistedRegistrationEnrollmentDrafts.delete(enrollmentDraftScopeKey)
      submissionKeys.clear("enrollment-rows", logicalId)
      await reloadCommitted({ kind: "rows" })
    } catch (error) {
      onWarning(getRegistrationEnrollmentStartSaveErrorMessage(
        error,
        "수업 정보를 저장하지 못했습니다.",
      ))
    } finally {
      setSaving(false)
    }
  }

  async function cancelPersistedEnrollment() {
    const enrollment = selectedCancelEnrollment
    if (!enrollment || saving || cancellationRefreshPending || trackHasOpenBatch) return
    if (!cancelReason.trim()) {
      setCancellationValidationError("수강 취소 사유를 입력하세요.")
      window.requestAnimationFrame(() => sectionRef.current?.querySelector<HTMLElement>(`[aria-label="${track.subject} 수강 취소 사유"]`)?.focus())
      return
    }
    if (selectedEnrollmentCancellation.requiresDestination && !cancelDestination) {
      setCancellationValidationError("수강 취소 후 단계를 선택하세요.")
      window.requestAnimationFrame(() => sectionRef.current?.querySelector<HTMLElement>(`[aria-label="${track.subject} 수강 취소 후 단계"]`)?.focus())
      return
    }
    const destination = selectedEnrollmentCancellation.requiresDestination ? cancelDestination : ""
    if (destination === "waiting" && !cancelWaitingKind) {
      setCancellationValidationError("취소 후 대기 종류를 선택하세요.")
      window.requestAnimationFrame(() => sectionRef.current?.querySelector<HTMLElement>(`[aria-label="${track.subject} 수강 취소 대기 종류"]`)?.focus())
      return
    }
    if (destination === "waiting" && cancelWaitingKind === "current_class" && !cancelClassId) {
      setCancellationValidationError("취소 후 대기 수업을 선택하세요.")
      window.requestAnimationFrame(() => sectionRef.current?.querySelector<HTMLElement>(`[aria-label="${track.subject} 수강 취소 대기 수업"]`)?.focus())
      return
    }
    const logicalId = `${enrollment.id}:${destination}:${cancelWaitingKind}:${cancelClassId}:${cancelReason.trim()}`
    const requestKey = submissionKeys.getOrCreate("cancel-enrollment", logicalId)
    setSaving(true)
    try {
      const receipt = await cancelRegistrationEnrollment({
        enrollmentId: enrollment.id,
        destination,
        waitingKind: destination === "waiting" ? cancelWaitingKind : "",
        classId: destination === "waiting" && cancelWaitingKind === "current_class" ? cancelClassId : "",
        reason: cancelReason.trim(),
        requestKey,
      })
      submissionKeys.clear("cancel-enrollment", logicalId)
      setCancelDestination("")
      setCancelWaitingKind("")
      setCancelClassId("")
      setCancelReason("")
      setCancellationValidationError("")
      if (await reloadCommitted(cancellationScope)) setCancelEnrollmentId("")
      if (receipt.publicClassesCacheRefresh?.status === "pending") {
        onWarning("수강 취소는 완료되었습니다. 공개 수업 캐시 갱신 대기 중")
      }
    } catch (error) {
      onWarning(errorMessage(error, "수강을 취소하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  const immutableHistory = trackEnrollments.filter((enrollment) => !isMutableDraft(enrollment))

  return (
    <section ref={sectionRef} className="grid gap-3" aria-label={`${track.subject} 수강 수업`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{track.subject} 수강 수업</h3>
        <Badge variant="outline">{draftRows.length}개 수업</Badge>
      </div>

      <div data-registration-action-owner={`${track.subject}:enrollment-rows`} className="grid gap-3">
      {draftRows.map((row, index) => {
        const detail = row.classId ? classDetailById[row.classId] : null
        const regularSessions = getSelectableRegistrationScheduleSessions(detail?.schedulePlan, {
          normalized: detail?.scheduleStorageMode !== "legacy",
        })
        const startOptions = getRegistrationEnrollmentStartOptions({
          regularSessions: regularSessions as RegistrationScheduleSession[],
          matchingObservation: currentMatchingObservation,
          finalClassId: row.classId,
        })
        const observationOption = startOptions.find((option) => option.source === "observation") || null
        const observationSelected = Boolean(
          observationOption
          && row.classStartSourceObservationId === observationOption.sourceObservationId,
        )
        const linkedTextbookIds = detail?.textbookIds
          || subjectClasses.find((classItem) => classItem.id === row.classId)?.textbookIds
          || []
        const linkedTextbooks = linkedTextbookIds
          .map((id) => textbooks.find((textbook) => textbook.id === id))
          .filter((textbook): textbook is OpsTextbookOption => Boolean(textbook))
        const rowBlockers = blockers.filter((blocker) => blocker.rowId === row.clientKey)
        return (
          <article key={row.clientKey} data-enrollment-row={row.clientKey} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto] sm:items-end">
            <Label className="grid gap-1.5">
              <span>수업 {index + 1}</span>
              <RegistrationSelect
                aria-label={`${track.subject} 수업 ${index + 1} 선택`}
                value={row.classId}
                placeholder="수업 선택"
                options={[
                  { value: "", label: "수업 선택" },
                  ...subjectClasses.map((classItem) => ({ value: classItem.id, label: classItem.label })),
                ]}
                onValueChange={(value) => { setRowsValidationError(""); selectClass(row.clientKey, value) }}
                disabled={!canEditRows || saving}
              />
            </Label>
            <Label className="grid gap-1.5">
              <span>교재</span>
              <RegistrationSelect
                aria-label={`${track.subject} 수업 ${index + 1} 교재 선택`}
                value={row.textbookId}
                placeholder="선택 안 함 · 이미 보유"
                options={[
                  { value: "", label: "선택 안 함 · 이미 보유" },
                  ...linkedTextbooks.map((textbook) => ({ value: textbook.id, label: textbook.label })),
                ]}
                onValueChange={(value) => updateRow(row.clientKey, {
                  textbookId: value,
                  textbookExplicitlyCleared: value === "",
                })}
                disabled={!canEditRows || saving || !row.classId}
              />
            </Label>
            <Label className="grid gap-1.5">
              <span>수업 시작 일정</span>
              {observationSelected && currentMatchingObservation ? (
                <div className="grid gap-0.5 rounded-md bg-muted/40 px-2.5 py-2 text-xs">
                  <span className="font-medium">최근 적합 청강</span>
                  <span>{registrationKoreanMonthDay(currentMatchingObservation.sessionDate)} · {currentMatchingObservation.className} · 참석 · 적합</span>
                  <span className="text-muted-foreground">첫 수업일 기본값에 반영했습니다.</span>
                </div>
              ) : null}
              <RegistrationStartScheduleCalendar
                subject={track.subject}
                rowIndex={index + 1}
                sessions={startOptions}
                value={row.classStartSessionKey}
                sourceObservationId={row.classStartSourceObservationId}
                valueDate={row.classStartDate}
                valueLabel={row.classStartSession}
                onSelect={(session) => selectStartSession(row.clientKey, session)}
                disabled={!canEditRows || saving || !row.classId || loadingClassIds.has(row.classId) || classDetailById[row.classId] === null}
              />
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (row.id === null) {
                  observationDefaultEligibleClientKeysRef.current.delete(row.clientKey)
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
              aria-label={`${track.subject} 수업 ${index + 1} ${row.id === null ? "삭제" : "수강 취소"}`}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {row.id === null ? "삭제" : "수강 취소"}
            </Button>
            {rowsValidationError && rowBlockers.length > 0 ? <p role="alert" className="text-xs text-destructive sm:col-span-4">{rowBlockers.map((blocker) => blocker.message).join(" · ")}</p> : null}
            {row.classId && classDetailById[row.classId] === null && !loadingClassIds.has(row.classId) ? (
              <div role="alert" className="grid gap-2 text-xs text-destructive sm:col-span-4">
                <span>선택한 수업 일정을 불러오지 못했습니다.</span>
                <Button type="button" aria-label={`${track.subject} 수업 ${index + 1} 일정 다시 불러오기`} variant="outline" size="sm" className="w-fit" onClick={() => retryClassDetail(row.classId)} disabled={rowsRefreshPending}>
                  <RefreshCw className="size-4" aria-hidden="true" />
                  수업 일정 다시 불러오기
                </Button>
              </div>
            ) : null}
          </article>
        )
      })}

      {canEditRows ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" data-registration-primary-action={`${track.subject}:enrollment-row-add`} aria-label={`${track.subject} 수업 추가`} variant="outline" onClick={addRow} disabled={saving}>
            <Plus className="size-4" aria-hidden="true" />
            수업 추가
          </Button>
          <RegistrationSaveButton
            type="button"
            data-registration-primary-action={`${track.subject}:enrollment-row-save`}
            dirty={rowsDirty}
            saving={saving}
            blocked={rowsRefreshPending || draftRows.length === 0}
            actionLabel="등록 정보 저장"
            cleanLabel={draftRows.some((row) => row.classId) ? "저장됨" : "수업을 선택하세요"}
            aria-label={`${track.subject} 등록 정보 저장`}
            onClick={() => void saveRows()}
          />
        </div>
      ) : null}
      </div>
      {rowsValidationError ? <p role="alert" className="text-xs text-destructive">{rowsValidationError}</p> : null}
      {externalReconciliationRequired || trackHasOpenBatch ? <p className="text-xs text-muted-foreground">외부 반영 정정 필요 · 저장한 수정 내용은 입학 이력을 바꾸지 않습니다.</p> : null}

      {rowsRefreshPending ? (
        <RegistrationRefreshAlert>
          <Button type="button" aria-label={`${track.subject} 수업 최신 내용 다시 불러오기`} variant="outline" size="sm" className="w-fit" onClick={() => void retryEnrollmentReload({ kind: "rows" })}>
            <RefreshCw className="size-4" aria-hidden="true" />
            최신 내용 다시 불러오기
          </Button>
        </RegistrationRefreshAlert>
      ) : null}

      {immutableHistory.length > 0 ? (
        <Collapsible open={enrollmentHistoryOpen} onOpenChange={setEnrollmentHistoryOpen} className="group rounded-md border p-3">
          <RegistrationCollapsibleTrigger>수강 이력 {immutableHistory.length}건</RegistrationCollapsibleTrigger>
          <CollapsibleContent className="mt-3 grid gap-2">
            {immutableHistory.map((enrollment) => {
              const classLabel = classes.find((classItem) => classItem.id === enrollment.classId)?.label || enrollment.classId
              const canCancel = permissions.canManage
                && !cancellationRefreshPending
                && !trackHasOpenBatch
                && (enrollment.status === "planned" || (enrollment.status === "enrolled" && enrollment.rosterActive))
              return (
                <div key={enrollment.id} className="grid gap-2 rounded-md bg-muted/30 px-3 py-2 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <div className="font-medium">{classLabel}</div>
                    <div className="text-xs text-muted-foreground">{enrollmentHistoryLabel(enrollment)}{enrollment.classStartDate ? ` · ${enrollment.classStartDate} ${enrollment.classStartSession || ""}` : ""}</div>
                  </div>
                  {canCancel ? <Button type="button" aria-label={`${track.subject} ${classLabel} 수강 취소`} variant="outline" size="sm" onClick={() => setCancelEnrollmentId(enrollment.id)}>수강 취소</Button> : null}
                </div>
              )
            })}
            {trackHasOpenBatch ? <p className="text-xs text-muted-foreground">진행 중인 입학 처리를 먼저 완료하거나 취소하세요.</p> : null}
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {permissions.canManage && cancelEnrollmentId ? (
        <section className="grid gap-3 rounded-md border border-destructive/30 p-3">
          <h4 className="text-sm font-semibold">수강 취소</h4>
          {cancellationRefreshPending ? (
            <RegistrationRefreshAlert>
              <Button type="button" aria-label={`${track.subject} 수강 취소 최신 내용 다시 불러오기`} variant="outline" size="sm" className="w-fit" onClick={() => void retryEnrollmentReload(cancellationScope)}>
                <RefreshCw className="size-4" aria-hidden="true" />
                최신 내용 다시 불러오기
              </Button>
            </RegistrationRefreshAlert>
          ) : <>
          <Textarea aria-label={`${track.subject} 수강 취소 사유`} value={cancelReason} onChange={(event) => { setCancellationValidationError(""); setCancelReason(event.target.value) }} placeholder="취소 사유" />
          {selectedEnrollmentCancellation.requiresDestination ? (
            <RegistrationSelect
              aria-label={`${track.subject} 수강 취소 후 단계`}
              value={cancelDestination}
              placeholder="취소 후 단계 선택"
              options={[
                { value: "", label: "취소 후 단계 선택" },
                { value: "enrollment_decided", label: "등록 결정으로 이동" },
                { value: "waiting", label: "대기로 이동" },
                { value: "not_registered", label: "미등록 완료" },
              ]}
              onValueChange={(value) => { setCancellationValidationError(""); setCancelDestination(value as typeof cancelDestination) }}
            />
          ) : null}
          {selectedEnrollmentCancellation.requiresDestination && cancelDestination === "waiting" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <RegistrationSelect
                aria-label={`${track.subject} 수강 취소 대기 종류`}
                value={cancelWaitingKind}
                placeholder="대기 종류 선택"
                options={[{ value: "", label: "대기 종류 선택" }, ...WAITING_KIND_OPTIONS]}
                onValueChange={(value) => { setCancellationValidationError(""); setCancelWaitingKind(value as RegistrationWaitingKind) }}
              />
              {cancelWaitingKind === "current_class" ? (
                <RegistrationSelect
                  aria-label={`${track.subject} 수강 취소 대기 수업`}
                  value={cancelClassId}
                  placeholder="대기 수업 선택"
                  options={[
                    { value: "", label: "대기 수업 선택" },
                    ...subjectClasses.map((classItem) => ({ value: classItem.id, label: classItem.label })),
                  ]}
                  onValueChange={(value) => { setCancellationValidationError(""); setCancelClassId(value) }}
                />
              ) : null}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" aria-label={`${track.subject} 수강 취소 닫기`} variant="outline" onClick={() => {
              setCancelEnrollmentId("")
              setCancelDestination("")
              setCancelWaitingKind("")
              setCancelClassId("")
              setCancelReason("")
              setCancellationValidationError("")
            }} disabled={saving}>닫기</Button>
            <Button type="button" aria-label={`${track.subject} 수강 취소 확인`} variant="destructive" onClick={() => void cancelPersistedEnrollment()} disabled={saving || cancellationRefreshPending}>수강 취소 확인</Button>
          </div>
          {cancellationValidationError ? <p role="alert" className="text-xs text-destructive">{cancellationValidationError}</p> : null}
          </>}
        </section>
      ) : null}
    </section>
  )
}

export type RegistrationAdmissionPanelProps = {
  taskId: string
  checklist: RegistrationAdmissionChecklistState
  permissions: RegistrationManagementPermissions
  onWarning: (message: string) => void
}

export function RegistrationAdmissionPanel({
  taskId,
  checklist,
  permissions,
  onWarning,
}: RegistrationAdmissionPanelProps) {
  const submissionKeys = useSubmissionKeys()
  const [currentChecklist, setCurrentChecklist] = useState(checklist)
  const [savingItems, setSavingItems] = useState<Set<RegistrationAdmissionChecklistItem>>(
    () => new Set(),
  )

  useEffect(() => {
    setCurrentChecklist(checklist)
  }, [checklist])

  async function setChecklistItem(
    item: RegistrationAdmissionChecklistItem,
    checked: boolean,
  ) {
    if (!permissions.canManage || savingItems.has(item)) return

    const previousChecked = currentChecklist[item]
    const entityId = `${taskId}:${item}:${checked}`
    const requestKey = submissionKeys.getOrCreate("admission-checklist", entityId)
    setCurrentChecklist((current) => ({ ...current, [item]: checked }))
    setSavingItems((current) => new Set(current).add(item))

    try {
      const saved = await setRegistrationAdmissionChecklistItem({
        taskId,
        item,
        checked,
        requestKey,
      })
      submissionKeys.clear("admission-checklist", entityId)
      setCurrentChecklist((current) => ({
        ...current,
        [item]: saved.checklist[item],
      }))
    } catch (error) {
      setCurrentChecklist((current) => ({ ...current, [item]: previousChecked }))
      onWarning(errorMessage(error, "입학 처리 체크 항목을 저장하지 못했습니다."))
    } finally {
      setSavingItems((current) => {
        const next = new Set(current)
        next.delete(item)
        return next
      })
    }
  }

  return (
    <section className="grid gap-3" aria-label="입학 처리">
      <h3 className="text-sm font-semibold">입학 처리</h3>
      <RegistrationAdmissionChecklist
        checklist={currentChecklist}
        editable={permissions.canManage}
        savingItems={savingItems}
        onCheckedChange={(item, checked) => void setChecklistItem(item, checked)}
      />
    </section>
  )
}
