import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { FIXED_NOW, fixtureDefinitions, resolveFixtureRequest } from '../../tests/fixtures/premium-dashboard.mjs';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url);
const { chromium } = require('playwright');
const base = process.env.PREMIUM_BASE_URL || 'http://127.0.0.1:3215';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Only loopback app servers are allowed');
const out = process.env.PREMIUM_OUT || '/tmp/tips-premium-dashboard-20260915/before';
const ids = (process.env.PREMIUM_FIXTURES || 'A').split(',');
const routes = (process.env.PREMIUM_ROUTES || 'dashboard,students,registration,textbooks,class-schedule,statistics').split(',');
await mkdir(out, { recursive: true });
const manifest = { sourceSha: process.env.PREMIUM_SOURCE_SHA || null, captureCheckoutSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), buildId: (await readFile('.next/BUILD_ID', 'utf8')).trim(), base, fixedNow: FIXED_NOW, data: 'synthetic only', network: 'Every API/Supabase request fulfilled or aborted; other external requests aborted; WebSockets closed', captures: [] };
const browser = await chromium.launch({ headless: true });
manifest.browser = browser.version();
try {
for (const id of ids) for (const width of [1440, 390]) for (const name of routes) {
  assert.ok(fixtureDefinitions[id], `Unknown fixture ${id}`);
  const viewport = { width, height: width === 1440 ? 900 : 844 };
  const entry = { route: `/admin/${name}`, fixture: id, role: id === 'G' ? 'anonymous' : 'admin', viewport, requests: [], unhandled: [], pageErrors: [], consoleErrors: [], blockedExternal: [] };
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
  await context.routeWebSocket(/.*/, socket => socket.close());
  const user = { id: '00000000-0000-4000-8000-000000000099', email: 'fixture@example.invalid', user_metadata: { name: '합성 관리자' }, app_metadata: {}, aud: 'authenticated', created_at: FIXED_NOW };
  const token = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: user.id, exp: 2000000000, role: 'authenticated' })).toString('base64url') + '.fixture';
  await context.addInitScript(({ user, token, id }) => {
    localStorage.setItem('theme', 'light');
    if (id !== 'G') localStorage.setItem('sb-tips-internal-fixture-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture-only', token_type: 'bearer', expires_in: 3600, expires_at: 2000000000, user }));
  }, { user, token, id });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    const fixtureHost = url.hostname === 'tips-internal-fixture.supabase.co';
    if (!fixtureHost && url.origin !== base) { entry.blockedExternal.push(url.origin + url.pathname); return route.abort(); }
    if (fixtureHost || url.pathname.startsWith('/api/')) {
      let args = {}; try { args = req.postDataJSON() || {}; } catch {}
      entry.requests.push({ method: req.method(), path: url.pathname, args });
      if (url.pathname.endsWith('/profiles')) return route.fulfill({ json: { id: user.id, role: 'admin', name: '합성 관리자', email: user.email } });
      if (url.pathname.endsWith('/user')) return route.fulfill({ json: user });
      const data = resolveFixtureRequest(url.pathname, args, id);
      if (data !== undefined) {
        if (id === 'F') await new Promise(resolve => setTimeout(resolve, 2500));
        return route.fulfill({ json: data });
      }
      entry.unhandled.push({ path: url.pathname, args });
      return route.fulfill({ status: 501, json: { code: 'fixture_unhandled', message: 'Synthetic fixture not defined' } });
    }
    assert.ok(['GET', 'HEAD'].includes(req.method()), 'No application write requests may reach server');
    return route.continue();
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  page.on('pageerror', err => entry.pageErrors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') entry.consoleErrors.push(msg.text()); });
  try {
    await page.goto(base + entry.route);
    if (id === 'G') await page.waitForURL('**/sign-in?**');
    else if (name === 'students' && id !== 'C') await page.getByText(id === 'B' ? '합성긴이름학생구분용가나다라마바00' : '합성학생01', { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 12000 });
    else if (name === 'dashboard') { if (id === 'C') await page.getByText(/오늘.*없습니다/).waitFor(); else await page.getByText(id === 'B' ? '합성긴수업명'.repeat(12) : '합성학생01 레벨테스트', { exact: true }).filter({ visible: true }).first().waitFor(); }
    else if (name === 'registration') await page.getByText('문의 단계에 등록 업무가 없습니다.', { exact: true }).waitFor();
    else if (name === 'class-schedule') await page.getByText('선택한 조건에 맞는 수업일정이 없습니다.', { exact: true }).waitFor();
    else if (name === 'statistics') await page.getByRole('region', { name: '통계 결과' }).locator('[aria-label="핵심 운영 지표"]').waitFor();
    else if (name === 'textbooks' && id !== 'C') await page.getByText(id === 'B' ? '합성교재제목'.repeat(16) + '구분가나' : '합성 영어 독해 교재', { exact: true }).filter({ visible: true }).first().waitFor();
    else await page.getByText(/없습니다|0건/).filter({ visible: true }).first().waitFor();
    if (id === 'D' && name === 'students') {
      await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
      await page.getByText('합성학생11', { exact: true }).filter({ visible: true }).first().waitFor();
      const search = page.locator('input[aria-label="학생 검색"]');
      await search.fill('일치하지않는합성검색');
      await page.getByText('0건 · 0–0번째', { exact: true }).waitFor();
      await search.fill('');
      await page.getByText('합성학생01', { exact: true }).filter({ visible: true }).first().waitFor();
      await page.getByText('20건 · 1–10번째', { exact: true }).waitFor();
      entry.studentPagingAndSearch = 'page2 -> zero search -> clear -> page1 restored';
    }
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => [...document.images].filter(image => image.getBoundingClientRect().width > 0).every(image => image.complete && image.naturalWidth > 0));
    entry.performance = await page.evaluate(() => ({ navigation: performance.getEntriesByType('navigation').map(entry => ({ duration: entry.duration, responseEnd: entry.responseEnd, domContentLoadedEventEnd: entry.domContentLoadedEventEnd })), resourceCount: performance.getEntriesByType('resource').length, transferredBytes: performance.getEntriesByType('resource').reduce((sum, entry) => sum + entry.transferSize, 0) }));
    entry.finalUrl = page.url();
    entry.text = (await page.locator('body').innerText()).slice(0, 16000);
    entry.bodyOverflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
    entry.state = entry.unhandled.length ? 'unhandled-contract' : 'rendered';
    assert.equal(entry.bodyOverflow, 0, 'No document horizontal overflow');
    assert.equal(entry.pageErrors.length, 0, 'No runtime errors');
    assert.equal(entry.consoleErrors.length, 0, 'No console errors');
    entry.screenshot = `${id}-${name}-${width}.png`;
    await page.screenshot({ path: `${out}/${entry.screenshot}`, fullPage: false });
  } catch (error) { entry.state = 'failed'; entry.failure = error.message; entry.text = (await page.locator('body').innerText()).slice(0, 16000); await page.screenshot({ path: `${out}/${id}-${name}-${width}-failure.png`, fullPage: false }); }
  manifest.captures.push(entry);
  console.log(`${id} ${name} ${width}: ${entry.state}; unhandled=${entry.unhandled.length}`);
  await context.close();
}
} finally { await browser.close(); await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 2)); }
if (manifest.captures.some(c => c.state === 'failed' || c.pageErrors.length || c.unhandled.length)) process.exitCode = 1;
