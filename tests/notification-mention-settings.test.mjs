import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { chromium } from "/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"

const serviceModuleUrl = new URL(
  "../src/features/notifications/notification-mention-settings-service.ts",
  import.meta.url,
)
const routeModuleUrl = new URL(
  "../src/features/notifications/server/notification-mention-settings-route.ts",
  import.meta.url,
)

const ADMIN_ID = "30000000-0000-4000-8000-000000000001"
const RULE_ID = "30000000-0000-4000-8000-000000000101"
const OTHER_RULE_ID = "30000000-0000-4000-8000-000000000102"
const REQUEST_ID = "30000000-0000-4000-8000-000000000201"
const REPLAY_ID = "30000000-0000-4000-8000-000000000202"
const REVISION = "9007199254740997"
const root = resolve(new URL("../", import.meta.url).pathname)
const runtimeNode = "/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const fixturePort = 4327
const fixtureUrl = `http://127.0.0.1:${fixturePort}`

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function request(url, method, body) {
  return new Request(url, {
    method,
    headers: {
      Authorization: "Bearer session-token",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function wireSetting(overrides = {}) {
  return {
    rule_id: RULE_ID,
    workflow_key: "registration",
    event_key: "registration.appointment_created",
    channel_key: "google_chat",
    mention_enabled: true,
    revision: REVISION,
    updated_at: "2026-08-11T00:00:00.000Z",
    editable: true,
    ...overrides,
  }
}

function rpcSetting(overrides = {}) {
  const setting = wireSetting(overrides)
  return {
    ruleId: setting.rule_id,
    workflowKey: setting.workflow_key,
    eventKey: setting.event_key,
    channelKey: setting.channel_key,
    mentionEnabled: setting.mention_enabled,
    revision: setting.revision,
    updatedAt: setting.updated_at,
    editable: setting.editable,
  }
}

async function waitForFixtureServer(output) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(fixtureUrl)).ok) return
    } catch {
      // The test-only Next fixture has not started yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`notification_mention_fixture_timeout:${output()}`)
}

function panelSnapshot(workflowKey, ruleId, eventKey) {
  return {
    scope_key: "global",
    workflow_key: workflowKey,
    rules: [ruleId, OTHER_RULE_ID].map((id, index) => ({
      id,
      workflow_key: workflowKey,
      event_key: index === 0 ? eventKey : workflowKey === "registration"
        ? "registration.inquiry_routed"
        : "transfer.processing_started",
      event_label: index === 0 ? "신청 생성" : "신청 변경",
      group_label: "알림",
      trigger_description: "변경 시",
      sort_order: index + 1,
      audience_key: "management_team",
      audience_label: "관리팀",
      channel_key: "google_chat",
      channel_label: "Google Chat",
      connection_key: "google_chat.management",
      rule_variant_key: "immediate",
      delivery_mode: "immediate",
      schedule_key: null,
      schedule_config: null,
      enabled: false,
      configuration_kind: "editable_rule",
      activation_locked: false,
      content_contract: {
        contractVersion: "1",
        availableVariables: [
          { key: "task_title", token: "업무", piiClass: "none" },
          { key: "current_status", token: "현재상태", piiClass: "none" },
          { key: "current_assignee", token: "현재담당", piiClass: "staff_name" },
        ],
        requiredTokens: ["업무", "현재상태", "현재담당"],
        optionalLineTokens: [],
        mustHaveFacts: ["target", "event", "current_state"],
        supportedPayloadVersions: [1],
        destinationPolicy: { allowedConnectionKeys: ["google_chat.management"], subjectScoped: false },
        freeTextVisibility: {},
        freeTextPriority: [],
        fieldPresence: {
          task_title: { required: true, nullBehavior: "reject", nullDisplay: null, emptyArrayBehavior: "reject" },
          current_status: { required: true, nullBehavior: "reject", nullDisplay: null, emptyArrayBehavior: "reject" },
          current_assignee: { required: true, nullBehavior: "reject", nullDisplay: null, emptyArrayBehavior: "reject" },
        },
      },
      template_compliance: { contract_version: "1", compliance: "conformant", violations: [] },
      active_template_id: index === 0
        ? "30000000-0000-4000-8000-000000000111"
        : "30000000-0000-4000-8000-000000000112",
      revision: REVISION,
      updated_at: "2026-08-11T00:00:00.000Z",
      template: {
        id: index === 0
          ? "30000000-0000-4000-8000-000000000111"
          : "30000000-0000-4000-8000-000000000112",
        rule_id: id,
        version: REVISION,
        title_template: "새 {task_title}",
        body_template: "{task_title} {current_status} {current_assignee}",
        allowed_variables: [],
        payload_schema_version: 1,
        content_contract_version: "1",
        checksum: "fixture-checksum",
      },
    })),
    connections: [{
      connection_key: "google_chat.management",
      connection_state: "encrypted_active",
      revision: REVISION,
      webhook_url_mask: "chat.googleapis.com/v1/spaces/SPAC…3456/messages",
      last_verified_at: null,
      last_error_code: null,
      editable: true,
    }],
    delivery_summary: { pending_count: 0, sent_count: 0, failed_count: 0, unknown_count: 0, latest_delivery_at: null },
    loaded_at: "2026-08-11T00:00:00.000Z",
  }
}

test("removing strict endpoint parsing would admit an extra payload key or a non-Google row", async () => {
  const { createNotificationMentionSettingsService, NotificationMentionSettingsHttpError } = await import(serviceModuleUrl)
  const calls = []
  const service = createNotificationMentionSettingsService({
    baseUrl: "http://localhost",
    getAccessToken: async () => "session-token",
    fetch: async (url, init) => {
      calls.push([String(url), init])
      return response({ settings: [wireSetting()] })
    },
  })

  const settings = await service.getMentionSettings({ workflowKey: "registration" })
  assert.deepEqual(settings, [{
    ruleId: RULE_ID,
    workflowKey: "registration",
    eventKey: "registration.appointment_created",
    channelKey: "google_chat",
    mentionEnabled: true,
    revision: REVISION,
    updatedAt: "2026-08-11T00:00:00.000Z",
    editable: true,
  }])
  assert.equal(new URL(calls[0][0]).search, "?workflow_key=registration")

  const unsafe = createNotificationMentionSettingsService({
    baseUrl: "http://localhost",
    getAccessToken: async () => "session-token",
    fetch: async () => response({ settings: [wireSetting({ channel_key: "alimtalk" })] }),
  })
  await assert.rejects(
    unsafe.getMentionSettings({ workflowKey: "registration" }),
    (error) => error instanceof NotificationMentionSettingsHttpError
      && error.code === "notification_unsafe_response"
      && error.status === 502,
  )
})

test("removing the independent PATCH boundary would let mention save mutate the control-plane draft payload", async () => {
  const { createNotificationMentionSettingsService, NotificationMentionSettingsHttpError } = await import(serviceModuleUrl)
  const requests = []
  const service = createNotificationMentionSettingsService({
    baseUrl: "http://localhost",
    getAccessToken: async () => "session-token",
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body))
      return response({ setting: wireSetting({ mention_enabled: false, revision: "9007199254740998" }) })
    },
  })
  const saved = await service.saveMentionSetting({
    ruleId: RULE_ID,
    mentionEnabled: false,
    expectedRevision: REVISION,
    requestId: REQUEST_ID,
  })
  assert.deepEqual(requests, [{
    rule_id: RULE_ID,
    mention_enabled: false,
    expected_revision: REVISION,
    request_id: REQUEST_ID,
  }])
  assert.equal(saved.revision, "9007199254740998")

  const stale = createNotificationMentionSettingsService({
    baseUrl: "http://localhost",
    getAccessToken: async () => "session-token",
    fetch: async () => response({ ok: false, code: "notification_mention_setting_revision_conflict" }, 409),
  })
  await assert.rejects(
    stale.saveMentionSetting({
      ruleId: RULE_ID,
      mentionEnabled: false,
      expectedRevision: REVISION,
      requestId: REQUEST_ID,
    }),
    (error) => error instanceof NotificationMentionSettingsHttpError
      && error.code === "notification_mention_setting_revision_conflict"
      && error.status === 409,
  )
})

test("removing role, stale, replay, or non-Google guards would call the setting RPC incorrectly", async () => {
  const { createNotificationMentionSettingsRouteHandlers } = await import(routeModuleUrl)
  const calls = []
  const replay = new Map()
  const handlers = createNotificationMentionSettingsRouteHandlers({
    authenticate: async () => ({ userId: ADMIN_ID, role: "staff", client: { caller: true } }),
    getMentionSettings: async ({ workflowKey, client }) => {
      calls.push(["get", workflowKey, client])
      return [rpcSetting()]
    },
    saveMentionSetting: async (input) => {
      calls.push(["save", input])
      if (input.ruleId === OTHER_RULE_ID) {
        const error = new Error("non-google")
        error.status = 400
        error.code = "notification_invalid_request"
        throw error
      }
      const key = input.requestId
      if (!replay.has(key)) replay.set(key, rpcSetting({
        mention_enabled: input.mentionEnabled,
        revision: "9007199254740998",
      }))
      return replay.get(key)
    },
  })

  const get = await handlers.get(request(
    "http://localhost/api/notifications/mention-settings?workflow_key=registration",
    "GET",
  ))
  assert.equal(get.status, 200)
  assert.deepEqual((await get.json()).settings, [wireSetting()])

  const payload = {
    rule_id: RULE_ID,
    mention_enabled: false,
    expected_revision: REVISION,
    request_id: REPLAY_ID,
  }
  const first = await handlers.patch(request(
    "http://localhost/api/notifications/mention-settings", "PATCH", payload,
  ))
  const second = await handlers.patch(request(
    "http://localhost/api/notifications/mention-settings", "PATCH", payload,
  ))
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), await second.json(), "same request id must replay the identical row")
  assert.deepEqual(calls[1][1], {
    ruleId: RULE_ID,
    mentionEnabled: false,
    expectedRevision: REVISION,
    requestId: REPLAY_ID,
    client: { caller: true },
  })

  const staleHandlers = createNotificationMentionSettingsRouteHandlers({
    authenticate: async () => ({ userId: ADMIN_ID, role: "admin", client: {} }),
    getMentionSettings: async () => [],
    saveMentionSetting: async () => {
      const error = new Error("stale")
      error.status = 409
      error.code = "notification_mention_setting_revision_conflict"
      throw error
    },
  })
  const stale = await staleHandlers.patch(request(
    "http://localhost/api/notifications/mention-settings", "PATCH", {
      ...payload,
      request_id: REQUEST_ID,
    },
  ))
  assert.equal(stale.status, 409)

  const viewer = createNotificationMentionSettingsRouteHandlers({
    authenticate: async () => ({ userId: ADMIN_ID, role: "viewer", client: {} }),
    getMentionSettings: async () => [],
    saveMentionSetting: async () => rpcSetting(),
  })
  assert.equal((await viewer.patch(request(
    "http://localhost/api/notifications/mention-settings", "PATCH", payload,
  ))).status, 403)
  assert.equal((await handlers.patch(request(
    "http://localhost/api/notifications/mention-settings", "PATCH", {
      ...payload,
      rule_id: OTHER_RULE_ID,
      request_id: REQUEST_ID,
    },
  ))).status, 400)
  assert.equal((await handlers.patch(request(
    "http://localhost/api/notifications/mention-settings", "PATCH", {
      ...payload,
      unexpected: true,
    },
  ))).status, 400)
})

test("real panel keeps the draft isolated while retrying, scoping, and applying per-rule mention saves", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "tips-notification-mention-"))
  let server
  let browser
  let output = ""
  try {
    await symlink(join(root, "node_modules"), join(fixtureRoot, "node_modules"))
    await mkdir(join(fixtureRoot, "app"))
    await mkdir(join(fixtureRoot, "src", "lib"), { recursive: true })
    await symlink(join(root, "src", "components"), join(fixtureRoot, "src", "components"))
    await symlink(join(root, "src", "features"), join(fixtureRoot, "src", "features"))
    await symlink(join(root, "src", "lib", "utils.ts"), join(fixtureRoot, "src", "lib", "utils.ts"))
    await writeFile(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}\n')
    await writeFile(join(fixtureRoot, "src", "lib", "supabase.ts"), `
export const supabase = {
  auth: { getSession: async () => ({ data: { session: { access_token: "fixture-token" } }, error: null }) },
  rpc: async () => ({ data: null, error: new Error("unexpected fixture RPC") }),
};
`)
    await writeFile(join(fixtureRoot, "next.config.mjs"), `
import path from "node:path";
export default {
  experimental: { externalDir: true },
  webpack(config) {
    config.resolve.alias["@"] = path.join(process.cwd(), "src");
    return config;
  },
};
`)
    await writeFile(join(fixtureRoot, "app", "layout.tsx"), `
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}
`)
    await writeFile(join(fixtureRoot, "app", "page.tsx"), `
"use client";
import { useEffect, useState } from "react";
import { NotificationControlPanel } from ${JSON.stringify(join(root, "src/features/notifications/notification-control-panel.tsx"))};
export default function Page() {
  const [workflow, setWorkflow] = useState("registration");
  useEffect(() => { (window as any).__notificationMentionSetWorkflow = setWorkflow; }, []);
  return <main>
    <NotificationControlPanel workflowKey={workflow as "registration" | "transfer"} presentation="dialog" open />
  </main>;
}
`)
    server = spawn(runtimeNode, [
      join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "-p", String(fixturePort),
    ], { cwd: fixtureRoot, stdio: ["ignore", "pipe", "pipe"] })
    server.stdout.on("data", (chunk) => { output += chunk })
    server.stderr.on("data", (chunk) => { output += chunk })
    await waitForFixtureServer(() => output)
    browser = await chromium.launch({ executablePath: chrome, headless: true })
    const page = await browser.newPage()
    const browserErrors = []
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text())
    })
    page.on("pageerror", (error) => browserErrors.push(error.message))
    const registrationSnapshot = panelSnapshot("registration", RULE_ID, "registration.case_created")
    const transferSnapshot = panelSnapshot("transfer", RULE_ID, "transfer.submitted")
    const mentionRows = [
      wireSetting({ mention_enabled: false }),
      wireSetting({
        rule_id: OTHER_RULE_ID,
        event_key: "registration.inquiry_routed",
        mention_enabled: false,
      }),
    ]
    await page.addInitScript(({ registrationSnapshot: initialRegistration, transferSnapshot: initialTransfer, initialMentions }) => {
      const fixture = { requests: [], patches: [], pending: [], pendingLists: [], delayNextList: false };
      window.__notificationMentionFixture = fixture;
      window.fetch = (input, init = {}) => {
        const url = new URL(String(input), window.location.origin);
        if (url.pathname === "/api/notifications/control-plane") {
          const workflow = url.searchParams.get("workflow_key");
          fixture.requests.push({ path: url.pathname, workflow, method: init.method || "GET" });
          return Promise.resolve(new Response(JSON.stringify(workflow === "transfer" ? initialTransfer : initialRegistration), { status: 200 }));
        }
        if (url.pathname === "/api/notifications/mention-settings" && (init.method || "GET") === "GET") {
          const workflow = url.searchParams.get("workflow_key");
          fixture.requests.push({ path: url.pathname, workflow, method: "GET" });
          const settings = workflow === "transfer"
            ? initialMentions.map((row) => ({ ...row, workflow_key: "transfer", event_key: "transfer.submitted" }))
            : initialMentions;
          if (fixture.delayNextList) {
            fixture.delayNextList = false;
            return new Promise((resolve) => fixture.pendingLists.push({ resolve, settings }));
          }
          return Promise.resolve(new Response(JSON.stringify({ settings }), { status: 200 }));
        }
        if (url.pathname === "/api/notifications/mention-settings") {
          const body = JSON.parse(init.body);
          fixture.patches.push(body);
          return new Promise((resolve, reject) => fixture.pending.push({ resolve, reject }));
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      };
    }, { registrationSnapshot, transferSnapshot, initialMentions: mentionRows })
    await page.goto(fixtureUrl)
    await page.waitForTimeout(1000)
    const initialBody = await page.locator("body").innerText()
    if (!initialBody.includes("확인된 Google Chat 계정만 멘션합니다.")) {
      const requests = await page.evaluate(() => window.__notificationMentionFixture?.requests ?? [])
      throw new Error(`panel_fixture_bootstrap:${JSON.stringify({ output, browserErrors, initialBody, requests })}`)
    }
    await page.getByRole("switch", { name: "관리팀 Google Chat" }).first().click()
    await page.getByRole("button", { name: "내용 수정" }).first().click()
    await page.getByLabel("제목").fill("새 {업무} 수정")
    await page.getByLabel("본문").fill("{업무} {현재상태} {현재담당} 수정")
    await page.keyboard.press("Escape")
    await page.getByText("저장하지 않은 변경사항이 있습니다.", { exact: true }).waitFor()

    const firstMention = page.getByRole("switch", { name: "담당자 멘션" }).first()
    await firstMention.click()
    await page.waitForFunction(() => window.__notificationMentionFixture.patches.length === 1)
    await page.evaluate(() => window.__notificationMentionFixture.pending[0].reject(new Error("ambiguous transport failure")))
    await page.getByText("담당자 멘션을 저장하지 못했습니다.", { exact: true }).first().waitFor()
    await firstMention.click()
    await page.waitForFunction(() => window.__notificationMentionFixture.patches.length === 2)
    const replayIds = await page.evaluate(() => window.__notificationMentionFixture.patches.slice(0, 2).map((body) => body.request_id))
    assert.equal(replayIds[0], replayIds[1], "ambiguous retry must keep its idempotency key")
    await page.evaluate((ruleId) => window.__notificationMentionFixture.pending[1].resolve(new Response(JSON.stringify({ setting: {
      rule_id: ruleId, workflow_key: "registration", event_key: "registration.case_created", channel_key: "google_chat",
      mention_enabled: true, revision: "9007199254740998", updated_at: "2026-08-11T00:01:00.000Z", editable: true,
    } }), { status: 200 })), RULE_ID)
    await page.waitForFunction(() => document.querySelectorAll('[role="switch"][aria-label="담당자 멘션"]')[0]?.getAttribute("data-state") === "checked")
    await page.getByText("저장하지 않은 변경사항이 있습니다.", { exact: true }).waitFor()

    await firstMention.click()
    await page.waitForFunction(() => window.__notificationMentionFixture.patches.length === 3)
    const freshId = await page.evaluate(() => window.__notificationMentionFixture.patches[2].request_id)
    assert.notEqual(freshId, replayIds[1], "new intent after a definitive result needs a fresh id")
    await page.evaluate(() => window.__notificationMentionFixture.pending[2].resolve(new Response(JSON.stringify({
      ok: false,
      code: "notification_mention_setting_revision_conflict",
    }), { status: 409 })))
    await page.getByText("다른 사용자가 담당자 멘션을 먼저 변경했습니다. 다시 확인해 주세요.", { exact: true }).first().waitFor()
    assert.equal(await page.getByRole("switch", { name: "관리팀 Google Chat" }).first().isChecked(), true)
    await page.getByRole("button", { name: "내용 수정" }).first().click()
    assert.equal(await page.getByLabel("제목").inputValue(), "새 {업무} 수정")
    assert.equal(await page.getByLabel("본문").inputValue(), "{업무} {현재상태} {현재담당} 수정")
    await page.keyboard.press("Escape")
    await firstMention.click()
    await page.waitForFunction(() => window.__notificationMentionFixture.patches.length === 4)
    const afterConflictId = await page.evaluate(() => window.__notificationMentionFixture.patches[3].request_id)
    assert.notEqual(afterConflictId, freshId, "a definitive conflict clears the retry key")
    await page.evaluate(() => window.__notificationMentionSetWorkflow("transfer"))
    await page.getByText("전반 알림 설정", { exact: true }).waitFor()
    await page.evaluate((ruleId) => window.__notificationMentionFixture.pending[3].resolve(new Response(JSON.stringify({ setting: {
      rule_id: ruleId, workflow_key: "registration", event_key: "registration.case_created", channel_key: "google_chat",
      mention_enabled: true, revision: "9007199254740999", updated_at: "2026-08-11T00:02:00.000Z", editable: true,
    } }), { status: 200 })), RULE_ID)
    await page.waitForTimeout(50)
    const activeMentions = await page.evaluate(() => Array.from(document.querySelectorAll('[data-notification-mention-setting]')).map((node) => node.getAttribute("data-notification-mention-setting")))
    assert.deepEqual([...new Set(activeMentions)], [RULE_ID, OTHER_RULE_ID])
    assert.equal(await page.getByRole("switch", { name: "담당자 멘션" }).first().isChecked(), false)
    assert.equal(await page.getByText("담당자 멘션을 저장하지 못했습니다.", { exact: true }).count(), 0)
    await page.getByRole("switch", { name: "담당자 멘션" }).first().click()
    await page.waitForFunction(() => window.__notificationMentionFixture.patches.length === 5)
    await page.evaluate(() => window.__notificationMentionSetWorkflow("registration"))
    await page.getByText("등록 알림 설정", { exact: true }).waitFor()
    await page.evaluate(() => window.__notificationMentionFixture.pending[4].reject(new Error("old scope error")))
    await page.waitForTimeout(50)
    assert.equal(await page.getByText("담당자 멘션을 저장하지 못했습니다.", { exact: true }).count(), 0)
    await page.evaluate(() => {
      window.__notificationMentionFixture.delayNextList = true
      window.__notificationMentionSetWorkflow("transfer")
    })
    await page.getByText("전반 알림 설정", { exact: true }).waitFor()
    await page.waitForFunction(() => window.__notificationMentionFixture.pendingLists.length === 1)
    await page.evaluate(() => window.__notificationMentionSetWorkflow("registration"))
    await page.getByText("등록 알림 설정", { exact: true }).waitFor()
    await page.evaluate(() => window.__notificationMentionFixture.pendingLists[0].resolve(new Response(JSON.stringify({
      settings: window.__notificationMentionFixture.pendingLists[0].settings,
    }), { status: 200 })))
    await page.waitForTimeout(50)
    assert.equal(await page.getByRole("switch", { name: "담당자 멘션" }).first().isChecked(), false, "a stale list completion cannot replace the active scope")
    const controlPlanePatches = await page.evaluate(() => window.__notificationMentionFixture.requests.filter((item) => item.path === "/api/notifications/control-plane" && item.method === "PATCH"))
    assert.deepEqual(controlPlanePatches, [], "mention saves must not serialize the existing draft")
  } finally {
    await browser?.close()
    server?.kill("SIGTERM")
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})
