import {
  NOTIFICATION_WORKFLOW_OPTIONS,
  parseNotificationControlPlaneSnapshot,
  type NotificationControlPlaneSnapshot,
  type NotificationRevisionMap,
  type NotificationScheduleConfig,
  type NotificationWorkflowKey,
} from "./notification-control-plane-types.ts"

const WORKFLOW_KEYS = new Set<string>(
  NOTIFICATION_WORKFLOW_OPTIONS.map(({ key }) => key),
)
const DECIMAL_REVISION = /^(0|[1-9]\d*)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONFLICT_FIELD = new RegExp(
  `^rules\\.${UUID.source.slice(1, -1)}\\.(?:enabled|titleTemplate|bodyTemplate|scheduleConfig)$`,
  "i",
)

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

type RulePatch = Readonly<{
  enabled?: boolean
  titleTemplate?: string
  bodyTemplate?: string
  scheduleConfig?: NotificationScheduleConfig
}>

type SavePatch = Readonly<{
  rules: Readonly<Record<string, RulePatch>>
}>

type ConflictOverride = Readonly<{
  requestId: string
  conflictingFields: ReadonlyArray<string>
}>

type ReconciliationJob = Readonly<{
  jobKind: string
  jobId: string
  status: string
  attemptCount: number
}>

export type NotificationControlPlaneSaveResult = NotificationControlPlaneSnapshot & Readonly<{
  reconciliationJob: ReconciliationJob | null
}>

export class NotificationControlPlaneHttpError extends Error {
  readonly code: string
  readonly status: number
  readonly currentSnapshot?: NotificationControlPlaneSnapshot
  readonly currentRevisions?: NotificationRevisionMap

  constructor(
    code: string,
    status: number,
    options: {
      currentSnapshot?: NotificationControlPlaneSnapshot
      currentRevisions?: NotificationRevisionMap
    } = {},
  ) {
    super("알림 설정 요청을 처리하지 못했습니다.")
    this.name = "NotificationControlPlaneHttpError"
    this.code = code
    this.status = status
    this.currentSnapshot = options.currentSnapshot
    this.currentRevisions = options.currentRevisions
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireWorkflowKey(value: string): NotificationWorkflowKey {
  if (!WORKFLOW_KEYS.has(value)) {
    throw new NotificationControlPlaneHttpError("notification_invalid_request", 400)
  }
  return value as NotificationWorkflowKey
}

function parseSafeSnapshot(input: unknown): NotificationControlPlaneSnapshot {
  const parsed = parseNotificationControlPlaneSnapshot(input)
  if (!parsed.ok) {
    throw new NotificationControlPlaneHttpError("notification_unsafe_response", 502)
  }
  return parsed.value
}

function parseRevisionMap(input: unknown): NotificationRevisionMap | undefined {
  if (!isRecord(input)) return undefined
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!UUID.test(key) || typeof value !== "string" || !DECIMAL_REVISION.test(value)) return undefined
    result[key] = value
  }
  return result
}

function toWirePatch(patch: SavePatch) {
  if (!isRecord(patch) || !isRecord(patch.rules)) {
    throw new NotificationControlPlaneHttpError("notification_invalid_request", 400)
  }

  const rules: Record<string, Record<string, unknown>> = {}
  for (const [ruleId, rulePatch] of Object.entries(patch.rules)) {
    if (!UUID.test(ruleId) || !isRecord(rulePatch)) {
      throw new NotificationControlPlaneHttpError("notification_invalid_request", 400)
    }
    const allowedKeys = new Set(["enabled", "titleTemplate", "bodyTemplate", "scheduleConfig"])
    if (Object.keys(rulePatch).some((key) => !allowedKeys.has(key))) {
      throw new NotificationControlPlaneHttpError("notification_invalid_request", 400)
    }
    const wirePatch: Record<string, unknown> = {}
    if ("enabled" in rulePatch) {
      if (typeof rulePatch.enabled !== "boolean") {
        throw new NotificationControlPlaneHttpError("notification_invalid_request", 400)
      }
      wirePatch.enabled = rulePatch.enabled
    }
    if ("titleTemplate" in rulePatch) {
      if (typeof rulePatch.titleTemplate !== "string") {
        throw new NotificationControlPlaneHttpError("notification_invalid_request", 400)
      }
      wirePatch.title_template = rulePatch.titleTemplate
    }
    if ("bodyTemplate" in rulePatch) {
      if (typeof rulePatch.bodyTemplate !== "string") {
        throw new NotificationControlPlaneHttpError("notification_invalid_request", 400)
      }
      wirePatch.body_template = rulePatch.bodyTemplate
    }
    if ("scheduleConfig" in rulePatch) {
      wirePatch.schedule_config = rulePatch.scheduleConfig
    }
    rules[ruleId] = wirePatch
  }
  return { rules }
}

function parseReconciliationJob(input: unknown): ReconciliationJob | null {
  if (input === undefined || input === null) return null
  if (
    !isRecord(input) ||
    typeof input.job_kind !== "string" ||
    typeof input.job_id !== "string" ||
    typeof input.status !== "string" ||
    !Number.isSafeInteger(input.attempt_count) ||
    (input.attempt_count as number) < 0
  ) {
    throw new NotificationControlPlaneHttpError("notification_unsafe_response", 502)
  }
  return {
    jobKind: input.job_kind,
    jobId: input.job_id,
    status: input.status,
    attemptCount: input.attempt_count as number,
  }
}

function validateExpectedRevisions(input: NotificationRevisionMap) {
  if (!isRecord(input)) {
    throw new NotificationControlPlaneHttpError("notification_invalid_request", 400)
  }
  for (const [ruleId, revision] of Object.entries(input)) {
    if (!UUID.test(ruleId) || typeof revision !== "string" || !DECIMAL_REVISION.test(revision)) {
      throw new NotificationControlPlaneHttpError("notification_invalid_request", 400)
    }
  }
}

function toWireConflictOverride(input: ConflictOverride) {
  if (
    !isRecord(input) ||
    Object.keys(input).sort().join(",") !== "conflictingFields,requestId" ||
    typeof input.requestId !== "string" ||
    !UUID.test(input.requestId) ||
    !Array.isArray(input.conflictingFields) ||
    input.conflictingFields.length === 0 ||
    input.conflictingFields.some((field) => typeof field !== "string" || !CONFLICT_FIELD.test(field)) ||
    new Set(input.conflictingFields).size !== input.conflictingFields.length
  ) {
    throw new NotificationControlPlaneHttpError("notification_invalid_request", 400)
  }
  return {
    request_id: input.requestId,
    conflicting_fields: [...input.conflictingFields],
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new NotificationControlPlaneHttpError("notification_invalid_response", 502)
  }
}

export function createNotificationControlPlaneService(dependencies: {
  baseUrl: string
  getAccessToken: () => Promise<string | null>
  fetch?: FetchLike
}) {
  const request = dependencies.fetch ?? globalThis.fetch

  async function authorizedFetch(url: URL, init: RequestInit = {}) {
    const token = await dependencies.getAccessToken()
    if (!token) {
      throw new NotificationControlPlaneHttpError("notification_unauthorized", 401)
    }
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

  async function throwResponseError(response: Response, payload: unknown): Promise<never> {
    const body = isRecord(payload) ? payload : {}
    const code = typeof body.code === "string" ? body.code : "notification_request_failed"
    const currentSnapshot = body.current_snapshot === undefined
      ? undefined
      : parseSafeSnapshot(body.current_snapshot)
    const currentRevisions = parseRevisionMap(body.current_revisions)
    throw new NotificationControlPlaneHttpError(code, response.status, {
      currentSnapshot,
      currentRevisions,
    })
  }

  return {
    async getControlPlane(input: {
      workflowKey: NotificationWorkflowKey
    }): Promise<NotificationControlPlaneSnapshot> {
      const workflowKey = requireWorkflowKey(input.workflowKey)
      const url = new URL("/api/notifications/control-plane", dependencies.baseUrl)
      url.searchParams.set("workflow_key", workflowKey)
      const response = await authorizedFetch(url)
      const payload = await readJson(response)
      if (!response.ok) await throwResponseError(response, payload)
      return parseSafeSnapshot(payload)
    },

    async saveControlPlane(input: {
      workflowKey: NotificationWorkflowKey
      expectedRevisions: NotificationRevisionMap
      patch: SavePatch
      requestId: string
      conflictOverride?: ConflictOverride
    }): Promise<NotificationControlPlaneSaveResult> {
      const workflowKey = requireWorkflowKey(input.workflowKey)
      validateExpectedRevisions(input.expectedRevisions)
      if (!UUID.test(input.requestId)) {
        throw new NotificationControlPlaneHttpError("notification_invalid_request", 400)
      }
      const conflictOverride = input.conflictOverride
        ? toWireConflictOverride(input.conflictOverride)
        : undefined
      const response = await authorizedFetch(
        new URL("/api/notifications/control-plane", dependencies.baseUrl),
        {
          method: "PATCH",
          body: JSON.stringify({
            workflow_key: workflowKey,
            expected_revisions: input.expectedRevisions,
            patch: toWirePatch(input.patch),
            request_id: input.requestId,
            ...(conflictOverride ? { conflict_override: conflictOverride } : {}),
          }),
        },
      )
      const payload = await readJson(response)
      if (!response.ok) await throwResponseError(response, payload)
      const snapshot = parseSafeSnapshot(payload)
      const reconciliationJob = parseReconciliationJob(
        isRecord(payload) ? payload.reconciliation_job : undefined,
      )
      return { ...snapshot, reconciliationJob }
    },
  }
}
