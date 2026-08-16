import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import test from "node:test"

const paths = [
  new URL("../src/features/notifications/registration-customer-reminder-settings.tsx", import.meta.url),
  new URL("../src/features/notifications/registration-customer-reminder-service.ts", import.meta.url),
]

test("예약 리마인드 lead time 편집 UI와 브라우저 service는 은퇴한다", async () => {
  for (const path of paths) {
    await assert.rejects(access(path), { code: "ENOENT" })
  }
  const panel = await readFile(
    new URL("../src/features/notifications/notification-control-panel.tsx", import.meta.url),
    "utf8",
  )
  assert.doesNotMatch(panel, /RegistrationCustomerReminderSettings/)
  assert.doesNotMatch(panel, /registration-customer-reminder-service/)
})
