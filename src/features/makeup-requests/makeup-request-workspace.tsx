"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Bell, Check, CircleAlert, MessageSquare, Plus, RefreshCw, RotateCcw, Send, Settings, Trash2, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DatePickerControl, TimePickerControl } from "@/components/ui/date-time-picker"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/providers/auth-provider"
import {
  buildRoomAvailability,
  getAllowedApproverNames,
  getDefaultMakeupEndAt,
  MAKEUP_REQUEST_STATUS_LABELS,
} from "./makeup-request-model.js"
import {
  approveMakeupRequest,
  cancelCompletedMakeupRequest,
  completeMakeupRequest,
  createMakeupRequest,
  loadMakeupRequestWorkspaceData,
  MAKEUP_NOTIFICATION_CHANNEL_LABELS,
  MAKEUP_NOTIFICATION_TRIGGER_LABELS,
  rejectMakeupRequest,
  requestMakeupRequestRevision,
  resubmitMakeupRequest,
  toggleMakeupNotificationSetting,
  type MakeupClassOption,
  type MakeupNotificationSetting,
  type MakeupRequest,
  type MakeupRequestInput,
  type MakeupRequestWorkspaceData,
} from "./makeup-request-service"

type MakeupRequestView = "mine" | "approvals" | "manager" | "closed"

const EMPTY_INPUT: MakeupRequestInput = {
  classId: "",
  reason: "",
  cancelDate: "",
  makeupSlots: [{ id: "slot-1", date: "", startTime: "", endTime: "", classroom: "" }],
  makeupClassroom: "",
  approverTeacherCatalogId: "",
}

const STATUS_BADGE_VARIANT: Record<MakeupRequest["status"], "default" | "secondary" | "outline" | "destructive"> = {
  approval_pending: "secondary",
  revision_requested: "outline",
  rejected: "destructive",
  manager_pending: "default",
  completed: "outline",
  canceled: "outline",
}

const SUBJECT_SORT_ORDER = ["영어", "수학"]

const NOTIFICATION_DELIVERY_STATUS_LABELS: Record<string, string> = {
  sent: "발송",
  skipped: "건너뜀",
  failed: "실패",
  disabled: "꺼짐",
  deduped: "중복 차단",
}

function sortSubjectOptions(left: string, right: string) {
  const leftIndex = SUBJECT_SORT_ORDER.indexOf(left)
  const rightIndex = SUBJECT_SORT_ORDER.indexOf(right)
  if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex
  if (leftIndex >= 0) return -1
  if (rightIndex >= 0) return 1
  return left.localeCompare(right, "ko")
}

function formatDateTime(value: string) {
  if (!value) return "-"
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return match ? `${match[1]} ${match[2]}` : value
}

function getStatusLabel(status: MakeupRequest["status"]) {
  return (MAKEUP_REQUEST_STATUS_LABELS as Record<string, string>)[status] || status
}

function findSelectedClass(data: MakeupRequestWorkspaceData, input: MakeupRequestInput) {
  return data.classes.find((classItem) => classItem.id === input.classId) || null
}

function canUserManage(userRole: string) {
  return userRole === "admin" || userRole === "staff"
}

function getMakeupActionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === "object") {
    const detail = [
      (error as { message?: unknown }).message,
      (error as { details?: unknown }).details,
      (error as { hint?: unknown }).hint,
      (error as { code?: unknown }).code,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" · ")
    if (detail) return detail
  }
  return fallback
}

function getRequestEvent(request: MakeupRequest, eventTypes: string[]) {
  const typeSet = new Set(eventTypes)
  return [...(request.events || [])]
    .filter((event) => typeSet.has(event.eventType))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null
}

function formatRequestTimeline(request: MakeupRequest) {
  const submittedEvent = getRequestEvent(request, ["submitted", "resubmitted"])
  const approvedEvent = getRequestEvent(request, ["approved"])
  const returnedEvent = getRequestEvent(request, ["revision_requested"])
  const rejectedEvent = getRequestEvent(request, ["rejected"])
  const completedEvent = getRequestEvent(request, ["completed"])
  const canceledEvent = getRequestEvent(request, ["completed_canceled"])

  return [
    {
      label: submittedEvent?.eventType === "resubmitted" ? "재상신" : "상신",
      at: submittedEvent?.createdAt || request.createdAt,
      actor: submittedEvent?.actorLabel || request.requesterLabel,
    },
    { label: "보완 요청", at: returnedEvent?.createdAt || "", actor: returnedEvent?.actorLabel || "" },
    { label: "승인", at: request.approvedAt || approvedEvent?.createdAt || "", actor: request.approvedByLabel || approvedEvent?.actorLabel || request.approverLabel },
    { label: "반려", at: rejectedEvent?.createdAt || "", actor: rejectedEvent?.actorLabel || "" },
    { label: "완료", at: request.completedAt || completedEvent?.createdAt || "", actor: request.completedByLabel || completedEvent?.actorLabel || "" },
    { label: "완료 취소", at: request.canceledAt || canceledEvent?.createdAt || "", actor: request.canceledByLabel || canceledEvent?.actorLabel || "" },
  ].filter((item) => Boolean(item.at))
}

function getManagerProcessorLabel(request: MakeupRequest) {
  const completedEvent = getRequestEvent(request, ["completed"])
  const canceledEvent = getRequestEvent(request, ["completed_canceled"])
  return request.canceledByLabel || request.completedByLabel || canceledEvent?.actorLabel || completedEvent?.actorLabel || "-"
}

function getRequestSlots(request: MakeupRequest) {
  return request.makeupSlots.length > 0
    ? request.makeupSlots
    : [{ id: "slot-1", startAt: request.makeupStartAt, endAt: request.makeupEndAt, classroom: request.makeupClassroom }]
}

function renderClosedRequestsTable(options: {
  requests: MakeupRequest[]
  isManager: boolean
  saving: boolean
  onCancelRequest: (request: MakeupRequest) => void
}) {
  const { requests, isManager, saving, onCancelRequest } = options

  return (
    <Card className="gap-0 overflow-hidden rounded-lg py-0">
      <Table className="min-w-[1180px] table-fixed">
        <TableHeader className="bg-muted/30">
          <TableRow>
            <TableHead className="w-[170px] px-4">신청서</TableHead>
            <TableHead className="w-[200px]">사유</TableHead>
            <TableHead className="w-[250px]">휴강/보강</TableHead>
            <TableHead className="w-[230px]">결재/관리팀 처리자</TableHead>
            <TableHead className="w-[240px]">단계 일시</TableHead>
            <TableHead className="w-[190px] pr-4 text-right">액션</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                표시할 신청서가 없습니다.
              </TableCell>
            </TableRow>
          ) : requests.map((request) => {
            const requestSlots = getRequestSlots(request)
            const timeline = formatRequestTimeline(request)
            return (
              <TableRow key={request.id}>
                <TableCell className="whitespace-normal px-4 align-top">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{request.className}</div>
                    <div className="mt-1 text-xs text-muted-foreground">과목 {request.subject || "-"} · 선생님 {request.teacherLabel}</div>
                    <div className="mt-1 text-xs text-muted-foreground">신청자 {request.requesterLabel}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">ID {request.id.slice(0, 8)}</div>
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal align-top text-xs">
                  <div className="whitespace-pre-wrap text-foreground">{request.reason || "-"}</div>
                  {request.returnedReason ? <div className="mt-2 text-primary">보완: {request.returnedReason}</div> : null}
                  {request.rejectedReason ? <div className="mt-2 text-destructive">반려: {request.rejectedReason}</div> : null}
                  {request.finalNote ? <div className="mt-2 text-muted-foreground">관리 메모: {request.finalNote}</div> : null}
                </TableCell>
                <TableCell className="whitespace-normal align-top text-xs">
                  <div className="font-medium">휴강일 {request.cancelDate || "-"}</div>
                  {requestSlots.map((slot, index) => (
                    <div key={slot.id || `${request.id}-${index}`} className="mt-2 rounded-md bg-muted/30 px-2 py-1">
                      <div>{formatDateTime(slot.startAt || request.makeupStartAt)} - {formatDateTime(slot.endAt || request.makeupEndAt)}</div>
                      <div className="mt-0.5 text-muted-foreground">보강 강의실 {slot.classroom || request.makeupClassroom || "-"}</div>
                    </div>
                  ))}
                </TableCell>
                <TableCell className="whitespace-normal align-top text-xs">
                  <div>결재자 {request.approverLabel}</div>
                  <div className="mt-1">승인자 {request.approvedByLabel || "-"}</div>
                  <div className="mt-1 font-medium">관리팀 처리자 {getManagerProcessorLabel(request)}</div>
                </TableCell>
                <TableCell className="whitespace-normal align-top text-xs">
                  {timeline.map((item) => (
                    <div key={`${request.id}-${item.label}-${item.at}`} className="mb-1 last:mb-0">
                      <span className="font-medium">{item.label}</span>
                      <span className="ml-1 text-muted-foreground">{formatDateTime(item.at)}</span>
                      {item.actor ? <span className="ml-1 text-muted-foreground">· {item.actor}</span> : null}
                    </div>
                  ))}
                </TableCell>
                <TableCell className="whitespace-normal pr-4 align-top">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Badge variant={STATUS_BADGE_VARIANT[request.status]}>{getStatusLabel(request.status)}</Badge>
                    {request.status === "completed" && isManager ? (
                      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => onCancelRequest(request)}>
                        <RotateCcw className="size-4" aria-hidden="true" />
                        처리 완료 취소
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}

function createSlotId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildSlotDateTime(date = "", time = "") {
  if (!date || !time) return ""
  return `${date}T${time}:00+09:00`
}

function getDatePart(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ""
}

function getTimePart(value: string) {
  const match = value.match(/T(\d{2}:\d{2})/)
  return match ? match[1] : ""
}

function toFormSlot(slot: { id?: string; startAt?: string; endAt?: string; classroom?: string }) {
  return {
    id: slot.id || createSlotId(),
    date: getDatePart(slot.startAt || ""),
    startTime: getTimePart(slot.startAt || ""),
    endTime: getTimePart(slot.endAt || ""),
    classroom: slot.classroom || "",
  }
}

function isCompleteSlotDateTime(slot: MakeupRequestInput["makeupSlots"][number]) {
  return Boolean(slot.date && slot.startTime && slot.endTime)
}

function materializeSlot(slot: MakeupRequestInput["makeupSlots"][number]) {
  if (!isCompleteSlotDateTime(slot)) return null
  return {
    ...slot,
    startAt: buildSlotDateTime(slot.date, slot.startTime),
    endAt: buildSlotDateTime(slot.date, slot.endTime),
    classroom: slot.classroom || "",
  }
}

function materializeSlots(input: MakeupRequestInput) {
  return input.makeupSlots
    .map((slot) => materializeSlot(slot))
    .filter((slot): slot is NonNullable<ReturnType<typeof materializeSlot>> => Boolean(slot))
}

function getClassTeacherKey(classItem: MakeupClassOption) {
  return classItem.teacherCatalogId ? `id:${classItem.teacherCatalogId}` : `name:${classItem.teacher}`
}

function getSlotRoomAvailability(
  slot: MakeupRequestInput["makeupSlots"][number],
  data: MakeupRequestWorkspaceData,
  currentRequestId = "",
  subject = "",
) {
  const materializedSlot = materializeSlot(slot)
  return buildRoomAvailability({
    classrooms: data.classrooms,
    classes: data.classes,
    requests: data.requests,
    academicEvents: data.academicEvents,
    slots: materializedSlot ? [materializedSlot] : [],
    currentRequestId,
    subject,
  })
}

function getSlotRoomCollisionState(
  slot: MakeupRequestInput["makeupSlots"][number],
  data: MakeupRequestWorkspaceData,
  currentRequestId = "",
  subject = "",
) {
  const room = slot.classroom || ""
  if (!room) return null
  return getSlotRoomAvailability(slot, data, currentRequestId, subject).find((item) => item.name === room) || null
}

function hasSlotRoomCollision(
  slots: MakeupRequestInput["makeupSlots"],
  data: MakeupRequestWorkspaceData,
  currentRequestId = "",
  subject = "",
) {
  return slots.some((slot) => Boolean(getSlotRoomCollisionState(slot, data, currentRequestId, subject)?.collisions.length))
}

export function MakeupRequestWorkspace() {
  const { user, role, loading: authLoading } = useAuth()
  const [view, setView] = useState<MakeupRequestView>("mine")
  const [data, setData] = useState<MakeupRequestWorkspaceData>({
    schemaReady: true,
    requests: [],
    profiles: [],
    teachers: [],
    classes: [],
    classrooms: [],
    academicEvents: [],
    notificationSettings: [],
    notificationDeliveries: [],
  })
  const [input, setInput] = useState<MakeupRequestInput>(EMPTY_INPUT)
  const [selectedSubject, setSelectedSubject] = useState("")
  const [selectedTeacherKey, setSelectedTeacherKey] = useState("")
  const [editingRequestId, setEditingRequestId] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [finalConfirmRequest, setFinalConfirmRequest] = useState<MakeupRequest | null>(null)
  const [finalConfirmNote, setFinalConfirmNote] = useState("")
  const [finalCancelRequest, setFinalCancelRequest] = useState<MakeupRequest | null>(null)
  const [finalCancelNote, setFinalCancelNote] = useState("")
  const [notificationDialogOpen, setNotificationDialogOpen] = useState(false)

  const currentUserId = user?.id || ""
  const selectedClass = useMemo(() => findSelectedClass(data, input), [data, input])
  const isManager = canUserManage(role)
  const shouldShowRequestForm = view === "mine"

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const nextData = await loadMakeupRequestWorkspaceData()
      setData(nextData)
      if (!nextData.schemaReady) {
        setError(nextData.error || "휴보강 신청서 DB 상태를 확인해 주세요.")
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "휴보강 신청서를 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authLoading) {
      void refresh()
    }
  }, [authLoading, refresh])

  const allowedApproverNames = useMemo(() => (
    selectedClass ? getAllowedApproverNames(selectedClass) : []
  ), [selectedClass])

  const approverOptions = useMemo(() => (
    data.teachers.filter((teacher) => allowedApproverNames.includes(teacher.name))
  ), [allowedApproverNames, data.teachers])

  const subjectOptions = useMemo(() => (
    [...new Set(data.classes.map((classItem) => classItem.subject).filter(Boolean))]
      .sort(sortSubjectOptions)
  ), [data.classes])

  const teacherOptions = useMemo(() => {
    const optionMap = new Map<string, string>()
    data.classes
      .filter((classItem) => !selectedSubject || classItem.subject === selectedSubject)
      .forEach((classItem) => {
        const key = getClassTeacherKey(classItem)
        if (key) optionMap.set(key, classItem.teacher || "선생님 미지정")
      })
    return [...optionMap.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, "ko"))
  }, [data.classes, selectedSubject])

  const availableClasses = useMemo(() => (
    data.classes.filter((classItem) => (
      (!selectedSubject || classItem.subject === selectedSubject) &&
      (!selectedTeacherKey || getClassTeacherKey(classItem) === selectedTeacherKey)
    ))
  ), [data.classes, selectedSubject, selectedTeacherKey])

  const selectedRoomHasCollision = useMemo(() => (
    hasSlotRoomCollision(input.makeupSlots, data, editingRequestId, selectedClass?.subject || selectedSubject)
  ), [data, editingRequestId, input.makeupSlots, selectedClass?.subject, selectedSubject])

  const filteredRequests = useMemo(() => {
    if (view === "mine") {
      return data.requests.filter((request) => request.requesterId === currentUserId || request.teacherProfileId === currentUserId)
    }
    if (view === "approvals") {
      return data.requests.filter((request) => request.approverProfileId === currentUserId && request.status === "approval_pending")
    }
    if (view === "manager") {
      return data.requests.filter((request) => request.status === "manager_pending")
    }
    return data.requests.filter((request) => ["completed", "rejected", "canceled"].includes(request.status))
  }, [currentUserId, data.requests, view])

  const viewCounts = useMemo(() => ({
    mine: data.requests.filter((request) => request.requesterId === currentUserId || request.teacherProfileId === currentUserId).length,
    approvals: data.requests.filter((request) => request.approverProfileId === currentUserId && request.status === "approval_pending").length,
    manager: data.requests.filter((request) => request.status === "manager_pending").length,
    closed: data.requests.filter((request) => ["completed", "rejected", "canceled"].includes(request.status)).length,
  }), [currentUserId, data.requests])

  const notificationSettingsByTrigger = useMemo(() => {
    const grouped = new Map<string, MakeupNotificationSetting[]>()
    for (const setting of data.notificationSettings || []) {
      const list = grouped.get(setting.triggerKind) || []
      list.push(setting)
      grouped.set(setting.triggerKind, list)
    }
    return grouped
  }, [data.notificationSettings])

  const patchInput = useCallback((patch: Partial<MakeupRequestInput>) => {
    setInput((current) => ({ ...current, ...patch }))
  }, [])

  const handleSubjectChange = useCallback((subject: string) => {
    setSelectedSubject(subject)
    setSelectedTeacherKey("")
    setInput((current) => ({
      ...current,
      classId: "",
      makeupClassroom: "",
      makeupSlots: current.makeupSlots.map((slot) => ({ ...slot, classroom: "" })),
      approverTeacherCatalogId: "",
    }))
  }, [])

  const handleTeacherChange = useCallback((teacherKey: string) => {
    setSelectedTeacherKey(teacherKey)
    setInput((current) => ({
      ...current,
      classId: "",
      makeupClassroom: "",
      makeupSlots: current.makeupSlots.map((slot) => ({ ...slot, classroom: "" })),
      approverTeacherCatalogId: "",
    }))
  }, [])

  const handleClassChange = useCallback((classId: string) => {
    const classItem = data.classes.find((item) => item.id === classId) || null
    const allowedNames = classItem ? getAllowedApproverNames(classItem) : []
    const firstApprover = data.teachers.find((teacher) => allowedNames.includes(teacher.name))
    setInput((current) => ({
      ...current,
      classId,
      approverTeacherCatalogId: firstApprover?.id || "",
    }))
    if (classItem) {
      setSelectedSubject(classItem.subject)
      setSelectedTeacherKey(getClassTeacherKey(classItem))
    }
  }, [data.classes, data.teachers])

  const patchMakeupSlot = useCallback((slotId: string, patch: Partial<MakeupRequestInput["makeupSlots"][number]>) => {
    setInput((current) => ({
      ...current,
      makeupSlots: current.makeupSlots.map((slot) => {
        if (slot.id !== slotId) return slot
        const nextSlot = { ...slot, ...patch }
        if ((patch.date || patch.startTime) && nextSlot.date && nextSlot.startTime && !patch.endTime) {
          const defaultEndAt = getDefaultMakeupEndAt(buildSlotDateTime(nextSlot.date, nextSlot.startTime), selectedClass || {})
          nextSlot.endTime = getTimePart(defaultEndAt) || nextSlot.endTime
        }
        return nextSlot
      }),
    }))
  }, [selectedClass])

  const addMakeupSlot = useCallback(() => {
    setInput((current) => ({
      ...current,
      makeupSlots: [
        ...current.makeupSlots,
        {
          id: createSlotId(),
          date: current.makeupSlots[current.makeupSlots.length - 1]?.date || current.cancelDate || "",
          startTime: "",
          endTime: "",
          classroom: "",
        },
      ],
    }))
  }, [])

  const removeMakeupSlot = useCallback((slotId: string) => {
    setInput((current) => ({
      ...current,
      makeupSlots: current.makeupSlots.length <= 1
        ? current.makeupSlots
        : current.makeupSlots.filter((slot) => slot.id !== slotId),
    }))
  }, [])

  const resetForm = useCallback(() => {
    setInput(EMPTY_INPUT)
    setSelectedSubject("")
    setSelectedTeacherKey("")
    setEditingRequestId("")
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!currentUserId) {
      setError("로그인 세션을 확인할 수 없습니다.")
      return
    }
    if (!input.classId || !input.reason || !input.cancelDate || !input.approverTeacherCatalogId) {
      setError("필수 항목을 모두 입력해 주세요.")
      return
    }
    if (input.makeupSlots.length === 0 || input.makeupSlots.some((slot) => !isCompleteSlotDateTime(slot))) {
      setError("보강일시의 날짜, 시작시각, 종료시각을 모두 입력해 주세요.")
      return
    }
    if (input.makeupSlots.some((slot) => !slot.classroom)) {
      setError("각 보강일시의 강의실을 선택해 주세요.")
      return
    }
    if (selectedRoomHasCollision) {
      setError("충돌이 없는 보강 강의실을 선택해 주세요.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")
    try {
      const makeupSlots = materializeSlots(input)
      const payload = {
        ...input,
        makeupClassroom: makeupSlots[0]?.classroom || "",
        makeupSlots,
      }
      if (editingRequestId) {
        await resubmitMakeupRequest(editingRequestId, payload, currentUserId)
        setMessage("휴보강 신청서를 재상신했습니다.")
      } else {
        await createMakeupRequest(payload, currentUserId)
        setMessage("휴보강 신청서를 상신했습니다.")
      }
      resetForm()
      await refresh()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "휴보강 신청서 저장에 실패했습니다.")
    } finally {
      setSaving(false)
    }
  }, [currentUserId, editingRequestId, input, refresh, resetForm, selectedRoomHasCollision])

  const runAction = useCallback(async (action: () => Promise<void>, successMessage: string) => {
    setSaving(true)
    setError("")
    setMessage("")
    try {
      await action()
      setMessage(successMessage)
      await refresh()
      return true
    } catch (actionError) {
      setError(getMakeupActionErrorMessage(actionError, "요청 처리에 실패했습니다."))
      return false
    } finally {
      setSaving(false)
    }
  }, [refresh])

  const closeFinalConfirmDialog = useCallback(() => {
    if (saving) return
    setFinalConfirmRequest(null)
    setFinalConfirmNote("")
  }, [saving])

  const closeFinalCancelDialog = useCallback(() => {
    if (saving) return
    setFinalCancelRequest(null)
    setFinalCancelNote("")
  }, [saving])

  const handleFinalConfirm = useCallback(async () => {
    if (!finalConfirmRequest) return
    const completed = await runAction(
      () => completeMakeupRequest(finalConfirmRequest.id, currentUserId, finalConfirmNote),
      "최종 확인 및 캘린더 반영을 완료했습니다.",
    )
    if (completed) {
      setFinalConfirmRequest(null)
      setFinalConfirmNote("")
    }
  }, [currentUserId, finalConfirmNote, finalConfirmRequest, runAction])

  const handleFinalCancel = useCallback(async () => {
    if (!finalCancelRequest) return
    const canceled = await runAction(
      () => cancelCompletedMakeupRequest(finalCancelRequest.id, currentUserId, finalCancelNote),
      "휴보강 처리 완료를 취소했습니다.",
    )
    if (canceled) {
      setFinalCancelRequest(null)
      setFinalCancelNote("")
    }
  }, [currentUserId, finalCancelNote, finalCancelRequest, runAction])

  const handleToggleNotificationSetting = useCallback(async (setting: MakeupNotificationSetting) => {
    if (!isManager) {
      setError("관리팀만 알림 설정을 변경할 수 있습니다.")
      return
    }
    await runAction(
      () => toggleMakeupNotificationSetting(setting.triggerKind, setting.channel, !setting.enabled, currentUserId),
      "알림 설정을 저장했습니다.",
    )
  }, [currentUserId, isManager, runAction])

  const handleEditForRevision = useCallback((request: MakeupRequest) => {
    const requestClass = data.classes.find((classItem) => classItem.id === request.classId) || null
    setEditingRequestId(request.id)
    setView("mine")
    if (requestClass) {
      setSelectedSubject(requestClass.subject)
      setSelectedTeacherKey(getClassTeacherKey(requestClass))
    }
    setInput({
      classId: request.classId,
      reason: request.reason,
      cancelDate: request.cancelDate,
      makeupSlots: request.makeupSlots.length > 0
        ? request.makeupSlots.map((slot) => toFormSlot({ ...slot, classroom: slot.classroom || request.makeupClassroom }))
        : [toFormSlot({ startAt: request.makeupStartAt, endAt: request.makeupEndAt, classroom: request.makeupClassroom })],
      makeupClassroom: request.makeupSlots[0]?.classroom || request.makeupClassroom,
      approverTeacherCatalogId: request.approverTeacherCatalogId,
    })
  }, [data.classes])

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="휴보강 신청서 보기">
          {[
            { id: "mine", label: "내 신청" },
            { id: "approvals", label: "결재함" },
            { id: "manager", label: "관리팀" },
            { id: "closed", label: "완료/반려" },
          ].map((tab) => (
            <Button
              key={tab.id}
              type="button"
              variant={view === tab.id ? "default" : "outline"}
              size="sm"
              role="tab"
              aria-selected={view === tab.id}
              onClick={() => setView(tab.id as MakeupRequestView)}
            >
              {tab.label}
              <Badge variant={view === tab.id ? "secondary" : "outline"}>{viewCounts[tab.id as MakeupRequestView]}</Badge>
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={() => setNotificationDialogOpen(true)}>
            <Settings className="size-4" aria-hidden="true" />
            알림 설정
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading || saving}>
            <RefreshCw className="size-4" aria-hidden="true" />
            새로고침
          </Button>
        </div>
      </div>

      {message ? <div role="status" className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">{message}</div> : null}
      {error ? <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}

      <div className={shouldShowRequestForm ? "grid min-w-0 gap-4 2xl:grid-cols-[minmax(500px,0.95fr)_minmax(0,1fr)]" : "grid min-w-0 gap-4"}>
        {shouldShowRequestForm ? (
        <Card className="min-w-0 gap-4 overflow-hidden rounded-lg py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center justify-between text-base">
              휴보강 신청서
              {editingRequestId ? <Badge variant="outline">보완 재상신</Badge> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 px-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="makeup-subject">과목</Label>
                <Select value={selectedSubject} onValueChange={handleSubjectChange}>
                  <SelectTrigger id="makeup-subject">
                    <SelectValue placeholder="과목 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjectOptions.map((subject) => (
                      <SelectItem key={subject} value={subject}>{subject}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="makeup-teacher">선생님</Label>
                <Select value={selectedTeacherKey} onValueChange={handleTeacherChange} disabled={!selectedSubject}>
                  <SelectTrigger id="makeup-teacher">
                    <SelectValue placeholder={selectedSubject ? "선생님 선택" : "과목 먼저"} />
                  </SelectTrigger>
                  <SelectContent>
                    {teacherOptions.map((teacher) => (
                      <SelectItem key={teacher.value} value={teacher.value}>{teacher.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="makeup-class">수업</Label>
                <Select value={input.classId} onValueChange={handleClassChange} disabled={!selectedTeacherKey}>
                  <SelectTrigger id="makeup-class">
                    <SelectValue placeholder={selectedTeacherKey ? "수업 선택" : "선생님 먼저"} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableClasses.map((classItem) => (
                      <SelectItem key={classItem.id} value={classItem.id}>
                        {classItem.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="makeup-reason">사유</Label>
              <Textarea
                id="makeup-reason"
                value={input.reason}
                onChange={(event) => patchInput({ reason: event.target.value })}
                placeholder="휴강 및 보강 사유"
                rows={3}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cancel-date">휴강일</Label>
              <DatePickerControl
                id="cancel-date"
                value={input.cancelDate}
                onChange={(value) => patchInput({ cancelDate: value })}
                placeholder="휴강일 선택"
                ariaLabel="휴강일 선택"
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label>보강일시</Label>
                <Button type="button" variant="outline" size="sm" onClick={addMakeupSlot}>
                  <Plus className="size-4" aria-hidden="true" />
                  보강일시 추가
                </Button>
              </div>
              <div className="grid gap-2">
                {input.makeupSlots.map((slot, index) => {
                  const slotRoomAvailability = getSlotRoomAvailability(slot, data, editingRequestId, selectedClass?.subject || selectedSubject)
                  const selectedSlotRoomState = getSlotRoomCollisionState(slot, data, editingRequestId, selectedClass?.subject || selectedSubject)
                  const slotDateTimeReady = isCompleteSlotDateTime(slot)

                  return (
                    <div key={slot.id} className="rounded-md border bg-muted/15 p-2">
                      <div className="grid gap-2 md:grid-cols-[minmax(150px,1fr)_minmax(96px,0.55fr)_minmax(96px,0.55fr)_32px]">
                        <div className="grid gap-1">
                          <span className="text-[11px] font-medium text-muted-foreground">날짜</span>
                          <DatePickerControl
                            value={slot.date || ""}
                            onChange={(value) => patchMakeupSlot(slot.id || "", { date: value })}
                            placeholder="날짜 선택"
                            ariaLabel={`보강일시 ${index + 1} 날짜`}
                          />
                        </div>
                        <div className="grid gap-1">
                          <span className="text-[11px] font-medium text-muted-foreground">시작시각</span>
                          <TimePickerControl
                            value={slot.startTime || ""}
                            onChange={(value) => patchMakeupSlot(slot.id || "", { startTime: value })}
                            placeholder="시작"
                            ariaLabel={`보강일시 ${index + 1} 시작시각`}
                          />
                        </div>
                        <div className="grid gap-1">
                          <span className="text-[11px] font-medium text-muted-foreground">종료시각</span>
                          <TimePickerControl
                            value={slot.endTime || ""}
                            onChange={(value) => patchMakeupSlot(slot.id || "", { endTime: value })}
                            placeholder="종료"
                            ariaLabel={`보강일시 ${index + 1} 종료시각`}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="self-end justify-self-end"
                          onClick={() => removeMakeupSlot(slot.id || "")}
                          disabled={input.makeupSlots.length <= 1}
                          aria-label={`보강일시 ${index + 1} 삭제`}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                        <div className="grid gap-1 md:col-span-3">
                          <span className="flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                            보강 강의실
                            <span>빈 강의실 우선</span>
                          </span>
                          <Select
                            value={slot.classroom || ""}
                            onValueChange={(value) => patchMakeupSlot(slot.id || "", { classroom: value })}
                            disabled={!slotDateTimeReady}
                          >
                            <SelectTrigger aria-label={`보강일시 ${index + 1} 강의실`}>
                              <SelectValue placeholder="강의실 선택" />
                            </SelectTrigger>
                            <SelectContent>
                              {slotRoomAvailability.map((room) => (
                                <SelectItem key={room.name} value={room.name} disabled={!room.available}>
                                  {room.name} · {room.available ? "빈 강의실" : "충돌"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {selectedSlotRoomState?.collisions.length ? (
                        <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                          {selectedSlotRoomState.collisions.map((collision) => `${collision.title || collision.detail} (${collision.source})`).join(" · ")}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="makeup-approver">결재자</Label>
              <Select value={input.approverTeacherCatalogId} onValueChange={(value) => patchInput({ approverTeacherCatalogId: value })}>
                <SelectTrigger id="makeup-approver">
                  <SelectValue placeholder={selectedClass ? "결재자 선택" : "수업을 먼저 선택"} />
                </SelectTrigger>
                <SelectContent>
                  {approverOptions.map((teacher) => (
                    <SelectItem key={teacher.id} value={teacher.id}>
                      {teacher.name}{teacher.profileId ? "" : " · 계정 연결 필요"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button type="button" onClick={() => void handleSubmit()} disabled={saving || loading || selectedRoomHasCollision}>
                <Send className="size-4" aria-hidden="true" />
                {editingRequestId ? "재상신" : "상신"}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
                취소
              </Button>
            </div>
          </CardContent>
        </Card>
        ) : null}

        {view === "closed" ? renderClosedRequestsTable({
          requests: filteredRequests,
          isManager,
          saving,
          onCancelRequest: (request) => {
            setFinalCancelRequest(request)
            setFinalCancelNote("")
          },
        }) : (
        <Card className="gap-0 overflow-hidden rounded-lg py-0">
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(150px,0.8fr)_minmax(120px,0.7fr)_minmax(160px,0.8fr)] gap-3 border-b bg-muted/30 px-4 py-3 text-xs font-medium text-muted-foreground">
            <span>신청서</span>
            <span>보강</span>
            <span>상태</span>
            <span className="text-right">액션</span>
          </div>
          {loading ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">불러오는 중입니다.</div>
          ) : filteredRequests.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">표시할 신청서가 없습니다.</div>
          ) : filteredRequests.map((request) => {
            const requestSlots = request.makeupSlots.length > 0
              ? request.makeupSlots
              : [{ id: "slot-1", startAt: request.makeupStartAt, endAt: request.makeupEndAt, classroom: request.makeupClassroom }]
            const managerHasCollision = requestSlots.some((slot) => {
              const formSlot = toFormSlot({ ...slot, classroom: slot.classroom || request.makeupClassroom })
              return Boolean(getSlotRoomCollisionState(formSlot, data, request.id, request.subject)?.collisions.length)
            })

            return (
              <div
                key={request.id}
                className="grid grid-cols-[minmax(0,1.4fr)_minmax(150px,0.8fr)_minmax(120px,0.7fr)_minmax(160px,0.8fr)] gap-3 border-b px-4 py-3 text-sm last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{request.className}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{request.teacherLabel} · 휴강일 {request.cancelDate}</div>
                  {request.returnedReason || request.rejectedReason ? (
                    <div className="mt-1 flex items-start gap-1 text-xs text-destructive">
                      <CircleAlert className="mt-0.5 size-3" aria-hidden="true" />
                      <span>{request.returnedReason || request.rejectedReason}</span>
                    </div>
                  ) : null}
                </div>
                <div className="min-w-0 text-xs">
                  {requestSlots.map((slot, index) => (
                    <div key={slot.id || `${request.id}-${index}`} className={index > 0 ? "mt-1.5 border-t pt-1.5" : ""}>
                      <div className="font-medium">{formatDateTime(slot.startAt || request.makeupStartAt)}</div>
                      <div className="mt-1 text-muted-foreground">{slot.classroom || request.makeupClassroom}</div>
                    </div>
                  ))}
                  {managerHasCollision ? <div className="mt-1 text-destructive">충돌 있음</div> : null}
                </div>
                <div>
                  <Badge variant={STATUS_BADGE_VARIANT[request.status]}>
                    {getStatusLabel(request.status)}
                  </Badge>
                  <div className="mt-1 text-xs text-muted-foreground">{request.approverLabel}</div>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {request.status === "revision_requested" && request.requesterId === currentUserId ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => handleEditForRevision(request)}>
                      보완
                    </Button>
                  ) : null}
                  {request.status === "approval_pending" && request.approverProfileId === currentUserId ? (
                    <>
                      <Button type="button" size="sm" onClick={() => void runAction(() => approveMakeupRequest(request.id, currentUserId), "결재 승인했습니다.")}>
                        <Check className="size-4" aria-hidden="true" />
                        승인
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const note = window.prompt("보완 요청 사유") || ""
                          if (note) void runAction(() => requestMakeupRequestRevision(request.id, currentUserId, note), "보완 요청을 보냈습니다.")
                        }}
                      >
                        보완 요청
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          const note = window.prompt("반려 사유") || ""
                          if (note) void runAction(() => rejectMakeupRequest(request.id, currentUserId, note), "반려 처리했습니다.")
                        }}
                      >
                        <X className="size-4" aria-hidden="true" />
                        반려
                      </Button>
                    </>
                  ) : null}
                  {request.status === "manager_pending" && isManager ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={managerHasCollision}
                      onClick={() => {
                        setFinalConfirmRequest(request)
                        setFinalConfirmNote("")
                      }}
                    >
                      최종 확인
                    </Button>
                  ) : null}
                  {request.status === "completed" && isManager ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setFinalCancelRequest(request)
                        setFinalCancelNote("")
                      }}
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                      처리 완료 취소
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </Card>
        )}
      </div>

      <Dialog open={notificationDialogOpen} onOpenChange={setNotificationDialogOpen}>
        <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>알림 설정</DialogTitle>
            <DialogDescription>
              알림/웹훅 트리거와 Google Chat 발송 현황을 확인합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.8fr)]">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 text-sm font-medium">
                  <Bell className="size-4" aria-hidden="true" />
                  알림/웹훅
                </div>
                <Badge variant={isManager ? "outline" : "secondary"}>{isManager ? "관리팀 제어" : "읽기 전용"}</Badge>
              </div>
              {(Object.entries(MAKEUP_NOTIFICATION_TRIGGER_LABELS) as Array<[keyof typeof MAKEUP_NOTIFICATION_TRIGGER_LABELS, string]>).map(([triggerKind, triggerLabel]) => {
                const settings = notificationSettingsByTrigger.get(triggerKind) || []
                return (
                  <div key={triggerKind} className="grid gap-2 rounded-md border bg-muted/15 p-3 md:grid-cols-[120px_minmax(0,1fr)]">
                    <div className="text-sm font-medium">{triggerLabel}</div>
                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      {settings.map((setting) => (
                        <Button
                          key={`${setting.triggerKind}-${setting.channel}`}
                          type="button"
                          variant={setting.enabled ? "default" : "outline"}
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={saving || !isManager}
                          onClick={() => void handleToggleNotificationSetting(setting)}
                        >
                          {MAKEUP_NOTIFICATION_CHANNEL_LABELS[setting.channel]}
                          <Badge variant={setting.enabled ? "secondary" : "outline"} className="ml-1 h-5 px-1">
                            {setting.enabled ? "켜짐" : "꺼짐"}
                          </Badge>
                        </Button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="min-w-0 rounded-md border">
              <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                <div className="inline-flex items-center gap-2 text-sm font-medium">
                  <MessageSquare className="size-4" aria-hidden="true" />
                  발송 현황
                </div>
                <Badge variant="outline">{data.notificationDeliveries.length}</Badge>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {data.notificationDeliveries.length === 0 ? (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">최근 발송 기록이 없습니다.</div>
                ) : data.notificationDeliveries.map((delivery) => (
                  <div key={delivery.id} className="grid gap-1 border-b px-3 py-2 text-xs last:border-b-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">
                        {MAKEUP_NOTIFICATION_TRIGGER_LABELS[delivery.triggerKind]} · {MAKEUP_NOTIFICATION_CHANNEL_LABELS[delivery.channel]}
                      </span>
                      <Badge variant={delivery.status === "failed" ? "destructive" : delivery.status === "sent" ? "default" : "outline"}>
                        {NOTIFICATION_DELIVERY_STATUS_LABELS[delivery.status] || delivery.status}
                      </Badge>
                    </div>
                    <div className="truncate text-muted-foreground">
                      {delivery.targetLabel || delivery.targetType} · {formatDateTime(delivery.createdAt)}
                    </div>
                    {delivery.error ? <div className="truncate text-destructive">{delivery.error}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(finalConfirmRequest)} onOpenChange={(open) => {
        if (!open) closeFinalConfirmDialog()
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>최종 확인</DialogTitle>
            <DialogDescription>
              {finalConfirmRequest?.className || "선택한 신청서"} 수업계획과 캘린더에 반영합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="makeup-final-note">관리팀 메모</Label>
            <Textarea
              id="makeup-final-note"
              value={finalConfirmNote}
              onChange={(event) => setFinalConfirmNote(event.target.value)}
              placeholder="필요 시 메모"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeFinalConfirmDialog} disabled={saving}>
              취소
            </Button>
            <Button type="button" onClick={() => void handleFinalConfirm()} disabled={saving || !finalConfirmRequest}>
              <Check className="size-4" aria-hidden="true" />
              최종 확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(finalCancelRequest)} onOpenChange={(open) => {
        if (!open) closeFinalCancelDialog()
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>처리 완료 취소</DialogTitle>
            <DialogDescription>
              수업일정과 캘린더 반영을 되돌립니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="makeup-final-cancel-note">취소 메모</Label>
            <Textarea
              id="makeup-final-cancel-note"
              value={finalCancelNote}
              onChange={(event) => setFinalCancelNote(event.target.value)}
              placeholder={finalCancelRequest?.className || "필요 시 메모"}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeFinalCancelDialog} disabled={saving}>
              닫기
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleFinalCancel()} disabled={saving || !finalCancelRequest}>
              <RotateCcw className="size-4" aria-hidden="true" />
              처리 완료 취소
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
