// Personal issuance UI retirement does not remove or relax personal API authorization tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { mountApiSettings } from './helpers/api-settings-ui.mjs';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
for (const role of ['staff', 'teacher', 'assistant', 'viewer']) test(`${role} receives no new settings permission or personal-key issuance`, async t => {
 const ui = await mountApiSettings(t, { auth: { role } });
 assert.match(document.body.textContent, /관리자 계정에서만 API 설정/);
 assert.equal(document.querySelector('[role="tab"]'), null);
 assert.equal(ui.rpcCalls.length, 0); assert.equal(ui.fetchCalls.length, 0);
});
test('unverified admin has no API settings access', async t => {
 const ui = await mountApiSettings(t, { auth: { user: { id: 'fallback', isFallbackRole: true } } });
 assert.equal(document.querySelector('[role="tab"]'), null); assert.equal(ui.rpcCalls.length, 0);
});
test('guide distinguishes credentials, durable results and historical request state', async t => {
 const ui = await mountApiSettings(t); await ui.tab('사용 안내');
 const text = document.body.textContent;
 assert.match(text, /서로 다른 권한/); assert.match(text, /이전 AI 요청 키로 수업이나 학사일정을 수정할 수 없습니다/);
 assert.match(text, /HTTP 200만으로 완료를 판단하지 말고 applied·failed·unknown/);
 assert.match(text, /GET \/api\/v2\/operations\//); assert.match(text, /GET \/api\/v2\/calendar\/operations\//);
 assert.ok(document.querySelector('a[href="/admin/ai-agent"]'));
 assert.equal(ui.rpcCalls.length, 0); assert.equal(ui.fetchCalls.length, 0);
});
test('retired UI modules are removed while compatible services and HTTP routes remain', () => {
 for (const path of ['ai-agent-credential-issue-dialog.tsx', 'ai-agent-personal-credential-workspace.tsx', 'ai-agent-space-policy-settings.tsx', 'ai-agent-request-create-dialog.tsx']) assert.equal(existsSync(new URL('../src/features/ai-agent/' + path, import.meta.url)), false);
 for (const path of ['ai-agent-personal-credential-service.ts', 'ai-agent-credential-service.ts', 'ai-agent-request-service.ts', 'ai-agent-request-recovery.ts']) assert.ok(existsSync(new URL('../src/features/ai-agent/' + path, import.meta.url)));
 const access = readFileSync(new URL('../src/features/agent-api/agent-access-workspace.tsx', import.meta.url), 'utf8');
 assert.doesNotMatch(access, /AiAgentCredentialWorkspace|AiAgentPersonalCredentialWorkspace|AiAgentSpacePolicySettings/);
});
test('support guide links to actual published OpenAPI routes and preserves narrow personal audience', () => {
 const { agentEditOpenApi } = loadNotificationComponent('src/features/agent-api/server/openapi-v2.ts');
 for (const path of ['/operations/{requestKey}', '/calendar/operations/{requestKey}', '/classes/{classId}/lesson-state-corrections/preview']) assert.ok(agentEditOpenApi.paths[path]);
 const personal = agentEditOpenApi['x-tips-credential-contracts'].personal_dashboard_read;
 assert.deepEqual(personal.methods, ['GET']); assert.equal(personal.paths.length, 3);
 assert.match(personal.limits, /No health, class discovery, writes, receipt access or issuance endpoint/);
});
