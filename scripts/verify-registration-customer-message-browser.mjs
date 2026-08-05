import { existsSync } from "node:fs"

const DEFAULT_BASE_URL = "http://127.0.0.1:3012"
const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const FIXTURE_PATH = "/admin/registration?fixture=registration-subject-tracks&fixtureRole=english_admin"
const VIEWPORTS = Object.freeze([
  { name: "desktop-1349x987", width: 1349, height: 987 },
  { name: "mobile-390x844", width: 390, height: 844 },
])
const APP_ENDPOINTS = new Set([
  "/api/solapi/registration/customer-message/preview",
  "/api/solapi/registration/customer-message/send",
  "/api/solapi/registration/customer-message/list",
  "/api/solapi/registration/customer-message/check",
  "/api/solapi/registration/customer-message/reconcile",
])
const CASES = Object.freeze([
  {
    messageKind: "level_test_booking",
    taskId: "fixture-task-dual-test",
    trackId: "fixture-track-dual-english",
    appointmentId: "fixture-appointment-dual-test",
    trigger: "예약 안내 알림톡",
    body: "TIPS 레벨테스트 예약 안내\n김다미 학생의 영어, 수학 레벨테스트가 예약되었습니다.",
  },
  {
    messageKind: "appointment_reminder",
    taskId: "fixture-task-dual-test",
    trackId: "fixture-track-dual-english",
    appointmentId: "fixture-appointment-dual-test",
    trigger: "리마인드 알림톡",
    body: "TIPS 예약 리마인드\n김다미 학생의 레벨테스트 일정을 다시 안내드립니다.",
  },
  {
    messageKind: "visit_consultation_booking",
    taskId: "fixture-task-split-consultation",
    trackId: "fixture-track-split-english",
    appointmentId: "fixture-appointment-split-visit",
    trigger: "예약 안내 알림톡",
    body: "TIPS 방문상담 예약 안내\n박서준 학생의 방문상담이 예약되었습니다.",
  },
  {
    messageKind: "waiting_notice",
    taskId: "fixture-task-waiting-notice",
    trackId: "fixture-track-waiting-notice-english",
    trigger: "대기 안내 알림톡",
    body: "TIPS 대기 안내\n문하늘 학생의 영어 신규반 대기 신청이 접수되었습니다.",
  },
  {
    messageKind: "admission_application",
    taskId: "fixture-task-multiple-classes",
    trackId: "fixture-track-multiple-english",
    trigger: "입학신청서 알림톡",
    body: "TIPS 입학신청서 안내\n최유진 학생의 입학신청서를 확인해 주세요.",
    unknown: true,
  },
])

function parseArgs(argv) {
  let baseUrl = DEFAULT_BASE_URL
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--base-url" || !argv[index + 1]) {
      throw new Error("usage: verify-registration-customer-message-browser.mjs [--base-url http://127.0.0.1:3012]")
    }
    baseUrl = argv[index + 1]
    index += 1
  }
  const url = new URL(baseUrl)
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("registration_customer_message_browser_loopback_required")
  }
  return url.toString().replace(/\/$/u, "")
}

async function importPlaywright() {
  try {
    return await import("playwright")
  } catch {
    throw new Error("Playwright is required from the bundled local runtime; do not install a package.")
  }
}

function caseUrl(baseUrl, item) {
  const search = new URLSearchParams({
    fixture: "registration-subject-tracks",
    fixtureRole: "english_admin",
    taskId: item.taskId,
    trackId: item.trackId,
  })
  if (item.appointmentId) search.set("appointmentId", item.appointmentId)
  return `${baseUrl}/admin/registration?${search}`
}

async function installSafetyRoutes(page, evidence) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === "api.solapi.com") {
      evidence.providerRequests.push(`${route.request().method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    if (url.origin === evidence.baseOrigin && APP_ENDPOINTS.has(url.pathname)) {
      evidence.appEndpointRequests.push(url.pathname)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, fixture: true }),
      })
      return
    }
    if (url.origin !== evidence.baseOrigin && !["blob:", "data:"].includes(url.protocol)) {
      evidence.unexpectedExternalRequests.push(`${route.request().method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
}

async function waitForApplication(page) {
  const host = page.locator("[data-registration-application-host]")
  await host.waitFor({ state: "visible", timeout: 10_000 })
  if (await host.count() !== 1) throw new Error("registration application host must be unique")
  return host
}

async function assertLayout(page, dialog) {
  await page.waitForTimeout(250)
  const pageOverflow = await page.evaluate(() => {
    const { scrollWidth, clientWidth } = document.documentElement
    return scrollWidth > clientWidth
  })
  if (pageOverflow) throw new Error("customer message page has horizontal overflow")
  const dialogOverflow = await dialog.evaluate((element) => {
    const { scrollWidth, clientWidth } = element
    return scrollWidth > clientWidth
  })
  if (dialogOverflow) throw new Error("customer message dialog has horizontal overflow")
  const shortButtons = await dialog.getByRole("button").evaluateAll((buttons) => (
    buttons.filter((button) => button.getBoundingClientRect().height < 44).map((button) => ({
      label: button.textContent?.trim() || button.getAttribute("aria-label") || "button",
      minHeight: button.getBoundingClientRect().height,
    }))
  ))
  if (shortButtons.some(({ minHeight }) => minHeight < 44)) {
    throw new Error(`customer message controls below 44px: ${JSON.stringify(shortButtons)}`)
  }
}

async function assertDialogFocus(page, dialog) {
  const focusedInside = await dialog.evaluate((element) => element.contains(document.activeElement))
  if (!focusedInside) throw new Error("customer message dialog did not receive focus")
  await page.keyboard.press("Escape")
  await dialog.waitFor({ state: "hidden", timeout: 5_000 })
}

async function openDialog(page, host, triggerName) {
  const triggers = host.getByRole("button", { name: triggerName, exact: true })
  await triggers.first().waitFor({ state: "visible", timeout: 8_000 })
  let trigger = null
  for (let index = 0; index < await triggers.count(); index += 1) {
    const candidate = triggers.nth(index)
    if (await candidate.isVisible() && !(await candidate.isDisabled())) {
      trigger = candidate
      break
    }
  }
  if (!trigger) {
    const states = await triggers.evaluateAll((buttons) => buttons.map((button) => ({
      disabled: button.disabled,
      visible: Boolean(button.getClientRects().length),
      parent: button.parentElement?.parentElement?.textContent?.trim() || "",
    })))
    throw new Error(`${triggerName} is unexpectedly disabled: ${JSON.stringify(states)}`)
  }
  await trigger.click()
  const dialog = page.getByRole("dialog", { name: "알림톡 미리보기" })
  await dialog.waitFor({ state: "visible", timeout: 8_000 })
  return { trigger, dialog }
}

async function verifyDirtySourceBlock(page, baseUrl) {
  const item = CASES[0]
  await page.goto(caseUrl(baseUrl, item), { waitUntil: "domcontentloaded" })
  const host = await waitForApplication(page)
  const placeGroup = host.getByRole("group", { name: /예약 장소/ }).first()
  await placeGroup.waitFor({ state: "visible", timeout: 8_000 })
  const choices = placeGroup.getByRole("button")
  const current = await choices.evaluateAll((buttons) => buttons.findIndex((button) => button.getAttribute("aria-pressed") === "true"))
  const alternate = current === 0 ? 1 : 0
  await choices.nth(alternate).click()
  const blocked = host.getByRole("button", { name: "예약 안내 알림톡", exact: true }).first()
  if (!(await blocked.isDisabled())) throw new Error("source_dirty appointment still allows customer message preview")
  await host.getByText("예약을 저장한 뒤 알림톡을 보낼 수 있습니다.", { exact: true }).waitFor({ state: "visible" })
  return "source_dirty"
}

async function verifyMessageCase(page, baseUrl, item) {
  await page.goto(caseUrl(baseUrl, item), { waitUntil: "domcontentloaded" })
  const host = await waitForApplication(page)
  const triggerScope = host
  if (item.unknown) {
    await page.evaluate(() => {
      globalThis.__TIPS_REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG__
        .setNextCustomerMessageStatus("unknown")
    })
  }

  let { trigger, dialog } = await openDialog(page, triggerScope, item.trigger)
  await dialog.getByText("끝 5678", { exact: false }).first().waitFor({ state: "visible" })
  await dialog.getByText(item.body, { exact: true }).waitFor({ state: "visible" })
  await dialog.getByText("준비 상태 · 발송 가능", { exact: true }).waitFor({ state: "visible" })
  await assertLayout(page, dialog)
  await assertDialogFocus(page, dialog)
  const focusReturned = await trigger.evaluate((button) => document.activeElement === button)
  if (!focusReturned) throw new Error("Escape did not return focus to the Alimtalk trigger")

  ;({ trigger, dialog } = await openDialog(page, triggerScope, item.trigger))
  await dialog.getByRole("button", { name: "확인 후 발송", exact: true }).click()
  if (item.unknown) {
    await dialog.getByText("발송 결과 확인 필요", { exact: true }).waitFor({ state: "visible" })
    await dialog.getByRole("button", { name: "상태 확인", exact: true }).click()
  }
  await dialog.getByText("SOLAPI 접수 완료 · 학부모 전화 끝 5678", { exact: true }).waitFor({ state: "visible" })
  await dialog.getByRole("button", { name: "돌아가기", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })

  ;({ dialog } = await openDialog(page, triggerScope, item.trigger))
  await page.waitForTimeout(300)
  const reopenedText = (await dialog.textContent()) || ""
  if (!reopenedText.includes("최근 상태 · SOLAPI 접수 완료")) {
    throw new Error(`accepted/history evidence missing for ${item.messageKind}: ${reopenedText}`)
  }
  await dialog.getByText("준비 상태 · duplicate_locked", { exact: true }).waitFor({ state: "visible" })
  if (!(await dialog.getByRole("button", { name: "확인 후 발송", exact: true }).isDisabled())) {
    throw new Error("duplicate_locked preview exposes another send")
  }
  await dialog.getByRole("button", { name: "돌아가기", exact: true }).click()
  return {
    messageKind: item.messageKind,
    currentStatus: "accepted",
    duplicateBlocker: "duplicate_locked",
  }
}

async function verifyViewport(browser, baseUrl, viewport) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  const evidence = {
    baseOrigin: new URL(baseUrl).origin,
    providerRequests: [],
    appEndpointRequests: [],
    unexpectedExternalRequests: [],
  }
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await installSafetyRoutes(page, evidence)
  try {
    const dirtySource = await verifyDirtySourceBlock(page, baseUrl)
    const kinds = []
    for (const item of CASES) {
      try {
        kinds.push(await verifyMessageCase(page, baseUrl, item))
      } catch (error) {
        throw new Error(`${viewport.name}/${item.messageKind}: ${error.message}`)
      }
    }
    const overlayErrors = await page.locator(
      "[data-nextjs-dialog-overlay], nextjs-portal [role=dialog]",
    ).count()
    if (consoleErrors.length || pageErrors.length || overlayErrors) {
      throw new Error(JSON.stringify({ consoleErrors, pageErrors, overlayErrors }))
    }
    if (evidence.providerRequests.length !== 0) {
      throw new Error(`api.solapi.com requests observed: ${evidence.providerRequests.join(", ")}`)
    }
    if (evidence.unexpectedExternalRequests.length !== 0) {
      throw new Error(
        `unexpected external requests observed: ${evidence.unexpectedExternalRequests.join(", ")}`,
      )
    }
    return {
      viewport: viewport.name,
      kinds,
      dirtySource,
      appEndpointRequests: evidence.appEndpointRequests.length,
      unexpectedExternalRequests: 0,
      providerCalls: 0,
      consoleErrors: 0,
      pageErrors: 0,
      overlayErrors: 0,
      overflow: false,
      minimumControlHeight: 44,
    }
  } finally {
    await context.close()
  }
}

async function main() {
  const baseUrl = parseArgs(process.argv.slice(2))
  if (APP_ENDPOINTS.size !== 5) {
    throw new Error("registration customer-message verifier contract invalid")
  }
  const { chromium } = await importPlaywright()
  if (!existsSync(CHROME_EXECUTABLE)) throw new Error("bundled browser QA requires local Google Chrome")
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_EXECUTABLE })
  try {
    const viewports = []
    for (const viewport of VIEWPORTS) viewports.push(await verifyViewport(browser, baseUrl, viewport))
    process.stdout.write(`${JSON.stringify({
      fixturePath: FIXTURE_PATH,
      viewports,
      messageKinds: CASES.map((item) => item.messageKind),
      providerCalls: 0,
    }, null, 2)}\n`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
