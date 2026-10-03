import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {act,createElement,useState} from 'react';import {loadNotificationComponent} from './helpers/notification-component-loader.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const userId='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
const credential={id,label:'synthetic',scopes:['ai-agent:requests:read'],grant:{queues:['employee_requests'],actions:['read']},expiresAt:'2026-10-04T00:00:00Z',token:'tips_agent_'+'a'.repeat(64)};
async function mount(t,{support=true,renderFixture}={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid/admin/settings/agent-access'});globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.self=dom.window;
 for(const key of ['HTMLElement','HTMLInputElement','HTMLTextAreaElement','Element','DocumentFragment','MutationObserver','CustomEvent','Event','MouseEvent','KeyboardEvent','Node','NodeFilter','DOMRect','getComputedStyle'])globalThis[key]=dom.window[key];
 globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};globalThis.requestAnimationFrame=window.requestAnimationFrame=cb=>window.setTimeout(cb,0);globalThis.cancelAnimationFrame=window.cancelAnimationFrame=window.clearTimeout;window.HTMLElement.prototype.scrollIntoView=()=>{};window.HTMLElement.prototype.getClientRects=function(){return this.hidden?[]:[{width:32,height:32}];};
 let auth={user:{id:userId,isFallbackRole:false,name:'합성 관리자'},role:'admin',loading:false,session:{user:{id:userId},access_token:'fixture'}};
 const oldFetch=globalThis.fetch,oldUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.invalid';const writes=[];
 globalThis.fetch=async(url,init)=>{if(url.includes('/spaces'))return Response.json({data:{items:Array.from({length:7},(_,i)=>({key:`space_${i+1}`,label:`공간 ${i+1}`,configured:i===0,selectable:i===0,reason:i?'space_not_configured':null,revision:'1'}))},error:null});const args=JSON.parse(init.body);if(args.p_action==='list')return Response.json({items:[],total:0,supportEnabled:support});const pending=Promise.withResolvers();writes.push({...pending,args});return pending.promise;};
 const {AiAgentCredentialWorkspace}=loadNotificationComponent('src/features/ai-agent/ai-agent-credential-issue-dialog.tsx',new Map([['@/providers/auth-provider',{useAuth:()=>auth}],['@/lib/supabase',{supabase:{auth:{getSession:async()=>({data:{session:auth.session},error:null})}}}]]));
 const Component=renderFixture?renderFixture(loadNotificationComponent):AiAgentCredentialWorkspace;
 const {createRoot}=await import('react-dom/client');let root=createRoot(document.getElementById('root'));const flush=async fn=>{await act(async()=>{fn?.();await new Promise(r=>setTimeout(r,0));});};await flush(()=>root.render(createElement(Component)));
 t.after(async()=>{await flush(()=>root.unmount());globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=oldUrl;dom.window.close();});
 const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text);
 return {writes,flush,button,async edit(value){await flush(()=>{const input=document.querySelector('#ai-credential-label');Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new window.Event('input',{bubbles:true}));});},async switch(next){auth={...auth,...next,user:next.user??auth.user};auth.session={user:{id:auth.user.id},access_token:'fixture'};await flush(()=>root.render(createElement(Component)));},async remount(){await flush(()=>root.unmount());root=createRoot(document.getElementById('root'));await flush(()=>root.render(createElement(Component)));}};
}
test('off support presents inventory and disables issuance independently of legacy flag',async t=>{const ui=await mount(t,{support:false});assert.equal(ui.button('AI 요청 키 발급').disabled,true);assert.ok(document.body.textContent.includes('AI 요청 키 발급 준비 중'));assert.equal(ui.writes.length,0);});
test('first issuance defaults read-only one day and has no Chat/domain grants; raw secret cleared on role boundary',async t=>{const ui=await mount(t);await ui.flush(()=>ui.button('AI 요청 키 발급').click());await ui.flush(()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(ui.writes.length,1);const payload=ui.writes[0].args.p_input;assert.deepEqual(payload.scopes,['ai-agent:requests:read']);assert.deepEqual(payload.grant,{queues:['employee_requests'],actions:['read']});assert.ok(new Date(payload.expiresAt)-Date.now()>23*3600000);await ui.flush(()=>ui.writes[0].resolve(Response.json(credential)));assert.equal(document.querySelector('input[aria-label="발급된 AI 요청 키"]').value,credential.token);await ui.switch({role:'viewer'});assert.equal(document.body.textContent.includes(credential.token),false);assert.equal(document.querySelector('input[aria-label="발급된 AI 요청 키"]'),null);});
test('dialog dismissal and late account-switch issue response never reveal old raw key',async t=>{const ui=await mount(t);await ui.flush(()=>ui.button('AI 요청 키 발급').click());await ui.flush(()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));await ui.flush(()=>document.querySelector('[data-slot="dialog-close"]').click());await ui.flush(()=>ui.writes[0].resolve(Response.json(credential)));assert.equal(document.querySelector('input[aria-label="발급된 AI 요청 키"]'),null);await ui.flush(()=>ui.button('AI 요청 키 발급').click());await ui.flush(()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));await ui.switch({user:{id:'10000000-0000-4000-8000-000000000002',isFallbackRole:false}});await ui.flush(()=>ui.writes[1].resolve(Response.json(credential)));assert.equal(document.querySelector('input[aria-label="발급된 AI 요청 키"]'),null);});
test('ambiguous create survives remount and reuses exact key/payload; metadata-only replay has no secret',async t=>{const ui=await mount(t);await ui.flush(()=>ui.button('AI 요청 키 발급').click());await ui.flush(()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));const first=ui.writes[0];await ui.flush(()=>first.reject(new Error('uncertain')));await ui.remount();await ui.flush(()=>ui.button('발급 결과 확인').click());await ui.edit('newer draft');await ui.flush(()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));assert.deepEqual(ui.writes[1].args,first.args);await ui.flush(()=>ui.writes[1].resolve(Response.json({...credential,token:null})));assert.equal(document.querySelector('input[aria-label="발급된 AI 요청 키"]'),null);assert.ok(document.body.textContent.includes('원문 키는 다시 표시할 수 없습니다'));});
for(const dismissal of ['Close','Escape']){
 test(`first-token dialog ${dismissal} restores focus to the issuance control`,async t=>{
  const ui=await mount(t);const opener=ui.button('AI 요청 키 발급');
  await ui.flush(()=>{opener.focus();opener.click();});
  await ui.flush(()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  await ui.flush(()=>ui.writes[0].resolve(Response.json(credential)));
  assert.ok(document.querySelector('input[aria-label="발급된 AI 요청 키"]'));
  await ui.flush(()=>dismissal==='Close'?ui.button('닫기').click():document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  await ui.flush();await ui.flush();
  assert.equal(document.querySelector('input[aria-label="발급된 AI 요청 키"]'),null);
  assert.equal(document.activeElement===opener,true,'issuance control must regain focus after the form-to-secret dialog transition');
 });
}
for(const dismissal of ['Close','Escape']){
 test(`shared sibling detail ${dismissal} keeps automatic opener restoration without an explicit ref`,async t=>{
  const ui=await mount(t,{renderFixture:load=>{
    const {Dialog}=load('src/components/ui/dialog.tsx');const {DetailDialogContent}=load('src/components/ui/form-dialog.tsx');
    return function SiblingDetail(){const [open,setOpen]=useState(false);return createElement('div',null,
      createElement('button',{onClick:()=>setOpen(true)},'교재 상세 열기'),
      createElement(Dialog,{open,onOpenChange:setOpen},createElement(DetailDialogContent,{title:'교재 상세',description:'합성 형제 화면',onClose:()=>setOpen(false)},createElement('p',null,'합성 상세'))));};
  }});
  const opener=ui.button('교재 상세 열기');await ui.flush(()=>{opener.focus();opener.click();});
  assert.ok(document.querySelector('[role="dialog"]'));
  await ui.flush(()=>dismissal==='Close'?ui.button('닫기').click():document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  await ui.flush();await ui.flush();assert.equal(document.querySelector('[role="dialog"]'),null);
  assert.equal(document.activeElement===opener,true,'default sibling opener restoration must remain intact');
 });
}
