import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const verifierUrl = new URL("../scripts/verify-ops-task-browser-workflow.mjs", import.meta.url)
const fixtureUrl = new URL("../src/features/tasks/registration-track-fixtures.ts", import.meta.url)
const fixtureRuntimeUrl = new URL("../src/features/tasks/registration-track-fixture-runtime.ts", import.meta.url)

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
  assert.match(verifier, /scrollBeforeHistoryOpen/)
  assert.match(verifier, /if \(scrollBeforeHistoryOpen <= 0\)/)
  assert.match(verifier, /historyPortalEscapedApplication/)
  assert.match(verifier, /scrollAfterEscape !== scrollBeforeHistoryOpen/)
  const positiveScroll = verifier.indexOf("const scrollBeforeHistoryOpen")
  const finalHistoryOpen = verifier.indexOf("await historyButton.click()", positiveScroll)
  assert.ok(positiveScroll >= 0 && finalHistoryOpen > positiveScroll, "positive dialog scroll must be established before history opens")
  assert.doesNotMatch(verifier, /locator\('\[data-registration-application-section="history"\]'/)
})

test("every fixture navigation checks a complete state digest against the first baseline", async () => {
  const [source, fixtureSource, runtimeSource] = await Promise.all([
    readFile(verifierUrl, "utf8"),
    readFile(fixtureUrl, "utf8"),
    readFile(fixtureRuntimeUrl, "utf8"),
  ])
  const verifier = registrationVerifier(source)
  const recordStart = verifier.indexOf("async function recordFixtureSafetySnapshot")
  const navigateStart = verifier.indexOf("async function navigateRegistrationFixture")
  const record = verifier.slice(recordStart, navigateStart)
  const navigateEnd = verifier.indexOf("async function assertNoHorizontalOverflow", navigateStart)
  const navigate = verifier.slice(navigateStart, navigateEnd)

  assert.match(runtimeSource, /stateDigest: string/)
  assert.match(fixtureSource, /stateDigest: getRegistrationSubjectTrackFixtureStateDigest\(state\)/)
  assert.match(verifier, /let fixtureStateBaselineDigest = null/)
  assert.match(record, /snapshot\.stateDigest/)
  assert.match(record, /fixtureStateBaselineDigest === null/)
  assert.match(record, /snapshot\.stateDigest !== fixtureStateBaselineDigest/)
  assert.match(record, /stage/)
  assert.ok(navigate.indexOf("recordFixtureSafetySnapshot") < navigate.indexOf("page.goto"), "baseline assertion must run before every navigation")
  assert.doesNotMatch(verifier.slice(0, navigateStart) + verifier.slice(navigateEnd), /page\.goto\(/)
})

test("read-only coverage reopens calendar and list cases without persistent actions", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)

  const calendarStart = verifier.indexOf("async function openRegistrationSubjectTrackFixtureCalendarItem")
  const calendarEnd = verifier.indexOf("async function openFixtureCaseFromList", calendarStart)
  assert.ok(calendarStart >= 0 && calendarEnd > calendarStart, "calendar and list helpers must execute")
  const calendar = verifier.slice(calendarStart, calendarEnd)
  assert.match(calendar, /data-registration-calendar-item/)
  assert.match(calendar, /calendarItem\.click\(\)/)
  assert.match(calendar, /waitForURL/)
  assert.match(calendar, /data-registration-appointment-focus/)
  assert.match(calendar, /registration-application-level_test/)
  assert.match(verifier, /await openRegistrationSubjectTrackFixtureCalendarItem\(\{[\s\S]*?fixture-appointment-dual-test/)

  const listStart = verifier.indexOf("async function openFixtureCaseFromList")
  const listEnd = verifier.indexOf("async function assertPrecedes", listStart)
  const list = verifier.slice(listStart, listEnd)
  assert.match(list, /getByRole\("tab"/)
  assert.match(list, /getByRole\("listitem"/)
  assert.match(list, /getByRole\("row"\)/)
  assert.match(list, /detailButton\.click\(\)/)
  assert.match(verifier, /openFixtureCaseFromList\(\{ studentName: "김예린"[\s\S]*?viewLabel: "상담"/)
  assert.match(verifier, /openFixtureCaseFromList\(\{ studentName: "서지안"[\s\S]*?viewLabel: "완료"/)

  assert.doesNotMatch(verifier, /saveCreateButton|createdResult|예약 저장[^\n]*click\(|입학 처리 시작[^\n]*click\(/)
})

test("read-only edge scenarios keep permissions migration terminal and dirty-close coverage", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)

  for (const marker of [
    "fixture-task-partial-registration",
    "읽기 전용 입학 처리 상태",
    'fixtureRole: "assistant"',
    "fixture-task-migration-review",
    "과목 분리 확인 필요",
    "fixture-task-cross-stage",
    "fixture-task-all-terminal",
    "등록 완료",
    "미등록 완료",
  ]) {
    assert.ok(verifier.includes(marker), `restored read-only verifier is missing ${marker}`)
  }
  assert.match(verifier, /readOnlyAdmissionDialog[\s\S]*?getByRole\("button", \{ name: "입학 처리 시작" \}\)\.count\(\)/)
  assert.match(verifier, /migrationDialog[\s\S]*?section\[aria-label="영어 문의 처리"\][\s\S]*?count\(\)/)
  assert.match(verifier, /consultationTaskId[\s\S]*?levelTestTaskId[\s\S]*?fixture-task-cross-stage/)
  assert.match(verifier, /unsavedInquiryRequestNote[\s\S]*?fill\(unsavedInquiryRequestNote\)[\s\S]*?keyboard\.press\("Escape"\)[\s\S]*?입력한 내용을 버릴까요\?[\s\S]*?계속 작성[\s\S]*?저장하지 않고 닫기/)
  assert.doesNotMatch(verifier, /phoneConsultationSave|공통 정보 저장[^\n]*click\(/)
})

test("option recovery and accessibility checks execute without saving", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)

  assert.match(verifier, /async function setNextFault/)
  assert.match(verifier, /kind: "option_data_once"/)
  assert.match(verifier, /optionFaultHost\.locator\('\[data-registration-focus="subject"\] button\[aria-pressed\]'/)
  assert.match(verifier, /optionFaultRetry\.click\(\)/)
  assert.match(verifier, /optionFaultDirector\.isEnabled\(\)/)
  assert.match(verifier, /async function assertSubjectQualifiedAccessibleNames/)
  assert.match(verifier, /async function assertAppointmentPlanAccessibleNames/)
  assert.match(verifier, /async function assertAppointmentAccessibleNames/)
  assert.match(verifier, /async function assertMobileActionDomOrder/)
  assert.match(verifier, /async function assertNonColorWorkflowState/)
  for (const call of [
    "assertSubjectQualifiedAccessibleNames(detailApplicationHost)",
    "assertAppointmentPlanAccessibleNames(detailApplicationHost)",
    "assertAppointmentAccessibleNames(detailApplicationHost)",
    "assertMobileActionDomOrder(admissionApplicationHost)",
    'assertNonColorWorkflowState(optionFaultHost, "locked")',
    'assertNonColorWorkflowState(optionFaultHost, "failed")',
  ]) {
    assert.ok(verifier.includes(call), `restored verifier does not execute ${call}`)
  }
  assert.doesNotMatch(verifier, /optionFaultHost[\s\S]*?getByRole\("checkbox"/)
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
