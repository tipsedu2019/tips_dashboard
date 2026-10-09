// Current API settings and retained request history: synthetic reads only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url);
const { chromium } = require('playwright');
const base = process.env.AI_AGENT_BASE_URL || 'http://127.0.0.1:3300';
assert.equal(new URL(base).hostname, '127.0.0.1');
const allowed = new Set([base, ...[1, 2].map(offset => `http://127.0.0.1:${Number(new URL(base).port) + offset}`)]);
const out = process.env.AI_AGENT_QA_OUT || '/tmp/tips-api-settings-browser';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
const results = [];
const control = async value => { const response = await fetch(base + '/__control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); assert.equal(response.status, 200); };
try {
 for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
  await control({ reset: true });
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce', serviceWorkers: 'block', colorScheme: theme });
  const row = { width, theme, errors: [], forbidden: [], screenshots: [], assertions: [] }; results.push(row);
  await context.routeWebSocket(/.*/, socket => socket.close());
  await context.route('**/*', route => {
   const request = route.request(), url = new URL(request.url());
   if (!allowed.has(url.origin)) return route.abort();
   if ((url.pathname.startsWith('/api/ai-agent/') && request.method() !== 'GET') || /\/(create|revoke)_agent_credential|\/ai_agent_(personal_)?credential_api/.test(url.pathname)) { row.forbidden.push(url.pathname); return route.abort(); }
   return route.continue();
  });
  const page = await context.newPage(); page.on('pageerror', error => row.errors.push(error.message));
  const screenshot = async name => { await page.evaluate(() => document.fonts.ready); assert.equal(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)), 0, name + ' overflow'); const file = `${name}-${width}-${theme}.png`; await page.screenshot({ path: `${out}/${file}` }); row.screenshots.push(file); };
  const metrics = () => page.evaluate(() => { const head = document.querySelector('[data-slot="table-head"]'); return { font: getComputedStyle(document.body).fontFamily, headHeight: head?.getBoundingClientRect().height, headFont: head ? getComputedStyle(head).fontSize : null }; });
  try {
   await page.goto(`${base}/__fixture?route=schools&theme=${theme}`);
   await page.locator('input[data-school-row-name]').filter({ visible: true }).first().waitFor();
   row.reference = await metrics(); await screenshot('schools-reference');
   await page.goto(base + '/admin/settings/agent-access');
   await page.getByRole('tab', { name: '지원 기능', exact: true }).waitFor();
   assert.equal(await page.getByRole('tab', { selected: true }).textContent(), '지원 기능');
   assert.equal(await page.getByRole('tab').count(), 3); assert.equal(await page.getByRole('tabpanel').count(), 1);
   await page.getByText('개인 키 발급 화면과 개인 업무 수정은 미제공', { exact: false }).waitFor();
   row.support = await metrics(); assert.equal(row.support.font, row.reference.font); assert.equal(row.support.headFont, row.reference.headFont); assert.ok(row.support.headHeight >= 44);
   await screenshot('api-support');
   await page.getByRole('tab', { name: '지원 기능', exact: true }).focus(); await page.keyboard.press('ArrowRight');
   assert.equal(await page.getByRole('tab', { selected: true }).textContent(), '지원 기능');
   await page.waitForFunction(() => document.activeElement?.textContent === '연결 키'); await page.keyboard.press('Enter'); await page.getByText('발급한 연결 키가 없습니다.', { exact: true }).waitFor();
   assert.equal(await page.getByRole('tab', { selected: true }).textContent(), '연결 키');
   await screenshot('connections-empty');
   await control({ mode: 'error' }); await page.getByRole('button', { name: '연결 목록 새로고침', exact: true }).click();
   await page.getByRole('alert').filter({ hasText: '연결 목록을 불러오지 못했습니다' }).waitFor(); await screenshot('connections-error');
   await control({ mode: 'loading' }); await page.getByRole('button', { name: '연결 목록 새로고침', exact: true }).click();
   await page.getByText('불러오는 중…', { exact: true }).waitFor(); await screenshot('connections-loading');
   await page.getByText('발급한 연결 키가 없습니다.', { exact: true }).waitFor(); await control({ mode: 'normal' });
   await page.getByRole('tab', { name: '사용 안내', exact: true }).click(); await page.getByRole('heading', { name: '수정 결과 확인' }).waitFor();
   assert.equal(await page.getByRole('tabpanel').count(), 1); await screenshot('api-guide');
   await page.getByRole('link', { name: '이전 요청 조회', exact: true }).click();
   const requestLink = page.getByRole('link', { name: /합성 긴 요청 제목/ }).filter({ visible: true }).first(); await requestLink.waitFor();
   assert.equal(await page.getByRole('button', { name: '요청 작성', exact: true }).count(), 0); await screenshot('history');
   await requestLink.click(); await page.getByRole('heading', { name: /합성 긴 요청 제목/ }).waitFor();
   assert.equal(await page.locator('section[aria-labelledby="ai-messages-title"] li').count(), 55);
   assert.equal(await page.locator('section[aria-labelledby="ai-audit-title"] li').count(), 55);
   assert.equal(await page.locator('section[aria-labelledby="ai-actions-title"] > ul > li').count(), 53);
   assert.equal(await page.locator('textarea,form').count(), 0); assert.equal(await page.getByRole('button', { name: /요청 취소|요청 재개|답변 저장/ }).count(), 0);
   await screenshot('history-detail'); await page.getByRole('button', { name: '합성 작업 1 작업 기록 조회', exact: true }).click();
   await page.getByText('합성 작업 확인 53', { exact: false }).waitFor();
   await page.getByRole('link', { name: '이전 요청 목록', exact: true }).click();
   await page.getByRole('link', { name: /합성 긴 요청 제목/ }).filter({ visible: true }).first().waitFor();
   for (const state of ['empty', 'error', 'loading']) {
    await control({ mode: state }); const retry = page.getByRole('button', { name: 'AI 요청 다시 조회', exact: true }); if (await retry.count()) await retry.click(); else await page.getByRole('button', { name: 'AI 요청 새로고침', exact: true }).click();
    if (state === 'empty') await page.getByText('AI 요청이 없습니다.', { exact: true }).filter({ visible: true }).first().waitFor();
    if (state === 'error') await page.getByRole('button', { name: 'AI 요청 다시 조회', exact: true }).waitFor();
    if (state === 'loading') await page.getByText('불러오는 중…', { exact: true }).filter({ visible: true }).first().waitFor();
    await screenshot('history-' + state);
    if (state === 'loading') await page.getByRole('link', { name: /합성 긴 요청 제목/ }).filter({ visible: true }).first().waitFor();
   }
   await control({ mode: 'normal' });
   await page.getByTestId('admin-quick-search-trigger').click();
   assert.equal(await page.getByTestId('admin-quick-search-item-admin-ai-agent').count(), 0);
   await page.keyboard.press('Escape');
   assert.deepEqual(row.errors, []); assert.deepEqual(row.forbidden, []);
   row.assertions = ['school settings visual tokens retained', 'desktop/mobile light/dark no page overflow', 'manual keyboard tabs and single panel', 'empty/error/loading recovery', 'legacy ID with 55 messages/events and 53 actions/journals', 'zero retired mutation controls or network writes', 'retired menu absent from command search'];
   row.passed = true;
  } catch (error) { row.failure = error.stack; await page.screenshot({ path: `${out}/failure-${width}-${theme}.png` }); }
  await context.close(); console.log(width, theme, row.passed ? 'PASS' : row.failure);
  if (!row.passed) throw new Error('API settings browser checks failed');
 }
} finally { await browser.close(); await fs.writeFile(`${out}/results.json`, JSON.stringify({ results }, null, 2)); }
