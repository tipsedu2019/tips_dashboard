export type AcademicSourceRow = Record<string, unknown>;

export type TimetableRow = {
  id: string;
  classId: string;
  title: string;
  fullTitle: string;
  academicYear: string;
  subject: string;
  grade: string;
  teacher: string;
  classroom: string;
  term: string;
  schedule: string;
  status: string;
  statusFilter: string;
  classGroupIds: string[];
  classGroupNames: string[];
  classGroupLabel: string;
  day: string;
  dayIndex: number;
  start: string;
  end: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  searchText: string;
};

export type TimetableLoadRow = {
  name: string;
  minutes: number;
  count: number;
};

export type TimetableWorkspaceModel = {
  rows: TimetableRow[];
  teacherLoad: TimetableLoadRow[];
  classroomLoad: TimetableLoadRow[];
  yearOptions: string[];
  termOptions: string[];
  subjectOptions: string[];
  classGroupOptions: Array<{ value: string; label: string }>;
  statusOptions: string[];
  gradeOptions: string[];
  teacherOptions: string[];
  classroomOptions: string[];
  dayOptions: string[];
  summary: {
    classCount: number;
    slotCount: number;
    teacherCount: number;
    classroomCount: number;
    weeklyMinutes: number;
  };
};

export type TimetableGridBlock = {
  key: string;
  columnIndex: number;
  startSlot: number;
  endSlot: number;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  clickable: boolean;
  editable: boolean;
  header: string;
  title: string;
  detailLines: Array<{ label: string; value: string }>;
  tooltip: string;
};

export type TimetableGridPanel = {
  id: string;
  title: string;
  columns: string[];
  blocks: TimetableGridBlock[];
};

export type TimetableGridPanelsModel = {
  view: string;
  axisMode: "teacher" | "classroom" | "day";
  axisOptions: string[];
  activeTargets: string[];
  timeSlots: string[];
  panels: TimetableGridPanel[];
};

export type CurriculumRow = {
  id: string;
  title: string;
  fullTitle: string;
  subject: string;
  grade: string;
  term: string;
  teacherNames: string[];
  teacherSummary: string;
  classroomNames: string[];
  classroomSummary: string;
  schedule: string;
  status: string;
  statusFilter: string;
  classGroupIds: string[];
  classGroupNames: string[];
  classGroupLabel: string;
  textbookCount: number;
  totalSessions: number;
  completedSessions: number;
  updatedSessions: number;
  delayedSessions: number;
  progressPercent: number;
  lastUpdatedAt: string;
  stateLabel: string;
  searchText: string;
};

export type CurriculumWorkspaceModel = {
  rows: CurriculumRow[];
  termOptions: string[];
  classGroupOptions: Array<{ value: string; label: string }>;
  statusOptions: string[];
  subjectOptions: string[];
  gradeOptions: string[];
  teacherOptions: string[];
  classroomOptions: string[];
  stateOptions: string[];
  summary: {
    classCount: number;
    managedClassCount: number;
    totalSessions: number;
    completedSessions: number;
    pendingSessions: number;
    linkedTextbooks: number;
  };
};

export function splitTeacherList(value: unknown): string[];
export function splitClassroomList(value: unknown): string[];
export function stripClassPrefix(value: unknown): string;
export function parseAcademicSchedule(
  schedule: unknown,
  classItem?: AcademicSourceRow,
): Array<{
  day: string;
  start: string;
  end: string;
  teacher: string;
  classroom: string;
}>;
export function buildTimetableWorkspaceModel(input?: {
  classes?: AcademicSourceRow[];
  classTerms?: AcademicSourceRow[];
  classGroups?: AcademicSourceRow[];
  classGroupMembers?: AcademicSourceRow[];
  teacherCatalogs?: AcademicSourceRow[];
  classroomCatalogs?: AcademicSourceRow[];
  filters?: Record<string, string>;
}): TimetableWorkspaceModel;
export function buildTimetableGridPanels(input?: {
  workspace?: TimetableWorkspaceModel;
  view?: string;
  gridCount?: number;
  selectedTargets?: string[];
}): TimetableGridPanelsModel;
export function buildCurriculumWorkspaceModel(input?: {
  classes?: AcademicSourceRow[];
  classTerms?: AcademicSourceRow[];
  classGroups?: AcademicSourceRow[];
  classGroupMembers?: AcademicSourceRow[];
  textbooks?: AcademicSourceRow[];
  progressLogs?: AcademicSourceRow[];
  teacherCatalogs?: AcademicSourceRow[];
  classroomCatalogs?: AcademicSourceRow[];
  filters?: Record<string, string>;
}): CurriculumWorkspaceModel;
