import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';

async function setup(t) {
  const dom = new JSDOM('<div id="root"></div>', {url:'https://test.invalid/admin/settings/notifications'});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  for (const key of ['HTMLElement','Element','MutationObserver','CustomEvent','Event','Node','NodeFilter','DocumentFragment','HTMLInputElement','KeyboardEvent']) globalThis[key]=dom.window[key];
  globalThis.getComputedStyle = window.getComputedStyle;
  globalThis.ResizeObserver = class {observe(){} unobserve(){} disconnect(){}};
  window.matchMedia = media => ({media,matches:false,addEventListener(){},removeEventListener(){}});
  globalThis.requestAnimationFrame = window.requestAnimationFrame = fn => window.setTimeout(fn,0);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame = window.clearTimeout;
  window.HTMLElement.prototype.scrollIntoView=()=>{};
  const {createRoot}=await import('react-dom/client');
  const root=createRoot(document.getElementById('root'));
  const originalFetch=globalThis.fetch;
  t.after(async()=>{await React.act(async()=>root.unmount());globalThis.fetch=originalFetch;dom.window.close()});
  const render = async node => React.act(async()=>root.render(node));
  const settle = async()=>React.act(async()=>{await new Promise(r=>setTimeout(r,25))});
  return {render,settle};
}
const button = text => [...document.querySelectorAll('button')].find(n=>n.textContent.trim()===text);
const key = async (node,value)=>React.act(async()=>{node.focus();node.dispatchEvent(new window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}))});

for(const state of ['unavailable','disabled']) test(`customer guidance stays reachable when staff channel is ${state}, without sends`,async t=>{
  const p=await setup(t), calls=[];
  const supabase={auth:{async getSession(){return {data:{session:{}},error:null}}},async rpc(name){calls.push(name);return name==='common_notification_control_plane_runtime_version'?{data:1,error:null}:state==='disabled'?{data:{flags:{notification_control_plane_settings_ui_enabled:{enabled:false}}},error:null}:{data:null,error:{message:'Synthetic private error'}}}};
  const {NotificationSettingsWorkspace}=loadNotificationComponent('src/features/notifications/notification-settings-workspace.tsx',new Map([['@/lib/supabase',{supabase}]]));
  await p.render(React.createElement(NotificationSettingsWorkspace,{customerGuidance:React.createElement('input',{'aria-label':'고객 안내 설정'})}));
  await p.settle();
  let tabs=[...document.querySelectorAll('[role=tab]')];
  assert.equal(tabs.length,2);
  await key(tabs[0],'ArrowRight');
  assert.equal(tabs[0].getAttribute('aria-selected'),'true','arrows only move focus');
  await key(tabs[1],'Enter');
  assert.ok(document.querySelector('input[aria-label="고객 안내 설정"]'));
  assert.equal(document.querySelector('[role=alert]'),null,'staff failure does not cover customer channel');
  await key(tabs[0],'Enter');
  if(state==='unavailable') {
    await React.act(async()=>button('다시 불러오기').click());
    await p.settle();
    assert.equal(calls.length,4,'retry checks only the two capability reads');
  }
  assert.ok(calls.every(name=>['get_notification_runtime_flags_v1','common_notification_control_plane_runtime_version'].includes(name)),'no send or write RPC');
});

test('public content tabs retain the panel and only fetch on manual activation',async t=>{
  const p=await setup(t),calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({entries:[],totalCount:0})}};
  const {PublicContentWorkspace}=loadNotificationComponent('src/features/public-content/public-content-workspace.tsx', new Map([['next/navigation', {useRouter:()=>({push(){}})}]]));
  await p.render(React.createElement(PublicContentWorkspace,{accessToken:'fixture'}));await p.settle();
  const tabs=[...document.querySelectorAll('[role=tab]')],initial=calls.length;
  const controlled=()=>document.getElementById(document.querySelector('[role=tab][aria-selected=true]').getAttribute('aria-controls'));
  assert.equal(controlled()?.getAttribute('role'),'tabpanel');
  await key(tabs[0],'ArrowRight');await p.settle();
  assert.equal(calls.length,initial);
  assert.equal(tabs[0].getAttribute('aria-selected'),'true');
  await key(tabs[1],'Enter');await p.settle();
  assert.equal(calls.length,initial+1);
  assert.match(calls.at(-1).url,/kind=review/);
  assert.equal(controlled()?.getAttribute('role'),'tabpanel');
  assert.equal(document.activeElement,tabs[1]);
});

test('deleting the last recruiting row restores focus to refresh after the opener disappears',async t=>{
  const p=await setup(t);let deleted=false;const requests=[];
  const record={id:'synthetic',name:'합성 지원자',subject:'영어',phone:'010-0000-0000',createdAt:'2026-09-22T00:00:00Z',expiresAt:'2026-12-22T00:00:00Z',consentedAt:'2026-09-22T00:00:00Z',retentionDays:90,consentVersion:'fixture',experience:'합성 경력',motivation:'합성 동기',portfolioUrl:null};
  globalThis.fetch=async(url,options)=>{requests.push({url,options});if(options.method==='DELETE'){deleted=true;return {ok:true}}return {ok:true,json:async()=>url.includes('?')?{applications:deleted?[]:[record],totalCount:deleted?0:1,retentionLastSucceededAt:new Date().toISOString()}:{application:record}}};
  const {RecruitingInbox}=loadNotificationComponent('src/features/recruiting/recruiting-inbox.tsx');
  await p.render(React.createElement(RecruitingInbox,{accessToken:'fixture'}));await p.settle();
  const opener=document.querySelector('li button');
  await React.act(async()=>{opener.focus();opener.click()});await p.settle();
  await React.act(async()=>button('삭제 요청 처리').click());
  await React.act(async()=>button('지원서 영구 삭제').click());await p.settle();
  assert.equal(document.querySelector('[role=dialog]'),null);
  assert.equal(opener.isConnected,false);
  assert.equal(document.activeElement,button('새로고침'));
  assert.match(document.body.textContent,/보관 중인 지원서가 없습니다/);
  assert.equal(requests.filter(r=>r.options.method==='DELETE').length,1);
});
