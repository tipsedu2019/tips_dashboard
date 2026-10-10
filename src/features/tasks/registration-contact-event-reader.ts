import type { RegistrationTrackClient } from "./registration-track-service"

type EventRow = { id: string; task_id: string; actor_id: string | null; event_type: string;
  field_name: string | null; before_value: string | null; after_value: string | null; created_at: string }
const EVENT_KEYS = ["id", "task_id", "actor_id", "event_type", "field_name", "before_value", "after_value", "created_at"] as const
const CONTACT_KEYS = new Set(["contact", "parent_contact", "parentContact", "phone", "student_contact", "studentContact",
  "student_phone", "studentPhone", "parent_phone", "parentPhone", "guardian_contact", "guardianContact", "guardian_phone", "guardianPhone"])
const uuid = (value: unknown): value is string => typeof value === "string" && value.length === 36
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const nullableText = (value: unknown) => value === null || typeof value === "string"

function hasUnsafeStructuredValue(value: unknown): boolean {
  const stack = [{ value, depth: 0 }]
  while (stack.length) {
    const current = stack.pop()!
    if (current.depth > 64) return true
    if (current.value === null || typeof current.value !== "object") continue
    if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 })
    } else {
      for (const [key, child] of Object.entries(current.value)) {
        if (CONTACT_KEYS.has(key)) return true
        stack.push({ value: child, depth: current.depth + 1 })
      }
    }
  }
  return false
}
function safeStructuredPayload(value: string | null): boolean {
  if (value === null) return true
  try { return !hasUnsafeStructuredValue(JSON.parse(value)) }
  catch { return true }
}
function validLegacyImport(value: string | null): boolean {
  if (value === null) return false
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      && Number((parsed as Record<string, unknown>).version) === 1
  } catch { return false }
}
function invalid(): never { throw new Error("registration_contact_event_read_response_invalid") }
function timestampMicros(value: string): bigint | null {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!parsed) return null
  const [, year, month, day, hour, minute, second, fraction = "", offset] = parsed
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`)
  if (!Number.isFinite(calendar.getTime()) || calendar.getUTCFullYear() !== Number(year)
    || calendar.getUTCMonth() + 1 !== Number(month) || calendar.getUTCDate() !== Number(day)
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null
  const whole = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`)
  if (!Number.isFinite(whole)) return null
  return BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(6, "0"))
}

/** Only a DB-sanitized bounded response; never a fallback raw-table read. */
export async function readRegistrationContactEvents(client: Pick<RegistrationTrackClient, "rpc">, taskId: string,
  sharedOnly: boolean, signal?: AbortSignal): Promise<EventRow[]> {
  if (!uuid(taskId) || typeof sharedOnly !== "boolean") throw new Error("registration_contact_event_read_input_invalid")
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000)
  requestSignal.throwIfAborted()
  const { data, error } = await client.rpc("read_registration_contact_events_v1", {
    p_task_id: taskId, p_limit: 30, p_shared_only: sharedOnly,
  }).abortSignal(requestSignal).retry(false)
  requestSignal.throwIfAborted()
  if (error) throw error
  if (!data || typeof data !== "object" || Array.isArray(data)
    || Object.keys(data).length !== 2 || !Object.prototype.hasOwnProperty.call(data, "events")
    || !Object.prototype.hasOwnProperty.call(data, "legacyImport")
    || new TextEncoder().encode(JSON.stringify(data)).byteLength > 128000) invalid()
  const envelope = data as { events: unknown; legacyImport: unknown }
  if (!Array.isArray(envelope.events) || envelope.events.length > 30) invalid()
  const seen = new Set<string>()
  let previous: { created: bigint; id: string } | null = null
  function validate(value: unknown): EventRow {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid()
    const row = value as Record<string, unknown>
    if (Object.keys(row).length !== EVENT_KEYS.length || EVENT_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(row, key))
      || !uuid(row.id) || !uuid(row.task_id) || row.task_id.toLowerCase() !== taskId.toLowerCase()
      || (row.actor_id !== null && !uuid(row.actor_id)) || typeof row.event_type !== "string"
      || !nullableText(row.field_name) || !nullableText(row.before_value) || !nullableText(row.after_value)
      || typeof row.created_at !== "string") invalid()
    const event = row as EventRow
    const created = timestampMicros(event.created_at)
    if (created === null) invalid()
    if ((event.field_name !== null && CONTACT_KEYS.has(event.field_name) && (event.before_value !== null || event.after_value !== null))
      || !safeStructuredPayload(event.before_value) || !safeStructuredPayload(event.after_value)) invalid()
    return event
  }
  const events = envelope.events.map((value: unknown) => {
    const event = validate(value), created = timestampMicros(event.created_at)!
    const lowerId = event.id.toLowerCase()
    if (seen.has(lowerId) || (previous && (created > previous.created || (created === previous.created && lowerId <= previous.id)))) invalid()
    seen.add(lowerId); previous = { created, id: lowerId }
    return event
  })
  if (envelope.legacyImport !== null) {
    const legacy = validate(envelope.legacyImport)
    if (legacy.event_type !== "legacy_registration_imported" || !validLegacyImport(legacy.after_value)) invalid()
    const same = events.find(event => event.id.toLowerCase() === legacy.id.toLowerCase())
    if (same) { if (EVENT_KEYS.some(key => same[key] !== legacy[key])) invalid() }
    else events.push(legacy)
  }
  return events
}
