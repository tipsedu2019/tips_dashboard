import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test("retired dashboard inbox components are removed", async () => {
  for (const relative of [
    "src/components/dashboard-notification-popover.tsx",
    "src/components/dashboard-notification-content.tsx",
  ]) {
    await assert.rejects(access(join(root, relative)))
  }
})

test("notification settings expose only Google Chat rules and connection", async () => {
  const panel = await readFile(join(root, "src/features/notifications/notification-control-panel.tsx"), "utf8")
  const workspace = await readFile(join(root, "src/features/notifications/notification-settings-workspace.tsx"), "utf8")
  assert.doesNotMatch(panel, /최근 전달|DeliverySummary|value="deliveries"/)
  assert.doesNotMatch(workspace, /"deliveries"/)
  assert.match(panel, /Google Chat 규칙/)
  assert.match(panel, /value="connections"/)
})

test("browser verifier no longer probes the retired dashboard inbox", async () => {
  const source = await readFile(join(root, "scripts/verify-notification-content-browser.mjs"), "utf8")
  assert.doesNotMatch(source, /dashboard-notification-(?:popover|list)|data-dashboard-notification-id/)
})
