import { readFile, readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"

export const NOTIFICATION_WORKFLOW_ENTRYPOINTS = Object.freeze([
  { workflowKey: "tasks", route: "/admin/tasks", page: "src/app/admin/tasks/page.tsx", workspace: "todo" },
  { workflowKey: "word_retests", route: "/admin/word-retests", page: "src/app/admin/word-retests/page.tsx", workspace: "word_retest" },
  { workflowKey: "registration", route: "/admin/registration", page: "src/app/admin/registration/page.tsx", workspace: "registration" },
  { workflowKey: "transfer", route: "/admin/transfer", page: "src/app/admin/transfer/page.tsx", workspace: "transfer" },
  { workflowKey: "withdrawal", route: "/admin/withdrawal", page: "src/app/admin/withdrawal/page.tsx", workspace: "withdrawal" },
  { workflowKey: "makeup_requests", route: "/admin/makeup-requests", page: "src/app/admin/makeup-requests/page.tsx", workspace: null },
  { workflowKey: "approvals", route: "/admin/approvals", page: "src/app/admin/approvals/page.tsx", workspace: null },
])

export function verifyNotificationWorkflowEntrypoints(evidence) {
  const blockers = []
  if (!Array.isArray(evidence) || evidence.length !== NOTIFICATION_WORKFLOW_ENTRYPOINTS.length) {
    return { passed: false, blockers: ["entrypoint_registry_invalid"] }
  }
  for (const expected of NOTIFICATION_WORKFLOW_ENTRYPOINTS) {
    const item = evidence.find((candidate) => candidate?.workflowKey === expected.workflowKey)
    if (!item || item.route !== expected.route) {
      blockers.push(`entrypoint_missing:${expected.workflowKey}`)
      continue
    }
    if (item.commonPanelCount !== 1) blockers.push(`common_panel_count:${expected.workflowKey}`)
    if (item.routeLocalDialogCount !== 0) blockers.push(`route_local_dialog:${expected.workflowKey}`)
    if (item.providerPostCount !== 0) blockers.push(`settings_provider_call:${expected.workflowKey}`)
    if (item.legacySourceBridgeCount !== 0) blockers.push(`settings_legacy_bridge_call:${expected.workflowKey}`)
  }
  return { passed: blockers.length === 0, blockers }
}

async function sourceAt(rootUrl, relativePath) {
  return readFile(new URL(relativePath, rootUrl), "utf8")
}

const ROUTE_LOCAL_NOTIFICATION_DIALOG_PATTERNS = Object.freeze([
  /<NotificationControlPanel\b/u,
  /\b[A-Za-z]+NotificationSettingsDialog\b/u,
  /\bnotificationDialogOpen\b/u,
  /<Dialog\b[\s\S]{0,240}?알림 설정/u,
])

const ROUTE_LOCAL_GOOGLE_CHAT_API_REFERENCE = /\/api\/google-chat\b/u
const SOURCE_CODE_EXTENSION = /\.(?:ts|tsx|js|jsx)$/u
const GOOGLE_CHAT_API_REFERENCE_ALLOWLIST = new Set([
  "src/app/api/google-chat/route.ts",
])

async function listSourceCodePaths(rootUrl, relativeDirectory = "src/") {
  const entries = await readdir(new URL(relativeDirectory, rootUrl), { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  const paths = []
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}${entry.name}`
    if (entry.isDirectory()) {
      paths.push(...await listSourceCodePaths(rootUrl, `${relativePath}/`))
    } else if (entry.isFile() && SOURCE_CODE_EXTENSION.test(entry.name)) {
      paths.push(relativePath)
    }
  }
  return paths
}

async function findGoogleChatApiReferencePaths(rootUrl) {
  const paths = await listSourceCodePaths(rootUrl)
  const matches = []
  for (const relativePath of paths) {
    if (GOOGLE_CHAT_API_REFERENCE_ALLOWLIST.has(relativePath)) continue
    const source = await sourceAt(rootUrl, relativePath)
    if (ROUTE_LOCAL_GOOGLE_CHAT_API_REFERENCE.test(source)) matches.push(relativePath)
  }
  return matches
}

function hasRouteLocalNotificationDialog(source) {
  return ROUTE_LOCAL_NOTIFICATION_DIALOG_PATTERNS.some((pattern) => pattern.test(source))
}

export async function scanNotificationWorkflowEntrypoints(rootUrl) {
  const blockers = []
  const taskWorkspace = await sourceAt(rootUrl, "src/features/tasks/ops-task-workspace.tsx")
  const makeupWorkspace = await sourceAt(rootUrl, "src/features/makeup-requests/makeup-request-workspace.tsx")
  const approvalWorkspace = await sourceAt(rootUrl, "src/features/approvals/approval-workspace.tsx")
  const settingsPage = await sourceAt(rootUrl, "src/app/admin/settings/notifications/page.tsx")
  const settingsWorkspace = await sourceAt(rootUrl, "src/features/notifications/notification-settings-workspace.tsx")
  const controlPanel = await sourceAt(rootUrl, "src/features/notifications/notification-control-panel.tsx")
  const controlPlaneTypes = await sourceAt(rootUrl, "src/features/notifications/notification-control-plane-types.ts")
  const navigation = await sourceAt(rootUrl, "src/lib/navigation.ts")
  const centralPanelReady = (
    settingsPage.includes("<NotificationSettingsWorkspace")
    && settingsWorkspace.includes("<NotificationControlPanel")
    && settingsWorkspace.includes('presentation="page"')
    && controlPanel.includes("NOTIFICATION_WORKFLOW_OPTIONS.map")
    && controlPanel.includes("data-notification-workflow={activeWorkflow}")
    && navigation.includes('{ title: "알림 설정", url: "/admin/settings/notifications" }')
  )
  const workspaceSurfaceByWorkflow = new Map([
    ["tasks", taskWorkspace],
    ["word_retests", taskWorkspace],
    ["registration", taskWorkspace],
    ["transfer", taskWorkspace],
    ["withdrawal", taskWorkspace],
    ["makeup_requests", makeupWorkspace],
    ["approvals", approvalWorkspace],
  ])
  const routeLocalSourcePaths = new Set([
    ...NOTIFICATION_WORKFLOW_ENTRYPOINTS.map((entry) => entry.page),
    "src/features/tasks/ops-task-workspace.tsx",
    "src/features/makeup-requests/makeup-request-workspace.tsx",
    "src/features/approvals/approval-workspace.tsx",
  ])

  for (const entry of NOTIFICATION_WORKFLOW_ENTRYPOINTS) {
    const page = await sourceAt(rootUrl, entry.page)
    if (entry.workspace && !page.includes(`workspace="${entry.workspace}"`)) {
      blockers.push(`page_workspace_mismatch:${entry.workflowKey}`)
    }
    const hasKey = new RegExp(`key:\\s*["']${entry.workflowKey}["']`).test(controlPlaneTypes)
    if (!centralPanelReady || !hasKey) {
      blockers.push(`common_panel_missing:${entry.workflowKey}`)
    }
    const routeLocalSurfaces = [page, workspaceSurfaceByWorkflow.get(entry.workflowKey) || ""]
    if (routeLocalSurfaces.some(hasRouteLocalNotificationDialog)) {
      blockers.push(`route_local_dialog:${entry.workflowKey}`)
    }
    if (routeLocalSurfaces.some((source) => ROUTE_LOCAL_GOOGLE_CHAT_API_REFERENCE.test(source))) {
      blockers.push(`settings_provider_call:${entry.workflowKey}`)
    }
  }

  const googleChatApiReferencePaths = await findGoogleChatApiReferencePaths(rootUrl)
  for (const relativePath of googleChatApiReferencePaths) {
    if (!routeLocalSourcePaths.has(relativePath)) {
      blockers.push(`settings_provider_call:source:${relativePath}`)
    }
  }

  const googleChat = await sourceAt(rootUrl, "src/app/api/google-chat/route.ts")
  const webPush = await sourceAt(rootUrl, "src/app/api/web-push/route.ts")
  if (!googleChat.includes("notification_payload_forbidden") || !googleChat.includes("sourceEventId")) {
    blockers.push("google_chat_contract_open")
  }
  if (!webPush.includes("notification_payload_forbidden")) blockers.push("web_push_contract_open")
  return { passed: blockers.length === 0, blockers, entrypoints: NOTIFICATION_WORKFLOW_ENTRYPOINTS }
}

async function probeRoutes(baseUrl) {
  const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }]
  const observer = createNotificationProviderRequestObserver(fetch)
  const routeResults = []
  for (const viewport of viewports) {
    for (const entry of NOTIFICATION_WORKFLOW_ENTRYPOINTS) {
      let response
      try {
        response = await observer.fetch(new URL(entry.route, baseUrl), {
          redirect: "manual",
          headers: { "X-Notification-Verification-Viewport": `${viewport.width}x${viewport.height}` },
        })
      } catch (error) {
        const code = error instanceof Error
          ? String(error.cause?.code || error.message || "unknown")
          : "unknown"
        throw new Error(`route_probe_fetch_failed:${entry.route}:${viewport.width}x${viewport.height}:${code}`)
      }
      routeResults.push({ route: entry.route, viewport, status: response.status })
      const status = response.status
      await response.arrayBuffer()
      if (status >= 500) throw new Error(`route_probe_failed:${entry.route}`)
    }
  }
  return { routeResults, providerRequests: observer.providerRequests }
}

const PROVIDER_ENDPOINTS = Object.freeze([
  { origin: "https://chat.googleapis.com", pathname: /^\/v1\/spaces\/[^/]+\/messages$/u },
  { origin: "https://fcm.googleapis.com", pathname: /^\/v1\/projects\/[^/]+\/messages:send$/u },
])

export function createNotificationProviderRequestObserver(fetchImpl = fetch) {
  if (typeof fetchImpl !== "function") throw new Error("provider_request_observer_fetch_invalid")
  const providerRequests = []
  return {
    providerRequests,
    async fetch(input, init) {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
      if (PROVIDER_ENDPOINTS.some((endpoint) => (
        endpoint.origin === url.origin && endpoint.pathname.test(url.pathname)
      ))) {
        providerRequests.push({
          method: String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase(),
          origin: url.origin,
          pathname: url.pathname,
        })
      }
      return fetchImpl(input, init)
    },
  }
}

async function main() {
  const rootUrl = new URL("../", import.meta.url)
  const staticResult = await scanNotificationWorkflowEntrypoints(rootUrl)
  const baseUrlIndex = process.argv.indexOf("--base-url")
  const runtime = baseUrlIndex >= 0 && process.argv[baseUrlIndex + 1]
    ? await probeRoutes(process.argv[baseUrlIndex + 1])
    : { routeResults: [], providerRequests: [] }
  const result = {
    ...staticResult,
    providerRequestCount: runtime.providerRequests.length,
    routeResults: runtime.routeResults,
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.passed || result.providerRequestCount !== 0) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "entry-point 검증에 실패했습니다."}\n`)
    process.exitCode = 1
  })
}
