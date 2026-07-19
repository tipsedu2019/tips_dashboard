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

test("registration dialog verifier requires the fixed six-section application and rejects split editors", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const start = source.indexOf("async function verifyRegistrationSinglePageDialog")
  const end = source.indexOf("async function verifyFlatOperationDialog", start)
  const verifier = source.slice(start, end)

  for (const title of ["문의 정보", "레벨테스트", "상담", "등록·대기 정보", "입학 처리", "자동 이력"]) {
    assert.ok(verifier.includes(title), `single-page verifier is missing ${title}`)
  }
  assert.match(verifier, /data-registration-application-section/)
  assert.match(verifier, /aria-disabled/)
  assert.match(verifier, /현재 업무/)
  assert.match(verifier, /section\[aria-label=.+예약/)
  assert.match(verifier, /closest\('\[data-registration-application-host\]'\)|closest\("\[data-registration-application-host\]"\)/)
  assert.doesNotMatch(verifier, /retiredLabel of \["전화상담 예약일시"[\s\S]*?"입학 처리"/)
})

test("credentialed registration fixture verifier executes the whole case workflow without providers", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)

  for (const marker of [
    "fixture-task-all-terminal",
    "fixture-task-cross-stage",
    "fixture-task-dual-test",
    "data-registration-application-host",
    "data-registration-application-mode",
    "registration case row",
    "setNextFault",
    "option_data_once",
    "common_revision_conflict_once",
    "내가 저장하려던 요청 사항",
    "다른 담당자가 먼저 저장한 요청 사항",
    "다시 불러오기",
    "role=alert",
    "subject-qualified accessible name",
    "mobile action DOM order",
    "automatic history",
    "appointmentId",
    "target_reconciliation",
    "notificationReceipts",
    "externalCalls",
    "interceptedProviderRequests",
  ]) {
    assert.ok(verifier.includes(marker), `registration fixture verifier is missing ${marker}`)
  }

  assert.match(verifier, /getByLabel\("영어 다음 업무"[\s\S]*?selectOption\("direct_phone"\)/)
  assert.match(verifier, /getByLabel\("수학 다음 업무"[\s\S]*?selectOption\("level_test"\)/)
  assert.match(verifier, /const createApplicationHost = [^\n]*data-registration-application-host/)
  assert.match(verifier, /createApplicationHost\.evaluateHandle|createApplicationHost\.elementHandle/)
  assert.match(verifier, /isConnected/)
  assert.match(verifier, /saveCreateButton\.click\(\)[\s\S]*?createApplicationHost\.waitFor\(\{ state: "visible"/)
  assert.match(verifier, /data-registration-application-mode[\s\S]*?detail/)
  assert.match(verifier, /createdResult\.taskId[\s\S]*?new URL\(page\.url\(\)\)/)
  assert.match(verifier, /createdStudentName[\s\S]*?과목별 진행 현황/)
  assert.match(verifier, /registration_case_created|첫 자동 이력/)
  assert.doesNotMatch(verifier, /createDialog\.waitFor\(\{ state: "hidden"/)
  assert.doesNotMatch(verifier, /name: `\[\$\{subject\}\] \$\{studentName\} 상세`/)

  for (const endpoint of [
    '"**/api/google-chat"',
    '"**/api/web-push"',
    '"**/api/solapi/**"',
    '"**/api/registration/consultation-notification"',
    '"**/api/notifications/worker"',
    '"**/api/notifications/connections"',
    '"**/api/notifications/legacy/**"',
  ]) {
    assert.ok(verifier.includes(endpoint), `provider interception is missing ${endpoint}`)
  }
  assert.match(verifier, /request\(\)\.method\(\) !== "POST"[\s\S]*?route\.continue\(\)/)
  assert.match(verifier, /permission|Notification\.requestPermission/)
  assert.match(verifier, /self-test/)
  assert.match(verifier, /createdResult\.notificationJobs\.length\s*!==\s*0/)
  assert.match(verifier, /savedSnapshot\.counts\.notificationReceipts\s*!==\s*0/)
  assert.match(verifier, /savedSnapshot\.counts\.externalCalls\s*!==\s*0/)
  assert.match(verifier, /interceptedProviderRequests\.length\s*!==\s*0/)
  assert.match(verifier, /final fixture snapshot/)
  assert.match(verifier, /installRegistrationFixtureSafetyGuards/)
  assert.match(verifier, /assertRegistrationFixtureSafetySnapshot/)
})

test("registration fixture verifier preserves sibling drafts and performs accessibility checks", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)

  assert.match(verifier, /unsavedInquiryRequestNote/)
  assert.match(verifier, /phone-consultation save|phone consultation save/)
  assert.match(verifier, /dirty-close confirmation/)
  assert.match(verifier, /discarded|저장하지 않고 닫기/)
  assert.match(verifier, /getByRole\("alert"\)/)
  assert.match(verifier, /document\.activeElement/)
  assert.match(verifier, /영어\|수학/)
  assert.match(verifier, /getAttribute\("aria-label"\)|ariaLabel/)
  assert.match(verifier, /compareDocumentPosition|getBoundingClientRect/)
  assert.match(verifier, /data-registration-state[\s\S]*?ariaLabel[\s\S]*?describedBy[\s\S]*?text/)
  assert.match(verifier, /saved:\s*\/\^\(저장된 신청서\|저장 완료\)\$\//)
  for (const state of ["locked", "current", "saved", "failed"]) {
    assert.match(verifier, new RegExp(`assertNonColorWorkflowState\\([^\\n]+"${state}"`))
  }
  assert.match(verifier, /\[data-registration-track-id\][\s\S]*?input/)
  assert.match(verifier, /\[data-registration-appointment-focus\][\s\S]*?(영어\|수학\|적용 과목\|예약)/)
  assert.match(verifier, /data-registration-primary-action/)
  assert.match(verifier, /data-registration-state/)
  assert.match(verifier, /first invalid control|first inquiry blocker/)
  assert.match(verifier, /if \(!\(await action\.isVisible/)
})

test("registration fixture verifier opens a real calendar item before it mutates the dual-test appointment", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)
  const calendarOpen = verifier.indexOf("openRegistrationSubjectTrackFixtureCalendarItem")
  const dualMutation = verifier.indexOf("예약 및 과목별 결과 관리")
  assert.ok(calendarOpen >= 0, "calendar interaction helper is missing")
  assert.ok(dualMutation >= 0, "dual-test mutation is missing")
  assert.ok(calendarOpen < dualMutation, "calendar item must be opened before later dual-test mutations")
  assert.match(verifier, /data-registration-calendar-item/)
  assert.match(verifier, /appointmentId[\s\S]*?fixture-appointment-dual-test/)
  assert.match(verifier, /taskId[\s\S]*?fixture-task-dual-test/)
  assert.match(verifier, /registration-application-level_test/)
})
