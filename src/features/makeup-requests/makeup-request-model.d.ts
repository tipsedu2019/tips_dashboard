export type MakeupRequestStatus =
  | "approval_pending"
  | "revision_requested"
  | "rejected"
  | "manager_pending"
  | "completed"
  | "canceled";

export type MakeupApprovalGroup = "math_middle" | "math_high" | "english" | "unknown";

export type MakeupRoomCollision = {
  id?: string;
  source: "regular_class" | "makeup_request" | "academic_event";
  title: string;
  classroom: string;
  startAt?: string;
  endAt?: string;
  startLabel?: string;
  endLabel?: string;
  detail?: string;
};

export type MakeupRoomAvailability = {
  name: string;
  available: boolean;
  collisions: MakeupRoomCollision[];
};

export type MakeupSlot = {
  id: string;
  startAt: string;
  endAt: string;
  classroom: string;
};

export const MAKEUP_REQUEST_STATUSES: MakeupRequestStatus[];
export const MAKEUP_REQUEST_STATUS_LABELS: Record<MakeupRequestStatus, string>;
export const ACTIVE_ROOM_RESERVATION_STATUSES: Set<MakeupRequestStatus>;
export const APPROVER_NAMES_BY_GROUP: Record<MakeupApprovalGroup, string[]>;
export const MAKEUP_CALENDAR_NOTE_MARKER: string;

export function resolveMakeupApprovalGroup(classRecord?: unknown): MakeupApprovalGroup;
export function getAllowedApproverNames(classRecordOrGroup?: unknown): string[];
export function canTransitionMakeupRequest(
  status: MakeupRequestStatus,
  nextStatus: MakeupRequestStatus,
  context?: { isRequester?: boolean; isApprover?: boolean; isManager?: boolean },
): boolean;
export function timeRangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean;
export function buildRoomOptions(
  classrooms?: unknown[],
  classes?: unknown[],
  options?: { subject?: string },
): string[];
export function normalizeMakeupSlots(source?: unknown, fallbackClassroom?: string): MakeupSlot[];
export function extractMakeupCalendarMeta(note?: string): Record<string, unknown> | null;
export function buildRoomAvailability(options?: {
  classrooms?: unknown[];
  classes?: unknown[];
  requests?: unknown[];
  academicEvents?: unknown[];
  startAt?: string;
  endAt?: string;
  slots?: unknown[];
  currentRequestId?: string;
  subject?: string;
}): MakeupRoomAvailability[];
export function getDefaultMakeupEndAt(startAt: string, classItem?: unknown): string;
export function applyMakeupRequestToSchedulePlan(
  rawPlan?: Record<string, unknown>,
  classRecord?: unknown,
  request?: unknown,
): Record<string, unknown>;
export function buildMakeupCalendarDrafts(request?: unknown): Array<Record<string, unknown>>;
export function toDateKey(value: string | Date): string;
