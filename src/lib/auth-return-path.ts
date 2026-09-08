const DEFAULT_AUTH_RETURN_PATH = "/admin/dashboard"
const RETURN_PATH_ORIGIN = "https://auth-return.invalid"

export function getAuthReturnPath(value: string | null) {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/u.test(value)
  ) {
    return DEFAULT_AUTH_RETURN_PATH
  }

  try {
    const target = new URL(value, RETURN_PATH_ORIGIN)
    // Dot segments can turn an initially relative path into a leading double slash.
    if (target.origin !== RETURN_PATH_ORIGIN || target.pathname.startsWith("//")) {
      return DEFAULT_AUTH_RETURN_PATH
    }
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return DEFAULT_AUTH_RETURN_PATH
  }
}
