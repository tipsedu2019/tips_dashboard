export type TimetableView =
  | "teacher-weekly"
  | "classroom-weekly"
  | "daily-teacher"
  | "daily-classroom";

export type PlanSlot = {
  id: string;
  itemId: string;
  planId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  teacherId: string;
  classroomId: string;
  sourceSlotId: string | null;
  /** Last server snapshot; optional for newly constructed slots. */
  teacherName?: string;
  classroomName?: string;
};

export type ShadowSlot = {
  id: string;
  classId: string;
  sourceSlotId: string | null;
  weekday: number;
  startMinute: number;
  endMinute: number;
  teacherId: string;
  classroomId: string;
  classRevision: number;
};

export type PlanItem = {
  id: string;
  planId: string;
  revision: number;
  name: string;
  subject: string;
  subjectAreaKey: string | null;
  grade: string;
  capacity: number | null;
  tuition: number | null;
  defaultTeacherId: string | null;
  defaultClassroomId: string | null;
  durationMinutes: number | null;
  sourceClassId: string | null;
  state: "draft" | "applied";
  appliedClassId: string | null;
  appliedTransferId: string | null;
  appliedAt: string | null;
  pendingSlots: PendingSlot[];
};

export type PendingSlot = {
  id: string;
  sourceText: string;
  reason: "missing_resource" | "conflict" | "invalid_time";
  weekday: number | null;
  startMinute: number | null;
  endMinute: number | null;
  teacherId: string | null;
  classroomId: string | null;
};

export type OccupancyBlocker = {
  classId: string;
  label: string;
  scope: "all" | "resource";
  resourceId: string | null;
  reason: "unresolved_time" | "unresolved_resource" | "incomplete_read";
};

export type DropTarget = {
  weekday: number;
  startMinute: number;
  teacherId?: string;
  classroomId?: string;
};

export type TimetableConflict = {
  kind: "teacher" | "classroom" | "same_class";
  slotId: string;
  otherSlotId: string;
};

export type GridTarget = {
  view: TimetableView;
  panelKey: string;
  columnKey: string;
  visibleStartMinute: number;
  rowPosition: number;
  slotMinutes: number;
};

/** Catalog UUIDs remain identity even after hiding or deleting a catalog row. */
export type ResourceOption = {
  id: string;
  name: string;
  isVisible: boolean;
  subjects: string[];
  /** Server tombstone for a deleted resource still referenced by this plan. */
  isMissing?: boolean;
};

export type PlanMetadata = {
  id: string;
  name: string;
  state: "draft" | "archived";
  metaRevision: number;
  changeSequence: number;
  targetStartDate: string | null;
  targetEndDate: string | null;
};
export type ShadowClass = {
  id: string;
  name: string;
  subject: string | null;
  grade: string | null;
  status: "수강";
  revision: number;
};
export type TimetableOperatingReference = {
  shadowSlots: ShadowSlot[];
  shadowClasses: ShadowClass[];
  catalogs: { teachers: ResourceOption[]; classrooms: ResourceOption[] };
  unresolvedOccupancies: OccupancyBlocker[];
  shadowFingerprint: string;
  complete: boolean;
};
export type PlanAccess = {
  canManage: boolean;
  canEdit: boolean;
  canTransfer: boolean;
};
export type PlanMember = { userId: string; name: string; access: "viewer" | "editor" };
export type PlanSnapshot = TimetableOperatingReference & {
  plan: PlanMetadata;
  items: PlanItem[];
  /** Draft slots only. Applied slots are immutable history below. */
  slots: PlanSlot[];
  appliedSnapshots: Array<{ itemId: string; slots: PlanSlot[] }>;
  members: PlanMember[];
  permissions: PlanAccess;
  capacity: {
    itemCount: number;
    slotCount: number;
    maxItems: 500;
    maxSlots: 2000;
    exceeded: boolean;
  };
};
export type PlanItemDraft = Pick<PlanItem,
  | "id" | "planId" | "name" | "subject" | "subjectAreaKey" | "grade"
  | "capacity" | "tuition" | "defaultTeacherId" | "defaultClassroomId"
  | "durationMinutes" | "pendingSlots"
>;
export type SavePlanItemCommand = {
  operation: "save";
  planId: string;
  expectedMetaRevision: number;
  expectedShadowFingerprint: string;
  item: PlanItemDraft;
  expectedItemRevision: number | null;
  slots: PlanSlot[];
  requestKey: string;
};
export type DeletePlanItemCommand = {
  operation: "delete";
  planId: string;
  itemId: string;
  expectedMetaRevision: number;
  expectedShadowFingerprint: string;
  expectedItemRevision: number;
  requestKey: string;
};
export type PlanMutationResult = {
  planId: string;
  metaRevision: number;
  changeSequence: number;
  shadowFingerprint: string;
  item: PlanItem | null;
  slots: PlanSlot[];
  removedItemIds: string[];
};
export type PlanCommand =
  | { operation: "create"; planId: string; name: string; targetStartDate?: string | null; targetEndDate?: string | null; requestKey: string }
  | { operation: "clone"; planId: string; sourcePlanId: string; expectedMetaRevision: number; name: string; requestKey: string }
  | { operation: "rename"; planId: string; expectedMetaRevision: number; name: string; targetStartDate?: string | null; targetEndDate?: string | null; requestKey: string }
  | { operation: "archive" | "restore"; planId: string; expectedMetaRevision: number; requestKey: string }
  | { operation: "share"; planId: string; expectedMetaRevision: number; members: Array<Pick<PlanMember, "userId" | "access">>; requestKey: string };
export type PlanRevision = Pick<PlanMutationResult, "planId" | "metaRevision" | "changeSequence" | "shadowFingerprint"> & { complete: boolean };
export type PlanList = { plans: PlanMetadata[]; total: number; page: number; pageSize: number; canManage: boolean };
export type ShareCandidate = { userId: string; name: string; role: "teacher" };
/** Re-fetch the authorized snapshot; event data never replaces schedule state. */
export type TimetableInvalidationSignal = {
  id: string;
  plan_id: string | null;
  change_sequence: number;
  updated_at: string;
};
export type TimetablePlanRpcContract = {
  list_timetable_plans_v1: { Args: { p_search?: string; p_archived?: boolean; p_page?: number; p_page_size?: number }; Returns: PlanList };
  get_timetable_plan_v1: { Args: { p_plan_id: string }; Returns: PlanSnapshot };
  get_timetable_plan_revision_v1: { Args: { p_plan_id: string }; Returns: PlanRevision };
  list_timetable_share_candidates_v1: { Args: Record<string, never>; Returns: ShareCandidate[] };
  mutate_timetable_plan_v1: { Args: { p_command: PlanCommand }; Returns: { plan: PlanMetadata } };
  mutate_timetable_plan_item_v1: { Args: { p_command: SavePlanItemCommand | DeletePlanItemCommand }; Returns: PlanMutationResult };
};
