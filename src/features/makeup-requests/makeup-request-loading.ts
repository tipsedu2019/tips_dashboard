export const MAKEUP_TABLE_TIMEOUT_MS = 12_000

const MAKEUP_WORKSPACE_RETRY_MESSAGE = "서버 응답이 지연되었습니다. 잠시 후 다시 시도해 주세요."
const MAKEUP_WORKSPACE_LOAD_FALLBACK = "휴보강 신청서 데이터를 불러오지 못했습니다."

export function getMakeupWorkspaceLoadErrorMessage(error: unknown) {
  const name = error && typeof error === "object"
    ? String((error as { name?: unknown }).name || "").trim()
    : ""
  const message = error instanceof Error ? error.message.trim() : ""

  if (name === "AbortError" || name === "TimeoutError" || message.toLowerCase().includes("failed to fetch")) {
    return MAKEUP_WORKSPACE_RETRY_MESSAGE
  }

  return message || MAKEUP_WORKSPACE_LOAD_FALLBACK
}
