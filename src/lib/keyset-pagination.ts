import { createHash } from "node:crypto"

type SortValue = string | number | null
type SortType = "string" | "number" | "null" | "nullable-string" | "nullable-number"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MAX_CURSOR_LENGTH = 1024

function cursorError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function assertUuid(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) throw cursorError(code)
}

function assertScope(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/iu.test(value)) throw cursorError("cursor_scope_invalid")
}

function decodeEnvelope(cursor: unknown): Record<string, unknown> {
  if (typeof cursor !== "string" || cursor.length === 0) throw cursorError("cursor_malformed")
  if (cursor.length > MAX_CURSOR_LENGTH) throw cursorError("cursor_too_long")
  if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) throw cursorError("cursor_base64url_invalid")
  let decoded: string
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8")
  } catch {
    throw cursorError("cursor_base64url_invalid")
  }
  if (Buffer.from(decoded, "utf8").toString("base64url") !== cursor) throw cursorError("cursor_base64url_invalid")
  let envelope: unknown
  try {
    envelope = JSON.parse(decoded)
  } catch {
    throw cursorError("cursor_malformed")
  }
  if (!isRecord(envelope)) throw cursorError("cursor_malformed")
  return envelope
}

function assertSortValues(values: unknown, types: readonly SortType[]): asserts values is SortValue[] {
  if (!Array.isArray(values) || values.length !== types.length) throw cursorError("cursor_sort_arity_invalid")
  for (let index = 0; index < types.length; index += 1) {
    const value = values[index]
    const type = types[index]
    const matches = type === "string" ? typeof value === "string"
      : type === "number" ? typeof value === "number" && Number.isFinite(value)
        : type === "null" ? value === null
          : type === "nullable-string" ? value === null || typeof value === "string"
            : value === null || (typeof value === "number" && Number.isFinite(value))
    if (!matches) throw cursorError("cursor_sort_type_invalid")
  }
}

export function createCursorScope({ surface, role, filters, sort }: {
  surface: string
  role: string
  filters: unknown
  sort: unknown
}): string {
  if (!surface || !role) throw cursorError("cursor_scope_invalid")
  return createHash("sha256").update(canonicalJson({ surface, role, filters, sort })).digest("hex")
}

export function encodeKeysetCursor({ sortValues, id, scope }: { sortValues: SortValue[]; id: string; scope: string }): string {
  assertUuid(id, "cursor_id_invalid")
  if (!Array.isArray(sortValues) || !sortValues.every((value) => value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value)))) throw cursorError("cursor_sort_type_invalid")
  assertScope(scope)
  const cursor = Buffer.from(JSON.stringify({ v: 1, s: sortValues, id, scope })).toString("base64url")
  if (cursor.length > MAX_CURSOR_LENGTH) throw cursorError("cursor_too_long")
  return cursor
}

export function decodeKeysetCursor(cursor: unknown, { scope, sortTypes }: { scope: string; sortTypes: readonly SortType[] }): { sortValues: SortValue[]; id: string } {
  const envelope = decodeEnvelope(cursor)
  if (envelope.v !== 1) throw cursorError("cursor_version_unknown")
  assertScope(envelope.scope)
  assertScope(scope)
  if (envelope.scope !== scope) throw cursorError("cursor_scope_mismatch")
  assertUuid(envelope.id, "cursor_id_invalid")
  assertSortValues(envelope.s, sortTypes)
  return { sortValues: envelope.s, id: envelope.id }
}

export function encodeManagementRelationCursor({ kind, entityId, relationKind, sortValue, id }: {
  kind: string
  entityId: string
  relationKind: string
  sortValue: string
  id: string
}): string {
  assertUuid(entityId, "management_cursor_entity_invalid")
  assertUuid(id, "management_cursor_id_invalid")
  if (!kind || !relationKind || typeof sortValue !== "string") throw cursorError("management_cursor_malformed")
  const cursor = Buffer.from(JSON.stringify({ v: 1, kind, entityId, relationKind, sortValue, id })).toString("base64url")
  if (cursor.length > MAX_CURSOR_LENGTH) throw cursorError("cursor_too_long")
  return cursor
}

export function decodeManagementRelationCursor(cursor: unknown, expected: { kind: string; entityId: string; relationKind: string }): { sortValue: string; id: string } {
  const envelope = decodeEnvelope(cursor)
  if (envelope.v !== 1) throw cursorError("cursor_version_unknown")
  assertUuid(envelope.entityId, "management_cursor_entity_invalid")
  assertUuid(envelope.id, "management_cursor_id_invalid")
  if (typeof envelope.kind !== "string" || typeof envelope.relationKind !== "string" || typeof envelope.sortValue !== "string") throw cursorError("management_cursor_malformed")
  if (envelope.kind !== expected.kind || envelope.entityId !== expected.entityId || envelope.relationKind !== expected.relationKind) throw cursorError("management_cursor_scope_mismatch")
  return { sortValue: envelope.sortValue, id: envelope.id }
}
