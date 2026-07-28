export const CONTINUOUS_CLASS_SCHEDULE_RPC = {
  getDefaults: "get_class_schedule_defaults_v1",
  getSchedule: "get_class_schedule_v1",
  initializeNewClass: "initialize_new_class_schedule_v1",
  saveDefaults: "save_class_schedule_defaults_v1",
  previewGeneration: "preview_class_lesson_session_generation_v1",
  generateSessions: "generate_class_lesson_sessions_v1",
  saveSession: "save_class_lesson_session_v1",
  saveContent: "save_class_lesson_content_v1",
  backfillShadow: "backfill_class_schedule_shadow_v1",
  verifyShadow: "verify_class_schedule_shadow_v1",
  activateStorage: "activate_class_schedule_storage_v1",
  deactivateStorage: "deactivate_class_schedule_storage_v1",
} as const;

export type ContinuousScheduleState =
  | "active"
  | "exception"
  | "makeup"
  | "tbd"
  | "skipped";

export type ContinuousScheduleSlotInput = {
  id: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  teacherCatalogId: string | null;
  classroomCatalogId: string | null;
  sortOrder: number;
};

export type ContinuousScheduleSlotSnapshot = ContinuousScheduleSlotInput & {
  id: string;
  classId: string;
  teacherName: string;
  classroomName: string;
};

export type SaveClassScheduleDefaultsInput = {
  classId: string;
  expectedScheduleRevision: number;
  slots: ContinuousScheduleSlotInput[];
  reason: string | null;
};

export type SaveClassScheduleDefaultsOutput = {
  changed: boolean;
  scheduleRevision: number;
  slots: ContinuousScheduleSlotSnapshot[];
  projectionHash: string;
};

export type GenerateClassLessonSessionsInput = {
  classId: string;
  expectedScheduleRevision: number;
  dateFrom: string;
  dateTo: string;
  reason: string | null;
};

export type SaveClassLessonSessionInput = {
  sessionId: string;
  expectedRevision: number;
  scheduleState: ContinuousScheduleState;
  sessionDate: string;
  startTime: string | null;
  endTime: string | null;
  teacherCatalogId: string | null;
  classroomCatalogId: string | null;
  memo: string;
  publicNote: string;
  teacherNote: string;
  correctionReason: string | null;
};

export type SaveClassLessonContentInput = {
  classId: string;
  expectedContentHash: string;
  contentPatch: Record<string, unknown>;
};

export type ContinuousScheduleRpcInputMap = {
  getDefaults: { classId: string };
  getSchedule: { classId: string; dateFrom: string; dateTo: string };
  initializeNewClass: {
    classId: string;
    expectedScheduleRevision: number;
    expectedSchedulePlanHash: string;
    slots: ContinuousScheduleSlotInput[];
  };
  saveDefaults: SaveClassScheduleDefaultsInput;
  previewGeneration: {
    classId: string;
    expectedScheduleRevision: number;
    dateFrom: string;
    dateTo: string;
  };
  generateSessions: GenerateClassLessonSessionsInput;
  saveSession: SaveClassLessonSessionInput;
  saveContent: SaveClassLessonContentInput;
  backfillShadow: {
    classId: string;
    expectedSourceHash: string;
    slots: unknown[];
    sessions: unknown[];
  };
  verifyShadow: { classId: string; expectedSourceHash: string };
  activateStorage: {
    classId: string;
    expectedScheduleRevision: number;
    expectedSourceHash: string;
  };
  deactivateStorage: { classId: string; reason: string };
};

export type ContinuousScheduleRpcOutput = {
  authoritativeSource: "legacy" | "normalized";
  runtimeVersion: 0 | 1;
  scheduleRevision: number;
  projectionHash: string;
};
