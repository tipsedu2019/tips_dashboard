const DASHBOARD_SOURCE_FORMAT_ERROR = "대시보드 데이터 형식을 확인하지 못했습니다."
const DASHBOARD_SOURCE_RETRY_ERROR = "서버 응답이 지연되었습니다. 잠시 후 다시 시도해 주세요."

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

function errorField(error, key) {
  if (!error || typeof error !== "object") return ""
  return String(error[key] || "").trim()
}

export function getDashboardSourceError(error, fallback = "대시보드 데이터를 불러오지 못했습니다.") {
  const name = error instanceof Error ? error.name : errorField(error, "name")
  const message = error instanceof Error ? error.message : errorField(error, "message")
  const details = errorField(error, "details")
  const hint = errorField(error, "hint")
  const code = errorField(error, "code")
  const diagnostic = [name, message, details, hint, code].join(" ").toLowerCase()

  if (
    name === "AbortError"
    || code === "57014"
    || diagnostic.includes("timed out")
    || diagnostic.includes("timeout")
    || diagnostic.includes("failed to fetch")
    || diagnostic.includes("network request failed")
    || diagnostic.includes("networkerror")
    || diagnostic.includes("context canceled")
    || diagnostic.includes("context deadline")
    || diagnostic.includes("request was aborted")
  ) {
    return DASHBOARD_SOURCE_RETRY_ERROR
  }

  return message || details || hint || fallback
}

export function normalizeDashboardSummarySources(value) {
  return normalizeSourceObject(value, SUMMARY_SOURCE_KEYS)
}

export function normalizeDashboardConflictSources(value) {
  return normalizeSourceObject(value, CONFLICT_SOURCE_KEYS)
}
