import { supabase } from "@/lib/supabase"

// registration-subject-capability-probe-factory:start
export type RegistrationSubjectCapability = {
  subject: "영어" | "수학" | "과학"
  isActive: boolean
  registrationCreateEnabled: boolean
  gradeLevels: readonly string[]
  sortOrder: number
  defaultDirectorProfileId: string | null
}

type RegistrationSubjectCapabilityProbeResult = {
  data: unknown
  error: unknown
}

export type RegistrationSubjectCapabilityProbeClient = {
  rpc: (name: string) => PromiseLike<RegistrationSubjectCapabilityProbeResult>
}

export type RegistrationSubjectCapabilityProbe = {
  probe: () => Promise<readonly RegistrationSubjectCapability[]>
  reset: () => void
}

const REGISTRATION_SUBJECT_CAPABILITY_RPC =
  "list_registration_subject_capabilities_v1"
const REGISTRATION_SUBJECTS = ["영어", "수학", "과학"] as const
const ALL_GRADE_LEVELS = [
  "초1", "초2", "초3", "초4", "초5", "초6",
  "중1", "중2", "중3", "고1", "고2", "고3",
] as const
const SCIENCE_GRADE_LEVELS = ["고1", "고2", "고3"] as const

function freezeCapabilities(
  capabilities: readonly RegistrationSubjectCapability[],
): readonly RegistrationSubjectCapability[] {
  return Object.freeze(capabilities.map((capability) => Object.freeze({
    ...capability,
    gradeLevels: Object.freeze([...capability.gradeLevels]),
  })))
}

const COMPATIBILITY_CAPABILITIES = freezeCapabilities([
  {
    subject: "영어",
    isActive: true,
    registrationCreateEnabled: true,
    gradeLevels: [...ALL_GRADE_LEVELS],
    sortOrder: 10,
    defaultDirectorProfileId: null,
  },
  {
    subject: "수학",
    isActive: true,
    registrationCreateEnabled: true,
    gradeLevels: [...ALL_GRADE_LEVELS],
    sortOrder: 20,
    defaultDirectorProfileId: null,
  },
  {
    subject: "과학",
    isActive: false,
    registrationCreateEnabled: false,
    gradeLevels: [...SCIENCE_GRADE_LEVELS],
    sortOrder: 30,
    defaultDirectorProfileId: null,
  },
])

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return ""
  return String(error.code || "").trim().toUpperCase()
}

function errorDescription(error: unknown) {
  if (!error || typeof error !== "object") return ""
  return ["message", "details", "hint"]
    .map((key) => (
      key in error ? String((error as Record<string, unknown>)[key] || "") : ""
    ))
    .join(" ")
    .trim()
    .toLowerCase()
}

function isMissingCapabilityFunction(error: unknown) {
  const code = errorCode(error)
  const description = errorDescription(error)
  const identifiesCapabilityRpc = description.includes(
    REGISTRATION_SUBJECT_CAPABILITY_RPC,
  )
  if ((code === "PGRST202" || code === "42883") && identifiesCapabilityRpc) {
    return true
  }

  return code === ""
    && identifiesCapabilityRpc
    && description.includes("could not find the function")
    && description.includes("schema cache")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isSubject(value: unknown): value is RegistrationSubjectCapability["subject"] {
  return typeof value === "string"
    && (REGISTRATION_SUBJECTS as readonly string[]).includes(value)
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseDefaultDirectorProfileId(value: unknown) {
  if (value === null) return null
  if (typeof value !== "string") return undefined
  const profileId = value.trim()
  return UUID_PATTERN.test(profileId) ? profileId : undefined
}

function parseGradeLevels(subject: RegistrationSubjectCapability["subject"], value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return null
  if (!value.every((grade) => typeof grade === "string")) return null
  const gradeLevels = value as string[]
  if (new Set(gradeLevels).size !== gradeLevels.length) return null

  const allowedGrades = subject === "과학"
    ? SCIENCE_GRADE_LEVELS
    : ALL_GRADE_LEVELS
  if (!gradeLevels.every((grade) => (
    (allowedGrades as readonly string[]).includes(grade)
  ))) return null

  return [...gradeLevels]
}

function parseCapability(value: unknown): RegistrationSubjectCapability | null {
  if (!isRecord(value) || !isSubject(value.subject)) return null
  if (typeof value.is_active !== "boolean") return null
  if (typeof value.registration_create_enabled !== "boolean") return null
  if (!Number.isInteger(value.sort_order) || Number(value.sort_order) < 0) return null

  const gradeLevels = parseGradeLevels(value.subject, value.grade_levels)
  if (!gradeLevels) return null
  const defaultDirectorProfileId = parseDefaultDirectorProfileId(
    value.default_director_profile_id,
  )
  if (defaultDirectorProfileId === undefined) return null

  return {
    subject: value.subject,
    isActive: value.is_active,
    registrationCreateEnabled: value.registration_create_enabled,
    gradeLevels,
    sortOrder: Number(value.sort_order),
    defaultDirectorProfileId,
  }
}

function parseCapabilities(value: unknown) {
  if (!Array.isArray(value) || value.length !== REGISTRATION_SUBJECTS.length) {
    return null
  }

  const parsed = value.map(parseCapability)
  if (parsed.some((row) => row === null)) return null

  const capabilities = parsed as RegistrationSubjectCapability[]
  const uniqueSubjects = new Set(capabilities.map((row) => row.subject))
  if (uniqueSubjects.size !== REGISTRATION_SUBJECTS.length) return null
  if (!REGISTRATION_SUBJECTS.every((subject) => uniqueSubjects.has(subject))) return null

  return freezeCapabilities(
    capabilities.sort((left, right) => left.sortOrder - right.sortOrder),
  )
}

async function readRegistrationSubjectCapabilities(
  client: RegistrationSubjectCapabilityProbeClient | null,
): Promise<readonly RegistrationSubjectCapability[]> {
  if (!client) {
    throw new Error("Registration subject capability client is unavailable.")
  }

  const response = await client.rpc(REGISTRATION_SUBJECT_CAPABILITY_RPC)
  if (response.error) {
    if (isMissingCapabilityFunction(response.error)) {
      return COMPATIBILITY_CAPABILITIES
    }
    throw response.error
  }

  return parseCapabilities(response.data) ?? COMPATIBILITY_CAPABILITIES
}

export function createRegistrationSubjectCapabilityProbe(
  client: RegistrationSubjectCapabilityProbeClient | null,
): RegistrationSubjectCapabilityProbe {
  let cachedCapabilities: readonly RegistrationSubjectCapability[] | null = null
  let inFlight: Promise<readonly RegistrationSubjectCapability[]> | null = null
  let generation = 0

  function reset() {
    generation += 1
    cachedCapabilities = null
    inFlight = null
  }

  function probe() {
    if (cachedCapabilities) return Promise.resolve(cachedCapabilities)
    if (inFlight) return inFlight

    const requestGeneration = generation
    const request = readRegistrationSubjectCapabilities(client)
      .then((capabilities) => {
        if (requestGeneration === generation) cachedCapabilities = capabilities
        return capabilities
      })
      .finally(() => {
        if (inFlight === request) inFlight = null
      })
    inFlight = request
    return request
  }

  return { probe, reset }
}
// registration-subject-capability-probe-factory:end

export function getRegistrationSubjectCompatibilityCapabilities() {
  return COMPATIBILITY_CAPABILITIES
}

const defaultRegistrationSubjectCapabilityProbe =
  createRegistrationSubjectCapabilityProbe(
    supabase as unknown as RegistrationSubjectCapabilityProbeClient | null,
  )

export function probeRegistrationSubjectCapabilities() {
  return defaultRegistrationSubjectCapabilityProbe.probe()
}

export function resetRegistrationSubjectCapabilityProbe() {
  defaultRegistrationSubjectCapabilityProbe.reset()
}
