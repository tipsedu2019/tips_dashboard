/** Local UI fixtures only; browser requests to Supabase and admin APIs are intercepted. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(resolve(dirname(process.execPath), "../node_modules/playwright"))); }
const root = new URL("../", import.meta.url), output = new URL("artifacts/recruiting-20260911/", root);
const base = process.env.RECRUITING_QA_BASE_URL || "http://127.0.0.1:3190";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "QA only permits local origins");
const env = await readFile(new URL(".env.local", root), "utf8");
const url = env.match(/^(?:NEXT_PUBLIC_SUPABASE_URL|VITE_SUPABASE_URL)\s*=\s*["']?([^\s"']+)/m)?.[1];
assert.ok(url, "existing public Supabase URL needed for browser interception");
const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
const checks = [], errors = [];
const add = (name, condition) => { assert.ok(condition, name); checks.push(name); };
const now = Date.now();
const applications = Array.from({ length: 23 }, (_, n) => { const retentionDays = n % 2 === 0 ? 730 : 365; return { id: randomUUID(), name: `모의 지원자 ${n + 1}`, phone: "01000000000", subject: ["영어", "수학", "과학"][n % 3], createdAt: new Date(now - n * 86400000).toISOString(), expiresAt: new Date(now + (retentionDays - n) * 86400000).toISOString(), experience: ("모의 수업 경력입니다.\n".repeat(50)), motivation: "<img src=x onerror=alert(1)>\n" + "학생에게 정확하고 명료하게 설명하고 싶습니다.\n".repeat(60), portfolioUrl: "https://example.org/portfolio", consentVersion: retentionDays === 730 ? "talent-pool-v2" : "talent-pool-v1", consentedAt: new Date(now).toISOString(), retentionDays }; });
const browser = await chromium.launch({ headless: true });
await mkdir(output, { recursive: true });
async function setup(role, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  await context.routeWebSocket(/.*/, (socket) => socket.close());
  const user = { id: randomUUID(), email: "fixture@example.invalid", user_metadata: { name: "모의 관리자" }, app_metadata: {}, aud: "authenticated", created_at: new Date(now).toISOString() };
  if (role) {
    const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(now / 1000) + 3600, role: "authenticated" })).toString("base64url")}.fixture`;
    await context.addInitScript(({ key, user, token }) => localStorage.setItem(key, JSON.stringify({ access_token: token, refresh_token: "fixture-only", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user })), { key: storageKey, user, token });
  }
  const state = { items: [...applications], listFailure: false, detailFailure: false, deleteFailure: false, stale: false, delay: 0, deletes: 0, listRequests: 0, mockRequests: 0 };
  await context.route("**/*", async (route) => {
    const target = new URL(route.request().url());
    if (target.origin === new URL(url).origin) {
      state.mockRequests++;
      const data = target.pathname.endsWith("/profiles") ? { id: user.id, name: "모의 관리자", role, email: user.email } : target.pathname.endsWith("/user") ? user : [];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    }
    if (target.origin !== new URL(base).origin) return route.abort();
    if (target.pathname.startsWith("/api/")) {
      state.mockRequests++;
      if (!target.pathname.startsWith("/api/admin/recruiting/applications")) return route.fulfill({ status: 200, json: {} });
      if (role !== "admin") return route.fulfill({ status: 403, json: { ok: false, code: "forbidden" } });
      const id = target.pathname.split("/")[5];
      if (!id) {
        state.listRequests++;
        if (state.delay) await new Promise((done) => setTimeout(done, state.delay));
        if (state.listFailure) return route.fulfill({ status: 503, json: { ok: false, code: "recruiting_unavailable" } });
        const page = Number(target.searchParams.get("page") || 1), size = Number(target.searchParams.get("pageSize") || 10);
        return route.fulfill({ status: 200, json: { ok: true, applications: state.items.slice((page - 1) * size, page * size), totalCount: state.items.length, retentionLastSucceededAt: new Date(now - (state.stale ? 4 * 3600000 : 1000)).toISOString(), page, pageSize: size } });
      }
      if (route.request().method() === "DELETE") {
        state.deletes++;
        assert.deepEqual(route.request().postDataJSON(), { confirm: true });
        if (state.deleteFailure) return route.fulfill({ status: 503, json: { ok: false, code: "recruiting_unavailable" } });
        state.items = state.items.filter((item) => item.id !== id);
        return route.fulfill({ status: 200, json: { ok: true } });
      }
      if (state.detailFailure) return route.fulfill({ status: 404, json: { ok: false, code: "not_found" } });
      return route.fulfill({ status: 200, json: { ok: true, application: state.items.find((item) => item.id === id) } });
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page, state };
}
try {
  const anonymous = await setup(null);
  await anonymous.page.goto(`${base}/admin/recruiting`); await anonymous.page.waitForURL("**/sign-in?**");
  add("anonymous admin navigation redirects to sign-in", anonymous.page.url().includes("next=%2Fadmin%2Frecruiting")); await anonymous.context.close();
  const staff = await setup("staff");
  await staff.page.goto(`${base}/admin/recruiting`);
  await staff.page.getByText("관리자만 지원서를 열람할 수 있습니다.").waitFor();
  add("staff sees role restriction and sends no application read", staff.state.listRequests === 0);
  add("staff sidebar hides recruiting entry", await staff.page.locator('a[href="/admin/recruiting"]').count() === 0); await staff.context.close();

  const { context, page, state } = await setup("admin");
  state.delay = 600;
  await page.goto(`${base}/admin/recruiting`);
  await page.getByText("지원서를 불러오고 있습니다.").waitFor();
  add("loading pager blocks navigation", await page.getByRole("button", { name: "다음 페이지", exact: true }).isDisabled());
  await page.getByRole("list", { name: "보관 중인 지원서" }).waitFor(); state.delay = 0;
  const rows = () => page.getByRole("list", { name: "보관 중인 지원서" }).getByRole("button");
  add("admin sidebar discovers recruiting route", await page.locator('a[href="/admin/recruiting"]').count() > 0);
  add("default list has 10 entries", await rows().count() === 10);
  await page.getByTestId("admin-quick-search-trigger").click();
  await page.getByTestId("admin-quick-search-input").fill("채용");
  await page.getByRole("option", { name: "빠른 이동: 채용 지원서" }).waitFor();
  add("admin quick search includes recruiting after upstream integration", true);
  await page.keyboard.press("Escape");
  await page.getByTestId("admin-quick-search-dialog").waitFor({ state: "hidden" });
  await page.screenshot({ path: new URL("admin-desktop.png", output).pathname, fullPage: true });
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await page.getByRole("button", { name: /모의 지원자 11 수학/ }).waitFor();
  add("next page renders next entries", await page.getByRole("button", { name: "2 페이지", exact: true }).getAttribute("aria-current") === "page");
  await page.getByRole("combobox", { name: "페이지당 행 수" }).click(); await page.getByRole("option", { name: "15개씩 보기" }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="보관 중인 지원서"]')?.children.length === 15);
  add("page size resets to first page", await page.getByRole("button", { name: "1 페이지", exact: true }).getAttribute("aria-current") === "page");
  await rows().first().focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog"); await dialog.getByRole("heading", { name: "경력", exact: true }).waitFor();
  add("new v2 detail displays its saved 730-day consent", (await dialog.innerText()).includes("730일 (talent-pool-v2)"));
  add("detail safely displays submitted markup as text", await dialog.locator("img").count() === 0 && (await dialog.innerText()).includes("<img src=x onerror=alert(1)>"));
  await dialog.getByRole("link", { name: "포트폴리오 열기 (새 창)" }).scrollIntoViewIfNeeded();
  add("portfolio uses protected external link", (await dialog.getByRole("link").getAttribute("rel")).includes("noreferrer"));
  await dialog.getByRole("heading", { name: "경력", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: new URL("admin-detail.png", output).pathname });
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  add("Escape restores keyboard focus to selected entry", await rows().first().evaluate((node) => document.activeElement === node));
  await rows().first().click(); await dialog.getByRole("button", { name: "삭제 요청 처리" }).click();
  add("delete needs a separate confirmation", state.deletes === 0);
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  add("cancel preserves application", state.items.length === 23 && state.deletes === 0);
  await dialog.getByRole("button", { name: "삭제 요청 처리" }).click(); state.deleteFailure = true;
  await dialog.getByRole("button", { name: "지원서 영구 삭제", exact: true }).click();
  await dialog.getByText("삭제를 확인하지 못했습니다. 다시 시도해 주세요.").waitFor();
  add("failed deletion stays open with original data", state.items.length === 23);
  state.deleteFailure = false; await dialog.getByRole("button", { name: "지원서 영구 삭제", exact: true }).click();
  await page.getByText("지원서가 삭제되었습니다.").waitFor();
  add("successful fixture deletion updates list", state.items.length === 22);
  await rows().first().click(); await dialog.getByRole("heading", { name: "경력", exact: true }).waitFor();
  add("legacy v1 detail retains its saved 365-day consent", (await dialog.innerText()).includes("365일 (talent-pool-v1)"));
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  state.detailFailure = true; await rows().first().click(); await dialog.getByText("지원서가 삭제되었거나 보관기간이 만료되었습니다.").waitFor();
  add("expired/deleted detail shows honest state", await dialog.getByRole("button", { name: "삭제 요청 처리" }).count() === 0);
  await dialog.getByRole("button", { name: "닫기", exact: true }).click(); state.detailFailure = false;
  state.listFailure = true; await page.getByRole("button", { name: "새로고침", exact: true }).click(); await page.getByRole("button", { name: "다시 시도", exact: true }).waitFor();
  add("list failure clears old private results", await page.getByRole("list", { name: "보관 중인 지원서" }).count() === 0);
  state.listFailure = false; state.stale = true; await page.getByRole("button", { name: "다시 시도", exact: true }).click(); await page.getByText(/자동 파기 작업을 확인해야 합니다/).waitFor();
  add("stale retention health visibly blocks intake", true);
  state.stale = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: new URL("admin-mobile.png", output).pathname, fullPage: true });
  add("390px list has no page overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await rows().first().click(); await dialog.getByRole("heading", { name: "경력", exact: true }).waitFor();
  await dialog.evaluate((node) => { node.scrollTop = 0; });
  await dialog.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))));
  const titleBox = await dialog.getByRole("heading", { level: 2 }).first().boundingBox();
  const closeBox = await dialog.locator('[data-slot="dialog-close"]').boundingBox();
  const titleTextBox = await dialog.getByRole("heading", { level: 2 }).first().evaluate((node) => { const range = document.createRange(); range.selectNodeContents(node); const b = range.getBoundingClientRect(); return { x: b.x, width: b.width }; });
  await writeFile(new URL("admin-mobile-close-geometry.json", output), JSON.stringify({titleBox, titleTextBox, closeBox}, null, 2));
  add("390px shared dialog close target is 44px and clears title", closeBox.width >= 43.9 && closeBox.height >= 43.9 && titleTextBox.x + titleTextBox.width <= closeBox.x);
  await page.screenshot({ path: new URL("admin-mobile-detail-top.png", output).pathname });
  const controls = dialog.locator('button:not([disabled]), a[href]');
  await controls.last().focus(); await page.keyboard.press("Tab");
  add("390px shared dialog Tab wraps to first control", await controls.first().evaluate((node) => document.activeElement === node));
  await page.keyboard.press("Shift+Tab");
  add("390px shared dialog ShiftTab wraps to last control", await controls.last().evaluate((node) => document.activeElement === node));
  await dialog.getByRole("button", { name: "삭제 요청 처리" }).scrollIntoViewIfNeeded();
  add("390px long detail reaches actions without horizontal overflow", await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
  await page.screenshot({ path: new URL("admin-mobile-detail.png", output).pathname });
  await page.keyboard.press("Escape");
  state.items = []; await page.getByRole("button", { name: "새로고침", exact: true }).click(); await page.getByText("보관 중인 지원서가 없습니다.").waitFor();
  add("empty state disables next page", await page.getByRole("button", { name: "다음 페이지", exact: true }).isDisabled());
  add("no browser runtime exceptions", errors.length === 0);
  await context.close();
  await writeFile(new URL("browser-results.json", output), JSON.stringify({ ok: true, checks, errors, evidence: "isolated browser auth/API fixtures; no real applicants or remote mutations" }, null, 2));
  console.log(JSON.stringify({ ok: true, checks: checks.length, errors }, null, 2));
} finally { await browser.close(); }
