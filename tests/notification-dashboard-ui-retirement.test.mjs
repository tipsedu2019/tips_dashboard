import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test("retired dashboard inbox components are removed", async () => {
  for (const relative of [
    "src/components/dashboard-notification-popover.tsx",
    "src/components/dashboard-notification-content.tsx",
  ]) {
    await assert.rejects(access(join(root, relative)))
  }
})

test("notification settings separate staff rules from customer guidance and keep connections outside the tabs", async () => {
  const panel = await readFile(join(root, "src/features/notifications/notification-control-panel.tsx"), "utf8")
  const workspace = await readFile(join(root, "src/features/notifications/notification-settings-workspace.tsx"), "utf8")
  assert.doesNotMatch(panel, /최근 전달|DeliverySummary|value="deliveries"/)
  assert.doesNotMatch(workspace, /"deliveries"/)
  const { NotificationControlPanel } = loadNotificationComponent("src/features/notifications/notification-control-panel.tsx")
  for (const initialSection of ["rules", "customer"]) {
    const dom = new JSDOM(renderToStaticMarkup(createElement(NotificationControlPanel, {
      workflowKey: "registration", presentation: "page", initialSection,
      customerGuidance: createElement("p", { "data-customer-guidance": "" }, "고객 안내 내용"),
    })))
    try {
      const document = dom.window.document
      assert.deepEqual([...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent), [
        "직원 알림 · Google Chat", "고객 안내 · 알림톡",
      ])
      assert.equal(document.querySelector('[role="tab"][aria-selected="true"]').textContent,
        initialSection === "rules" ? "직원 알림 · Google Chat" : "고객 안내 · 알림톡")
      assert.equal(Boolean(document.querySelector("[data-customer-guidance]")), initialSection === "customer")
      assert.equal([...document.querySelectorAll("button")].some((button) => button.textContent === "수신 채팅방"), initialSection === "rules")
    } finally {
      dom.window.close()
    }
  }
})

test("browser verifier no longer probes the retired dashboard inbox", async () => {
  const source = await readFile(join(root, "scripts/verify-notification-content-browser.mjs"), "utf8")
  assert.doesNotMatch(source, /dashboard-notification-(?:popover|list)|data-dashboard-notification-id/)
})
