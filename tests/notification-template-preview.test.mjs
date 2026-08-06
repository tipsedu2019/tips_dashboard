import assert from "node:assert/strict"
import test from "node:test"

import {
  buildNotificationTemplatePreview,
  toNotificationKoreanTemplate,
} from "../src/features/notifications/notification-template-preview.ts"

const variables = [
  { key: "student_name", token: "학생", piiClass: "student_name" },
  { key: "subjects", token: "과목", piiClass: "none" },
  { key: "scheduled_at", token: "일정", piiClass: "schedule" },
  { key: "place", token: "장소", piiClass: "location" },
  { key: "progress_line", token: "진행정보", piiClass: "none" },
]

test("알림 편집용 템플릿은 내부 키를 한국어 변수로 바꾸고 한국어 변수는 그대로 둔다", () => {
  assert.equal(
    toNotificationKoreanTemplate(
      "{student_name} · {subjects} · {학생} · {unknown_key}",
      variables,
    ),
    "{학생} · {과목} · {학생} · {unknown_key}",
  )
})

test("알림 미리보기는 한국어 변수에 안전한 예시값을 넣고 빈 선택 행을 정리한다", () => {
  assert.deepEqual(buildNotificationTemplatePreview({
    titleTemplate: "📅 [등록] {학생}의 방문상담이 예약됐어요",
    bodyTemplate: "[학생] {학생}\n[과목] {과목}\n[일정] {일정}\n[장소] {장소}\n{진행정보}",
    availableVariables: variables,
  }), {
    title: "📅 [등록] 김민서 학생의 방문상담이 예약됐어요",
    body: "[학생] 김민서 학생\n[과목] 영어 · 수학\n[일정] 8월 7일(금) 17:00\n[장소] 본관 상담실\n[진행] 관리팀이 다음 절차를 확인하고 있어요.",
  })

  assert.deepEqual(buildNotificationTemplatePreview({
    titleTemplate: "{학생} 알림",
    bodyTemplate: "첫 줄\n{없는변수}\n\n\n마지막 줄",
    availableVariables: variables,
  }), {
    title: "김민서 학생 알림",
    body: "첫 줄\n{없는변수}\n\n마지막 줄",
  })
})
