import {
  isRegistrationCustomerMessageKind,
  type RegistrationCustomerMessageHistoryItem,
} from "./registration-customer-message-contract.ts"

export type RegistrationCaseCustomerMessageHistoryItem = RegistrationCustomerMessageHistoryItem & Readonly<{
  canCheckDelivery: boolean
}>

export type RegistrationCaseCustomerMessageHistory = Readonly<{
  ok: true
  page: number
  pageSize: 10 | 15 | 20
  totalCount: number
  history: ReadonlyArray<RegistrationCaseCustomerMessageHistoryItem>
}>

export type RegistrationCaseCustomerMessageHistoryInput = Readonly<{
  taskId: string
  page: number
  pageSize: 10 | 15 | 20
}>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const STATUSES = new Set(["pending", "accepted", "unknown", "failed_hold"])
const RESPONSE_KEYS = new Set(["ok", "page", "pageSize", "totalCount", "history"])
const ITEM_KEYS = new Set(["messageId", "messageKind", "currentStatus", "confirmedByName", "confirmedAt", "updatedAt", "recipientLast4", "canCheck", "canCheckDelivery"])
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const validTime = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value))

export function parseRegistrationCaseCustomerMessageHistoryInput(params: URLSearchParams): RegistrationCaseCustomerMessageHistoryInput | null {
  if (params.size !== 3 || ![...params.keys()].every((key) => ["taskId", "page", "pageSize"].includes(key))) return null
  const taskId = params.get("taskId") || ""
  const rawPage = params.get("page") || ""
  const rawSize = params.get("pageSize") || ""
  if (!UUID.test(taskId) || !/^[1-9]\d{0,5}$/u.test(rawPage) || !["10", "15", "20"].includes(rawSize)) return null
  const page = Number(rawPage)
  if (page > 100000) return null
  return { taskId: taskId.toLowerCase(), page, pageSize: Number(rawSize) as 10 | 15 | 20 }
}

export function parseRegistrationCaseCustomerMessageHistory(
  value: unknown,
  input: Pick<RegistrationCaseCustomerMessageHistoryInput, "page" | "pageSize">,
): RegistrationCaseCustomerMessageHistory {
  const invalid = (): never => { throw new Error("registration_customer_message_history_unavailable") }
  if (!object(value) || Object.keys(value).some((key) => !RESPONSE_KEYS.has(key))
    || value.ok !== true || value.page !== input.page || value.pageSize !== input.pageSize
    || !Number.isSafeInteger(value.totalCount) || Number(value.totalCount) < 0
    || !Array.isArray(value.history) || value.history.length > input.pageSize
    || value.history.length > Number(value.totalCount)) return invalid()
  const ids = new Set<string>()
  const history = value.history.map((item): RegistrationCaseCustomerMessageHistoryItem => {
    if (!object(item) || Object.keys(item).some((key) => !ITEM_KEYS.has(key))
      || typeof item.messageId !== "string" || !UUID.test(item.messageId) || ids.has(item.messageId)
      || !isRegistrationCustomerMessageKind(item.messageKind)
      || typeof item.currentStatus !== "string" || !STATUSES.has(item.currentStatus)
      || typeof item.confirmedByName !== "string" || !item.confirmedByName.trim() || item.confirmedByName.length > 200
      || !validTime(item.confirmedAt) || !validTime(item.updatedAt)
      || typeof item.canCheck !== "boolean" || typeof item.canCheckDelivery !== "boolean"
      || (item.canCheck && !["pending", "unknown"].includes(item.currentStatus))
      || (item.canCheckDelivery && item.currentStatus !== "accepted")
      || (item.recipientLast4 !== undefined && (typeof item.recipientLast4 !== "string" || !/^\d{4}$/u.test(item.recipientLast4)))) return invalid()
    ids.add(item.messageId)
    return { ...item } as RegistrationCaseCustomerMessageHistoryItem
  })
  return { ok: true, page: input.page, pageSize: input.pageSize, totalCount: Number(value.totalCount), history }
}
