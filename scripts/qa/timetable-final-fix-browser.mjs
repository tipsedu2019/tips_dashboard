// Task9 actual isolated DB browser checks. Two independent contexts; known actors only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const require=createRequire('/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true});
const report={boundary:'actual isolated DB commit/receipt through release editor; synthetic response loss and safe candidate enumeration; no provider Realtime',checks:[]};
const prefix=`Final fix browser ${Date.now()}`;
const record=(name,data={})=>{report.checks.push({name,passed:true,...data});console.log(name);};
async function context(actor){
 const context=await browser.newContext({viewport:{width:1440,height:960},locale:'ko-KR',reducedMotion:'reduce'});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1'||!['3260','3262'].includes(u.port))return route.abort();const headers={...route.request().headers(),'x-timetable-fixture-db':'1'};return route.continue({headers});});
 await context.routeWebSocket(/.*/,socket=>socket.close());
 const page=await context.newPage();await page.goto(`http://127.0.0.1:3260/__fixture${actor==='teacher'?'?actor=teacher':''}`);await page.getByRole('combobox',{name:'시간표',exact:true}).waitFor();return {context,page};
}
async function rpc(page,name,args){return page.evaluate(async({name,args})=>{const session=JSON.parse(localStorage.getItem('sb-127-auth-token'));const r=await fetch(`http://127.0.0.1:3262/rest/v1/rpc/${name}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${session.access_token}`,'x-timetable-fixture-db':'1'},body:JSON.stringify(args)});return {status:r.status,data:await r.json()};},{name,args});}
async function select(page,name){await page.getByRole('combobox',{name:'시간표',exact:true}).click();await page.getByRole('option',{name,exact:true}).click();}
const itemDraft=i=>{const {id,planId,name,subject,subjectAreaKey,grade,capacity,tuition,defaultTeacherId,defaultClassroomId,durationMinutes,pendingSlots}=i;return {id,planId,name,subject,subjectAreaKey,grade,capacity,tuition,defaultTeacherId,defaultClassroomId,durationMinutes,pendingSlots};};
try{
 const {context:ctx,page:a}=await context('admin');const planId=crypto.randomUUID();report.planId=planId;
 assert.equal((await rpc(a,'mutate_timetable_plan_v1',{p_command:{operation:'create',planId,name:prefix,requestKey:crypto.randomUUID()}})).status,200);
 const read=async()=>{const r=await rpc(a,'get_timetable_plan_v1',{p_plan_id:planId});assert.equal(r.status,200);return r.data;};
 const saveCommand=async(i,name)=>{const s=await read();return {operation:'save',planId,expectedMetaRevision:s.plan.metaRevision,expectedShadowFingerprint:s.shadowFingerprint,expectedItemRevision:i.revision,item:{...itemDraft(i),name},slots:s.slots.filter(slot=>slot.itemId===i.id),requestKey:crypto.randomUUID()};};
 let s=await read();const original={id:crypto.randomUUID(),planId,name:'기존 검증 수업',subject:'영어',subjectAreaKey:null,grade:'',capacity:null,tuition:null,defaultTeacherId:null,defaultClassroomId:null,durationMinutes:60,pendingSlots:[],revision:null};
 assert.equal((await rpc(a,'mutate_timetable_plan_item_v1',{p_command:await saveCommand(original,original.name)})).status,200);
 await a.reload();await select(a,prefix);
 const list=a.getByRole('complementary',{name:'프리셋 수업 목록',exact:true});
 const row=name=>list.locator('.border-b').filter({has:a.getByRole('checkbox',{name:`${name} 선택`,exact:true})});
 for(const existing of [true,false]){
  if(existing)await row('기존 검증 수업').getByRole('button',{name:'수업 전체 편집',exact:true}).click();else await a.getByRole('button',{name:'수업 추가',exact:true}).click();
  const name=existing?'응답 유실 기존':'응답 유실 신규';await a.getByLabel('수업명',{exact:true}).fill(name);
  let submitted;await a.route('**/mutate_timetable_plan_item_v1',async route=>{submitted=route.request().postDataJSON();const res=await route.fetch();assert.ok(res.ok(),await res.text());await route.fulfill({status:503,json:{message:'actual commit response lost'}});},{times:1});
  await a.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();await a.getByRole('dialog').getByRole('button',{name:'원래 요청 재시도',exact:true}).waitFor();
  assert.equal(submitted.p_command.expectedItemRevision,existing?1:null);
  await a.reload();await select(a,prefix);await a.getByRole('button',{name:'원래 요청 재시도',exact:true}).waitFor();
  const request=a.waitForRequest(r=>r.url().endsWith('/mutate_timetable_plan_item_v1'));
  await a.getByRole('button',{name:'원래 요청 재시도',exact:true}).click();assert.deepEqual((await request).postDataJSON(),submitted);
  await a.getByText('저장됨',{exact:true}).waitFor();s=await read();assert.equal(s.items.filter(i=>i.id===submitted.p_command.item.id).length,1);assert.equal(s.items.find(i=>i.id===submitted.p_command.item.id).revision,existing?2:1);
  record(`actual editor ${existing?'existing':'new'} commit loss → reload → immutable receipt`,{itemId:submitted.p_command.item.id,requestKey:submitted.p_command.requestKey});
 }
 // A collaborator changes the item immediately before our delete reaches the server.
 for(const choice of ['최신 내용 사용','삭제 다시 적용']){
  s=await read();const target=s.items.find(i=>i.id===original.id);await row(target.name).getByRole('button',{name:'수업 삭제',exact:true}).click();
  await a.route('**/mutate_timetable_plan_item_v1',async route=>{const body=route.request().postDataJSON();assert.equal(body.p_command.operation,'delete');const cmd=await saveCommand(target,target.name+' 갱신');assert.equal((await rpc(a,'mutate_timetable_plan_item_v1',{p_command:cmd})).status,200);await route.continue();},{times:1});
  await a.getByRole('dialog').getByRole('button',{name:'수업 삭제',exact:true}).click();
  await a.getByRole('dialog').getByRole('button',{name:choice,exact:true}).waitFor();
  assert.equal(await list.getByRole('checkbox',{name:`${target.name} 선택`,exact:true}).count(),0);
  await a.screenshot({path:`docs/qa/timetable-presets-20260923/final-fix-delete-${choice==='최신 내용 사용'?'accept':'reapply'}.png`});
  await a.getByRole('dialog').getByRole('button',{name:choice,exact:true}).click();await a.getByRole('dialog').waitFor({state:'hidden'});s=await read();assert.equal(s.items.some(i=>i.id===original.id),choice==='최신 내용 사용');
  record(`stale delete usable ${choice} despite absent optimistic item`);
 }
 // Exact definite rejection transport fixture: server SQL pair is separately asserted in pgTAP.
 const rejectedTarget=s.items[0];await row(rejectedTarget.name).getByRole('button',{name:'수업 삭제',exact:true}).click();
 await a.route('**/mutate_timetable_plan_item_v1',route=>route.fulfill({status:400,json:{code:'22023',message:'timetable_invalid'}}),{times:1});
 await a.getByRole('dialog').getByRole('button',{name:'수업 삭제',exact:true}).click();await a.getByRole('dialog').getByRole('button',{name:'거절된 요청 버리기',exact:true}).click();await a.getByRole('dialog').waitFor({state:'hidden'});assert.ok((await read()).items.some(i=>i.id===rejectedTarget.id));await row(rejectedTarget.name).getByRole('button',{name:'수업 삭제',exact:true}).waitFor();record('definite rejected delete exposes discard and restores canonical item',{transport:'synthetic exact 22023/timetable_invalid; no write sent'});
 // Lost delete whose canonical row no longer exists still exposes original replay.
 const target=s.items[0];await row(target.name).getByRole('button',{name:'수업 삭제',exact:true}).click();let deleted;
 await a.route('**/mutate_timetable_plan_item_v1',async route=>{deleted=route.request().postDataJSON();const res=await route.fetch();assert.ok(res.ok(),await res.text());await route.fulfill({status:503,json:{message:'delete commit response lost'}});},{times:1});
 await a.getByRole('dialog').getByRole('button',{name:'수업 삭제',exact:true}).click();await a.getByRole('dialog').getByRole('button',{name:'원래 요청 재시도',exact:true}).waitFor();await a.reload();await select(a,prefix);
 assert.equal(await a.getByRole('button',{name:'거절된 요청 버리기',exact:true}).count(),0);const request=a.waitForRequest(r=>r.url().endsWith('/mutate_timetable_plan_item_v1'));await a.getByRole('button',{name:'원래 요청 재시도',exact:true}).click();assert.deepEqual((await request).postDataJSON(),deleted);await a.getByText('저장됨',{exact:true}).waitFor();assert.equal((await read()).items.length,0);record('lost delete absent canonical row → reload → original receipt only');
 // Mobile candidate presentation uses safe synthetic source enumeration, no DB mutation.
 await select(a,'운영 시간표');await a.setViewportSize({width:390,height:844});await a.evaluate(()=>document.documentElement.classList.add('dark'));
 await a.route('**/list_timetable_import_sources_v1',route=>route.fulfill({json:{preparationClasses:[],legacyCandidates:[{key:'planner:term:2026-2:긴과목이름의모바일후보줄바꿈검증영어심화:teacher-weekly',entryCount:123,parseStatus:'ready',updatedAt:'2026-09-23T00:00:00Z'}]}}));
 await a.getByRole('button',{name:'기존 초안 가져오기',exact:true}).click();await a.getByRole('combobox',{name:'가져올 원본',exact:true}).click();await a.getByRole('option',{name:'이전 시간표 초안',exact:true}).click();
 const date=a.getByText('2026-09-23',{exact:true});await date.waitFor();assert.equal(await date.evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap');
 const bounds=await date.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);await a.screenshot({path:'docs/qa/timetable-presets-20260923/final-fix-import-mobile-dark.png'});record('390px dark long import candidate date stays unbroken',{bounds});
 await a.getByRole('dialog').getByRole('button',{name:'취소',exact:true}).click();s=await read();assert.equal((await rpc(a,'mutate_timetable_plan_v1',{p_command:{operation:'archive',planId,expectedMetaRevision:s.plan.metaRevision,requestKey:crypto.randomUUID()}})).status,200);const listed=await rpc(a,'list_timetable_plans_v1',{p_search:'Final fix browser'});report.archivedQaPlans=[];for(const plan of listed.data.plans.filter(p=>/^Final fix browser [0-9]{13}$/.test(p.name))){const snap=(await rpc(a,'get_timetable_plan_v1',{p_plan_id:plan.id})).data;assert.equal((await rpc(a,'mutate_timetable_plan_v1',{p_command:{operation:'archive',planId:plan.id,expectedMetaRevision:snap.plan.metaRevision,requestKey:crypto.randomUUID()}})).status,200);report.archivedQaPlans.push(plan.id);}await ctx.close();
}finally{await writeFile('docs/qa/timetable-presets-20260923/evidence/final-fix-browser.json',JSON.stringify(report,null,2));await browser.close();}
