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
