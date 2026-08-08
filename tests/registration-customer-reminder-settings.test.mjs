import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  createRegistrationCustomerReminderSettingsService,
} from "../src/features/notifications/registration-customer-reminder-service.ts"

const SETTINGS = Object.freeze({
  enabled: false,
  leadHours: 3,
  revision: "1",
  updatedAt: "2026-08-08T06:00:00.000Z",
  ready: false,
  status: "approval_pending",
  editable: true,
})

test("설정 service는 access token을 사용하고 provider 식별자를 받지 않는다", async () => {
  const calls = []
  const service = createRegistrationCustomerReminderSettingsService({
    baseUrl: "https://tipsedu.co.kr",
    getAccessToken: async () => "access-token",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      return Response.json({ ok: true, settings: SETTINGS })
    },
  })

  assert.deepEqual(await service.get(), SETTINGS)
  assert.deepEqual(await service.update({ enabled: true, leadHours: 4, expectedRevision: "1" }), SETTINGS)
  assert.equal(calls[0].init.headers.Authorization, "Bearer access-token")
  assert.equal(calls[1].init.method, "PATCH")
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    enabled: true,
    leadHours: 4,
    expectedRevision: "1",
  })
  assert.equal(calls.some(({ init }) => JSON.stringify(init).includes("templateId")), false)
})

test("설정 service는 누락·추가 필드가 있는 응답을 거절한다", async () => {
  for (const settings of [
    { ...SETTINGS, templateId: "unsafe" },
    { ...SETTINGS, leadHours: 0 },
    { ...SETTINGS, editable: "yes" },
  ]) {
    const service = createRegistrationCustomerReminderSettingsService({
      baseUrl: "https://tipsedu.co.kr",
      getAccessToken: async () => "access-token",
      fetch: async () => Response.json({ ok: true, settings }),
    })
    await assert.rejects(service.get(), /registration_customer_reminder_settings_invalid/)
  }
})

test("설정 조회와 저장은 서버가 멈춰도 제한시간 내 종료한다", async () => {
  const signals = []
  const service = createRegistrationCustomerReminderSettingsService({
    baseUrl: "https://tipsedu.co.kr",
    getAccessToken: async () => "access-token",
    timeoutMs: 5,
    fetch: async (_url, init) => {
      signals.push(init.signal)
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })
      })
    },
  })

  await assert.rejects(service.get())
  await assert.rejects(service.update({ enabled: false, leadHours: 3, expectedRevision: "1" }))
  assert.equal(signals.length, 2)
  assert.equal(signals.every((signal) => signal?.aborted), true)
})

test("등록 알림 화면은 고객 자동 발송과 예약 N시간 전만 노출하고 내부 reminder rules를 숨긴다", async () => {
  const [panel, component] = await Promise.all([
    readFile(new URL("../src/features/notifications/notification-control-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/notifications/registration-customer-reminder-settings.tsx", import.meta.url), "utf8").catch(() => ""),
  ])

  assert.match(panel, /activeWorkflow === "registration"[\s\S]*RegistrationCustomerReminderSettings/)
  assert.match(panel, /rule\.eventKey !== "registration\.appointment_reminder_due"/)
  assert.doesNotMatch(panel, /현재 예약 알림이 발송되지 않습니다/)
  assert.match(component, />자동 발송</)
  assert.match(component, /예약[\s\S]*시간 전/)
  assert.match(component, /min=\{1\}/)
  assert.match(component, /max=\{72\}/)
  assert.doesNotMatch(component, /전날|당일|분 전|대상 선택/)
})

test("발송 감사 문구는 자동은 자동 발송·시각, 수동은 요청 담당자·시각으로 읽힌다", async () => {
  const source = await readFile(
    new URL("../src/features/tasks/registration-alimtalk-preview-dialog.tsx", import.meta.url),
    "utf8",
  )

  assert.match(source, /confirmedByName === "자동 발송"/)
  assert.match(source, /자동 발송/)
  assert.match(source, /발송 요청 · \$\{confirmedByName\}/)
  assert.match(source, /formatAuditTimestamp\(auditMessage\.confirmedAt\)/)
  assert.doesNotMatch(source, />발송 요청 · \{auditMessage\.confirmedByName\}/)
})
