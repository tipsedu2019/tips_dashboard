import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("등록 예약에는 수동 리마인드 발송 대신 자동 상태만 표시한다", async () => {
  const source = await readFile(
    new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url),
    "utf8",
  )

  assert.doesNotMatch(source, /messageKind:\s*"appointment_reminder"/)
  assert.doesNotMatch(source, />\s*리마인드 알림톡\s*</)
  assert.match(source, />\s*예약 안내 알림톡\s*</)
  assert.match(source, /오전 10시 발송 예정/)
  assert.match(source, /리마인드 대상 아님 · 오늘 예약/)
  assert.match(source, /리마인드 대상 아님 · 오늘 변경/)
  assert.match(source, /리마인드 발송 완료/)
  assert.match(source, /리마인드 발송 결과 확인 필요/)
})
