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

test("removing the mounted toggle row would hide the label, helper, or independent checked state", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "tips-notification-mention-"))
  let server
  let browser
  let output = ""
  try {
    await symlink(join(root, "node_modules"), join(fixtureRoot, "node_modules"))
    await mkdir(join(fixtureRoot, "app"))
    await writeFile(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}\n')
    await writeFile(join(fixtureRoot, "next.config.mjs"), `
export default {
  experimental: { externalDir: true },
  webpack(config) {
    config.resolve.alias["@"] = ${JSON.stringify(join(root, "src"))};
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
import { useState } from "react";
import { NotificationMentionToggle } from ${JSON.stringify(join(root, "src/features/notifications/notification-mention-settings.tsx"))};
const initial = {
  ruleId: ${JSON.stringify(RULE_ID)}, workflowKey: "registration", eventKey: "registration.appointment_created",
  channelKey: "google_chat" as const, mentionEnabled: false, revision: ${JSON.stringify(REVISION)},
  updatedAt: "2026-08-11T00:00:00.000Z", editable: true,
};
export default function Page() {
  const [setting, setSetting] = useState(initial);
  const [visible, setVisible] = useState(true);
  return <main>
    <button type="button" onClick={() => setVisible(false)}>행 숨기기</button>
    <NotificationMentionToggle
      setting={visible ? setting : undefined}
      saving={false}
      surfaceKey="desktop"
      error={null}
      onChange={(_setting, mentionEnabled) => setSetting({ ...setting, mentionEnabled })}
    />
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
    await page.goto(fixtureUrl)
    await page.getByText("확인된 Google Chat 계정만 멘션합니다.", { exact: true }).waitFor()
    const toggle = page.getByRole("switch", { name: "담당자 멘션" })
    assert.equal(await toggle.isChecked(), false)
    await toggle.click()
    assert.equal(await toggle.isChecked(), true)
    await page.getByRole("button", { name: "행 숨기기" }).click()
    assert.equal(await page.getByRole("switch", { name: "담당자 멘션" }).count(), 0)
  } finally {
    await browser?.close()
    server?.kill("SIGTERM")
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})
