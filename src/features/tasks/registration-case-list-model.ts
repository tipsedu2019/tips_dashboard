import type { OpsTask } from "./ops-task-service"
import {
  getRegistrationTrackViewKey,
  isRegistrationTrackTerminal,
  type RegistrationTrackViewKey,
} from "./registration-track-model.js"
import type {
  OpsRegistrationTrackStatus,
  OpsRegistrationTrackSummary,
  RegistrationSubject,
} from "./registration-track-service"

export type RegistrationCaseListTrackItem = {
  key: string
  trackId: string
  subject: RegistrationSubject
  status: OpsRegistrationTrackStatus
  viewKey: RegistrationTrackViewKey
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
  viewKey: RegistrationTrackViewKey
  matchingTracks: RegistrationCaseListTrackItem[]
  representativeTrack: RegistrationCaseListTrackItem
  representativeSortValue: string
}

const REGISTRATION_TRACK_VIEW_KEYS: RegistrationTrackViewKey[] = [
  "inquiry",
  "level_test",
  "consulting",
  "waiting",
  "enrollment",
  "closed",
]

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
      viewKey: getRegistrationTrackViewKey(track.status),
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
  viewKey: RegistrationTrackViewKey,
): RegistrationCaseListTrackItem[] {
  if (viewKey === "closed") {
    return item.tracks.length > 0 && item.tracks.every((track) => isRegistrationTrackTerminal(track.status))
      ? item.tracks
      : []
  }
  return item.tracks.filter((track) => track.viewKey === viewKey)
}

export function getRegistrationCaseTabCounts(
  items: readonly RegistrationCaseListItem[],
): Record<RegistrationTrackViewKey, number> {
  const counts = Object.fromEntries(REGISTRATION_TRACK_VIEW_KEYS.map((viewKey) => [viewKey, 0])) as Record<RegistrationTrackViewKey, number>
  for (const item of items) {
    for (const viewKey of REGISTRATION_TRACK_VIEW_KEYS) {
      if (getRegistrationCaseMatchedTracks(item, viewKey).length > 0) counts[viewKey] += 1
    }
  }
  return counts
}

export function filterRegistrationCaseListItems(
  items: readonly RegistrationCaseListItem[],
  viewKey: RegistrationTrackViewKey,
  query = "",
): RegistrationCaseListViewItem[] {
  const normalizedQuery = normalizeRegistrationCaseSearchText(query)
  const matched = items.flatMap((item) => {
    const matchingTracks = getRegistrationCaseMatchedTracks(item, viewKey)
    if (matchingTracks.length === 0 || !matchesRegistrationCaseSearch(item, matchingTracks, normalizedQuery)) return []
    const representativeTrack = getRepresentativeTrack(matchingTracks, viewKey)
    return [{
      ...item,
      viewKey,
      matchingTracks,
      representativeTrack,
      representativeSortValue: getRegistrationCaseTrackTimeValue(representativeTrack),
    }]
  })

  if (viewKey !== "consulting") return matched
  return [...matched].sort(compareConsultationCaseItems)
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

function getRepresentativeTrack(
  matchingTracks: RegistrationCaseListTrackItem[],
  viewKey: RegistrationTrackViewKey,
): RegistrationCaseListTrackItem {
  if (viewKey !== "consulting") return matchingTracks[0]
  return [...matchingTracks].sort(compareConsultationTracks)[0]
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
    ...item.tracks.map((track) => track.subject),
    ...matchingTracks.flatMap((track) => [track.directorName, track.visitPlace]),
  ].some((value) => normalizeRegistrationCaseSearchText(value).includes(normalizedQuery))
}

function normalizeRegistrationCaseSearchText(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "")
}
