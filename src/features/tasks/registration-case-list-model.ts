import type { OpsTask } from "./ops-task-service"
import {
  getRegistrationWorkflowStatusFromLegacyTrack,
  getRegistrationWorkflowViewKey,
} from "./registration-workflow-status.js"
import type {
  OpsRegistrationTrackStatus,
  OpsRegistrationTrackSummary,
  OpsRegistrationWorkflowStatus,
  RegistrationSubject,
} from "./registration-track-service"

export type RegistrationWorkflowViewKey =
  | "inquiry"
  | "level_test"
  | "consultation_requested"
  | "consultation_completed"
  | "waiting"
  | "enrollment"
  | "payment"
  | "completed"

export type RegistrationCaseListTrackItem = {
  key: string
  trackId: string
  subject: RegistrationSubject
  status: OpsRegistrationTrackStatus
  workflowStatus: OpsRegistrationWorkflowStatus
  workflowRevision: number
  workflowStatusEnteredAt: string
  viewKey: RegistrationWorkflowViewKey
  directorProfileId: string | null
  directorName: string
  stageEnteredAt: string
  phoneReadyAt: string | null
  migrationReviewRequired: boolean
  visitScheduledAt: string
  visitPlace: string
  sourceIndex: number
  track: OpsRegistrationTrackSummary
}

export type RegistrationCaseListItem = {
  key: string
  taskId: string
  studentName: string
  sourceIndex: number
  task: OpsTask
  tracks: RegistrationCaseListTrackItem[]
}

export type RegistrationCaseListViewItem = RegistrationCaseListItem & {
  viewKey: RegistrationWorkflowViewKey
  matchingTracks: RegistrationCaseListTrackItem[]
  representativeTrack: RegistrationCaseListTrackItem
  representativeSortValue: string
}

export type RegistrationCaseListFilterOptions = {
  consultationOwnerId?: string | null
}

const REGISTRATION_TRACK_VIEW_KEYS: RegistrationWorkflowViewKey[] = [
  "inquiry",
  "level_test",
  "consultation_requested",
  "consultation_completed",
  "waiting",
  "enrollment",
  "payment",
  "completed",
]

const DELETABLE_WORKFLOW_STATUSES = new Set<OpsRegistrationWorkflowStatus>(["inquiry"])

export function canDeleteRegistrationCase(
  task: Pick<OpsTask, "type" | "status" | "registrationTracks">,
  viewerRole: string | null | undefined,
): boolean {
  if (viewerRole !== "admin" || task.type !== "registration") return false
  if (task.status === "done" || task.status === "canceled") return false
  const tracks = task.registrationTracks || []
  return tracks.length > 0 && tracks.every((track) => DELETABLE_WORKFLOW_STATUSES.has(track.workflowStatus))
}

export function buildRegistrationCaseListItems(
  tasks: readonly OpsTask[],
): RegistrationCaseListItem[] {
  return tasks.map((task, sourceIndex) => ({
    key: task.id,
    taskId: task.id,
    studentName: task.studentName || task.title,
    sourceIndex,
    task,
    tracks: (task.registrationTracks || []).map((track, trackSourceIndex) => ({
      key: `${task.id}:${track.id}`,
      trackId: track.id,
      subject: track.subject,
      status: track.status,
      workflowStatus: track.workflowStatus || getRegistrationWorkflowStatusFromLegacyTrack(track),
      workflowRevision: track.workflowRevision || 1,
      workflowStatusEnteredAt: track.workflowStatusEnteredAt || track.stageEnteredAt,
      viewKey: getRegistrationWorkflowViewKey(track.workflowStatus || getRegistrationWorkflowStatusFromLegacyTrack(track)) as RegistrationWorkflowViewKey,
      directorProfileId: track.directorProfileId,
      directorName: track.directorName,
      stageEnteredAt: track.stageEnteredAt,
      phoneReadyAt: track.phoneReadyAt,
      migrationReviewRequired: track.migrationReviewRequired,
      visitScheduledAt: track.visitScheduledAt || "",
      visitPlace: track.visitPlace || "",
      sourceIndex: trackSourceIndex,
      track,
    })),
  }))
}

export function getRegistrationCaseMatchedTracks(
  item: RegistrationCaseListItem,
  viewKey: RegistrationWorkflowViewKey,
): RegistrationCaseListTrackItem[] {
  return item.tracks.filter((track) => track.viewKey === normalizeRegistrationWorkflowViewKey(viewKey))
}

export function getRegistrationCaseTabCounts(
  items: readonly RegistrationCaseListItem[],
): Record<RegistrationWorkflowViewKey, number> {
  const counts = Object.fromEntries(REGISTRATION_TRACK_VIEW_KEYS.map((viewKey) => [viewKey, 0])) as Record<RegistrationWorkflowViewKey, number>
  for (const item of items) {
    for (const viewKey of REGISTRATION_TRACK_VIEW_KEYS) {
      if (getRegistrationCaseMatchedTracks(item, viewKey).length > 0) counts[viewKey] += 1
    }
  }
  return counts
}

export function filterRegistrationCaseListItems(
  items: readonly RegistrationCaseListItem[],
  viewKey: RegistrationWorkflowViewKey,
  query = "",
  options: RegistrationCaseListFilterOptions = {},
): RegistrationCaseListViewItem[] {
  const normalizedViewKey = normalizeRegistrationWorkflowViewKey(viewKey)
  const normalizedQuery = normalizeRegistrationCaseSearchText(query)
  const ownerScoped = normalizedViewKey === "consultation_requested" || normalizedViewKey === "consultation_completed"
  const matched = items.flatMap((item) => {
    const viewTracks = getRegistrationCaseMatchedTracks(item, normalizedViewKey)
    const sourceMatchedTracks = options.consultationOwnerId === undefined || !ownerScoped
      ? viewTracks
      : viewTracks.filter((track) => (
          Boolean(options.consultationOwnerId)
          && track.directorProfileId === options.consultationOwnerId
        ))
    const matchingTracks = normalizedViewKey === "consultation_requested"
      ? [...sourceMatchedTracks].sort(compareConsultationTracks)
      : sourceMatchedTracks
    const searchSubjectTracks = options.consultationOwnerId === undefined || !ownerScoped
      ? item.tracks
      : matchingTracks
    if (
      matchingTracks.length === 0
      || !matchesRegistrationCaseSearch(item, matchingTracks, normalizedQuery, searchSubjectTracks)
    ) return []
    const representativeTrack = matchingTracks[0]
    return [{
      ...item,
      viewKey: normalizedViewKey,
      matchingTracks,
      representativeTrack,
      representativeSortValue: getRegistrationCaseTrackTimeValue(representativeTrack),
    }]
  })

  if (normalizedViewKey !== "consultation_requested") return matched
  return [...matched].sort(compareConsultationCaseItems)
}

function normalizeRegistrationWorkflowViewKey(value: string): RegistrationWorkflowViewKey {
  if (value === "consulting") return "consultation_requested"
  if (value === "closed") return "completed"
  return value as RegistrationWorkflowViewKey
}

export function getRegistrationCaseTrackTimeValue(
  track: Pick<
    RegistrationCaseListTrackItem,
    "status" | "stageEnteredAt" | "phoneReadyAt" | "visitScheduledAt"
  >,
): string {
  if (track.status === "consultation_waiting") return track.phoneReadyAt || ""
  if (track.status === "visit_consultation_scheduled") return track.visitScheduledAt
  return track.stageEnteredAt
}

function compareConsultationCaseItems(
  left: RegistrationCaseListViewItem,
  right: RegistrationCaseListViewItem,
): number {
  const trackComparison = compareConsultationTrackPriorityAndTime(left.representativeTrack, right.representativeTrack)
  if (trackComparison !== 0) return trackComparison
  return left.taskId.localeCompare(right.taskId)
}

function compareConsultationTracks(
  left: RegistrationCaseListTrackItem,
  right: RegistrationCaseListTrackItem,
): number {
  const priorityAndTimeComparison = compareConsultationTrackPriorityAndTime(left, right)
  if (priorityAndTimeComparison !== 0) return priorityAndTimeComparison
  return left.sourceIndex - right.sourceIndex
}

function compareConsultationTrackPriorityAndTime(
  left: RegistrationCaseListTrackItem,
  right: RegistrationCaseListTrackItem,
): number {
  const leftIsPhone = left.status === "consultation_waiting"
  const rightIsPhone = right.status === "consultation_waiting"
  if (leftIsPhone !== rightIsPhone) return leftIsPhone ? -1 : 1
  if (leftIsPhone && rightIsPhone) {
    const timeComparison = compareOptionalDateAscending(left.phoneReadyAt, right.phoneReadyAt)
    if (timeComparison !== 0) return timeComparison
  }
  return 0
}

function compareOptionalDateAscending(left: string | null, right: string | null): number {
  const leftTime = Date.parse(left || "")
  const rightTime = Date.parse(right || "")
  const normalizedLeft = Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY
  const normalizedRight = Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY
  if (normalizedLeft === normalizedRight) return 0
  return normalizedLeft < normalizedRight ? -1 : 1
}

function matchesRegistrationCaseSearch(
  item: RegistrationCaseListItem,
  matchingTracks: RegistrationCaseListTrackItem[],
  normalizedQuery: string,
  subjectTracks: readonly RegistrationCaseListTrackItem[] = item.tracks,
): boolean {
  if (!normalizedQuery) return true
  const registration = item.task.registration
  return [
    item.studentName,
    item.task.title,
    registration?.parentPhone,
    registration?.studentPhone,
    registration?.schoolGrade,
    registration?.schoolName,
    registration?.requestNote,
    ...subjectTracks.map((track) => track.subject),
    ...matchingTracks.flatMap((track) => [track.directorName, track.visitPlace]),
  ].some((value) => normalizeRegistrationCaseSearchText(value).includes(normalizedQuery))
}

function normalizeRegistrationCaseSearchText(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "")
}
