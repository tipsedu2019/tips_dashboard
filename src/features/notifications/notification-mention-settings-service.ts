import {
  NOTIFICATION_WORKFLOW_OPTIONS,
  type NotificationWorkflowKey,
} from "./notification-control-plane-types.ts"
import type { NotificationMentionSettingDto } from "./notification-mention-settings-types.ts"

const WORKFLOW_KEYS = new Set<string>(NOTIFICATION_WORKFLOW_OPTIONS.map(({ key }) => key))
const DECIMAL_REVISION = /^(0|[1-9]\d*)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export class NotificationMentionSettingsHttpError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status: number) {
    super("담당자 멘션 설정 요청을 처리하지 못했습니다.")
    this.name = "NotificationMentionSettingsHttpError"
    this.code = code
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(input: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(input).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function requireWorkflowKey(value: string): NotificationWorkflowKey {
  if (!WORKFLOW_KEYS.has(value)) {
    throw new NotificationMentionSettingsHttpError("notification_invalid_request", 400)
  }
  return value as NotificationWorkflowKey
}

function parseSetting(input: unknown): NotificationMentionSettingDto {
  if (
    !isRecord(input) ||
    !exactKeys(input, [
      "rule_id",
      "workflow_key",
      "event_key",
      "channel_key",
      "mention_enabled",
      "revision",
      "updated_at",
      "editable",
    ]) ||
    typeof input.rule_id !== "string" ||
    !UUID.test(input.rule_id) ||
    typeof input.workflow_key !== "string" ||
    !WORKFLOW_KEYS.has(input.workflow_key) ||
    typeof input.event_key !== "string" ||
    input.event_key.length === 0 ||
    input.channel_key !== "google_chat" ||
    typeof input.mention_enabled !== "boolean" ||
    typeof input.revision !== "string" ||
    !DECIMAL_REVISION.test(input.revision) ||
    (input.updated_at !== null && typeof input.updated_at !== "string") ||
    typeof input.editable !== "boolean"
  ) {
    throw new NotificationMentionSettingsHttpError("notification_unsafe_response", 502)
  }
  return {
    ruleId: input.rule_id,
    workflowKey: input.workflow_key as NotificationWorkflowKey,
    eventKey: input.event_key,
    channelKey: "google_chat",
    mentionEnabled: input.mention_enabled,
    revision: input.revision,
    updatedAt: input.updated_at,
    editable: input.editable,
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new NotificationMentionSettingsHttpError("notification_invalid_response", 502)
  }
}

function errorCode(payload: unknown) {
  return isRecord(payload) && typeof payload.code === "string"
    ? payload.code
    : "notification_request_failed"
}

export function createNotificationMentionSettingsService(dependencies: {
  baseUrl: string
  getAccessToken: () => Promise<string | null>
  fetch?: FetchLike
}) {
  const request = dependencies.fetch ?? globalThis.fetch

  async function authorizedFetch(url: URL, init: RequestInit = {}) {
    const token = await dependencies.getAccessToken()
    if (!token) throw new NotificationMentionSettingsHttpError("notification_unauthorized", 401)
    return request(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
    })
  }

  return {
    async getMentionSettings(input: {
      workflowKey: NotificationWorkflowKey
      signal?: AbortSignal
    }): Promise<NotificationMentionSettingDto[]> {
      const workflowKey = requireWorkflowKey(input.workflowKey)
      const url = new URL("/api/notifications/mention-settings", dependencies.baseUrl)
      url.searchParams.set("workflow_key", workflowKey)
      const response = await authorizedFetch(url, { signal: input.signal })
      const payload = await readJson(response)
      if (!response.ok) throw new NotificationMentionSettingsHttpError(errorCode(payload), response.status)
      if (!isRecord(payload) || !exactKeys(payload, ["settings"]) || !Array.isArray(payload.settings)) {
        throw new NotificationMentionSettingsHttpError("notification_unsafe_response", 502)
      }
      const settings = payload.settings.map(parseSetting)
      if (settings.some((setting) => setting.workflowKey !== workflowKey)) {
        throw new NotificationMentionSettingsHttpError("notification_unsafe_response", 502)
      }
      return settings
    },

    async saveMentionSetting(input: {
      ruleId: string
      mentionEnabled: boolean
      expectedRevision: string
      requestId: string
    }): Promise<NotificationMentionSettingDto> {
      if (
        !UUID.test(input.ruleId) ||
        typeof input.mentionEnabled !== "boolean" ||
        !DECIMAL_REVISION.test(input.expectedRevision) ||
        !UUID.test(input.requestId)
      ) {
        throw new NotificationMentionSettingsHttpError("notification_invalid_request", 400)
      }
      const response = await authorizedFetch(
        new URL("/api/notifications/mention-settings", dependencies.baseUrl),
        {
          method: "PATCH",
          body: JSON.stringify({
            rule_id: input.ruleId,
            mention_enabled: input.mentionEnabled,
            expected_revision: input.expectedRevision,
            request_id: input.requestId,
          }),
        },
      )
      const payload = await readJson(response)
      if (!response.ok) throw new NotificationMentionSettingsHttpError(errorCode(payload), response.status)
      if (!isRecord(payload) || !exactKeys(payload, ["setting"])) {
        throw new NotificationMentionSettingsHttpError("notification_unsafe_response", 502)
      }
      const setting = parseSetting(payload.setting)
      if (setting.ruleId !== input.ruleId) {
        throw new NotificationMentionSettingsHttpError("notification_unsafe_response", 502)
      }
      return setting
    },
  }
}
