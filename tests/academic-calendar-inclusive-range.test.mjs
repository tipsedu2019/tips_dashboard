import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createOperationsReadService } from "../src/features/operations/operations-read-service.js";
import { adaptAcademicEventDetailToCalendarEvent, buildAcademicEventMutationPayload, extractAcademicEventNoteMetadata } from "../src/features/operations/academic-event-utils.js";
import { eventSpansDay, buildMonthEventSegments } from "../src/app/admin/calendar/utils/calendar-grid.js";
const fixture = JSON.parse(await readFile(new URL('./fixtures/academic-calendar-inclusive-range-sql-output.json',import.meta.url),'utf8'));

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://test.invalid/admin/academic-calendar", pretendToBeVisual: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const name of ["window", "self", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "NodeFilter", "DocumentFragment", "Event", "CustomEvent", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
window.HTMLElement.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};
window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

function chain(data) { const q={limit(){return q},abortSignal(){return q},retry(value){assert.equal(value,false);return Promise.resolve({data,error:null})}};return q }
const calls=[];
const client={rpc(name,args){calls.push({name,args}); if(name==='get_operations_calendar_range_v1') return chain(fixture.calendar);if(name==='get_academic_event_detail_v1')return chain(fixture.details.find(d=>d.id===args.p_event_id));throw Error(name)}};
const service=createOperationsReadService({supabase:client,actorScope:'synthetic-calendar-admin'});
const day=key=>new Date(`${key}T12:00:00`);
async function mount(t,component,props){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>root.render(createElement(component,props)));t.after(async()=>{await act(async()=>root.unmount());host.remove()});return host}
const mocks=new Map([['next/navigation',{useRouter:()=>({push(){}})}],['sonner',{toast:{error(){},success(){}}}]]);
test('actual isolated SQL producer matches committed migration',async()=>{const sql=await readFile(new URL('../supabase/migrations/20261007013509_operations_calendar_inclusive_range.sql',import.meta.url));assert.equal(createHash('sha256').update(sql).digest('hex'),fixture.provenance.migrationSha256);assert.equal(fixture.calendar.ok,true);assert.ok(fixture.calendar.rows.length>0)});
test('SQL RPC → real service → calendar segments keeps inclusive dates and separate grade identities',async()=>{
 const response=await service.load({mode:'calendar',...fixture.calendar.range});
 for(const id of ['000000000001','000000000013']){const detail=await service.loadEventDetail('93991000-0000-4000-8000-'+id);const row=response.rows.find(r=>r.id===detail.id);assert.equal(row.sourceId,detail.id);assert.equal(row.endsAt,detail.endsAt);assert.equal(row.grade,detail.grade)}
 const multi=adaptAcademicEventDetailToCalendarEvent(await service.loadEventDetail('93991000-0000-4000-8000-000000000001'));
 for(const key of ['2196-10-06','2196-10-07','2196-10-08'])assert.equal(eventSpansDay(multi,day(key)),true);
 assert.equal(eventSpansDay(multi,day('2196-10-09')),false);
 const days=Array.from({length:7},(_,i)=>day(`2196-10-${String(2+i).padStart(2,'0')}`));assert.equal(buildMonthEventSegments(days,[multi])[0].span,3);
});
for(const width of [1440,390]) test(`actual Calendar renders multi-day bar and bounded long range at ${width}px (DOM coverage)`,async t=>{
 Object.defineProperty(window,'innerWidth',{configurable:true,value:width});
 window.matchMedia=query=>({matches:width<640&&query.includes('max-width'),media:query,addEventListener(){},removeEventListener(){}});
 const {Calendar}=loadNotificationComponent('src/app/admin/calendar/components/calendar.tsx',mocks);
 const events=fixture.details.filter(d=>['000000000001','000000000013','000000000014'].some(s=>d.id.endsWith(s))).map(adaptAcademicEventDetailToCalendarEvent);
 const host=await mount(t,Calendar,{events,eventDates:[],calendars:[],initialDate:day('2196-10-06'),readOnly:true});
 assert.ok(host.textContent.includes('inclusive range'));const buttons=[...host.querySelectorAll('button')].filter(b=>b.textContent.includes('inclusive range'));assert.ok(buttons.some(b=>/3\s*\*\s*\(14\.2857%\)/.test(b.parentElement.style.width) || Math.abs(parseFloat(b.parentElement.style.width.match(/[0-9.]+(?=%)/)?.[0] || '0')-300/7)<0.01),JSON.stringify(buttons.map(b=>b.parentElement.style.width)));assert.equal(events.find(e=>e.title==='long range').endDate.getFullYear(),9999,'clipping preserves canonical end');
});
for(const suffix of ['000000000001','000000000013','000000000014'])test(`exact SQL detail → actual EventForm unchanged save preserves end and identity (${suffix})`,async t=>{
 const detail=await service.loadEventDetail('93991000-0000-4000-8000-'+suffix);const event=adaptAcademicEventDetailToCalendarEvent(detail);const saves=[];
 const {EventForm}=loadNotificationComponent('src/app/admin/calendar/components/event-form.tsx',mocks);
 await mount(t,EventForm,{open:true,event,schoolOptions:[{id:detail.schoolId,name:detail.schoolName,category:'high'}],onOpenChange(){},onSave:data=>{saves.push(data);return true}});
 assert.equal(document.querySelector('#date').value,detail.startsAt);assert.equal(document.querySelector('#end-date').value,detail.endsAt);
 const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='변경 저장');assert.ok(button);await act(async()=>button.click());assert.equal(saves.length,1);const saved=saves[0];
 const key=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const result=buildAcademicEventMutationPayload({id:saved.id,title:saved.title,type:saved.typeLabel,schoolId:saved.schoolId,start:key(saved.date),end:key(saved.endDate),grade:saved.grade,note:saved.note},[{id:detail.schoolId,name:detail.schoolName,category:'high'}]);assert.equal(result.isValid,true);assert.equal(result.payload.id,detail.id);assert.equal(result.payload.grade,detail.grade);assert.equal(result.payload.end,detail.endsAt);assert.equal(extractAcademicEventNoteMetadata(result.payload.note).rangeEnd||null,detail.endsAt===detail.startsAt?null:detail.endsAt);
});

test('actual SQL → service/hook/workspace → Calendar click → exact detail → Form → unchanged mutation preserves period and grade IDs',async t=>{
 const writes=[],rpcCalls=[];const params=new URLSearchParams('date=2196-10-06');
 const supabase={rpc(name,args){rpcCalls.push({name,args});if(name==='get_operations_calendar_range_v1'){assert.deepEqual({dateFrom:args.p_date_from,dateTo:args.p_date_to},fixture.calendar.range);return chain(fixture.calendar)}if(name==='get_academic_event_detail_v1')return chain(fixture.details.find(d=>d.id===args.p_event_id));if(name==='list_operations_catalogs_v1')return chain({academicSchools:[{id:fixture.details[0].schoolId,name:fixture.details[0].schoolName,category:'high'}]});if(name==='list_active_science_subject_areas_v1')return chain([]);throw Error(name)},from(table){assert.equal(table,'academic_events');return {update(payload){return {eq(key,id){assert.equal(key,'id');writes.push({id,payload});return Promise.resolve({error:null})}}}}}};
 const {AcademicCalendarWorkspace}=loadNotificationComponent('src/features/operations/academic-calendar-workspace.tsx',new Map([...mocks,
 ['next/navigation',{useRouter:()=>({push(){}}),useSearchParams:()=>params}],['@/providers/auth-provider',{useAuth:()=>({user:{id:'93993000-0000-4000-8000-000000000005'},profile:null,role:'admin',loading:false,canManageAll:true})}],['@/lib/supabase',{supabase}]]));
 const host=await mount(t,AcademicCalendarWorkspace,{});
 async function waitFor(fn){for(let i=0;i<100;i++){if(fn())return;await act(async()=>new Promise(r=>setTimeout(r,5)))}assert.ok(fn())}
 await waitFor(()=>host.querySelector('[aria-label="inclusive range 상세 보기"]'));
 for(const suffix of ['000000000001','000000000013']){
  const detail=fixture.details.find(d=>d.id.endsWith(suffix));const button=host.querySelector(`[aria-label="${detail.title} 상세 보기"]`);assert.ok(button);await act(async()=>button.click());await waitFor(()=>document.querySelector('#end-date'));
  assert.equal(document.querySelector('#end-date').value,detail.endsAt);assert.equal(document.querySelector('#date').value,detail.startsAt);
  const save=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='변경 저장');await act(async()=>save.click());await waitFor(()=>writes.some(w=>w.id===detail.id));await waitFor(()=>!document.querySelector('#end-date'));
  const write=writes.find(w=>w.id===detail.id);assert.equal(write.payload.date,detail.startsAt);assert.equal(write.payload.grade,detail.grade);assert.equal(extractAcademicEventNoteMetadata(write.payload.note).rangeEnd||null,detail.endsAt===detail.startsAt?null:detail.endsAt);
  assert.ok(rpcCalls.some(c=>c.name==='get_academic_event_detail_v1'&&c.args.p_event_id===detail.id));
 }
 assert.equal(writes.length,2);
});
