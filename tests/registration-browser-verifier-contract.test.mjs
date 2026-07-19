import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const verifierUrl = new URL("../scripts/verify-ops-task-browser-workflow.mjs", import.meta.url)
const appointmentEditorUrl = new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url)
const enrollmentEditorUrl = new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url)
const trackActionsUrl = new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url)
const registrationCreateUrl = new URL("../src/features/tasks/registration-application-create.tsx", import.meta.url)
const registrationTrackEditorUrl = new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url)

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
  assert.match(verifier, /\[data-registration-appointment-shared-controls\][\s\S]*?data-registration-appointment-subjects/)
  assert.match(verifier, /participantSubjects\.filter\(\(subject\) => !label\.includes\(subject\)\)/)
  assert.match(verifier, /data-registration-primary-action/)
  assert.match(verifier, /data-registration-state/)
  assert.match(verifier, /first invalid control|first inquiry blocker/)
  assert.match(verifier, /if \(!\(await action\.isVisible/)
})

test("registration fixture verifier uses the rendered subject checkbox controls before option fault retry", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)

  assert.match(verifier, /createDialog\.getByRole\("checkbox", \{ name: "영어", exact: true \}\)\.check\(\)/)
  assert.match(verifier, /createDialog\.getByRole\("checkbox", \{ name: "수학", exact: true \}\)\.check\(\)/)
  assert.match(verifier, /optionFaultHost\.getByRole\("checkbox", \{ name: "영어", exact: true \}\)\.check\(\)[\s\S]*?getByLabel\("영어 다음 업무", \{ exact: true \}\)\.selectOption\("direct_phone"\)/)
  assert.match(verifier, /optionFaultDirector[\s\S]*?optionFaultRetry\.click\(\)[\s\S]*?optionFaultDirector\.isEnabled\(\)[\s\S]*?optionFaultDirector\.locator\("option"\)/)
})

test("registration fixture verifier snapshots every destructive navigation through one wrapper", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)
  const wrapperStart = verifier.indexOf("async function navigateRegistrationFixture")
  const wrapperEnd = verifier.indexOf("\n\n  async function openRegistrationSubjectTrackFixtureCase", wrapperStart)

  assert.ok(wrapperStart >= 0 && wrapperEnd > wrapperStart, "fixture navigation wrapper is missing")
  const wrapper = verifier.slice(wrapperStart, wrapperEnd)
  const withoutWrapper = verifier.slice(0, wrapperStart) + verifier.slice(wrapperEnd)
  assert.match(wrapper, /recordFixtureSafetySnapshot/)
  assert.match(verifier, /recordFixtureSafetySnapshot[\s\S]*?assertRegistrationFixtureSafetySnapshot[\s\S]*?fixtureSafetySnapshots\.push/)
  assert.match(wrapper, /page\.goto\(/)
  assert.doesNotMatch(withoutWrapper, /page\.goto\(/)
  assert.match(verifier, /initial fixture snapshot/)
  assert.match(verifier, /pre-navigation fixture snapshot/)
  assert.match(verifier, /final fixture snapshot/)
  assert.match(verifier, /fixtureSafetySnapshots\.length/)
  assert.match(verifier, /fixtureSafetySnapshots\.at\(-1\)/)
  assert.match(verifier, /fixtureSafetySnapshots\.reduce/)
  assert.match(verifier, /fixtureSafetyAggregate\.notificationReceipts/)
  assert.match(verifier, /fixtureSafetyAggregate\.externalCalls/)
})

test("registration primary-action markers own the data controls they commit", async () => {
  const [verifierSource, appointmentSource, enrollmentSource, actionsSource, createSource, trackEditorSource] = await Promise.all([
    readFile(verifierUrl, "utf8"),
    readFile(appointmentEditorUrl, "utf8"),
    readFile(enrollmentEditorUrl, "utf8"),
    readFile(trackActionsUrl, "utf8"),
    readFile(registrationCreateUrl, "utf8"),
    readFile(registrationTrackEditorUrl, "utf8"),
  ])
  const verifier = registrationVerifier(verifierSource)
  const mobileActionStart = verifier.indexOf("async function assertMobileActionDomOrder")
  const mobileActionEnd = verifier.indexOf("async function assertNonColorWorkflowState", mobileActionStart)
  assert.ok(mobileActionStart >= 0 && mobileActionEnd > mobileActionStart, "mobile action order verifier is missing")
  const mobileActionVerifier = verifier.slice(mobileActionStart, mobileActionEnd)

  assert.match(verifier, /data-registration-action-owner/)
  assert.match(verifier, /querySelectorAll\('\[data-registration-primary-action\]'/)
  assert.match(verifier, /closest\('\[data-registration-action-owner\]'/)
  assert.match(verifier, /lastOwnedField/)
  assert.match(verifier, /data-registration-appointment-subjects/)
  assert.match(verifier, /data-registration-appointment-shared-controls/)
  assert.doesNotMatch(mobileActionVerifier, /action\.matches\(':disabled'\)/)
  assert.match(mobileActionVerifier, /querySelectorAll\('input, select, textarea'\)/)
  assert.match(mobileActionVerifier, /owner has no visible data field/)
  assert.doesNotMatch(mobileActionVerifier, /window\.innerWidth/)
  assert.match(verifier, /sharedAppointment[\s\S]*?assertMobileActionDomOrder\(dualDialog\)/)
  assert.match(verifier, /reloadedAppointment[\s\S]*?assertMobileActionDomOrder\(dualDialog\)/)
  assert.match(verifier, /multipleDialog[\s\S]*?assertMobileActionDomOrder\(multipleDialog\)/)
  assert.match(appointmentSource, /data-registration-action-owner/)
  assert.match(appointmentSource, /data-registration-appointment-shared-controls/)
  assert.match(appointmentSource, /data-registration-appointment-subjects=\{appointmentParticipantSubjects\.join\("\|"\)\}/)
  assert.doesNotMatch(trackEditorSource, /data-registration-appointment-subjects/)
  assert.match(actionsSource, /data-registration-action-owner/)
  assert.match(enrollmentSource, /enrollment-row-save/)
  assert.match(enrollmentSource, /enrollment-row-add/)
  assert.match(enrollmentSource, /admission-start/)
  assert.doesNotMatch(createSource, /data-registration-primary-action="consultation-catalog-retry"/)
  assert.doesNotMatch(trackEditorSource, /data-registration-primary-action=\{`\$\{kind\}:\$\{plan\.appointmentId\}`\}/)
})

test("shared appointment browser selectors track the subject-qualified rendered controls", async () => {
  const [verifierSource, appointmentSource] = await Promise.all([
    readFile(verifierUrl, "utf8"),
    readFile(appointmentEditorUrl, "utf8"),
  ])
  const verifier = registrationVerifier(verifierSource)

  for (const renderedControl of [
    "appointmentParticipantSubjectLabel} 예약 시각",
    "appointmentParticipantSubjectLabel} 예약 적용: ${track.subject}",
    "appointmentParticipantSubjectLabel} 예약 저장",
    'track?.subject || "과목"} 시험 시작',
    'track?.subject || "과목"} 결과 완료',
    'track?.subject || "과목"} 시험지·결과지 URL',
  ]) {
    assert.ok(appointmentSource.includes(renderedControl), `appointment editor is missing ${renderedControl}`)
  }

  assert.match(verifier, /chooseFixtureTime\(sharedAppointment, \/\^영어·수학 예약 시각\//)
  assert.match(verifier, /영어·수학 예약 적용: 수학/)
  assert.match(verifier, /name: "영어 예약 저장", exact: true/)
  assert.match(verifier, /\^영어 예약 시각: 오전 10:30\$/)
  assert.match(verifier, /name: "영어 시험 시작", exact: true/)
  assert.match(verifier, /name: "영어 결과 완료", exact: true/)
  assert.match(verifier, /getByLabel\("영어 시험지·결과지 URL", \{ exact: true \}\)/)
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
