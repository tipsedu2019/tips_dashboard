const ENABLED = process.env.ADMIN_GUARD_SMOKE === "1"
const BASE_URL = process.env.ADMIN_GUARD_BASE_URL || "http://localhost:3000"

const ROUTES = [
  "/admin/tasks",
  "/admin/registration",
  "/admin/transfer",
  "/admin/withdrawal",
  "/admin/word-retests",
  "/admin/approvals",
]

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]

function joinUrl(path) {
  return `${BASE_URL.replace(/\/$/, "")}${path}`
}

async function importPlaywright() {
  try {
    return await import("playwright")
  } catch {
    throw new Error("Playwright is required for ADMIN_GUARD_SMOKE=1.")
  }
}

async function inspectRoute(page, route, viewport) {
  const consoleErrors = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await page.goto(joinUrl(route), { waitUntil: "networkidle" })
  const url = new URL(page.url())
  const text = await page.locator("body").innerText({ timeout: 8000 })
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }))

  if (!url.pathname.includes("/sign-in")) throw new Error(`${route} did not redirect to sign-in.`)
  if (!url.searchParams.get("next")?.startsWith(route.split("?")[0])) throw new Error(`${route} did not preserve the next URL.`)
  if (!text.includes("TIPS Dashboard") || !text.includes("아이디") || !text.includes("비밀번호")) {
    throw new Error(`${route} rendered an unexpected sign-in screen.`)
  }
  if (metrics.scrollWidth > metrics.viewportWidth + 8) {
    throw new Error(`${route} sign-in overflowed on ${viewport.name}: ${metrics.scrollWidth}px over ${metrics.viewportWidth}px.`)
  }
  if (consoleErrors.length > 0) throw new Error(`${route} had console errors: ${consoleErrors.join(" | ")}`)

  return { route, redirectedTo: url.pathname, viewport: viewport.name }
}

async function run() {
  if (!ENABLED) {
    console.log("Skipped. Set ADMIN_GUARD_SMOKE=1 to verify protected admin redirects.")
    return
  }

  const { chromium } = await importPlaywright()
  const browser = await chromium.launch({ headless: true })
  try {
    const results = []
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport })
      const page = await context.newPage()
      try {
        for (const route of ROUTES) {
          results.push(await inspectRoute(page, route, viewport))
        }
      } finally {
        await context.close()
      }
    }
    console.log(JSON.stringify({ ok: true, baseUrl: BASE_URL, results }, null, 2))
  } finally {
    await browser.close()
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
