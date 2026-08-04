import assert from "node:assert/strict"
import test from "node:test"

const parentProjectRef = "slnjqlzzhewblvttiidk"
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
  return import("../scripts/run-notification-isolated-db-qa.mjs")
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
