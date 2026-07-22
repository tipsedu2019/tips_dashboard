import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const scriptUrls = [
  new URL("../scripts/verify-ops-task-sample-workflow.mjs", import.meta.url),
  new URL("../scripts/verify-ops-task-browser-workflow.mjs", import.meta.url),
]
const sources = await Promise.all(scriptUrls.map((url) => readFile(url, "utf8")))
const concurrencySource = await readFile(
  new URL("../scripts/verify-registration-subject-track-concurrency.mjs", import.meta.url),
  "utf8",
)
const registrationMutationSource = await readFile(
  new URL("../supabase/migrations/20260712182834_registration_subject_track_mutations.sql", import.meta.url),
  "utf8",
)

function assertIncludesAll(source, snippets) {
  for (const snippet of snippets) {
    assert.ok(source.includes(snippet), `missing verification safety contract: ${snippet}`)
  }
}

function collectRpcArgumentContracts(source) {
  const contracts = []
  const callPattern = /rpc\((?:context\.)?[^,\n]+,\s*"([a-z0-9_]+)"\s*,\s*\{/g
  for (const match of source.matchAll(callPattern)) {
    let cursor = match.index + match[0].length - 1
    let depth = 0
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === "{") depth += 1
      if (source[cursor] === "}") {
        depth -= 1
        if (depth === 0) break
      }
    }
    const body = source.slice(match.index + match[0].length, cursor)
    contracts.push({
      name: match[1],
      keys: [...body.matchAll(/\b(p_[a-z0-9_]+)\s*:/g)].map((entry) => entry[1]).sort(),
    })
  }
  return contracts
}

function publicRpcArguments(name) {
  const start = registrationMutationSource.indexOf(`create function public.${name}(`)
  assert.ok(start >= 0, `missing public RPC signature: ${name}`)
  const returnsAt = registrationMutationSource.indexOf("\nreturns jsonb", start)
  const signature = registrationMutationSource.slice(start, returnsAt)
  return [...signature.matchAll(/\b(p_[a-z0-9_]+)\s+[a-z]/g)].map((entry) => entry[1]).sort()
}

function privateRpcBlock(name) {
  const start = registrationMutationSource.indexOf(`create function dashboard_private.${name}_impl(`)
  assert.ok(start >= 0, `missing private RPC implementation: ${name}`)
  const end = registrationMutationSource.indexOf(`alter function dashboard_private.${name}_impl(`, start)
  assert.ok(end > start, `missing private RPC implementation tail: ${name}`)
  return registrationMutationSource.slice(start, end)
}

test("verification scripts always run the four subject-track samples in memory", () => {
  for (const source of sources) {
    assertIncludesAll(source, [
      "SUBJECT_TRACK_SAMPLES",
      "same-day dual level test",
      "split visit and phone consultation",
      "partial registration with later batch",
      "multiple English classes",
      "verifySubjectTrackSamples()",
      "getSubjectTrackTabCounts",
      "tabCounts.level_test !== 2",
      "subjectTrackSamples",
    ])

    const verifyIndex = source.lastIndexOf("verifySubjectTrackSamples()")
    const enabledIndex = source.lastIndexOf("requireEnabled()")
    assert.ok(verifyIndex !== -1 && verifyIndex < enabledIndex, "in-memory samples must run before any enabled network lane")
  }
})

test("ready-mode verification seeds only empty roster projections and never writes history directly", () => {
  for (const source of sources) {
    assert.doesNotMatch(source, /(?:class_ids|waitlist_class_ids|student_ids|waitlist_ids)\s*:\s*\[(?!\s*\])/)
    assert.doesNotMatch(source, /set\s+(?:class_ids|waitlist_class_ids|student_ids|waitlist_ids)\s*=/i)
    assert.doesNotMatch(source, /\.update\s*\(\s*\{[^}]*\b(?:class_ids|waitlist_class_ids|student_ids|waitlist_ids)\b/s)
    assert.doesNotMatch(
      source,
      /(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?student_class_enrollment_history/i,
    )
  }
})

test("roster changes use an independently authenticated RPC client and validate the committed response", () => {
  for (const source of sources) {
    assertIncludesAll(source, [
      "authenticatedRosterClient",
      'authenticatedRosterClient.rpc("set_student_class_roster_mode"',
      "p_expected_mode: expectedMode",
      "p_next_mode: nextMode",
      "assertCommittedRosterResponse",
      "studentClassIds",
      "studentWaitlistClassIds",
      "classStudentIds",
      "classWaitlistIds",
    ])
    assert.doesNotMatch(source, /(?:serviceRoleClient|setupClient|serviceClient)\.rpc\(\s*["']set_student_class_roster_mode["']/)
    assert.doesNotMatch(source, /\bclient\.rpc\(\s*["']set_student_class_roster_mode["']/)
  }
  assert.ok(sources[0].includes("supabase: workflowClient"), "sample business workflow must use an authenticated workflow client")
})

test("cleanup reaches removed in sorted order, verifies all projections, and archives audit fixtures", () => {
  for (const source of sources) {
    assertIncludesAll(source, [
      "sortRosterPairs",
      'nextMode: "removed"',
      "verifyRosterProjection",
      "archiveAuditFixtures",
      "OPS_FIXTURE_DISPOSABLE",
      "OPS_FIXTURE_DATABASE_SCOPE",
      "disposable localhost",
      "db reset",
      "auditHistoryRetained",
      "activeFixtureRows",
    ])
  }
})

test("sample roster verification archives seeded audit fixtures even when a transition fails", () => {
  const sampleSource = sources[0]
  const start = sampleSource.indexOf("async function runReadyModeRosterSample")
  const end = sampleSource.indexOf("function buildCliWorkflowSql", start)
  const lane = sampleSource.slice(start, end)
  assert.match(lane, /let workflowError = null/)
  assert.match(lane, /catch \(error\) \{\s*workflowError = error\s*\}/)
  assert.ok(lane.indexOf("archiveAuditFixtures") > lane.indexOf("removeRosterPairs"))
  assert.ok(lane.indexOf("if (workflowError) throw workflowError") > lane.indexOf("archiveAuditFixtures"))
})

test("browser cleanup counts tasks and every archived fixture entity as active data", () => {
  const browserSource = sources[1]
  const start = browserSource.indexOf("async function archiveAuditFixtures")
  const end = browserSource.indexOf("function printAuditFixtureResetInstruction", start)
  const archiveSource = browserSource.slice(start, end)
  for (const marker of ["activeTasks", "activeStudents", "activeClasses", "activeTextbooks", "activeTeachers"]) {
    assert.ok(archiveSource.includes(marker), `archive verification is missing ${marker}`)
  }
  assert.match(archiveSource, /activeFixtureRows:\s*activeCounts\.reduce/)
})

test("CLI SQL is pinned to an explicitly guarded local database instead of the linked project", () => {
  const sampleSource = sources[0]
  assert.doesNotMatch(sampleSource, /["']--linked["']/)
  assert.ok(sampleSource.includes("OPS_SAMPLE_DB_URL"))
  assert.ok(sampleSource.includes('"--db-url", databaseUrl'))
  assert.ok(sampleSource.includes('OPS_FIXTURE_DATABASE_SCOPE=local'))
  assert.ok(sampleSource.includes("assertAuthorizedLocalFixtureDatabase"))
  assert.match(sampleSource, /localDatabaseUrl = getEnv\("OPS_SAMPLE_DB_URL"\)/)
  assert.doesNotMatch(sampleSource, /\["local", "preview"\]\.includes\(scope\)/)
})

test("database-backed sample and browser lanes require the same explicit localhost database authorization", () => {
  for (const source of sources) {
    assertIncludesAll(source, [
      "assertAuthorizedLocalFixtureDatabase",
      "OPS_SAMPLE_DB_URL",
      "OPS_FIXTURE_DATABASE_SCOPE=local",
      "OPS_FIXTURE_DISPOSABLE=1",
      "localhost",
      "127.0.0.1",
    ])
    assert.doesNotMatch(source, /OPS_FIXTURE_DATABASE_SCOPE=local\|preview/)
  }
})

test("authenticated browser verification includes the deterministic subject-track fixture route", () => {
  const browserSource = sources[1]
  assert.match(browserSource, /\/admin\/registration\?fixture=registration-subject-tracks/)
  assert.match(browserSource, /interaction:\s*"registration-subject-track-fixture"/)
  assert.match(browserSource, /verifyRegistrationSubjectTrackFixture/)
  assert.match(browserSource, /same-day dual level test/)
  assert.match(browserSource, /multiple English classes/)
})

test("subject-track fixture verification exercises the refined no-save application and mobile overflow", () => {
  const browserSource = sources[1]
  const start = browserSource.indexOf("async function verifyRegistrationSubjectTrackFixture")
  const end = browserSource.indexOf("async function login", start)
  const fixtureVerifier = browserSource.slice(start, end)

  assertIncludesAll(fixtureVerifier, [
    "openRegistrationSubjectTrackFixtureCase",
    "openRegistrationSubjectTrackFixtureCalendarItem",
    "openFixtureCaseFromList",
    "assertNoHorizontalOverflow",
    "fixture-task-dual-test",
    "fixture-track-dual-english",
    "과목별 등록 진행",
    "registration-subject-tab-",
    "브라우저 검증용 되돌릴 초안",
    "자동 이력 보기",
    "등록 자동 이력",
    "학년을 먼저 선택",
    "과학 문의 과목",
    "새봄고",
    "fixture-task-multiple-classes",
    "수업 추가",
    "입학 처리 시작",
    "fixture-task-partial-registration",
    "읽기 전용 입학 처리 상태",
    "fixture-task-migration-review",
    "과목 분리 확인 필요",
    "fixture-task-cross-stage",
    "fixture-task-all-terminal",
    "저장하지 않고 닫기",
    "option_data_once",
    "assertSubjectQualifiedAccessibleNames",
    "assertAppointmentPlanAccessibleNames",
    "assertAppointmentAccessibleNames",
    "assertMobileActionDomOrder",
    "assertNonColorWorkflowState",
  ])
  assert.match(fixtureVerifier, /button\[aria-pressed\]/)
  assert.match(fixtureVerifier, /scrollWidth[\s\S]*?viewportWidth/)
  assert.doesNotMatch(fixtureVerifier, /saveCreateButton|createdResult|replayLastFixtureCreate/)
})

test("browser route health is checked again after interactions and includes failed requests", () => {
  const browserSource = sources[1]
  const start = browserSource.indexOf("async function inspectRoute")
  const end = browserSource.indexOf("async function inspectPublicSmokeRoute", start)
  const inspect = browserSource.slice(start, end)

  assertIncludesAll(inspect, [
    "failedRequests",
    'page.on("requestfailed", onRequestFailed)',
    'page.off("requestfailed", onRequestFailed)',
    'assertRouteHealth("initial navigation")',
    'assertRouteHealth("post interaction")',
  ])
  const initialHealth = inspect.indexOf('assertRouteHealth("initial navigation")')
  const interaction = inspect.indexOf("const interactionResult = await verifyRouteInteraction")
  const postHealth = inspect.indexOf('assertRouteHealth("post interaction")')
  assert.ok(initialHealth >= 0 && interaction > initialHealth && postHealth > interaction)
  assert.match(inspect, /consoleMessages[\s\S]*pageErrors[\s\S]*failedRequests[\s\S]*responseErrors/)
  assert.match(inspect, /document\.documentElement\.scrollWidth[\s\S]*window\.innerWidth/)
})

test("registration provider interception and snapshots enforce a provider-zero no-mutation verifier", () => {
  const browserSource = sources[1]
  const start = browserSource.indexOf("async function verifyRegistrationSubjectTrackFixture")
  const end = browserSource.indexOf("async function login", start)
  const fixtureVerifier = browserSource.slice(start, end)

  assertIncludesAll(fixtureVerifier, [
    '"**/api/google-chat"',
    '"**/api/web-push"',
    '"**/api/solapi/**"',
    '"**/api/registration/consultation-notification"',
    '"**/api/notifications/worker"',
    '"**/api/notifications/connections"',
    '"**/api/notifications/legacy/**"',
    "permission prompt",
    "self-test",
  ])
  assert.match(fixtureVerifier, /route\.request\(\)\.method\(\) !== "POST"[\s\S]*?route\.continue\(\)/)
  assert.match(fixtureVerifier, /assertRegistrationFixtureSafetySnapshot/)
  assert.match(fixtureVerifier, /let fixtureStateBaselineDigest = null/)
  assert.match(fixtureVerifier, /snapshot\.stateDigest !== fixtureStateBaselineDigest/)
  assert.match(fixtureVerifier, /recordFixtureSafetySnapshot\(`pre-navigation fixture snapshot: \$\{stage\}`\)[\s\S]*?page\.goto/)
  assert.match(fixtureVerifier, /assertNoInterceptedProviderRequests\("no-send registration application verification"\)/)
  assert.doesNotMatch(fixtureVerifier, /createdResult|saveCreateButton|notification retry[^\n]*click\(/i)
})

test("authorized concurrency verification executes only gated seeded races with separate actor lanes", () => {
  assert.match(concurrencySource, /executeAuthorizedScenarios/)
  assert.doesNotMatch(concurrencySource, /Executable seeded mutation races are not implemented/)
  assertIncludesAll(concurrencySource, [
    "createClient",
    "adminClient",
    "secondAdminClient",
    "serviceRoleSetupClient",
    "serviceRoleFinalizerClient",
    "assertDistinctAdminActors",
    "createRaceBarrier",
    "runStudentIdentityRace",
    "runAppointmentRevisionRace",
    "runAttemptAndBatchCancellationRace",
    "runSamePairRosterBatchRace",
    "runUnrelatedRosterBatchRace",
    "runTwoCaseClaimRace",
    "runInvoicePaymentReplayRace",
    "runMessageRaces",
    "runDirectorReassignmentRace",
    "runWithdrawalLifecycleRaces",
    "cleanupFixtureNamespace",
  ])
  assert.match(concurrencySource, /rpc\(context\.serviceRoleFinalizerClient, "finalize_registration_admission_message"/)
  assert.doesNotMatch(concurrencySource, /rpc\(context\.serviceRole(?:Setup|Finalizer)Client, "(?:set_student_class_roster_mode|start_registration_admission_batch|complete_registration_consultation|complete_ops_withdrawal_roster_transition)"/)
  assert.match(concurrencySource, /Promise\.allSettled/)
  assert.match(concurrencySource, /scenarioStatus:\s*"executed"/)
})

test("authorized concurrency verification keeps production detection and service-key use in safe order", () => {
  const manifest = concurrencySource.slice(concurrencySource.indexOf("async function runAuthorizedManifest"))
  const productionGuard = manifest.indexOf("assertAuthorizedTarget")
  const serviceKeyRead = manifest.indexOf('optionValue(argv, "--service-role-key")')
  const serviceClient = manifest.indexOf("serviceRoleSetupClient")
  assert.ok(productionGuard >= 0)
  assert.ok(serviceKeyRead > productionGuard)
  assert.ok(serviceClient > serviceKeyRead)
  assert.match(concurrencySource, /url\.protocol === "https:"/)
  assert.match(concurrencySource, /url\.hostname\.endsWith\("\.supabase\.co"\)/)
  assert.match(concurrencySource, /\^\[a-z0-9\]\{20\}\$/)
  assert.doesNotMatch(concurrencySource, /\/(?:preview\|staging\|branch)\/i\.test\(url\.pathname\)/)
  assert.match(concurrencySource, /cleanupTablesInReverseForeignKeyOrder/)
  assert.match(concurrencySource, /namespacePrefix/)
  assert.match(concurrencySource, /fixtureTag/)
})

test("concurrency verification consumes the exact appointment RPC response shape", () => {
  assert.doesNotMatch(concurrencySource, /(?:create|createdAppointment)\.appointment\?\.id/)
  assert.match(concurrencySource, /const appointmentId = create\.appointmentId/)
  assert.match(concurrencySource, /assert\.ok\(createdAppointment\.appointmentId\)/)
  assert.match(concurrencySource, /fixture\.ids\.appointments\.add\(createdAppointment\.appointmentId\)/)
})

test("appointment race proves one notification source and job set without provider calls", () => {
  const start = concurrencySource.indexOf("async function runAppointmentRevisionRace")
  const end = concurrencySource.indexOf("async function runAttemptAndBatchCancellationRace", start)
  const race = concurrencySource.slice(start, end)

  assertIncludesAll(race, [
    'p_kind: "visit_consultation"',
    "context.fixture.actorIds[0]",
    "context.fixture.actorIds[1]",
    "notificationJobs",
    'job_kind === "target_reconciliation"',
    'get_registration_notification_source_snapshot_v1',
    "notification_revision",
    "recipient_revision",
    "assertProviderZero",
  ])
  assert.match(race, /assertExactlyOneWinner\(edits, "appointment revision"\)/)
  assert.match(race, /new Set\([^\n]*job_id/)
  assert.doesNotMatch(concurrencySource, /fetch\s*\(/)
  assertIncludesAll(concurrencySource, [
    "providerCallLedger",
    "providerCalls: context.providerCallLedger.length",
    '"/api/google-chat"',
    '"/api/web-push"',
    '"/api/solapi"',
  ])
})

test("withdrawal races use fixed service-only checkpoints without exposing a debug SQL surface", () => {
  assert.match(concurrencySource, /proofScope:\s*"deterministic_internal_checkpoint_race"/)
  assert.match(concurrencySource, /internalLockOrderProven:\s*true/)
  assert.match(concurrencySource, /lockOrders:\s*cases\.length/)
  assert.doesNotMatch(concurrencySource, /setTimeout\(resolve, 20\)/)
  assertIncludesAll(concurrencySource, [
    "armRegistrationVerificationCheckpoint",
    "waitForRegistrationVerificationCheckpoint",
    "releaseRegistrationVerificationCheckpoint",
    "disarmRegistrationVerificationCheckpoint",
    '"arm_registration_verification_checkpoint"',
    '"wait_registration_verification_checkpoint_reached"',
    '"release_registration_verification_checkpoint"',
    '"disarm_registration_verification_checkpoint"',
    '"registration_student_reactivation_required"',
    '"registration_workflow_retry_required"',
    "registrationEventCount",
    "assert.equal(raceState.registrationEventCount, 0)",
    "assert.ok(raceState.registrationEventCount > 0)",
    'assert.equal(raceState.batchCount, kind === "batch" ? 1 : 0)',
    'assert.equal(raceState.liveClaims[0].status, kind === "batch" ? "planned" : "waitlisted")',
    "assert.equal(raceState.enrollmentState.roster_active, true)",
    'operationKind: "withdrawal_after_parent_snapshot"',
    "competingCheckpoint",
  ])
  const checkpointTableStart = registrationMutationSource.indexOf("create table dashboard_private.ops_registration_verification_checkpoints")
  const checkpointTable = registrationMutationSource.slice(
    checkpointTableStart,
    registrationMutationSource.indexOf(";", checkpointTableStart) + 1,
  )
  assert.doesNotMatch(checkpointTable, /\b(?:sql|query|statement|payload)\b/i)
  assert.match(registrationMutationSource, /revoke all on table dashboard_private\.ops_registration_verification_checkpoints\s+from public, anon, authenticated, service_role/)
  assert.doesNotMatch(registrationMutationSource, /grant\s+(?:select|insert|update|delete|all)[^;]*ops_registration_verification_checkpoints[^;]*to service_role/i)
  assert.match(registrationMutationSource, /registration_verification_checkpoint_timeout/)
  assert.match(registrationMutationSource, /registration_verification_checkpoint_disarmed/)
  assert.doesNotMatch(concurrencySource, /rpc\(context\.(?:admin|secondAdmin)Client, "(?:arm|wait|release|disarm)_registration_verification_checkpoint"/)
  assert.doesNotMatch(concurrencySource, /rpc\(context\.serviceRoleSetupClient, "(?:start_registration_admission_batch|route_registration_inquiry|complete_ops_withdrawal_roster_transition)"/)

  const raceStart = concurrencySource.indexOf("async function runOrderedWithdrawalRace")
  const raceEnd = concurrencySource.indexOf("async function runWithdrawalLifecycleRaces", raceStart)
  const raceBlock = concurrencySource.slice(raceStart, raceEnd)
  const holderReached = raceBlock.indexOf("await waitForRegistrationVerificationCheckpoint(context, checkpoint)")
  const contenderArmed = raceBlock.indexOf("await armRegistrationVerificationCheckpoint(context, competingCheckpoint)")
  const contenderStarted = raceBlock.indexOf("competingPromise = withdrawal()")
  const contenderReached = raceBlock.indexOf("await waitForRegistrationVerificationCheckpoint(context, competingCheckpoint)")
  const contenderReleased = raceBlock.indexOf("await releaseRegistrationVerificationCheckpoint(context, competingCheckpoint)")
  const holderReleased = raceBlock.indexOf("await releaseRegistrationVerificationCheckpoint(context, checkpoint)")
  assert.ok([holderReached, contenderArmed, contenderStarted, contenderReached, contenderReleased, holderReleased].every((index) => index >= 0))
  assert.deepEqual(
    [holderReached, contenderArmed, contenderStarted, contenderReached, contenderReleased, holderReleased],
    [holderReached, contenderArmed, contenderStarted, contenderReached, contenderReleased, holderReleased]
      .toSorted((left, right) => left - right),
    "lifecycle-first must observe the competing withdrawal snapshot before releasing the lock holder",
  )
})

test("every concurrency RPC call matches the migration signature and consumed response nesting", () => {
  const contracts = collectRpcArgumentContracts(concurrencySource)
  assert.ok(contracts.length >= 30, "the executable verifier should contain every race call")
  for (const contract of contracts) {
    assert.deepEqual(contract.keys, publicRpcArguments(contract.name), `${contract.name} argument drift`)
  }

  const appointment = privateRpcBlock("save_registration_shared_appointment")
  assert.match(appointment, /'appointmentId', v_appointment_id/)
  assert.doesNotMatch(appointment, /'appointment',\s*pg_catalog\.jsonb_build_object/)
  assert.match(concurrencySource, /create\.appointmentId/)
  assert.match(concurrencySource, /createdAppointment\.appointmentId/)

  const batchStart = privateRpcBlock("start_registration_admission_batch")
  const batchAdvance = privateRpcBlock("advance_registration_admission_batch")
  assert.match(batchStart, /'batch',\s*pg_catalog\.jsonb_build_object\(\s*'id', v_batch_id/)
  assert.match(batchAdvance, /'batch',\s*pg_catalog\.jsonb_build_object\(\s*'id', v_batch\.id/)
  assert.match(concurrencySource, /started\.batch\.id/)
  assert.match(concurrencySource, /result\.batch\?\.invoiceSentAt/)
  assert.match(concurrencySource, /result\.batch\?\.paymentConfirmedAt/)

  const messageClaim = privateRpcBlock("claim_registration_admission_message")
  assert.match(messageClaim, /'messageId', v_message\.id/)
  assert.match(messageClaim, /'shouldSend', true/)
  assert.match(concurrencySource, /result\.shouldSend/)
  assert.match(concurrencySource, /\[0\]\.messageId/)
  assert.match(concurrencySource, /\[0\]\.messageRequestKey/)
})

test("browser workflow authorizes localhost before temporary users, login, or sample writes", () => {
  const browserSource = sources[1]
  const runBlock = browserSource.slice(browserSource.indexOf("async function run()"))
  const authorization = runBlock.indexOf("assertAuthorizedLocalFixtureDatabase")
  const temporaryUser = runBlock.indexOf("createTemporaryBrowserUserStorage")
  const playwright = runBlock.indexOf("importPlaywright")
  assert.ok(authorization >= 0)
  assert.ok(temporaryUser > authorization)
  assert.ok(playwright > authorization)
  assert.match(runBlock, /OPS_BROWSER_BASE_URL must use localhost/)
})

test("browser creation failures continue partial cleanup and surface cleanup errors", () => {
  const browserSource = sources[1]
  assert.ok(browserSource.includes("allowMissing: allowPartial"))
  assert.ok(browserSource.includes("const cleanupErrors = []"))
  assert.ok(browserSource.includes("Browser fixture cleanup failed."))
  assert.ok(browserSource.includes("Operation fixture creation and cleanup failed."))
  assert.ok(browserSource.includes("Registration fixture creation and cleanup failed."))
  assert.doesNotMatch(browserSource, /cleanup(?:OperationCompletionFixtures|RegistrationWorkflowFixture)\([^\n]*\)\.catch\(\(\) => \{\}\)/)
})

test("registration workflow cleanup distinguishes zero active rows from retained audit history", () => {
  const browserSource = sources[1]
  const start = browserSource.indexOf("async function cleanupRegistrationWorkflowFixture")
  const end = browserSource.indexOf("async function readRegistrationWorkflowState", start)
  const cleanupSource = browserSource.slice(start, end)
  assert.match(cleanupSource, /archive\.activeFixtureRows !== 0/)
  assert.match(cleanupSource, /!allowPartial && archive\.auditHistoryRetained < 2/)
})

test("verification dry runs stay network-free and report in-memory sample coverage", async () => {
  for (const url of scriptUrls) {
    const { stdout, stderr } = await execFileAsync(process.execPath, [url.pathname], {
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        PATH: process.env.PATH,
        NODE_PATH: process.env.NODE_PATH,
      },
      timeout: 10_000,
    })
    assert.equal(stderr, "")
    assert.match(stdout, /subjectTrackSamples[^\n]*4/s)
    assert.match(stdout, /Skipped\./)
  }
})
