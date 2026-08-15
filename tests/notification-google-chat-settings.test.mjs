import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import test from "node:test"

async function loadSettingsProjection() {
  try {
    return await import(new URL(
      "../src/features/notifications/notification-google-chat-settings.ts",
      import.meta.url,
    ).href)
  } catch {
    return null
  }
}

test("notification settings expose only Google Chat rules for editing", async () => {
  const settingsProjection = await loadSettingsProjection()
  assert.equal(typeof settingsProjection?.selectEditableGoogleChatRules, "function")

  const rules = [
    { id: "in-app", channelKey: "in_app" },
    { id: "push", channelKey: "web_push" },
    { id: "chat", channelKey: "google_chat" },
    { id: "alimtalk", channelKey: "customer_message" },
  ]

  assert.deepEqual(
    settingsProjection.selectEditableGoogleChatRules(rules).map(({ id, channelKey }) => ({ id, channelKey })),
    [{ id: "chat", channelKey: "google_chat" }],
  )
})

test("Google Chat settings do not expose the SOLAPI editor route or reminder editor", async () => {
  const [panelSource, solapiRouteExists] = await Promise.all([
    readFile(new URL(
      "../src/features/notifications/notification-control-panel.tsx",
      import.meta.url,
    ), "utf8"),
    access(new URL(
      "../src/app/admin/settings/notifications/solapi/page.tsx",
      import.meta.url,
    )).then(() => true, () => false),
  ])

  assert.doesNotMatch(panelSource, /RegistrationCustomerReminderSettings/)
  assert.match(panelSource, /Google Chat 규칙/)
  assert.equal(solapiRouteExists, false)
})
