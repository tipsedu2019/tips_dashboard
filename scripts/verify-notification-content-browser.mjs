import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const DEFAULT_ARTIFACT_DIR = "/private/tmp/tips-notification-content-browser"
const DEFAULT_BROWSER_EXECUTABLES = Object.freeze([
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
])
const USAGE = `Usage:
  node scripts/verify-notification-content-browser.mjs \\
    --base-url http://127.0.0.1:3012 \\
    --storage-state /private/tmp/tips-notification-content-storage-state.json \\
    [--browser-executable "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]

Add --capture-storage-state once to open a local login window and save the
authenticated session with file mode 0600 before provider-zero QA.

Runs authenticated dashboard notification browser QA with intercepted inbox fixtures.
All Google Chat, Web Push, SOLAPI, worker, and external provider requests are blocked.
Successful output records provider-zero evidence for every viewport.`

const VIEWPORTS = Object.freeze([
  { name: "desktop-1440x900", width: 1440, height: 900, zoom: 1 },
  { name: "mobile-320x568", width: 320, height: 568, zoom: 1 },
  { name: "mobile-360x800", width: 360, height: 800, zoom: 1 },
  { name: "mobile-390x844", width: 390, height: 844, zoom: 1 },
  { name: "landscape-844x390", width: 844, height: 390, zoom: 1 },
  { name: "desktop-200-percent", width: 1440, height: 900, zoom: 2 },
])

const PROVIDER_PATHS = Object.freeze([
  "/api/google-chat",
  "/api/web-push",
  "/api/registration/consultation-notification",
  "/api/notifications/worker",
])
const PROVIDER_HOSTS = Object.freeze([
  "chat.googleapis.com",
  "fcm.googleapis.com",
  "api.solapi.com",
])

function parseArgs(argv) {
  const args = {
    baseUrl: "",
    storageState: "",
    artifactDir: DEFAULT_ARTIFACT_DIR,
    browserExecutable: "",
    captureStorageState: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--help" || value === "-h") return { help: true, ...args }
    if (value === "--capture-storage-state") {
      args.captureStorageState = true
      continue
    }
    const next = argv[index + 1]
    if (value === "--base-url") args.baseUrl = next || ""
    else if (value === "--storage-state") args.storageState = next || ""
    else if (value === "--artifact-dir") args.artifactDir = next || ""
    else if (value === "--browser-executable") args.browserExecutable = next || ""
    else throw new Error(`알 수 없는 인자입니다: ${value}`)
    index += 1
  }
  return { help: false, ...args }
}

function validateArgs(args) {
  if (!args.baseUrl || !args.storageState) throw new Error(USAGE)
  const baseUrl = new URL(args.baseUrl)
  if (!["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname)) {
    throw new Error("--base-url은 인증 QA 안전을 위해 localhost만 허용합니다.")
  }
  if (!args.captureStorageState && !existsSync(args.storageState)) {
    throw new Error(`--storage-state 파일을 찾을 수 없습니다: ${args.storageState}`)
  }
  if (!args.artifactDir) throw new Error("--artifact-dir은 빈 값일 수 없습니다.")
  const browserExecutable = args.browserExecutable
    ? resolve(args.browserExecutable)
    : DEFAULT_BROWSER_EXECUTABLES.find((candidate) => existsSync(candidate)) || ""
  if (!browserExecutable || !existsSync(browserExecutable)) {
    throw new Error("실행 가능한 Chrome을 찾지 못했습니다. --browser-executable로 경로를 지정해 주세요.")
  }
  return {
    baseUrl: baseUrl.toString().replace(/\/$/u, ""),
    storageState: resolve(args.storageState),
    artifactDir: resolve(args.artifactDir),
    browserExecutable,
    captureStorageState: args.captureStorageState,
  }
}

function fixtureUuid(index) {
  return `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`
}

function loadInboxFixture() {
  const golden = JSON.parse(readFileSync(
    resolve(ROOT, "tests/fixtures/notification-content-golden.json"),
    "utf8",
  ))
  const goldens = [
    ...golden.requiredExamples.map((entry, index) => ({
      eventKey: `required.${index + 1}`,
      expectedTitle: entry.title,
      expectedBody: entry.body,
    })),
    ...golden.eventGoldens,
  ]
  const items = Array.from({ length: 20 }, (_, index) => {
    const entry = goldens[index % goldens.length]
    const createdAt = new Date(Date.UTC(2026, 7, 4, 1, 30 - index)).toISOString()
    return {
      id: fixtureUuid(index + 1),
      recipient_profile_id: fixtureUuid(900),
      recipient_team: null,
      actor_profile_id: null,
      type: entry.eventKey,
      title: entry.expectedTitle,
      body: index === 1
        ? `${entry.expectedBody}\n[메모] ${"긴알림내용".repeat(36)}`
        : entry.expectedBody,
      href: index === 0 ? "" : `/admin/tasks?taskId=${fixtureUuid(index + 101)}`,
      metadata: {},
      read_at: index < 12 ? null : createdAt,
      created_at: createdAt,
    }
  })
  return Object.freeze({
    items: Object.freeze(items),
    unread_count: "12",
    next_cursor: null,
    firstTitle: items[0].title,
    firstBody: items[0].body,
    firstCreatedAt: items[0].created_at,
  })
}

function isProviderRequest(url) {
  return PROVIDER_HOSTS.includes(url.hostname)
    || PROVIDER_PATHS.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`))
    || url.pathname.startsWith("/api/solapi/")
}

async function installSafetyRoutes(page, fixture, evidence) {
  await page.route("**/*", async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (isProviderRequest(url)) {
      evidence.providerRequests.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    if (url.pathname.endsWith("/rest/v1/rpc/get_dashboard_notification_inbox_v1")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        items: fixture.items,
        unread_count: fixture.unread_count,
        next_cursor: fixture.next_cursor,
      }) })
      return
    }
    if (url.pathname.endsWith("/rest/v1/rpc/get_dashboard_notification_unread_count_v1")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        unread_count: fixture.unread_count,
      }) })
      return
    }
    if (url.pathname.endsWith("/rest/v1/rpc/mark_dashboard_notification_read_v1")) {
      evidence.markReadRequests += 1
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({
        code: "P0001",
        details: null,
        hint: null,
        message: "fixture mark failure",
      }) })
      return
    }
    if (url.pathname === "/api/notifications/push-readiness") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        ok: true,
        state: "server_unconfigured",
        keysMatch: false,
        assetsAvailable: true,
        subscriptionOwned: false,
        capability: false,
      }) })
      return
    }
    if (
      request.isNavigationRequest()
      && url.pathname.startsWith("/admin/")
      && url.pathname !== "/admin/dashboard"
    ) {
      evidence.blockedNavigations += 1
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function verifyViewport(browser, options, viewport, fixture) {
  const cssViewport = {
    width: Math.round(viewport.width / viewport.zoom),
    height: Math.round(viewport.height / viewport.zoom),
  }
  const context = await browser.newContext({
    viewport: cssViewport,
    deviceScaleFactor: viewport.zoom,
    storageState: options.storageState,
  })
  const page = await context.newPage()
  const evidence = { providerRequests: [], blockedNavigations: 0, markReadRequests: 0 }
  try {
    await installSafetyRoutes(page, fixture, evidence)
    await page.goto(`${options.baseUrl}/admin/dashboard`, { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {})
    const reachedUrl = new URL(page.url())
    assert(
      reachedUrl.pathname === "/admin/dashboard",
      `${viewport.name}: 인증된 /admin/dashboard 대신 ${reachedUrl.pathname}에 도착했습니다.`,
    )
    const trigger = page.getByRole("button", { name: /알림, 읽지 않은 알림/ }).first()
    await trigger.waitFor({ state: "visible", timeout: 12_000 })
    await trigger.click()
    const popover = page.getByTestId("dashboard-notification-popover")
    const list = page.getByTestId("dashboard-notification-list")
    await popover.waitFor({ state: "visible" })
    await list.getByRole("listitem").first().waitFor({ state: "visible" })
    await page.waitForFunction(() => (
      document.querySelectorAll("[data-dashboard-notification-id]").length === 20
    ))
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-testid="dashboard-notification-popover"]')
      return panel instanceof HTMLElement
        && panel.getAnimations({ subtree: true }).every((animation) => animation.playState !== "running")
    })

    const firstItem = list.getByRole("listitem").first()
    const firstText = await firstItem.innerText()
    for (const fact of [fixture.firstTitle.replace(/^[^ ]+\s/u, ""), ...fixture.firstBody.split("\n")]) {
      assert(firstText.includes(fact), `${viewport.name}: 링크 없는 첫 알림에서 사실이 누락됐습니다: ${fact}`)
    }
    assert(await firstItem.locator("a").count() === 0, `${viewport.name}: href 없는 알림이 링크로 렌더됐습니다.`)

    const metrics = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="dashboard-notification-popover"]')
      const scroll = document.querySelector('[data-testid="dashboard-notification-list"]')
      const body = document.querySelector("[data-dashboard-notification-id] p.whitespace-pre-wrap")
      const readButton = document.querySelector('[data-dashboard-notification-id] button[aria-label$="읽음 처리"]')
      if (!(panel instanceof HTMLElement)
        || !(scroll instanceof HTMLElement)
        || !(body instanceof HTMLElement)
        || !(readButton instanceof HTMLElement)) return null
      const panelRect = panel.getBoundingClientRect()
      const buttonRect = readButton.getBoundingClientRect()
      const bodyStyle = getComputedStyle(body)
      return {
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        panelLeft: panelRect.left,
        panelRight: panelRect.right,
        panelTop: panelRect.top,
        panelBottom: panelRect.bottom,
        panelScrollWidth: panel.scrollWidth,
        panelClientWidth: panel.clientWidth,
        listScrollHeight: scroll.scrollHeight,
        listClientHeight: scroll.clientHeight,
        bodyFontSize: Number.parseFloat(bodyStyle.fontSize),
        bodyWhiteSpace: bodyStyle.whiteSpace,
        bodyOverflowWrap: bodyStyle.overflowWrap,
        buttonWidth: buttonRect.width,
        buttonHeight: buttonRect.height,
        devicePixelRatio: window.devicePixelRatio,
      }
    })
    assert(metrics, `${viewport.name}: 알림 측정 대상을 찾지 못했습니다.`)
    const screenshotPath = resolve(options.artifactDir, `${viewport.name}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: false })
    assert(metrics.documentScrollWidth <= metrics.viewportWidth, `${viewport.name}: 문서 가로 overflow가 있습니다.`)
    assert(metrics.panelScrollWidth <= metrics.panelClientWidth, `${viewport.name}: popover 내부 가로 overflow가 있습니다.`)
    assert(metrics.panelLeft >= 7, `${viewport.name}: 왼쪽 viewport 여백이 8px 미만입니다. left=${metrics.panelLeft}`)
    assert(metrics.panelRight <= metrics.viewportWidth - 7, `${viewport.name}: 오른쪽 viewport 여백이 8px 미만입니다. right=${metrics.panelRight}, viewport=${metrics.viewportWidth}`)
    assert(
      metrics.panelTop >= 7 && metrics.panelBottom <= metrics.viewportHeight - 7,
      `${viewport.name}: popover가 viewport 높이를 벗어났습니다. top=${metrics.panelTop}, bottom=${metrics.panelBottom}, viewport=${metrics.viewportHeight}`,
    )
    assert(metrics.listScrollHeight > metrics.listClientHeight, `${viewport.name}: 내부 목록 scroll이 형성되지 않았습니다.`)
    assert(metrics.bodyFontSize >= 14, `${viewport.name}: 본문 글자 크기가 14px보다 작습니다.`)
    assert(metrics.bodyWhiteSpace === "pre-wrap", `${viewport.name}: 본문 줄바꿈이 보존되지 않습니다.`)
    assert(metrics.bodyOverflowWrap === "anywhere", `${viewport.name}: 긴 내용 줄바꿈이 anywhere가 아닙니다.`)
    assert(metrics.buttonWidth >= 44 && metrics.buttonHeight >= 44, `${viewport.name}: 읽음 버튼이 44x44px보다 작습니다.`)
    if (viewport.zoom !== 1) {
      assert(metrics.devicePixelRatio === 2, `${viewport.name}: 200% device scale이 적용되지 않았습니다.`)
      assert(metrics.viewportWidth === cssViewport.width, `${viewport.name}: 200% CSS viewport가 적용되지 않았습니다.`)
    }

    const unreadStatus = firstItem.locator('[role="status"]')
    assert(
      await unreadStatus.count() === 1 && (await unreadStatus.innerText()).trim() === "읽지 않음",
      `${viewport.name}: 읽지 않음 status가 없습니다.`,
    )
    const time = firstItem.locator("time")
    assert(await time.getAttribute("datetime") === fixture.firstCreatedAt, `${viewport.name}: time datetime이 원본 시각과 다릅니다.`)
    assert(await page.locator('[role="status"][aria-live="polite"]').count() >= 1, `${viewport.name}: polite unread count가 없습니다.`)

    const readButtons = list.locator('button[aria-label$="읽음 처리"]')
    const lastReadButton = readButtons.last()
    await lastReadButton.focus()
    const focusVisible = await page.evaluate(() => {
      const scroll = document.querySelector('[data-testid="dashboard-notification-list"]')
      const active = document.activeElement
      if (!(scroll instanceof HTMLElement) || !(active instanceof HTMLElement)) return false
      const scrollRect = scroll.getBoundingClientRect()
      const activeRect = active.getBoundingClientRect()
      return activeRect.top >= scrollRect.top && activeRect.bottom <= scrollRect.bottom
    })
    assert(focusVisible, `${viewport.name}: 내부 scroll이 마지막 읽음 버튼 focus를 보이지 않게 했습니다.`)

    await readButtons.first().click()
    const alert = firstItem.getByRole("alert")
    await alert.waitFor({ state: "visible" })
    assert((await alert.innerText()).includes("읽음 처리하지 못했습니다"), `${viewport.name}: 읽음 오류 alert 문구가 없습니다.`)
    assert(evidence.markReadRequests === 1, `${viewport.name}: fixture 읽음 RPC 호출 수가 1이 아닙니다.`)

    await page.keyboard.press("Escape")
    await popover.waitFor({ state: "hidden" })
    await page.waitForFunction((button) => document.activeElement === button, await trigger.elementHandle())

    assert(evidence.providerRequests.length === 0, `${viewport.name}: provider 요청이 감지됐습니다: ${evidence.providerRequests.join(", ")}`)
    return {
      name: viewport.name,
      width: viewport.width,
      height: viewport.height,
      zoom: viewport.zoom,
      notificationCount: 20,
      providerAttempts: evidence.providerRequests.length,
      blockedNavigations: evidence.blockedNavigations,
      screenshotPath,
      metrics,
    }
  } finally {
    await context.close()
  }
}

async function captureStorageState(chromium, options) {
  const browser = await chromium.launch({
    executablePath: options.browserExecutable,
    headless: false,
  })
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    console.log("로컬 로그인 창에서 로그인해 주세요. 인증된 대시보드로 이동하면 QA를 자동으로 계속합니다.")
    await page.goto(`${options.baseUrl}/admin/dashboard`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: /^알림,/u }).waitFor({
      state: "visible",
      timeout: 5 * 60_000,
    })
    await page.waitForURL(`${options.baseUrl}/admin/dashboard`, {
      timeout: 5 * 60_000,
      waitUntil: "domcontentloaded",
    })
    await context.storageState({ path: options.storageState })
    chmodSync(options.storageState, 0o600)
    console.log(`인증 상태를 저장했습니다: ${options.storageState}`)
  } finally {
    await context.close()
    await browser.close()
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.help) {
    console.log(USAGE)
    return
  }
  const options = validateArgs(parsed)
  mkdirSync(options.artifactDir, { recursive: true })
  const fixture = loadInboxFixture()
  const { chromium } = await import("playwright")
  if (options.captureStorageState) await captureStorageState(chromium, options)
  const browser = await chromium.launch({
    executablePath: options.browserExecutable,
    headless: true,
  })
  try {
    const viewports = []
    for (const viewport of VIEWPORTS) {
      viewports.push(await verifyViewport(browser, options, viewport, fixture))
    }
    console.log(JSON.stringify({
      ok: true,
      providerZero: true,
      baseUrl: options.baseUrl,
      storageState: options.storageState,
      viewports,
    }, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
