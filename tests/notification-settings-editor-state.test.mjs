import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import {
  buildMentionDraftPatch,
  createMentionDraft,
  createTemplateEditorDraft,
  notificationSettingsLocationUrl,
  readNotificationSettingsLocation,
  rebaseMentionDraft,
  registrationNotificationDisplayRule,
} from "../src/features/notifications/notification-settings-editor-state.ts"

const setting = (id, enabled, revision = "1", editable = true) => ({ ruleId: id, workflowKey: "registration", eventKey: "registration.case_created", channelKey: "google_chat", mentionEnabled: enabled, revision, updatedAt: null, editable })

test("registration progress display labels match the registration workflow without changing stored identities or text", () => {
  for (const [eventKey, eventLabel] of [["registration.case_created", "상담 신청"], ["registration.consultation_completed", "상담 완료"], ["registration.waiting_transitioned", "대기 신청"], ["registration.admission_started", "등록 신청"]]) {
    const original = { workflowKey: "registration", channelKey: "google_chat", eventKey, eventLabel: "이전 표시 이름", template: { bodyTemplate: "원래 문구" } }
    assert.deepEqual(registrationNotificationDisplayRule(original), { ...original, eventLabel })
    assert.equal(original.eventLabel, "이전 표시 이름")
  }
  const other = { workflowKey: "tasks", channelKey: "google_chat", eventKey: "task.created", eventLabel: "요청 생성" }
  assert.equal(registrationNotificationDisplayRule(other), other)
})

test("mention edits stay local and one atomic patch contains only editable changed rows with their revisions", () => {
  const base = new Map([["progress", setting("progress", false, "7")], ["archive", setting("archive", false, "3", false)], ["visit", setting("visit", true, "8")]])
  const draft = createMentionDraft(base)
  draft.set("progress", true)
  draft.set("archive", true)
  assert.equal(base.get("progress").mentionEnabled, false)
  assert.deepEqual(buildMentionDraftPatch(base, draft), { mentionPatch: { progress: true }, expectedMentionRevisions: { progress: "7" } })
  draft.set("progress", false)
  assert.deepEqual(buildMentionDraftPatch(base, draft), { mentionPatch: {}, expectedMentionRevisions: {} })
})

test("explicit keep-local after conflict preserves unrelated remote changes and drops removed or archived edits", () => {
  const base = new Map([["local", setting("local", false)], ["remote", setting("remote", false)], ["retired", setting("retired", false)], ["removed", setting("removed", false)]])
  const local = createMentionDraft(base)
  for (const key of ["local", "retired", "removed"]) local.set(key, true)
  const remote = new Map([["local", setting("local", false, "2")], ["remote", setting("remote", true, "3")], ["retired", setting("retired", false, "2", false)]])
  const rebased = rebaseMentionDraft(base, local, remote)
  assert.deepEqual([...rebased], [["local", true], ["remote", true], ["retired", false]])
  assert.deepEqual(buildMentionDraftPatch(remote, rebased), { mentionPatch: { local: true }, expectedMentionRevisions: { local: "2" } })
})

test("opening and canceling an editor cannot mutate the existing parent draft, including nested schedules", () => {
  const parent = { enabled: false, titleTemplate: "기존 제목", bodyTemplate: "기존 본문", scheduleConfig: { anchorKey: "scheduled_at", timezone: "Asia/Seoul", leadMinutes: 30 } }
  const first = createTemplateEditorDraft(parent)
  first.titleTemplate = "취소할 수정"
  first.scheduleConfig.leadMinutes = 60
  assert.equal(parent.titleTemplate, "기존 제목")
  assert.equal(parent.scheduleConfig.leadMinutes, 30)
  const reopened = createTemplateEditorDraft(parent)
  assert.deepEqual(reopened, parent)
  assert.notEqual(reopened.scheduleConfig, parent.scheduleConfig)
})

test("settings links preserve workflow, channel and group while rejecting retired or unknown state", () => {
  const location = readNotificationSettingsLocation(new URLSearchParams("workflow=registration&section=rules&group=visit"))
  assert.deepEqual(location, { workflow: "registration", section: "rules", group: "visit" })
  assert.equal(notificationSettingsLocationUrl("https://example.test/admin/settings/notifications?keep=1#top", location), "/admin/settings/notifications?keep=1&workflow=registration&section=rules&group=visit#top")
  assert.equal(notificationSettingsLocationUrl("https://example.test/admin/settings/notifications?group=visit", { ...location, section: "customer" }), "/admin/settings/notifications?workflow=registration&section=customer")
  assert.deepEqual(readNotificationSettingsLocation(new URLSearchParams("workflow=word_retests&section=unknown&group=unknown")), { workflow: "word_retests", section: "rules", group: null })
  assert.deepEqual(readNotificationSettingsLocation(new URLSearchParams("workflow=registration&group=subject")), { workflow: "registration", section: "rules", group: "subject" })
})

test("settings UI stages mentions, gives template cancel an isolated draft, and keeps historical rules read-only", async () => {
  const panel = await readFile(new URL("../src/features/notifications/notification-control-panel.tsx", import.meta.url), "utf8")
  const groups = await readFile(new URL("../src/features/notifications/registration-notification-settings-groups.tsx", import.meta.url), "utf8")
  const edit = panel.slice(panel.indexOf("function TemplateEditorFields"), panel.indexOf("type ConnectionsViewProps"))
  assert.match(edit, /React\.useState\(\(\) => createTemplateEditorDraft/)
  assert.match(edit, /onChange=\{\(event\) => updateEditor/)
  assert.match(edit, /onClick=\{\(\) => onOpenChange\(false\)\}>취소/)
  assert.match(edit, /변경사항에 반영/)
  assert.doesNotMatch(panel, /mentionService\.saveMentionSetting/)
  assert.match(panel, /const dirty = React\.useMemo[\s\S]*Object\.keys\(mentionChanges\.mentionPatch\)/)
  assert.match(panel, /service\.saveControlPlane\(\{[\s\S]*?\.\.\.mentionChanges/)
  assert.match(groups, /getRegistrationNotificationRulePolicy/)
  const archive = groups.slice(groups.indexOf('{group === "archive" ? ('), groups.indexOf(') : selectedRule && value'))
  assert.doesNotMatch(archive, /renderControl|Switch|onChange|onCheckedChange/)
})
