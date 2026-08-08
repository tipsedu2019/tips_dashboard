export const MAKEUP_TABLE_TIMEOUT_MS = 12_000

const MAKEUP_WORKSPACE_RETRY_MESSAGE = "서버 응답이 지연되었습니다. 잠시 후 다시 시도해 주세요."
const MAKEUP_WORKSPACE_LOAD_FALLBACK = "휴보강 신청서 데이터를 불러오지 못했습니다."

export function getMakeupWorkspaceLoadErrorMessage(error: unknown) {
  const errorRecord = error && typeof error === "object"
    ? error as { name?: unknown; message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    : {}
  const name = String(errorRecord.name || "").trim()
  const message = String(errorRecord.message || "").trim()
  const details = String(errorRecord.details || "").trim()
  const hint = String(errorRecord.hint || "").trim()
  const code = String(errorRecord.code || "").trim()
  const diagnostic = [message, details, hint, code].filter(Boolean).join(" ")

  if (
    name === "AbortError" ||
    name === "TimeoutError" ||
    code === "57014" ||
    /\babort(?:ed|error)?\b|\b(?:timed out|timeout)\b|failed to fetch|network(?: request)? (?:failed|error)|networkerror|load failed/i.test(diagnostic)
  ) {
    return MAKEUP_WORKSPACE_RETRY_MESSAGE
  }

  return message || details || hint || MAKEUP_WORKSPACE_LOAD_FALLBACK
}
