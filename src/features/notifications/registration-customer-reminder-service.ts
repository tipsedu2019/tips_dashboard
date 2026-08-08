export type RegistrationCustomerReminderSettings = Readonly<{
  enabled: boolean
  leadHours: number
  revision: string
  updatedAt: string
  ready: boolean
  status: "ready" | "approval_pending" | "scheduler_pending"
  editable: boolean
}>

type Dependencies = Readonly<{
  baseUrl: string
  getAccessToken(): Promise<string | null>
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}>

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(value: JsonRecord, keys: ReadonlyArray<string>) {
  const expected = [...keys].sort()
  const actual = Object.keys(value).sort()
  return expected.length === actual.length
    && expected.every((key, index) => key === actual[index])
}

function settingsFromResponse(value: unknown): RegistrationCustomerReminderSettings {
  if (
    !isRecord(value)
    || !exactKeys(value, [
      "enabled",
      "leadHours",
      "revision",
      "updatedAt",
      "ready",
      "status",
      "editable",
    ])
    || typeof value.enabled !== "boolean"
    || !Number.isInteger(value.leadHours)
    || (value.leadHours as number) < 1
    || (value.leadHours as number) > 72
    || typeof value.revision !== "string"
    || !/^[1-9]\d*$/u.test(value.revision)
    || typeof value.updatedAt !== "string"
    || !Number.isFinite(Date.parse(value.updatedAt))
    || typeof value.ready !== "boolean"
    || !["ready", "approval_pending", "scheduler_pending"].includes(String(value.status))
    || typeof value.editable !== "boolean"
  ) throw new Error("registration_customer_reminder_settings_invalid")
  return Object.freeze({
    enabled: value.enabled,
    leadHours: value.leadHours as number,
    revision: value.revision,
    updatedAt: value.updatedAt,
    ready: value.ready,
    status: value.status as RegistrationCustomerReminderSettings["status"],
    editable: value.editable,
  })
}

async function responseSettings(response: Response) {
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === "string"
      ? payload.error
      : "자동 리마인드 설정을 처리하지 못했습니다."
    throw new Error(message)
  }
  if (!isRecord(payload) || payload.ok !== true || !exactKeys(payload, ["ok", "settings"])) {
    throw new Error("registration_customer_reminder_settings_invalid")
  }
  return settingsFromResponse(payload.settings)
}

export function createRegistrationCustomerReminderSettingsService(
  dependencies: Dependencies,
) {
  const fetcher = dependencies.fetch ?? globalThis.fetch.bind(globalThis)
  const timeoutMs = dependencies.timeoutMs ?? 12_000
  const endpoint = new URL(
    "/api/solapi/registration/reminders/settings",
    dependencies.baseUrl,
  )

  function requestSignal(signal?: AbortSignal) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  }

  async function authorization() {
    const token = await dependencies.getAccessToken()
    if (!token) throw new Error("로그인 정보를 다시 확인해 주세요.")
    return token
  }

  return Object.freeze({
    async get(signal?: AbortSignal) {
      const token = await authorization()
      return responseSettings(await fetcher(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: requestSignal(signal),
      }))
    },
    async update(input: Readonly<{
      enabled: boolean
      leadHours: number
      expectedRevision: string
    }>) {
      const token = await authorization()
      return responseSettings(await fetcher(endpoint, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
        signal: requestSignal(),
      }))
    },
  })
}
