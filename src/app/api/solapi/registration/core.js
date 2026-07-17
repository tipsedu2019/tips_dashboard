import { requireRegisteredNotificationExternalAttempt } from "../../../../features/notifications/server/external-attempt-gate.js"
import { recordLegacyNotificationDeliveryIntent } from "../../../../features/notifications/server/legacy-delivery-intent.js"

const SOLAPI_SEND_URL = "https://api.solapi.com/messages/v4/send-many/detail"
const SOLAPI_LIST_URL = "https://api.solapi.com/messages/v4/list"
const ADMISSION_TEMPLATE_KEY = "admission_application"
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000
const TEMPLATE_CHECKSUM = /^(?:[a-f0-9]{32}|[a-f0-9]{64})$/

function text(value) {
  return String(value || "").trim()
}

function digits(value) {
  return text(value).replace(/\D/g, "")
}

function rows(value) {
  if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry === "object")
  if (value && typeof value === "object") {
    return Object.values(value).filter((entry) => entry && typeof entry === "object")
  }
  return []
}

function customFields(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value
  if (typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function response(payload, status = 200) {
  return Response.json(payload, { status })
}

function messageStatus(message) {
  if (!message) return ""
  const status = text(message.status).toLowerCase()
  const active = Boolean(message.claim_active ?? message.claimActive)
  if (status === "failed" && active) return "failed_hold"
  return ["pending", "accepted", "unknown"].includes(status) ? status : ""
}

function providerValues(record, fallbackGroupId = "") {
  return {
    providerMessageId: text(record?.messageId || record?.message_id),
    providerGroupId: text(record?.groupId || record?.group_id || fallbackGroupId),
    providerStatusCode: text(record?.statusCode || record?.status_code),
    providerStatusMessage: text(record?.statusMessage || record?.status_message || record?.reason),
  }
}

export function parseSolapiSendResult(payload, responseStatus) {
  const groupId = text(payload?.groupInfo?.groupId || payload?.groupId)
  const accepted = rows(payload?.messageList)[0] || null
  const failed = rows(payload?.failedMessageList)[0] || null
  const acceptedValues = providerValues(accepted, groupId)
  const failedValues = providerValues(failed, groupId)
  const acceptedResponse = responseStatus >= 200 && responseStatus < 300
  const explicitClientRejection = responseStatus >= 400 && responseStatus < 500
  if (acceptedResponse && accepted && (acceptedValues.providerMessageId || acceptedValues.providerGroupId)) {
    return { result: "accepted", providerResult: acceptedValues }
  }
  if (failed || explicitClientRejection) {
    return {
      result: "failed",
      providerResult: {
        ...failedValues,
        errorMessage: text(payload?.errorMessage || payload?.error || failed?.statusMessage || "SOLAPI message was rejected"),
      },
    }
  }
  return {
    result: "unknown",
    providerResult: { errorMessage: "SOLAPI response did not prove acceptance or rejection" },
  }
}

export function findSolapiLookupMatch(payload, requestKey, providerMessageId = "", providerGroupId = "") {
  return rows(payload?.messageList).find((record) => {
    const fields = customFields(record.customFields || record.custom_fields)
    if (text(fields.registrationRequestKey) !== requestKey) return false
    if (providerMessageId && text(record.messageId || record.message_id) !== providerMessageId) return false
    if (providerGroupId && text(record.groupId || record.group_id) !== providerGroupId) return false
    return true
  }) || null
}

function validRequestKey(value) {
  const normalized = text(value)
  return normalized.length >= 12 && normalized.length <= 120
}

function validateProviderEvidence(value, allowedStates) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const allowedKeys = new Set([
    "providerMessageId", "providerGroupId", "lookupRequestKey", "observedState",
    "observedStatusCode", "observedStatusMessage",
  ])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return null
  if (Object.values(value).some((entry) => entry !== null && entry !== undefined && typeof entry !== "string")) return null
  const normalized = {
    providerMessageId: text(value.providerMessageId) || undefined,
    providerGroupId: text(value.providerGroupId) || undefined,
    lookupRequestKey: text(value.lookupRequestKey) || undefined,
    observedState: text(value.observedState).toLowerCase(),
    observedStatusCode: text(value.observedStatusCode) || undefined,
    observedStatusMessage: text(value.observedStatusMessage) || undefined,
  }
  if (!allowedStates.includes(normalized.observedState)) return null
  return normalized
}

function activeMessageInput(caseState) {
  const activeMessage = caseState.activeMessage || null
  return {
    id: text(activeMessage?.id),
    requestKey: text(activeMessage?.request_key || activeMessage?.requestKey),
    status: messageStatus(activeMessage),
    rawStatus: text(activeMessage?.status).toLowerCase(),
    claimActive: Boolean(activeMessage?.claim_active ?? activeMessage?.claimActive),
    updatedAt: text(activeMessage?.updated_at || activeMessage?.updatedAt),
    createdAt: text(activeMessage?.created_at || activeMessage?.createdAt),
    providerMessageId: text(activeMessage?.provider_message_id || activeMessage?.providerMessageId),
    providerGroupId: text(activeMessage?.provider_group_id || activeMessage?.providerGroupId),
  }
}

async function markAccepted(deps, context, input) {
  try {
    await deps.mark(context.client, {
      taskId: input.taskId,
      messageRequestKey: input.messageRequestKey,
      requestKey: `registration-admission-mark:${input.messageId}`,
    })
    return null
  } catch {
    return "알림톡은 접수됐지만 입학신청서 발송 상태 동기화를 확인해 주세요."
  }
}

function authoritativeMessagePayload(result, syncWarning = null) {
  return {
    ok: result.currentStatus === "accepted",
    taskId: result.taskId,
    messageId: result.messageId,
    messageRequestKey: result.messageRequestKey,
    currentStatus: result.currentStatus,
    claimActive: Boolean(result.claimActive),
    retryRequiresNewMessageKey: Boolean(result.retryRequiresNewMessageKey),
    syncWarning: syncWarning || undefined,
  }
}

async function runtimeContext(deps, request) {
  const context = await deps.authenticate(request)
  if (!context?.userId || !context.client) {
    return { response: response({ ok: false, error: "Unauthorized" }, 401) }
  }
  try {
    const runtime = await deps.probeRuntime(context.client)
    if (runtime.mode === "maintenance") {
      return {
        response: response({
          ok: false,
          code: "REGISTRATION_MIGRATION_IN_PROGRESS",
          error: "데이터 전환 중입니다. 잠시 후 다시 시도해 주세요.",
        }, 503),
      }
    }
    return { context, runtime }
  } catch {
    return {
      response: response({
        ok: false,
        code: "REGISTRATION_RUNTIME_UNAVAILABLE",
        error: "등록 데이터 준비 상태를 확인하지 못했습니다.",
      }, 503),
    }
  }
}

async function readyGet(deps, context, request) {
  const taskId = text(new URL(request.url).searchParams.get("taskId"))
  if (!taskId) return response({ ok: false, error: "Invalid request" }, 400)
  let caseState
  try {
    caseState = await deps.loadReadyCase(context.client, context.serviceClient, taskId)
  } catch {
    return response({ ok: false, error: "등록 메시지 상태를 불러오지 못했습니다." }, 500)
  }
  if (!caseState?.task || text(caseState.task.type) !== "registration" || !caseState.detail) {
    return response({ ok: false, error: "Registration not found" }, 404)
  }
  const message = activeMessageInput(caseState)
  const state = deps.getAdmissionState({
    tracks: caseState.tracks || [],
    enrollments: caseState.enrollments || [],
    admissionNoticeSent: Boolean(caseState.detail.admission_notice_sent ?? caseState.detail.admissionNoticeSent),
    admissionApplicationMessageStatus: message.status,
    admissionApplicationMessageClaimActive: message.claimActive,
  })
  const configuration = deps.getConfiguration()
  return response({
    ok: true,
    configured: configuration.configured,
    missing: configuration.missing,
    admissionEligible: Boolean(state.eligible),
    admissionNoticeSent: Boolean(caseState.detail.admission_notice_sent ?? caseState.detail.admissionNoticeSent),
    admissionApplicationMessageId: message.id || null,
    admissionApplicationMessageStatus: message.status,
    admissionApplicationMessageClaimActive: message.claimActive,
    admissionApplicationMessageUpdatedAt: message.updatedAt || null,
    admissionApplicationAccepted: message.rawStatus === "accepted",
    delivered: Boolean(state.delivered),
    syncNeeded: Boolean(state.syncNeeded),
    blocked: Boolean(state.blocked),
    canSend: Boolean(state.canSend),
  })
}

async function sendAdmission(deps, context, body) {
  const taskId = text(body.taskId)
  const requestKey = text(body.requestKey)
  if (!taskId || !validRequestKey(requestKey)) return response({ ok: false, error: "Invalid request" }, 400)

  let claim
  try {
    claim = await deps.claim(context.client, { taskId, messageRequestKey: requestKey })
  } catch (error) {
    return response({ ok: false, error: text(error?.message) || "발송 권한을 확보하지 못했습니다." }, 409)
  }

  if (!claim.shouldSend) {
    if (claim.claimStatus === "accepted") {
      const syncWarning = await markAccepted(deps, context, {
        taskId: claim.taskId,
        messageId: claim.messageId,
        messageRequestKey: claim.messageRequestKey,
      })
      return response(authoritativeMessagePayload({
        ...claim,
        currentStatus: "accepted",
      }, syncWarning))
    }
    return response({
      ok: false,
      code: claim.claimStatus === "pending" ? "SOLAPI_REQUEST_PENDING" : "SOLAPI_REQUEST_BLOCKED",
      currentStatus: claim.claimStatus,
      claimActive: Boolean(claim.claimActive),
      retryRequiresNewMessageKey: Boolean(claim.retryRequiresNewMessageKey),
    }, 409)
  }

  if (!context.serviceClient) return response({ ok: false, error: "Missing service role" }, 500)
  const delivery = await deps.beginDelivery(context.serviceClient, {
    messageId: claim.messageId,
    messageRequestKey: claim.messageRequestKey,
  })
  if (!delivery?.acquired) {
    // A deterministic begin replay means the previous request crossed the
    // durable dispatch-start boundary but did not persist a business outcome.
    // Never call SOLAPI again: close both ledgers as ambiguous so an operator
    // can reconcile provider evidence explicitly.
    if (delivery?.requiresUnknownFinalization) {
      const finalized = await deps.completeDelivery(context.serviceClient, {
        messageId: claim.messageId,
        deliveryId: delivery.deliveryId,
        claimId: delivery.claimId,
        ownerGeneration: delivery.ownerGeneration,
        claimToken: delivery.claimToken || null,
        dispatchToken: delivery.dispatchToken,
        result: "unknown",
        providerResult: {
          errorMessage: "SOLAPI dispatch began previously without a durable terminal outcome",
        },
        outcome: "delivery_unknown",
        providerReference: "solapi_unresolved_dispatch_replay",
      })
      return response(authoritativeMessagePayload(finalized), 502)
    }
    return response({
      ok: true,
      code: "SOLAPI_DELIVERY_OWNED",
      taskId: claim.taskId,
      messageId: claim.messageId,
      messageRequestKey: claim.messageRequestKey,
      currentStatus: claim.claimStatus || "pending",
      claimActive: Boolean(claim.claimActive),
    }, 202)
  }

  const legacyTemplateChecksum = text(delivery.templateChecksum)
  if (!TEMPLATE_CHECKSUM.test(legacyTemplateChecksum)) {
    const finalized = await deps.completeDelivery(context.serviceClient, {
      messageId: claim.messageId,
      deliveryId: delivery.deliveryId,
      claimId: delivery.claimId,
      ownerGeneration: delivery.ownerGeneration,
      claimToken: delivery.claimToken || null,
      dispatchToken: delivery.dispatchToken,
      result: "failed",
      providerResult: { errorMessage: "Legacy notification template checksum is invalid" },
      outcome: "failed",
      providerReference: "legacy_template_checksum_invalid",
    })
    return response({
      ...authoritativeMessagePayload(finalized),
      code: "SOLAPI_DELIVERY_PLAN_INVALID",
    }, 500)
  }

  const configuration = deps.getConfiguration()
  if (!configuration.configured) {
    const finalized = await deps.completeDelivery(context.serviceClient, {
      messageId: claim.messageId,
      deliveryId: delivery.deliveryId,
      claimId: delivery.claimId,
      ownerGeneration: delivery.ownerGeneration,
      claimToken: delivery.claimToken || null,
      dispatchToken: delivery.dispatchToken,
      result: "failed",
      providerResult: { errorMessage: "SOLAPI is not configured" },
      outcome: "failed",
      providerReference: "solapi_not_configured",
    })
    return response({
      ...authoritativeMessagePayload(finalized),
      code: "SOLAPI_NOT_CONFIGURED",
      missing: configuration.missing,
    }, 503)
  }

  if (delivery.deliveryId) {
    await recordLegacyNotificationDeliveryIntent({
      deliveryId: delivery.deliveryId,
      requestId: delivery.dispatchToken,
      legacyTemplateChecksum,
      title: "입학신청서 안내",
      body: `${text(claim.studentName)} 학생 입학신청서 안내`,
      href: `/admin/registration?taskId=${text(claim.taskId)}`,
      record: (intent) => deps.recordLegacyIntent(context.serviceClient, intent),
    })
  }

  const attempt = await requireRegisteredNotificationExternalAttempt({
    register: () => deps.registerExternalAttempt(context.serviceClient, {
      deliveryId: delivery.deliveryId,
      claimId: delivery.claimId,
      ownerGeneration: delivery.ownerGeneration,
      claimToken: delivery.claimToken || null,
      dispatchToken: delivery.dispatchToken,
    }),
    finalizeUnknown: (reason) => deps.completeDelivery(context.serviceClient, {
      messageId: claim.messageId,
      deliveryId: delivery.deliveryId,
      claimId: delivery.claimId,
      ownerGeneration: delivery.ownerGeneration,
      claimToken: delivery.claimToken || null,
      dispatchToken: delivery.dispatchToken,
      result: "unknown",
      providerResult: { errorMessage: reason },
      outcome: "delivery_unknown",
      providerReference: reason,
    }),
  })
  if (!attempt.allowed) {
    return response(authoritativeMessagePayload(attempt.finalization), 502)
  }

  let providerResponse
  try {
    providerResponse = await deps.fetch(SOLAPI_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: deps.createAuthorization(configuration.apiKey, configuration.apiSecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{
          to: digits(claim.parentPhone),
          type: "ATA",
          kakaoOptions: {
            pfId: configuration.pfId,
            templateId: configuration.templateId,
            disableSms: true,
            variables: { "#{학생명}": text(claim.studentName) },
          },
          customFields: { registrationRequestKey: claim.messageRequestKey },
        }],
        strict: true,
        allowDuplicates: false,
        showMessageList: true,
      }),
    })
  } catch (error) {
    const providerReference = text(error?.message) || "solapi_provider_exception"
    const finalized = await deps.completeDelivery(context.serviceClient, {
      messageId: claim.messageId,
      deliveryId: delivery.deliveryId,
      claimId: delivery.claimId,
      ownerGeneration: delivery.ownerGeneration,
      claimToken: delivery.claimToken || null,
      dispatchToken: delivery.dispatchToken,
      result: "unknown",
      providerResult: { errorMessage: providerReference },
      outcome: "delivery_unknown",
      providerReference,
    })
    return response(authoritativeMessagePayload(finalized), 502)
  }

  let payload
  try {
    payload = await providerResponse.json()
  } catch {
    payload = {}
  }
  const parsed = parseSolapiSendResult(payload, providerResponse.status)
  const deliveryOutcome = parsed.result === "accepted"
    ? "sent"
    : parsed.result === "failed"
      ? "failed"
      : "delivery_unknown"
  const providerReference = text(
    parsed.providerResult.providerMessageId
    || parsed.providerResult.providerGroupId
    || parsed.providerResult.providerStatusCode
    || parsed.providerResult.errorMessage
    || deliveryOutcome,
  )
  const finalized = await deps.completeDelivery(context.serviceClient, {
    messageId: claim.messageId,
    deliveryId: delivery.deliveryId,
    claimId: delivery.claimId,
    ownerGeneration: delivery.ownerGeneration,
    claimToken: delivery.claimToken || null,
    dispatchToken: delivery.dispatchToken,
    result: parsed.result,
    providerResult: parsed.providerResult,
    outcome: deliveryOutcome,
    providerReference,
  })
  let syncWarning = null
  if (finalized.currentStatus === "accepted" && finalized.claimActive) {
    syncWarning = await markAccepted(deps, context, {
      taskId: finalized.taskId,
      messageId: finalized.messageId,
      messageRequestKey: finalized.messageRequestKey,
    })
  }
  const status = finalized.currentStatus === "accepted" ? 200 : 502
  return response(authoritativeMessagePayload(finalized, syncWarning), status)
}

function buildLookupUrl(message, caseState) {
  const url = new URL(SOLAPI_LIST_URL)
  const criteria = []
  const values = []
  if (message.providerMessageId) {
    criteria.push("messageId")
    values.push(message.providerMessageId)
  }
  if (message.providerGroupId) {
    criteria.push("groupId")
    values.push(message.providerGroupId)
  }
  if (criteria.length > 0) {
    url.searchParams.set("criteria", criteria.join(","))
    url.searchParams.set("cond", criteria.map(() => "eq").join(","))
    url.searchParams.set("value", values.join(","))
  } else {
    const createdAt = new Date(message.createdAt || message.updatedAt)
    const start = new Date(createdAt.getTime() - 5 * 60 * 1000)
    const end = new Date(createdAt.getTime() + 15 * 60 * 1000)
    url.searchParams.set("to", digits(caseState.frozenRecipient))
    url.searchParams.set("startDate", start.toISOString())
    url.searchParams.set("endDate", end.toISOString())
    url.searchParams.set("dateType", "CREATED")
    url.searchParams.set("limit", "100")
  }
  return url
}

async function checkPending(deps, context, body) {
  const taskId = text(body.taskId)
  const messageId = text(body.messageId)
  if (!taskId || !messageId) return response({ ok: false, error: "Invalid request" }, 400)
  const caseState = await deps.loadReadyCase(context.client, context.serviceClient, taskId, { includeProvider: true })
  const message = activeMessageInput(caseState)
  if (message.id !== messageId || message.rawStatus !== "pending" || !message.claimActive) {
    return response({ ok: false, error: "현재 대기 중인 발송 건이 아닙니다." }, 409)
  }
  const updatedTime = new Date(message.updatedAt).getTime()
  if (!Number.isFinite(updatedTime) || deps.now().getTime() - updatedTime < FIFTEEN_MINUTES_MS) {
    return response({ ok: false, code: "SOLAPI_CHECK_TOO_EARLY", error: "발송 후 15분이 지나면 확인할 수 있습니다." }, 409)
  }
  if (!context.serviceClient) return response({ ok: false, error: "Missing service role" }, 500)
  const configuration = deps.getConfiguration()
  if (!configuration.configured) return response({ ok: false, code: "SOLAPI_NOT_CONFIGURED", missing: configuration.missing }, 503)
  if (!message.providerMessageId && !message.providerGroupId && !digits(caseState.frozenRecipient)) {
    return response({
      ok: false,
      code: "SOLAPI_FROZEN_RECIPIENT_UNAVAILABLE",
      error: "발송 당시 수신번호를 확인할 수 없어 자동 조회하지 않았습니다.",
    }, 409)
  }

  let lookupResponse
  try {
    lookupResponse = await deps.fetch(buildLookupUrl(message, caseState), {
      method: "GET",
      headers: { Authorization: deps.createAuthorization(configuration.apiKey, configuration.apiSecret) },
    })
  } catch {
    return response({ ok: false, code: "SOLAPI_LOOKUP_RETRY", error: "발송 상태 조회에 실패했습니다. 다시 시도해 주세요." }, 502)
  }
  if (!lookupResponse.ok) {
    return response({ ok: false, code: "SOLAPI_LOOKUP_RETRY", error: "발송 상태 조회에 실패했습니다. 다시 시도해 주세요." }, 502)
  }
  let payload
  try {
    payload = await lookupResponse.json()
  } catch {
    return response({ ok: false, code: "SOLAPI_LOOKUP_RETRY", error: "발송 상태 응답을 해석하지 못했습니다." }, 502)
  }
  const match = findSolapiLookupMatch(payload, message.requestKey, message.providerMessageId, message.providerGroupId)
  const result = match ? "accepted" : "unknown"
  const finalized = await deps.finalize(context.serviceClient, {
    messageId,
    result,
    providerResult: match
      ? providerValues(match, message.providerGroupId)
      : { errorMessage: "No exact provider record matched the frozen request key" },
  })
  let syncWarning = null
  if (finalized.currentStatus === "accepted" && finalized.claimActive) {
    syncWarning = await markAccepted(deps, context, {
      taskId: finalized.taskId,
      messageId: finalized.messageId,
      messageRequestKey: finalized.messageRequestKey,
    })
  }
  return response(authoritativeMessagePayload(finalized, syncWarning))
}

async function reconcileMessage(deps, context, body) {
  const resolution = text(body.resolution).toLowerCase()
  const reason = text(body.reason)
  const requestKey = text(body.requestKey)
  const messageId = text(body.messageId)
  const allowedStates = resolution === "accepted" ? ["accepted"] : ["failed", "not_found", "closed"]
  const evidence = validateProviderEvidence(body.providerEvidence, allowedStates)
  if (!messageId || !reason || !validRequestKey(requestKey)
    || !["accepted", "failed"].includes(resolution) || !evidence
    || (resolution === "accepted" && !evidence.providerMessageId && !evidence.providerGroupId)) {
    return response({ ok: false, error: "Invalid reconciliation evidence" }, 400)
  }
  const result = await deps.reconcile(context.client, {
    messageId, resolution, providerEvidence: evidence, reason, requestKey,
  })
  let syncWarning = null
  if (result.requiresAdmissionMark && result.nextStatus === "accepted" && result.claimActive) {
    syncWarning = await markAccepted(deps, context, {
      taskId: result.taskId,
      messageId: result.messageId,
      messageRequestKey: result.messageRequestKey,
    })
  }
  return response({ ok: true, ...result, syncWarning: syncWarning || undefined })
}

async function releaseMessage(deps, context, body) {
  const reason = text(body.reason)
  const requestKey = text(body.requestKey)
  const messageId = text(body.messageId)
  const evidence = validateProviderEvidence(body.providerEvidence, ["failed", "not_found", "closed"])
  if (!messageId || !reason || !validRequestKey(requestKey) || !evidence) {
    return response({ ok: false, error: "Invalid release evidence" }, 400)
  }
  const result = await deps.release(context.client, {
    messageId, providerEvidence: evidence, reason, requestKey,
  })
  return response({ ok: true, ...result })
}

export function createRegistrationAdmissionRouteHandlers(deps) {
  return {
    async get(request) {
      const gate = await runtimeContext(deps, request)
      if (gate.response) return gate.response
      if (gate.runtime.mode === "legacy") {
        const legacy = await deps.loadLegacyHandlers()
        return legacy.handleLegacyRegistrationGet(request)
      }
      return readyGet(deps, gate.context, request)
    },
    async post(request) {
      const gate = await runtimeContext(deps, request)
      if (gate.response) return gate.response
      if (gate.runtime.mode === "legacy") {
        const legacy = await deps.loadLegacyHandlers()
        return legacy.handleLegacyRegistrationPost(request)
      }
      if (!["admin", "staff"].includes(gate.context.role)) return response({ ok: false, error: "Forbidden" }, 403)
      const body = await request.json().catch(() => ({}))
      const action = text(body.action || "send").toLowerCase()
      if (["send", "check"].includes(action) && !gate.context.serviceClient) {
        return response({ ok: false, error: "Missing service role" }, 500)
      }
      try {
        if (action === "check") return checkPending(deps, gate.context, body)
        if (action === "reconcile") return reconcileMessage(deps, gate.context, body)
        if (action === "release") return releaseMessage(deps, gate.context, body)
        if (action === "send") return sendAdmission(deps, gate.context, body)
        return response({ ok: false, error: "Invalid action" }, 400)
      } catch (error) {
        return response({ ok: false, error: text(error?.message) || "등록 메시지 요청을 처리하지 못했습니다." }, 409)
      }
    },
  }
}

export { ADMISSION_TEMPLATE_KEY, SOLAPI_LIST_URL, SOLAPI_SEND_URL }
