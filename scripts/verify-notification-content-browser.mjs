#!/usr/bin/env node

import { chromium } from "playwright"

const baseUrl = String(process.env.NOTIFICATION_BROWSER_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/u, "")
const storageState = process.env.NOTIFICATION_BROWSER_STORAGE_STATE

if (!storageState) throw new Error("NOTIFICATION_BROWSER_STORAGE_STATE가 필요합니다.")

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ storageState })
  const page = await context.newPage()
  const providerRequests = []
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (["chat.googleapis.com", "api.solapi.com"].includes(url.hostname)) {
      providerRequests.push(`${route.request().method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })

  await page.goto(`${baseUrl}/admin/dashboard`, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {})
  const legacyNotificationButtons = await page.getByRole("button", { name: /읽지 않은 알림/ }).count()
  if (legacyNotificationButtons !== 0) throw new Error("폐기된 대시보드 알림 버튼이 남아 있습니다.")
  if (providerRequests.length !== 0) {
    throw new Error(`검증 중 외부 알림 요청이 발생했습니다: ${providerRequests.join(", ")}`)
  }
  process.stdout.write("대시보드 알림 UI 제거 확인 완료\n")
} finally {
  await browser.close()
}
