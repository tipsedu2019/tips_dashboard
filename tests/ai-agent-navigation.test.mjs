import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
const {getRoleCapabilities}=loadNotificationComponent('src/lib/auth-utils.ts');
const {resolveAiAgentRequestAccess}=loadNotificationComponent('src/features/ai-agent/ai-agent-request-access.ts');
const {buildAdminNavGroups,resolveAdminWorkspaceMeta}=loadNotificationComponent('src/lib/navigation.ts');
for(const role of ['admin','staff','teacher','assistant','viewer'])test(`${role}: menu receives verified AI capability independently`,()=>{
 const access=resolveAiAgentRequestAccess({role,isFallbackRole:false,loading:false});
 const items=buildAdminNavGroups({...getRoleCapabilities(role),isAdmin:role==='admin',canUseAiAgentRequests:access.canUseRequests}).flatMap(group=>group.items);
 assert.equal(items.some(item=>item.url==='/admin/ai-agent'),role!=='viewer');
 if(role!=='viewer')assert.equal(items.find(item=>item.url==='/admin/ai-agent').title,'AI 에이전트');
 const unresolved=buildAdminNavGroups({...getRoleCapabilities(role),canUseAiAgentRequests:false}).flatMap(group=>group.items);
 assert.equal(unresolved.some(item=>item.url==='/admin/ai-agent'),false);
});
for(const path of ['/admin/ai-agent','/admin/ai-agent/20000000-0000-4000-8000-000000000001','/admin/ai-agent-other','/admin/settings/agent-access'])test(`real assistant AuthGuard boundary ${path}`,()=>{
 const {AuthGuard}=loadNotificationComponent('src/components/auth/auth-guard.tsx',new Map([['next/navigation',{useRouter:()=>({replace(){}}),usePathname:()=>path,useSearchParams:()=>new URLSearchParams()}],['@/providers/auth-provider',{useAuth:()=>({user:{id:'assistant'},loading:false,canAccessDashboard:true,canUseAssistantOperations:true,defaultAdminPath:'/admin/word-retests'})}]]));
 const html=renderToStaticMarkup(createElement(AuthGuard,null,createElement('span',null,'protected request detail')));
 assert.equal(html.includes('protected request detail'),path==='/admin/ai-agent'||path.startsWith('/admin/ai-agent/'));
});
test('sidebar/search use same verified provider capability and no shortcuts added',()=>{
 for(const path of ['src/components/app-sidebar.tsx','src/components/command-search.tsx'])assert.match(readFileSync(new URL('../'+path,import.meta.url),'utf8'),/buildAdminNavGroups\(\{[^}]*canUseAiAgentRequests/);
 const provider=readFileSync(new URL('../src/providers/auth-provider.tsx',import.meta.url),'utf8');assert.match(provider,/canUseAiAgentRequests: resolveAiAgentRequestAccess\(\{ role, isFallbackRole: user\?\.isFallbackRole, loading \}\)/);
});

for(const path of ['/admin/ai-agent','/admin/ai-agent/20000000-0000-4000-8000-000000000001'])test(`approved AI agent shell title ${path}`,()=>{
 assert.deepEqual(resolveAdminWorkspaceMeta(path),{section:'운영',title:'AI 에이전트',summary:'요청과 답변, 처리 이력을 확인합니다.'});
});
