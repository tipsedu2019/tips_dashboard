export type DashboardNotification = Readonly<{
  id: string
  title: string
  body: string
  href: string
  type: string
  readAt: string
  createdAt: string
}>

export type DashboardNotificationCursor = Readonly<{
  createdAt: string
  id: string
}>

export type DashboardNotificationInbox = Readonly<{
  items: DashboardNotification[]
  unreadCount: number
  nextCursor: DashboardNotificationCursor | null
}>

export type DashboardNotificationReadResult = Readonly<{
  notificationId: string
  newlyRead: boolean
  readAt: string
  unreadCount: number
}>

type WireRecord = Record<string, unknown>

const INBOX_KEYS = ["items", "next_cursor", "unread_count"] as const
const INBOX_ITEM_KEYS = [
  "actor_profile_id",
  "body",
  "created_at",
  "href",
  "id",
  "metadata",
  "read_at",
  "recipient_profile_id",
  "recipient_team",
  "title",
  "type",
] as const
const CURSOR_KEYS = ["created_at", "id"] as const
const UNREAD_COUNT_KEYS = ["unread_count"] as const
const READ_RESULT_KEYS = ["newly_read", "notification_id", "read_at", "unread_count"] as const
const DECIMAL_COUNT_PATTERN = /^(0|[1-9]\d*)$/

function wireInvalid(): never {
  throw new Error("dashboard_notification_wire_invalid")
}

function isWireRecord(value: unknown): value is WireRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function wireRecord(value: unknown): WireRecord {
  if (!isWireRecord(value)) wireInvalid()
  return value
}

function hasExactKeys(value: WireRecord, expectedKeys: readonly string[]) {
  const actualKeys = Object.keys(value).sort()
  const sortedExpectedKeys = [...expectedKeys].sort()
  return actualKeys.length === sortedExpectedKeys.length
    && actualKeys.every((key, index) => key === sortedExpectedKeys[index])
}

function exactWireRecord(value: unknown, expectedKeys: readonly string[]) {
  const record = wireRecord(value)
  if (!hasExactKeys(record, expectedKeys)) wireInvalid()
  return record
}

function wireString(value: unknown, allowEmpty = true) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) wireInvalid()
  return value
}

function wireNullableString(value: unknown) {
  if (value === null) return null
  return wireString(value)
}

function safeUnreadCount(value: unknown) {
  if (typeof value !== "string" || !DECIMAL_COUNT_PATTERN.test(value)) wireInvalid()
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) wireInvalid()
  return count
}

function safeLocalUnreadCount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) wireInvalid()
  return value
}

function mapNotificationWire(value: unknown): DashboardNotification {
  const record = exactWireRecord(value, INBOX_ITEM_KEYS)
  wireNullableString(record.recipient_profile_id)
  wireNullableString(record.recipient_team)
  wireNullableString(record.actor_profile_id)
  wireRecord(record.metadata)

  const readAt = wireNullableString(record.read_at)
  return {
    id: wireString(record.id, false),
    title: wireString(record.title),
    body: wireString(record.body),
    href: wireString(record.href),
    type: wireString(record.type),
    readAt: readAt ?? "",
    createdAt: wireString(record.created_at, false),
  }
}

export function mapDashboardNotificationInboxWire(value: unknown): DashboardNotificationInbox {
  const record = exactWireRecord(value, INBOX_KEYS)
  if (!Array.isArray(record.items)) wireInvalid()

  let nextCursor: DashboardNotificationCursor | null = null
  if (record.next_cursor !== null) {
    const cursor = exactWireRecord(record.next_cursor, CURSOR_KEYS)
    nextCursor = {
      createdAt: wireString(cursor.created_at, false),
      id: wireString(cursor.id, false),
    }
  }

  return {
    items: record.items.map(mapNotificationWire),
    unreadCount: safeUnreadCount(record.unread_count),
    nextCursor,
  }
}

export function mapDashboardNotificationUnreadCountWire(value: unknown) {
  const record = exactWireRecord(value, UNREAD_COUNT_KEYS)
  return safeUnreadCount(record.unread_count)
}

export function mapDashboardNotificationReadWire(value: unknown): DashboardNotificationReadResult {
  const record = exactWireRecord(value, READ_RESULT_KEYS)
  if (typeof record.newly_read !== "boolean") wireInvalid()

  return {
    notificationId: wireString(record.notification_id, false),
    newlyRead: record.newly_read,
    readAt: wireString(record.read_at, false),
    unreadCount: safeUnreadCount(record.unread_count),
  }
}

export type DashboardInboxReadState = Readonly<{
  pending: boolean
  error: string
  operationId: number | null
}>

export type DashboardInboxState = Readonly<{
  profileId: string
  generation: number
  items: readonly DashboardNotification[]
  unreadCount: number
  nextCursor: DashboardNotificationCursor | null
  readStates: Readonly<Record<string, DashboardInboxReadState>>
  requiresUnreadCountSync: boolean
  pendingUnreadCountSyncOperationId: number | null
  markVersion: number
  nextOperationId: number
}>

export type DashboardInboxMarkRequest = Readonly<{
  profileId: string
  generation: number
  notificationId: string
  operationId: number
}>

export type DashboardInboxUnreadCountSyncRequest = Readonly<{
  profileId: string
  generation: number
  operationId: number
  markVersion: number
}>

type DashboardInboxMarkStart = Readonly<{
  state: DashboardInboxState
  request: DashboardInboxMarkRequest | null
}>

function hasPendingRead(state: DashboardInboxState) {
  return Object.values(state.readStates).some((readState) => readState.pending)
}

function isCurrentMarkRequest(state: DashboardInboxState, request: DashboardInboxMarkRequest | null) {
  if (!request) return false
  return request.profileId === state.profileId
    && request.generation === state.generation
    && state.readStates[request.notificationId]?.pending === true
    && state.readStates[request.notificationId]?.operationId === request.operationId
}

export function createDashboardInboxState(
  profileId: string,
  generation: number,
  inbox: DashboardNotificationInbox = { items: [], unreadCount: 0, nextCursor: null },
): DashboardInboxState {
  if (typeof profileId !== "string" || !Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("dashboard_inbox_scope_invalid")
  }

  return {
    profileId,
    generation,
    items: [...inbox.items],
    unreadCount: safeLocalUnreadCount(inbox.unreadCount),
    nextCursor: inbox.nextCursor,
    readStates: {},
    requiresUnreadCountSync: false,
    pendingUnreadCountSyncOperationId: null,
    markVersion: 0,
    nextOperationId: 0,
  }
}

export function beginDashboardInboxMark(
  state: DashboardInboxState,
  notificationId: string,
): DashboardInboxMarkStart {
  const item = state.items.find((candidate) => candidate.id === notificationId)
  if (!item || item.readAt || state.readStates[notificationId]?.pending) {
    return { state, request: null }
  }

  const operationId = state.nextOperationId + 1
  const hadConcurrentMark = hasPendingRead(state)
  const interruptedCountSync = state.pendingUnreadCountSyncOperationId !== null
  const request: DashboardInboxMarkRequest = {
    profileId: state.profileId,
    generation: state.generation,
    notificationId,
    operationId,
  }
  return {
    state: {
      ...state,
      readStates: {
        ...state.readStates,
        [notificationId]: { pending: true, error: "", operationId },
      },
      requiresUnreadCountSync: state.requiresUnreadCountSync || hadConcurrentMark || interruptedCountSync,
      pendingUnreadCountSyncOperationId: null,
      markVersion: state.markVersion + 1,
      nextOperationId: operationId,
    },
    request,
  }
}

export function beginDashboardInboxLinkClick(
  state: DashboardInboxState,
  notificationId: string,
) {
  return {
    ...beginDashboardInboxMark(state, notificationId),
    blockNavigation: false as const,
  }
}

export function completeDashboardInboxMark(
  state: DashboardInboxState,
  request: DashboardInboxMarkRequest | null,
  result: DashboardNotificationReadResult,
): DashboardInboxState {
  if (!isCurrentMarkRequest(state, request) || request?.notificationId !== result.notificationId) {
    return state
  }
  const unreadCount = safeLocalUnreadCount(result.unreadCount)
  if (!result.readAt) throw new Error("dashboard_notification_read_result_invalid")

  return {
    ...state,
    items: state.items.map((item) => item.id === request.notificationId
      ? { ...item, readAt: result.readAt }
      : item),
    unreadCount,
    readStates: {
      ...state.readStates,
      [request.notificationId]: { pending: false, error: "", operationId: null },
    },
  }
}

export function failDashboardInboxMark(
  state: DashboardInboxState,
  request: DashboardInboxMarkRequest | null,
  error: string,
): DashboardInboxState {
  if (!isCurrentMarkRequest(state, request) || !request) return state
  const message = typeof error === "string" && error.trim()
    ? error.trim()
    : "알림을 읽음 처리하지 못했습니다. 다시 시도하세요."

  return {
    ...state,
    readStates: {
      ...state.readStates,
      [request.notificationId]: { pending: false, error: message, operationId: null },
    },
  }
}

export function beginDashboardInboxUnreadCountSync(state: DashboardInboxState) {
  if (
    !state.requiresUnreadCountSync
    || hasPendingRead(state)
    || state.pendingUnreadCountSyncOperationId !== null
  ) {
    return { state, request: null }
  }

  const operationId = state.nextOperationId + 1
  const request: DashboardInboxUnreadCountSyncRequest = {
    profileId: state.profileId,
    generation: state.generation,
    operationId,
    markVersion: state.markVersion,
  }
  return {
    state: {
      ...state,
      pendingUnreadCountSyncOperationId: operationId,
      nextOperationId: operationId,
    },
    request,
  }
}

export function completeDashboardInboxUnreadCountSync(
  state: DashboardInboxState,
  request: DashboardInboxUnreadCountSyncRequest | null,
  unreadCount: number,
): DashboardInboxState {
  if (
    !request
    || request.profileId !== state.profileId
    || request.generation !== state.generation
    || request.operationId !== state.pendingUnreadCountSyncOperationId
    || request.markVersion !== state.markVersion
    || hasPendingRead(state)
  ) {
    return state
  }

  return {
    ...state,
    unreadCount: safeLocalUnreadCount(unreadCount),
    requiresUnreadCountSync: false,
    pendingUnreadCountSyncOperationId: null,
  }
}

export function failDashboardInboxUnreadCountSync(
  state: DashboardInboxState,
  request: DashboardInboxUnreadCountSyncRequest | null,
): DashboardInboxState {
  if (
    !request
    || request.profileId !== state.profileId
    || request.generation !== state.generation
    || request.operationId !== state.pendingUnreadCountSyncOperationId
  ) {
    return state
  }

  return {
    ...state,
    requiresUnreadCountSync: true,
    pendingUnreadCountSyncOperationId: null,
  }
}
