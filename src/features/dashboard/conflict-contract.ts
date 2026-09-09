export type DashboardConflictType = "exam" | "teacher" | "classroom" | "student"
export type DashboardConflictOccurrenceKind = "dated" | "weekly"
export type DashboardConflictExamRule =
  | "same-day-subject"
  | "day-before-other-subject"
  | ""

export type DashboardConflictSource = {
  classIds: string[]
  studentIds: string[]
  examEventIds: string[]
  examDetailIds: string[]
  teacherCatalogIds: string[]
  classroomCatalogIds: string[]
  weekday: string
  overlapStart: string
  overlapEnd: string
  examDate: string
  examRule: DashboardConflictExamRule
}

export type DashboardConflictRow = {
  key: string
  type: DashboardConflictType
  occurrenceKind: DashboardConflictOccurrenceKind
  title: string
  nextOccurrenceAt: string
  recurrenceDay: string
  problem: string
  ownerLabel: string
  resolution: string
  classIds: string[]
  classNames: string[]
  affectedStudentIds: string[]
  subject: string
  campus: string
  primaryAssigneeProfileId: string
  secondaryAssigneeProfileId: string
  assigneeTeam: string
  source: DashboardConflictSource
}
