import { validateGoogleChatWebhookUrl } from "../notification-connection-crypto.ts"

export type NotificationProviderResult = Readonly<{
  status: "sent" | "retry_wait" | "failed" | "delivery_unknown"
  statusReason: string | null
  providerMessageId: string | null
  providerResponseCode: string | null
  errorCode: string | null
  errorSummary: string | null
  nextAttemptAt: string | null
}>

export type Http408Disposition = "retry_wait" | "delivery_unknown"

export type GoogleChatBegunDeliveryContext = Readonly<{
  delivery_id: string
  claim_token: string
  dispatch_token: string
  status: "sending"
  channel_key: "google_chat"
  connection_key: string | null
  webhook_url: string | null
  rendered_title: string
  rendered_body: string
  href: string | null
}>

type FetchTransport = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

const SAFE_PROVIDER_ID = /^[A-Za-z0-9._/-]{1,256}$/
const GOOGLE_CHAT_APP_ORIGIN = "https://tipsedu.co.kr"
const EXTERNAL_URL_PATTERN = /(?:https?:\/\/|\/\/)/iu
const ENCODED_PATH_SEPARATOR_OR_TRAVERSAL = /%(?:2e|2f|5c)/iu
const RAW_PATH_SEPARATOR_OR_TRAVERSAL = /(?:\\|(?:^|\/)\.{1,2}(?:\/|$))/u
const MAX_GOOGLE_CHAT_TEXT_BYTES = 32_000
const GOOGLE_CHAT_LINK_QUERY_KEYS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  "/admin/tasks": new Set(["taskId", "focus"]),
  "/admin/word-retests": new Set(["taskId"]),
  "/admin/registration": new Set(["taskId", "trackId", "appointmentId", "view"]),
  "/admin/transfer": new Set(["flow", "taskId"]),
  "/admin/withdrawal": new Set(["flow", "taskId"]),
  "/admin/makeup-requests": new Set(["request"]),
  "/admin/approvals": new Set(["approvalId"]),
})

export type GoogleChatTextPayloadResult =
  | Readonly<{
      ok: true
      text: string
      absoluteUrl: string
      byteLength: number
    }>
  | Readonly<{
      ok: false
      errorCode: "render_validation_failed"
    }>

function result(
  status: NotificationProviderResult["status"],
  statusReason: string | null,
  values: Partial<Omit<NotificationProviderResult, "status" | "statusReason">> = {},
): NotificationProviderResult {
  return {
    status,
    statusReason,
    providerMessageId: values.providerMessageId ?? null,
    providerResponseCode: values.providerResponseCode ?? null,
    errorCode: values.errorCode ?? null,
    errorSummary: values.errorSummary ?? null,
    nextAttemptAt: values.nextAttemptAt ?? null,
  }
}

function safeWebhookUrl(value: unknown) {
  try {
    return validateGoogleChatWebhookUrl(value)
  } catch {
    return null
  }
}

function absoluteGoogleChatAppHref(value: unknown) {
  const rawPath = typeof value === "string" ? value.split("?", 1)[0] : ""
  if (
    typeof value !== "string" ||
    !value.startsWith("/admin/") ||
    value.includes("#") ||
    EXTERNAL_URL_PATTERN.test(value) ||
    ENCODED_PATH_SEPARATOR_OR_TRAVERSAL.test(rawPath) ||
    RAW_PATH_SEPARATOR_OR_TRAVERSAL.test(rawPath)
  ) {
    return undefined
  }

  try {
    const parsed = new URL(value, GOOGLE_CHAT_APP_ORIGIN)
    const allowedQueryKeys = GOOGLE_CHAT_LINK_QUERY_KEYS[parsed.pathname]
    if (
      parsed.origin !== GOOGLE_CHAT_APP_ORIGIN ||
      !allowedQueryKeys ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      return undefined
    }

    const seenQueryKeys = new Set<string>()
    for (const [key, queryValue] of parsed.searchParams) {
      if (
        !allowedQueryKeys.has(key) ||
        seenQueryKeys.has(key) ||
        !queryValue ||
        /[\u0000-\u001f\u007f]/u.test(queryValue)
      ) return undefined
      seenQueryKeys.add(key)
    }
    if (parsed.searchParams.has("view") && parsed.searchParams.get("view") !== "calendar") {
      return undefined
    }
    if (
      parsed.searchParams.has("flow") &&
      !["applicant", "operations", "closed"].includes(parsed.searchParams.get("flow") || "")
    ) return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}

export function buildGoogleChatTextPayload(input: Pick<
  GoogleChatBegunDeliveryContext,
  "rendered_title" | "rendered_body" | "href"
>): GoogleChatTextPayloadResult {
  if (
    !input ||
    typeof input.rendered_title !== "string" ||
    !input.rendered_title ||
    typeof input.rendered_body !== "string" ||
    !input.rendered_body ||
    EXTERNAL_URL_PATTERN.test(input.rendered_title) ||
    EXTERNAL_URL_PATTERN.test(input.rendered_body)
  ) return { ok: false, errorCode: "render_validation_failed" }

  const absoluteUrl = absoluteGoogleChatAppHref(input.href)
  if (!absoluteUrl) return { ok: false, errorCode: "render_validation_failed" }
  const text = `${input.rendered_title}\n\n${input.rendered_body}\n\n${absoluteUrl}`
  const byteLength = Buffer.byteLength(text, "utf8")
  if (byteLength > MAX_GOOGLE_CHAT_TEXT_BYTES) {
    return { ok: false, errorCode: "render_validation_failed" }
  }
  return { ok: true, text, absoluteUrl, byteLength }
}

function nextRetryAt() {
  return new Date(Date.now() + 60_000).toISOString()
}

function normalizeHttp408Disposition(value: unknown): Http408Disposition {
  return value === "delivery_unknown" ? "delivery_unknown" : "retry_wait"
}

function safeProviderMessageId(value: unknown) {
  if (typeof value !== "string" || !SAFE_PROVIDER_ID.test(value)) return null
  return value
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return ""
  return String(error.code || "").toUpperCase()
}

function classifyTransportError(error: unknown): NotificationProviderResult {
  const code = errorCode(error)
  const name = error && typeof error === "object" && "name" in error
    ? String(error.name || "")
    : ""

  if (code === "ETIMEDOUT" || name === "TimeoutError" || name === "AbortError") {
    return result("delivery_unknown", "provider_timeout_after_dispatch", {
      errorCode: "provider_timeout",
      errorSummary: "provider result unavailable",
    })
  }
  if (code === "ECONNRESET" || code === "EPIPE") {
    return result("delivery_unknown", "connection_reset_after_dispatch", {
      errorCode: "connection_reset",
      errorSummary: "provider result unavailable",
    })
  }
  return result("delivery_unknown", "provider_ambiguous_response", {
    errorCode: "provider_transport_error",
    errorSummary: "provider result unavailable",
  })
}

export function createGoogleChatProvider(input: {
  fetch: FetchTransport
  http408Disposition?: Http408Disposition
}) {
  const transport = input.fetch
  const http408Disposition = normalizeHttp408Disposition(input.http408Disposition)

  return {
    async send(context: GoogleChatBegunDeliveryContext): Promise<NotificationProviderResult> {
      const webhookUrl = safeWebhookUrl(context?.webhook_url)
      if (!webhookUrl || context?.status !== "sending" || context?.channel_key !== "google_chat") {
        return result("failed", "connection_missing", {
          errorCode: "connection_missing",
          errorSummary: "provider connection unavailable",
        })
      }
      const payload = buildGoogleChatTextPayload(context)
      if (!payload.ok) {
        return result("failed", "render_validation_failed", {
          errorCode: "render_validation_failed",
          errorSummary: "notification content invalid",
        })
      }

      let response: Response
      try {
        response = await transport(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: payload.text,
          }),
        })
      } catch (error) {
        return classifyTransportError(error)
      }

      const responseCode = String(response.status)
      if (response.ok) {
        let providerMessageId: string | null = null
        try {
          const responseBody = await response.json() as { name?: unknown }
          providerMessageId = safeProviderMessageId(responseBody.name)
        } catch {
          providerMessageId = null
        }
        return result("sent", null, {
          providerMessageId,
          providerResponseCode: responseCode,
        })
      }

      if (response.status === 429) {
        return result("retry_wait", "provider_rate_limited", {
          providerResponseCode: responseCode,
          errorCode: "provider_rate_limited",
          errorSummary: "provider temporarily rejected the request",
          nextAttemptAt: nextRetryAt(),
        })
      }
      if (response.status >= 500) {
        return result("delivery_unknown", "provider_ambiguous_response", {
          providerResponseCode: responseCode,
          errorCode: "provider_transport_error",
          errorSummary: "provider result unavailable",
        })
      }
      if (response.status === 408) {
        if (http408Disposition === "retry_wait") {
          return result("retry_wait", "transient_pre_dispatch_failure", {
            providerResponseCode: responseCode,
            errorCode: "transient_pre_dispatch_failure",
            errorSummary: "provider temporarily rejected the request",
            nextAttemptAt: nextRetryAt(),
          })
        }
        return result("delivery_unknown", "provider_ambiguous_response", {
          providerResponseCode: responseCode,
          errorCode: "provider_transport_error",
          errorSummary: "provider result unavailable",
        })
      }
      if (response.status === 425) {
        return result("retry_wait", "transient_pre_dispatch_failure", {
          providerResponseCode: responseCode,
          errorCode: "transient_pre_dispatch_failure",
          errorSummary: "provider temporarily rejected the request",
          nextAttemptAt: nextRetryAt(),
        })
      }
      return result("failed", "provider_definite_rejection", {
        providerResponseCode: responseCode,
        errorCode: "provider_definite_rejection",
        errorSummary: "provider rejected the request",
      })
    },
  }
}
