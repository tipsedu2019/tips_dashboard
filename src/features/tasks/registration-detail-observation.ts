const DETAIL_KINDS = [
  "detail", "runtime", "parent", "appointments_current", "appointments_history",
  "events", "admission_message", "reminder_request", "reminder_decode",
  "batches_current", "batches_history", "tracks", "enrollments_current",
  "enrollments_history", "dependent_rows", "initial_decode", "detail_decode",
] as const
const DETAIL_PHASES = [
  "start", "success", "failure", "child_deadline_elapsed",
  "detail_deadline_elapsed", "detail_cancel_observed", "truncated",
] as const

export type RegistrationDetailKind = typeof DETAIL_KINDS[number]
export type RegistrationDetailPhase = typeof DETAIL_PHASES[number]
export type RegistrationDetailObservation = {
  kind: RegistrationDetailKind
  phase: RegistrationDetailPhase
  elapsedMs: number
}
export type RegistrationDetailObservationOptions = {
  now: () => number
  emit: (rows: RegistrationDetailObservation[]) => void
}

// This boundary accepts only constants and locally owned signals. Never pass
// errors, results, URLs or identifiers into the observer, even for classification.
export function createRegistrationDetailObservation(options: RegistrationDetailObservationOptions) {
  let startedAt: number
  try {
    startedAt = options.now()
    if (!Number.isFinite(startedAt)) return undefined
  } catch {
    return undefined
  }
  const rows: RegistrationDetailObservation[] = []
  const listeners = new Map<RegistrationDetailKind, Set<() => void>>()
  let closed = false
  let truncated = false
  let lastElapsedMs = 0

  function record(kind: RegistrationDetailKind, phase: RegistrationDetailPhase, terminal = false) {
    if (closed || !DETAIL_KINDS.includes(kind) || !DETAIL_PHASES.includes(phase)) return
    try {
      const elapsed = options.now() - startedAt
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > Number.MAX_SAFE_INTEGER) return
      lastElapsedMs = Math.max(lastElapsedMs, Math.floor(elapsed))
      // Reserve a truncation marker and the final result within the 64-row cap.
      if (!terminal && rows.length >= 62) {
        if (!truncated) {
          rows.push({ kind: "detail", phase: "truncated", elapsedMs: lastElapsedMs })
          truncated = true
        }
        return
      }
      rows.push({ kind, phase, elapsedMs: lastElapsedMs })
    } catch {
      // Observation must never replace a business result or exception.
    }
  }

  function cleanup(kind: RegistrationDetailKind) {
    const pending = listeners.get(kind)
    if (!pending) return
    listeners.delete(kind)
    for (const remove of pending) remove()
  }

  function watch(kind: RegistrationDetailKind, signal: AbortSignal, phase: RegistrationDetailPhase) {
    if (closed || !DETAIL_KINDS.includes(kind) || !DETAIL_PHASES.includes(phase)) return
    try {
      const pending = listeners.get(kind) || new Set<() => void>()
      listeners.set(kind, pending)
      const remove = () => {
        try { signal.removeEventListener("abort", onAbort) } catch { /* observation only */ }
        pending.delete(remove)
      }
      const onAbort = () => {
        record(kind, phase)
        remove()
      }
      pending.add(remove)
      signal.addEventListener("abort", onAbort, { once: true })
      if (signal.aborted) onAbort()
    } catch {
      // A missing observation is not evidence of success or absence of timeout.
    }
  }

  return {
    record(kind: RegistrationDetailKind, phase: RegistrationDetailPhase) { record(kind, phase) },
    begin(kind: RegistrationDetailKind, detailSignal?: AbortSignal) {
      record(kind, "start")
      if (detailSignal) watch(kind, detailSignal, "detail_cancel_observed")
    },
    end(kind: RegistrationDetailKind, ok: boolean) {
      record(kind, ok ? "success" : "failure")
      cleanup(kind)
    },
    watchDeadline(kind: RegistrationDetailKind, signal: AbortSignal) {
      watch(kind, signal, "child_deadline_elapsed")
    },
    finish(ok: boolean) {
      if (closed) return
      record("detail", ok ? "success" : "failure", true)
      closed = true
      for (const kind of listeners.keys()) cleanup(kind)
      if (!ok && rows.length > 0) {
        try {
          options.emit(rows.map(({ kind, phase, elapsedMs }) => ({ kind, phase, elapsedMs })))
        } catch { /* observation only */ }
      }
      rows.length = 0
    },
  }
}

export type RegistrationDetailObserver = NonNullable<ReturnType<typeof createRegistrationDetailObservation>>
