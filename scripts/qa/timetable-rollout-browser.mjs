// Task9 actual isolated DB browser checks. Two independent contexts; known actors only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const require=createRequire('/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true});
const report={boundary:'two independent Playwright contexts, actual isolated DB RPC; polling/focus invalidation, no provider Realtime',checks:[]};
const prefix=`Task9 browser ${Date.now()}`;
const record=(name,data={})=>{report.checks.push({name,passed:true,...data});console.log(name);};
async function context(actor){
 const context=await browser.newContext({viewport:{width:1440,height:960},locale:'ko-KR',reducedMotion:'reduce'});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1'||!['3260','3262'].includes(u.port))return route.abort();const headers={...route.request().headers(),'x-timetable-fixture-db':'1'};return route.continue({headers});});
 await context.routeWebSocket(/.*/,socket=>socket.close());
 const page=await context.newPage();await page.goto(`http://127.0.0.1:3260/__fixture${actor==='teacher'?'?actor=teacher':''}`);await page.getByRole('combobox',{name:'시간표',exact:true}).waitFor();return {context,page};
}
async function rpc(page,name,args){return page.evaluate(async({name,args})=>{const session=JSON.parse(localStorage.getItem('sb-127-auth-token'));const r=await fetch(`http://127.0.0.1:3262/rest/v1/rpc/${name}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${session.access_token}`,'x-timetable-fixture-db':'1'},body:JSON.stringify(args)});return {status:r.status,data:await r.json()};},{name,args});}
async function select(page,name){await page.getByRole('combobox',{name:'시간표',exact:true}).click();await page.getByRole('option',{name,exact:true}).click();}
try{
 const admin=await context('admin'),teacher=await context('teacher');const a=admin.page,b=teacher.page;
 const actorIds=await Promise.all([a,b].map(p=>p.evaluate(()=>JSON.parse(localStorage.getItem('sb-127-auth-token')).user.id)));assert.notEqual(...actorIds);record('independent actual actor sessions',{actorIds});
 await a.getByRole('button',{name:'프리셋 만들기',exact:true}).click();await a.getByLabel('프리셋 이름',{exact:true}).fill(prefix+' lost create');
 let createBody;await a.route('**/mutate_timetable_plan_v1',async route=>{createBody=route.request().postDataJSON();const r=await route.fetch();assert.ok(r.ok(),await r.text());await route.fulfill({status:503,json:{message:'fixture lost response after actual commit'}});},{times:1});
 await a.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();await a.getByRole('button',{name:'원래 요청 재시도',exact:true}).waitFor();
 await a.getByLabel('프리셋 이름',{exact:true}).fill(prefix+' followup');await a.reload();await a.getByRole('button',{name:'원래 요청 확인',exact:true}).click();
 const retry=a.waitForRequest(r=>r.url().endsWith('/mutate_timetable_plan_v1'));await a.getByRole('button',{name:'원래 요청 재시도',exact:true}).click();assert.deepEqual((await retry).postDataJSON(),createBody);
 await a.getByText('원래 요청의 저장을 확인했습니다.',{exact:false}).waitFor();assert.equal(await a.getByLabel('프리셋 이름',{exact:true}).inputValue(),prefix+' followup');
 let listed=await rpc(a,'list_timetable_plans_v1',{p_search:prefix+' lost create'});assert.equal(listed.data.total,1);record('lost create response → reload → identical immutable request → one preset',{planId:createBody.p_command.planId,requestKey:createBody.p_command.requestKey});
 await a.getByRole('dialog').getByRole('button',{name:'취소',exact:true}).click();
 await select(a,'운영 시간표');await a.getByRole('button',{name:'기존 초안 가져오기',exact:true}).click();await a.getByLabel('새 프리셋 이름').fill(prefix+' import');
 await a.getByText('Task9 준비 A · 영어',{exact:true}).click();await a.getByText('Task9 준비 B · 영어',{exact:true}).click();await a.getByRole('button',{name:'선택한 원본 확인',exact:true}).click();await a.getByText('Task9 준비 A · 배치 1개',{exact:true}).waitFor();
 let importBody;await a.route('**/commit_timetable_plan_import_v1',async route=>{importBody=route.request().postDataJSON();const r=await route.fetch();assert.ok(r.ok(),await r.text());await route.fulfill({status:503,json:{message:'fixture import response lost after commit'}});},{times:1});
 await a.getByRole('dialog').getByRole('button',{name:'새 프리셋으로 가져오기',exact:true}).click();await a.getByRole('button',{name:'원래 요청 재시도',exact:true}).waitFor();await a.reload();await a.getByRole('button',{name:'가져오기 요청 확인',exact:true}).click();
 const importRetry=a.waitForRequest(r=>r.url().endsWith('/commit_timetable_plan_import_v1'));await a.getByRole('button',{name:'원래 요청 재시도',exact:true}).click();assert.deepEqual((await importRetry).postDataJSON(),importBody);await a.getByRole('dialog').waitFor({state:'hidden'});
 listed=await rpc(a,'list_timetable_plans_v1',{p_search:prefix+' import'});assert.equal(listed.data.total,1);const importedId=listed.data.plans[0].id;let snap=(await rpc(a,'get_timetable_plan_v1',{p_plan_id:importedId})).data;
 assert.equal(snap.items.length,2);assert.equal(snap.slots.length,1);assert.equal(snap.items.reduce((n,i)=>n+i.pendingSlots.length,0),1);record('preparing class import lost response → reload → same key → one preset and pending conflict',{planId:importedId,requestKey:importBody.p_command.requestKey});
 await a.screenshot({path:'docs/qa/timetable-presets-20260923/task9-import-desktop.png'});
 // Share actual imported plan to the eligible teacher, with a separate persistent permitted plan.
 const allowedId=crypto.randomUUID();assert.equal((await rpc(a,'mutate_timetable_plan_v1',{p_command:{operation:'create',planId:allowedId,name:prefix+' permitted',requestKey:crypto.randomUUID()}})).status,200);
 for(const id of [importedId,allowedId]){const s=(await rpc(a,'get_timetable_plan_v1',{p_plan_id:id})).data;assert.equal((await rpc(a,'mutate_timetable_plan_v1',{p_command:{operation:'share',planId:id,expectedMetaRevision:s.plan.metaRevision,members:[{userId:actorIds[1],access:'editor'}],requestKey:crypto.randomUUID()}})).status,200);}
 await b.reload();await select(b,prefix+' import');await b.locator('[data-plan-slot]').first().waitFor();await a.reload();await select(a,prefix+' import');await a.locator('[data-plan-slot]').first().waitFor();
 snap=(await rpc(a,'get_timetable_plan_v1',{p_plan_id:importedId})).data;
 const save=(item,name)=>{const {id,planId,subject,subjectAreaKey,grade,capacity,tuition,defaultTeacherId,defaultClassroomId,durationMinutes,pendingSlots}=item;return {operation:'save',planId:importedId,expectedMetaRevision:snap.plan.metaRevision,expectedShadowFingerprint:snap.shadowFingerprint,expectedItemRevision:item.revision,item:{id,planId,name,subject,subjectAreaKey,grade,capacity,tuition,defaultTeacherId,defaultClassroomId,durationMinutes,pendingSlots},slots:snap.slots.filter(s=>s.itemId===id),requestKey:crypto.randomUUID()};};
 const edits=[save(snap.items[0],prefix+' actor A'),save(snap.items[1],prefix+' actor B')];const merged=await Promise.all([rpc(a,'mutate_timetable_plan_item_v1',{p_command:edits[0]}),rpc(b,'mutate_timetable_plan_item_v1',{p_command:edits[1]})]);assert.ok(merged.every(r=>r.status===200),JSON.stringify(merged));
 snap=(await rpc(a,'get_timetable_plan_v1',{p_plan_id:importedId})).data;assert.ok(snap.items.some(i=>i.name===prefix+' actor A'));assert.ok(snap.items.some(i=>i.name===prefix+' actor B'));record('different items edited by independent actors merge');
 const same=[save(snap.items[0],prefix+' same A'),save(snap.items[0],prefix+' same B')];const collision=await Promise.all([rpc(a,'mutate_timetable_plan_item_v1',{p_command:same[0]}),rpc(b,'mutate_timetable_plan_item_v1',{p_command:same[1]})]);assert.equal(collision.filter(r=>r.status===200).length,1);assert.ok(collision.some(r=>r.data.code==='P0001'&&r.data.message==='timetable_stale'));record('same item actual concurrent edits yield one winner and one exact stale response');
 // Failed reference after valid load: existing board remains; edits and promotions are disabled.
 await a.evaluate(()=>window.dispatchEvent(new Event('focus')));await a.waitForTimeout(500);
 await a.getByRole('complementary',{name:'프리셋 수업 목록',exact:true}).getByRole('checkbox',{name:/ 선택$/}).first().click();assert.equal(await a.getByRole('button',{name:'선택 이동·복사',exact:true}).isEnabled(),true);
 await a.route('**/get_timetable_plan_v1',r=>r.fulfill({status:503,json:{message:'synthetic reference read failure'}}));await a.route('**/get_timetable_plan_revision_v1',r=>r.fulfill({status:503,json:{message:'synthetic reference read failure'}}));
 await a.evaluate(()=>window.dispatchEvent(new Event('focus')));await a.getByText('저장', {exact:false}).first().waitFor();await a.waitForTimeout(700);
 assert.ok(await a.locator('[data-plan-slot]').count());assert.equal(await a.locator('[data-plan-handle]').count(),0);const disabledCells=await a.locator('[data-plan-column] > button').evaluateAll(nodes=>nodes.every(n=>n.disabled));assert.ok(disabledCells);let forbiddenWrites=0;const countWrite=r=>{if(/\/(mutate_timetable|preview_timetable_plan_transfer|commit_timetable_plan_transfer)/.test(new URL(r.url()).pathname))forbiddenWrites++;};a.on('request',countWrite);
 for(const label of ['수업 추가','선택 이동·복사','프리셋 만들기']){const button=a.getByRole('button',{name:label,exact:true});assert.equal(await button.isDisabled(),true);const box=await button.boundingBox();assert.ok(box);await a.mouse.click(box.x+box.width/2,box.y+box.height/2);}
 await a.waitForTimeout(100);assert.equal(forbiddenWrites,0);a.off('request',countWrite);record('failed refreshed reference preserves good grid, disables previously enabled transfer and edit/create controls, sends zero mutation/transfer requests');
 await a.unroute('**/get_timetable_plan_v1');await a.unroute('**/get_timetable_plan_revision_v1');
 // Revocation must clear picker names, current view, pending scoped storage.
 const allowedSnap=(await rpc(b,'get_timetable_plan_v1',{p_plan_id:allowedId})).data;
 const allowedCommand={...save(snap.items[0],prefix+' preserved pending'),planId:allowedId,expectedItemRevision:null,expectedMetaRevision:allowedSnap.plan.metaRevision,expectedShadowFingerprint:allowedSnap.shadowFingerprint,slots:[]};allowedCommand.item={...allowedCommand.item,id:crypto.randomUUID(),planId:allowedId,pendingSlots:[]};
 // Real DB commit; preserve its submitted body as an uncertain, unmounted controller recovery.
 assert.equal((await rpc(b,'mutate_timetable_plan_item_v1',{p_command:allowedCommand})).status,200);
 const allowedRecovery=JSON.stringify({version:1,entries:[{edit:{operation:'save',item:allowedCommand.item,slots:[]},submitted:allowedCommand,status:'error',expectedItemRevision:null}]});
 await b.evaluate(({importedId,allowedId,allowedRecovery})=>{const base='tips:timetable:draft:v1:'+encodeURIComponent(JSON.parse(localStorage.getItem('sb-127-auth-token')).user.id+':teacher')+':';sessionStorage.setItem(base+allowedId,allowedRecovery);sessionStorage.setItem(base+encodeURIComponent('$metadata'),JSON.stringify({version:1,pending:{command:{operation:'rename',planId:importedId,requestKey:'revoked-metadata'},fields:{name:'revoked'}},followup:{name:'revoked'}}));},{importedId,allowedId,allowedRecovery});
 snap=(await rpc(a,'get_timetable_plan_v1',{p_plan_id:importedId})).data;assert.equal((await rpc(a,'mutate_timetable_plan_v1',{p_command:{operation:'share',planId:importedId,expectedMetaRevision:snap.plan.metaRevision,members:[],requestKey:crypto.randomUUID()}})).status,200);
 await b.evaluate(()=>window.dispatchEvent(new Event('focus')));await b.getByRole('combobox',{name:'시간표',exact:true}).filter({hasText:'운영 시간표'}).waitFor();await b.getByRole('combobox',{name:'시간표',exact:true}).click();assert.equal(await b.getByRole('option',{name:prefix+' import',exact:true}).count(),0);await b.getByRole('option',{name:prefix+' permitted',exact:true}).waitFor();assert.equal(await b.getByRole('option',{name:prefix+' permitted',exact:true}).count(),1);await b.keyboard.press('Escape');const remaining=await b.evaluate(()=>Object.fromEntries(Object.keys(sessionStorage).filter(k=>k.startsWith('tips:timetable:draft:v1:')).map(k=>[k,sessionStorage.getItem(k)])));assert.equal(Object.keys(remaining).length,1);assert.equal(Object.values(remaining)[0],allowedRecovery);assert.ok(Object.keys(remaining)[0].endsWith(allowedId));
 const receipt=await rpc(b,'mutate_timetable_plan_item_v1',{p_command:allowedCommand});assert.equal(receipt.status,200);assert.equal((await rpc(b,'get_timetable_plan_v1',{p_plan_id:allowedId})).data.items.length,1);
 record('teacher share revocation removes only revoked view/name/metadata, preserves other permitted plan submitted recovery byte-for-byte and same-key receipt',{allowedId,requestKey:allowedCommand.requestKey,otherRecoveryBoundary:'controller-format session storage seeded from real DB committed request; independent eligible teacher actual share revoke'});
 await b.screenshot({path:'docs/qa/timetable-presets-20260923/task9-revoked-teacher.png'});
 // Missing capability leaves the mounted operating read usable and refuses creation.
 await select(a,'운영 시간표');await a.route('**/list_timetable_plans_v1',r=>r.fulfill({status:404,json:{code:'PGRST202',message:'missing RPC'}}));await a.getByText('보관함',{exact:true}).click();await a.getByRole('alert').filter({hasText:'프리셋'}).first().waitFor();assert.equal(await a.getByRole('button',{name:'프리셋 만들기',exact:true}).count(),0);await a.getByText('Task9 운영 읽기',{exact:true}).first().waitFor();assert.ok(await a.locator('.timetable-grid').count());assert.equal(await a.getByRole('combobox',{name:'시간표',exact:true}).textContent(),'운영 시간표');assert.ok(await a.getByRole('tab',{name:'선생님 주간',exact:true}).filter({visible:true}).count());record('missing planner RPC leaves real operating read with no create action');
 await a.unroute('**/list_timetable_plans_v1');await a.getByRole('button',{name:'다시 불러오기',exact:true}).click();
 await select(a,prefix+' import');await a.locator('[data-plan-slot]').first().waitFor();
 const before=(await rpc(a,'get_timetable_plan_v1',{p_plan_id:importedId})).data;
 const shadow=a.locator('[data-shadow="true"] .timetable-block').first();await shadow.click();await a.getByRole('button',{name:'이 수업으로 새 초안 만들기',exact:true}).click();
 const newDraft=a.getByRole('dialog');await newDraft.getByRole('textbox',{name:'수업명',exact:true}).fill(prefix+' shadow basics');await newDraft.getByRole('button',{name:'저장',exact:true}).click();await newDraft.waitFor({state:'hidden'});
 const after=(await rpc(a,'get_timetable_plan_v1',{p_plan_id:importedId})).data;const basic=after.items.find(i=>i.name===prefix+' shadow basics');assert.ok(basic);assert.equal(after.slots.filter(s=>s.itemId===basic.id).length,0);assert.deepEqual(after.shadowSlots,before.shadowSlots);assert.deepEqual(after.shadowClasses,before.shadowClasses);record('active shadow → new draft copies basics with zero placements and unchanged operating source');
 report.passed=true;
} catch(error){report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{await writeFile('docs/qa/timetable-presets-20260923/task9-browser-results.json',JSON.stringify(report,null,2));await browser.close();}
