import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const verifierUrl = new URL("../scripts/verify-ops-task-browser-workflow.mjs", import.meta.url)

test("credentialed registration fixture verifier executes create, replay, reopen, and canonical edits", async () => {
  const source = await readFile(verifierUrl, "utf8")
  const start = source.indexOf("async function verifyRegistrationSubjectTrackFixture")
  const end = source.indexOf("async function login", start)
  const verifier = source.slice(start, end)

  assert.ok(start >= 0 && end > start, "registration fixture verifier must be present")
  for (const marker of [
    "학생명",
    "학부모 전화",
    "fixture-profile-english-director",
    "fixture-profile-math-director",
    "방문상담 예약일 날짜",
    "방문상담 예약일 시각",
    "방문상담실",
    "registration fixture save button",
    "openCreatedRegistrationCase",
    "__TIPS_REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG__",
    "replayLastCreate",
    "consultation_waiting",
    "visit_consultation_scheduled",
    "notificationReceipts",
    "externalCalls",
    "예약 수정",
    "책임자 저장",
    "시험지·결과지 URL",
    "결과 완료",
  ]) {
    assert.ok(verifier.includes(marker), `registration fixture verifier is missing ${marker}`)
  }

  assert.match(verifier, /beforeCounts[\s\S]*afterCounts/)
  assert.match(verifier, /appointments[\s\S]*===?\s*1|appointments[^\n]*1/)
  assert.match(verifier, /tracks[\s\S]*===?\s*2|tracks[^\n]*2/)
  assert.match(verifier, /"\*\*\/api\/google-chat"/)
  assert.match(verifier, /"\*\*\/api\/registration\/consultation-notification"/)
  assert.match(verifier, /page\.route\(providerRoutePattern/)
  assert.match(verifier, /page\.unroute\(providerRoutePattern/)
  assert.match(verifier, /interceptedProviderRequests\.length\s*!==\s*0/)
  assert.doesNotMatch(verifier, /canonical reload must preserve[\s\S]{0,300}getByRole\("button", \{ name: "닫기"/)
})
