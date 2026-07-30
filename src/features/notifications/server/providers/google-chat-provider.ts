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
  if (value === null) return null
  if (
    typeof value !== "string" ||
    !value.startsWith("/admin/") ||
    value.includes("#") ||
    EXTERNAL_URL_PATTERN.test(value)
  ) {
    return undefined
  }

  try {
    const parsed = new URL(value, GOOGLE_CHAT_APP_ORIGIN)
    if (
      parsed.origin !== GOOGLE_CHAT_APP_ORIGIN ||
      !parsed.pathname.startsWith("/admin/") ||
      parsed.hash
    ) {
      return undefined
    }
    return parsed.toString()
  } catch {
    return undefined
  }
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
      const href = absoluteGoogleChatAppHref(context.href)
      if (href === undefined) {
        return result("failed", "render_validation_failed", {
          errorCode: "render_validation_failed",
          errorSummary: "notification link invalid",
        })
      }

      let response: Response
      try {
        response = await transport(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: [context.rendered_title, context.rendered_body, href]
              .filter((value): value is string => typeof value === "string" && value.length > 0)
              .join("\n"),
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
