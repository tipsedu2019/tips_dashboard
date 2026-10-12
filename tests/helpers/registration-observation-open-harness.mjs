import { readFile } from "node:fs/promises"
import vm from "node:vm"
import ts from "typescript"
import { createRegistrationObservationAsyncOwnership } from "../../src/features/tasks/registration-workspace-route.ts"

export function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function compile(source) {
  return ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
}

// Execute the actual open callback and shared lazy loader. Only their I/O and
// React state setters are replaced; no business/query sequence is reimplemented.
export async function createObservationOpenHarness({
  workspaceSource,
  loadDetail,
  loadAttempt,
  importEditor,
  runtimeVersion = 1,
  taskType = "registration",
  canManage = true,
  onHost = () => {},
} = {}) {
  const source = workspaceSource ?? await readFile(new URL("../../src/features/tasks/ops-task-workspace.tsx", import.meta.url), "utf8")
  const lazySource = await readFile(new URL("../../src/features/tasks/registration-application-lazy.tsx", import.meta.url), "utf8")
  const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "openRegistrationObservation") callback = node.initializer.arguments[0].getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (!callback) throw new Error("actual observation open callback missing")
  const target = { taskId: "synthetic-task", trackId: "synthetic-track", appointmentId: "synthetic-appointment", observationId: "synthetic-observation" }
  const detail = { task: { id: target.taskId }, tracks: [{ id: target.trackId }] }
  const attempt = { observationId: target.observationId }
  const state = {}
  const calls = { detail: 0, attempt: 0, import: 0, preload: 0, options: 0 }
  const ownership = createRegistrationObservationAsyncOwnership()
  const refs = {
    registrationTrackSelectionRef: { current: "" },
    latestWorkspaceViewerIdRef: { current: "synthetic-viewer" },
    registrationObservationRuntimeVersionRef: { current: runtimeVersion },
    registrationObservationDeepLinkTargetRef: { current: null },
    registrationCommittedReceiptRef: { current: null },
    workspaceDataViewerIdRef: { current: "" },
  }
  let renderEditor
  const lazyModule = { exports: {} }
  vm.runInNewContext(compile(lazySource), {
    module: lazyModule, exports: lazyModule.exports,
    require(id) {
      if (id === "next/dynamic") return { default(loader) { renderEditor = loader; return function Lazy() {} } }
      if (id === "./registration-track-editor") {
        calls.import++
        return importEditor?.() ?? { RegistrationApplication: function SyntheticEditor() {} }
      }
      if (id === "react/jsx-runtime") return {}
      throw new Error(`unexpected lazy import: ${id}`)
    },
  })
  const setters = Object.fromEntries([
    "RegistrationMode", "FormOpen", "DetailOpen", "RegistrationApplicationDirty",
    "RegistrationDeepLinkedAttempt", "SelectedTask", "SelectedRegistrationTrackId",
    "SelectedRegistrationAppointmentId", "RegistrationCaseDetail", "RegistrationDetailLoadError",
    "Message", "Notice",
  ].map(name => [`set${name}`, value => { state[name] = value }]))
  const open = vm.runInNewContext(`${compile(`const open = ${callback}`)}\nopen`, {
    ...refs, ...setters,
    currentUserId: "synthetic-viewer",
    registrationObservationRuntime: { runtimeVersion },
    registrationObservationLoadOwnershipRef: { current: ownership },
    taskById: new Map(taskType ? [[target.taskId, { id: target.taskId, type: taskType }]] : []),
    canManageRegistrationWorkflow: canManage,
    registrationObservationClient: {},
    preloadRegistrationApplication() { calls.preload++; return lazyModule.exports.preloadRegistrationApplication() },
    async loadRegistrationCaseForWorkspace(id) { calls.detail++; return loadDetail ? loadDetail(id) : detail },
    loadRegistrationObservationDeepLinkedAttempt(target, load) { return load(target) },
    async loadRegistrationObservationManagerAttempt(_client, target) { calls.attempt++; return loadAttempt ? loadAttempt(target) : attempt },
    async ensureRegistrationOptions() { calls.options++ },
    syncTaskDeepLink(value) { state.deepLink = value },
    setRegistrationApplicationHost(value) { state.host = value; onHost(value, renderEditor) },
  })
  return { open, target, detail, attempt, state, calls, refs, ownership, renderEditor, preload: lazyModule.exports.preloadRegistrationApplication }
}
