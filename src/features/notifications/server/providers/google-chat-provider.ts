import { validateGoogleChatWebhookUrl } from "../notification-connection-crypto.ts"
import type { NotificationWorkflowKey } from "../../notification-control-plane-types.ts"
import { buildNotificationAppLink } from "../notification-app-deep-link.ts"

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

type GoogleChatProviderInput = Readonly<{
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
  workflow_key?: NotificationWorkflowKey
  mention_user_names?: ReadonlyArray<string>
}>

export type GoogleChatBegunDeliveryContext = GoogleChatProviderInput & Readonly<{
  workflow_key: NotificationWorkflowKey
}>

function hasGoogleChatWorkflowKey(
  value: GoogleChatProviderInput,
): value is GoogleChatBegunDeliveryContext {
  return typeof value.workflow_key === "string"
}

type FetchTransport = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

const SAFE_PROVIDER_ID = /^[A-Za-z0-9._/-]{1,256}$/
const EXTERNAL_URL_PATTERN = /(?:https?:\/\/|\/\/)/iu
const MAX_GOOGLE_CHAT_MESSAGE_BYTES = 32_000
const GOOGLE_CHAT_CARD_ID = "tips-dashboard-notification"
const GOOGLE_CHAT_USER_NAME_PATTERN = /^users\/[1-9]\d{0,31}$/u
const GOOGLE_CHAT_UNSAFE_TEXT_PATTERN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]|<|>|(?:^|[^A-Za-z0-9_])@(all|everyone|here|channel)(?=$|[^A-Za-z0-9_])/iu

export type GoogleChatCardPayload = Readonly<{
  cardsV2: ReadonlyArray<Readonly<{
    cardId: string
    card: Readonly<{
      header: Readonly<{ title: string }>
      sections: ReadonlyArray<Readonly<{
        widgets: ReadonlyArray<
          | Readonly<{ textParagraph: Readonly<{ text: string }> }>
          | Readonly<{
              buttonList: Readonly<{
                buttons: ReadonlyArray<Readonly<{
                  text: string
                  onClick: Readonly<{
                    openLink: Readonly<{ url: string }>
                  }>
                }>>
              }>
            }>
        >
      }>>
    }>
  }>>
}>

type GoogleChatMessagePayload = GoogleChatCardPayload | Readonly<{
  text: string
  cardsV2: GoogleChatCardPayload["cardsV2"]
}>

export type GoogleChatCardPayloadResult =
  | Readonly<{
      ok: true
      payload: GoogleChatCardPayload
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

function escapeGoogleChatCardText(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;")
    .replace(/\r\n?/gu, "\n")
    .replace(/\n/gu, "<br>")
}

function flattenGoogleChatText(value: unknown) {
  if (
    typeof value !== "string" ||
    !value ||
    EXTERNAL_URL_PATTERN.test(value) ||
    GOOGLE_CHAT_UNSAFE_TEXT_PATTERN.test(value)
  ) return undefined
  const flattened = value.replace(/\s+/gu, " ").trim()
  return flattened || undefined
}

function canonicalGoogleChatMentionUserNames(value: unknown) {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      Object.prototype.hasOwnProperty.call(value, "some") ||
      Object.prototype.hasOwnProperty.call(value, Symbol.iterator) ||
      value.length > 20
    ) return undefined
    const canonical: string[] = []
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) return undefined
      const userName = value[index]
      if (typeof userName !== "string" || !GOOGLE_CHAT_USER_NAME_PATTERN.test(userName)) {
        return undefined
      }
      let duplicate = false
      for (let knownIndex = 0; knownIndex < canonical.length; knownIndex += 1) {
        if (canonical[knownIndex] === userName) {
          duplicate = true
          break
        }
      }
      if (!duplicate) canonical.push(userName)
    }
    return canonical
  } catch {
    return undefined
  }
}

export function buildGoogleChatCardPayload(input: Pick<
  GoogleChatBegunDeliveryContext,
  "rendered_title" | "rendered_body" | "href" | "workflow_key"
>): GoogleChatCardPayloadResult {
  const title = flattenGoogleChatText(input?.rendered_title)
  const body = flattenGoogleChatText(input?.rendered_body)
  if (
    !input ||
    !title ||
    !body
  ) return { ok: false, errorCode: "render_validation_failed" }

  let appLink
  try {
    appLink = buildNotificationAppLink(input.href, input.workflow_key)
  } catch {
    return { ok: false, errorCode: "render_validation_failed" }
  }
  const payload: GoogleChatCardPayload = Object.freeze({
    cardsV2: Object.freeze([Object.freeze({
      cardId: GOOGLE_CHAT_CARD_ID,
      card: Object.freeze({
        header: Object.freeze({ title: input.rendered_title }),
        sections: Object.freeze([Object.freeze({
          widgets: Object.freeze([
            Object.freeze({
              textParagraph: Object.freeze({
                text: escapeGoogleChatCardText(input.rendered_body),
              }),
            }),
            Object.freeze({
              buttonList: Object.freeze({
                buttons: Object.freeze([Object.freeze({
                  text: appLink.buttonText,
                  onClick: Object.freeze({
                    openLink: Object.freeze({ url: appLink.absoluteUrl }),
                  }),
                })]),
              }),
            }),
          ]),
        })]),
      }),
    })]),
  })
  const byteLength = Buffer.byteLength(JSON.stringify(payload), "utf8")
  if (byteLength > MAX_GOOGLE_CHAT_MESSAGE_BYTES) {
    return { ok: false, errorCode: "render_validation_failed" }
  }
  return { ok: true, payload, absoluteUrl: appLink.absoluteUrl, byteLength }
}

function buildGoogleChatMessagePayload(context: GoogleChatProviderInput):
  | Readonly<{ ok: true; payload: GoogleChatMessagePayload }>
  | Readonly<{ ok: false }> {
  if (!hasGoogleChatWorkflowKey(context)) return { ok: false }
  const builtCard = buildGoogleChatCardPayload(context)
  if (!builtCard.ok) return { ok: false }
  if (!Object.prototype.hasOwnProperty.call(context, "mention_user_names")) {
    return { ok: true, payload: builtCard.payload }
  }

  const mentionUserNames = canonicalGoogleChatMentionUserNames(context.mention_user_names)
  if (!mentionUserNames) return { ok: false }

  const title = flattenGoogleChatText(context.rendered_title)
  const body = flattenGoogleChatText(context.rendered_body)
  if (!title || !body) return { ok: false }
  let mentionText = ""
  for (let index = 0; index < mentionUserNames.length; index += 1) {
    mentionText += `${index ? " " : ""}<${mentionUserNames[index]}>`
  }
  const payload: GoogleChatMessagePayload = Object.freeze({
    text: `${mentionText ? `${mentionText} ` : ""}${title} — ${body}`,
    cardsV2: builtCard.payload.cardsV2,
  })
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_GOOGLE_CHAT_MESSAGE_BYTES) {
    return { ok: false }
  }
  return { ok: true, payload }
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
    async send(context: GoogleChatProviderInput): Promise<NotificationProviderResult> {
      const webhookUrl = safeWebhookUrl(context?.webhook_url)
      if (!webhookUrl || context?.status !== "sending" || context?.channel_key !== "google_chat") {
        return result("failed", "connection_missing", {
          errorCode: "connection_missing",
          errorSummary: "provider connection unavailable",
        })
      }
      const built = buildGoogleChatMessagePayload(context)
      if (!built.ok) {
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
          body: JSON.stringify(built.payload),
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
