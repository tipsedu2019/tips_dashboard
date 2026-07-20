import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const verifierUrl = new URL("../scripts/verify-ops-task-browser-workflow.mjs", import.meta.url)

function registrationVerifier(source) {
  const start = source.indexOf("async function verifyRegistrationSubjectTrackFixture")
  const end = source.indexOf("async function login", start)
  assert.ok(start >= 0 && end > start, "registration fixture verifier must be present")
  return source.slice(start, end)
}

test("registration verifier targets the refined shared application contract", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)

  for (const marker of [
    "자동 이력 보기",
    "과목별 등록 진행",
    "registration-subject-tab-",
    "학년을 먼저 선택",
    "기존 입력",
  ]) {
    assert.ok(verifier.includes(marker), `registration verifier is missing ${marker}`)
  }

  assert.match(verifier, /data-registration-application-section="placement"/)
  assert.doesNotMatch(verifier, /data-registration-application-section="enrollment"/)
  assert.doesNotMatch(verifier, /data-registration-application-section="history"/)
})

test("create verification is subject-first, grade-scoped, and never saves", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)

  assert.match(verifier, /getByRole\("button", \{ name: "등록 추가", exact: true \}\)/)
  assert.match(verifier, /\[data-registration-focus="subject"\] button\[aria-pressed\]/)
  assert.match(verifier, /compareDocumentPosition/)
  assert.match(verifier, /getByLabel\(\/\^학년\//)
  assert.match(verifier, /getByLabel\(\/\^학교\//)
  assert.match(verifier, /selectOption\("고1"\)/)
  assert.match(verifier, /새봄고/)
  assert.match(verifier, /새봄초|새봄중/)
  assert.match(verifier, /getByRole\("button", \{ name: "자동 이력 보기" \}\)[\s\S]*?count\(\)/)
  assert.doesNotMatch(verifier, /getByRole\("checkbox"/)
  assert.doesNotMatch(verifier, /saveCreateButton|prematureSaveButton|createdResult|replayLastFixtureCreate/)
})

test("saved detail verification switches every subject panel and preserves a reversible draft", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)

  assert.match(verifier, /fixture-task-dual-test/)
  assert.match(verifier, /getByRole\("tab", \{ name: \/영어\//)
  assert.match(verifier, /getByRole\("tab", \{ name: \/수학\//)
  assert.match(verifier, /\[role="tabpanel"\]\[data-registration-subject="수학"\]/)
  assert.match(verifier, /\[role="tabpanel"\]\[data-registration-subject="영어"\]/)
  assert.match(verifier, /waitFor\(\{ state: "visible"/)
  assert.match(verifier, /waitFor\(\{ state: "hidden"/)
  assert.match(verifier, /getByLabel\("요청 사항"/)
  assert.match(verifier, /inputValue\(\)/)
  assert.match(verifier, /data-registration-appointment-plan-action/)
  assert.match(verifier, /appointmentId/)
  assert.match(verifier, /data-registration-appointment-subjects/)
  assert.match(verifier, /data-registration-application-section="placement"/)
  assert.match(verifier, /data-registration-application-section="admission"/)
})

test("history popover verifies content, focus return, and isolated Escape behavior", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)

  assert.match(verifier, /getByRole\("button", \{ name: "자동 이력 보기" \}\)/)
  assert.match(verifier, /getByLabel\("등록 자동 이력"\)/)
  assert.match(verifier, /getByLabel\("과목"/)
  assert.match(verifier, /getByLabel\("단계"/)
  assert.match(verifier, /document\.activeElement/)
  assert.match(verifier, /keyboard\.press\("Escape"\)/)
  assert.match(verifier, /scrollTop/)
  assert.match(verifier, /historyButton\.focus/)
  assert.doesNotMatch(verifier, /locator\('\[data-registration-application-section="history"\]'/)
})

test("fixture verification remains provider-zero and excludes every send or retry mutation", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)

  for (const endpoint of [
    '"**/api/google-chat"',
    '"**/api/web-push"',
    '"**/api/solapi/**"',
    '"**/api/registration/consultation-notification"',
    '"**/api/notifications/worker"',
  ]) {
    assert.ok(verifier.includes(endpoint), `provider interception is missing ${endpoint}`)
  }
  assert.match(verifier, /assertRegistrationFixtureSafetySnapshot/)
  assert.match(verifier, /assertNoInterceptedProviderRequests/)

  for (const prohibited of [
    /입학신청서 발송[^\n]*click\(/,
    /다시 보내기[^\n]*click\(/,
    /notification retry[^\n]*click\(/i,
    /공통 정보 저장[^\n]*click\(/,
    /과목 저장[^\n]*click\(/,
    /등록 완료[^\n]*click\(/,
  ]) {
    assert.doesNotMatch(verifier, prohibited)
  }
})
