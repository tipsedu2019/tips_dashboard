import type { OpsRegistrationClassDetail, OpsTaskWorkspaceData } from "./ops-task-service"
import type { OpsRegistrationCaseDetail, OpsRegistrationWorkspaceOptionData } from "./registration-track-service"

export const REGISTRATION_SUBJECT_TRACK_FIXTURE_QUERY_VALUE = "registration-subject-tracks"

export type RegistrationSubjectTrackFixtureAdapter = {
  readonly intakeWorkflowRuntimeVersion: number
  executeAction: <T = unknown>(type: string, payload: Record<string, unknown>) => Promise<T>
  loadCase: (taskId: string) => Promise<OpsRegistrationCaseDetail>
  loadWorkspaceData: () => Promise<OpsTaskWorkspaceData>
  loadOptionData: () => Promise<OpsRegistrationWorkspaceOptionData>
  loadClassDetails: (classIds: string[]) => Promise<Record<string, OpsRegistrationClassDetail>>
}

const activeFixtureAdapters: RegistrationSubjectTrackFixtureAdapter[] = []

function getActiveFixtureAdapter() {
  return activeFixtureAdapters[activeFixtureAdapters.length - 1] || null
}

export function shouldEnableRegistrationSubjectTrackFixture(
  nodeEnv: string | undefined,
  fixtureValue: string | null | undefined,
) {
  return (nodeEnv === "development" || nodeEnv === "test")
    && fixtureValue === REGISTRATION_SUBJECT_TRACK_FIXTURE_QUERY_VALUE
}

export function installRegistrationSubjectTrackFixtureRuntime(
  nodeEnv: string | undefined,
  fixtureValue: string | null | undefined,
  adapter: RegistrationSubjectTrackFixtureAdapter,
) {
  if (!shouldEnableRegistrationSubjectTrackFixture(nodeEnv, fixtureValue)) return () => undefined
  activeFixtureAdapters.push(adapter)
  return () => {
    const index = activeFixtureAdapters.lastIndexOf(adapter)
    if (index >= 0) activeFixtureAdapters.splice(index, 1)
  }
}

export function executeRegistrationSubjectTrackFixtureAction<T = unknown>(
  type: string,
  payload: Record<string, unknown> = {},
): Promise<T> | null {
  return getActiveFixtureAdapter()?.executeAction<T>(type, payload) || null
}

export function loadRegistrationSubjectTrackFixtureIntakeRuntimeVersion(): number | null {
  return getActiveFixtureAdapter()?.intakeWorkflowRuntimeVersion ?? null
}

export function loadRegistrationSubjectTrackFixtureCase(taskId: string): Promise<OpsRegistrationCaseDetail> | null {
  return getActiveFixtureAdapter()?.loadCase(taskId) || null
}

export function loadRegistrationSubjectTrackFixtureWorkspaceData(): Promise<OpsTaskWorkspaceData> | null {
  return getActiveFixtureAdapter()?.loadWorkspaceData() || null
}

export function loadRegistrationSubjectTrackFixtureOptionData(): Promise<OpsRegistrationWorkspaceOptionData> | null {
  return getActiveFixtureAdapter()?.loadOptionData() || null
}

export function loadRegistrationSubjectTrackFixtureClassDetails(
  classIds: string[],
): Promise<Record<string, OpsRegistrationClassDetail>> | null {
  return getActiveFixtureAdapter()?.loadClassDetails(classIds) || null
}
