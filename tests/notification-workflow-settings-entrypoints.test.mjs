import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const workspacePaths = [
  "../src/features/approvals/approval-workspace.tsx",
  "../src/features/makeup-requests/makeup-request-workspace.tsx",
  "../src/features/tasks/ops-task-workspace.tsx",
]

test("workflow screens delegate notification configuration to the central Google Chat page", async () => {
  for (const pathname of workspacePaths) {
    const source = await readFile(new URL(pathname, import.meta.url), "utf8")
    assert.doesNotMatch(source, /NotificationControlPanel/, pathname)
    assert.doesNotMatch(source, /useNotificationControlPlaneAvailability/, pathname)
    assert.doesNotMatch(source, /aria-label="(?:전자결재|휴보강) 알림 설정"/, pathname)
    assert.doesNotMatch(source, /등록 알림 설정|전반 알림 설정|퇴원 알림 설정/, pathname)
  }
})
