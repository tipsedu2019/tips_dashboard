import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement, useState } from 'react';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const session={sessionAuthority:'normalized',classLessonSessionId:'session-a',startsAt:'2026-09-20T09:00:00Z',endsAt:'2026-09-20T10:00:00Z',teacherName:'합성 교사',teacherProfileId:'teacher',classroomCatalogId:'room',classroomName:'본관',campus:'본관',textbooks:[],progress:''};
const detail={observationId:'observation-a',taskId:'task-a',trackId:'track-a',classId:'class-a',className:'합성 수업',teacherName:'합성 교사',status:'attended_feedback_pending',attendance:'attended',decisionKind:null,revision:1,feedbackRevision:1,trackWorkflowRevision:1,appointmentNotificationRevision:1};
async function mount(t,kind){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid/admin/registration'});globalThis.window=dom.window;globalThis.document=dom.window.document;
 for(const key of ['HTMLElement','Element','DocumentFragment','MutationObserver','CustomEvent','Event','Node','NodeFilter','HTMLInputElement','getComputedStyle'])globalThis[key]=dom.window[key];
 globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};globalThis.requestAnimationFrame=window.requestAnimationFrame=fn=>window.setTimeout(fn,0);globalThis.cancelAnimationFrame=window.cancelAnimationFrame=window.clearTimeout;window.HTMLElement.prototype.scrollIntoView=()=>{};window.HTMLElement.prototype.getClientRects=()=>[{width:30,height:30}];
 window.navigation=Object.assign(new window.EventTarget(),{traverseTo:()=>({committed:Promise.resolve(),finished:Promise.resolve()})});
 const routes=[],writes=[],router={push:href=>routes.push(href)};const overrides=new Map([['next/navigation',{useRouter:()=>router}]]);
 const {useDraftNavigation}=loadNotificationComponent('src/hooks/use-draft-navigation.tsx',overrides);
 const {RegistrationObservationEditor}=loadNotificationComponent('src/features/tasks/registration-observation-editor.tsx',overrides);
 const {RegistrationObservationFeedbackPanel}=loadNotificationComponent('src/features/tasks/registration-observation-feedback-panel.tsx',overrides);
 const {requestAppNavigation}=loadNotificationComponent('src/lib/guarded-navigation.ts');
 const actions={loadRegistrationObservationSessions:async()=>[session],saveRegistrationObservationBooking:()=>{const r=Promise.withResolvers();writes.push(r);return r.promise;},cancelRegistrationObservation:()=>{throw Error('unexpected cancel')},recordRegistrationObservationAttendance:()=>{throw Error('unexpected attendance')},decideRegistrationObservation:()=>{const r=Promise.withResolvers();writes.push(r);return r.promise;}};
 let currentProps={},mountKey=0;
 function Host(){const [dirty,setDirty]=useState(false);const guard=useDraftNavigation({dirty});return createElement('div',{'data-dirty':String(dirty)},guard.confirmation,kind==='booking'?createElement(RegistrationObservationEditor,{key:mountKey,trackId:'track-a',workflowRevision:1,observationRevision:null,appointmentNotificationRevision:null,detail:{currentObservation:null,attempts:[],classes:[{id:'class-a',name:'합성 수업'}]},actions,onSaved:async()=>{},onDirtyChange:setDirty,...currentProps}):createElement(RegistrationObservationFeedbackPanel,{key:mountKey,detail,canRecordAttendance:false,canDecide:true,actions,onSaved:async()=>{},onReload:async()=>{},onDirtyChange:setDirty,...currentProps}));}
 const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root'));const flush=async(fn)=>act(async()=>{fn?.();await new Promise(r=>setTimeout(r,25));});await flush(()=>root.render(createElement(Host)));t.after(async()=>{await flush(()=>root.unmount());dom.window.close();});
 function selectProps(label){const container=document.getElementById('root'),fiber=container[Object.keys(container).find(k=>k.startsWith('__reactContainer'))].stateNode.current;function find(n){if(!n)return null;if(n.type?.name==='RegistrationSelect'&&(!label||n.memoizedProps['aria-label']===label))return n.memoizedProps;return find(n.child)||find(n.sibling);}const p=find(fiber);assert.ok(p);return p;}
 return {writes,routes,flush,change:(value,label)=>flush(()=>selectProps(label).onValueChange(value)),app:()=>flush(()=>requestAppNavigation(()=>routes.push('/admin/dashboard'))),dirty:()=>document.querySelector('[data-dirty]').dataset.dirty,confirmation:()=>document.querySelector('[data-testid="draft-navigation-confirm-dialog"]'),button:label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label),render:async(p={},remount=false)=>{currentProps=p;if(remount)mountKey++;await flush(()=>root.render(createElement(Host)));}};
}
for(const kind of ['booking','decision'])test(`${kind}: actual child reports a draft to navigation and cancellation preserves its value`,async t=>{const ui=await mount(t,kind);assert.equal(ui.dirty(),'false');await ui.change(kind==='booking'?'class-a':'waiting_current_class',kind==='booking'?'청강 반':undefined);assert.equal(ui.dirty(),'true');await ui.app();assert.ok(ui.confirmation());assert.equal(ui.routes.length,0);await ui.flush(()=>ui.button('계속 편집').click());assert.equal(ui.dirty(),'true');await ui.change('',kind==='booking'?'청강 반':undefined);assert.equal(ui.dirty(),'false');});
for(const kind of ['booking','decision'])test(`${kind}: failed save keeps the draft and accepted retry clears its ownership`,async t=>{
 const ui=await mount(t,kind);await ui.change(kind==='booking'?'class-a':'waiting_current_class',kind==='booking'?'청강 반':undefined);
 if(kind==='booking')await ui.change('normalized:session-a','청강 회차');
 const save=async()=>{if(kind==='booking'){await ui.flush(()=>ui.button('청강 예약 저장').click());await ui.flush(()=>[...document.querySelectorAll('button')].findLast(b=>b.textContent==='청강 예약 저장').click());}else await ui.flush(()=>ui.button('결정 저장').click());};
 await save();assert.equal(ui.writes.length,1);assert.equal(ui.dirty(),'true');await ui.flush(()=>ui.writes[0].reject(new Error('synthetic failed write')));assert.equal(ui.dirty(),'true');
 await ui.app();assert.ok(ui.confirmation());await ui.flush(()=>ui.button('계속 편집').click());
 if(kind==='booking')await ui.flush(()=>[...document.querySelectorAll('button')].findLast(b=>b.textContent==='청강 예약 저장').click());else await save();
 assert.equal(ui.writes.length,2);await ui.flush(()=>ui.writes[1].resolve(kind==='booking'?{changed:true,observation:null,appointment:null}:{...detail,decisionKind:'waiting_current_class'}));assert.equal(ui.dirty(),'false');await ui.app();assert.deepEqual(ui.routes,['/admin/dashboard']);
});
for(const kind of ['booking','decision'])test(`${kind}: a former child's response cannot clear the next child's draft`,async t=>{
 const ui=await mount(t,kind);await ui.change(kind==='booking'?'class-a':'waiting_current_class',kind==='booking'?'청강 반':undefined);
 if(kind==='booking'){await ui.change('normalized:session-a','청강 회차');await ui.flush(()=>ui.button('청강 예약 저장').click());await ui.flush(()=>[...document.querySelectorAll('button')].findLast(b=>b.textContent==='청강 예약 저장').click());}else await ui.flush(()=>ui.button('결정 저장').click());
 assert.equal(ui.writes.length,1);await ui.render({},true);assert.equal(ui.dirty(),'false');await ui.change(kind==='booking'?'class-a':'not_registered',kind==='booking'?'청강 반':undefined);assert.equal(ui.dirty(),'true');await ui.flush(()=>ui.writes[0].resolve(kind==='booking'?{changed:true,observation:null,appointment:null}:{...detail,decisionKind:'waiting_current_class'}));assert.equal(ui.dirty(),'true');await ui.app();assert.ok(ui.confirmation());
});
