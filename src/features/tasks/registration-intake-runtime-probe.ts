import { supabase } from "@/lib/supabase"

// registration-intake-runtime-probe-factory:start
export type RegistrationIntakeRuntimeState = {
  available: boolean
  version: 0 | 1
}

type RegistrationIntakeRuntimeProbeResult = {
  data: unknown
  error: unknown
}

export type RegistrationIntakeRuntimeProbeClient = {
  rpc: (name: string) => PromiseLike<RegistrationIntakeRuntimeProbeResult>
}

export type RegistrationIntakeRuntimeProbe = {
  probe: () => Promise<RegistrationIntakeRuntimeState>
  reset: () => void
}

const REGISTRATION_INTAKE_RUNTIME_VERSION_RPC = "registration_intake_workflow_runtime_version"

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return ""
  return String(error.code || "").trim().toUpperCase()
}

function errorMessage(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) return ""
  return String(error.message || "").trim().toLowerCase()
}

function isMissingIntakeRuntimeFunction(error: unknown) {
  const code = errorCode(error)
  if (code === "PGRST202" || code === "42883") return true

  const message = errorMessage(error)
  return message.includes(REGISTRATION_INTAKE_RUNTIME_VERSION_RPC)
    && message.includes("schema cache")
    && message.includes("could not find the function")
}

async function detectRegistrationIntakeRuntime(
  client: RegistrationIntakeRuntimeProbeClient | null,
): Promise<RegistrationIntakeRuntimeState> {
  if (!client) {
    throw new Error("Registration intake runtime client is unavailable.")
  }

  const readiness = await client.rpc(REGISTRATION_INTAKE_RUNTIME_VERSION_RPC)
  if (!readiness.error) {
    return readiness.data === 1
      ? { available: true, version: 1 }
      : { available: false, version: 0 }
  }
  if (isMissingIntakeRuntimeFunction(readiness.error)) {
    return { available: false, version: 0 }
  }
  throw readiness.error
}

export function createRegistrationIntakeRuntimeProbe(
  client: RegistrationIntakeRuntimeProbeClient | null,
): RegistrationIntakeRuntimeProbe {
  let cachedState: RegistrationIntakeRuntimeState | null = null
  let inFlight: Promise<RegistrationIntakeRuntimeState> | null = null
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
    const request = detectRegistrationIntakeRuntime(client)
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

  return { probe, reset }
}
// registration-intake-runtime-probe-factory:end

const defaultRegistrationIntakeRuntimeProbe = createRegistrationIntakeRuntimeProbe(
  supabase as unknown as RegistrationIntakeRuntimeProbeClient | null,
)

export function probeRegistrationIntakeWorkflowRuntime() {
  return defaultRegistrationIntakeRuntimeProbe.probe()
}

export function resetRegistrationIntakeWorkflowRuntimeProbe() {
  defaultRegistrationIntakeRuntimeProbe.reset()
}
