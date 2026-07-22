import type { OpsClassOption, OpsRegistrationClassDetail, OpsTaskWorkspaceData } from "./ops-task-service"
import type {
  RegistrationAppointmentCalendarLoadInput,
  RegistrationAppointmentCalendarRow,
} from "./registration-appointment-calendar-model"
import type { OpsRegistrationCaseDetail, OpsRegistrationWorkspaceOptionData } from "./registration-track-service"
import type { RegistrationSubjectCapability } from "./registration-subject-capability-probe"

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
  stateDigest: string
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

export type RegistrationSubjectTrackFixtureDebugActionBehavior = {
  type: string
  delayMs?: number
  error?: string
}

export type RegistrationSubjectTrackFixtureDebugFault =
  | { kind: "option_data_once"; error: string }
  | {
      kind: "common_revision_conflict_once"
      taskId: string
      canonicalRequestNote: string
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
  loadSubjectCapabilities: () => Promise<readonly RegistrationSubjectCapability[]>
  loadScienceConsultationClassOptions: () => Promise<OpsClassOption[]>
  loadClassDetails: (classIds: string[]) => Promise<Record<string, OpsRegistrationClassDetail>>
  debugSnapshot?: () => RegistrationSubjectTrackFixtureDebugSnapshot
  debugReplayLastCreate?: () => Promise<RegistrationSubjectTrackFixtureDebugReplay>
  debugSetNextActionBehavior?: (behavior: RegistrationSubjectTrackFixtureDebugActionBehavior) => void
  debugSetNextFault?: (
    fault: RegistrationSubjectTrackFixtureDebugFault,
  ) => void
}

const activeFixtureAdapters: RegistrationSubjectTrackFixtureAdapter[] = []
let previousDebugGlobalDescriptor: PropertyDescriptor | undefined
let debugBridgeInstalled = false

function getActiveFixtureAdapter() {
  return activeFixtureAdapters[activeFixtureAdapters.length - 1] || null
}

function isRegistrationSubjectTrackFixtureUrlActive() {
  if (typeof window === "undefined") return false
  return shouldEnableRegistrationSubjectTrackFixture(
    typeof process === "undefined" ? undefined : process.env.NODE_ENV,
    new URLSearchParams(window.location.search).get("fixture"),
  )
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
  setNextActionBehavior(behavior: RegistrationSubjectTrackFixtureDebugActionBehavior) {
    const adapter = getActiveFixtureAdapter()
    if (!adapter?.debugSetNextActionBehavior) throw new Error("registration_subject_track_fixture_debug_unavailable")
    adapter.debugSetNextActionBehavior(behavior)
  },
  setNextFault(fault: RegistrationSubjectTrackFixtureDebugFault) {
    const adapter = getActiveFixtureAdapter()
    if (!adapter?.debugSetNextFault) throw new Error("registration_subject_track_fixture_debug_unavailable")
    adapter.debugSetNextFault(fault)
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
  if (typeof window !== "undefined" && !isRegistrationSubjectTrackFixtureUrlActive()) return null
  const adapter = getActiveFixtureAdapter()
  if (adapter) return adapter.executeAction<T>(type, payload)
  if (isRegistrationSubjectTrackFixtureUrlActive()) {
    return Promise.reject(new Error("registration_subject_track_fixture_runtime_not_ready"))
  }
  return null
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

export function loadRegistrationSubjectTrackFixtureCapabilities(): Promise<readonly RegistrationSubjectCapability[]> | null {
  return getActiveFixtureAdapter()?.loadSubjectCapabilities() || null
}

export function loadRegistrationSubjectTrackFixtureScienceConsultationClassOptions(): Promise<OpsClassOption[]> | null {
  return getActiveFixtureAdapter()?.loadScienceConsultationClassOptions() || null
}

export function loadRegistrationSubjectTrackFixtureClassDetails(
  classIds: string[],
): Promise<Record<string, OpsRegistrationClassDetail>> | null {
  return getActiveFixtureAdapter()?.loadClassDetails(classIds) || null
}
