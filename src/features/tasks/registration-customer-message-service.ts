import type {
  RegistrationCustomerMessageCheckInput,
  RegistrationCustomerMessageAdminClient,
  RegistrationCustomerMessageClient,
  RegistrationCustomerMessageHistoryItem,
  RegistrationCustomerMessageHistoryResponse,
  RegistrationCustomerMessagePreviewResponse,
  RegistrationCustomerMessageReadiness,
  RegistrationCustomerMessageSendInput,
  RegistrationCustomerMessageSendResult,
  RegistrationCustomerMessageTarget,
  RegistrationObservationSolapiReadiness,
} from "./registration-customer-message-contract.ts"
import {
  assertRegistrationCustomerMessagePublicPayload,
  parseRegistrationObservationSolapiReadiness,
} from "./registration-customer-message-contract.ts"

type RegistrationCustomerMessageServiceOptions = Readonly<{
  getAccessToken: () => Promise<string | null>
  fetch?: typeof globalThis.fetch
  adminTimeoutMs?: number
}>

const DEFAULT_ADMIN_TIMEOUT_MS = 15_000

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
  let payload: T & { code?: unknown }
  try {
    payload = await response.json() as T & { code?: unknown }
  } catch {
    throw new Error("registration_customer_message_request_failed")
  }
  if (!response.ok) {
    const code = typeof payload.code === "string" && payload.code.trim()
      ? payload.code.trim()
      : "registration_customer_message_request_failed"
    throw new Error(code)
  }
  return assertRegistrationCustomerMessagePublicPayload(payload)
}

function requestAdminJson<T>(
  options: RegistrationCustomerMessageServiceOptions,
  url: string,
  init: RequestInit,
) {
  const configuredTimeout = Number(options.adminTimeoutMs)
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_ADMIN_TIMEOUT_MS
  const controller = new AbortController()
  const externalSignal = init.signal

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => externalSignal?.removeEventListener("abort", onExternalAbort)
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      cleanup()
      callback()
    }
    const timeout = setTimeout(() => {
      controller.abort()
      settle(() => reject(new Error("registration_customer_message_admin_timeout")))
    }, timeoutMs)
    const onExternalAbort = () => {
      controller.abort(externalSignal?.reason)
      settle(() => reject(externalSignal?.reason || new Error("registration_customer_message_admin_aborted")))
    }
    if (externalSignal?.aborted) {
      onExternalAbort()
      return
    }
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true })

    void requestJson<T>(options, url, { ...init, signal: controller.signal }).then(
      (value) => {
        settle(() => resolve(value))
      },
      (error) => {
        settle(() => reject(error))
      },
    )
  })
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

export function createRegistrationCustomerMessageAdminClient(
  options: RegistrationCustomerMessageServiceOptions,
): RegistrationCustomerMessageAdminClient {
  const adminRequest = (body: Record<string, unknown>, signal?: AbortSignal) => (
    requestAdminJson<RegistrationCustomerMessageReadiness>(
      options,
      "/api/solapi/registration/admin",
      { method: "POST", body: JSON.stringify(body), signal },
    )
  )

  return Object.freeze({
    async inspectObservationReadiness(signal?: AbortSignal): Promise<RegistrationObservationSolapiReadiness> {
      const readiness = parseRegistrationObservationSolapiReadiness(
        await requestAdminJson<unknown>(
          options,
          "/api/solapi/registration/admin",
          {
            method: "POST",
            body: JSON.stringify({ action: "inspect_observation_readiness" }),
            signal,
          },
        ),
      )
      if (!readiness) throw new Error("registration_observation_solapi_readiness_invalid")
      return readiness
    },
    preflightTemplate(messageKind, signal) {
      return adminRequest({ action: "preflight_template", messageKind }, signal)
    },
    setActivation(input, signal) {
      return adminRequest({
        action: "set_activation",
        messageKind: input.messageKind,
        mode: input.mode,
        ...(input.verificationTaskId ? { verificationTaskId: input.verificationTaskId } : {}),
        requestKey: input.requestKey,
      }, signal)
    },
    recordLiveTestReceipt(input, signal) {
      return adminRequest({
        action: "record_live_test_receipt",
        messageKind: input.messageKind,
        messageId: input.messageId,
        receivedAt: input.receivedAt,
        requestKey: input.requestKey,
      }, signal)
    },
  })
}
