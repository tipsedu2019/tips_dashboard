import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const verifier = await readFile(
  new URL("../scripts/verify-ops-task-browser-workflow.mjs", import.meta.url),
  "utf8",
)

function functionBlock(name, nextName) {
  const start = verifier.indexOf(`async function ${name}`)
  assert.ok(start >= 0, `missing verifier function: ${name}`)
  const end = verifier.indexOf(`async function ${nextName}`, start)
  assert.ok(end > start, `missing verifier function tail: ${name}`)
  return verifier.slice(start, end)
}

test("the management browser smoke follows the dashboard bookmark to registration", () => {
  assert.match(verifier, /path:\s*"\/admin\/dashboard",\s*name:\s*"dashboard-bookmark",\s*expectedTexts:\s*\["등록"\],\s*interaction:\s*"registration-landing"/)
  const block = functionBlock("verifyRegistrationLanding", "chooseLinkedFixtureOption")
  for (const marker of [
    'url.pathname === "/admin/registration"',
    'getByRole("heading", { level: 1, name: "등록", exact: true })',
    'getByTestId("admin-nav-link-admin-registration")',
    'getByTestId("admin-nav-link-admin-dashboard")',
  ]) {
    assert.ok(block.includes(marker), `missing landing verification: ${marker}`)
  }
})

test("word-retest expected schedule verifier has three exact read-only role fixtures", () => {
  for (const role of ["assistant", "teacher", "admin"]) {
    assert.ok(
      verifier.includes(
        `/admin/word-retests?fixture=word-retest-expected-schedule&fixtureRole=${role}&role=`,
      ),
      `missing ${role} fixture route`,
    )
    assert.match(
      verifier,
      new RegExp(`name:\\s*"word-retest-expected-schedule-${role}-fixture"`),
    )
  }

  for (const marker of [
    'interaction: "word-retest-expected-schedule-fixture"',
    "installWordRetestFixtureSafetyGuards",
    "isWordRetestFixtureMutationRequest",
    '"/rest/v1/"',
    '"/api/google-chat"',
    '"/api/web-push"',
    '"/api/solapi"',
    '"/api/notifications/"',
    "assertNoMutationRequests",
    'route.interaction === "word-retest-expected-schedule-fixture"',
  ]) {
    assert.ok(verifier.includes(marker), `missing word-retest read-only fixture contract: ${marker}`)
  }
})

test("word-retest expected schedule verifier covers column order, memo, modal, and calendar", () => {
  const block = functionBlock(
    "verifyWordRetestExpectedScheduleFixture",
    "verifyWordRetestModeInteraction",
  )
  for (const column of [
    "상태",
    "본시험일",
    "응시예정일시",
    "담당선생님",
    "수업",
    "학생",
    "교재",
    "시험범위",
    "메모",
    "출제 개수",
    "커트라인",
    "맞은 개수",
    "결과",
    "다음 액션",
  ]) {
    assert.ok(verifier.includes(`"${column}"`), `missing word-retest column contract: ${column}`)
  }
  for (const marker of [
    "WORD_RETEST_EXPECTED_SCHEDULE_COLUMNS",
    "보이는 단어 재시험 전체 선택",
    "기존 업무 메모에서 표시",
    "사전 준비가 필요한 학생",
    "최비연결",
    'data-word-retest-edit-mode="expected_only"',
    "영어 단어 재시험 추가",
    'getByRole("grid", { name: "본시험일" })',
    "7월 7회차",
    "7월 8회차",
    "7월 9회차",
    "보강",
    '["교재", "시험범위", "메모", "출제 개수", "커트라인(합격 개수)"]',
    "fixtureSafety.assertNoMutationRequests",
  ]) {
    assert.ok(block.includes(marker), `missing word-retest verifier behavior: ${marker}`)
  }
  assert.doesNotMatch(block, /응시예정일시 저장/)
  assert.doesNotMatch(block, /type:\s*"submit"/)
})

test("word-retest-only fixture lane does not require a local Supabase data URL", () => {
  assert.match(
    verifier,
    /const deterministicFixtureOnly = getAuthenticatedRoutes\(\)\.every\(\(route\) => \([\s\S]*?registration-subject-track-fixture[\s\S]*?word-retest-expected-schedule-fixture[\s\S]*?\)\)/,
  )
  assert.match(verifier, /if \(!deterministicFixtureOnly && !authorizedSupabaseUrl\)/)
  assert.match(verifier, /if \(!deterministicFixtureOnly\) assertAuthorizedLocalFixtureDatabase/)
})
