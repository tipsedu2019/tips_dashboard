import { isEffectiveMakeupSchedule, type MakeupEffectiveSchedule } from "./makeup-request-model.js"

type Slot = { startAt?: string; endAt?: string }
type Envelope = { startAt: string; endAt: string }
const DAY = 86_400_000
const SEOUL = 9 * 3_600_000

// This limits one read, never the total lesson count or dates of a request.
export function* makeupEffectiveBatches(slots: Slot[]): Generator<Envelope[]> {
  const intervals = slots.map(slot => {
    const start = Date.parse(slot.startAt ?? ""), end = Date.parse(slot.endAt ?? "")
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end
      || new Date(start).toISOString().length !== 24 || new Date(end).toISOString().length !== 24) throw new Error("makeup_effective_window_invalid")
    return { start, end }
  }).sort((a, b) => a.start - b.start)
  const dayOf = (instant: number) => Math.floor((instant + SEOUL) / DAY) * DAY - SEOUL
  let remaining = intervals, firstDay = remaining.length ? dayOf(remaining[0].start) : 0
  while (remaining.length) {
    const lastEnd = firstDay + 14 * DAY, days = new Map<number, { start: number; end: number }>()
    for (const { start, end } of remaining) {
      if (start >= lastEnd) break
      // A long historical interval is split lazily, with at most fourteen
      // envelopes materialized before the next cancellable network read.
      for (let day = Math.max(dayOf(start), firstDay); day < Math.min(end, lastEnd); day += DAY) {
        const a = Math.max(start, day), b = Math.min(end, day + DAY), previous = days.get(day)
        days.set(day, { start: Math.min(a, previous?.start ?? a), end: Math.max(b, previous?.end ?? b) })
      }
    }
    yield [...days].sort(([a], [b]) => a - b).map(([, { start, end }]) => ({ startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() }))
    remaining = remaining.filter(({ end }) => end > lastEnd)
    if (remaining.length) firstDay = Math.max(lastEnd, dayOf(remaining[0].start))
  }
}

export async function readMakeupEffectiveSchedule({ slots, signal, readBatch }: {
  slots: Slot[]
  signal: AbortSignal
  readBatch: (slots: Envelope[]) => PromiseLike<{ data: unknown; error: unknown }>
}): Promise<MakeupEffectiveSchedule> {
  const occupancies: MakeupEffectiveSchedule["occupancies"] = [], seen = new Set<string>()
  for (const batch of makeupEffectiveBatches(slots)) {
    signal.throwIfAborted()
    const { data, error } = await readBatch(batch)
    signal.throwIfAborted()
    if (error) throw error
    if (!isEffectiveMakeupSchedule(data) || data.occupancies.length > 2000) throw new Error("makeup_effective_response_invalid")
    const dates = new Set(batch.map(slot => new Date(Date.parse(slot.startAt) + SEOUL).toISOString().slice(0, 10)))
    for (const row of data.occupancies) {
      if (!dates.has(String(row.date))) throw new Error("makeup_effective_response_invalid")
      // Weekly identities recur on different dates. Preserve both occurrences,
      // and preserve conflicting variants instead of overwriting uncertainty.
      const key = JSON.stringify(Object.keys(row).sort().map(field => [field, row[field]]))
      if (!seen.has(key)) { seen.add(key); occupancies.push(row) }
    }
  }
  signal.throwIfAborted()
  return { version: 1, occupancies }
}
