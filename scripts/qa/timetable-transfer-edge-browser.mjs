// Isolated transfer edge checks; data setup/perturbation is synthetic DB only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire('/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright'),id=()=>crypto.randomUUID();
const teacher=id(),room=id(),source=id(),target=id(),moved=id(),plans=[source,target,moved],prefix=`전송 edge ${source.slice(0,6)}`;
const out=new URL('../../docs/qa/timetable-presets-20260923/',import.meta.url);const evidence={plans,checks:[],errors:[]};
function sql(body){const r=spawnSync('/Users/hyunjun/.local/bin/docker',['exec','-i','tips_timetable_20260923','psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:body,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;}
sql(`insert into public.teacher_catalogs(id,name,subjects) values('${teacher}','${prefix} 교사',array['영어']);insert into public.classroom_catalogs(id,name,subjects) values('${room}','${prefix} 강의실',array['영어']);`);
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce',extraHTTPHeaders:{'x-timetable-fixture-db':'1'}});
await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'&&['3260','3262'].includes(u.port)?route.continue():route.abort();});await context.routeWebSocket(/.*/,socket=>socket.close());
const page=await context.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));
const rpc=async(name,args)=>{const res=await context.request.post(`http://127.0.0.1:3262/rest/v1/rpc/${name}`,{data:args});const data=await res.json();assert.ok(res.ok(),JSON.stringify(data));return data;};
const read=planId=>rpc('get_timetable_plan_v1',{p_plan_id:planId});const names={ [source]:prefix,[target]:`${prefix} 복사`,[moved]:`${prefix} 이동`};
const choosePlan=async pid=>{await page.getByRole('combobox',{name:'시간표',exact:true}).click();await page.getByRole('option',{name:names[pid],exact:true}).click();await page.getByRole('button',{name:'선택 이동·복사',exact:true}).waitFor();};
const choose=async(label,value)=>{await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();};
const open=()=>page.getByRole('button',{name:'선택 이동·복사',exact:true}).click();
const preview=()=>page.getByRole('button',{name:'선택 수업 다시 검사',exact:true}).click();
const complete=async(n,mode='복사')=>{await page.getByRole('button',{name:`확인한 수업 ${n}개 ${mode}`,exact:true}).click();await page.getByText('반영 완료 · 최신 시간표를 확인했습니다.',{exact:true}).waitFor();await page.getByRole('button',{name:'닫기',exact:true}).filter({visible:true}).click();};
try{
 for(const planId of plans)await rpc('mutate_timetable_plan_v1',{p_command:{operation:'create',planId,name:names[planId],requestKey:id()}});
 for(let n=0;n<3;n++){const itemId=id(),s=await read(source);await rpc('mutate_timetable_plan_item_v1',{p_command:{operation:'save',planId:source,expectedMetaRevision:0,expectedShadowFingerprint:s.shadowFingerprint,expectedItemRevision:null,requestKey:id(),item:{id:itemId,planId:source,name:`${prefix} 수업${n+1}`,subject:'영어',subjectAreaKey:null,grade:'중2',capacity:12,tuition:100000,defaultTeacherId:teacher,defaultClassroomId:room,durationMinutes:30,pendingSlots:[]},slots:n===2?[]:[{id:id(),itemId,planId:source,weekday:0,startMinute:600+n*60,endMinute:630+n*60,teacherId:teacher,classroomId:room,sourceSlotId:null}]}});}
 await page.goto('http://127.0.0.1:3260/__fixture');await choosePlan(source);
 await page.getByLabel(/이 프리셋 전체 3개/).filter({visible:true}).check();await open();await choose('목적지',names[target]);
 await page.getByLabel('충돌·미해결 배치를 미배치로 보존',{exact:true}).check();await preview();await complete(3);
 assert.equal((await read(source)).items.length,3);assert.equal((await read(target)).items.length,3);evidence.checks.push('explicit plan copy keep_pending preserves zero-slot source and new destination IDs');
 await open();await preview();await complete(3);const twice=await read(target);assert.equal(twice.items.length,6);assert.equal(twice.items.filter(i=>i.pendingSlots.length===1).length,2);evidence.checks.push('second plan copy preserves conflicting original slots as pending without overwriting drafts');
 await open();await choose('목적지',names[moved]);await choose('방식','이동 · 원안 제거');await preview();await page.getByText('미배치 슬롯을 모두 해결하세요.',{exact:true}).waitFor();
 await page.getByRole('checkbox',{name:`${prefix} 수업3 전송 선택`,exact:true}).click();await preview();await complete(2,'이동');assert.equal((await read(source)).items.length,1);assert.equal((await read(moved)).items.length,2);evidence.checks.push('plan move rejects unresolved selection; explicit exclusion moves two full items atomically');
 await choosePlan(moved);await page.getByRole('checkbox',{name:`${prefix} 수업1 선택`,exact:true}).check();await open();await preview();await page.getByRole('button',{name:'확인한 수업 1개 복사',exact:true}).waitFor();
 sql(`update public.teacher_catalogs set is_visible=false where id='${teacher}';`);await page.getByRole('button',{name:'확인한 수업 1개 복사',exact:true}).click();await page.getByRole('alert').filter({visible:true}).waitFor();
 await preview();await page.getByText('사용 가능한 선생님·강의실을 선택하세요.',{exact:true}).waitFor();
 sql(`update public.teacher_catalogs set is_visible=true where id='${teacher}';`);await preview();await complete(1);evidence.checks.push('catalog hiding rejects stale preview; explicit fresh check blocks then permits restored catalog');
 const promoted=await read(moved),applied=promoted.items.find(i=>i.state==='applied'),activeClass=applied.appliedClassId;
 await choose('수업 목록 범위','운영 반영 이력');await page.getByRole('button',{name:'새 초안으로 복제',exact:true}).click();await page.getByRole('button',{name:'저장',exact:true}).filter({visible:true}).click();
 await page.getByRole('heading',{name:'수업 전체 편집',exact:true}).waitFor({state:'hidden'});
 const cloned=await read(moved);const fresh=cloned.items.find(i=>i.id!==applied.id&&i.name===applied.name);assert.ok(fresh);assert.equal(fresh.state,'draft');assert.equal(fresh.appliedClassId,null);assert.equal(fresh.appliedTransferId,null);assert.equal(fresh.pendingSlots.length,1);assert.equal(cloned.slots.filter(s=>s.itemId===fresh.id).length,0);evidence.checks.push('applied clone creates new draft with original placement pending and all applied fields null');
 await choose('수업 목록 범위','전체 수업');
 await page.getByRole('button',{name:'이 배치 편성',exact:true}).click();
 const placement=page.getByRole('dialog',{name:'추가 배치',exact:true});
 assert.equal(await placement.getByRole('textbox',{name:'시작 시각',exact:true}).inputValue(),'10:00');
 assert.doesNotMatch(await placement.innerText(),/itemId|planId|sourceSlotId/);
 await page.screenshot({path:new URL('transfer-pending-readable.png',out).pathname});
 await placement.getByRole('button',{name:'닫기',exact:true}).click();await placement.waitFor({state:'hidden'});
 assert.deepEqual((await read(moved)).items.find(i=>i.id===fresh.id).pendingSlots,fresh.pendingSlots);
 await page.getByRole('button',{name:'이 배치 편성',exact:true}).click();
 await placement.getByRole('button',{name:'저장',exact:true}).click();await placement.getByRole('alert').waitFor();
 assert.deepEqual((await read(moved)).items.find(i=>i.id===fresh.id).pendingSlots,fresh.pendingSlots);
 await placement.getByRole('textbox',{name:'시작 시각',exact:true}).fill('12:13');await placement.getByRole('textbox',{name:'종료 시각',exact:true}).fill('12:43');
 let pendingBody;await page.route('**/rest/v1/rpc/mutate_timetable_plan_item_v1',async route=>{pendingBody=route.request().postDataJSON();await route.fulfill({status:503,json:{message:'fixture_pending_unknown'}});},{times:1});
 await placement.getByRole('button',{name:'저장',exact:true}).click();await placement.getByRole('button',{name:'원래 요청 재시도',exact:true}).waitFor();
 assert.equal(await placement.getByRole('textbox',{name:'시작 시각',exact:true}).inputValue(),'12:13');assert.deepEqual((await read(moved)).items.find(i=>i.id===fresh.id).pendingSlots,fresh.pendingSlots);
 const retry=page.waitForRequest(r=>r.url().endsWith('/mutate_timetable_plan_item_v1'));await placement.getByRole('button',{name:'원래 요청 재시도',exact:true}).click();assert.deepEqual((await retry).postDataJSON(),pendingBody);await placement.waitFor({state:'hidden'});
 const resolved=await read(moved);assert.equal(resolved.items.find(i=>i.id===fresh.id).pendingSlots.length,0);assert.equal(resolved.slots.find(s=>s.itemId===fresh.id).startMinute,733);assert.deepEqual(resolved.slots.filter(s=>s.itemId!==fresh.id),cloned.slots);
 evidence.checks.push('pending resolution prefills readable originals; cancel/conflict/unknown preserve pending and input; identical retry atomically resolves one pending and retains siblings');
 await page.getByRole('checkbox',{name:`${prefix} 수업2 선택`,exact:true}).check();await open();
 for(const change of ['modify','close','delete']){
  await preview();await page.getByRole('button',{name:'확인한 수업 1개 복사',exact:true}).waitFor();
  if(change==='modify')sql(`begin;select set_config('app.class_schedule_mutation','release2-rpc',true);update public.class_schedule_slots set start_time='10:05',end_time='10:35' where class_id='${activeClass}';update public.classes set schedule_revision=schedule_revision+1 where id='${activeClass}';commit;`);
  if(change==='close')sql(`begin;select set_config('app.class_close_mutation','v1',true);update public.classes set status='종강' where id='${activeClass}';commit;`);
  if(change==='delete')sql(`begin;select set_config('app.class_schedule_mutation','release2-rpc',true);delete from public.class_schedule_slots where class_id='${activeClass}';alter table public.classes disable trigger dashboard_audit_classes;delete from public.classes where id='${activeClass}';alter table public.classes enable trigger dashboard_audit_classes;commit;`);
  await page.getByRole('button',{name:'확인한 수업 1개 복사',exact:true}).click();await page.getByRole('alert').filter({visible:true}).waitFor();assert.equal((await read(moved)).items.filter(i=>i.state==='applied').length,1);evidence.checks.push(`operating shadow ${change} invalidates preview; no second promotion`);
 }
 await preview();await complete(1);const final=await read(moved);assert.equal(final.items.find(i=>i.id===applied.id).state,'applied');assert.equal(final.items.find(i=>i.id===applied.id).appliedClassId,null);
 await page.screenshot({path:new URL('transfer-edge-complete.png',out).pathname});assert.equal(evidence.errors.length,0);evidence.passed=true;
}catch(error){evidence.failure=error.stack;evidence.body=(await page.locator('body').innerText()).slice(-12000);await page.screenshot({path:new URL('transfer-edge-failure.png',out).pathname});}
finally{
 await browser.close();await fs.writeFile(new URL('transfer-edge-results.json',out),JSON.stringify(evidence,null,2));
 sql(`begin;select set_config('app.class_close_mutation','v1',true);select set_config('app.class_schedule_mutation','release2-rpc',true);update public.classes set status='종강' where id in(select class_id from public.class_schedule_slots where teacher_catalog_id='${teacher}');update public.timetable_plans set state='archived',meta_revision=meta_revision+1,change_sequence=change_sequence+1 where id=any(array[${plans.map(x=>`'${x}'::uuid`).join(',')}]);delete from public.teacher_catalogs where id='${teacher}';delete from public.classroom_catalogs where id='${room}';commit;`);
}
console.log(JSON.stringify(evidence,null,2));if(!evidence.passed)process.exitCode=1;
