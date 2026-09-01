import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  getRegistrationManagementNotificationReadiness,
} from "../src/features/tasks/registration-consultation-notification.js"

const root = new URL("../", import.meta.url)

test("management notification readiness follows message facts without gating status edits", () => {
  assert.deepEqual(getRegistrationManagementNotificationReadiness({
    workflowStatus: "consultation_requested",
    studentName: "",
    subject: "영어",
    schoolGrade: "",
    inquiryAt: "",
  }), {
    ready: false,
    eventKey: "registration.case_created",
    missingFields: ["학생 이름", "학년", "문의 시각"],
  })

  assert.deepEqual(getRegistrationManagementNotificationReadiness({
    workflowStatus: "consultation_requested",
    studentName: "김학생",
    subject: "영어",
    schoolGrade: "중2",
    inquiryAt: "2026-09-01T10:00:00+09:00",
  }), {
    ready: true,
    eventKey: "registration.case_created",
    missingFields: [],
  })

  assert.deepEqual(getRegistrationManagementNotificationReadiness({
    workflowStatus: "waiting_current_class",
    studentName: "김학생",
    subject: "영어",
    schoolGrade: "",
    inquiryAt: "",
  }), {
    ready: true,
    eventKey: "registration.waiting_transitioned",
    missingFields: [],
  })

  assert.deepEqual(getRegistrationManagementNotificationReadiness({
    workflowStatus: "registered",
    studentName: "김학생",
    subject: "영어",
    schoolGrade: "중2",
    inquiryAt: "2026-09-01T10:00:00+09:00",
  }), {
    ready: false,
    eventKey: null,
    missingFields: ["현재 진행상태에는 보낼 관리 알림이 없습니다"],
  })
})

test("status save and explicit management notification are separate UI actions", async () => {
  const editor = await readFile(new URL(
    "src/features/tasks/registration-track-editor.tsx",
    root,
  ), "utf8")
  const statusSave = editor.slice(
    editor.indexOf("async function changeWorkflowStatus"),
    editor.indexOf("async function sendRegistrationManagementNotification"),
  )
  const notificationSend = editor.slice(
    editor.indexOf("async function sendRegistrationManagementNotification"),
    editor.indexOf("const migrationReviewPanelId"),
  )

  assert.match(statusSave, /await setRegistrationWorkflowStatus/u)
  assert.doesNotMatch(statusSave, /ensureRegistrationWorkflowNotificationSourceIds/u)
  assert.doesNotMatch(statusSave, /dispatchRegistrationManagementNotificationSources/u)
  assert.match(notificationSend, /ensureRegistrationWorkflowNotificationSourceIds/u)
  assert.match(notificationSend, /dispatchRegistrationManagementNotificationSources/u)
  assert.match(notificationSend, /requestKey: crypto\.randomUUID\(\)/u)
  assert.match(editor, /관리팀 알림 보내기/u)
  assert.match(editor, /canManageCase && notificationReadiness\.eventKey/u)
  assert.match(editor, /studentName: detail\.task\.studentName,/u)
  assert.doesNotMatch(editor, /studentName: detail\.task\.studentName \|\| detail\.task\.title/u)
  assert.match(editor, /notificationReadiness\.ready/u)
  assert.match(editor, /notificationReadiness\.missingFields\.join/u)
})

test("database rechecks notification readiness and uses a non-retryable domain error", async () => {
  const sql = await readFile(new URL(
    "supabase/migrations/20260901110400_registration_notification_readiness_decoupling.sql",
    root,
  ), "utf8")

  assert.match(sql, /actor\.role in \('admin', 'staff'\)/u)
  assert.match(sql, /registration_management_notification_not_ready/u)
  assert.match(sql, /errcode = '23514'/u)
  assert.match(sql, /student_name/u)
  assert.match(sql, /school_grade/u)
  assert.match(sql, /inquiry_at/u)
  assert.doesNotMatch(sql, /errcode = '40001'/u)
})
