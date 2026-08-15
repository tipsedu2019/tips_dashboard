import assert from "node:assert/strict"
import { createHash, createHmac } from "node:crypto"
import test from "node:test"

import {
  SOLAPI_MESSAGE_LIST_URL,
  SOLAPI_SEND_MANY_URL,
  createRegistrationCustomerMessageSolapi,
  createSolapiHmacAuthorization,
} from "../src/features/tasks/server/registration-customer-message-solapi.ts"
import {
  createRegistrationCustomerMessageCatalog,
  renderRegistrationCustomerMessage,
} from "../src/features/tasks/server/registration-customer-message-catalog.ts"

const NOW = new Date("2026-08-05T01:02:03.456Z")
const API_KEY = "test-api-key"
const API_SECRET = "test-api-secret-never-log"
const PF_ID = "pf-tipsedu"
const REQUEST_KEY = "00000000-0000-4000-8000-000000000011"
const MESSAGE_ID = "provider-message-1"

const ENV = Object.freeze({
  SOLAPI_API_KEY: API_KEY,
  SOLAPI_API_SECRET: API_SECRET,
  SOLAPI_KAKAO_PF_ID: PF_ID,
  SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID: "template-level",
  SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID: "template-visit",
  SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID: "template-reminder",
  SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID: "template-waiting",
  SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID: "template-admission",
})

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function makeAdapter(fetch, overrides = {}) {
  let saltIndex = 0
  return createRegistrationCustomerMessageSolapi({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    pfId: PF_ID,
    fetch,
    now: () => NOW,
    createSalt: () => `0123456789abcdef0123456789abcde${saltIndex++}`,
    ...overrides,
  })
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

test("HMAC authorization signs exact date+fresh salt without exposing the secret", () => {
  const firstSalt = "0123456789abcdef0123456789abcdef"
  const secondSalt = "fedcba9876543210fedcba9876543210"
  const first = createSolapiHmacAuthorization({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    date: NOW.toISOString(),
    salt: firstSalt,
  })
  const second = createSolapiHmacAuthorization({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    date: NOW.toISOString(),
    salt: secondSalt,
  })
  const signature = createHmac("sha256", API_SECRET)
    .update(NOW.toISOString() + firstSalt)
    .digest("hex")

  assert.equal(
    first,
    `HMAC-SHA256 apiKey=${API_KEY}, date=${NOW.toISOString()}, salt=${firstSalt}, signature=${signature}`,
  )
  assert.notEqual(first, second)
  assert.equal(first.includes(API_SECRET), false)
})

test("send uses the official detailed ATA endpoint and an exact no-SMS-fallback payload", async () => {
  const calls = []
  const adapter = makeAdapter(async (url, init) => {
    calls.push({ url: String(url), init })
    return response({
      groupInfo: { groupId: "provider-group-1" },
      messageList: [{ messageId: MESSAGE_ID, statusCode: "2000", statusMessage: "접수" }],
      failedMessageList: [],
    })
  })

  const result = await adapter.send({
    to: "01012345678",
    templateId: "template-admission",
    variables: { "#{학생명}": "김팁스" },
    buttons: [{
      name: "입학신청서 작성",
      type: "WL",
      linkMobile: "https://pay.makeedu.co.kr/join/4A214239B585F87D809C141B2712F9D8",
      linkPc: "https://pay.makeedu.co.kr/join/4A214239B585F87D809C141B2712F9D8",
    }, {
      name: "문의하기",
      type: "WL",
      linkMobile: "https://tipsedu.channel.io",
      linkPc: "https://tipsedu.channel.io",
    }],
    requestKey: REQUEST_KEY,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, SOLAPI_SEND_MANY_URL)
  assert.equal(calls[0].init.method, "POST")
  assert.match(calls[0].init.headers.Authorization, /^HMAC-SHA256 /)
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    messages: [{
      to: "01012345678",
      type: "ATA",
      kakaoOptions: {
        pfId: PF_ID,
        templateId: "template-admission",
        disableSms: true,
        variables: { "#{학생명}": "김팁스" },
        buttons: [{
          buttonName: "입학신청서 작성",
          buttonType: "WL",
          linkMo: "https://pay.makeedu.co.kr/join/4A214239B585F87D809C141B2712F9D8",
          linkPc: "https://pay.makeedu.co.kr/join/4A214239B585F87D809C141B2712F9D8",
        }, {
          buttonName: "문의하기",
          buttonType: "WL",
          linkMo: "https://tipsedu.channel.io",
          linkPc: "https://tipsedu.channel.io",
        }],
      },
      customFields: { registrationRequestKey: REQUEST_KEY },
    }],
    strict: true,
    allowDuplicates: false,
    showMessageList: true,
  })
  assert.equal(result.outcome, "accepted")
  assert.match(result.providerPayloadChecksum, /^[a-f0-9]{64}$/u)
  assert.equal(
    result.providerPayloadChecksum,
    sha256(canonicalJson(JSON.parse(calls[0].init.body))),
  )
  assert.deepEqual(result.evidence, {
    providerMessageId: MESSAGE_ID,
    providerGroupId: "provider-group-1",
    statusCode: "2000",
    statusMessage: "접수",
    observedAt: NOW.toISOString(),
    requestKeyMatched: true,
  })
})

test("send payload checksum changes for every provider-visible input and stays deterministic", async () => {
  const accepted = async () => response({
    groupInfo: { groupId: "provider-group-1" },
    messageList: [{ messageId: MESSAGE_ID, statusCode: "2000", statusMessage: "접수" }],
    failedMessageList: [],
  })
  const base = {
    to: "01012345678",
    templateId: "template-level",
    variables: { "#{학생명}": "김팁스" },
    buttons: [{
      name: "문의하기",
      type: "WL",
      linkMobile: "https://tipsedu.channel.io",
      linkPc: "https://tipsedu.channel.io",
    }],
    requestKey: REQUEST_KEY,
  }
  const checksum = async (input, overrides = {}) => (
    await makeAdapter(accepted, overrides).send(input)
  ).providerPayloadChecksum
  const baseline = await checksum(base)

  assert.match(baseline, /^[a-f0-9]{64}$/u)
  assert.equal(await checksum(base), baseline)
  for (const changed of [
    { ...base, to: "01087654321" },
    { ...base, templateId: "template-visit" },
    { ...base, variables: { "#{학생명}": "이팁스" } },
    { ...base, buttons: [{ ...base.buttons[0], name: "상담하기" }] },
    { ...base, requestKey: "00000000-0000-4000-8000-000000000012" },
  ]) {
    assert.notEqual(await checksum(changed), baseline)
  }
  assert.notEqual(await checksum(base, { pfId: "pf-other" }), baseline)
})

test("send preserves canonical renderer variable tokens exactly once", async () => {
  const calls = []
  const adapter = makeAdapter(async (url, init) => {
    calls.push({ url: String(url), init })
    return response({
      groupInfo: { groupId: "provider-group-1" },
      messageList: [{ messageId: MESSAGE_ID, statusCode: "2000", statusMessage: "접수" }],
      failedMessageList: [],
    })
  })
  const rendered = renderRegistrationCustomerMessage({
    kind: "waiting_notice",
    facts: {
      studentName: "김팁스 학생",
      subjects: ["영어"],
      waitingKind: "current_term_opening",
    },
  })

  await adapter.send({
    to: "01012345678",
    templateId: "template-waiting",
    variables: rendered.variables,
    buttons: rendered.buttons,
    requestKey: REQUEST_KEY,
  })

  const payload = JSON.parse(calls[0].init.body)
  assert.deepEqual(payload.messages[0].kakaoOptions.variables, {
    "#{학생명}": "김팁스",
    "#{과목}": "영어",
    "#{대기종류}": "신규반 대기",
    "#{대기내용}": "신규반 개설 대기",
  })
})

test("send normalizes explicit rejection, failed list, 5xx, malformed JSON, and timeout", async () => {
  const cases = [
    [async () => response({ errorCode: "InvalidRequest", errorMessage: "거부" }, 400), "failed_hold", "provider_rejected"],
    [async () => new Response("not-json", { status: 400 }), "failed_hold", "provider_rejected"],
    [async () => response({
      messageList: [{ messageId: MESSAGE_ID, statusCode: "1048", statusMessage: "버튼 URL 값은 최대 100자까지 사용 가능합니다." }],
      failedMessageList: [],
    }), "failed_hold", "1048"],
    [async () => response({ failedMessageList: [{ statusCode: "3001", statusMessage: "실패" }] }), "failed_hold", "3001"],
    [async () => response({ errorMessage: "upstream raw detail" }, 503), "unknown", "provider_unavailable"],
    [async () => new Response("not-json", { status: 200 }), "unknown", "provider_response_invalid"],
    [async () => { throw new DOMException("timed out with secret detail", "AbortError") }, "unknown", "provider_timeout"],
  ]

  for (const [fetch, outcome, statusCode] of cases) {
    const result = await makeAdapter(fetch).send({
      to: "01012345678",
      templateId: "template-level",
      variables: { 학생명: "김팁스" },
      buttons: [],
      requestKey: REQUEST_KEY,
    })
    assert.equal(result.outcome, outcome)
    assert.equal(result.evidence.statusCode, statusCode)
    assert.match(result.providerPayloadChecksum, /^[a-f0-9]{64}$/u)
    const serialized = JSON.stringify(result)
    assert.equal(serialized.includes(API_SECRET), false)
    assert.equal(serialized.includes("01012345678"), false)
    assert.equal(serialized.includes("upstream raw detail"), false)
    assert.equal(serialized.includes("timed out with secret detail"), false)
  }
})

test("lookup uses exact stored message ID and requires the frozen request key", async () => {
  const calls = []
  const adapter = makeAdapter(async (url, init) => {
    calls.push({ url: new URL(String(url)), init })
    return response({
      messageList: {
        [MESSAGE_ID]: {
          messageId: MESSAGE_ID,
          groupId: "provider-group-1",
          status: "COMPLETE",
          statusCode: "4000",
          statusMessage: "성공",
          customFields: JSON.stringify({ registrationRequestKey: REQUEST_KEY }),
        },
      },
    })
  })

  const result = await adapter.lookup({ providerMessageId: MESSAGE_ID, requestKey: REQUEST_KEY })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url.origin + calls[0].url.pathname, SOLAPI_MESSAGE_LIST_URL)
  assert.equal(calls[0].url.searchParams.get("criteria"), "messageId")
  assert.equal(calls[0].url.searchParams.get("cond"), "eq")
  assert.equal(calls[0].url.searchParams.get("value"), MESSAGE_ID)
  assert.equal(calls[0].init.method, "GET")
  assert.equal(result.outcome, "accepted")
  assert.equal(result.evidence.requestKeyMatched, true)

  const mismatch = await makeAdapter(async () => response({
    messageList: [{
      messageId: MESSAGE_ID,
      status: "COMPLETE",
      statusCode: "4000",
      customFields: { registrationRequestKey: "00000000-0000-4000-8000-000000000099" },
    }],
  })).lookup({ providerMessageId: MESSAGE_ID, requestKey: REQUEST_KEY })
  assert.equal(mismatch.outcome, "unknown")
  assert.equal(mismatch.evidence.requestKeyMatched, false)

  const groupMismatch = await makeAdapter(async () => response({
    messageList: [{
      messageId: MESSAGE_ID,
      groupId: "wrong-group",
      status: "COMPLETE",
      statusCode: "4000",
      customFields: { registrationRequestKey: REQUEST_KEY },
    }],
  })).lookup({
    providerMessageId: MESSAGE_ID,
    providerGroupId: "provider-group-1",
    requestKey: REQUEST_KEY,
  })
  assert.equal(groupMismatch.outcome, "unknown")
  assert.equal(groupMismatch.evidence.requestKeyMatched, false)

  const nonSuccess4xxx = await makeAdapter(async () => response({
    messageList: [{
      messageId: MESSAGE_ID,
      status: "COMPLETE",
      statusCode: "4999",
      customFields: { registrationRequestKey: REQUEST_KEY },
    }],
  })).lookup({ providerMessageId: MESSAGE_ID, requestKey: REQUEST_KEY })
  assert.equal(nonSuccess4xxx.outcome, "failed_hold")
})

test("template preflight accepts only an exact APPROVED channel/content/variables/buttons match", async () => {
  const catalog = createRegistrationCustomerMessageCatalog(ENV)
  const entry = catalog.templates.admission_application
  const exactTemplate = {
    templateId: entry.templateId,
    channelId: PF_ID,
    status: "APPROVED",
    content: entry.content,
    variables: entry.variables.map((name) => `#{${name}}`),
    buttons: entry.buttons.map((button) => ({
      buttonName: button.name,
      buttonType: button.type,
      linkMo: button.linkMobile,
      linkPc: button.linkPc,
    })),
  }
  const exact = await makeAdapter(async () => response({ templateList: [exactTemplate] }))
    .preflight({ entry })
  assert.deepEqual(exact, {
    matched: true,
    receipt: {
      templateId: entry.templateId,
      pfId: PF_ID,
      catalogChecksum: entry.checksums.template,
      providerChecksum: entry.checksums.template,
      providerStatus: "sendable",
    },
  })

  for (const changed of [
    { ...exactTemplate, status: "INSPECTING" },
    { ...exactTemplate, status: "approved" },
    { ...exactTemplate, channelId: "other-channel" },
    { ...exactTemplate, content: `${entry.content} 변경` },
    { ...exactTemplate, content: ` ${entry.content}` },
    { ...exactTemplate, variables: [] },
    { ...exactTemplate, variables: [" #{학생명}"] },
    { ...exactTemplate, buttons: [] },
  ]) {
    const drift = await makeAdapter(async () => response({ templateList: [changed] }))
      .preflight({ entry })
    assert.equal(drift.matched, false)
    assert.equal(drift.code, "template_drift")
    assert.equal("receipt" in drift, false)
  }
})

test("observation preflight accepts reordered exact variables and rejects closed-contract drift without send calls", async () => {
  const observationEntry = createRegistrationCustomerMessageCatalog({
    ...ENV,
    SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID: "template-observation-booking",
  }).templates.observation_booking
  const exactObservationTemplate = {
    templateId: observationEntry.templateId,
    channelId: PF_ID,
    status: "APPROVED",
    content: observationEntry.content,
    variables: [...observationEntry.variables, ...observationEntry.transportVariables]
      .map((name) => `#{${name}}`),
    buttons: observationEntry.buttons.map((button) => ({
      buttonName: button.name,
      buttonType: button.type,
      linkMo: button.linkMobile,
      linkPc: button.linkPc,
    })),
  }
  const observationDriftCases = [
    { ...exactObservationTemplate, variables: exactObservationTemplate.variables.slice(0, -1) },
    { ...exactObservationTemplate, variables: [...exactObservationTemplate.variables, "#{임의변수}"] },
    { ...exactObservationTemplate, variables: [...exactObservationTemplate.variables.slice(0, -1), exactObservationTemplate.variables[0]] },
    { ...exactObservationTemplate, buttons: [
      { ...exactObservationTemplate.buttons[0], linkMo: "https://bit.ly/tips", linkPc: "https://bit.ly/tips" },
      exactObservationTemplate.buttons[1],
    ] },
    { ...exactObservationTemplate, buttons: exactObservationTemplate.buttons.slice(0, 1) },
  ]
  const urls = []
  const preflight = async (template) => makeAdapter(async (url) => {
    urls.push(String(url))
    return response({ templateList: [template] })
  }).preflight({ entry: observationEntry })

  for (const changed of observationDriftCases) {
    assert.deepEqual(await preflight(changed), { matched: false, code: "template_drift" })
  }
  const reordered = {
    ...exactObservationTemplate,
    variables: [...exactObservationTemplate.variables].reverse(),
  }
  assert.equal((await preflight(reordered)).matched, true)
  assert.equal(urls.length, observationDriftCases.length + 1)
  assert.equal(urls.some((url) => url === SOLAPI_SEND_MANY_URL), false)
  assert.equal(urls.every((url) => url.startsWith("https://api.solapi.com/kakao/v2/templates/")), true)
})
