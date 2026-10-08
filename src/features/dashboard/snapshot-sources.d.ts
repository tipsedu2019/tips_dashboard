export type DashboardSummarySources = {
  classes: unknown[]
  students: unknown[]
}

export type DashboardConflictSourcesSnapshot = {
  sessionDates: unknown[]
  classTerms: unknown[]
  classGroups: unknown[]
  classGroupMembers: unknown[]
  teacherCatalogs: unknown[]
  classroomCatalogs: unknown[]
  academicSchools: unknown[]
  academicExamDays: unknown[]
  academicEventExamDetails: unknown[]
  academicEvents: unknown[]
  withdrawalRosterCutoffs: DashboardWithdrawalRosterCutoff[]
}

export type DashboardWithdrawalRosterCutoff = {
  classId: string
  studentId: string
  lastLessonDate: string
}

export function normalizeDashboardSummarySources(value: unknown): DashboardSummarySources
export function normalizeDashboardConflictSources(value: unknown): DashboardConflictSourcesSnapshot
export function attachDashboardWithdrawalRosterCutoffs(classes: unknown[], rows: DashboardWithdrawalRosterCutoff[]): unknown[]
export function getDashboardSourceError(error: unknown, fallback?: string): string
