import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test, { after, before } from "node:test";
import { chromium } from "/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const root = resolve(new URL("../", import.meta.url).pathname);
const runtimeNode = "/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 4315;
const baseUrl = `http://127.0.0.1:${port}`;
const profileOne = "99460000-0000-4000-8000-000000000101";
const profileTwo = "99460000-0000-4000-8000-000000000102";

function identity({
  profileId,
  profileName,
  accountEmail,
  chatUserId = null,
  verificationStatus = "not_found",
  lastSyncStatus = "not_found",
  lastSyncAt = "2026-08-11T00:00:00.000Z",
  identityRevision = "1",
}) {
  return {
    profileId,
    profileName,
    accountEmail,
    dashboardRole: "teacher",
    chatUserId,
    resourceName: chatUserId ? `users/${chatUserId}` : null,
    source: chatUserId ? "directory" : null,
    verificationStatus,
    verifiedAt: verificationStatus === "verified" ? "2026-08-11T00:00:00.000Z" : null,
    lastSyncStatus,
    lastSyncAt,
    identityRevision,
    eligible: verificationStatus === "verified",
  };
}

const defaultSnapshot = {
  identities: [
    identity({ profileId: profileOne, profileName: "김선생", accountEmail: "kim@example.com" }),
    identity({ profileId: profileTwo, profileName: "이선생", accountEmail: "lee@example.com" }),
  ],
  directory: { status: "ready", configured: true },
  editable: true,
};

let fixtureRoot = "";
let server;
let browser;
let serverOutput = "";

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The dev server has not started listening yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`teacher_google_chat_test_server_timeout:${serverOutput}`);
}

async function writeFixtureApp() {
  fixtureRoot = await mkdtemp(join(tmpdir(), "tips-google-chat-panel-"));
  await symlink(join(root, "node_modules"), join(fixtureRoot, "node_modules"));
  await mkdir(join(fixtureRoot, "app"));
  await writeFile(join(fixtureRoot, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(fixtureRoot, "next.config.mjs"), `
import path from "node:path";
export default {
  experimental: { externalDir: true },
  webpack(config) {
    config.resolve.alias["@"] = ${JSON.stringify(join(root, "src"))};
    config.resolve.alias["@/providers/auth-provider"] = path.join(process.cwd(), "auth-mock.ts");
    return config;
  },
};
`);
  await writeFile(join(fixtureRoot, "auth-mock.ts"), `
export function useAuth() {
  return { session: { access_token: "test-access-token" } };
}
`);
  await writeFile(join(fixtureRoot, "app", "layout.tsx"), `
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}
`);
  await writeFile(join(fixtureRoot, "app", "page.tsx"), `
"use client";
import { useEffect, useState } from "react";
import { TeacherGoogleChatIdentityPanel } from ${JSON.stringify(join(root, "src/features/management/teacher-google-chat-identity-panel.tsx"))};
export default function Page() {
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    window.__identityPanelFixture = window.__identityPanelFixture || {};
    window.__identityPanelFixture.hide = () => setMounted(false);
  }, []);
  return mounted ? <TeacherGoogleChatIdentityPanel getAccessToken={async () => "test-access-token"} /> : <p>패널 숨김</p>;
}
`);
  await writeFile(join(fixtureRoot, "app", "globals.d.ts"), `
interface Window { __identityPanelFixture?: Record<string, unknown>; }
`);
}

async function openPanel(page, snapshot = defaultSnapshot, plans = [], options = {}) {
  await page.addInitScript(({ initialSnapshot, initialPlans, initialOptions }) => {
    const fixture = {
      snapshot: initialSnapshot,
      plans: initialPlans,
      requests: [],
      hide: null,
      delayed: null,
      resolveList: null,
      listSignalAborted: false,
    };
    window.__identityPanelFixture = fixture;
    window.fetch = async (_url, init = {}) => {
      const method = init.method || "GET";
      if (method === "GET") {
        if (!initialOptions.delayList) return new Response(JSON.stringify(fixture.snapshot), { status: 200 });
        return new Promise((resolveResponse) => {
          init.signal.addEventListener("abort", () => { fixture.listSignalAborted = true; }, { once: true });
          fixture.resolveList = () => resolveResponse(new Response(JSON.stringify(fixture.snapshot), { status: 200 }));
        });
      }
      const body = JSON.parse(init.body);
      fixture.requests.push({ url: String(_url), ...body });
      const plan = fixture.plans.shift() || { kind: "resolve", identity: fixture.snapshot.identities[0] };
      if (plan.kind === "reject") throw new Error(plan.error);
      if (plan.kind === "http") {
        return new Response(JSON.stringify(plan.body), { status: plan.status });
      }
      if (plan.kind === "delay") {
        return new Promise((resolveResponse) => {
          fixture.delayed = () => resolveResponse(new Response(JSON.stringify(plan.identity), { status: 200 }));
        });
      }
      return new Response(JSON.stringify(plan.identity), { status: 200 });
    };
  }, { initialSnapshot: snapshot, initialPlans: plans, initialOptions: options });
  await page.goto(baseUrl);
  await page.getByTestId("teacher-google-chat-identity-desktop-list").waitFor();
  if (!options.delayList) await page.getByText("김선생", { exact: true }).first().waitFor();
}

before(async () => {
  await writeFixtureApp();
  server = spawn(runtimeNode, [join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "-p", String(port)], {
    cwd: fixtureRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { serverOutput += chunk; });
  server.stderr.on("data", (chunk) => { serverOutput += chunk; });
  await waitForServer();
  browser = await chromium.launch({ executablePath: chrome, headless: true });
});

after(async () => {
  await browser?.close();
  server?.kill("SIGTERM");
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

test("removing the fallback gate would expose manual verification before a lookup failure", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await openPanel(page);
    assert.equal(await page.getByLabel("김선생 Google Chat ID").count(), 0);
    assert.equal(await page.getByRole("button", { name: "김선생 확인" }).count(), 0);
  } finally {
    await page.close();
  }
});

test("dropping a unique profile row or its responsive fields would hide a configured identity", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await openPanel(page);
    const desktop = page.getByTestId("teacher-google-chat-identity-desktop-list");
    assert.equal(await desktop.getByRole("row").count(), 3);
    await assertVisibleTexts(desktop, ["김선생", "kim@example.com", "미설정", "이선생", "lee@example.com"]);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = page.getByTestId("teacher-google-chat-identity-mobile-list");
    await assertVisibleTexts(mobile, ["김선생", "kim@example.com", "Chat ID", "상태", "마지막 동기화"]);
    assert.equal(await mobile.getByTestId("teacher-google-chat-identity-mobile-card").count(), 2);
    assert.equal(await page.getByText(profileOne, { exact: true }).count(), 0);
  } finally {
    await page.close();
  }
});

test("removing editable or Directory checks would enable identity actions in a closed configuration", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await openPanel(page, {
      ...defaultSnapshot,
      directory: { status: "not_configured", configured: false },
      editable: false,
    });
    const desktop = page.getByTestId("teacher-google-chat-identity-desktop-list");
    await page.getByText("Google Workspace Directory 설정이 필요합니다.", { exact: true }).waitFor();
    assert.equal(await desktop.getByRole("button", { name: "김선생 자동 조회" }).isDisabled(), true);
    assert.equal(await desktop.getByLabel("김선생 Google Chat ID").count(), 0);
    assert.equal(await desktop.getByRole("button", { name: "김선생 확인" }).count(), 0);
  } finally {
    await page.close();
  }
});

test("handling an automatic lookup failure unsafely would leak details or skip the manual fallback", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await openPanel(page, defaultSnapshot, [{ kind: "reject", error: "aliases=private@example.com directory-ready=secret" }]);
    const desktop = page.getByTestId("teacher-google-chat-identity-desktop-list");
    await desktop.getByRole("button", { name: "김선생 자동 조회" }).click();
    await desktop.getByText("Google Chat 계정 정보를 저장하지 못했습니다.", { exact: true }).waitFor();
    await desktop.getByLabel("김선생 Google Chat ID").waitFor();
    await desktop.getByRole("button", { name: "김선생 확인" }).waitFor();
    await desktop.getByText("조회 실패", { exact: true }).waitFor();
    assert.equal(await page.getByText("private@example.com", { exact: true }).count(), 0);
    assert.equal(await page.getByText("directory-ready=secret", { exact: true }).count(), 0);
  } finally {
    await page.close();
  }
});

test("sharing pending or failure state across profiles would block the other identity action", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const resolvedKim = identity({
    profileId: profileOne,
    profileName: "김선생",
    accountEmail: "kim@example.com",
    chatUserId: "123456789",
    verificationStatus: "verified",
    lastSyncStatus: "ok",
    identityRevision: "2",
  });
  try {
    await openPanel(page, defaultSnapshot, [
      { kind: "delay", identity: resolvedKim },
      { kind: "reject", error: "private-directory-reason" },
    ]);
    const desktop = page.getByTestId("teacher-google-chat-identity-desktop-list");
    const kimAuto = desktop.getByRole("button", { name: "김선생 자동 조회" });
    const leeAuto = desktop.getByRole("button", { name: "이선생 자동 조회" });
    await kimAuto.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="김선생 자동 조회"]:disabled'));
    assert.equal(await leeAuto.isDisabled(), false);
    await leeAuto.click();
    await desktop.getByLabel("이선생 Google Chat ID").waitFor();
    assert.equal(await kimAuto.isDisabled(), true);
    await page.evaluate(() => window.__identityPanelFixture.delayed());
    await desktop.getByText("123456789", { exact: true }).waitFor();
    assert.equal(await desktop.getByLabel("이선생 Google Chat ID").count(), 1);
  } finally {
    await page.close();
  }
});

test("sending a stale revision, reusing a request ID, or replacing every row would corrupt identity updates", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const resolvedKim = identity({
    profileId: profileOne,
    profileName: "김선생",
    accountEmail: "kim@example.com",
    chatUserId: "123456789",
    verificationStatus: "verified",
    lastSyncStatus: "ok",
    identityRevision: "2",
  });
  try {
    await openPanel(page, defaultSnapshot, [
      { kind: "resolve", identity: resolvedKim },
      { kind: "reject", error: "lookup failed" },
      { kind: "http", status: 409, body: { code: "google_chat_profile_identity_revision_conflict" } },
    ]);
    const desktop = page.getByTestId("teacher-google-chat-identity-desktop-list");
    const kimAuto = desktop.getByRole("button", { name: "김선생 자동 조회" });
    await kimAuto.click();
    await desktop.getByText("123456789", { exact: true }).waitFor();
    assert.equal(await desktop.getByLabel("김선생 Google Chat ID").count(), 0);
    assert.equal(await desktop.getByRole("button", { name: "김선생 확인" }).count(), 0);
    await desktop.getByText("이선생", { exact: true }).waitFor();
    await kimAuto.click();
    await desktop.getByLabel("김선생 Google Chat ID").waitFor();
    await desktop.getByLabel("김선생 Google Chat ID").fill("987654321");
    await desktop.getByRole("button", { name: "김선생 확인" }).click();
    await desktop.getByText("다른 관리자가 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.", { exact: true }).waitFor();
    const requests = await page.evaluate(() => window.__identityPanelFixture.requests);
    assert.deepEqual(requests.map((request) => request.expected_identity_revision), ["1", "2", "2"]);
    assert.deepEqual(requests.map((request) => request.profile_id), [profileOne, profileOne, profileOne]);
    assert.deepEqual(requests.map((request) => request.url), [
      "/api/admin/google-chat-identities",
      "/api/admin/google-chat-identities",
      "/api/admin/google-chat-identities",
    ]);
    assert.equal(requests[2].chat_user_id, "987654321");
    assert.equal(new Set(requests.map((request) => request.request_id)).size, 3);
  } finally {
    await page.close();
  }
});

test("publishing an aborted list completion would restore stale identities after unmount", { timeout: 5_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await openPanel(page, defaultSnapshot, [], { delayList: true });
    await page.getByTestId("teacher-google-chat-identity-mobile-list").waitFor({ state: "attached" });
    await page.waitForFunction(() => typeof window.__identityPanelFixture.hide === "function");
    await page.evaluate(() => window.__identityPanelFixture.hide());
    await page.getByText("패널 숨김", { exact: true }).waitFor();
    await page.evaluate(() => window.__identityPanelFixture.resolveList());
    await page.waitForFunction(() => window.__identityPanelFixture.listSignalAborted === true);
    assert.equal(await page.getByText("김선생", { exact: true }).count(), 0);
  } finally {
    await page.close();
  }
});

async function assertVisibleTexts(locator, values) {
  for (const value of values) {
    await locator.getByText(value, { exact: true }).first().waitFor({ state: "visible" });
  }
}
