import type {
  RegistrationCustomerMessageCheckInput,
  RegistrationCustomerMessageClient,
  RegistrationCustomerMessageHistoryItem,
  RegistrationCustomerMessageHistoryResponse,
  RegistrationCustomerMessagePreviewResponse,
  RegistrationCustomerMessageSendInput,
  RegistrationCustomerMessageSendResult,
  RegistrationCustomerMessageTarget,
} from "./registration-customer-message-contract"
import { assertRegistrationCustomerMessagePublicPayload } from "./registration-customer-message-contract"

type RegistrationCustomerMessageServiceOptions = Readonly<{
  getAccessToken: () => Promise<string | null>
  fetch?: typeof globalThis.fetch
}>

async function requestJson<T>(
  options: RegistrationCustomerMessageServiceOptions,
  url: string,
  init: RequestInit,
) {
  const accessToken = await options.getAccessToken()
  if (!accessToken) throw new Error("registration_customer_message_auth_required")
  const response = await (options.fetch || globalThis.fetch)(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  })
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error || "registration_customer_message_request_failed")
  return assertRegistrationCustomerMessagePublicPayload(payload)
}

export function createRegistrationCustomerMessageClient(
  options: RegistrationCustomerMessageServiceOptions,
): RegistrationCustomerMessageClient {
  return Object.freeze({
    preview(target: RegistrationCustomerMessageTarget, signal?: AbortSignal) {
      return requestJson<RegistrationCustomerMessagePreviewResponse>(options, "/api/solapi/registration/preview", {
        method: "POST",
        body: JSON.stringify({ messageKind: target.messageKind, sourceId: target.sourceId }),
        signal,
      })
    },
    send(input: RegistrationCustomerMessageSendInput) {
      return requestJson<RegistrationCustomerMessageSendResult>(options, "/api/solapi/registration/send", {
        method: "POST",
        body: JSON.stringify({ previewId: input.previewId, requestKey: input.requestKey }),
      })
    },
    list(target: RegistrationCustomerMessageTarget, signal?: AbortSignal) {
      const params = new URLSearchParams({ messageKind: target.messageKind, sourceId: target.sourceId })
      return requestJson<RegistrationCustomerMessageHistoryResponse>(
        options,
        `/api/solapi/registration/messages?${params.toString()}`,
        { method: "GET", signal },
      ).then((payload) => [...payload.history] as RegistrationCustomerMessageHistoryItem[])
    },
    check(input: RegistrationCustomerMessageCheckInput) {
      return requestJson<RegistrationCustomerMessageSendResult>(options, "/api/solapi/registration/check", {
        method: "POST",
        body: JSON.stringify({ messageId: input.messageId }),
      })
    },
    reconcile(input) {
      return requestJson<RegistrationCustomerMessageSendResult>(options, "/api/solapi/registration/admin", {
        method: "POST",
        body: JSON.stringify({
          action: "reconcile",
          messageId: input.messageId,
          resolution: input.resolution,
          evidence: {
            ...(input.evidence.providerMessageId ? { providerMessageId: input.evidence.providerMessageId } : {}),
            ...(input.evidence.providerGroupId ? { providerGroupId: input.evidence.providerGroupId } : {}),
            statusCode: input.evidence.statusCode,
            statusMessage: input.evidence.statusMessage,
            observedAt: input.evidence.observedAt,
            requestKeyMatched: input.evidence.requestKeyMatched,
          },
          reason: input.reason,
          requestKey: input.requestKey,
        }),
      })
    },
    releasePreSend(input) {
      return requestJson<RegistrationCustomerMessageSendResult>(options, "/api/solapi/registration/admin", {
        method: "POST",
        body: JSON.stringify({
          action: "release_pre_send",
          messageId: input.messageId,
          reason: input.reason,
          requestKey: input.requestKey,
        }),
      })
    },
  })
}
