import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
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

const coverageFixture = JSON.parse(readFileSync(
  new URL("./fixtures/notification-content-coverage-manifest.json", import.meta.url),
  "utf8",
))

const identityKey = ({ workflowKey, eventKey, audienceKey, channelKey, ruleVariantKey }) =>
  [workflowKey, eventKey, audienceKey, channelKey, ruleVariantKey].join("|")

const EXPECTED_IDENTITIES = coverageFixture.ruleGroups
  .filter((group) => group.scopeState === "in_scope")
  .flatMap((group) => group.eventKeys.flatMap((eventKey) => (
    group.cells.flatMap((cell) => cell.ruleVariantKeys.map((ruleVariantKey) => ({
      workflowKey: group.workflowKey,
      eventKey,
      audienceKey: cell.audienceKey,
      channelKey: cell.channelKey,
      ruleVariantKey,
      dispatchOwner: group.dispatchOwner,
    })))
  )))
  .sort((left, right) => identityKey(left).localeCompare(identityKey(right)))

const EXPECTED_IDENTITY_KEYS = EXPECTED_IDENTITIES.map(identityKey)

test("preview fixture runner는 전체 185개 in-scope identity를 exact content와 단일 destination으로 독립 비교한다", async () => {
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

    assert.deepEqual(runner.NOTIFICATION_SHADOW_PREVIEW_IDENTITIES, EXPECTED_IDENTITY_KEYS)
    assert.equal(first.passed, true)
    assert.deepEqual(first.identityOrder, EXPECTED_IDENTITY_KEYS)
    assert.equal(first.cycles.length, 185)
    assert.equal(first.totals.completedIdentities, 185)
    assert.equal(first.totals.externalRequests, 0)
    assert.equal(first.totals.providerAttempts, 0)
    assert.equal(first.totals.canonicalInboxProjections, 0)
    assert.equal(first.totals.duplicateExternalRequests, 0)
    assert.equal(first.totals.databaseOperations, 0)
    assert.equal(networkRequests, 0)
    assert.deepEqual(second, first, "동일 실행은 byte-stable 증거를 만들어야 한다")

    for (const [index, cycle] of first.cycles.entries()) {
      assert.equal(cycle.identityKey, EXPECTED_IDENTITY_KEYS[index])
      assert.deepEqual(cycle.identity, EXPECTED_IDENTITIES[index])
      assert.equal(cycle.complete, true)
      assert.equal(
        cycle.adapterSource,
        "notification-content-manifest+representative-workflow-registry",
      )
      assert.equal(cycle.rendererSource, "notification-worker.renderNotificationSnapshot")
      assert.equal(cycle.legacyTransport, "injected_recorder")
      assert.equal(cycle.comparison.matched, true)
      assert.deepEqual(cycle.comparison.mismatches, [])
      assert.equal(cycle.comparison.exactTitle, true)
      assert.equal(cycle.comparison.exactBody, true)
      assert.equal(cycle.comparison.exactHref, true)
      assert.equal(cycle.comparison.normalizedHash, true)
      assert.deepEqual(cycle.comparison.errorParity, {
        missing: "render_validation_failed",
        null: "render_validation_failed",
      })
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
      const googleChatTotal = Object.values(cycle.destinationCounts).reduce((sum, count) => sum + count, 0)
      assert.equal(googleChatTotal, cycle.identity.channelKey === "google_chat" ? 1 : 0)
      if (cycle.identity.channelKey === "google_chat") {
        assert.equal(cycle.destinationCounts[cycle.expectedDestination], 1)
        assert.equal(Object.values(cycle.destinationCounts).filter((count) => count === 0).length, 4)
      }
    }

    assert.deepEqual(first.excludedChannelCoverage, [{
      identityKey: "registration|registration.admission_message_requested|applicant_guardian|customer_message|immediate",
      scopeState: "excluded_channel",
      completionClaim: false,
      providerAttempts: 0,
    }])

    assert.deepEqual(first.manifest, {
      algorithm: "sha256",
      canonicalization: "sorted-json-v1",
      digest: first.manifest.digest,
    })
    assert.match(first.manifest.digest, /^[a-f0-9]{64}$/)
    assert.equal(runner.verifyNotificationShadowPreviewManifest(first), true)

    const taskCycle = first.cycles.find((cycle) => cycle.identity.eventKey === "task.created")
    assert.ok(taskCycle, "할 일 legacy custom preview 증거가 필요합니다")
    assert.equal(taskCycle.comparison.matched, true)
    assert.equal(taskCycle.recordedLegacyIntents, 1)
    assert.equal(taskCycle.externalRequests, 0)
    assert.equal(taskCycle.databaseOperations, 0)

    const wordRetestCycle = first.cycles.find((cycle) => cycle.identity.eventKey === "word_retest.created")
    assert.ok(wordRetestCycle, "단어 재시험 legacy custom preview 증거가 필요합니다")
    assert.equal(wordRetestCycle.comparison.matched, true)
    assert.equal(wordRetestCycle.recordedLegacyIntents, 1)
    assert.equal(wordRetestCycle.externalRequests, 0)
    assert.equal(wordRetestCycle.databaseOperations, 0)
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
  assert.deepEqual(evidence.identityOrder, EXPECTED_IDENTITY_KEYS)
  assert.equal(evidence.totals.completedIdentities, 185)
  assert.equal(evidence.totals.externalRequests, 0)
  assert.equal(evidence.totals.canonicalInboxProjections, 0)
  assert.match(evidence.manifest.digest, /^[a-f0-9]{64}$/)
})
