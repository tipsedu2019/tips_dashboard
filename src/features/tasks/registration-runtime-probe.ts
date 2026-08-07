import { supabase } from "@/lib/supabase"

// registration-runtime-probe-factory:start
export type RegistrationRuntimeState = {
  mode: "legacy" | "maintenance" | "ready"
  version: 0 | 1
}

type RegistrationRuntimeProbeResult = {
  data: unknown
  error: unknown
}

type RegistrationRuntimeProbeRequest = PromiseLike<RegistrationRuntimeProbeResult> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RegistrationRuntimeProbeResult>
}

export type RegistrationRuntimeProbeClient = {
  rpc: (name: string) => RegistrationRuntimeProbeRequest
  from: (table: string) => {
    select: (
      columns: string,
      options: { head: true; count: "exact" },
    ) => {
      limit: (count: number) => RegistrationRuntimeProbeRequest
    }
  }
}

export type RegistrationRuntimeProbeOptions = {
  timeoutMs?: number
}

export type RegistrationRuntimeProbe = {
  probe: () => Promise<RegistrationRuntimeState>
  reset: () => void
  invalidateAfterReadyFailure: (cause: unknown) => never
}

const REGISTRATION_RUNTIME_VERSION_RPC = "registration_subject_tracks_runtime_version"
const REGISTRATION_TRACK_TABLE = "ops_registration_subject_tracks"
const REGISTRATION_RUNTIME_PROBE_TIMEOUT_MS = 15_000

function registrationRequestTimeout(message: string) {
  const error = new Error(message) as Error & { code?: string }
  error.name = "RegistrationRequestTimeoutError"
  error.code = "REGISTRATION_REQUEST_TIMEOUT"
  return error
}

function withRegistrationRequestTimeout<T>(
  request: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      onTimeout?.()
      reject(registrationRequestTimeout(message))
    }, timeoutMs)
  })

  return Promise.race([request, timeout]).finally(() => {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle)
  })
}

function awaitRegistrationRuntimeRequest(
  request: RegistrationRuntimeProbeRequest,
  signal?: AbortSignal,
) {
  const abortableRequest = signal && typeof request.abortSignal === "function"
    ? request.abortSignal(signal)
    : request
  return Promise.resolve(abortableRequest)
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return ""
  return String(error.code || "").trim().toUpperCase()
}

function errorMessage(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) return ""
  return String(error.message || "").trim().toLowerCase()
}

function isMissingReadinessFunction(error: unknown) {
  const code = errorCode(error)
  if (code === "PGRST202" || code === "42883") return true

  const message = errorMessage(error)
  return message.includes("registration_subject_tracks_runtime_version")
    && message.includes("schema cache")
    && message.includes("could not find the function")
}

function isMissingTrackTable(error: unknown) {
  const code = errorCode(error)
  return code === "PGRST205" || code === "42P01"
}

async function detectRegistrationRuntime(
  client: RegistrationRuntimeProbeClient | null,
  signal?: AbortSignal,
): Promise<RegistrationRuntimeState> {
  if (!client) {
    throw new Error("Registration runtime client is unavailable.")
  }

  const readiness = await awaitRegistrationRuntimeRequest(
    client.rpc(REGISTRATION_RUNTIME_VERSION_RPC),
    signal,
  )
  if (!readiness.error) {
    return readiness.data === 1
      ? { mode: "ready", version: 1 }
      : { mode: "maintenance", version: 0 }
  }
  if (!isMissingReadinessFunction(readiness.error)) throw readiness.error

  const childProbe = await awaitRegistrationRuntimeRequest(
    client
      .from(REGISTRATION_TRACK_TABLE)
      .select("id", { head: true, count: "exact" })
      .limit(0),
    signal,
  )
  if (!childProbe.error) return { mode: "maintenance", version: 0 }
  if (isMissingTrackTable(childProbe.error)) return { mode: "legacy", version: 0 }
  throw childProbe.error
}

export class RegistrationRuntimeIntegrityError extends Error {
  readonly code = "REGISTRATION_RUNTIME_INTEGRITY_ERROR"
  readonly cause: unknown

  constructor(cause: unknown) {
    super("Registration runtime readiness does not match the deployed schema.")
    this.name = "RegistrationRuntimeIntegrityError"
    this.cause = cause
  }
}

export function createRegistrationRuntimeProbe(
  client: RegistrationRuntimeProbeClient | null,
  options: RegistrationRuntimeProbeOptions = {},
): RegistrationRuntimeProbe {
  let cachedState: RegistrationRuntimeState | null = null
  let inFlight: Promise<RegistrationRuntimeState> | null = null
  let generation = 0
  const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : REGISTRATION_RUNTIME_PROBE_TIMEOUT_MS

  function reset() {
    generation += 1
    cachedState = null
    inFlight = null
  }

  function probe() {
    if (cachedState) return Promise.resolve(cachedState)
    if (inFlight) return inFlight

    const requestGeneration = generation
    const controller = typeof AbortController === "function" ? new AbortController() : null
    const request = withRegistrationRequestTimeout(
      detectRegistrationRuntime(client, controller?.signal),
      timeoutMs,
      "registration_runtime_probe_timeout",
      () => controller?.abort(),
    )
      .then((state) => {
        if (requestGeneration === generation) cachedState = state
        return state
      })
      .finally(() => {
        if (inFlight === request) inFlight = null
      })
    inFlight = request
    return request
  }

  function invalidateAfterReadyFailure(cause: unknown): never {
    reset()
    throw new RegistrationRuntimeIntegrityError(cause)
  }

  return { probe, reset, invalidateAfterReadyFailure }
}
// registration-runtime-probe-factory:end

const defaultRegistrationRuntimeProbe = createRegistrationRuntimeProbe(
  supabase as unknown as RegistrationRuntimeProbeClient | null,
)

export function probeRegistrationSubjectTrackRuntime() {
  return defaultRegistrationRuntimeProbe.probe()
}

export function resetRegistrationSubjectTrackRuntimeProbe() {
  defaultRegistrationRuntimeProbe.reset()
}

export function invalidateRegistrationSubjectTrackRuntimeAfterReadyFailure(
  cause: unknown,
): never {
  return defaultRegistrationRuntimeProbe.invalidateAfterReadyFailure(cause)
}
