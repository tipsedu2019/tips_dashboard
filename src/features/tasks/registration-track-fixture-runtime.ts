import type { OpsRegistrationClassDetail, OpsTaskWorkspaceData } from "./ops-task-service"
import type {
  RegistrationAppointmentCalendarLoadInput,
  RegistrationAppointmentCalendarRow,
} from "./registration-appointment-calendar-model"
import type { OpsRegistrationCaseDetail, OpsRegistrationWorkspaceOptionData } from "./registration-track-service"

export const REGISTRATION_SUBJECT_TRACK_FIXTURE_QUERY_VALUE = "registration-subject-tracks"
export const REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG_GLOBAL = "__TIPS_REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG__"

export type RegistrationSubjectTrackFixtureDebugCounts = {
  tasks: number
  cases: number
  tracks: number
  appointments: number
  consultations: number
  levelTests: number
  receipts: number
  notificationReceipts: number
  externalCalls: number
}

export type RegistrationSubjectTrackFixtureDebugSnapshot = {
  counts: RegistrationSubjectTrackFixtureDebugCounts
  lastCreate: {
    command: {
      type: "createRegistrationCaseWithInitialWorkflow"
      requestKey: string
      payload: Record<string, unknown>
    }
    result: unknown
    receipt: unknown
    detail: unknown
  } | null
}

export type RegistrationSubjectTrackFixtureDebugReplay = {
  requestKey: string
  originalResult: unknown
  replayResult: unknown
  originalReceipt: unknown
  replayReceipt: unknown
  beforeCounts: RegistrationSubjectTrackFixtureDebugCounts
  afterCounts: RegistrationSubjectTrackFixtureDebugCounts
}

export type RegistrationSubjectTrackFixtureAdapter = {
  readonly intakeWorkflowRuntimeVersion: number
  executeAction: <T = unknown>(type: string, payload: Record<string, unknown>) => Promise<T>
  loadAppointmentCalendarRows: (
    input: RegistrationAppointmentCalendarLoadInput,
  ) => Promise<RegistrationAppointmentCalendarRow[]>
  loadCase: (taskId: string) => Promise<OpsRegistrationCaseDetail>
  loadWorkspaceData: () => Promise<OpsTaskWorkspaceData>
  loadOptionData: () => Promise<OpsRegistrationWorkspaceOptionData>
  loadClassDetails: (classIds: string[]) => Promise<Record<string, OpsRegistrationClassDetail>>
  debugSnapshot?: () => RegistrationSubjectTrackFixtureDebugSnapshot
  debugReplayLastCreate?: () => Promise<RegistrationSubjectTrackFixtureDebugReplay>
}

const activeFixtureAdapters: RegistrationSubjectTrackFixtureAdapter[] = []
let previousDebugGlobalDescriptor: PropertyDescriptor | undefined
let debugBridgeInstalled = false

function getActiveFixtureAdapter() {
  return activeFixtureAdapters[activeFixtureAdapters.length - 1] || null
}

const fixtureDebugBridge = {
  snapshot() {
    const adapter = getActiveFixtureAdapter()
    if (!adapter?.debugSnapshot) throw new Error("registration_subject_track_fixture_debug_unavailable")
    return adapter.debugSnapshot()
  },
  replayLastCreate() {
    const adapter = getActiveFixtureAdapter()
    if (!adapter?.debugReplayLastCreate) throw new Error("registration_subject_track_fixture_debug_unavailable")
    return adapter.debugReplayLastCreate()
  },
}

function installFixtureDebugBridge() {
  if (debugBridgeInstalled) return
  previousDebugGlobalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG_GLOBAL,
  )
  Object.defineProperty(globalThis, REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG_GLOBAL, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: fixtureDebugBridge,
  })
  debugBridgeInstalled = true
}

function uninstallFixtureDebugBridge() {
  if (!debugBridgeInstalled || activeFixtureAdapters.length > 0) return
  if (previousDebugGlobalDescriptor) {
    Object.defineProperty(
      globalThis,
      REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG_GLOBAL,
      previousDebugGlobalDescriptor,
    )
  } else {
    Reflect.deleteProperty(globalThis, REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG_GLOBAL)
  }
  previousDebugGlobalDescriptor = undefined
  debugBridgeInstalled = false
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
  installFixtureDebugBridge()
  return () => {
    const index = activeFixtureAdapters.lastIndexOf(adapter)
    if (index >= 0) activeFixtureAdapters.splice(index, 1)
    uninstallFixtureDebugBridge()
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

export function loadRegistrationSubjectTrackFixtureAppointmentCalendarRows(
  input: RegistrationAppointmentCalendarLoadInput,
): Promise<RegistrationAppointmentCalendarRow[]> | null {
  return getActiveFixtureAdapter()?.loadAppointmentCalendarRows(input) || null
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
