// Actual UI with synthetic loopback transport; no real issuance or provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url);
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:3300';
const allowed = new Set([base, 'http://127.0.0.1:3301', 'http://127.0.0.1:3302']);
const out = process.env.AI_AGENT_PERSONAL_QA_OUT || '/tmp/tips-personal-owner-ui-browser-20261005';
await fs.mkdir(out, { recursive: true, mode: 0o700 });
const issuer = 'a1400000-0000-4000-8000-000000000001';
const owners = [2, 4].map(value => ({ id: `a1400000-0000-4000-8000-${String(value).padStart(12, '0')}`, name: '합성 선생님 · 같은 이름' }));
const results = [], browser = await chromium.launch({ headless: true });
async function control(input) {
  const response = await fetch(base + '/__control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(response.status, 200);
}
async function switchRole(page) {
  await control({ role: 'viewer' });
  const session = await fetch(base + '/__session?index=0').then(response => response.json());
  await page.evaluate(session => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
    const channel = new BroadcastChannel('sb-127-auth-token');
    channel.postMessage({ event: 'USER_UPDATED', session });
    setTimeout(() => channel.close(), 50);
  }, session);
}
try {
  matrix: for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await control({ reset: true, mode: 'normal' });
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const row = { width, theme, passed: false, assertions: [], screenshots: [], errors: [], blockedExternal: [], reads: [], writes: [], providerCalls: 0 };
    results.push(row);
    let support = false, mode = 'normal', deferred;
    const inventory = [], receipts = new Map();
    context.on('page', page => page.on('pageerror', error => row.errors.push(error.message)));
    await context.routeWebSocket(/.*/, socket => socket.close());
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!allowed.has(url.origin)) { row.blockedExternal.push(url.origin); return route.abort(); }
      if (url.pathname.startsWith('/api/ai-agent/') || url.pathname.startsWith('/rest/v1/rpc/ai_agent_')) row.reads.push({ path: url.pathname, action: request.method() === 'POST' ? request.postDataJSON()?.p_action ?? null : null });
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (url.pathname === '/api/ai-agent/spaces') return respond({ data: { items: Array.from({ length: 7 }, (_, index) => ({
        key: `space_${index + 1}`, label: `합성 공간 ${index + 1}`, configured: index === 0, selectable: index === 0,
        reason: index ? 'space_not_configured' : null, revision: '1',
      })) }, error: null });
      if (url.pathname === '/rest/v1/rpc/ai_agent_credential_api_v1') {
        const args = request.postDataJSON();
        assert.equal(args.p_action, 'list', 'central key issuance is outside this synthetic scenario');
        return respond({ total: 0, items: [], supportEnabled: true });
      }
      if (url.pathname !== '/rest/v1/rpc/ai_agent_personal_credential_api_v1') return route.continue();
      const { p_action: action, p_input: input } = request.postDataJSON();
      if (action === 'list') return respond({ supportEnabled: support, total: inventory.length, items: inventory.slice((input.page - 1) * input.pageSize, input.page * input.pageSize) });
      if (action === 'owners') return respond({ total: owners.length, items: owners, page: input.page, pageSize: input.pageSize });
      row.writes.push({ action, input: structuredClone(input) });
      if (mode === 'denied') return respond({ code: '42501' }, 403);
      if (action === 'create') {
        const previous = receipts.get(input.idempotencyKey);
        if (previous) return respond({ ...previous, token: null });
        const metadata = {
          id: `a2600000-0000-4000-8000-${String(inventory.length + 1).padStart(12, '0')}`,
          label: input.label, credentialKind: 'personal', ownerProfileId: input.ownerProfileId, issuerProfileId: issuer,
          ownerName: owners.find(owner => owner.id === input.ownerProfileId)?.name ?? null, issuerName: '합성 관리자',
          scopes: input.scopes, grant: input.grant, expiresAt: input.expiresAt,
        };
        receipts.set(input.idempotencyKey, metadata);
        inventory.unshift({ ...metadata, createdAt: new Date().toISOString(), revokedAt: null, lastUsedAt: null });
        if (mode === 'uncertain') return respond({ code: 'XX000' }, 503);
        if (mode === 'deferred') { deferred = () => respond({ ...metadata, token: 'tips_agent_' + 'a'.repeat(64) }); return; }
        return respond({ ...metadata, token: 'tips_agent_' + 'a'.repeat(64) });
      }
      if (action === 'revoke') {
        const item = inventory.find(item => item.id === input.id);
        item.revokedAt ||= new Date().toISOString();
        return respond({ id: item.id, revokedAt: item.revokedAt });
      }
      return respond({ code: '22023' }, 400);
    });
    const page = await context.newPage(), tag = `${width}-${theme}`;
    async function snapshot(name) {
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)), 0, name + ' page overflow');
      const file = `${name}-${tag}.png`;
      await page.screenshot({ path: `${out}/${file}` }); row.screenshots.push(file);
    }
    const primary = () => page.getByRole('button', { name: '개인 요청 키 발급', exact: true });
    async function selectOwner(id = owners[0].id) {
      await page.getByLabel('요청 소유자', { exact: false }).selectOption(id);
    }
    try {
      await page.goto(base + `/__fixture?route=settings&theme=${theme}`);
      await page.getByRole('tab', { name: 'AI 요청 키', exact: true }).click();
      await page.getByText('발급한 AI 요청 키가 없습니다.', { exact: true }).waitFor();
      const reference = await page.getByRole('button', { name: 'AI 요청 키 발급', exact: true }).evaluate(element => {
        const style = getComputedStyle(element); return { height: style.height, font: style.fontSize, radius: style.borderRadius, background: style.backgroundColor };
      });
      await snapshot('central-reference');
      await page.getByRole('tab', { name: '개인 요청 키', exact: true }).click();
      await page.getByText('개인 요청 키 발급 준비 중', { exact: true }).waitFor();
      assert.equal(await primary().isDisabled(), true); assert.equal(row.writes.length, 0);
      await snapshot('personal-support-off');
      support = true;
      await page.getByRole('button', { name: '개인 요청 키 새로고침', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(element => element.textContent === '개인 요청 키 발급' && !element.disabled));
      assert.deepEqual(await primary().evaluate(element => { const style = getComputedStyle(element); return { height: style.height, font: style.fontSize, radius: style.borderRadius, background: style.backgroundColor }; }), reference);
      await primary().click();
      await page.getByLabel('요청 소유자', { exact: false }).getByRole('option', { name: /같은 이름/ }).first().waitFor({ state: 'attached' });
      assert.equal(await page.getByLabel('요청 소유자', { exact: false }).inputValue(), '');
      assert.equal(await page.getByRole('button', { name: '발급', exact: true }).isDisabled(), true);
      assert.equal(await page.getByLabel('요청 권한', { exact: true }).inputValue(), 'read');
      assert.equal(await page.getByLabel('유효 기간', { exact: true }).inputValue(), '1');
      assert.equal(await page.getByRole('checkbox', { name: '본인 요청 완료 알림', exact: true }).isChecked(), false);
      await selectOwner(); await snapshot('owner-selection');
      await page.getByRole('checkbox', { name: '본인 요청 완료 알림', exact: true }).click();
      const spaceBoxes = await page.getByRole('group', { name: '알림 공간', exact: true }).getByRole('checkbox').all();
      assert.equal(spaceBoxes.length, 7);
      for (const [index, checkbox] of spaceBoxes.entries()) {
        assert.equal(await checkbox.isChecked(), false);
        assert.equal(await checkbox.isDisabled(), index > 0);
      }
      assert.equal(await page.getByRole('button', { name: '발급', exact: true }).isDisabled(), true);
      await snapshot('completion-explicit-spaces');
      await page.getByRole('checkbox', { name: '본인 요청 완료 알림', exact: true }).click();
      await page.getByRole('button', { name: '개인 요청 키 발급 취소', exact: true }).click();
      assert.equal(row.writes.length, 0);
      await page.waitForFunction(() => document.activeElement?.textContent === '개인 요청 키 발급');
      row.assertions.push('central tokens match; support off and cancel produce zero writes; owner explicit/read/day1/completion off');
      mode = 'denied'; await primary().click(); await selectOwner();
      await page.getByRole('button', { name: '발급', exact: true }).click();
      await page.getByText('발급하지 못했습니다. 소유자 권한과 선택 항목을 확인하세요.', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('요청 소유자', { exact: false }).inputValue(), owners[0].id);
      await snapshot('denied-input-preserved'); await page.keyboard.press('Escape');
      mode = 'deferred'; await primary().click(); await selectOwner();
      await page.getByLabel('요청 권한', { exact: true }).selectOption('worker');
      await page.getByRole('button', { name: '발급', exact: true }).evaluate(element => { element.click(); element.click(); });
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(element => element.textContent?.includes('발급') && element.disabled));
      for (let n = 0; n < 100 && !deferred; n++) await page.waitForTimeout(20);
      assert.ok(deferred); assert.equal(row.writes.filter(write => write.action === 'create').length, 2);
      await deferred(); deferred = null;
      await page.getByRole('textbox', { name: '발급된 개인 요청 키', exact: true }).waitFor();
      assert.equal(row.writes.at(-1).input.ownerProfileId, owners[0].id);
      assert.deepEqual(row.writes.at(-1).input.grant.actions, ['read', 'claim', 'renew', 'progress', 'question', 'done']);
      assert.equal(row.writes.at(-1).input.grant.purposes, undefined);
      await snapshot('first-synthetic-key'); await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement?.textContent === '개인 요청 키 발급');
      await snapshot('identity-list');
      row.assertions.push('denial keeps owner; double click produces one create; separate owner and issuer; one-time secret focus restoration');
      mode = 'uncertain'; await primary().click(); await selectOwner();
      await page.getByRole('button', { name: '발급', exact: true }).click();
      await page.getByText('발급 결과를 확인하지 못했습니다. 같은 발급의 결과를 다시 확인하세요.', { exact: true }).waitFor();
      const original = structuredClone(row.writes.at(-1)); await page.keyboard.press('Escape');
      await page.getByRole('tab', { name: 'AI 요청 키', exact: true }).click();
      await page.getByRole('tab', { name: '개인 요청 키', exact: true }).click();
      await page.getByRole('button', { name: '발급 결과 확인', exact: true }).click();
      assert.equal(await page.getByLabel('요청 소유자', { exact: false }).inputValue(), original.input.ownerProfileId);
      assert.equal(await page.getByLabel('요청 소유자', { exact: false }).isDisabled(), true);
      mode = 'normal';
      await page.getByRole('button', { name: '발급 결과 확인', exact: true }).last().click();
      await page.getByText(/발급 기록을 확인했습니다. 원문 키는 다시 표시할 수 없습니다/).waitFor();
      assert.deepEqual(row.writes.at(-1), original);
      assert.equal(await page.getByRole('textbox', { name: '발급된 개인 요청 키', exact: true }).count(), 0);
      await snapshot('owned-replay');
      await page.getByRole('button', { name: /개인 요청 키 폐기$/, exact: false }).first().click();
      await page.getByRole('button', { name: '개인 요청 키 폐기 폐기', exact: true }).click();
      await page.getByText('개인 요청 키를 폐기했습니다.', { exact: true }).waitFor();
      await snapshot('revoked');
      row.assertions.push('same actor tab remount locks original owner/key/payload; replay exposes no token; revoke synthetic only');
      mode = 'deferred'; await primary().click(); await selectOwner();
      await page.getByRole('button', { name: '발급', exact: true }).click();
      for (let n = 0; n < 100 && !deferred; n++) await page.waitForTimeout(20);
      assert.ok(deferred); await switchRole(page);
      await page.waitForFunction(() => document.querySelector('#ai-personal-credential-label') === null);
      await deferred(); deferred = null;
      assert.equal(await page.getByRole('textbox', { name: '발급된 개인 요청 키', exact: true }).count(), 0);
      await snapshot('late-role-response');
      row.assertions.push('late response after current role loss stays hidden');
      assert.deepEqual(row.errors, []); assert.deepEqual(row.blockedExternal, []); row.passed = true;
    } catch (error) {
      row.failure = String(error.stack).replace(/tips_agent_[a-f0-9]{64}/gu, '[synthetic-token-redacted]');
      await snapshot('failure').catch(() => {});
    } finally { await context.close(); }
    process.stdout.write(`${tag}: ${row.passed ? 'PASS' : 'FAIL'}\n`);
    if (!row.passed) break matrix;
  }
} finally { await browser.close(); }
await fs.writeFile(out + '/results.json', JSON.stringify({ provenance: { synthetic: true, loopbackOnly: true, realIssuance: false, providerCalls: 0 }, results }, null, 2), { mode: 0o600 });
assert.equal(results.length, 4); assert.ok(results.every(row => row.passed));
