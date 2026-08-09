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
}

export function normalizeDashboardSummarySources(value: unknown): DashboardSummarySources
export function normalizeDashboardConflictSources(value: unknown): DashboardConflictSourcesSnapshot
