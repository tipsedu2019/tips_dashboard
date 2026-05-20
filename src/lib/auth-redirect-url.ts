const DEFAULT_AUTH_REDIRECT_ORIGIN = "https://tipsedu.co.kr"

const LOCAL_AUTH_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"])

function normalizeOrigin(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "")
  if (!trimmed) {
    return DEFAULT_AUTH_REDIRECT_ORIGIN
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function normalizePath(pathname: string) {
  return pathname.startsWith("/") ? pathname : `/${pathname}`
}

export function getAuthRedirectUrl(pathname: string) {
  const configuredOrigin =
    process.env.NEXT_PUBLIC_AUTH_REDIRECT_ORIGIN ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL

  if (configuredOrigin) {
    return `${normalizeOrigin(configuredOrigin)}${normalizePath(pathname)}`
  }

  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location
    const authOrigin = LOCAL_AUTH_HOSTNAMES.has(hostname)
      ? DEFAULT_AUTH_REDIRECT_ORIGIN
      : origin

    return `${normalizeOrigin(authOrigin)}${normalizePath(pathname)}`
  }

  return `${DEFAULT_AUTH_REDIRECT_ORIGIN}${normalizePath(pathname)}`
}
