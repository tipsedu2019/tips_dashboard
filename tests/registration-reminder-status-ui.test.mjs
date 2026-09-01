import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("등록 예약 저장과 알림 발송을 분리하고 과거 리마인드 이력만 표시한다", async () => {
  const source = await readFile(
    new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url),
    "utf8",
  )

  assert.doesNotMatch(source, /messageKind:\s*"appointment_reminder"/)
  assert.doesNotMatch(source, />\s*리마인드 알림톡\s*</)
  assert.match(source, />\s*예약 안내 알림톡\s*</)
  assert.doesNotMatch(source, /오전 10시 발송 예정/)
  assert.doesNotMatch(source, /리마인드 대상 아님 · 오늘 예약/)
  assert.doesNotMatch(source, /리마인드 대상 아님 · 오늘 변경/)
  assert.match(source, /과거 고객 리마인드 발송 이력 · 발송 완료/)
  assert.match(source, /과거 고객 리마인드 발송 이력 · 전달 여부 확인 필요/)
  assert.match(source, /과거 고객 리마인드 처리 이력 · 상태 확인 필요/)
  assert.match(source, /고객·관리 알림은 별도 명시 발송이며 자동으로 전송되지 않습니다/)
})
