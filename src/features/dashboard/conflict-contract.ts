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

export type DashboardConflictTaskLink = {
  conflictKey: string
  linked: boolean
  taskId: string
  canOpen: boolean
  alreadyExists: boolean
}

export type DashboardConflictRpcInput = {
  type: DashboardConflictType
  occurrenceKind: DashboardConflictOccurrenceKind
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

export function projectDashboardConflictRpcInput(
  conflict: DashboardConflictRow,
): DashboardConflictRpcInput {
  return {
    type: conflict.type,
    occurrenceKind: conflict.occurrenceKind,
    classIds: [...conflict.source.classIds],
    studentIds: [...conflict.source.studentIds],
    examEventIds: [...conflict.source.examEventIds],
    examDetailIds: [...conflict.source.examDetailIds],
    teacherCatalogIds: [...conflict.source.teacherCatalogIds],
    classroomCatalogIds: [...conflict.source.classroomCatalogIds],
    weekday: conflict.source.weekday,
    overlapStart: conflict.source.overlapStart,
    overlapEnd: conflict.source.overlapEnd,
    examDate: conflict.source.examDate,
    examRule: conflict.source.examRule,
  }
}
