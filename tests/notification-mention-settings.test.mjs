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
        ? "registration.consultation_completed"
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

test("an unadopted workflow returns an empty closed setting list without a save transition", async () => {
  const calls = []
  const { createNotificationMentionSettingsRouteHandlers } = await import(routeModuleUrl)
  const handlers = createNotificationMentionSettingsRouteHandlers({
    authenticate: async () => ({ userId: ADMIN_ID, role: "admin", client: {} }),
    getMentionSettings: async ({ workflowKey }) => {
      calls.push(["get", workflowKey])
      return []
    },
    saveMentionSetting: async () => {
      calls.push(["save"])
      throw new Error("unadopted workflow must not save")
    },
  })

  const result = await handlers.get(request(
    "http://localhost/api/notifications/mention-settings?workflow_key=registration",
    "GET",
  ))
  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), { settings: [] })
  assert.deepEqual(calls, [["get", "registration"]])
})

test("real panel cancels local template edits and atomically saves mention and rule drafts with retry and conflict recovery", async () => {
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
      wireSetting({ event_key: "registration.case_created", mention_enabled: false }),
      wireSetting({ rule_id: OTHER_RULE_ID, event_key: "registration.consultation_completed", mention_enabled: false }),
    ]
    await page.addInitScript(({ registrationSnapshot: registration, transferSnapshot: transfer, mentionRows: mentions }) => {
      const fixture = { registration, transfer, mentions, requests: [], patches: [], pending: [], standaloneMentionPatches: 0, pendingLists: [], delayNextList: false };
      window.__notificationMentionFixture = fixture;
      window.fetch = (input, init = {}) => {
        const url = new URL(String(input), window.location.origin);
        const method = init.method || "GET";
        fixture.requests.push({ path: url.pathname, method });
        if (url.pathname === "/api/notifications/control-plane") {
          if (method === "PATCH") {
            const body = JSON.parse(init.body);
            fixture.patches.push(body);
            return new Promise((resolve, reject) => fixture.pending.push({ body, resolve, reject }));
          }
          return Promise.resolve(new Response(JSON.stringify(url.searchParams.get("workflow_key") === "transfer" ? fixture.transfer : fixture.registration), { status: 200 }));
        }
        if (url.pathname === "/api/notifications/mention-settings" && method === "GET") {
          const isTransfer = url.searchParams.get("workflow_key") === "transfer";
          const settings = isTransfer ? fixture.mentions.map((row, index) => ({ ...row, workflow_key: "transfer", event_key: index ? "transfer.processing_started" : "transfer.submitted" })) : fixture.mentions;
          if (fixture.delayNextList) {
            fixture.delayNextList = false;
            return new Promise((resolve) => fixture.pendingLists.push({ resolve, settings }));
          }
          return Promise.resolve(new Response(JSON.stringify({ settings }), { status: 200 }));
        }
        if (url.pathname === "/api/notifications/mention-settings") fixture.standaloneMentionPatches += 1;
        return Promise.resolve(new Response(JSON.stringify({}), { status: 400 }));
      };
    }, { registrationSnapshot, transferSnapshot, mentionRows })
    await page.goto(fixtureUrl)
    await page.getByRole("button", { name: /관리팀 진행 공유.*상세 설정/ }).click()
    const ruleSwitch = () => page.getByRole("switch", { name: "상담 신청 · 관리팀 Google Chat", exact: true })
    const mentionSwitch = () => page.getByRole("switch", { name: "상담 신청 · 담당자 멘션", exact: true })
    const openEditor = () => page.getByRole("button", { name: "상담 신청 · 내용 수정", exact: true }).click()
    const closeGroup = () => page.getByRole("button", { name: "등록 알림 상세 닫기", exact: true }).click()
    const save = () => page.getByRole("button", { name: "변경사항 저장", exact: true }).click()
    await ruleSwitch().click()
    await mentionSwitch().click()
    assert.equal(await page.evaluate(() => window.__notificationMentionFixture.patches.length), 0, "switches only change local drafts")
    await openEditor()
    await page.getByLabel("제목", { exact: true }).fill("취소할 제목")
    await page.keyboard.press("Escape")
    await openEditor()
    assert.equal(await page.getByLabel("제목", { exact: true }).inputValue(), "새 {업무}")
    await page.getByLabel("제목", { exact: true }).fill("새 {업무} 수정")
    await page.getByLabel("본문", { exact: true }).fill("{업무} {현재상태} {현재담당} 수정")
    await page.getByRole("button", { name: "변경사항에 반영", exact: true }).click()
    await closeGroup()
    await page.getByText("저장하지 않은 변경사항이 있습니다.", { exact: true }).waitFor()
    await save()
    await page.waitForFunction(() => window.__notificationMentionFixture.patches.length === 1)
    const firstPatch = await page.evaluate(() => window.__notificationMentionFixture.patches[0])
    assert.equal(firstPatch.patch.rules[RULE_ID].enabled, true)
    assert.equal(firstPatch.patch.rules[RULE_ID].title_template, "새 {업무} 수정")
    assert.deepEqual(firstPatch.mention_patch, { [RULE_ID]: true })
    assert.deepEqual(firstPatch.expected_mention_revisions, { [RULE_ID]: REVISION })
    await page.evaluate(() => window.__notificationMentionFixture.pending[0].reject(new Error("ambiguous transport failure")))
    await page.getByText("설정을 저장하지 못했습니다. 입력한 내용은 유지했습니다. 다시 시도해 주세요.", { exact: true }).waitFor()
    await save()
    await page.waitForFunction(() => window.__notificationMentionFixture.patches.length === 2)
    assert.equal(await page.evaluate(() => window.__notificationMentionFixture.patches[1].request_id), firstPatch.request_id)
    const resolveSave = async (index) => page.evaluate((pendingIndex) => {
      const fixture = window.__notificationMentionFixture;
      const pending = fixture.pending[pendingIndex];
      fixture.registration.rules = fixture.registration.rules.map((rule) => {
        const patch = pending.body.patch.rules[rule.id];
        if (!patch) return rule;
        return { ...rule, enabled: patch.enabled ?? rule.enabled, revision: String(BigInt(rule.revision) + 1n), template: { ...rule.template, title_template: patch.title_template ?? rule.template.title_template, body_template: patch.body_template ?? rule.template.body_template } };
      });
      fixture.mentions = fixture.mentions.map((setting) => pending.body.mention_patch[setting.rule_id] === undefined ? setting : { ...setting, mention_enabled: pending.body.mention_patch[setting.rule_id], revision: String(BigInt(setting.revision) + 1n) });
      pending.resolve(new Response(JSON.stringify({ ...fixture.registration, mention_settings: fixture.mentions }), { status: 200 }));
    }, index)
    await resolveSave(1)
    await page.waitForFunction(() => document.querySelector('[aria-label="알림 설정 저장"]')?.textContent.includes("저장됨"))
    assert.equal(await page.getByRole("button", { name: "변경사항 저장", exact: true }).isDisabled(), true)
    await page.getByRole("button", { name: /관리팀 진행 공유.*상세 설정/ }).click()
    assert.equal(await mentionSwitch().isChecked(), true)
    await mentionSwitch().click()
    await closeGroup()
    await save()
    await page.waitForFunction(() => window.__notificationMentionFixture.patches.length === 3)
    assert.deepEqual(await page.evaluate(() => window.__notificationMentionFixture.patches[2].patch.rules), {}, "mention-only intent still reaches atomic save")
    await page.evaluate(() => {
      const fixture = window.__notificationMentionFixture;
      fixture.mentions[0] = { ...fixture.mentions[0], revision: String(BigInt(fixture.mentions[0].revision) + 1n) };
      fixture.pending[2].resolve(new Response(JSON.stringify({ code: "notification_mention_setting_revision_conflict", current_snapshot: fixture.registration, current_mention_settings: fixture.mentions }), { status: 409 }));
    })
    await page.getByRole("button", { name: "내 멘션 변경 유지", exact: true }).click()
    await save()
    await page.waitForFunction(() => window.__notificationMentionFixture.patches.length === 4)
    assert.equal(await page.evaluate((id) => window.__notificationMentionFixture.patches[3].expected_mention_revisions[id], RULE_ID), String(BigInt(REVISION) + 2n))
    await resolveSave(3)
    await page.waitForFunction(() => document.querySelector('[aria-label="알림 설정 저장"]')?.textContent.includes("저장됨"))
    await page.evaluate(() => {
      window.__notificationMentionFixture.delayNextList = true;
      window.__notificationMentionSetWorkflow("transfer");
    })
    await page.waitForFunction(() => window.__notificationMentionFixture.pendingLists.length === 1)
    await page.evaluate(() => window.__notificationMentionSetWorkflow("registration"))
    await page.getByRole("button", { name: /관리팀 진행 공유.*상세 설정/ }).waitFor()
    await page.evaluate(() => {
      const pending = window.__notificationMentionFixture.pendingLists[0];
      pending.resolve(new Response(JSON.stringify({ settings: pending.settings }), { status: 200 }));
    })
    await page.getByRole("button", { name: /관리팀 진행 공유.*상세 설정/ }).click()
    assert.equal(await mentionSwitch().isChecked(), false, "stale list response cannot replace the active workflow")
    assert.equal(await page.evaluate(() => window.__notificationMentionFixture.standaloneMentionPatches), 0)
    assert.deepEqual(browserErrors, [])
  } finally {
    await browser?.close()
    server?.kill("SIGTERM")
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})
