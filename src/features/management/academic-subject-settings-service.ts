import { supabase } from "@/lib/supabase"
import { resetRegistrationSubjectCapabilityProbe } from "@/features/tasks/registration-subject-capability-probe"

// academic-subject-settings-service-factory:start
export type AcademicSubjectSetting = {
  subject: "영어" | "수학" | "과학"
  isActive: boolean
  registrationCreateEnabled: boolean
  gradeLevels: string[]
  defaultDirectorProfileId: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type AcademicSubjectSettingUpdate = {
  subject: AcademicSubjectSetting["subject"]
  isActive: boolean
  registrationCreateEnabled: boolean
  gradeLevels: string[]
  defaultDirectorProfileId: string | null
}

type AcademicSubjectSettingsRpcResult = {
  data: unknown
  error: unknown
}

export type AcademicSubjectSettingsClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<AcademicSubjectSettingsRpcResult>
}

export type AcademicSubjectSettingsService = {
  list: () => Promise<readonly AcademicSubjectSetting[]>
  update: (input: AcademicSubjectSettingUpdate) => Promise<AcademicSubjectSetting>
}

const ACADEMIC_SUBJECTS = ["영어", "수학", "과학"] as const
const ALL_GRADE_LEVELS = [
  "초1", "초2", "초3", "초4", "초5", "초6",
  "중1", "중2", "중3", "고1", "고2", "고3",
] as const
const SCIENCE_GRADE_LEVELS = ["고1", "고2", "고3"] as const
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class AcademicSubjectSettingsUnsafeResponseError extends Error {
  readonly code = "academic_subject_settings_unsafe_response"

  constructor() {
    super("Academic subject settings response failed validation.")
    this.name = "AcademicSubjectSettingsUnsafeResponseError"
  }
}

function unsafeResponse(): never {
  throw new AcademicSubjectSettingsUnsafeResponseError()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isSubject(value: unknown): value is AcademicSubjectSetting["subject"] {
  return typeof value === "string"
    && (ACADEMIC_SUBJECTS as readonly string[]).includes(value)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.trim() !== ""
    && !Number.isNaN(Date.parse(value))
}

function parseGradeLevels(subject: AcademicSubjectSetting["subject"], value: unknown) {
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

function parseSetting(value: unknown): AcademicSubjectSetting | null {
  if (!isRecord(value) || !isSubject(value.subject)) return null
  if (typeof value.is_active !== "boolean") return null
  if (typeof value.registration_create_enabled !== "boolean") return null
  if (!Number.isInteger(value.sort_order) || Number(value.sort_order) < 0) return null
  if (!isTimestamp(value.created_at) || !isTimestamp(value.updated_at)) return null
  if (
    value.default_director_profile_id !== null
    && (
      typeof value.default_director_profile_id !== "string"
      || !UUID_PATTERN.test(value.default_director_profile_id)
    )
  ) return null

  const gradeLevels = parseGradeLevels(value.subject, value.grade_levels)
  if (!gradeLevels) return null

  return {
    subject: value.subject,
    isActive: value.is_active,
    registrationCreateEnabled: value.registration_create_enabled,
    gradeLevels,
    defaultDirectorProfileId: value.default_director_profile_id,
    sortOrder: Number(value.sort_order),
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  }
}

function parseSettings(value: unknown): AcademicSubjectSetting[] {
  if (!Array.isArray(value) || value.length !== ACADEMIC_SUBJECTS.length) {
    return unsafeResponse()
  }

  const parsed = value.map(parseSetting)
  if (parsed.some((setting) => setting === null)) return unsafeResponse()

  const settings = parsed as AcademicSubjectSetting[]
  const uniqueSubjects = new Set(settings.map((setting) => setting.subject))
  if (uniqueSubjects.size !== ACADEMIC_SUBJECTS.length) return unsafeResponse()
  if (!ACADEMIC_SUBJECTS.every((subject) => uniqueSubjects.has(subject))) {
    return unsafeResponse()
  }

  return settings.sort((left, right) => left.sortOrder - right.sortOrder)
}

function parseUpdatedSetting(
  value: unknown,
  expectedSubject: AcademicSubjectSetting["subject"],
) {
  if (!Array.isArray(value) || value.length !== 1) return unsafeResponse()
  const setting = parseSetting(value[0])
  if (!setting || setting.subject !== expectedSubject) return unsafeResponse()
  return setting
}

export function createAcademicSubjectSettingsService(
  client: AcademicSubjectSettingsClient | null,
  resetCapabilityProbe: () => void = () => undefined,
): AcademicSubjectSettingsService {
  function assertClient(): AcademicSubjectSettingsClient {
    if (!client) throw new Error("Academic subject settings client is unavailable.")
    return client
  }

  async function list() {
    const response = await assertClient().rpc(
      "list_registration_subject_capabilities_v1",
    )
    if (response.error) throw response.error
    return parseSettings(response.data)
  }

  async function update(input: AcademicSubjectSettingUpdate) {
    const response = await assertClient().rpc(
      "update_academic_subject_setting_v1",
      {
        p_subject: input.subject,
        p_is_active: input.isActive,
        p_registration_create_enabled: input.registrationCreateEnabled,
        p_grade_levels: [...input.gradeLevels],
        p_default_director_profile_id: input.defaultDirectorProfileId,
      },
    )
    if (response.error) throw response.error

    resetCapabilityProbe()
    const setting = parseUpdatedSetting(response.data, input.subject)
    return setting
  }

  return { list, update }
}
// academic-subject-settings-service-factory:end

export const academicSubjectSettingsService = createAcademicSubjectSettingsService(
  supabase as unknown as AcademicSubjectSettingsClient | null,
  resetRegistrationSubjectCapabilityProbe,
)
