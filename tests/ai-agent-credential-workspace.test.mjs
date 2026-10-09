// The former central/Chat issuance UI is retired. Its API/service contracts remain tested separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApiSettings } from './helpers/api-settings-ui.mjs';

test('API settings defaults to support without issuing or reading credentials', async t => {
 const ui = await mountApiSettings(t);
 assert.deepEqual([...document.querySelectorAll('[role="tab"]')].map(tab => tab.textContent), ['지원 기능', '연결 키', '사용 안내']);
 assert.match(document.body.textContent, /개인 키 발급 화면과 개인 업무 수정은 미제공/);
 assert.equal(ui.rpcCalls.length, 0); assert.equal(ui.fetchCalls.length, 0);
 for (const label of ['AI 요청 키 발급', '개인 요청 키 발급', '알림 공간']) assert.equal(ui.button(label), undefined);
});
test('manual tab activation fetches existing business inventory only on selection', async t => {
 const ui = await mountApiSettings(t);
 await ui.flush(() => { ui.button('연결 키').focus(); ui.button('연결 키').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
 assert.equal(ui.rpcCalls.length, 0);
 await ui.tab('연결 키');
 assert.equal(ui.rpcCalls.length, 1); assert.equal(ui.rpcCalls[0].name, 'list_agent_credentials_v1');
 assert.deepEqual(ui.rpcCalls[0].args, { p_page: 1, p_page_size: 10 });
 assert.ok(ui.button('연결 키 발급'));
 await ui.tab('사용 안내');
 assert.equal(document.querySelectorAll('[role="tabpanel"]').length, 1);
 assert.match(document.body.textContent, /새 요청 식별자로 다시 제출하거나 같은 일을 화면에서 반복하지 말고/);
 assert.equal(ui.rpcCalls.length, 1); assert.equal(ui.fetchCalls.length, 0);
});
test('disabled API does not offer issuance and failed inventory stays an error', async t => {
 const ui = await mountApiSettings(t, { apiEnabled: false, response: { data: null, error: { message: 'synthetic failure' } } });
 assert.match(document.body.textContent, /업무 API가 비활성화/);
 await ui.tab('연결 키');
 assert.equal(ui.button('연결 키 발급').disabled, true);
 assert.match(document.body.textContent, /목록을 불러오지 못했습니다/);
 assert.doesNotMatch(document.body.textContent, /발급한 연결 키가 없습니다/);
});
test('existing business credentials retain exact scope and target display without automatic mutation', async t => {
 const ui = await mountApiSettings(t, { response: { data: { items: [{ id: '20000000-0000-4000-8000-000000000001', label: '기존 업무 연결', scopes: ['classes:read', 'class-info:write', 'calendar:read'], classIds: [], classAccess: { mode: 'all', includesFutureClasses: true }, expiresAt: '2099-10-01T00:00:00Z', revokedAt: null, lastUsedAt: null }], total: 1 }, error: null } });
 await ui.tab('연결 키');
 assert.match(document.body.textContent, /기존 업무 연결/); assert.match(document.body.textContent, /전체 수업 \(신규 포함\)/);
 assert.match(document.body.textContent, /기본 정보 · 학사일정 조회/);
 assert.equal(ui.rpcCalls.length, 1); assert.equal(ui.rpcCalls[0].name, 'list_agent_credentials_v1');
 await ui.switch({ role: 'viewer' });
 assert.doesNotMatch(document.body.textContent, /기존 업무 연결/); assert.equal(ui.button('연결 키 발급'), undefined);
});
