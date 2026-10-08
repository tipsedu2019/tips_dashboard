import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { listNotificationContentContracts } from "../src/features/notifications/notification-content-contract-registry.ts"
import { buildWithdrawalNotificationPresentation } from "../src/features/notifications/server/presentation/withdrawal-notification-presentation.ts"
import { renderNotificationSnapshot } from "../src/features/notifications/server/notification-worker.ts"
import { buildGoogleChatCardPayload } from "../src/features/notifications/server/providers/google-chat-provider.ts"
import { installExternalRequestTraps } from "../scripts/run-notification-content-no-send-qa.mjs"

const migrationUrl = new URL(
  "../supabase/migrations/20261006080000_withdrawal_chat_last_lesson_wording.sql",
  import.meta.url,
)
const fixtureUrl = new URL("./fixtures/notification-content-golden.json", import.meta.url)

async function wordingRows() {
  const migration = await readFile(migrationUrl, "utf8")
  return [...migration.matchAll(/\('(withdrawal\.(?:submitted|completed))',\s*'([^']+)',\s*'([^']+)'\)/gu)]
    .map(([, eventKey, oldLine, newLine]) => ({ eventKey, oldLine, newLine }))
}

test("퇴원 Chat은 마지막 수업일과 다음 회차 제외를 안내하고 이미 제외된 상태를 보존한다", async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"))
  const rows = await wordingRows()
  assert.equal(rows.length, 4, "both events must cover Korean and internal variable tokens")
  const trap = installExternalRequestTraps()
  try {
    for (const { eventKey, oldLine, newLine } of rows) {
      const korean = newLine.includes("{제외일}")
      const golden = fixture.eventGoldens.find((entry) => entry.eventKey === eventKey)
      const destinations = eventKey === "withdrawal.completed"
        ? [["management_team", "google_chat.management", "management"],
          ["subject_team", "google_chat.math", "math"]]
        : [["management_team", "google_chat.management", "management"]]

      for (const [audienceKey, connectionKey, destinationTeam] of destinations) {
        const contract = listNotificationContentContracts().find((entry) =>
          entry.eventKey === eventKey && entry.audienceKey === audienceKey && entry.channelKey === "google_chat")
        assert.ok(contract)
        const variables = contract.contract.availableVariables.map((variable) => ({
          ...variable, token: korean ? variable.token : variable.key,
        }))
        const convert = (template) => korean
          ? variables.reduce((value, variable) => value.replaceAll(`{${variable.key}}`, `{${variable.token}}`), template)
          : template
        const originalBody = convert(golden.bodyTemplate)
        assert.ok(originalBody.split("\n").includes(oldLine))
        const template = {
          titleTemplate: convert(golden.titleTemplate),
          bodyTemplate: originalBody.replace(oldLine, newLine),
          allowedVariables: variables,
          payloadSchemaVersion: 1,
        }
        const usedKeys = variables.filter((variable) =>
          `${template.titleTemplate}\n${template.bodyTemplate}`.includes(`{${variable.token}}`))
          .map((variable) => variable.key)
        const renderContext = buildWithdrawalNotificationPresentation({
          workflowKey: "withdrawal", eventKey, payloadSchemaVersion: 1,
          ruleVariantKey: "immediate", audienceKey, connectionKey, destinationTeam,
          channelKey: "google_chat",
          contractIdentity: contract,
          requestedContextKeys: usedKeys,
          scheduledFor: "2026-10-01T01:00:00.000Z",
          payload: {
            task_status: eventKey === "withdrawal.completed" ? "done" : "requested",
            student_name: "김민서", selected_subject: "수학", notification_subjects: ["수학"],
            selected_class: "중2 수학 A반",
            requested_withdrawal_date: "2026-10-06", requested_withdrawal_round: "8회차",
            applied_withdrawal_date: "2026-10-08", applied_withdrawal_round: "9회차",
            requester_name: "박지영", other_active_subjects: ["영어"],
            reason: "학습 일정 조정", memo: "마지막 수업까지 참여",
          },
        })
        const rendered = renderNotificationSnapshot({
          workflowKey: "withdrawal", payloadSchemaVersion: 1, template, renderContext,
          href: "/admin/withdrawal?flow=operations&taskId=10000000-0000-4000-8000-000000000005",
        })
        const lastLesson = eventKey === "withdrawal.completed" ? "10월 8일(목) · 9회차" : "10월 6일(화) · 8회차"
        const scheduleLine = `[일정] 퇴원기준일(마지막 수업일): ${lastLesson}`
        assert.ok(rendered.renderedBody.split("\n").includes(scheduleLine))
        const policyLine = "명단에 남아 있는 학생은 퇴원기준일까지 수업을 진행하고, 그다음 회차부터 수업 명단에서 제외 예정입니다. 이미 제외된 학생은 기존 제외 상태를 유지합니다."
        assert.ok(rendered.renderedBody.split("\n").includes(policyLine))
        assert.doesNotMatch(rendered.renderedBody, /\d+회차부터 제외|\{[^}]+\}/u)
        assert.ok(rendered.renderedBody.includes("[수업] 중2 수학 A반"))
        const card = buildGoogleChatCardPayload({
          workflow_key: "withdrawal", rendered_title: rendered.renderedTitle,
          rendered_body: rendered.renderedBody, href: rendered.href,
        })
        assert.equal(card.ok, true)
        assert.ok(card.payload.cardsV2[0].card.sections[0].widgets[0].textParagraph.text.includes(scheduleLine))
        assert.ok(card.payload.cardsV2[0].card.sections[0].widgets[0].textParagraph.text.includes(policyLine))
      }
    }
    assert.equal(trap.attempts.length, 0, "render and card construction must make no external requests")
  } finally {
    trap.restore()
  }
})

test("문구 migration은 일치하는 시스템 Chat 템플릿만 새 버전으로 만들고 기존 업무 상태는 건드리지 않는다", async () => {
  const migration = await readFile(migrationUrl, "utf8")
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/iu)
  assert.match(migration, /rule_row\.workflow_key = 'withdrawal'/u)
  assert.match(migration, /rule_row\.channel_key = 'google_chat'/u)
  assert.match(migration, /active_template\.created_actor_kind = 'system'/u)
  assert.match(migration, /active_template\.created_by is null/u)
  assert.match(migration, /old_line = any\(pg_catalog\.string_to_array/u)
  assert.match(migration, /for update of rule_row/iu)
  assert.match(migration, /insert into dashboard_private\.notification_templates/iu)
  assert.match(migration, /notification_seed_template_checksum_v1/u)
  assert.match(migration, /notification_template_compliance_v1/u)
  assert.doesNotMatch(migration, /update\s+dashboard_private\.notification_templates/iu)
  assert.doesNotMatch(migration, /\b(?:delete|truncate|create|alter|grant|revoke)\b/iu)
  assert.doesNotMatch(migration, /notification_(?:events|deliveries|runtime_flags|dispatch_ownership_claims|rule_reconciliation_jobs|target_reconciliation_jobs)/u)
  assert.doesNotMatch(migration, /\b(?:enabled|retry_policy|timing_config|students|classes|student_ids|class_ids)\s*=/iu)
})
