import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import * as contract from "../src/features/tasks/registration-customer-message-contract.ts"

const SOURCE_ID = "96000000-0000-4000-8000-000000000001"
const PREVIEW_ID = "96000000-0000-4000-8000-000000000002"
const MESSAGE_ID = "96000000-0000-4000-8000-000000000003"
const REQUEST_KEY = "96000000-0000-4000-8000-000000000004"
const TASK_ID = "96000000-0000-4000-8000-000000000005"

test("browser-safe runtime unions expose exactly the approved customer-message values", () => {
  assert.deepEqual(contract.REGISTRATION_CUSTOMER_MESSAGE_KINDS, [
    "level_test_booking",
    "visit_consultation_booking",
    "appointment_reminder",
    "waiting_notice",
    "admission_application",
    "observation_booking",
    "observation_reminder",
  ])
  assert.deepEqual(contract.REGISTRATION_CUSTOMER_MESSAGE_STATUSES, [
    "pending",
    "accepted",
    "unknown",
    "failed_hold",
  ])
  assert.deepEqual(contract.REGISTRATION_CUSTOMER_MESSAGE_ACTIVATION_MODES, [
    "off",
    "verification",
    "live",
  ])
  assert.deepEqual(contract.REGISTRATION_CUSTOMER_MESSAGE_READINESS_CODES, [
    "runtime_not_ready",
    "activation_off",
    "verification_scope_mismatch",
    "credentials_missing",
    "pf_missing",
    "template_missing",
    "template_not_verified",
    "template_drift",
    "source_invalid",
    "source_dirty",
    "duplicate_locked",
    "role_not_authorized",
  ])
})

test("preview target parsing accepts only an exact message kind and canonical UUID", () => {
  for (const messageKind of contract.REGISTRATION_CUSTOMER_MESSAGE_KINDS) {
    assert.deepEqual(
      contract.parseRegistrationCustomerMessageTarget({ messageKind, sourceId: SOURCE_ID.toUpperCase() }),
      { messageKind, sourceId: SOURCE_ID },
    )
  }

  for (const invalid of [
    null,
    [],
    {},
    { messageKind: "sms", sourceId: SOURCE_ID },
    { messageKind: "level_test_booking", sourceId: "source-1" },
    { messageKind: "level_test_booking", sourceId: SOURCE_ID, phone: "01000001234" },
    { messageKind: "level_test_booking", sourceId: SOURCE_ID, body: "raw body" },
    { messageKind: "level_test_booking", sourceId: SOURCE_ID, variables: {} },
    { messageKind: "level_test_booking", sourceId: SOURCE_ID, templateId: "template" },
    { messageKind: "level_test_booking", sourceId: SOURCE_ID, pfId: "channel" },
  ]) {
    assert.equal(contract.parseRegistrationCustomerMessageTarget(invalid), null)
  }
})

test("observation rollout labels stay hidden until their dedicated UI task", async () => {
  const source = await readFile(
    new URL("../src/features/tasks/registration-customer-message-rollout-panel.tsx", import.meta.url),
    "utf8",
  )
  assert.match(source, /observation_booking:\s*"청강 예약 안내"/u)
  assert.match(source, /observation_reminder:\s*"청강 일정 안내"/u)
  assert.match(source, /const ROLLOUT_PANEL_MESSAGE_KINDS[\s\S]*"admission_application"/u)
  assert.doesNotMatch(source, /ROLLOUT_PANEL_MESSAGE_KINDS[\s\S]*"observation_booking"/u)
  assert.match(source, /ROLLOUT_PANEL_MESSAGE_KINDS\.map\(\(messageKind\)/u)
  assert.doesNotMatch(source, /REGISTRATION_CUSTOMER_MESSAGE_KINDS\.map\(\(messageKind\)/u)
})

test("send and check parsing reject extra browser-owned provider facts", () => {
  assert.deepEqual(
    contract.parseRegistrationCustomerMessageSendInput({
      previewId: PREVIEW_ID.toUpperCase(),
      requestKey: REQUEST_KEY.toUpperCase(),
    }),
    { previewId: PREVIEW_ID, requestKey: REQUEST_KEY },
  )
  assert.deepEqual(
    contract.parseRegistrationCustomerMessageCheckInput({ messageId: MESSAGE_ID.toUpperCase() }),
    { messageId: MESSAGE_ID },
  )

  for (const forbiddenField of ["phone", "body", "variables", "templateId", "pfId"]) {
    assert.equal(
      contract.parseRegistrationCustomerMessageSendInput({
        previewId: PREVIEW_ID,
        requestKey: REQUEST_KEY,
        [forbiddenField]: "forbidden",
      }),
      null,
    )
    assert.equal(
      contract.parseRegistrationCustomerMessageCheckInput({
        messageId: MESSAGE_ID,
        [forbiddenField]: "forbidden",
      }),
      null,
    )
  }

  assert.equal(contract.parseRegistrationCustomerMessageSendInput({ previewId: PREVIEW_ID }), null)
  assert.equal(contract.parseRegistrationCustomerMessageCheckInput({ messageId: "message-1" }), null)
})

test("admin action parsing is an exact discriminated union with normalized evidence", () => {
  const validActions = [
    {
      action: "preflight_template",
      messageKind: "level_test_booking",
    },
    {
      action: "set_activation",
      messageKind: "waiting_notice",
      mode: "verification",
      verificationTaskId: TASK_ID,
      requestKey: REQUEST_KEY,
    },
    {
      action: "record_live_test_receipt",
      messageKind: "admission_application",
      messageId: MESSAGE_ID,
      receivedAt: "2026-08-05T03:04:05.000Z",
      requestKey: REQUEST_KEY,
    },
    {
      action: "reconcile",
      messageId: MESSAGE_ID,
      resolution: "accepted",
      evidence: {
        providerMessageId: "provider-message",
        providerGroupId: "provider-group",
        statusCode: "2000",
        statusMessage: "accepted",
        observedAt: "2026-08-05T03:04:05.000Z",
        requestKeyMatched: true,
      },
      reason: "실제 접수 내역 확인",
      requestKey: REQUEST_KEY,
    },
    {
      action: "release_pre_send",
      messageId: MESSAGE_ID,
      reason: "provider 호출 전 준비 실패",
      requestKey: REQUEST_KEY,
    },
  ]

  for (const action of validActions) {
    assert.deepEqual(contract.parseRegistrationCustomerMessageAdminAction(action), action)
  }

  assert.deepEqual(
    contract.parseRegistrationCustomerMessageAdminAction({
      ...validActions[2],
      receivedAt: "2026-08-05T12:04:05.123456+09:00",
    }),
    {
      ...validActions[2],
      receivedAt: "2026-08-05T03:04:05.123Z",
    },
  )

  for (const invalidTimestamp of [
    "0",
    "2026-02-29",
    "08/05/2026",
    "2026-02-29T00:00:00.000Z",
    "2026-08-05T03:04:05",
    "2026-08-05T25:04:05.000Z",
  ]) {
    assert.equal(
      contract.parseRegistrationCustomerMessageAdminAction({
        ...validActions[2],
        receivedAt: invalidTimestamp,
      }),
      null,
    )
    assert.equal(
      contract.parseRegistrationCustomerMessageAdminAction({
        ...validActions[3],
        evidence: { ...validActions[3].evidence, observedAt: invalidTimestamp },
      }),
      null,
    )
  }

  assert.equal(
    contract.parseRegistrationCustomerMessageAdminAction({
      action: "preflight_template",
      messageKind: "level_test_booking",
      templateId: "browser-owned-template",
    }),
    null,
  )
  assert.equal(
    contract.parseRegistrationCustomerMessageAdminAction({
      ...validActions[3],
      evidence: { ...validActions[3].evidence, phone: "01000001234" },
    }),
    null,
  )
  assert.equal(
    contract.parseRegistrationCustomerMessageAdminAction({
      ...validActions[3],
      resolution: "pending",
    }),
    null,
  )
})

test("public response guard permits only the exact approved DTO field names", () => {
  const preview = {
    ok: true,
    previewId: PREVIEW_ID,
    expiresAt: "2026-08-05T03:19:05.000Z",
    messageKind: "level_test_booking",
    studentName: "김팁스",
    recipientLast4: "1234",
    facts: {
      subjectLabel: "영어 · 수학",
      scheduleLabel: "2026년 8월 8일 토요일 오후 2:00",
      placeLabel: "본관",
      admissionPlans: [{
        subjectLabel: "영어",
        className: "중2 영어 A반",
        textbookLabel: "능률 VOCA",
        scheduleLabel: "월·수 오후 6:00–8:00",
        teacherLabel: "홍길동",
        classroomLabel: "본관 301호",
        firstLessonLabel: "8월 17일 월요일 오후 6:00–8:00",
      }],
    },
    body: "실제 승인 템플릿과 같은 미리보기 본문",
    buttons: [],
    readiness: {
      runtimeReady: true,
      activationMode: "verification",
      activationEligible: true,
      credentialsConfigured: true,
      pfConfigured: true,
      templateConfigured: true,
      templateVerified: true,
      verifiedAt: "2026-08-05T03:00:00.000Z",
      sourceValid: true,
      sendAllowed: true,
      blockers: [],
    },
    latestMessage: null,
  }

  assert.strictEqual(contract.assertRegistrationCustomerMessagePublicPayload(preview), preview)
  const sendResult = {
    ok: true,
    messageId: MESSAGE_ID,
    messageKind: "level_test_booking",
    currentStatus: "accepted",
    recipientLast4: "1234",
    confirmedByName: "김관리",
    confirmedAt: "2026-08-05T03:04:05.000Z",
    updatedAt: "2026-08-05T03:04:06.000Z",
    canCheck: true,
    idempotent: false,
  }
  assert.strictEqual(contract.assertRegistrationCustomerMessagePublicPayload(sendResult), sendResult)
  const serialized = JSON.stringify(preview)
  for (const forbiddenKey of [
    "recipientHash",
    "templateId",
    "pfId",
    "sourceFingerprint",
    "providerEvidence",
    "providerMessageId",
    "apiSecret",
    "requestKey",
    "variables",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(`"${forbiddenKey}"`))
  }

  for (const forbiddenField of [
    "providerStatusMessage",
    "authorization",
    "claimToken",
    "dispatchToken",
    "parentPhoneNumber",
    "requestFingerprint",
    "bodyChecksum",
    "templateRevision",
    "rawEvidence",
    "enrollmentId",
    "trackId",
    "classId",
    "textbookId",
    "sessionId",
    "slotId",
    "workflowRevision",
    "scheduleRevision",
    "scheduleHash",
    "sourceFingerprint",
  ]) {
    assert.throws(
      () => contract.assertRegistrationCustomerMessagePublicPayload({
        ...preview,
        [forbiddenField]: "must-not-leak",
      }),
      /registration_customer_message_public_payload_forbidden_field/,
    )
  }
})

test("browser-safe module has no server environment or catalog export surface", async () => {
  const exportedNames = Object.keys(contract)
  assert.equal(exportedNames.some((name) => /SERVER_ENV|TEMPLATE_ID|PF_ID|CATALOG/.test(name)), false)
  assert.equal(exportedNames.includes("createRegistrationCustomerMessageCatalog"), false)

  const source = await readFile(
    new URL("../src/features/tasks/registration-customer-message-contract.ts", import.meta.url),
    "utf8",
  )
  assert.doesNotMatch(source, /node:crypto|process\.env|SOLAPI_[A-Z0-9_]+/)
})
