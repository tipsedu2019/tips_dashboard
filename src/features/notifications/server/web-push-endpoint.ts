const MAX_WEB_PUSH_ENDPOINT_LENGTH = 8_192
const EXACT_WEB_PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
  "android.googleapis.com",
])
const WINDOWS_PUSH_HOST_SUFFIX = ".notify.windows.com"
const DNS_NAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function parseAllowedWebPushEndpoint(value: unknown): URL | null {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_WEB_PUSH_ENDPOINT_LENGTH ||
    /[\u0000-\u0020\u007f]/.test(value)
  ) {
    return null
  }

  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    return null
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    !endpoint.pathname || endpoint.pathname === "/"
  ) {
    return null
  }

  const hostname = endpoint.hostname.toLowerCase()
  const isExactHost = EXACT_WEB_PUSH_HOSTS.has(hostname)
  const isWindowsHost = hostname.endsWith(WINDOWS_PUSH_HOST_SUFFIX) &&
    hostname.length > WINDOWS_PUSH_HOST_SUFFIX.length &&
    DNS_NAME_PATTERN.test(hostname)
  if (!isExactHost && !isWindowsHost) return null
  return endpoint
}

export function isAllowedWebPushEndpoint(value: unknown): value is string {
  return parseAllowedWebPushEndpoint(value) !== null
}

export function validateWebPushEndpoint(value: unknown): string {
  const endpoint = parseAllowedWebPushEndpoint(value)
  if (!endpoint) throw new Error("Invalid Web Push endpoint")
  return endpoint.href
}
