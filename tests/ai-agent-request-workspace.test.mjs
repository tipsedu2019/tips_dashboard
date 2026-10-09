import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const userId='10000000-0000-4000-8000-000000000001';
const row={id:'20000000-0000-4000-8000-000000000001',requesterId:userId,requesterName:'합성 요청자',title:'이전 계정 요청',body:'본문',status:'pending',version:'1',createdAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-04T02:30:00Z',readyAt:'2026-10-03T00:00:00Z',openQuestionId:null,result:null,notifyOnDone:false,notificationSpace:null};
async function mount(t,{configured=false,strict=false}={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid/admin/ai-agent'});globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.self=dom.window;
 for(const key of ['HTMLElement','HTMLInputElement','HTMLTextAreaElement','Element','DocumentFragment','MutationObserver','CustomEvent','Event','MouseEvent','KeyboardEvent','Node','NodeFilter','DOMRect','getComputedStyle'])globalThis[key]=dom.window[key];
 globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};globalThis.requestAnimationFrame=window.requestAnimationFrame=cb=>window.setTimeout(cb,0);globalThis.cancelAnimationFrame=window.cancelAnimationFrame=window.clearTimeout;window.HTMLElement.prototype.scrollIntoView=()=>{};window.HTMLElement.prototype.getClientRects=function(){return this.hidden?[]:[{width:32,height:32}];};
 let auth={user:{id:userId,name:'합성 요청자',isFallbackRole:false},role:'admin',loading:false,session:{user:{id:userId},access_token:'synthetic'}};
 const reads=[],writes=[];const fetcher=async(url,init)=>{if(url.includes('/spaces'))return new Response(JSON.stringify({data:{items:Array.from({length:7},(_,i)=>({key:`space_${i+1}`,label:['경영팀','관리팀','조교팀','영어팀','전체 공지','수학팀','과학팀'][i],configured:configured && i===0,selectable:configured && i===0,reason:configured && i===0?null:'space_not_configured',revision:'1'}))},error:null}));const pending={...Promise.withResolvers(),url,init};(['POST','PATCH'].includes(init.method)?writes:reads).push(pending);return pending.promise;};
 const routes=[];const router={push:href=>routes.push(href)};
 const Component=loadNotificationComponent('src/features/ai-agent/ai-agent-request-workspace.tsx',new Map([['@/providers/auth-provider',{useAuth:()=>auth}],['@/lib/supabase',{supabase:{auth:{getSession:async()=>({data:{session:auth.session}})},from(){const query={then:cb=>Promise.resolve(cb({data:[{id:userId,name:'합성 요청자',role:'admin'},{id:'10000000-0000-4000-8000-000000000003',name:'권한 없는 직원',role:'viewer'}],error:null}))};for(const method of ['select','order','abortSignal','retry'])query[method]=()=>query;return query;}}}],['next/navigation',{useRouter:()=>router}],['next/link',{__esModule:true,default:({href,children,prefetch,...props})=>createElement('a',{href,...props,'data-prefetch':String(prefetch)},children)}],['@/hooks/use-data-table-page-size',{useDataTablePageSize:()=>({pageSize:10,ready:true,setPreference:()=>{}})}]] )).AiAgentRequestWorkspace;
 const previousFetch=globalThis.fetch;globalThis.fetch=fetcher;const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root'));
 const renderComponent=()=>strict?createElement(StrictMode,null,createElement(Component)):createElement(Component);
 const flush=async(cb)=>act(async()=>{cb?.();await new Promise(resolve=>setTimeout(resolve,30));});await flush(()=>root.render(renderComponent()));
 t.after(async()=>{await flush(()=>root.unmount());globalThis.fetch=previousFetch;dom.window.close();});
 const edit=async(label,value)=>flush(()=>{const field=[...document.querySelectorAll('input,textarea')].find(el=>el.id===document.querySelector(`label[data-test-field="${label}"]`)?.htmlFor||el.name===label);assert.ok(field,`field ${label}`);Object.getOwnPropertyDescriptor(field.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new window.Event('input',{bubbles:true}));field.dispatchEvent(new window.Event('change',{bubbles:true}));});
 const button=name=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===name);
 const accept=index=>flush(()=>reads[index].resolve(new Response(JSON.stringify({data:{items:[row],total:1,page:1,pageSize:10},error:null}))));
 return {reads,writes,flush,edit,button,accept,remount:async()=>{await flush(()=>root.render(null));await flush(()=>root.render(renderComponent()));},switch:async(next)=>flush(()=>{auth={...auth,...next};root.render(renderComponent());}),routes};
}
test('account/role changes synchronously hide accepted and deferred old rows/errors',async t=>{const ui=await mount(t);await ui.accept(0);assert.match(document.body.textContent,/이전 계정 요청/);await ui.switch({role:'teacher'});assert.doesNotMatch(document.body.textContent,/이전 계정 요청/);assert.equal(ui.reads.length,2);await ui.switch({role:'viewer'});await ui.flush(()=>ui.reads[1].reject(new Error('old error')));assert.doesNotMatch(document.body.textContent,/이전 계정 요청|결과를 확인하지|다시 시도/);assert.equal(ui.button('요청 작성'),undefined);});
test('desktop and mobile lists distinguish accepted creation and update timestamps',async t=>{
 const ui=await mount(t);await ui.accept(0);
 assert.equal(document.querySelector('input[aria-label="AI 요청 검색"]').placeholder,'제목 검색');
 const table=document.querySelector('table');
 assert.deepEqual([...table.querySelectorAll('th')].map(cell=>cell.textContent),['제목','상태','요청자','생성일','수정일']);
 const desktopTimes=[...table.querySelectorAll('tbody time')];
 assert.deepEqual(desktopTimes.map(time=>time.dateTime),[row.createdAt,row.updatedAt]);
 assert.deepEqual(desktopTimes.map(time=>time.textContent),['26. 10. 3. 오전 9:00','26. 10. 4. 오전 11:30']);
 const mobileTimes=[...document.querySelectorAll('time')].filter(time=>!table.contains(time));
 assert.deepEqual(mobileTimes.map(time=>time.dateTime),[row.createdAt,row.updatedAt]);
 assert.deepEqual(mobileTimes.map(time=>time.textContent),['생성일 26. 10. 3. 오전 9:00','수정일 26. 10. 4. 오전 11:30']);
 assert.equal(ui.writes.length,0);
});

test('retired request entry stays read-only across refresh and remount', async t => {
 const ui = await mount(t); await ui.accept(0);
 assert.match(document.body.textContent, /이전 요청의 내용과 처리 이력만 조회/);
 assert.equal(ui.button('요청 작성'), undefined);
 assert.equal(document.querySelector('form'), null);
 assert.ok(document.querySelector(`a[href="/admin/ai-agent/${row.id}"]`));
 await ui.flush(() => ui.button('새로고침').click()); await ui.accept(1);
 await ui.remount(); await ui.accept(2);
 assert.equal(ui.writes.length, 0);
 assert.ok(ui.reads.every(read => read.init.method === 'GET'));
});

test('StrictMode remount creates a live request controller and keeps refresh usable', async t => {
 const ui = await mount(t, { strict: true });
 const live = ui.reads.filter(read => !read.init.signal?.aborted);
 assert.ok(live.length > 0, 'a live read must survive StrictMode effect replay');
 await ui.flush(() => { for (const read of live) read.resolve(Response.json({ data: { items: [row], total: 1, page: 1, pageSize: 10 }, error: null })); });
 assert.match(document.body.textContent, /이전 계정 요청/);
 const before = ui.reads.length; await ui.flush(() => ui.button('새로고침').click());
 assert.equal(ui.reads.length, before + 1); await ui.accept(before);
 assert.match(document.body.textContent, /이전 계정 요청/); assert.equal(ui.writes.length, 0);
});
