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

export type RegistrationRuntimeProbeClient = {
  rpc: (name: string) => PromiseLike<RegistrationRuntimeProbeResult>
  from: (table: string) => {
    select: (
      columns: string,
      options: { head: true; count: "exact" },
    ) => {
      limit: (count: number) => PromiseLike<RegistrationRuntimeProbeResult>
    }
  }
}

export type RegistrationRuntimeProbe = {
  probe: () => Promise<RegistrationRuntimeState>
  reset: () => void
  invalidateAfterReadyFailure: (cause: unknown) => never
}

const REGISTRATION_RUNTIME_VERSION_RPC = "registration_subject_tracks_runtime_version"
const REGISTRATION_TRACK_TABLE = "ops_registration_subject_tracks"

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
): Promise<RegistrationRuntimeState> {
  if (!client) {
    throw new Error("Registration runtime client is unavailable.")
  }

  const readiness = await client.rpc(REGISTRATION_RUNTIME_VERSION_RPC)
  if (!readiness.error) {
    return readiness.data === 1
      ? { mode: "ready", version: 1 }
      : { mode: "maintenance", version: 0 }
  }
  if (!isMissingReadinessFunction(readiness.error)) throw readiness.error

  const childProbe = await client
    .from(REGISTRATION_TRACK_TABLE)
    .select("id", { head: true, count: "exact" })
    .limit(0)
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
): RegistrationRuntimeProbe {
  let cachedState: RegistrationRuntimeState | null = null
  let inFlight: Promise<RegistrationRuntimeState> | null = null
  let generation = 0

  function reset() {
    generation += 1
    cachedState = null
    inFlight = null
  }

  function probe() {
    if (cachedState) return Promise.resolve(cachedState)
    if (inFlight) return inFlight

    const requestGeneration = generation
    const request = detectRegistrationRuntime(client)
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
