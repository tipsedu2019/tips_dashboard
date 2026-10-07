// Real management route with read-only synthetic transport. No save control is clicked.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { FIXED_NOW, resolveFixtureRequest } from '../../tests/fixtures/premium-dashboard.mjs';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url)('playwright');
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3277';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const out = process.env.QA_OUTPUT || 'output/playwright/registration-selection';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const reports = [];
for (const width of [1440, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce' });
  const user = { id: '00000000-0000-4000-8000-000000000099', email: 'fixture@example.invalid', user_metadata: { name: '합성 관리자' }, app_metadata: {}, aud: 'authenticated', created_at: FIXED_NOW };
  const token = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: user.id, exp: 2000000000, role: 'authenticated' })).toString('base64url') + '.fixture';
  await context.addInitScript(({ user, token }) => localStorage.setItem('sb-tips-internal-fixture-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture-only', token_type: 'bearer', expires_in: 3600, expires_at: 2000000000, user })), { user, token });
  const report = { width, unhandled: [], errors: [] };
  await context.routeWebSocket(/.*/, socket => socket.close());
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'tips-internal-fixture.supabase.co' || url.pathname.startsWith('/api/')) {
      let args = {}; try { args = req.postDataJSON() || {}; } catch {}
      const rows = ['고1', '고2', '중1', '중2'].map((grade, i) => ({ id: `00000000-0000-4000-8000-00000000020${i}`, kind: 'classes', name: `합성 ${grade}반`, subject: '영어', grade, status: '수강', teacherName: '합성교사', sortKey: String(i), weeklyMinutes: null, fee: 100000, classroom: '합성강의실', schedule: '', capacity: 10, studentCount: 0, updatedAt: FIXED_NOW }));
      const data = url.pathname.endsWith('/list_management_numbered_page_v1') ? { rows, page: 1, pageSize: 10, totalCount: 4 }
        : url.pathname.endsWith('/profiles') ? { id: user.id, role: 'admin', name: '합성 관리자', email: user.email }
        : url.pathname.endsWith('/user') ? user
        : resolveFixtureRequest(url.pathname, args, 'A');
      if (data === undefined) { report.unhandled.push(`${req.method()} ${url.pathname}`); return route.abort(); }
      return route.fulfill({ json: data });
    }
    if (url.origin !== base || !['GET', 'HEAD'].includes(req.method())) { report.unhandled.push(`${req.method()} ${url.pathname}`); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
  try {
    await page.goto(base + '/admin/classes');
    await page.getByText('합성 고1반', { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: '수업 등록', exact: true }).click({ timeout: 30000 });
    const dialog = page.getByRole('dialog');
    report.controls = await dialog.getByRole('combobox').evaluateAll(els => els.map(el => ({ name: el.getAttribute('aria-label'), id: el.id, text: el.textContent })));
    const subject = dialog.getByRole('combobox', { name: '과목', exact: true });
    const grade = dialog.getByRole('combobox', { name: '학년', exact: true });
    report.grades = {};
    for (const name of ['영어', '수학', '과학']) {
      await subject.click(); await page.getByRole('option', { name, exact: true }).click();
      await grade.click(); report.grades[name] = await page.getByRole('option').allTextContents();
      await page.keyboard.press('Escape');
      if (!process.env.QA_BASELINE) {
        const expected = name === '과학' ? ['고1', '고2', '고3'] : ['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'];
        assert.deepEqual(report.grades[name].filter(item => item !== '선택 안 함'), expected);
      }
    }
    await subject.click(); await page.getByRole('option', { name: '영어', exact: true }).click();
    await grade.click(); await page.screenshot({ path: `${out}/class-grades-${width}.png` }); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    report.passed = true;
  } catch (error) { report.error = error.message; await page.screenshot({ path: `${out}/class-failure-${width}.png` }); await fs.writeFile(`${out}/class-failure-${width}.txt`, await page.locator('body').innerText()); }
  reports.push(report); await context.close(); console.log(width, report.passed ? 'PASS' : report.error);
}
await browser.close(); await fs.writeFile(`${out}/class-browser-results.json`, JSON.stringify(reports, null, 2));
assert.ok(reports.every(r => r.passed && !r.unhandled.length && !r.errors.length), JSON.stringify(reports));
