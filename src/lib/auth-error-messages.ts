export function getAuthErrorMessage(error: unknown, fallbackMessage: string) {
  const rawMessage = error instanceof Error ? error.message : String(error || "")
  const message = rawMessage.trim()
  const normalizedMessage = message.toLowerCase()

  if (normalizedMessage.includes("invalid login credentials")) {
    return "아이디 또는 비밀번호가 올바르지 않습니다."
  }

  if (
    normalizedMessage.includes("email not confirmed") ||
    normalizedMessage.includes("email address not confirmed")
  ) {
    return "이메일 확인 후 로그인하세요."
  }

  if (
    normalizedMessage.includes("email rate limit") ||
    (normalizedMessage.includes("rate limit") && normalizedMessage.includes("email"))
  ) {
    return "메일 발송 한도를 초과했습니다. 잠시 후 다시 시도하거나 관리자에게 요청해 주세요."
  }

  if (
    normalizedMessage.includes("user already registered") ||
    normalizedMessage.includes("already registered") ||
    normalizedMessage.includes("already been registered")
  ) {
    return "이미 가입된 이메일입니다. 로그인하거나 비밀번호 재설정을 이용해 주세요."
  }

  return message || fallbackMessage
}
