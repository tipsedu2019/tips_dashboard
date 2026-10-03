import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
const { resolveAiAgentRequestAccess } = loadNotificationComponent('src/features/ai-agent/ai-agent-request-access.ts');
for (const role of ['staff','teacher','assistant']) test(`${role} receives own capability`, () => assert.deepEqual(resolveAiAgentRequestAccess({role,isFallbackRole:false,loading:false}), {canUseRequests:true,canViewAll:false}));
test('only verified admin receives all; unresolved actors deny', () => {
 assert.deepEqual(resolveAiAgentRequestAccess({role:'admin',isFallbackRole:false,loading:false}), {canUseRequests:true,canViewAll:true});
 for (const input of [{role:'viewer'},{role:'unknown'},{role:'admin',loading:true},{role:'admin',isFallbackRole:true},{role:'admin',isFallbackRole:undefined}]) assert.deepEqual(resolveAiAgentRequestAccess({isFallbackRole:false,loading:false,...input}), {canUseRequests:false,canViewAll:false});
});
