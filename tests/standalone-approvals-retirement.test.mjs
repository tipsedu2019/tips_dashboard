import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"
import { buildAdminNavGroups, resolveAdminWorkspaceMeta } from "../src/lib/navigation.ts"
import { NOTIFICATION_WORKFLOW_OPTIONS, NOTIFICATION_GOOGLE_CHAT_WORKFLOW_OPTIONS } from "../src/features/notifications/notification-control-plane-types.ts"
import { getNotificationWorkflowAdapter } from "../src/features/notifications/server/notification-workflow-registry.ts"
import { validateNotificationAppDeepLink } from "../src/features/notifications/server/notification-app-deep-link.ts"
import { createGoogleChatProvider } from "../src/features/notifications/server/providers/google-chat-provider.ts"

const root = new URL("../", import.meta.url)

test("retired approvals has no menu, quick navigation metadata, route or client implementation", () => {
  for (const canManageAll of [true, false]) {
    for (const canUseAssistantOperations of [true, false]) {
      const groups = buildAdminNavGroups({ canManageAll, canUseAssistantOperations, canEditCurriculumPlanning: true, isAdmin: canManageAll })
      assert.doesNotMatch(JSON.stringify(groups), /approvals|전자결재/u)
      if (!canUseAssistantOperations) assert.match(JSON.stringify(groups), /makeup-requests/u)
    }
  }
  assert.notEqual(resolveAdminWorkspaceMeta("/admin/approvals").title, "전자결재")
  for (const path of ["src/app/admin/approvals/page.tsx", "src/features/approvals/approval-workspace.tsx", "src/features/approvals/approval-service.ts", "src/features/approvals/approval-numbered-service.ts"]) {
    assert.equal(existsSync(new URL(path, root)), false, path)
  }
})

test("retired approvals is unavailable in settings, notification adapters and deep links", () => {
  assert.equal(NOTIFICATION_WORKFLOW_OPTIONS.some(({ key }) => key === "approvals"), false)
  assert.equal(NOTIFICATION_GOOGLE_CHAT_WORKFLOW_OPTIONS.some(({ key }) => key === "approvals"), false)
  assert.equal(getNotificationWorkflowAdapter("approvals"), null)
  assert.ok(getNotificationWorkflowAdapter("makeup_requests"))
  assert.throws(() => validateNotificationAppDeepLink("/admin/approvals?approvalId=old", "approvals"), /notification_app_deep_link_invalid/u)
})

test("old approval provider contexts never issue an external request", async () => {
  let calls = 0
  const provider = createGoogleChatProvider({ fetch: async () => { calls += 1; throw new Error("unexpected provider request") } })
  const result = await provider.send({ workflow_key: "approvals", status: "sending", channel_key: "google_chat" })
  assert.equal(result.errorCode, "approvals_retired")
  assert.equal(calls, 0)
})

test("current improvement lists exclude approvals", () => {
  for (const path of ["docs/design/2026-09-12-premium-dashboard-task-cards.md", "docs/design/2026-09-12-premium-dashboard-master-plan.md", "docs/design/2026-09-09-dashboard-apple-redesign.md"]) {
    assert.doesNotMatch(readFileSync(new URL(path, root), "utf8"), /전자결재|\/admin\/approvals/u)
  }
})
