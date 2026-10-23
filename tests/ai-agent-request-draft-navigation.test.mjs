import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const userId='10000000-0000-4000-8000-000000000001',requestId='20000000-0000-4000-8000-000000000001',questionId='40000000-0000-4000-8000-000000000001';
const request={id:requestId,requesterId:userId,requesterName:'합성 직원',title:'합성 질문',body:'긴 요청 내용\n두 번째 줄',status:'question',version:'3',createdAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z',readyAt:'2026-10-03T00:00:00Z',openQuestionId:questionId,result:null,notifyOnDone:false,notificationSpace:null};
const question={id:questionId,requestId,seq:'1',kind:'question',text:'열린 질문',authorKind:'bot',authorId:'50000000-0000-4000-8000-000000000001',questionId:null,createdAt:'2026-10-03T00:00:00Z'};
const action={id:'60000000-0000-4000-8000-000000000001',requestId,credentialId:'50000000-0000-4000-8000-000000000001',actionKey:'70000000-0000-4000-8000-000000000001',stepKey:'이전 계정 작업',kind:'local_review',target:'합성 검수',payload:{synthetic:true},payloadHash:'a'.repeat(64),generation:'1',revision:'3',state:'succeeded',createdAt:request.createdAt,updatedAt:request.updatedAt};
async function mount(t,{terminal=false,deferred=false,resume=false,journalDeferred=false,role}={}){
 const dom=new JSDOM('<div id="root"></div><a href="/admin/ai-agent">목록 링크</a>',{url:`https://test.invalid/admin/ai-agent/${requestId}`});globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.self=dom.window;
 for(const key of ['HTMLElement','HTMLInputElement','HTMLTextAreaElement','Element','DocumentFragment','MutationObserver','CustomEvent','Event','MouseEvent','KeyboardEvent','Node','NodeFilter','DOMRect','getComputedStyle'])globalThis[key]=dom.window[key];
 globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};globalThis.requestAnimationFrame=window.requestAnimationFrame=cb=>window.setTimeout(cb,0);globalThis.cancelAnimationFrame=window.cancelAnimationFrame=window.clearTimeout;window.HTMLElement.prototype.scrollIntoView=()=>{};window.HTMLElement.prototype.getClientRects=function(){return this.hidden?[]:[{width:32,height:32}];};
 const traversals=[],routes=[],reads=[],writes=[],journals=[],fetches=[];let currentRequest=terminal?{...request,status:'done',openQuestionId:null,result:'처리 결과'}:resume?{...request,status:'processing',openQuestionId:null}:request;window.navigation=Object.assign(new window.EventTarget(),{traverseTo:key=>{traversals.push(key);return{committed:Promise.resolve(),finished:Promise.resolve()};}});
 let auth={user:{id:userId,name:'합성 직원',isFallbackRole:false},role:role??(resume?'admin':'staff'),loading:false,session:{user:{id:userId},access_token:'synthetic'}};
 const fetcher=async(url,init)=>{fetches.push({url,init});if(init.method==='POST'){const pending={...Promise.withResolvers(),url,init};writes.push(pending);return pending.promise;}if(url.includes('/actions/')){const pending={...Promise.withResolvers(),url,init};journals.push(pending);return pending.promise;}if(url.includes('/actions?'))return Response.json({data:{items:journalDeferred?[action]:[],nextCursor:null},error:null});if(auth.user.id!==userId)return Response.json({data:null,error:{code:'ai_agent_forbidden'}},{status:403});const pending={...Promise.withResolvers(),url,init};reads.push(pending);if(!deferred)pending.resolve(new Response(JSON.stringify({data:{request:currentRequest,claim:null,messages:[question],events:[],actions:[],notification:null,nextMessageSeq:null,nextEventSeq:null},error:null})));return pending.promise;};
 const Component=loadNotificationComponent('src/features/ai-agent/ai-agent-request-detail.tsx',new Map([['@/providers/auth-provider',{useAuth:()=>auth}],['@/lib/supabase',{supabase:{auth:{getSession:async()=>({data:{session:auth.session}})}}}],['next/navigation',{useRouter:()=>({push:href=>routes.push(href)})}],['next/link',({href,children,prefetch,...props})=>createElement('a',{href,...props,'data-prefetch':String(prefetch)},children)]] )).AiAgentRequestDetail;
 const oldFetch=globalThis.fetch;globalThis.fetch=fetcher;const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root'));const flush=async(cb)=>act(async()=>{cb?.();await new Promise(resolve=>setTimeout(resolve,30));});await flush(()=>root.render(createElement(Component,{id:requestId})));
 t.after(async()=>{await flush(()=>root.unmount());globalThis.fetch=oldFetch;dom.window.close();});
 const button=name=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===name);
 const edit=async(value)=>flush(()=>{const field=document.querySelector('textarea[name="message"]');Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(field,value);field.dispatchEvent(new window.Event('input',{bubbles:true}));field.dispatchEvent(new window.Event('change',{bubbles:true}));});
 return {flush,button,edit,traversals,routes,reads,writes,journals,fetches,setRequest:value=>{currentRequest=value;},remount:async()=>{await flush(()=>root.render(null));await flush(()=>root.render(createElement(Component,{id:requestId})));},switch:async(next)=>flush(()=>{auth={...auth,...next};root.render(createElement(Component,{id:requestId}));})};
}
test('assistant legacy detail is denied before any detail/action GET or POST',async t=>{
 const ui=await mount(t,{role:'assistant',journalDeferred:true});
 assert.match(document.body.textContent,/접근할 권한이 없습니다/);
 assert.doesNotMatch(document.body.textContent,/합성 질문|긴 요청 내용|열린 질문|이전 계정 작업|읽기 전용 이력/);
 assert.equal(document.querySelector('form,textarea'),null);
 assert.equal(ui.button('새로고침'),undefined);
 assert.equal(ui.button('기록 조회'),undefined);
 assert.equal(ui.reads.length,0,'denied assistant must not fetch request detail');
 assert.equal(ui.journals.length,0,'denied assistant must not fetch an action journal');
 assert.equal(ui.fetches.filter(({init})=>init.method==='GET').length,0,'denied assistant must not issue any GET');
 assert.equal(ui.fetches.filter(({url})=>url.includes('/actions')).length,0,'denied assistant must not fetch the action list or detail');
 assert.equal(ui.writes.length,0,'denied assistant must not queue a POST');
 assert.equal(ui.fetches.filter(({init})=>init.method==='POST').length,0,'denied assistant must not issue any POST');
 assert.equal(ui.fetches.length,0,'denial must happen before the transport boundary');
});
test('terminal request never offers append or cancellation',async t=>{await mount(t,{terminal:true});assert.equal(document.querySelector('textarea[name="message"]'),null);assert.equal([...document.querySelectorAll('button')].some(el=>el.textContent==='요청 취소'),false);});
test('late detail errors are ignored after same-account role denial',async t=>{const ui=await mount(t,{deferred:true});assert.equal(ui.reads.length,1);await ui.switch({role:'viewer'});await ui.flush(()=>ui.reads[0].reject(new Error('old-detail-error')));assert.doesNotMatch(document.body.textContent,/합성 질문|결과를 확인하지|old-detail-error/);assert.match(document.body.textContent,/접근할 권한이 없습니다/);});
for (const options of [{}, { resume: true }, { terminal: true }]) test(`legacy detail retains its ID and history without mutation controls ${JSON.stringify(options)}`, async t => {
 const ui = await mount(t, options);
 assert.match(document.body.textContent, /읽기 전용 이력/);
 assert.match(document.body.textContent, /열린 질문/);
 assert.equal(document.querySelector('form,textarea'), null);
 assert.equal(ui.button('요청 재개'), undefined);
 assert.equal(ui.button('요청 취소'), undefined);
 assert.ok(document.querySelector('a[href="/admin/ai-agent"]'));
 await ui.flush(() => ui.button('새로고침').click());
 assert.equal(ui.writes.length, 0);
 assert.ok(ui.reads.every(read => read.url.includes(requestId) && read.init.method === 'GET'));
});

test('allowed account A to B hides accepted detail and ignores a delayed A journal', async t => {
 const ui = await mount(t, { journalDeferred: true });
 assert.match(document.body.textContent, /긴 요청 내용/);
 await ui.flush(() => ui.button('기록 조회').click()); assert.equal(ui.journals.length, 1);
 const nextId = '10000000-0000-4000-8000-000000000002';
 await ui.switch({ user: { id: nextId, name: '다른 직원', isFallbackRole: false }, session: { user: { id: nextId }, access_token: 'synthetic-next' } });
 assert.doesNotMatch(document.body.textContent, /긴 요청 내용|이전 계정 작업/);
 await ui.flush(() => ui.journals[0].resolve(Response.json({ data: { action, events: [{ id:'80000000-0000-4000-8000-000000000001',actionId:action.id,seq:'1',kind:'result',actorKind:'bot',actorId:action.credentialId,evidence:{observation:'이전 계정의 지연 기록'},createdAt:request.createdAt }], nextCursor:null }, error:null })));
 assert.doesNotMatch(document.body.textContent, /긴 요청 내용|이전 계정 작업|이전 계정의 지연 기록/);
 assert.equal(ui.writes.length, 0);
});
