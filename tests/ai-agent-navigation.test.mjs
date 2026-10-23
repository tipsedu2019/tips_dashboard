import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
const {getRoleCapabilities}=loadNotificationComponent('src/lib/auth-utils.ts');
const {resolveAiAgentRequestAccess}=loadNotificationComponent('src/features/ai-agent/ai-agent-request-access.ts');
const {buildAdminNavGroups,resolveAdminWorkspaceMeta}=loadNotificationComponent('src/lib/navigation.ts');
for(const role of ['admin','staff','teacher','assistant','viewer'])test(`${role}: retired AI menu is absent regardless of legacy API capability`,()=>{
 const access=resolveAiAgentRequestAccess({role,isFallbackRole:false,loading:false});
 const items=buildAdminNavGroups({...getRoleCapabilities(role),isAdmin:role==='admin',canUseAiAgentRequests:access.canUseRequests}).flatMap(group=>group.items);
 assert.equal(items.some(item=>item.url==='/admin/ai-agent'),false);
 const unresolved=buildAdminNavGroups({...getRoleCapabilities(role),canUseAiAgentRequests:false}).flatMap(group=>group.items);
 assert.equal(unresolved.some(item=>item.url==='/admin/ai-agent'),false);
});
for(const path of ['/admin/ai-agent','/admin/ai-agent/20000000-0000-4000-8000-000000000001','/admin/ai-agent-other','/admin/settings/agent-access'])test(`real assistant AuthGuard boundary ${path}`,()=>{
 const {AuthGuard}=loadNotificationComponent('src/components/auth/auth-guard.tsx',new Map([['next/navigation',{useRouter:()=>({replace(){}}),usePathname:()=>path,useSearchParams:()=>new URLSearchParams()}],['@/providers/auth-provider',{useAuth:()=>({user:{id:'assistant'},loading:false,canAccessDashboard:true,canUseAssistantOperations:true,defaultAdminPath:'/admin/word-retests'})}]]));
 const html=renderToStaticMarkup(createElement(AuthGuard,null,createElement('span',null,'protected request detail')));
 assert.equal(html.includes('protected request detail'),false);
});
test('sidebar/search use same verified provider capability and no shortcuts added',()=>{
 for(const path of ['src/components/app-sidebar.tsx','src/components/command-search.tsx'])assert.match(readFileSync(new URL('../'+path,import.meta.url),'utf8'),/buildAdminNavGroups\(\{[^}]*canUseAiAgentRequests/);
 const provider=readFileSync(new URL('../src/providers/auth-provider.tsx',import.meta.url),'utf8');assert.match(provider,/canUseAiAgentRequests: resolveAiAgentRequestAccess\(\{ role, isFallbackRole: user\?\.isFallbackRole, loading \}\)/);
});

for(const path of ['/admin/ai-agent','/admin/ai-agent/20000000-0000-4000-8000-000000000001'])test(`legacy history shell title ${path}`,()=>{
 assert.deepEqual(resolveAdminWorkspaceMeta(path),{section:'설정',title:'이전 요청 이력',summary:'기존 요청과 처리 결과를 조회합니다.'});
});

test('API navigation preserves the existing administrator boundary', () => {
 for (const role of ['admin', 'staff', 'teacher', 'assistant', 'viewer']) {
  const items = buildAdminNavGroups({ ...getRoleCapabilities(role), isAdmin: role === 'admin' }).flatMap(group => group.items).flatMap(item => item.items ?? []);
  assert.equal(items.some(item => item.url === '/admin/settings/agent-access'), role === 'admin');
  if (role === 'admin') assert.equal(items.find(item => item.url === '/admin/settings/agent-access').title, 'API');
 }
 assert.equal(resolveAdminWorkspaceMeta('/admin/settings/agent-access').title, 'API');
});
