import {
  normalizeRegistrationObservationRuntimeState,
  type RegistrationObservationRuntimeState,
} from "./registration-observation-model.ts"

export type RegistrationObservationRpcResult = Readonly<{
  data: unknown
  error: unknown
}>

export type RegistrationObservationRpcRequest = PromiseLike<RegistrationObservationRpcResult> & {
  abortSignal: (signal: AbortSignal) => RegistrationObservationRpcRequest
  retry: (enabled: boolean) => RegistrationObservationRpcRequest
}

export type RegistrationObservationRuntimeProbeClient = {
  rpc: (name: string) => RegistrationObservationRpcRequest
}

const REGISTRATION_OBSERVATION_RUNTIME_VERSION_RPC = "registration_observation_runtime_version"
const REGISTRATION_OBSERVATION_REQUEST_TIMEOUT_MS = 12_000

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return ""
  return String(error.code || "").trim().toUpperCase()
}

function errorMessage(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) return ""
  return String(error.message || "").trim().toLowerCase()
}

export function isRegistrationObservationFunctionMissing(
  error: unknown,
  functionName: string,
) {
  const code = errorCode(error)
  if (code !== "PGRST202" && code !== "42883") return false
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^a-z0-9_])${escapedName}(?=$|[^a-z0-9_])`, "i")
    .test(errorMessage(error))
}

function executeProbeRequest(request: RegistrationObservationRpcRequest) {
  return request
    .abortSignal(AbortSignal.timeout(REGISTRATION_OBSERVATION_REQUEST_TIMEOUT_MS))
    .retry(false)
}

export async function probeRegistrationObservationRuntime(
  client: RegistrationObservationRuntimeProbeClient,
): Promise<RegistrationObservationRuntimeState> {
  const { data, error } = await executeProbeRequest(
    client.rpc(REGISTRATION_OBSERVATION_RUNTIME_VERSION_RPC),
  )
  if (error) {
    if (isRegistrationObservationFunctionMissing(error, REGISTRATION_OBSERVATION_RUNTIME_VERSION_RPC)) {
      return { runtimeVersion: 0, available: false }
    }
    throw error
  }
  return normalizeRegistrationObservationRuntimeState(data)
}
