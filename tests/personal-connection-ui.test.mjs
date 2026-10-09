import assert from 'node:assert/strict';
import test from 'node:test';
import { mountApiSettings } from './helpers/api-settings-ui.mjs';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ownerId = id(1), classId = id(3), schoolId = id(4);
// Synthetic values only, never sent over HTTP or connected to a database.
const syntheticSecret = 'tips_dashboard_personal_' + 'a'.repeat(64);
function fixture() {
 const state = { ownerId, items: [], calls: [], mode: 'normal' };
 const classes = [{ id: classId, name: '합성 담당 수업' }], schools = [{ id: schoolId, name: '합성 허용 학교' }];
 const service = {
  async load(input) { return { status: 'ready', ownerId: state.ownerId, items: state.items.slice((input.page-1)*input.pageSize,input.page*input.pageSize), total: state.items.length, page: input.page, pageSize: input.pageSize, operation: input.pending ? { ...input.pending, state: state.mode === 'recovered' ? 'applied' : 'unknown', credential: state.mode === 'recovered' ? state.items[0] : null } : null }; },
  async targets(input) { const rows = input.kind === 'classes' ? classes : schools; return { ownerId: state.ownerId, kind: input.kind, search: input.search.trim(), items: rows, total: rows.length, page: input.page, pageSize: input.pageSize }; },
  async issue(input) {
   state.calls.push({ kind: 'issue', input, persisted: JSON.parse(window.sessionStorage.getItem(`tips:personal-connection:pending:${state.ownerId}`)) });
   const credential = { id: id(10), ownerId: state.ownerId, label: input.label, classes: classes.filter(row=>input.classIds.includes(row.id)), schools: schools.filter(row=>input.schoolIds.includes(row.id)), expiresAt: input.expiresAt, revokedAt: null, lastUsedAt: null };
   state.items = [credential];
   if (state.mode === 'unknown') throw new Error(syntheticSecret);
   const result = { requestId: input.requestId, credential, secret: syntheticSecret };
   if (state.mode === 'delayed') return await new Promise(resolve => { state.resolveIssue = () => resolve(result); });
   return result;
  },
  async revoke(input) { state.calls.push({ kind: 'revoke', input }); const credential = { ...state.items.find(row=>row.id===input.credentialId), revokedAt: new Date().toISOString() }; state.items=[credential]; return { requestId: input.requestId, credential }; },
 };
 return { state, service };
}
async function input(ui, value) {
 await ui.flush(() => { const field=document.getElementById('personal-label'); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(field,value); field.dispatchEvent(new window.Event('input',{bubbles:true})); });
}
async function review(ui) {
 await ui.flush(()=>ui.button('새 개인 연결').click()); await input(ui,'합성 일정 읽기');
 await ui.flush(()=>document.querySelector('[role="checkbox"]').click());
 await ui.flush(()=>ui.button('범위 확인').click());
}
async function confirm(ui) {
 await ui.flush(()=>document.querySelector('[role="checkbox"]').click());
 await ui.flush(()=>ui.button('확인하고 키 발급').click());
}
test('verified teacher sees exactly three read features and no business inventory calls',async t=>{
 const ui=await mountApiSettings(t,{auth:{role:'teacher'}});
 assert.equal(document.querySelectorAll('tbody tr').length,3);
 assert.match(document.body.textContent,/담당 수업 일정/); assert.match(document.body.textContent,/학교 학사일정/);
 await ui.tab('연결 키'); assert.match(document.body.textContent,/개인 연결 목록이나 처리 결과를 확인하지 못했습니다/);
 assert.doesNotMatch(document.body.textContent,/발급한 개인 읽기 연결이 없습니다/);
 assert.equal(ui.button('새 개인 연결').disabled,true);
 await ui.tab('사용 안내'); assert.match(document.body.textContent,/조회 3개/);
 assert.match(document.body.textContent,/보안 입력란에 직접/); assert.match(document.body.textContent,/401/); assert.match(document.body.textContent,/429·503/);
 assert.equal(ui.rpcCalls.length,1); assert.equal(ui.rpcCalls[0].name,'agent_personal_connection_v1'); assert.equal(ui.fetchCalls.length,0);
});
test('fallback teacher receives no settings or personal metadata',async t=>{
 const ui=await mountApiSettings(t,{auth:{role:'teacher',user:{id:ownerId,isFallbackRole:true}}});
 assert.equal(document.querySelector('[role="tab"]'),null); assert.equal(ui.rpcCalls.length,0);
});
test('synthetic issuance requires purpose, explicit target, scope review and confirmation; secret is never persisted or re-exposed',async t=>{
 const {state,service}=fixture();const ui=await mountApiSettings(t,{auth:{role:'teacher'},personalService:service}); await ui.tab('연결 키');
 await ui.flush(()=>ui.button('새 개인 연결').click());assert.equal(ui.button('범위 확인').disabled,true);
 await ui.flush(()=>ui.button('취소').click());await review(ui);
 assert.match(document.body.textContent,/合成|합성 담당 수업/); assert.match(document.body.textContent,/만료 \(한국 시각\)/);
 assert.equal(ui.button('확인하고 키 발급').disabled,true);assert.equal(state.calls.length,0);
 await confirm(ui);assert.equal(state.calls.length,1);
 assert.deepEqual(state.calls[0].persisted,{requestId:state.calls[0].input.requestId,kind:'issue'});
 assert.deepEqual(state.calls[0].input.schoolIds,[]);assert.deepEqual(state.calls[0].input.classIds,[classId]);
 assert.equal(document.getElementById('personal-secret'),null);
 assert.equal([...Object.values(window.localStorage),...Object.values(window.sessionStorage)].some(value=>String(value).includes(syntheticSecret)),false);
 await ui.flush(()=>ui.button('키 한 번 표시').click());assert.equal(document.getElementById('personal-secret').value,syntheticSecret);
 await ui.flush(()=>ui.button('키 숨기고 닫기').click());assert.equal(document.getElementById('personal-secret'),null);assert.equal(ui.button('키 한 번 표시'),undefined);
 assert.match(document.body.textContent,/합성 일정 읽기/);assert.equal(ui.fetchCalls.length,0);assert.equal(ui.rpcCalls.length,0);
});
test('unknown issuance retains only its request ID and blocks another issue across tab remount; recovery never redisplays the secret',async t=>{
 const {state,service}=fixture();state.mode='unknown';const ui=await mountApiSettings(t,{auth:{role:'teacher'},personalService:service});await ui.tab('연결 키');await review(ui);await confirm(ui);
 assert.match(document.body.textContent,/처리 결과를 확인하지 못했습니다/);assert.doesNotMatch(document.body.textContent,new RegExp(syntheticSecret));
 assert.equal(ui.button('새 개인 연결').disabled,true);assert.equal(state.calls.length,1);
 await ui.tab('사용 안내');await ui.tab('연결 키');assert.equal(ui.button('새 개인 연결').disabled,true);assert.equal(state.calls.length,1);
 state.mode='recovered';await ui.flush(()=>ui.button('처리 결과 확인').click());assert.match(document.body.textContent,/키 원문은 다시 표시하지 않습니다/);
 assert.equal(window.sessionStorage.length,0);assert.equal(ui.button('키 한 번 표시'),undefined);assert.equal(state.calls.length,1);
});
test('account switch hides the old inventory and discards a late issuance secret',async t=>{
 const {state,service}=fixture();state.mode='delayed';const ui=await mountApiSettings(t,{auth:{role:'teacher'},personalService:service});await ui.tab('연결 키');await review(ui);await confirm(ui);
 assert.equal(state.calls.length,1);state.ownerId=id(2);state.items=[];
 await ui.switch({user:{id:id(2),isFallbackRole:false}});await ui.flush(()=>state.resolveIssue());
 assert.equal(ui.button('키 한 번 표시'),undefined);assert.equal(document.getElementById('personal-secret'),null);assert.doesNotMatch(document.body.textContent,/합성 일정 읽기/);
});
test('foreign-owner inventory is rejected instead of rendering or enabling actions',async t=>{
 const {state,service}=fixture();state.ownerId=id(2);const ui=await mountApiSettings(t,{auth:{role:'teacher'},personalService:service});await ui.tab('연결 키');
 assert.match(document.body.textContent,/개인 연결 목록이나 처리 결과를 확인하지 못했습니다/);assert.equal(ui.button('새 개인 연결').disabled,true);
});
test('revoke requires an explicit confirmation and the successful own metadata receipt',async t=>{
 const {state,service}=fixture();const ui=await mountApiSettings(t,{auth:{role:'teacher'},personalService:service});await ui.tab('연결 키');await review(ui);await confirm(ui);await ui.flush(()=>ui.button('닫기').click());
 await ui.flush(()=>ui.button('폐기').click());assert.equal(state.calls.filter(call=>call.kind==='revoke').length,0);
 await ui.flush(()=>document.querySelector('[aria-label="개인 연결 폐기 폐기"]').click());
 assert.equal(state.calls.filter(call=>call.kind==='revoke').length,1);assert.match(document.body.textContent,/폐기됨/);assert.equal(ui.fetchCalls.length,0);
});
test('verified teacher navigation adds API only, preserving business settings and retired menus',()=>{
 const {buildAdminNavGroups}=loadNotificationComponent('src/lib/navigation.ts');
 const groups=buildAdminNavGroups({canManageAll:false,canEditCurriculumPlanning:false,canUsePersonalApiSettings:true});
 const settings=groups.find(group=>group.label==='설정');assert.deepEqual(settings.items[0].items,[{title:'API',url:'/admin/settings/agent-access'}]);
 const all=groups.flatMap(group=>group.items).flatMap(item=>[item,...(item.items??[])]);assert.equal(all.some(item=>item.url==='/admin/ai-agent'),false);
 assert.equal(all.some(item=>item.url==='/admin/settings/schools'),false);
});

test('double click during a delayed issue sends exactly one persisted request and closing cancels only before submission',async t=>{
 const {state,service}=fixture();state.mode='delayed';const ui=await mountApiSettings(t,{auth:{role:'teacher'},personalService:service});await ui.tab('연결 키');await review(ui);
 await ui.flush(()=>document.querySelector('[role="checkbox"]').click());
 await ui.flush(()=>{const button=ui.button('확인하고 키 발급');button.click();button.click();});assert.equal(state.calls.length,1);
 await ui.flush(()=>state.resolveIssue());assert.equal(ui.button('키 한 번 표시')!==undefined,true);
});
test('paged target search retains selections past fifty rows and caps each grant at fifty',async t=>{
 const {service}=fixture();const rows=Array.from({length:61},(_,n)=>({id:id(100+n),name:`합성 수업 ${String(n+1).padStart(2,'0')}`}));
 service.targets=async i=>{const all=i.kind==='classes'?rows.filter(r=>r.name.includes(i.search.trim())):[];return {ownerId,kind:i.kind,search:i.search.trim(),items:all.slice((i.page-1)*i.pageSize,i.page*i.pageSize),total:all.length,page:i.page,pageSize:i.pageSize};};
 const ui=await mountApiSettings(t,{auth:{role:'teacher'},personalService:service});await ui.tab('연결 키');await ui.flush(()=>ui.button('새 개인 연결').click());
 for(let page=1;page<=5;page++){
  const checks=[...document.querySelector('[aria-label="담당 수업 검색 결과"]').querySelectorAll('[role="checkbox"]')];
  for(const c of checks) await ui.flush(()=>c.click());
  const nav=document.querySelector('[aria-label="담당 수업 페이지"]');
  await ui.flush(()=>[...nav.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='다음 페이지').click());
 }
 assert.match(document.body.textContent,/담당 수업 \(50\/50\)/);
 assert.equal([...document.querySelector('[aria-label="담당 수업 검색 결과"]').querySelectorAll('[role="checkbox"]')].every(b=>b.disabled),true);
 await ui.flush(()=>document.querySelector('[aria-label="선택한 담당 수업"] button').click());
 assert.equal(document.querySelector('[aria-label="담당 수업 검색 결과"] [role="checkbox"]').disabled,false);
 await ui.flush(()=>document.querySelector('[aria-label="담당 수업 검색 결과"] [role="checkbox"]').click());
 assert.match(document.querySelector('[aria-label="선택한 담당 수업"]').textContent,/합성 수업 51/);
});
