import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const verifierUrl = new URL("../scripts/verify-ops-task-browser-workflow.mjs", import.meta.url)
const intakeWorkflowUrl = new URL("../src/features/tasks/registration-intake-workflow.ts", import.meta.url)
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

  assert.doesNotMatch(verifier, /data-registration-application-section="placement"/)
  assert.match(verifier, /const mode = await applicationHost\.getAttribute\("data-registration-application-mode"\)/)
  assert.match(verifier, /mode === "create"[\s\S]*?\["inquiry", "level_test", "consultation"\][\s\S]*?\["inquiry", "level_test", "consultation", "waiting", "registration", "admission"\]/)
  assert.doesNotMatch(verifier, /data-registration-application-section="enrollment"/)
  assert.doesNotMatch(verifier, /data-registration-application-section="history"/)
})

test("create verification is subject-first, grade-scoped, and never saves", async () => {
  const [source, intakeWorkflowSource] = await Promise.all([
    readFile(verifierUrl, "utf8"),
    readFile(intakeWorkflowUrl, "utf8"),
  ])
  const verifier = registrationVerifier(source)

  assert.match(verifier, /getByRole\("button", \{ name: "등록 추가", exact: true \}\)/)
  assert.match(verifier, /\[data-registration-focus="subject"\] button\[aria-pressed\]/)
  assert.match(verifier, /compareDocumentPosition/)
  assert.match(verifier, /getByLabel\(\/\^학년\//)
  assert.match(verifier, /getByLabel\(\/\^학교\//)
  assert.match(verifier, /getByRole\("button", \{ name: \/과학 문의 과목\//)
  assert.match(verifier, /getAttribute\("aria-pressed"\)/)
  assert.match(verifier, /async function selectRegistrationOption/)
  assert.match(verifier, /async function readRegistrationOptions/)
  assert.match(verifier, /selectRegistrationOption\(createControls\.schoolGrade, "고1"\)/)
  assert.ok(
    verifier.indexOf("과학 문의 과목") < verifier.indexOf('selectRegistrationOption(createControls.schoolGrade, "고1")'),
    "science must be selected before the create grade",
  )
  assert.doesNotMatch(verifier, /\.selectOption\(/)
  assert.doesNotMatch(intakeWorkflowSource, /과학 선택 전에 학년을 먼저 선택하세요\./)
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
  assert.match(verifier, /data-registration-application-section="registration"/)
  assert.match(verifier, /\["inquiry", "level_test", "consultation", "waiting", "registration", "admission"\]/)
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
  assert.match(verifier, /scrollBeforeHistoryEscape/)
  assert.match(verifier, /triggerAboveApplicationViewport/)
  assert.match(verifier, /historyPortalEscapedApplication/)
  assert.match(verifier, /page\.waitForFunction\([\s\S]*?document\.activeElement === button[\s\S]*?historyButtonElement/)
  assert.match(verifier, /scrollAfterEscape !== scrollBeforeHistoryEscape/)
  const firstHistoryClose = verifier.indexOf('await historyPanel.waitFor({ state: "hidden"')
  const finalHistoryOpen = verifier.indexOf("await historyButton.click()", firstHistoryClose)
  const positiveScroll = verifier.indexOf("const scrollBeforeHistoryEscape", finalHistoryOpen)
  const finalHistoryEscape = verifier.indexOf('await page.keyboard.press("Escape")', positiveScroll)
  const focusSettled = verifier.indexOf("await page.waitForFunction", finalHistoryEscape)
  const finalScrollRead = verifier.indexOf("const scrollAfterEscape", finalHistoryEscape)
  assert.ok(finalHistoryOpen >= 0 && positiveScroll > finalHistoryOpen, "history must open before its trigger is scrolled out of the application viewport")
  assert.ok(focusSettled > finalHistoryEscape && finalScrollRead > focusSettled, "history focus restoration must settle before the final scroll is observed")
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
  assert.match(verifier, /optionFaultConsultationSection[\s\S]*?getByRole\("button", \{ name: "상담", exact: true \}\)[\s\S]*?click\(\)/)
  assert.match(verifier, /getByRole\("group", \{ name: "상담 과목 선택", exact: true \}\)/)
  assert.match(verifier, /getByLabel\("영어 상담 책임자", \{ exact: true \}\)/)
  assert.doesNotMatch(verifier, /영어 다음 업무/)
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

test("appointment plan accessibility rejects visible actions without participant subjects", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)
  const start = verifier.indexOf("async function assertAppointmentPlanAccessibleNames")
  const end = verifier.indexOf("async function assertAppointmentAccessibleNames", start)
  const assertion = verifier.slice(start, end)

  assert.match(assertion, /participantSubjects\.length > 0/)
  assert.match(assertion, /:\s*\["participant subjects"\]/)
  assert.match(assertion, /participantSubjects\.filter\(\(subject\) => !label\.includes\(subject\)\)/)
})

test("mobile primary actions require an owned visible data field", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)
  const start = verifier.indexOf("async function assertMobileActionDomOrder")
  const end = verifier.indexOf("async function assertNonColorWorkflowState", start)
  const assertion = verifier.slice(start, end)

  assert.match(assertion, /actionLabel/)
  assert.match(assertion, /if \(fields\.length === 0\) return \[`\$\{actionLabel\} owner has no visible data field`\]/)
  assert.doesNotMatch(assertion, /if \(fields\.length === 0\) return \[\]/)
})

test("non-color workflow assertions cover and execute locked current saved and failed", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)
  const start = verifier.indexOf("async function assertNonColorWorkflowState")
  const end = verifier.indexOf("async function verifyHistoryPopover", start)
  const assertion = verifier.slice(start, end)

  for (const state of ["locked", "current", "saved", "failed"]) {
    assert.match(assertion, new RegExp(`${state}:`), `${state} matcher must exist`)
  }
  assert.match(assertion, /ariaLabel/)
  assert.match(assertion, /describedBy/)
  assert.match(assertion, /text/)
  assert.match(assertion, /\[signal\.ariaLabel, signal\.describedBy, signal\.text\]\.filter\(Boolean\)\.join\(" "\)/)
  for (const call of [
    'assertNonColorWorkflowState(optionFaultHost, "locked")',
    'assertNonColorWorkflowState(detailApplicationHost, "current")',
    'assertNonColorWorkflowState(detailApplicationHost, "saved")',
    'assertNonColorWorkflowState(optionFaultHost, "failed")',
  ]) {
    assert.ok(verifier.includes(call), `verifier does not execute ${call}`)
  }
})

test("list reopen requires exactly one requested subject tab", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)
  const start = verifier.indexOf("async function openFixtureCaseFromList")
  const end = verifier.indexOf("async function assertPrecedes", start)
  const helper = verifier.slice(start, end)

  assert.match(helper, /const subjectTabCount = await subjectTab\.count\(\)/)
  assert.match(helper, /if \(subjectTabCount !== 1\)/)
  assert.match(helper, /requested subject tab count is \$\{subjectTabCount\}, expected 1/)
  assert.doesNotMatch(helper, /if \(await subjectTab\.count\(\)\) await subjectTab\.click\(\)/)
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

test("science registration DB projections expose three-track calendar and reminder ordering", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260722100000_registration_science_subject.sql", import.meta.url),
    "utf8",
  )

  assert.match(migration, /create or replace view public\.ops_registration_appointment_calendar/)
  assert.match(migration, /when '영어' then 10[\s\S]*?when '수학' then 20[\s\S]*?when '과학' then 30/)
  assert.match(
    migration,
    /registration_appointment_track_ids_v1[\s\S]*?array_agg\([\s\S]*?registration_subject_sort_order/,
  )
  assert.match(
    migration,
    /preview_registration_appointment_reminders_v1[\s\S]*?cardinality\(p_track_ids\) not between 1 and 3/,
  )
  assert.match(
    migration,
    /registration_appointment_source_snapshot_v1[\s\S]*?registration_subject_sort_order[\s\S]*?'participants'/,
  )
  assert.match(
    migration,
    /write_registration_track_event_v2[\s\S]*?registration_subject_sort_order[\s\S]*?'subjects'/,
  )
  assert.match(
    migration,
    /registration_message_track_id_v1[\s\S]*?registration_subject_sort_order/,
  )
})

test("saved-detail browser verification requires one unified inquiry save and no duplicate summaries", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const verifier = registrationVerifier(source)

  assert.match(verifier, /const inquirySaveButtons = detailApplicationHost\.locator\('\[data-registration-application-section="inquiry"\]'\)\.getByRole\("button", \{ name: "저장", exact: true \}\)/)
  assert.match(verifier, /if \(await inquirySaveButtons\.count\(\) !== 1\)[\s\S]*?throw new Error/)
  assert.match(verifier, /async function assertNoDuplicateRegistrationDetailSummaries/)
  assert.match(verifier, /await assertNoDuplicateRegistrationDetailSummaries\(detailApplicationHost\)/)
  const duplicateStart = verifier.indexOf("async function assertNoDuplicateRegistrationDetailSummaries")
  const duplicateEnd = verifier.indexOf("async function ", duplicateStart + 1)
  const duplicateHelper = verifier.slice(duplicateStart, duplicateEnd)
  assert.match(duplicateHelper, /const forbiddenSummaryLocators = \[/)
  assert.match(duplicateHelper, /\[data-registration-duplicate-summary\]/)
  assert.match(duplicateHelper, /현재 진행 단계가 아닙니다/)
  assert.match(duplicateHelper, /for \(const locator of forbiddenSummaryLocators\)[\s\S]*?const count = await locator\.count\(\)[\s\S]*?if \(count !== 0\)[\s\S]*?throw new Error/)
  assert.doesNotMatch(verifier, /공통 정보 저장[\s\S]{0,120}click\(/)
  assert.doesNotMatch(verifier, /과목 저장[\s\S]{0,120}click\(/)
})
