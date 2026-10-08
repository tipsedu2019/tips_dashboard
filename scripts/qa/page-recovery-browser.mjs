// Production-build fault injection only. All traffic is restricted to the loopback app.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { FIXED_NOW, resolveFixtureRequest } from '../../tests/fixtures/premium-dashboard.mjs';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url)('playwright');
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3418';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const baseline = process.env.QA_BASELINE === '1';
const out = process.env.QA_OUTPUT || 'output/playwright/page-recovery';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const width of [1440, 390]) {
    for (const target of ['registration', 'layout']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ko-KR', serviceWorkers: 'block' });
      const user = { id: '00000000-0000-4000-8000-000000000099', email: 'fixture@example.invalid', user_metadata: { name: '합성 관리자' }, app_metadata: {}, aud: 'authenticated', created_at: FIXED_NOW };
      const token = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: user.id, exp: 2000000000, role: 'authenticated' })).toString('base64url') + '.fixture';
      await context.addInitScript(({ user, token }) => localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture-only', token_type: 'bearer', expires_in: 3600, expires_at: 2000000000, user })), { user, token });
      await context.routeWebSocket(/.*/, socket => socket.close());
      const page = await context.newPage();
      const report = { width, target, baseline, documentRequests: 0, failures: [], errors: [], blockedExternal: [] };
      results.push(report);
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('request', req => { if (req.isNavigationRequest() && req.frame() === page.mainFrame()) report.documentRequests++; });
      let inject = false;
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin === 'http://127.0.0.1:9' || (url.origin === base && url.pathname.startsWith('/api/'))) {
          let args = {}; try { args = req.postDataJSON() || {}; } catch {}
          const data = url.pathname.endsWith('/profiles') ? { id: user.id, role: 'admin', name: '합성 관리자', email: user.email }
            : url.pathname.endsWith('/user') ? user : resolveFixtureRequest(url.pathname, args, 'C');
          if (data === undefined) { report.blockedExternal.push(url.pathname); return route.abort(); }
          return route.fulfill({ json: data });
        }
        if (url.origin !== base) { report.blockedExternal.push(url.origin + url.pathname); return route.abort(); }
        if (!['GET', 'HEAD'].includes(req.method())) return route.abort();
        const failedChunk = target === 'registration'
          ? /\/_next\/static\/chunks\/app\/admin\/registration\/page-[^/]+\.js$/
          : /\/_next\/static\/chunks\/app\/layout-[^/]+\.js$/;
        if (inject && failedChunk.test(url.pathname)) {
          report.failures.push(url.pathname);
          return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Synthetic missing old deployment chunk', headers: { 'Cache-Control': 'public, max-age=3600' } });
        }
        return route.continue();
      });
      await page.goto(base + '/errors/forbidden');
      inject = true;
      const response = await page.goto(base + '/admin/registration?taskPage=2&taskPageType=registration#detail');
      report.cacheControl = response.headers()['cache-control'];
      if (!baseline) assert.match(report.cacheControl, /no-store/);
      const heading = page.getByRole('heading', { name: '화면을 불러오지 못했습니다' }).first();
      try { if (!baseline) await heading.waitFor({ timeout: 20000 }); else await page.waitForTimeout(1000); }
      catch (error) {
        report.bodyText = await page.locator('body').innerText();
        report.url = page.url();
        await page.screenshot({ path: `${out}/failure-${target}-${width}.png` });
        throw error;
      }
      assert.ok(report.failures.length > 0);
      // Initial script errors may leave the RSC import pending without a console exception.
      if (baseline) assert.match(await page.locator('body').innerText(), /^$|Application error:/);
      await page.screenshot({ path: `${out}/${target}-${width}.png` });
      await page.goBack();
      assert.equal(new URL(page.url()).pathname, '/errors/forbidden');
      await page.goForward();
      if (!baseline) await heading.waitFor({ timeout: 20000 }); else await page.waitForTimeout(1000);
      report.historyRestoredError = true;
      const documentCount = report.documentRequests;
      await page.waitForTimeout(1000);
      assert.equal(report.documentRequests, documentCount, 'no automatic reload loop');
      if (!baseline) assert.equal(await page.getByRole('heading', { name: '화면을 불러오지 못했습니다' }).count(), 1, 'one recovery surface');
      if (!baseline) {
        const link = page.getByRole('link', { name: '새 탭에서 다시 열기' }).first();
        const href = new URL(await link.getAttribute('href'));
        assert.equal(href.pathname, '/admin/registration');
        assert.equal(href.searchParams.get('taskPage'), '2');
        assert.equal(href.searchParams.get('taskPageType'), 'registration');
        assert.equal(href.hash, '#detail');
        assert.ok(href.searchParams.get('_tips_recovery'));
        assert.equal(await link.getAttribute('target'), '_blank');
        const oldUrl = page.url();
        inject = false;
        await link.focus();
        const popupPromise = page.waitForEvent('popup');
        await page.keyboard.press('Enter');
        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');
        assert.equal(page.url(), oldUrl);
        assert.equal(report.documentRequests, documentCount);
        assert.ok(popup.url().includes('_tips_recovery'));
        await popup.getByRole('heading', { name: '등록', exact: true }).waitFor({ timeout: 15000 });
        assert.equal(await popup.locator('#tips-script-recovery, [data-page-recovery]').count(), 0);
        report.recoveredNewTab = true;
        report.registrationVisibleInNewTab = true;
        await popup.close();
      }
      report.bodyText = await page.locator('body').innerText();
      report.horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(report.horizontalOverflow, false);
      await context.close();
    }
  }
} finally {
  await fs.writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(JSON.stringify(results.map(({ width, target, cacheControl, recoveredNewTab }) => ({ width, target, cacheControl, recoveredNewTab })), null, 2));
