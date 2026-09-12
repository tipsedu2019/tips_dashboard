/** Local UI fixtures only; browser requests to Supabase and admin APIs are intercepted. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(resolve(dirname(process.execPath), "../node_modules/playwright"))); }
const root = new URL("../", import.meta.url), output = new URL("artifacts/public-content-v21/", root);
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
 const anon=await setup(null);await anon.page.goto(`${base}/admin/public-content`);await anon.page.waitForURL('**/sign-in?**');add('anonymous homepage management returns to requested login path',anon.page.url().includes('next=%2Fadmin%2Fpublic-content'));await anon.context.close();
 for(const role of ['staff','admin']) {
  const item=await setup(role);let contentReads=0;
  await item.context.route('**/api/admin/public-content**',async route=>{contentReads++;return route.fulfill({status:role==='admin'?200:403,json:role==='admin'?{ok:true,entries:[],totalCount:0}:{ok:false,code:'forbidden'}})});
  await item.page.goto(`${base}/admin/public-content`);
  if(role==='staff'){await item.page.getByText('관리자만 홈페이지 내용을 변경할 수 있습니다.').waitFor();add('staff has no content menu or data reads',contentReads===0&&await item.page.locator('a[href="/admin/public-content"]').count()===0);}
  else {
   await item.page.getByRole('button',{name:'선생님 추가',exact:true}).waitFor();add('admin content route and navigation are present',await item.page.locator('a[href="/admin/public-content"]').count()>0&&contentReads===1);
   await item.page.getByTestId('admin-quick-search-trigger').click();await item.page.getByTestId('admin-quick-search-input').fill('홈페이지');await item.page.getByRole('option',{name:'빠른 이동: 홈페이지 관리'}).waitFor();add('homepage management is in quick search',true);await item.page.keyboard.press('Escape');
   await item.page.screenshot({path:new URL('admin-shell-desktop.png',output).pathname,fullPage:true});await item.page.setViewportSize({width:390,height:844});await item.page.screenshot({path:new URL('admin-shell-mobile.png',output).pathname,fullPage:true});add('admin shell fits 390px',await item.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await item.context.close();
 }
 add('actual Next build has no runtime exceptions',errors.length===0);await writeFile(new URL('browser-auth-results.json',output),JSON.stringify({checks,errors,remoteWrites:0,realAuth:false},null,2));console.log(checks.length,'production-build admin auth fixture checks passed');
}finally{await browser.close();}
