// Synthetic parser -> actual history popover. No authentication, server, DB or provider.
// Requires an existing production build for CSS, plus PLAYWRIGHT_PACKAGE and
// ESBUILD_PACKAGE pointing at installed package.json files when not local.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { parseAcademicSubject } from "../../src/lib/academic-subject-registry.ts";
import { REGISTRATION_WORKFLOW_STATUSES } from "../../src/features/tasks/registration-workflow-status.js";

const root = process.cwd();
const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url)("playwright");
const { build } = createRequire(process.env.ESBUILD_PACKAGE || import.meta.url)("esbuild");
const baseRef = process.env.QA_BASE_REF || "dda225e41543ddca2e1f4587ae6098b255c5a92c";
assert.match(baseRef, /^[a-f0-9]{40}$/);
const out = process.env.QA_OUTPUT || "output/playwright/registration-history";
await mkdir(out, { recursive: true });
const origin = "http://127.0.0.1:39997"; // Every request is fulfilled in memory.
const sourcePath = "src/features/tasks/registration-track-service.ts";
const historyPath = "src/features/tasks/registration-track-history.js";
const source = async (file, before) => before
  ? execFileSync("git", ["show", `${baseRef}:${file}`], { encoding: "utf8" })
  : readFile(file, "utf8");

function eventMapper(sourceText) {
  const start = "// registration-track-service-factory:start";
  const end = "// registration-track-service-factory:end";
  assert.ok(sourceText.includes(start) && sourceText.includes(end));
  const body = sourceText.split(start)[1].split(end)[0];
  const code = ts.transpileModule(body + "\nmodule.exports = { mapTrackEvent };", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, parseAcademicSubject, REGISTRATION_WORKFLOW_STATUSES });
  return loaded.exports.mapTrackEvent;
}

function fixture(mapEvent) {
  const created = { version: 1, actorId: "synthetic-creator", occurredAt: "2026-10-09T01:02:03.123456+00:00", campus: "PRIVATE_CAMPUS", studentName: "PRIVATE_STUDENT", subjects: ["영어"] };
  const rows = [
    { id: "created", event_type: "registration_case_created", after_value: JSON.stringify(created) },
    { id: "missing", event_type: "registration_case_created", after_value: { version: 1, actorId: null, occurredAt: null } },
    { id: "broken", event_type: "registration_case_created", after_value: '{"campus":"PRIVATE_BROKEN"' },
    { id: "future", event_type: "registration_case_created", after_value: '{"version":99,"campus":"PRIVATE_FUTURE"}' },
    { id: "empty", event_type: "registration_case_created", after_value: null },
    { id: "prose", event_type: "track_closed", after_value: "[전화상담] 보호자 요청으로 문의 종료" },
    { id: "system", event_type: "registration_track_event", after_value: JSON.stringify({ version: 2, event_type: "director_default_resolved", actor_kind: "system", system_source: "registration_director_defaults", occurred_at: "2026-10-08T00:00:00Z" }) },
    { id: "normal", event_type: "registration_track_event", after_value: JSON.stringify({ version: 2, event_type: "consultation_completed", actor_kind: "user", actor_profile_id: "synthetic-creator", occurred_at: "2026-10-09T02:00:00Z", metadata: { mode: "phone" } }) },
  ];
  return { tracks: [], events: rows.map(row => mapEvent({ ...row, task_id: "synthetic-task", actor_id: "wrong-owner", created_at: "2026-10-09T03:00:00Z" })) };
}

const bundles = new Map();
for (const before of [true, false]) {
  const detail = fixture(eventMapper(await source(sourcePath, before)));
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {RegistrationApplicationHistoryAction} from './src/features/tasks/registration-application-history-action.tsx';
    const detail = ${JSON.stringify(detail)};
    createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-3xl p-4"><form onSubmit={e=>{e.preventDefault();window.submissions++}}>
    <div className="flex items-center justify-between"><h1 className="text-lg font-semibold">등록 신청 · 합성 이력 검증</h1><RegistrationApplicationHistoryAction detail={detail} profiles={[{id:'synthetic-creator',label:'합성 담당자'}]}/></div>
    <button type="button" style={{position:'fixed',bottom:8,left:8}} data-outside>다른 업무</button></form></main>); window.submissions=0;`;
  const bundled = await build({
    stdin: { contents: entry, loader: "tsx", resolveDir: root },
    bundle: true, write: false, platform: "browser", format: "iife",
    jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "baseline-history", setup(plugin) {
      if (before) plugin.onLoad({ filter: /registration-track-history\.js$/ }, async () => ({ contents: await source(historyPath, true), loader: "js", resolveDir: path.dirname(path.resolve(historyPath)) }));
    } }],
  });
  bundles.set(before ? "before" : "after", Buffer.from(bundled.outputFiles[0].contents));
}
const cssNames = (await readdir(".next/static/css")).filter(name => name.endsWith(".css"));
assert.ok(cssNames.length, "run the production build first");
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
const reports = [];
try {
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) for (const phase of ["before", "after"]) {
    const report = { width, theme, phase, errors: [], blocked: [], requests: [] };
    reports.push(report);
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "ko-KR", timezoneId: "Asia/Seoul", colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block" });
    await context.routeWebSocket(/.*/, socket => socket.close());
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      report.requests.push(url.pathname);
      if (url.origin !== origin || request.method() !== "GET") { report.blocked.push(request.url()); return route.abort(); }
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<html lang="ko" class="${theme}"><head>${cssNames.map(name => `<link rel="stylesheet" href="/_next/static/css/${name}">`).join("")}</head><body class="bg-background text-foreground"><div id="root"></div><script src="/fixture.js"></script></body></html>` });
      if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: bundles.get(phase) });
      if (/^\/_next\/static\/(css|media)\/[\w.-]+$/.test(url.pathname)) return route.fulfill({ body: await readFile(".next/" + url.pathname.slice("/_next/".length)), contentType: url.pathname.endsWith(".css") ? "text/css" : "font/woff2" });
      report.blocked.push(request.url()); return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      const trigger = page.getByRole("button", { name: "업무 처리 이력", exact: true });
      await trigger.click();
      const timeline = page.getByRole("region", { name: "등록 업무 처리 이력", exact: true });
      await timeline.waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(out, `${phase}-${width}-${theme}.png`) });
      const text = await timeline.innerText();
      if (phase === "before") {
        assert.match(text, /PRIVATE_CAMPUS/);
        assert.match(text, /마이그레이션 · 시간 확인 불가/);
      } else {
        const assertOpenBounds = async () => {
          const box = await timeline.boundingBox();
          assert.ok(box && box.x >= 0 && box.x + box.width <= width, "open history stays within viewport");
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        };
        await assertOpenBounds();
        assert.doesNotMatch(text, /PRIVATE_|wrong-owner|actorId|campus|version|\[object Object\]/);
        const created = timeline.locator(":scope > ol > li").filter({ hasText: "2026. 10. 09. 오전 10:02" });
        assert.equal(await created.count(), 1);
        assert.match(await created.innerText(), /등록 문의 생성[\s\S]*합성 담당자/);
        assert.match(text, /알 수 없음 · 시간 확인 불가/);
        assert.match(text, /\[전화상담\] 보호자 요청으로 문의 종료/);
        assert.equal(await timeline.locator(":scope > ol > li").count(), 8);
        for (let cycle = 0; cycle < 3; cycle++) {
          const detailButtons = timeline.getByRole("button", { name: "상세 보기", exact: true });
          while (await detailButtons.count()) await detailButtons.first().click();
          await assertOpenBounds();
          assert.doesNotMatch(await timeline.innerText(), /PRIVATE_|wrong-owner|actorId|campus|version/);
          await page.keyboard.press("Escape");
          await timeline.waitFor({ state: "detached" });
          assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
          await trigger.click();
          assert.equal(await timeline.count(), 1);
        }
        await page.getByRole("button", { name: "다른 업무", exact: true }).click();
        await timeline.waitFor({ state: "detached" });
        assert.equal(await page.evaluate(() => window.submissions), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      assert.deepEqual(report.errors, []);
      assert.deepEqual(report.blocked, []);
      report.passed = true;
    } catch (error) { report.failure = error.stack; throw error; }
    finally { await context.close(); }
    console.log(`${phase} ${width} ${theme}: PASS`);
  }
} finally {
  await browser.close();
  await writeFile(path.join(out, "results.json"), JSON.stringify({ baseRef, syntheticOnly: true, reports }, null, 2));
}
