const DASHBOARD_SOURCE_FORMAT_ERROR = "대시보드 데이터 형식을 확인하지 못했습니다."

const SUMMARY_SOURCE_KEYS = ["classes", "students"]
const CONFLICT_SOURCE_KEYS = [
  "sessionDates",
  "classTerms",
  "classGroups",
  "classGroupMembers",
  "teacherCatalogs",
  "classroomCatalogs",
  "academicSchools",
  "academicExamDays",
  "academicEventExamDetails",
  "academicEvents",
]

function normalizeSourceObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(DASHBOARD_SOURCE_FORMAT_ERROR)
  }

  const normalized = {}
  for (const key of keys) {
    if (!Array.isArray(value[key])) {
      throw new Error(DASHBOARD_SOURCE_FORMAT_ERROR)
    }
    normalized[key] = value[key]
  }
  return normalized
}

export function normalizeDashboardSummarySources(value) {
  return normalizeSourceObject(value, SUMMARY_SOURCE_KEYS)
}

export function normalizeDashboardConflictSources(value) {
  return normalizeSourceObject(value, CONFLICT_SOURCE_KEYS)
}
