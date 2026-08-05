import { createHmac, randomBytes } from "node:crypto"

import type {
  RegistrationCustomerMessageProviderEvidenceInput,
} from "../registration-customer-message-contract.ts"
import {
  checksumRegistrationCustomerMessageTemplate,
  type RegistrationCustomerMessageButton,
  type RegistrationCustomerMessageCatalogEntry,
  type RegistrationCustomerMessageVariableName,
} from "./registration-customer-message-catalog.ts"

export const SOLAPI_SEND_MANY_URL = "https://api.solapi.com/messages/v4/send-many/detail"
export const SOLAPI_MESSAGE_LIST_URL = "https://api.solapi.com/messages/v4/list"
export const SOLAPI_TEMPLATE_LIST_URL = "https://api.solapi.com/kakao/v2/templates/"

type JsonRecord = Record<string, unknown>
type ProviderOutcome = "accepted" | "failed_hold" | "unknown"

export type RegistrationCustomerMessageProviderResult = Readonly<{
  outcome: ProviderOutcome
  evidence: RegistrationCustomerMessageProviderEvidenceInput
}>

type SolapiDependencies = Readonly<{
  apiKey: string
  apiSecret: string
  pfId: string
  fetch: typeof globalThis.fetch
  now?: () => Date
  createSalt?: () => string
  timeoutMs?: number
}>

type SendInput = Readonly<{
  to: string
  templateId: string
  variables: Readonly<Record<string, string>>
  buttons: ReadonlyArray<RegistrationCustomerMessageButton>
  requestKey: string
}>

type LookupInput = Readonly<{
  providerMessageId: string
  providerGroupId?: string
  requestKey: string
}>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown, maximum = 500) {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, maximum)
}

function exactText(value: unknown, maximum = 500) {
  return typeof value === "string" && value.length <= maximum ? value : ""
}

function rows(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (isRecord(value)) return Object.values(value).filter(isRecord)
  return []
}

function customFields(value: unknown): JsonRecord {
  if (isRecord(value)) return value
  if (typeof value !== "string") return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function providerEvidence(
  observedAt: string,
  input: Readonly<{
    providerMessageId?: unknown
    providerGroupId?: unknown
    statusCode: string
    statusMessage: string
    requestKeyMatched: boolean
  }>,
): RegistrationCustomerMessageProviderEvidenceInput {
  const providerMessageId = text(input.providerMessageId, 200)
  const providerGroupId = text(input.providerGroupId, 200)
  return Object.freeze({
    ...(providerMessageId ? { providerMessageId } : {}),
    ...(providerGroupId ? { providerGroupId } : {}),
    statusCode: text(input.statusCode, 100) || "provider_status_unavailable",
    statusMessage: text(input.statusMessage, 500) || "SOLAPI 상태를 확인할 수 없습니다.",
    observedAt,
    requestKeyMatched: input.requestKeyMatched,
  })
}

function providerResult(
  outcome: ProviderOutcome,
  observedAt: string,
  input: Parameters<typeof providerEvidence>[1],
): RegistrationCustomerMessageProviderResult {
  return Object.freeze({ outcome, evidence: providerEvidence(observedAt, input) })
}

export function createSolapiHmacAuthorization(input: Readonly<{
  apiKey: string
  apiSecret: string
  date: string
  salt: string
}>) {
  const apiKey = text(input.apiKey, 500)
  const apiSecret = text(input.apiSecret, 500)
  const date = text(input.date, 100)
  const salt = text(input.salt, 128)
  if (!apiKey || !apiSecret || !date || salt.length < 12 || salt.length > 128) {
    throw new Error("registration_customer_message_solapi_configuration_invalid")
  }
  const signature = createHmac("sha256", apiSecret)
    .update(date + salt, "utf8")
    .digest("hex")
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`
}

function normalizedVariables(value: unknown): RegistrationCustomerMessageVariableName[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const raw = typeof item === "string"
      ? item
      : isRecord(item)
        ? exactText(item.name ?? item.variableName ?? item.key)
        : ""
    const match = raw.match(/^#\{(.+)\}$/u)
    return exactText(match?.[1] ?? raw)
  }).filter(Boolean) as RegistrationCustomerMessageVariableName[]
}

function normalizedButtons(value: unknown): RegistrationCustomerMessageButton[] {
  return rows(value).map((button) => ({
    name: exactText(button.buttonName ?? button.name),
    type: exactText(button.buttonType ?? button.type) as "WL",
    linkMobile: exactText(button.linkMo ?? button.linkMobile),
    linkPc: exactText(button.linkPc),
  }))
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function parseJson(response: Response) {
  try {
    const value: unknown = await response.json()
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function sendRecordValues(record: JsonRecord | null, groupId: string) {
  return {
    providerMessageId: record?.messageId ?? record?.message_id,
    providerGroupId: record?.groupId ?? record?.group_id ?? groupId,
    statusCode: text(record?.statusCode ?? record?.status_code, 100),
    statusMessage: text(record?.statusMessage ?? record?.status_message ?? record?.reason, 500),
  }
}

export function createRegistrationCustomerMessageSolapi(dependencies: SolapiDependencies) {
  const now = dependencies.now ?? (() => new Date())
  const createSalt = dependencies.createSalt ?? (() => randomBytes(16).toString("hex"))
  const timeoutMs = dependencies.timeoutMs ?? 10_000

  function authorization(observedAt: string) {
    return createSolapiHmacAuthorization({
      apiKey: dependencies.apiKey,
      apiSecret: dependencies.apiSecret,
      date: observedAt,
      salt: createSalt(),
    })
  }

  async function providerFetch(url: string | URL, init: RequestInit) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await dependencies.fetch(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }
  }

  return Object.freeze({
    async send(input: SendInput): Promise<RegistrationCustomerMessageProviderResult> {
      const observedAt = now().toISOString()
      let response: Response
      try {
        response = await providerFetch(SOLAPI_SEND_MANY_URL, {
          method: "POST",
          headers: {
            Authorization: authorization(observedAt),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [{
              to: input.to,
              type: "ATA",
              kakaoOptions: {
                pfId: dependencies.pfId,
                templateId: input.templateId,
                disableSms: true,
                variables: Object.fromEntries(
                  Object.entries(input.variables).map(([key, value]) => [`#{${key}}`, value]),
                ),
                buttons: input.buttons.map((button) => ({
                  buttonName: button.name,
                  buttonType: button.type,
                  linkMo: button.linkMobile,
                  linkPc: button.linkPc,
                })),
              },
              customFields: { registrationRequestKey: input.requestKey },
            }],
            strict: true,
            allowDuplicates: false,
            showMessageList: true,
          }),
        })
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === "AbortError"
        return providerResult("unknown", observedAt, {
          statusCode: timedOut ? "provider_timeout" : "provider_network_error",
          statusMessage: timedOut
            ? "SOLAPI 응답 시간이 초과되었습니다."
            : "SOLAPI 연결 결과를 확인할 수 없습니다.",
          requestKeyMatched: true,
        })
      }

      const payload = await parseJson(response)
      if (!payload && response.status >= 400 && response.status < 500) {
        return providerResult("failed_hold", observedAt, {
          statusCode: "provider_rejected",
          statusMessage: "SOLAPI 요청이 거부되었습니다.",
          requestKeyMatched: true,
        })
      }
      if (!payload) {
        return providerResult("unknown", observedAt, {
          statusCode: "provider_response_invalid",
          statusMessage: "SOLAPI 응답 형식을 확인할 수 없습니다.",
          requestKeyMatched: true,
        })
      }
      const groupId = text(
        isRecord(payload.groupInfo) ? payload.groupInfo.groupId : payload.groupId,
        200,
      )
      const accepted = rows(payload.messageList)[0] ?? null
      const failed = rows(payload.failedMessageList)[0] ?? null
      if (response.ok && accepted) {
        const values = sendRecordValues(accepted, groupId)
        if (text(values.providerMessageId, 200) || text(values.providerGroupId, 200)) {
          return providerResult("accepted", observedAt, {
            ...values,
            statusCode: values.statusCode || "provider_accepted",
            statusMessage: values.statusMessage || "SOLAPI 접수 완료",
            requestKeyMatched: true,
          })
        }
      }
      if (failed || (response.status >= 400 && response.status < 500)) {
        const values = sendRecordValues(failed, groupId)
        return providerResult("failed_hold", observedAt, {
          ...values,
          statusCode: values.statusCode || "provider_rejected",
          statusMessage: values.statusMessage || "SOLAPI 요청이 거부되었습니다.",
          requestKeyMatched: true,
        })
      }
      return providerResult("unknown", observedAt, {
        statusCode: response.status >= 500 ? "provider_unavailable" : "provider_response_ambiguous",
        statusMessage: "SOLAPI 접수 여부를 확인할 수 없습니다.",
        requestKeyMatched: true,
      })
    },

    async lookup(input: LookupInput): Promise<RegistrationCustomerMessageProviderResult> {
      const observedAt = now().toISOString()
      const url = new URL(SOLAPI_MESSAGE_LIST_URL)
      const criteria = ["messageId"]
      const queryValues = [input.providerMessageId]
      if (input.providerGroupId) {
        criteria.push("groupId")
        queryValues.push(input.providerGroupId)
      }
      url.searchParams.set("criteria", criteria.join(","))
      url.searchParams.set("cond", criteria.map(() => "eq").join(","))
      url.searchParams.set("value", queryValues.join(","))
      let response: Response
      try {
        response = await providerFetch(url, {
          method: "GET",
          headers: { Authorization: authorization(observedAt) },
        })
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === "AbortError"
        return providerResult("unknown", observedAt, {
          providerMessageId: input.providerMessageId,
          providerGroupId: input.providerGroupId,
          statusCode: timedOut ? "provider_timeout" : "provider_network_error",
          statusMessage: "SOLAPI 조회 결과를 확인할 수 없습니다.",
          requestKeyMatched: false,
        })
      }
      const payload = response.ok ? await parseJson(response) : null
      if (!payload) {
        return providerResult("unknown", observedAt, {
          providerMessageId: input.providerMessageId,
          providerGroupId: input.providerGroupId,
          statusCode: response.ok ? "provider_response_invalid" : "provider_unavailable",
          statusMessage: "SOLAPI 조회 결과를 확인할 수 없습니다.",
          requestKeyMatched: false,
        })
      }
      const record = rows(payload.messageList).find((candidate) => (
        exactText(candidate.messageId ?? candidate.message_id, 200) === input.providerMessageId
        && (!input.providerGroupId
          || exactText(candidate.groupId ?? candidate.group_id, 200) === input.providerGroupId)
      ))
      const fields = customFields(record?.customFields ?? record?.custom_fields)
      const requestKeyMatched = exactText(fields.registrationRequestKey, 200) === input.requestKey
      if (!record || !requestKeyMatched) {
        return providerResult("unknown", observedAt, {
          providerMessageId: input.providerMessageId,
          providerGroupId: input.providerGroupId,
          statusCode: record ? "provider_request_key_mismatch" : "provider_record_not_found",
          statusMessage: "요청 키와 일치하는 SOLAPI 기록을 확인할 수 없습니다.",
          requestKeyMatched: false,
        })
      }
      const values = sendRecordValues(record, text(input.providerGroupId, 200))
      const status = exactText(record.status, 100)
      const statusCode = exactText(record.statusCode ?? record.status_code, 100)
      const delivered = statusCode === "4000" && status === "COMPLETE"
      const complete = status === "COMPLETE"
      const outcome: ProviderOutcome = delivered
        ? "accepted"
        : complete
          ? "failed_hold"
          : "unknown"
      return providerResult(outcome, observedAt, {
        ...values,
        statusCode: values.statusCode || (complete ? "provider_delivery_failed" : "provider_delivery_pending"),
        statusMessage: values.statusMessage || (complete ? "SOLAPI 전달 실패" : "SOLAPI 전달 확인 중"),
        requestKeyMatched: true,
      })
    },

    async preflight(input: Readonly<{ entry: RegistrationCustomerMessageCatalogEntry }>) {
      const observedAt = now().toISOString()
      const url = new URL(SOLAPI_TEMPLATE_LIST_URL)
      url.searchParams.set("channelId", dependencies.pfId)
      url.searchParams.set("templateId", input.entry.templateId ?? "")
      url.searchParams.set("status", "APPROVED")
      try {
        const response = await providerFetch(url, {
          method: "GET",
          headers: { Authorization: authorization(observedAt) },
        })
        const payload = response.ok ? await parseJson(response) : null
        const template = rows(payload?.templateList).find((candidate) => (
          exactText(candidate.templateId, 200) === input.entry.templateId
        ))
        const normalized = template
          ? {
              content: exactText(template.content, 20_000),
              variables: normalizedVariables(template.variables),
              buttons: normalizedButtons(template.buttons),
            }
          : null
        const providerChecksum = normalized
          ? checksumRegistrationCustomerMessageTemplate(normalized)
          : ""
        const matched = Boolean(
          template
          && exactText(template.status ?? template.inspectionStatus, 100) === "APPROVED"
          && exactText(template.channelId ?? template.pfId, 200) === dependencies.pfId
          && input.entry.send.disableSms === true
          && providerChecksum === input.entry.checksums.template
          && normalized
          && sameJson(normalized.variables, [...input.entry.variables])
          && sameJson(normalized.buttons, [...input.entry.buttons]),
        )
        if (!matched) return Object.freeze({ matched: false as const, code: "template_drift" as const })
        return Object.freeze({
          matched: true as const,
          receipt: Object.freeze({
            templateId: input.entry.templateId as string,
            pfId: dependencies.pfId,
            catalogChecksum: input.entry.checksums.template,
            providerChecksum,
            providerStatus: "sendable" as const,
          }),
        })
      } catch {
        return Object.freeze({ matched: false as const, code: "provider_unavailable" as const })
      }
    },
  })
}
