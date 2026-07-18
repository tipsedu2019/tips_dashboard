import type { NotificationProviderResult } from "./google-chat-provider.ts"
import { isAllowedWebPushEndpoint } from "../web-push-endpoint.ts"

export type WebPushSubscription = Readonly<{
  endpoint: string
  keys: Readonly<{
    p256dh: string
    auth: string
  }>
}>

export type WebPushBegunDeliveryContext = Readonly<{
  delivery_id: string
  claim_token: string
  dispatch_token: string
  status: "sending"
  channel_key: "web_push"
  subscription: WebPushSubscription | null
  rendered_title: string
  rendered_body: string
  href: string | null
}>

type PushResponse = Readonly<{
  statusCode?: number
  body?: unknown
}>

type SendNotification = (
  subscription: WebPushSubscription,
  payload: string,
) => Promise<PushResponse>

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

function validSubscription(value: WebPushSubscription | null | undefined): value is WebPushSubscription {
  return Boolean(
    value &&
    isAllowedWebPushEndpoint(value.endpoint) &&
    typeof value.keys?.p256dh === "string" && value.keys.p256dh.length > 0 &&
    typeof value.keys?.auth === "string" && value.keys.auth.length > 0,
  )
}

function readStatusCode(value: unknown) {
  if (!value || typeof value !== "object") return null
  if ("statusCode" in value && Number.isInteger(Number(value.statusCode))) {
    return Number(value.statusCode)
  }
  if ("status" in value && Number.isInteger(Number(value.status))) {
    return Number(value.status)
  }
  return null
}

function readErrorCode(value: unknown) {
  if (!value || typeof value !== "object" || !("code" in value)) return ""
  return String(value.code || "").toUpperCase()
}

function nextRetryAt() {
  return new Date(Date.now() + 60_000).toISOString()
}

function classifyFailure(error: unknown): NotificationProviderResult {
  const statusCode = readStatusCode(error)
  const responseCode = statusCode === null ? null : String(statusCode)
  if (statusCode === 429) {
    return result("retry_wait", "provider_rate_limited", {
      providerResponseCode: responseCode,
      errorCode: "provider_rate_limited",
      errorSummary: "provider temporarily rejected the request",
      nextAttemptAt: nextRetryAt(),
    })
  }
  if (statusCode !== null && statusCode >= 500) {
    return result("delivery_unknown", "provider_ambiguous_response", {
      providerResponseCode: responseCode,
      errorCode: "provider_transport_error",
      errorSummary: "provider result unavailable",
    })
  }
  if (statusCode === 408) {
    return result("delivery_unknown", "provider_ambiguous_response", {
      providerResponseCode: responseCode,
      errorCode: "provider_transport_error",
      errorSummary: "provider result unavailable",
    })
  }
  if (statusCode === 425) {
    return result("retry_wait", "transient_pre_dispatch_failure", {
      providerResponseCode: responseCode,
      errorCode: "transient_pre_dispatch_failure",
      errorSummary: "provider temporarily rejected the request",
      nextAttemptAt: nextRetryAt(),
    })
  }
  if (statusCode !== null) {
    return result("failed", "provider_definite_rejection", {
      providerResponseCode: responseCode,
      errorCode: "provider_definite_rejection",
      errorSummary: "provider rejected the request",
    })
  }
  const code = readErrorCode(error)
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
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

export function createWebPushProvider(input: { sendNotification: SendNotification }) {
  const sendNotification = input.sendNotification

  return {
    async send(context: WebPushBegunDeliveryContext): Promise<NotificationProviderResult> {
      const subscription = context?.subscription
      if (!validSubscription(subscription) || context?.status !== "sending" || context?.channel_key !== "web_push") {
        return result("failed", "connection_missing", {
          errorCode: "connection_missing",
          errorSummary: "provider connection unavailable",
        })
      }

      const payload = JSON.stringify({
        title: context.rendered_title,
        body: context.rendered_body,
        href: context.href,
      })
      try {
        const response = await sendNotification(subscription, payload)
        const statusCode = readStatusCode(response)
        if (statusCode === null) {
          return result("delivery_unknown", "provider_ambiguous_response", {
            errorCode: "provider_ambiguous_response",
            errorSummary: "provider result unavailable",
          })
        }
        if (statusCode >= 200 && statusCode < 300) {
          return result("sent", null, { providerResponseCode: String(statusCode) })
        }
        return classifyFailure({ statusCode })
      } catch (error) {
        return classifyFailure(error)
      }
    },
  }
}
