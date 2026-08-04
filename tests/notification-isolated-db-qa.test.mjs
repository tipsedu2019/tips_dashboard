import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"

const parentProjectRef = "slnjqlzzhewblvttiidk"
const runnerUrl = new URL("../scripts/run-notification-isolated-db-qa.mjs", import.meta.url)
const healthyBranch = Object.freeze({
  id: "fbdf5a53-161e-4460-98ad-0e39408d8689",
  name: "qa-notification-content-20260804093000",
  projectRef: "abcdefghijklmnopqrst",
  parentProjectRef,
  isDefault: false,
  persistent: false,
  withData: false,
  status: "ACTIVE_HEALTHY",
})

async function loadSubject() {
  return import(runnerUrl.href)
}

function createSuccessfulExecutor({
  databaseUrl = "postgresql://postgres:top-secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
  countOverrides = {},
  dryRunStdout = "No unsafe notification runtime activation found.",
  getStatuses = [healthyBranch.status],
  relationPresence = {
    auth_users: true,
    profiles: true,
    students: true,
    classes: true,
  },
} = {}) {
  const calls = []
  let getIndex = 0
  const rawBranch = {
    id: healthyBranch.id,
    name: healthyBranch.name,
    project_ref: healthyBranch.projectRef,
    parent_project_ref: healthyBranch.parentProjectRef,
    is_default: false,
    persistent: false,
    with_data: false,
    status: healthyBranch.status,
  }
  const zeroCounts = {
    auth_users: 0,
    profiles: 0,
    students: 0,
    classes: 0,
    deliveries: 0,
    inbox: 0,
    runtime_flags_enabled: 0,
    connection_secret_rows: 0,
    ...countOverrides,
  }

  return {
    calls,
    async execute(invocation) {
      calls.push(invocation)
      const signature = invocation.args.join(" ")
      if (signature.startsWith("branches list ")) {
        return { code: 0, stdout: "[]", stderr: "" }
      }
      if (signature.startsWith("branches create ")) {
        return { code: 0, stdout: JSON.stringify(rawBranch), stderr: "" }
      }
      if (signature.startsWith("branches get ")) {
        const status = getStatuses[Math.min(getIndex, getStatuses.length - 1)]
        getIndex += 1
        return {
          code: 0,
          stdout: JSON.stringify({ ...rawBranch, status, POSTGRES_URL_NON_POOLING: databaseUrl }),
          stderr: "",
        }
      }
      if (signature.startsWith("db query ") && signature.includes("notification-preview-relations")) {
        return {
          code: 0,
          stdout: JSON.stringify([{ notification_preview_relations: relationPresence }]),
          stderr: "",
        }
      }
      if (signature.startsWith("db query ") && signature.includes("notification-preview-preflight")) {
        return {
          code: 0,
          stdout: JSON.stringify([{ notification_preview_preflight: zeroCounts }]),
          stderr: "",
        }
      }
      if (signature.startsWith("db push ") && signature.includes("--dry-run")) {
        return { code: 0, stdout: dryRunStdout, stderr: "" }
      }
      if (invocation.command === "/test/node") {
        return { code: 0, stdout: JSON.stringify({ passed: true }), stderr: "" }
      }
      return { code: 0, stdout: "ok", stderr: "" }
    },
  }
}

test("Management API branch 목록은 안전한 필드만 정규화한다", async () => {
  const { normalizePreviewBranchList } = await loadSubject()
  const branches = normalizePreviewBranchList({
    branches: [{
      id: healthyBranch.id,
      name: healthyBranch.name,
      project_ref: healthyBranch.projectRef,
      parent_project_ref: healthyBranch.parentProjectRef,
      is_default: false,
      persistent: false,
      with_data: false,
      status: healthyBranch.status,
      database_password: "must-not-survive",
      postgres_url: "postgresql://postgres:must-not-survive@example.test/postgres",
      webhook_url: "https://chat.googleapis.com/v1/spaces/example/messages?key=secret",
    }],
  })

  assert.deepEqual(branches, [healthyBranch])
  assert.equal(Object.isFrozen(branches), true)
  assert.equal(Object.isFrozen(branches[0]), true)
  assert.equal(JSON.stringify(branches).includes("must-not-survive"), false)
})

test("Management API branch 목록 형식이 아니면 거부한다", async () => {
  const { normalizePreviewBranchList } = await loadSubject()

  assert.throws(
    () => normalizePreviewBranchList({ branches: "not-an-array" }),
    /notification_preview_branch_list_invalid/,
  )
})

test("preview branch는 부모와 다른 data-less 비영구 환경만 허용한다", async () => {
  const { assertDisposablePreviewBranch } = await loadSubject()
  const branch = assertDisposablePreviewBranch(healthyBranch, parentProjectRef)

  assert.deepEqual(branch, healthyBranch)
  assert.equal(Object.isFrozen(branch), true)
})

for (const patch of [
  { projectRef: parentProjectRef },
  { parentProjectRef: "zyxwvutsrqponmlkjihg" },
  { isDefault: true },
  { persistent: true },
  { withData: true },
  { status: "MIGRATIONS_FAILED" },
]) {
  test(`preview branch 거부: ${JSON.stringify(patch)}`, async () => {
    const { assertDisposablePreviewBranch } = await loadSubject()

    assert.throws(
      () => assertDisposablePreviewBranch({ ...healthyBranch, ...patch }, parentProjectRef),
      /notification_preview_branch_refused/,
    )
  })
}

test("preview branch 검증 결과에서도 안전한 필드만 보존한다", async () => {
  const { assertDisposablePreviewBranch } = await loadSubject()
  const branch = assertDisposablePreviewBranch({
    ...healthyBranch,
    databasePassword: "must-not-survive",
    webhookUrl: "https://chat.googleapis.com/v1/spaces/example/messages?key=secret",
  }, parentProjectRef)

  assert.deepEqual(branch, healthyBranch)
  assert.equal(JSON.stringify(branch).includes("must-not-survive"), false)
})

test("명령 증거에서 DB 자격 증명과 공급자 비밀을 가린다", async () => {
  const { redactCommandEvidence } = await loadSubject()
  const evidence = redactCommandEvidence([
    "postgresql://postgres:top-secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=require",
    "sbp_supersecret123",
    "https://chat.googleapis.com/v1/spaces/example/messages?key=abc&token=def",
  ].join(" "))

  assert.equal(evidence.includes("postgres:top-secret"), false)
  assert.equal(evidence.includes("sslmode=require"), false)
  assert.equal(evidence.includes("sbp_supersecret123"), false)
  assert.equal(evidence.includes("key=abc"), false)
  assert.equal(evidence.includes("token=def"), false)
  assert.match(evidence, /postgresql:\/\/\[redacted\]@db\.abcdefghijklmnopqrst\.supabase\.co:5432\/postgres/)
  assert.match(evidence, /https:\/\/chat\.googleapis\.com\/v1\/spaces\/example\/messages\?\[redacted\]/)
})

test("preview branch 이름은 UTC 시각으로 결정적으로 만든다", async () => {
  const { buildPreviewBranchName } = await loadSubject()

  assert.equal(
    buildPreviewBranchName(new Date("2026-08-04T09:30:00.000Z")),
    "qa-notification-content-20260804093000",
  )
})

test("유효하지 않은 시각으로 branch 이름을 만들지 않는다", async () => {
  const { buildPreviewBranchName } = await loadSubject()

  assert.throws(
    () => buildPreviewBranchName(new Date("invalid")),
    /notification_preview_branch_time_invalid/,
  )
})

test("승인되지 않은 실행은 첫 child process 전에 거부한다", async () => {
  const { runNotificationIsolatedDbQa } = await loadSubject()
  let executeCallCount = 0

  await assert.rejects(
    () => runNotificationIsolatedDbQa({
      approved: false,
      cliPath: "/test/supabase",
      nodePath: "/test/node",
      now: new Date("2026-08-04T09:30:00.000Z"),
      async execute() {
        executeCallCount += 1
        return { code: 0, stdout: "", stderr: "" }
      },
    }),
    /notification_preview_approval_required/,
  )
  assert.equal(executeCallCount, 0)
})

test("운영 프로젝트 ref의 DB URL은 migration 전에 거부하고 생성 branch만 정리한다", async () => {
  const { runNotificationIsolatedDbQa } = await loadSubject()
  const fake = createSuccessfulExecutor({
    databaseUrl: `postgresql://postgres:top-secret@db.${parentProjectRef}.supabase.co:5432/postgres`,
  })

  await assert.rejects(
    () => runNotificationIsolatedDbQa({
      approved: true,
      cliPath: "/test/supabase",
      nodePath: "/test/node",
      now: new Date("2026-08-04T09:30:00.000Z"),
      execute: fake.execute,
    }),
    /notification_preview_production_target_refused/,
  )

  const signatures = fake.calls.map((call) => call.args.join(" "))
  assert.equal(signatures.some((value) => value.startsWith("db push ")), false)
  assert.equal(signatures.some((value) => value.startsWith("db dump ")), false)
  assert.equal(
    signatures.filter((value) => value === `branches delete ${healthyBranch.projectRef} --project-ref ${parentProjectRef} --yes`).length,
    1,
  )
})

test("preview branch에 업무 데이터가 있으면 migration과 dump 전에 거부한다", async () => {
  const { runNotificationIsolatedDbQa } = await loadSubject()
  const fake = createSuccessfulExecutor({ countOverrides: { students: 1 } })

  await assert.rejects(
    () => runNotificationIsolatedDbQa({
      approved: true,
      cliPath: "/test/supabase",
      nodePath: "/test/node",
      now: new Date("2026-08-04T09:30:00.000Z"),
      execute: fake.execute,
    }),
    /notification_preview_data_not_empty/,
  )

  const signatures = fake.calls.map((call) => call.args.join(" "))
  assert.equal(signatures.some((value) => value.startsWith("db push ")), false)
  assert.equal(signatures.some((value) => value.startsWith("db dump ")), false)
  assert.equal(signatures.some((value) => value.startsWith("branches delete ")), true)
})

test("preflight count가 null이면 0으로 간주하지 않고 거부한다", async () => {
  const { runNotificationIsolatedDbQa } = await loadSubject()
  const fake = createSuccessfulExecutor({ countOverrides: { students: null } })

  await assert.rejects(
    () => runNotificationIsolatedDbQa({
      approved: true,
      cliPath: "/test/supabase",
      nodePath: "/test/node",
      now: new Date("2026-08-04T09:30:00.000Z"),
      execute: fake.execute,
    }),
    /notification_preview_data_not_empty/,
  )
})

test("migration 전 public 관계가 없어도 catalog 확인 후 0건으로 처리한다", async () => {
  const { runNotificationIsolatedDbQa } = await loadSubject()
  const fake = createSuccessfulExecutor({
    relationPresence: {
      auth_users: true,
      profiles: false,
      students: false,
      classes: false,
    },
  })

  const evidence = await runNotificationIsolatedDbQa({
    approved: true,
    cliPath: "/test/supabase",
    nodePath: "/test/node",
    now: new Date("2026-08-04T09:30:00.000Z"),
    execute: fake.execute,
  })

  assert.equal(evidence.zeroCounts.students, 0)
  assert.equal(
    fake.calls.filter((call) => call.args.join(" ").includes("notification-preview-relations")).length,
    1,
  )
})

test("dry-run에 알림 worker 활성화 SQL이 보이면 actual push를 거부한다", async () => {
  const { runNotificationIsolatedDbQa } = await loadSubject()
  const fake = createSuccessfulExecutor({
    dryRunStdout: "select cron.schedule('notification_worker_schedule', '* * * * *', 'select 1')",
  })

  await assert.rejects(
    () => runNotificationIsolatedDbQa({
      approved: true,
      cliPath: "/test/supabase",
      nodePath: "/test/node",
      now: new Date("2026-08-04T09:30:00.000Z"),
      execute: fake.execute,
    }),
    /notification_preview_runtime_activation_refused/,
  )

  const pushCalls = fake.calls
    .map((call) => call.args)
    .filter((args) => args[0] === "db" && args[1] === "push")
  assert.equal(pushCalls.length, 1)
  assert.equal(pushCalls[0].includes("--dry-run"), true)
  assert.equal(fake.calls.some((call) => call.args[0] === "branches" && call.args[1] === "delete"), true)
})

test("생성 직후 CREATING_PROJECT 상태는 15초 뒤 다시 확인한다", async () => {
  const { runNotificationIsolatedDbQa } = await loadSubject()
  const fake = createSuccessfulExecutor({
    getStatuses: ["CREATING_PROJECT", "ACTIVE_HEALTHY"],
  })
  const waits = []

  const evidence = await runNotificationIsolatedDbQa({
    approved: true,
    cliPath: "/test/supabase",
    nodePath: "/test/node",
    now: new Date("2026-08-04T09:30:00.000Z"),
    execute: fake.execute,
    async wait(milliseconds) {
      waits.push(milliseconds)
    },
  })

  assert.equal(evidence.branchRefPrefix, "abcdef")
  assert.deepEqual(waits, [15_000])
  assert.equal(
    fake.calls.filter((call) => call.args[0] === "branches" && call.args[1] === "get").length,
    2,
  )
})

test("승인된 orchestrator는 exact allowlist만 실행하고 안전한 증거를 반환한 뒤 정리한다", async () => {
  const { runNotificationIsolatedDbQa } = await loadSubject()
  const fake = createSuccessfulExecutor()
  const evidence = await runNotificationIsolatedDbQa({
    approved: true,
    cliPath: "/test/supabase",
    nodePath: "/test/node",
    now: new Date("2026-08-04T09:30:00.000Z"),
    execute: fake.execute,
  })

  assert.deepEqual(evidence, {
    branchName: healthyBranch.name,
    branchRefPrefix: "abcdef",
    runtimeFlagsEnabled: 0,
    zeroCounts: {
      authUsers: 0,
      profiles: 0,
      students: 0,
      classes: 0,
      deliveries: 0,
      inbox: 0,
      connectionSecretRows: 0,
    },
    localDatabase: {
      readOnlyPassed: true,
      roundTripPassed: true,
    },
    pgTap: {
      passed: true,
      fileCount: 9,
    },
    cleanup: {
      previewBranchDeleted: true,
      localDatabaseStopped: true,
      tempDirectoryRemoved: true,
    },
  })

  const allArgs = fake.calls.flatMap((call) => call.args)
  assert.equal(allArgs.includes("--with-data"), false)
  assert.equal(allArgs.includes("--persistent"), false)
  assert.equal(allArgs.includes("--notify-url"), false)
  assert.equal(fake.calls.every((call) => call.command === "/test/supabase" || call.command === "/test/node"), true)
  assert.equal(JSON.stringify(evidence).includes("top-secret"), false)

  const signatures = fake.calls.map((call) => call.args.join(" "))
  assert.equal(fake.calls.length, 19)
  assert.equal(signatures.filter((value) => value.startsWith("db push ")).length, 2)
  assert.equal(signatures.filter((value) => value.startsWith("migration list ")).length, 1)
  assert.equal(signatures.filter((value) => value.startsWith("db dump ")).length, 2)
  assert.equal(signatures.filter((value) => value.startsWith("db query ")).length, 5)
  assert.equal(fake.calls.filter((call) => call.command === "/test/node").length, 2)
  const pgTapCall = fake.calls.find((call) => call.args[0] === "test" && call.args[1] === "db")
  assert.equal(pgTapCall.args.filter((value) => value.endsWith("_test.sql")).length, 9)
  assert.equal(
    signatures.filter((value) => value === "stop --project-id tips_notification_db_qa --no-backup").length,
    1,
  )
  assert.equal(
    signatures.filter((value) => value === `branches delete ${healthyBranch.projectRef} --project-ref ${parentProjectRef} --yes`).length,
    1,
  )
})

test("Supabase access token은 branch CLI에만 전달하고 로컬 evidence에는 넘기지 않는다", async () => {
  const { runNotificationIsolatedDbQa } = await loadSubject()
  const fake = createSuccessfulExecutor()
  const previousAccessToken = process.env.SUPABASE_ACCESS_TOKEN
  const previousGoogleChatUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL
  process.env.SUPABASE_ACCESS_TOKEN = "sbp_branch_cli_only"
  process.env.GOOGLE_CHAT_WEBHOOK_URL = "https://chat.googleapis.com/v1/spaces/example/messages?key=must-not-pass"

  try {
    await runNotificationIsolatedDbQa({
      approved: true,
      cliPath: "/test/supabase",
      nodePath: "/test/node",
      now: new Date("2026-08-04T09:30:00.000Z"),
      execute: fake.execute,
    })
  } finally {
    if (previousAccessToken === undefined) delete process.env.SUPABASE_ACCESS_TOKEN
    else process.env.SUPABASE_ACCESS_TOKEN = previousAccessToken
    if (previousGoogleChatUrl === undefined) delete process.env.GOOGLE_CHAT_WEBHOOK_URL
    else process.env.GOOGLE_CHAT_WEBHOOK_URL = previousGoogleChatUrl
  }

  const cliCall = fake.calls.find((call) => call.command === "/test/supabase")
  const nodeCalls = fake.calls.filter((call) => call.command === "/test/node")
  assert.equal(cliCall.env.SUPABASE_ACCESS_TOKEN, "sbp_branch_cli_only")
  assert.equal(nodeCalls.length, 2)
  assert.equal(nodeCalls.every((call) => call.env.SUPABASE_ACCESS_TOKEN === undefined), true)
  assert.equal(nodeCalls.every((call) => call.env.GOOGLE_CHAT_WEBHOOK_URL === undefined), true)
})

test("CLI 기본 모드는 자원을 만들지 않고 실행 계획만 JSON으로 출력한다", () => {
  const result = spawnSync(process.execPath, [runnerUrl.pathname], {
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: "sbp_must_not_leak",
      GOOGLE_CHAT_WEBHOOK_URL: "https://chat.googleapis.com/v1/spaces/example/messages?key=must-not-leak",
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /sbp_must_not_leak|must-not-leak/u)
  assert.deepEqual(JSON.parse(result.stdout), {
    mode: "plan",
    approved: false,
    requiredFlags: ["--execute", "--approved-preview-branch"],
    expectedResources: {
      previewBranches: 1,
      productionDataCopied: false,
      persistent: false,
      localDatabaseProjectId: "tips_notification_db_qa",
    },
  })
})
