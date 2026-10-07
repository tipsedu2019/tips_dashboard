// Run against a localhost server staged with tests/helpers/registration-class-selection-fixture.mjs.
// Intercepts every external request; never calls a save, message, or mutation control.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url);
const { chromium } = require('playwright');
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3277';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const out = process.env.QA_OUTPUT || 'output/playwright/registration-selection';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const reports = [];
for (const width of [1440, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce' });
  const blocked = [], errors = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/__nextjs_original-stack-frames') return route.abort();
    if (url.origin !== base || url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method())) { blocked.push(`${req.method()} ${url.pathname}`); return route.abort(); }
    return route.continue();
  });
  await context.routeWebSocket(/.*/, socket => socket.close());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') console.log('CONSOLE', msg.text()); });
  const report = { width, blocked, errors };
  try {
    await page.goto(`${base}/admin/registration?fixture=registration-subject-tracks&fixtureRole=english_admin&taskId=20000000-0000-4000-8000-000000000002&trackId=20000000-0000-4000-8000-000000000001`);
    const choose = async (name, option) => { await page.getByRole('combobox', { name, exact: true }).click(); await page.getByRole('option', { name: option, exact: true }).click(); };
    const optionLabels = async name => { await page.getByRole('combobox', { name, exact: true }).click(); const labels = await page.getByRole('option').allTextContents(); await page.keyboard.press('Escape'); return labels; };
    const enrollment = '영어 수업 1 선택';
    await page.getByRole('combobox', { name: enrollment, exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole('combobox', { name: '청강 반', exact: true }).waitFor({ timeout: 10000 });
    if (process.env.QA_BASELINE === '1') {
      report.gradeControlCount = await page.getByRole('combobox', { name: `${enrollment} 학년`, exact: true }).count();
      report.classOptions = await optionLabels(enrollment);
      await choose(enrollment, '영어 2반');
      const book = page.getByRole('button', { name: '영어 수업 1 교재 선택', exact: true });
      await book.waitFor();
      report.defaultBooks = await book.getAttribute('title');
      await page.getByRole('region', { name: '영어 수강 수업', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/enrollment-${width}.png` });
      await page.getByRole('combobox', { name: '청강 반', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/observation-${width}.png` });
      report.passed = true; reports.push(report); await context.close(); continue;
    }

    report.gradeOptions = await optionLabels(`${enrollment} 학년`);
    assert.deepEqual(report.gradeOptions, ['전체 학년', '중1', '중2', '고3', '학년 미지정']);
    for (const name of [enrollment, '청강 반']) {
      await choose(`${name} 학년`, '중1');
      assert.deepEqual(await optionLabels(name), ['반 선택', '영어 2반', '영어 10반']);
      await choose(`${name} 학년`, '중2');
      assert.deepEqual(await optionLabels(name), ['반 선택', '영어 2반']);
      await choose(`${name} 학년`, '학년 미지정');
      assert.deepEqual(await optionLabels(name), ['반 선택', '학년 공통반']);
      await choose(`${name} 학년`, '중1');
    }
    await choose(enrollment, '영어 2반');
    const bookButton = page.getByRole('button', { name: '영어 수업 1 교재 선택', exact: true });
    await page.waitForFunction(() => document.querySelector('[aria-label="영어 수업 1 교재 선택"]')?.getAttribute('title') === '합성 교재 a, 합성 교재 b, 합성 교재 c');
    assert.equal(await bookButton.getAttribute('title'), '합성 교재 a, 합성 교재 b, 합성 교재 c');
    await bookButton.click();
    assert.equal(await page.getByRole('checkbox', { name: '합성 교재 a', exact: true }).isChecked(), true);
    assert.equal(await page.getByRole('checkbox', { name: '합성 교재 inactive', exact: true }).isChecked(), false);
    assert.equal(await page.getByRole('checkbox', { name: '합성 교재 expired', exact: true }).isChecked(), false);
    assert.equal(await page.getByRole('checkbox', { name: '합성 교재 future', exact: true }).isChecked(), false);
    await page.getByRole('checkbox', { name: '합성 교재 b', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await bookButton.getAttribute('title'), '합성 교재 a, 합성 교재 c');
    await choose(`${enrollment} 학년`, '고3');
    await page.waitForFunction(() => document.querySelector('[aria-label="영어 수업 1 선택"]')?.textContent === '영어 2반', { timeout: 3000 });
    assert.equal(await page.getByRole('combobox', { name: enrollment, exact: true }).innerText(), '영어 2반');
    assert.equal(await bookButton.getAttribute('title'), '합성 교재 a, 합성 교재 c');
    await page.getByRole('combobox', { name: enrollment, exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement === document.querySelector('[aria-label="영어 수업 1 선택"]'));
    assert.equal(await page.getByRole('combobox', { name: enrollment, exact: true }).evaluate(el => document.activeElement === el), true);
    await choose(`${enrollment} 학년`, '중1');
    await page.getByRole('region', { name: '영어 수강 수업', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/enrollment-${width}.png` });
    await page.getByRole('combobox', { name: '청강 반 학년', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/observation-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    await page.screenshot({ path: `${out}/failure-${width}.png` });
    await fs.writeFile(`${out}/failure-${width}.txt`, await page.locator('body').innerText());
  }
  await context.close(); reports.push(report); console.log(width, report.passed ? 'PASS' : report.error);
}
await browser.close();
await fs.writeFile(`${out}/browser-results.json`, JSON.stringify(reports, null, 2));
assert.ok(reports.every(report => report.passed && report.errors.length === 0 && report.blocked.length === 0), JSON.stringify(reports));
