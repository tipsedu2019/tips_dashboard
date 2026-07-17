import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

const runnerUrl = new URL(
  "../scripts/run-notification-shadow-preview-fixtures.mjs",
  import.meta.url,
)
const registryUrl = new URL(
  "../src/features/notifications/server/notification-workflow-registry.ts",
  import.meta.url,
)

const EXPECTED_SCOPES = [
  "tasks",
  "word_retests",
  "approvals",
  "transfer",
  "withdrawal",
  "makeup_requests",
  "registration",
  "registration_phone",
  "registration_visit",
  "registration_solapi",
]

test("preview fixture runner는 고정 10개 범위를 실제 adapter로 독립 비교한다", async () => {
  const originalFetch = globalThis.fetch
  let networkRequests = 0
  globalThis.fetch = async () => {
    networkRequests += 1
    throw new Error("preview fixture에서는 네트워크 호출을 할 수 없습니다.")
  }

  try {
    const runner = await import(`${runnerUrl.href}?success=${Date.now()}`)
    const first = await runner.runNotificationShadowPreviewFixtures()
    const second = await runner.runNotificationShadowPreviewFixtures()

    assert.deepEqual(runner.NOTIFICATION_SHADOW_PREVIEW_SCOPES, EXPECTED_SCOPES)
    assert.equal(first.passed, true)
    assert.deepEqual(first.scopeOrder, EXPECTED_SCOPES)
    assert.equal(first.cycles.length, 10)
    assert.equal(first.totals.completedScopes, 10)
    assert.equal(first.totals.externalRequests, 0)
    assert.equal(first.totals.providerAttempts, 0)
    assert.equal(first.totals.canonicalInboxProjections, 0)
    assert.equal(first.totals.duplicateExternalRequests, 0)
    assert.equal(first.totals.databaseOperations, 0)
    assert.equal(networkRequests, 0)
    assert.deepEqual(second, first, "동일 실행은 byte-stable 증거를 만들어야 한다")

    for (const [index, cycle] of first.cycles.entries()) {
      assert.equal(cycle.owner, EXPECTED_SCOPES[index])
      assert.equal(cycle.scopeKey, EXPECTED_SCOPES[index])
      assert.equal(cycle.complete, true)
      assert.equal(cycle.adapterSource, "notification-workflow-registry")
      assert.equal(cycle.rendererSource, "notification-worker.renderNotificationSnapshot")
      assert.equal(cycle.legacyTransport, "injected_recorder")
      assert.equal(cycle.comparison.matched, true)
      assert.deepEqual(cycle.comparison.mismatches, [])
      assert.ok(cycle.recordedLegacyIntents >= 1)
      assert.ok(cycle.canonicalRows.length >= 1)
      assert.ok(cycle.canonicalRows.every((row) => (
        row.status === "skipped"
        && row.skipReason === "shadow_mode"
        && row.replayable === false
      )))
      assert.equal(cycle.externalRequests, 0)
      assert.equal(cycle.providerAttempts, 0)
      assert.equal(cycle.canonicalInboxProjections, 0)
      assert.equal(cycle.duplicateExternalRequests, 0)
      assert.equal(cycle.databaseOperations, 0)
      assert.match(cycle.intentDigest, /^[a-f0-9]{64}$/)
    }

    assert.deepEqual(first.manifest, {
      algorithm: "sha256",
      canonicalization: "sorted-json-v1",
      digest: first.manifest.digest,
    })
    assert.match(first.manifest.digest, /^[a-f0-9]{64}$/)
    assert.equal(runner.verifyNotificationShadowPreviewManifest(first), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("canonical target가 변하면 독립 legacy 결과와의 불일치를 탐지한다", async () => {
  const runner = await import(`${runnerUrl.href}?mismatch=${Date.now()}`)
  const registry = await import(registryUrl.href)

  await assert.rejects(
    runner.runNotificationShadowPreviewFixtures({
      getAdapter(workflowKey) {
        const adapter = registry.getNotificationWorkflowAdapter(workflowKey)
        if (workflowKey !== "tasks" || !adapter) return adapter
        return {
          ...adapter,
          async resolveTargets(input) {
            const result = await adapter.resolveTargets(input)
            return {
              ...result,
              targets: result.targets.map((target) => ({
                ...target,
                targetKey: `${target.targetKey}:canonical-drift`,
              })),
            }
          },
        }
      },
    }),
    /notification_shadow_preview_mismatch:tasks/,
  )
})

test("canonical seed 템플릿만 drift하면 legacy 선언과의 불일치를 탐지한다", async () => {
  const runner = await import(`${runnerUrl.href}?canonical-template-drift=${Date.now()}`)

  await assert.rejects(
    runner.runNotificationShadowPreviewFixtures({
      canonicalTemplateTransform(template, scopeKey) {
        if (scopeKey !== "tasks") return template
        return {
          ...template,
          titleTemplate: `${template.titleTemplate} [canonical-drift]`,
        }
      },
    }),
    /notification_shadow_preview_mismatch:tasks/,
  )
})

test("legacy 체크섬 입력만 drift하면 렌더 결과가 같아도 불일치를 탐지한다", async () => {
  const runner = await import(`${runnerUrl.href}?legacy-checksum-drift=${Date.now()}`)

  await assert.rejects(
    runner.runNotificationShadowPreviewFixtures({
      legacyTemplateTransform(template, scopeKey) {
        if (scopeKey !== "tasks") return template
        return {
          ...template,
          allowedVariables: [
            ...template.allowedVariables,
            { key: "preview_drift", token: "preview_drift", piiClass: "none" },
          ],
        }
      },
    }),
    /notification_shadow_preview_mismatch:tasks/,
  )
})

test("CLI는 환경 변수 없이 JSON 증거와 검증 가능한 SHA256 manifest를 출력한다", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", fileURLToPath(runnerUrl)],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {},
      encoding: "utf8",
    },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, "")
  const evidence = JSON.parse(result.stdout)
  assert.equal(evidence.passed, true)
  assert.deepEqual(evidence.scopeOrder, EXPECTED_SCOPES)
  assert.equal(evidence.totals.externalRequests, 0)
  assert.equal(evidence.totals.canonicalInboxProjections, 0)
  assert.match(evidence.manifest.digest, /^[a-f0-9]{64}$/)
})
