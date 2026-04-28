export type OperationsSourceRow = Record<string, unknown>;

export type AcademicCalendarEvent = {
  id: string;
  title: string;
  type: string;
  start: string;
  end: string;
  grade: string;
  schoolId: string;
  schoolName: string;
  category: string;
  note: string;
};

export type AcademicCalendarDay = {
  date: string;
  day: number;
  events: AcademicCalendarEvent[];
};

export type AcademicCalendarWorkspaceModel = {
  month: string;
  monthOptions: string[];
  days: AcademicCalendarDay[];
  events: AcademicCalendarEvent[];
  upcomingEvents: AcademicCalendarEvent[];
  typeOptions: string[];
  schoolOptions: Array<{ value: string; label: string }>;
  categoryOptions: string[];
  summary: {
    eventCount: number;
    schoolCount: number;
    upcomingCount: number;
    typeCount: number;
  };
};

export type ClassScheduleRouteRow = {
  id: string;
  title: string;
  subject: string;
  grade: string;
  teacher: string;
  termName: string;
  scheduleLabel: string;
  sessionCount: number;
  completedSessions: number;
  latestPlannedSessionIndex: number;
  latestActualSessionIndex: number;
  nextActionSessionId: string;
  syncGroupName: string;
  warningText: string;
  raw: Record<string, unknown>;
};

export type ClassScheduleRouteModel = {
  rows: ClassScheduleRouteRow[];
  filterOptions: {
    terms: Array<{ value: string; label: string }>;
    subjects: string[];
    grades: string[];
    teachers: string[];
  };
  syncGroupCards: Array<{
    id: string;
    name: string;
    memberCount: number;
    warningText: string;
    members: Array<{ classId: string; className: string }>;
  }>;
  summary: {
    classCount: number;
    totalSessions: number;
    completedSessions: number;
    warningCount: number;
  };
  timelineRange: {
    start: string;
    end: string;
  };
  errors: Array<{
    classId: string;
    className: string;
    message: string;
  }>;
};

export function buildAcademicCalendarWorkspaceModel(input?: {
  academicEvents?: OperationsSourceRow[];
  academicSchools?: OperationsSourceRow[];
  filters?: Record<string, string>;
  month?: string;
}): AcademicCalendarWorkspaceModel;

export function buildClassScheduleRouteModel(input?: {
  classes?: OperationsSourceRow[];
  textbooks?: OperationsSourceRow[];
  progressLogs?: OperationsSourceRow[];
  classTerms?: OperationsSourceRow[];
  syncGroups?: OperationsSourceRow[];
  syncGroupMembers?: OperationsSourceRow[];
  filters?: Record<string, string>;
}): ClassScheduleRouteModel;
